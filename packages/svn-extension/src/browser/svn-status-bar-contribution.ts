import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/browser/quick-input/quick-input-service';

export const SVN_STATUS_BAR_COMMAND = {
  id: 'svn.statusBar.click',
  label: 'SVN Quick Actions',
};

@injectable()
export class SvnStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) protected readonly statusBar!: StatusBar;
  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(SvnStore) protected readonly svnStore!: SvnStore;
  @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(QuickInputService) protected readonly quickInputService!: QuickInputService;

  protected readonly statusBarId = 'kairo-svn-status';

  @postConstruct()
  protected init(): void {
    this.svnService.onSvnAvailabilityChange(() => this.updateStatusBar());
    this.svnService.onDidChangeStatus(() => this.updateStatusBar());
    this.svnService.onDidUpdateComplete(() => this.updateStatusBar());
    this.svnStore.onDidChange(() => this.updateStatusBar());

    this.commandRegistry.registerCommand(SVN_STATUS_BAR_COMMAND, {
      execute: () => this.showQuickActions(),
    });
  }

  onStart(): void {
    this.updateStatusBar();
  }

  protected updateStatusBar(): void {
    const installation = this.svnService.getSvnInstallation();
    const wcRoot = this.svnService.getActiveWcRoot();
    const wcInfo = this.svnService.getWcInfoCache();
    const state = this.svnStore.getState();

    if (!installation) {
      this.statusBar.setElement(this.statusBarId, {
        text: '$(source-control) SVN: not found',
        alignment: StatusBarAlignment.LEFT,
        priority: 100,
        tooltip: 'SVN client not detected. Click to configure.',
        command: SVN_STATUS_BAR_COMMAND.id,
      });
      return;
    }

    if (!wcRoot || !wcInfo) {
      this.statusBar.setElement(this.statusBarId, {
        text: `$(git-branch) SVN: ${installation.version.split(' ')[0]}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 100,
        tooltip: `SVN client ${installation.version} (no working copy open). Click for actions.`,
        command: SVN_STATUS_BAR_COMMAND.id,
      });
      return;
    }

    const branchName = this.svnService.getBranchNameFromUrl(wcInfo.url);
    const totalChanges = this.svnStore.getTotalChanges();
    const changesText = totalChanges > 0 ? ` | ${totalChanges} changes` : '';
    const conflictText = state.conflictedFiles.length > 0 ? ` | ${state.conflictedFiles.length} conflicts` : '';

    this.statusBar.setElement(this.statusBarId, {
      text: `$(git-branch) ${branchName} | r${wcInfo.revision}${changesText}${conflictText}`,
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      tooltip: `SVN Working Copy
Root: ${wcRoot}
URL: ${wcInfo.url}
Revision: ${wcInfo.revision}
Last Changed: ${wcInfo.lastChangedAuthor} @ ${wcInfo.lastChangedDate.toLocaleString()}
Click for quick actions.`,
      command: SVN_STATUS_BAR_COMMAND.id,
    });
  }

  protected async showQuickActions(): Promise<void> {
    interface SvnQuickPickItem extends QuickPickItem {
      execute: () => void;
    }
    const items: SvnQuickPickItem[] = [
      { label: '$(cloud-download) Update Project', execute: () => { void this.svnStore.update().catch(e => console.error('Update failed:', e)); } },
      { label: '$(check) Commit...', execute: () => { void this.commandRegistry.executeCommand('svn.commit'); } },
      { label: '$(history) Show History', execute: () => { void this.commandRegistry.executeCommand('svn.showHistory'); } },
      { label: '$(refresh) Refresh Status', execute: () => { void this.svnStore.refresh(); } },
      { label: '$(repo) Checkout...', execute: () => { void this.commandRegistry.executeCommand('svn.checkout'); } },
      { label: '$(repo) Browse Repository', execute: () => { void this.commandRegistry.executeCommand('svn.browseRepo'); } },
    ];

    const selected = await this.quickInputService.showQuickPick<SvnQuickPickItem>(items, {
      placeholder: 'SVN Quick Actions',
    });
    if (selected) {
      selected.execute();
    }
  }
}
