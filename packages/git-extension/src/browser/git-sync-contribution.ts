import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import {
  QuickInputService,
} from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import { GitService } from './git-service';
import { toRepoRelativePath } from './git-path-utils';

export const GIT_SYNC_COMMANDS = {
  PULL: 'kairo.git.pull',
  PUSH: 'kairo.git.push',
  FETCH: 'kairo.git.fetch',
  BRANCH_CREATE: 'kairo.git.branch.create',
  BRANCH_SWITCH: 'kairo.git.branch.switch',
  DISCARD: 'kairo.git.discard',
} as const;

function cmd(id: string, label: string): Command {
  return { id, label, category: 'Git' };
}

export const GIT_PULL_COMMAND = cmd(GIT_SYNC_COMMANDS.PULL, 'Pull');
export const GIT_PUSH_COMMAND = cmd(GIT_SYNC_COMMANDS.PUSH, 'Push');
export const GIT_FETCH_COMMAND = cmd(GIT_SYNC_COMMANDS.FETCH, 'Fetch');
export const GIT_BRANCH_CREATE_COMMAND = cmd(GIT_SYNC_COMMANDS.BRANCH_CREATE, 'Create Branch...');
export const GIT_BRANCH_SWITCH_COMMAND = cmd(GIT_SYNC_COMMANDS.BRANCH_SWITCH, 'Switch Branch...');
export const GIT_DISCARD_COMMAND = cmd(GIT_SYNC_COMMANDS.DISCARD, 'Discard File Changes');

/**
 * Remote sync / branch / discard commands on top of GitService.
 * Complements the existing changes/commit/history/stash/cherry-pick set so
 * day-to-day Git work needs no external terminal.
 */
@injectable()
export class GitSyncContribution {
  @inject(GitService) protected readonly gitService!: GitService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(QuickInputService) protected readonly quickInput!: QuickInputService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GIT_PULL_COMMAND, {
      execute: () => void this.runSync(() => this.gitService.pull(), 'pull'),
    });
    commands.registerCommand(GIT_PUSH_COMMAND, {
      execute: () => void this.runSync(() => this.gitService.push(), 'push'),
    });
    commands.registerCommand(GIT_FETCH_COMMAND, {
      execute: () => void this.runSync(() => this.gitService.fetch(), 'fetch'),
    });
    commands.registerCommand(GIT_BRANCH_CREATE_COMMAND, {
      execute: () => void this.createBranch(),
    });
    commands.registerCommand(GIT_BRANCH_SWITCH_COMMAND, {
      execute: () => void this.switchBranch(),
    });
    commands.registerCommand(GIT_DISCARD_COMMAND, {
      execute: () => void this.discardCurrentFile(),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_BRANCH_SWITCH_COMMAND.id,
      label: 'Switch Branch',
      order: 'c0',
    });
  }

  private async requireRepo(): Promise<boolean> {
    if (!this.gitService.getRepoRoot()) {
      // One retry in case discovery has not finished yet
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!this.gitService.getRepoRoot()) {
      this.messages.warn(this.i18n.t('widget.git.sync.noRepo'));
      return false;
    }
    return true;
  }

  private async runSync(action: () => Promise<string>, kind: 'pull' | 'push' | 'fetch'): Promise<void> {
    if (!(await this.requireRepo())) return;
    try {
      const out = await action();
      const summary = out || this.i18n.t(`widget.git.sync.${kind}Done`);
      this.messages.info(this.i18n.t(`widget.git.sync.${kind}Ok`, { summary: truncate(summary, 400) }));
    } catch (err) {
      this.messages.error(this.i18n.t(`widget.git.sync.${kind}Fail`, {
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  private async createBranch(): Promise<void> {
    if (!(await this.requireRepo())) return;
    const name = await this.quickInput.input({
      prompt: this.i18n.t('widget.git.sync.branchPrompt'),
      placeHolder: this.i18n.t('widget.git.sync.branchPlaceholder'),
    });
    if (!name?.trim()) return;
    try {
      await this.gitService.createBranch(name);
      this.messages.info(this.i18n.t('widget.git.sync.branchCreated', { name }));
    } catch (err) {
      this.messages.error(this.i18n.t('widget.git.sync.branchFail', {
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  private async switchBranch(): Promise<void> {
    if (!(await this.requireRepo())) return;
    let current = '';
    let branches: string[] = [];
    try {
      const list = await this.gitService.listBranches();
      current = list.current;
      branches = list.branches;
    } catch (err) {
      this.messages.error(this.i18n.t('widget.git.sync.branchListFail', {
        message: err instanceof Error ? err.message : String(err),
      }));
      return;
    }
    if (branches.length === 0) {
      this.messages.info(this.i18n.t('widget.git.sync.noBranches'));
      return;
    }
    const pick = await this.quickInput.showQuickPick(
      branches.map(b => ({
        label: b === current ? `● ${b}` : b,
        description: b === current ? this.i18n.t('widget.git.sync.currentBranch') : '',
        branch: b,
      })),
      { placeholder: this.i18n.t('widget.git.sync.switchPrompt') },
    );
    const target = (pick as { branch?: string } | undefined)?.branch;
    if (!target || target === current) return;
    try {
      await this.gitService.switchBranch(target);
      this.messages.info(this.i18n.t('widget.git.sync.switchedTo', { name: target }));
    } catch (err) {
      this.messages.error(this.i18n.t('widget.git.sync.branchFail', {
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  private async discardCurrentFile(): Promise<void> {
    if (!(await this.requireRepo())) return;
    const editor = this.editorManager.currentEditor;
    const uri = editor?.editor?.uri?.toString();
    const root = this.gitService.getRepoRoot();
    if (!uri || !root) {
      this.messages.warn(this.i18n.t('widget.git.sync.noEditor'));
      return;
    }
    const rel = toRepoRelativePath(uri, root);
    if (!rel) {
      this.messages.warn(this.i18n.t('widget.git.sync.outsideRepo'));
      return;
    }
    const confirmed = await this.messages.warn(
      this.i18n.t('widget.git.sync.discardConfirm', { file: rel }),
      'OK', 'Cancel',
    );
    if (confirmed !== 'OK') return;
    try {
      await this.gitService.discardFileChanges([rel]);
      this.messages.info(this.i18n.t('widget.git.sync.discarded', { file: rel }));
    } catch (err) {
      this.messages.error(this.i18n.t('widget.git.sync.discardFail', {
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
