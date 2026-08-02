import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { SvnService } from './svn-service';
import { SvnStore } from './svn-store';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/browser/quick-input/quick-input-service';
import { KairoI18nService } from '@kairo/i18n';

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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected readonly statusBarId = 'kairo-svn-status';

  @postConstruct()
  protected init(): void {
    this.svnService.onSvnAvailabilityChange(() => this.updateStatusBar());
    this.svnService.onDidChangeStatus(() => this.updateStatusBar());
    this.svnService.onDidUpdateComplete(() => this.updateStatusBar());
    this.svnStore.onDidChange(() => this.updateStatusBar());
    this.i18n.onDidChangeLanguage(() => this.updateStatusBar());

    this.commandRegistry.registerCommand(SVN_STATUS_BAR_COMMAND, {
      execute: () => this.showQuickActions(),
    });
  }

  onStart(): void {
    this.updateStatusBar();
  }

  protected updateStatusBar(): void {
    const t = this.i18n.t.bind(this.i18n);
    const installation = this.svnService.getSvnInstallation();
    const wcRoot = this.svnService.getActiveWcRoot();
    const wcInfo = this.svnService.getWcInfoCache();
    const state = this.svnStore.getState();

    if (!installation) {
      this.statusBar.setElement(this.statusBarId, {
        text: `$(source-control) ${t('statusBar.svnNotFound')}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 100,
        tooltip: t('statusBar.svnNotFoundTooltip'),
        command: SVN_STATUS_BAR_COMMAND.id,
        className: 'kairo-statusbar-group-1 kairo-statusbar-placeholder',
      });
      return;
    }

    if (!wcRoot || !wcInfo) {
      const version = installation.version.split(' ')[0];
      this.statusBar.setElement(this.statusBarId, {
        text: `$(git-branch) ${t('statusBar.svnVersion', { version })}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 100,
        tooltip: t('statusBar.svnVersionTooltip', { version: installation.version }),
        command: SVN_STATUS_BAR_COMMAND.id,
        className: 'kairo-statusbar-group-1 kairo-statusbar-placeholder',
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
      { label: '$(cloud-download) Update Project…', execute: () => { void this.commandRegistry.executeCommand('svn.update'); } },
      { label: '$(check) Commit…', execute: () => { void this.commandRegistry.executeCommand('svn.commit'); } },
      { label: '$(history) Show History', execute: () => { void this.commandRegistry.executeCommand('svn.showHistory'); } },
      { label: '$(git-merge) Merge…', execute: () => { void this.commandRegistry.executeCommand('svn.merge'); } },
      { label: '$(git-branch) Branch / Tag…', execute: () => { void this.commandRegistry.executeCommand('svn.branchTag'); } },
      { label: '$(arrow-swap) Switch…', execute: () => { void this.commandRegistry.executeCommand('svn.switch'); } },
      { label: '$(warning) Resolve Conflicts…', execute: () => { void this.commandRegistry.executeCommand('svn.resolve'); } },
      { label: '$(refresh) Refresh Status', execute: () => { void this.svnStore.refresh(); } },
      { label: '$(desktop-download) Checkout…', execute: () => { void this.commandRegistry.executeCommand('svn.checkout'); } },
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
