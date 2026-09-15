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
  /** Precomputed path weight so sorting does not recompute it per comparison. */
  weight?: number;
  lowerLabel?: string;
  lowerDetail?: string;
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

/** Module-level so the hot fuzzy-scoring loop does not allocate per call. */
const WORD_BOUNDARY_RE = /[/\\._\-\s]/;

function isSubsequence(needle: string, haystack: string): boolean {
  let n = 0;
  let h = 0;
  const nLen = needle.length;
  const hLen = haystack.length;
  while (n < nLen && h < hLen) {
    if (needle.charCodeAt(n) === haystack.charCodeAt(h)) {
      n++;
    }
    h++;
  }
  return n === nLen;
}

function fuzzyScorePreLowered(needle: string, haystack: string): number | undefined {
  if (!needle) return 0;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return 10_000 - exact * 10 - (haystack.length - needle.length);
  let score = 0;
  let cursor = 0;
  let last = -1;
  for (let i = 0; i < needle.length; i++) {
    const char = needle[i];
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return undefined;
    score += last < 0 ? 100 - found : Math.max(1, 40 - (found - last - 1) * 5);
    if (found === 0 || WORD_BOUNDARY_RE.test(haystack[found - 1])) score += 30;
    last = found;
    cursor = found + 1;
  }
  return score - haystack.length;
}

function compareScoredItems(
  a: { totalScore: number; label: string },
  b: { totalScore: number; label: string },
): number {
  const diff = b.totalScore - a.totalScore;
  if (diff !== 0) return diff;
  return a.label.localeCompare(b.label);
}

function compareCandidateWithWorst(
  candTotalScore: number,
  candLabel: string,
  worst: { totalScore: number; label: string },
): number {
  const diff = worst.totalScore - candTotalScore;
  if (diff !== 0) return diff;
  return candLabel.localeCompare(worst.label);
}

function bubbleUp(arr: (FindFileItem & { score: number; totalScore: number })[], idx: number): void {
  let curr = idx;
  while (curr > 0) {
    const prev = curr - 1;
    if (compareScoredItems(arr[prev], arr[curr]) > 0) {
      const tmp = arr[prev];
      arr[prev] = arr[curr];
      arr[curr] = tmp;
      curr = prev;
    } else {
      break;
    }
  }
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

      const needle = trimmed.toLowerCase();
      // Bounded top-K candidates to avoid sorting thousands of items on 10k-50k workspaces
      const scored: (FindFileItem & { score: number; totalScore: number })[] = [];

      for (let i = 0; i < allFiles.length; i++) {
        if (controller.signal.aborted || generation !== this.generation) return this.state;
        const item = allFiles[i];
        const lowerLabel = item.lowerLabel ?? item.label.toLowerCase();
        const lowerDetail = item.lowerDetail ?? item.detail.toLowerCase();

        // Fast subsequence pre-check: skips 95%+ non-matching items with 0 allocations
        const labelMatches = isSubsequence(needle, lowerLabel);
        const detailMatches = !labelMatches && isSubsequence(needle, lowerDetail);
        if (!labelMatches && !detailMatches) {
          continue;
        }

        const nameScore = labelMatches ? fuzzyScorePreLowered(needle, lowerLabel) : undefined;
        const pathScore = (detailMatches || labelMatches) ? fuzzyScorePreLowered(needle, lowerDetail) : undefined;
        const baseScore = Math.max(nameScore ?? -Infinity, pathScore !== undefined ? pathScore - 500 : -Infinity);
        if (!Number.isFinite(baseScore)) {
          continue;
        }

        const weight = item.weight ?? 0;
        const totalScore = baseScore + weight * 100;

        if (scored.length < limit) {
          scored.push({ ...item, score: baseScore, totalScore });
          if (scored.length === limit) {
            scored.sort(compareScoredItems);
          }
        } else if (compareCandidateWithWorst(totalScore, item.label, scored[limit - 1]) < 0) {
          scored[limit - 1] = { ...item, score: baseScore, totalScore };
          bubbleUp(scored, limit - 1);
        }
      }

      if (scored.length < limit) {
        scored.sort(compareScoredItems);
      }

      const finalItems = scored.map(({ totalScore, ...rest }) => rest);
      this.publish({ status: finalItems.length ? 'results' : 'empty', query: trimmed, items: finalItems, selectedIndex: 0 });
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
          weight: pathWeight(entry.path),
          lowerLabel: entry.name.toLowerCase(),
          lowerDetail: entry.path.toLowerCase(),
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
            weight: pathWeight(relative),
            lowerLabel: child.resource.path.base.toLowerCase(),
            lowerDetail: relative.toLowerCase(),
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
