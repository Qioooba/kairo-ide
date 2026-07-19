import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import { ActiveProjectService } from '@kairo/project-extension';

/**
 * Java Language Server lifecycle manager.
 *
 * Listens for project changes and manages the JDT LS
 * lifecycle through the Go Runtime Agent. When a project
 * is selected or changed, this service:
 *   1. Ensures JDT LS is prepared (POST /java/prepare)
 *   2. Fetches the launch descriptor from the agent
 *   3. Triggers the backend JavaLanguageServerManager to
 *      spawn the JDT LS process with the descriptor
 *
 * The actual process spawning is delegated to the backend
 * JavaLanguageServerManager, which uses child_process.spawn
 * and provides StreamMessageReader/StreamMessageWriter for
 * LSP communication.
 */
@injectable()
export class JavaLanguageServerLifecycle {
    @inject(RuntimeConnectionService)
    private readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    private readonly workspaceContext!: WorkspaceContextService;

    @inject(ActiveProjectService)
    private readonly activeProject!: ActiveProjectService;

    @inject(ILogger)
    private readonly logger!: ILogger;

    private launchDescriptor: unknown | undefined;
    private toDispose: Disposable[] = [];

    @postConstruct()
    protected async init(): Promise<void> {
        this.logger.info('JavaLanguageServerLifecycle initialized');

        // Listen for project changes
        this.toDispose.push(this.activeProject.onDidChangeProject(async (project) => {
            if (!project) {
                this.logger.info('No project selected, skipping JDT LS launch');
                return;
            }

            await this.onProjectChanged(project);
        }));

        // Also listen for workspace context changes
        this.toDispose.push(this.workspaceContext.onDidChangeContext(async (ctx) => {
            if (!ctx) {
                this.logger.info('No workspace context, skipping JDT LS launch');
                return;
            }

            const project = this.activeProject.project;
            if (project) {
                await this.onProjectChanged(project);
            }
        }));
    }

    dispose(): void {
        for (const d of this.toDispose) {
            d.dispose();
        }
        this.toDispose = [];
    }

    /**
     * Handle a project change: prepare JDT LS and fetch the
     * launch descriptor from the Go Runtime Agent.
     */
    private async onProjectChanged(project: { workspaceId: string; projectId: string }): Promise<void> {
        try {
            const ctx = this.workspaceContext.requireContext();

            this.logger.info(`Project changed: ${project.projectId}, ensuring JDT LS is prepared`);

            // First, ensure JDT LS is prepared on the agent side
            await this.runtime.request(
                `POST /api/v1/workspaces/${ctx.workspaceId}/java/prepare`,
                { projectId: project.projectId },
            );

            // Then get the launch descriptor
            this.launchDescriptor = await this.runtime.request(
                `GET /api/v1/workspaces/${ctx.workspaceId}/java/launch-descriptor`,
                undefined,
                { query: { projectId: project.projectId } },
            );

            this.logger.info(`Launch descriptor received for project ${project.projectId}`);
        } catch (err) {
            this.logger.error(`Failed to prepare JDT LS for project ${project.projectId}: ${String(err)}`);
        }
    }

    /**
     * Returns the current launch descriptor, if any.
     */
    getLaunchDescriptor(): unknown | undefined {
        return this.launchDescriptor;
    }
}