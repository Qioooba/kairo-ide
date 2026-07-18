import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { ServerStore, ServerInstance } from './server-store';

function stateIcon(state: ServerInstance['state']): string {
    switch (state) {
        case 'stopped': return '\u23f9\ufe0f'; // stop
        case 'starting': return '\u25b6\ufe0f'; // play
        case 'running': return '\u2705'; // checkmark
        case 'stopping': return '\u23f3'; // hourglass
        case 'error': return '\u274c'; // cross
        case 'crashed': return '\u274c'; // cross
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

interface ServerViewProps {
    store: ServerStore;
    commandService: CommandService;
}

const ServerViewComponent: React.FC<ServerViewProps> = ({ store, commandService }) => {
    const [servers, setServers] = React.useState<ServerInstance[]>(store.getServers());

    React.useEffect(() => {
        const sub = store.onDidChange(s => setServers([...s]));
        return () => sub.dispose();
    }, [store]);

    const activeServer = servers.length > 0 ? servers[0] : undefined;

    const handleStart = () => commandService.executeCommand('kairo.server.start');
    const handleStop = () => commandService.executeCommand('kairo.server.stop');
    const handleRestart = () => commandService.executeCommand('kairo.server.restart');
    const handleOpenApp = () => commandService.executeCommand('kairo.app.open');

    return (
        <div className="kairo-widget" data-testid="server-view">
            <div className="kairo-widget-header" data-testid="server-view-header">
                <span className="kairo-widget-title">Server</span>
                {activeServer ? (
                    <span
                        className="kairo-server-state"
                        data-testid="server-state"
                        data-state={activeServer.state}
                    >
                        {stateIcon(activeServer.state)} {stateLabel(activeServer.state)}
                    </span>
                ) : (
                    <span className="kairo-server-state" data-testid="server-state" data-state="stopped">
                        {stateIcon('stopped')} Stopped
                    </span>
                )}
            </div>

            <div className="kairo-widget-toolbar" data-testid="server-view-toolbar">
                <button
                    className="theia-button"
                    data-testid="server-start-button"
                    onClick={handleStart}
                    disabled={activeServer?.state === 'running' || activeServer?.state === 'starting'}
                >
                    Start
                </button>
                <button
                    className="theia-button"
                    data-testid="server-stop-button"
                    onClick={handleStop}
                    disabled={!activeServer || activeServer.state === 'stopped'}
                >
                    Stop
                </button>
                <button
                    className="theia-button"
                    data-testid="server-restart-button"
                    onClick={handleRestart}
                    disabled={!activeServer || activeServer.state === 'stopped'}
                >
                    Restart
                </button>
                <button
                    className="theia-button"
                    data-testid="server-open-button"
                    onClick={handleOpenApp}
                    disabled={!activeServer || activeServer.state !== 'running' || !activeServer.url}
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
                        <dt>PID</dt>
                        <dd data-testid="server-info-pid">{activeServer.pid}</dd>
                        <dt>Started</dt>
                        <dd data-testid="server-info-start-time">{activeServer.startTime}</dd>
                    </dl>
                </div>
            )}

            <div className="kairo-widget-section" data-testid="server-list-section">
                <div className="kairo-section-title">All Servers</div>
                {servers.length === 0 ? (
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
        });
    }
}