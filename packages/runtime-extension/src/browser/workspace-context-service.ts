import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
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
        this.toDispose = this.workspaceService.onWorkspaceChanged(roots => {
            if (roots.length === 0) {
                this.currentContext = undefined;
                this.onDidChangeContextEmitter.fire(undefined);
                return;
            }
            void this.resolveWorkspace(roots[0].resource.path.toString());
        });

        // Initial check - async, do not await in postConstruct
        void this.workspaceService.roots.then(roots => {
            if (roots.length > 0) {
                void this.resolveWorkspace(roots[0].resource.path.toString());
            }
        });
    }

    protected async resolveWorkspace(rootPath: string): Promise<void> {
        try {
            // Call backend to get/create workspace
            const workspaces = await this.runtime.request('GET /api/v1/workspaces', undefined) as any[];
            const existing = workspaces.find((w: any) => w.root === rootPath);

            if (existing) {
                this.setWorkspace(existing.id, existing.root);
            } else {
                const name = rootPath.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
                const created = await this.runtime.request('POST /api/v1/workspaces', { name, rootPath: rootPath }) as any;
                this.setWorkspace(created.id, created.root);
            }
        } catch (_err) {
            // If the backend is not available, derive workspaceId from path
            // Must match backend format: ws_ prefix + 26 chars base32 (a-z, 2-7)
            const encoded = btoa(rootPath).toLowerCase().replace(/[^a-z2-7]/g, '');
            const padded = (encoded + 'a'.repeat(26)).slice(0, 26);
            const fallbackId = `ws_${padded}`;
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
