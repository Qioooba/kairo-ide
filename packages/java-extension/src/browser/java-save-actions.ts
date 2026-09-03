/**
 * Java Save Actions — format-on-save and organize-imports-on-save
 * for Java files.
 *
 * Runs on will-save so edits land before the file is written.
 * Flushes pending document sync first, then applies format and
 * organize-imports serially (never as a single stacked edit set
 * from the same stale snapshot).
 */

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import * as monaco from '@theia/monaco-editor-core';
import { JavaCompletionProvider } from './java-completion-provider';
import { JavaOrganizeImports } from './java-organize-imports';
import { JavaDocumentSyncContribution } from './java-document-sync';
import { collectLspTextEditsForUri, lspUrisReferToSameDocument, LSPTextEdit } from '../common/lsp-protocol';

const JAVA_EXTENSIONS = ['.java'];

/** Convert an LSP text edit range (0-based) to a Monaco Range (1-based). */
function lspToMonacoRange(edit: LSPTextEdit): monaco.Range {
  return new monaco.Range(
    edit.range.start.line + 1,
    edit.range.start.character + 1,
    edit.range.end.line + 1,
    edit.range.end.character + 1,
  );
}

@injectable()
export class JavaSaveActionsService implements FrontendApplicationContribution {
  @inject(JavaCompletionProvider) protected readonly provider!: JavaCompletionProvider;
  @inject(JavaOrganizeImports) protected readonly imports!: JavaOrganizeImports;
  @inject(PreferenceService) protected readonly prefs!: PreferenceService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(MonacoWorkspace) protected readonly monacoWorkspace!: MonacoWorkspace;
  @inject(JavaDocumentSyncContribution) @optional()
  protected readonly documentSync?: JavaDocumentSyncContribution;

  protected readonly attached = new WeakSet<object>();

  onStart(_app: FrontendApplication): void {
    for (const model of this.monacoWorkspace.textDocuments) {
      this.attachWillSave(model);
    }
    this.monacoWorkspace.onDidOpenTextDocument((model: MonacoEditorModel) => {
      this.attachWillSave(model);
    });
  }

  protected attachWillSave(model: MonacoEditorModel): void {
    if (this.attached.has(model)) return;
    this.attached.add(model);
    model.onModelWillSaveModel(async (e) => {
      const uri = e.model.uri;
      if (uri && this.isJavaFile(uri)) {
        await this.runSaveActions(uri);
      }
    });
  }

  protected isJavaFile(uri: string): boolean {
    return JAVA_EXTENSIONS.some(ext => uri.endsWith(ext));
  }

  protected async runSaveActions(uri: string): Promise<void> {
    const formatOnSave = this.prefs.get<boolean>('kairo.java.formatOnSave', false);
    const organizeImportsOnSave = this.prefs.get<boolean>('kairo.java.organizeImportsOnSave', false);

    if (!formatOnSave && !organizeImportsOnSave) {
      return;
    }

    const editor = this.findEditorForUri(uri);
    if (!editor) return;

    const control = editor.getControl();
    const model = control.getModel();
    if (!model) return;

    try {
      // Flush pending didChange so LSP sees the latest buffer before
      // computing format / organize-imports edits.
      this.documentSync?.flushPending(uri);
      this.provider.cacheSource(uri, model.getValue());

      if (formatOnSave) {
        const tabSize = this.prefs.get<number>('kairo.java.tabSize', 4);
        const insertSpaces = this.prefs.get<boolean>('kairo.java.insertSpaces', true);
        const edits = await this.provider.provideFormatting(uri, { tabSize, insertSpaces });
        if (edits && edits.length > 0) {
          this.applyEdits(control, edits);
          // Re-sync after format so organize-imports sees the new text
          this.documentSync?.flushPending(uri);
          this.provider.cacheSource(uri, model.getValue());
        }
      }

      if (organizeImportsOnSave) {
        const result = await this.imports.organizeImports(uri);
        if (result.success && result.edit) {
          const operations = collectLspTextEditsForUri(result.edit, uri);
          if (operations.length > 0) {
            this.applyEdits(control, operations);
          }
        }
      }
    } catch {
      // Silently ignore errors during save actions to avoid
      // disrupting the save flow.
    }
  }

  protected applyEdits(
    control: monaco.editor.ICodeEditor,
    edits: LSPTextEdit[],
  ): void {
    const operations: monaco.editor.IIdentifiedSingleEditOperation[] = edits.map(edit => ({
      range: lspToMonacoRange(edit),
      text: edit.newText,
    }));
    // Sort edits in reverse order so earlier edits don't
    // shift the positions of later edits.
    operations.sort((a, b) => {
      if (b.range.startLineNumber !== a.range.startLineNumber) {
        return b.range.startLineNumber - a.range.startLineNumber;
      }
      return b.range.startColumn - a.range.startColumn;
    });
    control.pushUndoStop();
    control.executeEdits('kairo.saveActions', operations);
    control.pushUndoStop();
  }

  protected findEditorForUri(uri: string): MonacoEditor | undefined {
    for (const widget of this.editorManager.all) {
      const editor = widget.editor;
      if (editor instanceof MonacoEditor && lspUrisReferToSameDocument(editor.uri.toString(), uri)) {
        return editor;
      }
    }
    return undefined;
  }
}
