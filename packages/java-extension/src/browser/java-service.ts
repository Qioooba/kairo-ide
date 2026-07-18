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

import { injectable, inject } from '@theia/core/shared/inversify';
import type {
  JdtState,
  JdtStatus,
  JdtStartRequest,
  JdtProjectRequest,
  JdtProjectResponse,
  Toolchain,
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
  protected startInFlight: Promise<void> | undefined;

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

  async listToolchains(): Promise<Toolchain[]> {
    return (await this.runtime.request('GET /api/v1/toolchains', undefined)) as Toolchain[];
  }

  async importToolchain(path: string, label?: string): Promise<Toolchain> {
    return this.runtime.request('POST /api/v1/toolchains/import', { path, label });
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
   * Start the JDT LS. Idempotent: a second call while a start
   * is in flight reuses the same promise; while already
   * `ready` it is a no-op. The promise resolves only after
   * the agent confirms `running` AND the LSP `initialize`
   * handshake has completed (when the caller passed an
   * `initializeRootURI`).
   *
   * Before reaching `ready`, the service passes through
   * `not-installed -> installing -> starting -> initializing`
   * so the status bar shows real progress, not a static label.
   */
  ensureStarted(req: JdtStartRequest = {}): Promise<void> {
    if (this.startInFlight) return this.startInFlight;
    if (this.state === 'ready' || this.state === 'degraded') return Promise.resolve();
    this.setState('not-installed');
    this.startInFlight = this.doStart(req).finally(() => {
      this.startInFlight = undefined;
    });
    return this.startInFlight;
  }

  protected async doStart(req: JdtStartRequest): Promise<void> {
    this.setState('installing');
    try {
      const st = (await this.runtime.request('POST /api/v1/jdtls', req)) as JdtStatus;
      this.status = st;
      // Decision tree mirrors refreshStatus: only `running`
      // AND `initializeOk == true` reaches `ready` (or
      // `degraded` for non-Java 6 sources).
      if (st.state === 'running' && st.initializeOk) {
        if (st.sourceLevel && !isLegacySourceLevel(st.sourceLevel)) {
          this.setState('degraded', st);
          return;
        }
        this.setState('ready', st);
        return;
      }
      if (st.state === 'running') {
        this.setState('initializing', st);
        return;
      }
      if (st.state === 'starting') {
        this.setState('starting', st);
        return;
      }
      this.setState('crashed', st);
      throw new Error(`JDT LS did not reach running: state=${st.state} lastError=${st.lastError ?? ''}`);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
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
    this.setState(st.state === 'stopped' ? 'stopped' : 'stopping', st);
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

  /**
   * Render the JDT LS project model for a legacy project.
   * Returns the absolute paths the JDT LS will use, and the
   * generated classpath XML on disk. The frontend uses this
   * to point the Theia Java LanguageClientContribution at
   * the right workspace.
   */
  async generateProject(req: JdtProjectRequest): Promise<JdtProjectResponse> {
    return this.runtime.request('POST /api/v1/jdtls/project', req);
  }

  /**
   * The current Theia-side state, derived from the wire
   * state + the install state. Used by the status bar.
   */
  effectiveState(): JavaServiceState {
    return this.state;
  }
}

function isLegacySourceLevel(level: string): boolean {
  return level === '1.5' || level === '1.6' || level === '1.7' || level === '1.8';
}

export function bindJavaExtension(bind: any): void {
  bind(KairoJavaService).toSelf().inSingletonScope();
}

// Re-export the protocol types for convenience.
export type { JdtState, JdtStatus, JdtStartRequest, JdtProjectRequest, JdtProjectResponse, JavaServiceState };
