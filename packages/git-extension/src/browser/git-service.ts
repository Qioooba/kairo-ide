import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeFsPath, parsePorcelainStatusZ } from './git-path-utils';

const execFileAsync = promisify(execFile);

/** Force C locale so ahead/behind and commit summaries stay machine-parseable. */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...(typeof process !== 'undefined' ? process.env : {}),
    LANG: 'C',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
}

function gitOpts(cwd: string, extra?: { maxBuffer?: number }): { cwd: string; env: NodeJS.ProcessEnv; maxBuffer?: number } {
  return { cwd, env: gitEnv(), ...extra };
}

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

export interface GitCommitResult {
  hash: string;
  message: string;
  filesChanged: number;
}

@injectable()
export class GitService {
  protected readonly onDidChangeStatusEmitter = new Emitter<GitStatusResult>();
  readonly onDidChangeStatus: Event<GitStatusResult> = this.onDidChangeStatusEmitter.event;

  protected readonly onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

  protected repoRoot: string | undefined;
  protected cachedStatus: GitStatusResult | undefined;

  /** Public read-only access to the cached status. */
  getCachedStatus(): GitStatusResult | undefined {
    return this.cachedStatus;
  }
  protected pollingTimer: ReturnType<typeof setInterval> | undefined;
  protected refreshInFlight = false;

  @postConstruct()
  protected init(): void {
    this.pollingTimer = setInterval(() => { void this.refreshStatus(); }, 3000);
  }

  dispose(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.onDidChangeStatusEmitter.dispose();
    this.onDidChangeEmitter.dispose();
  }

  async findRepoRoot(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], gitOpts(cwd));
      return normalizeFsPath(stdout.trim());
    } catch {
      return undefined;
    }
  }

  setRepoRoot(root: string): void {
    this.repoRoot = normalizeFsPath(root);
    this.refreshStatus();
  }

  getRepoRoot(): string | undefined {
    return this.repoRoot;
  }

  protected async refreshStatus(): Promise<void> {
    if (!this.repoRoot || this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      const result = await this.getStatus();
      this.cachedStatus = result;
      this.onDidChangeStatusEmitter.fire(result);
    } catch {
      // Silently ignore - repo might not be initialized or git not available
    } finally {
      this.refreshInFlight = false;
    }
  }

  async getStatus(): Promise<GitStatusResult> {
    if (!this.repoRoot) return { branch: '', files: [], ahead: 0, behind: 0 };

    const opts = gitOpts(this.repoRoot);

    const [branchResult, statusResult] = await Promise.allSettled([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
      // -z: NUL-terminated, unquoted paths (avoids core.quotepath octal escapes)
      execFileAsync('git', ['status', '--porcelain', '-b', '-z'], opts),
    ]);

    let branch = '';
    let ahead = 0;
    let behind = 0;
    let files: GitFileStatus[] = [];

    if (branchResult.status === 'fulfilled') {
      branch = branchResult.value.stdout.trim();
    }

    if (statusResult.status === 'fulfilled') {
      const parsed = parsePorcelainStatusZ(statusResult.value.stdout);
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
      const { stdout } = await execFileAsync(
        'git',
        ['log', `--max-count=${maxCount}`, `--format=${format}`, '-z'],
        gitOpts(this.repoRoot, { maxBuffer: 10 * 1024 * 1024 }),
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
      const { stdout } = await execFileAsync(
        'git',
        ['log', '-1', hash, `--format=${format}`, '-z'],
        gitOpts(this.repoRoot, { maxBuffer: 10 * 1024 * 1024 }),
      );
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
      const { stdout } = await execFileAsync(
        'git',
        ['blame', '--line-porcelain', '--', filePath],
        gitOpts(this.repoRoot, { maxBuffer: 10 * 1024 * 1024 }),
      );
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
      const { stdout } = await execFileAsync('git', args, gitOpts(this.repoRoot));
      return { file, diff: stdout, staged };
    } catch {
      return { file, diff: '', staged };
    }
  }

  async stageFiles(files: string[]): Promise<void> {
    if (!this.repoRoot || files.length === 0) return;
    await execFileAsync('git', ['add', '--', ...files], gitOpts(this.repoRoot));
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async unstageFiles(files: string[]): Promise<void> {
    if (!this.repoRoot || files.length === 0) return;
    await execFileAsync('git', ['reset', 'HEAD', '--', ...files], gitOpts(this.repoRoot));
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async stageAll(): Promise<void> {
    if (!this.repoRoot) return;
    await execFileAsync('git', ['add', '-A'], gitOpts(this.repoRoot));
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async unstageAll(): Promise<void> {
    if (!this.repoRoot) return;
    await execFileAsync('git', ['reset', 'HEAD'], gitOpts(this.repoRoot));
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
    const { stdout } = await execFileAsync('git', args, gitOpts(this.repoRoot));
    let hash = '';
    try {
      const head = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], gitOpts(this.repoRoot));
      hash = head.stdout.trim();
    } catch {
      // leave empty
    }
    let filesChanged = 0;
    try {
      const stat = await execFileAsync(
        'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
        gitOpts(this.repoRoot),
      );
      filesChanged = stat.stdout.trim().split('\n').filter(Boolean).length;
    } catch {
      // VC-P2-12: fall back to locale-dependent stdout only if diff-tree fails.
      const changedMatch = stdout.match(/(\d+) files? changed/);
      filesChanged = changedMatch ? parseInt(changedMatch[1], 10) : 0;
    }
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
    return { hash, message, filesChanged };
  }
}
