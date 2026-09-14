/**
 * Startup Phased Readiness, File Manifest Caching, and Resource Observability (PR15).
 *
 * Implements:
 * - StartupStageTracker: P0~P4 phased lifecycle, non-blocking editing on semantic delay.
 * - WorkspaceFileManifestCache: Lightweight workspace file inventory, ignore rules, LRU eviction.
 * - ResourceBudgetManager: 4GB virtual desktop environment budgeting, heavy task slot throttling.
 */

import type {
  StartupStage,
  StartupMilestone,
  StartupReport,
  ResourceBudgetConfig,
  FileManifestEntry,
} from '@kairo/protocol';

/* ========================================================================== */
/*  1. Startup Stage Tracker (P0 ~ P4 Phased Readiness)                       */
/* ========================================================================== */

export type StartupStageListener = (milestone: StartupMilestone) => void;

export class StartupStageTracker {
  protected milestones: Map<StartupStage, StartupMilestone> = new Map();
  protected failedStages: Map<StartupStage, string> = new Map();
  protected listeners: Set<StartupStageListener> = new Set();
  protected startTime: number;

  constructor(processStartTime: number = Date.now()) {
    this.startTime = processStartTime;
    this.milestones.set('processStart', {
      stage: 'processStart',
      timestamp: processStartTime,
      durationMs: 0,
    });
  }

  /**
   * Subscribe to stage transition events.
   */
  onDidReachStage(listener: StartupStageListener): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  /**
   * Mark a startup milestone as reached.
   */
  markStage(stage: StartupStage, metadata?: Record<string, unknown>): StartupMilestone {
    const now = Date.now();
    const durationMs = now - this.startTime;

    const milestone: StartupMilestone = {
      stage,
      timestamp: now,
      durationMs,
      metadata,
    };

    this.milestones.set(stage, milestone);
    this.failedStages.delete(stage);

    for (const listener of this.listeners) {
      try {
        listener(milestone);
      } catch {
        // Safe dispatch: listeners do not crash tracker
      }
    }

    return milestone;
  }

  /**
   * Mark a stage as failed (e.g. JDT LS failed to initialize).
   * Note: A failure in P3 (javaReady) must NOT block P1 (editorReady) or P2 (projectModelReady).
   */
  failStage(stage: StartupStage, reason: string): void {
    this.failedStages.set(stage, reason);
  }

  /**
   * Check if a stage has been reached.
   */
  isStageReached(stage: StartupStage): boolean {
    return this.milestones.has(stage);
  }

  /**
   * Check if a stage failed.
   */
  getStageFailure(stage: StartupStage): string | undefined {
    return this.failedStages.get(stage);
  }

  /**
   * Get milestone for a specific stage.
   */
  getMilestone(stage: StartupStage): StartupMilestone | undefined {
    return this.milestones.get(stage);
  }

  /**
   * Get duration in milliseconds from processStart to a specific milestone.
   */
  getStageDuration(stage: StartupStage): number | undefined {
    return this.milestones.get(stage)?.durationMs;
  }

  /**
   * Generate complete startup performance snapshot.
   */
  generateReport(): StartupReport {
    const list = Array.from(this.milestones.values());
    list.sort((a, b) => a.timestamp - b.timestamp);

    const maxTimestamp = list.reduce((max, m) => Math.max(max, m.timestamp), this.startTime);
    const totalDurationMs = maxTimestamp - this.startTime;

    const failedObj: Partial<Record<StartupStage, string>> = {};
    for (const [s, r] of this.failedStages.entries()) {
      failedObj[s] = r;
    }

    return {
      milestones: list,
      totalDurationMs,
      failedStages: Object.keys(failedObj).length > 0 ? failedObj : undefined,
    };
  }

  /**
   * Reset tracker state.
   */
  reset(processStartTime: number = Date.now()): void {
    this.startTime = processStartTime;
    this.milestones.clear();
    this.failedStages.clear();
    this.milestones.set('processStart', {
      stage: 'processStart',
      timestamp: processStartTime,
      durationMs: 0,
    });
  }
}

/* ========================================================================== */
/*  2. Workspace File Manifest Cache                                          */
/* ========================================================================== */

export const DEFAULT_WORKSPACE_EXCLUDES = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.pnpm-store',
  'target',
  'build',
  'dist',
  'out',
  'logs',
  'work',
  'temp',
  '.legacyflow',
  '.kairo',
];

export class WorkspaceFileManifestCache {
  protected entries: Map<string, FileManifestEntry> = new Map();
  protected maxEntries: number;
  protected ignores: Set<string>;
  protected hits = 0;
  protected misses = 0;
  protected evictions = 0;

  constructor(maxEntries = 50_000, customIgnores?: string[]) {
    this.maxEntries = Math.max(1, maxEntries);
    this.ignores = new Set([...DEFAULT_WORKSPACE_EXCLUDES, ...(customIgnores ?? [])]);
  }

  /**
   * Check if a relative path should be excluded according to ignore policy.
   */
  shouldIgnore(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/');
    for (const segment of segments) {
      if (this.ignores.has(segment)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Add or update an entry in the manifest cache.
   * Returns false if path is ignored.
   */
  addOrUpdateFile(entry: FileManifestEntry): boolean {
    const normalizedPath = entry.relativePath.replace(/\\/g, '/');
    if (this.shouldIgnore(normalizedPath)) {
      return false;
    }

    // Check capacity before insertion
    if (!this.entries.has(normalizedPath) && this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(normalizedPath, {
      ...entry,
      relativePath: normalizedPath,
    });
    return true;
  }

  /**
   * Bulk populate the manifest cache.
   * Returns count of accepted files.
   */
  batchPopulate(entries: FileManifestEntry[]): number {
    let accepted = 0;
    for (const entry of entries) {
      if (this.addOrUpdateFile(entry)) {
        accepted++;
      }
    }
    return accepted;
  }

  /**
   * Remove a file from the cache.
   */
  removeFile(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return this.entries.delete(normalized);
  }

  /**
   * Handle file rename.
   */
  renameFile(oldPath: string, newPath: string): boolean {
    const oldNorm = oldPath.replace(/\\/g, '/');
    const newNorm = newPath.replace(/\\/g, '/');

    const existing = this.entries.get(oldNorm);
    if (!existing) {
      return false;
    }

    this.entries.delete(oldNorm);
    if (!this.shouldIgnore(newNorm)) {
      this.entries.set(newNorm, {
        ...existing,
        relativePath: newNorm,
      });
      return true;
    }
    return false;
  }

  /**
   * Retrieve a file entry.
   */
  getFile(relativePath: string): FileManifestEntry | undefined {
    const normalized = relativePath.replace(/\\/g, '/');
    const found = this.entries.get(normalized);
    if (found) {
      this.hits++;
      return { ...found };
    }
    this.misses++;
    return undefined;
  }

  /**
   * Query files matching a pattern (string prefix or RegExp).
   */
  queryFiles(pattern?: string | RegExp, limit = 100): FileManifestEntry[] {
    const results: FileManifestEntry[] = [];

    if (!pattern) {
      for (const entry of this.entries.values()) {
        results.push({ ...entry });
        if (results.length >= limit) break;
      }
      return results;
    }

    if (typeof pattern === 'string') {
      const lower = pattern.toLowerCase();
      for (const entry of this.entries.values()) {
        if (entry.relativePath.toLowerCase().includes(lower)) {
          results.push({ ...entry });
          if (results.length >= limit) break;
        }
      }
    } else {
      for (const entry of this.entries.values()) {
        if (pattern.test(entry.relativePath)) {
          results.push({ ...entry });
          if (results.length >= limit) break;
        }
      }
    }

    return results;
  }

  /**
   * Get cache metrics and health indicators.
   */
  getStats(): {
    totalFiles: number;
    maxEntries: number;
    hitCount: number;
    missCount: number;
    evictionCount: number;
    hitRate: number;
  } {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 1.0;
    return {
      totalFiles: this.entries.size,
      maxEntries: this.maxEntries,
      hitCount: this.hits,
      missCount: this.misses,
      evictionCount: this.evictions,
      hitRate: Math.round(hitRate * 1000) / 1000,
    };
  }

  /**
   * Clear all cached files and reset stats.
   */
  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  protected evictOldest(): void {
    const firstKey = this.entries.keys().next().value;
    if (firstKey !== undefined) {
      this.entries.delete(firstKey);
      this.evictions++;
    }
  }
}

/* ========================================================================== */
/*  3. Resource Budget Manager (4GB Environment Strategy)                     */
/* ========================================================================== */

export const DEFAULT_4GB_BUDGET: ResourceBudgetConfig = {
  maxMemoryMb: 3072, // Warn if IDE process group exceeds 3GB on a 4GB machine
  maxFileCacheEntries: 50_000,
  maxConcurrentHeavyTasks: 2, // Limit concurrent compilations & heavy searches
  maxLogRingLines: 1_000,
};

export class ResourceBudgetManager {
  protected config: ResourceBudgetConfig;
  protected activeHeavyTasks = 0;
  protected taskQueue: Array<() => void> = [];

  constructor(config: Partial<ResourceBudgetConfig> = {}) {
    this.config = { ...DEFAULT_4GB_BUDGET, ...config };
  }

  get budgetConfig(): Readonly<ResourceBudgetConfig> {
    return this.config;
  }

  get runningHeavyTasks(): number {
    return this.activeHeavyTasks;
  }

  get queuedHeavyTasks(): number {
    return this.taskQueue.length;
  }

  /**
   * Acquire an execution slot for a heavy operation (compilation, full search).
   * If running tasks reach maxConcurrentHeavyTasks, the caller awaits until
   * a prior task releases its slot.
   */
  async acquireHeavyTaskSlot(_taskName?: string): Promise<{ release(): void }> {
    if (this.activeHeavyTasks < this.config.maxConcurrentHeavyTasks) {
      this.activeHeavyTasks++;
      let released = false;
      return {
        release: () => {
          if (!released) {
            released = true;
            this.releaseSlot();
          }
        },
      };
    }

    // Wait in queue
    return new Promise(resolve => {
      this.taskQueue.push(() => {
        this.activeHeavyTasks++;
        let released = false;
        resolve({
          release: () => {
            if (!released) {
              released = true;
              this.releaseSlot();
            }
          },
        });
      });
    });
  }

  protected releaseSlot(): void {
    this.activeHeavyTasks--;
    if (this.taskQueue.length > 0) {
      const next = this.taskQueue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Check if current memory consumption is within budget.
   */
  checkMemoryBudget(usedBytes: number): {
    withinBudget: boolean;
    usageMb: number;
    thresholdMb: number;
    warning?: string;
  } {
    const usageMb = Math.round(usedBytes / (1024 * 1024));
    const thresholdMb = this.config.maxMemoryMb;

    if (usageMb > thresholdMb) {
      return {
        withinBudget: false,
        usageMb,
        thresholdMb,
        warning: `Memory usage (${usageMb}MB) exceeds 4GB environment threshold (${thresholdMb}MB). Consider closing idle projects or triggering garbage collection.`,
      };
    }

    return {
      withinBudget: true,
      usageMb,
      thresholdMb,
    };
  }

  /**
   * Append a log line to a bounded ring buffer.
   */
  appendBoundedLog(ring: string[], line: string, maxLines?: number): void {
    const limit = maxLines ?? this.config.maxLogRingLines;
    ring.push(line);
    while (ring.length > limit) {
      ring.shift();
    }
  }
}
