import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';

export interface ProjectInfo {
    workspaceId: string;
    projectId: string;
    name: string;
    root: string;
}

const LAST_PROJECT_KEY = 'kairo.lastSelectedProjectId';

@injectable()
export class ActiveProjectService {
    private currentProject: ProjectInfo | undefined;
    private readonly onDidChangeProjectEmitter = new Emitter<ProjectInfo | undefined>();
    readonly onDidChangeProject: Event<ProjectInfo | undefined> = this.onDidChangeProjectEmitter.event;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @postConstruct()
    protected init(): void {
        this.workspaceContext.onDidChangeContext(async (ctx) => {
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

                // Check localStorage for last selected project
                const lastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
                const lastProject = lastProjectId
                    ? projects.find((p: ProjectConfig) => p.id === lastProjectId)
                    : undefined;

                // Auto-select last selected or first project
                const selected = lastProject || projects[0];
                const projectInfo: ProjectInfo = {
                    workspaceId: ctx.workspaceId,
                    projectId: selected.id,
                    name: selected.name,
                    root: selected.rootPath,
                };
                this.currentProject = projectInfo;
                this.onDidChangeProjectEmitter.fire(projectInfo);
            } catch {
                // Backend not available, clear project
                this.currentProject = undefined;
                this.onDidChangeProjectEmitter.fire(undefined);
            }
        });
    }

    get project(): ProjectInfo | undefined {
        return this.currentProject;
    }

    async setProject(project: ProjectInfo): Promise<void> {
        this.currentProject = project;
        // Persist selected project ID in localStorage
        localStorage.setItem(LAST_PROJECT_KEY, project.projectId);
        this.onDidChangeProjectEmitter.fire(project);
    }

    async requireProject(): Promise<ProjectInfo> {
        if (!this.currentProject) {
            throw new Error('No project is selected. Please import or select a project first.');
        }
        return this.currentProject;
    }
}