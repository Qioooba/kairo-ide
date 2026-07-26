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
    /** Per-directory encoding overrides. Keys are relative directory
     * paths (e.g. "src/"), values are encoding names (e.g. "GBK"). */
    directoryEncodingOverrides?: Record<string, string>;
}

const LAST_PROJECT_KEY = 'kairo.lastSelectedProjectId';

@injectable()
export class ActiveProjectService {
    private currentProject: ProjectInfo | undefined;
    private readonly onDidChangeProjectEmitter = new Emitter<ProjectInfo | undefined>();
    readonly onDidChangeProject: Event<ProjectInfo | undefined> = this.onDidChangeProjectEmitter.event;
    private toDispose: Disposable | undefined;
    /**
     * KAIRO-RC-WEB-2026-07-25-12: a generation counter incremented on every
     * setProject() call so an in-flight async listener from the @postConstruct
     * hook (page load, prior workspace) cannot clobber a project the wizard
     * just selected. The init handler captures the generation at entry and
     * bails if the generation advanced before its await resolved.
     */
    private generation = 0;
    private inflightListeners = 0;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(StorageService)
    protected readonly storageService!: StorageService;

    @postConstruct()
    protected init(): void {
        this.toDispose = this.workspaceContext.onDidChangeContext(async (ctx) => {
            const myGeneration = this.generation;
            this.inflightListeners++;
            try {
                if (!ctx) {
                    if (myGeneration !== this.generation) return;
                    this.currentProject = undefined;
                    this.onDidChangeProjectEmitter.fire(undefined);
                    return;
                }

                // KAIRO-RC-WEB-029: if .kairo/project.yaml was just read
                // and we have not yet selected a project for this
                // workspace, surface the detected values to the UI so
                // the user does not have to re-run the import wizard
                // every time the workspace loads. Backend-driven
                // projects always win when the agent is reachable.
                const _yaml = this.workspaceContext.detectedProject;
                try {
                    // KAIRO-RC-WEB-2026-07-25-12: filter projects by the
                    // current workspace — without the workspaceId the
                    // agent returns the global catalog which does not
                    // include the just-imported project (stored under
                    // the new workspace), so the handler would clear
                    // the active project even though the import
                    // succeeded.
                    const projects = await this.runtime.request(
                        'GET /api/v1/projects',
                        undefined,
                        { query: { workspaceId: ctx.workspaceId } },
                    ) as ProjectConfig[];
                    // KAIRO-RC-WEB-2026-07-25-12: if the user has just
                    // selected a project (generation advanced) while we
                    // were awaiting the projects list, do not clobber
                    // the user's choice.
                    if (myGeneration !== this.generation) return;

                    if (projects.length === 0) {
                        // Only clear if no project was just selected
                        // and no project is already active.
                        if (this.currentProject && this.currentProject.workspaceId === ctx.workspaceId) {
                            return;
                        }
                        this.currentProject = undefined;
                        this.onDidChangeProjectEmitter.fire(undefined);
                        return;
                    }

                    // Check StorageService for last selected project (per workspace)
                    const lastProjectId = await this.storageService.getData<string | undefined>(
                        `${LAST_PROJECT_KEY}:${ctx.workspaceId}`,
                        undefined
                    );
                    if (myGeneration !== this.generation) return;
                    const lastProject = lastProjectId
                        ? projects.find((p: ProjectConfig) => p.id === lastProjectId)
                        : undefined;

                    // If the active project already matches one of the
                    // discovered projects for this workspace, do not
                    // fire again — that would re-trigger JDT LS prepare
                    // and any other "project changed" listeners.
                    if (this.currentProject
                        && this.currentProject.workspaceId === ctx.workspaceId
                        && projects.some(p => p.id === this.currentProject!.projectId)) {
                        return;
                    }

                    if (projects.length === 1) {
                        // Auto-select the only project
                        const p = projects[0];
                        const raw = p as unknown as {
                            encoding?: string;
                            directoryEncodingOverrides?: Record<string, string>;
                        };
                        const projectInfo: ProjectInfo = {
                            workspaceId: ctx.workspaceId,
                            projectId: p.id,
                            name: p.name,
                            root: p.rootPath,
                            encoding: raw.encoding,
                            directoryEncodingOverrides: raw.directoryEncodingOverrides,
                        };
                        this.currentProject = projectInfo;
                        this.onDidChangeProjectEmitter.fire(projectInfo);
                    } else if (lastProject) {
                        // Restore last selected project
                        const raw = lastProject as unknown as {
                            encoding?: string;
                            directoryEncodingOverrides?: Record<string, string>;
                        };
                        const projectInfo: ProjectInfo = {
                            workspaceId: ctx.workspaceId,
                            projectId: lastProject.id,
                            name: lastProject.name,
                            root: lastProject.rootPath,
                            encoding: raw.encoding,
                            directoryEncodingOverrides: raw.directoryEncodingOverrides,
                        };
                        this.currentProject = projectInfo;
                        this.onDidChangeProjectEmitter.fire(projectInfo);
                    } else if (!this.currentProject || this.currentProject.workspaceId !== ctx.workspaceId) {
                        // Multiple projects, none previously selected — UI will show QuickPick.
                        // Only clear if no project is already active for this workspace.
                        this.currentProject = undefined;
                        this.onDidChangeProjectEmitter.fire(undefined);
                    }
                } catch {
                    // Backend not available. Only clear if no project was
                    // just selected.
                    if (myGeneration !== this.generation) return;
                    this.currentProject = undefined;
                    this.onDidChangeProjectEmitter.fire(undefined);
                }
            } finally {
                this.inflightListeners--;
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
        // KAIRO-RC-WEB-2026-07-25-12: bump the generation so any in-flight
        // @postConstruct listener (which has captured an older generation)
        // knows to bail out instead of clobbering the user's selection.
        this.generation++;
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