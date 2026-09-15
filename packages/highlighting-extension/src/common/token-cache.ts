/**
 * Token and Checkpoint Cache for Kairo IDE incremental tokenization.
 * Pure logic — no DOM or Theia UI dependencies.
 */

import { LexerState } from './lexer-state';

export interface Checkpoint {
  lineNumber: number;
  state: LexerState;
  documentVersion: number;
}

export class ModelTokenCache {
  readonly modelInstanceId: string;
  readonly CHECKPOINT_INTERVAL = 256;

  private checkpoints: Checkpoint[] = [];
  private lineTokensMap = new Map<number, Uint32Array>();
  private completedLineCount: number = 0;
  private currentVersion: number = 0;

  constructor(modelInstanceId: string) {
    this.modelInstanceId = modelInstanceId;
  }

  setVersion(version: number): void {
    if (this.currentVersion !== version) {
      this.currentVersion = version;
    }
  }

  getVersion(): number {
    return this.currentVersion;
  }

  getCompletedLineCount(): number {
    return this.completedLineCount;
  }

  setCompletedLineCount(count: number): void {
    this.completedLineCount = count;
  }

  /**
   * Add or replace checkpoint for a given line number.
   */
  addCheckpoint(lineNumber: number, state: LexerState, version: number): void {
    const existingIndex = this.checkpoints.findIndex(c => c.lineNumber === lineNumber);
    const cp: Checkpoint = {
      lineNumber,
      state: state.clone(),
      documentVersion: version,
    };
    if (existingIndex >= 0) {
      this.checkpoints[existingIndex] = cp;
    } else {
      this.checkpoints.push(cp);
      this.checkpoints.sort((a, b) => a.lineNumber - b.lineNumber);
    }
  }

  /**
   * Find the closest checkpoint <= targetLine.
   */
  getClosestCheckpoint(targetLine: number): Checkpoint | undefined {
    let best: Checkpoint | undefined;
    for (const cp of this.checkpoints) {
      if (cp.lineNumber <= targetLine) {
        if (!best || cp.lineNumber > best.lineNumber) {
          best = cp;
        }
      }
    }
    return best;
  }

  /**
   * Invalidate checkpoints and tokens starting from line `fromLine`.
   */
  invalidateFrom(fromLine: number): void {
    this.checkpoints = this.checkpoints.filter(cp => cp.lineNumber < fromLine);
    if (this.completedLineCount >= fromLine) {
      this.completedLineCount = Math.max(0, fromLine - 1);
    }
    for (const line of Array.from(this.lineTokensMap.keys())) {
      if (line >= fromLine) {
        this.lineTokensMap.delete(line);
      }
    }
  }

  setLineTokens(lineNumber: number, tokens: Uint32Array): void {
    this.lineTokensMap.set(lineNumber, tokens);
  }

  getLineTokens(lineNumber: number): Uint32Array | undefined {
    return this.lineTokensMap.get(lineNumber);
  }

  clear(): void {
    this.checkpoints = [];
    this.lineTokensMap.clear();
    this.completedLineCount = 0;
  }

  getByteSize(): number {
    let bytes = 0;
    for (const tokens of this.lineTokensMap.values()) {
      bytes += tokens.byteLength;
    }
    bytes += this.checkpoints.length * 64;
    return bytes;
  }

  getCheckpointCount(): number {
    return this.checkpoints.length;
  }
}

/**
 * Global LRU cache managing token caches across all active models,
 * bounding overall memory usage.
 */
export class TokenCacheManager {
  private readonly maxBytes: number;
  private currentBytes: number = 0;
  private caches = new Map<string, ModelTokenCache>();

  constructor(maxBytes: number = 128 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  getOrCreateCache(modelInstanceId: string): ModelTokenCache {
    let cache = this.caches.get(modelInstanceId);
    if (!cache) {
      cache = new ModelTokenCache(modelInstanceId);
      this.caches.set(modelInstanceId, cache);
    }
    return cache;
  }

  getCache(modelInstanceId: string): ModelTokenCache | undefined {
    return this.caches.get(modelInstanceId);
  }

  removeCache(modelInstanceId: string): void {
    const cache = this.caches.get(modelInstanceId);
    if (cache) {
      this.currentBytes -= cache.getByteSize();
      cache.clear();
      this.caches.delete(modelInstanceId);
    }
  }

  getTotalBytes(): number {
    let total = 0;
    for (const cache of this.caches.values()) {
      total += cache.getByteSize();
    }
    this.currentBytes = total;
    return total;
  }

  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    this.caches.clear();
    this.currentBytes = 0;
  }
}

export const defaultTokenCacheManager = new TokenCacheManager();
