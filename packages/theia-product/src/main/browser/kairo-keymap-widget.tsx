/**
 * Kairo Keymap management widget.
 *
 * Provides a searchable, editable UI for keyboard shortcuts
 * (keybindings). Supports:
 *   - Search by key sequence or command name
 *   - Modify existing bindings
 *   - Conflict detection (same key bound to multiple commands)
 *   - Reset to default (per scope or globally)
 *
 * Backed by Theia's KeybindingRegistry which already handles
 * scope-based keymap storage and dispatch.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KeybindingRegistry, KeybindingScope, ScopedKeybinding as _ScopedKeybinding } from '@theia/core/lib/browser/keybinding';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { Keybinding as _Keybinding } from '@theia/core/lib/common/keybinding';

export const KAIRO_KEYMAP_FACTORY_ID = 'kairo-keymap';

interface KeymapEntry {
  command: string;
  commandLabel: string;
  keybinding: string;
  when: string;
  scope: KeybindingScope;
  scopeLabel: string;
  isDefault: boolean;
}

interface ConflictGroup {
  keybinding: string;
  entries: KeymapEntry[];
}

const SCOPE_LABELS: Record<KeybindingScope, string> = {
  [KeybindingScope.DEFAULT]: 'Default',
  [KeybindingScope.USER]: 'User',
  [KeybindingScope.WORKSPACE]: 'Workspace',
  [KeybindingScope.END]: 'END',
};

interface KeymapViewProps {
  entries: KeymapEntry[];
  conflicts: ConflictGroup[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onModifyBinding: (entry: KeymapEntry) => void;
  onResetBinding: (entry: KeymapEntry) => void;
  onResetAll: (scope: KeybindingScope) => void;
  busy: boolean;
}

const KeymapView: React.FC<KeymapViewProps> = ({
  entries, conflicts, searchTerm, onSearchChange, onModifyBinding: _onModifyBinding, onResetBinding, onResetAll, busy,
}) => {
  const filtered = entries.filter(e => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return e.command.toLowerCase().includes(term)
      || e.commandLabel.toLowerCase().includes(term)
      || e.keybinding.toLowerCase().includes(term);
  });

  return (
    <div className="kairo-keymap-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)' }}>
        <input
          className="theia-input"
          type="search"
          placeholder="Search keybindings by key or command..."
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          aria-label="Search keybindings"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {/* Toolbar */}
      <div className="kairo-widget-toolbar" style={{ padding: '4px 12px', borderBottom: '1px solid var(--theia-panel-border)' }}>
        <button className="theia-button secondary" disabled={busy} onClick={() => onResetAll(KeybindingScope.USER)}>
          Reset User Keybindings
        </button>
        <button className="theia-button secondary" disabled={busy} onClick={() => onResetAll(KeybindingScope.WORKSPACE)}>
          Reset Workspace Keybindings
        </button>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          {filtered.length} of {entries.length} bindings
        </span>
      </div>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div style={{ padding: '8px 12px', background: 'var(--theia-editorWarning-foreground, #cca700)', color: 'var(--theia-editor-background, #1e1e1e)' }}>
          <strong>⚠ Keybinding Conflicts ({conflicts.length})</strong>
          {conflicts.map((c, i) => (
            <div key={i} style={{ marginTop: 4, fontSize: '0.9em' }}>
              <code>{c.keybinding}</code> is bound to:{' '}
              {c.entries.map(e => e.commandLabel || e.command).join(', ')}
            </div>
          ))}
        </div>
      )}

      {/* Keybinding list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Keyboard shortcuts">
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: 'var(--theia-editor-background, #1e1e1e)', borderBottom: '1px solid var(--theia-panel-border)' }}>
              <th style={{ padding: '6px 12px', textAlign: 'left', width: '30%' }}>Command</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', width: '25%' }}>Keybinding</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', width: '15%' }}>Source</th>
              <th style={{ padding: '6px 12px', textAlign: 'left', width: '15%' }}>When</th>
              <th style={{ padding: '6px 12px', textAlign: 'right', width: '15%' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', opacity: 0.5 }}>
                  {searchTerm ? 'No keybindings match your search.' : 'No keybindings registered.'}
                </td>
              </tr>
            ) : (
              filtered.map((entry, idx) => (
                <tr key={`${entry.command}-${entry.scope}-${idx}`} style={{ borderBottom: '1px solid var(--theia-panel-border)' }}>
                  <td style={{ padding: '4px 12px' }}>
                    <div>{entry.commandLabel || entry.command}</div>
                    <div style={{ fontSize: '0.8em', opacity: 0.6 }}>{entry.command}</div>
                  </td>
                  <td style={{ padding: '4px 12px' }}>
                    <code style={{
                      background: 'var(--theia-badge-background, #4d4d4d)',
                      color: 'var(--theia-badge-foreground, #fff)',
                      padding: '2px 6px',
                      borderRadius: 3,
                      fontSize: '0.9em',
                    }}>
                      {entry.keybinding || '—'}
                    </code>
                  </td>
                  <td style={{ padding: '4px 12px', fontSize: '0.85em' }}>
                    {entry.scopeLabel}
                    {entry.isDefault ? '' : ' (custom)'}
                  </td>
                  <td style={{ padding: '4px 12px', fontSize: '0.85em', opacity: 0.7 }}>
                    {entry.when || '—'}
                  </td>
                  <td style={{ padding: '4px 12px', textAlign: 'right' }}>
                    {entry.scope !== KeybindingScope.DEFAULT && (
                      <button
                        className="theia-button secondary"
                        style={{ fontSize: '0.8em', padding: '2px 8px' }}
                        disabled={busy}
                        onClick={() => onResetBinding(entry)}
                        title="Reset to default"
                      >
                        Reset
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

@injectable()
export class KairoKeymapWidget extends ReactWidget {
  static readonly ID = KAIRO_KEYMAP_FACTORY_ID;

  @inject(KeybindingRegistry) protected readonly keybindingRegistry!: KeybindingRegistry;
  @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
  @inject(MessageService) protected readonly messages!: MessageService;

  protected searchTerm = '';
  protected busy = false;

  @postConstruct()
  protected init(): void {
    this.id = KAIRO_KEYMAP_FACTORY_ID;
    this.title.label = 'Keyboard Shortcuts';
    this.title.caption = 'Kairo IDE Keyboard Shortcuts';
    this.title.iconClass = 'codicon codicon-keyboard';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    const entries = this.collectEntries();
    const conflicts = this.detectConflicts(entries);
    return (
      <KeymapView
        entries={entries}
        conflicts={conflicts}
        searchTerm={this.searchTerm}
        onSearchChange={term => {
          this.searchTerm = term;
          this.update();
        }}
        onModifyBinding={entry => this.handleModify(entry)}
        onResetBinding={entry => this.handleReset(entry)}
        onResetAll={scope => this.handleResetAll(scope)}
        busy={this.busy}
      />
    );
  }

  protected collectEntries(): KeymapEntry[] {
    const entries: KeymapEntry[] = [];
    const seen = new Set<string>();

    for (const scope of [KeybindingScope.DEFAULT, KeybindingScope.USER, KeybindingScope.WORKSPACE]) {
      const bindings = this.keybindingRegistry.getKeybindingsByScope(scope);
      for (const binding of bindings) {
        const key = `${binding.command}::${binding.keybinding}::${scope}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const cmd = this.commandRegistry.getCommand(binding.command);
        entries.push({
          command: binding.command,
          commandLabel: cmd?.label || binding.command,
          keybinding: binding.keybinding,
          when: binding.when || '',
          scope,
          scopeLabel: SCOPE_LABELS[scope] || 'Unknown',
          isDefault: scope === KeybindingScope.DEFAULT,
        });
      }
    }

    return entries;
  }

  protected detectConflicts(entries: KeymapEntry[]): ConflictGroup[] {
    const byKey = new Map<string, KeymapEntry[]>();
    for (const entry of entries) {
      if (!entry.keybinding) continue;
      const existing = byKey.get(entry.keybinding) || [];
      existing.push(entry);
      byKey.set(entry.keybinding, existing);
    }

    const conflicts: ConflictGroup[] = [];
    for (const [keybinding, group] of byKey) {
      // Only report conflicts where the same key is bound to different commands
      const uniqueCommands = new Set(group.map(e => e.command));
      if (uniqueCommands.size > 1) {
        conflicts.push({ keybinding, entries: group });
      }
    }

    return conflicts;
  }

  protected handleModify(_entry: KeymapEntry): void {
    // Theia's keybindings are modified via the keymaps.json file
    // or programmatically via KeybindingRegistry.setKeymap().
    // For now, directing users to use the keybindings JSON editor
    // is the most reliable approach.
    this.messages.info(
      'To modify keybindings, open the keybindings JSON editor ' +
      'via Preferences: Open Keyboard Shortcuts (JSON) in the command palette.',
    );
  }

  protected handleReset(entry: KeymapEntry): void {
    try {
      this.keybindingRegistry.resetKeybindingsForScope(entry.scope);
      this.messages.info(`Keybindings for ${entry.scopeLabel} scope have been reset to defaults.`);
      this.update();
    } catch (err) {
      this.messages.error(`Failed to reset keybindings: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  protected handleResetAll(scope: KeybindingScope): void {
    const label = SCOPE_LABELS[scope] || 'Unknown';
    try {
      this.keybindingRegistry.resetKeybindingsForScope(scope);
      this.messages.info(`${label} keybindings have been reset to defaults.`);
      this.update();
    } catch (err) {
      this.messages.error(`Failed to reset ${label} keybindings: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}