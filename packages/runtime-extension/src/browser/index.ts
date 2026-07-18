/**
 * The browser-side module that wires the KairoRuntime into
 * inversify.
 *
 * Bindings are registered as a Theia ContainerModule, not via
 * the (unreliable) `window.$(...).data('kairo.container')`
 * pattern. Apps compose the module into the Theia container.
 */

import { ContainerModule, injectable } from '@theia/core/shared/inversify';
import {
  KairoRuntime,
  KairoRuntimeImpl,
  KairoRuntimeConfig,
  KairoErrorListener,
  KairoErrorListenerImpl,
} from './runtime';

export {
  KairoRuntime,
  KairoRuntimeImpl,
  KairoRuntimeConfig,
  KairoErrorListener,
  KairoErrorListenerImpl,
  EventStream,
} from './runtime';

export { KairoError, normaliseThrown, unwrapResponse, FALLBACK_ERROR_CODE } from './runtime-errors';
export type { KairoRequestInit } from './runtime';

export const RUNTIME_BASE_URL = 'http://127.0.0.1:18099';

/**
 * The Kairo runtime frontend module. Apps load it as part of
 * their Theia composition.
 */
export const KairoRuntimeModule = new ContainerModule(bind => {
  bind(KairoRuntime).to(KairoRuntimeImpl).inSingletonScope();
  bind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
});

/**
 * A one-shot configuration helper. After the Theia container
 * has loaded the module, call this with the base URL to set
 * the runtime client up.
 */
@injectable()
export class KairoRuntimeConfigurator {
  constructor() {}
  // The actual configuration happens via the factory below.
}

/**
 * Factory: create a configured runtime. Used by apps/browser
 * and apps/desktop at startup.
 */
export const KairoRuntimeFactory = Symbol('KairoRuntimeFactory');
