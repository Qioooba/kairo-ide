import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import { ActiveProjectService } from '@kairo/project-extension';
import type { Endpoint } from '@kairo/protocol';
import { JavaLanguageClient } from './java-language-client';
import type { JdtLsState } from '../node/jdt-ls-manager';

export const JDT_LS_MAX_AUTO_RESTARTS = 3;
export const JDT_LS_RESTART_BASE_DELAY_MS = 1_000;
export const JDT_LS_RESTART_MAX_DELAY_MS = 10_000;

/**
 * Launch descriptor returned by the Go Runtime Agent
 * (GET /api/v1/workspaces/{ws}/java/launch-descriptor).
 * Mirrors runtime-agent/internal/jdtls LaunchDescriptor:
 *   { command, args, workingDir, envAllowlist }
 * The agent puts the Eclipse workspace data dir both in
 * `args` (after `-data`) and in `envAllowlist` as
 * `JDTLS_WORKSPACE=<dir>`.
 */
export interface JdtLsLaunchDescriptor {
    command: string;
    args: string[];
    workingDir: string;
    envAllowlist: string[];
}

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

    @inject(JavaLanguageClient)
    private readonly javaClient!: JavaLanguageClient;

    private launchDescriptor: JdtLsLaunchDescriptor | undefined;
    private lastStartKey: string | undefined;
    private toDispose: Disposable[] = [];
    private desiredProject: { workspaceId: string; projectId: string } | undefined;
    private activationToken = 0;
    private restartAttempts = 0;
    private restartTimer: ReturnType<typeof setTimeout> | undefined;
    private restartInFlight = false;
    private disposed = false;
    /** Serializes stop/start transitions after async descriptor
     *  preparation, preventing two project changes from interleaving
     *  as stop(A) -> stop(B) -> start(A) -> start(B). */
    private transitionChain: Promise<void> = Promise.resolve();
    /** Duplicate "no project/no context" events can arrive back-to-back
     *  on a cold start. Share one bounded backend stop instead of opening
     *  two '/services/jdt-ls-backend' channels concurrently. */
    private deactivateChain: Promise<void> | undefined;

    @postConstruct()
    protected init(): void {
        // The postConstruct must remain synchronous: this service
        // is bound to FrontendApplicationContribution via
        // bindJavaLanguageClientContribution. An async @postConstruct
        // would make the entire binding chain async, and Theia's
        // synchronous getAll(FrontendApplicationContribution) would
        // throw `LazyInSync` for the contribution symbol.
        //
        // The previous version was `async` and `await`ed nothing
        // (only `onDidChangeProject(... async ...)` listener
        // registrations and `onDidChangeContext(... async ...)` —
        // listener bodies being async is independent of the listener
        // registration itself, which is always synchronous). We
        // therefore drop the `async` keyword.
        this.logger.info('JavaLanguageServerLifecycle initialized');

        // Listen for project changes
        this.toDispose.push(this.activeProject.onDidChangeProject(project => {
            if (!project) {
                this.logger.info('No project selected, stopping JDT LS');
                void this.deactivate();
                return;
            }
            this.activate(project);
        }));

        // Also listen for workspace context changes
        this.toDispose.push(this.workspaceContext.onDidChangeContext(ctx => {
            if (!ctx) {
                this.logger.info('No workspace context, stopping JDT LS');
                void this.deactivate();
                return;
            }
            const project = this.activeProject.project;
            if (project) {
                this.activate(project);
            }
        }));

        this.toDispose.push(this.javaClient.onState(state => this.onClientState(state)));
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.activationToken += 1;
        this.desiredProject = undefined;
        this.launchDescriptor = undefined;
        this.lastStartKey = undefined;
        this.clearRestartTimer();
        for (const d of this.toDispose) {
            d.dispose();
        }
        this.toDispose = [];
        // FrontendApplicationContribution.dispose cannot await. The
        // backend stop operation is bounded by JdtLsManager and is
        // still issued so closing a workspace releases the process
        // and its Eclipse workspace-data lock.
        // Do not queue shutdown behind a potentially hung initialize;
        // backend stop is shared/bounded and interrupts it directly.
        void this.javaClient.stop().catch(err => {
            this.logger.error(`Failed to stop JDT LS during lifecycle disposal: ${String(err)}`);
        });
    }

    private activate(project: { workspaceId: string; projectId: string }): void {
        if (this.disposed) return;
        const changed = !this.desiredProject
            || this.desiredProject.workspaceId !== project.workspaceId
            || this.desiredProject.projectId !== project.projectId;
        this.desiredProject = { ...project };
        if (changed) {
            this.restartAttempts = 0;
        }
        this.clearRestartTimer();
        const token = ++this.activationToken;
        void this.onProjectChanged(project, token);
    }

    private deactivate(): Promise<void> {
        this.activationToken += 1;
        this.desiredProject = undefined;
        this.launchDescriptor = undefined;
        this.lastStartKey = undefined;
        this.restartAttempts = 0;
        this.clearRestartTimer();
        if (!this.deactivateChain) {
            this.deactivateChain = (async () => {
                try {
                    // Closing a workspace must interrupt an initialize that
                    // is currently occupying the serialized transition chain.
                    await this.javaClient.stop();
                } catch (err) {
                    this.logger.error(`Failed to stop JDT LS after workspace/project close: ${String(err)}`);
                } finally {
                    this.deactivateChain = undefined;
                }
            })();
        }
        return this.deactivateChain;
    }

    /**
     * Handle a project change: prepare JDT LS and fetch the
     * launch descriptor from the Go Runtime Agent.
     *
     * After import, there are race conditions:
     * 1. The project may not yet be associated with the workspace (404/not found).
     * 2. The workspaceId in the event may differ from the actual workspace
     *    that owns the project ("belongs to workspace ws_xxx" error).
     * We retry up to 12 times with 2s delays (~26s total window) and
     * extract the correct workspace ID from error messages.
     */
    private async onProjectChanged(project: { workspaceId: string; projectId: string }, token: number): Promise<void> {
        const MAX_RETRIES = 12;
        const RETRY_DELAY_MS = 2000;
        let lastError: unknown;
        let forcedWorkspaceId: string | null = project.workspaceId || null;

        // KAIRO-RC-DESKTOP-2026-07-29: skip JDT LS prepare entirely if
        // KAIRO_SKIP_JDTLS is set. This lets the desktop app render
        // normally even when the JDT LS archive is not bundled.
        if (typeof process !== 'undefined' && process.env?.['KAIRO_SKIP_JDTLS'] === '1') {
            this.logger.info(`JDT LS skipped (KAIRO_SKIP_JDTLS=1) for project ${project.projectId}`);
            return;
        }

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (!this.isCurrentActivation(project, token)) return;
            if (this.restartTimer) {
                clearTimeout(this.restartTimer);
                this.restartTimer = undefined;
            }
            try {
                if (attempt === 0) {
                    await delay(this.initialDelayMs());
                } else {
                    this.logger.info(`JDT LS prepare retry ${attempt}/${MAX_RETRIES} for project ${project.projectId}${forcedWorkspaceId ? ` (ws=${forcedWorkspaceId})` : ''}`);
                    await delay(RETRY_DELAY_MS);
                }
                if (!this.isCurrentActivation(project, token)) return;

                const ctx = this.workspaceContext.requireContext();
                const workspaceId = forcedWorkspaceId || project.workspaceId || ctx.workspaceId;

                this.logger.info(`Project changed: ${project.projectId}, ensuring JDT LS is prepared (workspace=${workspaceId})`);

                await this.runtime.request(
                    `POST /api/v1/workspaces/${workspaceId}/java/prepare` as Endpoint,
                    { projectId: project.projectId },
                );
                if (!this.isCurrentActivation(project, token)) return;

                const descriptor = await this.runtime.request(
                    `GET /api/v1/workspaces/${workspaceId}/java/launch-descriptor` as Endpoint,
                    undefined,
                    { query: { projectId: project.projectId } },
                ) as JdtLsLaunchDescriptor;
                if (!this.isCurrentActivation(project, token)) return;
                this.launchDescriptor = descriptor;

                this.logger.info(`Launch descriptor received for project ${project.projectId}`);

                await this.startLanguageClient(descriptor, project.projectId, token);
                return;
            } catch (err) {
                lastError = err;
                const errMsg = String(err);
                const belongsMatch = /belongs to workspace (ws_[a-z0-9]+)/.exec(errMsg);
                if (belongsMatch && belongsMatch[1]) {
                    forcedWorkspaceId = belongsMatch[1];
                    this.logger.info(`JDT LS: project belongs to workspace ${forcedWorkspaceId}, will retry with correct workspace ID`);
                }
                const isRetryable = errMsg.includes('not found')
                    || errMsg.includes('404')
                    || errMsg.includes('belongs to workspace')
                    || errMsg.includes('connection got disposed')
                    || errMsg.includes('Pending response rejected')
                    || errMsg.includes('connection is disposed')
                    || errMsg.includes('Backend service not available');
                // KAIRO-RC-DESKTOP-2026-07-29: treat "archive not available" as
                // non-retryable and non-fatal. The IDE can still function
                // without JDT LS (build, deploy, tomcat). Log a warning
                // and return cleanly so the UI does not hang.
                const isArchiveNotAvailable = errMsg.includes('archive not available')
                    || errMsg.includes('offline/air-gapped');
                if (isArchiveNotAvailable) {
                    this.logger.warn(`JDT LS not available for project ${project.projectId} (offline/air-gapped mode). The IDE will work without Java language features. To enable: set KAIRO_JDTLS_HOME or run pnpm bundled:prepare.`);
                    return;
                }
                if (!isRetryable || attempt >= MAX_RETRIES) {
                    this.logger.error(`Failed to prepare JDT LS for project ${project.projectId}: ${errMsg}`);
                    return;
                }
                this.logger.warn(`JDT LS prepare attempt ${attempt + 1} failed for ${project.projectId} (${errMsg.slice(0, 100)}), retrying...`);
            }
        }
        if (lastError) {
            this.logger.warn(`JDT LS prepare exhausted retries for project ${project.projectId}, waiting for workspace context change to retry: ${String(lastError).slice(0, 200)}`);
        }
    }

    /**
     * Start the JDT LS through the JavaLanguageClient using the
     * launch descriptor produced by the Go Runtime Agent.
     *
     * "Already running" (starting / initializing / ready) is
     * treated as success: the backend JdtLsService shares one
     * JDT LS process, so a repeated project/context change must
     * not spawn a second one. Failures are logged, never thrown.
     */
    private startLanguageClient(descriptor: JdtLsLaunchDescriptor, projectId: string, token: number): Promise<void> {
        return this.enqueueTransition(() => this.startLanguageClientNow(descriptor, projectId, token));
    }

    private async startLanguageClientNow(descriptor: JdtLsLaunchDescriptor, projectId: string, token: number): Promise<void> {
        try {
            if (!this.desiredProject || token !== this.activationToken || this.disposed) return;
            const workspaceDataDir = extractWorkspaceDataDir(descriptor);
            if (!descriptor.workingDir || !workspaceDataDir) {
                this.logger.error(
                    `Launch descriptor for project ${projectId} is missing workingDir or workspace data dir; cannot start JDT LS`,
                );
                return;
            }
            const rootUri = pathToFileUri(descriptor.workingDir);
            const home = extractJdtLsHome(descriptor);
            const startKey = `${rootUri}|${workspaceDataDir}|${home ?? ''}`;

            const state = await this.javaClient.fetchState();
            if (!this.desiredProject || token !== this.activationToken || this.disposed) return;
            if (state === 'starting' || state === 'initializing' || state === 'ready') {
                if (this.lastStartKey === startKey) {
                    this.logger.info(`JDT LS already ${state} for ${rootUri}, not restarting`);
                    return;
                }
                await this.javaClient.stop();
                if (!this.desiredProject || token !== this.activationToken || this.disposed) return;
            }

            const result = await this.javaClient.start({ rootUri, workspaceDataDir, home });
            if (result.ok) {
                this.lastStartKey = startKey;
                this.logger.info(`JDT LS start requested for ${rootUri}`);
            } else {
                const errMsg = String(result.reason);
                const isTransient = errMsg.includes('connection got disposed')
                    || errMsg.includes('Pending response rejected')
                    || errMsg.includes('Backend service not available')
                    || errMsg.includes('WebSocket is not open');
                if (isTransient) {
                    this.logger.warn(`JDT LS connection transient error for ${projectId}, will retry: ${errMsg.slice(0, 200)}`);
                    throw new Error(errMsg);
                }
                this.logger.error(`JDT LS failed to start for project ${projectId}: ${result.reason}`);
                this.scheduleRestart();
            }
        } catch (err) {
            const errMsg = String(err);
            const isTransient = errMsg.includes('connection got disposed')
                || errMsg.includes('Pending response rejected')
                || errMsg.includes('connection is disposed')
                || errMsg.includes('Backend service not available')
                || errMsg.includes('WebSocket is not open');
            if (isTransient) {
                this.logger.warn(`JDT LS connection transient error for ${projectId}, will retry: ${errMsg.slice(0, 200)}`);
                throw err;
            }
            this.logger.error(`Failed to start JDT LS for project ${projectId}: ${errMsg}`);
            this.scheduleRestart();
        }
    }

    private enqueueTransition(operation: () => Promise<void>): Promise<void> {
        const run = this.transitionChain.then(operation, operation);
        this.transitionChain = run.then(() => undefined, () => undefined);
        return run;
    }

    private onClientState(state: JdtLsState): void {
        if (state === 'crashed' || state === 'failed') {
            this.scheduleRestart();
        }
    }

    private scheduleRestart(): void {
        const project = this.desiredProject;
        const descriptor = this.launchDescriptor;
        if (this.disposed || !project || !descriptor || this.restartTimer || this.restartInFlight) return;
        if (this.restartAttempts >= JDT_LS_MAX_AUTO_RESTARTS) {
            this.logger.error(`JDT LS automatic restart limit reached (${JDT_LS_MAX_AUTO_RESTARTS}); manual restart required`);
            return;
        }
        const attempt = ++this.restartAttempts;
        const token = this.activationToken;
        const delay = this.restartDelayMs(attempt);
        this.logger.warn(`JDT LS crashed; automatic restart ${attempt}/${JDT_LS_MAX_AUTO_RESTARTS} in ${delay}ms`);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            if (!this.isCurrentActivation(project, token)) return;
            this.restartInFlight = true;
            void this.startLanguageClient(descriptor, project.projectId, token).catch(() => {}).finally(async () => {
                this.restartInFlight = false;
                if (!this.isCurrentActivation(project, token)) return;
                try {
                    const state = await this.javaClient.fetchState();
                    if (state === 'crashed' || state === 'failed') this.scheduleRestart();
                } catch (err) {
                    this.logger.warn(`Could not inspect JDT LS after restart attempt: ${String(err)}`);
                    this.scheduleRestart();
                }
            });
        }, delay);
    }

    protected restartDelayMs(attempt: number): number {
        return Math.min(JDT_LS_RESTART_MAX_DELAY_MS, JDT_LS_RESTART_BASE_DELAY_MS * (2 ** (attempt - 1)));
    }

    /**
     * Initial delay before the first JDT LS prepare request.
     * Exposed as a method so tests can override it to 0.
     */
    protected initialDelayMs(): number {
        return 5000;
    }

    private clearRestartTimer(): void {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = undefined;
    }

    private isCurrentActivation(project: { workspaceId: string; projectId: string }, token: number): boolean {
        return !this.disposed
            && token === this.activationToken
            && this.desiredProject?.workspaceId === project.workspaceId
            && this.desiredProject?.projectId === project.projectId;
    }

    /**
     * Returns the current launch descriptor, if any.
     */
    getLaunchDescriptor(): JdtLsLaunchDescriptor | undefined {
        return this.launchDescriptor;
    }
}

/**
 * Extract the Eclipse workspace data dir from the launch
 * descriptor. The agent exposes it as `JDTLS_WORKSPACE=<dir>`
 * in envAllowlist and as the value following `-data` in args.
 */
export function extractWorkspaceDataDir(descriptor: JdtLsLaunchDescriptor): string | undefined {
    if (Array.isArray(descriptor.envAllowlist)) {
        for (const entry of descriptor.envAllowlist) {
            if (entry.startsWith('JDTLS_WORKSPACE=')) {
                const value = entry.slice('JDTLS_WORKSPACE='.length);
                if (value) {
                    return value;
                }
            }
        }
    }
    if (Array.isArray(descriptor.args)) {
        const idx = descriptor.args.indexOf('-data');
        if (idx >= 0 && idx + 1 < descriptor.args.length) {
            return descriptor.args[idx + 1];
        }
    }
    return undefined;
}

/** Convert an absolute filesystem path to a file:// URI. */
export function pathToFileUri(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `file://${withSlash}`;
}

/**
 * Extract the JDT LS install home from the launch descriptor.
 * The agent's args reference the Equinox launcher jar as
 * `<home>/plugins/org.eclipse.equinox.launcher_<version>.jar`
 * (the value following `-jar`); the install home is the
 * parent of `plugins/`. Returns undefined when the descriptor
 * does not carry a launcher path — the backend then falls
 * back to KAIRO_JDT_LS_HOME.
 */
export function extractJdtLsHome(descriptor: JdtLsLaunchDescriptor): string | undefined {
    if (!Array.isArray(descriptor.args)) {
        return undefined;
    }
    const jarIdx = descriptor.args.indexOf('-jar');
    const candidates = jarIdx >= 0 && jarIdx + 1 < descriptor.args.length
        ? [descriptor.args[jarIdx + 1]]
        : descriptor.args;
    for (const arg of candidates) {
        const normalized = String(arg).replace(/\\/g, '/');
        const m = /^(.*)\/plugins\/org\.eclipse\.equinox\.launcher_[^/]*\.jar$/i.exec(normalized);
        if (m && m[1]) {
            return m[1];
        }
    }
    return undefined;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
