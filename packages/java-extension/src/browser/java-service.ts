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

import { injectable, inject, interfaces, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import type {
  JdtState,
  JdtStatus,
  JavaServiceState,
} from '@kairo/protocol';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import { JavaLanguageClient } from './java-language-client';
import type { JdtLsState } from '../common/jdt-ls-state';

@injectable()
export class KairoJavaService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(JavaLanguageClient) protected languageClient!: JavaLanguageClient;
  @inject(ILogger) protected logger!: ILogger;

  protected state: JavaServiceState = 'uninitialized';
  protected status: JdtStatus | undefined;
  protected lastError: string | undefined;
  protected listeners = new Set<(s: JavaServiceState, st?: JdtStatus) => void>();
  /** Set once the backend $inspect() JRE probe succeeded. */
  protected jreFilled = false;

  @postConstruct()
  protected init(): void {
    // KAIRO-RC-WEB-251: the JDT LS process lives in the THEIA
    // backend now — the Go agent's /api/v1/jdtls state refers to
    // its own (never-started) manager and is permanently
    // 'stopped'. The language client's state (backend RPC) is the
    // source of truth; subscribe and mirror it.
    this.languageClient.onState(s => this.applyClientState(s));
  }

  /**
   * Fill `jre`/`javaMajor` from the backend $inspect() probe. The Go
   * agent never carries these for the Theia-hosted LS process, so the
   * status bar would otherwise show a bare state label forever.
   */
  protected async fillJreOnce(): Promise<void> {
    if (this.jreFilled || this.status?.jre) return;
    try {
      const ins = await this.languageClient.inspect();
      this.logger.info(`[KairoJavaService] $inspect -> ${JSON.stringify(ins).slice(0, 200)}`);
      if (ins.ok && ins.jre) {
        this.jreFilled = true;
        const base = this.status ?? ({ state: 'running' } as JdtStatus);
        this.status = { ...base, jre: ins.jre, javaMajor: ins.javaMajor };
        for (const fn of this.listeners) fn(this.state, this.status);
      }
    } catch {
      // cosmetic only — retry on the next ready transition
    }
  }

  protected applyClientState(s: JdtLsState): void {
    const status = { ...(this.status ?? { state: 'stopped' as JdtState }) } as JdtStatus;
    switch (s) {
      case 'ready':
        status.state = 'running';
        this.setState('ready', status);
        void this.fillJreOnce();
        break;
      case 'starting':
      case 'initializing':
        status.state = 'starting' as JdtState;
        this.setState('starting', status);
        break;
      case 'crashed':
        status.state = 'crashed' as JdtState;
        this.setState('crashed', status);
        break;
      case 'stopped':
      case 'stopping':
        status.state = 'stopped' as JdtState;
        this.setState('stopped' as JdtState, status);
        break;
      default:
        break;
    }
  }

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
      if (st.state === 'running') {
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
      } else {
        this.setState(st.state as JdtState, st);
      }
      // The agent's state refers to its own (unused) manager;
      // the Theia-backend-hosted LS is the truth — overlay it.
      this.applyClientState(await this.languageClient.fetchState());
      // The agent status carries no `jre` for the Theia-hosted process —
      // resolve it from the backend so the status bar can show the real
      // JDK version instead of a bare state label.
      if (this.status && !this.status.jre) {
        try {
          const ins = await this.languageClient.inspect();
          if (ins.ok) {
            this.status = { ...this.status, jre: ins.jre, javaMajor: ins.javaMajor };
            for (const fn of this.listeners) fn(this.state, this.status);
          }
        } catch {
          // cosmetic only — state label stays
        }
      }
      return this.status;
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
