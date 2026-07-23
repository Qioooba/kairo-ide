/**
 * web.xml editing assistance — code completion for servlet, filter,
 * and listener configuration elements.
 *
 * Provides:
 *  - servlet-class / filter-class / listener-class: workspace Java
 *    class suggestions (filtered by suffix)
 *  - servlet-name / filter-name: existing names from the current
 *    web.xml
 *  - url-pattern: common URL pattern suggestions
 *
 * Only activates for files matching WEB-INF/web.xml.
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { parseWebXml } from './webxml-parser';

/** Matches WEB-INF/web.xml in the URI path. */
const WEB_XML_RE = /WEB-INF[/\\]web\.xml$/i;

/** Common Java source roots in legacy web projects. */
const SRC_ROOTS = [
  'src/main/java',
  'src',
  'src/java',
  'WEB-INF/src',
  'web/WEB-INF/src',
  'webapp/WEB-INF/src',
  'WebContent/WEB-INF/src',
  'src/main/webapp/WEB-INF/src',
];

/** Common URL patterns for servlet/filter mapping. */
const URL_PATTERNS: monaco.languages.CompletionItem[] = [
  { label: '/', kind: monaco.languages.CompletionItemKind.Value, detail: '精确匹配根路径', insertText: '/', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
  { label: '/*', kind: monaco.languages.CompletionItemKind.Value, detail: '匹配所有路径', insertText: '/*', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
  { label: '*.do', kind: monaco.languages.CompletionItemKind.Value, detail: '匹配所有 .do 后缀', insertText: '*.do', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
  { label: '*.jsp', kind: monaco.languages.CompletionItemKind.Value, detail: '匹配所有 .jsp 后缀', insertText: '*.jsp', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
  { label: '*.html', kind: monaco.languages.CompletionItemKind.Value, detail: '匹配所有 .html 后缀', insertText: '*.html', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
  { label: '/api/*', kind: monaco.languages.CompletionItemKind.Value, detail: '匹配 /api/ 下的所有路径', insertText: '/api/*', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
  { label: '/admin/*', kind: monaco.languages.CompletionItemKind.Value, detail: '匹配 /admin/ 下的所有路径', insertText: '/admin/*', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } },
];

/** Build a CompletionItem with a default range placeholder. */
function ci(partial: Partial<monaco.languages.CompletionItem> & {
  label: string;
  kind: monaco.languages.CompletionItemKind;
  insertText: string;
}): monaco.languages.CompletionItem {
  return {
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
    ...partial,
  } as monaco.languages.CompletionItem;
}

/**
 * Check whether the cursor is inside a specific XML element.
 * Uses a simple scan of the model text around the position.
 */
function isInsideElement(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  elementName: string,
): boolean {
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  const before = text.substring(0, offset);
  const openTag = `<${elementName}>`;
  const closeTag = `</${elementName}>`;
  const openIdx = before.lastIndexOf(openTag);
  if (openIdx === -1) return false;
  const closeIdx = before.lastIndexOf(closeTag);
  if (closeIdx > openIdx) return false;
  const after = text.substring(offset);
  const endCloseIdx = after.indexOf(closeTag);
  return endCloseIdx !== -1;
}

/**
 * Extract existing servlet names from the current web.xml content.
 * Falls back to simple regex if DOMParser is unavailable.
 */
function extractServletNames(content: string): string[] {
  const parsed = parseWebXml(content);
  if (parsed) return Object.keys(parsed.servlets);
  // Fallback: regex extraction
  const names: string[] = [];
  const re = /<servlet-name>([^<]+)<\/servlet-name>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1].trim());
  }
  return [...new Set(names)];
}

/**
 * Extract existing filter names from the current web.xml content.
 */
function extractFilterNames(content: string): string[] {
  const names: string[] = [];
  const re = /<filter-name>([^<]+)<\/filter-name>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1].trim());
  }
  return [...new Set(names)];
}

/**
 * web.xml completion provider for servlet, filter, and listener
 * configuration elements.
 */
@injectable()
export class WebXmlCompletionProvider implements monaco.languages.CompletionItemProvider {
  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

  triggerCharacters = ['<', ' '];

  /** Cached list of fully qualified Java class names from the workspace. */
  private javaClassesCache: string[] | null = null;

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    if (!WEB_XML_RE.test(model.uri.path)) return { suggestions: [] };

    // Determine which element we're inside
    if (isInsideElement(model, position, 'servlet-class')) {
      return this.suggestJavaClasses(token, ['Servlet']);
    }
    if (isInsideElement(model, position, 'filter-class')) {
      return this.suggestJavaClasses(token, ['Filter']);
    }
    if (isInsideElement(model, position, 'listener-class')) {
      return this.suggestJavaClasses(token, ['Listener']);
    }
    if (isInsideElement(model, position, 'servlet-name')) {
      return this.suggestServletNames(model);
    }
    if (isInsideElement(model, position, 'filter-name')) {
      return this.suggestFilterNames(model);
    }
    if (isInsideElement(model, position, 'url-pattern')) {
      return { suggestions: URL_PATTERNS };
    }

    return { suggestions: [] };
  }

  /**
   * Invalidate the Java class cache (e.g. after file changes).
   */
  invalidateCache(): void {
    this.javaClassesCache = null;
  }

  private async suggestJavaClasses(
    token: monaco.CancellationToken,
    suffixes: string[],
  ): Promise<monaco.languages.CompletionList> {
    const classes = await this.scanJavaClasses(token);
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const cls of classes) {
      const simpleName = cls.split('.').pop()!;
      const matches = suffixes.some(s => simpleName.endsWith(s));
      if (!matches) continue;
      suggestions.push(ci({
        label: cls,
        kind: monaco.languages.CompletionItemKind.Class,
        detail: simpleName,
        insertText: cls,
      }));
    }
    return { suggestions };
  }

  private suggestServletNames(
    model: monaco.editor.ITextModel,
  ): monaco.languages.CompletionList {
    const content = model.getValue();
    const names = extractServletNames(content);
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const name of names) {
      suggestions.push(ci({
        label: name,
        kind: monaco.languages.CompletionItemKind.Value,
        detail: 'Servlet 名称',
        insertText: name,
      }));
    }
    return { suggestions };
  }

  private suggestFilterNames(
    model: monaco.editor.ITextModel,
  ): monaco.languages.CompletionList {
    const content = model.getValue();
    const names = extractFilterNames(content);
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const name of names) {
      suggestions.push(ci({
        label: name,
        kind: monaco.languages.CompletionItemKind.Value,
        detail: 'Filter 名称',
        insertText: name,
      }));
    }
    return { suggestions };
  }

  private async scanJavaClasses(token: monaco.CancellationToken): Promise<string[]> {
    if (this.javaClassesCache !== null) return this.javaClassesCache;

    const roots = await this.workspaceService.roots;
    if (roots.length === 0) {
      this.javaClassesCache = [];
      return [];
    }
    const rootUri = URI.fromFilePath(roots[0].resource.path.toString());

    const classes: string[] = [];
    for (const srcRoot of SRC_ROOTS) {
      if (token.isCancellationRequested) break;
      await this.walkJavaDir(rootUri.resolve(srcRoot), '', classes, token);
    }

    this.javaClassesCache = classes;
    return classes;
  }

  private async walkJavaDir(
    uri: URI,
    pkg: string,
    classes: string[],
    token: monaco.CancellationToken,
  ): Promise<void> {
    if (token.isCancellationRequested) return;
    try {
      const stat = await this.fileService.resolve(uri, { resolveMetadata: false });
      if (!stat.children) return;
      for (const child of stat.children) {
        if (token.isCancellationRequested) return;
        const basename = child.resource.path.base;
        if (child.isDirectory) {
          if (basename.startsWith('.') || basename === 'node_modules' || basename === 'lib' || basename === 'dist') {
            continue;
          }
          const subPkg = pkg ? `${pkg}.${basename}` : basename;
          await this.walkJavaDir(child.resource, subPkg, classes, token);
        } else if (basename.endsWith('.java')) {
          const className = basename.substring(0, basename.length - 5); // strip .java
          const fqn = pkg ? `${pkg}.${className}` : className;
          classes.push(fqn);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
}