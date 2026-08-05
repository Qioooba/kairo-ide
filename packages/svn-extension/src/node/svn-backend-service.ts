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
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
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
import { toWcRelativePath } from '../browser/svn-path-utils';

const execFileAsync = promisify(execFile);

/** Force C locale so human-readable svn messages stay English for parsers that need them. */
function svnEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LANG: 'C',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
}

/** Append `--` before path args so filenames starting with `-` are not treated as options. */
function withPathArgs(base: string[], files: string[]): string[] {
  if (!files.length) return base;
  return [...base, '--', ...files];
}

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
  /** Set when cancelled so the exec callback does not double-settle. */
  cancelled?: boolean;
  /** True after resolve/reject — prevents cancel/exit double-settle. */
  settled?: boolean;
}

/**
 * Per-WC queue (VC-P3-2): FIFO pending list, concurrent reads (cap),
 * exclusive writes. Writes never jump ahead of earlier reads, and a
 * write never starts while reads are still active.
 */
interface WcQueue {
  pending: QueuedCommand[];
  activeReadCount: number;
  activeWrite: QueuedCommand | null;
  /** All in-flight commands keyed by id (for cancel). */
  activeById: Map<string, QueuedCommand>;
}

const READ_CONCURRENCY_LIMIT = 3;
const DEFAULT_TIMEOUT = 300000;
const STATUS_TIMEOUT = 10000;

export class SvnCommandCancelledError extends Error {
  readonly code = 'SVN_CANCELLED';
  constructor(commandId: string, message = `SVN command cancelled: ${commandId}`) {
    super(message);
    this.name = 'SvnCommandCancelledError';
  }
}

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

  /** Normalize Theia/Posix-style Windows paths like "/G:/foo" → "G:/foo". */
  protected normalizeFsPath(cwd: string): string {
    if (!cwd) return cwd;
    let p = cwd.replace(/\\/g, '/');
    if (/^\/[a-zA-Z]:/.test(p)) {
      p = p.substring(1);
    }
    return path.resolve(p);
  }

  async $isWcRoot(cwd: string): Promise<boolean> {
    try {
      const svnDir = path.join(this.normalizeFsPath(cwd), '.svn');
      return fs.existsSync(svnDir) && fs.statSync(svnDir).isDirectory();
    } catch { return false; }
  }

  async $findWcRoot(cwd: string): Promise<string | undefined> {
    let current = this.normalizeFsPath(cwd);
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
  // Command queue + exec (VC-P3-2: fair FIFO + cancel)
  // ---------------------------------------------------------------------------

  async $exec(args: string[], cwd: string, type: 'read' | 'write'): Promise<CommandResult> {
    const wcRoot = this.getWcRootForCwd(cwd);
    return new Promise<CommandResult>((resolve, reject) => {
      const cmd: QueuedCommand = {
        id: randomUUID(),
        args,
        cwd,
        type,
        resolve,
        reject,
      };
      this.enqueueCommand(wcRoot, cmd);
    });
  }

  async $cancel(commandId: string): Promise<boolean> {
    for (const [wcRoot, queue] of this.queues) {
      const pendingIdx = queue.pending.findIndex(c => c.id === commandId);
      if (pendingIdx >= 0) {
        const [cmd] = queue.pending.splice(pendingIdx, 1);
        this.rejectCancelled(cmd);
        this.processNext(wcRoot);
        return true;
      }
      const active = queue.activeById.get(commandId);
      if (active) {
        this.killCommand(active, queue, wcRoot);
        return true;
      }
    }
    return false;
  }

  async $cancelAll(cwd?: string): Promise<number> {
    let cancelled = 0;
    const roots = cwd
      ? [this.getWcRootForCwd(cwd)]
      : [...this.queues.keys()];
    for (const wcRoot of roots) {
      const queue = this.queues.get(wcRoot);
      if (!queue) continue;
      const pending = queue.pending.splice(0, queue.pending.length);
      for (const cmd of pending) {
        this.rejectCancelled(cmd);
        cancelled++;
      }
      const active = [...queue.activeById.values()];
      for (const cmd of active) {
        if (this.killCommand(cmd, queue, wcRoot)) {
          cancelled++;
        }
      }
      this.processNext(wcRoot);
    }
    return cancelled;
  }

  protected async execXml<T>(
    args: string[], cwd: string, parser: (xml: string) => T,
  ): Promise<T> {
    const r = await this.$exec([...args, '--xml'], cwd, 'read');
    return parser(r.stdout);
  }

  protected ensureQueue(wcRoot: string): WcQueue {
    let queue = this.queues.get(wcRoot);
    if (!queue) {
      queue = {
        pending: [],
        activeReadCount: 0,
        activeWrite: null,
        activeById: new Map(),
      };
      this.queues.set(wcRoot, queue);
    }
    return queue;
  }

  protected enqueueCommand(wcRoot: string, cmd: QueuedCommand): void {
    const queue = this.ensureQueue(wcRoot);
    queue.pending.push(cmd);
    this.processNext(wcRoot);
  }

  /**
   * Fair scheduler: drain leading reads up to concurrency; start a write
   * only when it is at the head of the FIFO and no reads are active.
   * Writes never jump ahead of earlier-queued reads (VC-P3-2).
   */
  protected processNext(wcRoot: string): void {
    const queue = this.queues.get(wcRoot);
    if (!queue || queue.activeWrite) return;

    while (
      queue.activeReadCount < READ_CONCURRENCY_LIMIT
      && queue.pending.length > 0
      && queue.pending[0].type === 'read'
    ) {
      const cmd = queue.pending.shift()!;
      this.executeCommand(cmd, wcRoot);
    }

    if (
      queue.activeReadCount === 0
      && !queue.activeWrite
      && queue.pending.length > 0
      && queue.pending[0].type === 'write'
    ) {
      const cmd = queue.pending.shift()!;
      queue.activeWrite = cmd;
      this.executeCommand(cmd, wcRoot);
    }
  }

  protected rejectCancelled(cmd: QueuedCommand): void {
    if (cmd.settled || cmd.cancelled) return;
    cmd.cancelled = true;
    cmd.settled = true;
    const err = new SvnCommandCancelledError(cmd.id);
    this.onCommandEmitter.fire({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
    this.client?.onCommandEvent?.({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
    cmd.reject(err);
  }

  /** Kill an in-flight command. Returns false if already settled/cancelled. */
  protected killCommand(cmd: QueuedCommand, queue: WcQueue, wcRoot: string): boolean {
    if (cmd.settled || cmd.cancelled) return false;
    cmd.cancelled = true;
    cmd.settled = true;
    try {
      cmd.process?.kill();
    } catch { /* ignore */ }
    this.releaseActive(cmd, queue);
    this.onCommandEmitter.fire({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
    this.client?.onCommandEvent?.({ id: cmd.id, kind: 'error', args: cmd.args, cwd: cmd.cwd });
    cmd.reject(new SvnCommandCancelledError(cmd.id));
    this.processNext(wcRoot);
    return true;
  }

  protected releaseActive(cmd: QueuedCommand, queue: WcQueue): void {
    queue.activeById.delete(cmd.id);
    if (cmd.type === 'read') {
      if (queue.activeReadCount > 0) queue.activeReadCount--;
    } else if (queue.activeWrite?.id === cmd.id) {
      queue.activeWrite = null;
    }
  }

  protected executeCommand(cmd: QueuedCommand, wcRoot: string): void {
    const queue = this.queues.get(wcRoot);
    if (!queue) { cmd.reject(new Error('Queue not found')); return; }
    if (cmd.cancelled) return;

    if (cmd.type === 'read') queue.activeReadCount++;
    queue.activeById.set(cmd.id, cmd);

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

    const finish = (error: Error | null | undefined, stdoutData: string, stderrData: string): void => {
      if (exited) return;
      exited = true;
      if (cmd.settled || cmd.cancelled) {
        this.processNext(wcRoot);
        return;
      }
      cmd.settled = true;
      this.releaseActive(cmd, queue);
      stdout = stdoutData || '';
      stderr = stderrData || '';

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
    };

    const child = execFile(svnPath, args, {
      cwd: cmd.cwd,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
      env: svnEnv(),
    }, (error, stdoutData, stderrData) => {
      finish(error, stdoutData || '', stderrData || '');
    });
    cmd.process = child;
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      finish(err, stdout, stderr);
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

  async $getStatus(cwd: string, update = false): Promise<SvnStatus[]> {
    try {
      // --no-ignore so Ignored Files appear in the Changes view (IDEA parity).
      // -u shows incoming repos-status for the Incoming tab.
      const args = update
        ? ['status', '--no-ignore', '-u']
        : ['status', '--no-ignore'];
      const list = await this.execXml(args, cwd, parseStatusXml);
      // Windows SVN returns absolute paths in status XML; normalize to
      // WC-relative forward-slash paths so UI / decorators can match.
      return list.map(entry => ({
        ...entry,
        path: toWcRelativePath(entry.path, cwd),
      }));
    } catch { return []; }
  }

  async $getFileStatus(cwd: string, relPath: string): Promise<SvnStatus | undefined> {
    try {
      const list = await this.execXml(withPathArgs(['status', '--no-ignore'], [relPath]), cwd, parseStatusXml);
      const entry = list[0];
      if (!entry) return undefined;
      return { ...entry, path: toWcRelativePath(entry.path, cwd) };
    } catch { return undefined; }
  }

  async $commit(cwd: string, files: string[], message: string): Promise<CommandResult> {
    return this.$exec(withPathArgs(['commit', '-m', message], files), cwd, 'write');
  }

  async $update(cwd: string, files: string[], revision?: string): Promise<CommandResult> {
    const args: string[] = ['update'];
    if (revision) args.push('-r', revision);
    return this.$exec(withPathArgs(args, files), cwd, 'write');
  }

  async $add(cwd: string, files: string[]): Promise<CommandResult> {
    return this.$exec(withPathArgs(['add', '--parents'], files), cwd, 'write');
  }

  async $revert(cwd: string, files: string[]): Promise<CommandResult> {
    return this.$exec(withPathArgs(['revert'], files), cwd, 'write');
  }

  async $cleanup(cwd: string): Promise<CommandResult> {
    return this.$exec(['cleanup'], cwd, 'write');
  }

  async $delete(cwd: string, files: string[], force = false): Promise<CommandResult> {
    const args = ['delete'];
    if (force) args.push('--force');
    return this.$exec(withPathArgs(args, files), cwd, 'write');
  }

  async $resolve(cwd: string, files: string[], choice: SvnResolveChoice): Promise<CommandResult> {
    return this.$exec(withPathArgs(['resolve', '--accept', choice], files), cwd, 'write');
  }

  async $lock(cwd: string, files: string[], message?: string, steal = false): Promise<CommandResult> {
    const args = ['lock'];
    if (message) args.push('-m', message);
    if (steal) args.push('--force');
    return this.$exec(withPathArgs(args, files), cwd, 'write');
  }

  async $unlock(cwd: string, files: string[], breakLock = false): Promise<CommandResult> {
    const args = ['unlock'];
    if (breakLock) args.push('--force');
    return this.$exec(withPathArgs(args, files), cwd, 'write');
  }

  async $ignore(cwd: string, patterns: string[]): Promise<CommandResult> {
    // patterns: basenames or WC-relative paths. Group by parent directory.
    const byDir = new Map<string, string[]>();
    for (const p of patterns) {
      const normalized = p.replace(/\\/g, '/');
      const hasSlash = normalized.includes('/');
      const dir = hasSlash
        ? path.resolve(cwd, path.dirname(normalized))
        : path.resolve(cwd);
      const base = path.basename(normalized);
      const list = byDir.get(dir) || [];
      if (!list.includes(base)) list.push(base);
      byDir.set(dir, list);
    }
    let lastResult: CommandResult = { stdout: '', stderr: '', exitCode: 0 };
    for (const [dir, list] of byDir.entries()) {
      let existing = '';
      try {
        const r = await this.$exec(['propget', 'svn:ignore', dir], cwd, 'read');
        existing = r.stdout;
      } catch { existing = ''; }
      const existingLines = existing.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const merged = [...existingLines];
      for (const item of list) {
        if (!merged.includes(item)) merged.push(item);
      }
      lastResult = await this.$exec(
        ['propset', 'svn:ignore', merged.join('\n'), dir],
        cwd,
        'write',
      );
    }
    return lastResult;
  }

  async $getLog(cwd: string, files: string[], limit: number, revision?: string): Promise<SvnLogEntry[]> {
    try {
      const args = ['log', '-l', String(limit)];
      if (revision) args.push('-r', revision);
      return await this.execXml(withPathArgs(args, files), cwd, parseLogXml);
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
      // execXml appends --xml; do not pass it here (would duplicate the flag).
      const args = ['blame'];
      if (revision) args.push('-r', revision);
      return await this.execXml(withPathArgs(args, [relPath]), cwd, parseBlameXml);
    } catch { return []; }
  }

  async $getDiff(cwd: string, files: string[], revision?: string): Promise<SvnDiffResult> {
    try {
      const args = ['diff'];
      if (revision) args.push('-r', revision);
      const r = await this.$exec(withPathArgs(args, files), cwd, 'read');
      return { content: r.stdout };
    } catch (e: any) {
      return { content: e.stdout || '' };
    }
  }

  async $checkout(url: string, target: string, revision?: string): Promise<CommandResult> {
    const resolved = path.resolve(target);
    const parent = path.dirname(resolved);
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch { /* ignore */ }
    const args = ['checkout', url, resolved];
    if (revision) args.push('-r', revision);
    // cwd must exist; target itself may not exist yet before checkout.
    return this.$exec(args, parent, 'write');
  }

  async $getFileAtRevision(cwd: string, relPath: string, revision: string | number): Promise<CommandResult> {
    return this.$exec(withPathArgs(['cat', '-r', String(revision)], [relPath]), cwd, 'read');
  }

  async $exportAtRevision(cwd: string, relPath: string, revision: string | number, outPath: string): Promise<CommandResult> {
    const args = withPathArgs(['export', '-r', String(revision), '--force'], [relPath]);
    args.push(outPath);
    return this.$exec(args, cwd, 'read');
  }

  async $revertToRevision(cwd: string, relPath: string, revision: string | number): Promise<CommandResult> {
    // svn merge -r HEAD:revision path  → bring file back to that revision
    return this.$exec(withPathArgs(['merge', '-r', `HEAD:${revision}`], [relPath]), cwd, 'write');
  }
}
