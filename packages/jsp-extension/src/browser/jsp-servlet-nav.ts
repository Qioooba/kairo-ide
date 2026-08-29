/**
 * JSP ↔ Servlet bidirectional navigation.
 *
 * - Ctrl+Click on form action="/xxx" or href="/xxx" in a JSP file
 *   navigates to the matching servlet-class in Java source.
 * - Ctrl+Click on <servlet-class> or <filter-class> in web.xml
 *   navigates to the corresponding Java source file.
 * - Ctrl+Click on <jsp-file> in web.xml navigates to the JSP file.
 * - Ctrl+Click on a servlet-name in web.xml navigates to the servlet
 *   class or JSP file.
 *
 * Registered as Monaco DefinitionProviders.
 */

import * as monaco from '@theia/monaco-editor-core';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { type WebXml } from './webxml-parser';
import type { JspNavServices } from './jsp-nav-services';
import {
  WEB_XML_RE,
  WEB_DOC_ROOTS,
  getWorkspaceRootUri,
  isInsideXmlElement,
  isJavaClassName,
  loadWorkspaceWebXml,
  resolveWorkspaceJavaClass,
} from './workspace-layout';
import { isAbsoluteUrl } from './jsp-navigation';

/** Regexes for extracting URL values from JSP/HTML attributes. */
const FORM_ACTION_RE = /<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi;
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;

interface UrlMatch {
  url: string;
  matchStart: number;
  matchEnd: number;
}

/**
 * Extract the URL value under the cursor from a line of JSP/HTML content.
 * Returns null if the cursor is not on a form action or href attribute.
 */
function extractUrlAtColumn(lineContent: string, column: number): UrlMatch | null {
  const extractors = [FORM_ACTION_RE, HREF_RE];
  for (const re of extractors) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineContent)) !== null) {
      const fullMatch = m[0];
      const url = m[1];
      const matchStart = m.index;
      const matchEnd = matchStart + fullMatch.length;
      if (column >= matchStart && column < matchEnd) {
        return { url, matchStart, matchEnd };
      }
    }
  }
  return null;
}

/**
 * Find the servlet class that matches a given URL path.
 * Supports exact, prefix, and extension matching as per Servlet spec.
 */
function findMatchingServletClass(webXml: WebXml, url: string): string | null {
  // Remove query string and fragment
  const path = url.split(/[?#]/)[0];

  // Try exact match first
  for (const m of webXml.mappings) {
    if (m.urlPattern === path) {
      const servlet = webXml.servlets[m.servletName];
      if (servlet?.servletClass) return servlet.servletClass;
    }
  }

  // Try prefix matching (e.g. /api/*)
  for (const m of webXml.mappings) {
    if (m.urlPattern.endsWith('/*')) {
      const prefix = m.urlPattern.slice(0, -2);
      if (path.startsWith(prefix)) {
        const servlet = webXml.servlets[m.servletName];
        if (servlet?.servletClass) return servlet.servletClass;
      }
    }
  }

  // Try extension matching (e.g. *.do)
  for (const m of webXml.mappings) {
    if (m.urlPattern.startsWith('*.')) {
      const ext = m.urlPattern.slice(1);
      if (path.endsWith(ext)) {
        const servlet = webXml.servlets[m.servletName];
        if (servlet?.servletClass) return servlet.servletClass;
      }
    }
  }

  // Default servlet match (/) — lowest priority
  for (const m of webXml.mappings) {
    if (m.urlPattern === '/') {
      const servlet = webXml.servlets[m.servletName];
      if (servlet?.servletClass) return servlet.servletClass;
    }
  }

  return null;
}

/**
 * Find the JSP file that matches a given URL path.
 * Returns the JSP file path from the servlet definition.
 */
function findMatchingJspFile(webXml: WebXml, url: string): string | null {
  const path = url.split(/[?#]/)[0];

  for (const m of webXml.mappings) {
    if (m.urlPattern === path || (m.urlPattern.endsWith('/*') && path.startsWith(m.urlPattern.slice(0, -2)))) {
      const servlet = webXml.servlets[m.servletName];
      if (servlet?.jspFile) return servlet.jspFile;
    }
  }
  return null;
}

export class JspServletNavigationProvider implements monaco.languages.DefinitionProvider {
  constructor(
    protected readonly fileService: FileService,
    protected readonly workspaceService: WorkspaceService,
  ) {}

  async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Definition> {
    if (token.isCancellationRequested) return [];

    const lineContent = model.getLineContent(position.lineNumber);
    const column = position.column - 1;

    const urlMatch = extractUrlAtColumn(lineContent, column);
    if (!urlMatch) return [];

    // Skip absolute URLs (http://, https://, etc.)
    if (isAbsoluteUrl(urlMatch.url)) {
      return [];
    }

    // Load and parse web.xml
    const webXml = await this.loadWebXml(token);
    if (!webXml) return [];

    // Try to find matching JSP file first
    const jspFile = findMatchingJspFile(webXml, urlMatch.url);
    if (jspFile) {
      const jspUri = await this.resolveJspFile(jspFile, token);
      if (jspUri.length > 0) return jspUri;
    }

    // Try to find matching servlet class
    const servletClass = findMatchingServletClass(webXml, urlMatch.url);
    if (servletClass) {
      return this.resolveJavaClass(servletClass, token);
    }

    return [];
  }

  /**
   * Load and parse web.xml from the workspace.
   */
  async loadWebXml(token: monaco.CancellationToken): Promise<WebXml | undefined> {
    const loaded = await loadWorkspaceWebXml(this.fileService, this.workspaceService, token);
    return loaded?.webXml;
  }

  /**
   * Resolve a fully qualified Java class name to a file URI in the workspace.
   */
  resolveJavaClass(
    className: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    return resolveWorkspaceJavaClass(this.fileService, this.workspaceService, className, token);
  }

  /**
   * Resolve a JSP file path relative to the web application root.
   * JSP files in web.xml use paths like "/index.jsp" — they are relative
   * to the web application root (e.g., "web/" or "WebContent/").
   */
  async resolveJspFile(
    jspPath: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    // Normalize the path: remove leading slash
    const relativePath = jspPath.replace(/^\/+/, '');

    const rootUri = await getWorkspaceRootUri(this.workspaceService);
    if (!rootUri) return [];

    for (const webRoot of WEB_DOC_ROOTS) {
      if (token.isCancellationRequested) return [];
      const candidate = webRoot
        ? rootUri.resolve(webRoot).resolve(relativePath)
        : rootUri.resolve(relativePath);
      try {
        await this.fileService.resolve(candidate, { resolveMetadata: false });
        return [{
          uri: monaco.Uri.parse(candidate.toString()),
          range: new monaco.Range(1, 1, 1, 1),
        }];
      } catch {
        // File doesn't exist at this path; try next
      }
    }
    return [];
  }
}

/**
 * Register the JSP form action → Servlet/JSP navigation definition provider.
 * When user Ctrl+Clicks on form action="/xxx" or href="/xxx" in a JSP file,
 * navigates to the matching servlet's Java class or the JSP file.
 */
export function registerJspServletNavigation(services: JspNavServices): monaco.IDisposable {
  const provider = new JspServletNavigationProvider(services.fileService, services.workspaceService);
  return monaco.languages.registerDefinitionProvider(
    JSP_LANGUAGE_ID,
    provider,
  );
}

/**
 * Register the web.xml class / JSP file navigation definition provider.
 * When user Ctrl+Clicks on:
 *  - <servlet-class> or <filter-class> → navigates to Java class
 *  - <jsp-file> → navigates to the JSP file
 *  - <servlet-name> → navigates to the servlet class or JSP file
 */
export function registerWebXmlClassNavigation(services: JspNavServices): monaco.IDisposable {
  const provider = new JspServletNavigationProvider(services.fileService, services.workspaceService);

  return monaco.languages.registerDefinitionProvider('xml', {
    provideDefinition: async (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      token: monaco.CancellationToken,
    ): Promise<monaco.languages.Definition> => {
      if (token.isCancellationRequested) return [];
      if (!WEB_XML_RE.test(model.uri.path)) return [];

      const word = model.getWordAtPosition(position);
      if (!word) return [];

      const text = word.word.trim();

      // ── <servlet-class> → Java class ─────────────────────
      if (isInsideXmlElement(model, position, 'servlet-class') && isJavaClassName(text)) {
        return provider.resolveJavaClass(text, token);
      }

      // ── <filter-class> → Java class ──────────────────────
      if (isInsideXmlElement(model, position, 'filter-class') && isJavaClassName(text)) {
        return provider.resolveJavaClass(text, token);
      }

      // ── <jsp-file> → JSP file ────────────────────────────
      if (isInsideXmlElement(model, position, 'jsp-file')) {
        return provider.resolveJspFile(text, token);
      }

      // ── <servlet-name> → servlet class or JSP file ───────
      if (isInsideXmlElement(model, position, 'servlet-name')) {
        const webXml = await provider.loadWebXml(token);
        if (webXml) {
          const servlet = webXml.servlets[text];
          if (servlet) {
            if (servlet.jspFile) {
              return provider.resolveJspFile(servlet.jspFile, token);
            }
            if (servlet.servletClass) {
              return provider.resolveJavaClass(servlet.servletClass, token);
            }
          }
        }
      }

      return [];
    },
  });
}