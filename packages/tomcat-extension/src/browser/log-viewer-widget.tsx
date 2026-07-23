import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ServerStore } from './server-store';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import { BoundedLogBuffer, filterLogLines, HistoryDeltaTracker, mergeLogHistory, normalizeLogEntry, safeLogFilename, type KairoLogLine, type LogStream } from './log-buffer';
import { VirtualList } from '@kairo/ui-kit';

@injectable()
export class LogViewerWidget extends ReactWidget {
    static readonly ID = 'kairo-log-viewer';
    @inject(ServerStore) protected readonly serverStore!: ServerStore;
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
    @inject(WorkspaceContextService) protected readonly workspaceContext!: WorkspaceContextService;
    constructor() { super(); this.id = LogViewerWidget.ID; this.title.label = 'Server Logs'; this.title.closable = true; this.title.caption = 'Kairo Server Log Viewer'; this.addClass('kairo-widget'); }
    protected render(): React.ReactNode { return <LogViewer serverStore={this.serverStore} runtime={this.runtime} workspaceContext={this.workspaceContext} />; }
}

interface Props { serverStore: ServerStore; runtime: RuntimeConnectionService; workspaceContext: WorkspaceContextService; }
const BATCH_MS = 80;
const POLL_MS = 2000;
type ConnectionStatus = 'connecting' | 'open' | 'disconnected' | 'closed';

export const LogViewer: React.FC<Props> = ({ serverStore, runtime, workspaceContext }) => {
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
    const timer = React.useRef<ReturnType<typeof setTimeout>>();

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
            setHistoryError(error instanceof Error ? error.message : 'Unable to load log history');
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
    const previousConnection = React.useRef<ConnectionStatus>();
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
        <div className="kairo-log-viewer-toolbar" role="toolbar" aria-label="Tomcat log controls">
            <strong className="kairo-log-viewer-title">Server Logs ({lines.length} lines / {bufferRef.current.byteLength} bytes)</strong>
            <select className="kairo-log-viewer-server-select" value={selectedServerId} onChange={event => setSelectedServerId(event.target.value)} aria-label="Select server">{servers.map(server => <option key={server.id} value={server.id}>{server.id} ({server.state})</option>)}</select>
            <button className="theia-button secondary" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? 'Resume' : 'Pause'}</button>
            <button className="theia-button secondary" onClick={clearView}>Clear view</button>
            <button className="theia-button secondary" onClick={saveAs} disabled={!visible.length}>Save As…</button>
            <label className="kairo-log-checkbox"><input type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.target.checked)} /> Auto-scroll</label>
            <input className="theia-input" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter logs" aria-label="Filter logs" />
            <select className="kairo-log-viewer-server-select" value={stream} onChange={event => setStream(event.target.value as 'all' | LogStream)} aria-label="Filter log stream"><option value="all">All streams</option><option value="stdout">stdout</option><option value="stderr">stderr</option><option value="structured">structured</option></select>
        </div>
        <div className="kairo-log-status" role="status">
            Runtime: {connection}; Server: {selectedServer?.state ?? 'none'}; History: {historyStatus}; Refresh: {pollingActive ? '2s bounded polling' : 'idle'}; {paused ? (pausedCount ? `${pausedCount}+ updates buffered while paused` : 'updates buffered while paused') : 'live'}
            {historyStatus === 'error' && <><span className="kairo-log-error"> — {historyError}</span> <button className="theia-button secondary" onClick={() => void loadHistory()}>Retry history</button></>}
        </div>
        {!visible.length ? (
            <div className="kairo-log-viewer-content">
                <div className="kairo-log-empty">No matching log output.</div>
            </div>
        ) : (
            <VirtualList
                items={visible}
                rowHeight={24}
                className="kairo-log-viewer-content"
                role="log"
                ariaLive={paused ? 'off' : 'polite'}
                ariaLabel="Server logs"
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
                        <time>{log.ts}</time> <span className="kairo-log-stream">[{log.stream}]</span> {log.line}
                    </div>
                )}
            />
        )}
    </div>;
};
