/**
 * Public surface of the Kairo runtime browser extension.
 *
 * The inversify bindings for these services live in
 * `@kairo/theia-product` (bindKairoFrontend / bindKairoProduct),
 * which is the single composition root — a ContainerModule here
 * was a third, diverging copy of the same four bindings and was
 * removed in KAIRO-RC-WEB-013.
 */

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
