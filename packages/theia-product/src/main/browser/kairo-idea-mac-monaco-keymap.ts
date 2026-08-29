/**
 * Kairo IDE — IntelliJ IDEA Monaco Keymap for macOS
 *
 * Nullifies Monaco editor default keybindings that conflict with the
 * IDEA macOS keymap, and registers editor-level commands that require
 * direct access to the Monaco editor instance.
 *
 * Reference: IntelliJ IDEA Default Keymap (macOS)
 */

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

export const KAIRO_DELETE_LINE_COMMAND = {
  id: 'kairo.editor.deleteLine',
  label: 'Delete Line',
};

export const KAIRO_MOVE_LINE_UP_COMMAND = {
  id: 'kairo.editor.moveLineUp',
  label: 'Move Line Up',
};

export const KAIRO_MOVE_LINE_DOWN_COMMAND = {
  id: 'kairo.editor.moveLineDown',
  label: 'Move Line Down',
};

@injectable()
export class KairoIDEAMacMonacoKeymapContribution implements FrontendApplicationContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
  @inject(KeybindingRegistry) protected readonly keybindings!: KeybindingRegistry;

  private keymapApplied = false;
  private toggleCaseCommandRegistered = false;
  private deleteLineCommandRegistered = false;
  private moveLineCommandsRegistered = false;

  onStart(_app: FrontendApplication): void {
    if (!isOSX) {
      return;
    }

    this.reclaimToggleCaseChord();
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
   * Theia registers VS Code-style bottom-panel toggles (e.g. Output with
   * "CtrlCmd+Shift+U") that swallow IDEA chords before Monaco ever sees them,
   * so the dynamic per-editor Toggle Case binding was dead (BUG-20260826-308).
   * Runs at app onStart, i.e. after every KeybindingContribution has already
   * registered its bindings, so the unregister reliably finds them.
   */
  protected reclaimToggleCaseChord(): void {
    for (const raw of ['CtrlCmd+Shift+U', 'ctrlcmd+shift+u', 'cmd+shift+u']) {
      this.keybindings.unregisterKeybinding(raw);
    }
    if (!this.toggleCaseCommandRegistered) {
      this.toggleCaseCommandRegistered = true;
      this.commands.registerCommand(KAIRO_TOGGLE_CASE_COMMAND, {
        execute: () => this.toggleCaseInActiveEditor(),
      });
    }
    this.keybindings.registerKeybinding({
      command: KAIRO_TOGGLE_CASE_COMMAND.id,
      keybinding: 'ctrlcmd+shift+u',
      when: 'editorTextFocus && !editorReadonly',
    });
    // Cmd+Backspace — Delete Line. Monaco's built-in mac "delete to line
    // start" shadows the per-editor dynamic binding on the native delivery
    // path, so own the chord at the registry level like Toggle Case
    // (BUG-20260826-310 follow-up).
    if (!this.deleteLineCommandRegistered) {
      this.deleteLineCommandRegistered = true;
      this.commands.registerCommand(KAIRO_DELETE_LINE_COMMAND, {
        execute: () => this.triggerInActiveEditor('editor.action.deleteLines'),
      });
    }
    this.keybindings.registerKeybinding({
      command: KAIRO_DELETE_LINE_COMMAND.id,
      keybinding: 'ctrlcmd+backspace',
      when: 'editorTextFocus && !editorReadonly',
    });
    // Shift+Alt+Up/Down — Move Line. Monaco's built-in Copy-Line shares the
    // chord and outranks dynamic per-editor bindings, so own these at the
    // registry level too (BUG-20260826-310 follow-up).
    if (!this.moveLineCommandsRegistered) {
      this.moveLineCommandsRegistered = true;
      this.commands.registerCommand(KAIRO_MOVE_LINE_UP_COMMAND, {
        execute: () => this.triggerInActiveEditor('editor.action.moveLinesUpAction'),
      });
      this.commands.registerCommand(KAIRO_MOVE_LINE_DOWN_COMMAND, {
        execute: () => this.triggerInActiveEditor('editor.action.moveLinesDownAction'),
      });
    }
    this.keybindings.registerKeybinding({
      command: KAIRO_MOVE_LINE_UP_COMMAND.id,
      keybinding: 'shift+alt+up',
      when: 'editorTextFocus && !editorReadonly',
    });
    this.keybindings.registerKeybinding({
      command: KAIRO_MOVE_LINE_DOWN_COMMAND.id,
      keybinding: 'shift+alt+down',
      when: 'editorTextFocus && !editorReadonly',
    });
  }

  protected triggerInActiveEditor(actionId: string): void {
    const current = this.editorManager.currentEditor?.editor;
    if (!(current instanceof MonacoEditor)) {
      return;
    }
    current.getControl().trigger('idea-keymap', actionId, null);
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

  private applyIDEAKeybindings(): void {
    if (this.keymapApplied) {
      return;
    }
    this.keymapApplied = true;

    // Nullify Monaco default keybindings that conflict with IDEA macOS keymap.
    // These must be nullified so Theia's keybinding system can handle them.
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
        // macOS built-in "delete to line start" would shadow the IDEA
        // Delete-Line chord once the keyboard guard stopped cloning these
        // events into the registry (BUG-20260826-310 follow-up).
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backspace,
        command: null,
        when: 'editorTextFocus',
      },
      {
        // Built-in Copy-Line-Up/Down would shadow the IDEA Move-Line chords
        // on the native delivery path (BUG-20260826-310 follow-up).
        keybinding: monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow,
        command: null,
        when: 'editorTextFocus',
      },
      {
        keybinding: monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow,
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

    // NOTE: chords that are already bound in kairo-idea-mac-keymap.ts
    // (Theia KeybindingRegistry) must NOT be re-registered here when the
    // Theia CommandRegistry actually exposes that command (e.g. ⌘W →
    // workbench.action.closeActiveEditor): both paths would fire.
    // However ids like editor.action.* are NOT registered as Theia
    // commands — the KeybindingRegistry match is a silent no-op for them
    // and the MONACO-level registration below is what makes the chord work
    // (BUG-20260826-302 follow-up).

    // Cmd+R — Find / Replace (IDEA macOS). Monaco-level registration is
    // required: the Theia-level binding for the raw action id
    // 'editor.action.startFindReplaceAction' has no backing command in the
    // CommandRegistry and never fired (BUG-20260826-110).
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, () => {
      control.trigger('idea-keymap', 'editor.action.startFindReplaceAction', null);
    }, 'editorFocus');

    // Cmd+D — Duplicate Line (IDEA macOS default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      control.trigger('idea-keymap', 'editor.action.copyLinesDownAction', null);
    }, 'editorTextFocus && !editorReadonly');

    // Ctrl+G — Add Cursor Above (IDEA macOS: Ctrl+G, not Ctrl+Alt+Up).
    // BUG-20260826-304: KeyMod.CtrlCmd maps to ⌘ on macOS — the previous
    // binding hijacked ⌘G (find-next) and never delivered Ctrl+G.
    // IDEA semantics need the literal Control key → KeyMod.WinCtrl.
    control.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyG, () => {
      control.trigger('idea-keymap', 'editor.action.insertCursorAbove', null);
    }, 'editorTextFocus && !editorReadonly');

    // Ctrl+Shift+G — Add Cursor Below
    control.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.KeyG, () => {
      control.trigger('idea-keymap', 'editor.action.insertCursorBelow', null);
    }, 'editorTextFocus && !editorReadonly');

    // Cmd+Shift+U — Toggle Case is handled at the Theia KeybindingRegistry
    // level (see reclaimToggleCaseChord): the Output panel registers
    // "CtrlCmd+Shift+U" (output:toggle) in the same registry and consumes the
    // chord before any per-editor dynamic binding could run
    // (BUG-20260826-308).

    // Option+J — Select Next Occurrence
    control.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyJ, () => {
      control.trigger('idea-keymap', 'editor.action.addSelectionToNextFindMatch', null);
    }, 'editorTextFocus');

    // Cmd+Ctrl+Shift+J — Select All Occurrences
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.KeyJ, () => {
      control.trigger('idea-keymap', 'editor.action.selectHighlights', null);
    }, 'editorTextFocus');

    // Cmd+End — Cursor Bottom
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.End, () => {
      control.trigger('idea-keymap', 'cursorBottom', null);
    }, 'editorTextFocus');

    // Cmd+Home — Cursor Top
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Home, () => {
      control.trigger('idea-keymap', 'cursorTop', null);
    }, 'editorTextFocus');

    // Cmd+Shift+End — Cursor Bottom Select
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.End, () => {
      control.trigger('idea-keymap', 'cursorBottomSelect', null);
    }, 'editorTextFocus');

    // Cmd+Shift+Home — Cursor Top Select
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Home, () => {
      control.trigger('idea-keymap', 'cursorTopSelect', null);
    }, 'editorTextFocus');

    // Ctrl+Shift+M — Jump to Matching Bracket. The registry match is
    // prevented+consumed but the bridged execution never reaches the active
    // monaco editor, so register the action directly (BUG-20260826-306).
    control.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.KeyM, () => {
      control.trigger('idea-keymap', 'editor.action.jumpToBracket', null);
    }, 'editorTextFocus');

    // ⌘- / ⌘= / ⌘⇧- / ⌘⇧= — Fold / Unfold (single / all). The Theia-level
    // bindings in kairo-idea-mac-keymap.ts reference command ids
    // ('editor.fold' family) that no Theia CommandRegistry ever exposes, so
    // the registry match is a silent no-op; register at Monaco level
    // (BUG-20260826-307).
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

    // ⌥⌘/ — Block Comment (IDEA macOS). Same class of gap: the Theia-level
    // binding references 'editor.action.blockComment', which is not a
    // registered Theia command (BUG-20260826-307).
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Slash, () => {
      control.trigger('idea-keymap', 'editor.action.blockComment', null);
    }, 'editorTextFocus');

    // ⌘W (close editor) is bound in kairo-idea-mac-keymap.ts — not duplicated
    // here (see BUG-20260826-302 note above).
  }
}