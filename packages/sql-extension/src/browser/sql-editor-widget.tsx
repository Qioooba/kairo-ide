/**
 * SQL Editor Widget — Monaco editor with SQL language support,
 * execute button, dangerous statement detection, and statement history.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { Emitter } from '@theia/core/lib/common/event';
import * as React from '@theia/core/shared/react';
import { SqlExecutionService, SqlQueryResult, SqlHistoryEntry } from './sql-execution-service';
import { SqlConnectionService, SqlConnectionConfig } from './sql-connection-service';

interface EditorWidgetState {
  sql: string;
  connectionId: string;
  connections: SqlConnectionConfig[];
  isExecuting: boolean;
  readOnly: boolean;
  history: SqlHistoryEntry[];
  showHistory: boolean;
  confirmDialog: { message: string; onConfirm: () => void } | null;
}

@injectable()
export class SqlEditorWidget extends ReactWidget {
  static readonly ID = 'kairo-sql-editor-widget';
  static readonly LABEL = 'SQL Editor';

  @inject(SqlExecutionService)
  protected readonly executionService!: SqlExecutionService;

  @inject(SqlConnectionService)
  protected readonly connectionService!: SqlConnectionService;

  private textAreaRef = React.createRef<HTMLTextAreaElement>();

  private state: EditorWidgetState = {
    sql: '',
    connectionId: '',
    connections: [],
    isExecuting: false,
    readOnly: true,
    history: [],
    showHistory: false,
    confirmDialog: null,
  };

  @postConstruct()
  protected init(): void {
    this.id = SqlEditorWidget.ID;
    this.title.label = SqlEditorWidget.LABEL;
    this.title.caption = 'Oracle SQL Editor';
    this.title.closable = true;
    this.update();
  }

  protected onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    this.refreshConnections();
    this.connectionService.onConnectionsChanged(() => {
      this.refreshConnections();
    });
  }

  private refreshConnections(): void {
    this.setState({
      connections: this.connectionService.getAllConnections(),
    });
  }

  protected render(): React.ReactNode {
    const { connections, connectionId, sql, isExecuting, readOnly, history, showHistory, confirmDialog } = this.state;

    return (
      <div className="sql-editor-widget">
        <div className="sql-editor-toolbar">
          <select
            value={connectionId}
            onChange={(e) => this.setState({ connectionId: e.target.value })}
            className="sql-connection-selector"
          >
            <option value="">-- Select Connection --</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.username}@{c.host}:{c.port})
              </option>
            ))}
          </select>
          <button
            className="theia-button"
            onClick={() => this.handleExecute()}
            disabled={!connectionId || !sql.trim() || isExecuting}
            title="Execute (F5 / Ctrl+Enter)"
          >
            {isExecuting ? 'Executing...' : 'Execute'}
          </button>
          <label className="sql-readonly-toggle">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => this.handleReadOnlyToggle(e.target.checked)}
            />
            Read-only
          </label>
          <button
            className="theia-button"
            onClick={() => this.setState({ showHistory: !showHistory })}
          >
            {showHistory ? 'Hide History' : 'History'}
          </button>
        </div>

        <div className="sql-editor-body">
          <textarea
            ref={this.textAreaRef}
            className="sql-editor-textarea"
            value={sql}
            onChange={(e) => this.setState({ sql: e.target.value })}
            onKeyDown={(e) => this.handleKeyDown(e)}
            placeholder="Enter SQL statement here...&#10;&#10;F5 or Ctrl+Enter to execute"
            spellCheck={false}
            readOnly={isExecuting}
          />
        </div>

        {showHistory && (
          <div className="sql-history-panel">
            <h4>Statement History (last 50)</h4>
            {history.length === 0 && (
              <div className="sql-empty-message">No executed statements yet.</div>
            )}
            {history.map((entry) => (
              <div
                key={entry.id}
                className={`sql-history-item ${entry.success ? 'sql-history-success' : 'sql-history-error'}`}
                onClick={() => this.setState({ sql: entry.sql })}
                title="Click to load into editor"
              >
                <span className="sql-history-time">{new Date(entry.executedAt).toLocaleTimeString()}</span>
                <span className="sql-history-sql">{entry.sql.substring(0, 100)}</span>
                <span className="sql-history-meta">
                  {entry.executionTimeMs}ms
                  {entry.rowCount !== undefined && ` | ${entry.rowCount} rows`}
                </span>
              </div>
            ))}
          </div>
        )}

        {confirmDialog && (
          <div className="sql-confirm-overlay">
            <div className="sql-confirm-dialog">
              <p>{confirmDialog.message}</p>
              <div className="sql-confirm-actions">
                <button
                  className="theia-button theia-button-danger"
                  onClick={() => {
                    confirmDialog.onConfirm();
                    this.setState({ confirmDialog: null });
                  }}
                >
                  Execute Anyway
                </button>
                <button
                  className="theia-button"
                  onClick={() => this.setState({ confirmDialog: null })}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  private handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'F5' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      this.handleExecute();
    }
  }

  private handleReadOnlyToggle(checked: boolean): void {
    if (!checked) {
      if (window.confirm('Are you sure you want to disable read-only mode? You will be able to execute DDL statements.')) {
        this.setState({ readOnly: false });
      }
    } else {
      this.setState({ readOnly: true });
    }
  }

  private async handleExecute(): Promise<void> {
    const { sql, connectionId, readOnly } = this.state;
    if (!connectionId || !sql.trim()) return;

    // Check for dangerous statements
    if (!readOnly) {
      const selectedSql = this.getSelectedOrCurrentStatement();
      const dangerous = this.executionService.isDangerousStatement(selectedSql);
      if (dangerous.dangerous) {
        this.setState({
          confirmDialog: {
            message: `⚠️ Dangerous Statement: ${dangerous.reason}\n\n${selectedSql.substring(0, 200)}`,
            onConfirm: () => this.doExecute(),
          },
        });
        return;
      }
    }

    await this.doExecute();
  }

  private async doExecute(): Promise<void> {
    const { sql: _sql, connectionId } = this.state;
    const selectedSql = this.getSelectedOrCurrentStatement();

    this.setState({ isExecuting: true });

    try {
      const result = await this.executionService.execute({
        connectionId,
        sql: selectedSql,
      });
      this.setState({
        history: this.executionService.getHistory(connectionId),
      });
      // Emit an event so the results widget can show the result
      this.onResultReadyEmitter.fire(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.setState({
        history: this.executionService.getHistory(connectionId),
      });
      this.onErrorEmitter.fire(message);
    } finally {
      this.setState({ isExecuting: false });
    }
  }

  private getSelectedOrCurrentStatement(): string {
    const textarea = this.textAreaRef.current;
    if (!textarea) return this.state.sql.trim();
    const { selectionStart, selectionEnd } = textarea;
    const sql = this.state.sql;

    if (selectionStart !== selectionEnd) {
      return sql.substring(selectionStart, selectionEnd).trim();
    }
    return this.executionService.extractCurrentStatement(sql, selectionStart);
  }

  // Event emitters for communicating with the results widget
  private readonly onResultReadyEmitter = new Emitter<SqlQueryResult>();
  readonly onResultReady = this.onResultReadyEmitter.event;

  private readonly onErrorEmitter = new Emitter<string>();
  readonly onError = this.onErrorEmitter.event;

  private setState(partial: Partial<EditorWidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }
}