/**
 * SQL Connection Widget — connection list view with add/edit/delete/test/connect.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import * as React from '@theia/core/shared/react';
import { SqlConnectionService, SqlConnectionConfig, SqlConnectionStatus } from './sql-connection-service';

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

const EMPTY_FORM: SqlConnectionFormData = {
  name: '',
  host: 'localhost',
  port: 1521,
  sid: 'orcl',
  serviceName: '',
  useServiceName: false,
  username: '',
  password: '',
};

@injectable()
export class SqlConnectionWidget extends ReactWidget {
  static readonly ID = 'kairo-sql-connection-widget';
  static readonly LABEL = 'SQL Connections';

  @inject(SqlConnectionService)
  protected readonly connectionService!: SqlConnectionService;

  private state: ConnectionWidgetState = {
    connections: [],
    connectionStates: {},
    oracleVersions: {},
    errors: {},
    editingId: null,
    showAddForm: false,
    formData: { ...EMPTY_FORM },
    testResults: {},
  };

  @postConstruct()
  protected init(): void {
    this.id = SqlConnectionWidget.ID;
    this.title.label = SqlConnectionWidget.LABEL;
    this.title.caption = 'Oracle 11g SQL Connections';
    this.title.closable = true;
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
      <div className="sql-connection-widget">
        <div className="sql-connection-header">
          <h3>Oracle Connections</h3>
          <button
            className="theia-button"
            onClick={() => this.setState({ showAddForm: !this.state.showAddForm, editingId: null })}
          >
            {this.state.showAddForm ? 'Cancel' : '+ Add Connection'}
          </button>
        </div>

        {this.state.showAddForm && this.renderForm()}
        {this.state.editingId && this.renderForm()}

        <div className="sql-connection-list">
          {this.state.connections.length === 0 && (
            <div className="sql-empty-message">No connections configured. Add one to get started.</div>
          )}
          {this.state.connections.map((conn) => this.renderConnectionItem(conn))}
        </div>

        <div className="sql-connection-actions">
          <button
            className="theia-button"
            onClick={() => this.handleExport()}
          >
            Export Configs
          </button>
          <button
            className="theia-button"
            onClick={() => this.handleImport()}
          >
            Import Configs
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

    const statusColors: Record<SqlConnectionStatus, string> = {
      disconnected: '#888',
      connecting: '#f0ad4e',
      connected: '#5cb85c',
      error: '#d9534f',
    };

    return (
      <div key={conn.id} className="sql-connection-item">
        <div className="sql-connection-item-header">
          <span
            className="sql-connection-status-dot"
            style={{ backgroundColor: statusColors[status] }}
            title={status}
          />
          <span className="sql-connection-name">{conn.name}</span>
          <span className="sql-connection-detail">
            {conn.username}@{conn.host}:{conn.port}/{conn.useServiceName ? conn.serviceName : conn.sid}
          </span>
        </div>
        <div className="sql-connection-item-info">
          {status === 'connected' && version && (
            <span className="sql-connection-version">Oracle {version}</span>
          )}
          {status === 'error' && error && (
            <span className="sql-connection-error" title={error}>{error}</span>
          )}
        </div>
        <div className="sql-connection-item-actions">
          <button
            className="theia-button"
            onClick={() => this.handleTestConnection(conn.id)}
            disabled={testResult?.running}
          >
            {testResult?.running ? 'Testing...' : 'Test'}
          </button>
          {status !== 'connected' ? (
            <button
              className="theia-button"
              onClick={() => this.handleConnect(conn.id)}
              disabled={status === 'connecting'}
            >
              {status === 'connecting' ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <button
              className="theia-button"
              onClick={() => this.handleDisconnect(conn.id)}
            >
              Disconnect
            </button>
          )}
          <button
            className="theia-button"
            onClick={() => this.handleEdit(conn)}
          >
            Edit
          </button>
          <button
            className="theia-button theia-button-danger"
            onClick={() => this.handleDelete(conn.id)}
          >
            Delete
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
        <h4>{isEditing ? 'Edit Connection' : 'New Connection'}</h4>
        <div className="sql-form-field">
          <label>Connection Name</label>
          <input
            type="text"
            value={f.name}
            onChange={(e) => this.updateForm('name', e.target.value)}
            placeholder="My Oracle DB"
          />
        </div>
        <div className="sql-form-field">
          <label>Host</label>
          <input
            type="text"
            value={f.host}
            onChange={(e) => this.updateForm('host', e.target.value)}
            placeholder="localhost"
          />
        </div>
        <div className="sql-form-field">
          <label>Port</label>
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
            Use Service Name
          </label>
        </div>
        {f.useServiceName ? (
          <div className="sql-form-field">
            <label>Service Name</label>
            <input
              type="text"
              value={f.serviceName}
              onChange={(e) => this.updateForm('serviceName', e.target.value)}
              placeholder="orcl.example.com"
            />
          </div>
        ) : (
          <div className="sql-form-field">
            <label>SID</label>
            <input
              type="text"
              value={f.sid}
              onChange={(e) => this.updateForm('sid', e.target.value)}
              placeholder="orcl"
            />
          </div>
        )}
        <div className="sql-form-field">
          <label>Username</label>
          <input
            type="text"
            value={f.username}
            onChange={(e) => this.updateForm('username', e.target.value)}
            placeholder="scott"
          />
        </div>
        <div className="sql-form-field">
          <label>Password</label>
          <input
            type="password"
            value={f.password}
            onChange={(e) => this.updateForm('password', e.target.value)}
            placeholder="Enter password"
          />
        </div>
        <div className="sql-form-actions">
          <button
            className="theia-button"
            onClick={() => this.handleSave()}
            disabled={!f.name || !f.host || !f.username}
          >
            {isEditing ? 'Update' : 'Save'}
          </button>
          <button
            className="theia-button"
            onClick={() => this.cancelForm()}
          >
            Cancel
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
    this.setState({ showAddForm: false, editingId: null, formData: { ...EMPTY_FORM } });
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
    if (window.confirm('Are you sure you want to delete this connection?')) {
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
            ? `Connected! Oracle ${result.oracleVersion}${result.instanceName ? ` (${result.instanceName})` : ''}`
            : `Failed: ${result.error}`,
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
          const count = await this.connectionService.importConnections(configs);
          alert(`Imported ${count} connections. Passwords need to be set manually.`);
        }
      } catch {
        alert('Invalid connection export file.');
      }
    };
    input.click();
  }

  private setState(partial: Partial<ConnectionWidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }
}