import * as React from 'react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FindClassModel, type FindClassItem, type FindClassState } from './find-class-model';
import { VirtualList } from '@kairo/ui-kit';

const ROW_HEIGHT = 28;

function classKindIcon(kind: number): string {
  switch (kind) {
    case 5: return '\uD83C\uDFD7';  // Class
    case 10: return '\uD83D\uDDDD'; // Enum
    case 11: return '\u25CB';       // Interface
    case 23: return '\uD83D\uDEE0'; // Struct
    default: return '\uD83C\uDFD7';
  }
}

export interface FindClassProps {
  model: FindClassModel;
  state: FindClassState;
  onOpen: (item: FindClassItem) => Promise<unknown>;
  onClose: () => void;
}

export const FindClassComponent: React.FC<FindClassProps> = ({ model, state, onOpen, onClose }) => {
  const [query, setQuery] = React.useState(state.query);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [openError, setOpenError] = React.useState<Error | undefined>();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();

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
      return <div className="kairo-find-status is-error" role="alert">{openError.message}</div>;
    }
    switch (state.status) {
      case 'loading':
        return <div className="kairo-find-status" role="status">搜索类中…</div>;
      case 'idle':
        return <div className="kairo-find-status">输入类名进行搜索</div>;
      case 'empty':
        return <div className="kairo-find-status">未找到匹配的类</div>;
      case 'error':
        return <div className="kairo-find-status is-error" role="alert">{state.error?.message ?? '搜索失败'}</div>;
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
        aria-label="查找类"
        data-testid="find-class"
      >
        <div className="kairo-find-header">
          <input
            autoFocus
            className="theia-input kairo-find-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="输入类名搜索 (e.g. UserController)"
            aria-label="类名搜索"
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
            ariaLabel="类搜索结果"
            testId="find-class-results"
            renderItem={(item, _index, isSelected) => (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-find-item${isSelected ? ' is-selected' : ''}`}
                style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px' }}
                onMouseEnter={() => { setSelectedIndex(_index); model.select(_index); }}
                onClick={() => void openItem(item)}
                data-testid="find-class-result"
              >
                <span className="kairo-find-kind">{classKindIcon(item.kind)}</span>
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

  protected state: FindClassState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.id = FindClassWidget.ID;
    this.title.label = '查找类';
    this.title.closable = true;
    this.addClass('kairo-find-class-widget');
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
      />
    );
  }
}