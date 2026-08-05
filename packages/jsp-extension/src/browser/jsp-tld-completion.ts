/**
 * TLD tag library completion for JSP files.
 *
 * Scans the workspace for *.tld files, parses them, and provides
 * code completion for:
 *  - <%@ taglib %> directive (uri and prefix attributes)
 *  - Custom tag prefixes (e.g. <k: → suggests all tags)
 *  - Attribute completion for known tags (e.g. <k:message → suggests key=, bundle=)
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { injectable, inject } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { JSP_LANGUAGE_ID } from './jsp-monarch';
import { TldParser, Tld, TldTag } from './tld-parser';

/** Build a CompletionItem with an explicit replacement range. */
function ci(
  range: monaco.IRange,
  partial: Partial<monaco.languages.CompletionItem> & {
    label: string;
    kind: monaco.languages.CompletionItemKind;
    insertText: string;
  },
): monaco.languages.CompletionItem {
  return {
    range,
    ...partial,
  } as monaco.languages.CompletionItem;
}

/**
 * Build documentation and insertText for a TLD tag.
 */
function buildTagCompletionItem(tag: TldTag, prefix: string, range: monaco.IRange): monaco.languages.CompletionItem {
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

  return ci(range, {
    label: `${prefix}:${tag.name}`,
    kind: monaco.languages.CompletionItemKind.Class,
    detail: tag.tagClass ?? prefix,
    documentation: docParts.join('\n'),
    insertText: hasAttrs ? `${prefix}:${tag.name}${attrSnippet}` : `${prefix}:${tag.name}`,
    insertTextRules: hasAttrs ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
  });
}

/**
 * Build a completion item for a TLD tag attribute.
 */
function buildAttributeCompletionItem(
  attr: { name: string; required: boolean; rtexprvalue: boolean; type?: string; description?: string },
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  const type = attr.type ?? 'String';
  const req = attr.required ? ' [required]' : '';
  const el = attr.rtexprvalue ? ' [EL]' : '';
  const detail = `${type}${req}${el}`;
  const docParts: string[] = [];
  if (attr.description) {
    docParts.push(attr.description);
  }
  docParts.push(`**Type**: \`${type}\``);
  if (attr.required) {
    docParts.push('**Required**: yes');
  }
  if (attr.rtexprvalue) {
    docParts.push('**Supports EL**: yes');
  }

  return ci(range, {
    label: attr.name,
    kind: monaco.languages.CompletionItemKind.Property,
    detail,
    documentation: docParts.join('\n'),
    insertText: `${attr.name}="\${1}"`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: attr.required ? '0' + attr.name : '1' + attr.name,
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

  /** File watchers that invalidate the cache on TLD/JAR changes. */
  protected readonly watchers = new DisposableCollection();
  protected watchersStarted = false;

  /**
   * Scan the workspace roots for *.tld files and parse them.
   * Subsequent calls are no-ops until {@link invalidateCache}.
   */
  async scanWorkspace(): Promise<void> {
    if (this.scanned) return;
    this.scanned = true;
    const roots = await this.workspaceService.roots;
    if (roots.length === 0) return;
    for (const root of roots) {
      const rootUri = URI.fromFilePath(root.resource.path.toString());
      await this.walkDir(rootUri);
    }
    this.ensureWatchers();
  }

  /**
   * Watch workspace roots so TLD/JAR changes refresh the cache (JV-P2-5).
   * Safe to call multiple times; watchers survive invalidateCache.
   */
  protected ensureWatchers(): void {
    if (this.watchersStarted) return;
    this.watchersStarted = true;

    void this.workspaceService.roots.then(roots => {
      for (const root of roots) {
        try {
          this.watchers.push(this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
        } catch {
          // Watch may fail on remote/unsupported providers
        }
      }
    });

    this.watchers.push(this.fileService.onDidFilesChange(event => {
      for (const change of event.changes) {
        const p = change.resource.path.toString().replace(/\\/g, '/');
        const base = change.resource.path.base.toLowerCase();
        const isTld = base.endsWith('.tld');
        const isWebInfLibJar = base.endsWith('.jar') && /\/WEB-INF\/lib\//i.test(p);
        if (isTld || isWebInfLibJar) {
          this.invalidateCache();
          return;
        }
      }
    }));
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
   * Return a specific tag by prefix:tagName.
   */
  getTag(prefix: string, tagName: string): TldTag | undefined {
    for (const tld of this.tldCache.values()) {
      if (tld.shortName === prefix) {
        return tld.tags.find(t => t.name === tagName);
      }
    }
    return undefined;
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
   * Return all TLD URIs for taglib directive completion.
   */
  getTldUris(): { uri: string; shortName: string }[] {
    const results: { uri: string; shortName: string }[] = [];
    for (const tld of this.tldCache.values()) {
      results.push({ uri: tld.uri, shortName: tld.shortName });
    }
    return results;
  }

  /**
   * Invalidate the cache so the next completion request re-scans.
   * Watchers stay active so subsequent file changes keep refreshing.
   */
  invalidateCache(): void {
    this.tldCache.clear();
    this.scanned = false;
  }

  /** Tear down file watchers (tests / contribution dispose). */
  dispose(): void {
    this.watchers.dispose();
    this.watchersStarted = false;
    this.invalidateCache();
  }

  private async walkDir(uri: URI): Promise<void> {
    try {
      const stat = await this.fileService.resolve(uri, { resolveMetadata: false });
      if (!stat.children) return;
      for (const child of stat.children) {
        const basename = child.resource.path.base;
        if (child.isDirectory) {
          // Skip generic `lib/` trees, but never skip WEB-INF/lib (JV-P2-5).
          const parentBase = uri.path.base;
          const skipLib = basename === 'lib' && parentBase !== 'WEB-INF';
          if (basename.startsWith('.') || basename === 'node_modules' || skipLib || basename === 'dist') {
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

/** Regex to detect if cursor is inside a <%@ taglib %> directive. */
const TAGLIB_DIRECTIVE_RE = /<%@\s+taglib\b/gi;

/** Regex to detect a known tag with attributes: <prefix:tagname */
const TAG_WITH_ATTRS_RE = /<([a-zA-Z_][\w-]*):([a-zA-Z_][\w-]*)\s+([^>]*)$/;

/**
 * Check if the cursor is inside a <%@ taglib %> directive.
 */
function isInsideTaglibDirective(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): boolean {
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  const before = text.substring(0, offset);

  TAGLIB_DIRECTIVE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAGLIB_DIRECTIVE_RE.exec(before)) !== null) {
    const afterOpen = text.substring(m.index);
    const closeIdx = afterOpen.indexOf('%>');
    if (closeIdx === -1) continue;
    const directiveEnd = m.index + closeIdx + 2;
    if (offset >= m.index && offset <= directiveEnd) {
      return true;
    }
  }
  return false;
}

/**
 * Check if the cursor is inside a tag that has a known prefix
 * (e.g. <k:message), for attribute completion.
 */
function parseTagForAttributeCompletion(
  lineContent: string,
  column: number,
): { prefix: string; tagName: string } | null {
  const lineBeforeCursor = lineContent.substring(0, column);
  const match = TAG_WITH_ATTRS_RE.exec(lineBeforeCursor);
  if (!match) return null;
  return { prefix: match[1], tagName: match[2] };
}

/**
 * Monaco completion provider that suggests TLD tags inside JSP files
 * and provides taglib directive completion.
 */
class JspTldCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['<', ':', ' ', '"', '='];

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

    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const lineContent = model.getLineContent(position.lineNumber);
    const lineBeforeCursor = lineContent.substring(0, position.column - 1);

    // ── Phase 1: <%@ taglib %> directive completion ──────────
    if (isInsideTaglibDirective(model, position)) {
      return this.suggestTaglibDirective(model, position, range);
    }

    // ── Phase 2: Attribute completion for known tags ──────────
    const tagInfo = parseTagForAttributeCompletion(lineContent, position.column - 1);
    if (tagInfo) {
      return this.suggestTagAttributes(tagInfo.prefix, tagInfo.tagName, range);
    }

    // ── Phase 3: Tag name completion (<prefix:tag) ────────────
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
          suggestions.push(buildTagCompletionItem(tag, prefix, range));
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
        suggestions.push(ci(range, {
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

  /**
   * Provide completion for <%@ taglib %> directive attributes.
   */
  private suggestTaglibDirective(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    range: monaco.IRange,
  ): monaco.languages.CompletionList {
    const lineContent = model.getLineContent(position.lineNumber);
    const lineBeforeCursor = lineContent.substring(0, position.column - 1);

    const suggestions: monaco.languages.CompletionItem[] = [];

    // Check if we're inside a quoted attribute value
    const lastQuote = Math.max(
      lineBeforeCursor.lastIndexOf('"'),
      lineBeforeCursor.lastIndexOf("'"),
    );
    const lastEquals = lineBeforeCursor.lastIndexOf('=');

    if (lastQuote > lastEquals && lastQuote >= 0) {
      // We're inside a quoted value — suggest based on which attribute
      const beforeQuote = lineBeforeCursor.substring(0, lastQuote);
      if (beforeQuote.match(/uri\s*=\s*$/i)) {
        // Suggest known TLD URIs
        const tldUris = this.tldProvider.getTldUris();
        for (const { uri, shortName } of tldUris) {
          suggestions.push(ci(range, {
            label: uri,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: `${shortName} tag library`,
            insertText: uri,
            documentation: `URI for the \`${shortName}\` tag library.`,
          }));
        }
        // Also suggest common JSTL URIs
        const jstlUris = [
          { uri: 'http://java.sun.com/jsp/jstl/core', name: 'JSTL Core' },
          { uri: 'http://java.sun.com/jsp/jstl/fmt', name: 'JSTL Format' },
          { uri: 'http://java.sun.com/jsp/jstl/sql', name: 'JSTL SQL' },
          { uri: 'http://java.sun.com/jsp/jstl/xml', name: 'JSTL XML' },
          { uri: 'http://java.sun.com/jsp/jstl/functions', name: 'JSTL Functions' },
        ];
        for (const jstl of jstlUris) {
          if (!tldUris.some(t => t.uri === jstl.uri)) {
            suggestions.push(ci(range, {
              label: jstl.uri,
              kind: monaco.languages.CompletionItemKind.Value,
              detail: jstl.name,
              insertText: jstl.uri,
            }));
          }
        }
        return { suggestions };
      }
      if (beforeQuote.match(/prefix\s*=\s*$/i)) {
        // Suggest known prefixes
        const prefixes = this.tldProvider.getPrefixes();
        for (const pfx of prefixes) {
          suggestions.push(ci(range, {
            label: pfx,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: `${pfx} tag library prefix`,
            insertText: pfx,
          }));
        }
        return { suggestions };
      }
      return { suggestions: [] };
    }

    // Not inside a quoted value — suggest attribute names
    const hasUri = /uri\s*=/i.test(lineBeforeCursor);
    const hasPrefix = /prefix\s*=/i.test(lineBeforeCursor);

    if (!hasUri) {
      suggestions.push(ci(range, {
        label: 'uri',
        kind: monaco.languages.CompletionItemKind.Property,
        detail: 'Tag library URI',
        insertText: 'uri="${1}"',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        documentation: 'The URI of the tag library descriptor.',
        sortText: '0',
      }));
    }
    if (!hasPrefix) {
      suggestions.push(ci(range, {
        label: 'prefix',
        kind: monaco.languages.CompletionItemKind.Property,
        detail: 'Tag library prefix',
        insertText: 'prefix="${1}"',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        documentation: 'The prefix used to invoke tags from this library.',
        sortText: '1',
      }));
    }

    return { suggestions };
  }

  /**
   * Provide attribute completion for a known tag (e.g. <k:message).
   */
  private suggestTagAttributes(
    prefix: string,
    tagName: string,
    range: monaco.IRange,
  ): monaco.languages.CompletionList {
    const tag = this.tldProvider.getTag(prefix, tagName);
    if (!tag) return { suggestions: [] };

    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const attr of tag.attributes) {
      suggestions.push(buildAttributeCompletionItem(attr, range));
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