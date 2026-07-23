import * as React from 'react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FindFileModel, type FindFileItem, type FindFileState } from './find-file-model';
import { VirtualList } from '@kairo/ui-kit';

const ROW_HEIGHT = 28;

export interface FindFileProps {
  model: FindFileModel;
  state: FindFileState;
  onOpen: (item: FindFileItem) => Promise<unknown>;
  onClose: () => void;
}

export const FindFileComponent: React.FC<FindFileProps> = ({ model, state, onOpen, onClose }) => {
  const [query, setQuery] = React.useState(state.query);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [openError, setOpenError] = React.useState<Error | undefined>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void model.query(query, 50);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [model, query]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [state.query]);

  const items = state.items;

  const openItem = async (item: FindFileItem): Promise<void> => {
    setOpenError(undefined);
    try {
      model.remember(item);
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
      return <div className="kairo-find-status is-error" role="alert">{openError.message}</div>;
    }
    switch (state.status) {
      case 'loading':
        return <div className="kairo-find-status" role="status">搜索中…</div>;
      case 'idle':
        return <div className="kairo-find-status">输入文件名进行搜索，最近打开的文件将显示在这里</div>;
      case 'empty':
        return <div className="kairo-find-status">未找到匹配的文件</div>;
      case 'error':
        return <div className="kairo-find-status is-error" role="alert">{state.error?.message ?? '搜索失败'}</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <div className="kairo-find-modal-backdrop" onClick={() => onClose()} data-testid="find-file-backdrop">
      <div
        className="kairo-find-modal"
        ref={containerRef}
        onKeyDown={keyDown}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="查找文件"
        data-testid="find-file"
      >
        <div className="kairo-find-header">
          <input
            autoFocus
            className="theia-input kairo-find-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="输入文件名搜索 (e.g. UserController.java)"
            aria-label="文件名搜索"
            data-testid="find-file-query"
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
            ariaLabel="文件搜索结果"
            testId="find-file-results"
            renderItem={(item, _index, isSelected) => (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-find-item${isSelected ? ' is-selected' : ''}`}
                style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px' }}
                onMouseEnter={() => { setSelectedIndex(_index); model.select(_index); }}
                onClick={() => void openItem(item)}
                data-testid="find-file-result"
              >
                <span className="codicon codicon-file" aria-hidden="true" />
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
export class FindFileWidget extends ReactWidget {
  static readonly ID = 'kairo-find-file';

  @inject(FindFileModel) protected readonly model!: FindFileModel;
  @inject(EditorManager) protected readonly editors!: EditorManager;

  protected state: FindFileState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.id = FindFileWidget.ID;
    this.title.label = '查找文件';
    this.title.closable = true;
    this.addClass('kairo-find-file-widget');
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

  protected async open(item: FindFileItem): Promise<void> {
    await this.editors.open(new URI(item.uri), { mode: 'activate' });
  }

  protected render(): React.ReactNode {
    return (
      <FindFileComponent
        model={this.model}
        state={this.state}
        onOpen={item => this.open(item)}
        onClose={() => this.close()}
      />
    );
  }
}