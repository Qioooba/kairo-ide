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
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { KairoI18nService } from '@kairo/i18n';

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

const STATUS_DOT_CLASS: Record<ConnectionState, string> = {
  disconnected: 'kairo-status-dot-error',
  connecting: 'kairo-status-dot-info',
  connected: 'kairo-status-dot-success',
  reconnecting: 'kairo-status-dot-warning',
  error: 'kairo-status-dot-error',
};

@injectable()
export class RemoteConnectionWidget extends ReactWidget {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

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
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-remote';
    this.addClass('kairo-widget');
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.updateTitle();
      this.update();
    }));
    this.update();
  }

  private updateTitle(): void {
    this.title.label = this.i18n.t('widget.remote.connection.title' as any);
    this.title.caption = this.i18n.t('widget.remote.connection.caption' as any);
  }

  protected render(): React.ReactNode {
    return (
      <div className="kairo-widget kairo-remote-connection">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">
            {this.i18n.t('widget.remote.connection.title' as any)}
          </span>
          <ConnectionIndicator status={this.status} i18n={this.i18n} />
        </div>
        <div
          className="kairo-widget-toolbar kairo-remote-connection-tabs"
          role="tablist"
          aria-label={this.i18n.t('widget.remote.connection.tabsAria' as any)}
        >
          {(['config', 'files', 'terminal'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={this.activeTab === tab}
              className={`kairo-remote-connection-tab ${this.activeTab === tab ? 'active' : ''}`}
              onClick={() => this.setTab(tab)}
            >
              {this.i18n.t(`widget.remote.connection.tab.${tab}` as any)}
            </button>
          ))}
        </div>
        <div className="kairo-widget-body kairo-remote-connection-body">
          {this.activeTab === 'config' && this.renderConfigTab()}
          {this.activeTab === 'files' && this.renderFilesTab()}
          {this.activeTab === 'terminal' && this.renderTerminalTab()}
        </div>
        <style>{`
          .kairo-remote-connection-tabs {
            gap: 0;
            padding: 0 12px;
          }
          .kairo-remote-connection-tab {
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--kairo-text-secondary);
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            padding: 8px 14px;
            transition: color 0.15s ease, border-color 0.15s ease;
          }
          .kairo-remote-connection-tab:hover {
            color: var(--kairo-text);
          }
          .kairo-remote-connection-tab.active {
            border-bottom-color: var(--kairo-primary);
            color: var(--kairo-primary);
          }
          .kairo-remote-connection-form {
            max-width: 720px;
          }
          .kairo-remote-connection-files-toolbar .kairo-remote-connection-path-label {
            color: var(--kairo-text-secondary);
            font-size: 12px;
            white-space: nowrap;
          }
          .kairo-remote-connection-files-toolbar input.theia-input {
            flex: 1 1 auto;
            min-width: 120px;
          }
          .kairo-remote-connection-files-list table {
            border-collapse: collapse;
            font-size: 12px;
            width: 100%;
          }
          .kairo-remote-connection-files-list th,
          .kairo-remote-connection-files-list td {
            border-bottom: 1px solid var(--kairo-border);
            padding: 6px 8px;
            text-align: left;
          }
          .kairo-remote-connection-files-list th {
            color: var(--kairo-text-secondary);
            font-weight: 600;
          }
          .kairo-remote-connection-files-list tr:hover td {
            background: var(--kairo-hover-overlay);
          }
          .kairo-remote-connection-files-list .codicon {
            margin-right: 6px;
          }
          .kairo-remote-connection-terminal-toolbar {
            justify-content: flex-start;
          }
          .kairo-remote-connection-terminal-session {
            border: 1px solid var(--kairo-border);
            border-radius: 6px;
            margin-bottom: 10px;
            overflow: hidden;
          }
          .kairo-remote-connection-terminal-session-header {
            align-items: center;
            background: var(--kairo-bg-secondary);
            border-bottom: 1px solid var(--kairo-border);
            display: flex;
            justify-content: space-between;
            padding: 6px 10px;
          }
          .kairo-remote-connection-terminal-session-header button {
            background: transparent;
            border: none;
            color: var(--kairo-text-secondary);
            cursor: pointer;
            padding: 2px 4px;
          }
          .kairo-remote-connection-terminal-session-header button:hover {
            color: var(--kairo-error);
          }
          .kairo-remote-connection-terminal-body {
            height: 160px;
          }
          .kairo-remote-connection-error-detail {
            color: var(--kairo-text-secondary);
            font-size: 12px;
            margin-top: 4px;
          }
        `}</style>
      </div>
    );
  }

  private renderConfigTab(): React.ReactNode {
    return (
      <div className="kairo-remote-form kairo-remote-connection-form">
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.host' as any)}
          </label>
          <input
            type="text"
            className="theia-input"
            value={this.config.host}
            onChange={(e) => this.updateConfig({ host: e.target.value })}
            placeholder={this.i18n.t('widget.remote.connection.placeholder.host' as any)}
          />
        </div>
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.port' as any)}
          </label>
          <input
            type="number"
            className="theia-input"
            value={this.config.port}
            onChange={(e) => this.updateConfig({ port: parseInt(e.target.value, 10) || 22 })}
            min={1}
            max={65535}
          />
        </div>
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.username' as any)}
          </label>
          <input
            type="text"
            className="theia-input"
            value={this.config.username}
            onChange={(e) => this.updateConfig({ username: e.target.value })}
            placeholder={this.i18n.t('widget.remote.connection.placeholder.username' as any)}
          />
        </div>
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.authMethod' as any)}
          </label>
          <select
            className="theia-input"
            value={this.config.authMethod}
            onChange={(e) =>
              this.updateConfig({ authMethod: e.target.value as 'password' | 'keyfile' | 'keydata' })
            }
          >
            <option value="password">
              {this.i18n.t('widget.remote.connection.auth.password' as any)}
            </option>
            <option value="keyfile">
              {this.i18n.t('widget.remote.connection.auth.keyFile' as any)}
            </option>
            <option value="keydata">
              {this.i18n.t('widget.remote.connection.auth.keyData' as any)}
            </option>
          </select>
        </div>
        {this.config.authMethod === 'password' && (
          <div className="kairo-remote-form-row">
            <label className="kairo-remote-label">
              {this.i18n.t('widget.remote.connection.label.password' as any)}
            </label>
            <input
              type="password"
              className="theia-input"
              value={this.config.password || ''}
              onChange={(e) => this.updateConfig({ password: e.target.value })}
              placeholder={this.i18n.t('widget.remote.connection.placeholder.password' as any)}
            />
          </div>
        )}
        {this.config.authMethod === 'keyfile' && (
          <div className="kairo-remote-form-row">
            <label className="kairo-remote-label">
              {this.i18n.t('widget.remote.connection.label.keyFile' as any)}
            </label>
            <input
              type="text"
              className="theia-input"
              value={this.config.keyFile || ''}
              onChange={(e) => this.updateConfig({ keyFile: e.target.value })}
              placeholder={this.i18n.t('widget.remote.connection.placeholder.keyFile' as any)}
            />
          </div>
        )}
        {this.config.authMethod === 'keydata' && (
          <div className="kairo-remote-form-row">
            <label className="kairo-remote-label">
              {this.i18n.t('widget.remote.connection.label.keyData' as any)}
            </label>
            <textarea
              className="theia-input"
              value={this.config.keyData || ''}
              onChange={(e) => this.updateConfig({ keyData: e.target.value })}
              placeholder={this.i18n.t('widget.remote.connection.placeholder.keyData' as any)}
              rows={5}
            />
          </div>
        )}
        {(this.config.authMethod === 'keyfile' || this.config.authMethod === 'keydata') && (
          <div className="kairo-remote-form-row">
            <label className="kairo-remote-label">
              {this.i18n.t('widget.remote.connection.label.keyPassphrase' as any)}
            </label>
            <input
              type="password"
              className="theia-input"
              value={this.config.keyPassphrase || ''}
              onChange={(e) => this.updateConfig({ keyPassphrase: e.target.value })}
              placeholder={this.i18n.t('widget.remote.connection.placeholder.keyPassphrase' as any)}
            />
          </div>
        )}
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.remoteAgentPort' as any)}
          </label>
          <input
            type="number"
            className="theia-input"
            value={this.config.remoteAgentPort}
            onChange={(e) =>
              this.updateConfig({ remoteAgentPort: parseInt(e.target.value, 10) || 9443 })
            }
            min={1}
            max={65535}
          />
        </div>
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.keepAliveInterval' as any)}
          </label>
          <input
            type="number"
            className="theia-input"
            value={this.config.keepAliveInterval}
            onChange={(e) =>
              this.updateConfig({ keepAliveInterval: parseInt(e.target.value, 10) || 30 })
            }
            min={5}
            max={300}
          />
        </div>
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            {this.i18n.t('widget.remote.connection.label.maxReconnectRetries' as any)}
          </label>
          <input
            type="number"
            className="theia-input"
            value={this.config.maxReconnectRetries}
            onChange={(e) =>
              this.updateConfig({ maxReconnectRetries: parseInt(e.target.value, 10) || 5 })
            }
            min={0}
            max={100}
          />
        </div>
        <div className="kairo-remote-form-actions">
          <button
            className="theia-button main"
            onClick={() => this.handleConnect()}
            disabled={this.status.state === 'connecting' || this.status.state === 'connected'}
          >
            {this.status.state === 'connected'
              ? this.i18n.t('widget.remote.connection.state.connected' as any)
              : this.i18n.t('widget.remote.connection.action.connect' as any)}
          </button>
          <button
            className="theia-button secondary"
            onClick={() => this.handleDisconnect()}
            disabled={this.status.state === 'disconnected'}
          >
            {this.i18n.t('widget.remote.connection.action.disconnect' as any)}
          </button>
        </div>
        {this.status.state === 'error' && this.status.error && (
          <ErrorBanner i18n={this.i18n} message={this.status.error} />
        )}
      </div>
    );
  }

  private renderFilesTab(): React.ReactNode {
    const connected = this.status.state === 'connected';
    return (
      <div className="kairo-remote-connection-files">
        <div className="kairo-widget-toolbar kairo-remote-connection-files-toolbar">
          <span className="kairo-remote-connection-path-label">
            {this.i18n.t('widget.remote.connection.label.path' as any)}
          </span>
          <input
            type="text"
            className="theia-input"
            value={this.currentPath}
            onChange={(e) => this.setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && this.refreshFileList()}
          />
          <button
            className="theia-button toolbar"
            onClick={() => this.refreshFileList()}
            title={this.i18n.t('common.refresh' as any)}
            aria-label={this.i18n.t('common.refresh' as any)}
          >
            <span className="codicon codicon-refresh" aria-hidden="true" />
          </button>
          <button
            className="theia-button toolbar"
            onClick={() => this.navigateUp()}
            title={this.i18n.t('widget.remote.connection.action.goUp' as any)}
            aria-label={this.i18n.t('widget.remote.connection.action.goUp' as any)}
          >
            <span className="codicon codicon-arrow-up" aria-hidden="true" />
          </button>
        </div>
        <div className="kairo-remote-connection-files-list">
          {this.fileList.length === 0 ? (
            <div className="kairo-empty-state">
              <span className="kairo-empty-state-glyph">
                <span className="codicon codicon-folder-opened" aria-hidden="true" />
              </span>
              <div className="kairo-empty-state-title">
                {connected
                  ? this.i18n.t('widget.remote.connection.empty.filesTitle' as any)
                  : this.i18n.t('widget.remote.connection.empty.connectTitle' as any)}
              </div>
              <p className="kairo-empty-state-reason">
                {connected
                  ? this.i18n.t('widget.remote.connection.empty.filesReason' as any)
                  : this.i18n.t('widget.remote.connection.empty.connectReason' as any)}
              </p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{this.i18n.t('common.name' as any)}</th>
                  <th>{this.i18n.t('common.size' as any)}</th>
                  <th>{this.i18n.t('widget.remote.connection.column.mode' as any)}</th>
                  <th>{this.i18n.t('widget.remote.connection.column.modified' as any)}</th>
                </tr>
              </thead>
              <tbody>
                {this.fileList.map((file) => (
                  <tr
                    key={file.path}
                    className={file.isDir ? 'kairo-remote-connection-dir' : 'kairo-remote-connection-file'}
                    onDoubleClick={() => {
                      if (file.isDir) {
                        this.setPath(file.path);
                        this.refreshFileList();
                      }
                    }}
                  >
                    <td>
                      <span
                        className={`codicon ${file.isDir ? 'codicon-folder' : 'codicon-file'}`}
                        aria-hidden="true"
                      />
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
    const connected = this.status.state === 'connected';
    return (
      <div className="kairo-remote-connection-terminal">
        <div className="kairo-widget-toolbar kairo-remote-connection-terminal-toolbar">
          <button
            className="theia-button main"
            onClick={() => this.addTerminalSession()}
            disabled={!connected}
          >
            <span className="codicon codicon-add" aria-hidden="true" />
            {this.i18n.t('widget.remote.connection.action.newTerminal' as any)}
          </button>
        </div>
        {this.terminalSessions.length === 0 ? (
          <div className="kairo-empty-state">
            <span className="kairo-empty-state-glyph">
              <span className="codicon codicon-terminal" aria-hidden="true" />
            </span>
            <div className="kairo-empty-state-title">
              {connected
                ? this.i18n.t('widget.remote.connection.empty.terminalTitle' as any)
                : this.i18n.t('widget.remote.connection.empty.connectTitle' as any)}
            </div>
            <p className="kairo-empty-state-reason">
              {connected
                ? this.i18n.t('widget.remote.connection.empty.terminalReason' as any)
                : this.i18n.t('widget.remote.connection.empty.connectReason' as any)}
            </p>
          </div>
        ) : (
          <div className="kairo-remote-connection-terminal-sessions">
            {this.terminalSessions.map((session) => (
              <div key={session.id} className="kairo-remote-connection-terminal-session">
                <div className="kairo-remote-connection-terminal-session-header">
                  <span>{session.name}</span>
                  <button
                    onClick={() => this.removeTerminalSession(session.id)}
                    title={this.i18n.t('common.remove' as any)}
                    aria-label={this.i18n.t('common.remove' as any)}
                  >
                    <span className="codicon codicon-close" aria-hidden="true" />
                  </button>
                </div>
                <div
                  className="kairo-remote-connection-terminal-body"
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
      name: this.i18n.t('widget.remote.connection.terminalName' as any, { index: this.terminalSessions.length + 1 }),
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
  i18n: KairoI18nService;
}

function ConnectionIndicator({ status, i18n }: ConnectionIndicatorProps): React.ReactNode {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const dotClass = STATUS_DOT_CLASS[status.state];

  return (
    <div className="kairo-remote-status-bar" title={status.error || ''}>
      <span className={`kairo-remote-status-dot ${dotClass}`} />
      <span className="kairo-remote-status-label">
        {t(`widget.remote.connection.state.${status.state}` as any)}
      </span>
      {status.state === 'connected' && status.host && (
        <span className="kairo-remote-status-addr">
          {status.host}:{status.port}
        </span>
      )}
      {status.state === 'reconnecting' && status.reconnectAttempt && (
        <span className="kairo-remote-status-addr">
          {t('widget.remote.connection.retry' as any, { attempt: status.reconnectAttempt })}
        </span>
      )}
    </div>
  );
}

interface ErrorBannerProps {
  message: string;
  i18n: KairoI18nService;
}

function ErrorBanner({ message, i18n }: ErrorBannerProps): React.ReactNode {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

  return (
    <div className="kairo-error-banner" role="alert">
      <span className="codicon codicon-error" aria-hidden="true" />
      <div>
        <strong>{t('widget.remote.connection.errorTitle' as any)}</strong>
        <div className="kairo-remote-connection-error-detail">{message}</div>
      </div>
    </div>
  );
}
