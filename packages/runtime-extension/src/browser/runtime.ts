/**
 * KairoRuntime — type-level definitions for the HTTP client.
 *
 * The actual runtime client implementation is now in
 * RuntimeConnectionService (runtime-connection-service.ts).
 * This file retains the Symbol, listener interfaces, and
 * re-exports for backward compatibility.
 */

import { Endpoint } from '@kairo/protocol';
import { KairoError } from './runtime-errors';

export const KairoRuntime = Symbol('KairoRuntime');

/**
 * Listener for client-side errors. The Theia side uses this to
 * drive the status bar ("Runtime Agent: disconnected"), the
 * notifications service, and the audit log.
 */
export const KairoErrorListener = Symbol('KairoErrorListener');
export interface KairoErrorListener {
  onError(err: KairoError, ctx: { endpoint: Endpoint; attempt: number }): void;
}

export class KairoErrorListenerImpl implements KairoErrorListener {
  onError(_err: KairoError, _ctx: { endpoint: Endpoint; attempt: number }): void {
    // Default no-op; views register themselves.
  }
}
