import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { Emitter } from '@theia/core/lib/common/event';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

@injectable()
export class SvnGutterDecorator {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(SvnStore) protected readonly svnStore!: SvnStore;

  protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
  readonly onDidChangeDecorations = this.onDidChangeDecorationsEmitter.event;

  protected currentDecorations: Map<string, any> = new Map();

  @postConstruct()
  protected init(): void {
    this.svnStore.onDidChange(() => this.updateDecorations());
    this.setupEditorListener();
  }

  protected setupEditorListener(): void {
    this.editorManager.onCurrentEditorChanged(editor => {
      if (editor) {
        this.updateDecorationsForEditor(editor);
      }
    });
  }

  protected async updateDecorations(): Promise<void> {
    const currentEditor = this.editorManager.currentEditor;
    if (currentEditor) {
      this.updateDecorationsForEditor(currentEditor);
    }
  }

  protected async updateDecorationsForEditor(editor: any): Promise<void> {
    const monacoEditor = this.getMonacoEditor(editor);
    if (!monacoEditor) return;

    const uri = editor.getResourceUri();
    if (!uri) return;

    const filePath = this.getRelativePath(uri.toString());
    const entry = this.svnService.getFileStatus(filePath);
    if (!entry) return;

    const model = monacoEditor.getModel();
    if (!model) return;

    const decorations: any[] = [];
    const lineCount = model.getLineCount() as number;

    if (entry.status === 'added') {
      for (let i = 1; i <= lineCount; i++) {
        decorations.push({
          range: { startLineNumber: i, startColumn: 1, endLineNumber: i, endColumn: 1 },
          options: {
            isWholeLine: true,
            glyphMarginClassName: 'svn-gutter-added',
            glyphMarginHoverMessage: { value: 'Added in working copy' },
          },
        });
      }
    } else if (entry.status === 'modified') {
      try {
        const diff = await this.svnService.getDiff(filePath, { revision: 'BASE' as any });
        const hunks = this.parseUnifiedDiff(diff);
        const changedLines = new Set<number>();

        for (const hunk of hunks) {
          let newLine = hunk.newStart;
          for (const line of hunk.lines) {
            if (line.startsWith('+')) {
              changedLines.add(newLine);
              newLine++;
            } else if (line.startsWith(' ')) {
              newLine++;
            }
            // '-' lines don't increment newLine
          }
        }

        for (const lineNum of changedLines) {
          if (lineNum >= 1 && lineNum <= lineCount) {
            decorations.push({
              range: { startLineNumber: lineNum, startColumn: 1, endLineNumber: lineNum, endColumn: 1 },
              options: {
                isWholeLine: true,
                glyphMarginClassName: 'svn-gutter-modified',
                glyphMarginHoverMessage: { value: 'Modified in working copy' },
              },
            });
          }
        }
      } catch {
        // Fallback: if diff fails, don't show any gutter marks
      }
    }

    if (entry.status === 'deleted') {
      for (let i = 1; i <= lineCount; i++) {
        decorations.push({
          range: { startLineNumber: i, startColumn: 1, endLineNumber: i, endColumn: 1 },
          options: {
            isWholeLine: true,
            glyphMarginClassName: 'svn-gutter-deleted',
            glyphMarginHoverMessage: { value: 'Deleted in working copy' },
          },
        });
      }
    }

    if (decorations.length > 0) {
      const editorDecorations = monacoEditor.createDecorationsCollection(decorations);
      const key = editor.getResourceUri().toString();
      const existing = this.currentDecorations.get(key);
      if (existing) {
        existing.clear();
      }
      this.currentDecorations.set(key, editorDecorations);
    }
  }

  protected parseUnifiedDiff(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = diff.split('\n');
    let currentHunk: DiffHunk | null = null;

    const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

    for (const line of lines) {
      const match = line.match(hunkHeaderRegex);
      if (match) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldCount: match[2] ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newCount: match[4] ? parseInt(match[4], 10) : 1,
          lines: [],
        };
      } else if (currentHunk) {
        if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
          currentHunk.lines.push(line);
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    return hunks;
  }

  protected getMonacoEditor(editor: any): any {
    if (editor instanceof MonacoEditor) {
      return editor.getControl();
    }
    return undefined;
  }

  protected getRelativePath(uri: string): string {
    const wcRoot = this.svnService.getActiveWcRoot();
    if (!wcRoot) return uri;

    const fileUri = uri.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
    const decodedUri = decodeURIComponent(fileUri);

    if (decodedUri.startsWith(wcRoot)) {
      let relative = decodedUri.substring(wcRoot.length);
      if (relative.startsWith('/')) relative = relative.substring(1);
      return relative;
    }
    return decodedUri;
  }
}