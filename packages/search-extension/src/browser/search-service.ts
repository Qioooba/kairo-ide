/**
 * Kairo search service — wraps the search endpoint with a
 * debounced, cancellable API. The widget binds to this.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { SearchRequest, SearchResponse } from '@kairo/protocol';
import { RuntimeConnectionService } from '@kairo/runtime-extension';

export interface SearchOptions extends Partial<SearchRequest> {
  workspaceId: string;
  /**
   * Frontend-only preview cap: at most this many matches are rendered.
   * Never sent to the backend (REST/stream clients pick explicit fields).
   */
  displayLimit?: number;
}

/**
 * Error thrown when a search was cancelled by a newer search()
 * call (or by an explicit cancel()). Callers can swallow this
 * without surfacing it to the UI.
 */
export class KairoSearchCancelledError extends Error {
  constructor() {
    super('search cancelled');
    this.name = 'KairoSearchCancelledError';
  }
}

@injectable()
export class KairoSearchService {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  protected current?: AbortController;

  async search(opts: SearchOptions): Promise<SearchResponse> {
    // Abort any in-flight request before starting a new one.
    // Previously the previous fetch's AbortError propagated as
    // an unhandled promise rejection on every keystroke.
    this.current?.abort();
    this.current = new AbortController();
    const signal = this.current.signal;
    try {
      return await this.runtime.request('POST /api/v1/search', {
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
      }, { signal });
    } catch (e) {
      // Convert DOMException AbortError into a typed cancellation
      // error so callers can distinguish "no result because we
      // were superseded" from a real network failure.
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        throw new KairoSearchCancelledError();
      }
      throw e;
    }
  }

  cancel(): void {
    this.current?.abort();
    this.current = undefined;
  }
}
