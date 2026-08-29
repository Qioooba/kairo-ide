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

@injectable()
export class KairoIDEAMonacoKeymapContribution implements FrontendApplicationContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
  @inject(KeybindingRegistry) protected readonly keybindings!: KeybindingRegistry;

  private keymapApplied = false;
  private toggleCaseCommandRegistered = false;
  private lastToggleAt = 0;

  onStart(_app: FrontendApplication): void {
    if (isOSX) {
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

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      control.trigger('idea-keymap', 'editor.action.deleteLines', null);
    }, 'editorTextFocus && !editorReadonly');

    // Ctrl+D — Duplicate Line (IDEA Windows default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      control.trigger('idea-keymap', 'editor.action.copyLinesDownAction', null);
    }, 'editorTextFocus && !editorReadonly');

    // Ctrl+Shift+M — Jump to Matching Bracket (IDEA Windows default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM, () => {
      control.trigger('idea-keymap', 'editor.action.jumpToBracket', null);
    }, 'editorTextFocus');

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

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyJ, () => {
      control.trigger('idea-keymap', 'editor.action.selectHighlights', null);
    }, 'editorTextFocus');

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

    // Ctrl+Shift+/ — Block Comment (IDEA). Same class of gap: the Theia-level
    // binding references 'editor.action.blockComment', which is not a
    // registered Theia command (BUG-20260826-307).
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Slash, () => {
      control.trigger('idea-keymap', 'editor.action.blockComment', null);
    }, 'editorTextFocus');
  }
}
