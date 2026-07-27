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
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { isOSX } from '@theia/core/lib/common/os';
import * as monaco from '@theia/monaco-editor-core';

@injectable()
export class KairoIDEAMacMonacoKeymapContribution implements FrontendApplicationContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;

  private keymapApplied = false;

  onStart(_app: FrontendApplication): void {
    if (!isOSX) {
      return;
    }

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
    ]);
  }

  private applyEditorKeybindings(editor: MonacoEditor): void {
    const control = editor.getControl();
    if (!control) {
      return;
    }

    // Cmd+Backspace — Delete Line (IDEA macOS default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backspace, () => {
      control.trigger('idea-keymap', 'editor.action.deleteLines', null);
    }, 'editorTextFocus && !editorReadonly');

    // Cmd+D — Duplicate Line (IDEA macOS default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      control.trigger('idea-keymap', 'editor.action.copyLinesDownAction', null);
    }, 'editorTextFocus && !editorReadonly');

    // Cmd+Shift+U — Toggle Case (IDEA macOS default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyU, () => {
      const selection = control.getSelection();
      if (!selection) return;
      const model = control.getModel();
      if (!model) return;
      const text = model.getValueInRange(selection);
      const isUpperCase = text === text.toUpperCase() && text !== text.toLowerCase();
      control.executeEdits('idea-toggle-case', [{
        range: selection,
        text: isUpperCase ? text.toLowerCase() : text.toUpperCase(),
      }]);
    }, 'editorTextFocus && !editorReadonly');

    // Shift+Option+Up — Move Line Up
    control.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      control.trigger('idea-keymap', 'editor.action.moveLinesUpAction', null);
    }, 'editorTextFocus && !editorReadonly');

    // Shift+Option+Down — Move Line Down
    control.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      control.trigger('idea-keymap', 'editor.action.moveLinesDownAction', null);
    }, 'editorTextFocus && !editorReadonly');

    // Ctrl+G — Add Cursor Above (IDEA macOS: Ctrl+G, not Ctrl+Alt+Up)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
      control.trigger('idea-keymap', 'editor.action.insertCursorAbove', null);
    }, 'editorTextFocus && !editorReadonly');

    // Ctrl+Shift+G — Add Cursor Below
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG, () => {
      control.trigger('idea-keymap', 'editor.action.insertCursorBelow', null);
    }, 'editorTextFocus && !editorReadonly');

    // Option+J — Select Next Occurrence (Add Selection for Next Occurrence)
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

    // Cmd+W — Close Active Editor (IDEA macOS default)
    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      control.trigger('idea-keymap', 'workbench.action.closeActiveEditor', null);
    });
  }
}