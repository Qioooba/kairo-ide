import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { DisposableCollection, Disposable } from '@theia/core/lib/common/disposable';
import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { Endpoint, JdtLaunchDescriptor } from '@kairo/protocol';

/**
 * Health check result for the JDT LS process.
 */
export interface LsHealthCheck {
  healthy: boolean;
  state: string;
  pid?: number;
  uptimeMs?: number;
  crashCount: number;
  lastCrashTime?: string;
}

/**
 * Kairo Java Language Server Contribution (backend).
 *
 * Owns the JDT LS process lifecycle. The Go Agent only provides
 * the launch descriptor; this contribution spawns JDT LS and
 * exposes the stdin/stdout streams for the LanguageClient.
 *
 * The initialize handshake is performed ONLY by the
 * LanguageClient — the Go Agent is not involved in LSP.
 */
@injectable()
export class KairoJavaLanguageServerContribution implements Disposable {
    readonly id = 'kairo-java';
    readonly name = 'Kairo Java';

    @inject(ILogger)
    private readonly logger!: ILogger;

    @inject(RuntimeConnectionService)
    private readonly runtime!: RuntimeConnectionService;

    private process: ChildProcess | undefined;
    private reader: StreamMessageReader | undefined;
    private writer: StreamMessageWriter | undefined;

    private toDispose = new DisposableCollection();

    // Crash circuit breaker: max N crashes in time window.
    private crashCount = 0;
    private readonly maxCrashes = 5;
    private readonly crashWindowMs = 60000; // 1 minute
    private crashTimestamps: number[] = [];
    private startedAt: number | undefined;

    // Health check interval
    private healthCheckTimer: ReturnType<typeof setInterval> | undefined;

    @postConstruct()
    protected init(): void {
        this.logger.info('[KairoJava] Language server contribution initialized');
    }

    dispose(): void {
        this.stopHealthCheck();
        this.toDispose.dispose();
        this.stop().catch(err => this.logger.error(`[KairoJava] Error during disposal: ${err}`));
    }

    /**
     * Fetch the launch descriptor from the Go Agent.
     * The Go Agent returns the JVM command, arguments, working directory,
     * and a minimal env allowlist (never os.Environ()).
     */
    async getLaunchDescriptor(workspaceId: string, projectId: string): Promise<JdtLaunchDescriptor> {
        return this.runtime.request(
            `GET /api/v1/workspaces/${workspaceId}/java/launch-descriptor` as Endpoint,
            undefined,
            { query: { projectId } },
        ) as Promise<JdtLaunchDescriptor>;
    }

    /**
     * Build the environment from the Go Agent's env allowlist.
     * Only the variables explicitly listed by the agent are passed.
     * Never expose the full process.env.
     */
    private buildEnv(envAllowlist: string[]): Record<string, string> {
        const env: Record<string, string> = {};
        for (const entry of envAllowlist) {
            const eqIdx = entry.indexOf('=');
            if (eqIdx >= 0) {
                env[entry.substring(0, eqIdx)] = entry.substring(eqIdx + 1);
            }
        }
        return env;
    }

    /**
     * Start JDT LS using the launch descriptor.
     * Returns the stdin/stdout streams for the LanguageClient.
     *
     * @throws if JDT LS is already running
     * @throws if crash circuit breaker is tripped
     */
    async start(descriptor: JdtLaunchDescriptor): Promise<{
        reader: StreamMessageReader;
        writer: StreamMessageWriter;
    }> {
        if (this.process) {
            throw new Error('[KairoJava] JDT LS is already running');
        }

        // Crash circuit breaker check.
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < this.crashWindowMs);
        if (this.crashTimestamps.length >= this.maxCrashes) {
            const msg = `[KairoJava] JDT LS crashed ${this.crashTimestamps.length} times in ` +
                `${this.crashWindowMs / 1000}s. Please check the JDT LS installation and ` +
                `restart the workspace. Last crashes at: ${this.crashTimestamps.map(t => new Date(t).toISOString()).join(', ')}`;
            this.logger.error(msg);
            throw new Error(msg);
        }

        this.logger.info(`[KairoJava] Starting JDT LS: ${descriptor.command} ${descriptor.args.join(' ')}`);

        const options: SpawnOptions = {
            cwd: descriptor.workingDir,
            env: this.buildEnv(descriptor.envAllowlist),
            stdio: ['pipe', 'pipe', 'pipe'],
        };

        this.process = spawn(descriptor.command, descriptor.args, options);
        this.crashCount = 0;
        this.startedAt = Date.now();

        this.reader = new StreamMessageReader(this.process.stdout!);
        this.writer = new StreamMessageWriter(this.process.stdin!);

        this.process.on('exit', (code, signal) => {
            this.logger.warn(`[KairoJava] JDT LS exited with code ${code}, signal ${signal}`);
            this.reader = undefined;
            this.writer = undefined;
            this.process = undefined;
            this.startedAt = undefined;
            this.stopHealthCheck();
            this.handleCrash();
        });

        this.process.on('error', err => {
            this.logger.error(`[KairoJava] JDT LS process error: ${err.message}`);
            this.reader = undefined;
            this.writer = undefined;
            this.process = undefined;
            this.startedAt = undefined;
            this.stopHealthCheck();
            this.handleCrash();
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            this.logger.debug(`[KairoJava] JDT LS stderr: ${data.toString()}`);
        });

        // Start periodic health checks
        this.startHealthCheck();

        return { reader: this.reader, writer: this.writer };
    }

    /**
     * Restart JDT LS. Stops the current process (if any) and
     * starts a new one with the same or a new descriptor.
     */
    async restart(descriptor?: JdtLaunchDescriptor): Promise<void> {
        this.logger.info('[KairoJava] Restarting JDT LS');
        await this.stop();
        // Reset crash circuit breaker on explicit restart
        this.crashTimestamps = [];
        this.crashCount = 0;
        if (descriptor) {
            await this.start(descriptor);
        }
    }

    /**
     * Gracefully stop JDT LS.
     * 1. Close the writer (stdin) to signal shutdown.
     * 2. Wait up to 5 seconds for graceful exit.
     * 3. Send SIGTERM if still running.
     * 4. Wait 2 more seconds.
     * 5. Send SIGKILL if still running.
     */
    async stop(): Promise<void> {
        this.stopHealthCheck();

        if (!this.process) {
            return;
        }

        this.logger.info('[KairoJava] Stopping JDT LS');

        try {
            this.writer?.end();
        } catch {
            // Writer may already be closed.
        }

        const proc = this.process;
        let killed = false;

        // Wait up to 5 seconds for graceful shutdown.
        killed = await this.waitForExit(proc, 5000);

        if (!killed && proc) {
            this.logger.warn('[KairoJava] JDT LS did not exit gracefully, sending SIGTERM');
            proc.kill('SIGTERM');
            killed = await this.waitForExit(proc, 2000);
        }

        if (!killed && proc) {
            this.logger.warn('[KairoJava] JDT LS did not respond to SIGTERM, sending SIGKILL');
            proc.kill('SIGKILL');
        }

        this.reader = undefined;
        this.writer = undefined;
        this.process = undefined;
        this.startedAt = undefined;
    }

    /**
     * Returns a health check object for the JDT LS process.
     */
    healthCheck(): LsHealthCheck {
        const running = this.isRunning();
        return {
            healthy: running,
            state: running ? 'running' : (this.process ? 'stopping' : 'stopped'),
            pid: this.process?.pid,
            uptimeMs: this.startedAt ? Date.now() - this.startedAt : undefined,
            crashCount: this.crashCount,
            lastCrashTime: this.crashTimestamps.length > 0
                ? new Date(this.crashTimestamps[this.crashTimestamps.length - 1]).toISOString()
                : undefined,
        };
    }

    /**
     * Start periodic health checks that log warnings if the
     * process exits unexpectedly.
     */
    private startHealthCheck(): void {
        this.stopHealthCheck();
        this.healthCheckTimer = setInterval(() => {
            const health = this.healthCheck();
            if (!health.healthy && this.process !== undefined) {
                this.logger.warn(`[KairoJava] Health check failed: ${JSON.stringify(health)}`);
            }
        }, 30000); // Every 30 seconds
    }

    private stopHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
    }

    /**
     * Wait for the process to exit, with a timeout.
     * Returns true if the process exited, false on timeout.
     */
    private waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            if (!proc || proc.exitCode !== null) {
                resolve(true);
                return;
            }
            const timer = setTimeout(() => resolve(false), timeoutMs);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    }

    /**
     * Returns the current streams, or null if JDT LS is not running.
     */
    getStreams(): { reader: StreamMessageReader | null; writer: StreamMessageWriter | null } {
        return {
            reader: this.reader || null,
            writer: this.writer || null,
        };
    }

    /**
     * Returns true if JDT LS is currently running.
     */
    isRunning(): boolean {
        return this.process !== undefined && this.process.exitCode === null;
    }

    private handleCrash(): void {
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < this.crashWindowMs);
        this.crashTimestamps.push(now);
        this.crashCount++;

        if (this.crashTimestamps.length >= this.maxCrashes) {
            this.logger.error(
                `[KairoJava] Crash circuit breaker tripped: ${this.crashTimestamps.length} crashes ` +
                `in ${this.crashWindowMs / 1000}s. JDT LS will not be restarted automatically. ` +
                `Check the JDT LS installation and restart the workspace.`
            );
        }
    }
}