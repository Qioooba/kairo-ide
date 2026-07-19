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
    protected async init(): Promise<void> {
        this.toDispose = this.workspaceService.onWorkspaceChanged(async (roots) => {
            if (roots.length === 0) {
                this.currentContext = undefined;
                this.onDidChangeContextEmitter.fire(undefined);
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
            } catch (err) {
                // If the backend is not available, derive workspaceId from path
                const fallbackId = `local-${btoa(rootPath).replace(/[+/=]/g, '').slice(0, 16)}`;
                this.setWorkspace(fallbackId, rootPath);
            }
        });

        // Initial check
        const roots = await this.workspaceService.roots;
        if (roots.length > 0) {
            const rootStat = roots[0];
            const rootPath = rootStat.resource.path.toString();

            try {
                const workspaces = await this.runtime.request('GET /api/v1/workspaces', undefined) as any[];
                const existing = workspaces.find((w: any) => w.rootPath === rootPath);

                if (existing) {
                    this.setWorkspace(existing.id, existing.rootPath);
                } else {
                    const name = rootPath.split(/[/\\]/).filter(Boolean).pop() || 'workspace';
                    const created = await this.runtime.request('POST /api/v1/workspaces', { rootPath, name }) as any;
                    this.setWorkspace(created.id, created.rootPath);
                }
            } catch {
                const fallbackId = `local-${btoa(rootPath).replace(/[+/=]/g, '').slice(0, 16)}`;
                this.setWorkspace(fallbackId, rootPath);
            }
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