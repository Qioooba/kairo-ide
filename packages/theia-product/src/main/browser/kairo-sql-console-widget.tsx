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
}

const SqlConsole: React.FC<SqlConsoleProps> = ({ sqlService }) => {
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
        setConnStatus('Connected');
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
    setConnStatus('Disconnected');
    setResult(null);
  };

  /* ---- Execution ---- */

  const handleExecute = async () => {
    if (!connected || !connectionId) {
      setConnStatus('Not connected');
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

  const connectionField = (label: string, value: string, onChange: (v: string) => void, type = 'text', placeholder = '') => (
    <label className="kairo-sql-field">
      <span className="kairo-sql-field-label">{label}</span>
      <input
        className="theia-input kairo-sql-input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
      />
    </label>
  );

  return (
    <div className="kairo-widget kairo-sql-console-widget">
      {/* Connection Panel */}
      <div className="kairo-widget-toolbar kairo-sql-toolbar">
        <div className="kairo-sql-connection-fields">
          {connectionField('Host', host, setHost, 'text', 'localhost')}
          {connectionField('Port', port, setPort, 'number', '1521')}
          <label className="kairo-sql-field">
            <span className="kairo-sql-field-label">Service</span>
            <select
              className="theia-select"
              value={useServiceName ? 'serviceName' : 'sid'}
              onChange={e => setUseServiceName(e.target.value === 'serviceName')}
              aria-label="Service type"
            >
              <option value="sid">SID</option>
              <option value="serviceName">Service Name</option>
            </select>
          </label>
          {useServiceName
            ? connectionField('Svc Name', serviceName, setServiceName, 'text', 'ORCL')
            : connectionField('SID', sid, setSid, 'text', 'ORCL')}
          {connectionField('Username', username, setUsername)}
          {connectionField('Password', password, setPassword, 'password')}
        </div>
        <div className="kairo-sql-connection-actions">
          <button
            className="theia-button secondary"
            disabled={connecting}
            onClick={handleTestConnection}
          >
            {connecting ? 'Testing…' : 'Test Connection'}
          </button>
          {connected ? (
            <button
              className="theia-button secondary"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          ) : (
            <button
              className="theia-button main"
              disabled={connecting}
              onClick={handleConnect}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          )}
          <span className={`kairo-sql-status ${connected ? 'kairo-sql-status-connected' : 'kairo-sql-status-disconnected'}`}>
            <span className="kairo-sql-status-dot" />
            {connStatus || (connected ? 'Connected' : 'Disconnected')}
          </span>
        </div>
      </div>

      {/* Editor + Results */}
      <div className="kairo-sql-body">
        {/* SQL Editor */}
        <div className="kairo-sql-editor-section">
          <div className="kairo-sql-editor-header">
            <span className="kairo-sql-editor-title">SQL</span>
            <div className="kairo-sql-editor-actions">
              <button
                className="theia-button"
                disabled={!connected || executing}
                onClick={handleExecute}
              >
                {executing ? 'Executing…' : 'Execute (Ctrl+Enter)'}
              </button>
              <div className="kairo-sql-history-toggle" style={{ position: 'relative' }}>
                <button
                  className="theia-button secondary"
                  onClick={() => setShowHistory(!showHistory)}
                  title="Query History"
                >
                  History
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
            style={{ height: '200px', border: '1px solid var(--theia-dropdown-border)' }}
          />
        </div>

        {/* Results Panel */}
        <div className="kairo-sql-results-section">
          <div className="kairo-sql-results-header">
            <span className="kairo-sql-results-title">Results</span>
            {result && !result.error && (
              <span className="kairo-sql-results-meta">
                {result.rowCount} rows returned in {result.executionTime}ms
              </span>
            )}
          </div>
          <div className="kairo-sql-results-body">
            {result === null ? (
              <p className="kairo-empty">Execute a query to see results.</p>
            ) : result.error ? (
              <div className="kairo-sql-error" role="alert">{result.error}</div>
            ) : result.columns.length === 0 ? (
              <p className="kairo-empty">Query executed successfully. No results.</p>
            ) : (
              <div className="kairo-sql-table-wrapper">
                <table className="kairo-sql-table" aria-label="Query results">
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

  @postConstruct()
  protected init(): void {
    this.id = KairoSqlConsoleWidget.ID;
    this.title.label = 'SQL Console';
    this.title.caption = 'Kairo SQL Console';
    this.title.iconClass = 'codicon codicon-database';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    return <SqlConsole sqlService={this.sqlService} />;
  }
}