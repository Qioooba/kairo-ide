/**
 * Kairo UI Kit — Browser entry point
 *
 * Exports the frontend application contributions:
 * - KairoUiContribution: auto-opens Explorer on workspace load
 * - KairoThemeContribution: registers the Kairo dark theme
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { KairoUiContribution } from './kairo-ui-contribution';
import { KairoThemeContribution } from './kairo-theme-contribution';

export * from './kairo-ui-contribution';
export * from './kairo-theme';
export * from './kairo-theme-contribution';
export { default as KairoUiContribution } from './kairo-ui-contribution';

export default new ContainerModule(bind => {
  bind(KairoUiContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoUiContribution);
  bind(KairoThemeContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoThemeContribution);
});