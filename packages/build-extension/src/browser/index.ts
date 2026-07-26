import type { interfaces } from '@theia/core/shared/inversify';
import { WidgetFactory } from '@theia/core/lib/browser';
import { BuildStore } from './build-store';
import { BuildViewWidget } from './build-view-widget';
import { BuildMarkerAdapter } from './build-marker-adapter';
import { MavenViewWidget } from './maven-view-widget';
import { CustomBuildRunnerWidget, CUSTOM_BUILD_WIDGET_ID } from './kairo-custom-build-runner';

export { BuildStore, mapBuildResult } from './build-store';
export type { BuildRun, BuildDiagnostic, ConnectionState } from './build-store';
export { BuildViewWidget } from './build-view-widget';
export { BuildMarkerAdapter, toMarkerSeverity, diagnosticToMarker } from './build-marker-adapter';
export { MavenViewWidget } from './maven-view-widget';
export type { MavenGoal, MavenDependency, MavenDependencyTreeNode, MavenDependencyConflict, MavenProjectInfo, MavenBuildResult } from './maven-view-widget';
export { CustomBuildRunnerWidget } from './kairo-custom-build-runner';
export { CUSTOM_BUILD_WIDGET_ID, CUSTOM_BUILD_LABEL } from './kairo-custom-build-runner';

export function bindBuildExtension(bind: interfaces.Bind): void {
    bind(BuildStore).toSelf().inSingletonScope();
    bind(BuildViewWidget).toSelf();
    bind(BuildMarkerAdapter).toSelf().inSingletonScope();
    bind(MavenViewWidget).toSelf();
    bind(CustomBuildRunnerWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: CUSTOM_BUILD_WIDGET_ID,
        createWidget: () => ctx.container.get(CustomBuildRunnerWidget),
    }));
}