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

export namespace KairoCheatsheetCommands {
  export const TOGGLE: Command = {
    id: 'kairo.shortcuts.cheatsheet',
    label: 'Kairo: Keyboard Shortcuts Cheat Sheet',
    category: 'Kairo',
  };
}

interface ShortcutRow {
  action: string;
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
      { action: 'Undo', idea: '⌘Z', kairo: '⌘Z' },
      { action: 'Redo', idea: '⌘⇧Z', kairo: '⌘⇧Z' },
      { action: 'Cut', idea: '⌘X', kairo: '⌘X' },
      { action: 'Copy', idea: '⌘C', kairo: '⌘C' },
      { action: 'Paste', idea: '⌘V', kairo: '⌘V' },
      { action: 'Comment with Line Comment', idea: '⌘/', kairo: '⌘/' },
      { action: 'Comment with Block Comment', idea: '⌘⌥/', kairo: '⌘⌥/' },
      { action: 'Format Code', idea: '⌘⌥L', kairo: '⌘⌥L' },
      { action: 'Organize Imports', idea: '⌃⌥O', kairo: '⌃⌥O' },
      { action: 'Rename', idea: '⇧F6', kairo: '⇧F6' },
      { action: 'Duplicate Line', idea: '⌘D', kairo: '⌘D' },
      { action: 'Delete Line', idea: '⌘⌫', kairo: '⌘⌫' },
      { action: 'Move Line Up', idea: '⇧⌥↑', kairo: '⇧⌥↑' },
      { action: 'Move Line Down', idea: '⇧⌥↓', kairo: '⇧⌥↓' },
      { action: 'Extend Selection', idea: '⌥↑', kairo: '⌥↑' },
      { action: 'Shrink Selection', idea: '⌥↓', kairo: '⌥↓' },
      { action: 'Quick Fix', idea: '⌥↵', kairo: '⌥↵' },
      { action: 'Insert Line Below', idea: '⇧↵', kairo: '⇧↵' },
      { action: 'Insert Line Above', idea: '⌘⌥↵', kairo: '⌘⌥↵' },
      { action: 'Complete Statement', idea: '⇧⌘↵', kairo: '⇧⌘↵' },
      { action: 'Parameter Info', idea: '⌘P', kairo: '⌘P' },
      { action: 'Code Completion', idea: '⌃Space', kairo: '⌃Space' },
      { action: 'Smart Completion', idea: '⌃⇧Space', kairo: '⌃⇧Space' },
      { action: 'Hippie Completion', idea: '⌥/', kairo: '⌥/' },
      { action: 'Hippie Completion Backward', idea: '⌥⇧/', kairo: '⌥⇧/' },
      { action: 'Quick Documentation', idea: '⌃J', kairo: '⌃J' },
      { action: 'Join Lines', idea: '⌃⇧J', kairo: '⌃⇧J' },
      { action: 'Toggle Case', idea: '⌘⇧U', kairo: '⌘⇧U' },
      { action: 'Next Error', idea: 'F2', kairo: 'F2' },
      { action: 'Previous Error', idea: '⇧F2', kairo: '⇧F2' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.navigation',
    icon: 'codicon-compass',
    shortcuts: [
      { action: 'Search Everywhere', idea: 'Double ⇧', kairo: 'Double ⇧' },
      { action: 'Go to Class', idea: '⌘O', kairo: '⌘O' },
      { action: 'Go to File', idea: '⌘⇧O', kairo: '⌘⇧O' },
      { action: 'Go to Symbol', idea: '⌘⌥O', kairo: '⌘⌥O' },
      { action: 'Find Action', idea: '⌘⇧A', kairo: '⌘⇧A' },
      { action: 'Go to Line', idea: '⌘L', kairo: '⌘L' },
      { action: 'File Structure', idea: '⌘F12', kairo: '⌘F12' },
      { action: 'Quick Definition', idea: '⌘⇧I', kairo: '⌘⇧I' },
      { action: 'Go to Definition', idea: '⌘B', kairo: '⌘B' },
      { action: 'Go to Implementation', idea: '⌘⌥B', kairo: '⌘⌥B' },
      { action: 'Go to Type Definition', idea: '⌘⇧B', kairo: '⌘⇧B' },
      { action: 'Go to Super Method', idea: '⌘U', kairo: '⌘U' },
      { action: 'Find Usages', idea: '⌥F7', kairo: '⌥F7' },
      { action: 'Call Hierarchy', idea: '⌃⌥H', kairo: '⌃⌥H' },
      { action: 'Recent Files', idea: '⌘E', kairo: '⌘E' },
      { action: 'Recent Locations', idea: '⌘⇧E', kairo: '⌘⇧E' },
      { action: 'Navigate Back', idea: '⌘[', kairo: '⌘[' },
      { action: 'Navigate Forward', idea: '⌘]', kairo: '⌘]' },
      { action: 'Close Active Tab', idea: '⌘W', kairo: '⌘W' },
      { action: 'Jump to Bracket', idea: '⌃⇧M', kairo: '⌃⇧M' },
      { action: 'Type Hierarchy', idea: '⌃H', kairo: '⌃H' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.searchReplace',
    icon: 'codicon-search',
    shortcuts: [
      { action: 'Find in Path', idea: '⌘⇧F', kairo: '⌘⇧F' },
      { action: 'Replace in Path', idea: '⌘⇧R', kairo: '⌘⇧R' },
      { action: 'Find in File', idea: '⌘F', kairo: '⌘F' },
      { action: 'Replace in File', idea: '⌘R', kairo: '⌘R' },
      { action: 'Find Next', idea: '⌘G', kairo: '⌘G' },
      { action: 'Find Previous', idea: '⌘⇧G', kairo: '⌘⇧G' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.buildRunDebug',
    icon: 'codicon-play',
    shortcuts: [
      { action: 'Build Project', idea: '⌘F9', kairo: '⌘F9' },
      { action: 'Build & Deploy', idea: '⌘⇧F9', kairo: '⌘⇧F9' },
      { action: 'Run', idea: '⌃⇧R', kairo: '⌃⇧R' },
      { action: 'Debug', idea: '⌃⇧D', kairo: '⌃⇧D' },
      { action: 'Stop', idea: '⌘F2', kairo: '⌘F2' },
      { action: 'Toggle Breakpoint', idea: '⌘F8', kairo: '⌘F8' },
      { action: 'Conditional Breakpoint', idea: '⌘⇧F8', kairo: '⌘⇧F8' },
      { action: 'Step Over', idea: 'F8', kairo: 'F8' },
      { action: 'Step Into', idea: 'F7', kairo: 'F7' },
      { action: 'Step Out', idea: '⇧F8', kairo: '⇧F8' },
      { action: 'Resume Program', idea: '⌘⌥R', kairo: '⌘⌥R' },
      { action: 'Run to Cursor', idea: '⌥F9', kairo: '⌥F9' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.refactoring',
    icon: 'codicon-wand',
    shortcuts: [
      { action: 'Generate Code', idea: '⌘N', kairo: '⌘N' },
      { action: 'Override Method', idea: '⌃O', kairo: '⌃O' },
      { action: 'Implement Methods', idea: '⌃I', kairo: '⌃I' },
      { action: 'Surround With', idea: '⌘⌥T', kairo: '⌘⌥T' },
      { action: 'Unwrap', idea: '⌘⇧⌫', kairo: '⌘⇧⌫' },
      { action: 'Manage Live Templates', idea: '⌘⌥J', kairo: '⌘⌥J' },
      { action: 'Refactor This', idea: '⌃T', kairo: '⌃T' },
      { action: 'Extract Method', idea: '⌘⌥M', kairo: '⌘⌥M' },
      { action: 'Extract Variable', idea: '⌘⌥V', kairo: '⌘⌥V' },
      { action: 'Extract Constant', idea: '⌘⌥C', kairo: '⌘⌥C' },
      { action: 'Change Signature', idea: '⌘F6', kairo: '⌘F6' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.generalIde',
    icon: 'codicon-settings-gear',
    shortcuts: [
      { action: 'Save All', idea: '⌘S', kairo: '⌘S' },
      { action: 'Settings', idea: '⌘,', kairo: '⌘,' },
      { action: 'Terminal', idea: '⌥F12', kairo: '⌥F12' },
      { action: 'Keyboard Shortcuts', idea: '⌘⇧K', kairo: '⌘⇧K' },
      { action: 'Toggle Full Screen', idea: '⌃⌘F', kairo: '⌃⌘F' },
      { action: 'Next Editor', idea: '⌘⇧]', kairo: '⌘⇧]' },
      { action: 'Previous Editor', idea: '⌘⇧[', kairo: '⌘⇧[' },
      { action: 'Hide Active Panel', idea: 'Esc', kairo: 'Esc' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.toolWindows',
    icon: 'codicon-layout',
    shortcuts: [
      { action: 'Project', idea: '⌘1', kairo: '⌘1' },
      { action: 'Servers (Kairo)', idea: '⌘2 (Bookmarks in IDEA)', kairo: '⌘2' },
      { action: 'Deployments (Kairo)', idea: '⌘3 (Find in IDEA)', kairo: '⌘3' },
      { action: 'Builds (Kairo)', idea: '⌘4 (Run in IDEA)', kairo: '⌘4' },
      { action: 'Debug', idea: '⌘5', kairo: '⌘5' },
      { action: 'Problems', idea: '⌘6', kairo: '⌘6' },
      { action: 'TODO (Kairo)', idea: '⌘7 (Structure in IDEA)', kairo: '⌘7' },
      { action: 'Git', idea: '⌘9', kairo: '⌘9' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.bookmarks',
    icon: 'codicon-bookmark',
    shortcuts: [
      { action: 'Toggle Bookmark', idea: 'F11', kairo: 'F11' },
      { action: 'Toggle Bookmark (Mnemonic)', idea: '⌘F11', kairo: '⌘F11' },
      { action: 'Show Bookmarks', idea: '⇧F11', kairo: '⇧F11' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.codeFolding',
    icon: 'codicon-folding',
    shortcuts: [
      { action: 'Collapse', idea: '⌘-', kairo: '⌘-' },
      { action: 'Expand', idea: '⌘=', kairo: '⌘=' },
      { action: 'Collapse All', idea: '⌘⇧-', kairo: '⌘⇧-' },
      { action: 'Expand All', idea: '⌘⇧=', kairo: '⌘⇧=' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.multipleCursors',
    icon: 'codicon-multiple-windows',
    shortcuts: [
      { action: 'Add Cursor Above', idea: '⌃G', kairo: '⌃G' },
      { action: 'Add Cursor Below', idea: '⌃⇧G', kairo: '⌃⇧G' },
      { action: 'Select Next Occurrence', idea: '⌥J', kairo: '⌥J' },
      { action: 'Column Selection Mode', idea: '⌘⇧8', kairo: '⌘⇧8' },
    ],
  },
];

const IDEA_KEYBINDINGS_WIN: ShortcutCategory[] = [
  {
    nameKey: 'widget.cheatsheet.category.editing',
    icon: 'codicon-edit',
    shortcuts: [
      { action: 'Undo (撤销)', idea: 'Ctrl+Z', kairo: 'Ctrl+Z' },
      { action: 'Redo (重做)', idea: 'Ctrl+Shift+Z', kairo: 'Ctrl+Shift+Z' },
      { action: 'Cut (剪切)', idea: 'Ctrl+X', kairo: 'Ctrl+X' },
      { action: 'Copy (复制)', idea: 'Ctrl+C', kairo: 'Ctrl+C' },
      { action: 'Paste (粘贴)', idea: 'Ctrl+V', kairo: 'Ctrl+V' },
      { action: 'Line Comment (行注释)', idea: 'Ctrl+/', kairo: 'Ctrl+/' },
      { action: 'Block Comment (块注释)', idea: 'Ctrl+Shift+/', kairo: 'Ctrl+Shift+/' },
      { action: 'Format Code (格式化代码)', idea: 'Ctrl+Alt+L', kairo: 'Ctrl+Alt+L' },
      { action: 'Optimize Imports (优化导入)', idea: 'Ctrl+Alt+O', kairo: 'Ctrl+Alt+O' },
      { action: 'Rename (重命名)', idea: 'Shift+F6', kairo: 'Shift+F6' },
      { action: 'Duplicate Line (复制行)', idea: 'Ctrl+D', kairo: 'Ctrl+D' },
      { action: 'Delete Line (删除行)', idea: 'Ctrl+Y', kairo: 'Ctrl+Y' },
      { action: 'Move Line Up (上移行)', idea: 'Shift+Alt+Up', kairo: 'Shift+Alt+Up' },
      { action: 'Move Line Down (下移行)', idea: 'Shift+Alt+Down', kairo: 'Shift+Alt+Down' },
      { action: 'Expand Selection (扩展选择)', idea: 'Ctrl+W', kairo: 'Ctrl+W' },
      { action: 'Shrink Selection (收缩选择)', idea: 'Ctrl+Shift+W', kairo: 'Ctrl+Shift+W' },
      { action: 'Quick Fix (快速修复)', idea: 'Alt+Enter', kairo: 'Alt+Enter' },
      { action: 'Insert Line Below (下方插入行)', idea: 'Shift+Enter', kairo: 'Shift+Enter' },
      { action: 'Insert Line Above (上方插入行)', idea: 'Ctrl+Alt+Enter', kairo: 'Ctrl+Alt+Enter' },
      { action: 'Complete Statement (补全语句)', idea: 'Ctrl+Shift+Enter', kairo: 'Ctrl+Shift+Enter' },
      { action: 'Parameter Info (参数信息)', idea: 'Ctrl+P', kairo: 'Ctrl+P' },
      { action: 'Code Completion (代码补全)', idea: 'Ctrl+Space', kairo: 'Ctrl+Space' },
      { action: 'Smart Completion (智能补全)', idea: 'Ctrl+Shift+Space', kairo: 'Ctrl+Shift+Space' },
      { action: 'Hippie Completion (循环补全)', idea: 'Alt+/', kairo: 'Alt+/' },
      { action: 'Hippie Completion Backward (反向循环)', idea: 'Alt+Shift+/', kairo: 'Alt+Shift+/' },
      { action: 'Quick Documentation (快速文档)', idea: 'Ctrl+Q', kairo: 'Ctrl+Q' },
      { action: 'Join Lines (合并行)', idea: 'Ctrl+Shift+J', kairo: 'Ctrl+Shift+J' },
      { action: 'Toggle Case (切换大小写)', idea: 'Ctrl+Shift+U', kairo: 'Ctrl+Shift+U' },
      { action: 'Next Error (下一个错误)', idea: 'F2', kairo: 'F2' },
      { action: 'Previous Error (上一个错误)', idea: 'Shift+F2', kairo: 'Shift+F2' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.navigation',
    icon: 'codicon-compass',
    shortcuts: [
      { action: 'Search Everywhere (全局搜索)', idea: 'Double Shift', kairo: 'Double Shift' },
      { action: 'Go to Class (查找类)', idea: 'Ctrl+N', kairo: 'Ctrl+N' },
      { action: 'Go to File (查找文件)', idea: 'Ctrl+Shift+N', kairo: 'Ctrl+Shift+N' },
      { action: 'Go to Symbol (查找符号)', idea: 'Ctrl+Shift+Alt+N', kairo: 'Ctrl+Shift+Alt+N' },
      { action: 'Find Action (查找操作)', idea: 'Ctrl+Shift+A', kairo: 'Ctrl+Shift+A' },
      { action: 'Go to Line (跳转到行)', idea: 'Ctrl+G', kairo: 'Ctrl+G' },
      { action: 'File Structure (文件结构)', idea: 'Ctrl+F12', kairo: 'Ctrl+F12' },
      { action: 'Quick Definition (快速定义)', idea: 'Ctrl+Shift+I', kairo: 'Ctrl+Shift+I' },
      { action: 'Go to Definition (跳转到定义)', idea: 'Ctrl+B', kairo: 'Ctrl+B' },
      { action: 'Go to Implementation (跳转到实现)', idea: 'Ctrl+Alt+B', kairo: 'Ctrl+Alt+B' },
      { action: 'Go to Type Definition (跳转到类型定义)', idea: 'Ctrl+Shift+B', kairo: 'Ctrl+Shift+B' },
      { action: 'Go to Super Method (跳转到父类方法)', idea: 'Ctrl+U', kairo: 'Ctrl+U' },
      { action: 'Find Usages (查找用法)', idea: 'Alt+F7', kairo: 'Alt+F7' },
      { action: 'Call Hierarchy (调用层次)', idea: 'Ctrl+Alt+H', kairo: 'Ctrl+Alt+H' },
      { action: 'Type Hierarchy (类型层次)', idea: 'Ctrl+H', kairo: 'Ctrl+H' },
      { action: 'Recent Files (最近文件)', idea: 'Ctrl+E', kairo: 'Ctrl+E' },
      { action: 'Recent Locations (最近位置)', idea: 'Ctrl+Shift+E', kairo: 'Ctrl+Shift+E' },
      { action: 'Last Edit Location (上次编辑位置)', idea: 'Ctrl+Shift+Backspace', kairo: 'Ctrl+Shift+Backspace' },
      { action: 'Navigate Back (后退)', idea: 'Ctrl+Alt+Left', kairo: 'Ctrl+Alt+Left' },
      { action: 'Navigate Forward (前进)', idea: 'Ctrl+Alt+Right', kairo: 'Ctrl+Alt+Right' },
      { action: 'Close Active Tab (关闭当前标签)', idea: 'Ctrl+F4', kairo: 'Ctrl+F4' },
      { action: 'Jump to Bracket (跳转到括号)', idea: 'Ctrl+Shift+M', kairo: 'Ctrl+Shift+M' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.searchReplace',
    icon: 'codicon-search',
    shortcuts: [
      { action: 'Find in Path (全局查找)', idea: 'Ctrl+Shift+F', kairo: 'Ctrl+Shift+F' },
      { action: 'Replace in Path (全局替换)', idea: 'Ctrl+Shift+R', kairo: 'Ctrl+Shift+R' },
      { action: 'Find (查找)', idea: 'Ctrl+F', kairo: 'Ctrl+F' },
      { action: 'Replace (替换)', idea: 'Ctrl+R', kairo: 'Ctrl+R' },
      { action: 'Find Next (下一个)', idea: 'F3', kairo: 'F3' },
      { action: 'Find Previous (上一个)', idea: 'Shift+F3', kairo: 'Shift+F3' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.buildRunDebug',
    icon: 'codicon-play',
    shortcuts: [
      { action: 'Build Project (构建项目)', idea: 'Ctrl+F9', kairo: 'Ctrl+F9' },
      { action: 'Build & Deploy (构建并部署)', idea: 'Ctrl+Shift+F9', kairo: 'Ctrl+Shift+F9' },
      { action: 'Run (运行)', idea: 'Shift+F10', kairo: 'Shift+F10' },
      { action: 'Debug (调试)', idea: 'Shift+F9', kairo: 'Shift+F9' },
      { action: 'Stop (停止)', idea: 'Ctrl+F2', kairo: 'Ctrl+F2' },
      { action: 'Toggle Breakpoint (切换断点)', idea: 'Ctrl+F8', kairo: 'Ctrl+F8' },
      { action: 'View / Conditional Breakpoint (查看/条件断点)', idea: 'Ctrl+Shift+F8', kairo: 'Ctrl+Shift+F8' },
      { action: 'Step Over (单步跳过)', idea: 'F8', kairo: 'F8' },
      { action: 'Step Into (单步进入)', idea: 'F7', kairo: 'F7' },
      { action: 'Step Out (单步跳出)', idea: 'Shift+F8', kairo: 'Shift+F8' },
      { action: 'Resume Program (继续执行)', idea: 'F9', kairo: 'F9' },
      { action: 'Run to Cursor (运行到光标)', idea: 'Alt+F9', kairo: 'Alt+F9' },
      { action: 'Evaluate Expression (求值)', idea: 'Alt+F8', kairo: 'Alt+F8' },
      { action: 'Rerun / Restart (重新运行)', idea: 'Ctrl+F5', kairo: 'Ctrl+F5' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.refactoring',
    icon: 'codicon-wand',
    shortcuts: [
      { action: 'Generate Code (生成代码)', idea: 'Alt+Insert', kairo: 'Alt+Insert' },
      { action: 'Override Method (重写方法)', idea: 'Ctrl+O', kairo: 'Ctrl+O' },
      { action: 'Implement Methods (实现方法)', idea: 'Ctrl+I', kairo: 'Ctrl+I' },
      { action: 'Surround With (包围)', idea: 'Ctrl+Alt+T', kairo: 'Ctrl+Alt+T' },
      { action: 'Unwrap (拆除包围)', idea: 'Ctrl+Shift+Delete', kairo: 'Ctrl+Shift+Delete' },
      { action: 'Manage Live Templates (管理模板)', idea: 'Ctrl+Alt+Shift+J', kairo: 'Ctrl+Alt+Shift+J' },
      { action: 'Refactor This (重构)', idea: 'Ctrl+Shift+Alt+T', kairo: 'Ctrl+Shift+Alt+T' },
      { action: 'Extract Method (提取方法)', idea: 'Ctrl+Alt+M', kairo: 'Ctrl+Alt+M' },
      { action: 'Extract Variable (提取变量)', idea: 'Ctrl+Alt+V', kairo: 'Ctrl+Alt+V' },
      { action: 'Extract Constant (提取常量)', idea: 'Ctrl+Alt+C', kairo: 'Ctrl+Alt+C' },
      { action: 'Extract Field (提取字段)', idea: 'Ctrl+Alt+F', kairo: 'Ctrl+Alt+F' },
      { action: 'Change Signature (修改签名)', idea: 'Ctrl+F6', kairo: 'Ctrl+F6' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.generalIde',
    icon: 'codicon-settings-gear',
    shortcuts: [
      { action: 'Save All (保存全部)', idea: 'Ctrl+S', kairo: 'Ctrl+S' },
      { action: 'Settings (设置)', idea: 'Ctrl+Alt+S', kairo: 'Ctrl+Alt+S' },
      { action: 'Terminal (终端)', idea: 'Alt+F12', kairo: 'Alt+F12' },
      { action: 'Toggle Full Screen (全屏)', idea: 'Ctrl+Shift+F12', kairo: 'Ctrl+Shift+F12' },
      { action: 'Copy Path (复制路径)', idea: 'Ctrl+Shift+C', kairo: 'Ctrl+Shift+C' },
      { action: 'Paste from History (历史粘贴)', idea: 'Ctrl+Shift+V', kairo: 'Ctrl+Shift+V' },
      { action: 'Hide Active Panel (隐藏面板)', idea: 'Shift+Esc', kairo: 'Shift+Esc' },
      { action: 'Split Editor (分屏)', idea: 'Ctrl+Shift+\\', kairo: 'Ctrl+Shift+\\' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.toolWindows',
    icon: 'codicon-layout',
    shortcuts: [
      { action: 'Project (项目)', idea: 'Alt+1', kairo: 'Alt+1' },
      { action: 'Servers (服务器, Kairo)', idea: 'Alt+2 (Bookmarks in IDEA)', kairo: 'Alt+2' },
      { action: 'Deployments (部署, Kairo)', idea: 'Alt+3 (Find in IDEA)', kairo: 'Alt+3' },
      { action: 'Builds (构建, Kairo)', idea: 'Alt+4 (Run in IDEA)', kairo: 'Alt+4' },
      { action: 'Debug (调试)', idea: 'Alt+5', kairo: 'Alt+5' },
      { action: 'Problems (问题)', idea: 'Alt+6', kairo: 'Alt+6' },
      { action: 'TODO (Kairo)', idea: 'Alt+7 (Structure in IDEA)', kairo: 'Alt+7' },
      { action: 'Git / VCS', idea: 'Alt+9', kairo: 'Alt+9' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.bookmarks',
    icon: 'codicon-bookmark',
    shortcuts: [
      { action: 'Toggle Bookmark (切换书签)', idea: 'F11', kairo: 'F11' },
      { action: 'Toggle Bookmark (Mnemonic)', idea: 'Ctrl+F11', kairo: 'Ctrl+F11' },
      { action: 'Show Bookmarks (显示书签)', idea: 'Shift+F11', kairo: 'Shift+F11' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.codeFolding',
    icon: 'codicon-folding',
    shortcuts: [
      { action: 'Collapse (折叠)', idea: 'Ctrl+-', kairo: 'Ctrl+-' },
      { action: 'Expand (展开)', idea: 'Ctrl+=', kairo: 'Ctrl+=' },
      { action: 'Collapse All (全部折叠)', idea: 'Ctrl+Shift+-', kairo: 'Ctrl+Shift+-' },
      { action: 'Expand All (全部展开)', idea: 'Ctrl+Shift+=', kairo: 'Ctrl+Shift+=' },
    ],
  },
  {
    nameKey: 'widget.cheatsheet.category.multipleCursors',
    icon: 'codicon-multiple-windows',
    shortcuts: [
      { action: 'Add Cursor Above (上方添加光标)', idea: 'Ctrl+Alt+Up', kairo: 'Ctrl+Alt+Up' },
      { action: 'Add Cursor Below (下方添加光标)', idea: 'Ctrl+Alt+Down', kairo: 'Ctrl+Alt+Down' },
      { action: 'Select Next Occurrence (选择下一个)', idea: 'Alt+J', kairo: 'Alt+J' },
      { action: 'Column Selection Mode (列选择)', idea: 'Alt+Shift+Insert', kairo: 'Alt+Shift+Insert' },
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
  const data = getShortcutData();
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
