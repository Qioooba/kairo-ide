import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { ServerStore, ServerInstance, ConnectionState, HotReloadStatus } from './server-store';

function stateIcon(state: ServerInstance['state']): string {
    switch (state) {
        case 'stopped': return '\u25A0'; // black square
        case 'starting': return '\u25B6'; // play
        case 'running': return '\u25CF'; // black circle
        case 'stopping': return '\u25D0'; // circle with left half black
        case 'error': return '\u2716'; // heavy multiplication x
        case 'crashed': return '\u2716'; // heavy multiplication x
    }
}

function stateLabel(state: ServerInstance['state']): string {
    switch (state) {
        case 'stopped': return 'Stopped';
        case 'starting': return 'Starting...';
        case 'running': return 'Running';
        case 'stopping': return 'Stopping...';
        case 'error': return 'Error';
        case 'crashed': return 'Crashed';
    }
}

function hotReloadStatusColor(status: HotReloadStatus): string {
    switch (status) {
        case 'synced': return '#22c55e'; // green
        case 'compiling': return '#eab308'; // yellow
        case 'restart_required': return '#ef4444'; // red
    }
}

function hotReloadStatusLabel(status: HotReloadStatus): string {
    switch (status) {
        case 'synced': return '已同步';
        case 'compiling': return '编译中';
        case 'restart_required': return '需要重启';
    }
}

interface ServerViewProps {
    store: ServerStore;
    commandService: CommandService;
    runtime: RuntimeConnectionService;
}

const ServerViewComponent: React.FC<ServerViewProps> = ({ store, commandService, runtime }) => {
    const [servers, setServers] = React.useState<ServerInstance[]>(store.getServers());
    const [connectionState, setConnectionState] = React.useState<ConnectionState>(store.getConnectionState());
    const [reloadPaused, setReloadPaused] = React.useState(false);
    const [publishState, setPublishState] = React.useState<'idle' | 'publishing' | 'success' | 'error'>('idle');
    const [publishMessage, setPublishMessage] = React.useState('Manual mode — no file watcher is active.');
    const [hotReloadStatus, setHotReloadStatus] = React.useState<HotReloadStatus>(store.getHotReloadStatus());

    React.useEffect(() => {
        const sub = store.onDidChange(s => setServers([...s]));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const sub = store.onConnectionStateChange(s => setConnectionState(s));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const sub = store.onHotReloadStatusChange(s => setHotReloadStatus(s));
        return () => sub.dispose();
    }, [store]);

    // The API retains stopped server history. Prefer the currently live
    // instance so historical rows cannot leave Stop/Restart/Open disabled
    // while a later server is running (KAIRO-RC-WEB-262).
    const activeServer = servers.find(server =>
        server.state === 'running' || server.state === 'starting' || server.state === 'stopping',
    ) ?? servers[0];
    const isBusy = activeServer?.state === 'starting' || activeServer?.state === 'stopping';
    const isDisconnected = connectionState === 'disconnected';
    const isEmpty = servers.length === 0 && connectionState !== 'loading';

    const handleStart = () => commandService.executeCommand('kairo.server.start');
    const handleDebug = () => commandService.executeCommand('kairo.server.debug');
    const handleStop = () => commandService.executeCommand('kairo.server.stop');
    const handleRestart = () => commandService.executeCommand('kairo.server.restart');
    const handleOpenApp = () => commandService.executeCommand('kairo.app.open');
    const publishStatic = async () => {
        if (!activeServer || reloadPaused) return;
        setPublishState('publishing'); setPublishMessage('Publishing JSP/CSS/JS and static resources…');
        try {
            const result = await runtime.request('POST /api/v1/deployments', { projectId: activeServer.projectId, buildId: '', scope: 'webapp', intent: 'publish-static-changes' });
            setPublishState('success'); setPublishMessage(`${result.filesTouched} file(s), ${result.bytes} bytes published without context reload.`);
        } catch (error) {
            setPublishState('error'); setPublishMessage(error instanceof Error ? error.message : 'Publish failed. Retry when ready.');
        }
    };

    if (connectionState === 'loading') {
        return (
            <>
            <div className="kairo-widget" data-testid="server-view">
                <div className="kairo-widget-header" data-testid="server-view-header">
                    <span className="kairo-widget-title">Server</span>
                </div>
                <p className="kairo-empty" data-testid="server-loading">Loading...</p>
            </div>

            <div className="kairo-widget-section" data-testid="hot-reload-section">
                <div className="kairo-section-title">Static Hot Reload (manual)</div>
                <div className="kairo-hot-reload-indicator" data-testid="hot-reload-indicator" title={hotReloadStatusLabel(hotReloadStatus)}>
                    <span className="kairo-hot-reload-dot" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: hotReloadStatusColor(hotReloadStatus), marginRight: 6, verticalAlign: 'middle' }} />
                    <span className="kairo-hot-reload-label">{hotReloadStatusLabel(hotReloadStatus)}</span>
                </div>
                <div className="kairo-widget-toolbar">
                    <button className="theia-button" onClick={() => void publishStatic()} disabled={!activeServer || activeServer.state !== 'running' || reloadPaused || publishState === 'publishing'}>Publish Changed Files</button>
                    <button className="theia-button secondary" onClick={() => setReloadPaused(value => !value)} aria-pressed={reloadPaused}>{reloadPaused ? 'Resume' : 'Pause'}</button>
                </div>
                <div className={`kairo-hot-reload-status ${publishState}`} role="status">{publishMessage}</div>
                <p className="kairo-help-text">JSP/CSS/JS and static bytes are merge-copied. Deletes are not propagated. Java/class changes require Build + Publish and may require restart; HotSwap is not claimed.</p>
            </div>
            </>
        );
    }

    if (isDisconnected) {
        return (
            <div className="kairo-widget" data-testid="server-view">
                <div className="kairo-widget-header" data-testid="server-view-header">
                    <span className="kairo-widget-title">Server</span>
                    <span className="kairo-server-state" data-testid="server-state" data-state="disconnected">
                        Disconnected
                    </span>
                </div>
                <p className="kairo-empty" data-testid="server-disconnected">
                    Cannot reach the runtime agent. Server commands are unavailable.
                </p>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="server-view">
            <div className="kairo-widget-header" data-testid="server-view-header">
                <span className="kairo-widget-title">Server</span>
                {activeServer ? (
                    <span
                        className="kairo-server-state"
                        data-testid="server-state"
                        data-state={activeServer.state}
                        aria-live="polite"
                    >
                        {stateIcon(activeServer.state)} {stateLabel(activeServer.state)}
                    </span>
                ) : (
                    <span className="kairo-server-state" data-testid="server-state" data-state="stopped" aria-live="polite">
                        {stateIcon('stopped')} Stopped
                    </span>
                )}
            </div>

            <div className="kairo-widget-toolbar" data-testid="server-view-toolbar">
                <button
                    className="theia-button"
                    data-testid="server-start-button"
                    onClick={handleStart}
                    disabled={activeServer?.state === 'running' || activeServer?.state === 'starting' || isDisconnected}
                    aria-label="Start server"
                >
                    Start
                </button>
                <button
                    className="theia-button"
                    data-testid="server-debug-button"
                    onClick={handleDebug}
                    disabled={activeServer?.state === 'running' || activeServer?.state === 'starting' || isDisconnected}
                    aria-label="Start server with JDWP enabled"
                    title="Start Tomcat with a local JDWP port. Debug Adapter connection is shown separately."
                >
                    Debug Server
                </button>
                <button
                    className="theia-button"
                    data-testid="server-stop-button"
                    onClick={handleStop}
                    disabled={!activeServer || activeServer.state === 'stopped' || isDisconnected}
                    aria-label="Stop server"
                >
                    Stop
                </button>
                <button
                    className="theia-button"
                    data-testid="server-restart-button"
                    onClick={handleRestart}
                    disabled={!activeServer || activeServer.state === 'stopped' || isBusy || isDisconnected}
                    aria-label="Restart server"
                >
                    Restart
                </button>
                <button
                    className="theia-button"
                    data-testid="server-open-button"
                    onClick={handleOpenApp}
                    disabled={!activeServer || activeServer.state !== 'running' || !activeServer.url}
                    aria-label="Open application in browser"
                >
                    Open App
                </button>
            </div>

            {activeServer && activeServer.url && activeServer.state === 'running' && (
                <div className="kairo-server-url" data-testid="server-url">
                    <span className="kairo-server-url-label">URL: </span>
                    <a
                        href={activeServer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${activeServer.url} in browser`}
                        data-testid="server-url-link"
                    >
                        {activeServer.url}
                    </a>
                </div>
            )}

            {activeServer && (
                <div className="kairo-widget-section" data-testid="server-info">
                    <div className="kairo-section-title">Server Info</div>
                    <dl className="kairo-info-list" data-testid="server-info-list">
                        <dt>ID</dt>
                        <dd data-testid="server-info-id">{activeServer.id}</dd>
                        <dt>Port</dt>
                        <dd data-testid="server-info-port">{activeServer.httpPort}</dd>
                        {Boolean(activeServer.debugPort) && (
                            <>
                                <dt>JDWP</dt>
                                <dd data-testid="server-info-debug-port">
                                    127.0.0.1:{activeServer.debugPort} (ready)
                                </dd>
                            </>
                        )}
                        <dt>PID</dt>
                        <dd data-testid="server-info-pid">{activeServer.pid}</dd>
                        <dt>Started</dt>
                        <dd data-testid="server-info-start-time">{activeServer.startTime}</dd>
                    </dl>
                </div>
            )}

            <div className="kairo-widget-section" data-testid="hot-reload-section">
                <div className="kairo-section-title">Static Hot Reload (manual)</div>
                <div className="kairo-hot-reload-indicator" data-testid="hot-reload-indicator" title={hotReloadStatusLabel(hotReloadStatus)}>
                    <span className="kairo-hot-reload-dot" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: hotReloadStatusColor(hotReloadStatus), marginRight: 6, verticalAlign: 'middle' }} />
                    <span className="kairo-hot-reload-label">{hotReloadStatusLabel(hotReloadStatus)}</span>
                </div>
                <div className="kairo-widget-toolbar">
                    <button className="theia-button" onClick={() => void publishStatic()} disabled={!activeServer || activeServer.state !== 'running' || reloadPaused || publishState === 'publishing'}>Publish Changed Files</button>
                    <button className="theia-button secondary" onClick={() => setReloadPaused(value => !value)} aria-pressed={reloadPaused}>{reloadPaused ? 'Resume' : 'Pause'}</button>
                </div>
                <div className={`kairo-hot-reload-status ${publishState}`} role="status">{publishMessage}</div>
                <p className="kairo-help-text">JSP/CSS/JS and static bytes are merge-copied. Deletes are not propagated. Java/class changes require Build + Publish and may require restart; HotSwap is not claimed.</p>
            </div>

            <div className="kairo-widget-section" data-testid="server-list-section">
                <div className="kairo-section-title">All Servers</div>
                {isEmpty ? (
                    <p className="kairo-empty" data-testid="server-empty">
                        No servers registered. Press <strong>Start</strong> to launch one.
                    </p>
                ) : (
                    <ul className="kairo-server-list" data-testid="server-list">
                        {servers.map(s => (
                            <li
                                key={s.id}
                                className={`kairo-server-item kairo-server-${s.state}`}
                                data-testid={`server-${s.id}`}
                            >
                                <span className="kairo-server-state-icon">{stateIcon(s.state)}</span>
                                <span className="kairo-server-id">{s.id}</span>
                                <span className="kairo-server-port">:{s.httpPort}</span>
                                {Boolean(s.debugPort) && (
                                    <span className="kairo-server-debug-port" title="JDWP debug-ready port">
                                        {' '}JDWP:{s.debugPort}
                                    </span>
                                )}
                                <span className="kairo-server-status">{stateLabel(s.state)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

@injectable()
export class ServerViewWidget extends ReactWidget {
    static readonly ID = 'kairo-server-view';

    @inject(ServerStore) protected readonly serverStore!: ServerStore;
    @inject(CommandService) protected readonly commandService!: CommandService;
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

    constructor() {
        super();
        this.id = ServerViewWidget.ID;
        this.title.label = 'Kairo Server';
        this.title.caption = 'Kairo Server View';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(ServerViewComponent, {
            store: this.serverStore,
            commandService: this.commandService,
            runtime: this.runtime,
        });
    }
}
