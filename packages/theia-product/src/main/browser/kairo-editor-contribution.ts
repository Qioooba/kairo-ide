/**
 * KairoEditorContribution — editor delivery enhancements:
 *
 *   B3.2: External modification conflict handling
 *   B3.3: Breadcrumb navigation (enabled by default)
 *   B3.4: Read-only file handling
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  DisposableCollection,
  Disposable,
  Emitter,
  MessageService,
  URI,
} from '@theia/core/lib/common';
import {
  FrontendApplication,
  FrontendApplicationContribution,
  ApplicationShell,
  Saveable,
} from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { PreferenceService, PreferenceScope } from '@theia/core/lib/common/preferences';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AbstractDialog, DialogProps } from '@theia/core/lib/browser/dialogs';
import { Message } from '@theia/core/shared/@lumino/messaging';
import * as monaco from '@theia/monaco-editor-core';
import { JavaOrganizeImports } from '@kairo/java-extension';
import type { LSPWorkspaceEdit, LSPTextEdit } from '@kairo/java-extension/lib/common/lsp-protocol';

/* ------------------------------------------------------------------ */
/*  B3.2: External modification conflict dialog                         */
/* ------------------------------------------------------------------ */

interface ExternalChangeDialogProps extends DialogProps {
  msg: string;
  overwriteLabel: string;
  keepLabel: string;
  compareLabel?: string;
}

export class ExternalChangeDialog extends AbstractDialog<string> {
  protected readonly externalProps: ExternalChangeDialogProps;

  constructor(props: ExternalChangeDialogProps) {
    super(props);
    this.externalProps = props;
    this.appendMessage();
    this.appendButtons();
  }

  protected appendMessage(): void {
    const messageNode = document.createElement('div');
    messageNode.textContent = this.externalProps.msg;
    messageNode.style.marginBottom = '12px';
    this.contentNode.appendChild(messageNode);
  }

  protected appendButtons(): void {
    // Overwrite (primary) — replaces the default accept button
    this.appendAcceptButton(this.externalProps.overwriteLabel);
    this.acceptButton?.addEventListener('click', () => {
      this.resolveCustom('overwrite');
    });

    // Keep (secondary)
    const keepBtn = this.appendButton(this.externalProps.keepLabel, false);
    keepBtn.addEventListener('click', () => {
      this.resolveCustom('keep');
    });

    // Compare (extra)
    if (this.externalProps.compareLabel) {
      const compareBtn = this.appendButton(this.externalProps.compareLabel, false);
      compareBtn.addEventListener('click', () => {
        this.resolveCustom('compare');
      });
    }
  }

  protected resolveCustom(result: string): void {
    if (this.resolve) {
      this.resolve(result);
      this.resolve = undefined;
    }
    this.close();
  }

  protected override onCloseRequest(msg: Message): void {
    if (this.resolve) {
      this.resolve('keep'); // Default on close
      this.resolve = undefined;
    }
    super.onCloseRequest(msg);
  }

  get value(): string {
    return 'keep';
  }
}

/* ------------------------------------------------------------------ */
/*  B3.2: External modification conflict handling                       */
/* ------------------------------------------------------------------ */

interface WatchedFile {
  uri: URI;
  mtime: number;
  editor: MonacoEditor;
}

@injectable()
export class KairoEditorContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution, MenuContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(PreferenceService) protected readonly preferences!: PreferenceService;
  @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
  @inject(JavaOrganizeImports) protected readonly organizeImports!: JavaOrganizeImports;
  @inject(StatusBar) protected readonly statusBar!: StatusBar;

  protected readonly toDispose = new DisposableCollection();

  // B3.2 state
  protected watchedFiles = new Map<string, WatchedFile>();
  protected fileWatcherDisposable?: Disposable;

  // B3.4 state
  protected readonly showReadOnlyWarning = new Set<string>();
  protected readonly onDidChangeReadOnlyWarningEmitter = new Emitter<URI>();

  @postConstruct()
  protected init(): void {
    // B3.3: Enable breadcrumbs by default
    this.preferences.ready.then(() => {
      if (this.preferences.get('breadcrumbs.enabled') === undefined) {
        this.preferences.set('breadcrumbs.enabled', true, PreferenceScope.User);
      }
    });
  }

  onStart(_app: FrontendApplication): void {
    // B3.2: Watch for external file changes on open editors
    this.toDispose.push(this.editorManager.onCreated(widget => this.trackEditor(widget)));
    this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => this.onEditorChanged()));
    for (const widget of this.editorManager.all) {
      this.trackEditor(widget);
    }

    // B3.4: Listen for read-only state changes
    this.toDispose.push(this.onDidChangeReadOnlyWarningEmitter);

    // Format-on-save status bar item
    this.renderFormatOnSaveStatus();
    this.toDispose.push(this.preferences.onPreferenceChanged(e => {
      if (e.preferenceName === 'kairo.java.formatOnSave') {
        this.renderFormatOnSaveStatus();
      }
    }));
    this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => {
      this.renderFormatOnSaveStatus();
    }));
  }

  onStop(): void {
    this.toDispose.dispose();
    this.fileWatcherDisposable?.dispose();
  }

  /* ------------------------------------------------------------------ */
  /*  Organize Imports command                                            */
  /* ------------------------------------------------------------------ */

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(
      { id: 'kairo.organizeImports', label: 'Kairo: Organize Imports' },
      {
        execute: async () => {
          const editor = this.editorManager.currentEditor?.editor;
          if (!(editor instanceof MonacoEditor)) {
            this.messages.warn('No active Java editor.');
            return undefined;
          }
          const uri = editor.uri.toString();
          const result = await this.organizeImports.organizeImports(uri);
          if (!result.success) {
            this.messages.error(result.message);
            return undefined;
          }
          if (!result.edit) {
            this.messages.info(result.message);
            return undefined;
          }
          // Apply the workspace edit to the current Monaco editor.
          this.applyWorkspaceEdit(editor, uri, result.edit);
          this.messages.info(result.message);
          return undefined;
        },
      },
    );

    registry.registerCommand(
      { id: 'kairo.toggleFormatOnSave', label: 'Kairo: Toggle Format on Save' },
      {
        execute: async () => {
          const current = this.preferences.get<boolean>('kairo.java.formatOnSave', false);
          await this.preferences.set('kairo.java.formatOnSave', !current, PreferenceScope.User);
          this.messages.info(`Format on Save: ${!current ? 'Enabled' : 'Disabled'}`);
          return undefined;
        },
        isToggled: () => this.preferences.get<boolean>('kairo.java.formatOnSave', false),
      },
    );

    registry.registerCommand(
      { id: 'kairo.toggleOrganizeImportsOnSave', label: 'Kairo: Toggle Organize Imports on Save' },
      {
        execute: async () => {
          const current = this.preferences.get<boolean>('kairo.java.organizeImportsOnSave', false);
          await this.preferences.set('kairo.java.organizeImportsOnSave', !current, PreferenceScope.User);
          this.messages.info(`Organize Imports on Save: ${!current ? 'Enabled' : 'Disabled'}`);
          return undefined;
        },
        isToggled: () => this.preferences.get<boolean>('kairo.java.organizeImportsOnSave', false),
      },
    );
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    // IDEA Organize Imports: Ctrl+Alt+O / ⌃⌥O. Never ⌘⌥O (Go to Symbol on Mac).
    keybindings.registerKeybinding({
      command: 'kairo.organizeImports',
      keybinding: 'ctrl+alt+o',
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(['editor_context_menu', '0_more'], {
      commandId: 'kairo.toggleFormatOnSave',
      label: 'Format on Save',
      order: 'a',
    });
    menus.registerMenuAction(['editor_context_menu', '0_more'], {
      commandId: 'kairo.toggleOrganizeImportsOnSave',
      label: 'Organize Imports on Save',
      order: 'b',
    });
  }

  /**
   * Apply a JDT LS workspace edit to the given Monaco editor.
   * Only edits for the current file URI are applied.
   */
  private applyWorkspaceEdit(editor: MonacoEditor, fileUri: string, edit: LSPWorkspaceEdit): void {
    const control = editor.getControl();
    const model = control.getModel();
    if (!model) return;

    const operations: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    const textEdits = edit.changes?.[fileUri];
    if (textEdits) {
      for (const te of textEdits) {
        operations.push({
          range: lspToMonacoRange(te),
          text: te.newText,
        });
      }
    }
    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        if ('kind' in change) continue; // Skip resource operations
        if (change.textDocument.uri !== fileUri) continue;
        for (const te of change.edits) {
          operations.push({
            range: lspToMonacoRange(te),
            text: te.newText,
          });
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
      control.executeEdits('kairo.organizeImports', operations);
      control.pushUndoStop();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  B3.2: External modification conflict handling                       */
  /* ------------------------------------------------------------------ */

  protected trackEditor(widget: EditorWidget): void {
    const editor = widget.editor;
    if (!(editor instanceof MonacoEditor)) return;
    const uri = editor.uri;
    const uriStr = uri.toString();

    if (this.watchedFiles.has(uriStr)) return;

    this.fileService.resolve(uri, { resolveMetadata: true }).then(stat => {
      this.watchedFiles.set(uriStr, {
        uri,
        mtime: stat.mtime,
        editor,
      });
    }).catch(() => {
      // File may not exist yet (untitled), skip
    });

    widget.disposed.connect(() => {
      this.watchedFiles.delete(uriStr);
    });
  }

  protected onEditorChanged(): void {
    const current = this.editorManager.currentEditor?.editor;
    if (!(current instanceof MonacoEditor)) return;
    const uriStr = current.uri.toString();
    const watched = this.watchedFiles.get(uriStr);
    if (!watched) return;

    // Check if file was modified externally since we last tracked it
    this.fileService.resolve(watched.uri, { resolveMetadata: true }).then(stat => {
      if (stat.mtime !== watched.mtime) {
        this.handleExternalChange(watched, stat.mtime);
      }
    }).catch(() => {
      // ignore
    });
  }

  /**
   * Check a specific URI for external modification.
   * Called when the editor gains focus or when the file watcher fires.
   */
  checkExternalChange(uri: URI): void {
    const uriStr = uri.toString();
    const watched = this.watchedFiles.get(uriStr);
    if (!watched) return;

    this.fileService.resolve(uri, { resolveMetadata: true }).then(stat => {
      if (stat.mtime !== watched.mtime) {
        this.handleExternalChange(watched, stat.mtime);
      }
    }).catch(() => {
      // ignore
    });
  }

  protected async handleExternalChange(watched: WatchedFile, newMtime: number): Promise<void> {
    const editor = watched.editor;
    const isDirty = editor.document.dirty;

    const props: ExternalChangeDialogProps = {
      title: 'File Modified Externally',
      msg: `"${watched.uri.displayName}" was modified outside Kairo IDE.`,
      overwriteLabel: 'Overwrite',
      keepLabel: 'Keep',
      compareLabel: 'Compare',
    };

    const dialog = new ExternalChangeDialog(props);
    const result = await dialog.open();
    if (result === 'overwrite') {
      // Overwrite: save the current editor contents (if dirty) or just acknowledge
      if (isDirty) {
        try {
          await Saveable.save(editor);
          this.messages.info(`"${watched.uri.displayName}" saved.`);
        } catch (err) {
          this.messages.error(`Failed to save "${watched.uri.displayName}": ${(err as Error).message}`);
        }
      }
      watched.mtime = newMtime;
    } else if (result === 'keep') {
      // Keep: revert the editor to the external version
      try {
        await editor.document.revert!();
        this.messages.info(`"${watched.uri.displayName}" reverted to external version.`);
      } catch (err) {
        this.messages.error(`Failed to revert "${watched.uri.displayName}": ${(err as Error).message}`);
      }
      watched.mtime = newMtime;
    }
    // "Compare" button closes the dialog with no action - user can inspect manually
  }

  /* ------------------------------------------------------------------ */
  /*  B3.4: Read-only file handling                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Show a lock icon on read-only file tabs and handle read-only editing.
   * Called when the editor is about to be modified.
   */
  handleReadOnlyEdit(editor: MonacoEditor): boolean {
    if (!editor.isReadonly) return true;

    const uriStr = editor.uri.toString();
    if (this.showReadOnlyWarning.has(uriStr)) return true; // Already warned

    this.showReadOnlyWarning.add(uriStr);
    const props: ExternalChangeDialogProps = {
      title: 'Read-Only File',
      msg: `"${editor.uri.displayName}" is read-only. Attempt to override?`,
      overwriteLabel: 'Override',
      keepLabel: 'Keep Read-Only',
    };

    const dialog = new ExternalChangeDialog(props);
    dialog.open().then(result => {
      this.showReadOnlyWarning.delete(uriStr);
      if (result === 'overwrite') {
        // User chose to override - make the editor writable
        editor.getControl().updateOptions({ readOnly: false });
        this.messages.warn(`"${editor.uri.displayName}" is now editable. Save will attempt to write to the file.`);
      }
    });

    return false; // Block the edit
  }

  /**
   * Show a clear error message on save failure for read-only files.
   */
  handleReadOnlySaveFailure(uri: URI, _error: Error): void {
    this.messages.error(
      `Cannot save "${uri.displayName}": The file is read-only or you do not have write permissions. ` +
      `Check file permissions and try again.`,
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Format-on-Save status bar item                                      */
  /* ------------------------------------------------------------------ */

  protected renderFormatOnSaveStatus(): void {
    const editor = this.editorManager.currentEditor?.editor;
    const isJavaFile = editor instanceof MonacoEditor && editor.uri.toString().endsWith('.java');
    if (!isJavaFile) {
      this.statusBar.removeElement('kairo.formatOnSave');
      return;
    }
    const enabled = this.preferences.get<boolean>('kairo.java.formatOnSave', false);
    this.statusBar.setElement('kairo.formatOnSave', {
      text: enabled ? '$(check) Format on Save' : '$(close) Format on Save',
      tooltip: enabled
        ? 'Format on Save is enabled. Click to disable.'
        : 'Format on Save is disabled. Click to enable.',
      alignment: StatusBarAlignment.RIGHT,
      priority: 109,
      command: 'kairo.toggleFormatOnSave',
    });
  }
}

/** Convert an LSP text edit range (0-based) to a Monaco Range (1-based). */
function lspToMonacoRange(edit: LSPTextEdit): monaco.Range {
  return new monaco.Range(
    edit.range.start.line + 1,
    edit.range.start.character + 1,
    edit.range.end.line + 1,
    edit.range.end.character + 1,
  );
}