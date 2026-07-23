import * as React from 'react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { CommandService } from '@theia/core/lib/common/command';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { SearchEverywhereModel, type SearchEverywhereCategory, type SearchEverywhereItem, type SearchEverywhereState } from './search-everywhere-model';

const CATEGORIES: SearchEverywhereCategory[] = ['all', 'files', 'types', 'symbols', 'actions'];

/** Map LSP SymbolKind to a short display icon. */
function symbolKindIcon(kind: number | undefined): string {
  switch (kind) {
    case 1: return '\uD83D\uDCC4'; // File
    case 2: return '\uD83D\uDCE6'; // Module
    case 3: return '\uD83D\uDCC1'; // Namespace
    case 4: return '\uD83D\uDCE6'; // Package
    case 5: return '\uD83C\uDFD7'; // Class
    case 6: return '\u0192';       // Method
    case 7: return '\u2699';       // Property
    case 8: return '\uD83D\uDD11'; // Field
    case 9: return '\uD83D\uDEE0'; // Constructor
    case 10: return '\uD83D\uDDDD'; // Enum
    case 11: return '\u25CB';      // Interface
    case 12: return '\u0192';      // Function
    case 13: return '\uD83D\uDD22'; // Variable
    case 14: return '\uD83D\uDD12'; // Constant
    case 23: return '\uD83D\uDEE0'; // Struct
    default: return '';
  }
}

export interface SearchEverywhereProps {
  model: SearchEverywhereModel;
  state: SearchEverywhereState;
  onOpen: (item: SearchEverywhereItem) => unknown;
}

export const SearchEverywhereComponent: React.FC<SearchEverywhereProps> = ({ model, state, onOpen }) => {
  const [query, setQuery] = React.useState(state.query);
  const [openError, setOpenError] = React.useState<Error | undefined>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const timer = setTimeout(() => void model.query(query, state.category, 100), 100);
    return () => clearTimeout(timer);
  }, [model, query, state.category]);

  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); model.select(state.selectedIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); model.select(state.selectedIndex - 1); }
    else if (event.key === 'Enter' && state.items[state.selectedIndex]) { event.preventDefault(); void openItem(state.items[state.selectedIndex]); }
    else if (event.key === 'Escape') { /* handled by widget close */ }
    else if (event.key === 'Tab') {
      // Trap focus inside the modal (D4.1)
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const current = document.activeElement;
      const idx = Array.from(focusable).indexOf(current as HTMLElement);
      const next = event.shiftKey
        ? (idx <= 0 ? focusable.length - 1 : idx - 1)
        : (idx >= focusable.length - 1 ? 0 : idx + 1);
      focusable[next].focus();
    }
  };
  const openItem = async (item: SearchEverywhereItem): Promise<void> => {
    setOpenError(undefined);
    try { await onOpen(item); }
    catch (error) { setOpenError(error instanceof Error ? error : new Error(String(error))); }
  };

  return <div className="kairo-everywhere" data-testid="search-everywhere" ref={containerRef} onKeyDown={keyDown} role="dialog" aria-modal="true" aria-label="Search Everywhere">
    <input autoFocus className="theia-input kairo-everywhere-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files, types, symbols, actions" aria-label="Search query" data-testid="everywhere-query" />
    <nav className="kairo-everywhere-tabs" aria-label="Search categories">
      {CATEGORIES.map(category => <button key={category} type="button" className={state.category === category ? 'is-active' : ''} aria-label={`Search in ${category}`} aria-pressed={state.category === category} onClick={() => void model.query(query, category, 100)} data-testid={`category-${category}`}>{category[0].toUpperCase() + category.slice(1)}</button>)}
    </nav>
    <div className="kairo-everywhere-body" role="listbox">
      {state.status === 'loading' && <div role="status">Searching…</div>}
      {state.status === 'idle' && <div>Type to search. Recent items appear here.</div>}
      {state.status === 'empty' && <div>No matching items.</div>}
      {state.status === 'error' && <div role="alert">{state.error?.message}</div>}
      {openError && <div role="alert" data-testid="everywhere-open-error">{openError.message}</div>}
      {state.items.map((item, index) => <button type="button" role="option" aria-selected={index === state.selectedIndex} className={`kairo-everywhere-item${index === state.selectedIndex ? ' is-selected' : ''}`} key={item.id} onMouseEnter={() => model.select(index)} onClick={() => void openItem(item)}>
        <span className="kairo-everywhere-kind">{(item.kind !== undefined ? symbolKindIcon(item.kind) : item.category) || item.category}</span><span>{item.label}</span><small>{item.detail}</small>
      </button>)}
    </div>
  </div>;
};

@injectable()
export class SearchEverywhereWidget extends ReactWidget {
  static readonly ID = 'kairo-search-everywhere';
  @inject(SearchEverywhereModel) protected readonly model!: SearchEverywhereModel;
  @inject(EditorManager) protected readonly editors!: EditorManager;
  @inject(CommandService) protected readonly commands!: CommandService;
  protected state: SearchEverywhereState = { status: 'idle', query: '', category: 'all', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super(); this.id = SearchEverywhereWidget.ID; this.title.label = 'Search Everywhere'; this.title.closable = true; this.addClass('kairo-search-everywhere-widget');
  }
  protected onAfterAttach(message: Message): void { super.onAfterAttach(message); this.unsubscribe ??= this.model.subscribe(state => { this.state = state; this.update(); }); }
  dispose(): void { this.unsubscribe?.(); this.model.cancel(); super.dispose(); }
  protected async open(item: SearchEverywhereItem): Promise<void> {
    this.model.remember(item);
    if (item.commandId) await this.commands.executeCommand(item.commandId);
    else if (item.uri) await this.editors.open(new URI(item.uri), { mode: 'activate', selection: item.line === undefined ? undefined : { start: { line: item.line, character: item.character ?? 0 } } });
  }
  protected render(): React.ReactNode { return <SearchEverywhereComponent model={this.model} state={this.state} onOpen={item => void this.open(item)} />; }
}
