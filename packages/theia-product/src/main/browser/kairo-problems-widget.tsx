/**
 * Kairo Problems Widget — unified diagnostic panel for build
 * and Java diagnostics with advanced filtering and navigation.
 *
 * §7.3 P2-JAVA — 快速筛选和问题导航
 *
 * Features:
 *   - Filter bar: severity toggles, file autocomplete, type dropdown, current file
 *   - Next Problem (F8) / Previous Problem (Shift+F8) navigation
 *   - Problem count badge by severity
 *   - "No problems" when filtered results are empty
 *   - Remember filter state across sessions
 */

import * as React from 'react';
import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import { KairoI18nService } from '@kairo/i18n';

/** Factory ID for the widget. */
export const KAIRO_PROBLEMS_FACTORY_ID = 'kairo-problems';

/** Type filter options. */
type TypeFilter = 'All' | 'Java' | 'Ant' | 'XML' | 'JSP' | 'Encoding';

/** Owner constants matching the Monaco marker owners. */
const BUILD_OWNER = 'kairo-build';
const JAVA_OWNER = 'java';
const _JSP_OWNER = 'jsp';
const _XML_OWNER = 'xml';
const _ENCODING_OWNER = 'encoding';

/** localStorage key for filter state. */
const FILTER_STATE_KEY = 'kairo.problems.filterState';

interface MarkerEntry {
  key: string;
  severity: monaco.MarkerSeverity;
  severityLabel: string;
  file: string;
  filePath: string;
  line: number;
  column: number;
  message: string;
  source: string;
  uri: monaco.Uri;
}

interface FilterState {
  showErrors: boolean;
  showWarnings: boolean;
  showInfos: boolean;
  fileFilter: string;
  typeFilter: TypeFilter;
  currentFileOnly: boolean;
}

function severityLabel(severity: monaco.MarkerSeverity, t: (key: string) => string): string {
  switch (severity) {
    case monaco.MarkerSeverity.Error: return t('widget.problems.severity.error');
    case monaco.MarkerSeverity.Warning: return t('widget.problems.severity.warning');
    case monaco.MarkerSeverity.Info: return t('widget.problems.severity.info');
    default: return t('widget.problems.severity.hint');
  }
}

function severityClass(severity: monaco.MarkerSeverity): string {
  switch (severity) {
    case monaco.MarkerSeverity.Error: return 'kairo-problem-severity-error';
    case monaco.MarkerSeverity.Warning: return 'kairo-problem-severity-warning';
    case monaco.MarkerSeverity.Info: return 'kairo-problem-severity-info';
    default: return 'kairo-problem-severity-hint';
  }
}

function sourceLabel(owner: string): string {
  if (owner === BUILD_OWNER) return 'Java';
  if (owner === JAVA_OWNER) return 'Java';
  return owner;
}

function detectType(entry: MarkerEntry): string {
  const path = entry.filePath.toLowerCase();
  if (path.endsWith('.java')) return 'Java';
  if (path.endsWith('.xml') || path.endsWith('.tld')) return 'XML';
  if (path.endsWith('.jsp') || path.endsWith('.jspx') || path.endsWith('.tag')) return 'JSP';
  if (path.endsWith('.properties')) return 'Encoding';
  if (entry.source === 'Build') return 'Ant';
  return 'Java';
}

function markersToEntries(markers: monaco.editor.IMarker[], t: (key: string) => string): MarkerEntry[] {
  return markers.map((m, i) => ({
    key: `${m.resource.toString()}:${m.startLineNumber}:${m.startColumn}:${i}`,
    severity: m.severity,
    severityLabel: severityLabel(m.severity, t),
    file: m.resource.path.split('/').pop() ?? m.resource.path,
    filePath: m.resource.path,
    line: m.startLineNumber,
    column: m.startColumn,
    message: m.message,
    source: sourceLabel(m.owner),
    uri: m.resource,
  }));
}

function loadFilterState(): FilterState {
  try {
    const saved = localStorage.getItem(FILTER_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        showErrors: true,
        showWarnings: true,
        showInfos: true,
        fileFilter: '',
        typeFilter: 'All',
        currentFileOnly: false,
        ...parsed,
      };
    }
  } catch { /* ignore */ }
  return {
    showErrors: true,
    showWarnings: true,
    showInfos: true,
    fileFilter: '',
    typeFilter: 'All',
    currentFileOnly: false,
  };
}

function saveFilterState(state: FilterState): void {
  try {
    localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

interface KairoProblemsProps {
  openerService: OpenerService;
  editorManager: EditorManager;
  i18n: KairoI18nService;
}

const KairoProblems: React.FC<KairoProblemsProps> = ({ openerService, editorManager, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [entries, setEntries] = React.useState<MarkerEntry[]>([]);
  const [filterState, setFilterState] = React.useState<FilterState>(loadFilterState);
  const [selectedIndex, setSelectedIndex] = React.useState<number>(-1);
  const [fileSuggestions, setFileSuggestions] = React.useState<string[]>([]);
  const [showFileDropdown, setShowFileDropdown] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [disabled, setDisabled] = React.useState(false);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  const refresh = React.useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      const markers = monaco.editor.getModelMarkers({});
      const all = markersToEntries(markers, t);
      setEntries(all);
      setFileSuggestions([...new Set(all.map(e => e.file))].sort());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load markers.');
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    refresh();
    const disposable = monaco.editor.onDidChangeMarkers(() => refresh());
    return () => disposable.dispose();
  }, [refresh]);

  // Detect disabled state: no editor open = problems view is not applicable
  React.useEffect(() => {
    const checkDisabled = () => {
      const editor = editorManager.currentEditor;
      // Only show disabled hint when there is literally no editor open
      setDisabled(!editor && entries.length === 0);
    };
    checkDisabled();
    const interval = setInterval(checkDisabled, 2000);
    return () => clearInterval(interval);
  }, [editorManager, entries.length]);

  const updateFilter = (partial: Partial<FilterState>) => {
    setFilterState(prev => {
      const next = { ...prev, ...partial };
      saveFilterState(next);
      return next;
    });
  };

  const getCurrentFilePath = (): string => {
    const editor = editorManager.currentEditor;
    if (!editor) return '';
    return new URI(String(editor.editor.document.uri)).path.toString();
  };

  const filtered = React.useMemo(() => {
    const currentFile = getCurrentFilePath();
    return entries.filter(e => {
      // Severity checkboxes
      if (!filterState.showErrors && e.severity === monaco.MarkerSeverity.Error) return false;
      if (!filterState.showWarnings && e.severity === monaco.MarkerSeverity.Warning) return false;
      if (!filterState.showInfos && e.severity === monaco.MarkerSeverity.Info) return false;

      // File filter
      if (filterState.fileFilter) {
        const term = filterState.fileFilter.toLowerCase();
        if (!e.file.toLowerCase().includes(term) && !e.filePath.toLowerCase().includes(term)) {
          return false;
        }
      }

      // Type filter
      if (filterState.typeFilter !== 'All') {
        if (detectType(e) !== filterState.typeFilter) return false;
      }

      // Current file only
      if (filterState.currentFileOnly && currentFile) {
        if (e.filePath !== currentFile) return false;
      }

      return true;
    });
  }, [entries, filterState]);

  const handleClick = (entry: MarkerEntry) => {
    const uri = new URI(entry.uri.toString());
    const range = {
      line: entry.line - 1,
      character: entry.column - 1,
    };
    open(openerService, uri, {
      selection: { start: range, end: range },
    });
  };

  const navigateToProblem = (direction: 'next' | 'prev') => {
    if (filtered.length === 0) return;
    let newIndex: number;
    if (selectedIndex < 0) {
      newIndex = direction === 'next' ? 0 : filtered.length - 1;
    } else {
      newIndex = direction === 'next'
        ? (selectedIndex + 1) % filtered.length
        : (selectedIndex - 1 + filtered.length) % filtered.length;
    }
    setSelectedIndex(newIndex);
    handleClick(filtered[newIndex]);
  };

  // Keyboard navigation
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        if (!e.shiftKey) {
          e.preventDefault();
          navigateToProblem('next');
        }
      } else if (e.key === 'F8' && e.shiftKey) {
        // Shift+F8 is handled below
      }
    };
    const shiftHandler = (e: KeyboardEvent) => {
      if (e.key === 'F8' && e.shiftKey) {
        e.preventDefault();
        navigateToProblem('prev');
      }
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keydown', shiftHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', shiftHandler);
    };
  }, [filtered, selectedIndex]);

  const counts = React.useMemo(() => {
    const e = entries.filter(e => e.severity === monaco.MarkerSeverity.Error).length;
    const w = entries.filter(e => e.severity === monaco.MarkerSeverity.Warning).length;
    const i = entries.filter(e => e.severity === monaco.MarkerSeverity.Info).length;
    return { errors: e, warnings: w, infos: i };
  }, [entries]);

  const typeFilterOptions: TypeFilter[] = ['All', 'Java', 'Ant', 'XML', 'JSP', 'Encoding'];

  return (
    <div className={`kairo-widget kairo-problems-widget${disabled ? ' kairo-problems-disabled' : ''}`} aria-busy={loading}>
      {/* Loading State */}
      {loading && (
        <div className="kairo-loading" role="status" aria-label={t('widget.problems.loading')}>
          <div className="kairo-spinner" />
          <span className="kairo-loading-text">{t('widget.problems.loading')}</span>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div role="alert" aria-live="assertive" className="kairo-problems-error">
          <div className="kairo-problems-error-box">
            <div className="kairo-problems-error-title">
              <span aria-hidden="true">⚠</span>
              <strong>{t('widget.problems.error')}</strong>
            </div>
            <p className="kairo-problems-error-message">{error}</p>
            <button
              className="theia-button secondary"
              onClick={refresh}
              aria-label={t('widget.problems.retry')}
            >
              {t('widget.problems.retry')}
            </button>
          </div>
        </div>
      )}

      {/* Disabled State */}
      {!loading && !error && disabled && (
        <div className="kairo-empty kairo-problems-disabled" role="status" aria-label={t('widget.problems.noEditor')}>
          <p>{t('widget.problems.noEditor')}</p>
        </div>
      )}

      {/* Filter Bar */}
      {!loading && !error && !disabled && (
      <>
      <div className="kairo-widget-toolbar kairo-problems-toolbar">
        {/* Severity toggle checkboxes */}
        <div className="kairo-problems-filter-group">
          <label className="kairo-problems-filter-checkbox">
            <input
              type="checkbox"
              checked={filterState.showErrors}
              onChange={e => updateFilter({ showErrors: e.target.checked })}
            />
            <span className="kairo-problems-count-error">{t('widget.problems.errors', { count: counts.errors })}</span>
          </label>
          <label className="kairo-problems-filter-checkbox">
            <input
              type="checkbox"
              checked={filterState.showWarnings}
              onChange={e => updateFilter({ showWarnings: e.target.checked })}
            />
            <span className="kairo-problems-count-warning">{t('widget.problems.warnings', { count: counts.warnings })}</span>
          </label>
          <label className="kairo-problems-filter-checkbox">
            <input
              type="checkbox"
              checked={filterState.showInfos}
              onChange={e => updateFilter({ showInfos: e.target.checked })}
            />
            <span className="kairo-problems-count-info">{t('widget.problems.infos', { count: counts.infos })}</span>
          </label>
        </div>

        {/* File filter with autocomplete */}
        <div className="kairo-problems-filter-group kairo-problems-filter-group-relative">
          <input
            type="text"
            className="theia-input kairo-problems-file-input"
            placeholder={t('widget.problems.filterPlaceholder')}
            value={filterState.fileFilter}
            onChange={e => {
              updateFilter({ fileFilter: e.target.value });
              setShowFileDropdown(true);
            }}
            onFocus={() => setShowFileDropdown(true)}
            onBlur={() => setTimeout(() => setShowFileDropdown(false), 200)}
          />
          {showFileDropdown && filterState.fileFilter && (
            <div className="kairo-problems-file-dropdown">
              {fileSuggestions
                .filter(f => f.toLowerCase().includes(filterState.fileFilter.toLowerCase()))
                .slice(0, 10)
                .map(f => (
                  <div
                    key={f}
                    className="kairo-problems-file-dropdown-item"
                    onMouseDown={() => {
                      updateFilter({ fileFilter: f });
                      setShowFileDropdown(false);
                    }}
                  >
                    {f}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Type filter dropdown */}
        <label className="kairo-problems-filter-label">
          {t('widget.problems.typeLabel')}
          <select
            value={filterState.typeFilter}
            onChange={e => updateFilter({ typeFilter: e.target.value as TypeFilter })}
            className="theia-select kairo-problems-select"
          >
            {typeFilterOptions.map(o => (
              <option key={o} value={o}>{o === 'All' ? t('widget.problems.allTypes') : o}</option>
            ))}
          </select>
        </label>

        {/* Current file only toggle */}
        <label className="kairo-problems-filter-checkbox">
          <input
            type="checkbox"
            checked={filterState.currentFileOnly}
            onChange={e => updateFilter({ currentFileOnly: e.target.checked })}
          />
          <span>{t('widget.problems.currentFileOnly')}</span>
        </label>

        {/* Navigation buttons */}
        <div className="kairo-problems-nav">
          <button
            className="theia-button secondary"
            onClick={() => navigateToProblem('prev')}
            title={t('widget.problems.previousTooltip')}
          >
            {t('widget.problems.previous')}
          </button>
          <button
            className="theia-button secondary"
            onClick={() => navigateToProblem('next')}
            title={t('widget.problems.nextTooltip')}
          >
            {t('widget.problems.next')}
          </button>
        </div>
      </div>

      {/* Problem list */}
      <div className="kairo-widget-body kairo-problems-body">
        {filtered.length === 0 ? (
          <p className="kairo-empty">
            {entries.length === 0 ? t('widget.problems.noProblems') : t('widget.problems.noMatchingProblems')}
          </p>
        ) : (
          <table className="kairo-problems-table" aria-label={t('widget.problems.title')}>
            <thead>
              <tr>
                <th className="kairo-problems-col-severity">{t('widget.problems.columns.severity')}</th>
                <th className="kairo-problems-col-file">{t('widget.problems.columns.file')}</th>
                <th className="kairo-problems-col-line">{t('widget.problems.columns.line')}</th>
                <th className="kairo-problems-col-message">{t('widget.problems.columns.message')}</th>
                <th className="kairo-problems-col-source">{t('widget.problems.columns.source')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, idx) => (
                <tr
                  key={entry.key}
                  className={`kairo-problems-row${idx === selectedIndex ? ' kairo-problems-row-selected' : ''}`}
                  onClick={() => { handleClick(entry); setSelectedIndex(idx); }}
                  title={`${entry.file}:${entry.line}:${entry.column} — ${entry.message}`}
                  role="link"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') { handleClick(entry); setSelectedIndex(idx); } }}
                >
                  <td className={`kairo-problems-col-severity ${severityClass(entry.severity)}`}>
                    {entry.severityLabel}
                  </td>
                  <td className="kairo-problems-col-file">{entry.file}</td>
                  <td className="kairo-problems-col-line">{entry.line}</td>
                  <td className="kairo-problems-col-message">{entry.message}</td>
                  <td className="kairo-problems-col-source">
                    <span className={`kairo-problems-source-badge kairo-problems-source-${detectType(entry).toLowerCase()}`}>
                      {detectType(entry)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}
    </div>
  );
};

@injectable()
export class KairoProblemsWidget extends ReactWidget {
  static readonly ID = KAIRO_PROBLEMS_FACTORY_ID;

  @inject(OpenerService)
  protected readonly openerService!: OpenerService;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = KAIRO_PROBLEMS_FACTORY_ID;
    this.title.label = '问题';
    this.title.caption = 'Kairo 问题面板';
    this.title.iconClass = 'codicon codicon-warning';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.title.label = this.i18n.t('widget.problems.title');
    this.title.caption = this.i18n.t('widget.problems.caption');
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.title.label = this.i18n.t('widget.problems.title');
      this.title.caption = this.i18n.t('widget.problems.caption');
      this.update();
    }));
    this.update();
  }

  render(): React.ReactNode {
    return React.createElement(KairoProblems, {
      openerService: this.openerService,
      editorManager: this.editorManager,
      i18n: this.i18n,
    });
  }
}
