import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { Command } from '@theia/core/lib/common';
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

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus);
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_STASH_TOGGLE_COMMAND.id,
      label: 'Git Stash',
      order: 'b',
    });
  }
}
