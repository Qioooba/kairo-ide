import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { GitCherryPickService } from './git-cherrypick-service';

export const GIT_CHERRY_PICK_COMMAND: Command = {
  id: 'kairo-git-cherrypick:pick',
  label: 'Git: Cherry-Pick Commit',
};

export const GIT_CHERRY_PICK_CONTINUE_COMMAND: Command = {
  id: 'kairo-git-cherrypick:continue',
  label: 'Git: Cherry-Pick Continue',
};

export const GIT_CHERRY_PICK_ABORT_COMMAND: Command = {
  id: 'kairo-git-cherrypick:abort',
  label: 'Git: Cherry-Pick Abort',
};

@injectable()
export class GitCherryPickContribution {
  @inject(GitCherryPickService) protected readonly cherryPickService!: GitCherryPickService;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GIT_CHERRY_PICK_COMMAND, {
      execute: (hash?: string) => {
        if (hash) {
          this.cherryPickService.cherryPickSingle(hash);
        }
      },
    });
    commands.registerCommand(GIT_CHERRY_PICK_CONTINUE_COMMAND, {
      execute: () => this.cherryPickService.continue(),
      isVisible: () => this.cherryPickService.getState().status !== 'idle',
    });
    commands.registerCommand(GIT_CHERRY_PICK_ABORT_COMMAND, {
      execute: () => this.cherryPickService.abort(),
      isVisible: () => this.cherryPickService.getState().status !== 'idle',
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(['git', 'cherry-pick'], {
      commandId: GIT_CHERRY_PICK_COMMAND.id,
      label: 'Cherry-Pick',
      order: 'z',
    });
  }
}
