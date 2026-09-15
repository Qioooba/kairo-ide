import { injectable, inject, optional, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { CommandService } from '@theia/core/lib/common/command';
import { WorkspaceContextService, type KairoProjectYaml, type WorkspaceContext } from '@kairo/runtime-extension';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import type { EncodingId, ProjectConfig, ProjectDetection, ProjectImportConfirmRequest } from '@kairo/protocol';

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

    @inject(MessageService)
    @optional()
    protected readonly messageService?: MessageService;

    @inject(CommandService)
    @optional()
    protected readonly commandService?: CommandService;

    @inject(KairoI18nService)
    @optional()
    protected readonly i18n?: KairoI18nService;

    private readonly promptedWorkspaceIds = new Set<string>();

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

                // KAIRO-RC-WEB-029: backend-driven projects win when the
                // agent catalog has entries; otherwise we fall back to
                // on-disk .kairo/project.yaml (see tryAutoBindFromYaml).
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
                        // KAIRO-RC-WEB-029: auto-bind from on-disk
                        // .kairo/project.yaml so opening a legacy folder
                        // does not leave the status bar on
                        // "Project: (no workspace)".
                        const fromYaml = await this.tryAutoBindFromYaml(ctx, myGeneration);
                        if (fromYaml || myGeneration !== this.generation) {
                            return;
                        }
                        const fromDetect = await this.tryAutoDetectAndBind(ctx, myGeneration);
                        if (fromDetect || myGeneration !== this.generation) {
                            return;
                        }
                        this.currentProject = undefined;
                        this.onDidChangeProjectEmitter.fire(undefined);
                        this.promptUnconfiguredFolder(ctx.workspaceId);
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
                    // Backend not available. Prefer on-disk yaml so the
                    // status bar still reflects the opened project.
                    if (myGeneration !== this.generation) return;
                    const fromYaml = await this.tryAutoBindFromYaml(ctx, myGeneration, /*register*/ false);
                    if (fromYaml || myGeneration !== this.generation) return;
                    this.currentProject = undefined;
                    this.onDidChangeProjectEmitter.fire(undefined);
                }
            } finally {
                this.inflightListeners--;
            }
        });
    }

    /**
     * KAIRO-RC-WEB-029: when the agent catalog has no project for this
     * workspace but `.kairo/project.yaml` was detected, register (or
     * locally surface) that project so Build/Run/status-bar work without
     * forcing the user through the import wizard again.
     */
    protected async tryAutoBindFromYaml(
        ctx: WorkspaceContext,
        myGeneration: number,
        register = true,
    ): Promise<boolean> {
        const yaml = this.workspaceContext.detectedProject;
        if (!yaml?.name) {
            return false;
        }
        const projectInfo = this.projectInfoFromYaml(ctx, yaml);
        if (register) {
            try {
                // Prefer an already-registered project with the same root
                // to avoid a noisy 409 Conflict on every cold start.
                const existing = await this.findExistingProject(ctx, yaml, projectInfo.root);
                if (myGeneration !== this.generation) return true;
                if (existing) {
                    const info: ProjectInfo = {
                        workspaceId: ctx.workspaceId,
                        projectId: existing.id,
                        name: existing.name || yaml.name,
                        root: existing.rootPath || projectInfo.root,
                        encoding: yaml.encoding,
                    };
                    this.currentProject = info;
                    await this.storageService.setData(
                        `${LAST_PROJECT_KEY}:${ctx.workspaceId}`,
                        info.projectId,
                    );
                    this.onDidChangeProjectEmitter.fire(info);
                    return true;
                }
                const saved = await this.registerYamlProject(ctx, yaml, projectInfo.root);
                if (myGeneration !== this.generation) return true;
                if (saved) {
                    const info: ProjectInfo = {
                        workspaceId: ctx.workspaceId,
                        projectId: saved.id,
                        name: saved.name || yaml.name,
                        root: saved.rootPath || projectInfo.root,
                        encoding: yaml.encoding,
                    };
                    this.currentProject = info;
                    await this.storageService.setData(
                        `${LAST_PROJECT_KEY}:${ctx.workspaceId}`,
                        info.projectId,
                    );
                    this.onDidChangeProjectEmitter.fire(info);
                    return true;
                }
            } catch {
                // Fall through to local-only bind.
            }
        }
        if (myGeneration !== this.generation) return true;
        this.currentProject = projectInfo;
        this.onDidChangeProjectEmitter.fire(projectInfo);
        return true;
    }

    /**
     * When a folder is directly opened via File -> Open Folder (without
     * .kairo/project.yaml or prior import), scan the workspace root
     * with the backend project scanner. If a Java Web project structure
     * is detected, automatically import and bind it as active project.
     */
    protected async tryAutoDetectAndBind(
        ctx: WorkspaceContext,
        myGeneration: number,
    ): Promise<boolean> {
        try {
            const detected = await this.runtime.request(
                'POST /api/v1/projects/detect',
                { rootPath: ctx.workspaceRoot },
                { timeoutMs: 15_000, noRetry: true },
            ) as ProjectDetection;

            if (myGeneration !== this.generation) return true;
            if (!detected || typeof detected.confidence !== 'number' || detected.confidence < 0.5) {
                return false;
            }

            // Must have some recognizable project structure (webRoot, sourceDirs, or buildScript)
            const hasWeb = Boolean(detected.webRoot);
            const hasSrc = Array.isArray(detected.sourceDirs) && detected.sourceDirs.length > 0;
            const hasBuild = Boolean(detected.buildScript);
            if (!hasWeb && !hasSrc && !hasBuild) {
                return false;
            }

            // Derive a sensible project name from folder name
            const folderName = ctx.workspaceRoot.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || 'project';
            const buildTool = detected.buildSystem === 'ant' ? 'ant'
                : (detected.buildScript === 'build.xml' ? 'ant' : 'javac');

            const params: ProjectImportConfirmRequest = {
                workspaceId: ctx.workspaceId,
                rootPath: ctx.workspaceRoot,
                name: folderName,
                sourceDirs: detected.sourceDirs?.length ? detected.sourceDirs : ['src'],
                webRoot: detected.webRoot || 'WebRoot',
                libDirs: detected.libDirs?.length ? detected.libDirs : ['lib'],
                buildScript: detected.buildScript || 'build.xml',
                defaultEncoding: detected.defaultEncoding || 'gbk',
                jdkVersion: detected.jdkVersion || '1.6',
                sourceVersion: detected.sourceVersion || '1.6',
                targetVersion: detected.targetVersion || '1.6',
                outputDir: detected.outputDir || 'build/classes',
                buildTool,
                contextPath: '/',
            };

            let saved: { id: string; name: string; rootPath: string } | undefined;
            try {
                saved = await this.runtime.request(
                    'POST /api/v1/projects/import',
                    params,
                    { timeoutMs: 15_000, noRetry: true },
                ) as { id: string; name: string; rootPath: string };
            } catch (err) {
                // If 409 conflict, find existing project
                const msg = err instanceof Error ? err.message : String(err);
                if (/409|already exists|conflict/i.test(msg)) {
                    const existing = await this.findExistingProject(ctx, { name: folderName }, ctx.workspaceRoot);
                    if (existing) {
                        saved = existing;
                    }
                } else {
                    return false;
                }
            }

            if (myGeneration !== this.generation || !saved) return true;

            const info: ProjectInfo = {
                workspaceId: ctx.workspaceId,
                projectId: saved.id,
                name: saved.name || folderName,
                root: saved.rootPath || ctx.workspaceRoot,
                encoding: params.defaultEncoding,
            };

            this.currentProject = info;
            await this.storageService.setData(
                `${LAST_PROJECT_KEY}:${ctx.workspaceId}`,
                info.projectId,
            );
            this.onDidChangeProjectEmitter.fire(info);

            // Show friendly notification with action to open import wizard
            const msg = this.i18n
                ? this.i18n.t('widget.servers.autoDetectedAndBound', { name: info.name })
                : `已自动识别并关联 Java Web 项目「${info.name}」，已为您生成默认 Tomcat 运行配置。`;
            const actionLabel = this.i18n
                ? this.i18n.t('widget.servers.openImportWizard')
                : '项目配置向导';

            if (this.messageService) {
                void this.messageService.info(msg, actionLabel).then(action => {
                    if (action === actionLabel && this.commandService) {
                        void this.commandService.executeCommand('kairo.project.import');
                    }
                });
            }

            return true;
        } catch {
            return false;
        }
    }

    protected promptUnconfiguredFolder(workspaceId: string): void {
        if (this.promptedWorkspaceIds.has(workspaceId)) return;
        this.promptedWorkspaceIds.add(workspaceId);

        const msg = this.i18n
            ? this.i18n.t('widget.servers.unconfiguredFolderPrompt')
            : '当前工作区尚未配置为 Kairo 项目。如需运行或调试，可通过项目向导进行配置。';
        const actionLabel = this.i18n
            ? this.i18n.t('widget.servers.importProject')
            : '导入项目';

        if (this.messageService) {
            void this.messageService.info(msg, actionLabel).then(action => {
                if (action === actionLabel && this.commandService) {
                    void this.commandService.executeCommand('kairo.project.import');
                }
            });
        }
    }

    protected async findExistingProject(
        ctx: WorkspaceContext,
        yaml: KairoProjectYaml,
        rootPath: string,
    ): Promise<{ id: string; name: string; rootPath: string } | undefined> {
        const pick = (projects: ProjectConfig[]) => {
            const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
            const want = norm(rootPath);
            return projects.find(p => {
                const root = (p as unknown as { rootPath?: string }).rootPath || '';
                return p.name === yaml.name
                    || norm(root) === want
                    || p.id === this.projectInfoFromYaml(ctx, yaml).projectId;
            });
        };
        try {
            let projects = await this.runtime.request(
                'GET /api/v1/projects',
                undefined,
                { query: { workspaceId: ctx.workspaceId } },
            ) as ProjectConfig[];
            let hit = pick(projects);
            if (!hit) {
                projects = await this.runtime.request('GET /api/v1/projects', undefined) as ProjectConfig[];
                hit = pick(projects);
            }
            if (!hit) return undefined;
            return {
                id: hit.id,
                name: hit.name,
                rootPath: (hit as unknown as { rootPath?: string }).rootPath || rootPath,
            };
        } catch {
            return undefined;
        }
    }

    protected projectInfoFromYaml(ctx: WorkspaceContext, yaml: KairoProjectYaml): ProjectInfo {
        // BUG-20260826-301: prefer the folder that actually owns the
        // detected .kairo/project.yaml (the project may live in a
        // subfolder of the workspace, e.g. workspace/legacy-sample).
        const detectedRoot = this.workspaceContext.detectedProjectRoot;
        const base = detectedRoot ?? ctx.workspaceRoot;
        const root = !yaml.root || yaml.root === '.'
            ? base
            : `${base.replace(/[/\\]+$/, '')}/${yaml.root}`.replace(/\\/g, '/');
        const projectId = (yaml.name || 'project')
            .toLowerCase()
            .replace(/[^a-z0-9_.-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'project';
        return {
            workspaceId: ctx.workspaceId,
            projectId,
            name: yaml.name || projectId,
            root,
            encoding: yaml.encoding,
        };
    }

    protected async registerYamlProject(
        ctx: WorkspaceContext,
        yaml: KairoProjectYaml,
        rootPath: string,
    ): Promise<{ id: string; name: string; rootPath: string } | undefined> {
        const level = (yaml.sourceLevel || '1.6') as ProjectImportConfirmRequest['sourceVersion'];
        const target = (yaml.targetLevel || level) as ProjectImportConfirmRequest['targetVersion'];
        const encoding = (yaml.encoding || 'gbk') as EncodingId;
        const buildTool: ProjectImportConfirmRequest['buildTool'] =
            yaml.buildTool === 'javac' ? 'javac' : 'ant';
        const params: ProjectImportConfirmRequest = {
            workspaceId: ctx.workspaceId,
            rootPath,
            name: yaml.name || 'project',
            sourceDirs: yaml.sourceRoots?.length ? yaml.sourceRoots : ['src'],
            webRoot: yaml.webappDir || 'WebRoot',
            libDirs: yaml.libraryDirs?.length ? yaml.libraryDirs : ['lib'],
            buildScript: yaml.buildFile || 'build.xml',
            defaultEncoding: encoding,
            jdkVersion: level,
            sourceVersion: level,
            targetVersion: target,
            outputDir: yaml.outputDir || 'build/classes',
            buildTool,
            contextPath: yaml.contextPath || '/',
        };
        try {
            const saved = await this.runtime.request(
                'POST /api/v1/projects/import',
                params,
                { timeoutMs: 15_000, noRetry: true },
            ) as { id: string; name: string; rootPath: string };
            return saved;
        } catch (err) {
            // Already imported (409) — re-list and pick by name/root.
            // Prefer workspace-scoped list; fall back to global catalog
            // when the project was registered under a prior workspace id.
            const msg = err instanceof Error ? err.message : String(err);
            const code = (err as { code?: string })?.code || '';
            if (!/409|already exists|conflict/i.test(`${msg} ${code}`)) {
                throw err;
            }
            const pick = (projects: ProjectConfig[]) => projects.find(p => {
                const root = (p as unknown as { rootPath?: string }).rootPath || '';
                const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
                return p.name === yaml.name
                    || norm(root) === norm(rootPath)
                    || p.id === this.projectInfoFromYaml(ctx, yaml).projectId;
            });
            let projects = await this.runtime.request(
                'GET /api/v1/projects',
                undefined,
                { query: { workspaceId: ctx.workspaceId } },
            ) as ProjectConfig[];
            let hit = pick(projects);
            if (!hit) {
                projects = await this.runtime.request('GET /api/v1/projects', undefined) as ProjectConfig[];
                hit = pick(projects);
            }
            if (!hit) return undefined;
            return {
                id: hit.id,
                name: hit.name,
                rootPath: (hit as unknown as { rootPath?: string }).rootPath || rootPath,
            };
        }
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