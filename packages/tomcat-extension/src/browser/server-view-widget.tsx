import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import { ServerStore, ServerInstance, ConnectionState, HotReloadStatus } from './server-store';

function stateIconClass(state: ServerInstance['state'] | 'disconnected'): string {
    switch (state) {
        case 'stopped': return 'codicon-primitive-square';
        case 'starting': return 'codicon-play';
        case 'running': return 'codicon-circle-filled';
        case 'stopping': return 'codicon-sync codicon-modifier-spin';
        case 'error': return 'codicon-error';
        case 'crashed': return 'codicon-error';
        case 'disconnected': return 'codicon-warning';
    }
}

function stateLabel(state: ServerInstance['state'], t: (key: string, params?: Record<string, string | number>) => string): string {
    switch (state) {
        case 'stopped': return t('widget.servers.state.stopped');
        case 'starting': return t('widget.servers.state.starting');
        case 'running': return t('widget.servers.state.running');
        case 'stopping': return t('widget.servers.state.stopping');
        case 'error': return t('widget.servers.state.error');
        case 'crashed': return t('widget.servers.state.crashed');
    }
}

function hotReloadStatusClass(status: HotReloadStatus): string {
    switch (status) {
        case 'synced': return 'synced';
        case 'compiling': return 'compiling';
        case 'restart_required': return 'restart_required';
    }
}

function hotReloadStatusLabel(status: HotReloadStatus, t: (key: string, params?: Record<string, string | number>) => string): string {
    switch (status) {
        case 'synced': return t('widget.servers.hotReload.synced');
        case 'compiling': return t('widget.servers.hotReload.compiling');
        case 'restart_required': return t('widget.servers.hotReload.restartRequired');
    }
}

interface HotReloadSectionProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    hotReloadStatus: HotReloadStatus;
    publishState: 'idle' | 'publishing' | 'success' | 'error';
    publishMessage: string;
    autoSyncEnabled: boolean;
    activeServer?: ServerInstance;
    onUpdate: () => void;
    onReloadContext: () => void;
    onToggleAutoSync: () => void;
}

const HotReloadSection: React.FC<HotReloadSectionProps> = ({
    t,
    hotReloadStatus,
    publishState,
    publishMessage,
    autoSyncEnabled,
    activeServer,
    onUpdate,
    onReloadContext,
    onToggleAutoSync,
}) => (
    <div className="kairo-widget-section" data-testid="hot-reload-section">
        <div className="kairo-section-title">{t('widget.servers.hotReload.title')}</div>
        <div
            className={`kairo-hot-reload-banner ${hotReloadStatusClass(hotReloadStatus)}`}
            data-testid="hot-reload-indicator"
            title={hotReloadStatusLabel(hotReloadStatus, t)}
            role="status"
        >
            <span className="kairo-hot-reload-dot" />
            <div className="kairo-hot-reload-info">
                <div className="kairo-hot-reload-label">{hotReloadStatusLabel(hotReloadStatus, t)}</div>
                <div className="kairo-hot-reload-help">{t('widget.servers.hotReload.helpText')}</div>
            </div>
        </div>
        <div className="kairo-hot-reload-controls">
            <button
                className="theia-button main"
                onClick={onUpdate}
                disabled={!activeServer || activeServer.state !== 'running' || publishState === 'publishing'}
            >
                {t('widget.servers.hotReload.updateApplication')}
            </button>
            <button
                className="theia-button secondary"
                onClick={onReloadContext}
                disabled={!activeServer || activeServer.state !== 'running'}
            >
                {t('widget.servers.hotReload.reloadContext')}
            </button>
            <label title={t('widget.servers.hotReload.autoSyncOnSave')}>
                <input type="checkbox" checked={autoSyncEnabled} onChange={onToggleAutoSync} />
                {t('widget.servers.hotReload.autoSyncOnSave')}
            </label>
        </div>
        {publishState !== 'idle' && (
            <div className={`kairo-hot-reload-status ${publishState}`} role="status" aria-live="polite">
                {publishState === 'publishing' && <span className="codicon codicon-sync codicon-modifier-spin" aria-hidden="true" />}
                {publishState === 'success' && <span className="codicon codicon-check" aria-hidden="true" />}
                {publishMessage}
            </div>
        )}
    </div>
);

interface ServerViewProps {
    store: ServerStore;
    commandService: CommandService;
    runtime: RuntimeConnectionService;
    i18n: KairoI18nService;
}

const ServerViewComponent: React.FC<ServerViewProps> = ({ store, commandService, runtime, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [servers, setServers] = React.useState<ServerInstance[]>(store.getServers());
    const [connectionState, setConnectionState] = React.useState<ConnectionState>(store.getConnectionState());
    const [autoSyncEnabled, setAutoSyncEnabled] = React.useState(() => {
        try { return localStorage.getItem('kairo.hotReload.autoSyncOnSave') !== 'false'; } catch { return true; }
    });
    const [publishState, setPublishState] = React.useState<'idle' | 'publishing' | 'success' | 'error'>('idle');
    const [publishMessage, setPublishMessage] = React.useState(t('widget.servers.hotReload.autoSyncActive'));
    const [hotReloadStatus, setHotReloadStatus] = React.useState<HotReloadStatus>(store.getHotReloadStatus());

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

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
    const handleUpdate = () => {
        setPublishState('publishing');
        setPublishMessage(t('widget.servers.hotReload.updating'));
        commandService.executeCommand('kairo.server.update');
        setTimeout(() => {
            setPublishState('success');
            setPublishMessage(t('widget.servers.hotReload.updateTriggered'));
        }, 1000);
    };
    const handleReloadContext = () => {
        if (window.confirm(t('widget.servers.hotReload.reloadContextConfirm'))) {
            setPublishState('publishing');
            setPublishMessage(t('widget.servers.hotReload.reloading'));
            commandService.executeCommand('kairo.server.reloadContext');
            setTimeout(() => {
                setPublishState('success');
                setPublishMessage(t('widget.servers.hotReload.reloadTriggered'));
            }, 1000);
        }
    };
    const toggleAutoSync = () => {
        const next = !autoSyncEnabled;
        setAutoSyncEnabled(next);
        try { localStorage.setItem('kairo.hotReload.autoSyncOnSave', String(next)); } catch {}
        setPublishMessage(next ? t('widget.servers.hotReload.autoSyncActive') : t('widget.servers.hotReload.autoSyncPaused'));
    };

    if (connectionState === 'loading') {
        return (
            <div className="kairo-widget" data-testid="server-view">
                <div className="kairo-widget-header" data-testid="server-view-header">
                    <span className="kairo-widget-title">{t('widget.servers.title')}</span>
                </div>
                <div className="kairo-widget-body">
                    <div className="kairo-empty-state" data-testid="server-loading">
                        <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('common.loading')}</h3>
                    </div>
                </div>
            </div>
        );
    }

    if (isDisconnected) {
        return (
            <div className="kairo-widget" data-testid="server-view">
                <div className="kairo-widget-header" data-testid="server-view-header">
                    <span className="kairo-widget-title">{t('widget.servers.title')}</span>
                    <span className="kairo-server-state" data-testid="server-state" data-state="disconnected">
                        <span className={`codicon ${stateIconClass('disconnected')}`} aria-hidden="true" /> {t('widget.servers.state.disconnected')}
                    </span>
                </div>
                <div className="kairo-empty-state" data-testid="server-disconnected">
                    <span className="kairo-empty-state-glyph codicon codicon-plug" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.servers.disconnectedStateTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.servers.disconnectedStateReason')}</p>
                    <div className="kairo-empty-state-action">
                        <button className="theia-button main" onClick={() => commandService.executeCommand('kairo.agent.reconnect')}>
                            {t('widget.servers.disconnectedStateAction')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="server-view">
            <div className="kairo-widget-header" data-testid="server-view-header">
                <span className="kairo-widget-title">{t('widget.servers.title')}</span>
                {activeServer ? (
                    <span
                        className="kairo-server-state"
                        data-testid="server-state"
                        data-state={activeServer.state}
                        aria-live="polite"
                    >
                        <span className={`codicon ${stateIconClass(activeServer.state)}`} aria-hidden="true" /> {stateLabel(activeServer.state, t)}
                    </span>
                ) : (
                    <span className="kairo-server-state" data-testid="server-state" data-state="stopped" aria-live="polite">
                        <span className={`codicon ${stateIconClass('stopped')}`} aria-hidden="true" /> {t('widget.servers.state.stopped')}
                    </span>
                )}
            </div>

            <div className="kairo-server-toolbar" data-testid="server-view-toolbar">
                <button
                    className="theia-button main"
                    data-testid="server-start-button"
                    onClick={handleStart}
                    disabled={activeServer?.state === 'running' || activeServer?.state === 'starting' || isDisconnected}
                    aria-label={t('widget.servers.toolbar.startServerAria')}
                >
                    <span className="codicon codicon-play" aria-hidden="true" />
                    {t('common.start')}
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="server-debug-button"
                    onClick={handleDebug}
                    disabled={activeServer?.state === 'running' || activeServer?.state === 'starting' || isDisconnected}
                    aria-label={t('widget.servers.toolbar.debugServerAria')}
                    title={t('widget.servers.toolbar.debugServerTooltip')}
                >
                    <span className="codicon codicon-debug-alt" aria-hidden="true" />
                    {t('widget.servers.toolbar.debugServer')}
                </button>
                <div className="kairo-server-toolbar-separator" />
                <button
                    className="theia-button toolbar"
                    data-testid="server-stop-button"
                    onClick={handleStop}
                    disabled={!activeServer || activeServer.state === 'stopped' || isDisconnected}
                    aria-label={t('widget.servers.toolbar.stopServerAria')}
                    title={t('common.stop')}
                >
                    <span className="codicon codicon-primitive-square" aria-hidden="true" />
                    {t('common.stop')}
                </button>
                <button
                    className="theia-button toolbar"
                    data-testid="server-restart-button"
                    onClick={handleRestart}
                    disabled={!activeServer || activeServer.state === 'stopped' || isBusy || isDisconnected}
                    aria-label={t('widget.servers.toolbar.restartServerAria')}
                    title={t('common.restart')}
                >
                    <span className="codicon codicon-refresh" aria-hidden="true" />
                    {t('common.restart')}
                </button>
                <button
                    className="theia-button toolbar"
                    data-testid="server-open-button"
                    onClick={handleOpenApp}
                    disabled={!activeServer || activeServer.state !== 'running' || !activeServer.url}
                    aria-label={t('widget.servers.toolbar.openAppAria')}
                    title={t('widget.servers.toolbar.openApp')}
                >
                    <span className="codicon codicon-globe" aria-hidden="true" />
                    {t('widget.servers.toolbar.openApp')}
                </button>
            </div>

            {activeServer && activeServer.url && activeServer.state === 'running' && (
                <div className="kairo-server-url" data-testid="server-url">
                    <span className="kairo-server-url-label">{t('widget.servers.info.url')}</span>
                    <a
                        href={activeServer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t('widget.servers.info.urlAria', { url: activeServer.url })}
                        data-testid="server-url-link"
                    >
                        {activeServer.url}
                    </a>
                </div>
            )}

            {activeServer && (
                <div className="kairo-widget-section" data-testid="server-info">
                    <div className="kairo-section-title">{t('widget.servers.info.title')}</div>
                    <dl className="kairo-info-list" data-testid="server-info-list">
                        <dt>{t('widget.servers.info.id')}</dt>
                        <dd data-testid="server-info-id">{activeServer.id}</dd>
                        <dt>{t('widget.servers.info.port')}</dt>
                        <dd data-testid="server-info-port">{activeServer.httpPort}</dd>
                        {Boolean(activeServer.debugPort) && (
                            <>
                                <dt>{t('widget.servers.info.jdwp')}</dt>
                                <dd data-testid="server-info-debug-port">
                                    {t('widget.servers.info.jdwpReady', { port: activeServer.debugPort! })}
                                </dd>
                            </>
                        )}
                        <dt>{t('widget.servers.info.pid')}</dt>
                        <dd data-testid="server-info-pid">{activeServer.pid}</dd>
                        <dt>{t('widget.servers.info.started')}</dt>
                        <dd data-testid="server-info-start-time">{activeServer.startTime}</dd>
                    </dl>
                </div>
            )}

            <HotReloadSection
                t={t}
                hotReloadStatus={hotReloadStatus}
                publishState={publishState}
                publishMessage={publishMessage}
                autoSyncEnabled={autoSyncEnabled}
                activeServer={activeServer}
                onUpdate={handleUpdate}
                onReloadContext={handleReloadContext}
                onToggleAutoSync={toggleAutoSync}
            />

            <div className="kairo-widget-section" data-testid="server-list-section">
                <div className="kairo-section-title">{t('widget.servers.allServers')}</div>
                {isEmpty ? (
                    <div className="kairo-empty-state" data-testid="server-empty">
                        <span className="kairo-empty-state-glyph codicon codicon-server" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{t('widget.servers.emptyListTitle')}</h3>
                        <p className="kairo-empty-state-reason">{t('widget.servers.emptyListReason', { action: t('common.start') })}</p>
                        <div className="kairo-empty-state-action">
                            <button className="theia-button main" onClick={handleStart}>
                                {t('common.start')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <ul className="kairo-server-list" data-testid="server-list">
                        {servers.map(s => (
                            <li
                                key={s.id}
                                className={`kairo-server-item kairo-server-${s.state}`}
                                data-testid={`server-${s.id}`}
                            >
                                <span className={`kairo-server-state-icon codicon ${stateIconClass(s.state)}`} aria-hidden="true" title={stateLabel(s.state, t)} />
                                <span className="kairo-server-id">{s.id}</span>
                                <span className="kairo-server-item-state" data-state={s.state}>{stateLabel(s.state, t)}</span>
                                <span className="kairo-server-port">:{s.httpPort}</span>
                                {Boolean(s.debugPort) && (
                                    <span className="kairo-server-debug-port" title={t('widget.servers.jdwpTooltip')}>
                                        JDWP:{s.debugPort}
                                    </span>
                                )}
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
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = ServerViewWidget.ID;
        this.title.label = 'Kairo Server';
        this.title.caption = 'Kairo Server View';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.servers.title');
        this.title.caption = this.i18n.t('widget.servers.caption');
    }

    protected render(): React.ReactNode {
        return React.createElement(ServerViewComponent, {
            store: this.serverStore,
            commandService: this.commandService,
            runtime: this.runtime,
            i18n: this.i18n,
        });
    }
}
