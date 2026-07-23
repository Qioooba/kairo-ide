import { injectable, inject as _inject } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { GitHistoryWidget } from './git-history-widget';

export const GIT_HISTORY_TOGGLE_COMMAND: Command = {
  id: 'kairo-git-history:toggle',
  label: 'Git: Show History',
};

@injectable()
export class GitHistoryContribution extends AbstractViewContribution<GitHistoryWidget> {
  constructor() {
    super({
      widgetId: GitHistoryWidget.ID,
      widgetName: GitHistoryWidget.LABEL,
      defaultWidgetOptions: {
        area: 'bottom',
        rank: 500,
      },
      toggleCommandId: GIT_HISTORY_TOGGLE_COMMAND.id,
    });
  }

  override registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GIT_HISTORY_TOGGLE_COMMAND, {
      execute: () => this.openView({ activate: true }),
    });
    super.registerCommands(commands);
  }

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus);
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_HISTORY_TOGGLE_COMMAND.id,
      label: 'Git History',
      order: 'a',
    });
  }
}