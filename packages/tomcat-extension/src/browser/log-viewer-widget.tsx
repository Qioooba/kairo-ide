import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ServerStore } from './server-store';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';

interface LogLine {
    line: string;
    ts: string;
    level?: 'error' | 'warning' | 'info';
}

@injectable()
export class LogViewerWidget extends ReactWidget {
    static readonly ID = 'kairo-log-viewer';

    @inject(ServerStore)
    protected readonly serverStore!: ServerStore;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(RuntimeConnectionService)
    protected readonly runtimeConnection!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    constructor() {
        super();
        this.id = LogViewerWidget.ID;
        this.title.label = 'Server Logs';
        this.title.closable = true;
        this.title.caption = 'Kairo Server Log Viewer';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(LogViewer, {
            serverStore: this.serverStore,
            runtime: this.runtime,
            runtimeConnection: this.runtimeConnection,
            workspaceContext: this.workspaceContext,
        });
    }
}

interface LogViewerProps {
    serverStore: ServerStore;
    runtime: RuntimeConnectionService;
    runtimeConnection: RuntimeConnectionService;
    workspaceContext: WorkspaceContextService;
}

const MAX_LOG_LINES = 1000;
const VISIBLE_LINES = 500;
const BATCH_INTERVAL = 80;

const LogViewer: React.FC<LogViewerProps> = ({ serverStore, runtime, runtimeConnection, workspaceContext }) => {
    const [logLines, setLogLines] = React.useState<LogLine[]>([]);
    const [selectedServerId, setSelectedServerId] = React.useState<string>('');
    const containerRef = React.useRef<HTMLDivElement>(null);
    const autoScrollRef = React.useRef(true);
    const pendingBatch = React.useRef<LogLine[]>([]);
    const batchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const classifyLogLevel = React.useCallback((line: string): LogLine['level'] => {
        const lower = line.toLowerCase();
        if (lower.includes('error') || lower.includes('exception') || lower.includes('fatal') ||
            lower.includes('severe') || lower.includes('fail')) {
            return 'error';
        }
        if (lower.includes('warn') || lower.includes('warning')) {
            return 'warning';
        }
        return 'info';
    }, []);

    const flushBatch = React.useCallback(() => {
        if (pendingBatch.current.length === 0) return;
        setLogLines(prev => {
            const merged = [...prev, ...pendingBatch.current];
            if (merged.length > MAX_LOG_LINES) {
                return merged.slice(merged.length - MAX_LOG_LINES);
            }
            return merged;
        });
        pendingBatch.current = [];
        batchTimer.current = null;
    }, []);

    const appendLog = React.useCallback((newLines: LogLine[]) => {
        pendingBatch.current.push(...newLines);
        if (!batchTimer.current) {
            batchTimer.current = setTimeout(flushBatch, BATCH_INTERVAL);
        }
    }, [flushBatch]);

    const handleClear = React.useCallback(() => {
        setLogLines([]);
        pendingBatch.current = [];
        if (batchTimer.current) {
            clearTimeout(batchTimer.current);
            batchTimer.current = null;
        }
    }, []);

    React.useEffect(() => {
        const servers = serverStore.getServers();
        if (servers.length > 0 && !selectedServerId) {
            setSelectedServerId(servers[0].id);
        }
    }, [serverStore, selectedServerId]);

    // Fetch log history from the real endpoint when selected server changes
    React.useEffect(() => {
        if (!selectedServerId) return;
        setLogLines([]);
        pendingBatch.current = [];
        if (batchTimer.current) {
            clearTimeout(batchTimer.current);
            batchTimer.current = null;
        }
        runtime.request('GET /api/v1/servers/{serverId}/logs', { follow: false }, { pathParams: { serverId: selectedServerId } })
            .then((data: any) => {
                const lines = (Array.isArray(data) ? data : []).map((entry: any) => ({
                    line: entry.line,
                    ts: entry.ts,
                    level: classifyLogLevel(entry.line),
                }));
                setLogLines(lines);
            })
            .catch(() => {
                // Server may not be running yet — no logs available.
            });
    }, [selectedServerId, runtime, classifyLogLevel]);

    // Subscribe to EventHub for live log tailing
    React.useEffect(() => {
        const ctx = workspaceContext.context;
        if (!ctx) return;
        const unsub = runtimeConnection.subscribeEvents(ctx.workspaceId, (event: any) => {
            if (event.type === 'log') {
                if (selectedServerId && event.serverId !== selectedServerId) return;
                const newLine: LogLine = {
                    line: event.line,
                    ts: event.ts,
                    level: classifyLogLevel(event.line),
                };
                appendLog([newLine]);
            }
        });
        return () => {
            unsub();
        };
    }, [selectedServerId, runtimeConnection, workspaceContext, appendLog, classifyLogLevel]);

    // Track server list changes to update selector
    React.useEffect(() => {
        const sub = serverStore.onDidChange(servers => {
            if (selectedServerId && !servers.find(s => s.id === selectedServerId)) {
                setSelectedServerId(servers.length > 0 ? servers[0].id : '');
            } else if (!selectedServerId && servers.length > 0) {
                setSelectedServerId(servers[0].id);
            }
        });
        return () => sub.dispose();
    }, [serverStore, selectedServerId]);

    React.useEffect(() => {
        return () => {
            if (batchTimer.current) {
                clearTimeout(batchTimer.current);
            }
        };
    }, []);

    React.useEffect(() => {
        if (autoScrollRef.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logLines]);

    const handleScroll = React.useCallback(() => {
        if (containerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
            autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 50;
        }
    }, []);

    const handleServerChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedServerId(e.target.value);
    }, []);

    const visibleLines = logLines.slice(-VISIBLE_LINES);
    const servers = serverStore.getServers();

    return (
        <div className="kairo-log-viewer" data-testid="log-viewer">
            <div className="kairo-log-viewer-toolbar" data-testid="log-viewer-toolbar">
                <span className="kairo-log-viewer-title" data-testid="log-viewer-title">
                    Server Logs ({logLines.length} lines)
                </span>
                {servers.length > 1 && (
                    <select
                        className="kairo-log-viewer-server-select"
                        value={selectedServerId}
                        onChange={handleServerChange}
                        data-testid="log-server-select"
                        aria-label="Select server for logs"
                    >
                        {servers.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.id} ({s.state})
                            </option>
                        ))}
                    </select>
                )}
                <button
                    className="theia-button secondary"
                    onClick={handleClear}
                    data-testid="log-clear-btn"
                    aria-label="Clear logs"
                >
                    Clear
                </button>
            </div>
            <div
                className="kairo-log-viewer-content"
                ref={containerRef}
                onScroll={handleScroll}
                data-testid="log-viewer-content"
                aria-label="Server log output"
                role="log"
            >
                {visibleLines.length === 0 ? (
                    <div className="kairo-log-empty" data-testid="log-empty">
                        No log output. Start a server to see logs.
                    </div>
                ) : (
                    visibleLines.map((log, idx) => (
                        <div
                            key={`${log.ts}-${idx}`}
                            className={`kairo-log-line ${log.level || ''}`}
                            data-testid={`log-line-${idx}`}
                        >
                            {log.line}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
