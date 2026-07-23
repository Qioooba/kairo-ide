/**
 * 性能采样器 — P3-OBS-03
 *
 * KairoPerfSampler service for performance profiling.
 * Collect: memory usage (heap, RSS), CPU %, GC pauses, event loop lag.
 * Sample every 5 seconds, keep last 30 minutes.
 * Show in a small graph widget (optional, user can hide).
 * Alert when memory exceeds 1.2GB or CPU sustained > 80%.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';

/** A single performance sample. */
export interface PerfSample {
  timestamp: number;
  /** Heap memory in MB. */
  heapMB: number;
  /** RSS memory in MB. */
  rssMB: number;
  /** CPU usage percentage (0-100). */
  cpuPercent: number;
  /** Event loop lag in ms. */
  eventLoopLagMs: number;
  /** GC pause estimate in ms. */
  gcPauseMs: number;
}

/** Performance alert type. */
export type PerfAlertType = 'memory-high' | 'cpu-sustained' | 'event-loop-lag';

/** Performance alert. */
export interface PerfAlert {
  type: PerfAlertType;
  message: string;
  timestamp: number;
  value: number;
  threshold: number;
}

/** Sampler configuration. */
export interface PerfSamplerConfig {
  /** Sampling interval in ms. */
  intervalMs: number;
  /** How long to keep samples in ms. */
  retentionMs: number;
  /** Memory alert threshold in MB. */
  memoryAlertThresholdMB: number;
  /** CPU alert threshold percentage. */
  cpuAlertThresholdPercent: number;
  /** Event loop lag alert threshold in ms. */
  eventLoopLagThresholdMs: number;
  /** Whether the graph widget is visible. */
  showGraph: boolean;
}

const DEFAULT_CONFIG: PerfSamplerConfig = {
  intervalMs: 5_000,
  retentionMs: 30 * 60 * 1_000, // 30 minutes
  memoryAlertThresholdMB: 1_200,
  cpuAlertThresholdPercent: 80,
  eventLoopLagThresholdMs: 100,
  showGraph: false,
};

const MAX_SAMPLES = (30 * 60 * 1000) / 5000; // 360 samples for 30 min at 5s interval

@injectable()
export class KairoPerfSampler {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(StatusBar) protected readonly statusBar!: StatusBar;

  protected readonly onDidSampleEmitter = new Emitter<PerfSample>();
  readonly onDidSample: Event<PerfSample> = this.onDidSampleEmitter.event;

  protected readonly onDidAlertEmitter = new Emitter<PerfAlert>();
  readonly onDidAlert: Event<PerfAlert> = this.onDidAlertEmitter.event;

  protected config: PerfSamplerConfig = { ...DEFAULT_CONFIG };
  protected samples: PerfSample[] = [];
  protected timer: ReturnType<typeof setInterval> | undefined;
  protected running = false;
  protected cpuSustainedCounter = 0;
  protected lastGCTimestamp = 0;

  get isRunning(): boolean {
    return this.running;
  }

  get sampleHistory(): readonly PerfSample[] {
    return this.samples;
  }

  get currentConfig(): Readonly<PerfSamplerConfig> {
    return this.config;
  }

  @postConstruct()
  protected init(): void {
    this.logger.info('Kairo 性能采样器已初始化');
    this.statusBar.setElement('kairo.perf', {
      text: '$(dashboard) 性能: 空闲',
      tooltip: '性能监控已就绪。点击切换图表。',
      alignment: StatusBarAlignment.RIGHT,
      priority: 0,
      command: 'kairo.perf.toggleGraph',
    });
  }

  /**
   * Start the performance sampler.
   */
  start(config?: Partial<PerfSamplerConfig>): void {
    if (this.running) {
      return;
    }

    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }

    this.running = true;
    this.logger.info('性能采样器已启动');

    // Take an immediate sample
    this.takeSample();

    // Start periodic sampling
    this.timer = setInterval(() => {
      this.takeSample();
    }, this.config.intervalMs);
  }

  /**
   * Stop the performance sampler.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info('性能采样器已停止');
    this.statusBar.setElement('kairo.perf', {
      text: '$(dashboard) 性能: 已停止',
      tooltip: '性能监控已停止。',
      alignment: StatusBarAlignment.RIGHT,
      priority: 0,
    });
  }

  /**
   * Toggle the graph widget visibility.
   */
  toggleGraph(): void {
    this.config.showGraph = !this.config.showGraph;
    this.logger.info(`性能图表: ${this.config.showGraph ? '显示' : '隐藏'}`);
  }

  /**
   * Get the latest sample.
   */
  getLatestSample(): PerfSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /**
   * Get the average CPU over the last N seconds.
   */
  getAverageCPU(seconds: number): number {
    const cutoff = Date.now() - seconds * 1000;
    const recent = this.samples.filter(s => s.timestamp >= cutoff);
    if (recent.length === 0) return 0;
    const sum = recent.reduce((acc, s) => acc + s.cpuPercent, 0);
    return sum / recent.length;
  }

  /**
   * Get the current memory usage (latest sample).
   */
  getMemoryUsage(): { heapMB: number; rssMB: number } | undefined {
    const latest = this.getLatestSample();
    if (!latest) return undefined;
    return { heapMB: latest.heapMB, rssMB: latest.rssMB };
  }

  // ── Internal ──────────────────────────────────────────────────

  protected takeSample(): void {
    const sample: PerfSample = {
      timestamp: Date.now(),
      heapMB: this.measureHeapMemory(),
      rssMB: this.measureRSSMemory(),
      cpuPercent: this.measureCPU(),
      eventLoopLagMs: this.measureEventLoopLag(),
      gcPauseMs: this.estimateGCPause(),
    };

    this.samples.push(sample);

    // Trim to retention window
    const cutoff = Date.now() - this.config.retentionMs;
    this.samples = this.samples.filter(s => s.timestamp >= cutoff);

    // Trim to max samples
    if (this.samples.length > MAX_SAMPLES) {
      this.samples = this.samples.slice(this.samples.length - MAX_SAMPLES);
    }

    this.onDidSampleEmitter.fire(sample);
    this.checkAlerts(sample);
    this.updateStatusBar(sample);
  }

  protected measureHeapMemory(): number {
    // Use performance.memory if available (Chrome only)
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      return mem.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  protected measureRSSMemory(): number {
    // Estimate RSS from performance.memory.totalJSHeapSize
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      const mem = (performance as any).memory;
      return mem.totalJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  protected measureCPU(): number {
    // Estimate CPU usage from recent event loop lag
    // This is a rough approximation
    const recent = this.samples.slice(-6); // Last 30 seconds
    if (recent.length < 2) return 0;

    const avgLag = recent.reduce((sum, s) => sum + s.eventLoopLagMs, 0) / recent.length;
    // Normalize: 0ms lag = 0% CPU, 100ms lag = 100% CPU (rough)
    return Math.min(100, Math.max(0, avgLag));
  }

  protected measureEventLoopLag(): number {
    // Measure event loop lag by checking how long setTimeout takes
    const _start = Date.now();
    let lag = 0;
    // We can't truly measure this synchronously, but we can estimate
    // based on the time between scheduled samples
    if (this.samples.length > 0) {
      const lastSample = this.samples[this.samples.length - 1];
      const expectedInterval = this.config.intervalMs;
      const actualInterval = Date.now() - lastSample.timestamp;
      lag = Math.max(0, actualInterval - expectedInterval);
    }
    return lag;
  }

  protected estimateGCPause(): number {
    // Estimate GC pause from memory drops
    if (this.samples.length < 2) return 0;

    const current = this.samples[this.samples.length - 1];
    const previous = this.samples[this.samples.length - 2];

    // If heap dropped significantly, it might be GC
    const drop = previous.heapMB - current.heapMB;
    if (drop > 5 && current.heapMB > 0) {
      this.lastGCTimestamp = current.timestamp;
      return Math.min(drop * 0.5, 50); // Rough estimate, max 50ms
    }

    return 0;
  }

  protected checkAlerts(sample: PerfSample): void {
    // Memory alert
    if (sample.heapMB > this.config.memoryAlertThresholdMB) {
      const alert: PerfAlert = {
        type: 'memory-high',
        message: `内存使用过高: ${sample.heapMB.toFixed(0)} MB (阈值: ${this.config.memoryAlertThresholdMB} MB)`,
        timestamp: sample.timestamp,
        value: sample.heapMB,
        threshold: this.config.memoryAlertThresholdMB,
      };
      this.messages.warn(alert.message);
      this.onDidAlertEmitter.fire(alert);
    }

    // CPU sustained alert
    if (sample.cpuPercent > this.config.cpuAlertThresholdPercent) {
      this.cpuSustainedCounter++;
      if (this.cpuSustainedCounter >= 6) {
        // Sustained for 30 seconds
        const alert: PerfAlert = {
          type: 'cpu-sustained',
          message: `CPU 持续高负载: ${sample.cpuPercent.toFixed(0)}% (阈值: ${this.config.cpuAlertThresholdPercent}%)`,
          timestamp: sample.timestamp,
          value: sample.cpuPercent,
          threshold: this.config.cpuAlertThresholdPercent,
        };
        this.messages.warn(alert.message);
        this.onDidAlertEmitter.fire(alert);
        this.cpuSustainedCounter = 0;
      }
    } else {
      this.cpuSustainedCounter = 0;
    }

    // Event loop lag alert
    if (sample.eventLoopLagMs > this.config.eventLoopLagThresholdMs) {
      const alert: PerfAlert = {
        type: 'event-loop-lag',
        message: `事件循环延迟过高: ${sample.eventLoopLagMs.toFixed(0)} ms (阈值: ${this.config.eventLoopLagThresholdMs} ms)`,
        timestamp: sample.timestamp,
        value: sample.eventLoopLagMs,
        threshold: this.config.eventLoopLagThresholdMs,
      };
      this.messages.warn(alert.message);
      this.onDidAlertEmitter.fire(alert);
    }
  }

  protected updateStatusBar(sample: PerfSample): void {
    const memText = sample.heapMB > 0
      ? `${sample.heapMB.toFixed(0)} MB`
      : 'N/A';

    let icon = '$(dashboard)';
    if (sample.heapMB > this.config.memoryAlertThresholdMB * 0.8) {
      icon = '$(warning)';
    }
    if (sample.heapMB > this.config.memoryAlertThresholdMB) {
      icon = '$(error)';
    }

    this.statusBar.setElement('kairo.perf', {
      text: `${icon} 性能: ${memText}`,
      tooltip: [
        `堆内存: ${sample.heapMB > 0 ? sample.heapMB.toFixed(0) + ' MB' : 'N/A'}`,
        `RSS: ${sample.rssMB > 0 ? sample.rssMB.toFixed(0) + ' MB' : 'N/A'}`,
        `CPU: ${sample.cpuPercent.toFixed(0)}%`,
        `事件循环延迟: ${sample.eventLoopLagMs.toFixed(0)} ms`,
        `GC 暂停: ${sample.gcPauseMs.toFixed(0)} ms`,
        '点击切换性能图表。',
      ].join('\n'),
      alignment: StatusBarAlignment.RIGHT,
      priority: 0,
      command: 'kairo.perf.toggleGraph',
    });
  }
}