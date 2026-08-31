import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { isOSX } from '@theia/core/lib/common/os';
import * as monaco from '@theia/monaco-editor-core';

export const KAIRO_TOGGLE_CASE_COMMAND = {
  id: 'kairo.editor.toggleCase',
  label: 'Toggle Case',
};

/** Commands that must be routed through Theia's keybinding registry.  Monaco
 * has competing built-ins for these chords (redo, bracket navigation and
 * comment actions); registering a second editor-level handler is order
 * dependent and produced silent no-ops in Chromium on Windows. */
const KAIRO_DELETE_LINE_COMMAND = {
  id: 'kairo.editor.deleteLine',
  label: 'Delete Line',
};
const KAIRO_DUPLICATE_LINE_COMMAND = {
  id: 'kairo.editor.duplicateLine',
  label: 'Duplicate Line',
};
const KAIRO_SELECT_ALL_OCCURRENCES_COMMAND = {
  id: 'kairo.editor.selectAllOccurrences',
  label: 'Select All Occurrences',
};
const KAIRO_JUMP_TO_BRACKET_COMMAND = {
  id: 'kairo.editor.jumpToBracket',
  label: 'Jump to Matching Bracket',
};
const KAIRO_BLOCK_COMMENT_COMMAND = {
  id: 'kairo.editor.blockComment',
  label: 'Toggle Block Comment',
};

@injectable()
export class KairoIDEAMonacoKeymapContribution implements FrontendApplicationContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
  @inject(KeybindingRegistry) protected readonly keybindings!: KeybindingRegistry;

  private keymapApplied = false;
  private toggleCaseCommandRegistered = false;
  private lastToggleAt = 0;
  private editorCommandBindingsRegistered = false;

  onStart(_app: FrontendApplication): void {
    if (isOSX) {
      return;
    }

    this.reclaimToggleCaseChord();
    this.registerEditorCommandBindings();
    this.applyIDEAKeybindings();
    this.editorManager.onCreated(widget => {
      const editor = widget.editor;
      if (editor instanceof MonacoEditor) {
        this.applyEditorKeybindings(editor);
      }
    });
    for (const widget of this.editorManager.all) {
      const editor = widget.editor;
      if (editor instanceof MonacoEditor) {
        this.applyEditorKeybindings(editor);
      }
    }
  }

  /**
   * Theia registers VS Code-style bottom-panel toggles (Output uses
   * "CtrlCmd+Shift+U" = output:toggle on Windows/Linux too) that swallow the
   * IDEA Toggle Case chord before Monaco ever sees it (BUG-20260826-308).
   * Runs at app onStart, i.e. after every KeybindingContribution has already
   * registered its bindings, so the unregister reliably finds them.
   */
  protected reclaimToggleCaseChord(): void {
    for (const raw of ['CtrlCmd+Shift+U', 'ctrlcmd+shift+u', 'ctrl+shift+u']) {
      this.keybindings.unregisterKeybinding(raw);
    }
    if (!this.toggleCaseCommandRegistered) {
      this.toggleCaseCommandRegistered = true;
      this.commands.registerCommand(KAIRO_TOGGLE_CASE_COMMAND, {
        // Guard against double dispatch (registry + panel re-register races):
        // two executions inside the debounce window cancel each other out.
        execute: () => {
          const now = Date.now();
          if (now - this.lastToggleAt < 120) {
            return;
          }
          this.lastToggleAt = now;
          this.toggleCaseInActiveEditor();
        },
      });
    }
    this.keybindings.registerKeybinding({
      command: KAIRO_TOGGLE_CASE_COMMAND.id,
      keybinding: 'ctrlcmd+shift+u',
      when: 'editorTextFocus && !editorReadonly',
    });
  }

  protected toggleCaseInActiveEditor(): void {
    const current = this.editorManager.currentEditor?.editor;
    if (!(current instanceof MonacoEditor)) {
      return;
    }
    const control = current.getControl();
    const selection = control.getSelection();
    const model = control.getModel();
    if (!control || !selection || selection.isEmpty() || !model) {
      return;
    }
    const text = model.getValueInRange(selection);
    const isUpperCase = text === text.toUpperCase() && text !== text.toLowerCase();
    control.executeEdits('idea-toggle-case', [{
      range: selection,
      text: isUpperCase ? text.toLowerCase() : text.toUpperCase(),
    }]);
  }

  /**
   * Route conflict-prone Windows editor actions through a single dispatch
   * path.  The previous implementation added Monaco handlers for Ctrl+Y,
   * Ctrl+Shift+M and Ctrl+Alt+Shift+J while Chromium's native delivery and
   * Monaco defaults competed for the same chords.  In a browser this looked
   * like the shortcuts were accepted but did nothing.  Theia's registry owns
   * the chord and invokes the active editor explicitly, matching the stable
   * macOS implementation.
   */
  protected registerEditorCommandBindings(): void {
    if (this.editorCommandBindingsRegistered) {
      return;
    }
    this.editorCommandBindingsRegistered = true;
    this.keybindings.unregisterKeybinding('ctrl+y');
    this.keybindings.unregisterKeybinding('ctrl+d');
    this.keybindings.unregisterKeybinding('ctrl+shift+m');
    this.keybindings.unregisterKeybinding('ctrl+alt+shift+j');
    this.keybindings.unregisterKeybinding('ctrl+shift+/');

    this.commands.registerCommand(KAIRO_DELETE_LINE_COMMAND, {
      execute: () => this.triggerInActiveEditor('editor.action.deleteLines'),
    });
    this.commands.registerCommand(KAIRO_DUPLICATE_LINE_COMMAND, {
      execute: () => this.duplicateActiveLine(),
    });
    this.commands.registerCommand(KAIRO_SELECT_ALL_OCCURRENCES_COMMAND, {
      execute: () => this.triggerInActiveEditor('editor.action.selectHighlights'),
    });
    this.commands.registerCommand(KAIRO_JUMP_TO_BRACKET_COMMAND, {
      execute: () => this.triggerInActiveEditor('editor.action.jumpToBracket'),
    });
    this.commands.registerCommand(KAIRO_BLOCK_COMMENT_COMMAND, {
      execute: () => this.triggerInActiveEditor('editor.action.blockComment'),
    });

    const when = 'editorTextFocus && !editorReadonly';
    this.keybindings.registerKeybinding({ command: KAIRO_DELETE_LINE_COMMAND.id, keybinding: 'ctrl+y', when });
    this.keybindings.registerKeybinding({ command: KAIRO_DUPLICATE_LINE_COMMAND.id, keybinding: 'ctrl+d', when });
    this.keybindings.registerKeybinding({ command: KAIRO_SELECT_ALL_OCCURRENCES_COMMAND.id, keybinding: 'ctrl+alt+shift+j', when });
    this.keybindings.registerKeybinding({ command: KAIRO_JUMP_TO_BRACKET_COMMAND.id, keybinding: 'ctrl+shift+m', when: 'editorTextFocus' });
    this.keybindings.registerKeybinding({ command: KAIRO_BLOCK_COMMENT_COMMAND.id, keybinding: 'ctrl+shift+/', when });
  }

  protected triggerInActiveEditor(actionId: string): void {
    const current = this.editorManager.currentEditor?.editor;
    if (!(current instanceof MonacoEditor)) {
      return;
    }
    current.getControl().trigger('idea-keymap', actionId, null);
  }

  /** Duplicate the active line without relying on Monaco's competing
   * copy-line keybinding.  The editor action is not exposed consistently by
   * all Monaco builds, while this edit operation is stable across browser and
   * Electron hosts and preserves the current cursor column. */
  protected duplicateActiveLine(): void {
    const current = this.editorManager.currentEditor?.editor;
    if (!(current instanceof MonacoEditor)) {
      return;
    }
    const control = current.getControl();
    const model = control.getModel();
    const selection = control.getSelection();
    if (!model || !selection) {
      return;
    }
    const lineNumber = selection.positionLineNumber;
    const lineContent = model.getLineContent(lineNumber);
    const endColumn = model.getLineMaxColumn(lineNumber);
    const cursorColumn = Math.min(selection.positionColumn, endColumn);
    const eol = model.getEOL();
    control.executeEdits('idea-duplicate-line', [{
      range: { startLineNumber: lineNumber, startColumn: endColumn, endLineNumber: lineNumber, endColumn },
      text: `${eol}${lineContent}`,
    }]);
    control.setPosition({ lineNumber: lineNumber + 1, column: cursorColumn });
  }

  private applyIDEAKeybindings(): void {
    if (this.keymapApplied) {
      return;
    }
    this.keymapApplied = true;

    monaco.editor.addKeybindingRules([
      {
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.Alt | monaco.KeyCode.Enter,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
        command: null,
        when: 'editorTextFocus',
      },
    ]);
  }

  private applyEditorKeybindings(editor: MonacoEditor): void {
    const control = editor.getControl();
    if (!control) {
      return;
    }

    // Ctrl+R — Find / Replace (IDEA). Monaco-level registration is
    // required: the Theia-level binding for the raw action id
    // 'editor.action.startFindReplaceAction' has no backing command in the
    // CommandRegistry and never fired (BUG-20260826-110).
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, () => {
      control.trigger('idea-keymap', 'editor.action.startFindReplaceAction', null);
    }, 'editorFocus');

    // Ctrl+Shift+U — Toggle Case is handled at the Theia KeybindingRegistry
    // level (see reclaimToggleCaseChord): the Output panel registers
    // "CtrlCmd+Shift+U" (output:toggle) in the same registry and consumes the
    // chord before any per-editor dynamic binding could run
    // (BUG-20260826-308).

    control.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      control.trigger('idea-keymap', 'editor.action.moveLinesDownAction', null);
    }, 'editorTextFocus && !editorReadonly');

    control.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      control.trigger('idea-keymap', 'editor.action.moveLinesUpAction', null);
    }, 'editorTextFocus && !editorReadonly');

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      control.trigger('idea-keymap', 'editor.action.insertCursorBelow', null);
    }, 'editorTextFocus && !editorReadonly');

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      control.trigger('idea-keymap', 'editor.action.insertCursorAbove', null);
    }, 'editorTextFocus && !editorReadonly');

    control.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyJ, () => {
      control.trigger('idea-keymap', 'editor.action.addSelectionToNextFindMatch', null);
    }, 'editorTextFocus');

    // Duplicate-line, select-all-occurrences, bracket matching and block
    // comments are routed
    // through registerEditorCommandBindings() above.  Keeping duplicate
    // Monaco handlers here makes Chromium dispatch the action twice or let a
    // built-in command win depending on event timing.

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.End, () => {
      control.trigger('idea-keymap', 'cursorBottom', null);
    }, 'editorTextFocus');

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Home, () => {
      control.trigger('idea-keymap', 'cursorTop', null);
    }, 'editorTextFocus');

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.End, () => {
      control.trigger('idea-keymap', 'cursorBottomSelect', null);
    }, 'editorTextFocus');

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Home, () => {
      control.trigger('idea-keymap', 'cursorTopSelect', null);
    }, 'editorTextFocus');

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F4, () => {
      control.trigger('idea-keymap', 'workbench.action.closeActiveEditor', null);
    });

    // Ctrl+- / Ctrl+= / Ctrl+Shift+- / Ctrl+Shift+= — Fold / Unfold (single /
    // all). The Theia-level bindings in kairo-idea-windows-keymap.ts reference
    // command ids ('editor.fold' family) that no Theia CommandRegistry ever
    // exposes, so the registry match is a silent no-op; register at Monaco
    // level (BUG-20260826-307).
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
      control.trigger('idea-keymap', 'editor.fold', null);
    }, 'editorFocus');
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
      control.trigger('idea-keymap', 'editor.unfold', null);
    }, 'editorFocus');
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Minus, () => {
      control.trigger('idea-keymap', 'editor.foldAll', null);
    }, 'editorFocus');
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Equal, () => {
      control.trigger('idea-keymap', 'editor.unfoldAll', null);
    }, 'editorFocus');

    // Ctrl+Shift+/ block comment is likewise registered at the Theia level.
  }
}
