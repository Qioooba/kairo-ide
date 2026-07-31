import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitService } from './git-service';

const execFileAsync = promisify(execFile);

export interface GitStashEntry {
  ref: string;
  index: number;
  message: string;
  branch: string;
  hash: string;
  date: Date;
}

export interface GitStashShowResult {
  ref: string;
  diff: string;
  stat: string;
}

@injectable()
export class GitStashService {
  @inject(GitService) protected readonly gitService!: GitService;

  protected readonly onDidChangeStashEmitter = new Emitter<GitStashEntry[]>();
  readonly onDidChangeStash: Event<GitStashEntry[]> = this.onDidChangeStashEmitter.event;

  protected readonly onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

  private getCwd(): string {
    return this.gitService.getRepoRoot() || (typeof process !== 'undefined' ? process.cwd() : '');
  }

  private async execGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.getCwd() });
    return stdout;
  }

  async list(): Promise<GitStashEntry[]> {
    try {
      const stdout = await this.execGit([
        'stash', 'list', '--format=%gd%x00%H%x00%gs%x00%aI',
      ]);
      const parts = stdout.trim().split('\0').filter(Boolean);
      const entries: GitStashEntry[] = [];
      for (let i = 0; i + 3 < parts.length; i += 4) {
        const ref = parts[i];
        const hash = parts[i + 1];
        const message = parts[i + 2];
        const dateStr = parts[i + 3];
        const idxMatch = ref.match(/stash@\{(\d+)\}/);
        const index = idxMatch ? parseInt(idxMatch[1], 10) : i;
        const branchMatch = message.match(/(?:On|WIP on)\s+(.+?)(?:$|:)/);
        const branch = branchMatch ? branchMatch[1] : '';
        entries.push({
          ref, index, hash,
          message: message.replace(/^WIP on /, '').replace(/^On /, ''),
          branch, date: new Date(dateStr),
        });
      }
      return entries;
    } catch {
      return [];
    }
  }

  async push(message?: string, includeUntracked: boolean = false, stagedOnly: boolean = false): Promise<void> {
    const args = ['stash', 'push'];
    if (stagedOnly) args.push('--staged');
    if (includeUntracked) args.push('--include-untracked');
    if (message) args.push('-m', message);
    await this.execGit(args);
    this.onDidChangeStashEmitter.fire(await this.list());
    this.onDidChangeEmitter.fire();
  }

  async pop(ref?: string, index?: boolean): Promise<void> {
    const args = ['stash', 'pop'];
    if (index) args.push('--index');
    await this.execGit([...args, ref || 'stash@{0}']);
    this.onDidChangeStashEmitter.fire(await this.list());
    this.onDidChangeEmitter.fire();
  }

  async apply(ref?: string, index?: boolean): Promise<void> {
    const args = ['stash', 'apply'];
    if (index) args.push('--index');
    await this.execGit([...args, ref || 'stash@{0}']);
    this.onDidChangeStashEmitter.fire(await this.list());
    this.onDidChangeEmitter.fire();
  }

  async drop(ref?: string): Promise<void> {
    try {
      await this.execGit(['stash', 'drop', ref || 'stash@{0}']);
    } catch { /* ignore */ }
    this.onDidChangeStashEmitter.fire(await this.list());
    this.onDidChangeEmitter.fire();
  }

  async show(ref?: string): Promise<GitStashShowResult> {
    const target = ref || 'stash@{0}';
    const [diffResult, statResult] = await Promise.allSettled([
      this.execGit(['stash', 'show', '-p', target]),
      this.execGit(['stash', 'show', '--stat', target]),
    ]);
    return {
      ref: target,
      diff: diffResult.status === 'fulfilled' ? diffResult.value : '',
      stat: statResult.status === 'fulfilled' ? statResult.value : '',
    };
  }

  async pushStaged(message?: string): Promise<void> {
    return this.push(message, false, true);
  }

  async clear(): Promise<void> {
    await this.execGit(['stash', 'clear']);
    this.onDidChangeStashEmitter.fire([]);
    this.onDidChangeEmitter.fire();
  }
}
