import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { SearchResultsWidget } from './search-results-widget';

@injectable()
export class SearchResultsContribution extends AbstractViewContribution<SearchResultsWidget> {
  constructor() {
    super({
      widgetId: SearchResultsWidget.ID,
      widgetName: 'Find',
      defaultWidgetOptions: { area: 'bottom', rank: 150 },
      toggleCommandId: 'kairo.search.results.toggle',
    });
  }

  override registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand({
      id: 'kairo.search.results.open',
      label: 'Open Find Tool Window',
    }, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus);
  }
}
