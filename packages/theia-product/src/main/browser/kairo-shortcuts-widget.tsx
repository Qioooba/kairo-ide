/**
 * Kairo Keyboard Shortcuts Widget.
 *
 * Displays a searchable, categorized reference table of all
 * keyboard shortcuts registered in the Kairo IDE. Categories
 * mirror the keybindings.json structure:
 *
 *  - General (file, window, navigation)
 *  - Editor (code editing, selection, formatting)
 *  - Search & Replace
 *  - Debug
 *  - Git
 *  - Java
 *  - Kairo-specific
 *
 * The widget is accessible via the bottom panel or
 * Ctrl+K Ctrl+S keyboard shortcut.
 */

import React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, Widget } from '@theia/core/lib/browser/widgets';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommandRegistry } from '@theia/core/lib/common';
import { DisposableCollection } from '@theia/core/lib/common/disposable';

/** Factory ID for the shortcuts widget. */
export const KAIRO_SHORTCUTS_FACTORY_ID = 'kairo-shortcuts';

export const KAIRO_SHORTCUTS_WIDGET_ID = 'kairo-shortcuts-widget';

interface ShortcutEntry {
  command: string;
  keybinding: string;
  label: string;
  category: string;
  when?: string;
}

interface ShortcutCategory {
  name: string;
  order: number;
  shortcuts: ShortcutEntry[];
}

/** Category definitions. */
const CATEGORIES: Record<string, { name: string; order: number }> = {
  general: { name: '通用 (General)', order: 1 },
  editor: { name: '编辑器 (Editor)', order: 2 },
  search: { name: '搜索与替换 (Search)', order: 3 },
  navigate: { name: '导航 (Navigation)', order: 4 },
  debug: { name: '调试 (Debug)', order: 5 },
  git: { name: 'Git', order: 6 },
  java: { name: 'Java', order: 7 },
  kairo: { name: 'Kairo IDE', order: 8 },
  terminal: { name: '终端 (Terminal)', order: 9 },
  view: { name: '视图 (View)', order: 10 },
};

/** Command-to-category mapping. */
function getCategoryForCommand(commandId: string): string {
  if (commandId.startsWith('workbench.action.debug')) return 'debug';
  if (commandId.startsWith('editor.debug')) return 'debug';
  if (commandId.startsWith('editor.action')) return 'editor';
  if (commandId.startsWith('core.')) return 'general';
  if (commandId.startsWith('actions.')) return 'search';
  if (commandId.startsWith('search.')) return 'search';
  if (commandId.startsWith('git.')) return 'git';
  if (commandId.startsWith('java.')) return 'java';
  if (commandId.startsWith('kairo.')) return 'kairo';
  if (commandId.startsWith('workbench.action.terminal')) return 'terminal';
  if (commandId.startsWith('workbench.action.navigate')) return 'navigate';
  if (commandId.startsWith('workbench.action.')) return 'view';
  if (commandId.startsWith('workspace:')) return 'general';
  if (commandId.startsWith('references-view.')) return 'navigate';
  return 'general';
}

@injectable()
export class KairoShortcutsWidget extends BaseWidget {
  @inject(KeybindingRegistry)
  protected readonly keybindingRegistry!: KeybindingRegistry;

  @inject(CommandRegistry)
  protected readonly commandRegistry!: CommandRegistry;

  protected readonly toDispose = new DisposableCollection();
  protected searchTerm = '';

  constructor() {
    super();
    this.id = KAIRO_SHORTCUTS_WIDGET_ID;
    this.title.label = 'Keyboard Shortcuts';
    this.title.caption = 'Keyboard Shortcuts Reference';
    this.title.closable = true;
    this.title.iconClass = 'fa fa-keyboard-o';
    this.addClass('kairo-shortcuts-widget');
    this.scrollOptions = undefined;
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.update();
  }

  protected override onResize(msg: Widget.ResizeMessage): void {
    super.onResize(msg);
    this.update();
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    // Focus the search input when the widget is activated
    setTimeout(() => {
      const input = this.node.querySelector<HTMLInputElement>('.kairo-shortcuts-search-input');
      input?.focus();
    }, 0);
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */

  protected render(): React.ReactNode {
    const allShortcuts = this.collectShortcuts();
    const filtered = this.searchTerm
      ? allShortcuts.filter(s =>
          s.label.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
          s.keybinding.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
          s.command.toLowerCase().includes(this.searchTerm.toLowerCase()),
        )
      : allShortcuts;

    const categorized = this.categorize(filtered);

    return (
      <div className="kairo-shortcuts-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px' }}>
        {/* Search Bar */}
        <div className="kairo-shortcuts-search" style={{ marginBottom: '12px', flexShrink: 0 }}>
          <input
            className="kairo-shortcuts-search-input theia-input"
            type="text"
            placeholder="搜索快捷键 (按命令名、快捷键或标签搜索)..."
            value={this.searchTerm}
            onChange={(e) => {
              this.searchTerm = (e.target as HTMLInputElement).value;
              this.update();
            }}
            aria-label="搜索快捷键"
            role="searchbox"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid var(--theia-input-border)',
              borderRadius: '4px',
              background: 'var(--theia-input-background)',
              color: 'var(--theia-input-foreground)',
            }}
          />
          <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--theia-descriptionForeground)' }}>
            {filtered.length} 个快捷键
            {this.searchTerm && ` (共 ${allShortcuts.length} 个)`}
          </div>
        </div>

        {/* Shortcuts Table */}
        <div className="kairo-shortcuts-table-container" style={{ flex: 1, overflow: 'auto' }}>
          {categorized.map(category => (
            <div key={category.name} className="kairo-shortcuts-category" style={{ marginBottom: '16px' }}>
              <h3
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  padding: '8px 0',
                  margin: '0 0 8px 0',
                  borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
                  color: 'var(--theia-sideBarTitle-foreground)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--theia-editor-background)',
                  zIndex: 1,
                }}
              >
                {category.name}
                <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: 400, color: 'var(--theia-descriptionForeground)' }}>
                  ({category.shortcuts.length})
                </span>
              </h3>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px',
                }}
                role="grid"
                aria-label={`${category.name} 快捷键`}
              >
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--theia-descriptionForeground)', width: '30%' }}>命令</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--theia-descriptionForeground)', width: '25%' }}>快捷键</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--theia-descriptionForeground)', width: '35%' }}>标签</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--theia-descriptionForeground)', width: '10%' }}>条件</th>
                  </tr>
                </thead>
                <tbody>
                  {category.shortcuts.map((shortcut, idx) => (
                    <tr
                      key={`${shortcut.command}-${idx}`}
                      style={{
                        borderBottom: '1px solid var(--theia-tree-indentGuidesStroke)',
                      }}
                      role="row"
                    >
                      <td style={{ padding: '6px 8px', color: 'var(--theia-foreground)' }}>
                        <code style={{ fontSize: '12px', padding: '2px 4px', borderRadius: '3px', background: 'var(--theia-textBlockQuote-background)' }}>
                          {shortcut.command}
                        </code>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <kbd
                          style={{
                            display: 'inline-block',
                            padding: '2px 6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            border: '1px solid var(--theia-button-border)',
                            borderRadius: '3px',
                            background: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            fontFamily: 'monospace',
                          }}
                          aria-label={`快捷键: ${shortcut.keybinding}`}
                        >
                          {shortcut.keybinding}
                        </kbd>
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--theia-foreground)' }}>
                        {shortcut.label}
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', fontStyle: 'italic' }}>
                        {shortcut.when || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {categorized.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--theia-descriptionForeground)' }}>
              {this.searchTerm ? `未找到匹配 "${this.searchTerm}" 的快捷键` : '暂无可用的快捷键'}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Data Collection                                                     */
  /* ------------------------------------------------------------------ */

  /** Collect all registered keyboard shortcuts. */
  protected collectShortcuts(): ShortcutEntry[] {
    const shortcuts: ShortcutEntry[] = [];
    const keybindings = this.keybindingRegistry.getKeybindingsForCommand
      ? this.keybindingRegistry.getKeybindingsForCommand
      : undefined;

    const commands = this.commandRegistry.commands;
    for (const command of commands) {
      const commandId = command.id;
      const label = command.label || commandId;
      const category = getCategoryForCommand(commandId);

      let keybindingStr = '';
      if (typeof keybindings === 'function') {
        const bindings = keybindings.call(this.keybindingRegistry, commandId);
        if (bindings && bindings.length > 0) {
          keybindingStr = bindings.map((b: { keybinding?: string; command?: string }) => this.formatKeybinding(b)).join(', ');
        }
      }

      // Only include shortcuts with keybindings
      if (keybindingStr) {
        shortcuts.push({
          command: commandId,
          keybinding: keybindingStr,
          label,
          category,
        });
      }
    }

    return shortcuts;
  }

  /** Categorize shortcuts into groups. */
  protected categorize(shortcuts: ShortcutEntry[]): ShortcutCategory[] {
    const categoryMap = new Map<string, ShortcutEntry[]>();

    for (const s of shortcuts) {
      const cat = categoryMap.get(s.category) || [];
      cat.push(s);
      categoryMap.set(s.category, cat);
    }

    const categories: ShortcutCategory[] = [];
    for (const [catName, catShortcuts] of categoryMap) {
      const catDef = CATEGORIES[catName] || { name: catName, order: 99 };
      categories.push({
        name: catDef.name,
        order: catDef.order,
        shortcuts: catShortcuts.sort((a, b) => a.label.localeCompare(b.label)),
      });
    }

    return categories.sort((a, b) => a.order - b.order);
  }

  /** Format a keybinding string for display. */
  protected formatKeybinding(keybinding: { keybinding?: string; command?: string } | string): string {
    if (typeof keybinding === 'string') {
      return keybinding
        .replace(/ctrlcmd/g, navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl')
        .replace(/\+/g, '+');
    }
    if (keybinding.keybinding) {
      return keybinding.keybinding
        .replace(/ctrlcmd/g, navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl')
        .replace(/\+/g, '+');
    }
    return String(keybinding);
  }
}