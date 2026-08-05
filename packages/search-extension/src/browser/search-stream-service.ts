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

@injectable()
export class SearchStreamService {
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  protected ws: WebSocket | null = null;
  protected state: SearchStreamState = INITIAL_STREAM_STATE;
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

    this.setState({
      status: 'streaming',
      matches: [],
      totalMatches: 0,
      batchIndex: 0,
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
            matches: this.state.matches,
            totalMatches: this.state.totalMatches,
            batchIndex: this.state.batchIndex,
            error: msg,
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
            this.setState({
              status: 'error',
              matches: this.state.matches,
              totalMatches: this.state.totalMatches,
              batchIndex: this.state.batchIndex,
              error: event.error,
            });
            ws.close();
            finish(new Error(event.error));
            return;
          }
          if (event.done) {
            this.setState({
              status: 'done',
              matches: this.state.matches,
              totalMatches: event.total || this.state.totalMatches,
              batchIndex: this.state.batchIndex,
            });
            ws.close();
            finish();
            return;
          }
          const newMatches = [...this.state.matches, ...(event.batch ?? [])];
          this.setState({
            status: 'streaming',
            matches: newMatches,
            totalMatches: event.total ?? newMatches.length,
            batchIndex: event.batchIndex,
          });
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
          this.setState({
            status: 'done',
            matches: this.state.matches,
            totalMatches: this.state.totalMatches,
            batchIndex: this.state.batchIndex,
          });
          finish();
        }
      });

      ws.addEventListener('error', () => {
        if (signal.aborted) {
          return;
        }
        this.setState({
          status: 'error',
          matches: this.state.matches,
          totalMatches: this.state.totalMatches,
          batchIndex: this.state.batchIndex,
          error: 'WebSocket connection error',
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
      this.setState({ ...INITIAL_STREAM_STATE });
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