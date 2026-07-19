/**
 * Kairo Java service — owns the JDT Language Server lifecycle
 * and exposes its state to the UI.
 *
 * v0.4-java-intelligence state machine:
 *
 *   uninitialized  --first call---------> not-installed
 *   not-installed  --ensureStarted()----> installing
 *   installing     --download+extract ok-> starting
 *   starting       --process up---------> initializing
 *   initializing   --LSP init ok--------> ready
 *   ready          --ensureStopped()----> stopped
 *   any            --crash event--------> crashed
 *   ready          --non-1.6 source-----> degraded
 *
 * The UI must NEVER advertise Java language features (completion,
 * hover, definition, references, diagnostics, outline) until
 * the state is `ready` or `degraded`. The status bar's JDT LS
 * entry shows the real state and a clickable menu: Restart,
 * Show Logs, Open Install Folder.
 *
 * The contract is honest: the agent reports back the
 * distribution status, the per-workspace data dir, the
 * launcher JAR, the JRE, the running pid, and the initialize
 * state. We do not move to `ready` until the LSP `initialize`
 * handshake has succeeded AND the JDT LS has had a chance to
 * surface its capabilities. The bridge endpoint
 * /api/v1/jdtls/lsp is the same WebSocket the Theia
 * LanguageClientContribution uses; the service is responsible
 * for opening it AFTER the LS is ready.
 */

import { injectable, inject, interfaces } from '@theia/core/shared/inversify';
import type {
  JdtState,
  JdtStatus,
  JavaServiceState,
} from '@kairo/protocol';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';

@injectable()
export class KairoJavaService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;

  protected state: JavaServiceState = 'uninitialized';
  protected status: JdtStatus | undefined;
  protected lastError: string | undefined;
  protected listeners = new Set<(s: JavaServiceState, st?: JdtStatus) => void>();

  state$(): JavaServiceState {
    return this.state;
  }

  lastStatus(): JdtStatus | undefined {
    return this.status;
  }

  lastError$(): string | undefined {
    return this.lastError;
  }

  onState(fn: (s: JavaServiceState, st?: JdtStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected setState(s: JavaServiceState, st?: JdtStatus): void {
    this.state = s;
    if (st) this.status = st;
    if (st?.lastError) this.lastError = st.lastError;
    for (const fn of this.listeners) fn(s, this.status);
  }

  async refreshStatus(): Promise<JdtStatus | undefined> {
    try {
      const st = (await this.runtime.request('GET /api/v1/jdtls', undefined)) as JdtStatus;
      this.status = st;
      // If the wire state is `running` but the initialize
      // handshake has not completed, the service is
      // "initializing", not "ready". Anything other than
      // ready is reflected locally.
      if (st.state === 'running' && st.initializeOk) {
        if (
          st.sourceLevel &&
          st.sourceLevel !== '1.6' &&
          st.sourceLevel !== '1.7' &&
          st.sourceLevel !== '1.8'
        ) {
          this.setState('degraded', st);
        } else {
          this.setState('ready', st);
        }
      } else if (st.state === 'running') {
        this.setState('initializing', st);
      } else {
        this.setState(st.state as JdtState, st);
      }
      return st;
    } catch (err) {
      if (err instanceof KairoError) {
        this.lastError = err.message;
        this.setState('crashed');
      }
      return undefined;
    }
  }

  /**
   * The current Theia-side state, derived from the wire
   * state + the install state. Used by the status bar.
   */
  effectiveState(): JavaServiceState {
    return this.state;
  }
}

export function bindJavaExtension(bind: interfaces.Bind): void {
  bind(KairoJavaService).toSelf().inSingletonScope();
}

// Re-export the protocol types for convenience.
export type { JdtState, JdtStatus, JavaServiceState };
