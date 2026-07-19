/**
 * The browser-side module that wires the Kairo runtime into
 * inversify.
 *
 * Bindings are registered as a Theia ContainerModule, not via
 * the (unreliable) `window.$(...).data('kairo.container')`
 * pattern. Apps compose the module into the Theia container.
 */

import { ContainerModule, injectable } from '@theia/core/shared/inversify';
import {
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
} from './runtime';
import { WorkspaceContextService } from './workspace-context-service';
import { RuntimeConnectionService } from './runtime-connection-service';

export {
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
} from './runtime';

export { KairoError, normaliseThrown, unwrapResponse, FALLBACK_ERROR_CODE } from './runtime-errors';

export { WorkspaceContextService } from './workspace-context-service';
export type { WorkspaceContext } from './workspace-context-service';

export {
  RuntimeConnectionService,
  EventStream,
  KAIRO_WS_SUBPROTOCOL,
} from './runtime-connection-service';
export type {
  KairoRuntimeConfig,
  KairoRequestInit,
  RuntimeEndpoints,
} from './runtime-connection-service';

/**
 * @deprecated Per docs/hotfix-windows-test-readiness.md 搂2,
 * the frontend MUST NOT hardcode the agent port. Call
 * `RuntimeConnectionService.fetchEndpoints()` after the
 * first connect to learn the dynamic host:port the agent
 * bound. The constant is kept only so old callers that
 * still reference it continue to typecheck; new code
 * should treat it as a sentinel for "no port configured".
 */
export const RUNTIME_BASE_URL = '';

/**
 * The Kairo runtime frontend module. Apps load it as part of
 * their Theia composition.
 *
 * Key bindings:
 *   - `RuntimeConnectionService` toSelf (singleton) — the single
 *     HTTP client that every Kairo service injects.
 *   - `KairoRuntime` (Symbol) toService(RuntimeConnectionService) — for
 *     callers that want the Symbol-typed lookup.
 */
const _kairoRuntimeModule = new ContainerModule((bind, _unbind, isBound, rebind) => {
  if (isBound(RuntimeConnectionService)) {
    rebind(RuntimeConnectionService).toSelf().inSingletonScope();
  } else {
    bind(RuntimeConnectionService).toSelf().inSingletonScope();
  }
  if (isBound(KairoRuntime)) {
    rebind(KairoRuntime).toService(RuntimeConnectionService);
  } else {
    bind(KairoRuntime).toService(RuntimeConnectionService);
  }
  if (isBound(KairoErrorListener)) {
    rebind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  } else {
    bind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  }
  if (isBound(WorkspaceContextService)) {
    rebind(WorkspaceContextService).toSelf().inSingletonScope();
  } else {
    bind(WorkspaceContextService).toSelf().inSingletonScope();
  }
});

/**
 * `KairoRuntimeModule` is exposed with both forms the rest of
 * the codebase historically used:
 *
 *   • `container.load(KairoRuntimeModule)` — the standard
 *     Inversify ContainerModule contract, used by
 *     `loadKairoProduct()` in theia-product.
 *   • `KairoRuntimeModule.load(container)` — a static helper
 *     that forwards to the same call. Some boot paths (older
 *     bundle output, the dev-mode esbuild watch run) iterate
 *     over named exports and try to call `.load` on them,
 *     which fails with `Hrr.KairoRuntimeModule.load is not a
 *     function` because plain `ContainerModule` has no such
 *     method. Adding the helper makes both call sites work
 *     without coordinating changes across packages.
 */
export const KairoRuntimeModule = Object.assign(_kairoRuntimeModule, {
  /**
   * Convenience wrapper around `container.load(this)`. Lets
   * callers that hold a reference to the module (e.g. a
   * generic module-iteration helper) invoke it with the
   * verb-first API instead of the Inversify noun-first API.
   */
  load(container: { load: (m: unknown) => void }): void {
    container.load(_kairoRuntimeModule);
  },
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
