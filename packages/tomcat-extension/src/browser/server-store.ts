import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { ServerInstance as ProtocolServerInstance } from '@kairo/protocol';

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
    private eventsUnsubscribe?: () => void;

    @postConstruct()
    protected init(): void {
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
                        pid: s.pid || 0,
                        startTime: s.startedAt || '',
                        url: s.ports.http ? `http://127.0.0.1:${s.ports.http}` : undefined,
                    }));
                    this.onDidChangeEmitter.fire(this.getServers());
                }
            } catch {
                // Agent not reachable yet — store stays empty.
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
                        pid: event.pid || existing?.pid || 0,
                        startTime: existing?.startTime || new Date().toISOString(),
                        url: event.ports?.http ? `http://127.0.0.1:${event.ports.http}` : existing?.url,
                    });
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
        this.onDidChangeEmitter.dispose();
    }
}
