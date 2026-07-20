import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { ServerInstance as ProtocolServerInstance } from '@kairo/protocol';

export type ConnectionState = 'loading' | 'connected' | 'disconnected' | 'empty';

export interface ServerInstance {
    id: string;
    workspaceId: string;
    projectId: string;
    state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'crashed';
    httpPort: number;
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

    /** Read the current connection state. UI components can seed their
     * initial render with this and then subscribe to `onConnectionStateChange`
     * for updates. */
    getConnectionState(): ConnectionState {
        return this.connectionState;
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
    /** Track which server IDs we've seen to make the reducer idempotent. */
    private seenServerIds = new Set<string>();

    @postConstruct()
    protected init(): void {
        // Subscribe to connection status
        this.statusUnsubscribe = this.runtime.onStatusChange(s => {
            const prev = this.connectionState;
            if (s === 'open') {
                this.connectionState = this.servers.length === 0 ? 'empty' : 'connected';
            } else if (s === 'disconnected' || s === 'closed') {
                this.connectionState = 'disconnected';
            } else {
                this.connectionState = 'loading';
            }
            if (this.connectionState !== prev) {
                this.onConnectionStateChangeEmitter.fire(this.connectionState);
            }
        });

        // Subscribe to workspace context changes
        this.workspaceContext.onDidChangeContext(ctx => {
            if (ctx) {
                void this.loadServers(ctx.workspaceId);
                this.subscribeToEvents(ctx.workspaceId);
            } else {
                this.servers = [];
                this.seenServerIds.clear();
                this.eventsUnsubscribe?.();
                this.eventsUnsubscribe = undefined;
                this.onDidChangeEmitter.fire([]);
            }
        });

        // Initial load - async, do not await in postConstruct
        const ctx = this.workspaceContext.context;
        if (ctx) {
            void this.loadServers(ctx.workspaceId);
            this.subscribeToEvents(ctx.workspaceId);
        }
    }

    protected subscribeToEvents(workspaceId: string): void {
        if (this.eventsUnsubscribe) {
            this.eventsUnsubscribe();
        }
        this.eventsUnsubscribe = this.runtime.subscribeEvents(workspaceId, (event: any) => {
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
                    workspaceId: existing?.workspaceId || workspaceId,
                    projectId: existing?.projectId || '',
                    state: nextState,
                    httpPort: event.ports?.http || existing?.httpPort || 0,
                    pid: event.pid || existing?.pid || 0,
                    startTime: existing?.startTime || new Date().toISOString(),
                    url: event.ports?.http ? `http://127.0.0.1:${event.ports.http}` : existing?.url,
                });
            }
        });
    }

    protected async loadServers(workspaceId: string): Promise<void> {
        try {
            const servers = await this.runtime.request('GET /api/v1/servers', undefined) as ProtocolServerInstance[];
            if (Array.isArray(servers)) {
                this.servers = servers.map(s => {
                    this.seenServerIds.add(s.id);
                    return {
                        id: s.id,
                        workspaceId,
                        projectId: s.projectId,
                        state: s.state,
                        httpPort: s.ports.http || 0,
                        pid: s.pid || 0,
                        startTime: s.startedAt || '',
                        url: s.ports.http ? `http://127.0.0.1:${s.ports.http}` : undefined,
                    };
                });
                this.connectionState = this.servers.length === 0 ? 'empty' : 'connected';
                this.onConnectionStateChangeEmitter.fire(this.connectionState);
                this.onDidChangeEmitter.fire(this.getServers());
            }
        } catch {
            this.connectionState = 'disconnected';
            this.onConnectionStateChangeEmitter.fire(this.connectionState);
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
            const existing = this.servers[idx];
            // Idempotent: skip if nothing changed
            if (existing.state === server.state && existing.pid === server.pid && existing.httpPort === server.httpPort) {
                return;
            }
            this.servers = [...this.servers.slice(0, idx), server, ...this.servers.slice(idx + 1)];
        } else {
            this.seenServerIds.add(server.id);
            this.servers = [...this.servers, server].slice(-16);
        }
        this.onDidChangeEmitter.fire(this.getServers());
    }

    removeServer(id: string): void {
        this.servers = this.servers.filter(s => s.id !== id);
        this.seenServerIds.delete(id);
        this.onDidChangeEmitter.fire(this.getServers());
    }

    dispose(): void {
        this.eventsUnsubscribe?.();
        this.statusUnsubscribe?.();
        this.onDidChangeEmitter.dispose();
        this.onConnectionStateChangeEmitter.dispose();
    }
}