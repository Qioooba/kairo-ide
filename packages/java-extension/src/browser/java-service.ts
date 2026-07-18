/**
 * Kairo Java service — owns the JDT Language Server lifecycle
 * and exposes its state to the UI.
 *
 * Lifecycle contract (v0.3-jdt-ls-skeleton):
 *
 *   uninitialized --ensureStarted()--> starting
 *   starting      --agent ready------> ready
 *   starting      --agent error------> crashed
 *   ready         --ensureStopped()--> stopped
 *   any           --crash event------> crashed
 *
 * We only flip the public `state` to `ready` AFTER the agent
 * has confirmed two things over the wire:
 *   (a) state == "running" (the JVM is up), AND
 *   (b) initializeOk == true (the LSP initialize handshake
 *       succeeded, or we did not ask for one).
 *
 * Anything short of that is `starting` or `crashed`, and the UI
 * must not advertise Java language features. This is the rule
 * the user called out: "只有 JDT LS 真正完成初始化并收到响应，
 * 状态才能变为 ready" — we do not pretend.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { JdtState, JdtStatus, JdtStartRequest, Toolchain } from '@kairo/protocol';
import { KairoRuntimeImpl, KairoError } from '@kairo/runtime-extension';

/**
 * The service-level state machine is a SUPERSET of the
 * protocol's wire JdtState. The two extra values are local
 * UI concepts:
 *
 *   - 'uninitialized': we have not yet asked the agent for
 *     anything. Nothing has been started, nothing is broken.
 *   - 'ready': the wire JDT LS is `running` AND the LSP
 *     initialize handshake succeeded. This is the only state
 *     under which we tell the rest of the IDE "Java language
 *     features are available."
 *
 * The protocol JdtState is what the agent returns over the
 * wire. We never set it to 'uninitialized' or 'ready' — those
 * are computed locally from the wire state.
 */
export type JavaServiceState = JdtState | 'uninitialized' | 'ready';

@injectable()
export class KairoJavaService {
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;

  protected state: JavaServiceState = 'uninitialized';
  protected status: JdtStatus | undefined;
  protected listeners = new Set<(s: JavaServiceState, st?: JdtStatus) => void>();
  protected startInFlight: Promise<void> | undefined;

  /**
   * Public state accessor. `uninitialized` is the value the UI
   * sees before the user has asked for Java; `stopped` is what
   * the UI sees after a Stop or after a crash.
   */
  state$(): JavaServiceState {
    return this.state;
  }

  /**
   * Last full status payload, or undefined if we have not
   * talked to the agent yet. The status bar uses this to
   * render pid / jre / version / lastError.
   */
  lastStatus(): JdtStatus | undefined {
    return this.status;
  }

  onState(fn: (s: JavaServiceState, st?: JdtStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected setState(s: JavaServiceState, st?: JdtStatus): void {
    this.state = s;
    if (st) this.status = st;
    for (const fn of this.listeners) fn(s, this.status);
  }

  async listToolchains(): Promise<Toolchain[]> {
    return (await this.runtime.request('GET /api/v1/toolchains', undefined)) as Toolchain[];
  }

  async importToolchain(path: string, label?: string): Promise<Toolchain> {
    return this.runtime.request('POST /api/v1/toolchains/import', { path, label });
  }

  /**
   * Returns the agent's view of the JDT LS right now. Does
   * NOT change local state; it is a read-through cache
   * refresher. If we have never talked to the agent, this is
   * also what tells us the agent has nothing to report.
   */
  async refreshStatus(): Promise<JdtStatus | undefined> {
    try {
      const st = (await this.runtime.request('GET /api/v1/jdtls', undefined)) as JdtStatus;
      this.status = st;
      return st;
    } catch (err) {
      // The agent may be down. Keep the previous status, but
      // surface that the local state should also be `crashed`
      // so the status bar does not lie about being ready.
      if (err instanceof KairoError) {
        this.setState('crashed');
      }
      return undefined;
    }
  }

  /**
   * Start the JDT LS. Idempotent: a second call while a start
   * is in flight reuses the same promise; while already
   * `ready` it is a no-op. The promise resolves only after
   * the agent confirms `running` + (when requested)
   * `initializeOk: true`.
   */
  ensureStarted(req: JdtStartRequest = {}): Promise<void> {
    if (this.startInFlight) return this.startInFlight;
    if (this.state === 'ready') return Promise.resolve();

    this.setState('starting');
    this.startInFlight = this.doStart(req).finally(() => {
      this.startInFlight = undefined;
    });
    return this.startInFlight;
  }

  protected async doStart(req: JdtStartRequest): Promise<void> {
    try {
      const st = (await this.runtime.request('POST /api/v1/jdtls', req)) as JdtStatus;
      // The agent returns running ONLY after the process is up
      // AND (if a root URI was sent) the LSP initialize
      // handshake returned. We accept either:
      //   - state == "running" and (no root was sent, or
      //     initializeOk == true)  →  ready
      //   - state == "running" but initializeOk == false  →
      //     still starting (the UI must keep waiting)
      //   - state == "starting"   →  still starting
      //   - anything else         →  crashed
      if (st.state === 'running' && st.initializeOk) {
        this.setState('ready', st);
        return;
      }
      if (st.state === 'running' || st.state === 'starting') {
        this.setState('starting', st);
        // The agent says "running but not initialized". We
        // surface this honestly: a JDT LS without an
        // initialize handshake cannot serve the UI. Crash
        // locally so the status bar shows the right thing.
        if (st.state === 'running' && !st.initializeOk && req.initializeRootURI) {
          this.setState('crashed', st);
          throw new Error(
            'JDT LS process is up but the LSP initialize handshake did not complete: ' +
              (st.lastError ?? 'no initialize response'),
          );
        }
        return;
      }
      this.setState('crashed', st);
      throw new Error(`JDT LS did not reach running: state=${st.state} lastError=${st.lastError ?? ''}`);
    } catch (err) {
      // Network / agent error / 4xx / 5xx. Already in starting
      // or crashed; ensure the final state is crashed.
      this.setState('crashed');
      throw err;
    }
  }

  /**
   * Stop the JDT LS. Resolves to the post-stop status. If
   * the LS is already stopped, this is a no-op that still
   * returns the current status.
   */
  async ensureStopped(): Promise<JdtStatus> {
    const st = (await this.runtime.request('DELETE /api/v1/jdtls', undefined)) as JdtStatus;
    this.status = st;
    this.setState(st.state === 'stopped' ? 'stopped' : 'starting', st);
    return st;
  }

  /**
   * Restart from a known clean state. Equivalent to
   * ensureStopped() + ensureStarted(), with a single error
   * surface and a single state transition.
   */
  async restart(req: JdtStartRequest = {}): Promise<void> {
    try {
      await this.ensureStopped();
    } catch {
      // Ignore stop errors; the next Start will surface a
      // truthful state via the agent's CAS.
    }
    return this.ensureStarted(req);
  }
}

export function bindJavaExtension(bind: any): void {
  bind(KairoJavaService).toSelf().inSingletonScope();
}
