import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { SvnService } from './svn-service';
import { SvnBlameLine } from './svn-types';

@injectable()
export class SvnAnnotateDecorator {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(SvnService) protected readonly svnService!: SvnService;

  protected annotatedEditors: Map<string, {
    entries: SvnBlameLine[];
    contentWidgets: any[];
  }> = new Map();

  init(): void {
    this.editorManager.onCurrentEditorChanged(editor => {
      if (editor) {
        this.clearAnnotations(editor);
      }
    });
  }

  async annotateEditor(filePath: string): Promise<void> {
    const currentEditor = this.editorManager.currentEditor;
    if (!currentEditor) return;

    const monacoEditor = this.getMonacoEditor(currentEditor);
    if (!monacoEditor) return;

    try {
      const entries = await this.svnService.annotate(filePath);
      this.showAnnotations(monacoEditor, entries);
      this.annotatedEditors.set(filePath, { entries, contentWidgets: [] });
    } catch (e) {
      console.error('Failed to annotate:', e);
    }
  }

  async clearAnnotations(editor?: any): Promise<void> {
    if (!editor) return;

    const monacoEditor = this.getMonacoEditor(editor);
    if (!monacoEditor) return;

    const uri = editor.getResourceUri();
    if (!uri) return;

    const filePath = this.getRelativePath(uri.toString());
    this.annotatedEditors.delete(filePath);

    monacoEditor.removeAllContentWidgets();
  }

  protected showAnnotations(
    monacoEditor: any,
    entries: SvnBlameLine[],
  ): void {
    const model = monacoEditor.getModel();
    if (!model) return;

    const lines = model.getLinesContent() as string[];
    const maxLineWidth = Math.max(...lines.map((l: string) => l.length), 80);

    for (const entry of entries) {
      const lineNumber = entry.line;
      const author = (entry.author || '').substring(0, 12);
      const revision = String(entry.revision).substring(0, 6);
      const date = entry.date ? new Date(entry.date).toLocaleDateString() : '';

      const annotationText = `${author}${' '.repeat(Math.max(1, 12 - author.length))} | r${revision}${' '.repeat(Math.max(1, 6 - revision.length))} | ${date}`;

      monacoEditor.addContentWidget({
        getId: () => `svn-blame-${entry.line}`,
        getDomNode: () => {
          const node = document.createElement('div');
          node.style.color = 'var(--theia-editorLineNumber-foreground)';
          node.style.fontSize = 'var(--theia-editor-font-size, 12px)';
          node.style.fontFamily = 'var(--theia-editor-font-family, monospace)';
          node.style.whiteSpace = 'pre';
          node.style.opacity = '0.6';
          node.style.paddingRight = '8px';
          node.textContent = annotationText;
          return node;
        },
        getPosition: () => ({
          position: { lineNumber, column: Math.min(lines[lineNumber - 1]?.length ?? 0, maxLineWidth) + 2 },
          preference: [1], // EXACT
        }),
      });
    }
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