import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import { ActiveProjectService } from '@kairo/project-extension';
import type { Endpoint, JdtLaunchDescriptor } from '@kairo/protocol';

/**
 * Java Language Server lifecycle manager.
 *
 * Listens for project changes and manages the JDT LS
 * lifecycle through the Go Runtime Agent. When a project
 * is selected or changed, this service:
 *   1. Ensures JDT LS is prepared (POST /api/v1/jdtls)
 *   2. Ensures the JDT project model is generated
 *      (POST /api/v1/jdtls/project)
 *   3. Fetches the launch descriptor from the agent
 *      (GET /api/v1/workspaces/{ws}/java/launch-descriptor)
 *
 * The actual process spawning is delegated to the backend
 * KairoJavaLanguageServerContribution, which uses child_process.spawn
 * and provides StreamMessageReader/StreamMessageWriter for
 * LSP communication.
 *
 * The Go Agent does NOT send the LSP `initialize` request.
 * That handshake is the LanguageClient's responsibility.
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

    private launchDescriptor: JdtLaunchDescriptor | undefined;
    private toDispose: Disposable[] = [];

    /** Crash circuit breaker: max restarts in time window. */
    private crashTimestamps: number[] = [];
    private readonly maxCrashes = 5;
    private readonly crashWindowMs = 60000;

    @postConstruct()
    protected async init(): Promise<void> {
        this.logger.info('[KairoJava] Language server lifecycle initialized');

        // Listen for project changes
        this.toDispose.push(this.activeProject.onDidChangeProject(async (project) => {
            if (!project) {
                this.logger.info('[KairoJava] No project selected, skipping JDT LS launch');
                return;
            }
            await this.onProjectChanged(project);
        }));

        // Also listen for workspace context changes
        this.toDispose.push(this.workspaceContext.onDidChangeContext(async (ctx) => {
            if (!ctx) {
                this.logger.info('[KairoJava] No workspace context, skipping JDT LS launch');
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

            this.logger.info(`[KairoJava] Project changed: ${project.projectId}, ensuring JDT LS is prepared`);

            // 1. Ensure JDT LS distribution is installed.
            await this.runtime.request(
                'POST /api/v1/jdtls' as Endpoint,
                undefined,
            );

            // 2. Generate the JDT project model (.project / .classpath).
            await this.runtime.request(
                'POST /api/v1/jdtls/project' as Endpoint,
                {
                    workspaceId: ctx.workspaceId,
                    rootPath: ctx.workspaceRoot,
                    projectId: project.projectId,
                },
            );

            // 3. Get the launch descriptor.
            this.launchDescriptor = await this.runtime.request(
                `GET /api/v1/workspaces/${ctx.workspaceId}/java/launch-descriptor` as Endpoint,
                undefined,
                { query: { projectId: project.projectId } },
            ) as JdtLaunchDescriptor;

            this.logger.info(`[KairoJava] Launch descriptor received for project ${project.projectId}`);
        } catch (err) {
            this.logger.error(`[KairoJava] Failed to prepare JDT LS for project ${project.projectId}: ${String(err)}`);
            this.recordCrash();
        }
    }

    /**
     * Returns the current launch descriptor, if any.
     */
    getLaunchDescriptor(): JdtLaunchDescriptor | undefined {
        return this.launchDescriptor;
    }

    /**
     * Returns true if the crash circuit breaker is tripped.
     * The UI should show an actionable error and not attempt
     * further restarts until the workspace is reopened.
     */
    isCrashBreakerTripped(): boolean {
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < this.crashWindowMs);
        return this.crashTimestamps.length >= this.maxCrashes;
    }

    /**
     * Record a crash event for the circuit breaker.
     * If the breaker is tripped, an actionable error is logged.
     */
    private recordCrash(): void {
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < this.crashWindowMs);
        this.crashTimestamps.push(now);

        if (this.crashTimestamps.length >= this.maxCrashes) {
            this.logger.error(
                `[KairoJava] Crash circuit breaker tripped: ${this.crashTimestamps.length} failures ` +
                `in ${this.crashWindowMs / 1000}s. Please check the JDT LS installation and ` +
                `restart the workspace.`
            );
        }
    }
}