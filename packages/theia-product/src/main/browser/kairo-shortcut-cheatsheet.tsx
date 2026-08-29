import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { isOSX } from '@theia/core/lib/common/os';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

import { KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID } from './kairo-factory-ids';
import './kairo-shortcut-cheatsheet.css';

type CheatsheetCategoryKey =
  | 'widget.cheatsheet.category.editing'
  | 'widget.cheatsheet.category.navigation'
  | 'widget.cheatsheet.category.searchReplace'
  | 'widget.cheatsheet.category.buildRunDebug'
  | 'widget.cheatsheet.category.refactoring'
  | 'widget.cheatsheet.category.generalIde'
  | 'widget.cheatsheet.category.toolWindows'
  | 'widget.cheatsheet.category.bookmarks'
  | 'widget.cheatsheet.category.codeFolding'
  | 'widget.cheatsheet.category.multipleCursors';

type CheatsheetActionKey =
  | 'widget.cheatsheet.action.undo'
  | 'widget.cheatsheet.action.redo'
  | 'widget.cheatsheet.action.cut'
  | 'widget.cheatsheet.action.copy'
  | 'widget.cheatsheet.action.paste'
  | 'widget.cheatsheet.action.lineComment'
  | 'widget.cheatsheet.action.blockComment'
  | 'widget.cheatsheet.action.formatCode'
  | 'widget.cheatsheet.action.optimizeImports'
  | 'widget.cheatsheet.action.rename'
  | 'widget.cheatsheet.action.duplicateLine'
  | 'widget.cheatsheet.action.deleteLine'
  | 'widget.cheatsheet.action.moveLineUp'
  | 'widget.cheatsheet.action.moveLineDown'
  | 'widget.cheatsheet.action.expandSelection'
  | 'widget.cheatsheet.action.shrinkSelection'
  | 'widget.cheatsheet.action.quickFix'
  | 'widget.cheatsheet.action.insertLineBelow'
  | 'widget.cheatsheet.action.insertLineAbove'
  | 'widget.cheatsheet.action.completeStatement'
  | 'widget.cheatsheet.action.parameterInfo'
  | 'widget.cheatsheet.action.codeCompletion'
  | 'widget.cheatsheet.action.smartCompletion'
  | 'widget.cheatsheet.action.hippieCompletion'
  | 'widget.cheatsheet.action.hippieCompletionBackward'
  | 'widget.cheatsheet.action.quickDocumentation'
  | 'widget.cheatsheet.action.joinLines'
  | 'widget.cheatsheet.action.toggleCase'
  | 'widget.cheatsheet.action.nextError'
  | 'widget.cheatsheet.action.previousError'
  | 'widget.cheatsheet.action.searchEverywhere'
  | 'widget.cheatsheet.action.goToClass'
  | 'widget.cheatsheet.action.goToFile'
  | 'widget.cheatsheet.action.goToSymbol'
  | 'widget.cheatsheet.action.findAction'
  | 'widget.cheatsheet.action.goToLine'
  | 'widget.cheatsheet.action.fileStructure'
  | 'widget.cheatsheet.action.quickDefinition'
  | 'widget.cheatsheet.action.goToDefinition'
  | 'widget.cheatsheet.action.goToImplementation'
  | 'widget.cheatsheet.action.goToTypeDefinition'
  | 'widget.cheatsheet.action.goToSuperMethod'
  | 'widget.cheatsheet.action.findUsages'
  | 'widget.cheatsheet.action.callHierarchy'
  | 'widget.cheatsheet.action.typeHierarchy'
  | 'widget.cheatsheet.action.recentFiles'
  | 'widget.cheatsheet.action.recentLocations'
  | 'widget.cheatsheet.action.lastEditLocation'
  | 'widget.cheatsheet.action.navigateBack'
  | 'widget.cheatsheet.action.navigateForward'
  | 'widget.cheatsheet.action.closeActiveTab'
  | 'widget.cheatsheet.action.jumpToBracket'
  | 'widget.cheatsheet.action.findInPath'
  | 'widget.cheatsheet.action.replaceInPath'
  | 'widget.cheatsheet.action.findInFile'
  | 'widget.cheatsheet.action.replaceInFile'
  | 'widget.cheatsheet.action.findNext'
  | 'widget.cheatsheet.action.findPrevious'
  | 'widget.cheatsheet.action.buildProject'
  | 'widget.cheatsheet.action.buildAndDeploy'
  | 'widget.cheatsheet.action.run'
  | 'widget.cheatsheet.action.debug'
  | 'widget.cheatsheet.action.stop'
  | 'widget.cheatsheet.action.toggleBreakpoint'
  | 'widget.cheatsheet.action.conditionalBreakpoint'
  | 'widget.cheatsheet.action.stepOver'
  | 'widget.cheatsheet.action.stepInto'
  | 'widget.cheatsheet.action.stepOut'
  | 'widget.cheatsheet.action.resumeProgram'
  | 'widget.cheatsheet.action.runToCursor'
  | 'widget.cheatsheet.action.evaluateExpression'
  | 'widget.cheatsheet.action.rerunRestart'
  | 'widget.cheatsheet.action.generateCode'
  | 'widget.cheatsheet.action.overrideMethod'
  | 'widget.cheatsheet.action.implementMethods'
  | 'widget.cheatsheet.action.surroundWith'
  | 'widget.cheatsheet.action.unwrap'
  | 'widget.cheatsheet.action.manageLiveTemplates'
  | 'widget.cheatsheet.action.refactorThis'
  | 'widget.cheatsheet.action.extractMethod'
  | 'widget.cheatsheet.action.extractVariable'
  | 'widget.cheatsheet.action.extractConstant'
  | 'widget.cheatsheet.action.extractField'
  | 'widget.cheatsheet.action.changeSignature'
  | 'widget.cheatsheet.action.saveAll'
  | 'widget.cheatsheet.action.settings'
  | 'widget.cheatsheet.action.terminal'
  | 'widget.cheatsheet.action.toggleFullScreen'
  | 'widget.cheatsheet.action.keyboardShortcuts'
  | 'widget.cheatsheet.action.nextEditor'
  | 'widget.cheatsheet.action.previousEditor'
  | 'widget.cheatsheet.action.hideActivePanel'
  | 'widget.cheatsheet.action.copyPath'
  | 'widget.cheatsheet.action.pasteFromHistory'
  | 'widget.cheatsheet.action.splitEditor'
  | 'widget.cheatsheet.action.project'
  | 'widget.cheatsheet.action.servers'
  | 'widget.cheatsheet.action.deployments'
  | 'widget.cheatsheet.action.builds'
  | 'widget.cheatsheet.action.problems'
  | 'widget.cheatsheet.action.todo'
  | 'widget.cheatsheet.action.git'
  | 'widget.cheatsheet.action.toggleBookmark'
  | 'widget.cheatsheet.action.toggleBookmarkMnemonic'
  | 'widget.cheatsheet.action.showBookmarks'
  | 'widget.cheatsheet.action.collapse'
  | 'widget.cheatsheet.action.expand'
  | 'widget.cheatsheet.action.collapseAll'
  | 'widget.cheatsheet.action.expandAll'
  | 'widget.cheatsheet.action.addCursorAbove'
  | 'widget.cheatsheet.action.addCursorBelow'
  | 'widget.cheatsheet.action.selectNextOccurrence'
  | 'widget.cheatsheet.action.columnSelectionMode';

export namespace KairoCheatsheetCommands {
  export const TOGGLE: Command = {
    id: 'kairo.shortcuts.cheatsheet',
    label: 'Kairo: Keyboard Shortcuts Cheat Sheet',
    category: 'Kairo',
  };
}

interface ShortcutRow {
  action: CheatsheetActionKey;
  idea: string;
  kairo: string;
}

interface ShortcutCategory {
  nameKey: CheatsheetCategoryKey;
  icon: string;
  shortcuts: ShortcutRow[];
}

const IDEA_KEYBINDINGS_MAC: ShortcutCategory[] = [
  {
    nameKey: 'widget.cheatsheet.category.editing',
    icon: 'codicon-edit',
    shortcuts: [
      { action: 'widget.cheatsheet.action.undo', idea: '⌘Z', kairo: '⌘Z' },
      { action: 'widget.cheatsheet.action.redo', idea: '⌘⇧Z', kairo: '⌘⇧Z' },
      { action: 'widget.cheatsheet.action.cut', idea: '⌘X', kairo: '⌘X' },
      { action: 'widget.cheatsheet.action.copy', idea: '⌘C', kairo: '⌘C' },
      { action: 'widget.cheatsheet.action.paste', idea: '⌘V', kairo: '⌘V' },
      { action: 'widget.cheatsheet.action.lineComment', idea: '⌘/', kairo: '⌘/' },
      { action: 'widget.cheatsheet.action.blockComment', idea: '⌘⌥/', kairo: '⌘⌥/' },
      { action: 'widget.cheatsheet.action.formatCode', idea: '⌘⌥L', kairo: '⌘⌥L' },
      { action: 'widget.cheatsheet.action.optimizeImports', idea: '⌃⌥O', kairo: '⌃⌥O' },
      { action: 'widget.cheatsheet.action.rename', idea: '⇧F6', kairo: '⇧F6' },
      { action: 'widget.cheatsheet.action.duplicateLine', idea: '⌘D', kairo: '⌘D' },
      { action: 'widget.cheatsheet.action.deleteLine', idea: '⌘⌫', kairo: '⌘⌫' },
      { action: 'widget.cheatsheet.action.moveLineUp', idea: '⇧⌥↑', kairo: '⇧⌥↑' },
      { action: 'widget.cheatsheet.action.moveLineDown', idea: '⇧⌥↓', kairo: '⇧⌥↓' },
      { action: 'widget.cheatsheet.action.expandSelection', idea: '⌥↑', kairo: '⌥↑' },
      { action: 'widget.cheatsheet.action.shrinkSelection', idea: '⌥↓', kairo: '⌥↓' },
      { action: 'widget.cheatsheet.action.quickFix', idea: '⌥↵', kairo: '⌥↵' },
      { action: 'widget.cheatsheet.action.insertLineBelow', idea: '⇧↵', kairo: '⇧↵' },
      { action: 'widget.cheatsheet.action.insertLineAbove', idea: '⌘⌥↵', kairo: '⌘⌥↵' },
      { action: 'widget.cheatsheet.action.completeStatement', idea: '⇧⌘↵', kairo: '⇧⌘↵' },
      { action: 'widget.cheatsheet.action.parameterInfo', idea: '⌘P', kairo: '⌘P' },
      { action: 'widget.cheatsheet.action.codeCompletion', idea: '⌃Space', kairo: '⌃Space' },
      { action: 'widget.cheatsheet.action.smartCompletion', idea: '⌃⇧Space', kairo: '⌃⇧Space' },
      { action: 'widget.cheatsheet.action.hippieCompletion', idea: '⌥/', kairo: '⌥/' },
      { action: 'widget.cheatsheet.action.hippieCompletionBackward', idea: '⌥⇧/', kairo: '⌥⇧/' },
      { action: 'widget.cheatsheet.action.quickDocumentation', idea: '⌃J', kairo: '⌃J' },
      { action: 'widget.cheatsheet.action.joinLines', idea: '⌃⇧J', kairo: '⌃⇧J' },
      { action: 'widget.cheatsheet.action.toggleCase', idea: '⌘⇧U', kairo: '⌘⇧U' },
      { action: 'widget.cheatsheet.action.nextError', idea: 'F2', kairo: 'F2' },
      { action: 'widget.cheatsheet.action.previousError', idea: '⇧F2', kairo: '⇧F2' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.navigation',
    icon: 'codicon-compass',
    shortcuts: [
      { action: 'widget.cheatsheet.action.searchEverywhere', idea: 'Double ⇧', kairo: 'Double ⇧' },
      { action: 'widget.cheatsheet.action.goToClass', idea: '⌘O', kairo: '⌘O' },
      { action: 'widget.cheatsheet.action.goToFile', idea: '⌘⇧O', kairo: '⌘⇧O' },
      { action: 'widget.cheatsheet.action.goToSymbol', idea: '⌘⌥O', kairo: '⌘⌥O' },
      { action: 'widget.cheatsheet.action.findAction', idea: '⌘⇧A', kairo: '⌘⇧A' },
      { action: 'widget.cheatsheet.action.goToLine', idea: '⌘L', kairo: '⌘L' },
      { action: 'widget.cheatsheet.action.fileStructure', idea: '⌘F12', kairo: '⌘F12' },
      { action: 'widget.cheatsheet.action.quickDefinition', idea: '⌘⇧I', kairo: '⌘⇧I' },
      { action: 'widget.cheatsheet.action.goToDefinition', idea: '⌘B', kairo: '⌘B' },
      { action: 'widget.cheatsheet.action.goToImplementation', idea: '⌘⌥B', kairo: '⌘⌥B' },
      { action: 'widget.cheatsheet.action.goToTypeDefinition', idea: '⌘⇧B', kairo: '⌘⇧B' },
      { action: 'widget.cheatsheet.action.goToSuperMethod', idea: '⌘U', kairo: '⌘U' },
      { action: 'widget.cheatsheet.action.findUsages', idea: '⌥F7', kairo: '⌥F7' },
      { action: 'widget.cheatsheet.action.callHierarchy', idea: '⌃⌥H', kairo: '⌃⌥H' },
      { action: 'widget.cheatsheet.action.recentFiles', idea: '⌘E', kairo: '⌘E' },
      { action: 'widget.cheatsheet.action.recentLocations', idea: '⌘⇧E', kairo: '⌘⇧E' },
      { action: 'widget.cheatsheet.action.navigateBack', idea: '⌘[', kairo: '⌘[' },
      { action: 'widget.cheatsheet.action.navigateForward', idea: '⌘]', kairo: '⌘]' },
      { action: 'widget.cheatsheet.action.closeActiveTab', idea: '⌘W', kairo: '⌘W' },
      { action: 'widget.cheatsheet.action.jumpToBracket', idea: '⌃⇧M', kairo: '⌃⇧M' },
      { action: 'widget.cheatsheet.action.typeHierarchy', idea: '⌃H', kairo: '⌃H' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.searchReplace',
    icon: 'codicon-search',
    shortcuts: [
      { action: 'widget.cheatsheet.action.findInPath', idea: '⌘⇧F', kairo: '⌘⇧F' },
      { action: 'widget.cheatsheet.action.replaceInPath', idea: '⌘⇧R', kairo: '⌘⇧R' },
      { action: 'widget.cheatsheet.action.findInFile', idea: '⌘F', kairo: '⌘F' },
      { action: 'widget.cheatsheet.action.replaceInFile', idea: '⌘R', kairo: '⌘R' },
      { action: 'widget.cheatsheet.action.findNext', idea: '⌘G', kairo: '⌘G' },
      { action: 'widget.cheatsheet.action.findPrevious', idea: '⌘⇧G', kairo: '⌘⇧G' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.buildRunDebug',
    icon: 'codicon-play',
    shortcuts: [
      { action: 'widget.cheatsheet.action.buildProject', idea: '⌘F9', kairo: '⌘F9' },
      { action: 'widget.cheatsheet.action.buildAndDeploy', idea: '⌘⇧F9', kairo: '⌘⇧F9' },
      { action: 'widget.cheatsheet.action.run', idea: '⌃⇧R', kairo: '⌃⇧R' },
      { action: 'widget.cheatsheet.action.debug', idea: '⌃⇧D', kairo: '⌃⇧D' },
      { action: 'widget.cheatsheet.action.stop', idea: '⌘F2', kairo: '⌘F2' },
      { action: 'widget.cheatsheet.action.toggleBreakpoint', idea: '⌘F8', kairo: '⌘F8' },
      { action: 'widget.cheatsheet.action.conditionalBreakpoint', idea: '⌘⇧F8', kairo: '⌘⇧F8' },
      { action: 'widget.cheatsheet.action.stepOver', idea: 'F8', kairo: 'F8' },
      { action: 'widget.cheatsheet.action.stepInto', idea: 'F7', kairo: 'F7' },
      { action: 'widget.cheatsheet.action.stepOut', idea: '⇧F8', kairo: '⇧F8' },
      { action: 'widget.cheatsheet.action.resumeProgram', idea: '⌘⌥R', kairo: '⌘⌥R' },
      { action: 'widget.cheatsheet.action.runToCursor', idea: '⌥F9', kairo: '⌥F9' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.refactoring',
    icon: 'codicon-wand',
    shortcuts: [
      { action: 'widget.cheatsheet.action.generateCode', idea: '⌘N', kairo: '⌘N' },
      { action: 'widget.cheatsheet.action.overrideMethod', idea: '⌃O', kairo: '⌃O' },
      { action: 'widget.cheatsheet.action.implementMethods', idea: '⌃I', kairo: '⌃I' },
      { action: 'widget.cheatsheet.action.surroundWith', idea: '⌘⌥T', kairo: '⌘⌥T' },
      { action: 'widget.cheatsheet.action.unwrap', idea: '⌘⇧⌫', kairo: '⌘⇧⌫' },
      { action: 'widget.cheatsheet.action.manageLiveTemplates', idea: '⌘⌥J', kairo: '⌘⌥J' },
      { action: 'widget.cheatsheet.action.refactorThis', idea: '⌃T', kairo: '⌃T' },
      { action: 'widget.cheatsheet.action.extractMethod', idea: '⌘⌥M', kairo: '⌘⌥M' },
      { action: 'widget.cheatsheet.action.extractVariable', idea: '⌘⌥V', kairo: '⌘⌥V' },
      { action: 'widget.cheatsheet.action.extractConstant', idea: '⌘⌥C', kairo: '⌘⌥C' },
      { action: 'widget.cheatsheet.action.changeSignature', idea: '⌘F6', kairo: '⌘F6' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.generalIde',
    icon: 'codicon-settings-gear',
    shortcuts: [
      { action: 'widget.cheatsheet.action.saveAll', idea: '⌘S', kairo: '⌘S' },
      { action: 'widget.cheatsheet.action.settings', idea: '⌘,', kairo: '⌘,' },
      { action: 'widget.cheatsheet.action.terminal', idea: '⌥F12', kairo: '⌥F12' },
      { action: 'widget.cheatsheet.action.keyboardShortcuts', idea: '⌘⇧K', kairo: '⌘⇧K' },
      { action: 'widget.cheatsheet.action.toggleFullScreen', idea: '⌃⌘F', kairo: '⌃⌘F' },
      { action: 'widget.cheatsheet.action.nextEditor', idea: '⌘⇧]', kairo: '⌘⇧]' },
      { action: 'widget.cheatsheet.action.previousEditor', idea: '⌘⇧[', kairo: '⌘⇧[' },
      { action: 'widget.cheatsheet.action.hideActivePanel', idea: 'Esc', kairo: 'Esc' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.toolWindows',
    icon: 'codicon-layout',
    shortcuts: [
      { action: 'widget.cheatsheet.action.project', idea: '⌘1', kairo: '⌘1' },
      { action: 'widget.cheatsheet.action.servers', idea: '⌘2 (Bookmarks in IDEA)', kairo: '⌘2' },
      { action: 'widget.cheatsheet.action.deployments', idea: '⌘3 (Find in IDEA)', kairo: '⌘3' },
      { action: 'widget.cheatsheet.action.builds', idea: '⌘4 (Run in IDEA)', kairo: '⌘4' },
      { action: 'widget.cheatsheet.action.debug', idea: '⌘5', kairo: '⌘5' },
      { action: 'widget.cheatsheet.action.problems', idea: '⌘6', kairo: '⌘6' },
      { action: 'widget.cheatsheet.action.todo', idea: '⌘7 (Structure in IDEA)', kairo: '⌘7' },
      { action: 'widget.cheatsheet.action.git', idea: '⌘9', kairo: '⌘9' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.bookmarks',
    icon: 'codicon-bookmark',
    shortcuts: [
      { action: 'widget.cheatsheet.action.toggleBookmark', idea: 'F11', kairo: 'F11' },
      { action: 'widget.cheatsheet.action.toggleBookmarkMnemonic', idea: '⌘F11', kairo: '⌘F11' },
      { action: 'widget.cheatsheet.action.showBookmarks', idea: '⇧F11', kairo: '⇧F11' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.codeFolding',
    icon: 'codicon-folding',
    shortcuts: [
      { action: 'widget.cheatsheet.action.collapse', idea: '⌘-', kairo: '⌘-' },
      { action: 'widget.cheatsheet.action.expand', idea: '⌘=', kairo: '⌘=' },
      { action: 'widget.cheatsheet.action.collapseAll', idea: '⌘⇧-', kairo: '⌘⇧-' },
      { action: 'widget.cheatsheet.action.expandAll', idea: '⌘⇧=', kairo: '⌘⇧=' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.multipleCursors',
    icon: 'codicon-multiple-windows',
    shortcuts: [
      { action: 'widget.cheatsheet.action.addCursorAbove', idea: '⌃G', kairo: '⌃G' },
      { action: 'widget.cheatsheet.action.addCursorBelow', idea: '⌃⇧G', kairo: '⌃⇧G' },
      { action: 'widget.cheatsheet.action.selectNextOccurrence', idea: '⌥J', kairo: '⌥J' },
      { action: 'widget.cheatsheet.action.columnSelectionMode', idea: '⌘⇧8', kairo: '⌘⇧8' },
    ],
  },
];

const IDEA_KEYBINDINGS_WIN: ShortcutCategory[] = [
  {
    nameKey: 'widget.cheatsheet.category.editing',
    icon: 'codicon-edit',
    shortcuts: [
      { action: 'widget.cheatsheet.action.undo', idea: 'Ctrl+Z', kairo: 'Ctrl+Z' },
      { action: 'widget.cheatsheet.action.redo', idea: 'Ctrl+Shift+Z', kairo: 'Ctrl+Shift+Z' },
      { action: 'widget.cheatsheet.action.cut', idea: 'Ctrl+X', kairo: 'Ctrl+X' },
      { action: 'widget.cheatsheet.action.copy', idea: 'Ctrl+C', kairo: 'Ctrl+C' },
      { action: 'widget.cheatsheet.action.paste', idea: 'Ctrl+V', kairo: 'Ctrl+V' },
      { action: 'widget.cheatsheet.action.lineComment', idea: 'Ctrl+/', kairo: 'Ctrl+/' },
      { action: 'widget.cheatsheet.action.blockComment', idea: 'Ctrl+Shift+/', kairo: 'Ctrl+Shift+/' },
      { action: 'widget.cheatsheet.action.formatCode', idea: 'Ctrl+Alt+L', kairo: 'Ctrl+Alt+L' },
      { action: 'widget.cheatsheet.action.optimizeImports', idea: 'Ctrl+Alt+O', kairo: 'Ctrl+Alt+O' },
      { action: 'widget.cheatsheet.action.rename', idea: 'Shift+F6', kairo: 'Shift+F6' },
      { action: 'widget.cheatsheet.action.duplicateLine', idea: 'Ctrl+D', kairo: 'Ctrl+D' },
      { action: 'widget.cheatsheet.action.deleteLine', idea: 'Ctrl+Y', kairo: 'Ctrl+Y' },
      { action: 'widget.cheatsheet.action.moveLineUp', idea: 'Shift+Alt+Up', kairo: 'Shift+Alt+Up' },
      { action: 'widget.cheatsheet.action.moveLineDown', idea: 'Shift+Alt+Down', kairo: 'Shift+Alt+Down' },
      { action: 'widget.cheatsheet.action.expandSelection', idea: 'Ctrl+W', kairo: 'Ctrl+W' },
      { action: 'widget.cheatsheet.action.shrinkSelection', idea: 'Ctrl+Shift+W', kairo: 'Ctrl+Shift+W' },
      { action: 'widget.cheatsheet.action.quickFix', idea: 'Alt+Enter', kairo: 'Alt+Enter' },
      { action: 'widget.cheatsheet.action.insertLineBelow', idea: 'Shift+Enter', kairo: 'Shift+Enter' },
      { action: 'widget.cheatsheet.action.insertLineAbove', idea: 'Ctrl+Alt+Enter', kairo: 'Ctrl+Alt+Enter' },
      { action: 'widget.cheatsheet.action.completeStatement', idea: 'Ctrl+Shift+Enter', kairo: 'Ctrl+Shift+Enter' },
      { action: 'widget.cheatsheet.action.parameterInfo', idea: 'Ctrl+P', kairo: 'Ctrl+P' },
      { action: 'widget.cheatsheet.action.codeCompletion', idea: 'Ctrl+Space', kairo: 'Ctrl+Space' },
      { action: 'widget.cheatsheet.action.smartCompletion', idea: 'Ctrl+Shift+Space', kairo: 'Ctrl+Shift+Space' },
      { action: 'widget.cheatsheet.action.hippieCompletion', idea: 'Alt+/', kairo: 'Alt+/' },
      { action: 'widget.cheatsheet.action.hippieCompletionBackward', idea: 'Alt+Shift+/', kairo: 'Alt+Shift+/' },
      { action: 'widget.cheatsheet.action.quickDocumentation', idea: 'Ctrl+Q', kairo: 'Ctrl+Q' },
      { action: 'widget.cheatsheet.action.joinLines', idea: 'Ctrl+Shift+J', kairo: 'Ctrl+Shift+J' },
      { action: 'widget.cheatsheet.action.toggleCase', idea: 'Ctrl+Shift+U', kairo: 'Ctrl+Shift+U' },
      { action: 'widget.cheatsheet.action.nextError', idea: 'F2', kairo: 'F2' },
      { action: 'widget.cheatsheet.action.previousError', idea: 'Shift+F2', kairo: 'Shift+F2' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.navigation',
    icon: 'codicon-compass',
    shortcuts: [
      { action: 'widget.cheatsheet.action.searchEverywhere', idea: 'Double Shift', kairo: 'Double Shift' },
      { action: 'widget.cheatsheet.action.goToClass', idea: 'Ctrl+N', kairo: 'Ctrl+N' },
      { action: 'widget.cheatsheet.action.goToFile', idea: 'Ctrl+Shift+N', kairo: 'Ctrl+Shift+N' },
      { action: 'widget.cheatsheet.action.goToSymbol', idea: 'Ctrl+Shift+Alt+N', kairo: 'Ctrl+Shift+Alt+N' },
      { action: 'widget.cheatsheet.action.findAction', idea: 'Ctrl+Shift+A', kairo: 'Ctrl+Shift+A' },
      { action: 'widget.cheatsheet.action.goToLine', idea: 'Ctrl+G', kairo: 'Ctrl+G' },
      { action: 'widget.cheatsheet.action.fileStructure', idea: 'Ctrl+F12', kairo: 'Ctrl+F12' },
      { action: 'widget.cheatsheet.action.quickDefinition', idea: 'Ctrl+Shift+I', kairo: 'Ctrl+Shift+I' },
      { action: 'widget.cheatsheet.action.goToDefinition', idea: 'Ctrl+B', kairo: 'Ctrl+B' },
      { action: 'widget.cheatsheet.action.goToImplementation', idea: 'Ctrl+Alt+B', kairo: 'Ctrl+Alt+B' },
      { action: 'widget.cheatsheet.action.goToTypeDefinition', idea: 'Ctrl+Shift+B', kairo: 'Ctrl+Shift+B' },
      { action: 'widget.cheatsheet.action.goToSuperMethod', idea: 'Ctrl+U', kairo: 'Ctrl+U' },
      { action: 'widget.cheatsheet.action.findUsages', idea: 'Alt+F7', kairo: 'Alt+F7' },
      { action: 'widget.cheatsheet.action.callHierarchy', idea: 'Ctrl+Alt+H', kairo: 'Ctrl+Alt+H' },
      { action: 'widget.cheatsheet.action.typeHierarchy', idea: 'Ctrl+H', kairo: 'Ctrl+H' },
      { action: 'widget.cheatsheet.action.recentFiles', idea: 'Ctrl+E', kairo: 'Ctrl+E' },
      { action: 'widget.cheatsheet.action.recentLocations', idea: 'Ctrl+Shift+E', kairo: 'Ctrl+Shift+E' },
      { action: 'widget.cheatsheet.action.lastEditLocation', idea: 'Ctrl+Shift+Backspace', kairo: 'Ctrl+Shift+Backspace' },
      { action: 'widget.cheatsheet.action.navigateBack', idea: 'Ctrl+Alt+Left', kairo: 'Ctrl+Alt+Left' },
      { action: 'widget.cheatsheet.action.navigateForward', idea: 'Ctrl+Alt+Right', kairo: 'Ctrl+Alt+Right' },
      { action: 'widget.cheatsheet.action.closeActiveTab', idea: 'Ctrl+F4', kairo: 'Ctrl+F4' },
      { action: 'widget.cheatsheet.action.jumpToBracket', idea: 'Ctrl+Shift+M', kairo: 'Ctrl+Shift+M' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.searchReplace',
    icon: 'codicon-search',
    shortcuts: [
      { action: 'widget.cheatsheet.action.findInPath', idea: 'Ctrl+Shift+F', kairo: 'Ctrl+Shift+F' },
      { action: 'widget.cheatsheet.action.replaceInPath', idea: 'Ctrl+Shift+R', kairo: 'Ctrl+Shift+R' },
      { action: 'widget.cheatsheet.action.findInFile', idea: 'Ctrl+F', kairo: 'Ctrl+F' },
      { action: 'widget.cheatsheet.action.replaceInFile', idea: 'Ctrl+R', kairo: 'Ctrl+R' },
      { action: 'widget.cheatsheet.action.findNext', idea: 'F3', kairo: 'F3' },
      { action: 'widget.cheatsheet.action.findPrevious', idea: 'Shift+F3', kairo: 'Shift+F3' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.buildRunDebug',
    icon: 'codicon-play',
    shortcuts: [
      { action: 'widget.cheatsheet.action.buildProject', idea: 'Ctrl+F9', kairo: 'Ctrl+F9' },
      { action: 'widget.cheatsheet.action.buildAndDeploy', idea: 'Ctrl+Shift+F9', kairo: 'Ctrl+Shift+F9' },
      { action: 'widget.cheatsheet.action.run', idea: 'Shift+F10', kairo: 'Shift+F10' },
      { action: 'widget.cheatsheet.action.debug', idea: 'Shift+F9', kairo: 'Shift+F9' },
      { action: 'widget.cheatsheet.action.stop', idea: 'Ctrl+F2', kairo: 'Ctrl+F2' },
      { action: 'widget.cheatsheet.action.toggleBreakpoint', idea: 'Ctrl+F8', kairo: 'Ctrl+F8' },
      { action: 'widget.cheatsheet.action.conditionalBreakpoint', idea: 'Ctrl+Shift+F8', kairo: 'Ctrl+Shift+F8' },
      { action: 'widget.cheatsheet.action.stepOver', idea: 'F8', kairo: 'F8' },
      { action: 'widget.cheatsheet.action.stepInto', idea: 'F7', kairo: 'F7' },
      { action: 'widget.cheatsheet.action.stepOut', idea: 'Shift+F8', kairo: 'Shift+F8' },
      { action: 'widget.cheatsheet.action.resumeProgram', idea: 'F9', kairo: 'F9' },
      { action: 'widget.cheatsheet.action.runToCursor', idea: 'Alt+F9', kairo: 'Alt+F9' },
      { action: 'widget.cheatsheet.action.evaluateExpression', idea: 'Alt+F8', kairo: 'Alt+F8' },
      { action: 'widget.cheatsheet.action.rerunRestart', idea: 'Ctrl+F5', kairo: 'Ctrl+F5' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.refactoring',
    icon: 'codicon-wand',
    shortcuts: [
      { action: 'widget.cheatsheet.action.generateCode', idea: 'Alt+Insert', kairo: 'Alt+Insert' },
      { action: 'widget.cheatsheet.action.overrideMethod', idea: 'Ctrl+O', kairo: 'Ctrl+O' },
      { action: 'widget.cheatsheet.action.implementMethods', idea: 'Ctrl+I', kairo: 'Ctrl+I' },
      { action: 'widget.cheatsheet.action.surroundWith', idea: 'Ctrl+Alt+T', kairo: 'Ctrl+Alt+T' },
      { action: 'widget.cheatsheet.action.unwrap', idea: 'Ctrl+Shift+Delete', kairo: 'Ctrl+Shift+Delete' },
      { action: 'widget.cheatsheet.action.manageLiveTemplates', idea: 'Ctrl+Alt+Shift+J', kairo: 'Ctrl+Alt+Shift+J' },
      { action: 'widget.cheatsheet.action.refactorThis', idea: 'Ctrl+Shift+Alt+T', kairo: 'Ctrl+Shift+Alt+T' },
      { action: 'widget.cheatsheet.action.extractMethod', idea: 'Ctrl+Alt+M', kairo: 'Ctrl+Alt+M' },
      { action: 'widget.cheatsheet.action.extractVariable', idea: 'Ctrl+Alt+V', kairo: 'Ctrl+Alt+V' },
      { action: 'widget.cheatsheet.action.extractConstant', idea: 'Ctrl+Alt+C', kairo: 'Ctrl+Alt+C' },
      { action: 'widget.cheatsheet.action.extractField', idea: 'Ctrl+Alt+F', kairo: 'Ctrl+Alt+F' },
      { action: 'widget.cheatsheet.action.changeSignature', idea: 'Ctrl+F6', kairo: 'Ctrl+F6' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.generalIde',
    icon: 'codicon-settings-gear',
    shortcuts: [
      { action: 'widget.cheatsheet.action.saveAll', idea: 'Ctrl+S', kairo: 'Ctrl+S' },
      { action: 'widget.cheatsheet.action.settings', idea: 'Ctrl+Alt+S', kairo: 'Ctrl+Alt+S' },
      { action: 'widget.cheatsheet.action.terminal', idea: 'Alt+F12', kairo: 'Alt+F12' },
      { action: 'widget.cheatsheet.action.toggleFullScreen', idea: 'Ctrl+Shift+F12', kairo: 'Ctrl+Shift+F12' },
      { action: 'widget.cheatsheet.action.copyPath', idea: 'Ctrl+Shift+C', kairo: 'Ctrl+Shift+C' },
      { action: 'widget.cheatsheet.action.pasteFromHistory', idea: 'Ctrl+Shift+V', kairo: 'Ctrl+Shift+V' },
      { action: 'widget.cheatsheet.action.hideActivePanel', idea: 'Shift+Esc', kairo: 'Shift+Esc' },
      { action: 'widget.cheatsheet.action.splitEditor', idea: 'Ctrl+Shift+\\', kairo: 'Ctrl+Shift+\\' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.toolWindows',
    icon: 'codicon-layout',
    shortcuts: [
      { action: 'widget.cheatsheet.action.project', idea: 'Alt+1', kairo: 'Alt+1' },
      { action: 'widget.cheatsheet.action.servers', idea: 'Alt+2 (Bookmarks in IDEA)', kairo: 'Alt+2' },
      { action: 'widget.cheatsheet.action.deployments', idea: 'Alt+3 (Find in IDEA)', kairo: 'Alt+3' },
      { action: 'widget.cheatsheet.action.builds', idea: 'Alt+4 (Run in IDEA)', kairo: 'Alt+4' },
      { action: 'widget.cheatsheet.action.debug', idea: 'Alt+5', kairo: 'Alt+5' },
      { action: 'widget.cheatsheet.action.problems', idea: 'Alt+6', kairo: 'Alt+6' },
      { action: 'widget.cheatsheet.action.todo', idea: 'Alt+7 (Structure in IDEA)', kairo: 'Alt+7' },
      { action: 'widget.cheatsheet.action.git', idea: 'Alt+9', kairo: 'Alt+9' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.bookmarks',
    icon: 'codicon-bookmark',
    shortcuts: [
      { action: 'widget.cheatsheet.action.toggleBookmark', idea: 'F11', kairo: 'F11' },
      { action: 'widget.cheatsheet.action.toggleBookmarkMnemonic', idea: 'Ctrl+F11', kairo: 'Ctrl+F11' },
      { action: 'widget.cheatsheet.action.showBookmarks', idea: 'Shift+F11', kairo: 'Shift+F11' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.codeFolding',
    icon: 'codicon-folding',
    shortcuts: [
      { action: 'widget.cheatsheet.action.collapse', idea: 'Ctrl+-', kairo: 'Ctrl+-' },
      { action: 'widget.cheatsheet.action.expand', idea: 'Ctrl+=', kairo: 'Ctrl+=' },
      { action: 'widget.cheatsheet.action.collapseAll', idea: 'Ctrl+Shift+-', kairo: 'Ctrl+Shift+-' },
      { action: 'widget.cheatsheet.action.expandAll', idea: 'Ctrl+Shift+=', kairo: 'Ctrl+Shift+=' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.multipleCursors',
    icon: 'codicon-multiple-windows',
    shortcuts: [
      { action: 'widget.cheatsheet.action.addCursorAbove', idea: 'Ctrl+Alt+Up', kairo: 'Ctrl+Alt+Up' },
      { action: 'widget.cheatsheet.action.addCursorBelow', idea: 'Ctrl+Alt+Down', kairo: 'Ctrl+Alt+Down' },
      { action: 'widget.cheatsheet.action.selectNextOccurrence', idea: 'Alt+J', kairo: 'Alt+J' },
      { action: 'widget.cheatsheet.action.columnSelectionMode', idea: 'Alt+Shift+Insert', kairo: 'Alt+Shift+Insert' },
    ],
  },
];

function getShortcutData(): ShortcutCategory[] {
  return isOSX ? IDEA_KEYBINDINGS_MAC : IDEA_KEYBINDINGS_WIN;
}

function getToggleShortcut(): string {
  return isOSX ? '⌘⇧K' : 'Ctrl+Shift+K';
}

function getCloseKey(): string {
  return isOSX ? 'Esc' : 'Esc';
}

function renderKbd(keys: string, comingSoonLabel: string): React.ReactNode {
  if (keys === '\u2014' || keys === 'Coming soon') {
    return <span className="kairo-cheatsheet-key kairo-cheatsheet-key-na">{keys === 'Coming soon' ? comingSoonLabel : keys}</span>;
  }
  const noteMatch = keys.match(/^(.+?)\s*(\([^)]+\))$/);
  const mainPart = noteMatch ? noteMatch[1] : keys;
  const note = noteMatch ? noteMatch[2] : null;

  const chords = mainPart.split(/\s+/).filter(Boolean);

  return (
    <span className="kairo-cheatsheet-key-group">
      {chords.map((chord, ci) => (
        <React.Fragment key={ci}>
          {ci > 0 && <span style={{ margin: '0 2px', opacity: 0.4 }}>&nbsp;</span>}
          {chord.split(/\s*\+\s*/).map((part, i) => {
            let displayPart = part;
            if (part === '⌘') displayPart = '⌘';
            else if (part === '⇧') displayPart = '⇧';
            else if (part === '⌥') displayPart = '⌥';
            else if (part === '⌃') displayPart = '⌃';
            else if (part === '↵') displayPart = '↵';
            else if (part === '⌫') displayPart = '⌫';
            return (
              <React.Fragment key={i}>
                {i > 0 && <span className="kairo-cheatsheet-key-sep">+</span>}
                <kbd className="kairo-cheatsheet-key">{displayPart}</kbd>
              </React.Fragment>
            );
          })}
        </React.Fragment>
      ))}
      {note && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.6 }}>{note}</span>}
    </span>
  );
}

function highlightText(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="kairo-cheatsheet-highlight">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
  );
}

const CheatsheetContent: React.FC<{
  i18n: KairoI18nService;
  searchTerm: string;
  onSearchChange: (term: string) => void;
}> = ({ i18n, searchTerm, onSearchChange }) => {
  const t = React.useCallback(
    (key: KairoI18nKey, params?: Record<string, string | number>) => i18n.t(key, params),
    [i18n],
  );
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const term = searchTerm.trim().toLowerCase();
  const data = getShortcutData().map(category => ({
    ...category,
    shortcuts: category.shortcuts.map(row => ({ ...row, action: t(row.action) })),
  }));
  const isMac = isOSX;
  const comingSoonLabel = t('widget.cheatsheet.comingSoon');

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  const filteredCategories = React.useMemo(() => {
    if (!term) return data;
    return data
      .map(cat => ({
        ...cat,
        shortcuts: cat.shortcuts.filter(
          s => s.action.toLowerCase().includes(term)
            || s.idea.toLowerCase().includes(term)
            || s.kairo.toLowerCase().includes(term),
        ),
      }))
      .filter(cat => cat.shortcuts.length > 0);
  }, [term, data]);

  const totalShortcuts = data.reduce((sum, c) => sum + c.shortcuts.length, 0);
  const visibleCount = filteredCategories.reduce((sum, c) => sum + c.shortcuts.length, 0);

  React.useEffect(() => {
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const showTwoColumns = isMac;

  return (
    <div className="kairo-cheatsheet-content">
      <div className="kairo-cheatsheet-search">
        <i className="codicon codicon-search" style={{ marginRight: 8, opacity: 0.6 }} />
        <input
          ref={searchInputRef}
          className="kairo-cheatsheet-search-input"
          type="search"
          placeholder={isMac ? t('widget.cheatsheet.searchPlaceholder') : t('widget.cheatsheet.searchPlaceholderLong')}
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          aria-label={t('widget.cheatsheet.searchAria')}
        />
        {searchTerm && (
          <button
            className="kairo-cheatsheet-clear"
            onClick={() => {
              onSearchChange('');
              searchInputRef.current?.focus();
            }}
            aria-label={t('widget.cheatsheet.clearSearchAria')}
          >
            <i className="codicon codicon-close" />
          </button>
        )}
        <span className="kairo-cheatsheet-count-inline">{visibleCount} / {totalShortcuts}</span>
      </div>

      {!isMac && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--theia-textBlockQuote-background, rgba(127,127,127,0.1))',
          borderLeft: '3px solid var(--theia-button-background, #0e639c)',
          fontSize: 12,
          color: 'var(--theia-descriptionForeground)',
          marginBottom: 8,
        }}>
          <i className="codicon codicon-info" style={{ marginRight: 6 }} />
          {t('widget.cheatsheet.infoBannerWin')}
        </div>
      )}

      <div className="kairo-cheatsheet-body">
        {filteredCategories.length === 0 ? (
          <div className="kairo-cheatsheet-empty">
            <i className="codicon codicon-search" style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }} />
            <div>{t('widget.cheatsheet.emptyNoMatch', { term: searchTerm })}</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              {t('widget.cheatsheet.emptyHint')}
            </div>
          </div>
        ) : (
          filteredCategories.map(category => (
            <div key={category.nameKey} className="kairo-cheatsheet-category">
              <div className="kairo-cheatsheet-category-header">
                <i className={`codicon ${category.icon}`} style={{ marginRight: 6 }} />
                {t(category.nameKey)}
                <span className="kairo-cheatsheet-category-count">({category.shortcuts.length})</span>
              </div>
              <table className="kairo-cheatsheet-table">
                <thead>
                  <tr>
                    <th className="kairo-cheatsheet-col-action">{t('widget.cheatsheet.colAction')}</th>
                    {showTwoColumns ? (
                      <>
                        <th className="kairo-cheatsheet-col-idea">
                          <i className="codicon codicon-symbol-namespace" style={{ marginRight: 4 }} />
                          {t('widget.cheatsheet.colIdeaShortcut')}
                        </th>
                        <th className="kairo-cheatsheet-col-kairo">
                          <span className="kairo-cheatsheet-kairo-badge">K</span>
                          {t('widget.cheatsheet.colKairoShortcut')}
                        </th>
                      </>
                    ) : (
                      <th className="kairo-cheatsheet-col-idea" style={{ width: '50%' }}>
                        <i className="codicon codicon-keyboard" style={{ marginRight: 4 }} />
                        {t('widget.cheatsheet.colIdeaShortcutWin')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {category.shortcuts.map((row, idx) => (
                    <tr key={`${category.nameKey}-${idx}`}>
                      <td className="kairo-cheatsheet-col-action">
                        {highlightText(row.action, term)}
                      </td>
                      {showTwoColumns ? (
                        <>
                          <td className="kairo-cheatsheet-col-idea">
                            {renderKbd(row.idea, comingSoonLabel)}
                          </td>
                          <td className="kairo-cheatsheet-col-kairo">
                            {renderKbd(row.kairo, comingSoonLabel)}
                          </td>
                        </>
                      ) : (
                        <td className="kairo-cheatsheet-col-idea">
                          {renderKbd(row.idea, comingSoonLabel)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      <div className="kairo-cheatsheet-footer">
        <span>
          {t('widget.cheatsheet.footerCloseBefore')}{' '}
          <kbd className="kairo-cheatsheet-key kairo-cheatsheet-key-sm">{getCloseKey()}</kbd>{' '}
          {t('widget.cheatsheet.footerCloseAfter')}
          &nbsp;&bull;&nbsp;
          {renderKbd(getToggleShortcut(), comingSoonLabel)}{' '}
          {t('widget.cheatsheet.footerToggleAfter')}
        </span>
      </div>
    </div>
  );
};

export class KairoShortcutCheatsheetDialog extends ReactDialog<void> {
  protected searchTerm = '';
  protected readonly dialogDisposables = new DisposableCollection();

  constructor(protected readonly i18n: KairoI18nService) {
    super({
      title: i18n.t(isOSX ? 'widget.cheatsheet.titleMac' : 'widget.cheatsheet.titleWin'),
      maxWidth: isOSX ? 900 : 960,
    } as DialogProps);
    this.addClass('kairo-cheatsheet-dialog');
    this.id = KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID;
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
    this.dialogDisposables.push(
      i18n.onDidChangeLanguage(() => {
        (this as unknown as { title: string }).title =
          i18n.t(isOSX ? 'widget.cheatsheet.titleMac' : 'widget.cheatsheet.titleWin');
        this.update();
      }),
    );
  }

  override dispose(): void {
    this.dialogDisposables.dispose();
    super.dispose();
  }

  protected render(): React.ReactNode {
    return (
      <CheatsheetContent
        i18n={this.i18n}
        searchTerm={this.searchTerm}
        onSearchChange={term => {
          this.searchTerm = term;
          this.update();
        }}
      />
    );
  }

  get value(): undefined {
    return undefined;
  }
}

@injectable()
export class KairoShortcutCheatsheetContribution implements CommandContribution, KeybindingContribution {

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected dialog: KairoShortcutCheatsheetDialog | null = null;
  protected commandRegistry: CommandRegistry | undefined;

  @postConstruct()
  protected init(): void {
    this.i18n.onDidChangeLanguage(() => this.refreshCommandLabel());
  }

  protected refreshCommandLabel(): void {
    const cmd = this.commandRegistry?.getCommand(KairoCheatsheetCommands.TOGGLE.id);
    if (cmd) {
      cmd.label = this.i18n.t('widget.cheatsheet.commandLabel');
    }
  }

  registerCommands(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    registry.registerCommand(
      { ...KairoCheatsheetCommands.TOGGLE, label: this.i18n.t('widget.cheatsheet.commandLabel') },
      {
        execute: () => this.toggle(),
      },
    );
    this.refreshCommandLabel();
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: KairoCheatsheetCommands.TOGGLE.id,
      keybinding: isOSX ? 'cmd+shift+k' : 'ctrl+shift+k',
    });
  }

  protected toggle(): void {
    if (this.dialog && this.dialog.isAttached) {
      this.dialog.close();
    } else {
      this.open();
    }
  }

  protected open(): void {
    this.dialog = new KairoShortcutCheatsheetDialog(this.i18n);
    this.dialog.open();
  }
}
