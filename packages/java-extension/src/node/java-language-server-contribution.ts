import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { spawn, ChildProcess } from 'child_process';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { Endpoint } from '@kairo/protocol';

export interface LaunchDescriptor {
    command: string;
    args: string[];
    workingDir: string;
    env: string[];
}

@injectable()
export class JavaLanguageServerManager {
    private process: ChildProcess | undefined;
    private reader: StreamMessageReader | undefined;
    private writer: StreamMessageWriter | undefined;
    private crashCount: number = 0;
    private readonly maxCrashes: number = 3;
    private readonly crashWindow: number = 60000; // 1 minute
    private crashTimestamps: number[] = [];

    @inject(ILogger)
    private readonly logger!: ILogger;

    @inject(RuntimeConnectionService)
    private readonly runtime!: RuntimeConnectionService;

    async getLaunchDescriptor(workspaceId: string, projectId: string): Promise<LaunchDescriptor> {
        return this.runtime.request(
            `GET /api/v1/workspaces/${workspaceId}/java/launch-descriptor` as Endpoint,
            undefined,
            { query: { projectId } },
        ) as Promise<LaunchDescriptor>;
    }

    async start(descriptor: LaunchDescriptor): Promise<{ reader: StreamMessageReader; writer: StreamMessageWriter }> {
        if (this.process) {
            throw new Error('JDT LS is already running');
        }

        this.logger.info(`Starting JDT LS: ${descriptor.command} ${descriptor.args.join(' ')}`);

        this.process = spawn(descriptor.command, descriptor.args, {
            cwd: descriptor.workingDir,
            env: this.buildEnv(descriptor.env),
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.reader = new StreamMessageReader(this.process.stdout!);
        this.writer = new StreamMessageWriter(this.process.stdin!);

        this.process.on('exit', (code, signal) => {
            this.logger.warn(`JDT LS exited with code ${code}, signal ${signal}`);
            this.reader = undefined;
            this.writer = undefined;
            this.process = undefined;
            this.handleCrash();
        });

        this.process.on('error', (err) => {
            this.logger.error(`JDT LS error: ${err.message}`);
            this.reader = undefined;
            this.writer = undefined;
            this.process = undefined;
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            this.logger.debug(`JDT LS stderr: ${data.toString()}`);
        });

        return { reader: this.reader, writer: this.writer };
    }

    async stop(): Promise<void> {
        if (!this.process) {
            return;
        }

        this.logger.info('Stopping JDT LS');
        this.writer?.end();

        // Give it a moment to shut down gracefully
        await new Promise<void>(resolve => {
            const timeout = setTimeout(() => {
                if (this.process) {
                    this.process.kill('SIGTERM');
                    setTimeout(() => {
                        if (this.process) {
                            this.process.kill('SIGKILL');
                        }
                        resolve();
                    }, 2000);
                } else {
                    resolve();
                }
            }, 3000);

            this.process?.on('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
        });

        this.reader = undefined;
        this.writer = undefined;
        this.process = undefined;
    }

    getStreams(): { reader: StreamMessageReader | null; writer: StreamMessageWriter | null } {
        return {
            reader: this.reader || null,
            writer: this.writer || null,
        };
    }

    private buildEnv(env: string[]): Record<string, string> {
        const result: Record<string, string> = {};
        for (const e of env) {
            const eqIdx = e.indexOf('=');
            if (eqIdx >= 0) {
                result[e.substring(0, eqIdx)] = e.substring(eqIdx + 1);
            }
        }
        return result;
    }

    private handleCrash(): void {
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < this.crashWindow);
        this.crashTimestamps.push(now);

        if (this.crashTimestamps.length > this.maxCrashes) {
            this.logger.error(`JDT LS crashed ${this.crashTimestamps.length} times in ${this.crashWindow}ms. Not restarting.`);
            return;
        }

        this.logger.info('JDT LS will be restarted on next request');
    }
}