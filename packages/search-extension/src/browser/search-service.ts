/**
 * Kairo search service — wraps the search endpoint with a
 * debounced, cancellable API. The widget binds to this.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import type { SearchRequest, SearchResponse } from '@kairo/protocol';
import { KairoRuntimeImpl } from '@kairo/runtime-extension';

export interface SearchOptions extends Partial<SearchRequest> {
  workspaceId: string;
}

@injectable()
export class KairoSearchService {
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;
  protected current?: AbortController;

  async search(opts: SearchOptions): Promise<SearchResponse> {
    this.current?.abort();
    this.current = new AbortController();
    return this.runtime.request('POST /api/v1/search', {
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
    }, { signal: this.current.signal });
  }

  cancel(): void {
    this.current?.abort();
    this.current = undefined;
  }
}

export function bindSearchExtension(bind: any): void {
  bind(KairoSearchService).toSelf().inSingletonScope();
}
