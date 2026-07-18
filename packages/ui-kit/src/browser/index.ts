/**
 * Kairo UI Kit — Browser entry point
 *
 * Exports the frontend application contribution that loads
 * the Kairo theme and UI customizations.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { KairoUiContribution } from './kairo-ui-contribution';

export * from './kairo-ui-contribution';
export { default as KairoUiContribution } from './kairo-ui-contribution';

export default new ContainerModule(bind => {
  bind(KairoUiContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoUiContribution);
});
