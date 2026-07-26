/**
 * 冷启动计时器 + Java 代码补全计时器 — P3-OBS-04
 *
 * KairoColdStartTimer: 记录 IDE 冷启动各阶段耗时。
 * KairoCompletionTimer: 测量首次 Java 代码补全延迟。
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ILogger } from '@theia/core/lib/common/logger';
import { JavaCompletionProvider } from '@kairo/java-extension';

/** 冷启动指标 */
export interface ColdStartMetrics {
  /** 应用启动时间（ms） */
  appStartTime: number;
  /** 布局就绪时间（ms） */
  layoutReadyTime: number;
  /** 完全可见时间（ms） */
  fullyVisibleTime: number;
  /** 首次 Java 补全时间（ms，可选） */
  firstJavaCompletionTime?: number;
  /** 冷启动总耗时（ms） */
  totalColdStartMs: number;
}

const STORAGE_KEY = 'kairo:perf:coldstart';
const MAX_HISTORY = 20;

@injectable()
export class KairoColdStartTimer implements FrontendApplicationContribution {
  @inject(ILogger) protected readonly logger!: ILogger;

  protected appStartTime = 0;
  protected layoutReadyTime = 0;
  protected fullyVisibleTime = 0;
  protected firstJavaCompletionTime?: number;
  protected origin = 0;

  /** 冷启动入口时间（performance.timeOrigin 的近似值） */
  getOrigin(): number {
    return this.origin;
  }

  onStart(): void {
    this.origin = performance.timeOrigin;
    this.appStartTime = performance.now();
    this.logger.info('[Perf] 冷启动计时开始');
  }

  onDidInitializeLayout(): void {
    this.layoutReadyTime = performance.now();
    const elapsed = this.layoutReadyTime - this.appStartTime;
    console.log(`[Perf] 布局就绪: ${elapsed.toFixed(1)}ms`);
    this.logger.info(`[Perf] 布局就绪: ${elapsed.toFixed(1)}ms`);
  }

  onDidBecomeVisible(): void {
    this.fullyVisibleTime = performance.now();
    const elapsed = this.fullyVisibleTime - this.appStartTime;
    console.log(`[Perf] 完全可见: ${elapsed.toFixed(1)}ms`);
    this.logger.info(`[Perf] 完全可见: ${elapsed.toFixed(1)}ms`);

    const metrics = this.getMetrics();
    console.log(`[Perf] 冷启动完成: ${metrics.totalColdStartMs.toFixed(1)}ms`);
    this.persistMetrics(metrics);
  }

  registerFirstCompletion(time: number): void {
    if (this.firstJavaCompletionTime !== undefined) return;
    this.firstJavaCompletionTime = time;
    console.log(`[Perf] 首次 Java 补全: ${time.toFixed(1)}ms`);
    this.logger.info(`[Perf] 首次 Java 补全: ${time.toFixed(1)}ms`);
  }

  getMetrics(): ColdStartMetrics {
    const totalColdStartMs = this.fullyVisibleTime > 0
      ? this.fullyVisibleTime - this.appStartTime
      : performance.now() - this.appStartTime;

    return {
      appStartTime: this.appStartTime,
      layoutReadyTime: this.layoutReadyTime,
      fullyVisibleTime: this.fullyVisibleTime,
      firstJavaCompletionTime: this.firstJavaCompletionTime,
      totalColdStartMs,
    };
  }

  /** 获取历史冷启动记录 */
  getHistory(): ColdStartMetrics[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as ColdStartMetrics[];
    } catch {
      return [];
    }
  }

  /** 清除所有冷启动历史记录 */
  clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.logger.info('[Perf] Cold start history cleared');
    } catch (err) {
      this.logger.warn(`[Perf] Failed to clear cold start history: ${String(err)}`);
    }
  }

  protected persistMetrics(metrics: ColdStartMetrics): void {
    try {
      const history = this.getHistory();
      history.push(metrics);
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (err) {
      this.logger.warn(`[Perf] 无法保存冷启动指标: ${String(err)}`);
    }
  }
}

/**
 * Java 代码补全计时器 — 包装 JavaCompletionProvider 以测量首次补全延迟。
 */
@injectable()
export class KairoCompletionTimer {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(JavaCompletionProvider) protected readonly provider!: JavaCompletionProvider;
  @inject(KairoColdStartTimer) protected readonly coldStartTimer!: KairoColdStartTimer;

  protected firstCompletionTime?: number;
  protected measured = false;

  getFirstCompletionTime(): number | undefined {
    return this.firstCompletionTime;
  }

  /** 包装原始的 provideCompletions，测量首次补全耗时 */
  async provideCompletions(req: {
    uri: string;
    line: number;
    character: number;
    triggerKind?: 1 | 2 | 3;
    triggerCharacter?: string;
  }): Promise<{
    isIncomplete: boolean;
    items: { label: string; kind: number | undefined; detail: string | undefined; documentation: string | undefined; sortText: string | undefined; filterText: string | undefined; insertText: string | undefined; isDeprecated?: boolean; score?: number }[];
  }> {
    const startTime = performance.now();
    const result = await this.provider.provideCompletions(req);
    const elapsed = performance.now() - startTime;

    if (!this.measured && result.items.length > 0) {
      this.measured = true;
      this.firstCompletionTime = elapsed;
      this.coldStartTimer.registerFirstCompletion(elapsed);
    }

    return result;
  }
}