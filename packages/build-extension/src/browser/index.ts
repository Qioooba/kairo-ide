import type { interfaces } from '@theia/core/shared/inversify';
import { BuildStore } from './build-store';
import { BuildViewWidget } from './build-view-widget';
import { BuildMarkerAdapter } from './build-marker-adapter';

export { BuildStore, mapBuildResult } from './build-store';
export type { BuildRun, BuildDiagnostic, ConnectionState } from './build-store';
export { BuildViewWidget } from './build-view-widget';
export { BuildMarkerAdapter, toMarkerSeverity, diagnosticToMarker } from './build-marker-adapter';

export function bindBuildExtension(bind: interfaces.Bind): void {
    bind(BuildStore).toSelf().inSingletonScope();
    bind(BuildViewWidget).toSelf();
    bind(BuildMarkerAdapter).toSelf().inSingletonScope();
}