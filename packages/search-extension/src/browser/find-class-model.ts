import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { JavaLanguageClient } from '@kairo/java-extension';
import { fuzzyScore } from './search-everywhere-model';
import { FileIndexService } from './file-index-service';

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
const SKIP_DIRS = new Set(['.git', '.svn', 'node_modules', 'target', 'build', 'dist', '.kairo', 'classes']);

@injectable()
export class FindClassModel {
  @inject(JavaLanguageClient) protected readonly java!: JavaLanguageClient;
  @inject(FileService) protected readonly files!: FileService;
  @inject(WorkspaceContextService) protected readonly workspace!: WorkspaceContextService;
  @inject(FileIndexService) protected readonly fileIndex!: FileIndexService;

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
      // File-name search first — fast, works before JDT index is warm, and survives
      // query re-fills that abort long waitJavaReady loops.
      let items = await this.searchClassesFromFiles(trimmed, controller.signal, limit);
      if (controller.signal.aborted || generation !== this.generation) return this.state;

      // Enrich / replace with JDT type symbols when LS is already ready (non-blocking).
      let jdtReady = false;
      try {
        jdtReady = (await this.java.fetchState()) === 'ready';
      } catch {
        jdtReady = false;
      }
      if (jdtReady) {
        const jdtItems = await this.searchClasses(trimmed, controller.signal, limit, false);
        if (controller.signal.aborted || generation !== this.generation) return this.state;
        if (jdtItems.length > 0) {
          items = jdtItems;
        }
      }

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

  protected async waitJavaReady(signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (signal.aborted) return false;
      try {
        const state = await this.java.fetchState();
        if (state === 'ready') return true;
      } catch {
        /* keep waiting */
      }
      await new Promise(r => setTimeout(r, 1_000));
    }
    try {
      return (await this.java.fetchState()) === 'ready';
    } catch {
      return false;
    }
  }

  protected async searchClasses(
    query: string,
    signal: AbortSignal,
    limit: number,
    allowEmptyCache = true,
  ): Promise<FindClassItem[]> {
    if (this.cache && this.cache.query === query && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
      if (allowEmptyCache || this.cache.items.length > 0) {
        return this.cache.items;
      }
    }

    let symbols: Awaited<ReturnType<JavaLanguageClient['workspaceSymbols']>> = [];
    try {
      symbols = await this.java.workspaceSymbols(query);
    } catch {
      symbols = [];
    }
    if (signal.aborted) return [];

    const results = (symbols ?? [])
      .filter((symbol: { kind: number; name: string; containerName?: string; location: { uri: string; range: { start: { line: number; character: number } } } }) => TYPE_KINDS.has(symbol.kind))
      .map((symbol: { kind: number; name: string; containerName?: string; location: { uri: string; range: { start: { line: number; character: number } } } }) => {
        const packageName = symbol.containerName ?? '';
        const score = fuzzyScore(query, symbol.name) ?? 0;
        const uri = symbol.location.uri;
        // Prefer source files over JDT classfile URIs so Find Class
        // opens editable .java instead of decompiled .class.
        const sourceBonus = /\.java$/i.test(uri) || uri.startsWith('file:') ? 50 : 0;
        return {
          id: `class:${uri}:${symbol.name}`,
          label: symbol.name,
          detail: packageName,
          uri,
          line: symbol.location.range.start.line,
          character: symbol.location.range.start.character,
          kind: symbol.kind,
          score: score + sourceBonus,
        };
      })
      .sort((a: { score: number; label: string }, b: { score: number; label: string }) => (b.score - a.score) || a.label.localeCompare(b.label))
      .slice(0, limit);

    // Do not cache empty results — they race with JDT indexing.
    if (results.length > 0) {
      this.cache = { query, items: results };
      this.cacheTimestamp = Date.now();
    }
    return results;
  }

  /**
   * Fallback when JDT workspace/symbol returns nothing: match simple class
   * names to `Foo.java` / `Foo.java` paths via file index or a shallow walk.
   */
  protected async searchClassesFromFiles(query: string, signal: AbortSignal, limit: number): Promise<FindClassItem[]> {
    const context = (() => {
      try {
        return this.workspace.requireContext();
      } catch {
        return undefined;
      }
    })();
    if (!context) return [];

    const root = URI.fromFilePath(context.workspaceRoot);
    let entries: Array<{ name: string; path: string }> = [];
    try {
      const listed = await this.fileIndex.listFiles({
        workspaceId: context.workspaceId,
        maxFiles: 50_000,
        signal,
      });
      entries = listed
        .filter(e => /\.java$/i.test(e.name))
        .map(e => ({ name: e.name, path: e.path }));
    } catch {
      entries = await this.walkJavaFiles(root, signal);
    }
    if (signal.aborted) return [];

    const results: FindClassItem[] = [];
    for (const entry of entries) {
      if (signal.aborted) return [];
      const simpleName = entry.name.replace(/\.java$/i, '');
      const score = fuzzyScore(query, simpleName);
      if (score === undefined) continue;
      const uri = root.resolve(entry.path).toString();
      const pkg = entry.path
        .replace(/\\/g, '/')
        .replace(/\.java$/i, '')
        .replace(/^.*?((?:src\/(?:main|test)\/java\/)|(?:src\/)|(?:WebRoot\/WEB-INF\/classes\/))?/, '')
        .split('/')
        .slice(0, -1)
        .filter(Boolean)
        .join('.');
      results.push({
        id: `class-file:${uri}:${simpleName}`,
        label: simpleName,
        detail: pkg,
        uri,
        line: 0,
        character: 0,
        kind: 5,
        score: score + 40,
      });
      if (results.length >= limit * 3) break;
    }
    return results
      .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  protected async walkJavaFiles(root: URI, signal: AbortSignal): Promise<Array<{ name: string; path: string }>> {
    const queue: URI[] = [root];
    const results: Array<{ name: string; path: string }> = [];
    let visited = 0;
    while (queue.length && visited < 8_000 && results.length < 2_000) {
      if (signal.aborted) return results;
      let stat;
      try {
        stat = await this.files.resolve(queue.shift()!);
      } catch {
        continue;
      }
      for (const child of stat.children ?? []) {
        if (signal.aborted) return results;
        visited++;
        if (child.isDirectory) {
          if (!SKIP_DIRS.has(child.resource.path.base)) queue.push(child.resource);
          continue;
        }
        if (child.isFile && /\.java$/i.test(child.resource.path.base)) {
          const rel = root.relative(child.resource)?.toString() ?? child.resource.path.base;
          results.push({ name: child.resource.path.base, path: rel });
        }
      }
    }
    return results;
  }

  protected publish(state: FindClassState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { try { console.error('Find Class listener failed', error); } catch {} }
    }
  }
}
