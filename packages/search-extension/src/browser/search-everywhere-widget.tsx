import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { CommandService } from '@theia/core/lib/common/command';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { KairoI18nService } from '@kairo/i18n';
import { VirtualList } from '@kairo/ui-kit';
import { SearchEverywhereModel, type SearchEverywhereCategory, type SearchEverywhereItem, type SearchEverywhereState } from './search-everywhere-model';

const ROW_HEIGHT = 28;

const CATEGORIES: SearchEverywhereCategory[] = ['all', 'files', 'types', 'symbols', 'actions'];

/** Map LSP SymbolKind to a codicon class. */
function symbolKindIcon(kind: number | undefined): string {
  switch (kind) {
    case 1: return 'codicon-symbol-file';
    case 2: return 'codicon-symbol-namespace';
    case 3: return 'codicon-symbol-namespace';
    case 4: return 'codicon-symbol-namespace';
    case 5: return 'codicon-symbol-class';
    case 6: return 'codicon-symbol-method';
    case 7: return 'codicon-symbol-property';
    case 8: return 'codicon-symbol-field';
    case 9: return 'codicon-symbol-constructor';
    case 10: return 'codicon-symbol-enum';
    case 11: return 'codicon-symbol-interface';
    case 12: return 'codicon-symbol-function';
    case 13: return 'codicon-symbol-variable';
    case 14: return 'codicon-symbol-constant';
    case 23: return 'codicon-symbol-struct';
    default: return 'codicon-symbol-method';
  }
}

function categoryIcon(category: SearchEverywhereCategory): string {
  switch (category) {
    case 'all': return 'codicon-search';
    case 'files': return 'codicon-file';
    case 'types': return 'codicon-symbol-class';
    case 'symbols': return 'codicon-symbol-method';
    case 'actions': return 'codicon-symbol-event';
    default: return 'codicon-search';
  }
}

export interface SearchEverywhereProps {
  model: SearchEverywhereModel;
  state: SearchEverywhereState;
  onOpen: (item: SearchEverywhereItem) => unknown;
  i18n: KairoI18nService;
}

export const SearchEverywhereComponent: React.FC<SearchEverywhereProps> = ({ model, state, onOpen, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
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

  const renderStatus = (): React.ReactNode => {
    if (openError) {
      return <div className="kairo-everywhere-status kairo-error-banner" role="alert" data-testid="everywhere-open-error">{openError.message}</div>;
    }
    switch (state.status) {
      case 'loading':
        return <div className="kairo-everywhere-status kairo-empty-state" role="status">{t('widget.search.everywhere.status.loading')}</div>;
      case 'idle':
        return <div className="kairo-everywhere-status kairo-empty-state">{t('widget.search.everywhere.status.idle')}</div>;
      case 'empty':
        return <div className="kairo-everywhere-status kairo-empty-state">{t('widget.search.everywhere.status.empty')}</div>;
      case 'error':
        return <div className="kairo-everywhere-status kairo-error-banner" role="alert">{state.error?.message}</div>;
      case 'results':
        return undefined;
    }
  };

  return <div className="kairo-everywhere" data-testid="search-everywhere" ref={containerRef} onKeyDown={keyDown} role="dialog" aria-modal="true" aria-label={t('widget.search.everywhere.title')}>
    <input autoFocus className="theia-input kairo-everywhere-input" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('widget.search.everywhere.placeholder')} aria-label={t('widget.search.everywhere.ariaLabel.query')} data-testid="everywhere-query" />
    <nav className="kairo-everywhere-tabs" aria-label={t('widget.search.everywhere.ariaLabel.categories')}>
      {CATEGORIES.map(category => <button key={category} type="button" className={state.category === category ? 'is-active' : ''} aria-label={t('widget.search.everywhere.category.ariaLabel', { category: t(`widget.search.everywhere.category.${category}`) })} aria-pressed={state.category === category} onClick={() => void model.query(query, category, 100)} data-testid={`category-${category}`}><span className={`codicon ${categoryIcon(category)}`} aria-hidden="true" /> {t(`widget.search.everywhere.category.${category}`)}</button>)}
    </nav>
    <div className="kairo-everywhere-body">
      {renderStatus()}
      {state.items.length > 0 && (
        <VirtualList
          items={state.items}
          rowHeight={ROW_HEIGHT}
          selectedIndex={state.selectedIndex}
          className="kairo-everywhere-list"
          role="listbox"
          ariaLabel={t('widget.search.everywhere.ariaLabel.query')}
          keyboardNavigation={false}
          scrollToIndex={state.selectedIndex}
          renderItem={(item, index, isSelected) => (
            <button type="button" role="option" aria-selected={isSelected} className={`kairo-everywhere-item${isSelected ? ' is-selected' : ''}`} key={item.id} onMouseEnter={() => { if (index !== state.selectedIndex) model.select(index); }} onClick={() => void openItem(item)} data-testid="everywhere-item">
              <span className="kairo-everywhere-kind"><span className={`codicon ${item.kind !== undefined ? symbolKindIcon(item.kind) : categoryIcon(item.category)}`} aria-hidden="true" /></span><span>{item.label}</span><small>{item.detail}</small>
            </button>
          )}
        />
      )}
    </div>
  </div>;
};

@injectable()
export class SearchEverywhereWidget extends ReactWidget {
  static readonly ID = 'kairo-search-everywhere';
  @inject(SearchEverywhereModel) protected readonly model!: SearchEverywhereModel;
  @inject(EditorManager) protected readonly editors!: EditorManager;
  @inject(CommandService) protected readonly commands!: CommandService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  protected state: SearchEverywhereState = { status: 'idle', query: '', category: 'all', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super(); this.id = SearchEverywhereWidget.ID; this.title.closable = true; this.addClass('kairo-search-everywhere-widget');
  }

  @postConstruct()
  protected init(): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);
    const updateTitle = (): void => {
      this.title.label = t('widget.search.everywhere.title');
      this.title.caption = t('widget.search.everywhere.caption');
    };
    updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      updateTitle();
      this.update();
    }));
  }

  protected onAfterAttach(message: Message): void { super.onAfterAttach(message); this.unsubscribe ??= this.model.subscribe(state => { this.state = state; this.update(); }); }
  dispose(): void { this.unsubscribe?.(); this.model.cancel(); super.dispose(); }
  protected async open(item: SearchEverywhereItem): Promise<void> {
    this.model.remember(item);
    if (item.commandId) await this.commands.executeCommand(item.commandId);
    else if (item.uri) await this.editors.open(new URI(item.uri), { mode: 'activate', selection: item.line === undefined ? undefined : { start: { line: item.line, character: item.character ?? 0 } } });
  }
  protected render(): React.ReactNode { return <SearchEverywhereComponent model={this.model} state={this.state} onOpen={item => void this.open(item)} i18n={this.i18n} />; }
}
