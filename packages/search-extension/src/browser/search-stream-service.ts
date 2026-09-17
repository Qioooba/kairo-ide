/**
 * Streaming search service — connects to the WebSocket endpoint
 * for incremental search results.
 *
 * Implements KAIRO-W10:
 * - Independent StreamSession per search query with identity validation.
 * - Distinguishes premature socket close (interrupted/incomplete) from normal completion (done).
 * - Prevents stale close callbacks from wiping active WebSocket references.
 * - Retains partial matches and refreshes revision upon interruption.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { SearchMatch, SearchStreamEvent } from '@kairo/protocol';
import { PROTOCOL_VERSION_PATH } from '@kairo/protocol';
import { RuntimeConnectionService, KAIRO_WS_SUBPROTOCOL } from '@kairo/runtime-extension';
import { KairoSearchCancelledError as _KairoSearchCancelledError, type SearchOptions } from './search-service';

export type SearchStreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface SearchStreamState {
  status: SearchStreamStatus;
  matches: SearchMatch[];
  totalMatches: number;
  batchIndex: number;
  error?: string;
  /** Backend capped the result set (MaxResults). UI must surface a truncated banner. */
  truncated?: boolean;
  /** Connection dropped before explicit done event received. */
  interrupted?: boolean;
  filesSearched?: number;
  /**
   * Bumped whenever `matches` gains entries. Matches are accumulated in one
   * mutable buffer (avoids copying the whole result set per WebSocket
   * batch); consumers should key expensive recomputation off this counter
   * instead of array identity.
   */
  revision?: number;
}

export type SearchStreamListener = (state: SearchStreamState) => void;

export interface StreamSession {
  readonly id: number;
  readonly ws: WebSocket;
  readonly abortController: AbortController;
  idleTimer?: ReturnType<typeof setTimeout>;
  doneReceived: boolean;
  settled: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

const INITIAL_STREAM_STATE: SearchStreamState = {
  status: 'idle',
  matches: [],
  totalMatches: 0,
  batchIndex: 0,
};

/** Abort hung streams that never send done/close (avoids eternal loading). */
const SEARCH_STREAM_IDLE_MS = 60_000;

/**
 * Coalesce stream notifications so each WS batch does not trigger a full
 * UI recomputation. Results keep accumulating; listeners see them at most
 * this often while streaming.
 */
const STREAM_NOTIFY_INTERVAL_MS = 120;

@injectable()
export class SearchStreamService {
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  protected ws: WebSocket | null = null;
  protected state: SearchStreamState = INITIAL_STREAM_STATE;
  /** Mutable accumulation buffer exposed via `state.matches` (same reference). */
  protected matchBuffer: SearchMatch[] = [];
  protected revision = 0;
  protected notifyTimer: ReturnType<typeof setTimeout> | undefined;
  protected pendingTotal = 0;
  protected pendingBatchIndex = 0;
  protected readonly listeners = new Set<SearchStreamListener>();
  protected currentAbort: AbortController | null = null;
  protected completionResolve: (() => void) | undefined;
  protected completionReject: ((error: Error) => void) | undefined;
  protected idleTimer: ReturnType<typeof setTimeout> | undefined;

  protected sessionCounter = 0;
  protected currentSession: StreamSession | null = null;

  get snapshot(): SearchStreamState {
    return this.state;
  }

  subscribe(listener: SearchStreamListener): () => void {
    this.listeners.add(listener);
    this.notifyListener(listener, this.state);
    return () => this.listeners.delete(listener);
  }

  /** Clear terminal stream state so new subscribers are not primed with a stale `done`. */
  reset(): void {
    this.setState({ ...INITIAL_STREAM_STATE });
  }

  async searchStream(opts: SearchOptions): Promise<void> {
    this.cancel();

    const sessionId = ++this.sessionCounter;
    const abortController = new AbortController();
    const signal = abortController.signal;
    this.currentAbort = abortController;

    this.matchBuffer = [];
    this.revision = 0;
    this.pendingTotal = 0;
    this.pendingBatchIndex = 0;
    this.clearNotifyTimer();
    this.setState({
      status: 'streaming',
      matches: this.matchBuffer,
      totalMatches: 0,
      batchIndex: 0,
      revision: this.revision,
    });

    const baseUrl = this.runtime.baseUrl().replace(/\/$/, '');
    const wsUrl = baseUrl.replace(/^http/, 'ws') + PROTOCOL_VERSION_PATH + '/search/stream';

    const secret = this.runtime.getAgentSecret();
    const protocols = secret ? [KAIRO_WS_SUBPROTOCOL, secret] : [];

    return new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = this.createWebSocket(wsUrl, protocols);
      } catch (_err) {
        this.setState({
          status: 'error',
          matches: [],
          totalMatches: 0,
          batchIndex: 0,
          error: 'Failed to create WebSocket connection',
        });
        reject(new Error('Failed to create WebSocket connection'));
        return;
      }

      const session: StreamSession = {
        id: sessionId,
        ws,
        abortController,
        doneReceived: false,
        settled: false,
        resolve,
        reject,
      };

      this.currentSession = session;
      this.ws = ws;
      this.completionResolve = resolve;
      this.completionReject = reject;

      const clearIdle = (): void => {
        if (session.idleTimer !== undefined) {
          clearTimeout(session.idleTimer);
          session.idleTimer = undefined;
        }
      };

      const bumpIdle = (): void => {
        clearIdle();
        session.idleTimer = setTimeout(() => {
          if (this.currentSession !== session || signal.aborted || session.settled || this.state.status !== 'streaming') {
            return;
          }
          const msg = 'Search timed out waiting for results';
          this.setState({
            status: 'error',
            matches: this.matchBuffer,
            totalMatches: this.state.totalMatches,
            batchIndex: this.state.batchIndex,
            error: msg,
            revision: this.revision,
          });
          try { ws.close(); } catch { /* ignore */ }
          finish(new Error(msg));
        }, SEARCH_STREAM_IDLE_MS);
      };

      const finish = (error?: Error): void => {
        if (session.settled) {
          return;
        }
        session.settled = true;
        clearIdle();

        if (this.currentSession === session) {
          this.currentSession = null;
          this.completionResolve = undefined;
          this.completionReject = undefined;
        }
        if (this.ws === ws) {
          this.ws = null;
        }

        if (signal.aborted) {
          return;
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      bumpIdle();

      ws.addEventListener('open', () => {
        if (this.currentSession !== session || signal.aborted || session.settled) {
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        bumpIdle();
        ws.send(JSON.stringify({
          workspaceId: opts.workspaceId,
          rootPath: opts.rootPath,
          query: opts.query ?? '',
          isRegex: opts.isRegex ?? false,
          caseSensitive: opts.caseSensitive ?? false,
          wholeWord: opts.wholeWord ?? false,
          include: opts.include,
          exclude: opts.exclude,
          contextLines: opts.contextLines,
          maxResults: opts.maxResults,
          previewReplace: opts.previewReplace,
        }));
      });

      ws.addEventListener('message', (ev) => {
        if (this.currentSession !== session || signal.aborted || session.settled) {
          return;
        }
        bumpIdle();
        try {
          const event: SearchStreamEvent = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          if (event.kind !== 'searchStream') {
            return;
          }
          if (event.error) {
            this.clearNotifyTimer();
            this.setState({
              status: 'error',
              matches: this.matchBuffer,
              totalMatches: this.state.totalMatches,
              batchIndex: this.state.batchIndex,
              error: event.error,
              truncated: event.truncated ?? this.state.truncated,
              filesSearched: event.filesSearched ?? this.state.filesSearched,
              revision: this.revision,
            });
            finish(new Error(event.error));
            try { ws.close(); } catch { /* ignore */ }
            return;
          }
          if (event.done) {
            session.doneReceived = true;
            this.clearNotifyTimer();
            this.revision++;
            this.setState({
              status: 'done',
              matches: this.matchBuffer,
              totalMatches: event.total || this.matchBuffer.length,
              batchIndex: this.state.batchIndex,
              truncated: event.truncated ?? (this.matchBuffer.length < (event.total ?? this.matchBuffer.length)),
              filesSearched: event.filesSearched ?? this.state.filesSearched,
              revision: this.revision,
            });
            finish();
            try { ws.close(); } catch { /* ignore */ }
            return;
          }
          const batch = event.batch ?? [];
          if (batch.length > 0) {
            for (const match of batch) {
              this.matchBuffer.push(match);
            }
            this.scheduleStreamingUpdate(session, event.total ?? this.matchBuffer.length, event.batchIndex);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener('close', () => {
        // Only wipe this.ws if it still matches this session
        if (this.ws === ws) {
          this.ws = null;
        }
        if (this.currentSession === session) {
          this.currentSession = null;
        }

        if (session.settled || signal.aborted) {
          return;
        }

        this.clearNotifyTimer();

        // If socket closed before explicit done event, treat as interrupted error
        if (!session.doneReceived) {
          const errorMsg = '搜索中断，结果不完整';
          this.revision++;
          this.setState({
            status: 'error',
            interrupted: true,
            matches: this.matchBuffer,
            totalMatches: this.matchBuffer.length,
            batchIndex: this.state.batchIndex,
            error: errorMsg,
            truncated: true,
            filesSearched: this.state.filesSearched,
            revision: this.revision,
          });
          finish(new Error(errorMsg));
        } else {
          finish();
        }
      });

      ws.addEventListener('error', () => {
        if (this.ws === ws) {
          this.ws = null;
        }
        if (this.currentSession === session) {
          this.currentSession = null;
        }

        if (session.settled || signal.aborted) {
          return;
        }

        this.clearNotifyTimer();
        this.setState({
          status: 'error',
          matches: this.matchBuffer,
          totalMatches: this.state.totalMatches,
          batchIndex: this.state.batchIndex,
          error: 'WebSocket connection error',
          truncated: this.state.truncated,
          filesSearched: this.state.filesSearched,
          revision: this.revision,
        });
        finish(new Error('WebSocket connection error'));
      });
    });
  }

  cancel(): void {
    this.clearNotifyTimer();
    const session = this.currentSession;
    if (session) {
      if (session.idleTimer !== undefined) {
        clearTimeout(session.idleTimer);
        session.idleTimer = undefined;
      }
      session.abortController.abort();
      try {
        session.ws.close();
      } catch {
        // ignore
      }
      if (!session.settled) {
        session.settled = true;
        session.reject(new _KairoSearchCancelledError());
      }
      if (this.ws === session.ws) {
        this.ws = null;
      }
      this.currentSession = null;
    }
    this.currentAbort = null;
    this.completionResolve = undefined;
    this.completionReject = undefined;
    if (this.state.status === 'streaming') {
      this.matchBuffer = [];
      this.setState({ ...INITIAL_STREAM_STATE });
    }
  }

  /** Allows injection/mocking of WebSocket constructor in unit tests. */
  createWebSocket(url: string, protocols: string[]): WebSocket {
    return protocols.length > 0
      ? new WebSocket(url, protocols)
      : new WebSocket(url);
  }

  /** Publishes accumulated matches at most once per throttle window. */
  protected scheduleStreamingUpdate(session: StreamSession, totalMatches: number, batchIndex: number): void {
    this.pendingTotal = totalMatches;
    this.pendingBatchIndex = batchIndex;
    if (this.notifyTimer !== undefined) {
      return;
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      if (this.currentSession !== session || session.abortController.signal.aborted || session.settled || this.state.status !== 'streaming') {
        return;
      }
      this.revision++;
      this.setState({
        status: 'streaming',
        matches: this.matchBuffer,
        totalMatches: this.pendingTotal,
        batchIndex: this.pendingBatchIndex,
        truncated: this.state.truncated,
        filesSearched: this.state.filesSearched,
        revision: this.revision,
      });
    }, STREAM_NOTIFY_INTERVAL_MS);
  }

  protected clearNotifyTimer(): void {
    if (this.notifyTimer !== undefined) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = undefined;
    }
  }

  protected setState(state: SearchStreamState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      this.notifyListener(listener, state);
    }
  }

  protected notifyListener(listener: SearchStreamListener, state: SearchStreamState): void {
    try {
      listener(state);
    } catch (error) {
      try {
        globalThis.console?.error('Kairo search stream listener failed', error);
      } catch {
        // ignore
      }
    }
  }
}