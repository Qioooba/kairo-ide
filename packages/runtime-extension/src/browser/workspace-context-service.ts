import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { RuntimeConnectionService } from './runtime-connection-service';
import { KairoError } from './runtime-errors';
import type { Workspace } from '@kairo/protocol';

export interface WorkspaceContext {
    workspaceId: string;
    workspaceRoot: string;
}

@injectable()
export class WorkspaceContextService implements FrontendApplicationContribution {
    private currentContext: WorkspaceContext | undefined;
    private readonly onDidChangeContextEmitter = new Emitter<WorkspaceContext | undefined>();
    readonly onDidChangeContext: Event<WorkspaceContext | undefined> = this.onDidChangeContextEmitter.event;
    private toDispose: Disposable | undefined;
    private statusUnsubscribe: (() => void) | undefined;
    /** Track the last known roots so we can re-sync when the runtime connects. */
    private lastRoots: FileStat[] | undefined;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @postConstruct()
    protected init(): void {
        this.toDispose = this.workspaceService.onWorkspaceChanged((roots) => {
            this.lastRoots = roots;
            void this.syncFromRoots(roots);
        });

        // Trigger the initial sync as a fire-and-forget microtask.
        void this.workspaceService.roots.then(roots => {
            this.lastRoots = roots;
            if (roots.length > 0) {
                void this.syncFromRoots(roots);
            }
        });

        // Re-sync when the runtime (re)connects, in case the initial
        // sync failed because the agent was not reachable (N-026).
        this.statusUnsubscribe = this.runtime.onStatusChange(s => {
            if (s === 'open' && this.lastRoots && this.lastRoots.length > 0) {
                void this.syncFromRoots(this.lastRoots);
            }
        });
    }

    onStart(_app: FrontendApplication): void {
        // WorkspaceContextService is initialized via @postConstruct;
        // onStart is a no-op but required by FrontendApplicationContribution.
    }

    onStop(): void {
        this.statusUnsubscribe?.();
    }

    /**
     * Resolve the Kairo workspace for the given Theia roots and
     * fire `onDidChangeContext` if it changed. Async; callers
     * should `void` the returned promise.
     */
    protected async syncFromRoots(roots: FileStat[]): Promise<void> {
        if (roots.length === 0) {
            if (this.currentContext !== undefined) {
                this.currentContext = undefined;
                this.onDidChangeContextEmitter.fire(undefined);
            }
            return;
        }

        const rootStat = roots[0];
        const rootPath = rootStat.resource.path.toString();

        try {
            // Call backend to get/create workspace
            const workspaces = await this.runtime.request('GET /api/v1/workspaces', undefined) as Workspace[];
            const existing = workspaces.find((w: Workspace) => w.rootPath === rootPath);

            if (existing) {
                this.setWorkspace(existing.id, existing.rootPath);
            } else {
                const name = rootPath.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
                const created = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name }) as Workspace;
                this.setWorkspace(created.id, created.rootPath);
            }
        } catch (_err) {
            // If the backend is not available, derive workspaceId from path
            const fallbackId = `local-${btoa(rootPath).replace(/[+/=]/g, '').slice(0, 16)}`;
            this.setWorkspace(fallbackId, rootPath);
        }
    }

    dispose(): void {
        this.toDispose?.dispose();
        this.statusUnsubscribe?.();
        this.onDidChangeContextEmitter.dispose();
    }

    get context(): WorkspaceContext | undefined {
        return this.currentContext;
    }

    async setWorkspace(workspaceId: string, workspaceRoot: string): Promise<void> {
        this.currentContext = { workspaceId, workspaceRoot };
        this.runtime.setWorkspace(workspaceId);
        this.onDidChangeContextEmitter.fire(this.currentContext);
    }

    requireContext(): WorkspaceContext {
        if (!this.currentContext) {
            throw new KairoError({ code: 'invalid_request', message: 'No workspace is open' });
        }
        return this.currentContext;
    }
}
