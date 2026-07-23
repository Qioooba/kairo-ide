/**
 * 搜索计时器 — P3-OBS-05
 *
 * KairoSearchTimer: 包装 SearchInWorkspaceService 测量搜索性能。
 * 记录搜索耗时、文件数和结果数，跟踪最近 10 次搜索的平均时间。
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { SearchInWorkspaceService, SearchInWorkspaceCallbacks } from '@theia/search-in-workspace/lib/browser/search-in-workspace-service';
import type {
  SearchInWorkspaceResult,
  SearchInWorkspaceOptions,
} from '@theia/search-in-workspace/lib/common/search-in-workspace-interface';

const MAX_SEARCH_HISTORY = 10;

@injectable()
export class KairoSearchTimer {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(SearchInWorkspaceService) protected readonly searchService!: SearchInWorkspaceService;

  protected searchTimes: number[] = [];
  protected totalSearches = 0;

  /** 获取最近搜索的平均时间（ms） */
  getAverageSearchTime(): number {
    if (this.searchTimes.length === 0) return 0;
    const sum = this.searchTimes.reduce((a, b) => a + b, 0);
    return sum / this.searchTimes.length;
  }

  /** 获取最近搜索时间记录 */
  getSearchHistory(): number[] {
    return [...this.searchTimes];
  }

  /** 获取总搜索次数 */
  getTotalSearches(): number {
    return this.totalSearches;
  }

  /**
   * 包装的搜索方法 — 测量搜索耗时并记录指标。
   * 包装回调以在搜索完成时统计耗时和结果数。
   */
  search(
    what: string,
    callbacks: SearchInWorkspaceCallbacks,
    opts?: SearchInWorkspaceOptions,
  ): Promise<number> {
    const startTime = performance.now();
    const originalOnResult = callbacks.onResult;
    const originalOnDone = callbacks.onDone;

    let fileCount = 0;
    let resultCount = 0;

    const wrappedCallbacks: SearchInWorkspaceCallbacks = {
      onResult: (searchId: number, result: SearchInWorkspaceResult) => {
        fileCount++;
        resultCount += result.matches?.length ?? 0;
        if (originalOnResult) {
          originalOnResult(searchId, result);
        }
      },
      onDone: (searchId: number, error?: string) => {
        const elapsed = performance.now() - startTime;
        console.log(
          `[Perf] 搜索完成: ${elapsed.toFixed(1)}ms (${fileCount} 文件, ${resultCount} 结果)`,
        );
        this.logger.info(
          `[Perf] 搜索完成: ${elapsed.toFixed(1)}ms (${fileCount} 文件, ${resultCount} 结果)`,
        );
        this.searchTimes.push(elapsed);
        if (this.searchTimes.length > MAX_SEARCH_HISTORY) {
          this.searchTimes.shift();
        }
        this.totalSearches++;
        if (originalOnDone) {
          originalOnDone(searchId, error);
        }
      },
    };

    return this.searchService.search(what, wrappedCallbacks, opts);
  }
}