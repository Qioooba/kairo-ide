import * as React from 'react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { SearchMatch } from '@kairo/protocol';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoSearchSessionModel, type SearchSessionState } from './search-session-model';
import { SearchReplaceService, type ReplaceApplyResult, type ReplacePlan } from './search-replace-service';
import { resolveWorkspaceMatchUri } from './search-path';
import { SearchScopeModel, type SearchScope, type GroupMode, type SearchHistoryEntry as _SearchHistoryEntry, SCOPE_OPTIONS, GROUP_MODE_OPTIONS } from './search-scope-model';
import { VirtualList } from '@kairo/ui-kit';
import './search-center.css';

export interface SearchCenterQuery {
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include?: string[];
  exclude?: string[];
}

export interface SearchCenterProps {
  state: SearchSessionState;
  onSearch: (query: SearchCenterQuery) => Promise<unknown> | unknown;
  onCancel: () => void;
  onOpen: (match: SearchMatch) => Promise<unknown> | unknown;
  onCreateReplacePlan?: (matches: readonly SearchMatch[], replacement: string) => Promise<ReplacePlan>;
  onApplyReplacePlan?: (plan: ReplacePlan) => Promise<ReplaceApplyResult[]>;
  onUndoReplace?: () => Promise<ReplaceApplyResult[]>;
  /** Called when the user clicks "继续加载" to load the next batch. */
  onLoadMore?: () => void;
  /** Whether a "继续加载" button should be shown. */
  showLoadMore?: boolean;
  /** Whether more results are expected (streaming is still active). */
  isStreaming?: boolean;
  /** Scope model for scope/group/filter/history */
  scopeModel?: SearchScopeModel;
}

export interface SearchResultGroup {
  file: string;
  matches: readonly SearchMatch[];
}

export function groupMatchesByFile(matches: readonly SearchMatch[]): SearchResultGroup[] {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.file);
    if (group) {
      group.push(match);
    } else {
      groups.set(match.file, [match]);
    }
  }
  return [...groups].map(([file, grouped]) => ({ file, matches: grouped }));
}

export function parseGlobInput(value: string): string[] | undefined {
  const values = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
  return values.length > 0 ? values : undefined;
}

// --- Flattened search items (for VirtualList) ---

const VIRTUAL_ROW_HEIGHT = 24;

interface FlatSearchItem {
  kind: 'header' | 'match';
  file?: string;
  matchCount?: number;
  match?: SearchMatch;
  flatIndex: number;
}

export const SearchCenterComponent: React.FC<SearchCenterProps> = ({ state, onSearch, onCancel, onOpen, onCreateReplacePlan, onApplyReplacePlan, onUndoReplace, onLoadMore, showLoadMore, isStreaming, scopeModel }) => {
  const [query, setQuery] = React.useState('');
  const [include, setInclude] = React.useState('');
  const [exclude, setExclude] = React.useState('');
  const [isRegex, setRegex] = React.useState(false);
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [wholeWord, setWholeWord] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [submissionError, setSubmissionError] = React.useState<Error | undefined>();
  const [replacement, setReplacement] = React.useState('');
  const [replacePlan, setReplacePlan] = React.useState<ReplacePlan | undefined>();
  const [applyResults, setApplyResults] = React.useState<ReplaceApplyResult[]>([]);
  const [applying, setApplying] = React.useState(false);
  const [canUndo, setCanUndo] = React.useState(false);
  const [scope, setScope] = React.useState<SearchScope>('project');
  const [groupMode, setGroupMode] = React.useState<GroupMode>('by-file');
  const [fileTypes, setFileTypes] = React.useState('');
  const [modifiedOnly, setModifiedOnly] = React.useState(false);
  const [excludeGenerated, setExcludeGenerated] = React.useState(true);
  const [showHistory, setShowHistory] = React.useState(false);

  const matches = state.matches;
  const groups = React.useMemo(() => groupMatchesByFile(matches), [matches]);

  // Flatten groups into virtual list items
  const flatItems = React.useMemo((): FlatSearchItem[] => {
    let idx = 0;
    const items: FlatSearchItem[] = [];
    for (const group of groups) {
      items.push({ kind: 'header', file: group.file, matchCount: group.matches.length, flatIndex: idx++ });
      for (const match of group.matches) {
        items.push({ kind: 'match', match, flatIndex: idx++ });
      }
    }
    return items;
  }, [groups]);

  React.useEffect(() => {
    const firstMatch = flatItems.findIndex(item => item.kind === 'match');
    setSelectedIndex(firstMatch >= 0 ? firstMatch : 0);
  }, [state.requestId, flatItems]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }
    setSubmissionError(undefined);
    scopeModel?.setScope(scope);
    scopeModel?.setGroupMode(groupMode);
    scopeModel?.setFileTypes(fileTypes);
    scopeModel?.setModifiedOnly(modifiedOnly);
    scopeModel?.setExcludeGenerated(excludeGenerated);
    scopeModel?.addToHistory({
      query: query.trim(),
      isRegex,
      caseSensitive,
      wholeWord,
      scope,
      timestamp: Date.now(),
    });
    setShowHistory(false);
    try {
      await onSearch({
        query: query.trim(),
        isRegex,
        caseSensitive,
        wholeWord,
        include: parseGlobInput(include),
        exclude: parseGlobInput(exclude),
      });
    } catch (error) {
      setSubmissionError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const openSelected = async (match: SearchMatch): Promise<void> => {
    setSubmissionError(undefined);
    try {
      await onOpen(match);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const renderStatus = (): React.ReactNode => {
    if (submissionError) {
      return <div className="kairo-search-state is-error" role="alert" data-testid="search-error">{submissionError.message}</div>;
    }
    switch (state.status) {
      case 'idle':
        return <div className="kairo-search-state" data-testid="search-idle">Search across the current workspace.</div>;
      case 'loading':
        if (matches.length === 0) {
          return (
            <div className="kairo-search-state is-loading" role="status" data-testid="search-loading">
              <span className="kairo-search-spinner" aria-hidden="true" /> Searching…
              <button type="button" className="theia-button secondary" onClick={onCancel} data-testid="search-cancel">Cancel</button>
            </div>
          );
        }
        return undefined;
      case 'empty':
        return <div className="kairo-search-state" data-testid="search-empty">No matches found.</div>;
      case 'error':
        return <div className="kairo-search-state is-error" role="alert" data-testid="search-error">Search failed: {state.error?.message ?? 'Unknown error'}</div>;
      case 'cancelled':
        return <div className="kairo-search-state" role="status" data-testid="search-cancelled">Search cancelled.</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <section className="kairo-search-center" aria-label="Kairo Search Center" data-testid="search-center">
      <form className="kairo-search-form" onSubmit={event => void submit(event)} data-testid="search-form">
        <div className="kairo-search-query-row">
          <input
            className="theia-input kairo-search-query"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onFocus={() => { if (!query.trim()) setShowHistory(true); }}
            placeholder="Find text in workspace"
            aria-label="Search text"
            data-testid="search-query"
          />
          <button className="theia-button" type="submit" disabled={!query.trim()} data-testid="search-submit">Search</button>
          <span className="kairo-search-count" aria-live="polite" data-testid="search-count">
            {(state.status === 'results' || state.status === 'loading') && state.totalMatches > 0 ? `${state.totalMatches} result${state.totalMatches === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        {showHistory && !query.trim() && scopeModel && scopeModel.getRecentQueries(10).length > 0 && (
          <div className="kairo-search-history" data-testid="search-history">
            {scopeModel.getRecentQueries(10).map((entry, index) => (
              <div key={index} className="kairo-search-history-item">
                <button
                  type="button"
                  className="kairo-search-history-query"
                  onClick={() => {
                    setQuery(entry.query);
                    setRegex(entry.isRegex);
                    setCaseSensitive(entry.caseSensitive);
                    setWholeWord(entry.wholeWord);
                    setScope(entry.scope);
                    setShowHistory(false);
                  }}
                >
                  {entry.query}
                </button>
                <button
                  type="button"
                  className={`kairo-search-history-pin${scopeModel.isPinned(entry.query) ? ' is-pinned' : ''}`}
                  onClick={() => {
                    if (scopeModel.isPinned(entry.query)) {
                      scopeModel.unpinQuery(entry.query);
                    } else {
                      scopeModel.pinQuery(entry);
                    }
                  }}
                  title={scopeModel.isPinned(entry.query) ? '取消固定' : '固定查询'}
                  aria-label={scopeModel.isPinned(entry.query) ? '取消固定' : '固定查询'}
                  data-testid="search-history-pin"
                >
                  📌
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="kairo-search-filters" aria-label="Search filters">
          <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} data-testid="filter-case" /> Match case</label>
          <label><input type="checkbox" checked={wholeWord} onChange={event => setWholeWord(event.target.checked)} data-testid="filter-word" /> Whole word</label>
          <label><input type="checkbox" checked={isRegex} onChange={event => setRegex(event.target.checked)} data-testid="filter-regex" /> Regex</label>
          <input className="theia-input" value={include} onChange={event => setInclude(event.target.value)} placeholder="Include: **/*.java" aria-label="Include glob patterns" data-testid="filter-include" />
          <input className="theia-input" value={exclude} onChange={event => setExclude(event.target.value)} placeholder="Exclude: target/**" aria-label="Exclude glob patterns" data-testid="filter-exclude" />
        </div>
        <div className="kairo-search-scope" aria-label="Search scope and grouping">
          <select value={scope} onChange={event => { setScope(event.target.value as SearchScope); scopeModel?.setScope(event.target.value as SearchScope); }} data-testid="scope-selector" aria-label="搜索范围">
            {SCOPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select value={groupMode} onChange={event => { setGroupMode(event.target.value as GroupMode); scopeModel?.setGroupMode(event.target.value as GroupMode); }} data-testid="group-selector" aria-label="分组模式">
            {GROUP_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input className="theia-input" value={fileTypes} onChange={event => { setFileTypes(event.target.value); scopeModel?.setFileTypes(event.target.value); }} placeholder="文件类型: *.java, *.xml" aria-label="文件类型过滤" data-testid="filter-file-types" />
          <label><input type="checkbox" checked={modifiedOnly} onChange={event => { setModifiedOnly(event.target.checked); scopeModel?.setModifiedOnly(event.target.checked); }} data-testid="filter-modified" /> 仅修改过的文件</label>
          <label><input type="checkbox" checked={excludeGenerated} onChange={event => { setExcludeGenerated(event.target.checked); scopeModel?.setExcludeGenerated(event.target.checked); }} data-testid="filter-exclude-generated" /> 排除生成目录</label>
        </div>
      </form>

      {renderStatus()}

      {(state.status === 'results' || state.status === 'loading') && matches.length > 0 && (
        <>
        <VirtualList
          items={flatItems}
          rowHeight={VIRTUAL_ROW_HEIGHT}
          selectedIndex={selectedIndex}
          onSelectIndex={(index) => {
            if (flatItems[index]?.kind === 'match') {
              setSelectedIndex(index);
            } else {
              for (let i = index; i < flatItems.length; i++) {
                if (flatItems[i].kind === 'match') { setSelectedIndex(i); return; }
              }
              for (let i = index - 1; i >= 0; i--) {
                if (flatItems[i].kind === 'match') { setSelectedIndex(i); return; }
              }
            }
          }}
          className="kairo-search-results"
          ariaLabel="Search results"
          testId="search-results"
          renderItem={(item, _index, isSelected) => {
            if (item.kind === 'header') {
              return (
                <div
                  className="kairo-search-group-header"
                  data-testid="search-group"
                  style={{ display: 'flex', alignItems: 'center', padding: '0 8px', height: '100%' }}
                >
                  <span className="codicon codicon-file" aria-hidden="true" />
                  <span className="kairo-search-file">{item.file}</span>
                  <span className="kairo-search-file-count">{item.matchCount}</span>
                </div>
              );
            }
            const match = item.match!;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`kairo-search-result${isSelected ? ' is-selected' : ''}`}
                style={{ height: '100%', width: '100%' }}
                onMouseEnter={() => setSelectedIndex(item.flatIndex)}
                onClick={() => void openSelected(match)}
                onFocus={() => setSelectedIndex(item.flatIndex)}
                data-testid="search-result"
              >
                <span className="kairo-search-location">{match.line}:{match.column}</span>
                <span className="kairo-search-preview">{match.contextBefore}<mark>{match.matchText}</mark>{match.contextAfter}</span>
              </button>
            );
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.defaultPrevented) {
              const item = flatItems[selectedIndex];
              if (item?.kind === 'match' && item.match) {
                event.preventDefault();
                void openSelected(item.match);
              }
            }
          }}
        />
        {state.truncated && <div className="kairo-search-truncated" role="status">Result limit reached. Refine the filters to continue.</div>}
        {showLoadMore && onLoadMore && (
          <div className="kairo-search-load-more" data-testid="search-load-more">
            <button
              type="button"
              className="theia-button secondary"
              onClick={onLoadMore}
              disabled={isStreaming}
            >
              {isStreaming ? <><span className="kairo-search-spinner" aria-hidden="true" /> 加载中…</> : '继续加载'}
            </button>
          </div>
        )}
        {onCreateReplacePlan && onApplyReplacePlan && <section className="kairo-replace-preview" aria-label="Replace preview">
          <div className="kairo-replace-toolbar">
            <input className="theia-input" value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="Replace with" aria-label="Replacement text" />
            <button type="button" className="theia-button secondary" onClick={() => void onCreateReplacePlan(matches, replacement).then(plan => { setReplacePlan(plan); setApplyResults([]); }).catch(error => setSubmissionError(error instanceof Error ? error : new Error(String(error))))}>Preview Replace</button>
            <button type="button" className="theia-button" disabled={!replacePlan || applying} onClick={() => replacePlan && void (async () => { setApplying(true); try { const results = await onApplyReplacePlan(replacePlan); setApplyResults(results); setCanUndo(results.some(result => result.status === 'applied') && !results.some(result => result.status === 'failed' || result.status === 'rollback-failed')); } catch (error) { setSubmissionError(error instanceof Error ? error : new Error(String(error))); } finally { setApplying(false); } })()}>{applying ? 'Applying…' : 'Apply selected'}</button>
            {onUndoReplace && <button type="button" className="theia-button secondary" disabled={!canUndo || applying} onClick={() => void (async () => { setApplying(true); try { const results = await onUndoReplace(); setApplyResults(results); if (results.every(result => result.status === 'undone')) setCanUndo(false); } finally { setApplying(false); } })()}>Undo</button>}
          </div>
          {replacePlan?.files.map((file, fileIndex) => <details key={file.file} open>
            <summary>{file.file} — {file.edits.filter(edit => edit.selected).length} selected</summary>
            <button type="button" className="theia-button secondary" onClick={() => setReplacePlan(plan => plan && ({ ...plan, files: plan.files.map((entry, i) => i === fileIndex ? ({ ...entry, edits: entry.edits.map(item => ({ ...item, selected: !file.edits.every(edit => edit.selected) })) }) : entry) }))}>{file.edits.every(edit => edit.selected) ? 'Deselect file' : 'Select file'}</button>
            {file.edits.map((edit, editIndex) => <label className="kairo-replace-edit" key={edit.id}><input type="checkbox" checked={edit.selected} onChange={event => setReplacePlan(plan => plan && ({ ...plan, files: plan.files.map((entry, i) => i === fileIndex ? ({ ...entry, edits: entry.edits.map((item, j) => j === editIndex ? ({ ...item, selected: event.target.checked }) : item) }) : entry) }))} /> <span>{edit.line}:{edit.column}</span> <del>{edit.before}</del> <ins>{edit.after}</ins></label>)}
          </details>)}
          {applyResults.map((result, index) => <div key={`${result.file}:${result.status}:${index}`} role="status" className={`kairo-replace-result is-${result.status}`}>{result.file}: {result.status}{result.error ? ` — ${result.error}` : ''}</div>)}
        </section>}
        </>
      )}
    </section>
  );
};

@injectable()
export class SearchCenterWidget extends ReactWidget {
  static readonly ID = 'kairo-search-center';

  @inject(KairoSearchSessionModel) protected readonly model!: KairoSearchSessionModel;
  @inject(WorkspaceContextService) protected readonly workspaceContext!: WorkspaceContextService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(SearchReplaceService) protected readonly replaceService!: SearchReplaceService;
  @inject(SearchScopeModel) protected readonly scopeModel!: SearchScopeModel;

  protected state: SearchSessionState = {
    status: 'idle', requestId: 0, matches: [], totalMatches: 0, truncated: false, erroredFiles: [],
  };
  protected unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.id = SearchCenterWidget.ID;
    this.title.label = 'Search';
    this.title.caption = 'Kairo Search Center';
    this.title.iconClass = 'codicon codicon-search';
    this.title.closable = true;
    this.addClass('kairo-search-center-widget');
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

  protected async search(query: SearchCenterQuery): Promise<void> {
    const context = this.workspaceContext.requireContext();
    await this.model.searchStream({ ...query, workspaceId: context.workspaceId });
  }

  protected async openMatch(match: SearchMatch): Promise<void> {
    const context = this.workspaceContext.requireContext();
    const start = { line: Math.max(0, match.line - 1), character: Math.max(0, match.column - 1) };
    await this.editorManager.open(resolveWorkspaceMatchUri(context.workspaceRoot, match.file), {
      mode: 'activate',
      selection: { start, end: { line: start.line, character: start.character + Math.max(1, match.matchText.length) } },
      revealOption: 'centerIfOutsideViewport',
    });
  }

  protected render(): React.ReactNode {
    const streamState = this.state.streamState;
    return <SearchCenterComponent
      state={this.state}
      onSearch={query => this.search(query)}
      onCancel={() => this.model.cancelStream()}
      onOpen={match => this.openMatch(match)}
      onCreateReplacePlan={(matches, replacement) => this.replaceService.createPlan(matches, replacement)}
      onApplyReplacePlan={plan => this.replaceService.apply(plan)}
      onUndoReplace={() => this.replaceService.undoLastApply()}
      showLoadMore={false}
      isStreaming={streamState?.status === 'streaming'}
      scopeModel={this.scopeModel}
    />;
  }
}
