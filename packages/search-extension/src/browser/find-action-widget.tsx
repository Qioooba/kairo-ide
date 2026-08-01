import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService } from '@theia/core/lib/common/command';
import { KairoI18nService } from '@kairo/i18n';
import { FindActionModel, type FindActionItem, type FindActionState } from './find-action-model';
import { VirtualList } from '@kairo/ui-kit';

const ROW_HEIGHT = 28;

export interface FindActionProps {
  model: FindActionModel;
  state: FindActionState;
  onOpen: (item: FindActionItem) => Promise<unknown>;
  onClose: () => void;
  i18n: KairoI18nService;
}

export const FindActionComponent: React.FC<FindActionProps> = ({ model, state, onOpen, onClose, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [query, setQuery] = React.useState(state.query);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [openError, setOpenError] = React.useState<Error | undefined>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      model.query(query, 30);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [model, query]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [state.query]);

  const items = state.items;

  const openItem = async (item: FindActionItem): Promise<void> => {
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
        return <div className="kairo-find-status kairo-empty-state" role="status">{t('widget.search.findAction.status.loading')}</div>;
      case 'idle':
        return <div className="kairo-find-status kairo-empty-state">{t('widget.search.findAction.status.idle')}</div>;
      case 'empty':
        return <div className="kairo-find-status kairo-empty-state">{t('widget.search.findAction.status.empty')}</div>;
      case 'error':
        return <div className="kairo-find-status kairo-error-banner" role="alert">{state.error?.message ?? t('widget.search.findAction.status.unknownError')}</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <div className="kairo-find-modal-backdrop" onClick={() => onClose()} data-testid="find-action-backdrop">
      <div
        className="kairo-find-modal"
        ref={containerRef}
        onKeyDown={keyDown}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('widget.search.findAction.title')}
        data-testid="find-action"
      >
        <div className="kairo-find-header">
          <input
            autoFocus
            className="theia-input kairo-find-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('widget.search.findAction.placeholder')}
            aria-label={t('widget.search.findAction.ariaLabel.query')}
            data-testid="find-action-query"
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
            ariaLabel={t('widget.search.findAction.ariaLabel.results')}
            testId="find-action-results"
            renderItem={(item, _index, isSelected) => (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-find-item${isSelected ? ' is-selected' : ''}`}
                onMouseEnter={() => { setSelectedIndex(_index); model.select(_index); }}
                onClick={() => void openItem(item)}
                data-testid="find-action-result"
              >
                <span className="kairo-find-kind"><span className="codicon codicon-symbol-event" aria-hidden="true" /></span>
                <span className="kairo-find-label">{item.label}</span>
                <span className="kairo-find-shortcut">{item.detail}</span>
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
export class FindActionWidget extends ReactWidget {
  static readonly ID = 'kairo-find-action';

  @inject(FindActionModel) protected readonly model!: FindActionModel;
  @inject(CommandService) protected readonly commands!: CommandService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected state: FindActionState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.id = FindActionWidget.ID;
    this.title.closable = true;
    this.addClass('kairo-find-action-widget');
  }

  @postConstruct()
  protected init(): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);
    const updateTitle = (): void => {
      this.title.label = t('widget.search.findAction.title');
      this.title.caption = t('widget.search.findAction.caption');
    };
    updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      updateTitle();
      this.update();
    }));
  }

  protected onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
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

  protected async open(item: FindActionItem): Promise<void> {
    await this.commands.executeCommand(item.commandId);
  }

  protected render(): React.ReactNode {
    return (
      <FindActionComponent
        model={this.model}
        state={this.state}
        onOpen={item => this.open(item)}
        onClose={() => this.close()}
        i18n={this.i18n}
      />
    );
  }
}
