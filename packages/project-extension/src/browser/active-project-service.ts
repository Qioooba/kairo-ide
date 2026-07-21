import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';

export interface ProjectInfo {
    workspaceId: string;
    projectId: string;
    name: string;
    root: string;
    /** Project default encoding (e.g. 'gbk'); applied as a
     * folder-level override so files under the project root open
     * with the right encoding (KAIRO-RC-WEB-206). */
    encoding?: string;
}

const LAST_PROJECT_KEY = 'kairo.lastSelectedProjectId';

@injectable()
export class ActiveProjectService {
    private currentProject: ProjectInfo | undefined;
    private readonly onDidChangeProjectEmitter = new Emitter<ProjectInfo | undefined>();
    readonly onDidChangeProject: Event<ProjectInfo | undefined> = this.onDidChangeProjectEmitter.event;
    private toDispose: Disposable | undefined;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(StorageService)
    protected readonly storageService!: StorageService;

    @postConstruct()
    protected init(): void {
        this.toDispose = this.workspaceContext.onDidChangeContext(async (ctx) => {
            if (!ctx) {
                this.currentProject = undefined;
                this.onDidChangeProjectEmitter.fire(undefined);
                return;
            }

            try {
                // Load projects for this workspace
                const projects = await this.runtime.request('GET /api/v1/projects', undefined) as ProjectConfig[];

                if (projects.length === 0) {
                    this.currentProject = undefined;
                    this.onDidChangeProjectEmitter.fire(undefined);
                    return;
                }

                // Check StorageService for last selected project (per workspace)
                const lastProjectId = await this.storageService.getData<string | undefined>(
                    `${LAST_PROJECT_KEY}:${ctx.workspaceId}`,
                    undefined
                );
                const lastProject = lastProjectId
                    ? projects.find((p: ProjectConfig) => p.id === lastProjectId)
                    : undefined;

                if (projects.length === 1) {
                    // Auto-select the only project
                    const p = projects[0];
                    const projectInfo: ProjectInfo = {
                        workspaceId: ctx.workspaceId,
                        projectId: p.id,
                        name: p.name,
                        root: p.rootPath,
                        encoding: (p as unknown as { encoding?: string }).encoding,
                    };
                    this.currentProject = projectInfo;
                    this.onDidChangeProjectEmitter.fire(projectInfo);
                } else if (lastProject) {
                    // Restore last selected project
                    const projectInfo: ProjectInfo = {
                        workspaceId: ctx.workspaceId,
                        projectId: lastProject.id,
                        name: lastProject.name,
                        root: lastProject.rootPath,
                        encoding: (lastProject as unknown as { encoding?: string }).encoding,
                    };
                    this.currentProject = projectInfo;
                    this.onDidChangeProjectEmitter.fire(projectInfo);
                } else {
                    // Multiple projects, none previously selected — UI will show QuickPick
                    this.currentProject = undefined;
                    this.onDidChangeProjectEmitter.fire(undefined);
                }
            } catch {
                // Backend not available, clear project
                this.currentProject = undefined;
                this.onDidChangeProjectEmitter.fire(undefined);
            }
        });
    }

    dispose(): void {
        this.toDispose?.dispose();
        this.onDidChangeProjectEmitter.dispose();
    }

    get project(): ProjectInfo | undefined {
        return this.currentProject;
    }

    async setProject(project: ProjectInfo): Promise<void> {
        this.currentProject = project;
        // Persist selected project ID in Theia StorageService, keyed by workspace
        await this.storageService.setData(
            `${LAST_PROJECT_KEY}:${project.workspaceId}`,
            project.projectId
        );
        this.onDidChangeProjectEmitter.fire(project);
    }

    async requireProject(): Promise<ProjectInfo> {
        if (!this.currentProject) {
            throw new Error('No project selected');
        }
        return this.currentProject;
    }
}