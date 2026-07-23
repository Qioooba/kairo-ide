import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorDecoration } from '@theia/editor/lib/browser/decorations/editor-decoration';
import { EditorDecorator } from '@theia/editor/lib/browser/decorations/editor-decorator';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { TextEditor as _TextEditor } from '@theia/editor/lib/browser/editor';
import { GitService } from './git-service';
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

  protected activeWidget: EditorWidget | undefined;
  protected editorDisposable: { dispose(): void } | undefined;

  activate(): void {
    this.editorDisposable = this.editorManager.onCurrentEditorChanged(widget => {
      this.activeWidget = widget;
      this.updateBlame();
    });
    if (this.editorManager.currentEditor) {
      this.activeWidget = this.editorManager.currentEditor;
      this.updateBlame();
    }
  }

  deactivate(): void {
    this.editorDisposable?.dispose();
    this.editorDisposable = undefined;
    if (this.activeWidget) {
      this.setDecorations(this.activeWidget.editor, []);
      this.activeWidget = undefined;
    }
  }

  protected async updateBlame(): Promise<void> {
    if (!this.activeWidget) return;

    const editor = this.activeWidget.editor;
    const uri = editor.document.uri;
    if (!uri) return;

    const repoRoot = this.gitService.getRepoRoot();
    if (!repoRoot) {
      this.setDecorations(editor, []);
      return;
    }

    const uriStr = uri.toString();
    let filePath = '';
    if (uriStr.startsWith('file://')) {
      filePath = decodeURIComponent(uriStr.replace('file://', ''));
    }
    if (!filePath.startsWith(repoRoot)) {
      this.setDecorations(editor, []);
      return;
    }

    const relativePath = filePath.substring(repoRoot.length + 1);

    let blameLines = this.blameCache.get(relativePath);
    if (!blameLines) {
      const result = await this.gitService.getBlame(relativePath);
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
    }

    const decorations: EditorDecoration[] = blameLines.map(bl => {
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
        } as any,
      };
    });

    this.setDecorations(editor, decorations);
  }

  invalidateCache(filePath?: string): void {
    if (filePath) {
      this.blameCache.delete(filePath);
    } else {
      this.blameCache.clear();
    }
  }
}