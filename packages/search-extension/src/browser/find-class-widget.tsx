import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { KairoI18nService } from '@kairo/i18n';
import { FindClassModel, type FindClassItem, type FindClassState } from './find-class-model';
import { VirtualList } from '@kairo/ui-kit';

const ROW_HEIGHT = 28;

function classKindIcon(kind: number): string {
  switch (kind) {
    case 5: return 'codicon-symbol-class';
    case 10: return 'codicon-symbol-enum';
    case 11: return 'codicon-symbol-interface';
    case 23: return 'codicon-symbol-struct';
    default: return 'codicon-symbol-class';
  }
}

export interface FindClassProps {
  model: FindClassModel;
  state: FindClassState;
  onOpen: (item: FindClassItem) => Promise<unknown>;
  onClose: () => void;
  i18n: KairoI18nService;
}

export const FindClassComponent: React.FC<FindClassProps> = ({ model, state, onOpen, onClose, i18n }) => {
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

  const openItem = async (item: FindClassItem): Promise<void> => {
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
        return <div className="kairo-find-status kairo-empty-state" role="status">{t('widget.search.findClass.status.loading')}</div>;
      case 'idle':
        return <div className="kairo-find-status kairo-empty-state">{t('widget.search.findClass.status.idle')}</div>;
      case 'empty':
        return <div className="kairo-find-status kairo-empty-state">{t('widget.search.findClass.status.empty')}</div>;
      case 'error':
        return <div className="kairo-find-status kairo-error-banner" role="alert">{state.error?.message ?? t('widget.search.findClass.status.unknownError')}</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <div className="kairo-find-modal-backdrop" onClick={() => onClose()} data-testid="find-class-backdrop">
      <div
        className="kairo-find-modal"
        ref={containerRef}
        onKeyDown={keyDown}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('widget.search.findClass.title')}
        data-testid="find-class"
      >
        <div className="kairo-find-header">
          <input
            autoFocus
            className="theia-input kairo-find-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('widget.search.findClass.placeholder')}
            aria-label={t('widget.search.findClass.ariaLabel.query')}
            data-testid="find-class-query"
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
            ariaLabel={t('widget.search.findClass.ariaLabel.results')}
            testId="find-class-results"
            renderItem={(item, _index, isSelected) => (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-find-item${isSelected ? ' is-selected' : ''}`}
                onMouseEnter={() => { if (_index !== selectedIndex) { setSelectedIndex(_index); model.select(_index); } }}
                onClick={() => void openItem(item)}
                data-testid="find-class-result"
              >
                <span className="kairo-find-kind"><span className={`codicon ${classKindIcon(item.kind)}`} aria-hidden="true" /></span>
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
export class FindClassWidget extends ReactWidget {
  static readonly ID = 'kairo-find-class';

  @inject(FindClassModel) protected readonly model!: FindClassModel;
  @inject(EditorManager) protected readonly editors!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected state: FindClassState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.id = FindClassWidget.ID;
    this.title.closable = true;
    this.addClass('kairo-find-class-widget');
  }

  @postConstruct()
  protected init(): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);
    const updateTitle = (): void => {
      this.title.label = t('widget.search.findClass.title');
      this.title.caption = t('widget.search.findClass.caption');
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

  protected async open(item: FindClassItem): Promise<void> {
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
      <FindClassComponent
        model={this.model}
        state={this.state}
        onOpen={item => this.open(item)}
        onClose={() => this.close()}
        i18n={this.i18n}
      />
    );
  }
}
