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
    private eventsUnsubscribe?: () => void;

    @postConstruct()
    protected async init(): Promise<void> {
        // Load initial snapshot
        const ctx = this.workspaceContext.context;
        if (ctx) {
            try {
                const builds = await this.runtime.request('GET /api/v1/builds', undefined) as BuildResult[];
                if (Array.isArray(builds)) {
                    this.builds = builds.map(b => ({
                        id: b.id,
                        workspaceId: ctx.workspaceId,
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
                    }));
                    this.onDidChangeEmitter.fire(this.getBuilds());
                }
            } catch {
                // Agent not reachable yet — store stays empty, UI shows "no builds".
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
                        endTime: (state === 'success' || state === 'failure') ? new Date().toISOString() : undefined,
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

    dispose(): void {
        this.eventsUnsubscribe?.();
        this.onDidChangeEmitter.dispose();
    }
}