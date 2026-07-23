import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TestTreeWidget } from './test-tree-widget';

@injectable()
export class TestTreeContribution extends AbstractViewContribution<TestTreeWidget> {
    constructor() {
        super({
            widgetId: TestTreeWidget.ID,
            widgetName: 'Kairo Tests',
            defaultWidgetOptions: { area: 'bottom', rank: 200 },
            toggleCommandId: 'kairo.test.tree.toggle',
        });
    }
}