/**
 * Kairo UI Kit — Browser entry point
 *
 * Exports the frontend application contributions:
 * - KairoUiContribution: auto-opens Explorer on workspace load
 * - KairoThemeContribution: registers the Kairo dark theme
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { KairoUiContribution } from './kairo-ui-contribution';
import { KairoThemeContribution } from './kairo-theme-contribution';
import './kairo-theme.css';

export * from './kairo-ui-contribution';
export * from './kairo-theme';
export * from './kairo-theme-idea';
export * from './kairo-theme-contribution';
export * from './virtual-list';
export { default as KairoUiContribution } from './kairo-ui-contribution';

export default new ContainerModule(bind => {
  bind(KairoUiContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoUiContribution);
  bind(KairoThemeContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoThemeContribution);
  // KairoThemeContribution also implements ColorContribution so
  // Theia's ColorApplicationContribution picks up Kairo's color
  // overrides (button.background, statusBar.background, …) on
  // startup. Without this, the Theia defaults (#007acc blue)
  // leak through after KairoDarkTheme.activate() and override
  // the values we just wrote. See N-034.
  bind(ColorContribution).toService(KairoThemeContribution);
});
