import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
  protected pollingTimer: ReturnType<typeof setInterval> | undefined;

  @postConstruct()
  protected init(): void {
    this.pollingTimer = setInterval(() => this.refreshStatus(), 3000);
  }

  dispose(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.onDidChangeStatusEmitter.dispose();
  }

  async findRepoRoot(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  setRepoRoot(root: string): void {
    this.repoRoot = root;
    this.refreshStatus();
  }

  getRepoRoot(): string | undefined {
    return this.repoRoot;
  }

  protected async refreshStatus(): Promise<void> {
    if (!this.repoRoot) return;
    try {
      const result = await this.getStatus();
      this.cachedStatus = result;
      this.onDidChangeStatusEmitter.fire(result);
    } catch {
      // Silently ignore - repo might not be initialized or git not available
    }
  }

  async getStatus(): Promise<GitStatusResult> {
    if (!this.repoRoot) return { branch: '', files: [], ahead: 0, behind: 0 };

    const opts = { cwd: this.repoRoot };

    const [branchResult, statusResult] = await Promise.allSettled([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
      execFileAsync('git', ['status', '--porcelain', '-b'], opts),
    ]);

    let branch = '';
    let ahead = 0;
    let behind = 0;
    const files: GitFileStatus[] = [];

    if (branchResult.status === 'fulfilled') {
      branch = branchResult.value.stdout.trim();
    }

    if (statusResult.status === 'fulfilled') {
      const lines = statusResult.value.stdout.trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        if (line.startsWith('## ')) {
          const branchLine = line.substring(3);
          const spaceIdx = branchLine.indexOf(' ');
          if (spaceIdx > 0) {
            branch = branchLine.substring(0, spaceIdx).split('...')[0];
            const info = branchLine.substring(spaceIdx + 1);
            const aheadMatch = info.match(/ahead\s+(\d+)/);
            const behindMatch = info.match(/behind\s+(\d+)/);
            if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
            if (behindMatch) behind = parseInt(behindMatch[1], 10);
          } else {
            branch = branchLine.split('...')[0];
          }
          continue;
        }
        if (line.length >= 3) {
          const xy = line.substring(0, 2);
          const rest = line.substring(3);
          const staged = xy[0] !== ' ';
          const statusChar = xy.trim() || ' ';
          if (xy.includes('R') || xy.includes('C')) {
            const arrowIdx = rest.indexOf(' -> ');
            if (arrowIdx > 0) {
              files.push({
                status: statusChar,
                path: rest.substring(arrowIdx + 4),
                origPath: rest.substring(0, arrowIdx),
                staged,
              });
              continue;
            }
          }
          files.push({
            status: statusChar,
            path: rest,
            staged,
          });
        }
      }
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
        { cwd: this.repoRoot, maxBuffer: 10 * 1024 * 1024 },
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
        { cwd: this.repoRoot, maxBuffer: 10 * 1024 * 1024 },
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
        ['blame', '--line-porcelain', filePath],
        { cwd: this.repoRoot, maxBuffer: 10 * 1024 * 1024 },
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
    return this.cachedStatus.files.find(f => f.path === filePath);
  }

  async getDiff(file: string, staged: boolean = false): Promise<GitDiffResult> {
    if (!this.repoRoot) return { file, diff: '', staged };
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--', file);
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: this.repoRoot });
      return { file, diff: stdout, staged };
    } catch {
      return { file, diff: '', staged };
    }
  }

  async stageFiles(files: string[]): Promise<void> {
    if (!this.repoRoot) return;
    await execFileAsync('git', ['add', ...files], { cwd: this.repoRoot });
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async unstageFiles(files: string[]): Promise<void> {
    if (!this.repoRoot) return;
    await execFileAsync('git', ['reset', 'HEAD', '--', ...files], { cwd: this.repoRoot });
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async stageAll(): Promise<void> {
    if (!this.repoRoot) return;
    await execFileAsync('git', ['add', '-A'], { cwd: this.repoRoot });
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async unstageAll(): Promise<void> {
    if (!this.repoRoot) return;
    await execFileAsync('git', ['reset', 'HEAD'], { cwd: this.repoRoot });
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
  }

  async commit(message: string, amend: boolean = false): Promise<GitCommitResult> {
    if (!this.repoRoot) throw new Error('No repo root');
    const args = ['commit', '-m', message];
    if (amend) args.push('--amend');
    const { stdout } = await execFileAsync('git', args, { cwd: this.repoRoot });
    const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
    const hash = hashMatch ? hashMatch[1] : '';
    const changedMatch = stdout.match(/(\d+) files? changed/);
    const filesChanged = changedMatch ? parseInt(changedMatch[1], 10) : 0;
    this.refreshStatus();
    this.onDidChangeEmitter.fire();
    return { hash, message, filesChanged };
  }
}