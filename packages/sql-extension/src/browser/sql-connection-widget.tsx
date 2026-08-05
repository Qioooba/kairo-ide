/**
 * SQL Connection Widget — connection list view with add/edit/delete/test/connect.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import * as React from '@theia/core/shared/react';
import { SqlConnectionService, SqlConnectionConfig, SqlConnectionStatus } from './sql-connection-service';
import { KairoI18nService } from '@kairo/i18n';

interface ConnectionWidgetState {
  connections: SqlConnectionConfig[];
  connectionStates: Record<string, SqlConnectionStatus>;
  oracleVersions: Record<string, string | undefined>;
  errors: Record<string, string | undefined>;
  editingId: string | null;
  showAddForm: boolean;
  formData: SqlConnectionFormData;
  testResults: Record<string, { running: boolean; result?: string }>;
}

interface SqlConnectionFormData {
  name: string;
  host: string;
  port: number;
  sid: string;
  serviceName: string;
  useServiceName: boolean;
  username: string;
  password: string;
}

@injectable()
export class SqlConnectionWidget extends ReactWidget {
  static readonly ID = 'kairo-sql-connection-widget';
  static readonly LABEL = 'SQL Connections';

  @inject(SqlConnectionService)
  protected readonly connectionService!: SqlConnectionService;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  private state: ConnectionWidgetState = {
    connections: [],
    connectionStates: {},
    oracleVersions: {},
    errors: {},
    editingId: null,
    showAddForm: false,
    formData: {
      name: '',
      host: 'localhost',
      port: 1521,
      sid: 'orcl',
      serviceName: '',
      useServiceName: false,
      username: '',
      password: '',
    },
    testResults: {},
  };

  @postConstruct()
  protected init(): void {
    this.id = SqlConnectionWidget.ID;
    this.title.label = SqlConnectionWidget.LABEL;
    this.title.caption = this.t('widget.sql.connection.caption');
    this.title.closable = true;
    this.i18n.onDidChangeLanguage(() => this.update());
    this.update();
  }

  protected onAfterAttach(message: Message): void {
    super.onAfterAttach(message);
    this.connectionService.loadConnections().then(() => {
      this.refreshState();
    });
    this.connectionService.onConnectionsChanged(() => {
      this.refreshState();
    });
    this.connectionService.onConnectionStateChanged((cs) => {
      this.state.connectionStates[cs.config.id] = cs.status;
      this.state.oracleVersions[cs.config.id] = cs.oracleVersion;
      this.state.errors[cs.config.id] = cs.error;
      this.update();
    });
  }

  private refreshState(): void {
    this.state.connections = this.connectionService.getAllConnections();
    for (const conn of this.state.connections) {
      const cs = this.connectionService.getConnectionState(conn.id);
      if (cs) {
        this.state.connectionStates[conn.id] = cs.status;
        this.state.oracleVersions[conn.id] = cs.oracleVersion;
        this.state.errors[conn.id] = cs.error;
      }
    }
    this.update();
  }

  protected render(): React.ReactNode {
    return (
      <div className="sql-connection-widget kairo-sql-connection-widget">
        <div className="sql-connection-header kairo-widget-header">
          <h3 className="kairo-widget-title">{this.t('widget.sql.connection.title')}</h3>
          <button
            className="theia-button"
            onClick={() => this.setState({ showAddForm: !this.state.showAddForm, editingId: null })}
          >
            {this.state.showAddForm ? this.t('common.cancel') : this.t('widget.sql.connection.addConnection')}
          </button>
        </div>

        {this.state.showAddForm && this.renderForm()}
        {this.state.editingId && this.renderForm()}

        <div className="sql-connection-list">
          {this.state.connections.length === 0 && (
            <div className="sql-empty-message kairo-empty-state">{this.t('widget.sql.connection.empty')}</div>
          )}
          {this.state.connections.map((conn) => this.renderConnectionItem(conn))}
        </div>

        <div className="sql-connection-actions">
          <button
            className="theia-button"
            onClick={() => this.handleExport()}
          >
            {this.t('widget.sql.connection.exportConfigs')}
          </button>
          <button
            className="theia-button"
            onClick={() => this.handleImport()}
          >
            {this.t('widget.sql.connection.importConfigs')}
          </button>
        </div>
      </div>
    );
  }

  private renderConnectionItem(conn: SqlConnectionConfig): React.ReactNode {
    const status = this.state.connectionStates[conn.id] || 'disconnected';
    const version = this.state.oracleVersions[conn.id];
    const error = this.state.errors[conn.id];
    const testResult = this.state.testResults[conn.id];

    return (
      <div key={conn.id} className="sql-connection-item">
        <div className="sql-connection-item-header">
          <span
            className={`sql-connection-status-dot kairo-status-${status}`}
            title={this.t(`widget.sql.connection.status.${status}`)}
          />
          <span className="sql-connection-name">{conn.name}</span>
          <span className="sql-connection-detail">
            {this.t('widget.sql.connection.detail', {
              username: conn.username,
              host: conn.host,
              port: conn.port,
              database: (conn.useServiceName ? conn.serviceName : conn.sid) || '',
            })}
          </span>
        </div>
        <div className="sql-connection-item-info">
          {status === 'connected' && version && (
            <span className="sql-connection-version">{this.t('widget.sql.connection.oracleVersion', { version: version || '' })}</span>
          )}
          {status === 'error' && error && (
            <span className="sql-connection-error kairo-error-banner" title={error}>{error}</span>
          )}
        </div>
        <div className="sql-connection-item-actions">
          <button
            className="theia-button"
            onClick={() => this.handleTestConnection(conn.id)}
            disabled={testResult?.running}
          >
            {testResult?.running ? this.t('widget.sql.connection.testing') : this.t('widget.sql.connection.test')}
          </button>
          {status !== 'connected' ? (
            <button
              className="theia-button"
              onClick={() => this.handleConnect(conn.id)}
              disabled={status === 'connecting'}
            >
              {status === 'connecting' ? this.t('common.inProgress') : this.t('common.connect')}
            </button>
          ) : (
            <button
              className="theia-button"
              onClick={() => this.handleDisconnect(conn.id)}
            >
              {this.t('common.disconnect')}
            </button>
          )}
          <button
            className="theia-button"
            onClick={() => this.handleEdit(conn)}
          >
            {this.t('common.edit')}
          </button>
          <button
            className="theia-button theia-button-danger"
            onClick={() => this.handleDelete(conn.id)}
          >
            {this.t('common.delete')}
          </button>
        </div>
        {testResult?.result && (
          <div className="sql-test-result">{testResult.result}</div>
        )}
      </div>
    );
  }

  private renderForm(): React.ReactNode {
    const f = this.state.formData;
    const isEditing = !!this.state.editingId;

    return (
      <div className="sql-connection-form">
        <h4>{isEditing ? this.t('widget.sql.connection.editTitle') : this.t('widget.sql.connection.newTitle')}</h4>
        <div className="sql-form-field">
          <label>{this.t('widget.sql.connection.nameLabel')}</label>
          <input
            type="text"
            value={f.name}
            onChange={(e) => this.updateForm('name', e.target.value)}
            placeholder={this.t('widget.sql.connection.namePlaceholder')}
          />
        </div>
        <div className="sql-form-field">
          <label>{this.t('widget.sql.connection.hostLabel')}</label>
          <input
            type="text"
            value={f.host}
            onChange={(e) => this.updateForm('host', e.target.value)}
            placeholder={this.t('widget.sql.connection.hostPlaceholder')}
          />
        </div>
        <div className="sql-form-field">
          <label>{this.t('widget.sql.connection.portLabel')}</label>
          <input
            type="number"
            value={f.port}
            onChange={(e) => this.updateForm('port', parseInt(e.target.value, 10) || 1521)}
          />
        </div>
        <div className="sql-form-field">
          <label>
            <input
              type="checkbox"
              checked={f.useServiceName}
              onChange={(e) => this.updateForm('useServiceName', e.target.checked)}
            />
            {this.t('widget.sql.connection.useServiceName')}
          </label>
        </div>
        {f.useServiceName ? (
          <div className="sql-form-field">
            <label>{this.t('widget.sql.connection.serviceNameLabel')}</label>
            <input
              type="text"
              value={f.serviceName}
              onChange={(e) => this.updateForm('serviceName', e.target.value)}
              placeholder={this.t('widget.sql.connection.serviceNamePlaceholder')}
            />
          </div>
        ) : (
          <div className="sql-form-field">
            <label>{this.t('widget.sql.connection.sidLabel')}</label>
            <input
              type="text"
              value={f.sid}
              onChange={(e) => this.updateForm('sid', e.target.value)}
              placeholder={this.t('widget.sql.connection.sidPlaceholder')}
            />
          </div>
        )}
        <div className="sql-form-field">
          <label>{this.t('widget.sql.connection.usernameLabel')}</label>
          <input
            type="text"
            value={f.username}
            onChange={(e) => this.updateForm('username', e.target.value)}
            placeholder={this.t('widget.sql.connection.usernamePlaceholder')}
          />
        </div>
        <div className="sql-form-field">
          <label>{this.t('widget.sql.connection.passwordLabel')}</label>
          <input
            type="password"
            value={f.password}
            onChange={(e) => this.updateForm('password', e.target.value)}
            placeholder={this.t('widget.sql.connection.passwordPlaceholder')}
          />
        </div>
        <div className="sql-form-actions">
          <button
            className="theia-button"
            onClick={() => this.handleSave()}
            disabled={!f.name || !f.host || !f.username}
          >
            {isEditing ? this.t('widget.sql.connection.update') : this.t('widget.sql.connection.save')}
          </button>
          <button
            className="theia-button"
            onClick={() => this.cancelForm()}
          >
            {this.t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  private updateForm<K extends keyof SqlConnectionFormData>(field: K, value: SqlConnectionFormData[K]): void {
    this.setState({
      formData: { ...this.state.formData, [field]: value },
    });
  }

  private cancelForm(): void {
    this.setState({
      showAddForm: false,
      editingId: null,
      formData: {
        name: '',
        host: 'localhost',
        port: 1521,
        sid: 'orcl',
        serviceName: '',
        useServiceName: false,
        username: '',
        password: '',
      },
    });
  }

  private async handleSave(): Promise<void> {
    const f = this.state.formData;
    const config = {
      name: f.name,
      host: f.host,
      port: f.port,
      sid: f.sid,
      serviceName: f.serviceName,
      useServiceName: f.useServiceName,
      username: f.username,
    };

    if (this.state.editingId) {
      await this.connectionService.updateConnection(this.state.editingId, config, f.password || undefined);
    } else {
      await this.connectionService.addConnection(config, f.password);
    }
    this.cancelForm();
  }

  private async handleEdit(conn: SqlConnectionConfig): Promise<void> {
    this.setState({
      editingId: conn.id,
      showAddForm: false,
      formData: {
        name: conn.name,
        host: conn.host,
        port: conn.port,
        sid: conn.sid,
        serviceName: conn.serviceName || '',
        useServiceName: conn.useServiceName,
        username: conn.username,
        password: '',
      },
    });
  }

  private async handleDelete(id: string): Promise<void> {
    if (window.confirm(this.t('widget.sql.connection.deleteConfirm'))) {
      await this.connectionService.deleteConnection(id);
    }
  }

  private async handleTestConnection(id: string): Promise<void> {
    this.setState({
      testResults: {
        ...this.state.testResults,
        [id]: { running: true },
      },
    });
    const result = await this.connectionService.testConnectionById(id);
    this.setState({
      testResults: {
        ...this.state.testResults,
        [id]: {
          running: false,
          result: result.success
            ? this.t('widget.sql.connection.testSuccess', {
                version: result.oracleVersion || '',
                instance: result.instanceName || '',
              })
            : this.t('widget.sql.connection.testFailed', { error: result.error || '' }),
        },
      },
    });
  }

  private async handleConnect(id: string): Promise<void> {
    await this.connectionService.connect(id);
  }

  private async handleDisconnect(id: string): Promise<void> {
    await this.connectionService.disconnect(id);
  }

  private handleExport(): void {
    const configs = this.connectionService.exportConnections();
    const blob = new Blob([JSON.stringify(configs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kairo-sql-connections.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private handleImport(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const configs = JSON.parse(text);
        if (Array.isArray(configs)) {
          // VC-P1-8: skip connections that would be created with an empty password.
          const { imported, skipped } = await this.connectionService.importConnections(configs);
          const msg = this.t('widget.sql.connection.imported', { count: imported }) +
            (skipped > 0 ? ` (${skipped} skipped — empty password)` : '');
          alert(msg);
        }
      } catch {
        alert(this.t('widget.sql.connection.invalidImport'));
      }
    };
    input.click();
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key as any, params);
  }

  private setState(partial: Partial<ConnectionWidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }
}
