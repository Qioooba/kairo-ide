import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitService } from './git-service';

const execFileAsync = promisify(execFile);

export type CherryPickStatus = 'idle' | 'in-progress' | 'conflict';

export interface CherryPickState {
  status: CherryPickStatus;
  currentHash?: string;
  currentMessage?: string;
  remainingHashes: string[];
}

@injectable()
export class GitCherryPickService {
  @inject(GitService) protected readonly gitService!: GitService;

  protected readonly onDidChangeStateEmitter = new Emitter<CherryPickState>();
  readonly onDidChangeState: Event<CherryPickState> = this.onDidChangeStateEmitter.event;

  protected readonly onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

  private state: CherryPickState = { status: 'idle', remainingHashes: [] };

  private getCwd(): string {
    return this.gitService.getRepoRoot() || (typeof process !== 'undefined' ? process.cwd() : '');
  }

  private async execGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.getCwd() });
    return stdout;
  }

  getState(): CherryPickState {
    return { ...this.state };
  }

  async cherryPick(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    this.state = {
      status: 'in-progress',
      currentHash: hashes[0],
      currentMessage: '',
      remainingHashes: hashes.slice(1),
    };
    this.onDidChangeStateEmitter.fire(this.state);

    try {
      await this.execGit(['cherry-pick', ...hashes]);
      this.state = { status: 'idle', remainingHashes: [] };
      this.onDidChangeStateEmitter.fire(this.state);
      this.onDidChangeEmitter.fire();
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string }).stderr || '';
      const msg = err instanceof Error ? err.message : String(err);
      if (stderr.includes('CONFLICT') || msg.includes('conflict') || stderr.includes('conflict')) {
        this.state = { ...this.state, status: 'conflict' };
        this.onDidChangeStateEmitter.fire(this.state);
      } else {
        this.state = { status: 'idle', remainingHashes: [] };
        this.onDidChangeStateEmitter.fire(this.state);
        throw err;
      }
    }
  }

  async cherryPickSingle(hash: string): Promise<void> {
    return this.cherryPick([hash]);
  }

  async continue(): Promise<void> {
    if (this.state.remainingHashes.length > 0) {
      const nextHash = this.state.remainingHashes[0];
      this.state = {
        status: 'in-progress',
        currentHash: nextHash,
        currentMessage: '',
        remainingHashes: this.state.remainingHashes.slice(1),
      };
      this.onDidChangeStateEmitter.fire(this.state);
      try {
        await this.execGit(['cherry-pick', '--continue']);
        // After --continue, we need to cherry-pick the next one
        await this.execGit(['cherry-pick', nextHash]);
        this.state = { status: 'idle', remainingHashes: [] };
        this.onDidChangeStateEmitter.fire(this.state);
        this.onDidChangeEmitter.fire();
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr || '';
        const msg = err instanceof Error ? err.message : String(err);
        if (stderr.includes('CONFLICT') || msg.includes('conflict') || stderr.includes('conflict')) {
          this.state = { ...this.state, status: 'conflict' };
          this.onDidChangeStateEmitter.fire(this.state);
        } else {
          this.state = { status: 'idle', remainingHashes: [] };
          this.onDidChangeStateEmitter.fire(this.state);
          throw err;
        }
      }
    } else {
      await this.execGit(['cherry-pick', '--continue']);
      this.state = { status: 'idle', remainingHashes: [] };
      this.onDidChangeStateEmitter.fire(this.state);
      this.onDidChangeEmitter.fire();
    }
  }

  async abort(): Promise<void> {
    await this.execGit(['cherry-pick', '--abort']);
    this.state = { status: 'idle', remainingHashes: [] };
    this.onDidChangeStateEmitter.fire(this.state);
    this.onDidChangeEmitter.fire();
  }

  async isCherryPickInProgress(): Promise<boolean> {
    try {
      const cwd = this.getCwd();
      const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd });
      const gitDir = stdout.trim();
      const fs = await import('node:fs/promises');
      const cherryPickHead = gitDir + '/CHERRY_PICK_HEAD';
      await fs.access(cherryPickHead);
      return true;
    } catch {
      return false;
    }
  }
}
