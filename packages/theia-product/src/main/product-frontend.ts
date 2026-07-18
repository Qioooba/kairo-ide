/**
 * KairoProductFrontend — the browser-side module that the
 * Theia browser app loads via the `theiaExtensions[].frontend`
 * field. Theia server / Electron app hosts do NOT load this
 * module.
 *
 * Apps that want to compose the Kairo frontend with their own
 * InversifyJS container can `container.load(KairoProductFrontend)`.
 *
 * The module binds:
 *   * KairoStatusBarContribution — status bar entries
 *   * KairoViewsContribution      — commands, view containers, event wiring
 *   * Widget factories for the four Kairo views
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindKairoFrontend } from './browser/kairo-product-frontend-module';

export { bindKairoFrontend };

export const KairoProductFrontend = new ContainerModule(bind => {
  bindKairoFrontend(bind);
});

export default KairoProductFrontend;
