/**
 * Kairo SQL Console Widget — interactive SQL query editor and
 * results viewer backed by the Go Agent SQL API endpoints.
 *
 * Features:
 *   - Connection panel: host, port, SID/ServiceName, username, password
 *   - Monaco SQL editor with syntax highlighting
 *   - Results table with column headers, row count, timing
 *   - Query history (last 20)
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import {
  KairoSqlService,
  type SqlConnectionConfig,
  type SqlQueryResult,
} from './kairo-sql-service';
import { KAIRO_SQL_CONSOLE_FACTORY_ID } from './kairo-factory-ids';
import { KairoI18nService } from '@kairo/i18n';
import { ResizableSplit, validatePortText } from '@kairo/ui-kit';

/* ------------------------------------------------------------------ */
/*  SQL Language Registration                                          */
/* ------------------------------------------------------------------ */

let sqlLanguageRegistered = false;

function ensureSqlLanguage(): void {
  if (sqlLanguageRegistered) return;
  sqlLanguageRegistered = true;
  if (!monaco.languages.getLanguages().some(l => l.id === 'sql')) {
    monaco.languages.register({ id: 'sql', extensions: ['.sql'], aliases: ['SQL', 'sql'] });
  }
  monaco.languages.setMonarchTokensProvider('sql', {
    keywords: [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
      'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'LEFT',
      'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN',
      'LIKE', 'BETWEEN', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
      'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'UNION', 'ALL',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'ANY', 'SOME', 'TRUNCATE',
      'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE', 'BEGIN', 'DECLARE', 'EXCEPTION',
      'RAISE', 'PRAGMA', 'EXPLAIN',
    ],
    operators: ['=', '>', '<', '>=', '<=', '<>', '!=', '!<', '!>', '+=', '-=', '*=', '/='],
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/'[^']*'/, 'string'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        [/[0-9]+/, 'number'],
        [/[;,.]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
    ignoreCase: true,
  } as monaco.languages.IMonarchLanguage);
}

/* ------------------------------------------------------------------ */
/*  History helpers                                                     */
/* ------------------------------------------------------------------ */

const HISTORY_KEY = 'kairo.sql.history';
const MAX_HISTORY = 20;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return [];
}

function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  History dropdown — portal overlay with edge flip/shift (UI-15)      */
/* ------------------------------------------------------------------ */

interface HistoryDropdownProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  history: string[];
  label: string;
  onPick(sql: string): void;
  onClose(): void;
}

/**
 * Rendered into document.body (the SQL view is not a modal, so no focus
 * trap is involved) and positioned from the trigger rect with flip/shift:
 * opens upward when there is no room below, clamps horizontally into the
 * viewport. Never relies on z-index alone — ancestors with
 * overflow:hidden cannot clip a body-level fixed layer.
 */
const HistoryDropdown: React.FC<HistoryDropdownProps> = ({ triggerRef, history, label, onPick, onClose }) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>({ visibility: 'hidden' });
  const [activeIdx, setActiveIdx] = React.useState(0);

  const reposition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const maxH = Math.min(220, window.innerHeight - margin * 2);
    const width = Math.min(360, Math.max(240, rect.width * 2));
    const below = window.innerHeight - rect.bottom - 4;
    const openUp = below < 120 && rect.top > below;
    let left = window.innerWidth - margin - width;
    // Prefer right-aligning with the trigger, then shift into view.
    left = Math.min(left, rect.right - width);
    left = Math.max(margin, left);
    setStyle(openUp
      ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 4, width, maxHeight: maxH, visibility: 'visible' }
      : { position: 'fixed', left, top: rect.bottom + 4, width, maxHeight: maxH, visibility: 'visible' });
  }, [triggerRef]);

  React.useLayoutEffect(() => {
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [reposition]);

  React.useEffect(() => {
    listRef.current?.focus();
  }, []);

  const pick = (idx: number) => {
    const sql = history[idx];
    if (sql !== undefined) onPick(sql);
  };

  return createPortal(
    <>
      <div
        className="kairo-sql-history-scrim"
        data-testid="sql-history-scrim"
        onMouseDown={e => { e.preventDefault(); onClose(); }}
      />
      <div
        ref={listRef}
        className="kairo-sql-history-dropdown kairo-sql-history-dropdown-portal"
        data-testid="sql-history-dropdown"
        role="listbox"
        aria-label={label}
        tabIndex={-1}
        style={style}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => {
              const next = Math.min(history.length - 1, i + 1);
              document.getElementById(`kairo-sql-history-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
              return next;
            });
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => {
              const next = Math.max(0, i - 1);
              document.getElementById(`kairo-sql-history-opt-${next}`)?.scrollIntoView({ block: 'nearest' });
              return next;
            });
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(activeIdx);
          }
        }}
      >
        {history.map((h, i) => (
          <div
            key={`${i}-${h.slice(0, 16)}`}
            id={`kairo-sql-history-opt-${i}`}
            className={`kairo-sql-history-item${i === activeIdx ? ' active' : ''}`}
            role="option"
            aria-selected={i === activeIdx}
            onClick={() => pick(i)}
            onMouseEnter={() => setActiveIdx(i)}
            title={h}
          >
            {h.length > 80 ? h.slice(0, 77) + '...' : h}
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
};

/* ------------------------------------------------------------------ */
/*  React component                                                     */
/* ------------------------------------------------------------------ */

interface SqlConsoleProps {
  sqlService: KairoSqlService;
  i18n: KairoI18nService;
}

const SqlConsole: React.FC<SqlConsoleProps> = ({ sqlService, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);
  const [host, setHost] = React.useState('localhost');
  // UI-13: raw port text; validated at connect/test time so clearing or
  // partially typing never collapses into 0.
  const [portText, setPortText] = React.useState('1521');
  const [portError, setPortError] = React.useState<string | undefined>(undefined);
  const [sid, setSid] = React.useState('');
  const [serviceName, setServiceName] = React.useState('');
  const [useServiceName, setUseServiceName] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [connected, setConnected] = React.useState(false);
  const [connectionId, setConnectionId] = React.useState<string>('');
  const [connectedEndpoint, setConnectedEndpoint] = React.useState<string>('');
  const [connStatus, setConnStatus] = React.useState('');
  const [connecting, setConnecting] = React.useState(false);
  const [executing, setExecuting] = React.useState(false);
  const [result, setResult] = React.useState<SqlQueryResult | null>(null);
  const [history, setHistory] = React.useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = React.useState(false);

  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = React.useRef<HTMLDivElement | null>(null);
  const historyButtonRef = React.useRef<HTMLButtonElement | null>(null);
  /** Synchronous in-flight guard: setState-based busy flags cannot stop an
   * adjacent repeated shortcut between render passes (UI-04). */
  const executingRef = React.useRef(false);
  /** Latest connection id visible to the stable Monaco action (UI-04). */
  const connectionRef = React.useRef({ connected, connectionId });
  connectionRef.current = { connected, connectionId };

  /* ---- Execution (single entry for button + shortcut, UI-04) ---- */

  const handleExecute = React.useCallback(async () => {
    // Read connection identity synchronously so the result is always
    // attributed to the connection that started it.
    const snapshot = connectionRef.current;
    if (!snapshot.connected || !snapshot.connectionId) {
      setConnStatus(t('widget.sqlConsole.status.notConnected'));
      return;
    }
    if (executingRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const sql = editor.getValue().trim();
    if (!sql) return;

    executingRef.current = true;
    setExecuting(true);
    setResult(null);
    try {
      const res = await sqlService.executeQuery(snapshot.connectionId, sql);
      // Drop stale completions after disconnect/switch: never write an old
      // connection's result over the new one (UI-04).
      if (connectionRef.current.connectionId !== snapshot.connectionId) return;
      setResult(res);
      // Update history
      setHistory(prev => {
        const newHistory = [sql, ...prev.filter(h => h !== sql)].slice(0, MAX_HISTORY);
        saveHistory(newHistory);
        return newHistory;
      });
    } finally {
      executingRef.current = false;
      setExecuting(false);
    }
  }, [sqlService, t]);

  /* ---- Latest-callback ref: the Monaco action registered once below always
     forwards to the current handleExecute instead of the initial closure. ---- */
  const executeRef = React.useRef<(() => Promise<void>) | null>(null);
  React.useLayoutEffect(() => {
    executeRef.current = handleExecute;
  }, [handleExecute]);

  /* ---- Monaco editor lifecycle (instance stays stable, UI-04) ---- */

  React.useEffect(() => {
    ensureSqlLanguage();
    if (!editorContainerRef.current) return;
    const editor = monaco.editor.create(editorContainerRef.current, {
      value: '',
      language: 'sql',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      wordWrap: 'off',
    });
    editorRef.current = editor;

    // Ctrl+Enter to execute — forwards via executeRef so connect-state
    // changes never require recreating the editor.
    const executeAction = editor.addAction({
      id: 'kairo-sql-execute',
      label: 'Execute SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => executeRef.current?.(),
    });

    return () => {
      executeAction.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  /* ---- Connection ---- */

  const readPort = (): number | undefined => {
    const parsed = validatePortText(portText);
    if (parsed.port === undefined) {
      setPortError(t('widget.sqlConsole.validation.portRange'));
      return undefined;
    }
    setPortError(undefined);
    return parsed.port;
  };

  const buildConfig = (): SqlConnectionConfig | undefined => {
    const port = readPort();
    if (port === undefined) return undefined;
    return {
      host,
      port,
      sid: useServiceName ? undefined : sid,
      serviceName: useServiceName ? serviceName : undefined,
      useServiceName,
      username,
      password,
    };
  };

  const handleTestConnection = async () => {
    const config = buildConfig();
    if (!config) return;
    setConnecting(true);
    setConnStatus('');
    try {
      const res = await sqlService.testConnection(config);
      setConnStatus(res.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleConnect = async () => {
    const config = buildConfig();
    if (!config) return;
    setConnecting(true);
    setConnStatus('');
    try {
      const res = await sqlService.testConnection(config);
      if (res.success) {
        const endpoint = `${host}:${config.port}/${useServiceName ? serviceName : sid}`;
        setConnected(true);
        setConnectionId(endpoint);
        setConnectedEndpoint(endpoint);
        setConnStatus(t('widget.sqlConsole.status.connected'));
      } else {
        setConnected(false);
        setConnStatus(res.message);
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    // Invalidate in-flight executions so their results are discarded (UI-04).
    connectionRef.current = { connected: false, connectionId: '' };
    setConnected(false);
    setConnectionId('');
    setConnStatus(t('widget.sqlConsole.status.disconnected'));
    setResult(null);
  };

  const handleHistoryPick = (sql: string) => {
    const editor = editorRef.current;
    if (editor) {
      editor.setValue(sql);
      editor.focus();
    }
    setShowHistory(false);
    // Return focus to the trigger that opened the list (UI-15).
    historyButtonRef.current?.focus();
  };

  const closeHistory = () => {
    setShowHistory(false);
    historyButtonRef.current?.focus();
  };

  /* ---- Render ---- */

  const connectionField = (labelKey: string, value: string, onChange: (v: string) => void, type = 'text', placeholderKey = '') => (
    <label className="kairo-sql-field" htmlFor={`kairo-sql-${labelKey.split('.').pop()}`}>
      <span className="kairo-sql-field-label">{t(labelKey)}</span>
      <input
        id={`kairo-sql-${labelKey.split('.').pop()}`}
        className="theia-input kairo-sql-input"
        type={type}
        value={value}
        placeholder={placeholderKey ? t(placeholderKey) : ''}
        onChange={e => onChange(e.target.value)}
        aria-label={t(labelKey)}
        disabled={connected}
      />
    </label>
  );

  return (
    <div className="kairo-widget kairo-sql-console-widget">
      {/* Connection Panel */}
      <div className="kairo-sql-toolbar">
        <div className="kairo-sql-connection-fields">
          {connectionField('widget.sqlConsole.label.host', host, setHost, 'text', 'widget.sqlConsole.placeholder.host')}
          <label className="kairo-sql-field" htmlFor="kairo-sql-port">
            <span className="kairo-sql-field-label">{t('widget.sqlConsole.label.port')}</span>
            <input
              id="kairo-sql-port"
              data-testid="sql-port"
              className="theia-input kairo-sql-input"
              type="text"
              inputMode="numeric"
              value={portText}
              placeholder={t('widget.sqlConsole.placeholder.port')}
              onChange={e => setPortText(e.target.value)}
              aria-label={t('widget.sqlConsole.label.port')}
              aria-invalid={portError ? true : undefined}
              aria-describedby={portError ? 'kairo-sql-port-error' : undefined}
              disabled={connected}
            />
            {portError && <span id="kairo-sql-port-error" className="kairo-sql-field-error" role="alert">{portError}</span>}
          </label>
          <label className="kairo-sql-field">
            <span className="kairo-sql-field-label">{t('widget.sqlConsole.label.serviceType')}</span>
            <select
              className="theia-select"
              value={useServiceName ? 'serviceName' : 'sid'}
              onChange={e => setUseServiceName(e.target.value === 'serviceName')}
              aria-label={t('widget.sqlConsole.label.serviceType')}
            >
              <option value="sid">{t('widget.sqlConsole.label.sid')}</option>
              <option value="serviceName">{t('widget.sqlConsole.label.serviceName')}</option>
            </select>
          </label>
          {useServiceName
            ? connectionField('widget.sqlConsole.label.serviceName', serviceName, setServiceName, 'text', 'widget.sqlConsole.placeholder.serviceName')
            : connectionField('widget.sqlConsole.label.sid', sid, setSid, 'text', 'widget.sqlConsole.placeholder.sid')}
          {connectionField('widget.sqlConsole.label.username', username, setUsername)}
          {connectionField('widget.sqlConsole.label.password', password, setPassword, 'password')}
        </div>
        <div className="kairo-sql-connection-actions">
          <button
            className="theia-button secondary"
            disabled={connecting}
            onClick={handleTestConnection}
          >
            {connecting ? t('widget.sqlConsole.action.testing') : t('widget.sqlConsole.action.testConnection')}
          </button>
          {connected ? (
            <button
              className="theia-button secondary"
              onClick={handleDisconnect}
            >
              {t('widget.sqlConsole.action.disconnect')}
            </button>
          ) : (
            <button
              className="theia-button main"
              disabled={connecting}
              onClick={handleConnect}
            >
              {connecting ? t('widget.sqlConsole.action.connecting') : t('widget.sqlConsole.action.connect')}
            </button>
          )}
          <span className={`kairo-sql-status ${connected ? 'kairo-sql-status-connected' : 'kairo-sql-status-disconnected'}`}>
            <span className="kairo-sql-status-dot" aria-hidden="true" />
            {connStatus || (connected ? t('widget.sqlConsole.status.connected') : t('widget.sqlConsole.status.disconnected'))}
          </span>
          {/* The connected endpoint is the source of truth; the draft fields
              above are locked while connected — disconnect to modify (UI-04). */}
          {connected && (
            <span className="kairo-sql-endpoint" data-testid="sql-connection-endpoint" title={connectedEndpoint}>
              {connectedEndpoint}
            </span>
          )}
        </div>
      </div>

      {/* Editor + Results — internal split with mouse/keyboard/collapse (UI-06) */}
      <div className="kairo-sql-body">
        <ResizableSplit
          orientation="horizontal"
          primaryMinPx={80}
          secondaryMinPx={80}
          defaultRatio={0.55}
          storageKey="sql:editor-results"
          primaryLabel={t('widget.sqlConsole.editor.title')}
          secondaryLabel={t('widget.sqlConsole.results.title')}
          testId="sql-editor-results"
          primary={(
            <div className="kairo-sql-editor-section">
              <div className="kairo-sql-editor-header">
                <span className="kairo-sql-editor-title">{t('widget.sqlConsole.editor.title')}</span>
                <div className="kairo-sql-editor-actions">
                  <button
                    className="theia-button main"
                    data-testid="sql-execute"
                    disabled={!connected || executing}
                    onClick={handleExecute}
                  >
                    {executing ? t('widget.sqlConsole.action.executing') : t('widget.sqlConsole.action.execute')}
                  </button>
                  <div className="kairo-sql-history-toggle">
                    <button
                      ref={historyButtonRef}
                      className="theia-button secondary"
                      data-testid="sql-history-toggle"
                      aria-haspopup="listbox"
                      aria-expanded={showHistory}
                      onClick={() => setShowHistory(v => !v)}
                      title={t('widget.sqlConsole.history.tooltip')}
                    >
                      {t('widget.sqlConsole.history.title')}
                    </button>
                  </div>
                </div>
              </div>
              <div
                ref={editorContainerRef}
                className="kairo-sql-editor-container"
              />
            </div>
          )}
          secondary={(
            <div className="kairo-sql-results-section">
              <div className="kairo-sql-results-header">
                <span className="kairo-sql-results-title">{t('widget.sqlConsole.results.title')}</span>
                {result && !result.error && (
                  <span className="kairo-sql-results-meta">
                    {t('widget.sqlConsole.results.rowsReturned', { count: result.rowCount, time: result.executionTime })}
                  </span>
                )}
              </div>
              <div className="kairo-sql-results-body">
                {result === null ? (
                  <p className="kairo-empty">{t('widget.sqlConsole.results.executeQuery')}</p>
                ) : result.error ? (
                  <div className="kairo-sql-error" role="alert">{result.error}</div>
                ) : result.columns.length === 0 ? (
                  <p className="kairo-empty">{t('widget.sqlConsole.results.noResults')}</p>
                ) : (
                  <div className="kairo-sql-table-wrapper">
                    <table className="kairo-sql-table" aria-label={t('widget.sqlConsole.results.title')}>
                      <thead>
                        <tr>
                          {result.columns.map((col, i) => (
                            <th key={i}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell: unknown, ci: number) => (
                              <td key={ci}>{cell === null ? <em>NULL</em> : String(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        />
      </div>
      {/* History overlay: body-level portal with flip/shift + Esc + focus restore (UI-15) */}
      {showHistory && history.length > 0 && (
        <HistoryDropdown
          triggerRef={historyButtonRef}
          history={history}
          label={t('widget.sqlConsole.history.tooltip')}
          onPick={handleHistoryPick}
          onClose={closeHistory}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Widget class                                                        */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoSqlConsoleWidget extends ReactWidget {
  static readonly ID = KAIRO_SQL_CONSOLE_FACTORY_ID;

  @inject(KairoSqlService)
  protected readonly sqlService!: KairoSqlService;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  @postConstruct()
  protected init(): void {
    this.id = KairoSqlConsoleWidget.ID;
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    this.title.iconClass = 'codicon codicon-database';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.sqlConsole.title');
    this.title.caption = this.i18n.t('widget.sqlConsole.caption');
  }

  protected render(): React.ReactNode {
    return <SqlConsole sqlService={this.sqlService} i18n={this.i18n} />;
  }
}