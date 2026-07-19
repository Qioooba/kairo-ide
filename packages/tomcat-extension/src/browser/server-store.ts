import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { ServerInstance as ProtocolServerInstance } from '@kairo/protocol';
import { mapBuildState } from '@kairo/protocol';

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

@injectable()
export class ServerStore {
    @inject(RuntimeConnectionService)
    private readonly runtimeConnection!: RuntimeConnectionService;

    @inject(RuntimeConnectionService)
    private readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    private readonly workspaceContext!: WorkspaceContextService;

    private servers: ServerInstance[] = [];
    private readonly onDidChangeEmitter = new Emitter<ServerInstance[]>();
    readonly onDidChange: Event<ServerInstance[]> = this.onDidChangeEmitter.event;
    private eventsUnsubscribe?: () => void;

    @postConstruct()
    protected async init(): Promise<void> {
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
                    this.upsertServer({
                        id: event.serverId,
                        workspaceId: existing?.workspaceId || ctx.workspaceId,
                        projectId: existing?.projectId || '',
                        state: event.state,
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

    upsertServer(server: ServerInstance): void {
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