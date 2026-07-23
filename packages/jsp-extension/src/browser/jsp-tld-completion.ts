/**
 * TLD tag library completion for JSP files.
 *
 * Scans the workspace for *.tld files, parses them, and provides
 * code completion for custom tag prefixes (e.g. <k: → suggests
 * all tags defined in the TLD whose short-name matches "k").
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { TldParser, Tld, TldTag } from './tld-parser';

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
 * Build documentation and insertText for a TLD tag.
 */
function buildTagCompletionItem(tag: TldTag, prefix: string): monaco.languages.CompletionItem {
  const docParts: string[] = [];
  if (tag.tagClass) {
    docParts.push(`**Tag Class**: \`${tag.tagClass}\``);
  }
  if (tag.bodyContent) {
    docParts.push(`**Body Content**: ${tag.bodyContent}`);
  }
  if (tag.attributes.length > 0) {
    docParts.push('');
    docParts.push('**Attributes**:');
    for (const attr of tag.attributes) {
      const req = attr.required ? ' (required)' : '';
      const el = attr.rtexprvalue ? ' [EL]' : '';
      const type = attr.type ?? 'String';
      docParts.push(`- \`${attr.name}\`: ${type}${req}${el}`);
    }
  }

  const hasAttrs = tag.attributes.length > 0;
  const attrSnippet = hasAttrs
    ? tag.attributes.map((a, i) => ` ${a.name}="\${${i + 1}}"`).join('')
    : '';

  return ci({
    label: `${prefix}:${tag.name}`,
    kind: monaco.languages.CompletionItemKind.Class,
    detail: tag.tagClass ?? prefix,
    documentation: docParts.join('\n'),
    insertText: hasAttrs ? `${prefix}:${tag.name}${attrSnippet}` : `${prefix}:${tag.name}`,
    insertTextRules: hasAttrs ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
  });
}

/**
 * Manages TLD parsing and caching. Scans the workspace for *.tld
 * files and exposes tag completions per prefix.
 */
@injectable()
export class TldCompletionProvider {
  @inject(FileService)
  protected readonly fileService!: FileService;

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService;

  @inject(TldParser)
  protected readonly tldParser!: TldParser;

  /** Cache of parsed TLDs keyed by URI string. */
  protected tldCache = new Map<string, Tld>();

  /** Whether the workspace has already been scanned. */
  protected scanned = false;

  /**
   * Scan the workspace roots for *.tld files and parse them.
   * Subsequent calls are no-ops.
   */
  async scanWorkspace(): Promise<void> {
    if (this.scanned) return;
    this.scanned = true;
    const roots = await this.workspaceService.roots;
    if (roots.length === 0) return;
    const rootUri = URI.fromFilePath(roots[0].resource.path.toString());
    await this.walkDir(rootUri);
  }

  /**
   * Return all tags whose TLD short-name matches the given prefix.
   */
  getTags(prefix: string): { tld: Tld; tag: TldTag }[] {
    const results: { tld: Tld; tag: TldTag }[] = [];
    for (const tld of this.tldCache.values()) {
      if (tld.shortName === prefix) {
        for (const tag of tld.tags) {
          results.push({ tld, tag });
        }
      }
    }
    return results;
  }

  /**
   * Return all known TLD short-names (prefixes). Useful for
   * suggesting prefixes when the user types `<` followed by
   * a partial match.
   */
  getPrefixes(): string[] {
    return [...new Set([...this.tldCache.values()].map(t => t.shortName))];
  }

  /**
   * Invalidate the cache so the next completion request re-scans.
   */
  invalidateCache(): void {
    this.tldCache.clear();
    this.scanned = false;
  }

  private async walkDir(uri: URI): Promise<void> {
    try {
      const stat = await this.fileService.resolve(uri, { resolveMetadata: false });
      if (!stat.children) return;
      for (const child of stat.children) {
        const basename = child.resource.path.base;
        if (child.isDirectory) {
          if (basename.startsWith('.') || basename === 'node_modules' || basename === 'lib' || basename === 'dist') {
            continue;
          }
          await this.walkDir(child.resource);
        } else if (basename.endsWith('.tld')) {
          await this.parseAndCache(child.resource);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  private async parseAndCache(uri: URI): Promise<void> {
    try {
      const content = await this.fileService.read(uri, { encoding: 'utf-8' });
      const tld = this.tldParser.parse(content.value);
      if (tld && tld.tags.length > 0) {
        this.tldCache.set(uri.toString(), tld);
      }
    } catch {
      // Skip unreadable TLD files
    }
  }
}

/**
 * Monaco completion provider that suggests TLD tags inside JSP files.
 */
class JspTldCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['<', ':'];

  constructor(private readonly tldProvider: TldCompletionProvider) { }

  async provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.CompletionList> {
    // Ensure TLDs are scanned
    await this.tldProvider.scanWorkspace();
    if (token.isCancellationRequested) return { suggestions: [] };

    const lineContent = model.getLineContent(position.lineNumber);
    const lineBeforeCursor = lineContent.substring(0, position.column - 1);

    // Find the last `<` on the line before the cursor
    const lastOpen = lineBeforeCursor.lastIndexOf('<');
    if (lastOpen === -1) return { suggestions: [] };

    // Check if there's a closing `>` between the `<` and cursor
    const lastClose = lineBeforeCursor.lastIndexOf('>');
    if (lastClose > lastOpen) return { suggestions: [] };

    // Extract the text between `<` and cursor
    const afterLt = lineBeforeCursor.substring(lastOpen + 1);

    // If the text contains `:`, we're completing a tag name
    const colonIdx = afterLt.indexOf(':');
    if (colonIdx >= 0) {
      const prefix = afterLt.substring(0, colonIdx);
      const tagPrefix = afterLt.substring(colonIdx + 1);

      const matched = this.tldProvider.getTags(prefix);
      if (matched.length === 0) return { suggestions: [] };

      const suggestions: monaco.languages.CompletionItem[] = [];
      for (const { tag } of matched) {
        if (tagPrefix === '' || tag.name.startsWith(tagPrefix)) {
          suggestions.push(buildTagCompletionItem(tag, prefix));
        }
      }
      return { suggestions };
    }

    // No colon yet — suggest known TLD prefixes
    const prefixText = afterLt.trim();
    const allPrefixes = this.tldProvider.getPrefixes();
    if (allPrefixes.length === 0) return { suggestions: [] };

    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const pfx of allPrefixes) {
      if (prefixText === '' || pfx.startsWith(prefixText)) {
        suggestions.push(ci({
          label: `${pfx}:`,
          kind: monaco.languages.CompletionItemKind.Module,
          detail: `${pfx} tag library`,
          insertText: `${pfx}:`,
          documentation: `TLD prefix for \`${pfx}\` tag library.`,
        }));
      }
    }
    return { suggestions };
  }
}

/**
 * Register the TLD completion provider with Monaco for JSP files.
 * @param tldProvider The TldCompletionProvider instance that manages
 *   the TLD cache and workspace scanning.
 */
export function registerJspTldCompletion(tldProvider: TldCompletionProvider): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider(
    JSP_LANGUAGE_ID,
    new JspTldCompletionProvider(tldProvider),
  );
}