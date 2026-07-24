/**
 * P3-REMOTE: Remote Connection Widget
 *
 * Provides the UI for managing remote SSH connections, including:
 *   - SSH connection configuration form
 *   - Connection status indicator
 *   - Remote file browser
 *   - Remote terminal (xterm.js)
 *
 * Marked as "Experimental" — Phase 3+ feature.
 */
import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Widget } from '@theia/core/lib/browser/widgets';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { Emitter, Event } from '@theia/core/lib/common/event';

/** SSH Connection configuration. */
export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'keyfile' | 'keydata';
  password?: string;
  keyFile?: string;
  keyData?: string;
  keyPassphrase?: string;
  remoteAgentPort: number;
  keepAliveInterval: number;
  maxReconnectRetries: number;
}

/** Connection status. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Connection status information. */
export interface ConnectionStatusInfo {
  state: ConnectionState;
  host?: string;
  port?: number;
  localPort?: number;
  connectedAt?: number;
  reconnectAttempt?: number;
  error?: string;
  bytesSent?: number;
  bytesReceived?: number;
}

/** Remote file entry. */
export interface RemoteFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode: string;
  modTime: string;
}

/** Terminal session. */
interface TerminalSession {
  id: string;
  name: string;
  connected: boolean;
}

const DEFAULT_CONFIG: SSHConnectionConfig = {
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  remoteAgentPort: 9443,
  keepAliveInterval: 30,
  maxReconnectRetries: 5,
};

@injectable()
export class RemoteConnectionWidget extends ReactWidget {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  private config: SSHConnectionConfig = { ...DEFAULT_CONFIG };
  private status: ConnectionStatusInfo = { state: 'disconnected' };
  private fileList: RemoteFileEntry[] = [];
  private currentPath: string = '/home';
  private terminalSessions: TerminalSession[] = [];
  private activeTab: 'config' | 'files' | 'terminal' = 'config';

  private readonly onStatusChangeEmitter = new Emitter<ConnectionStatusInfo>();
  readonly onStatusChange: Event<ConnectionStatusInfo> = this.onStatusChangeEmitter.event;

  static readonly ID = 'kairo-remote-connection-widget';
  static readonly LABEL = 'Remote Connection';

  @postConstruct()
  protected initialize(): void {
    this.id = RemoteConnectionWidget.ID;
    this.title.label = RemoteConnectionWidget.LABEL;
    this.title.caption = 'Kairo Remote SSH Connection';
    this.title.closable = true;
    this.title.iconClass = 'fa fa-cloud kairo-remote-icon';
    this.update();
  }

  protected render(): React.ReactNode {
    return (
      <div className="kairo-remote-widget">
        <div className="kairo-remote-header">
          <h3>Remote Connection</h3>
          <ConnectionIndicator status={this.status} />
        </div>
        <div className="kairo-remote-tabs">
          <button
            className={`kairo-remote-tab ${this.activeTab === 'config' ? 'active' : ''}`}
            onClick={() => this.setTab('config')}
          >
            Configuration
          </button>
          <button
            className={`kairo-remote-tab ${this.activeTab === 'files' ? 'active' : ''}`}
            onClick={() => this.setTab('files')}
          >
            File Browser
          </button>
          <button
            className={`kairo-remote-tab ${this.activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => this.setTab('terminal')}
          >
            Terminal
          </button>
        </div>
        <div className="kairo-remote-content">
          {this.activeTab === 'config' && this.renderConfigTab()}
          {this.activeTab === 'files' && this.renderFilesTab()}
          {this.activeTab === 'terminal' && this.renderTerminalTab()}
        </div>
      </div>
    );
  }

  private renderConfigTab(): React.ReactNode {
    return (
      <div className="kairo-remote-config">
        <div className="kairo-remote-form-group">
          <label>Host</label>
          <input
            type="text"
            value={this.config.host}
            onChange={(e) => this.updateConfig({ host: e.target.value })}
            placeholder="e.g., 192.168.1.100"
          />
        </div>
        <div className="kairo-remote-form-group">
          <label>Port</label>
          <input
            type="number"
            value={this.config.port}
            onChange={(e) => this.updateConfig({ port: parseInt(e.target.value, 10) || 22 })}
            min={1}
            max={65535}
          />
        </div>
        <div className="kairo-remote-form-group">
          <label>Username</label>
          <input
            type="text"
            value={this.config.username}
            onChange={(e) => this.updateConfig({ username: e.target.value })}
            placeholder="e.g., root"
          />
        </div>
        <div className="kairo-remote-form-group">
          <label>Authentication Method</label>
          <select
            value={this.config.authMethod}
            onChange={(e) =>
              this.updateConfig({ authMethod: e.target.value as 'password' | 'keyfile' | 'keydata' })
            }
          >
            <option value="password">Password</option>
            <option value="keyfile">Private Key File</option>
            <option value="keydata">Private Key Data</option>
          </select>
        </div>
        {this.config.authMethod === 'password' && (
          <div className="kairo-remote-form-group">
            <label>Password</label>
            <input
              type="password"
              value={this.config.password || ''}
              onChange={(e) => this.updateConfig({ password: e.target.value })}
              placeholder="Enter password"
            />
          </div>
        )}
        {this.config.authMethod === 'keyfile' && (
          <div className="kairo-remote-form-group">
            <label>Private Key File Path</label>
            <input
              type="text"
              value={this.config.keyFile || ''}
              onChange={(e) => this.updateConfig({ keyFile: e.target.value })}
              placeholder="e.g., ~/.ssh/id_rsa"
            />
          </div>
        )}
        {this.config.authMethod === 'keydata' && (
          <div className="kairo-remote-form-group">
            <label>Private Key Data (PEM)</label>
            <textarea
              value={this.config.keyData || ''}
              onChange={(e) => this.updateConfig({ keyData: e.target.value })}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
              rows={5}
            />
          </div>
        )}
        {(this.config.authMethod === 'keyfile' || this.config.authMethod === 'keydata') && (
          <div className="kairo-remote-form-group">
            <label>Key Passphrase (optional)</label>
            <input
              type="password"
              value={this.config.keyPassphrase || ''}
              onChange={(e) => this.updateConfig({ keyPassphrase: e.target.value })}
              placeholder="Leave empty if no passphrase"
            />
          </div>
        )}
        <div className="kairo-remote-form-group">
          <label>Remote Agent Port</label>
          <input
            type="number"
            value={this.config.remoteAgentPort}
            onChange={(e) =>
              this.updateConfig({ remoteAgentPort: parseInt(e.target.value, 10) || 9443 })
            }
            min={1}
            max={65535}
          />
        </div>
        <div className="kairo-remote-form-group">
          <label>Keep-Alive Interval (seconds)</label>
          <input
            type="number"
            value={this.config.keepAliveInterval}
            onChange={(e) =>
              this.updateConfig({ keepAliveInterval: parseInt(e.target.value, 10) || 30 })
            }
            min={5}
            max={300}
          />
        </div>
        <div className="kairo-remote-form-group">
          <label>Max Reconnect Retries</label>
          <input
            type="number"
            value={this.config.maxReconnectRetries}
            onChange={(e) =>
              this.updateConfig({ maxReconnectRetries: parseInt(e.target.value, 10) || 5 })
            }
            min={0}
            max={100}
          />
        </div>
        <div className="kairo-remote-actions">
          <button
            className="kairo-remote-btn kairo-remote-btn-primary"
            onClick={() => this.handleConnect()}
            disabled={this.status.state === 'connecting' || this.status.state === 'connected'}
          >
            {this.status.state === 'connected' ? 'Connected' : 'Connect'}
          </button>
          <button
            className="kairo-remote-btn kairo-remote-btn-danger"
            onClick={() => this.handleDisconnect()}
            disabled={this.status.state === 'disconnected'}
          >
            Disconnect
          </button>
        </div>
        {this.status.state === 'error' && this.status.error && (
          <div className="kairo-remote-error">
            Error: {this.status.error}
          </div>
        )}
      </div>
    );
  }

  private renderFilesTab(): React.ReactNode {
    return (
      <div className="kairo-remote-files">
        <div className="kairo-remote-files-toolbar">
          <div className="kairo-remote-path">
            <span className="kairo-remote-path-label">Path:</span>
            <input
              type="text"
              value={this.currentPath}
              onChange={(e) => this.setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && this.refreshFileList()}
            />
            <button onClick={() => this.refreshFileList()} title="Refresh">
              ↻
            </button>
            <button onClick={() => this.navigateUp()} title="Go up">
              ↑
            </button>
          </div>
        </div>
        <div className="kairo-remote-files-list">
          {this.fileList.length === 0 ? (
            <div className="kairo-remote-files-empty">
              {this.status.state === 'connected'
                ? 'No files to display. Click refresh to load.'
                : 'Connect to a remote host to browse files.'}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Mode</th>
                  <th>Modified</th>
                </tr>
              </thead>
              <tbody>
                {this.fileList.map((file) => (
                  <tr
                    key={file.path}
                    className={file.isDir ? 'kairo-remote-dir' : 'kairo-remote-file'}
                    onDoubleClick={() => {
                      if (file.isDir) {
                        this.setPath(file.path);
                        this.refreshFileList();
                      }
                    }}
                  >
                    <td>
                      <span className={file.isDir ? 'fa fa-folder' : 'fa fa-file'} />
                      {file.name}
                    </td>
                    <td>{file.isDir ? '-' : this.formatFileSize(file.size)}</td>
                    <td>{file.mode}</td>
                    <td>{file.modTime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  private renderTerminalTab(): React.ReactNode {
    return (
      <div className="kairo-remote-terminal">
        <div className="kairo-remote-terminal-toolbar">
          <button
            onClick={() => this.addTerminalSession()}
            disabled={this.status.state !== 'connected'}
          >
            + New Terminal
          </button>
        </div>
        {this.terminalSessions.length === 0 ? (
          <div className="kairo-remote-terminal-empty">
            {this.status.state === 'connected'
              ? 'No terminal sessions. Click "+ New Terminal" to start one.'
              : 'Connect to a remote host to use the terminal.'}
          </div>
        ) : (
          <div className="kairo-remote-terminal-sessions">
            {this.terminalSessions.map((session) => (
              <div key={session.id} className="kairo-remote-terminal-session">
                <div className="kairo-remote-terminal-session-header">
                  <span>{session.name}</span>
                  <button onClick={() => this.removeTerminalSession(session.id)}>×</button>
                </div>
                <div
                  className="kairo-remote-terminal-body"
                  ref={(el) => el && this.attachTerminal(session.id, el)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Public API ---

  /** Update the connection status. */
  setStatus(status: ConnectionStatusInfo): void {
    this.status = status;
    this.onStatusChangeEmitter.fire(status);
    this.update();
  }

  /** Set the remote file list. */
  setFileList(files: RemoteFileEntry[]): void {
    this.fileList = files;
    this.update();
  }

  /** Get the current SSH configuration. */
  getConfig(): SSHConnectionConfig {
    return { ...this.config };
  }

  // --- Private methods ---

  private setTab(tab: 'config' | 'files' | 'terminal'): void {
    this.activeTab = tab;
    this.update();
  }

  private updateConfig(partial: Partial<SSHConnectionConfig>): void {
    this.config = { ...this.config, ...partial };
    this.update();
  }

  private handleConnect(): void {
    this.setStatus({ state: 'connecting', host: this.config.host, port: this.config.port });
    this.logger.info('[RemoteWidget] Connecting to', this.config.host);
    // The actual connection is handled by the RemoteConnectionService
    // This widget just manages the UI state
  }

  private handleDisconnect(): void {
    this.setStatus({ state: 'disconnected' });
    this.logger.info('[RemoteWidget] Disconnecting');
  }

  private setPath(path: string): void {
    this.currentPath = path;
    this.update();
  }

  private navigateUp(): void {
    const parts = this.currentPath.split('/').filter(Boolean);
    parts.pop();
    this.currentPath = '/' + parts.join('/');
    this.refreshFileList();
  }

  private refreshFileList(): void {
    // Files are loaded via the RemoteConnectionService
    this.logger.info('[RemoteWidget] Refreshing file list for', this.currentPath);
  }

  private addTerminalSession(): void {
    const id = `terminal-${Date.now()}`;
    const session: TerminalSession = {
      id,
      name: `Terminal ${this.terminalSessions.length + 1}`,
      connected: false,
    };
    this.terminalSessions = [...this.terminalSessions, session];
    this.update();
    this.logger.info('[RemoteWidget] Added terminal session', id);
  }

  private removeTerminalSession(id: string): void {
    this.terminalSessions = this.terminalSessions.filter((s) => s.id !== id);
    this.update();
  }

  private attachTerminal(sessionId: string, _container: HTMLElement): void {
    // Terminal attachment is handled by the xterm.js integration
    // In full implementation, this would create an xterm Terminal instance
    // and connect it to the SSH session via WebSocket
    this.logger.info('[RemoteWidget] Attaching terminal to', sessionId);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
}

/** Connection status indicator component. */
interface ConnectionIndicatorProps {
  status: ConnectionStatusInfo;
}

function ConnectionIndicator({ status }: ConnectionIndicatorProps): React.ReactNode {
  const stateClass = `kairo-remote-indicator kairo-remote-indicator-${status.state}`;
  const stateLabel = status.state.charAt(0).toUpperCase() + status.state.slice(1);

  return (
    <div className={stateClass} title={status.error || ''}>
      <span className="kairo-remote-indicator-dot" />
      <span className="kairo-remote-indicator-label">{stateLabel}</span>
      {status.state === 'connected' && status.host && (
        <span className="kairo-remote-indicator-detail">
          {status.host}:{status.port}
        </span>
      )}
      {status.state === 'reconnecting' && status.reconnectAttempt && (
        <span className="kairo-remote-indicator-detail">
          Retry {status.reconnectAttempt}
        </span>
      )}
    </div>
  );
}