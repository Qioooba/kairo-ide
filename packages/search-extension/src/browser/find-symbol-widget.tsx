import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { KairoI18nService } from '@kairo/i18n';
import { JavaLanguageClient } from '@kairo/java-extension';
import { fuzzyScore } from './search-everywhere-model';
import { VirtualList } from '@kairo/ui-kit';

const ROW_HEIGHT = 28;

interface FindSymbolItem {
  id: string;
  label: string;
  detail: string;
  uri: string;
  line: number;
  character: number;
  kind: number;
  score: number;
}

interface FindSymbolState {
  status: 'idle' | 'loading' | 'results' | 'empty' | 'error';
  query: string;
  items: readonly FindSymbolItem[];
  selectedIndex: number;
  error?: Error;
}

type FindSymbolListener = (state: FindSymbolState) => void;

const SYMBOL_KINDS = new Set([6, 7, 8, 9, 12, 13, 14]); // Method, Property, Field, Constructor, Function, Variable, Constant

function symbolKindIcon(kind: number): string {
  switch (kind) {
    case 6: return 'codicon-symbol-method';
    case 7: return 'codicon-symbol-property';
    case 8: return 'codicon-symbol-field';
    case 9: return 'codicon-symbol-constructor';
    case 12: return 'codicon-symbol-function';
    case 13: return 'codicon-symbol-variable';
    case 14: return 'codicon-symbol-constant';
    default: return 'codicon-symbol-method';
  }
}

@injectable()
export class FindSymbolModel {
  @inject(JavaLanguageClient) protected readonly java!: JavaLanguageClient;

  protected state: FindSymbolState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected readonly listeners = new Set<FindSymbolListener>();
  protected controller: AbortController | undefined;
  protected generation = 0;

  get snapshot(): FindSymbolState { return this.state; }

  subscribe(listener: FindSymbolListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async query(query: string, limit = 30): Promise<FindSymbolState> {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const trimmed = query.trim();

    if (!trimmed) {
      this.publish({ status: 'idle', query: '', items: [], selectedIndex: 0 });
      return this.state;
    }

    this.publish({ status: 'loading', query: trimmed, items: [], selectedIndex: 0 });

    try {
      // An unavailable language server must degrade to "No results", not an
      // error — the LS being stopped is a normal state, not a failure.
      let symbols: Awaited<ReturnType<JavaLanguageClient['workspaceSymbols']>> = [];
      try {
        symbols = await this.java.workspaceSymbols(trimmed);
      } catch {
        symbols = [];
      }
      if (controller.signal.aborted || generation !== this.generation) return this.state;

      const items = (symbols ?? [])
        .filter((symbol: { kind: number; name: string; containerName?: string; location: { uri: string; range: { start: { line: number; character: number } } } }) => SYMBOL_KINDS.has(symbol.kind))
        .map((symbol: { kind: number; name: string; containerName?: string; location: { uri: string; range: { start: { line: number; character: number } } } }) => {
          const containerName = symbol.containerName ?? '';
          const score = fuzzyScore(trimmed, symbol.name) ?? 0;
          return {
            id: `symbol:${symbol.location.uri}:${symbol.location.range.start.line}:${symbol.name}`,
            label: symbol.name,
            detail: containerName,
            uri: symbol.location.uri,
            line: symbol.location.range.start.line,
            character: symbol.location.range.start.character,
            kind: symbol.kind,
            score,
          };
        })
        .sort((a: { score: number; label: string }, b: { score: number; label: string }) => (b.score - a.score) || a.label.localeCompare(b.label))
        .slice(0, limit);

      this.publish({ status: items.length ? 'results' : 'empty', query: trimmed, items, selectedIndex: 0 });
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generation) {
        this.publish({ status: 'error', query: trimmed, items: [], selectedIndex: 0, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    return this.state;
  }

  select(index: number): void {
    if (!this.state.items.length) return;
    const selectedIndex = (index + this.state.items.length) % this.state.items.length;
    this.publish({ ...this.state, selectedIndex });
  }

  cancel(): void { this.controller?.abort(); }

  protected publish(state: FindSymbolState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { try { console.error('Find Symbol listener failed', error); } catch {} }
    }
  }
}

export interface FindSymbolProps {
  model: FindSymbolModel;
  state: FindSymbolState;
  onOpen: (item: FindSymbolItem) => Promise<unknown>;
  onClose: () => void;
  i18n: KairoI18nService;
}

export const FindSymbolComponent: React.FC<FindSymbolProps> = ({ model, state, onOpen, onClose, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [query, setQuery] = React.useState(state.query);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [openError, setOpenError] = React.useState<Error | undefined>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void model.query(query, 30);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [model, query]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [state.query]);

  const items = state.items;

  const openItem = async (item: FindSymbolItem): Promise<void> => {
    setOpenError(undefined);
    try {
      await onOpen(item);
      onClose();
    } catch (error) {
      setOpenError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(selectedIndex + 1, items.length - 1);
      setSelectedIndex(next);
      model.select(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(prev);
      model.select(prev);
    } else if (event.key === 'Enter' && items[selectedIndex]) {
      event.preventDefault();
      void openItem(items[selectedIndex]);
    } else if (event.key === 'Tab') {
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

  const renderStatus = (): React.ReactNode => {
    if (openError) {
      return <div className="kairo-find-status kairo-error-banner" role="alert">{openError.message}</div>;
    }
    switch (state.status) {
      case 'loading':
        return <div className="kairo-find-status kairo-empty-state" role="status">{t('widget.search.findSymbol.status.loading')}</div>;
      case 'idle':
        return <div className="kairo-find-status kairo-empty-state">{t('widget.search.findSymbol.status.idle')}</div>;
      case 'empty':
        return <div className="kairo-find-status kairo-empty-state">{t('widget.search.findSymbol.status.empty')}</div>;
      case 'error':
        return <div className="kairo-find-status kairo-error-banner" role="alert">{state.error?.message ?? t('widget.search.findSymbol.status.unknownError')}</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <div className="kairo-find-modal-backdrop" onClick={() => onClose()} data-testid="find-symbol-backdrop">
      <div
        className="kairo-find-modal"
        ref={containerRef}
        onKeyDown={keyDown}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('widget.search.findSymbol.title')}
        data-testid="find-symbol"
      >
        <div className="kairo-find-header">
          <input
            autoFocus
            className="theia-input kairo-find-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('widget.search.findSymbol.placeholder')}
            aria-label={t('widget.search.findSymbol.ariaLabel.query')}
            data-testid="find-symbol-query"
          />
        </div>
        {renderStatus()}
        {(state.status === 'results' || state.status === 'loading') && items.length > 0 && (
          <VirtualList
            items={items}
            rowHeight={ROW_HEIGHT}
            selectedIndex={selectedIndex}
            onSelectIndex={index => { setSelectedIndex(index); model.select(index); }}
            className="kairo-find-results"
            ariaLabel={t('widget.search.findSymbol.ariaLabel.results')}
            testId="find-symbol-results"
            renderItem={(item, _index, isSelected) => (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-find-item${isSelected ? ' is-selected' : ''}`}
                onMouseEnter={() => { if (_index !== selectedIndex) { setSelectedIndex(_index); model.select(_index); } }}
                onClick={() => void openItem(item)}
                data-testid="find-symbol-result"
              >
                <span className="kairo-find-kind"><span className={`codicon ${symbolKindIcon(item.kind)}`} aria-hidden="true" /></span>
                <span className="kairo-find-label">{item.label}</span>
                <span className="kairo-find-detail">{item.detail}</span>
              </button>
            )}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.defaultPrevented && items[selectedIndex]) {
                event.preventDefault();
                void openItem(items[selectedIndex]);
              }
            }}
          />
        )}
      </div>
    </div>
  );
};

@injectable()
export class FindSymbolWidget extends ReactWidget {
  static readonly ID = 'kairo-find-symbol';

  @inject(FindSymbolModel) protected readonly model!: FindSymbolModel;
  @inject(EditorManager) protected readonly editors!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected state: FindSymbolState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.id = FindSymbolWidget.ID;
    this.title.closable = true;
    this.addClass('kairo-find-symbol-widget');
  }

  @postConstruct()
  protected init(): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);
    const updateTitle = (): void => {
      this.title.label = t('widget.search.findSymbol.title');
      this.title.caption = t('widget.search.findSymbol.caption');
    };
    updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      updateTitle();
      this.update();
    }));
  }

  /** IDEA popups close on Escape regardless of inner focus. */
  protected readonly handleEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  protected override onBeforeDetach(message: Message): void {
    window.removeEventListener('keydown', this.handleEscape, true);
    super.onBeforeDetach(message);
  }

  protected onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    window.addEventListener('keydown', this.handleEscape, true);
    this.unsubscribe ??= this.model.subscribe(state => {
      this.state = state;
      this.update();
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.model.cancel();
    super.dispose();
  }

  protected async open(item: FindSymbolItem): Promise<void> {
    await this.editors.open(new URI(item.uri), {
      mode: 'activate',
      selection: {
        start: { line: item.line, character: item.character },
        end: { line: item.line, character: item.character + item.label.length },
      },
    });
  }

  protected render(): React.ReactNode {
    return (
      <FindSymbolComponent
        model={this.model}
        state={this.state}
        onOpen={item => this.open(item)}
        onClose={() => this.close()}
        i18n={this.i18n}
      />
    );
  }
}
