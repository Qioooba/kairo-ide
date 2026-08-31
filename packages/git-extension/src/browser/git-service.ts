import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { normalizeFsPath, parsePorcelainStatusZ } from '../common/git-path-utils';
import { GitBackendPath, GitBackendService } from '../common/git-protocol';

const DEFAULT_GIT_MAX_BUFFER = 10 * 1024 * 1024;

export interface GitFileStatus {
  /** Relative path from repo root */
  path: string;
  /** Git status code: M=modified, A=added, D=deleted, R=renamed, C=copied, U=unmerged, ?=untracked, ' '=unmodified */
  status: string;
  /** Original path if renamed */
  origPath?: string;
  /** Whether the file is staged (index) */
  staged: boolean;
}

export interface GitStatusResult {
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

/** Deep-enough equality for poll deduplication. */
export function gitStatusEquals(a: GitStatusResult | undefined, b: GitStatusResult | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.branch !== b.branch || a.ahead !== b.ahead || a.behind !== b.behind) return false;
  if (a.files.length !== b.files.length) return false;
  for (let i = 0; i < a.files.length; i++) {
    const fa = a.files[i];
    const fb = b.files[i];
    if (fa.path !== fb.path || fa.status !== fb.status || fa.staged !== fb.staged || fa.origPath !== fb.origPath) {
      return false;
    }
  }
  return true;
}

export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: Date;
  message: string;
}

export interface GitBlameLine {
  hash: string;
  author: string;
  date: Date;
  line: number;
  content: string;
}

export interface GitDiffResult {
  file: string;
  diff: string;
  staged: boolean;
}

export interface GitCommitOptions {
  amend?: boolean;
  signoff?: boolean;
  noVerify?: boolean;
}

export interface GitBranchList {
  current: string;
  branches: string[];
}

export interface GitCommitResult {
  hash: string;
  message: string;
  filesChanged: number;
}

@injectable()
export class GitService {
  @inject(WorkspaceService) @optional()
  protected readonly workspaceService?: WorkspaceService;
  @inject(WebSocketConnectionProvider) @optional()
  protected readonly connectionProvider?: WebSocketConnectionProvider;

  /** Single-process fallback (unit tests): bind the real backend directly. */
  @inject(GitBackendService) @optional()
  protected readonly directBackend?: GitBackendService;

  protected readonly onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

  protected readonly onDidChangeStatusEmitter = new Emitter<GitStatusResult>();
  readonly onDidChangeStatus: Event<GitStatusResult> = this.onDidChangeStatusEmitter.event;

  protected repoRoot: string | undefined;
  protected cachedStatus: GitStatusResult | undefined;

  /** Public read-only access to the cached status. */
  getCachedStatus(): GitStatusResult | undefined {
    return this.cachedStatus;
  }
  protected pollingTimer: ReturnType<typeof setInterval> | undefined;
  protected refreshInFlight = false;
  protected detectTicks = 0;
  protected rpcProxy: GitBackendService | undefined;
  protected rpcFailed = false;

  @postConstruct()
  protected init(): void {
    this.pollingTimer = setInterval(() => { void this.tick(); }, 3000);
    // Detect the repo for the current workspace right away (BUG-20260826-300).
    void this.detectRepoRoot();
    // Re-detect when the workspace changes.
    this.workspaceService?.onWorkspaceChanged(() => {
      this.repoRoot = undefined;
      this.cachedStatus = undefined;
      void this.detectRepoRoot();
    });
  }

  /**
   * Poll tick: refresh cached status when a repo is known; otherwise keep
   * probing for one (a repo may be `git init`ed while the IDE is open).
   */
  protected async tick(): Promise<void> {
    if (!this.repoRoot) {
      this.detectTicks++;
      if (this.detectTicks % 4 === 0) {
        await this.detectRepoRoot();
      }
      return;
    }
    await this.refreshStatus();
  }

  /** Find the git repo nearest to the first workspace root, if any. */
  protected async detectRepoRoot(): Promise<void> {
    try {
      const root = (await this.workspaceService?.roots)?.[0];
      if (!root) return;
      const cwd = root.resource.path.toString();
      const backend = this.proxy();
      if (!backend) return;
      const found = await backend.$findNearestRepoRoot(cwd, 2);
      if (found !== this.repoRoot) {
        this.setRepoRoot(found);
      }
    } catch {
      // workspace not ready yet — retried by tick()
    }
  }

  dispose(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.onDidChangeStatusEmitter.dispose();
    this.onDidChangeEmitter.dispose();
  }

  // ---------------------------------------------------------------------------
  // Backend proxy management (mirrors SvnService pattern)
  // ---------------------------------------------------------------------------

  /** Execute `git <args>` in repoRoot via the Node backend. */
  protected async exec(args: string[], maxBuffer: number = DEFAULT_GIT_MAX_BUFFER): Promise<string> {
    const backend = this.proxy();
    if (!backend || !this.repoRoot) throw new Error('git backend unavailable');
    const result = await backend.$exec(args, this.repoRoot, maxBuffer);
    return result.stdout;
  }

  protected proxy(): GitBackendService | undefined {
    if (this.directBackend && typeof this.directBackend === 'object'
      && typeof (this.directBackend as unknown as Record<string, unknown>).$exec === 'function') {
      return this.directBackend;
    }
    if (this.rpcFailed || !this.connectionProvider) return undefined;
    if (!this.rpcProxy) {
      try {
        this.rpcProxy = this.connectionProvider.createProxy<GitBackendService>(GitBackendPath);
      } catch {
        this.rpcFailed = true;
        return undefined;
      }
    }
    return this.rpcProxy;
  }

  async findRepoRoot(cwd: string): Promise<string | undefined> {
    const backend = this.proxy();
    if (!backend) return undefined;
    return backend.$findRepoRoot(cwd);
  }

  /**
   * Resolve the repository nearest to a workspace folder.  A workspace root
   * is often a container (for example a checkout with several project
   * folders), so the detector must use the backend's bounded downward search
   * before falling back to the normal parent walk.
   */
  async findNearestRepoRoot(cwd: string, maxDepth = 2): Promise<string | undefined> {
    const backend = this.proxy();
    if (!backend) return undefined;
    return backend.$findNearestRepoRoot(cwd, maxDepth);
  }

  setRepoRoot(root: string | undefined): void {
    const normalized = root ? normalizeFsPath(root) : undefined;
    if (normalized === this.repoRoot) return;

    this.repoRoot = normalized;
    this.cachedStatus = undefined;
    // Clear old decorations/status-bar state immediately when switching
    // projects or when a repository is removed, then publish the new status
    // once the backend refresh completes.
    this.onDidChangeStatusEmitter.fire({ branch: '', files: [], ahead: 0, behind: 0 });
    this.onDidChangeEmitter.fire();
    if (normalized) {
      void this.refreshStatus();
    }
  }

  getRepoRoot(): string | undefined {
    return this.repoRoot;
  }

  protected async refreshStatus(): Promise<void> {
    if (!this.repoRoot || this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      const result = await this.getStatus();
      // Only broadcast when something actually changed — the poll timer
      // fires constantly, and unconditional events force every decorator
      // and the status bar through a full refresh cycle.
      if (!gitStatusEquals(this.cachedStatus, result)) {
        this.cachedStatus = result;
        this.onDidChangeStatusEmitter.fire(result);
      }
    } catch {
      // Silently ignore - repo might not be initialized or git not available
    } finally {
      this.refreshInFlight = false;
    }
  }

  async getStatus(): Promise<GitStatusResult> {
    if (!this.repoRoot) return { branch: '', files: [], ahead: 0, behind: 0 };

    const [branchResult, statusResult] = await Promise.allSettled([
      this.exec(['rev-parse', '--abbrev-ref', 'HEAD']),
      // -z: NUL-terminated, unquoted paths (avoids core.quotepath octal escapes)
      this.exec(['status', '--porcelain', '-b', '-z']),
    ]);

    let branch = '';
    let ahead = 0;
    let behind = 0;
    let files: GitFileStatus[] = [];

    if (branchResult.status === 'fulfilled') {
      branch = branchResult.value.trim();
    }

    if (statusResult.status === 'fulfilled') {
      const parsed = parsePorcelainStatusZ(statusResult.value);
      if (parsed.branch) branch = parsed.branch;
      ahead = parsed.ahead;
      behind = parsed.behind;
      files = parsed.files;
    }

    return { branch, files, ahead, behind };
  }

  async getHistory(maxCount: number = 50): Promise<GitCommit[]> {
    if (!this.repoRoot) return [];

    const format = '%H%x00%an%x00%ae%x00%aI%x00%s';
    try {
      const stdout = await this.exec(
        ['log', `--max-count=${maxCount}`, `--format=${format}`, '-z'],
      );
      const parts = stdout.split('\0').filter(Boolean);
      const commits: GitCommit[] = [];
      for (let i = 0; i + 4 < parts.length; i += 5) {
        commits.push({
          hash: parts[i],
          author: parts[i + 1],
          email: parts[i + 2],
          date: new Date(parts[i + 3]),
          message: parts[i + 4],
        });
      }
      return commits;
    } catch {
      return [];
    }
  }

  async getCommitDetail(hash: string): Promise<GitCommit | undefined> {
    if (!this.repoRoot) return undefined;

    const format = '%H%x00%an%x00%ae%x00%aI%x00%s%n%b';
    try {
      const stdout = await this.exec(['log', '-1', hash, `--format=${format}`, '-z']);
      const parts = stdout.split('\0').filter(Boolean);
      if (parts.length >= 5) {
        return {
          hash: parts[0],
          author: parts[1],
          email: parts[2],
          date: new Date(parts[3]),
          message: parts.slice(4).join('\n').trim(),
        };
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  async getBlame(filePath: string): Promise<GitBlameLine[]> {
    if (!this.repoRoot) return [];

    try {
      const stdout = await this.exec(['blame', '--line-porcelain', '--', filePath]);
      const lines = stdout.split('\n');
      const result: GitBlameLine[] = [];
      let current: Partial<GitBlameLine> = {};

      for (const line of lines) {
        const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)\s*(\d*)/);
        if (headerMatch) {
          if (current.hash && current.line !== undefined) {
            result.push(current as GitBlameLine);
          }
          current = {
            hash: headerMatch[1],
            line: parseInt(headerMatch[3], 10),
            content: '',
          };
          continue;
        }
        if (line.startsWith('author ')) {
          current.author = line.substring(7);
        } else if (line.startsWith('author-time ')) {
          const ts = parseInt(line.substring(12), 10);
          current.date = new Date(ts * 1000);
        } else if (line.startsWith('\t')) {
          current.content = line.substring(1);
        }
      }
      if (current.hash && current.line !== undefined) {
        result.push(current as GitBlameLine);
      }
      return result;
    } catch {
      return [];
    }
  }

  getFileStatus(filePath: string): GitFileStatus | undefined {
    if (!this.cachedStatus) return undefined;
    const normalized = filePath.replace(/\\/g, '/');
    return this.cachedStatus.files.find(f => f.path === filePath || f.path === normalized);
  }

  async getDiff(file: string, staged: boolean = false): Promise<GitDiffResult> {
    if (!this.repoRoot) return { file, diff: '', staged };
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--', file);
    try {
      const stdout = await this.exec(args);
      return { file, diff: stdout, staged };
    } catch {
      return { file, diff: '', staged };
    }
  }

  async stageFiles(files: string[]): Promise<void> {
    if (!this.repoRoot || files.length === 0) return;
    await this.exec(['add', '--', ...files]);
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async unstageFiles(files: string[]): Promise<void> {
    if (!this.repoRoot || files.length === 0) return;
    await this.exec(['reset', 'HEAD', '--', ...files]);
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async stageAll(): Promise<void> {
    if (!this.repoRoot) return;
    await this.exec(['add', '-A']);
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async unstageAll(): Promise<void> {
    if (!this.repoRoot) return;
    await this.exec(['reset', 'HEAD']);
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async commit(message: string, amendOrOptions: boolean | GitCommitOptions = false): Promise<GitCommitResult> {
    if (!this.repoRoot) throw new Error('No repo root');
    const options: GitCommitOptions = typeof amendOrOptions === 'boolean'
      ? { amend: amendOrOptions }
      : amendOrOptions;
    const args = ['commit', '-m', message];
    if (options.amend) args.push('--amend');
    if (options.signoff) args.push('--signoff');
    if (options.noVerify) args.push('--no-verify');
    const stdout = await this.exec(args);
    let hash = '';
    try {
      hash = (await this.exec(['rev-parse', '--short', 'HEAD'])).trim();
    } catch {
      // leave empty
    }
    let filesChanged = 0;
    try {
      const stat = await this.exec(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
      filesChanged = stat.trim().split('\n').filter(Boolean).length;
    } catch {
      // VC-P2-12: fall back to locale-dependent stdout only if diff-tree fails.
      const changedMatch = /(\d+) files? changed/.exec(stdout);
      filesChanged = changedMatch ? parseInt(changedMatch[1], 10) : 0;
    }
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
    return { hash, message, filesChanged };
  }

  /** Run a git command and return trimmed stdout via the Node backend. */
  protected async run(args: string[]): Promise<string> {
    if (!this.repoRoot) throw new Error('No git repository');
    try {
      const stdout = await this.exec(args);
      this.refreshStatus();
      this.onDidChangeEmitter.fire();
      return stdout.trim();
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr || e.message || 'git failed').trim();
      throw new Error(detail);
    }
  }

  async push(remote?: string, branch?: string): Promise<string> {
    const args = ['push'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    return this.run(args);
  }

  async pull(remote?: string, branch?: string): Promise<string> {
    const args = ['pull'];
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    return this.run(args);
  }

  async fetch(remote?: string): Promise<string> {
    const args = ['fetch', '--prune'];
    if (remote) args.push(remote);
    return this.run(args);
  }

  async listBranches(): Promise<GitBranchList> {
    const out = await this.run(['branch', '--format=%(refname:short)']);
    const branches = out.split('\n').map(b => b.trim()).filter(Boolean);
    let current = '';
    try {
      current = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])) || '';
    } catch {
      // detached HEAD etc.
    }
    return { current, branches };
  }

  async createBranch(name: string, checkout: boolean = true): Promise<string> {
    if (!name.trim()) throw new Error('Branch name required');
    return checkout ? this.run(['checkout', '-b', name.trim()]) : this.run(['branch', name.trim()]);
  }

  async switchBranch(name: string): Promise<string> {
    return this.run(['checkout', name.trim()]);
  }

  /**
   * Discard unstaged changes of tracked files. Untracked files are left
   * untouched on purpose — destructive clean is a separate decision.
   */
  async discardFileChanges(files: string[]): Promise<string> {
    if (!files.length) throw new Error('No files to discard');
    return this.run(['checkout', '--', ...files]);
  }
}
