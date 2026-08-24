/**
 * Kairo IDE — IntelliJ IDEA Keymap for Windows
 *
 * Provides complete IDEA-style keyboard shortcuts for Windows/Linux platform.
 * This contribution registers keybindings that match IntelliJ IDEA muscle memory.
 *
 * Per KAIRO_IDE_DELIVERY_MASTER_PLAN:
 *   - Windows/Linux uses Ctrl-based shortcuts
 *   - macOS uses Cmd-based shortcuts (handled separately via isOSX guard)
 *
 * Reference: IntelliJ IDEA Default Keymap (Windows/Linux)
 */

import { injectable } from '@theia/core/shared/inversify';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { isOSX } from '@theia/core/lib/common/os';
import { isKairoBrowser } from './kairo-platform';

interface IDEAKeybinding {
  command: string;
  keybinding: string;
  when?: string;
}

/**
 * Chrome (and Edge) reserve several Ctrl chords so IDEA bindings never
 * reach the page. When running in a browser tab, remap those to Alt-
 * based alternatives. Electron keeps the true IDEA chords.
 *
 * Reserved by Chrome (cannot preventDefault): Ctrl+N/T/W, Ctrl+Shift+N/T, Ctrl+Tab.
 * Note: ctrl+w / ctrl+shift+w are handled explicitly for smartSelect below
 * (TP-P3-9) so they are not listed here — avoids dual remap + binding overlap.
 */
const BROWSER_CHROME_REMAPS: Record<string, string> = {
  'ctrl+n': 'alt+shift+n',            // Find Class (Chrome: new window)
  'ctrl+shift+n': 'alt+shift+f',      // Find File (Chrome: new incognito)
};

const IDEA_WINDOWS_KEYBINDINGS: IDEAKeybinding[] = [
  { command: 'undo', keybinding: 'ctrl+z' },
  { command: 'redo', keybinding: 'ctrl+shift+z' },
  { command: 'editor.action.clipboardCutAction', keybinding: 'ctrl+x', when: 'editorTextFocus' },
  { command: 'editor.action.clipboardCopyAction', keybinding: 'ctrl+c', when: 'editorTextFocus' },
  { command: 'editor.action.clipboardPasteAction', keybinding: 'ctrl+v', when: 'editorTextFocus' },
  { command: 'editor.action.commentLine', keybinding: 'ctrl+/', when: 'editorTextFocus' },
  { command: 'editor.action.blockComment', keybinding: 'ctrl+shift+/', when: 'editorTextFocus' },
  { command: 'editor.action.formatDocument', keybinding: 'ctrl+alt+l', when: 'editorTextFocus' },
  { command: 'kairo.organizeImports', keybinding: 'ctrl+alt+o', when: 'editorTextFocus' },
  { command: 'editor.action.rename', keybinding: 'shift+f6', when: 'editorTextFocus' },
  { command: 'editor.action.deleteLines', keybinding: 'ctrl+y', when: 'editorTextFocus' },
  { command: 'editor.action.copyLinesDownAction', keybinding: 'ctrl+d', when: 'editorTextFocus' },
  // Browser: Chrome steals ctrl+w; use alt+shift+w / ctrl+alt+shift+w (TP-P3-9)
  { command: 'editor.action.smartSelect.expand', keybinding: 'ctrl+w', when: 'editorTextFocus' },
  { command: 'editor.action.smartSelect.shrink', keybinding: 'ctrl+shift+w', when: 'editorTextFocus' },
  { command: 'editor.action.insertLineAfter', keybinding: 'shift+enter', when: 'editorTextFocus' },
  { command: 'editor.action.insertLineBefore', keybinding: 'ctrl+alt+enter', when: 'editorTextFocus' },
  { command: 'editor.action.completeStatement', keybinding: 'ctrl+shift+enter', when: 'editorTextFocus' },
  { command: 'editor.action.quickFix', keybinding: 'alt+enter', when: 'editorTextFocus' },
  { command: 'editor.action.triggerSuggest', keybinding: 'ctrl+space', when: 'editorTextFocus' },
  { command: 'kairo.java.smartCompletion', keybinding: 'ctrl+shift+space', when: 'editorTextFocus' },
  { command: 'editor.action.triggerParameterHints', keybinding: 'ctrl+p', when: 'editorTextFocus' },
  { command: 'editor.action.showHover', keybinding: 'ctrl+q', when: 'editorTextFocus' },
  { command: 'editor.action.marker.next', keybinding: 'f2', when: 'editorFocus' },
  { command: 'editor.action.marker.prev', keybinding: 'shift+f2', when: 'editorFocus' },
  { command: 'editor.fold', keybinding: 'ctrl+-', when: 'editorFocus' },
  { command: 'editor.unfold', keybinding: 'ctrl+=', when: 'editorFocus' },
  { command: 'editor.foldAll', keybinding: 'ctrl+shift+-', when: 'editorFocus' },
  { command: 'editor.unfoldAll', keybinding: 'ctrl+shift+=', when: 'editorFocus' },
  { command: 'editor.action.joinLines', keybinding: 'ctrl+shift+j', when: 'editorTextFocus' },
  { command: 'editor.action.addSelectionToNextFindMatch', keybinding: 'alt+j', when: 'editorTextFocus' },
  // Was ctrl+alt+shift+j — conflicted with liveTemplates.manage (TP-P2-3)
  { command: 'editor.action.selectHighlights', keybinding: 'ctrl+alt+shift+l', when: 'editorTextFocus' },
  { command: 'editor.action.toggleColumnSelection', keybinding: 'alt+shift+insert', when: 'editorFocus' },

  { command: 'kairo.find.class', keybinding: 'ctrl+n' },
  { command: 'kairo.find.file', keybinding: 'ctrl+shift+n' },
  { command: 'kairo.find.symbol', keybinding: 'ctrl+shift+alt+n' },
  { command: 'kairo.find.action', keybinding: 'ctrl+shift+a' },
  { command: 'kairo.navigation.goToLine', keybinding: 'ctrl+g' },
  { command: 'editor.action.revealDefinition', keybinding: 'ctrl+b', when: 'editorTextFocus' },
  { command: 'workbench.action.toggleSidebar', keybinding: 'ctrl+b', when: '!editorTextFocus' },
  { command: 'editor.action.peekDefinition', keybinding: 'ctrl+shift+i', when: 'editorTextFocus' },
  { command: 'editor.action.goToImplementation', keybinding: 'ctrl+alt+b', when: 'editorTextFocus' },
  { command: 'kairo.java.goToTypeDefinition', keybinding: 'ctrl+shift+b', when: 'editorTextFocus && editorLangId == java' },
  { command: 'kairo.java.goToSuperMethod', keybinding: 'ctrl+u', when: 'editorTextFocus && editorLangId == java' },
  { command: 'editor.action.referenceSearch.trigger', keybinding: 'alt+f7', when: 'editorTextFocus && editorLangId != java' },
  { command: 'kairo.java.findUsages', keybinding: 'alt+f7', when: 'editorTextFocus && editorLangId == java' },
  { command: 'kairo.java.showUsages', keybinding: 'ctrl+alt+f7', when: 'editorTextFocus && editorLangId == java' },
  { command: 'kairo.navigation.back', keybinding: 'ctrl+alt+left' },
  { command: 'kairo.navigation.forward', keybinding: 'ctrl+alt+right' },
  { command: 'kairo.navigation.recentFiles', keybinding: 'ctrl+e' },
  { command: 'editor.action.jumpToBracket', keybinding: 'ctrl+shift+m', when: 'editorTextFocus' },
  { command: 'editor.action.revealDefinition', keybinding: 'f4', when: 'editorTextFocus' },
  { command: 'editor.action.typeHierarchy', keybinding: 'ctrl+h', when: 'editorTextFocus' },
  { command: 'kairo.java.callHierarchy.showIncoming', keybinding: 'ctrl+alt+h', when: 'editorTextFocus && editorLangId == java' },
  { command: 'kairo.navigation.fileStructure', keybinding: 'ctrl+f12', when: 'editorTextFocus' },
  // Map unimplemented IDEA aliases to existing recentFiles (TP-P2-2)
  { command: 'kairo.navigation.recentFiles', keybinding: 'ctrl+shift+e' },

  { command: 'kairo.search.center.toggle', keybinding: 'ctrl+shift+f' },
  { command: 'kairo.search.replace', keybinding: 'ctrl+shift+r' },
  { command: 'actions.find', keybinding: 'ctrl+f', when: 'editorFocus' },
  { command: 'editor.action.startFindReplaceAction', keybinding: 'ctrl+r', when: 'editorFocus' },
  { command: 'editor.action.nextMatchFindAction', keybinding: 'f3', when: 'editorFocus' },
  { command: 'editor.action.previousMatchFindAction', keybinding: 'shift+f3', when: 'editorFocus' },

  { command: 'kairo.build', keybinding: 'ctrl+f9' },
  { command: 'kairo.buildAndDeploy', keybinding: 'ctrl+shift+f9' },
  { command: 'kairo.server.update', keybinding: 'ctrl+f10' },
  { command: 'kairo.server.start', keybinding: 'shift+f10' },
  { command: 'kairo.server.debug', keybinding: 'shift+f9' },
  { command: 'kairo.server.stop', keybinding: 'ctrl+f2', when: '!inDebugMode' },
  { command: 'editor.debug.action.toggleBreakpoint', keybinding: 'ctrl+f8', when: 'editorTextFocus' },
  { command: 'editor.debug.action.conditionalBreakpoint', keybinding: 'ctrl+shift+f8', when: 'editorTextFocus' },
  { command: 'workbench.action.debug.stepOver', keybinding: 'f8', when: 'inDebugMode' },
  { command: 'workbench.action.debug.stepInto', keybinding: 'f7', when: 'inDebugMode' },
  { command: 'workbench.action.debug.stepOut', keybinding: 'shift+f8', when: 'inDebugMode' },
  { command: 'workbench.action.debug.continue', keybinding: 'f9', when: 'inDebugMode' },
  { command: 'editor.debug.action.runToCursor', keybinding: 'alt+f9', when: 'inDebugMode' },

  // N-057: do NOT rebind ctrl+s here. Theia already binds ctrl+s →
  // `core.save` (File > Save). Adding a second ctrl+s chord for
  // `core.saveAll` made both menu items claim Ctrl+S and the resolved
  // chord executed NOTHING (silent no-op save). Users who want Save All
  // can use File > Save All; Ctrl+S keeps saving the active editor.
  { command: 'core.save', keybinding: 'ctrl+s', when: 'editorTextFocus' },
  { command: 'kairo.terminal.toggle', keybinding: 'alt+f12' },
  { command: 'kairo.shortcuts.cheatsheet', keybinding: 'ctrl+shift+k' },
  { command: 'workbench.action.closeActiveEditor', keybinding: 'ctrl+f4' },
  { command: 'workbench.action.toggleFullScreen', keybinding: 'ctrl+shift+f12' },
  { command: 'workbench.action.openSettings', keybinding: 'ctrl+alt+s' },
  { command: 'workbench.action.nextEditor', keybinding: 'alt+right' },
  { command: 'workbench.action.previousEditor', keybinding: 'alt+left' },
  { command: 'workbench.action.closeOtherEditors', keybinding: 'ctrl+shift+f4' },

  { command: 'kairo.view.project', keybinding: 'alt+1' },
  { command: 'kairo.view.servers', keybinding: 'alt+2' },
  { command: 'kairo.view.deployments', keybinding: 'alt+3' },
  { command: 'kairo.view.builds', keybinding: 'alt+4' },
  { command: 'kairo.debug.openView', keybinding: 'alt+5' },
  { command: 'workbench.actions.view.problems', keybinding: 'alt+6' },
  { command: 'kairo.view.todo', keybinding: 'alt+7' },
  { command: 'workbench.view.scm', keybinding: 'alt+9' },
  { command: 'workbench.action.hideActivePanel', keybinding: 'shift+escape' },

  { command: 'kairo.bookmark.toggle', keybinding: 'f11' },
  { command: 'kairo.bookmark.toggleMnemonic', keybinding: 'ctrl+f11' },
  { command: 'kairo.bookmark.show', keybinding: 'shift+f11' },

  { command: 'editor.action.generator.generate', keybinding: 'alt+insert', when: 'editorTextFocus' },
  { command: 'editor.action.overrideMethod', keybinding: 'ctrl+o', when: 'editorTextFocus' },
  { command: 'editor.action.implementMethods', keybinding: 'ctrl+i', when: 'editorTextFocus' },
  { command: 'editor.action.surroundWith', keybinding: 'ctrl+alt+t', when: 'editorTextFocus' },
  { command: 'editor.action.unwrap', keybinding: 'ctrl+shift+delete', when: 'editorTextFocus' },
  { command: 'editor.action.hippieCompletion', keybinding: 'alt+/', when: 'editorTextFocus' },
  { command: 'editor.action.hippieCompletionBackward', keybinding: 'alt+shift+/', when: 'editorTextFocus' },
  { command: 'kairo.java.liveTemplates.manage', keybinding: 'ctrl+alt+shift+j', when: 'editorTextFocus' },
  { command: 'editor.action.refactor', keybinding: 'ctrl+shift+alt+t', when: 'editorTextFocus' },
  { command: 'editor.action.extractMethod', keybinding: 'ctrl+alt+m', when: 'editorTextFocus' },
  { command: 'editor.action.extractVariable', keybinding: 'ctrl+alt+v', when: 'editorTextFocus' },
  { command: 'editor.action.extractConstant', keybinding: 'ctrl+alt+c', when: 'editorTextFocus' },
  { command: 'editor.action.extractField', keybinding: 'ctrl+alt+f', when: 'editorTextFocus' },
  { command: 'editor.action.changeSignature', keybinding: 'ctrl+f6', when: 'editorTextFocus' },
  { command: 'core.copy.path', keybinding: 'ctrl+shift+c' },
  { command: 'editor.action.clipboardPasteHistoryAction', keybinding: 'ctrl+shift+v', when: 'editorTextFocus' },

  { command: 'editor.action.selectAll', keybinding: 'ctrl+a' },
  { command: 'cursorTop', keybinding: 'ctrl+home', when: 'editorTextFocus' },
  { command: 'cursorBottom', keybinding: 'ctrl+end', when: 'editorTextFocus' },
  { command: 'cursorTopSelect', keybinding: 'ctrl+shift+home', when: 'editorTextFocus' },
  { command: 'cursorBottomSelect', keybinding: 'ctrl+shift+end', when: 'editorTextFocus' },
];

@injectable()
export class KairoIDEAWindowsKeymapContribution implements CommandContribution, KeybindingContribution {
  registerCommands(_registry: CommandRegistry): void {}

  registerKeybindings(registry: KeybindingRegistry): void {
    if (isOSX) {
      return;
    }

    const inBrowser = isKairoBrowser();

    for (const binding of IDEA_WINDOWS_KEYBINDINGS) {
      try {
        let chord = binding.keybinding;
        if (inBrowser) {
          if (binding.command === 'editor.action.smartSelect.expand') {
            chord = 'alt+shift+w';
          } else if (binding.command === 'editor.action.smartSelect.shrink') {
            chord = 'ctrl+alt+shift+w';
          } else if (BROWSER_CHROME_REMAPS[chord]) {
            chord = BROWSER_CHROME_REMAPS[chord];
          }
        }
        const keybindingConfig: { command: string; keybinding: string; when?: string } = {
          command: binding.command,
          keybinding: chord,
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
