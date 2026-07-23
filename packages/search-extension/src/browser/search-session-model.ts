import { inject, injectable } from '@theia/core/shared/inversify';
import type { SearchMatch, SearchResponse } from '@kairo/protocol';
import {
  KairoSearchCancelledError,
  KairoSearchService,
  type SearchOptions,
} from './search-service';
import { SearchStreamService, type SearchStreamState } from './search-stream-service';

export type SearchSessionStatus =
  | 'idle'
  | 'loading'
  | 'results'
  | 'empty'
  | 'error'
  | 'cancelled';

export interface SearchSessionState {
  readonly status: SearchSessionStatus;
  readonly requestId: number;
  readonly options?: Readonly<SearchOptions>;
  readonly matches: readonly SearchMatch[];
  readonly totalMatches: number;
  readonly truncated: boolean;
  readonly elapsedMs?: number;
  readonly erroredFiles: SearchResponse['erroredFiles'];
  readonly error?: Error;
  /** Streaming search state, when using WebSocket streaming. */
  readonly streamState?: SearchStreamState;
}

export type SearchSessionListener = (state: SearchSessionState) => void;

const INITIAL_STATE: SearchSessionState = {
  status: 'idle',
  requestId: 0,
  matches: [],
  totalMatches: 0,
  truncated: false,
  erroredFiles: [],
};

/**
 * UI-agnostic state model for Kairo full-text search.
 *
 * Theia remains responsible for presenting its standard search surfaces. This
 * model gives those surfaces (and the planned Kairo Search Center) one source
 * of truth for request lifecycle, filters and stale-response protection.
 */
@injectable()
export class KairoSearchSessionModel {
  @inject(KairoSearchService) protected readonly searchService!: KairoSearchService;
  @inject(SearchStreamService) protected readonly streamService!: SearchStreamService;

  protected state: SearchSessionState = INITIAL_STATE;
  protected requestId = 0;
  protected readonly listeners = new Set<SearchSessionListener>();
  protected unsubscribeStream: (() => void) | undefined;

  get snapshot(): SearchSessionState {
    return this.state;
  }

  subscribe(listener: SearchSessionListener): () => void {
    this.listeners.add(listener);
    this.notifyListener(listener, this.state);
    return () => this.listeners.delete(listener);
  }

  async search(options: SearchOptions): Promise<SearchSessionState> {
    const requestId = ++this.requestId;
    const normalized = normalizeOptions(options);
    this.update({
      status: 'loading',
      requestId,
      options: normalized,
      matches: [],
      totalMatches: 0,
      truncated: false,
      erroredFiles: [],
    });

    try {
      const response = await this.searchService.search(normalized);
      if (requestId !== this.requestId) {
        return this.state;
      }
      this.update({
        status: response.matches.length > 0 ? 'results' : 'empty',
        requestId,
        options: normalized,
        matches: response.matches,
        totalMatches: response.totalMatches,
        truncated: response.truncated,
        elapsedMs: response.elapsedMs,
        erroredFiles: response.erroredFiles,
      });
    } catch (error) {
      if (requestId !== this.requestId) {
        return this.state;
      }
      if (error instanceof KairoSearchCancelledError) {
        this.update({
          status: 'cancelled',
          requestId,
          options: normalized,
          matches: [],
          totalMatches: 0,
          truncated: false,
          erroredFiles: [],
        });
      } else {
        this.update({
          status: 'error',
          requestId,
          options: normalized,
          matches: [],
          totalMatches: 0,
          truncated: false,
          erroredFiles: [],
          error: toError(error),
        });
      }
    }
    return this.state;
  }

  cancel(): void {
    if (this.state.status !== 'loading') {
      return;
    }
    this.searchService.cancel();
    // Invalidate the running call immediately. Its rejection is now stale and
    // cannot replace a later query's state.
    const requestId = ++this.requestId;
    this.update({
      status: 'cancelled',
      requestId,
      options: this.state.options,
      matches: [],
      totalMatches: 0,
      truncated: false,
      erroredFiles: [],
    });
  }

  /** Start a streaming search via WebSocket. Results arrive incrementally. */
  async searchStream(options: SearchOptions): Promise<void> {
    this.cancelStream();
    const normalized = normalizeOptions(options);
    const requestId = ++this.requestId;
    this.update({
      status: 'loading',
      requestId,
      options: normalized,
      matches: [],
      totalMatches: 0,
      truncated: false,
      erroredFiles: [],
    });

    this.unsubscribeStream = this.streamService.subscribe(streamState => {
      if (requestId !== this.requestId) {
        return;
      }
      switch (streamState.status) {
        case 'streaming':
          this.update({
            status: 'loading',
            requestId,
            options: normalized,
            matches: streamState.matches,
            totalMatches: streamState.totalMatches,
            truncated: false,
            erroredFiles: [],
            streamState,
          });
          break;
        case 'done':
          this.update({
            status: streamState.matches.length > 0 ? 'results' : 'empty',
            requestId,
            options: normalized,
            matches: streamState.matches,
            totalMatches: streamState.totalMatches,
            truncated: false,
            erroredFiles: [],
            streamState,
          });
          break;
        case 'error':
          this.update({
            status: 'error',
            requestId,
            options: normalized,
            matches: streamState.matches,
            totalMatches: streamState.totalMatches,
            truncated: false,
            erroredFiles: [],
            error: new Error(streamState.error ?? 'Stream search failed'),
            streamState,
          });
          break;
      }
    });

    await this.streamService.searchStream(normalized);
  }

  cancelStream(): void {
    this.streamService.cancel();
    this.unsubscribeStream?.();
    this.unsubscribeStream = undefined;
  }

  reset(): void {
    this.searchService.cancel();
    const requestId = ++this.requestId;
    this.update({ ...INITIAL_STATE, requestId });
  }

  protected update(state: SearchSessionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      this.notifyListener(listener, state);
    }
  }

  protected notifyListener(listener: SearchSessionListener, state: SearchSessionState): void {
    try {
      listener(state);
    } catch (error) {
      // A view callback is an observer, not part of the search operation. One
      // broken view must not prevent other views from updating or turn a
      // successful backend response into a failed search.
      try {
        globalThis.console?.error('Kairo search state listener failed', error);
      } catch {
        // Logging must be best-effort as custom test/browser consoles can throw.
      }
    }
  }
}

function normalizeOptions(options: SearchOptions): SearchOptions {
  return {
    ...options,
    query: options.query ?? '',
    isRegex: options.isRegex ?? false,
    caseSensitive: options.caseSensitive ?? false,
    wholeWord: options.wholeWord ?? false,
    include: normalizeGlobs(options.include),
    exclude: normalizeGlobs(options.exclude),
  };
}

function normalizeGlobs(globs: string[] | undefined): string[] | undefined {
  if (!globs) {
    return undefined;
  }
  const normalized = [...new Set(globs.map(glob => glob.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
