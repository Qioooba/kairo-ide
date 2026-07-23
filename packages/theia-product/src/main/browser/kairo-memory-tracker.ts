/**
 * 内存追踪器 — P3-OBS-06
 *
 * KairoMemoryTracker: 使用 performance.memory (Chrome) 跟踪 JS 堆内存。
 * 每 30 秒记录一次，在文件打开/关闭时记录内存变化，堆超过 500MB 时告警。
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ILogger } from '@theia/core/lib/common/logger';

const MEMORY_TRACK_INTERVAL_MS = 30_000;
const HEAP_WARNING_THRESHOLD_MB = 500;

@injectable()
export class KairoMemoryTracker implements FrontendApplicationContribution {
  @inject(ILogger) protected readonly logger!: ILogger;

  protected timer: ReturnType<typeof setInterval> | undefined;
  protected lastHeapMB = 0;
  protected peakHeapMB = 0;
  protected running = false;

  @postConstruct()
  protected init(): void {
    this.logger.info('[Perf] 内存追踪器已初始化');
  }

  onStart(): void {
    this.running = true;
    this.logger.info('[Perf] 内存追踪器已启动');
    this.timer = setInterval(() => {
      this.logMemory();
    }, MEMORY_TRACK_INTERVAL_MS);
  }

  getCurrentHeapMB(): number {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      return mem.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  getCurrentTotalMB(): number {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      return mem.totalJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  getPeakHeapMB(): number {
    return this.peakHeapMB;
  }

  /** 文件打开时记录内存变化 */
  recordFileOpen(): void {
    this.recordMemoryDelta('文件打开');
  }

  /** 文件关闭时记录内存变化 */
  recordFileClose(): void {
    this.recordMemoryDelta('文件关闭');
  }

  protected logMemory(): void {
    const heapMB = this.getCurrentHeapMB();
    const totalMB = this.getCurrentTotalMB();

    if (heapMB > this.peakHeapMB) {
      this.peakHeapMB = heapMB;
    }

    console.log(`[Perf] 内存: JS 堆 ${heapMB.toFixed(1)}MB, 总计 ${totalMB.toFixed(1)}MB`);
    this.logger.info(`[Perf] 内存: JS 堆 ${heapMB.toFixed(1)}MB, 总计 ${totalMB.toFixed(1)}MB`);

    if (heapMB > HEAP_WARNING_THRESHOLD_MB) {
      console.warn(`[Perf] ⚠ 内存告警: JS 堆 ${heapMB.toFixed(1)}MB 超过 ${HEAP_WARNING_THRESHOLD_MB}MB 阈值`);
      this.logger.warn(`[Perf] ⚠ 内存告警: JS 堆 ${heapMB.toFixed(1)}MB 超过 ${HEAP_WARNING_THRESHOLD_MB}MB 阈值`);
    }
  }

  protected recordMemoryDelta(event: string): void {
    const heapMB = this.getCurrentHeapMB();
    const delta = heapMB - this.lastHeapMB;
    this.lastHeapMB = heapMB;

    if (Math.abs(delta) > 0.5) {
      const sign = delta > 0 ? '+' : '';
      console.log(`[Perf] ${event}: 内存变化 ${sign}${delta.toFixed(1)}MB (当前: ${heapMB.toFixed(1)}MB)`);
      this.logger.info(`[Perf] ${event}: 内存变化 ${sign}${delta.toFixed(1)}MB (当前: ${heapMB.toFixed(1)}MB)`);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.running = false;
  }
}