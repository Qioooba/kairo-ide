/**
 * JSP ↔ Servlet bidirectional navigation.
 *
 * - Ctrl+Click on form action="/xxx" or href="/xxx" in a JSP file
 *   navigates to the matching servlet-class in Java source.
 * - Ctrl+Click on <servlet-class> or <filter-class> in web.xml
 *   navigates to the corresponding Java source file.
 *
 * Registered as Monaco DefinitionProviders.
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { parseWebXml, type WebXml } from './webxml-parser';

/** Common Java source roots in legacy web projects. */
const SRC_ROOTS = [
  'src/main/java',
  'src',
  'src/java',
  'WEB-INF/src',
  'web/WEB-INF/src',
];

/** Common web.xml locations relative to workspace root. */
const WEB_XML_PATHS = [
  'WEB-INF/web.xml',
  'web/WEB-INF/web.xml',
  'webapp/WEB-INF/web.xml',
  'WebContent/WEB-INF/web.xml',
  'src/main/webapp/WEB-INF/web.xml',
];

/** Matches WEB-INF/web.xml in the URI path. */
const WEB_XML_RE = /WEB-INF[/\\]web\.xml$/i;

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
      if (servlet) return servlet.servletClass;
    }
  }

  // Try prefix matching (e.g. /api/*)
  for (const m of webXml.mappings) {
    if (m.urlPattern.endsWith('/*')) {
      const prefix = m.urlPattern.slice(0, -2);
      if (path.startsWith(prefix)) {
        const servlet = webXml.servlets[m.servletName];
        if (servlet) return servlet.servletClass;
      }
    }
  }

  // Try extension matching (e.g. *.do)
  for (const m of webXml.mappings) {
    if (m.urlPattern.startsWith('*.')) {
      const ext = m.urlPattern.slice(1);
      if (path.endsWith(ext)) {
        const servlet = webXml.servlets[m.servletName];
        if (servlet) return servlet.servletClass;
      }
    }
  }

  // Default servlet match (/) — lowest priority
  for (const m of webXml.mappings) {
    if (m.urlPattern === '/') {
      const servlet = webXml.servlets[m.servletName];
      if (servlet) return servlet.servletClass;
    }
  }

  return null;
}

/**
 * Check if a string looks like a fully qualified Java class name.
 */
function isJavaClassName(name: string): boolean {
  return /^[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+$/.test(name);
}

/**
 * Check whether the cursor is inside a <servlet-class> or <filter-class> element.
 */
function isInsideClassElement(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): boolean {
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  const before = text.substring(0, offset);

  // Check for <servlet-class>
  const scOpen = before.lastIndexOf('<servlet-class>');
  const scClose = before.lastIndexOf('</servlet-class>');
  if (scOpen !== -1 && (scClose === -1 || scClose < scOpen)) {
    const after = text.substring(offset);
    if (after.indexOf('</servlet-class>') !== -1) return true;
  }

  // Check for <filter-class>
  const fcOpen = before.lastIndexOf('<filter-class>');
  const fcClose = before.lastIndexOf('</filter-class>');
  if (fcOpen !== -1 && (fcClose === -1 || fcClose < fcOpen)) {
    const after = text.substring(offset);
    if (after.indexOf('</filter-class>') !== -1) return true;
  }

  return false;
}

@injectable()
export class JspServletNavigationProvider implements monaco.languages.DefinitionProvider {
  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

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
    if (/^(https?:|ftp:|mailto:|javascript:|data:)/i.test(urlMatch.url)) {
      return [];
    }

    // Load and parse web.xml
    const webXml = await this.loadWebXml(token);
    if (!webXml) return [];

    const servletClass = findMatchingServletClass(webXml, urlMatch.url);
    if (!servletClass) return [];

    return this.resolveJavaClass(servletClass, token);
  }

  /**
   * Load and parse web.xml from the workspace.
   */
  private async loadWebXml(token: monaco.CancellationToken): Promise<WebXml | undefined> {
    const roots = await this.workspaceService.roots;
    if (roots.length === 0) return undefined;

    const rootUri = URI.fromFilePath(roots[0].resource.path.toString());
    for (const webXmlPath of WEB_XML_PATHS) {
      if (token.isCancellationRequested) return undefined;
      const webXmlUri = rootUri.resolve(webXmlPath);
      try {
        const content = await this.fileService.read(webXmlUri, { encoding: 'utf-8' });
        const parsed = parseWebXml(content.value);
        if (parsed) return parsed;
      } catch {
        // web.xml not found at this path; try next
      }
    }
    return undefined;
  }

  /**
   * Resolve a fully qualified Java class name to a file URI in the workspace.
   */
  private async resolveJavaClass(
    className: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    const relativePath = className.replace(/\./g, '/') + '.java';
    const roots = await this.workspaceService.roots;
    if (roots.length === 0) return [];

    const rootUri = URI.fromFilePath(roots[0].resource.path.toString());
    for (const srcRoot of SRC_ROOTS) {
      if (token.isCancellationRequested) return [];
      const candidate = rootUri.resolve(srcRoot).resolve(relativePath);
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
 * Register the JSP form action → Servlet navigation definition provider.
 * When user Ctrl+Clicks on form action="/xxx" or href="/xxx" in a JSP file,
 * navigates to the matching servlet's Java class.
 */
export function registerJspServletNavigation(): monaco.IDisposable {
  return monaco.languages.registerDefinitionProvider(
    JSP_LANGUAGE_ID,
    new JspServletNavigationProvider(),
  );
}

/**
 * Register the web.xml class navigation definition provider.
 * When user Ctrl+Clicks on <servlet-class> or <filter-class> in web.xml,
 * navigates to the corresponding Java class file.
 */
export function registerWebXmlClassNavigation(): monaco.IDisposable {
  const provider = new JspServletNavigationProvider();

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
      const className = word.word.trim();
      if (!isJavaClassName(className)) return [];

      if (!isInsideClassElement(model, position)) return [];

      return (provider as any).resolveJavaClass(className, token);
    },
  });
}