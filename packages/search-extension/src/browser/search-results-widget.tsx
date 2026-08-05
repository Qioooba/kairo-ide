import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { SearchMatch } from '@kairo/protocol';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import { VirtualList } from '@kairo/ui-kit';
import { KairoSearchSessionModel, type SearchSessionState } from './search-session-model';
import { resolveWorkspaceMatchUri } from './search-path';
import { groupMatchesByFile, getSearchFileName, getSearchFileDir, getSearchFileIcon, matchPreviewParts } from './search-result-utils';
import './search-center.css';

/**
 * IDEA-style docked "Find" tool window.
 * Shares KairoSearchSessionModel with the Find in Path popup so results
 * stay available after the dialog is closed.
 */
@injectable()
export class SearchResultsWidget extends ReactWidget {
  static readonly ID = 'kairo-search-results';
  static readonly LABEL = 'Find';

  @inject(KairoSearchSessionModel) protected readonly model!: KairoSearchSessionModel;
  @inject(WorkspaceContextService) protected readonly workspaceContext!: WorkspaceContextService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected state: SearchSessionState = {
    status: 'idle', requestId: 0, matches: [], totalMatches: 0, truncated: false, erroredFiles: [],
  };
  protected unsubscribe: (() => void) | undefined;
  protected selectedIndex = 0;
  protected collapsedFiles = new Set<string>();

  constructor() {
    super();
    this.id = SearchResultsWidget.ID;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-search';
    this.addClass('kairo-search-results-widget');
  }

  @postConstruct()
  protected init(): void {
    const updateTitles = (): void => {
      this.title.label = this.i18n.t('widget.search.results.title' as any);
      this.title.caption = this.i18n.t('widget.search.results.caption' as any);
    };
    updateTitles();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      updateTitles();
      this.update();
    }));
  }

  protected onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    if (!this.unsubscribe) {
      this.unsubscribe = this.model.subscribe(state => {
        this.state = state;
        this.update();
      });
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    super.dispose();
  }

  protected async openMatch(match: SearchMatch, preserveFocus = false): Promise<void> {
    const context = this.workspaceContext.requireContext();
    const start = { line: Math.max(0, match.line - 1), character: Math.max(0, match.column - 1) };
    await this.editorManager.open(resolveWorkspaceMatchUri(context.workspaceRoot, match.file), {
      mode: preserveFocus ? 'reveal' : 'activate',
      selection: { start, end: { line: start.line, character: start.character + Math.max(1, match.matchText.length) } },
      revealOption: 'centerIfOutsideViewport',
    });
  }

  protected render(): React.ReactNode {
    return (
      <SearchResultsPanel
        state={this.state}
        selectedIndex={this.selectedIndex}
        collapsedFiles={this.collapsedFiles}
        onSelectIndex={index => { this.selectedIndex = index; this.update(); }}
        onToggleCollapse={file => {
          if (this.collapsedFiles.has(file)) this.collapsedFiles.delete(file);
          else this.collapsedFiles.add(file);
          this.update();
        }}
        onOpen={(match, preserve) => void this.openMatch(match, preserve)}
        onCancel={() => this.model.cancelStream()}
        i18n={this.i18n}
      />
    );
  }
}

export interface SearchResultsPanelProps {
  state: SearchSessionState;
  selectedIndex: number;
  collapsedFiles: Set<string>;
  onSelectIndex: (index: number) => void;
  onToggleCollapse: (file: string) => void;
  onOpen: (match: SearchMatch, preserveFocus?: boolean) => void;
  onCancel: () => void;
  i18n: KairoI18nService;
}

interface FlatItem {
  kind: 'header' | 'match';
  file?: string;
  matchCount?: number;
  match?: SearchMatch;
  flatIndex: number;
  collapsed?: boolean;
}

export const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  state,
  selectedIndex,
  collapsedFiles,
  onSelectIndex,
  onToggleCollapse,
  onOpen,
  onCancel,
  i18n,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const groups = React.useMemo(() => groupMatchesByFile(state.matches), [state.matches]);
  const flatItems = React.useMemo((): FlatItem[] => {
    let idx = 0;
    const items: FlatItem[] = [];
    for (const group of groups) {
      const isCollapsed = collapsedFiles.has(group.file);
      items.push({ kind: 'header', file: group.file, matchCount: group.matches.length, flatIndex: idx++, collapsed: isCollapsed });
      if (!isCollapsed) {
        for (const match of group.matches) {
          items.push({ kind: 'match', match, flatIndex: idx++ });
        }
      }
    }
    return items;
  }, [groups, collapsedFiles]);

  const isStreaming = state.streamState?.status === 'streaming';
  const fileCount = groups.length;
  const matchCount = state.totalMatches || state.matches.length;

  return (
    <div className="kairo-find-tool-window" data-testid="search-results-panel">
      <div className="kairo-find-tool-toolbar">
        <span className="codicon codicon-search" aria-hidden="true" />
        <span className="kairo-find-tool-title">{t('widget.search.results.title')}</span>
        <span className="kairo-find-tool-stats" data-testid="find-tool-count">
          {matchCount > 0
            ? t('widget.search.center.stats.matchInFiles', { count: matchCount, fileCount })
            : t('widget.search.center.status.idle')}
          {isStreaming ? t('widget.search.center.stats.streaming') : ''}
        </span>
        {state.status === 'loading' && (
          <button type="button" className="kairo-search-footer-btn" onClick={onCancel} data-testid="find-tool-cancel">
            {t('widget.search.center.cancel')}
          </button>
        )}
      </div>
      {state.status === 'empty' && (
        <div className="kairo-search-status kairo-empty-state" data-testid="find-tool-empty">
          {t('widget.search.center.status.empty')}
        </div>
      )}
      {state.status === 'error' && (
        <div className="kairo-search-status kairo-error-banner" role="alert">
          {t('widget.search.center.status.error', { message: state.error?.message ?? t('widget.search.center.status.unknownError') })}
        </div>
      )}
      {(state.status === 'results' || state.status === 'loading') && state.matches.length > 0 && (
        <VirtualList
          items={flatItems}
          rowHeight={22}
          selectedIndex={selectedIndex}
          onSelectIndex={index => {
            onSelectIndex(index);
            if (flatItems[index]?.kind === 'match' && flatItems[index].match) {
              onOpen(flatItems[index].match!, true);
            }
          }}
          className="kairo-search-results kairo-find-tool-list"
          ariaLabel={t('widget.search.center.ariaLabel.results')}
          testId="find-tool-results"
          renderItem={(item, _index, isSelected) => {
            if (item.kind === 'header') {
              const file = item.file || '';
              return (
                <button
                  type="button"
                  className="kairo-search-result-group"
                  onClick={() => item.file && onToggleCollapse(item.file)}
                  data-testid="find-tool-group"
                >
                  <span className={`codicon kairo-search-chevron ${item.collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden="true" />
                  <span className={`codicon ${getSearchFileIcon(getSearchFileName(file))}`} aria-hidden="true" />
                  <span className="kairo-search-result-filename">{getSearchFileName(file)}</span>
                  <span className="kairo-search-result-filepath">{getSearchFileDir(file)}</span>
                  <span className="kairo-search-result-count">{item.matchCount}</span>
                </button>
              );
            }
            const match = item.match!;
            const preview = matchPreviewParts(match);
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-search-result-item${isSelected ? ' is-selected' : ''}`}
                onClick={() => onOpen(match)}
                data-testid="find-tool-result"
              >
                <span className="kairo-search-result-lineno">{match.line}</span>
                <span className="kairo-search-result-preview">
                  {preview.before}
                  {preview.highlight
                    ? <span className="kairo-search-highlight">{preview.highlight}</span>
                    : null}
                  {preview.after}
                </span>
              </button>
            );
          }}
        />
      )}
    </div>
  );
};
