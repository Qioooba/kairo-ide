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

@injectable()
export class SearchStreamService {
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  protected ws: WebSocket | null = null;
  protected state: SearchStreamState = INITIAL_STREAM_STATE;
  protected readonly listeners = new Set<SearchStreamListener>();
  protected currentAbort: AbortController | null = null;

  get snapshot(): SearchStreamState {
    return this.state;
  }

  subscribe(listener: SearchStreamListener): () => void {
    this.listeners.add(listener);
    this.notifyListener(listener, this.state);
    return () => this.listeners.delete(listener);
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
      return;
    }

    this.ws = ws;

    ws.addEventListener('open', () => {
      if (signal.aborted) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({
        workspaceId: opts.workspaceId,
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
      }
      this.ws = null;
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
    });
  }

  cancel(): void {
    this.currentAbort?.abort();
    this.currentAbort = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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