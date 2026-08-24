/**
 * Kairo IDE — IntelliJ IDEA Keymap for macOS
 *
 * Provides complete IDEA-style keyboard shortcuts for macOS platform.
 * This contribution registers keybindings that match IntelliJ IDEA muscle memory.
 *
 * Per KAIRO_IDE_DELIVERY_MASTER_PLAN:
 *   - macOS uses Cmd-based shortcuts (e.g. Cmd+N for Go to Class)
 *   - Some shortcuts use Ctrl-based (e.g. Ctrl+Shift+R for Run)
 *   - Alt on Windows maps to Option on macOS (e.g. Option+Enter for Quick Fix)
 *
 * Reference: IntelliJ IDEA Default Keymap (macOS)
 */

import { injectable } from '@theia/core/shared/inversify';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { isOSX } from '@theia/core/lib/common/os';

interface IDEAKeybinding {
  command: string;
  keybinding: string;
  when?: string;
}

const IDEA_MAC_KEYBINDINGS: IDEAKeybinding[] = [
  // ── Editing ─────────────────────────────────────────────────
  { command: 'undo', keybinding: 'cmd+z' },
  { command: 'redo', keybinding: 'cmd+shift+z' },
  { command: 'editor.action.clipboardCutAction', keybinding: 'cmd+x', when: 'editorTextFocus' },
  { command: 'editor.action.clipboardCopyAction', keybinding: 'cmd+c', when: 'editorTextFocus' },
  { command: 'editor.action.clipboardPasteAction', keybinding: 'cmd+v', when: 'editorTextFocus' },
  { command: 'editor.action.commentLine', keybinding: 'cmd+/', when: 'editorTextFocus' },
  { command: 'editor.action.blockComment', keybinding: 'cmd+alt+/', when: 'editorTextFocus' },
  { command: 'editor.action.formatDocument', keybinding: 'cmd+alt+l', when: 'editorTextFocus' },
  { command: 'kairo.organizeImports', keybinding: 'ctrl+alt+o', when: 'editorTextFocus' },
  { command: 'editor.action.rename', keybinding: 'shift+f6', when: 'editorTextFocus' },
  { command: 'editor.action.deleteLines', keybinding: 'cmd+backspace', when: 'editorTextFocus' },
  { command: 'editor.action.copyLinesDownAction', keybinding: 'cmd+d', when: 'editorTextFocus' },
  { command: 'editor.action.smartSelect.expand', keybinding: 'alt+up', when: 'editorTextFocus' },
  { command: 'editor.action.smartSelect.shrink', keybinding: 'alt+down', when: 'editorTextFocus' },
  { command: 'editor.action.insertLineAfter', keybinding: 'shift+enter', when: 'editorTextFocus' },
  { command: 'editor.action.insertLineBefore', keybinding: 'cmd+alt+enter', when: 'editorTextFocus' },
  { command: 'editor.action.completeStatement', keybinding: 'cmd+shift+enter', when: 'editorTextFocus' },
  { command: 'editor.action.quickFix', keybinding: 'alt+enter', when: 'editorTextFocus' },
  { command: 'editor.action.triggerSuggest', keybinding: 'ctrl+space', when: 'editorTextFocus' },
  { command: 'kairo.java.smartCompletion', keybinding: 'ctrl+shift+space', when: 'editorTextFocus' },
  { command: 'editor.action.triggerParameterHints', keybinding: 'cmd+p', when: 'editorTextFocus' },
  { command: 'editor.action.showHover', keybinding: 'ctrl+j', when: 'editorTextFocus' },
  { command: 'editor.action.marker.next', keybinding: 'f2', when: 'editorFocus' },
  { command: 'editor.action.marker.prev', keybinding: 'shift+f2', when: 'editorFocus' },
  { command: 'editor.fold', keybinding: 'cmd+-', when: 'editorFocus' },
  { command: 'editor.unfold', keybinding: 'cmd+=', when: 'editorFocus' },
  { command: 'editor.foldAll', keybinding: 'cmd+shift+-', when: 'editorFocus' },
  { command: 'editor.unfoldAll', keybinding: 'cmd+shift+=', when: 'editorFocus' },
  { command: 'editor.action.joinLines', keybinding: 'ctrl+shift+j', when: 'editorTextFocus' },
  { command: 'editor.action.addSelectionToNextFindMatch', keybinding: 'alt+j', when: 'editorTextFocus' },
  { command: 'editor.action.selectHighlights', keybinding: 'cmd+ctrl+shift+j', when: 'editorTextFocus' },
  { command: 'editor.action.toggleColumnSelection', keybinding: 'cmd+shift+8', when: 'editorFocus' },

  // ── Navigation ──────────────────────────────────────────────
  { command: 'kairo.find.class', keybinding: 'cmd+o' },
  { command: 'kairo.find.file', keybinding: 'cmd+shift+o' },
  { command: 'kairo.find.symbol', keybinding: 'cmd+alt+o' },
  { command: 'kairo.find.action', keybinding: 'cmd+shift+a' },
  { command: 'kairo.navigation.goToLine', keybinding: 'cmd+l' },
  { command: 'editor.action.revealDefinition', keybinding: 'cmd+b', when: 'editorTextFocus' },
  { command: 'workbench.action.toggleSidebar', keybinding: 'cmd+b', when: '!editorTextFocus' },
  { command: 'editor.action.peekDefinition', keybinding: 'cmd+shift+i', when: 'editorTextFocus' },
  { command: 'editor.action.goToImplementation', keybinding: 'cmd+alt+b', when: 'editorTextFocus' },
  { command: 'editor.action.referenceSearch.trigger', keybinding: 'alt+f7', when: 'editorTextFocus && editorLangId != java' },
  { command: 'kairo.java.findUsages', keybinding: 'alt+f7', when: 'editorTextFocus && editorLangId == java' },
  { command: 'kairo.java.showUsages', keybinding: 'alt+cmd+f7', when: 'editorTextFocus && editorLangId == java' },
  { command: 'kairo.navigation.back', keybinding: 'cmd+[' },
  { command: 'kairo.navigation.forward', keybinding: 'cmd+]' },
  { command: 'kairo.navigation.recentFiles', keybinding: 'cmd+e' },
  // Map unimplemented alias to recentFiles (TP-P2-2)
  { command: 'kairo.navigation.recentFiles', keybinding: 'cmd+shift+e' },
  { command: 'editor.action.jumpToBracket', keybinding: 'ctrl+shift+m', when: 'editorTextFocus' },
  { command: 'editor.action.revealDefinition', keybinding: 'f4', when: 'editorTextFocus' },
  { command: 'editor.action.typeHierarchy', keybinding: 'ctrl+h', when: 'editorTextFocus' },
  { command: 'kairo.navigation.fileStructure', keybinding: 'cmd+f12', when: 'editorTextFocus' },

  // ── Search / Replace ────────────────────────────────────────
  { command: 'kairo.search.center.toggle', keybinding: 'cmd+shift+f' },
  { command: 'kairo.search.replace', keybinding: 'cmd+shift+r' },
  { command: 'actions.find', keybinding: 'cmd+f', when: 'editorFocus' },
  { command: 'editor.action.startFindReplaceAction', keybinding: 'cmd+r', when: 'editorFocus' },
  { command: 'editor.action.nextMatchFindAction', keybinding: 'cmd+g', when: 'editorFocus' },
  { command: 'editor.action.previousMatchFindAction', keybinding: 'cmd+shift+g', when: 'editorFocus' },

  // ── Build / Run / Debug ─────────────────────────────────────
  { command: 'kairo.build', keybinding: 'cmd+f9' },
  { command: 'kairo.buildAndDeploy', keybinding: 'cmd+shift+f9' },
  { command: 'kairo.server.start', keybinding: 'ctrl+shift+r' },
  { command: 'kairo.server.debug', keybinding: 'ctrl+shift+d' },
  { command: 'kairo.server.stop', keybinding: 'cmd+f2', when: '!inDebugMode' },
  { command: 'editor.debug.action.toggleBreakpoint', keybinding: 'cmd+f8', when: 'editorTextFocus' },
  { command: 'editor.debug.action.conditionalBreakpoint', keybinding: 'cmd+shift+f8', when: 'editorTextFocus' },
  { command: 'workbench.action.debug.stepOver', keybinding: 'f8', when: 'inDebugMode' },
  { command: 'workbench.action.debug.stepInto', keybinding: 'f7', when: 'inDebugMode' },
  { command: 'workbench.action.debug.stepOut', keybinding: 'shift+f8', when: 'inDebugMode' },
  { command: 'workbench.action.debug.continue', keybinding: 'cmd+alt+r', when: 'inDebugMode' },
  { command: 'editor.debug.action.runToCursor', keybinding: 'alt+f9', when: 'inDebugMode' },

  // ── Refactoring ─────────────────────────────────────────────
  { command: 'editor.action.generator.generate', keybinding: 'cmd+n', when: 'editorTextFocus' },
  { command: 'editor.action.overrideMethod', keybinding: 'ctrl+o', when: 'editorTextFocus' },
  { command: 'editor.action.implementMethods', keybinding: 'ctrl+i', when: 'editorTextFocus' },
  { command: 'editor.action.surroundWith', keybinding: 'cmd+alt+t', when: 'editorTextFocus' },
  { command: 'editor.action.unwrap', keybinding: 'cmd+shift+delete', when: 'editorTextFocus' },
  { command: 'editor.action.hippieCompletion', keybinding: 'alt+/', when: 'editorTextFocus' },
  { command: 'editor.action.hippieCompletionBackward', keybinding: 'alt+shift+/', when: 'editorTextFocus' },
  { command: 'kairo.java.liveTemplates.manage', keybinding: 'cmd+alt+j', when: 'editorTextFocus' },
  { command: 'editor.action.refactor', keybinding: 'ctrl+t', when: 'editorTextFocus' },
  { command: 'editor.action.extractMethod', keybinding: 'cmd+alt+m', when: 'editorTextFocus' },
  { command: 'editor.action.extractVariable', keybinding: 'cmd+alt+v', when: 'editorTextFocus' },
  { command: 'editor.action.extractConstant', keybinding: 'cmd+alt+c', when: 'editorTextFocus' },
  { command: 'editor.action.extractField', keybinding: 'cmd+alt+f', when: 'editorTextFocus' },
  { command: 'editor.action.changeSignature', keybinding: 'cmd+f6', when: 'editorTextFocus' },

  // ── General / IDE ───────────────────────────────────────────
  // N-057: Theia already binds cmd+s → `core.save`. The previous double
  // binding (save + saveAll on the same chord) dead-locked the key.
  { command: 'core.save', keybinding: 'cmd+s', when: 'editorTextFocus' },
  { command: 'kairo.terminal.toggle', keybinding: 'alt+f12' },
  { command: 'kairo.shortcuts.cheatsheet', keybinding: 'cmd+shift+k' },
  { command: 'workbench.action.closeActiveEditor', keybinding: 'cmd+w' },
  { command: 'workbench.action.toggleFullScreen', keybinding: 'ctrl+cmd+f' },
  { command: 'workbench.action.openSettings', keybinding: 'cmd+,' },
  // Find Action (⌘⇧A) is registered as kairo.find.action — do not also bind
  // workbench.action.showCommands to the same chord.
  { command: 'workbench.action.nextEditor', keybinding: 'cmd+shift+]' },
  { command: 'workbench.action.previousEditor', keybinding: 'cmd+shift+[' },
  { command: 'workbench.action.closeOtherEditors', keybinding: 'cmd+shift+w' },

  // Tool Windows
  { command: 'kairo.view.project', keybinding: 'cmd+1' },
  { command: 'kairo.view.servers', keybinding: 'cmd+2' },
  { command: 'kairo.view.deployments', keybinding: 'cmd+3' },
  { command: 'kairo.view.builds', keybinding: 'cmd+4' },
  { command: 'kairo.debug.openView', keybinding: 'cmd+5' },
  { command: 'workbench.actions.view.problems', keybinding: 'cmd+6' },
  { command: 'kairo.view.todo', keybinding: 'cmd+7' },
  { command: 'workbench.view.scm', keybinding: 'cmd+9' },
  { command: 'workbench.action.hideActivePanel', keybinding: 'escape' },

  // ── Bookmarks ───────────────────────────────────────────────
  { command: 'kairo.bookmark.toggle', keybinding: 'f11' },
  { command: 'kairo.bookmark.toggleMnemonic', keybinding: 'cmd+f11' },
  { command: 'kairo.bookmark.show', keybinding: 'shift+f11' },

  // ── Selection / Cursor ──────────────────────────────────────
  { command: 'editor.action.selectAll', keybinding: 'cmd+a' },
  { command: 'cursorTop', keybinding: 'cmd+home', when: 'editorTextFocus' },
  { command: 'cursorBottom', keybinding: 'cmd+end', when: 'editorTextFocus' },
  { command: 'cursorTopSelect', keybinding: 'cmd+shift+home', when: 'editorTextFocus' },
  { command: 'cursorBottomSelect', keybinding: 'cmd+shift+end', when: 'editorTextFocus' },
];

@injectable()
export class KairoIDEAMacKeymapContribution implements CommandContribution, KeybindingContribution {
  registerCommands(_registry: CommandRegistry): void {}

  registerKeybindings(registry: KeybindingRegistry): void {
    if (!isOSX) {
      return;
    }

    for (const binding of IDEA_MAC_KEYBINDINGS) {
      try {
        const keybindingConfig: { command: string; keybinding: string; when?: string } = {
          command: binding.command,
          keybinding: binding.keybinding,
        };
        if (binding.when) {
          keybindingConfig.when = binding.when;
        }
        registry.registerKeybinding(keybindingConfig);
      } catch {
        // skip invalid bindings
      }
    }
  }
}