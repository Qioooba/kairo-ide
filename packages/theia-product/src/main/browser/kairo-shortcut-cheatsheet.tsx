import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';

import { KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID } from './kairo-factory-ids';
import './kairo-shortcut-cheatsheet.css';

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
  name: string;
  icon: string;
  shortcuts: ShortcutRow[];
}

const SHORTCUT_DATA: ShortcutCategory[] = [
  {
    name: 'Editing',
    icon: 'codicon-edit',
    shortcuts: [
      { action: 'Undo', idea: 'Ctrl+Z', kairo: 'Ctrl+Z' },
      { action: 'Redo', idea: 'Ctrl+Shift+Z', kairo: 'Ctrl+Shift+Z' },
      { action: 'Cut', idea: 'Ctrl+X', kairo: 'Ctrl+X' },
      { action: 'Copy', idea: 'Ctrl+C', kairo: 'Ctrl+C' },
      { action: 'Paste', idea: 'Ctrl+V', kairo: 'Ctrl+V' },
      { action: 'Comment with Line Comment', idea: 'Ctrl+/', kairo: 'Ctrl+/' },
      { action: 'Comment with Block Comment', idea: 'Ctrl+Shift+/', kairo: 'Ctrl+Shift+/' },
      { action: 'Format Code', idea: 'Ctrl+Alt+L', kairo: 'Shift+Alt+F' },
      { action: 'Organize Imports', idea: 'Ctrl+Alt+O', kairo: 'Shift+Alt+O' },
      { action: 'Rename', idea: 'Shift+F6', kairo: 'F2' },
      { action: 'Duplicate Line', idea: 'Ctrl+D', kairo: 'Shift+Alt+Down' },
      { action: 'Delete Line', idea: 'Ctrl+Y', kairo: 'Ctrl+Shift+L' },
      { action: 'Move Line Up', idea: 'Shift+Alt+Up', kairo: 'Alt+Up' },
      { action: 'Move Line Down', idea: 'Shift+Alt+Down', kairo: 'Alt+Down' },
      { action: 'Expand Selection', idea: 'Ctrl+W', kairo: 'Shift+Alt+Right' },
      { action: 'Shrink Selection', idea: 'Ctrl+Shift+W', kairo: 'Shift+Alt+Left' },
    ],
  },
  {
    name: 'Navigation',
    icon: 'codicon-compass',
    shortcuts: [
      { action: 'Go to File', idea: 'Ctrl+Shift+N', kairo: 'Ctrl+P' },
      { action: 'Go to Class', idea: 'Ctrl+N', kairo: 'Ctrl+Shift+Alt+N' },
      { action: 'Go to Line', idea: 'Ctrl+G', kairo: 'Ctrl+G' },
      { action: 'File Structure', idea: 'Ctrl+F12', kairo: 'Ctrl+Shift+O' },
      { action: 'Quick Definition', idea: 'Ctrl+Shift+I', kairo: 'Alt+F12' },
      { action: 'Go to Definition', idea: 'Ctrl+B', kairo: 'F12' },
      { action: 'Go to Implementation', idea: 'Ctrl+Alt+B', kairo: 'Ctrl+F12' },
      { action: 'Find Usages', idea: 'Alt+F7', kairo: 'Shift+F12' },
      { action: 'Switch Tab (Next)', idea: 'Alt+Right', kairo: 'Ctrl+Tab' },
      { action: 'Switch Tab (Previous)', idea: 'Alt+Left', kairo: 'Ctrl+Shift+Tab' },
      { action: 'Close Tab', idea: 'Ctrl+F4', kairo: 'Ctrl+W' },
      { action: 'Back', idea: 'Ctrl+Alt+Left', kairo: 'Alt+Left' },
      { action: 'Forward', idea: 'Ctrl+Alt+Right', kairo: 'Alt+Right' },
      { action: 'Recent Files', idea: 'Ctrl+E', kairo: 'Ctrl+E' },
    ],
  },
  {
    name: 'Search',
    icon: 'codicon-search',
    shortcuts: [
      { action: 'Search Everywhere', idea: 'Double Shift', kairo: 'Double Shift' },
      { action: 'Find Action', idea: 'Ctrl+Shift+A', kairo: 'Ctrl+Shift+A' },
      { action: 'Find in Path', idea: 'Ctrl+Shift+F', kairo: 'Ctrl+Shift+F' },
      { action: 'Replace in Path', idea: 'Ctrl+Shift+R', kairo: 'Ctrl+Shift+H' },
      { action: 'Find in File', idea: 'Ctrl+F', kairo: 'Ctrl+F' },
      { action: 'Replace in File', idea: 'Ctrl+R', kairo: 'Ctrl+H' },
      { action: 'Find Next', idea: 'F3', kairo: 'F3' },
      { action: 'Find Previous', idea: 'Shift+F3', kairo: 'Shift+F3' },
    ],
  },
  {
    name: 'Build / Run',
    icon: 'codicon-play',
    shortcuts: [
      { action: 'Build Project', idea: 'Ctrl+F9', kairo: 'Ctrl+B' },
      { action: 'Run', idea: 'Shift+F10', kairo: 'Shift+F10' },
      { action: 'Debug', idea: 'Shift+F9', kairo: 'Shift+F9' },
      { action: 'Stop', idea: 'Ctrl+F2', kairo: 'Shift+F5' },
      { action: 'Run to Cursor', idea: 'Alt+F9', kairo: '\u2014' },
      { action: 'Apply Changes (Hotswap)', idea: 'Ctrl+Shift+F9', kairo: 'Ctrl+F10' },
    ],
  },
  {
    name: 'Debug',
    icon: 'codicon-debug-alt',
    shortcuts: [
      { action: 'Toggle Breakpoint', idea: 'Ctrl+F8', kairo: 'Ctrl+Shift+B' },
      { action: 'Step Over', idea: 'F8', kairo: 'F10' },
      { action: 'Step Into', idea: 'F7', kairo: 'F11' },
      { action: 'Step Out', idea: 'Shift+F8', kairo: 'Shift+F11' },
      { action: 'Resume Program', idea: 'F9', kairo: 'F5' },
      { action: 'Evaluate Expression', idea: 'Alt+F8', kairo: '\u2014' },
      { action: 'View Breakpoints', idea: 'Ctrl+Shift+F8', kairo: 'Ctrl+Shift+Alt+B' },
    ],
  },
  {
    name: 'Bookmarks',
    icon: 'codicon-bookmark',
    shortcuts: [
      { action: 'Toggle Bookmark', idea: 'F11', kairo: 'F11' },
      { action: 'Toggle Bookmark (Mnemonic)', idea: 'Ctrl+F11', kairo: 'Ctrl+Shift+F11' },
      { action: 'Go to Bookmark (0-9)', idea: 'Ctrl+0..9', kairo: 'Ctrl+0..9' },
      { action: 'Set Bookmark (0-9)', idea: 'Ctrl+Shift+0..9', kairo: 'Ctrl+Shift+0..9' },
      { action: 'Show Bookmarks', idea: 'Shift+F11', kairo: '\u2014' },
    ],
  },
  {
    name: 'Git',
    icon: 'codicon-git-branch',
    shortcuts: [
      { action: 'Commit', idea: 'Ctrl+K', kairo: 'Ctrl+Enter (Git panel)' },
      { action: 'Push', idea: 'Ctrl+Shift+K', kairo: '\u2014' },
      { action: 'Update Project (Pull)', idea: 'Ctrl+T', kairo: '\u2014' },
      { action: 'Show VCS Popup', idea: 'Alt+`', kairo: '\u2014' },
      { action: 'Open Git Panel', idea: 'Alt+9', kairo: 'Ctrl+Shift+G' },
    ],
  },
  {
    name: 'General',
    icon: 'codicon-settings-gear',
    shortcuts: [
      { action: 'Save All', idea: 'Ctrl+S', kairo: 'Ctrl+K S' },
      { action: 'Settings', idea: 'Ctrl+Alt+S', kairo: 'Ctrl+,' },
      { action: 'Project Structure', idea: 'Ctrl+Alt+Shift+S', kairo: 'Ctrl+Alt+Shift+S' },
      { action: 'Terminal', idea: 'Alt+F12', kairo: 'Ctrl+`' },
      { action: 'Command Palette', idea: 'Ctrl+Shift+A', kairo: 'F1' },
      { action: 'Quick Open', idea: 'Double Shift', kairo: 'Ctrl+P' },
    ],
  },
];

function renderKbd(keys: string): React.ReactNode {
  if (keys === '\u2014' || keys === 'Coming soon') {
    return <span className="kairo-cheatsheet-key kairo-cheatsheet-key-na">{keys}</span>;
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
          {chord.split(/\s*\+\s*/).map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="kairo-cheatsheet-key-sep">+</span>}
              <kbd className="kairo-cheatsheet-key">{part}</kbd>
            </React.Fragment>
          ))}
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

const CheatsheetContent: React.FC<{ searchTerm: string; onSearchChange: (term: string) => void }> = ({ searchTerm, onSearchChange }) => {
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const term = searchTerm.trim().toLowerCase();

  const filteredCategories = React.useMemo(() => {
    if (!term) return SHORTCUT_DATA;
    return SHORTCUT_DATA
      .map(cat => ({
        ...cat,
        shortcuts: cat.shortcuts.filter(
          s => s.action.toLowerCase().includes(term)
            || s.idea.toLowerCase().includes(term)
            || s.kairo.toLowerCase().includes(term),
        ),
      }))
      .filter(cat => cat.shortcuts.length > 0);
  }, [term]);

  const totalShortcuts = SHORTCUT_DATA.reduce((sum, c) => sum + c.shortcuts.length, 0);
  const visibleCount = filteredCategories.reduce((sum, c) => sum + c.shortcuts.length, 0);

  React.useEffect(() => {
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="kairo-cheatsheet-content">
      <div className="kairo-cheatsheet-search">
        <i className="codicon codicon-search" style={{ marginRight: 8, opacity: 0.6 }} />
        <input
          ref={searchInputRef}
          className="kairo-cheatsheet-search-input"
          type="search"
          placeholder="Search shortcuts by action or key..."
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          aria-label="Search shortcuts"
        />
        {searchTerm && (
          <button
            className="kairo-cheatsheet-clear"
            onClick={() => {
              onSearchChange('');
              searchInputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <i className="codicon codicon-close" />
          </button>
        )}
        <span className="kairo-cheatsheet-count-inline">{visibleCount} / {totalShortcuts}</span>
      </div>

      <div className="kairo-cheatsheet-body">
        {filteredCategories.length === 0 ? (
          <div className="kairo-cheatsheet-empty">
            <i className="codicon codicon-search" style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }} />
            <div>No shortcuts match &quot;{searchTerm}&quot;</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              Try searching for action names like &quot;debug&quot;, &quot;format&quot;, or &quot;git&quot;
            </div>
          </div>
        ) : (
          filteredCategories.map(category => (
            <div key={category.name} className="kairo-cheatsheet-category">
              <div className="kairo-cheatsheet-category-header">
                <i className={`codicon ${category.icon}`} style={{ marginRight: 6 }} />
                {category.name}
                <span className="kairo-cheatsheet-category-count">({category.shortcuts.length})</span>
              </div>
              <table className="kairo-cheatsheet-table">
                <thead>
                  <tr>
                    <th className="kairo-cheatsheet-col-action">Action</th>
                    <th className="kairo-cheatsheet-col-idea">
                      <i className="codicon codicon-symbol-namespace" style={{ marginRight: 4 }} />
                      IDEA Shortcut
                    </th>
                    <th className="kairo-cheatsheet-col-kairo">
                      <span className="kairo-cheatsheet-kairo-badge">K</span>
                      Kairo Shortcut
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {category.shortcuts.map((row, idx) => (
                    <tr key={`${category.name}-${idx}`}>
                      <td className="kairo-cheatsheet-col-action">
                        {highlightText(row.action, term)}
                      </td>
                      <td className="kairo-cheatsheet-col-idea">
                        {renderKbd(row.idea)}
                      </td>
                      <td className="kairo-cheatsheet-col-kairo">
                        {renderKbd(row.kairo)}
                      </td>
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
          Press <kbd className="kairo-cheatsheet-key kairo-cheatsheet-key-sm">Esc</kbd> to close
          &nbsp;&bull;&nbsp;
          <kbd className="kairo-cheatsheet-key kairo-cheatsheet-key-sm">Ctrl</kbd>
          <kbd className="kairo-cheatsheet-key kairo-cheatsheet-key-sm">Shift</kbd>
          <kbd className="kairo-cheatsheet-key kairo-cheatsheet-key-sm">K</kbd> to toggle
        </span>
      </div>
    </div>
  );
};

export class KairoShortcutCheatsheetDialog extends ReactDialog<void> {
  protected searchTerm = '';

  constructor() {
    super({
      title: 'Keyboard Shortcuts \u2014 IDEA vs Kairo',
      maxWidth: 900,
    } as DialogProps);
    this.addClass('kairo-cheatsheet-dialog');
    this.id = KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID;
    this.closeCrossNode.classList.add('codicon', 'codicon-close');
  }

  protected render(): React.ReactNode {
    return (
      <CheatsheetContent
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

  protected dialog: KairoShortcutCheatsheetDialog | null = null;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoCheatsheetCommands.TOGGLE, {
      execute: () => this.toggle(),
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: KairoCheatsheetCommands.TOGGLE.id,
      keybinding: 'ctrl+shift+k',
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
    this.dialog = new KairoShortcutCheatsheetDialog();
    this.dialog.open();
  }
}
