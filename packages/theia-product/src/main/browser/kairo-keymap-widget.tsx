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
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

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

const SCOPE_LABELS: Record<KeybindingScope, (i18n: KairoI18nService) => string> = {
  [KeybindingScope.DEFAULT]: i18n => i18n.t('widget.keymap.scopeDefault' as KairoI18nKey),
  [KeybindingScope.USER]: i18n => i18n.t('widget.keymap.scopeUser' as KairoI18nKey),
  [KeybindingScope.WORKSPACE]: i18n => i18n.t('widget.keymap.scopeWorkspace' as KairoI18nKey),
  [KeybindingScope.END]: () => 'END',
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
  i18n: KairoI18nService;
}

const KeymapView: React.FC<KeymapViewProps> = ({
  entries, conflicts, searchTerm, onSearchChange, onModifyBinding: _onModifyBinding, onResetBinding, onResetAll, busy, i18n,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  const filtered = entries.filter(e => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return e.command.toLowerCase().includes(term)
      || e.commandLabel.toLowerCase().includes(term)
      || e.keybinding.toLowerCase().includes(term);
  });

  return (
    <div className="kairo-keymap-widget">
      {/* Search bar */}
      <div className="kairo-keymap-search">
        <input
          className="theia-input kairo-keymap-search-input"
          type="search"
          placeholder={t('widget.keymap.searchPlaceholder')}
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          aria-label={t('widget.keymap.searchAria')}
        />
      </div>

      {/* Toolbar */}
      <div className="kairo-widget-toolbar">
        <button className="theia-button secondary" disabled={busy} onClick={() => onResetAll(KeybindingScope.USER)}>
          {t('widget.keymap.resetUser')}
        </button>
        <button className="theia-button secondary" disabled={busy} onClick={() => onResetAll(KeybindingScope.WORKSPACE)}>
          {t('widget.keymap.resetWorkspace')}
        </button>
        <span className="kairo-keymap-count">
          {t('widget.keymap.count', { filtered: filtered.length, total: entries.length })}
        </span>
      </div>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="kairo-keymap-conflicts">
          <strong className="kairo-keymap-conflicts-title">{t('widget.keymap.conflicts', { count: conflicts.length })}</strong>
          {conflicts.map((c, i) => (
            <div key={i} className="kairo-keymap-conflicts-item">
              <code>{c.keybinding}</code> {t('widget.keymap.boundTo')}{' '}
              {c.entries.map(e => e.commandLabel || e.command).join(', ')}
            </div>
          ))}
        </div>
      )}

      {/* Keybinding list */}
      <div className="kairo-keymap-table-wrap">
        <table className="kairo-keymap-table" aria-label={t('widget.keymap.tableAria')}>
          <thead>
            <tr>
              <th className="kairo-keymap-col-command">{t('widget.keymap.colCommand')}</th>
              <th className="kairo-keymap-col-keybinding">{t('widget.keymap.colKeybinding')}</th>
              <th className="kairo-keymap-col-source">{t('widget.keymap.colSource')}</th>
              <th className="kairo-keymap-col-when">{t('widget.keymap.colWhen')}</th>
              <th className="kairo-keymap-col-actions">{t('widget.keymap.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="kairo-keymap-no-match">
                  {searchTerm ? t('widget.keymap.noMatch') : t('widget.keymap.noBindings')}
                </td>
              </tr>
            ) : (
              filtered.map((entry, idx) => (
                <tr key={`${entry.command}-${entry.scope}-${idx}`}>
                  <td>
                    <div>{entry.commandLabel || entry.command}</div>
                    <div className="kairo-keymap-command-label">{entry.command}</div>
                  </td>
                  <td>
                    <code className="kairo-keymap-key">
                      {entry.keybinding || '—'}
                    </code>
                  </td>
                  <td className="kairo-keymap-source">
                    {entry.scopeLabel}
                    {entry.isDefault ? '' : ` ${t('widget.keymap.custom')}`}
                  </td>
                  <td className="kairo-keymap-when">
                    {entry.when || '—'}
                  </td>
                  <td className="kairo-keymap-col-actions">
                    {entry.scope !== KeybindingScope.DEFAULT && (
                      <button
                        className="theia-button secondary"
                        disabled={busy}
                        onClick={() => onResetBinding(entry)}
                        title={t('widget.keymap.resetAria')}
                      >
                        {t('widget.keymap.reset')}
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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected searchTerm = '';
  protected busy = false;

  @postConstruct()
  protected init(): void {
    this.id = KAIRO_KEYMAP_FACTORY_ID;
    this.title.label = this.i18n.t('widget.keymap.title' as KairoI18nKey);
    this.title.caption = this.i18n.t('widget.keymap.caption' as KairoI18nKey);
    this.title.iconClass = 'codicon codicon-keyboard';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.title.label = this.i18n.t('widget.keymap.title' as KairoI18nKey);
      this.title.caption = this.i18n.t('widget.keymap.caption' as KairoI18nKey);
      this.update();
    }));
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
        i18n={this.i18n}
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
          scopeLabel: SCOPE_LABELS[scope] ? SCOPE_LABELS[scope](this.i18n) : 'Unknown',
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
    this.messages.info(this.i18n.t('widget.keymap.modifyInfo' as KairoI18nKey));
  }

  protected handleReset(entry: KeymapEntry): void {
    try {
      this.keybindingRegistry.resetKeybindingsForScope(entry.scope);
      this.messages.info(this.i18n.t('widget.keymap.resetInfo' as KairoI18nKey, { scope: entry.scopeLabel }));
      this.update();
    } catch (err) {
      this.messages.error(this.i18n.t('widget.keymap.resetFailed' as KairoI18nKey, {
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  protected handleResetAll(scope: KeybindingScope): void {
    const label = SCOPE_LABELS[scope] ? SCOPE_LABELS[scope](this.i18n) : 'Unknown';
    try {
      this.keybindingRegistry.resetKeybindingsForScope(scope);
      this.messages.info(this.i18n.t('widget.keymap.resetInfo' as KairoI18nKey, { scope: label }));
      this.update();
    } catch (err) {
      this.messages.error(this.i18n.t('widget.keymap.resetAllFailed' as KairoI18nKey, {
        scope: label,
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }
}