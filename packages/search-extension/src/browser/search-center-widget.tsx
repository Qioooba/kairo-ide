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
import { SearchScopeModel, type SearchScope, SCOPE_OPTIONS } from './search-scope-model';
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
  onOpen: (match: SearchMatch, preserveFocus?: boolean) => Promise<unknown> | unknown;
  onCreateReplacePlan?: (matches: readonly SearchMatch[], replacement: string) => Promise<ReplacePlan>;
  onApplyReplacePlan?: (plan: ReplacePlan) => Promise<ReplaceApplyResult[]>;
  onUndoReplace?: () => Promise<ReplaceApplyResult[]>;
  onLoadMore?: () => void;
  showLoadMore?: boolean;
  isStreaming?: boolean;
  scopeModel?: SearchScopeModel;
  onClose: () => void;
  mode?: 'search' | 'replace';
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

interface FlatSearchItem {
  kind: 'header' | 'match';
  file?: string;
  matchCount?: number;
  match?: SearchMatch;
  flatIndex: number;
  collapsed?: boolean;
}

export const SearchCenterComponent: React.FC<SearchCenterProps> = ({
  state,
  onSearch,
  onCancel,
  onOpen,
  onCreateReplacePlan,
  onApplyReplacePlan,
  onUndoReplace,
  onLoadMore,
  showLoadMore,
  isStreaming,
  scopeModel,
  onClose,
  mode = 'search',
}) => {
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
  const [fileTypes, setFileTypes] = React.useState('');
  const [collapsedFiles, setCollapsedFiles] = React.useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = React.useState(true);
  const [currentMode, setCurrentMode] = React.useState<'search' | 'replace'>(mode);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const matches = state.matches;
  const groups = React.useMemo(() => groupMatchesByFile(matches), [matches]);

  const flatItems = React.useMemo((): FlatSearchItem[] => {
    let idx = 0;
    const items: FlatSearchItem[] = [];
    for (const group of groups) {
      const isCollapsed = collapsedFiles.has(group.file);
      items.push({
        kind: 'header',
        file: group.file,
        matchCount: group.matches.length,
        flatIndex: idx++,
        collapsed: isCollapsed,
      });
      if (!isCollapsed) {
        for (const match of group.matches) {
          items.push({ kind: 'match', match, flatIndex: idx++ });
        }
      }
    }
    return items;
  }, [groups, collapsedFiles]);

  React.useEffect(() => {
    const firstMatch = flatItems.findIndex(item => item.kind === 'match');
    setSelectedIndex(firstMatch >= 0 ? firstMatch : 0);
  }, [state.requestId, flatItems]);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [currentMode]);

  React.useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [onClose]);

  const toggleFileCollapse = (file: string): void => {
    setCollapsedFiles(prev => {
      const next = new Set(prev);
      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }
      return next;
    });
  };

  const getSelectedMatch = (): SearchMatch | undefined => {
    const item = flatItems[selectedIndex];
    return item?.kind === 'match' ? item.match : undefined;
  };

  const getFileIcon = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'java': return 'codicon-symbol-class';
      case 'js': case 'jsx': case 'ts': case 'tsx': return 'codicon-symbol-namespace';
      case 'xml': case 'html': case 'jsp': return 'codicon-symbol-misc';
      case 'css': case 'less': case 'scss': return 'codicon-symbol-color';
      case 'json': return 'codicon-symbol-object';
      case 'md': return 'codicon-symbol-string';
      case 'py': return 'codicon-symbol-namespace';
      case 'go': return 'codicon-symbol-namespace';
      default: return 'codicon-file';
    }
  };

  const getFileName = (filepath: string): string => {
    const parts = filepath.split(/[\\/]/);
    return parts[parts.length - 1] || filepath;
  };

  const getFilePath = (filepath: string): string => {
    const parts = filepath.split(/[\\/]/);
    return parts.slice(0, -1).join('/');
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }
    setSubmissionError(undefined);
    scopeModel?.setScope(scope);
    scopeModel?.setFileTypes(fileTypes);
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

  const openSelected = async (match: SearchMatch, preserveFocus = false): Promise<void> => {
    setSubmissionError(undefined);
    try {
      await onOpen(match, preserveFocus);
    } catch (error) {
      setSubmissionError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      let next = selectedIndex + 1;
      while (next < flatItems.length && flatItems[next].kind !== 'match') {
        next++;
      }
      if (next < flatItems.length) {
        setSelectedIndex(next);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      let prev = selectedIndex - 1;
      while (prev >= 0 && flatItems[prev].kind !== 'match') {
        prev--;
      }
      if (prev >= 0) {
        setSelectedIndex(prev);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const item = flatItems[selectedIndex];
      if (item?.kind === 'match' && item.match) {
        const file = item.match.file;
        if (!collapsedFiles.has(file)) {
          setCollapsedFiles(prev => new Set([...prev, file]));
        }
      } else if (item?.kind === 'header' && item.file && !item.collapsed) {
        toggleFileCollapse(item.file);
      }
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const item = flatItems[selectedIndex];
      if (item?.kind === 'header' && item.file && item.collapsed) {
        toggleFileCollapse(item.file);
      }
    } else if (event.key === 'Enter' && !event.defaultPrevented) {
      event.preventDefault();
      const item = flatItems[selectedIndex];
      if (item?.kind === 'match' && item.match) {
        if (event.ctrlKey || event.metaKey) {
          void openSelected(item.match, true);
        } else {
          void openSelected(item.match);
          onClose();
        }
      } else if (item?.kind === 'header' && item.file) {
        toggleFileCollapse(item.file);
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  const selectedMatch = getSelectedMatch();
  const fileCount = groups.length;
  const matchCount = state.totalMatches || matches.length;

  const renderPreview = (): React.ReactNode => {
    if (!showPreview || !selectedMatch) {
      return undefined;
    }
    const beforeLines = selectedMatch.contextBefore ? selectedMatch.contextBefore.split('\n') : [];
    const afterLines = selectedMatch.contextAfter ? selectedMatch.contextAfter.split('\n') : [];
    const contextBefore = beforeLines.slice(-3);
    const contextAfter = afterLines.slice(0, 3);

    return (
      <div className="kairo-search-preview-pane">
        <div className="kairo-search-preview-header">
          <span className="codicon codicon-file" aria-hidden="true" />
          <span className="kairo-search-preview-file">{selectedMatch.file}</span>
          <span className="kairo-search-preview-line">:{selectedMatch.line}</span>
          <button
            type="button"
            className="kairo-search-preview-toggle"
            onClick={() => setShowPreview(false)}
            title="隐藏预览"
          >
            <span className="codicon codicon-chevron-down" />
          </button>
        </div>
        <div className="kairo-search-preview-content">
          {contextBefore.length > 0 && (
            <div className="kairo-search-preview-context">
              {contextBefore.map((line, i) => {
                const lineNo = selectedMatch.line - contextBefore.length + i;
                return (
                  <div key={`before-${i}`} className="kairo-search-preview-line-context">
                    <span className="kairo-search-preview-lineno">{Math.max(1, lineNo)}</span>
                    <span className="kairo-search-preview-code">{line}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="kairo-search-preview-current">
            <span className="kairo-search-preview-lineno-current">{selectedMatch.line}</span>
            <span className="kairo-search-preview-code">
              {beforeLines[beforeLines.length - 1] || ''}
              <mark>{selectedMatch.matchText}</mark>
              {afterLines[0] || ''}
            </span>
          </div>
          {contextAfter.length > 0 && (
            <div className="kairo-search-preview-context">
              {contextAfter.map((line, i) => (
                <div key={`after-${i}`} className="kairo-search-preview-line-context">
                  <span className="kairo-search-preview-lineno">{selectedMatch.line + 1 + i}</span>
                  <span className="kairo-search-preview-code">{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStatus = (): React.ReactNode => {
    if (submissionError) {
      return <div className="kairo-idea-search-status is-error" role="alert" data-testid="search-error">{submissionError.message}</div>;
    }
    switch (state.status) {
      case 'idle':
        return <div className="kairo-idea-search-status">输入搜索词开始查找</div>;
      case 'loading':
        if (matches.length === 0) {
          return (
            <div className="kairo-idea-search-status is-loading" role="status" data-testid="search-loading">
              <span className="kairo-idea-search-spinner" aria-hidden="true" />
              搜索中…
            </div>
          );
        }
        return undefined;
      case 'empty':
        return <div className="kairo-idea-search-status" data-testid="search-empty">未找到匹配项</div>;
      case 'error':
        return <div className="kairo-idea-search-status is-error" role="alert" data-testid="search-error">搜索失败: {state.error?.message ?? '未知错误'}</div>;
      case 'cancelled':
        return <div className="kairo-idea-search-status" role="status" data-testid="search-cancelled">搜索已取消</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <div className="kairo-idea-search-backdrop" onClick={() => onClose()} data-testid="search-center-backdrop">
      <div
        className="kairo-idea-search-modal"
        ref={containerRef}
        onKeyDown={keyDown}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={currentMode === 'replace' ? '在路径中替换' : '在路径中查找'}
        data-testid="search-center-modal"
      >
        <div className="kairo-idea-search-header">
          <div className="kairo-idea-search-tabs">
            <button
              type="button"
              className={`kairo-idea-search-tab${currentMode === 'search' ? ' is-active' : ''}`}
              onClick={() => setCurrentMode('search')}
            >
              <span className="codicon codicon-search" aria-hidden="true" />
              查找
            </button>
            {onCreateReplacePlan && onApplyReplacePlan && (
              <button
                type="button"
                className={`kairo-idea-search-tab${currentMode === 'replace' ? ' is-active' : ''}`}
                onClick={() => setCurrentMode('replace')}
              >
                <span className="codicon codicon-replace" aria-hidden="true" />
                替换
              </button>
            )}
          </div>
          <button
            type="button"
            className="kairo-idea-search-close"
            onClick={() => onClose()}
            title="关闭 (Esc)"
          >
            <span className="codicon codicon-chrome-close" />
          </button>
        </div>

        <div className="kairo-idea-search-input-area">
          <form onSubmit={event => void submit(event)} data-testid="search-form">
            <div className="kairo-idea-search-input-row">
              <span className="codicon codicon-search kairo-idea-search-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                className="kairo-idea-search-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={currentMode === 'replace' ? '输入要替换的文本' : '输入要查找的文本'}
                aria-label="搜索文本"
                data-testid="search-query"
              />
              <div className="kairo-idea-search-filter-btns">
                <button
                  type="button"
                  className={`kairo-idea-filter-btn${caseSensitive ? ' is-active' : ''}`}
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  title="匹配大小写 (Aa)"
                  data-testid="filter-case"
                >
                  Aa
                </button>
                <button
                  type="button"
                  className={`kairo-idea-filter-btn${isRegex ? ' is-active' : ''}`}
                  onClick={() => setRegex(!isRegex)}
                  title="正则表达式 (.*)"
                  data-testid="filter-regex"
                >
                  .*
                </button>
                <button
                  type="button"
                  className={`kairo-idea-filter-btn${wholeWord ? ' is-active' : ''}`}
                  onClick={() => setWholeWord(!wholeWord)}
                  title="整个单词 (W)"
                  data-testid="filter-word"
                >
                  W
                </button>
              </div>
            </div>
            {currentMode === 'replace' && (
              <div className="kairo-idea-search-input-row">
                <span className="codicon codicon-replace kairo-idea-search-icon" aria-hidden="true" />
                <input
                  className="kairo-idea-search-input"
                  value={replacement}
                  onChange={event => setReplacement(event.target.value)}
                  placeholder="替换为"
                  aria-label="替换文本"
                  data-testid="replace-text"
                />
              </div>
            )}
            <div className="kairo-idea-search-options-row">
              <div className="kairo-idea-search-file-mask">
                <span className="codicon codicon-filter" aria-hidden="true" />
                <input
                  className="kairo-idea-mask-input"
                  value={fileTypes}
                  onChange={event => { setFileTypes(event.target.value); scopeModel?.setFileTypes(event.target.value); }}
                  placeholder="文件类型 (如 *.java,*.xml)"
                  aria-label="文件类型过滤"
                  data-testid="filter-file-types"
                />
              </div>
              <select
                className="kairo-idea-scope-select"
                value={scope}
                onChange={event => { setScope(event.target.value as SearchScope); scopeModel?.setScope(event.target.value as SearchScope); }}
                aria-label="搜索范围"
                data-testid="scope-selector"
              >
                {SCOPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                type="submit"
                className="kairo-idea-search-submit"
                disabled={!query.trim() || isStreaming}
                data-testid="search-submit"
              >
                {isStreaming ? '搜索中…' : (currentMode === 'replace' ? '查找' : '搜索')}
              </button>
              {currentMode === 'replace' && replacePlan && (
                <button
                  type="button"
                  className="kairo-idea-replace-btn"
                  disabled={applying}
                  onClick={() => replacePlan && void (async () => {
                    setApplying(true);
                    try {
                      const results = await onApplyReplacePlan!(replacePlan);
                      setApplyResults(results);
                      setCanUndo(results.some(r => r.status === 'applied') && !results.some(r => r.status === 'failed'));
                    } catch (error) {
                      setSubmissionError(error instanceof Error ? error : new Error(String(error)));
                    } finally {
                      setApplying(false);
                    }
                  })()}
                >
                  {applying ? '替换中…' : '替换全部'}
                </button>
              )}
              {onUndoReplace && canUndo && (
                <button
                  type="button"
                  className="kairo-idea-replace-btn secondary"
                  disabled={applying}
                  onClick={() => void (async () => {
                    setApplying(true);
                    try {
                      const results = await onUndoReplace!();
                      setApplyResults(results);
                      if (results.every(r => r.status === 'undone')) setCanUndo(false);
                    } finally {
                      setApplying(false);
                    }
                  })()}
                >
                  撤销
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="kairo-idea-search-results-area">
          {renderStatus()}
          {(state.status === 'results' || state.status === 'loading') && matches.length > 0 && (
            <VirtualList
              items={flatItems}
              rowHeight={24}
              selectedIndex={selectedIndex}
              onSelectIndex={(index) => {
                if (flatItems[index]?.kind === 'match') {
                  setSelectedIndex(index);
                  if (flatItems[index].match) {
                    void openSelected(flatItems[index].match!, true);
                  }
                }
              }}
              className="kairo-idea-search-results"
              ariaLabel="搜索结果"
              testId="search-results"
              renderItem={(item, _index, isSelected) => {
                if (item.kind === 'header') {
                  return (
                    <button
                      type="button"
                      className="kairo-idea-result-group"
                      onClick={() => item.file && toggleFileCollapse(item.file)}
                      style={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%', border: 0, background: 'transparent', cursor: 'pointer', padding: '0 8px', gap: '6px' }}
                      data-testid="search-group"
                    >
                      <span className={`codicon ${item.collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden="true" style={{ fontSize: '12px' }} />
                      <span className={`codicon ${getFileIcon(item.file || '')}`} aria-hidden="true" />
                      <span className="kairo-idea-result-filename">{getFileName(item.file || '')}</span>
                      <span className="kairo-idea-result-filepath">{getFilePath(item.file || '')}</span>
                      <span className="kairo-idea-result-count">{item.matchCount}</span>
                    </button>
                  );
                }
                const match = item.match!;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`kairo-idea-result-item${isSelected ? ' is-selected' : ''}`}
                    style={{ height: '100%', width: '100%', border: 0, borderLeft: '2px solid transparent', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 12px 0 28px', gap: '12px' }}
                    onMouseEnter={() => {
                      setSelectedIndex(item.flatIndex);
                      void openSelected(match, true);
                    }}
                    onClick={() => void openSelected(match)}
                    onFocus={() => {
                      setSelectedIndex(item.flatIndex);
                      void openSelected(match, true);
                    }}
                    data-testid="search-result"
                  >
                    <span className="kairo-idea-result-lineno">{match.line}</span>
                    <span className="kairo-idea-result-preview">
                      {match.contextBefore}<mark>{match.matchText}</mark>{match.contextAfter}
                    </span>
                  </button>
                );
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.defaultPrevented) {
                  const item = flatItems[selectedIndex];
                  if (item?.kind === 'match' && item.match) {
                    event.preventDefault();
                    void openSelected(item.match);
                    onClose();
                  } else if (item?.kind === 'header' && item.file) {
                    event.preventDefault();
                    toggleFileCollapse(item.file);
                  }
                }
              }}
            />
          )}
          {state.truncated && (
            <div className="kairo-idea-search-truncated" role="status">
              结果已达上限，请优化搜索条件
            </div>
          )}
        </div>

        {(state.status === 'results' || state.status === 'loading') && matches.length > 0 && (
          <>
            {!showPreview && (
              <button
                type="button"
                className="kairo-idea-preview-show"
                onClick={() => setShowPreview(true)}
              >
                <span className="codicon codicon-chevron-up" />
                显示预览
              </button>
            )}
            {renderPreview()}
          </>
        )}

        <div className="kairo-idea-search-footer">
          <span className="kairo-idea-search-stats" data-testid="search-count">
            {matchCount > 0 && `${matchCount} 个匹配${fileCount > 0 ? `，在 ${fileCount} 个文件中` : ''}`}
            {isStreaming && matches.length > 0 && ' （搜索中…）'}
          </span>
          <div className="kairo-idea-search-actions">
            {state.status === 'loading' && (
              <button type="button" className="kairo-idea-footer-btn" onClick={onCancel} data-testid="search-cancel">
                取消
              </button>
            )}
            <button
              type="button"
              className="kairo-idea-footer-btn"
              onClick={() => setShowPreview(!showPreview)}
              title={showPreview ? '隐藏预览' : '显示预览'}
            >
              {showPreview ? '隐藏预览' : '显示预览'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
    this.title.label = '在路径中查找';
    this.title.caption = 'Kairo Find in Path';
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

  protected async openMatch(match: SearchMatch, preserveFocus?: boolean): Promise<void> {
    const context = this.workspaceContext.requireContext();
    const start = { line: Math.max(0, match.line - 1), character: Math.max(0, match.column - 1) };
    await this.editorManager.open(resolveWorkspaceMatchUri(context.workspaceRoot, match.file), {
      mode: preserveFocus ? 'reveal' : 'activate',
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
      onOpen={(match, preserveFocus) => this.openMatch(match, preserveFocus)}
      onCreateReplacePlan={(matches, replacement) => this.replaceService.createPlan(matches, replacement)}
      onApplyReplacePlan={plan => this.replaceService.apply(plan)}
      onUndoReplace={() => this.replaceService.undoLastApply()}
      showLoadMore={false}
      isStreaming={streamState?.status === 'streaming'}
      scopeModel={this.scopeModel}
      onClose={() => this.close()}
    />;
  }
}
