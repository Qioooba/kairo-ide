/**
 * Kairo Debug Session Service — centralized debug session coordination.
 *
 * Provides a unified state observable for all debug widgets, batch
 * variable request processing, and breakpoint sync coordination
 * between the frontend and backend JDWP layer.
 *
 * All debug widgets inject this service instead of subscribing to
 * DebugSessionManager events individually, ensuring consistent
 * state transitions and avoiding redundant DAP requests.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { KairoJavaDebugService, type KairoJavaDebugState } from './kairo-java-debug-service';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface KairoDebugThreadInfo {
  id: number;
  name: string;
}

export interface KairoDebugSessionState {
  /** Current debug state */
  debugState: KairoJavaDebugState;
  /** Active session ID */
  sessionId: string | undefined;
  /** Whether the session is suspended (paused at a breakpoint/step) */
  isSuspended: boolean;
  /** Whether the session is running */
  isRunning: boolean;
  /** Whether a session is active (connected or paused) */
  hasSession: boolean;
  /** Current thread ID */
  threadId: number | undefined;
  /** Current thread name */
  threadName: string | undefined;
  /** All threads */
  threads: KairoDebugThreadInfo[];
  /** Session label for display */
  sessionLabel: string;
  /** Whether breakpoints are muted */
  breakpointsMuted: boolean;
  /** Current frame ID (for evaluation context) */
  currentFrameId: number | undefined;
}

export interface BatchVariableRequest {
  /** Variables references to fetch */
  references: number[];
  /** Session to use */
  session: DebugSession;
}

export interface BatchVariableResult {
  reference: number;
  variables: DebugProtocol.Variable[];
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                             */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDebugSessionService {
  @inject(DebugSessionManager)
  protected readonly sessionManager!: DebugSessionManager;

  @inject(KairoJavaDebugService)
  protected readonly javaDebug!: KairoJavaDebugService;

  protected readonly onStateChangeEmitter = new Emitter<KairoDebugSessionState>();
  readonly onDidChangeState: Event<KairoDebugSessionState> = this.onStateChangeEmitter.event;

  protected state: KairoDebugSessionState = {
    debugState: 'unknown',
    sessionId: undefined,
    isSuspended: false,
    isRunning: false,
    hasSession: false,
    threadId: undefined,
    threadName: undefined,
    threads: [],
    sessionLabel: '',
    breakpointsMuted: false,
    currentFrameId: undefined,
  };

  get currentState(): Readonly<KairoDebugSessionState> {
    return this.state;
  }

  get isSuspended(): boolean {
    return this.state.isSuspended;
  }

  get isRunning(): boolean {
    return this.state.isRunning;
  }

  get hasSession(): boolean {
    return this.state.hasSession;
  }

  get currentSession(): DebugSession | undefined {
    return this.sessionManager.currentSession;
  }

  get currentFrameId(): number | undefined {
    return this.currentSession?.currentFrame?.raw?.id;
  }

  protected _breakpointsMuted = false;
  protected _temporaryRunToLine: { line: number; source: DebugProtocol.Source } | null = null;

  @postConstruct()
  protected init(): void {
    this.sessionManager.onDidChange(() => this.refreshState());
    this.sessionManager.onDidStartDebugSession(() => this.refreshState());
    this.sessionManager.onDidStopDebugSession(() => this.refreshState());
    this.sessionManager.onDidDestroyDebugSession(() => {
      this._temporaryRunToLine = null;
      this.refreshState();
    });
    this.javaDebug.onDidChangeStatus(() => this.refreshState());
  }

  /**
   * Refresh the session state from the current debug session and
   * Java debug service status. Called automatically on session events.
   */
  refreshState(): void {
    const session = this.sessionManager.currentSession;
    const debugState = this.javaDebug.currentStatus.state;
    const isSuspended = debugState === 'paused';
    const isRunning = debugState === 'connected';
    const hasSession = isSuspended || isRunning;

    const threads: KairoDebugThreadInfo[] = [];
    const threadId = session?.currentThread?.threadId;
    const threadName = session?.currentThread?.raw?.name;

    this.state = {
      debugState,
      sessionId: session?.id,
      isSuspended,
      isRunning,
      hasSession,
      threadId,
      threadName,
      threads,
      sessionLabel: session
        ? `${session.configuration.name} • ${session.id}`
        : '',
      breakpointsMuted: this._breakpointsMuted,
      currentFrameId: session?.currentFrame?.raw?.id,
    };

    this.onStateChangeEmitter.fire(this.state);

    if (hasSession) {
      this.fetchThreads();
    }
  }

  protected async fetchThreads(): Promise<void> {
    const session = this.currentSession;
    if (!session) return;
    try {
      const response = await session.sendRequest('threads', {});
      const threadList = response.body?.threads ?? [];
      this.state = {
        ...this.state,
        threads: threadList.map(t => ({ id: t.id, name: t.name })),
      };
      this.onStateChangeEmitter.fire(this.state);
    } catch {
      // ignore
    }
  }

  /**
   * Fetch variables for a single variablesReference.
   */
  async getVariables(reference: number): Promise<DebugProtocol.Variable[]> {
    const session = this.currentSession;
    if (!session) return [];
    try {
      const response = await session.sendRequest('variables', { variablesReference: reference });
      return response.body?.variables ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Batch-fetch variables for multiple references in parallel.
   * This avoids the sequential N+1 query pattern when refreshing
   * variables from multiple scopes.
   */
  async batchGetVariables(references: number[]): Promise<BatchVariableResult[]> {
    const session = this.currentSession;
    if (!session || references.length === 0) return [];

    const results = await Promise.allSettled(
      references.map(async (ref): Promise<BatchVariableResult> => {
        try {
          const vars = await session.sendRequest('variables', { variablesReference: ref });
          return { reference: ref, variables: vars.body?.variables ?? [] };
        } catch (error) {
          return {
            reference: ref,
            variables: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    return results.map(r =>
      r.status === 'fulfilled' ? r.value : { reference: 0, variables: [], error: r.reason?.message ?? String(r.reason) },
    );
  }

  /**
   * Fetch scopes for the current thread and then batch-fetch all
   * variables from all scopes in parallel.
   */
  async getScopesAndVariables(): Promise<{ scopeName: string; variables: DebugProtocol.Variable[] }[]> {
    const session = this.currentSession;
    if (!session) return [];

    const thread = session.currentThread;
    if (!thread) return [];

    try {
      const scopesResponse = await session.sendRequest('scopes', { frameId: thread.threadId });
      const scopes = scopesResponse.body?.scopes ?? [];
      if (!scopes || scopes.length === 0) return [];

      // Batch-fetch variables from all scopes in parallel
      const refs = scopes.map(s => s.variablesReference);
      const results = await this.batchGetVariables(refs);

      // Build a map for O(1) lookup
      const resultMap = new Map<number, DebugProtocol.Variable[]>();
      for (const r of results) {
        resultMap.set(r.reference, r.variables);
      }

      return scopes.map(s => ({
        scopeName: s.name,
        variables: resultMap.get(s.variablesReference) ?? [],
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetch just scope descriptors (without variables) for the current frame.
   */
  async fetchScopes(): Promise<DebugProtocol.Scope[]> {
    const session = this.currentSession;
    if (!session) return [];

    const frameId = session.currentFrame?.raw?.id;
    if (!frameId) return [];

    try {
      const response = await session.sendRequest('scopes', { frameId });
      return response.body?.scopes ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch stack frames for the current thread.
   */
  async fetchStackFrames(): Promise<{ frames: DebugProtocol.StackFrame[]; totalFrames?: number }> {
    const session = this.currentSession;
    if (!session) return { frames: [] };

    const threadId = session.currentThread?.threadId;
    if (!threadId) return { frames: [] };

    try {
      const response = await session.sendRequest('stackTrace', { threadId });
      return {
        frames: response.body?.stackFrames ?? [],
        totalFrames: response.body?.totalFrames,
      };
    } catch {
      return { frames: [] };
    }
  }

  /**
   * Evaluate an expression in the current debug session.
   */
  async evaluate(expression: string, frameId?: number, context: 'repl' | 'hover' | 'watch' = 'repl'): Promise<{ result: string; type?: string; variablesReference?: number; error?: string }> {
    const session = this.currentSession;
    if (!session) return { result: '', error: 'No active session' };

    try {
      const effectiveFrameId = frameId ?? session.currentFrame?.raw?.id;
      const reply = await session.sendRequest('evaluate', {
        expression,
        frameId: effectiveFrameId,
        context,
      });
      return {
        result: reply.body?.result ?? 'undefined',
        type: reply.body?.type,
        variablesReference: reply.body?.variablesReference,
      };
    } catch (error) {
      return {
        result: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send a continue request to the current session.
   */
  async continue(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      await session.sendRequest('continue', { threadId: session.currentThread?.threadId ?? 0 });
    }
  }

  /**
   * Send a step-over request.
   */
  async stepOver(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      await session.sendRequest('next', { threadId: session.currentThread?.threadId ?? 0 });
    }
  }

  /**
   * Send a step-into request.
   */
  async stepInto(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      await session.sendRequest('stepIn', { threadId: session.currentThread?.threadId ?? 0 });
    }
  }

  /**
   * Send a step-out request.
   */
  async stepOut(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      await session.sendRequest('stepOut', { threadId: session.currentThread?.threadId ?? 0 });
    }
  }

  /**
   * Stop the debug session.
   */
  async stop(): Promise<void> {
    this._temporaryRunToLine = null;
    await this.javaDebug.stop();
  }

  /**
   * Pause the running debug session.
   */
  async pause(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      await session.sendRequest('pause', { threadId: session.currentThread?.threadId ?? 0 });
    }
  }

  /**
   * Restart the debug session (stop and re-attach if possible).
   */
  async restart(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      try {
        await session.sendRequest('restart', { arguments: session.configuration });
      } catch {
        // Fallback: just stop
        await this.stop();
      }
    }
  }

  /**
   * Run to cursor (set temporary breakpoint at line and continue).
   */
  async runToCursor(line: number, source: DebugProtocol.Source): Promise<void> {
    const session = this.currentSession;
    if (!session) return;

    const threadId = session.currentThread?.threadId ?? 0;
    const currentBreakpoints = (session as any).breakpoints || [];

    this._temporaryRunToLine = { line, source };
    await session.sendRequest('setBreakpoints', {
      source,
      lines: [line],
      breakpoints: [{ line }],
    });
    await this.continue();
  }

  /**
   * Toggle breakpoint muting state.
   */
  toggleMuteBreakpoints(): boolean {
    this._breakpointsMuted = !this._breakpointsMuted;
    this.state = { ...this.state, breakpointsMuted: this._breakpointsMuted };
    this.onStateChangeEmitter.fire(this.state);
    return this._breakpointsMuted;
  }

  /**
   * Set variable value.
   */
  async setVariable(variablesReference: number, name: string, value: string): Promise<{ success: boolean; error?: string }> {
    const session = this.currentSession;
    if (!session) return { success: false, error: 'No active session' };

    try {
      const reply = await session.sendRequest('setVariable', {
        variablesReference,
        name,
        value,
      });
      return { success: reply.success ?? true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}