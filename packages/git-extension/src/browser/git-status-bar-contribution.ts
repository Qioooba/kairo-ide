import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StatusBar, StatusBarAlignment, StatusBarEntry } from '@theia/core/lib/browser/status-bar/status-bar-types';
import { GitService } from './git-service';
import { GitCherryPickService } from './git-cherrypick-service';

@injectable()
export class GitStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) protected statusBar!: StatusBar;
  @inject(GitService) protected gitService!: GitService;
  @inject(GitCherryPickService) protected cherryPickService!: GitCherryPickService;

  protected static readonly ID = 'kairo-git-status';
  protected static readonly CHERRY_PICK_ID = 'kairo-git-cherrypick-status';

  @postConstruct()
  protected init(): void {
    this.gitService.onDidChangeStatus(() => this.updateStatusBar());
    this.cherryPickService.onDidChangeState(() => this.updateCherryPickStatus());
  }

  onStart(): void {
    this.updateStatusBar();
    this.updateCherryPickStatus();
  }

  protected async updateCherryPickStatus(): Promise<void> {
    const state = this.cherryPickService.getState();
    if (state.status === 'idle') {
      await this.statusBar.removeElement(GitStatusBarContribution.CHERRY_PICK_ID);
      return;
    }

    let text = '';
    if (state.status === 'in-progress') {
      text = '$(git-merge) Cherry-picking...';
      if (state.currentHash) {
        const shortHash = state.currentHash.substring(0, 7);
        text += ` ${shortHash}`;
      }
      if (state.remainingHashes.length > 0) {
        text += ` (${state.remainingHashes.length} remaining)`;
      }
    } else if (state.status === 'conflict') {
      text = '$(warning) Cherry-pick conflict!';
      if (state.currentHash) {
        text += ` ${state.currentHash.substring(0, 7)}`;
      }
    }

    const entry: StatusBarEntry = {
      text,
      alignment: StatusBarAlignment.LEFT,
      command: state.status === 'conflict' ? 'kairo-git-cherrypick:abort' : undefined,
      tooltip: state.status === 'conflict'
        ? 'Cherry-pick conflict. Click to abort, or resolve conflicts and continue.'
        : 'Cherry-pick in progress...',
      priority: 90,
    };

    await this.statusBar.setElement(GitStatusBarContribution.CHERRY_PICK_ID, entry);
  }

  protected async updateStatusBar(): Promise<void> {
    const repoRoot = this.gitService.getRepoRoot();
    if (!repoRoot) {
      await this.statusBar.removeElement(GitStatusBarContribution.ID);
      return;
    }

    const status = this.gitService.getCachedStatus();
    if (!status) {
      await this.statusBar.removeElement(GitStatusBarContribution.ID);
      return;
    }

    let text = `$(git-branch) ${status.branch}`;
    if (status.ahead > 0) text += ` ↑${status.ahead}`;
    if (status.behind > 0) text += ` ↓${status.behind}`;

    const changedCount = status.files.filter(f => f.status !== '?' && f.status !== ' ').length;
    if (changedCount > 0) {
      text += ` +${changedCount}`;
    }

    const entry: StatusBarEntry = {
      text,
      alignment: StatusBarAlignment.LEFT,
      tooltip: this.buildTooltip(status),
      priority: 100,
    };

    await this.statusBar.setElement(GitStatusBarContribution.ID, entry);
  }

  protected buildTooltip(status: { branch: string; files: { path: string; status: string }[] }): string {
    const lines: string[] = [`Branch: ${status.branch}`];
    const modified = status.files.filter(f => f.status === 'M');
    const added = status.files.filter(f => f.status === 'A');
    const deleted = status.files.filter(f => f.status === 'D');
    const untracked = status.files.filter(f => f.status === '?');

    if (modified.length) lines.push(`Modified: ${modified.length}`);
    if (added.length) lines.push(`Added: ${added.length}`);
    if (deleted.length) lines.push(`Deleted: ${deleted.length}`);
    if (untracked.length) lines.push(`Untracked: ${untracked.length}`);

    return lines.join('\n');
  }
}