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
import { KairoI18nService } from '@kairo/i18n';

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

/** Category definitions — names are resolved via i18n at render time. */
const CATEGORIES: Record<string, { order: number; i18nKey: string }> = {
  general: { order: 1, i18nKey: 'widget.shortcuts.category.general' },
  editor: { order: 2, i18nKey: 'widget.shortcuts.category.editor' },
  search: { order: 3, i18nKey: 'widget.shortcuts.category.search' },
  navigate: { order: 4, i18nKey: 'widget.shortcuts.category.navigate' },
  debug: { order: 5, i18nKey: 'widget.shortcuts.category.debug' },
  git: { order: 6, i18nKey: 'widget.shortcuts.category.git' },
  java: { order: 7, i18nKey: 'widget.shortcuts.category.java' },
  kairo: { order: 8, i18nKey: 'widget.shortcuts.category.kairo' },
  terminal: { order: 9, i18nKey: 'widget.shortcuts.category.terminal' },
  view: { order: 10, i18nKey: 'widget.shortcuts.category.view' },
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

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected readonly toDispose = new DisposableCollection();
  protected searchTerm = '';

  constructor() {
    super();
    this.id = KAIRO_SHORTCUTS_WIDGET_ID;
    this.title.closable = true;
    this.title.iconClass = 'fa fa-keyboard-o';
    this.addClass('kairo-shortcuts-widget');
    this.scrollOptions = undefined;
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.updateTitle();
      this.update();
    }));
    this.update();
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.shortcuts.title');
    this.title.caption = this.i18n.t('widget.shortcuts.caption');
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
      <div className="kairo-shortcuts-container">
        {/* Search Bar */}
        <div className="kairo-shortcuts-search">
          <input
            className="kairo-shortcuts-search-input theia-input"
            type="text"
            placeholder={this.i18n.t('widget.cheatsheet.searchPlaceholderLong')}
            value={this.searchTerm}
            onChange={(e) => {
              this.searchTerm = (e.target as HTMLInputElement).value;
              this.update();
            }}
            aria-label={this.i18n.t('widget.shortcuts.searchAria')}
            role="searchbox"
          />
          <div className="kairo-shortcuts-count">
            {this.i18n.t('widget.shortcuts.count', { filtered: filtered.length, total: allShortcuts.length })}
            {this.searchTerm ? this.i18n.t('widget.shortcuts.countFiltered', { total: allShortcuts.length }) : ''}
          </div>
        </div>

        {/* Shortcuts Table */}
        <div className="kairo-shortcuts-table-container">
          {categorized.map(category => (
            <div key={category.name} className="kairo-shortcuts-category">
              <h3 className="kairo-shortcuts-category-header">
                {category.name}
                <span className="kairo-shortcuts-category-count">
                  ({category.shortcuts.length})
                </span>
              </h3>
              <table
                className="kairo-shortcuts-table"
                role="grid"
                aria-label={this.i18n.t('widget.shortcuts.tableAria', { category: category.name })}
              >
                <thead>
                  <tr className="kairo-shortcuts-header-row">
                    <th className="kairo-shortcuts-th kairo-shortcuts-col-command">{this.i18n.t('widget.shortcuts.colCommand')}</th>
                    <th className="kairo-shortcuts-th kairo-shortcuts-col-keybinding">{this.i18n.t('widget.shortcuts.colKeybinding')}</th>
                    <th className="kairo-shortcuts-th kairo-shortcuts-col-label">{this.i18n.t('widget.shortcuts.colLabel')}</th>
                    <th className="kairo-shortcuts-th kairo-shortcuts-col-when">{this.i18n.t('widget.shortcuts.colWhen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {category.shortcuts.map((shortcut, idx) => (
                    <tr
                      key={`${shortcut.command}-${idx}`}
                      className="kairo-shortcuts-row"
                      role="row"
                    >
                      <td className="kairo-shortcuts-td kairo-shortcuts-cell-command">
                        <code className="kairo-shortcuts-code">
                          {shortcut.command}
                        </code>
                      </td>
                      <td className="kairo-shortcuts-td kairo-shortcuts-cell-keybinding">
                        <kbd
                          className="kairo-shortcuts-kbd"
                          aria-label={this.i18n.t('widget.shortcuts.kbdAria', { keybinding: shortcut.keybinding })}
                        >
                          {shortcut.keybinding}
                        </kbd>
                      </td>
                      <td className="kairo-shortcuts-td kairo-shortcuts-cell-label">
                        {shortcut.label}
                      </td>
                      <td className="kairo-shortcuts-td kairo-shortcuts-cell-when">
                        {shortcut.when || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {categorized.length === 0 && (
            <div className="kairo-shortcuts-empty">
              {this.searchTerm
                ? this.i18n.t('widget.shortcuts.emptyNoMatch', { term: this.searchTerm })
                : this.i18n.t('widget.shortcuts.empty')}
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
      const catDef = CATEGORIES[catName] || { i18nKey: catName, order: 99 };
      const displayName = catDef.i18nKey.startsWith('widget.') ? (this.i18n?.t(catDef.i18nKey as any) ?? catName) : catDef.i18nKey;
      categories.push({
        name: displayName,
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
