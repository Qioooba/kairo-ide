import { injectable, multiInject } from '@theia/core/shared/inversify';

export type SearchEverywhereCategory = 'all' | 'files' | 'types' | 'symbols' | 'actions';
export type SearchEverywhereItemCategory = Exclude<SearchEverywhereCategory, 'all'>;

export interface SearchEverywhereItem {
  id: string;
  category: SearchEverywhereItemCategory;
  label: string;
  detail?: string;
  uri?: string;
  line?: number;
  character?: number;
  commandId?: string;
  score?: number;
  /** LSP SymbolKind — used for rendering a type icon. */
  kind?: number;
}

export interface SearchEverywhereState {
  status: 'idle' | 'loading' | 'results' | 'empty' | 'error';
  query: string;
  category: SearchEverywhereCategory;
  items: readonly SearchEverywhereItem[];
  selectedIndex: number;
  error?: Error;
}

export interface SearchEverywhereProvider {
  readonly id: string;
  search(query: string, signal: AbortSignal, limit: number): Promise<SearchEverywhereItem[]>;
}

export const SearchEverywhereProvider = Symbol('SearchEverywhereProvider');
export type SearchEverywhereListener = (state: SearchEverywhereState) => void;

/** Module-level so the hot fuzzy-scoring loop does not allocate per call. */
const WORD_BOUNDARY_RE = /[/\\._\-\s]/;

export function fuzzyScore(query: string, value: string): number | undefined {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = value.toLocaleLowerCase();
  if (!needle) return 0;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return 10_000 - exact * 10 - (haystack.length - needle.length);
  let score = 0;
  let cursor = 0;
  let last = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return undefined;
    score += last < 0 ? 100 - found : Math.max(1, 40 - (found - last - 1) * 5);
    if (found === 0 || WORD_BOUNDARY_RE.test(haystack[found - 1])) score += 30;
    last = found;
    cursor = found + 1;
  }
  return score - haystack.length;
}

@injectable()
export class SearchEverywhereModel {
  @multiInject(SearchEverywhereProvider) protected readonly providers!: SearchEverywhereProvider[];
  protected state: SearchEverywhereState = { status: 'idle', query: '', category: 'all', items: [], selectedIndex: 0 };
  protected readonly listeners = new Set<SearchEverywhereListener>();
  protected controller: AbortController | undefined;
  protected generation = 0;
  protected recent: SearchEverywhereItem[] = [];

  get snapshot(): SearchEverywhereState { return this.state; }
  get recentItems(): readonly SearchEverywhereItem[] { return this.recent; }

  subscribe(listener: SearchEverywhereListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async query(query: string, category: SearchEverywhereCategory = this.state.category, limit = 100): Promise<SearchEverywhereState> {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const trimmed = query.trim();
    if (!trimmed) {
      const items = this.filterCategory(this.recent, category).slice(0, limit);
      this.publish({ status: items.length ? 'results' : 'idle', query: '', category, items, selectedIndex: 0 });
      return this.state;
    }
    this.publish({ status: 'loading', query: trimmed, category, items: [], selectedIndex: 0 });
    try {
      const settled = await Promise.allSettled(this.providers.map(provider => provider.search(trimmed, controller.signal, limit)));
      if (controller.signal.aborted || generation !== this.generation) return this.state;
      if (settled.length > 0 && settled.every(result => result.status === 'rejected')) {
        const rejected = settled[0] as PromiseRejectedResult;
        throw rejected.reason;
      }
      const scored = settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
        .filter(item => category === 'all' || item.category === category)
        .map(item => ({ ...item, score: fuzzyScore(trimmed, `${item.label} ${item.detail ?? ''}`) }))
        .filter((item): item is SearchEverywhereItem & { score: number } => item.score !== undefined)
        .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label))
        .slice(0, limit);
      this.publish({ status: scored.length ? 'results' : 'empty', query: trimmed, category, items: scored, selectedIndex: 0 });
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generation) {
        this.publish({ status: 'error', query: trimmed, category, items: [], selectedIndex: 0, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    return this.state;
  }

  select(index: number): void {
    if (!this.state.items.length) return;
    const selectedIndex = (index + this.state.items.length) % this.state.items.length;
    this.publish({ ...this.state, selectedIndex });
  }

  remember(item: SearchEverywhereItem): void {
    this.recent = [item, ...this.recent.filter(existing => existing.id !== item.id)].slice(0, 20);
  }

  cancel(): void { this.controller?.abort(); }

  protected filterCategory(items: readonly SearchEverywhereItem[], category: SearchEverywhereCategory): SearchEverywhereItem[] {
    return items.filter(item => category === 'all' || item.category === category);
  }

  protected publish(state: SearchEverywhereState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { try { console.error('Search Everywhere listener failed', error); } catch {} }
    }
  }
}
