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
 *
 * Two bindings are registered:
 *   - `KairoRuntimeImpl` toSelf (singleton) — the concrete class
 *     that every Kairo service injects via `@inject(KairoRuntimeImpl)`.
 *   - `KairoRuntime` (Symbol) toService(KairoRuntimeImpl) — for
 *     callers that want the Symbol-typed lookup.
 *
 * Previously only the Symbol binding existed, so every consumer
 * that injected the concrete class got "No matching bindings
 * found for serviceIdentifier: KairoRuntimeImpl" at resolve time
 * and the entire Kairo composition was non-functional.
 */
export const KairoRuntimeModule = new ContainerModule((bind, _unbind, isBound, rebind) => {
  if (isBound(KairoRuntimeImpl)) {
    rebind(KairoRuntimeImpl).toSelf().inSingletonScope();
  } else {
    bind(KairoRuntimeImpl).toSelf().inSingletonScope();
  }
  if (isBound(KairoRuntime)) {
    rebind(KairoRuntime).toService(KairoRuntimeImpl);
  } else {
    bind(KairoRuntime).toService(KairoRuntimeImpl);
  }
  if (isBound(KairoErrorListener)) {
    rebind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  } else {
    bind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  }
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
