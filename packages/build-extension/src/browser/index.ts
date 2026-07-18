import type { interfaces } from '@theia/core/shared/inversify';
import { BuildStore } from './build-store';
import { BuildViewWidget } from './build-view-widget';

export { BuildStore } from './build-store';
export type { BuildRun, BuildDiagnostic } from './build-store';
export { BuildViewWidget } from './build-view-widget';

export function bindBuildExtension(bind: interfaces.Bind): void {
    bind(BuildStore).toSelf().inSingletonScope();
    bind(BuildViewWidget).toSelf();
}