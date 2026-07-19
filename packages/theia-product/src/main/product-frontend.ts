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
 *   * All Kairo service-layer bindings (RuntimeConnectionService,
 *     KairoServerService, KairoJavaService, etc.) via bindKairoProduct
 *     so that the DI container is fully populated — previously these
 *     were only available when configureKairoRuntime() was called.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindKairoFrontend } from './browser/kairo-product-frontend-module';
import { bindKairoProduct } from './product-bindings';
import { RuntimeConnectionService, RUNTIME_BASE_URL } from '@kairo/runtime-extension';

export { bindKairoFrontend };

export const KairoProductFrontend = new ContainerModule((bind, _unbind, isBound, rebind, onActivation) => {
  // Frontend-layer bindings (widgets, views, commands, status bar)
  bindKairoFrontend(bind);

  // Service-layer bindings (RuntimeConnectionService, KairoServerService,
  // KairoJavaService, KairoProjectService, etc.)
  bindKairoProduct(bind, isBound, rebind);

  // Configure the runtime client on first activation, matching the
  // behaviour that configureKairoRuntime() previously provided.
  // The base URL is read from the global KAIRO_RUNTIME_BASE_URL if
  // set by the host HTML page, otherwise the empty-string default.
  onActivation(RuntimeConnectionService, (_ctx, svc) => {
    const baseUrl: string =
      (typeof window !== 'undefined' && (window as any).KAIRO_RUNTIME_BASE_URL) ||
      RUNTIME_BASE_URL;
    svc.configure({ baseUrl });
    return svc;
  });
});

export default KairoProductFrontend;
