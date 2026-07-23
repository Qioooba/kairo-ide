import { inject, injectable } from '@theia/core/shared/inversify';
import { JavaLanguageClient } from '@kairo/java-extension';
import { fuzzyScore } from './search-everywhere-model';

export interface FindClassItem {
  id: string;
  label: string;
  detail: string;
  uri: string;
  line: number;
  character: number;
  kind: number;
  score: number;
}

export interface FindClassState {
  status: 'idle' | 'loading' | 'results' | 'empty' | 'error';
  query: string;
  items: readonly FindClassItem[];
  selectedIndex: number;
  error?: Error;
}

export type FindClassListener = (state: FindClassState) => void;

const TYPE_KINDS = new Set([5, 10, 11, 23]); // Class, Enum, Interface, Struct
const CACHE_TTL_MS = 3_000;

@injectable()
export class FindClassModel {
  @inject(JavaLanguageClient) protected readonly java!: JavaLanguageClient;

  protected state: FindClassState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected readonly listeners = new Set<FindClassListener>();
  protected controller: AbortController | undefined;
  protected generation = 0;
  protected cache: { query: string; items: FindClassItem[] } | undefined;
  protected cacheTimestamp = 0;

  get snapshot(): FindClassState { return this.state; }

  subscribe(listener: FindClassListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async query(query: string, limit = 30): Promise<FindClassState> {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const trimmed = query.trim();

    if (!trimmed) {
      this.publish({ status: 'idle', query: '', items: [], selectedIndex: 0 });
      return this.state;
    }

    this.publish({ status: 'loading', query: trimmed, items: [], selectedIndex: 0 });

    try {
      const items = await this.searchClasses(trimmed, controller.signal, limit);
      if (controller.signal.aborted || generation !== this.generation) return this.state;

      this.publish({ status: items.length ? 'results' : 'empty', query: trimmed, items, selectedIndex: 0 });
    } catch (error) {
      if (!controller.signal.aborted && generation === this.generation) {
        this.publish({ status: 'error', query: trimmed, items: [], selectedIndex: 0, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    return this.state;
  }

  select(index: number): void {
    if (!this.state.items.length) return;
    const selectedIndex = (index + this.state.items.length) % this.state.items.length;
    this.publish({ ...this.state, selectedIndex });
  }

  cancel(): void { this.controller?.abort(); }

  protected async searchClasses(query: string, signal: AbortSignal, limit: number): Promise<FindClassItem[]> {
    if (this.cache && this.cache.query === query && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.cache.items;
    }

    const symbols = await this.java.workspaceSymbols(query);
    if (signal.aborted) return [];

    const results = (symbols ?? [])
      .filter((symbol: { kind: number; name: string; containerName?: string; location: { uri: string; range: { start: { line: number; character: number } } } }) => TYPE_KINDS.has(symbol.kind))
      .map((symbol: { kind: number; name: string; containerName?: string; location: { uri: string; range: { start: { line: number; character: number } } } }) => {
        const packageName = symbol.containerName ?? '';
        const score = fuzzyScore(query, symbol.name) ?? 0;
        return {
          id: `class:${symbol.location.uri}:${symbol.name}`,
          label: symbol.name,
          detail: packageName,
          uri: symbol.location.uri,
          line: symbol.location.range.start.line,
          character: symbol.location.range.start.character,
          kind: symbol.kind,
          score,
        };
      })
      .sort((a: { score: number; label: string }, b: { score: number; label: string }) => (b.score - a.score) || a.label.localeCompare(b.label))
      .slice(0, limit);

    this.cache = { query, items: results };
    this.cacheTimestamp = Date.now();
    return results;
  }

  protected publish(state: FindClassState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { try { console.error('Find Class listener failed', error); } catch {} }
    }
  }
}