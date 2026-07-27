import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { isOSX } from '@theia/core/lib/common/os';
import * as monaco from '@theia/monaco-editor-core';

@injectable()
export class KairoIDEAMonacoKeymapContribution implements FrontendApplicationContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;

  private keymapApplied = false;

  onStart(_app: FrontendApplication): void {
    if (isOSX) {
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

    control.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      control.trigger('idea-keymap', 'editor.action.deleteLines', null);
    }, 'editorTextFocus && !editorReadonly');

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
  }
}
