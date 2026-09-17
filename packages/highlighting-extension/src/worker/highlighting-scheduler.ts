/**
 * Highlighting Scheduler for Worker.
 * Prioritizes active viewports with 300-line prefetch, background EOF completion,
 * and multi-document fairness.
 * Pure logic — runnable in Web Worker or Node thread.
 */

import { IncrementalTokenizer, TokenizeSliceResult } from './incremental-tokenizer';
import type { TokenBatchMessage } from '../common/highlight-protocol';

export interface Range {
  start: number;
  end: number;
}

export function addCoveredRange(ranges: Range[], start: number, end: number): void {
  if (start > end) return;
  ranges.push({ start, end });
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    if (merged.length === 0) {
      merged.push({ ...r });
    } else {
      const last = merged[merged.length - 1];
      if (r.start <= last.end + 1) {
        last.end = Math.max(last.end, r.end);
      } else {
        merged.push({ ...r });
      }
    }
  }
  ranges.length = 0;
  ranges.push(...merged);
}

export function findUncoveredRange(
  ranges: Range[],
  preferredStart: number,
  preferredEnd: number,
  totalLines: number,
  maxSliceLines: number = 500,
): { start: number; end: number } | undefined {
  if (totalLines <= 0) return undefined;

  // 1. Check inside preferred range [prefStart, prefEnd]
  const prefStart = Math.max(1, Math.min(preferredStart, totalLines));
  const prefEnd = Math.max(prefStart, Math.min(preferredEnd, totalLines));

  for (let l = prefStart; l <= prefEnd; ) {
    const covered = ranges.find(r => r.start <= l && l <= r.end);
    if (covered) {
      l = covered.end + 1;
    } else {
      const nextCovered = ranges.find(r => r.start > l);
      const limit = Math.min(prefEnd, nextCovered ? nextCovered.start - 1 : prefEnd, l + maxSliceLines - 1);
      return { start: l, end: limit };
    }
  }

  // 2. Check before preferred range [1, prefStart - 1] (backfill prefix holes!)
  for (let l = 1; l < prefStart; ) {
    const covered = ranges.find(r => r.start <= l && l <= r.end);
    if (covered) {
      l = covered.end + 1;
    } else {
      const nextCovered = ranges.find(r => r.start > l);
      const limit = Math.min(prefStart - 1, nextCovered ? nextCovered.start - 1 : prefStart - 1, l + maxSliceLines - 1);
      return { start: l, end: limit };
    }
  }

  // 3. Check after preferred range [prefEnd + 1, totalLines] (progressive sweep to EOF)
  for (let l = prefEnd + 1; l <= totalLines; ) {
    const covered = ranges.find(r => r.start <= l && l <= r.end);
    if (covered) {
      l = covered.end + 1;
    } else {
      const nextCovered = ranges.find(r => r.start > l);
      const limit = Math.min(totalLines, nextCovered ? nextCovered.start - 1 : totalLines, l + maxSliceLines - 1);
      return { start: l, end: limit };
    }
  }

  return undefined;
}

export interface ModelTaskState {
  modelInstanceId: string;
  tokenizer: IncrementalTokenizer;
  documentVersion: number;
  viewportStart: number;
  viewportEnd: number;
  coveredRanges: Range[];
  isCompleted: boolean;
}

export class HighlightingScheduler {
  private models = new Map<string, ModelTaskState>();
  private onBatchCallback: (batch: TokenBatchMessage) => void;
  private isProcessing: boolean = false;
  private activeModelId?: string;
  private status: 'idle' | 'busy' | 'stopped' = 'idle';

  constructor(onBatch: (batch: TokenBatchMessage) => void) {
    this.onBatchCallback = onBatch;
  }

  getStatus(): 'idle' | 'busy' | 'stopped' {
    return this.status;
  }

  registerModel(
    modelInstanceId: string,
    languageId: string,
    dialect: string = languageId,
    version: number,
    text: string,
    viewport?: { startLine: number; endLine: number },
  ): void {
    const tokenizer = new IncrementalTokenizer(modelInstanceId, languageId, dialect);
    tokenizer.setFullText(text, version);

    const vpStart = viewport?.startLine ?? 1;
    const vpEnd = viewport?.endLine ?? Math.min(100, tokenizer.getLineCount());

    this.models.set(modelInstanceId, {
      modelInstanceId,
      tokenizer,
      documentVersion: version,
      viewportStart: vpStart,
      viewportEnd: vpEnd,
      coveredRanges: [],
      isCompleted: false,
    });

    this.activeModelId = modelInstanceId;
    this.triggerSchedule();
  }

  updateViewport(modelInstanceId: string, startLine: number, endLine: number): void {
    const state = this.models.get(modelInstanceId);
    if (!state) return;
    state.viewportStart = startLine;
    state.viewportEnd = endLine;
    this.activeModelId = modelInstanceId;
    this.triggerSchedule();
  }

  updateContent(
    modelInstanceId: string,
    beforeVersion: number,
    afterVersion: number,
    changes: Array<{ rangeOffset: number; rangeLength: number; text: string }>,
    fullText?: string,
  ): void {
    const state = this.models.get(modelInstanceId);
    if (!state) return;

    state.documentVersion = afterVersion;
    state.isCompleted = false;
    const dirtyLine = state.tokenizer.applyEdits(changes, afterVersion, fullText);

    // Invalidate covered ranges from dirtyLine
    const newCovered: Range[] = [];
    for (const r of state.coveredRanges) {
      if (r.end < dirtyLine) {
        newCovered.push(r);
      } else if (r.start < dirtyLine) {
        newCovered.push({ start: r.start, end: dirtyLine - 1 });
      }
    }
    state.coveredRanges = newCovered;
    this.activeModelId = modelInstanceId;
    this.triggerSchedule();
  }

  disposeModel(modelInstanceId: string): void {
    this.models.delete(modelInstanceId);
    if (this.activeModelId === modelInstanceId) {
      this.activeModelId = this.models.keys().next().value;
    }
  }

  getModel(modelInstanceId: string): IncrementalTokenizer | undefined {
    return this.models.get(modelInstanceId)?.tokenizer;
  }

  /**
   * Schedule the next slice of work.
   */
  private triggerSchedule(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.status = 'busy';

    const runStep = () => {
      const hasMore = this.processNextSlice();
      if (hasMore) {
        setTimeout(runStep, 0);
      } else {
        this.isProcessing = false;
        this.status = 'idle';
      }
    };

    setTimeout(runStep, 0);
  }

  /**
   * Process one synchronous slice of work across pending models.
   * Returns true if more work remains.
   */
  processNextSlice(): boolean {
    const target = this.pickNextTarget();
    if (!target) {
      this.status = 'idle';
      return false;
    }

    const totalLines = target.tokenizer.getLineCount();
    const prefetchStart = Math.max(1, target.viewportStart - 300);
    const prefetchEnd = Math.min(totalLines, target.viewportEnd + 300);

    const nextRange = findUncoveredRange(target.coveredRanges, prefetchStart, prefetchEnd, totalLines);
    if (!nextRange) {
      target.isCompleted = true;
      return this.hasPendingWork();
    }

    const result: TokenizeSliceResult = target.tokenizer.tokenizeSlice(nextRange.start, nextRange.end, 12);
    addCoveredRange(target.coveredRanges, result.startLine, result.endLine);

    const isFullyDone =
      target.coveredRanges.length === 1 &&
      target.coveredRanges[0].start <= 1 &&
      target.coveredRanges[0].end >= totalLines;

    if (isFullyDone) {
      target.isCompleted = true;
    }

    // Emit batch
    this.onBatchCallback({
      type: 'tokens',
      modelInstanceId: target.modelInstanceId,
      documentVersion: target.documentVersion,
      startLineNumber: result.startLine,
      endLineNumber: result.endLine,
      lineTokens: result.lineTokens,
      endState: result.endState,
      isCompleted: target.isCompleted,
    });

    return this.hasPendingWork();
  }

  private pickNextTarget(): ModelTaskState | undefined {
    // Priority: Active model if not completed
    if (this.activeModelId) {
      const active = this.models.get(this.activeModelId);
      if (active && !active.isCompleted) {
        return active;
      }
    }

    // Other models
    for (const m of this.models.values()) {
      if (!m.isCompleted) {
        return m;
      }
    }

    return undefined;
  }

  private hasPendingWork(): boolean {
    for (const m of this.models.values()) {
      if (!m.isCompleted) return true;
    }
    return false;
  }
}
