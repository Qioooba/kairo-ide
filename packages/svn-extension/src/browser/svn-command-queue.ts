import { injectable, inject } from '@theia/core/shared/inversify';
import { ChildProcess, execFile } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SvnDetector } from './svn-detector';
import { CommandResult } from './svn-types';

export type CommandType = 'read' | 'write';

interface QueuedCommand {
  id: string;
  args: string[];
  cwd: string;
  type: CommandType;
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  options?: {
    timeout?: number;
    onProgress?: (data: string) => void;
    username?: string;
    password?: string;
    nonInteractive?: boolean;
    trustServerCert?: boolean;
  };
  process?: ChildProcess;
}

interface WcQueue {
  writeQueue: QueuedCommand[];
  activeReadCount: number;
  activeWrite: QueuedCommand | null;
}

const READ_CONCURRENCY_LIMIT = 3;
const DEFAULT_TIMEOUT = 300000;
const STATUS_TIMEOUT = 10000;

@injectable()
export class SvnCommandQueue {
  @inject(SvnDetector)
  protected readonly detector!: SvnDetector;

  protected queues: Map<string, WcQueue> = new Map();

  async exec(
    args: string[],
    cwd: string,
    type: CommandType = 'read',
    options?: QueuedCommand['options'],
  ): Promise<CommandResult> {
    const wcRoot = await this.getWcRootForCwd(cwd);
    return new Promise<CommandResult>((resolve, reject) => {
      const cmd: QueuedCommand = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        args,
        cwd,
        type,
        resolve,
        reject,
        options,
      };

      this.enqueueCommand(wcRoot, cmd);
    });
  }

  async execXml<T>(
    args: string[],
    cwd: string,
    parser: (xml: string) => T,
    options?: QueuedCommand['options'],
  ): Promise<T> {
    const xmlArgs = [...args, '--xml'];
    const result = await this.exec(xmlArgs, cwd, 'read', options);
    return parser(result.stdout);
  }

  cancel(commandId: string): void {
    for (const [, queue] of this.queues) {
      const idx = queue.writeQueue.findIndex(c => c.id === commandId);
      if (idx >= 0) {
        const cmd = queue.writeQueue[idx];
        cmd.reject(new Error('Command cancelled'));
        queue.writeQueue.splice(idx, 1);
        return;
      }
      if (queue.activeWrite?.id === commandId && queue.activeWrite.process) {
        queue.activeWrite.process.kill();
      }
    }
  }

  isWorking(cwd: string): boolean {
    const wcRoot = this.findWcRootSync(cwd);
    if (!wcRoot) return false;
    const queue = this.queues.get(wcRoot);
    if (!queue) return false;
    return queue.activeWrite !== null || queue.writeQueue.length > 0;
  }

  protected getWcRootForCwd(cwd: string): string {
    return this.findWcRoot(cwd) || cwd;
  }

  protected findWcRootSync(cwd: string): string | undefined {
    return this.findWcRoot(cwd);
  }

  protected findWcRoot(cwd: string): string | undefined {
    let current = path.resolve(cwd);
    const { root } = path.parse(current);

    while (current !== root) {
      const svnDir = path.join(current, '.svn');
      try {
        if (fs.existsSync(svnDir) && fs.statSync(svnDir).isDirectory()) {
          const entries = fs.readdirSync(svnDir);
          if (entries.includes('wc.db') || entries.includes('format')) {
            return current;
          }
        }
      } catch {
        // Ignore permission errors
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return undefined;
  }

  protected enqueueCommand(wcRoot: string, cmd: QueuedCommand): void {
    if (!this.queues.has(wcRoot)) {
      this.queues.set(wcRoot, {
        writeQueue: [],
        activeReadCount: 0,
        activeWrite: null,
      });
    }

    const queue = this.queues.get(wcRoot)!;

    if (cmd.type === 'read') {
      if (queue.activeWrite === null && queue.activeReadCount < READ_CONCURRENCY_LIMIT) {
        this.executeCommand(cmd, wcRoot);
      } else {
        const checkAndRun = () => {
          if (queue.activeWrite === null && queue.activeReadCount < READ_CONCURRENCY_LIMIT) {
            this.executeCommand(cmd, wcRoot);
            return true;
          }
          return false;
        };
        if (!checkAndRun()) {
          queue.writeQueue.push({
            ...cmd,
            resolve: (result) => {
              cmd.resolve(result);
              this.processNext(wcRoot);
            },
            reject: (err) => {
              cmd.reject(err);
              this.processNext(wcRoot);
            },
          });
        }
      }
    } else {
      queue.writeQueue.push(cmd);
      this.processNext(wcRoot);
    }
  }

  protected processNext(wcRoot: string): void {
    const queue = this.queues.get(wcRoot);
    if (!queue) return;

    if (queue.activeWrite === null) {
      const writeIdx = queue.writeQueue.findIndex(c => c.type === 'write');
      if (writeIdx >= 0) {
        const cmd = queue.writeQueue.splice(writeIdx, 1)[0];
        queue.activeWrite = cmd;
        this.executeCommand(cmd, wcRoot);
        return;
      }
    }

    while (queue.activeReadCount < READ_CONCURRENCY_LIMIT && queue.writeQueue.length > 0) {
      const readIdx = queue.writeQueue.findIndex(c => c.type === 'read');
      if (readIdx < 0) break;
      const cmd = queue.writeQueue.splice(readIdx, 1)[0];
      this.executeCommand(cmd, wcRoot);
    }
  }

  protected executeCommand(cmd: QueuedCommand, wcRoot: string): void {
    const queue = this.queues.get(wcRoot);
    if (!queue) {
      cmd.reject(new Error('Queue not found'));
      return;
    }

    if (cmd.type === 'read') {
      queue.activeReadCount++;
    }

    const svnPath = this.detector.getCached()?.path || 'svn';

    const args: string[] = [...cmd.args];
    if (cmd.options?.nonInteractive) {
      args.push('--non-interactive');
    }
    if (cmd.options?.trustServerCert) {
      args.push('--trust-server-cert');
    }
    if (cmd.options?.username) {
      args.push('--username', cmd.options.username);
    }
    if (cmd.options?.password) {
      args.push('--password', cmd.options.password);
    }

    const timeout = cmd.options?.timeout ||
      (cmd.args.includes('status') ? STATUS_TIMEOUT : DEFAULT_TIMEOUT);

    let stdout = '';
    let stderr = '';
    let exited = false;

    const child = execFile(
      svnPath,
      args,
      {
        cwd: cmd.cwd,
        timeout,
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdoutData, stderrData) => {
        if (exited) return;
        exited = true;

        stdout = stdoutData || '';
        stderr = stderrData || '';

        if (cmd.type === 'read') {
          queue.activeReadCount--;
        } else {
          queue.activeWrite = null;
        }

        if (error && (error as any).code !== 0) {
          const errorCode = (error as any).code;
          if (errorCode === 'ENOENT') {
            this.detector.invalidateCache();
          }
          const err: any = new Error(stderr || error.message || 'SVN command failed');
          err.code = errorCode;
          err.stdout = stdout;
          err.stderr = stderr;
          err.exitCode = typeof errorCode === 'number' ? errorCode : 1;
          cmd.reject(err);
        } else {
          cmd.resolve({ stdout, stderr, exitCode: 0 });
        }

        this.processNext(wcRoot);
      },
    );

    cmd.process = child;

    child.stdout?.on('data', (data: Buffer) => {
      const str = data.toString();
      stdout += str;
      cmd.options?.onProgress?.(str);
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (exited) return;
      exited = true;
      if (cmd.type === 'read') {
        queue.activeReadCount--;
      } else {
        queue.activeWrite = null;
      }
      cmd.reject(err);
      this.processNext(wcRoot);
    });
  }
}
