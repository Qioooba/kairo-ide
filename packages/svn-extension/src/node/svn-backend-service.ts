// SPDX-License-Identifier: Apache-2.0
//
// Kairo svn-extension — backend service implementation.
//
// All SVN CLI executions (child_process / fs) live here so the
// browser bundle never hits JSPM's shim layer that throws on
// any child_process import. The browser side reaches this via
// JSON-RPC at SvnBackendPath.

import { injectable, inject } from '@theia/core/shared/inversify';
import { execFile, ChildProcess } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { promisify } from 'node:util';
import { ILogger } from '@theia/core/lib/common/logger';
import { Emitter, Event } from '@theia/core/lib/common/event';
import {
  SvnBackendService,
  SvnFrontendClient,
} from '../common/svn-protocol';
import {
  SvnInstallation,
  CommandResult,
  SvnInfo,
  SvnStatus,
  SvnLogEntry,
  SvnAnnotation,
  SvnDiffResult,
  SvnCredential,
  SvnResolveChoice,
} from '../browser/svn-types';
import {
  parseVersionString,
  parseStatusXml,
  parseInfoXml,
  parseLogXml,
  parseBlameXml,
} from '../browser/svn-parser';

const execFileAsync = promisify(execFile);

const WINDOWS_CANDIDATE_PATHS = [
  'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files (x86)\\TortoiseSVN\\bin\\svn.exe',
  'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
  'C:\\Program Files\\CollabNet\\Subversion Client\\svn.exe',
  'C:\\Program Files\\VisualSVN\\bin\\svn.exe',
  'C:\\cygwin64\\bin\\svn.exe',
  'C:\\Program Files\\Git\\usr\\bin\\svn.exe',
  'C:\\ProgramData\\chocolatey\\bin\\svn.exe',
  'C:\\Program Files\\WANdisco\\Subversion\\bin\\svn.exe',
];

const MAC_CANDIDATE_PATHS = [
  '/usr/bin/svn',
  '/usr/local/bin/svn',
  '/opt/subversion/bin/svn',
  '/opt/homebrew/bin/svn',
  '/opt/homebrew/opt/subversion/bin/svn',
];

const LINUX_CANDIDATE_PATHS = [
  '/usr/bin/svn',
  '/usr/local/bin/svn',
];

type CommandType = 'read' | 'write';

interface QueuedCommand {
  id: string;
  args: string[];
  cwd: string;
  type: CommandType;
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  options?: {
    timeout?: number;
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
export class SvnBackendServiceImpl implements SvnBackendService {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  protected cachedInstallation: SvnInstallation | undefined;
  protected credentials: SvnCredential | undefined;
  protected client: SvnFrontendClient | undefined;
  protected queues: Map<string, WcQueue> = new Map();

  protected readonly onCommandEmitter = new Emitter<{
    id: string; kind: 'start' | 'end' | 'error'; args: string[]; cwd: string;
  }>();
  readonly onCommand: Event<{
    id: string; kind: 'start' | 'end' | 'error'; args: string[]; cwd: string;
  }> = this.onCommandEmitter.event;

  setClient(client: SvnFrontendClient | undefined): void {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  async $detectSvn(): Promise<SvnInstallation | undefined> {
    if (this.cachedInstallation) return this.cachedInstallation;

    const pathResult = await this.tryExecPath('svn', 'path');
    if (pathResult) {
      this.cachedInstallation = pathResult;
      return pathResult;
    }

    const candidates = this.getCandidatePaths();
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const result = await this.$validatePath(candidate);
          if (result) {
            this.cachedInstallation = { ...result, source: 'common-location' };
            return this.cachedInstallation;
          }
        }
      } catch { /* ignore */ }
    }

    if (os.platform() === 'win32') {
      const reg = await this.tryRegistryDetection();
      if (reg) {
        this.cachedInstallation = reg;
        return reg;
      }
      const scoop = path.join(os.homedir(), 'scoop', 'shims', 'svn.exe');
      try {
        if (fs.existsSync(scoop)) {
          const result = await this.$validatePath(scoop);
          if (result) {
            this.cachedInstallation = { ...result, source: 'common-location' };
            return this.cachedInstallation;
          }
        }
      } catch { /* ignore */ }
    }
    return undefined;
  }

  async $validatePath(svnPath: string): Promise<SvnInstallation | undefined> {
    try {
      const { stdout } = await execFileAsync(svnPath, ['--version', '--quiet'], {
        timeout: 5000, maxBuffer: 1024 * 1024,
      });
      const parsed = parseVersionString(stdout.trim());
      return {
        path: svnPath,
        version: parsed.full,
        versionMajor: parsed.major,
        versionMinor: parsed.minor,
        source: 'user-config',
      };
    } catch {
      return undefined;
    }
  }

  protected getCandidatePaths(): string[] {
    const platform = os.platform();
    if (platform === 'win32') return WINDOWS_CANDIDATE_PATHS;
    if (platform === 'darwin') return MAC_CANDIDATE_PATHS;
    if (platform === 'linux') return LINUX_CANDIDATE_PATHS;
    return [];
  }

  protected async tryExecPath(command: string, source: SvnInstallation['source']): Promise<SvnInstallation | undefined> {
    try {
      const { stdout } = await execFileAsync(command, ['--version', '--quiet'], {
        timeout: 3000, maxBuffer: 1024 * 1024,
      });
      const parsed = parseVersionString(stdout.trim());
      return {
        path: command,
        version: parsed.full,
        versionMajor: parsed.major,
        versionMinor: parsed.minor,
        source,
      };
    } catch {
      return undefined;
    }
  }

  protected async tryRegistryDetection(): Promise<SvnInstallation | undefined> {
    const regQuery = async (keyPath: string): Promise<string | undefined> => {
      try {
        const { stdout } = await execFileAsync('reg', ['query', keyPath, '/v', 'InstallDir'], {
          timeout: 3000, maxBuffer: 1024 * 1024,
        });
        const match = stdout.match(/InstallDir\s+REG_SZ\s+(.+)/);
        return match ? match[1].trim() : undefined;
      } catch { return undefined; }
    };
    for (const regPath of ['HKLM\\SOFTWARE\\TortoiseSVN', 'HKLM\\SOFTWARE\\Wow6432Node\\TortoiseSVN']) {
      const installDir = await regQuery(regPath);
      if (installDir) {
        const svnExe = path.join(installDir, 'bin', 'svn.exe');
        try {
          if (fs.existsSync(svnExe)) {
            const result = await this.$validatePath(svnExe);
            if (result) return { ...result, source: 'registry' };
          }
        } catch { /* ignore */ }
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Credentials
  // ---------------------------------------------------------------------------

  async $setCredentials(creds: SvnCredential | undefined): Promise<void> {
    this.credentials = creds;
  }

  // ---------------------------------------------------------------------------
  // Low-level WC helpers
  // ---------------------------------------------------------------------------

  async $isWcRoot(cwd: string): Promise<boolean> {
    try {
      const svnDir = path.join(cwd, '.svn');
      return fs.existsSync(svnDir) && fs.statSync(svnDir).isDirectory();
    } catch { return false; }
  }

  async $findWcRoot(cwd: string): Promise<string | undefined> {
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
      } catch { /* ignore */ }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return undefined;
  }

  protected getWcRootForCwd(cwd: string): string {
    // synchronous fs lookup for queue keying
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
      } catch { /* ignore */ }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return cwd;
  }

  // ---------------------------------------------------------------------------
  // Command queue + exec
  // ---------------------------------------------------------------------------

  async $exec(args: string[], cwd: string, type: 'read' | 'write'): Promise<CommandResult> {
    const wcRoot = this.getWcRootForCwd(cwd);
    return new Promise<CommandResult>((resolve, reject) => {
      const cmd: QueuedCommand = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        args,
        cwd,
        type,
        resolve,
        reject,
      };
      this.enqueueCommand(wcRoot, cmd);
    });
  }

  protected async execXml<T>(
    args: string[], cwd: string, parser: (xml: string) => T,
  ): Promise<T> {
    const r = await this.$exec([...args, '--xml'], cwd, 'read');
    return parser(r.stdout);
  }

  protected enqueueCommand(wcRoot: string, cmd: QueuedCommand): void {
    if (!this.queues.has(wcRoot)) {
      this.queues.set(wcRoot, { writeQueue: [], activeReadCount: 0, activeWrite: null });
    }
    const queue = this.queues.get(wcRoot)!;
    if (cmd.type === 'read') {
      if (queue.activeWrite === null && queue.activeReadCount < READ_CONCURRENCY_LIMIT) {
        this.executeCommand(cmd, wcRoot);
      } else {
        queue.writeQueue.push({
          ...cmd,
          resolve: (r) => { cmd.resolve(r); this.processNext(wcRoot); },
          reject: (e) => { cmd.reject(e); this.processNext(wcRoot); },
        });
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
    if (!queue) { cmd.reject(new Error('Queue not found')); return; }
    if (cmd.type === 'read') queue.activeReadCount++;

    const svnPath = this.cachedInstallation?.path || 'svn';
    const args = [...cmd.args];
    const merged = {
      nonInteractive: true,
      trustServerCert: true,
      ...(this.credentials && {
        username: this.credentials.username,
        password: this.credentials.password,
      }),
      ...(cmd.options || {}),
    };
    if (merged.nonInteractive) args.push('--non-interactive');
    if (merged.trustServerCert) args.push('--trust-server-cert');
    if (merged.username) args.push('--username', merged.username);
    if (merged.password) args.push('--password', merged.password);

    const timeout =
      cmd.options?.timeout ||
      (cmd.args.includes('status') ? STATUS_TIMEOUT : DEFAULT_TIMEOUT);

    let stdout = '';
    let stderr = '';
    let exited = false;

    this.onCommandEmitter.fire({ id: cmd.id, kind: 'start', args: cmd.args, cwd: cmd.cwd });
    this.client?.onCommandEvent?.({ id: cmd.id, kind: 'start', args: cmd.args, cwd: cmd.cwd });
    this.logger.info(`[svn-backend] exec ${svnPath} ${args.join(' ')} (cwd=${cmd.cwd})`);

    const child = execFile(svnPath, args, {
      cwd: cmd.cwd,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdoutData, stderrData) => {
      if (exited) return;
      exited = true;
      stdout = stdoutData || '';
      stderr = stderrData || '';
      if (cmd.type === 'read') queue.activeReadCount--;
      else queue.activeWrite = null;

      if (error && (error as any).code !== 0) {
        const errorCode = (error as any).code;
        if (errorCode === 'ENOENT') this.cachedInstallation = undefined;
        const err: any = new Error(stderr || error.message || 'SVN command failed');
        err.code = errorCode;
        err.stdout = stdout;
        err.stderr = stderr;
        err.exitCode = typeof errorCode === 'number' ? errorCode : 1;
        this.onCommandEmitter.fire({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
        this.client?.onCommandEvent?.({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
        cmd.reject(err);
      } else {
        this.onCommandEmitter.fire({ id: cmd.id, kind: 'end', args: cmd.args, cwd: cmd.cwd });
        this.client?.onCommandEvent?.({ id: cmd.id, kind: 'end', args: cmd.args, cwd: cmd.cwd });
        cmd.resolve({ stdout, stderr, exitCode: 0 });
      }
      this.processNext(wcRoot);
    });
    cmd.process = child;
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (exited) return;
      exited = true;
      if (cmd.type === 'read') queue.activeReadCount--;
      else queue.activeWrite = null;
      this.onCommandEmitter.fire({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
      this.client?.onCommandEvent?.({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
      cmd.reject(err);
      this.processNext(wcRoot);
    });
  }

  // ---------------------------------------------------------------------------
  // High-level ops (still in backend so we save a round trip for XML parsing)
  // ---------------------------------------------------------------------------

  async $getWcInfo(cwd: string): Promise<SvnInfo | undefined> {
    try {
      const info = await this.execXml(['info'], cwd, parseInfoXml);
      return info as any;
    } catch { return undefined; }
  }

  async $getStatus(cwd: string): Promise<SvnStatus[]> {
    try {
      return await this.execXml(['status'], cwd, parseStatusXml);
    } catch { return []; }
  }

  async $getFileStatus(cwd: string, relPath: string): Promise<SvnStatus | undefined> {
    try {
      const list = await this.execXml(['status', relPath], cwd, parseStatusXml);
      return list[0];
    } catch { return undefined; }
  }

  async $commit(cwd: string, files: string[], message: string): Promise<CommandResult> {
    return this.$exec(['commit', '-m', message, ...files], cwd, 'write');
  }

  async $update(cwd: string, files: string[], revision?: string): Promise<CommandResult> {
    const args: string[] = ['update'];
    if (revision) args.push('-r', revision);
    args.push(...files);
    return this.$exec(args, cwd, 'write');
  }

  async $add(cwd: string, files: string[]): Promise<CommandResult> {
    return this.$exec(['add', '--parents', ...files], cwd, 'write');
  }

  async $revert(cwd: string, files: string[]): Promise<CommandResult> {
    return this.$exec(['revert', ...files], cwd, 'write');
  }

  async $cleanup(cwd: string): Promise<CommandResult> {
    return this.$exec(['cleanup'], cwd, 'write');
  }

  async $delete(cwd: string, files: string[], force = false): Promise<CommandResult> {
    const args = ['delete'];
    if (force) args.push('--force');
    args.push(...files);
    return this.$exec(args, cwd, 'write');
  }

  async $resolve(cwd: string, files: string[], choice: SvnResolveChoice): Promise<CommandResult> {
    return this.$exec(['resolve', '--accept', choice, ...files], cwd, 'write');
  }

  async $lock(cwd: string, files: string[], message?: string, steal = false): Promise<CommandResult> {
    const args = ['lock'];
    if (message) args.push('-m', message);
    if (steal) args.push('--force');
    args.push(...files);
    return this.$exec(args, cwd, 'write');
  }

  async $unlock(cwd: string, files: string[], breakLock = false): Promise<CommandResult> {
    const args = ['unlock'];
    if (breakLock) args.push('--force');
    args.push(...files);
    return this.$exec(args, cwd, 'write');
  }

  async $ignore(cwd: string, patterns: string[]): Promise<CommandResult> {
    // Appends patterns to svn:ignore on the directory of each pattern (or cwd)
    // Simpler approach: use `svn propset svn:ignore` with combined list per dir
    const byDir = new Map<string, string[]>();
    for (const p of patterns) {
      const dir = path.dirname(p.startsWith('.') || p.startsWith('/') ? p : path.join(cwd, p));
      const base = path.basename(p);
      const list = byDir.get(dir) || [];
      list.push(base);
      byDir.set(dir, list);
    }
    let lastResult: CommandResult = { stdout: '', stderr: '', exitCode: 0 };
    for (const [dir, list] of byDir.entries()) {
      // Fetch existing ignore list
      let existing = '';
      try {
        const r = await this.$exec(['propget', 'svn:ignore', dir], dir, 'read');
        existing = r.stdout;
      } catch { existing = ''; }
      const combined = existing
        ? existing + '\n' + list.join('\n')
        : list.join('\n');
      lastResult = await this.$exec(['propset', 'svn:ignore', combined, dir], dir, 'write');
    }
    return lastResult;
  }

  async $getLog(cwd: string, files: string[], limit: number, revision?: string): Promise<SvnLogEntry[]> {
    try {
      const args = ['log', '-l', String(limit)];
      if (revision) args.push('-r', revision);
      return await this.execXml([...args, ...files], cwd, parseLogXml);
    } catch { return []; }
  }

  async $getLogEntry(cwd: string, revision: string): Promise<SvnLogEntry | undefined> {
    try {
      const entries = await this.execXml(['log', '-r', revision, '-l', '1'], cwd, parseLogXml);
      return entries[0];
    } catch { return undefined; }
  }

  async $annotate(cwd: string, relPath: string, revision?: string): Promise<SvnAnnotation[]> {
    try {
      const args = ['blame', '--xml'];
      if (revision) args.push('-r', revision);
      args.push(relPath);
      return await this.execXml(args, cwd, parseBlameXml);
    } catch { return []; }
  }

  async $getDiff(cwd: string, files: string[], revision?: string): Promise<SvnDiffResult> {
    try {
      const args = ['diff'];
      if (revision) args.push('-r', revision);
      args.push(...files);
      const r = await this.$exec(args, cwd, 'read');
      return { content: r.stdout };
    } catch (e: any) {
      return { content: e.stdout || '' };
    }
  }

  async $checkout(url: string, target: string, revision?: string): Promise<CommandResult> {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    } catch { /* ignore */ }
    const args = ['checkout', url, target];
    if (revision) args.push('-r', revision);
    return this.$exec(args, target, 'write');
  }

  async $getFileAtRevision(cwd: string, relPath: string, revision: string | number): Promise<CommandResult> {
    return this.$exec(['cat', '-r', String(revision), relPath], cwd, 'read');
  }

  async $exportAtRevision(cwd: string, relPath: string, revision: string | number, outPath: string): Promise<CommandResult> {
    const args = ['export', '-r', String(revision), '--force', relPath, outPath];
    return this.$exec(args, cwd, 'read');
  }

  async $revertToRevision(cwd: string, relPath: string, revision: string | number): Promise<CommandResult> {
    // svn merge -r HEAD:revision path  → bring file back to that revision
    return this.$exec(['merge', '-r', `HEAD:${revision}`, relPath], cwd, 'write');
  }
}
