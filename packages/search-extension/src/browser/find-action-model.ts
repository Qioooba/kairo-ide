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

@injectable()
export class FindActionModel {
  @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
  @inject(KeybindingRegistry) protected readonly keybindings!: KeybindingRegistry;

  protected state: FindActionState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected readonly listeners = new Set<FindActionListener>();
  protected generation = 0;

  get snapshot(): FindActionState { return this.state; }

  subscribe(listener: FindActionListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
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
      const allCommands = [...this.commands.getAllCommands()];
      const items = allCommands
        .filter(command => {
          if (!command.label) return false;
          if (command.id.startsWith('_')) return false;
          return this.commands.isVisible(command.id);
        })
        .map(command => {
          const keybindings = this.keybindings.getKeybindingsForCommand(command.id);
          const shortcut = keybindings.length > 0
            ? keybindings[0].keybinding.replace(/ctrlcmd/g, isOSX ? 'Cmd' : 'Ctrl').replace(/([+])/g, ' $1 ')
            : '';
          const detail = shortcut || command.category || '';
          const score = fuzzyScore(trimmed, `${command.label} ${command.category ?? ''}`) ?? 0;
          return {
            id: `action:${command.id}`,
            label: command.label,
            detail,
            commandId: command.id,
            score,
          };
        })
        .filter((item): item is { id: string; label: string; detail: string; commandId: string; score: number } => item.score !== undefined)
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