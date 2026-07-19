import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import type { BuildResult } from '@kairo/protocol';

export interface BuildRun {
    id: string;
    workspaceId: string;
    projectId: string;
    state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    startTime: string;
    endTime?: string;
    summary?: string;
    diagnostics?: BuildDiagnostic[];
}

export interface BuildDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
}

export type ConnectionState = 'loading' | 'connected' | 'disconnected' | 'empty';

@injectable()
export class BuildStore {
    @inject(RuntimeConnectionService)
    private readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    private readonly workspaceContext!: WorkspaceContextService;

    private builds: BuildRun[] = [];
    private readonly onDidChangeEmitter = new Emitter<BuildRun[]>();
    readonly onDidChange: Event<BuildRun[]> = this.onDidChangeEmitter.event;
    private readonly onConnectionStateChangeEmitter = new Emitter<ConnectionState>();
    readonly onConnectionStateChange: Event<ConnectionState> = this.onConnectionStateChangeEmitter.event;
    private connectionState: ConnectionState = 'loading';
    private eventsUnsubscribe?: () => void;
    private statusUnsubscribe?: () => void;
    /** Track which build IDs we've seen to make the reducer idempotent. */
    private seenBuildIds = new Set<string>();

    @postConstruct()
    protected init(): void {
        // Subscribe to connection status
        this.statusUnsubscribe = this.runtime.onStatusChange(s => {
            const prev = this.connectionState;
            if (s === 'open') {
                this.connectionState = this.builds.length === 0 ? 'empty' : 'connected';
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
                void this.loadBuilds(ctx.workspaceId);
                this.subscribeToEvents(ctx.workspaceId);
            } else {
                this.builds = [];
                this.seenBuildIds.clear();
                this.eventsUnsubscribe?.();
                this.eventsUnsubscribe = undefined;
                this.onDidChangeEmitter.fire([]);
            }
        });

        // Initial load - async, do not await in postConstruct
        const ctx = this.workspaceContext.context;
        if (ctx) {
            void this.loadBuilds(ctx.workspaceId);
            this.subscribeToEvents(ctx.workspaceId);
        }
    }

    protected subscribeToEvents(workspaceId: string): void {
        if (this.eventsUnsubscribe) {
            this.eventsUnsubscribe();
        }
        this.eventsUnsubscribe = this.runtime.subscribeEvents(workspaceId, (event: any) => {
            if (event.type === 'build.progress') {
                const state = event.state as string;
                const mappedState = state === 'success' ? 'succeeded' as const
                    : state === 'failure' ? 'failed' as const
                    : state === 'queued' ? 'pending' as const
                    : state;
                this.upsertBuild(event.buildId, {
                    state: mappedState as BuildRun['state'],
                    endTime: (state === 'success' || state === 'failure') ? new Date().toISOString() : undefined,
                });
            }
        });
    }

    protected async loadBuilds(workspaceId: string): Promise<void> {
        try {
            const builds = await this.runtime.request('GET /api/v1/builds', undefined) as BuildResult[];
            if (Array.isArray(builds)) {
                this.builds = builds.map(b => {
                    this.seenBuildIds.add(b.id);
                    return {
                        id: b.id,
                        workspaceId,
                        projectId: '',
                        state: b.state === 'success' ? 'succeeded' : b.state === 'failure' ? 'failed' : b.state === 'queued' ? 'pending' : b.state,
                        startTime: b.startedAt,
                        endTime: b.finishedAt,
                        summary: `${b.summary.errors} errors, ${b.summary.warnings} warnings`,
                        diagnostics: b.diagnostics.map(d => ({
                            file: d.file,
                            line: d.line,
                            column: d.column,
                            severity: d.severity === 'hint' ? 'info' : d.severity,
                            message: d.message,
                        })),
                    };
                });
                this.connectionState = this.builds.length === 0 ? 'empty' : 'connected';
                this.onConnectionStateChangeEmitter.fire(this.connectionState);
                this.onDidChangeEmitter.fire(this.getBuilds());
            }
        } catch {
            this.connectionState = 'disconnected';
            this.onConnectionStateChangeEmitter.fire(this.connectionState);
        }
    }

    getBuilds(): BuildRun[] {
        return [...this.builds];
    }

    getLatestBuild(): BuildRun | undefined {
        return this.builds[this.builds.length - 1];
    }

    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    addBuild(build: BuildRun): void {
        // Idempotent: skip if already seen
        if (this.seenBuildIds.has(build.id)) return;
        this.seenBuildIds.add(build.id);
        this.builds = [...this.builds, build].slice(-200);
        this.onDidChangeEmitter.fire(this.getBuilds());
    }

    setBuilds(builds: BuildRun[]): void {
        this.builds = [...builds];
        this.seenBuildIds = new Set(builds.map(b => b.id));
        this.onDidChangeEmitter.fire(this.getBuilds());
    }

    /** Idempotent upsert: add or update a build by id. */
    upsertBuild(id: string, update: Partial<BuildRun>): void {
        const existing = this.builds.find(b => b.id === id);
        if (existing) {
            // Only update if state is actually progressing (idempotent)
            this.builds = this.builds.map(b => b.id === id ? { ...b, ...update } : b);
            this.onDidChangeEmitter.fire(this.getBuilds());
        } else {
            // New build from event
            this.addBuild({
                id,
                workspaceId: this.workspaceContext.context?.workspaceId ?? '',
                projectId: '',
                state: update.state ?? 'pending',
                startTime: new Date().toISOString(),
                ...update,
            });
        }
    }

    updateBuild(id: string, update: Partial<BuildRun>): void {
        this.builds = this.builds.map(b => b.id === id ? { ...b, ...update } : b);
        this.onDidChangeEmitter.fire(this.getBuilds());
    }

    clearHistory(): void {
        this.builds = [];
        this.seenBuildIds.clear();
        this.onDidChangeEmitter.fire([]);
    }

    dispose(): void {
        this.eventsUnsubscribe?.();
        this.statusUnsubscribe?.();
        this.onDidChangeEmitter.dispose();
        this.onConnectionStateChangeEmitter.dispose();
    }
}