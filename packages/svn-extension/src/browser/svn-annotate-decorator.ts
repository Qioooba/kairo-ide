import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MessageService } from '@theia/core/lib/common/message-service';
import { SvnService } from './svn-service';
import { SvnBlameLine } from '../common/svn-types';

interface AnnotatedFile {
  entries: SvnBlameLine[];
  decorations: string[];
  widgetIds: string[];
}

/**
 * IntelliJ IDEA-style SVN annotate (blame) decorator.
 *
 *  - Each line shows `author | r<REV> | YYYY-MM-DD` in the gutter.
 *  - The colour of the annotation swatch is derived from the revision
 *    number, so visually adjacent groups of "last touched by r123"
 *    lines share a hue — exactly like IDEA's "Annotate" view.
 *  - Clicking the annotation jumps to the SVN History view pre-filtered
 *    to that revision, or opens a diff against the previous revision
 *    if the user holds Shift — same affordances as IDEA.
 */
@injectable()
export class SvnAnnotateDecorator {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(MessageService) protected readonly messageService!: MessageService;

  protected annotatedEditors: Map<string, AnnotatedFile> = new Map();

  init(): void {
    this.editorManager.onCurrentEditorChanged(editor => {
      if (editor) {
        this.refreshAnnotationsIfTracked(editor);
      }
    });
  }

  /**
   * Toggle annotations on the current editor for the given file path.
   * If already annotated, clears them; otherwise annotates.
   */
  async annotateEditor(filePath: string): Promise<void> {
    const currentEditor = this.editorManager.currentEditor;
    if (!currentEditor) return;
    const monacoEditor = this.getMonacoEditor(currentEditor);
    if (!monacoEditor) return;

    // Toggle off if already annotated
    if (this.annotatedEditors.has(filePath)) {
      this.clearAnnotations(currentEditor);
      return;
    }

    try {
      const entries = await this.svnService.annotate(filePath);
      this.applyAnnotations(monacoEditor, filePath, entries);
    } catch (e) {
      this.messageService.error(`Annotate failed: ${(e as Error).message}`);
    }
  }

  clearAnnotations(editor?: any): void {
    if (!editor) return;
    const monacoEditor = this.getMonacoEditor(editor);
    if (!monacoEditor) return;
    const uri = editor.getResourceUri();
    if (!uri) return;
    const filePath = this.getRelativePath(uri.toString());
    const tracked = this.annotatedEditors.get(filePath);
    if (!tracked) {
      // Nothing to do; still wipe any stragglers
      monacoEditor.removeAllContentWidgets();
      return;
    }
    // Remove decorations
    const model = monacoEditor.getModel();
    if (model && tracked.decorations.length > 0) {
      (monacoEditor as any).deltaDecorations(tracked.decorations, []);
    }
    // Remove content widgets
    for (const id of tracked.widgetIds) {
      try { monacoEditor.removeContentWidget({ getId: () => id, getDomNode: () => document.createElement('div'), getPosition: () => null as any } as any); } catch { /* ignore */ }
    }
    monacoEditor.removeAllContentWidgets();
    this.annotatedEditors.delete(filePath);
  }

  /**
   * If the newly active editor was previously annotated, re-apply the
   * annotations to the new Monaco instance (editor re-creation happens
   * e.g. on language switch).
   */
  protected refreshAnnotationsIfTracked(editor: any): void {
    const uri = editor.getResourceUri?.();
    if (!uri) return;
    const filePath = this.getRelativePath(uri.toString());
    const tracked = this.annotatedEditors.get(filePath);
    if (!tracked) return;
    const monacoEditor = this.getMonacoEditor(editor);
    if (!monacoEditor) return;
    this.applyAnnotations(monacoEditor, filePath, tracked.entries);
  }

  protected applyAnnotations(
    monacoEditor: any,
    filePath: string,
    entries: SvnBlameLine[],
  ): void {
    // Clear any previous annotations on this editor
    monacoEditor.removeAllContentWidgets();
    const model: any = monacoEditor.getModel();
    if (!model) return;
    const lines: string[] = model.getLinesContent();

    // Decoration: highlight the line background lightly by revision
    const decorationEntries: any[] = [];
    const widgetIds: string[] = [];

    for (const entry of entries) {
      const lineNumber = entry.line;
      if (lineNumber < 1 || lineNumber > lines.length) continue;
      const author = (entry.author || 'unknown').substring(0, 14);
      const revision = String(entry.revision);
      const date = entry.date ? new Date(entry.date) : undefined;
      const dateStr = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        : '';
      const color = this.revisionToColor(entry.revision);

      // Subtle background highlight
      decorationEntries.push({
        range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn: 1, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'kairo-svn-annotate-line',
          linesDecorationsClassName: `kairo-svn-annotate-gutter kairo-svn-annotate-rev-${this.colorKey(entry.revision)}`,
          minimap: { color, position: monacoEditor.__minimapPos ?? 1 },
        },
      });

      // Inline annotation as a content widget
      const widgetId = `svn-blame-${lineNumber}-${revision}`;
      widgetIds.push(widgetId);
      const annotationText = ` ${author.padEnd(14, ' ')} · r${revision.padStart(6, ' ')} · ${dateStr}`;
      monacoEditor.addContentWidget({
        getId: () => widgetId,
        getDomNode: () => {
          const node = document.createElement('div');
          node.className = 'kairo-svn-annotate-widget';
          node.style.color = color;
          node.style.fontSize = 'var(--theia-editor-font-size, 12px)';
          node.style.fontFamily = 'var(--theia-editor-font-family, monospace)';
          node.style.whiteSpace = 'pre';
          node.style.opacity = '0.85';
          node.style.padding = '0 8px';
          node.style.cursor = 'pointer';
          node.style.userSelect = 'none';
          node.title = `Click to open r${revision} in History\nShift+Click to compare with previous`;
          node.textContent = annotationText;
          node.addEventListener('click', e => {
            e.stopPropagation();
            this.handleAnnotationClick(filePath, entry.revision, e.shiftKey);
          });
          return node;
        },
        getPosition: () => {
          const lineContent = lines[lineNumber - 1] || '';
          const column = Math.min(lineContent.length + 2, model.getLineMaxColumn(lineNumber));
          return {
            position: { lineNumber, column },
            preference: [1], // EXACT
          };
        },
      });
    }

    const newDecorationIds = (monacoEditor as any).deltaDecorations([], decorationEntries) || [];
    this.annotatedEditors.set(filePath, {
      entries,
      decorations: newDecorationIds,
      widgetIds,
    });
  }

  protected handleAnnotationClick(filePath: string, revision: number, shiftKey: boolean): void {
    if (shiftKey) {
      // Shift+Click → compare with previous revision
      this.svnService.requestDiff(filePath, revision - 1, revision);
    } else {
      // Plain click → open history for this file
      this.svnService.requestHistory(filePath);
      this.messageService.info(`Opened history for ${filePath} (clicked r${revision})`);
    }
  }

  /**
   * Map a revision number to a stable hue. Two adjacent lines touched by
   * the same revision always get the same colour, so the eye can easily
   * see "blocks of code that were last edited together". The colour is
   * HSL-based for pleasant saturation/lightness in both light & dark
   * themes.
   */
  protected revisionToColor(rev: number | string): string {
    const n = typeof rev === 'number' ? rev : parseInt(String(rev), 10) || 0;
    // 24 distinct hues, evenly distributed
    const hue = (n * 137) % 360; // golden-angle approximation → good spread
    // Slightly desaturated, readable on both backgrounds
    return `hsl(${hue}, 55%, 60%)`;
  }

  /**
   * Sanitize the revision number into a CSS class name token.
   */
  protected colorKey(rev: number | string): string {
    return String(rev).replace(/[^a-zA-Z0-9_-]/g, '_');
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
