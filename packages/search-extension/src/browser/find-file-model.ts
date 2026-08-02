import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { fuzzyScore } from './search-everywhere-model';
import { FileIndexService } from './file-index-service';

export interface FindFileItem {
  id: string;
  label: string;
  detail: string;
  uri: string;
  score: number;
}

export interface FindFileState {
  status: 'idle' | 'loading' | 'results' | 'empty' | 'error';
  query: string;
  items: readonly FindFileItem[];
  selectedIndex: number;
  error?: Error;
}

export type FindFileListener = (state: FindFileState) => void;

const CACHE_TTL_MS = 15_000;
const PATH_WEIGHTS: Record<string, number> = {
  'src': 3,
  'lib': 2,
  'app': 2,
  'include': 2,
  'test': 1,
  'tests': 1,
};
const DEPRIORITIZED_DIRS = ['.git', '.svn', 'node_modules', 'target', 'build', 'dist', '.kairo', '__pycache__', '.next', '.nuxt'];

function pathWeight(relativePath: string): number {
  const segments = relativePath.toLowerCase().replace(/\\/g, '/').split('/');
  let weight = 0;
  for (const segment of segments) {
    if (DEPRIORITIZED_DIRS.includes(segment)) return -10;
    weight += PATH_WEIGHTS[segment] ?? 0;
  }
  return weight;
}

@injectable()
export class FindFileModel {
  @inject(FileService) protected readonly files!: FileService;
  @inject(WorkspaceContextService) protected readonly workspace!: WorkspaceContextService;
  @inject(FileIndexService) protected readonly fileIndex!: FileIndexService;

  protected state: FindFileState = { status: 'idle', query: '', items: [], selectedIndex: 0 };
  protected readonly listeners = new Set<FindFileListener>();
  protected controller: AbortController | undefined;
  protected generation = 0;
  protected fileCache: FindFileItem[] | undefined;
  protected cacheTimestamp = 0;
  protected recentFiles: FindFileItem[] = [];

  get snapshot(): FindFileState { return this.state; }

  subscribe(listener: FindFileListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async query(query: string, limit = 50): Promise<FindFileState> {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const trimmed = query.trim();

    if (!trimmed) {
      const items = this.recentFiles.slice(0, limit);
      this.publish({ status: items.length ? 'results' : 'idle', query: '', items, selectedIndex: 0 });
      return this.state;
    }

    this.publish({ status: 'loading', query: trimmed, items: [], selectedIndex: 0 });

    try {
      const allFiles = await this.getOrBuildFileList(controller.signal);
      if (controller.signal.aborted || generation !== this.generation) return this.state;

      const scored = allFiles
        .map(item => {
          const nameScore = fuzzyScore(trimmed, item.label);
          const pathScore = fuzzyScore(trimmed, item.detail);
          const score = Math.max(nameScore ?? -Infinity, pathScore !== undefined ? pathScore - 500 : -Infinity);
          return { ...item, score: Number.isFinite(score) ? score : undefined };
        })
        .filter((item): item is FindFileItem & { score: number } => item.score !== undefined)
        .sort((a, b) => {
          const pwA = pathWeight(a.detail);
          const pwB = pathWeight(b.detail);
          const scoreDiff = (b.score + pwB * 100) - (a.score + pwA * 100);
          if (scoreDiff !== 0) return scoreDiff;
          return a.label.localeCompare(b.label);
        })
        .slice(0, limit);

      this.publish({ status: scored.length ? 'results' : 'empty', query: trimmed, items: scored, selectedIndex: 0 });
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

  remember(item: FindFileItem): void {
    this.recentFiles = [item, ...this.recentFiles.filter(existing => existing.id !== item.id)].slice(0, 20);
  }

  cancel(): void { this.controller?.abort(); }

  protected async getOrBuildFileList(signal: AbortSignal): Promise<FindFileItem[]> {
    if (this.fileCache && Date.now() - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.fileCache;
    }
    const context = this.workspace.requireContext();
    const root = URI.fromFilePath(context.workspaceRoot);

    try {
      const entries = await this.fileIndex.listFiles({
        workspaceId: context.workspaceId,
        maxFiles: 50_000,
        signal,
      });
      if (signal.aborted) return [];
      const results = entries.map(entry => {
        const uri = root.resolve(entry.path);
        return {
          id: `file:${uri}`,
          label: entry.name,
          detail: entry.path,
          uri: uri.toString(),
          score: 0,
        };
      });
      this.fileCache = results;
      this.cacheTimestamp = Date.now();
      return results;
    } catch {
      // Fallback to FileService BFS when Agent is unavailable.
      return this.buildFileListViaFileService(root, signal);
    }
  }

  protected async buildFileListViaFileService(root: URI, signal: AbortSignal): Promise<FindFileItem[]> {
    const results: FindFileItem[] = [];
    const queue: URI[] = [root];
    let visited = 0;

    while (queue.length && visited < 10000) {
      if (signal.aborted) return [];
      let stat;
      try { stat = await this.files.resolve(queue.shift()!); }
      catch { if (signal.aborted) return []; continue; }
      for (const child of stat.children ?? []) {
        if (signal.aborted) return [];
        visited++;
        if (child.isDirectory && !DEPRIORITIZED_DIRS.includes(child.resource.path.base)) {
          queue.push(child.resource);
        }
        if (child.isFile) {
          const relative = root.relative(child.resource)?.toString() ?? child.resource.path.base;
          results.push({
            id: `file:${child.resource}`,
            label: child.resource.path.base,
            detail: relative,
            uri: child.resource.toString(),
            score: 0,
          });
        }
      }
    }

    this.fileCache = results;
    this.cacheTimestamp = Date.now();
    return results;
  }

  protected publish(state: FindFileState): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      try { listener(state); } catch (error) { try { console.error('Find File listener failed', error); } catch {} }
    }
  }
}
