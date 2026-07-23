import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { ServerInstance as ProtocolServerInstance } from '@kairo/protocol';

export type ConnectionState = 'loading' | 'connected' | 'disconnected' | 'empty';

/** Hot reload status mirroring the Go backend HotReloadStatus enum. */
export type HotReloadStatus = 'synced' | 'compiling' | 'restart_required';

export interface ServerInstance {
    id: string;
    workspaceId: string;
    projectId: string;
    state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crashed';
    httpPort: number;
    /** JDWP listen port. A non-zero value means the server was started in
     * debug-ready mode; it does not imply that a DAP client is attached. */
    debugPort?: number;
    pid: number;
    startTime: string;
    url?: string;
}

/**
 * Minimal lifecycle state machine for a Kairo server
 * instance. The protocol surface uses 6 states
 * (`stopped` / `starting` / `running` / `stopping` /
 * `error` / `crashed`); the agent's UI summaries collapse
 * `error` and `crashed` to "failed". This table is the
 * authoritative allow-list for transitions.
 *
 * Anything outside this table is rejected with a console
 * warning — the agent sometimes emits out-of-order events
 * (e.g. `running` after a `stopping` if a new server is
 * registered before the old one has finished tearing
 * down), and we don't want a stale event to push the UI
 * back into a stale state.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ServerInstance['state'], ReadonlySet<ServerInstance['state']>>> = {
    stopped: new Set<ServerInstance['state']>(['starting']),
    starting: new Set<ServerInstance['state']>(['running', 'stopped', 'error', 'crashed']),
    running: new Set<ServerInstance['state']>(['stopping', 'error', 'crashed']),
    stopping: new Set<ServerInstance['state']>(['stopped', 'error', 'crashed']),
    error: new Set<ServerInstance['state']>(['starting', 'stopped']),
    crashed: new Set<ServerInstance['state']>(['starting', 'stopped']),
};

/** Collapse the 6-state surface into the 5-state
 *  user-facing summary used by the toolbar / status bar. */
export function summarizeState(s: ServerInstance['state']): 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' {
    switch (s) {
        case 'stopped': return 'stopped';
        case 'starting': return 'starting';
        case 'running': return 'running';
        case 'stopping': return 'stopping';
        case 'error':
        case 'crashed':
            return 'failed';
    }
}

export function isValidTransition(from: ServerInstance['state'], to: ServerInstance['state']): boolean {
    if (from === to) return true; // idempotent re-emit is always allowed
    return ALLOWED_TRANSITIONS[from].has(to);
}

@injectable()
export class ServerStore {
    @inject(RuntimeConnectionService)
    private readonly runtimeConnection!: RuntimeConnectionService;

    @inject(RuntimeConnectionService)
    private readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    private readonly workspaceContext!: WorkspaceContextService;

    @inject(ILogger)
    protected readonly logger!: ILogger;

    private servers: ServerInstance[] = [];
    private readonly onDidChangeEmitter = new Emitter<ServerInstance[]>();
    readonly onDidChange: Event<ServerInstance[]> = this.onDidChangeEmitter.event;
    private readonly onConnectionStateChangeEmitter = new Emitter<ConnectionState>();
    readonly onConnectionStateChange: Event<ConnectionState> = this.onConnectionStateChangeEmitter.event;
    private connectionState: ConnectionState = 'loading';
    private hotReloadStatus: HotReloadStatus = 'synced';
    private readonly onHotReloadStatusChangeEmitter = new Emitter<HotReloadStatus>();
    readonly onHotReloadStatusChange: Event<HotReloadStatus> = this.onHotReloadStatusChangeEmitter.event;

    /** Read the current connection state. UI components can seed their
     * initial render with this and then subscribe to `onConnectionStateChange`
     * for updates. */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    /** Read the current hot reload status. */
    getHotReloadStatus(): HotReloadStatus {
        return this.hotReloadStatus;
    }

    /** Direct setter for the connection state. Used by tests and by
     * init paths that don't go through `runtime.onStatusChange`. */
    setConnectionState(state: ConnectionState): void {
        if (this.connectionState === state) return;
        this.connectionState = state;
        this.onConnectionStateChangeEmitter.fire(state);
    }
    private eventsUnsubscribe?: () => void;
    private statusUnsubscribe?: () => void;
    private contextUnsubscribe?: { dispose(): void };

    @postConstruct()
    protected init(): void {
        // Subscribe to connection status (synchronous — safe for
        // postConstruct; see the bootstrap comment below).
        this.statusUnsubscribe = this.runtime.onStatusChange(s => {
            if (s === 'open') {
                this.setConnectionState(this.servers.length === 0 ? 'empty' : 'connected');
            } else if (s === 'disconnected' || s === 'closed') {
                this.setConnectionState('disconnected');
            } else {
                this.setConnectionState('loading');
            }
        });

        // The postConstruct must remain synchronous: ServerStore is
        // injected by KairoStatusBarContribution and KairoViewsContribution,
        // both bound to FrontendApplicationContribution. An async
        // @postConstruct here would make the entire binding chain
        // async, and Theia's synchronous getAll(FrontendApplicationContribution)
        // in ApplicationShell.startContributions would throw
        // `LazyInSync` for the contribution symbol. We therefore
        // kick off the snapshot load + event subscription as
        // fire-and-forget microtasks. The store is empty until the
        // first emission lands — same observable behavior as before.
        // KAIRO-RC-WEB-237 (same root cause as BuildStore): bootstrap
        // ran once at postConstruct when workspaceContext.context is
        // almost always still undefined — no snapshot, no event
        // subscription, no retry: the Server view stayed empty and its
        // buttons permanently disabled. Re-bootstrap when the context
        // appears.
        this.contextUnsubscribe = this.workspaceContext.onDidChangeContext(ctx => {
            if (ctx) {
                this.eventsUnsubscribe?.();
                this.eventsUnsubscribe = undefined;
                void this.bootstrap();
            }
        });
        void this.bootstrap();
    }

    protected async bootstrap(): Promise<void> {
        // Load initial snapshot
        const ctx = this.workspaceContext.context;
        if (ctx) {
            try {
                const servers = await this.runtime.request('GET /api/v1/servers', undefined) as ProtocolServerInstance[];
                if (Array.isArray(servers)) {
                    this.servers = servers.map(s => ({
                        id: s.id,
                        workspaceId: ctx.workspaceId,
                        projectId: s.projectId,
                        state: s.state,
                        httpPort: s.ports.http || 0,
                        debugPort: s.ports.debug || 0,
                        pid: s.pid || 0,
                        startTime: s.startedAt || '',
                        url: s.ports.http ? `http://127.0.0.1:${s.ports.http}` : undefined,
                    }));
                    this.onDidChangeEmitter.fire(this.getServers());
                    this.setConnectionState(this.servers.length === 0 ? 'empty' : 'connected');
                }
            } catch {
                // Agent not reachable yet — store stays empty.
                this.setConnectionState('disconnected');
            }
        }

        // Subscribe to events
        if (ctx) {
            this.eventsUnsubscribe = this.runtimeConnection.subscribeEvents(ctx.workspaceId, (event: any) => {
                if (event.type === 'server.state') {
                    const existing = this.servers.find(s => s.id === event.serverId);
                    const nextState = event.state as ServerInstance['state'];
                    if (existing && !isValidTransition(existing.state, nextState)) {
                        this.logger.warn(
                            `[ServerStore] rejected out-of-order transition for ${event.serverId}: ` +
                            `${existing.state} -> ${nextState} (snapshot may be stale)`,
                        );
                        return;
                    }
                    this.upsertServer({
                        id: event.serverId,
                        workspaceId: existing?.workspaceId || ctx.workspaceId,
                        projectId: existing?.projectId || '',
                        state: nextState,
                        httpPort: event.ports?.http || existing?.httpPort || 0,
                        debugPort: event.ports?.debug || existing?.debugPort || 0,
                        pid: event.pid || existing?.pid || 0,
                        startTime: existing?.startTime || new Date().toISOString(),
                        url: event.ports?.http ? `http://127.0.0.1:${event.ports.http}` : existing?.url,
                    });
                }
                if (event.type === 'hotreload.status') {
                    const nextStatus = (event.data?.status || event.message) as HotReloadStatus;
                    if (this.hotReloadStatus !== nextStatus) {
                        this.hotReloadStatus = nextStatus;
                        this.onHotReloadStatusChangeEmitter.fire(nextStatus);
                    }
                }
            });
        }
    }

    getServers(): ServerInstance[] {
        return [...this.servers];
    }

    getServer(id: string): ServerInstance | undefined {
        return this.servers.find(s => s.id === id);
    }

    /**
     * Drive the lifecycle state machine. If a server with
     * `server.id` already exists and `server.state` is
     * not reachable from the current state, the call is a
     * no-op (logged) — callers can force the override by
     * passing `{ force: true }` in the second argument.
     */
    upsertServer(server: ServerInstance, opts: { force?: boolean } = {}): void {
        const existing = this.servers.find(s => s.id === server.id);
        if (existing && !opts.force && !isValidTransition(existing.state, server.state)) {
            this.logger.warn(
                `[ServerStore] rejected upsert for ${server.id}: ` +
                `${existing.state} -> ${server.state} (pass { force: true } to override)`,
            );
            return;
        }
        const idx = this.servers.findIndex(s => s.id === server.id);
        if (idx >= 0) {
            this.servers = [...this.servers.slice(0, idx), server, ...this.servers.slice(idx + 1)];
        } else {
            this.servers = [...this.servers, server].slice(-16);
        }
        this.onDidChangeEmitter.fire(this.getServers());
    }

    removeServer(id: string): void {
        this.servers = this.servers.filter(s => s.id !== id);
        this.onDidChangeEmitter.fire(this.getServers());
    }

    dispose(): void {
        this.eventsUnsubscribe?.();
        this.statusUnsubscribe?.();
        this.contextUnsubscribe?.dispose();
        this.onDidChangeEmitter.dispose();
        this.onConnectionStateChangeEmitter.dispose();
        this.onHotReloadStatusChangeEmitter.dispose();
    }
}
