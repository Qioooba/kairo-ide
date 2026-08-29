import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import type { SearchMatch } from '@kairo/protocol';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import { KairoSearchSessionModel, type SearchSessionState } from './search-session-model';
import { SearchReplaceService, type ReplaceApplyResult, type ReplacePlan } from './search-replace-service';
import { resolveWorkspaceMatchUri } from './search-path';
import { SearchScopeModel, type SearchScope, SCOPE_OPTIONS } from './search-scope-model';
import { parseFileMask, mergeGlobs } from './file-mask';
import { groupMatchesByFile, sameLineContext, multiLineContext, getSearchFileName, getSearchFileDir, getSearchFileIcon, matchPreviewParts } from './search-result-utils';
import { SearchResultsWidget } from './search-results-widget';
import { VirtualList } from '@kairo/ui-kit';
import './search-center.css';

export { parseFileMask, mergeGlobs, normalizeMaskToken } from './file-mask';
export { groupMatchesByFile, sameLineContext, multiLineContext, getSearchFileName, getSearchFileDir, getSearchFileIcon, matchPreviewParts } from './search-result-utils';
export type { SearchResultGroup } from './search-result-utils';

export interface SearchCenterQuery {
  query: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include?: string[];
  exclude?: string[];
  /** Absolute directory or file to scope the search. */
  rootPath?: string;
  scope?: SearchScope;
  /** Replace mode: stream the post-image so rows render a replacement preview. */
  previewReplace?: string;
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
  onOpenInFindWindow?: () => void;
  mode?: 'search' | 'replace';
  initialQuery?: string;
  i18n: KairoI18nService;
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
  onOpenInFindWindow,
  mode = 'search',
  initialQuery = '',
  i18n,
}) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [query, setQuery] = React.useState(initialQuery);
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
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setCurrentMode(mode);
  }, [mode]);

  React.useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  const matches = state.matches;
  // Streaming accumulates into a stable array; the revision counter marks
  // new data. Keying off both keeps grouping correct without re-running on
  // every unrelated state tick.
  const streamRevision = state.streamState?.revision ?? 0;
  const groups = React.useMemo(() => groupMatchesByFile(matches), [matches, streamRevision]);

  // Reset the keyboard selection onto the first match only when a NEW result
  // set arrives (request id or live match count changed). Recomputing on every
  // flatItems change made ←/→ collapse/expand unusable: collapsing rewrote
  // flatItems, snapped the selection back to a match row, and ArrowRight
  // could then never reach the collapsed header to expand it again.
  const navKeyRef = React.useRef('');
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
    const navKey = `${state.requestId}:${matches.length}`;
    if (navKeyRef.current === navKey) {
      return;
    }
    navKeyRef.current = navKey;
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

  // Build the replace plan from the current result set. The plan powers the
  // "Replace All" button; without it the button never appears and the replace
  // workflow is a dead end. Rebuild it whenever a new search completes or the
  // replacement text changes, and drop it when matches are cleared.
  // Plan creation reads every matched file, so it is debounced: typing a
  // replacement word must not re-read the whole result set per keystroke.
  React.useEffect(() => {
    if (currentMode !== 'replace' || !onCreateReplacePlan || !replacement.trim() || state.matches.length === 0) {
      setReplacePlan(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      onCreateReplacePlan(state.matches, replacement.trim())
        .then(plan => { if (!cancelled) setReplacePlan(plan); })
        .catch(() => { if (!cancelled) setReplacePlan(undefined); });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // state.matches is bound to state.requestId; the request id + status are
    // the stable keys for "a new result set arrived".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode, state.requestId, state.status, replacement, onCreateReplacePlan]);

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

  const getFileIcon = getSearchFileIcon;
  const getFileName = getSearchFileName;
  const getFilePath = getSearchFileDir;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!query.trim()) {
      return;
    }
    setSubmissionError(undefined);
    scopeModel?.setScope(scope);
    scopeModel?.setFileTypes(fileTypes);
    const mask = parseFileMask(fileTypes);
    const excludeExtra = parseGlobInput(exclude);
    try {
      await onSearch({
        query: query.trim(),
        isRegex,
        caseSensitive,
        wholeWord,
        include: mask.include,
        exclude: mergeGlobs(mask.exclude, excludeExtra),
        scope,
        ...(currentMode === 'replace' && replacement.trim() ? { previewReplace: replacement.trim() } : {}),
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
    // Handled navigation keys must not leak to the workbench: an un-stopped
    // ArrowLeft/ArrowDown bubbles to Theia's keybinding resolver, which
    // moves focus into the Navigator file tree mid-interaction.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      let next = selectedIndex + 1;
      while (next < flatItems.length && flatItems[next].kind !== 'match') {
        next++;
      }
      if (next < flatItems.length) {
        setSelectedIndex(next);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      let prev = selectedIndex - 1;
      while (prev >= 0 && flatItems[prev].kind !== 'match') {
        prev--;
      }
      if (prev >= 0) {
        setSelectedIndex(prev);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
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
      event.stopPropagation();
      const item = flatItems[selectedIndex];
      if (item?.kind === 'header' && item.file && item.collapsed) {
        toggleFileCollapse(item.file);
      }
    } else if (event.key === 'Enter' && !event.defaultPrevented) {
      // When an input inside the form has focus (search query / replace
      // text / file mask), Enter must submit the form — the default action
      // — not be swallowed by the results-list navigation handler below.
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const item = flatItems[selectedIndex];
      if (item?.kind === 'match' && item.match) {
        // IDEA Find: Enter opens and keeps dialog; Shift+Enter opens and closes.
        // Ctrl/Cmd+Enter opens with preserveFocus (preview-friendly).
        if (event.shiftKey) {
          void openSelected(item.match);
          onClose();
        } else if (event.ctrlKey || event.metaKey) {
          void openSelected(item.match, true);
        } else {
          void openSelected(item.match);
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

  // Post-image preview for Replace in Path: resolve the planned replacement
  // for a match from the current replace plan (instant, no extra request).
  const replacementFor = (match: SearchMatch): string | undefined => {
    if (currentMode !== 'replace' || !replacePlan) {
      return undefined;
    }
    const filePlan = replacePlan.files.find(file => file.file === match.file);
    return filePlan?.edits.find(edit => edit.line === match.line && edit.column === match.column)?.after;
  };

  const renderPreview = (): React.ReactNode => {
    if (!showPreview || !selectedMatch) {
      return undefined;
    }
    const { beforeLines, afterLines, sameBefore, sameAfter } = multiLineContext(selectedMatch);
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
            title={t('widget.search.center.preview.hide')}
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
              {sameBefore}
              <span className="kairo-search-highlight">{selectedMatch.matchText}</span>
              {sameAfter}
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
      return (
        <div className="kairo-search-status kairo-error-banner" role="alert" data-testid="search-error">
          {submissionError.message}
        </div>
      );
    }
    switch (state.status) {
      case 'idle':
        return <div className="kairo-search-status kairo-empty-state" data-testid="search-idle">{t('widget.search.center.status.idle')}</div>;
      case 'loading':
        if (matches.length === 0) {
          return (
            <div className="kairo-search-status kairo-empty-state is-loading" role="status" data-testid="search-loading">
              <span className="kairo-search-spinner" aria-hidden="true" />
              {t('widget.search.center.status.loading')}
            </div>
          );
        }
        return undefined;
      case 'empty':
        return <div className="kairo-search-status kairo-empty-state" data-testid="search-empty">{t('widget.search.center.status.empty')}</div>;
      case 'error':
        return (
          <div className="kairo-search-status kairo-error-banner" role="alert" data-testid="search-error">
            {t('widget.search.center.status.error', { message: state.error?.message ?? t('widget.search.center.status.unknownError') })}
          </div>
        );
      case 'cancelled':
        return <div className="kairo-search-status kairo-empty-state" role="status" data-testid="search-cancelled">{t('widget.search.center.status.cancelled')}</div>;
      case 'results':
        return undefined;
    }
  };

  return (
    <div className="kairo-search-backdrop" onClick={() => onClose()} data-testid="search-center-backdrop">
      <div
        className="kairo-search-modal"
        ref={containerRef}
        onKeyDown={keyDown}
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={currentMode === 'replace' ? t('widget.search.center.ariaLabel.replaceInPath') : t('widget.search.center.ariaLabel.findInPath')}
        data-testid="search-center-modal"
      >
        <div className="kairo-search-header">
          <div className="kairo-search-tabs">
            <button
              type="button"
              className={`kairo-search-tab${currentMode === 'search' ? ' is-active' : ''}`}
              onClick={() => setCurrentMode('search')}
            >
              <span className="codicon codicon-search" aria-hidden="true" />
              {t('widget.search.center.mode.search')}
            </button>
            {onCreateReplacePlan && onApplyReplacePlan && (
              <button
                type="button"
                className={`kairo-search-tab${currentMode === 'replace' ? ' is-active' : ''}`}
                onClick={() => setCurrentMode('replace')}
              >
                <span className="codicon codicon-replace" aria-hidden="true" />
                {t('widget.search.center.mode.replace')}
              </button>
            )}
          </div>
          <button
            type="button"
            className="kairo-search-close"
            onClick={() => onClose()}
            title={t('widget.search.center.closeTooltip')}
          >
            <span className="codicon codicon-chrome-close" />
          </button>
        </div>

        <div className="kairo-search-input-area">
          <form onSubmit={event => void submit(event)} data-testid="search-form">
            <div className="kairo-search-input-row">
              <span className="codicon codicon-search kairo-search-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                className="kairo-search-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={currentMode === 'replace' ? t('widget.search.center.placeholder.replace') : t('widget.search.center.placeholder.search')}
                aria-label={t('widget.search.center.ariaLabel.searchQuery')}
                data-testid="search-query"
              />
              <div className="kairo-search-filter-btns">
                <button
                  type="button"
                  className={`kairo-search-filter-btn${caseSensitive ? ' is-active' : ''}`}
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  title={t('widget.search.center.filter.case.title')}
                  data-testid="filter-case"
                >
                  Aa
                </button>
                <button
                  type="button"
                  className={`kairo-search-filter-btn${isRegex ? ' is-active' : ''}`}
                  onClick={() => setRegex(!isRegex)}
                  title={t('widget.search.center.filter.regex.title')}
                  data-testid="filter-regex"
                >
                  .*
                </button>
                <button
                  type="button"
                  className={`kairo-search-filter-btn${wholeWord ? ' is-active' : ''}`}
                  onClick={() => setWholeWord(!wholeWord)}
                  title={t('widget.search.center.filter.word.title')}
                  data-testid="filter-word"
                >
                  W
                </button>
              </div>
            </div>
            {currentMode === 'replace' && (
              <div className="kairo-search-input-row">
                <span className="codicon codicon-replace kairo-search-icon" aria-hidden="true" />
                <input
                  className="kairo-search-input"
                  value={replacement}
                  onChange={event => setReplacement(event.target.value)}
                  placeholder={t('widget.search.center.placeholder.replaceWith')}
                  aria-label={t('widget.search.center.ariaLabel.replaceText')}
                  data-testid="replace-text"
                />
              </div>
            )}
            <div className="kairo-search-options-row">
              <div className="kairo-search-file-mask">
                <span className="codicon codicon-filter" aria-hidden="true" />
                <input
                  className="kairo-search-mask-input"
                  value={fileTypes}
                  onChange={event => { setFileTypes(event.target.value); scopeModel?.setFileTypes(event.target.value); }}
                  placeholder={t('widget.search.center.placeholder.fileTypes')}
                  aria-label={t('widget.search.center.ariaLabel.fileTypes')}
                  data-testid="filter-file-types"
                  title={t('widget.search.center.placeholder.fileTypesHint')}
                />
              </div>
              <select
                className="theia-select kairo-search-scope-select"
                value={scope}
                onChange={event => { setScope(event.target.value as SearchScope); scopeModel?.setScope(event.target.value as SearchScope); }}
                aria-label={t('widget.search.center.ariaLabel.scope')}
                data-testid="scope-selector"
              >
                {SCOPE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                type="button"
                className={`kairo-search-filter-btn${showAdvanced ? ' is-active' : ''}`}
                onClick={() => setShowAdvanced(!showAdvanced)}
                title={t('widget.search.center.advanced.toggle')}
                data-testid="toggle-advanced"
              >
                <span className="codicon codicon-ellipsis" aria-hidden="true" />
              </button>
              <button
                type="submit"
                className="kairo-search-submit"
                disabled={!query.trim() || isStreaming}
                data-testid="search-submit"
              >
                {isStreaming ? t('widget.search.center.submit.searching') : (currentMode === 'replace' ? t('widget.search.center.submit.find') : t('widget.search.center.submit.search'))}
              </button>
              {currentMode === 'replace' && replacePlan && (
                <button
                  type="button"
                  className="kairo-search-replace-btn"
                  disabled={applying}
                  onClick={() => replacePlan && void (async () => {
                    setApplying(true);
                    try {
                      const results = await onApplyReplacePlan!(replacePlan);
                      setApplyResults(results);
                      setCanUndo(results.some(r => r.status === 'applied') && !results.some(r => r.status === 'failed'));
                      // Transaction failures (preflight drift, write/rollback errors)
                      // must be visible — a silent zero-write is indistinguishable
                      // from success for the user.
                      const failure = results.find(r =>
                        r.status === 'failed' || r.status === 'rollback-failed' || r.status === 'rollback-unknown');
                      setSubmissionError(failure
                        ? new Error(failure.error ?? `Replace failed for ${failure.file}`)
                        : undefined);
                    } catch (error) {
                      setSubmissionError(error instanceof Error ? error : new Error(String(error)));
                    } finally {
                      setApplying(false);
                    }
                  })()}
                >
                  {applying ? t('widget.search.center.replace.replacing') : t('widget.search.center.replace.all')}
                </button>
              )}
              {onUndoReplace && canUndo && (
                <button
                  type="button"
                  className="kairo-search-replace-btn secondary"
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
                  {t('widget.search.center.replace.undo')}
                </button>
              )}
            </div>
            {showAdvanced && (
              <div className="kairo-search-options-row kairo-search-advanced-row">
                <div className="kairo-search-file-mask kairo-search-exclude-mask">
                  <span className="codicon codicon-exclude" aria-hidden="true" />
                  <input
                    className="kairo-search-mask-input"
                    value={exclude}
                    onChange={event => setExclude(event.target.value)}
                    placeholder={t('widget.search.center.placeholder.exclude')}
                    aria-label={t('widget.search.center.ariaLabel.exclude')}
                    data-testid="filter-exclude"
                  />
                </div>
              </div>
            )}
          </form>
        </div>

        <div className="kairo-search-results-area">
          {renderStatus()}
          {(state.status === 'results' || state.status === 'loading') && matches.length > 0 && (
            <VirtualList
              items={flatItems}
              rowHeight={24}
              selectedIndex={selectedIndex}
              onSelectIndex={(index) => {
                if (flatItems[index]?.kind === 'match') {
                  setSelectedIndex(index);
                }
              }}
              className="kairo-search-results"
              ariaLabel={t('widget.search.center.ariaLabel.results')}
              testId="search-results"
              renderItem={(item, _index, isSelected) => {
                if (item.kind === 'header') {
                  return (
                    <button
                      type="button"
                      className="kairo-search-result-group"
                      onClick={() => item.file && toggleFileCollapse(item.file)}
                      data-testid="search-group"
                    >
                      <span className={`codicon kairo-search-chevron ${item.collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden="true" />
                      <span className={`codicon ${getFileIcon(item.file || '')}`} aria-hidden="true" />
                      <span className="kairo-search-result-filename">{getFileName(item.file || '')}</span>
                      <span className="kairo-search-result-filepath">{getFilePath(item.file || '')}</span>
                      <span className="kairo-search-result-count">{item.matchCount}</span>
                    </button>
                  );
                }
                const match = item.match!;
                const preview = matchPreviewParts(match);
                const plannedReplacement = replacementFor(match);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`kairo-search-result-item${isSelected ? ' is-selected' : ''}`}
                    onMouseEnter={() => {
                      if (item.flatIndex !== selectedIndex) {
                        setSelectedIndex(item.flatIndex);
                      }
                    }}
                    onClick={() => {
                      setSelectedIndex(item.flatIndex);
                      // Open with preserveFocus so Find dialog stays mounted (IDEA).
                      void openSelected(match, true);
                    }}
                    onDoubleClick={() => {
                      void openSelected(match);
                      onClose();
                    }}
                    onFocus={() => {
                      setSelectedIndex(item.flatIndex);
                    }}
                    data-testid="search-result"
                  >
                    <span className="kairo-search-result-lineno">{match.line}</span>
                    <span className="kairo-search-result-preview">
                      {preview.before}
                      {preview.highlight
                        ? <span className="kairo-search-highlight">{preview.highlight}</span>
                        : null}
                      {preview.after}
                      {(plannedReplacement ?? preview.replacement) !== undefined && (
                        <span className="kairo-search-replacement-group">
                          <span className="kairo-search-replacement-arrow" aria-hidden="true">→</span>
                          <span className="kairo-search-replacement">{plannedReplacement ?? preview.replacement}</span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.defaultPrevented) {
                  const item = flatItems[selectedIndex];
                  if (item?.kind === 'match' && item.match) {
                    event.preventDefault();
                    if (event.shiftKey) {
                      void openSelected(item.match);
                      onClose();
                    } else {
                      void openSelected(item.match);
                    }
                  } else if (item?.kind === 'header' && item.file) {
                    event.preventDefault();
                    toggleFileCollapse(item.file);
                  }
                }
              }}
            />
          )}
          {state.truncated && (
            <div className="kairo-search-truncated" role="status">
              {t('widget.search.center.truncated')}
            </div>
          )}
        </div>

        {(state.status === 'results' || state.status === 'loading') && matches.length > 0 && (
          <>
            {!showPreview && (
              <button
                type="button"
                className="kairo-search-preview-show"
                onClick={() => setShowPreview(true)}
              >
                <span className="codicon codicon-chevron-up" />
                {t('widget.search.center.preview.show')}
              </button>
            )}
            {renderPreview()}
          </>
        )}

        <div className="kairo-search-footer">
          <span className="kairo-search-stats" data-testid="search-count" tabIndex={-1}>
            {matchCount > 0 && (fileCount > 0
              ? t('widget.search.center.stats.matchInFiles', { count: matchCount, fileCount })
              : t('widget.search.center.stats.match', { count: matchCount }))}
            {isStreaming && matches.length > 0 && t('widget.search.center.stats.streaming')}
          </span>
          <div className="kairo-search-actions">
            {onOpenInFindWindow && matches.length > 0 && (
              <button
                type="button"
                className="kairo-search-footer-btn"
                onClick={() => onOpenInFindWindow()}
                data-testid="open-find-window"
                title={t('widget.search.center.openInFindWindow')}
              >
                <span className="codicon codicon-window" aria-hidden="true" />
                {t('widget.search.center.openInFindWindow')}
              </button>
            )}
            {state.status === 'loading' && (
              <button type="button" className="kairo-search-footer-btn" onClick={onCancel} data-testid="search-cancel">
                {t('widget.search.center.cancel')}
              </button>
            )}
            <button
              type="button"
              className="kairo-search-footer-btn"
              onClick={() => setShowPreview(!showPreview)}
              title={showPreview ? t('widget.search.center.preview.hide') : t('widget.search.center.preview.show')}
              disabled={matchCount === 0}
              style={matchCount === 0 ? { display: 'none' } : undefined}
            >
              {showPreview ? t('widget.search.center.preview.hide') : t('widget.search.center.preview.show')}
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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
  @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

  protected state: SearchSessionState = {
    status: 'idle', requestId: 0, matches: [], totalMatches: 0, truncated: false, erroredFiles: [],
  };
  protected unsubscribe: (() => void) | undefined;
  protected mode: 'search' | 'replace' = 'search';
  protected initialQuery = '';

  setMode(mode: 'search' | 'replace'): void {
    this.mode = mode;
    this.update();
  }

  /** Prefill from editor selection (IDEA: Find in Path uses selected text). */
  captureEditorSelection(): void {
    const text = readEditorSelection(this.editorManager);
    if (text && text.length <= 500 && !text.includes('\n')) {
      this.initialQuery = text;
      this.update();
    }
  }

  async openInFindWindow(): Promise<void> {
    const widget = await this.widgetManager.getOrCreateWidget(SearchResultsWidget.ID) as SearchResultsWidget;
    if (!widget.isAttached) {
      this.shell.addWidget(widget, { area: 'bottom', rank: 150 });
    }
    this.shell.activateWidget(widget.id);
    this.close();
  }

  constructor() {
    super();
    this.id = SearchCenterWidget.ID;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-search';
    this.addClass('kairo-search-center-widget');
  }

  @postConstruct()
  protected init(): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);
    const updateTitles = (): void => {
      this.title.label = t('widget.search.center.title');
      this.title.caption = t('widget.search.center.caption');
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

  protected async search(query: SearchCenterQuery): Promise<void> {
    const context = this.workspaceContext.requireContext();
    const scoped = this.resolveScope(query, context.workspaceRoot);
    await this.model.searchStream({
      ...scoped,
      workspaceId: context.workspaceId,
      rootPath: context.workspaceRoot,
      contextLines: 2,
    });
    this.scopeModel.addToHistory({
      query: scoped.query,
      isRegex: scoped.isRegex,
      caseSensitive: scoped.caseSensitive,
      wholeWord: scoped.wholeWord,
      scope: scoped.scope ?? 'project',
      timestamp: Date.now(),
    });
  }

  /**
   * Map IDEA-style scope to rootPath / include filters.
   * Directory / current-file use the active editor URI when available.
   *
   * Include globs are OR'd on the agent. Scope therefore must narrow the
   * include list (replace / expand), not merge with `*.java` — otherwise
   * `current-file` + `*.java` still matches every Java file.
   */
  protected resolveScope(query: SearchCenterQuery, workspaceRoot: string): SearchCenterQuery {
    const scope = query.scope ?? this.scopeModel.currentFilter.scope;
    const editorUri = this.editorManager.currentEditor?.editor?.uri;
    const fsPath = editorUri ? URIToFsPath(editorUri) : undefined;

    if (scope === 'current-file' || scope === 'selection') {
      if (fsPath) {
        const relative = toWorkspaceRelative(workspaceRoot, fsPath);
        if (relative) {
          const file = relative.replace(/\\/g, '/');
          return {
            ...query,
            scope,
            include: [file],
          };
        }
      }
    }

    if ((scope === 'directory' || scope === 'module') && fsPath) {
      const dir = fsPath.replace(/[\\/][^\\/]+$/, '');
      const relativeDir = toWorkspaceRelative(workspaceRoot, dir);
      if (relativeDir) {
        const base = relativeDir.replace(/\\/g, '/');
        const masks = query.include?.length ? query.include : ['*'];
        const include = masks.map(mask => {
          const m = mask.replace(/\\/g, '/');
          if (m.includes('/')) {
            return m;
          }
          return `${base}/**/${m}`;
        });
        return {
          ...query,
          scope,
          include,
        };
      }
    }

    return { ...query, scope };
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
      onOpenInFindWindow={() => void this.openInFindWindow()}
      mode={this.mode}
      initialQuery={this.initialQuery}
      i18n={this.i18n}
    />;
  }
}

function readEditorSelection(editorManager: EditorManager): string {
  try {
    const editor = editorManager.currentEditor?.editor as { document?: { getText?: (range: unknown) => string }; selection?: unknown } | undefined;
    if (!editor?.document?.getText || !editor.selection) {
      return '';
    }
    return editor.document.getText(editor.selection) ?? '';
  } catch {
    return '';
  }
}

function URIToFsPath(uri: URI): string {
  try {
    return uri.path.fsPath();
  } catch {
    const raw = uri.toString(true);
    if (raw.startsWith('file:///')) {
      const path = decodeURIComponent(raw.slice('file:///'.length));
      return /^[A-Za-z]:/.test(path) ? path : `/${path}`;
    }
    if (raw.startsWith('file://')) {
      return decodeURIComponent(raw.slice('file://'.length));
    }
    return uri.path.toString();
  }
}

function toWorkspaceRelative(workspaceRoot: string, absPath: string): string | undefined {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const full = absPath.replace(/\\/g, '/');
  const fullLower = full.toLowerCase();
  if (fullLower === root) {
    return '';
  }
  if (fullLower.startsWith(root + '/')) {
    return full.slice(root.length + 1);
  }
  // Windows drive-letter case / separator tolerance already handled via lowercasing.
  return undefined;
}
