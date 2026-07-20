import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { RuntimeConnectionService } from './runtime-connection-service';
import { KairoError } from './runtime-errors';

export interface WorkspaceContext {
    workspaceId: string;
    workspaceRoot: string;
}

@injectable()
export class WorkspaceContextService {
    private currentContext: WorkspaceContext | undefined;
    private readonly onDidChangeContextEmitter = new Emitter<WorkspaceContext | undefined>();
    readonly onDidChangeContext: Event<WorkspaceContext | undefined> = this.onDidChangeContextEmitter.event;
    private toDispose: Disposable | undefined;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @postConstruct()
    protected init(): void {
        // The postConstruct must remain synchronous: every
        // Kairo FrontendApplicationContribution / CommandContribution
        // transitively injects this service (via BuildStore,
        // KairoServerService, KairoProjectService, ActiveProjectService,
        // LogViewerWidget, …). An async @postConstruct makes the
        // entire binding chain async, and the synchronous
        // `getAll(FrontendApplicationContribution)` /
        // `getAll(CommandContribution)` calls in the Theia
        // ApplicationShell / CommandRegistry onStart paths
        // throw `LazyInSync` for the contribution symbol.
        //
        // The previous version of this method was `async` and
        // `await`ed `workspaceService.roots` here. We now fire the
        // initial-check as a microtask after construction so the
        // postConstruct returns void. The behavior is unchanged:
        // the listener below also fires for any subsequent
        // workspace changes, so the first `roots` event covers the
        // initial state regardless of which path populates it.
        this.toDispose = this.workspaceService.onWorkspaceChanged((roots) => {
            void this.syncFromRoots(roots);
        });

        // Trigger the initial sync as a fire-and-forget microtask.
        // `workspaceService.roots` is a Promise<Stat[]>, so we
        // chain off it instead of awaiting inside init().
        void this.workspaceService.roots.then(roots => {
            if (roots.length > 0) {
                void this.syncFromRoots(roots);
            }
        });
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
            const workspaces = await this.runtime.request('GET /api/v1/workspaces', undefined) as any[];
            const existing = workspaces.find((w: any) => w.rootPath === rootPath);

            if (existing) {
                this.setWorkspace(existing.id, existing.rootPath);
            } else {
                const name = rootPath.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
                const created = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name }) as any;
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
