import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ServerStore } from './server-store';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import { BoundedLogBuffer, filterLogLines, HistoryDeltaTracker, mergeLogHistory, normalizeLogEntry, safeLogFilename, type KairoLogLine, type LogStream, type LogLevel } from './log-buffer';
import { VirtualList } from '@kairo/ui-kit';
import { KairoI18nService } from '@kairo/i18n';

type LogLevelFilter = 'all' | LogLevel;

function levelDotClass(level: LogLevel): string {
    switch (level) {
        case 'error': return 'kairo-log-dot-error';
        case 'warning': return 'kairo-log-dot-warning';
        default: return 'kairo-log-dot-info';
    }
}

function formatTime(ts: string): string {
    // Keep the full ISO value in the tooltip, show a compact clock in the row.
    // `2026-09-16T12:34:56.789Z` -> `12:34:56`
    const match = /T(\d{2}:\d{2}:\d{2})/.exec(ts);
    return match ? match[1] : ts.slice(0, 8);
}

function pickPreferredServerId(
    servers: { id: string; state: string }[],
    current: string,
    external?: string,
): string {
    if (external && servers.some(server => server.id === external)) {
        return external;
    }
    if (current && servers.some(server => server.id === current)) {
        return current;
    }
    const running = servers.find(server => server.state === 'running');
    if (running) {
        return running.id;
    }
    const starting = servers.find(server => server.state === 'starting');
    if (starting) {
        return starting.id;
    }
    return servers[0]?.id ?? '';
}

function matchesLevel(line: KairoLogLine, level: LogLevelFilter): boolean {
    return level === 'all' || line.level === level;
}

function highlightMatch(message: string, needle: string): React.ReactNode {
    const query = needle.trim();
    if (!query) {
        return message;
    }
    const lowerMessage = message.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    const index = lowerMessage.indexOf(lowerQuery);
    if (index < 0) {
        return message;
    }
    return (
        <>
            {message.slice(0, index)}
            <mark className="kairo-log-match">{message.slice(index, index + query.length)}</mark>
            {message.slice(index + query.length)}
        </>
    );
}

function renderLogRow(log: KairoLogLine, filter: string): React.ReactNode {
    return (
        <div className={`kairo-log-line ${log.level} stream-${log.stream}`} data-level={log.level} data-stream={log.stream} title={`${log.ts}  ${log.stream}\n${log.line}`}>
            <span className={`kairo-log-dot ${levelDotClass(log.level)}`} aria-hidden="true" />
            <time className="kairo-log-time">{formatTime(log.ts)}</time>
            <span className={`kairo-log-stream kairo-log-stream-${log.stream}`}>{log.stream}</span>
            <span className="kairo-log-message">{highlightMatch(log.line, filter)}</span>
        </div>
    );
}

export function renderLogRowForTest(log: KairoLogLine, filter: string): React.ReactNode {
    return renderLogRow(log, filter);
}

@injectable()
export class LogViewerWidget extends ReactWidget {
    static readonly ID = 'kairo-log-viewer';
    @inject(ServerStore) protected readonly serverStore!: ServerStore;
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
    @inject(WorkspaceContextService) protected readonly workspaceContext!: WorkspaceContextService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    /** Server requested by an external reveal (e.g. right after Start). */
    protected pendingServerId?: string;
    /** Bumped on every external reveal so the React tree re-selects even for the same id. */
    protected revealNonce = 0;

    constructor() {
        super();
        this.id = LogViewerWidget.ID;
        this.title.label = '';
        this.title.closable = true;
        this.title.caption = '';
        this.addClass('kairo-widget');
        this.addClass('kairo-log-viewer-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.logs.title');
        this.title.caption = this.i18n.t('widget.logs.caption');
    }

    /**
     * Select a server the next time the React tree renders.
     * Called by the Start/Debug/Restart commands so the freshly started
     * server is visible immediately, even if the view was already open
     * on another (stopped) server.
     */
    selectServer(serverId: string): void {
        if (!serverId) {
            return;
        }
        this.pendingServerId = serverId;
        this.revealNonce += 1;
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <LogViewer
                serverStore={this.serverStore}
                runtime={this.runtime}
                workspaceContext={this.workspaceContext}
                i18n={this.i18n}
                externalServerId={this.pendingServerId}
                revealNonce={this.revealNonce}
            />
        );
    }
}

interface Props {
    serverStore: ServerStore;
    runtime: RuntimeConnectionService;
    workspaceContext: WorkspaceContextService;
    i18n: KairoI18nService;
    /** Server id requested by an external reveal (Start/Debug/Restart). */
    externalServerId?: string;
    /** Changes on every external reveal; lets the view re-select the same id. */
    revealNonce?: number;
}
const BATCH_MS = 80;
const POLL_MS = 2000;
type ConnectionStatus = 'connecting' | 'open' | 'disconnected' | 'closed';

export const LogViewer: React.FC<Props> = ({ serverStore, runtime, workspaceContext, i18n, externalServerId, revealNonce }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const bufferRef = React.useRef(new BoundedLogBuffer());
    const historyTracker = React.useRef(new HistoryDeltaTracker());
    const [lines, setLines] = React.useState<readonly KairoLogLine[]>([]);
    const [selectedServerId, setSelectedServerId] = React.useState(() => externalServerId ?? '');
    const [paused, setPaused] = React.useState(false);
    const pausedRef = React.useRef(false);
    const [autoScroll, setAutoScroll] = React.useState(true);
    const [filter, setFilter] = React.useState('');
    const [stream, setStream] = React.useState<'all' | LogStream>('all');
    const [level, setLevel] = React.useState<LogLevelFilter>('all');
    const [connection, setConnection] = React.useState<ConnectionStatus>('disconnected');
    const [pausedCount, setPausedCount] = React.useState(0);
    const [historyStatus, setHistoryStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [historyError, setHistoryError] = React.useState('');
    const [documentVisible, setDocumentVisible] = React.useState(() => document.visibilityState !== 'hidden');
    const [viewerVisible, setViewerVisible] = React.useState(true);
    const [, setServerVersion] = React.useState(0);
    const viewerRef = React.useRef<HTMLDivElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const pending = React.useRef<KairoLogLine[]>([]);
    const liveVersion = React.useRef(0);
    const loadGeneration = React.useRef(0);
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const publish = React.useCallback(() => setLines([...bufferRef.current.snapshot]), []);
    const flush = React.useCallback(() => {
        timer.current = undefined;
        if (!pending.current.length) return;
        const batch = pending.current;
        pending.current = [];
        bufferRef.current.append(...batch);
        if (pausedRef.current) setPausedCount(count => count + batch.length);
        else publish();
    }, [publish]);
    const append = React.useCallback((entry: KairoLogLine) => { liveVersion.current++; pending.current.push(entry); timer.current ??= setTimeout(flush, BATCH_MS); }, [flush]);

    React.useEffect(() => { pausedRef.current = paused; if (!paused) { flush(); setPausedCount(0); publish(); } }, [paused, flush, publish]);
    React.useEffect(() => {
        const sub = serverStore.onDidChange(servers => {
            setServerVersion(v => v + 1);
            setSelectedServerId(current => pickPreferredServerId(servers, current, externalServerId));
        });
        return () => sub.dispose();
    }, [serverStore, externalServerId, revealNonce]);
    React.useEffect(() => runtime.onStatusChange(status => setConnection(status)), [runtime]);
    React.useEffect(() => {
        const onVisibility = () => setDocumentVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);
    React.useEffect(() => {
        const element = viewerRef.current;
        if (!element || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver(entries => setViewerVisible(entries.some(entry => entry.isIntersecting)));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // An external reveal (Start/Debug/Restart) wins over the current selection,
    // even when the view was already open on a different server.
    React.useEffect(() => {
        if (!externalServerId) {
            return;
        }
        setSelectedServerId(current => {
            if (current === externalServerId) {
                return current;
            }
            return externalServerId;
        });
        setPaused(false);
        setPausedCount(0);
        setAutoScroll(true);
    }, [externalServerId, revealNonce]);

    const loadHistory = React.useCallback(async () => {
        if (!selectedServerId) return;
        const generation = ++loadGeneration.current;
        const startLiveVersion = liveVersion.current;
        setHistoryStatus('loading');
        setHistoryError('');
        try {
            const data = await runtime.request('GET /api/v1/servers/{serverId}/logs', { follow: false, tail: 1000 }, { pathParams: { serverId: selectedServerId } });
            if (generation !== loadGeneration.current) return;
            const history = (Array.isArray(data) ? data : []).map(normalizeLogEntry);
            const delta = historyTracker.current.next(history);
            if (delta.initial && liveVersion.current !== startLiveVersion) {
                flush();
                bufferRef.current.replace(mergeLogHistory(history, bufferRef.current.snapshot));
            } else if (delta.initial) bufferRef.current.replace(history);
            else bufferRef.current.append(...delta.additions);
            setHistoryStatus('ready');
            if (!pausedRef.current) publish();
        } catch (error) {
            if (generation !== loadGeneration.current) return;
            setHistoryStatus('error');
            setHistoryError(error instanceof Error ? error.message : String(error));
        }
    }, [selectedServerId, runtime, publish, flush, t]);

    React.useEffect(() => {
        pending.current = [];
        loadGeneration.current++;
        liveVersion.current = 0;
        historyTracker.current.reset();
        bufferRef.current.clear();
        setPaused(false);
        setPausedCount(0);
        publish();
        void loadHistory();
    }, [loadHistory, publish]);
    const previousConnection = React.useRef<ConnectionStatus | undefined>(undefined);
    React.useEffect(() => {
        const previous = previousConnection.current;
        previousConnection.current = connection;
        if (previous !== undefined && previous !== 'open' && connection === 'open') void loadHistory();
    }, [connection, loadHistory]);
    React.useEffect(() => {
        if (!selectedServerId || connection !== 'open' || !documentVisible || !viewerVisible) return undefined;
        let disposed = false;
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        const poll = async () => {
            await loadHistory();
            if (!disposed) pollTimer = setTimeout(poll, POLL_MS);
        };
        pollTimer = setTimeout(poll, POLL_MS);
        return () => {
            disposed = true;
            if (pollTimer) clearTimeout(pollTimer);
            loadGeneration.current++;
        };
    }, [connection, documentVisible, loadHistory, selectedServerId, viewerVisible]);
    React.useEffect(() => {
        const context = workspaceContext.context; if (!context) return undefined;
        return runtime.subscribeEvents(context.workspaceId, event => { if (event.type === 'log' && (!selectedServerId || event.serverId === selectedServerId)) append(normalizeLogEntry(event)); });
    }, [selectedServerId, runtime, workspaceContext, append]);
    React.useEffect(() => { const servers = serverStore.getServers(); setSelectedServerId(current => pickPreferredServerId(servers, current, externalServerId)); }, [serverStore, selectedServerId, externalServerId, revealNonce]);
    React.useEffect(() => () => { loadGeneration.current++; if (timer.current) clearTimeout(timer.current); }, []);

    const servers = serverStore.getServers(); const selectedServer = servers.find(server => server.id === selectedServerId);
    const streamFiltered = filterLogLines(lines, filter, stream);
    const visible = streamFiltered.filter(line => matchesLevel(line, level));
    const errorCount = lines.filter(line => line.level === 'error').length;
    const warningCount = lines.filter(line => line.level === 'warning').length;
    const clearView = () => { pending.current = []; bufferRef.current.clear(); setPausedCount(0); publish(); };
    const clearFilter = () => { setFilter(''); setStream('all'); setLevel('all'); searchRef.current?.focus(); };
    const isFilterActive = filter.trim() !== '' || stream !== 'all' || level !== 'all';
    const saveAs = () => {
        const text = visible.map(line => `${line.ts}\t${line.stream}\t${line.line}`).join('\n'); const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeLogFilename(selectedServerId); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const pollingActive = Boolean(selectedServerId && connection === 'open' && documentVisible && viewerVisible);
    const connectionLabel = connection === 'open'
        ? t('widget.logs.connectionOpen')
        : connection === 'connecting'
            ? t('widget.logs.connectionConnecting')
            : connection === 'closed'
                ? t('widget.logs.connectionClosed')
                : t('widget.logs.connectionDisconnected');
    const serverStateLabel = selectedServer
        ? (() => {
            const key = `widget.servers.state.${selectedServer.state}`;
            const label = t(key);
            return label === key ? selectedServer.state : label;
        })()
        : t('widget.logs.noServer');
    const isStarting = selectedServer?.state === 'starting';
    const isLoadingHistory = historyStatus === 'loading' && lines.length === 0;
    const showStartingState = Boolean(selectedServerId && isStarting && lines.length === 0 && historyStatus !== 'error');
    const showNoServerState = servers.length === 0 || !selectedServerId;
    const showFilterEmptyState = !showNoServerState && !showStartingState && !isLoadingHistory && visible.length === 0 && historyStatus !== 'error';

    return <div className="kairo-log-viewer" data-testid="log-viewer" ref={viewerRef}>
        <div className="kairo-log-viewer-header">
            <div className="kairo-log-viewer-title-row">
                <span className="kairo-log-viewer-header-title">{t('widget.logs.title')}</span>
                {selectedServer && (
                    <span className="kairo-log-server-pill" data-state={selectedServer.state} title={`${selectedServer.id} · :${selectedServer.httpPort}`}>
                        <span className={`kairo-log-server-dot kairo-log-server-dot-${selectedServer.state}`} aria-hidden="true" />
                        {selectedServer.id}
                        <span className="kairo-log-server-port">:{selectedServer.httpPort}</span>
                    </span>
                )}
            </div>
            <span className="kairo-log-viewer-header-meta">{t('widget.logs.serverLogsTitle', { lines: lines.length, bytes: bufferRef.current.byteLength })}</span>
        </div>
        <div className="kairo-log-viewer-toolbar kairo-log-toolbar" role="toolbar" aria-label={t('widget.logs.toolbarAria')}>
            <div className="kairo-toolbar-group kairo-log-server-group">
                <select className="kairo-log-viewer-server-select" value={selectedServerId} onChange={event => setSelectedServerId(event.target.value)} aria-label={t('widget.logs.serverSelectAria')} disabled={servers.length === 0}>
                    {servers.length === 0 && <option value="">{t('widget.logs.noServer')}</option>}
                    {servers.map(server => {
                        const stateKey = `widget.servers.state.${server.state}`;
                        const stateLabel = t(stateKey);
                        return <option key={server.id} value={server.id}>{server.id} ({stateLabel === stateKey ? server.state : stateLabel})</option>;
                    })}
                </select>
            </div>
            <div className="kairo-toolbar-separator" aria-hidden="true" />
            <div className="kairo-toolbar-group kairo-log-filter">
                <div className="kairo-log-search">
                    <span className="codicon codicon-search kairo-log-search-icon" aria-hidden="true" />
                    <input ref={searchRef} className="theia-input kairo-log-search-input" value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('widget.logs.filterPlaceholder')} aria-label={t('widget.logs.filterPlaceholder')} />
                    {filter && (
                        <button className="kairo-log-search-clear" onClick={() => setFilter('')} aria-label={t('widget.logs.clearFilter')} title={t('widget.logs.clearFilter')}>
                            <span className="codicon codicon-close" aria-hidden="true" />
                        </button>
                    )}
                </div>
                <select className="kairo-log-viewer-server-select" value={stream} onChange={event => setStream(event.target.value as 'all' | LogStream)} aria-label={t('widget.logs.streamFilterAria')}>
                    <option value="all">{t('widget.logs.allStreams')}</option>
                    <option value="stdout">{t('widget.logs.stdout')}</option>
                    <option value="stderr">{t('widget.logs.stderr')}</option>
                    <option value="structured">{t('widget.logs.structured')}</option>
                </select>
                <select className="kairo-log-viewer-server-select" value={level} onChange={event => setLevel(event.target.value as LogLevelFilter)} aria-label={t('widget.logs.levelFilterAria')}>
                    <option value="all">{t('widget.logs.levelAll')}</option>
                    <option value="info">{t('widget.logs.levelInfo')}</option>
                    <option value="warning">{t('widget.logs.levelWarning')}</option>
                    <option value="error">{t('widget.logs.levelError')}</option>
                </select>
            </div>
            <div className="kairo-toolbar-actions">
                <button className="theia-button toolbar" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? t('widget.logs.resume') : t('widget.logs.pause')} title={paused ? t('widget.logs.resume') : t('widget.logs.pause')}>
                    <span className={`codicon ${paused ? 'codicon-play' : 'codicon-debug-pause'}`} aria-hidden="true" />
                </button>
                <button className="theia-button toolbar" onClick={clearView} aria-label={t('widget.logs.clearView')} title={t('widget.logs.clearView')}>
                    <span className="codicon codicon-clear-all" aria-hidden="true" />
                </button>
                <button className="theia-button toolbar" onClick={saveAs} disabled={!visible.length} aria-label={t('widget.logs.saveAs')} title={t('widget.logs.saveAs')}>
                    <span className="codicon codicon-save" aria-hidden="true" />
                </button>
                {!autoScroll && visible.length > 0 && (
                    <button className="theia-button toolbar kairo-log-goto-bottom" onClick={() => setAutoScroll(true)} aria-label={t('widget.logs.goToBottom')} title={t('widget.logs.goToBottom')}>
                        <span className="codicon codicon-arrow-down" aria-hidden="true" />
                    </button>
                )}
                <div className="kairo-toolbar-separator" aria-hidden="true" />
                <label className="kairo-log-checkbox"><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> {t('widget.logs.autoScroll')}</label>
            </div>
        </div>
        <div className="kairo-log-status" role="status">
            <div className="kairo-log-status-chips">
                <span className="kairo-log-status-chip" data-kind="runtime" data-state={connection}>{t('widget.logs.statusRuntime')}: {connectionLabel}</span>
                <span className="kairo-log-status-chip" data-kind="server" data-state={selectedServer?.state ?? 'none'}>{t('widget.logs.statusServer')}: {serverStateLabel}</span>
                {errorCount > 0 && <span className="kairo-log-status-chip" data-kind="errors" data-state="error"><span className="codicon codicon-error" aria-hidden="true" /> {errorCount}</span>}
                {warningCount > 0 && <span className="kairo-log-status-chip" data-kind="warnings" data-state="warning"><span className="codicon codicon-warning" aria-hidden="true" /> {warningCount}</span>}
                <span className="kairo-log-status-poll">{pollingActive ? t('widget.logs.statusPolling', { interval: POLL_MS / 1000 }) : t('widget.logs.statusIdle')}</span>
            </div>
            <span className={paused ? 'kairo-log-status-paused' : 'kairo-log-status-live'}>
                {paused ? (pausedCount ? t('widget.logs.statusBuffered', { count: pausedCount }) : t('widget.logs.statusPaused')) : t('widget.logs.statusLive')}
            </span>
        </div>
        {historyStatus === 'error' && (
            <div className="kairo-error-banner" role="alert">
                <span className="codicon codicon-error" aria-hidden="true" />
                <span>{t('widget.logs.historyError')}：{historyError}</span>
                <button className="theia-button secondary" onClick={() => void loadHistory()}>{t('widget.logs.retryHistory')}</button>
            </div>
        )}
        {showNoServerState ? (
            <div className="kairo-log-viewer-content">
                <div className="kairo-empty-state" data-testid="log-empty-no-server">
                    <span className="kairo-empty-state-glyph codicon codicon-server" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.logs.noServerTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.logs.noServerReason')}</p>
                </div>
            </div>
        ) : showStartingState || isLoadingHistory ? (
            <div className="kairo-log-viewer-content">
                <div className="kairo-empty-state" data-testid="log-loading">
                    <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{isLoadingHistory && !isStarting ? t('widget.logs.loadingHistory') : t('widget.logs.startingTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.logs.startingReason')}</p>
                </div>
            </div>
        ) : showFilterEmptyState ? (
            <div className="kairo-log-viewer-content">
                <div className="kairo-empty-state" data-testid="log-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-output" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.logs.emptyState')}</h3>
                    {isFilterActive && (
                        <div className="kairo-empty-state-action">
                            <button className="theia-button secondary" onClick={clearFilter}>{t('widget.logs.clearFilter')}</button>
                        </div>
                    )}
                </div>
            </div>
        ) : (
            <VirtualList
                items={visible}
                rowHeight={24}
                className="kairo-log-viewer-content"
                role="log"
                ariaLive={paused ? 'off' : 'polite'}
                ariaLabel={t('widget.logs.serverLogsAriaLabel')}
                keyboardNavigation={false}
                scrollToIndex={autoScroll ? visible.length - 1 : undefined}
                onScroll={({ scrollTop, scrollHeight, clientHeight }) => {
                    if (scrollTop + clientHeight < scrollHeight - 5) {
                        setAutoScroll(false);
                    }
                }}
                onScrollToBottom={() => setAutoScroll(true)}
                renderItem={log => renderLogRow(log, filter)}
            />
        )}
    </div>;
};
