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
import { RuntimeConnectionService, EventStream, type KairoRuntimeConfig, type KairoRequestInit } from './runtime-connection-service';

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
export const KairoRuntimeModule = new ContainerModule((bind, _unbind, isBound, rebind) => {
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