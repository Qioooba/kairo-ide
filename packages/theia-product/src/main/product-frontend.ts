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
 *
 * Set KAIRO_NO_KAIRO_FRONTEND=1 in the environment to load an
 * empty module instead. Useful for confirming that the Theia
 * default shell renders on its own when Kairo's frontend
 * extensions are the source of a problem.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { bindKairoFrontend } from './browser/kairo-product-frontend-module';
import { bindKairoProduct } from './product-bindings';
import { RuntimeConnectionService, RUNTIME_BASE_URL } from '@kairo/runtime-extension';

export { bindKairoFrontend };

// Read the feature flag from the preload-injected window
// config. `process` is not available inside the browser bundle,
// so we cannot check process.env at module-load time on the
// renderer side. The preload script copies the value from the
// main process env to `window.kairoConfig.noKairoFrontend`.
declare const window: Window & {
  kairoConfig?: { noKairoFrontend?: boolean };
};

export const KairoProductFrontend: ContainerModule = (() => {
  // The decision is made at module load time, before the
  // frontend container is wired. `window.kairoConfig` is set
  // synchronously by the Electron preload script before the
  // page begins evaluating, so it is safe to read here.
  if (typeof window !== 'undefined' && window.kairoConfig?.noKairoFrontend) {
    // eslint-disable-next-line no-console
    console.log('[kairo] noKairoFrontend=true; loading empty frontend module');
    return new ContainerModule(() => { /* no-op */ });
  }
  return new ContainerModule((bind, _unbind, isBound, rebind, onActivation) => {
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
})();

export default KairoProductFrontend;
