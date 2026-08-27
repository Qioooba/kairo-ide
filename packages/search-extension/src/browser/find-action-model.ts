import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { fuzzyScore } from './search-everywhere-model';

export interface FindActionItem {
  id: string;
  label: string;
  detail: string;
  commandId: string;
  score: number;
}

export interface FindActionState {
  status: 'idle' | 'loading' | 'results' | 'empty' | 'error';
  query: string;
  items: readonly FindActionItem[];
  selectedIndex: number;
  error?: Error;
}

export type FindActionListener = (state: FindActionState) => void;

interface CatalogEntry { id: string; label: string; category: string; shortcut: string; }

@injectable()
export class FindActionModel {
  @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
  @inject(KeybindingRegistry) protected readonly keybindings!: KeybindingRegistry;

  protected state: FindActionState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected readonly listeners = new Set<FindActionListener>();
  protected generation = 0;

  /**
   * Cached visible-command catalog. Building it requires an O(commands ×
   * keybindings) scan plus a visibility check per command; caching turns
   * every keystroke's cost back into a plain fuzzy-score pass.
   */
  protected catalog: CatalogEntry[] | undefined;
  protected catalogUnsubscribe: (() => void) | undefined;

  get snapshot(): FindActionState { return this.state; }

  subscribe(listener: FindActionListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  protected getCatalog(): CatalogEntry[] {
    if (!this.catalog) {
      this.catalog = [...this.commands.getAllCommands()]
        .filter(command => {
          if (!command.label) return false;
          if (command.id.startsWith('_')) return false;
          return this.commands.isVisible(command.id);
        })
        .map(command => {
          const bindings = this.keybindings.getKeybindingsForCommand(command.id);
          const shortcut = bindings.length > 0
            ? bindings[0].keybinding.replace(/ctrlcmd/g, isOSX ? 'Cmd' : 'Ctrl').replace(/([+])/g, ' $1 ')
            : '';
          return { id: command.id, label: command.label!, category: command.category ?? '', shortcut };
        });
      if (!this.catalogUnsubscribe) {
        this.keybindings.onKeybindingsChanged(() => { this.catalog = undefined; });
        // Event subscriptions from a singleton live for the app lifetime.
        this.catalogUnsubscribe = () => { /* kept intentionally */ };
      }
    }
    return this.catalog;
  }

  query(query: string, limit = 30): FindActionState {
    this.generation++;
    const trimmed = query.trim();

    if (!trimmed) {
      this.publish({ status: 'idle', query: '', items: [], selectedIndex: 0 });
      return this.state;
    }

    this.publish({ status: 'loading', query: trimmed, items: [], selectedIndex: 0 });

    try {
      const items = this.getCatalog()
        .map(entry => {
          const detail = entry.shortcut || entry.category;
          const score = fuzzyScore(trimmed, `${entry.label} ${entry.category}`) ?? 0;
          return {
            id: `action:${entry.id}`,
            label: entry.label,
            detail,
            commandId: entry.id,
            score,
          };
        })
        .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label))
        .slice(0, limit);

      this.publish({ status: items.length ? 'results' : 'empty', query: trimmed, items, selectedIndex: 0 });
    } catch (error) {
      this.publish({ status: 'error', query: trimmed, items: [], selectedIndex: 0, error: error instanceof Error ? error : new Error(String(error)) });
    }
    return this.state;
  }

  select(index: number): void {
    if (!this.state.items.length) return;
    const selectedIndex = (index + this.state.items.length) % this.state.items.length;
    this.publish({ ...this.state, selectedIndex });
  }

  cancel(): void { /* no async operations */ }

  protected publish(state: FindActionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { try { console.error('Find Action listener failed', error); } catch {} }
    }
  }
}