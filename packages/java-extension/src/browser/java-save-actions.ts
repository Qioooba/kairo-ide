/**
 * Java Save Actions — format-on-save and organize-imports-on-save
 * for Java files.
 *
 * Listens to text document save events via MonacoWorkspace and
 * applies formatting / organize-imports edits when the
 * corresponding preferences are enabled.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
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
import { LSPTextEdit } from '../common/lsp-protocol';

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

  onStart(_app: FrontendApplication): void {
    this.monacoWorkspace.onDidSaveTextDocument((model: MonacoEditorModel) => {
      const uri = model.uri?.toString();
      if (uri && this.isJavaFile(uri)) {
        this.onJavaFileSaved(uri);
      }
    });
  }

  protected isJavaFile(uri: string): boolean {
    return JAVA_EXTENSIONS.some(ext => uri.endsWith(ext));
  }

  protected async onJavaFileSaved(uri: string): Promise<void> {
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

    const operations: monaco.editor.IIdentifiedSingleEditOperation[] = [];

    try {
      if (formatOnSave) {
        const tabSize = this.prefs.get<number>('kairo.java.tabSize', 4);
        const insertSpaces = this.prefs.get<boolean>('kairo.java.insertSpaces', true);
        const edits = await this.provider.provideFormatting(uri, { tabSize, insertSpaces });
        if (edits && edits.length > 0) {
          for (const edit of edits) {
            operations.push({
              range: lspToMonacoRange(edit),
              text: edit.newText,
            });
          }
        }
      }

      if (organizeImportsOnSave) {
        const result = await this.imports.organizeImports(uri);
        if (result.success && result.edit) {
          const textEdits = result.edit.changes?.[uri];
          if (textEdits) {
            for (const te of textEdits) {
              operations.push({
                range: lspToMonacoRange(te),
                text: te.newText,
              });
            }
          }
          if (result.edit.documentChanges) {
            for (const change of result.edit.documentChanges) {
              if ('kind' in change) continue;
              if (change.textDocument.uri !== uri) continue;
              for (const te of change.edits) {
                operations.push({
                  range: lspToMonacoRange(te),
                  text: te.newText,
                });
              }
            }
          }
        }
      }

      if (operations.length > 0) {
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
    } catch {
      // Silently ignore errors during save actions to avoid
      // disrupting the save flow.
    }
  }

  protected findEditorForUri(uri: string): MonacoEditor | undefined {
    for (const widget of this.editorManager.all) {
      const editor = widget.editor;
      if (editor instanceof MonacoEditor && editor.uri.toString() === uri) {
        return editor;
      }
    }
    return undefined;
  }
}