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
import { KairoI18nService } from '@kairo/i18n';

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

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

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
    this.title.caption = this.t('widget.sql.editor.caption');
    this.title.closable = true;
    this.i18n.onDidChangeLanguage(() => this.update());
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
      <div className="sql-editor-widget kairo-sql-editor-widget">
        <div className="sql-editor-toolbar">
          <select
            value={connectionId}
            onChange={(e) => this.setState({ connectionId: e.target.value })}
            className="sql-connection-selector"
          >
            <option value="">{this.t('widget.sql.editor.selectConnection')}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {this.t('widget.sql.editor.connectionOption', { name: c.name, username: c.username, host: c.host, port: c.port })}
              </option>
            ))}
          </select>
          <button
            className="theia-button"
            onClick={() => this.handleExecute()}
            disabled={!connectionId || !sql.trim() || isExecuting}
            title={this.t('widget.sql.editor.executeTooltip')}
          >
            {isExecuting ? this.t('widget.sql.editor.executing') : this.t('widget.sql.editor.execute')}
          </button>
          <label className="sql-readonly-toggle">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => this.handleReadOnlyToggle(e.target.checked)}
            />
            {this.t('widget.sql.editor.readOnly')}
          </label>
          <button
            className="theia-button"
            onClick={() => this.setState({ showHistory: !showHistory })}
          >
            {showHistory ? this.t('widget.sql.editor.hideHistory') : this.t('widget.sql.editor.history')}
          </button>
        </div>

        <div className="sql-editor-body">
          <textarea
            ref={this.textAreaRef}
            className="sql-editor-textarea"
            value={sql}
            onChange={(e) => this.setState({ sql: e.target.value })}
            onKeyDown={(e) => this.handleKeyDown(e)}
            placeholder={this.t('widget.sql.editor.placeholder')}
            spellCheck={false}
            readOnly={isExecuting}
          />
        </div>

        {showHistory && (
          <div className="sql-history-panel">
            <h4>{this.t('widget.sql.editor.historyTitle')}</h4>
            {history.length === 0 && (
              <div className="sql-empty-message kairo-empty-state">{this.t('widget.sql.editor.historyEmpty')}</div>
            )}
            {history.map((entry) => (
              <div
                key={entry.id}
                className={`sql-history-item ${entry.success ? 'sql-history-success' : 'sql-history-error'}`}
                onClick={() => this.setState({ sql: entry.sql })}
                title={this.t('widget.sql.editor.historyItemTooltip')}
              >
                <span className="sql-history-time">{new Date(entry.executedAt).toLocaleTimeString()}</span>
                <span className="sql-history-sql">{entry.sql.substring(0, 100)}</span>
                <span className="sql-history-meta">
                  {this.t('widget.sql.editor.historyTime', { time: entry.executionTimeMs })}
                  {entry.rowCount !== undefined && this.t('widget.sql.editor.historyRowCount', { count: entry.rowCount })}
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
                  {this.t('widget.sql.editor.executeAnyway')}
                </button>
                <button
                  className="theia-button"
                  onClick={() => this.setState({ confirmDialog: null })}
                >
                  {this.t('common.cancel')}
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
      if (window.confirm(this.t('widget.sql.editor.disableReadOnlyConfirm'))) {
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
            message: this.t('widget.sql.editor.dangerousStatement', { reason: dangerous.reason || '', sql: selectedSql.substring(0, 200) }),
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
      const message = err instanceof Error ? err.message : this.t('common.unknownError');
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

  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key as any, params);
  }

  private setState(partial: Partial<EditorWidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }
}
