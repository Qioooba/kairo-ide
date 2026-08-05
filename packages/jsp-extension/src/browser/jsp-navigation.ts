/**
 * JSP navigation provider — Ctrl+Click navigation to included files,
 * taglib references, static resource paths, and Java type references.
 *
 * Registers a Monaco DefinitionProvider for the JSP language that
 * resolves:
 *   - <%@ include file="..." %>  (static include)
 *   - <jsp:include page="..." />  (dynamic include)
 *   - <%@ taglib uri="..." %>    (local taglib paths)
 *   - <link href="..." />        (CSS)
 *   - <script src="..." />       (JS)
 *   - <img src="..." />          (images)
 *   - Java type references in scriptlets / expressions / declarations
 *     (resolved via <%@ page import="..." %> directives)
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { JspJavaParser } from './jsp-java-nav';
import type { JspNavServices } from './jsp-nav-services';

/** Common Java source roots in legacy web projects. */
const SRC_ROOTS = [
  'src/main/java',
  'src',
  'src/java',
  'WEB-INF/src',
  'web/WEB-INF/src',
];

interface PathExtractor {
  /** Regex that captures the file path in group 1. */
  regex: RegExp;
}

/**
 * Patterns for extracting file paths from JSP/HTML directives.
 * Each regex must capture the path in capture group 1 and
 * must be used with the `g` flag for iterating over all matches.
 */
const EXTRACTORS: PathExtractor[] = [
  // <%@ include file="path" %>
  { regex: /<%@\s+include\s+file\s*=\s*["']([^"']+)["']/gi },
  // <jsp:include page="path" />
  { regex: /<jsp:include\b[^>]*\bpage\s*=\s*["']([^"']+)["']/gi },
  // <%@ taglib uri="path" %>
  { regex: /<%@\s+taglib\b[^>]*\buri\s*=\s*["']([^"']+)["']/gi },
  // <link href="path" />
  { regex: /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi },
  // <script src="path" />
  { regex: /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
  // <img src="path" />
  { regex: /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi },
];

function isAbsoluteUrl(path: string): boolean {
  return /^(https?:|ftp:|mailto:|javascript:|data:)/i.test(path);
}

/**
 * Walk up from the current URI looking for a WEB-INF segment; the
 * parent of WEB-INF is the webapp root. Also recognizes common
 * Eclipse/Maven web roots embedded in the path.
 * Exported for unit tests (JV-P2-7).
 */
export function findWebappRoot(currentUri: monaco.Uri): monaco.Uri | undefined {
  const parts = currentUri.path.split('/').filter(p => p.length > 0);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'WEB-INF') {
      const rootPath = '/' + parts.slice(0, i).join('/');
      return currentUri.with({ path: rootPath || '/' });
    }
  }

  // Fallback: known web-root folder names as a path segment
  const webRootNames = new Set(['webapp', 'WebContent', 'web', 'WebRoot']);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (webRootNames.has(parts[i])) {
      const rootPath = '/' + parts.slice(0, i + 1).join('/');
      return currentUri.with({ path: rootPath });
    }
  }

  return undefined;
}

export class JspNavigationProvider implements monaco.languages.DefinitionProvider {
  private readonly javaParser = new JspJavaParser();

  constructor(
    protected readonly fileService: FileService,
    protected readonly workspaceService: WorkspaceService,
  ) {}

  async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _token: monaco.CancellationToken,
  ): Promise<monaco.languages.Definition> {
    // --- Phase 1: file-path navigation (existing behaviour) ---
    const lineContent = model.getLineContent(position.lineNumber);
    const column = position.column - 1; // Monaco columns are 1-based

    for (const extractor of EXTRACTORS) {
      extractor.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = extractor.regex.exec(lineContent)) !== null) {
        const fullMatch = match[0];
        const pathValue = match[1];
        const matchStart = match.index;
        const matchEnd = matchStart + fullMatch.length;

        if (column < matchStart || column >= matchEnd) continue;

        if (!isAbsoluteUrl(pathValue)) {
          const targetUri = await this.resolvePath(model.uri, pathValue);
          if (targetUri) {
            return [{
              uri: targetUri,
              range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            }];
          }
        }
        return [];
      }
    }

    // --- Phase 2: Java type reference inside <% ... %> blocks ---
    const content = model.getValue();
    const offset = this.javaParser.positionToOffset(content, position.lineNumber - 1, position.column - 1);

    const blocks = this.javaParser.findJavaBlocks(content);
    const block = this.javaParser.findBlockAt(blocks, offset);
    if (!block) return [];

    const wordInfo = this.javaParser.getWordAt(content, offset);
    if (!wordInfo) return [];

    // Resolve via page imports
    const imports = this.javaParser.parseImports(content);
    let fqn: string | null = null;
    if (imports.has(wordInfo.word)) {
      fqn = imports.get(wordInfo.word)!;
    } else if (wordInfo.word.length > 0 && wordInfo.word[0] === wordInfo.word[0].toUpperCase()) {
      fqn = wordInfo.word;
    }
    if (!fqn) return [];

    return this.resolveJavaClass(fqn, _token);
  }

  /**
   * Resolve a JSP/HTML path relative to the current file, or as a
   * webapp-absolute path when it starts with `/` (e.g. `/WEB-INF/...`).
   * Returns undefined when the target does not exist (JV-P2-7).
   */
  private async resolvePath(
    currentUri: monaco.Uri,
    path: string,
  ): Promise<monaco.Uri | undefined> {
    let candidate: monaco.Uri | undefined;
    try {
      if (path.startsWith('/')) {
        const webRoot = findWebappRoot(currentUri);
        if (!webRoot) {
          return undefined;
        }
        candidate = monaco.Uri.joinPath(webRoot, path.replace(/^\/+/, ''));
      } else {
        const dir = monaco.Uri.joinPath(currentUri, '..');
        candidate = monaco.Uri.joinPath(dir, path);
      }
    } catch {
      return undefined;
    }

    if (!candidate) {
      return undefined;
    }

    try {
      await this.fileService.resolve(new URI(candidate.toString(true)), {
        resolveMetadata: false,
      });
      return candidate;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a fully qualified Java class name to a file URI in the
   * workspace. Returns the first matching source file found.
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
        // File doesn't exist at this path; try next.
      }
    }
    return [];
  }
}

/**
 * Register the JSP navigation definition provider with Monaco.
 * Returns a Disposable for cleanup.
 */
export function registerJspNavigation(services: JspNavServices): monaco.IDisposable {
  return monaco.languages.registerDefinitionProvider(
    JSP_LANGUAGE_ID,
    new JspNavigationProvider(services.fileService, services.workspaceService),
  );
}