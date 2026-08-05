import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitService } from './git-service';

const execFileAsync = promisify(execFile);

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...(typeof process !== 'undefined' ? process.env : {}),
    LANG: 'C',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
}

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
    const { stdout } = await execFileAsync('git', args, { cwd: this.getCwd(), env: gitEnv() });
    return stdout;
  }

  getState(): CherryPickState {
    return { ...this.state };
  }

  /** Locale-independent: conflict leaves CHERRY_PICK_HEAD (or unmerged index entries). */
  private async isConflictState(): Promise<boolean> {
    if (await this.isCherryPickInProgress()) {
      return true;
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '-u'],
        { cwd: this.getCwd(), env: gitEnv() },
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
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
      // Let git's sequencer own the full list — do not re-apply hashes after --continue.
      await this.execGit(['cherry-pick', ...hashes]);
      this.state = { status: 'idle', remainingHashes: [] };
      this.onDidChangeStateEmitter.fire(this.state);
      this.onDidChangeEmitter.fire();
    } catch (err: unknown) {
      if (await this.isConflictState()) {
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
    // git cherry-pick --continue resumes the current commit and then any
    // remaining commits in the sequencer. Do NOT manually cherry-pick the
    // next hash (that would apply it twice).
    try {
      await this.execGit(['cherry-pick', '--continue']);
      this.state = { status: 'idle', remainingHashes: [] };
      this.onDidChangeStateEmitter.fire(this.state);
      this.onDidChangeEmitter.fire();
    } catch (err: unknown) {
      if (await this.isConflictState()) {
        this.state = { ...this.state, status: 'conflict' };
        this.onDidChangeStateEmitter.fire(this.state);
      } else {
        this.state = { status: 'idle', remainingHashes: [] };
        this.onDidChangeStateEmitter.fire(this.state);
        throw err;
      }
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
      const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd, env: gitEnv() });
      const gitDir = stdout.trim();
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const cherryPickHead = path.join(gitDir, 'CHERRY_PICK_HEAD');
      await fs.access(cherryPickHead);
      return true;
    } catch {
      return false;
    }
  }
}
