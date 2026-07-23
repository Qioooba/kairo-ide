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

/**
 * Map a wire BuildResult to the view model. Tolerates null /
 * missing summary and diagnostics — the agent emits both as
 * null for builds that never ran a compiler (KAIRO-RC-WEB-237:
 * the unguarded access used to kill the whole bootstrap and
 * leave the Build view idle forever).
 */
export function mapBuildResult(b: BuildResult, workspaceId: string): BuildRun {
    const summary = b.summary as { errors?: number; warnings?: number } | null | undefined;
    const diagnostics = Array.isArray(b.diagnostics) ? b.diagnostics : [];
    return {
        id: b.id,
        workspaceId,
        projectId: (b as unknown as { projectId?: string }).projectId ?? '',
        state: b.state === 'success' ? 'succeeded' : b.state === 'failure' ? 'failed' : b.state === 'queued' ? 'pending' : b.state,
        startTime: b.startedAt,
        endTime: b.finishedAt,
        summary: summary ? `${summary.errors ?? 0} errors, ${summary.warnings ?? 0} warnings` : b.error ?? '',
        diagnostics: diagnostics.map(d => ({
            file: d.file,
            line: d.line,
            column: d.column,
            severity: d.severity === 'hint' ? 'info' : d.severity,
            message: d.message,
        })),
    };
}

@injectable()
export class BuildStore {
    @inject(RuntimeConnectionService)
    private readonly runtimeConnection!: RuntimeConnectionService;

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
    private readonly cancellationRequests = new Map<string, Promise<BuildRun>>();

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
    private contextUnsubscribe?: { dispose(): void };

    @postConstruct()
    protected init(): void {
        // Subscribe to connection status (synchronous — safe for
        // postConstruct; see the bootstrap comment below).
        this.statusUnsubscribe = this.runtime.onStatusChange(s => {
            if (s === 'open') {
                this.setConnectionState(this.builds.length === 0 ? 'empty' : 'connected');
            } else if (s === 'disconnected' || s === 'closed') {
                this.setConnectionState('disconnected');
            } else {
                this.setConnectionState('loading');
            }
        });

        // The postConstruct must remain synchronous: BuildStore is
        // injected by KairoViewsContribution, which is bound to
        // FrontendApplicationContribution. An async @postConstruct
        // here would make the entire binding chain async, and the
        // synchronous `getAll(FrontendApplicationContribution)`
        // that Theia performs in ApplicationShell.startContributions
        // would throw `LazyInSync` for the contribution symbol.
        //
        // We therefore kick off the initial snapshot and event
        // subscription as fire-and-forget microtasks. The store
        // is still empty until the first emission, which is
        // exactly the prior observable behavior — the UI shows
        // "no builds" until the snapshot / first event lands.
        // KAIRO-RC-WEB-237: bootstrap used to run exactly once at
        // postConstruct, when workspaceContext.context is almost
        // always still undefined (the agent connection and workspace
        // arrive later) — no snapshot, no event subscription, and no
        // retry: the Build view stayed permanently empty. Re-bootstrap
        // whenever the workspace context appears (and after a change),
        // tearing down the previous event subscription first.
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
                const builds = await this.runtime.request('GET /api/v1/builds', undefined) as BuildResult[];
                if (Array.isArray(builds)) {
                    this.builds = builds.map(b => mapBuildResult(b, ctx.workspaceId));
                    this.onDidChangeEmitter.fire(this.getBuilds());
                    this.setConnectionState(this.builds.length === 0 ? 'empty' : 'connected');
                }
            } catch {
                // Agent not reachable yet — store stays empty, UI shows "no builds".
                this.setConnectionState('disconnected');
            }
        }

        // Subscribe to events
        if (ctx) {
            this.eventsUnsubscribe = this.runtimeConnection.subscribeEvents(ctx.workspaceId, (event: any) => {
                if (event.type === 'build.progress') {
                    const state = event.state as string;
                    const mappedState = state === 'success' ? 'succeeded' as const
                        : state === 'failure' ? 'failed' as const
                        : state === 'queued' ? 'pending' as const
                        : state;
                    this.updateBuild(event.buildId, {
                        state: mappedState as BuildRun['state'],
                        endTime: (state === 'success' || state === 'failure' || state === 'cancelled') ? new Date().toISOString() : undefined,
                    });
                }
            });
        }
    }

    getBuilds(): BuildRun[] {
        return [...this.builds];
    }

    getLatestBuild(): BuildRun | undefined {
        return this.builds[this.builds.length - 1];
    }

    addBuild(build: BuildRun): void {
        this.builds = [...this.builds, build].slice(-200);
        this.onDidChangeEmitter.fire(this.getBuilds());
    }

    setBuilds(builds: BuildRun[]): void {
        this.builds = [...builds];
        this.onDidChangeEmitter.fire(this.getBuilds());
    }

    updateBuild(id: string, update: Partial<BuildRun>): void {
        this.builds = this.builds.map(b => b.id === id ? { ...b, ...update } : b);
        this.onDidChangeEmitter.fire(this.getBuilds());
    }

    clearHistory(): void {
        this.builds = [];
        this.onDidChangeEmitter.fire([]);
    }

    cancelBuild(buildId: string): Promise<BuildRun> {
        const existing = this.cancellationRequests.get(buildId);
        if (existing) return existing;
        const request = this.cancelBuildOnce(buildId);
        this.cancellationRequests.set(buildId, request);
        void request.then(
            () => this.cancellationRequests.delete(buildId),
            () => this.cancellationRequests.delete(buildId),
        );
        return request;
    }

    private async cancelBuildOnce(buildId: string): Promise<BuildRun> {
        const ctx = this.workspaceContext.context;
        if (!ctx) {
            throw new Error('No active workspace');
        }
        const result = await this.runtime.request(
            'DELETE /api/v1/builds/{buildId}',
            undefined,
            { pathParams: { buildId }, timeoutMs: 15_000, noRetry: true },
        ) as BuildResult;
        const mapped = mapBuildResult(result, ctx.workspaceId);
        const exists = this.builds.some(build => build.id === buildId);
        this.builds = exists
            ? this.builds.map(build => build.id === buildId ? mapped : build)
            : [...this.builds, mapped].slice(-200);
        this.onDidChangeEmitter.fire(this.getBuilds());
        return mapped;
    }

    dispose(): void {
        this.eventsUnsubscribe?.();
        this.statusUnsubscribe?.();
        this.contextUnsubscribe?.dispose();
        this.onDidChangeEmitter.dispose();
        this.onConnectionStateChangeEmitter.dispose();
    }
}
