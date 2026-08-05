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
  const [port, setPort] = React.useState('1521');
  const [sid, setSid] = React.useState('');
  const [serviceName, setServiceName] = React.useState('');
  const [useServiceName, setUseServiceName] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [connected, setConnected] = React.useState(false);
  const [connectionId, setConnectionId] = React.useState<string>('');
  const [connStatus, setConnStatus] = React.useState('');
  const [connecting, setConnecting] = React.useState(false);
  const [executing, setExecuting] = React.useState(false);
  const [result, setResult] = React.useState<SqlQueryResult | null>(null);
  const [history, setHistory] = React.useState<string[]>(loadHistory);
  const [showHistory, setShowHistory] = React.useState(false);

  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = React.useRef<HTMLDivElement | null>(null);

  /* ---- Monaco editor lifecycle ---- */

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

    // Ctrl+Enter to execute
    editor.addAction({
      id: 'kairo-sql-execute',
      label: 'Execute SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => handleExecute(),
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  /* ---- Connection ---- */

  const buildConfig = (): SqlConnectionConfig => ({
    host,
    port: Number(port) || 1521,
    sid: useServiceName ? undefined : sid,
    serviceName: useServiceName ? serviceName : undefined,
    useServiceName,
    username,
    password,
  });

  const handleTestConnection = async () => {
    setConnecting(true);
    setConnStatus('');
    try {
      const res = await sqlService.testConnection(buildConfig());
      setConnStatus(res.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setConnStatus('');
    try {
      const res = await sqlService.testConnection(buildConfig());
      if (res.success) {
        setConnected(true);
        setConnectionId(`${host}:${port}/${useServiceName ? serviceName : sid}`);
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
    setConnected(false);
    setConnectionId('');
    setConnStatus(t('widget.sqlConsole.status.disconnected'));
    setResult(null);
  };

  /* ---- Execution ---- */

  const handleExecute = async () => {
    if (!connected || !connectionId) {
      setConnStatus(t('widget.sqlConsole.status.notConnected'));
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const sql = editor.getValue().trim();
    if (!sql) return;

    setExecuting(true);
    setResult(null);
    try {
      const res = await sqlService.executeQuery(connectionId, sql);
      setResult(res);
      // Update history
      const newHistory = [sql, ...history.filter(h => h !== sql)].slice(0, MAX_HISTORY);
      setHistory(newHistory);
      saveHistory(newHistory);
    } finally {
      setExecuting(false);
    }
  };

  const handleHistoryClick = (sql: string) => {
    const editor = editorRef.current;
    if (editor) {
      editor.setValue(sql);
      editor.focus();
    }
    setShowHistory(false);
  };

  /* ---- Render ---- */

  const connectionField = (labelKey: string, value: string, onChange: (v: string) => void, type = 'text', placeholderKey = '') => (
    <label className="kairo-sql-field">
      <span className="kairo-sql-field-label">{t(labelKey)}</span>
      <input
        className="theia-input kairo-sql-input"
        type={type}
        value={value}
        placeholder={placeholderKey ? t(placeholderKey) : ''}
        onChange={e => onChange(e.target.value)}
        aria-label={t(labelKey)}
      />
    </label>
  );

  return (
    <div className="kairo-widget kairo-sql-console-widget">
      {/* Connection Panel */}
      <div className="kairo-sql-toolbar">
        <div className="kairo-sql-connection-fields">
          {connectionField('widget.sqlConsole.label.host', host, setHost, 'text', 'widget.sqlConsole.placeholder.host')}
          {connectionField('widget.sqlConsole.label.port', port, setPort, 'number', 'widget.sqlConsole.placeholder.port')}
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
            <span className="kairo-sql-status-dot" />
            {connStatus || (connected ? t('widget.sqlConsole.status.connected') : t('widget.sqlConsole.status.disconnected'))}
          </span>
        </div>
      </div>

      {/* Editor + Results */}
      <div className="kairo-sql-body">
        {/* SQL Editor */}
        <div className="kairo-sql-editor-section">
          <div className="kairo-sql-editor-header">
            <span className="kairo-sql-editor-title">{t('widget.sqlConsole.editor.title')}</span>
            <div className="kairo-sql-editor-actions">
              <button
                className="theia-button main"
                disabled={!connected || executing}
                onClick={handleExecute}
              >
                {executing ? t('widget.sqlConsole.action.executing') : t('widget.sqlConsole.action.execute')}
              </button>
              <div className="kairo-sql-history-toggle">
                <button
                  className="theia-button secondary"
                  onClick={() => setShowHistory(!showHistory)}
                  title={t('widget.sqlConsole.history.tooltip')}
                >
                  {t('widget.sqlConsole.history.title')}
                </button>
                {showHistory && history.length > 0 && (
                  <div className="kairo-sql-history-dropdown">
                    {history.map((h, i) => (
                      <div
                        key={i}
                        className="kairo-sql-history-item"
                        onClick={() => handleHistoryClick(h)}
                        title={h}
                      >
                        {h.length > 80 ? h.slice(0, 77) + '...' : h}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div
            ref={editorContainerRef}
            className="kairo-sql-editor-container"
          />
        </div>

        {/* Results Panel */}
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
      </div>
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