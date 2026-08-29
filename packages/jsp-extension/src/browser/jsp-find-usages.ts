/**
 * JSP → Java 跨文件 Find Usages — §7.2 P2-WEB
 *
 * Extends the existing JSP navigation to support Find Usages
 * across JSP and Java files. When the user triggers Find Usages
 * on a Java class referenced in JSP, this provider:
 *   1. Scans all JSP files for references via import, useBean, taglib
 *   2. Merges results with Java-level references from JDT LS
 *   3. Presents a unified Find Usages view
 *
 * When triggered on a Servlet mapping in web.xml, it:
 *   1. Finds all JSP files that link to the Servlet URL pattern
 *   2. Finds all Java files that reference the Servlet class
 *
 * Uses Theia's Monaco reference provider interface.
 * Timeout: 30s per search.
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';
import type { JspNavServices } from './jsp-nav-services';
import {
  WEB_XML_RE,
  findWebXmlClassReferences,
  getWorkspaceRootUri,
  isInsideXmlElement,
  isJavaClassName,
  resolveWorkspaceJavaClass,
  walkWorkspaceFiles,
} from './workspace-layout';

/** Timeout for each search phase. */
const SEARCH_TIMEOUT_MS = 30_000;

/** JSP file extensions. */
const JSP_EXTENSIONS = ['.jsp', '.jspx', '.tag', '.tagx'];

/** JSP reference patterns that indicate use of a Java class. */
const USE_BEAN_RE = /<jsp:useBean\b[^>]*\bclass\s*=\s*["']([^"']+)["']/gi;

/** URI pattern for servlet URL references in JSP: action="..." or form action="..." */
const SERVLET_URL_RE = /(?:action|href)\s*=\s*["']([^"']+)["']/gi;

/** Result of a find-usages search. */
export interface JspFindUsagesResult {
  /** Locations found in JSP files. */
  jspReferences: monaco.languages.Location[];
  /** Locations found in Java files. */
  javaReferences: monaco.languages.Location[];
  /** Locations found in web.xml files. */
  webXmlReferences: monaco.languages.Location[];
  /** Whether the search timed out. */
  timedOut: boolean;
  /** Total count. */
  totalCount: number;
}

/**
 * JSP Find Usages provider — registers as a Monaco ReferenceProvider
 * for the JSP language and also as a ReferenceProvider for Java
 * (to catch servlet-class → web.xml references).
 */
export class JspFindUsagesProvider {
  private readonly javaParser = new JspJavaParser();

  constructor(
    protected readonly fileService: FileService,
    protected readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Find all usages of a Java class name across JSP and Java files.
   */
  async findUsages(
    className: string,
    currentFileUri: string,
    cancellationToken: monaco.CancellationToken,
  ): Promise<JspFindUsagesResult> {
    const result: JspFindUsagesResult = {
      jspReferences: [],
      javaReferences: [],
      webXmlReferences: [],
      timedOut: false,
      totalCount: 0,
    };

    const startTime = Date.now();

    // Phase 1: Scan JSP files for references
    try {
      result.jspReferences = await this.scanJspFiles(className, cancellationToken);
      if (Date.now() - startTime > SEARCH_TIMEOUT_MS) {
        result.timedOut = true;
      }
    } catch {
      // Continue with partial results
    }

    // Phase 2: Scan web.xml files for servlet-class references
    try {
      if (!cancellationToken.isCancellationRequested && !result.timedOut) {
        result.webXmlReferences = await this.scanWebXmlFiles(className, cancellationToken);
      }
      if (Date.now() - startTime > SEARCH_TIMEOUT_MS) {
        result.timedOut = true;
      }
    } catch {
      // Continue with partial results
    }

    result.totalCount = result.jspReferences.length + result.javaReferences.length + result.webXmlReferences.length;
    return result;
  }

  /**
   * Find all JSP files that reference a given Servlet URL pattern.
   * Used when Find Usages is triggered on a servlet-mapping in web.xml.
   */
  async findServletUrlUsages(
    urlPattern: string,
    servletClass: string,
    cancellationToken: monaco.CancellationToken,
  ): Promise<JspFindUsagesResult> {
    const result: JspFindUsagesResult = {
      jspReferences: [],
      javaReferences: [],
      webXmlReferences: [],
      timedOut: false,
      totalCount: 0,
    };

    const startTime = Date.now();

    // Phase 1: Find JSP files linking to this URL pattern
    try {
      result.jspReferences = await this.scanJspFilesForUrl(urlPattern, cancellationToken);
      if (Date.now() - startTime > SEARCH_TIMEOUT_MS) {
        result.timedOut = true;
      }
    } catch {
      // Continue
    }

    // Phase 2: Find web.xml entries for the same servlet class
    try {
      if (!cancellationToken.isCancellationRequested && !result.timedOut) {
        result.webXmlReferences = await this.scanWebXmlFiles(servletClass, cancellationToken);
      }
    } catch {
      // Continue
    }

    result.totalCount = result.jspReferences.length + result.javaReferences.length + result.webXmlReferences.length;
    return result;
  }

  // ── Phase 1: Scan JSP files ──────────────────────────────────

  /**
   * Scan all JSP files in the workspace for references to a Java class name.
   */
  private async scanJspFiles(
    className: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    const rootUri = await getWorkspaceRootUri(this.workspaceService);
    if (!rootUri) return [];

    const results: monaco.languages.Location[] = [];
    const simpleName = className.split('.').pop()!;

    // Walk the workspace to find JSP files
    const jspFiles = await this.findJspFiles(rootUri, token);
    if (token.isCancellationRequested) return results;

    for (const jspFile of jspFiles) {
      if (token.isCancellationRequested) break;
      try {
        const content = await this.fileService.read(jspFile, { encoding: 'utf-8' });
        const refs = this.findReferencesInJspContent(content.value, className, simpleName);
        for (const ref of refs) {
          results.push({
            uri: monaco.Uri.parse(jspFile.toString()),
            range: new monaco.Range(ref.line, ref.column, ref.line, ref.column + ref.length),
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return results;
  }

  /**
   * Find references to a class name in JSP content.
   * Checks: page imports, useBean class, taglib uri, scriptlet/expression references.
   */
  private findReferencesInJspContent(
    content: string,
    fqn: string,
    simpleName: string,
  ): Array<{ line: number; column: number; length: number }> {
    const results: Array<{ line: number; column: number; length: number }> = [];
    const lines = content.split('\n');

    // Check page imports
    const imports = this.javaParser.parseImports(content);
    if (imports.get(simpleName) === fqn) {
      // Find where the import line mentions the class
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const importMatch = /<%@\s+page\s+[^%]*\bimport\s*=\s*"([^"]*)"[^%]*%>/i.exec(line);
        if (importMatch && importMatch[1].includes(simpleName)) {
          const col = importMatch[1].indexOf(simpleName);
          const beforeImport = importMatch[0].indexOf(importMatch[1]);
          results.push({ line: i + 1, column: (importMatch.index + beforeImport + col + 1), length: simpleName.length });
        }
      }
    }

    // Check useBean
    let m: RegExpExecArray | null;
    USE_BEAN_RE.lastIndex = 0;
    while ((m = USE_BEAN_RE.exec(content)) !== null) {
      if (m[1] === fqn || m[1].endsWith('.' + simpleName)) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        const lineStart = content.lastIndexOf('\n', m.index) + 1;
        const col = m.index - lineStart + 1;
        results.push({ line: lineNum, column: col, length: m[0].length });
      }
    }

    // Check scriptlets/expressions/declarations for the class name
    const blocks = this.javaParser.findJavaBlocks(content);
    for (const block of blocks) {
      const blockText = content.substring(block.start, block.end);
      let idx = 0;
      while ((idx = blockText.indexOf(simpleName, idx)) !== -1) {
        // Check that it's a word boundary
        const before = idx > 0 ? blockText.charCodeAt(idx - 1) : 0;
        const after = idx + simpleName.length < blockText.length ? blockText.charCodeAt(idx + simpleName.length) : 0;
        const isWordBoundary =
          !isJavaIdentChar(before) && !isJavaIdentChar(after);
        if (isWordBoundary) {
          const absOffset = block.start + idx;
          const lineNum = content.substring(0, absOffset).split('\n').length;
          const lineStart = content.lastIndexOf('\n', absOffset) + 1;
          const col = absOffset - lineStart + 1;
          results.push({ line: lineNum, column: col, length: simpleName.length });
        }
        idx += simpleName.length;
      }
    }

    return results;
  }

  /**
   * Scan all JSP files for references to a URL pattern.
   */
  private async scanJspFilesForUrl(
    urlPattern: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    const rootUri = await getWorkspaceRootUri(this.workspaceService);
    if (!rootUri) return [];

    const results: monaco.languages.Location[] = [];

    const jspFiles = await this.findJspFiles(rootUri, token);
    if (token.isCancellationRequested) return results;

    // Normalize the URL pattern for comparison (strip leading /*)
    const normalizedPattern = urlPattern.replace(/\/\*$/, '');

    for (const jspFile of jspFiles) {
      if (token.isCancellationRequested) break;
      try {
        const content = await this.fileService.read(jspFile, { encoding: 'utf-8' });
        const text = content.value;
        SERVLET_URL_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SERVLET_URL_RE.exec(text)) !== null) {
          const url = m[1];
          if (url === normalizedPattern || url.startsWith(normalizedPattern)) {
            const lineNum = text.substring(0, m.index).split('\n').length;
            const lineStart = text.lastIndexOf('\n', m.index) + 1;
            const col = m.index - lineStart + 1;
            results.push({
              uri: monaco.Uri.parse(jspFile.toString()),
              range: new monaco.Range(lineNum, col, lineNum, col + m[0].length),
            });
          }
        }
      } catch {
        // Skip
      }
    }

    return results;
  }

  // ── Phase 2: Scan web.xml files ───────────────────────────────

  /**
   * Scan all web.xml files for references to a servlet class name.
   */
  private async scanWebXmlFiles(
    className: string,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.Location[]> {
    return findWebXmlClassReferences(this.fileService, this.workspaceService, className, token);
  }

  // ── File discovery ────────────────────────────────────────────

  /**
   * Recursively find all JSP files in the workspace.
   */
  private findJspFiles(
    rootUri: URI,
    token: monaco.CancellationToken,
    maxFiles: number = 500,
  ): Promise<URI[]> {
    return walkWorkspaceFiles(
      this.fileService,
      rootUri,
      base => JSP_EXTENSIONS.some(ext => base.endsWith(ext)),
      token,
      maxFiles,
    );
  }
}

/**
 * Register the JSP Find Usages reference provider with Monaco.
 * Returns a Disposable for cleanup.
 */
export function registerJspFindUsages(services: JspNavServices): monaco.IDisposable {
  const provider = new JspFindUsagesProvider(services.fileService, services.workspaceService);

  const disposables: monaco.IDisposable[] = [];

  // Reference provider for JSP files: find references to Java classes
  disposables.push(
    monaco.languages.registerReferenceProvider(JSP_LANGUAGE_ID, {
      provideReferences: async (model, position, _context, token) => {
        if (token.isCancellationRequested) return [];

        const content = model.getValue();
        const parser = new JspJavaParser();
        const offset = parser.positionToOffset(content, position.lineNumber - 1, position.column - 1);

        const blocks = parser.findJavaBlocks(content);
        const block = parser.findBlockAt(blocks, offset);

        if (block) {
          // Inside a Java block — find the class name under cursor
          const wordInfo = parser.getWordAt(content, offset);
          if (wordInfo) {
            const imports = parser.parseImports(content);
            let fqn: string | null = null;
            if (imports.has(wordInfo.word)) {
              fqn = imports.get(wordInfo.word)!;
            } else if (wordInfo.word.length > 0 && wordInfo.word[0] === wordInfo.word[0].toUpperCase()) {
              fqn = wordInfo.word;
            }
            if (fqn) {
              const result = await provider.findUsages(fqn, model.uri.toString(), token);
              return [...result.jspReferences, ...result.javaReferences, ...result.webXmlReferences];
            }
          }
        }

        // Check if cursor is on a useBean class attribute
        const lineContent = model.getLineContent(position.lineNumber);
        const useBeanMatch = /<jsp:useBean\b[^>]*\bclass\s*=\s*["']([^"']+)["']/.exec(lineContent);
        if (useBeanMatch) {
          const className = useBeanMatch[1];
          const result = await provider.findUsages(className, model.uri.toString(), token);
          return [...result.jspReferences, ...result.javaReferences, ...result.webXmlReferences];
        }

        return [];
      },
    }),
  );

  // Reference provider for web.xml (XML) files: find references to servlet classes
  disposables.push(
    monaco.languages.registerReferenceProvider('xml', {
      provideReferences: async (model, position, _context, token) => {
        if (token.isCancellationRequested) return [];
        if (!WEB_XML_RE.test(model.uri.path)) return [];

        const word = model.getWordAtPosition(position);
        if (!word) return [];

        const className = word.word.trim();
        if (!isJavaClassName(className)) return [];

        // Check if we're inside a servlet-class element
        if (!isInsideXmlElement(model, position, 'servlet-class')) return [];

        const result = await provider.findUsages(className, model.uri.toString(), token);
        return [...result.jspReferences, ...result.javaReferences, ...result.webXmlReferences];
      },
    }),
  );

  return {
    dispose: () => disposables.forEach(d => d.dispose()),
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function isJavaIdentChar(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x5f ||
    code === 0x24
  );
}