import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ServerStore } from './server-store';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import { BoundedLogBuffer, filterLogLines, HistoryDeltaTracker, mergeLogHistory, normalizeLogEntry, safeLogFilename, type KairoLogLine, type LogStream } from './log-buffer';
import { VirtualList } from '@kairo/ui-kit';
import { KairoI18nService } from '@kairo/i18n';

@injectable()
export class LogViewerWidget extends ReactWidget {
    static readonly ID = 'kairo-log-viewer';
    @inject(ServerStore) protected readonly serverStore!: ServerStore;
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
    @inject(WorkspaceContextService) protected readonly workspaceContext!: WorkspaceContextService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = LogViewerWidget.ID;
        this.title.label = '';
        this.title.closable = true;
        this.title.caption = '';
        this.addClass('kairo-widget');
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

    protected render(): React.ReactNode { return <LogViewer serverStore={this.serverStore} runtime={this.runtime} workspaceContext={this.workspaceContext} i18n={this.i18n} />; }
}

interface Props { serverStore: ServerStore; runtime: RuntimeConnectionService; workspaceContext: WorkspaceContextService; i18n: KairoI18nService; }
const BATCH_MS = 80;
const POLL_MS = 2000;
type ConnectionStatus = 'connecting' | 'open' | 'disconnected' | 'closed';

export const LogViewer: React.FC<Props> = ({ serverStore, runtime, workspaceContext, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const bufferRef = React.useRef(new BoundedLogBuffer());
    const historyTracker = React.useRef(new HistoryDeltaTracker());
    const [lines, setLines] = React.useState<readonly KairoLogLine[]>([]);
    const [selectedServerId, setSelectedServerId] = React.useState('');
    const [paused, setPaused] = React.useState(false);
    const pausedRef = React.useRef(false);
    const [autoScroll, setAutoScroll] = React.useState(true);
    const [filter, setFilter] = React.useState('');
    const [stream, setStream] = React.useState<'all' | LogStream>('all');
    const [connection, setConnection] = React.useState<ConnectionStatus>('disconnected');
    const [pausedCount, setPausedCount] = React.useState(0);
    const [historyStatus, setHistoryStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [historyError, setHistoryError] = React.useState('');
    const [documentVisible, setDocumentVisible] = React.useState(() => document.visibilityState !== 'hidden');
    const [viewerVisible, setViewerVisible] = React.useState(true);
    const [, setServerVersion] = React.useState(0);
    const viewerRef = React.useRef<HTMLDivElement>(null);
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
            setSelectedServerId(current => servers.some(server => server.id === current)
                ? current
                : (servers.find(server => server.state === 'running') ?? servers[0])?.id ?? '');
        });
        return () => sub.dispose();
    }, [serverStore]);
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
            setHistoryError(error instanceof Error ? error.message : t('widget.logs.historyError'));
        }
    }, [selectedServerId, runtime, publish, flush]);

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
    React.useEffect(() => { const servers = serverStore.getServers(); const selected = servers.find(s => s.id === selectedServerId); const running = servers.find(s => s.state === 'running'); if (!selected) setSelectedServerId((running ?? servers[0])?.id ?? ''); }, [serverStore, selectedServerId]);
    React.useEffect(() => () => { loadGeneration.current++; if (timer.current) clearTimeout(timer.current); }, []);

    const servers = serverStore.getServers(); const selectedServer = servers.find(server => server.id === selectedServerId);
    const visible = filterLogLines(lines, filter, stream);
    const clearView = () => { pending.current = []; bufferRef.current.clear(); setPausedCount(0); publish(); };
    const saveAs = () => {
        const text = visible.map(line => `${line.ts}\t${line.stream}\t${line.line}`).join('\n'); const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeLogFilename(selectedServerId); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const pollingActive = Boolean(selectedServerId && connection === 'open' && documentVisible && viewerVisible);
    return <div className="kairo-log-viewer" data-testid="log-viewer" ref={viewerRef}>
        <div className="kairo-log-viewer-header">
            <span className="kairo-log-viewer-header-title">{t('widget.logs.title')}</span>
            <span className="kairo-log-viewer-header-meta">{t('widget.logs.serverLogsTitle', { lines: lines.length, bytes: bufferRef.current.byteLength })}</span>
        </div>
        <div className="kairo-log-viewer-toolbar kairo-log-toolbar" role="toolbar" aria-label={t('widget.logs.toolbarAria')}>
            <div className="kairo-toolbar-group">
                <select className="kairo-log-viewer-server-select" value={selectedServerId} onChange={event => setSelectedServerId(event.target.value)} aria-label={t('widget.logs.serverSelectAria')}>
                    {servers.map(server => <option key={server.id} value={server.id}>{server.id} ({server.state})</option>)}
                </select>
            </div>
            <div className="kairo-toolbar-separator" />
            <div className="kairo-toolbar-group kairo-log-filter">
                <input className="theia-input" value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('widget.logs.filterPlaceholder')} aria-label={t('widget.logs.filterPlaceholder')} />
                <select className="kairo-log-viewer-server-select" value={stream} onChange={event => setStream(event.target.value as 'all' | LogStream)} aria-label={t('widget.logs.streamFilterAria')}>
                    <option value="all">{t('widget.logs.allStreams')}</option>
                    <option value="stdout">{t('widget.logs.stdout')}</option>
                    <option value="stderr">{t('widget.logs.stderr')}</option>
                    <option value="structured">{t('widget.logs.structured')}</option>
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
                <div className="kairo-toolbar-separator" />
                <label className="kairo-log-checkbox"><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> {t('widget.logs.autoScroll')}</label>
            </div>
        </div>
        <div className="kairo-log-status" role="status">
            <div className="kairo-log-status-chips">
                <span className="kairo-log-status-chip" data-kind="runtime" data-state={connection}>{t('widget.logs.statusRuntime')}: {connection}</span>
                <span className="kairo-log-status-chip" data-kind="server" data-state={selectedServer?.state ?? 'none'}>{t('widget.logs.statusServer')}: {selectedServer?.state ?? t('widget.logs.noServer')}</span>
                <span>{pollingActive ? t('widget.logs.statusPolling', { interval: POLL_MS / 1000 }) : t('widget.logs.statusIdle')}</span>
            </div>
            <span className={paused ? 'kairo-log-status-paused' : 'kairo-log-status-live'}>
                {paused ? (pausedCount ? t('widget.logs.statusBuffered', { count: pausedCount }) : t('widget.logs.statusPaused')) : t('widget.logs.statusLive')}
            </span>
        </div>
        {historyStatus === 'error' && (
            <div className="kairo-error-banner" role="alert">
                <span className="codicon codicon-error" aria-hidden="true" />
                <span>{historyError}</span>
                <button className="theia-button secondary" onClick={() => void loadHistory()}>{t('widget.logs.retryHistory')}</button>
            </div>
        )}
        {!visible.length ? (
            <div className="kairo-log-viewer-content">
                <div className="kairo-empty-state" data-testid="log-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-output" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.logs.emptyState')}</h3>
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
                renderItem={log => (
                    <div className={`kairo-log-line ${log.level} stream-${log.stream}`}>
                        <time>{log.ts}</time>
                        <span className="kairo-log-stream">{log.stream}</span>
                        <span className="kairo-log-message">{log.line}</span>
                    </div>
                )}
            />
        )}
    </div>;
};
