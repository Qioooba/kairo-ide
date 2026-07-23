import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { SearchCenterWidget } from './search-center-widget';

@injectable()
export class SearchCenterContribution extends AbstractViewContribution<SearchCenterWidget> {
  constructor() {
    super({
      widgetId: SearchCenterWidget.ID,
      widgetName: 'Kairo Search Center',
      defaultWidgetOptions: { area: 'bottom', rank: 100 },
      toggleCommandId: 'kairo.search.center.toggle',
    });
  }
}
