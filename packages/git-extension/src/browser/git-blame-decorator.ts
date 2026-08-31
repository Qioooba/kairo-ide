import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorDecoration, EditorDecorationOptions } from '@theia/editor/lib/browser/decorations/editor-decoration';
import { EditorDecorator } from '@theia/editor/lib/browser/decorations/editor-decorator';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { TextEditor as _TextEditor } from '@theia/editor/lib/browser/editor';
import { GitService } from './git-service';
import { toRepoRelativePath } from '../common/git-path-utils';
import { Range } from '@theia/core/shared/vscode-languageserver-protocol';

interface BlameLineData {
  author: string;
  date: Date;
  line: number;
}

@injectable()
export class GitBlameDecorator extends EditorDecorator {
  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(GitService) protected gitService!: GitService;

  protected blameCache = new Map<string, BlameLineData[]>();
  /** Cache entries expire so blame doesn't show stale authors (VC-P2-9). */
  protected blameCacheAt = new Map<string, number>();
  protected static readonly CACHE_TTL_MS = 60_000;
  /** Upper bound for cached files so long sessions cannot grow unbounded. */
  protected static readonly CACHE_MAX_ENTRIES = 32;
  /**
   * Debounce for content-change refreshes. Every keystroke previously
   * invalidated the cache and spawned a full `git blame` process; typing
   * bursts now coalesce into a single refresh after the user pauses.
   */
  protected static readonly BLAME_REFRESH_DELAY_MS = 800;

  protected activeWidget: EditorWidget | undefined;
  protected editorDisposable: { dispose(): void } | undefined;
  protected docChangeDisposable: { dispose(): void } | undefined;
  protected blameRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  activate(): void {
    this.editorDisposable = this.editorManager.onCurrentEditorChanged(widget => {
      this.activeWidget = widget;
      this.wireDocumentListener(widget);
      this.updateBlame();
    });
    if (this.editorManager.currentEditor) {
      this.activeWidget = this.editorManager.currentEditor;
      this.wireDocumentListener(this.activeWidget);
      this.updateBlame();
    }
  }

  deactivate(): void {
    this.editorDisposable?.dispose();
    this.editorDisposable = undefined;
    this.docChangeDisposable?.dispose();
    this.docChangeDisposable = undefined;
    if (this.blameRefreshTimer !== undefined) {
      clearTimeout(this.blameRefreshTimer);
      this.blameRefreshTimer = undefined;
    }
    if (this.activeWidget) {
      this.setDecorations(this.activeWidget.editor, []);
      this.activeWidget = undefined;
    }
  }

  protected wireDocumentListener(widget: EditorWidget | undefined): void {
    this.docChangeDisposable?.dispose();
    this.docChangeDisposable = undefined;
    if (!widget) return;
    const doc = widget.editor.document as unknown as {
      onDidChangeContent?: (cb: () => void) => { dispose(): void };
    };
    // Invalidate on edit so blame doesn't linger on wrong lines, but
    // debounce the refresh: a `git blame` process per keystroke caused
    // CPU spikes and process pile-up while typing.
    if (typeof doc.onDidChangeContent === 'function') {
      this.docChangeDisposable = doc.onDidChangeContent(() => {
        const uri = widget.editor.document.uri;
        const repoRoot = this.gitService.getRepoRoot();
        if (uri && repoRoot) {
          const relativePath = toRepoRelativePath(uri.toString(), repoRoot);
          if (relativePath !== undefined) {
            this.invalidateCache(relativePath);
          }
        }
        this.scheduleBlameRefresh();
      });
    }
  }

  protected scheduleBlameRefresh(): void {
    if (this.blameRefreshTimer !== undefined) {
      clearTimeout(this.blameRefreshTimer);
    }
    this.blameRefreshTimer = setTimeout(() => {
      this.blameRefreshTimer = undefined;
      void this.updateBlame();
    }, GitBlameDecorator.BLAME_REFRESH_DELAY_MS);
  }

  protected async updateBlame(): Promise<void> {
    const widgetAtStart = this.activeWidget;
    if (!widgetAtStart) return;

    const editor = widgetAtStart.editor;
    const uri = editor.document.uri;
    if (!uri) return;

    const repoRoot = this.gitService.getRepoRoot();
    if (!repoRoot) {
      this.setDecorations(editor, []);
      return;
    }

    const relativePath = toRepoRelativePath(uri.toString(), repoRoot);
    if (relativePath === undefined) {
      this.setDecorations(editor, []);
      return;
    }

    const now = Date.now();
    const cachedAt = this.blameCacheAt.get(relativePath) ?? 0;
    let blameLines = this.blameCache.get(relativePath);
    if (!blameLines || now - cachedAt > GitBlameDecorator.CACHE_TTL_MS) {
      const result = await this.gitService.getBlame(relativePath);
      // VC-P2-9: await may have raced past an editor switch.
      if (this.activeWidget !== widgetAtStart) {
        return;
      }
      if (result.length === 0) {
        this.setDecorations(editor, []);
        return;
      }
      blameLines = result.map((r: { author: string; date: Date; line: number }) => ({
        author: r.author,
        date: r.date,
        line: r.line,
      }));
      this.blameCache.set(relativePath, blameLines);
      this.blameCacheAt.set(relativePath, now);
      this.trimBlameCache();
    }

    if (this.activeWidget !== widgetAtStart) {
      return;
    }

    // Limit inline decorations to visible-ish range to avoid large-file jank.
    const maxInline = 500;
    const forInline = blameLines.length > maxInline ? blameLines.slice(0, maxInline) : blameLines;

    const decorations: EditorDecoration[] = forInline.map(bl => {
      const dateStr = bl.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const hoverMsg = `${bl.author}, ${bl.date.toLocaleString()}`;

      return {
        range: Range.create(bl.line - 1, 0, bl.line - 1, 0),
        options: {
          isWholeLine: true,
          glyphMarginClassName: 'kairo-git-blame-glyph',
          glyphMarginHoverMessage: hoverMsg,
          before: {
            contentText: `  ${bl.author}, ${dateStr}  `,
            inlineClassName: 'kairo-git-blame-inline',
          },
        } as EditorDecorationOptions,
      };
    });

    this.setDecorations(editor, decorations);
  }

  invalidateCache(filePath?: string): void {
    if (filePath) {
      this.blameCache.delete(filePath);
      this.blameCacheAt.delete(filePath);
    } else {
      this.blameCache.clear();
      this.blameCacheAt.clear();
    }
  }

  /** Evicts the oldest cache entries when the cache grows past its cap. */
  protected trimBlameCache(): void {
    let excess = this.blameCache.size - GitBlameDecorator.CACHE_MAX_ENTRIES;
    if (excess <= 0) return;
    const oldest = [...this.blameCacheAt.entries()].sort((a, b) => a[1] - b[1]);
    for (const [path] of oldest) {
      if (excess <= 0) break;
      this.blameCache.delete(path);
      this.blameCacheAt.delete(path);
      excess--;
    }
  }
}
