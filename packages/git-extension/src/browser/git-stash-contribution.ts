import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { GitStashWidget } from './git-stash-widget';

export const GIT_STASH_TOGGLE_COMMAND: Command = {
  id: 'kairo-git-stash:toggle',
  label: 'Git: Show Stash',
};

@injectable()
export class GitStashContribution extends AbstractViewContribution<GitStashWidget> {
  constructor() {
    super({
      widgetId: GitStashWidget.ID,
      widgetName: 'Git Stash',
      defaultWidgetOptions: {
        area: 'bottom',
        rank: 510,
      },
      toggleCommandId: GIT_STASH_TOGGLE_COMMAND.id,
    });
  }

  override registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GIT_STASH_TOGGLE_COMMAND, {
      execute: () => this.openView({ activate: true }),
    });
    super.registerCommands(commands);
  }

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus);
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_STASH_TOGGLE_COMMAND.id,
      label: 'Git Stash',
      order: 'b',
    });
  }
}
