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
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KairoI18nService } from '@kairo/i18n';
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

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = KAIRO_REMOTE_FACTORY_ID;
    this.title.iconClass = 'codicon codicon-remote';
    this.title.closable = true;
    this.addClass('kairo-remote');
  }

  /**
   * Title must be applied after DI property injection completes —
   * reading this.i18n in the constructor threw
   * "Cannot read properties of undefined (reading 't')" and the widget
   * never mounted (BUG-20260826-109).
   */
  @postConstruct()
  protected init(): void {
    const apply = (): void => {
      this.title.label = this.i18n.t('widget.remote.title');
      this.title.caption = this.i18n.t('widget.remote.caption');
      this.update();
    };
    apply();
    this.toDispose.push(this.i18n.onDidChangeLanguage(apply));
  }

  render(): React.ReactNode {
    return React.createElement(KairoRemoteView, {
      agent: this.agent,
      messages: this.messages,
      i18n: this.i18n,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  React View                                                          */
/* ------------------------------------------------------------------ */

interface KairoRemoteViewProps {
  agent: KairoRemoteAgentService;
  messages: MessageService;
  i18n: KairoI18nService;
}

const statusDotClass = (status: RemoteAgentStatus): string => {
  switch (status) {
    case 'connected': return 'kairo-status-dot-success';
    case 'connecting': return 'kairo-status-dot-warning';
    case 'error': return 'kairo-status-dot-error';
    default: return 'kairo-status-dot-error';
  }
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

const KairoRemoteView: React.FC<KairoRemoteViewProps> = ({ agent, messages, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);
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
      messages.warn(t('widget.remote.validation.hostTokenRequired'));
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
        messages.info(t('widget.remote.toast.connected', { host, port }));
        // Save to recent connections
        const label = `${host}:${port}`;
        const updated = recentConnections.filter(c => c.label !== label);
        updated.unshift({ host: host.trim(), port, useTLS, workspacePath: workspacePath.trim() || '/', label });
        setRecentConnections(updated);
        saveRecentConnections(updated);
      } else {
        messages.error(t('widget.remote.toast.failed', { host, port }));
      }
    } catch (err) {
      messages.error(t('widget.remote.toast.error', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    agent.disconnect();
    messages.info(t('widget.remote.toast.disconnected'));
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
        <span className={`kairo-remote-status-dot ${statusDotClass(status)}`} />
        <span className="kairo-remote-status-label">{t(`widget.remote.status.${status}`)}</span>
        {connected && (
          <span className="kairo-remote-status-addr">
            {agent.getConnection()?.config.host}:{agent.getConnection()?.config.port}
          </span>
        )}
      </div>

      <div className="kairo-remote-form">
        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">{t('widget.remote.label.host')}</label>
          <input
            type="text"
            className="theia-input"
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder={t('widget.remote.placeholder.host')}
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">{t('widget.remote.label.port')}</label>
          <input
            type="number"
            className="theia-input"
            value={port}
            onChange={e => setPort(Number(e.target.value))}
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label kairo-remote-checkbox">
            <input
              type="checkbox"
              checked={useTLS}
              onChange={e => setUseTLS(e.target.checked)}
              disabled={connected}
            />
            {t('widget.remote.label.useTLS')}
          </label>
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">{t('widget.remote.label.workspacePath')}</label>
          <input
            type="text"
            className="theia-input"
            value={workspacePath}
            onChange={e => setWorkspacePath(e.target.value)}
            placeholder={t('widget.remote.placeholder.workspacePath')}
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-row">
          <label className="kairo-remote-label">{t('widget.remote.label.token')}</label>
          <input
            type="password"
            className="theia-input"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={t('widget.remote.placeholder.token')}
            disabled={connected}
          />
        </div>

        <div className="kairo-remote-form-actions">
          {!connected ? (
            <button
              type="button"
              className="theia-button main"
              onClick={handleConnect}
              disabled={busy || status === 'connecting'}
            >
              {busy ? t('widget.remote.action.connecting') : t('widget.remote.action.connect')}
            </button>
          ) : (
            <button
              type="button"
              className="theia-button toolbar"
              onClick={handleDisconnect}
            >
              {t('widget.remote.action.disconnect')}
            </button>
          )}
        </div>
      </div>

      {recentConnections.length > 0 && (
        <div className="kairo-remote-recent">
          <div className="kairo-remote-recent-header">
            <h3>{t('widget.remote.recent.title')}</h3>
            <button
              type="button"
              className="theia-button secondary small"
              onClick={handleClearRecent}
            >
              {t('widget.remote.recent.clear')}
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
          <p>{t('widget.remote.connectedInfo.connectedTo', { host: agent.getConnection()?.config.host ?? '', port: agent.getConnection()?.config.port ?? '' })}</p>
          <p>{t('widget.remote.connectedInfo.remoteWorkspace', { path: agent.getConnection()?.config.workspacePath ?? '' })}</p>
        </div>
      )}
    </div>
  );
};