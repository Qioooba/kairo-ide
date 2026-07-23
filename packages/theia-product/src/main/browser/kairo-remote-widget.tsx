/**
 * Kairo Remote Development Widget.
 *
 * React widget that provides a connection form for remote
 * development via the Kairo Remote Agent. Supports:
 *   - Connection form (host, port, token, workspace path)
 *   - Connect / Disconnect button
 *   - Connection status indicator
 *   - Recent connections (stored in localStorage)
 *   - Remote file tree when connected
 */

import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import {
  KairoRemoteAgentService,
  RemoteAgentConfig,
  RemoteAgentStatus,
} from './kairo-remote-agent-service';
import { KAIRO_REMOTE_FACTORY_ID } from './kairo-factory-ids';

const RECENT_CONNECTIONS_KEY = 'kairo-remote-recent-connections';

interface RecentConnection {
  host: string;
  port: number;
  useTLS: boolean;
  workspacePath: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoRemoteWidget extends ReactWidget {
  static readonly ID = KAIRO_REMOTE_FACTORY_ID;

  @inject(KairoRemoteAgentService)
  protected readonly agent!: KairoRemoteAgentService;

  @inject(MessageService)
  protected readonly messages!: MessageService;

  constructor() {
    super();
    this.id = KAIRO_REMOTE_FACTORY_ID;
    this.title.label = 'Remote Development';
    this.title.caption = 'Kairo Remote Development';
    this.title.iconClass = 'codicon codicon-remote';
    this.title.closable = true;
    this.addClass('kairo-remote');
  }

  render(): React.ReactNode {
    return React.createElement(KairoRemoteView, {
      agent: this.agent,
      messages: this.messages,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  React View                                                          */
/* ------------------------------------------------------------------ */

interface KairoRemoteViewProps {
  agent: KairoRemoteAgentService;
  messages: MessageService;
}

const STATUS_LABELS: Record<RemoteAgentStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Error',
};

const STATUS_DOT: Record<RemoteAgentStatus, string> = {
  disconnected: '#f44336',
  connecting: '#ff9800',
  connected: '#4caf50',
  error: '#f44336',
};

function loadRecentConnections(): RecentConnection[] {
  try {
    const raw = localStorage.getItem(RECENT_CONNECTIONS_KEY);
    if (raw) {
      return JSON.parse(raw) as RecentConnection[];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

function saveRecentConnections(connections: RecentConnection[]): void {
  try {
    const deduped = connections.slice(0, 10);
    localStorage.setItem(RECENT_CONNECTIONS_KEY, JSON.stringify(deduped));
  } catch {
    // Ignore storage errors
  }
}

const KairoRemoteView: React.FC<KairoRemoteViewProps> = ({ agent, messages }) => {
  const [status, setStatus] = React.useState<RemoteAgentStatus>('disconnected');
  const [host, setHost] = React.useState('127.0.0.1');
  const [port, setPort] = React.useState(9443);
  const [useTLS, setUseTLS] = React.useState(true);
  const [token, setToken] = React.useState('');
  const [workspacePath, setWorkspacePath] = React.useState('/');
  const [busy, setBusy] = React.useState(false);
  const [recentConnections, setRecentConnections] = React.useState<RecentConnection[]>(loadRecentConnections);

  React.useEffect(() => {
    const sub = agent.onDidChangeStatus(s => setStatus(s));
    return () => sub.dispose();
  }, [agent]);

  const handleConnect = async () => {
    if (!host.trim() || !token.trim()) {
      messages.warn('Host and token are required.');
      return;
    }
    setBusy(true);
    try {
      const config: RemoteAgentConfig = {
        host: host.trim(),
        port,
        useTLS,
        token: token.trim(),
        workspacePath: workspacePath.trim() || '/',
      };
      const ok = await agent.connect(config);
      if (ok) {
        messages.info(`Connected to ${host}:${port}`);
        // Save to recent connections
        const label = `${host}:${port}`;
        const updated = recentConnections.filter(c => c.label !== label);
        updated.unshift({ host: host.trim(), port, useTLS, workspacePath: workspacePath.trim() || '/', label });
        setRecentConnections(updated);
        saveRecentConnections(updated);
      } else {
        messages.error(`Failed to connect to ${host}:${port}`);
      }
    } catch (err) {
      messages.error(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    agent.disconnect();
    messages.info('Disconnected from remote agent.');
  };

  const handleSelectRecent = (conn: RecentConnection) => {
    setHost(conn.host);
    setPort(conn.port);
    setUseTLS(conn.useTLS);
    setWorkspacePath(conn.workspacePath);
  };

  const handleClearRecent = () => {
    setRecentConnections([]);
    saveRecentConnections([]);
  };

  const connected = status === 'connected';

  return (
    <div className="kairo-remote-body">
      <div className="kairo-remote-status-bar">
        <span
          className="kairo-remote-status-dot"
          style={{ backgroundColor: STATUS_DOT[status], width: 10, height: 10, borderRadius: '50%', display: 'inline-block', marginRight: 6 }}
        />
        <span className="kairo-remote-status-label">{STATUS_LABELS[status]}</span>
        {connected && (
          <span className="kairo-remote-status-addr">
            {agent.getConnection()?.config.host}:{agent.getConnection()?.config.port}
          </span>
        )}
      </div>

      <div className="kairo-remote-form">
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">Host</label>
          <input
            type="text"
            className="theia-input"
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="192.168.1.100"
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">Port</label>
          <input
            type="number"
            className="theia-input"
            value={port}
            onChange={e => setPort(Number(e.target.value))}
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">
            <input
              type="checkbox"
              checked={useTLS}
              onChange={e => setUseTLS(e.target.checked)}
              disabled={connected}
            />
            {' '}Use TLS
          </label>
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">Workspace Path</label>
          <input
            type="text"
            className="theia-input"
            value={workspacePath}
            onChange={e => setWorkspacePath(e.target.value)}
            placeholder="/home/user/project"
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">Session Token</label>
          <input
            type="password"
            className="theia-input"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Enter session token"
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-actions">
          {!connected ? (
            <button
              type="button"
              className="theia-button"
              onClick={handleConnect}
              disabled={busy || status === 'connecting'}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          ) : (
            <button
              type="button"
              className="theia-button secondary"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {recentConnections.length > 0 && (
        <div className="kairo-remote-recent">
          <div className="kairo-remote-recent-header">
            <h3>Recent Connections</h3>
            <button
              type="button"
              className="theia-button secondary small"
              onClick={handleClearRecent}
            >
              Clear
            </button>
          </div>
          <ul className="kairo-remote-recent-list">
            {recentConnections.map((conn, i) => (
              <li key={i} className="kairo-remote-recent-item">
                <button
                  type="button"
                  className="theia-button secondary"
                  onClick={() => handleSelectRecent(conn)}
                  disabled={connected}
                  title={`${conn.host}:${conn.port} → ${conn.workspacePath}`}
                >
                  <span className="kairo-remote-recent-addr">{conn.label}</span>
                  <span className="kairo-remote-recent-path">{conn.workspacePath}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {connected && (
        <div className="kairo-remote-connected">
          <p>Connected to {agent.getConnection()?.config.host}:{agent.getConnection()?.config.port}</p>
          <p>Remote workspace: {agent.getConnection()?.config.workspacePath}</p>
        </div>
      )}
    </div>
  );
};