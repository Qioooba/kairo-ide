/**
 * Streaming search service — connects to the WebSocket endpoint
 * for incremental search results.
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

    this.currentAbort = new AbortController();
    const signal = this.currentAbort.signal;

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
      this.completionResolve = resolve;
      this.completionReject = reject;

      const clearIdle = (): void => {
        if (this.idleTimer !== undefined) {
          clearTimeout(this.idleTimer);
          this.idleTimer = undefined;
        }
      };

      const bumpIdle = (): void => {
        clearIdle();
        this.idleTimer = setTimeout(() => {
          if (signal.aborted || this.state.status !== 'streaming') {
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
          try { this.ws?.close(); } catch { /* ignore */ }
          this.ws = null;
          finish(new Error(msg));
        }, SEARCH_STREAM_IDLE_MS);
      };

      const finish = (error?: Error): void => {
        clearIdle();
        this.completionResolve = undefined;
        this.completionReject = undefined;
        if (signal.aborted) {
          return;
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      let ws: WebSocket;
      try {
        ws = protocols.length > 0
          ? new WebSocket(wsUrl, protocols)
          : new WebSocket(wsUrl);
      } catch (_err) {
        this.setState({
          status: 'error',
          matches: [],
          totalMatches: 0,
          batchIndex: 0,
          error: 'Failed to create WebSocket connection',
        });
        finish(new Error('Failed to create WebSocket connection'));
        return;
      }

      this.ws = ws;
      bumpIdle();

      ws.addEventListener('open', () => {
        if (signal.aborted) {
          ws.close();
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
        if (signal.aborted) {
          ws.close();
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
            ws.close();
            finish(new Error(event.error));
            return;
          }
          if (event.done) {
            this.clearNotifyTimer();
            this.revision++;
            this.setState({
              status: 'done',
              matches: this.matchBuffer,
              totalMatches: event.total || this.matchBuffer.length,
              batchIndex: this.state.batchIndex,
              truncated: event.truncated ?? this.matchBuffer.length < (event.total ?? this.matchBuffer.length),
              filesSearched: event.filesSearched ?? this.state.filesSearched,
              revision: this.revision,
            });
            ws.close();
            finish();
            return;
          }
          const batch = event.batch ?? [];
          if (batch.length > 0) {
            for (const match of batch) {
              this.matchBuffer.push(match);
            }
            this.scheduleStreamingUpdate(event.total ?? this.matchBuffer.length, event.batchIndex);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener('close', () => {
        this.ws = null;
        if (signal.aborted) {
          return;
        }
        if (this.state.status === 'streaming') {
          this.clearNotifyTimer();
          this.setState({
            status: 'done',
            matches: this.matchBuffer,
            totalMatches: this.state.totalMatches,
            batchIndex: this.state.batchIndex,
            truncated: this.state.truncated,
            filesSearched: this.state.filesSearched,
            revision: this.revision,
          });
          finish();
        }
      });

      ws.addEventListener('error', () => {
        if (signal.aborted) {
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
        this.ws = null;
        finish(new Error('WebSocket connection error'));
      });
    });
  }

  cancel(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.clearNotifyTimer();
    this.currentAbort?.abort();
    this.currentAbort = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    const reject = this.completionReject;
    this.completionResolve = undefined;
    this.completionReject = undefined;
    reject?.(new _KairoSearchCancelledError());
    if (this.state.status === 'streaming') {
      this.matchBuffer = [];
      this.setState({ ...INITIAL_STREAM_STATE });
    }
  }

  /** Publishes accumulated matches at most once per throttle window. */
  protected scheduleStreamingUpdate(totalMatches: number, batchIndex: number): void {
    this.pendingTotal = totalMatches;
    this.pendingBatchIndex = batchIndex;
    if (this.notifyTimer !== undefined) {
      return;
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      if (this.currentAbort?.signal.aborted || this.state.status !== 'streaming') {
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