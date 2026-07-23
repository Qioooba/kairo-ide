import type { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TestStore } from './test-store';
import { TestDiscoveryService } from './test-discovery';
import { TestRunner, parseJUnitXml as _parseJUnitXml, parseFailureLocation as _parseFailureLocation } from './test-runner';
import { TestTreeWidget } from './test-tree-widget';
import { TestTreeContribution } from './test-tree-contribution';
import { TestMarkerAdapter } from './test-marker-adapter';

export { TestStore } from './test-store';
export type { TestItem, TestRun, TestMethodResult, TestStatus, ConnectionState } from './test-store';
export { TestDiscoveryService } from './test-discovery';
export { TestRunner, parseJUnitXml, parseFailureLocation } from './test-runner';
export type { JUnitXmlSuite, JUnitXmlTestCase } from './test-runner';
export { TestTreeWidget } from './test-tree-widget';
export { TestTreeContribution } from './test-tree-contribution';
export { TestMarkerAdapter, toMarkerSeverity, testResultToMarker } from './test-marker-adapter';

export function bindTestExtension(bind: interfaces.Bind): void {
    bind(TestStore).toSelf().inSingletonScope();
    bind(TestDiscoveryService).toSelf().inSingletonScope();
    bind(TestRunner).toSelf().inSingletonScope();
    bind(TestTreeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: TestTreeWidget.ID,
        createWidget: () => context.container.get(TestTreeWidget),
    })).inSingletonScope();
    bindViewContribution(bind, TestTreeContribution);
    bind(FrontendApplicationContribution).toService(TestTreeContribution);
    bind(TestMarkerAdapter).toSelf().inSingletonScope();
}