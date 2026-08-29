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
import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { KairoI18nService } from '@kairo/i18n';
import { parseWebXml } from './webxml-parser';
import { setJspI18n, t } from './i18n-context';
import {
  JAVA_SRC_ROOTS,
  WEB_XML_RE,
  getWorkspaceRootUri,
  isInsideXmlElement,
} from './workspace-layout';

/** Common URL patterns for servlet/filter mapping. Built per provide call. */
function buildUrlPatterns(range?: monaco.IRange): monaco.languages.CompletionItem[] {
  return [
    { label: '/', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.root'), insertText: '/', ...(range ? { range } : {}) },
    { label: '/*', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.all'), insertText: '/*', ...(range ? { range } : {}) },
    { label: '*.do', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.extDo'), insertText: '*.do', ...(range ? { range } : {}) },
    { label: '*.jsp', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.extJsp'), insertText: '*.jsp', ...(range ? { range } : {}) },
    { label: '*.html', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.extHtml'), insertText: '*.html', ...(range ? { range } : {}) },
    { label: '/api/*', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.apiPrefix'), insertText: '/api/*', ...(range ? { range } : {}) },
    { label: '/admin/*', kind: monaco.languages.CompletionItemKind.Value, detail: t('completion.webxml.urlPattern.adminPrefix'), insertText: '/admin/*', ...(range ? { range } : {}) },
  ] as monaco.languages.CompletionItem[];
}

/** Build a CompletionItem without a hard-coded range (caller supplies word range). */
function ci(partial: Partial<monaco.languages.CompletionItem> & {
  label: string;
  kind: monaco.languages.CompletionItemKind;
  insertText: string;
}): monaco.languages.CompletionItem {
  return {
    ...partial,
  } as monaco.languages.CompletionItem;
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

  @inject(KairoI18nService)
  @optional()
  protected readonly i18n?: KairoI18nService;

  triggerCharacters = ['<', ' '];

  /** Cached list of fully qualified Java class names from the workspace. */
  private javaClassesCache: string[] | null = null;

  @postConstruct()
  protected init(): void {
    setJspI18n(this.i18n);
  }

  provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken,
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    if (!WEB_XML_RE.test(model.uri.path)) return { suggestions: [] };
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

    // Determine which element we're inside
    if (isInsideXmlElement(model, position, 'servlet-class')) {
      return this.suggestJavaClasses(token, ['Servlet'], range);
    }
    if (isInsideXmlElement(model, position, 'filter-class')) {
      return this.suggestJavaClasses(token, ['Filter'], range);
    }
    if (isInsideXmlElement(model, position, 'listener-class')) {
      return this.suggestJavaClasses(token, ['Listener'], range);
    }
    if (isInsideXmlElement(model, position, 'servlet-name')) {
      return this.suggestServletNames(model, range);
    }
    if (isInsideXmlElement(model, position, 'filter-name')) {
      return this.suggestFilterNames(model, range);
    }
    if (isInsideXmlElement(model, position, 'url-pattern')) {
      return { suggestions: buildUrlPatterns(range) };
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
    range: monaco.IRange,
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
        range,
      }));
    }
    return { suggestions };
  }

  private suggestServletNames(
    model: monaco.editor.ITextModel,
    range: monaco.IRange,
  ): monaco.languages.CompletionList {
    const content = model.getValue();
    const names = extractServletNames(content);
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const name of names) {
      suggestions.push(ci({
        label: name,
        kind: monaco.languages.CompletionItemKind.Value,
        detail: t('completion.webxml.servletName'),
        insertText: name,
        range,
      }));
    }
    return { suggestions };
  }

  private suggestFilterNames(
    model: monaco.editor.ITextModel,
    range: monaco.IRange,
  ): monaco.languages.CompletionList {
    const content = model.getValue();
    const names = extractFilterNames(content);
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const name of names) {
      suggestions.push(ci({
        label: name,
        kind: monaco.languages.CompletionItemKind.Value,
        detail: t('completion.webxml.filterName'),
        insertText: name,
        range,
      }));
    }
    return { suggestions };
  }

  private async scanJavaClasses(token: monaco.CancellationToken): Promise<string[]> {
    if (this.javaClassesCache !== null) return this.javaClassesCache;

    const rootUri = await getWorkspaceRootUri(this.workspaceService);
    if (!rootUri) {
      this.javaClassesCache = [];
      return [];
    }

    const classes: string[] = [];
    for (const srcRoot of JAVA_SRC_ROOTS) {
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