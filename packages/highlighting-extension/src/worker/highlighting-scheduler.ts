/**
 * Highlighting Scheduler for Worker.
 * Prioritizes active viewports with 300-line prefetch, background EOF completion,
 * and multi-document fairness.
 * Pure logic — runnable in Web Worker or Node thread.
 */

import { IncrementalTokenizer, TokenizeSliceResult } from './incremental-tokenizer';
import type { TokenBatchMessage } from '../common/highlight-protocol';

export interface ModelTaskState {
  modelInstanceId: string;
  tokenizer: IncrementalTokenizer;
  documentVersion: number;
  viewportStart: number;
  viewportEnd: number;
  lastProcessedLine: number;
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
      lastProcessedLine: 0,
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
    state.tokenizer.applyEdits(changes, afterVersion, fullText);
    state.lastProcessedLine = 0;
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

    // 1. Process viewport with +/- 300 line prefetch
    const prefetchStart = Math.max(1, target.viewportStart - 300);
    const prefetchEnd = Math.min(target.tokenizer.getLineCount(), target.viewportEnd + 300);

    let sliceStart = prefetchStart;
    let sliceEnd = prefetchEnd;

    if (target.lastProcessedLine < prefetchEnd) {
      sliceStart = Math.max(prefetchStart, target.lastProcessedLine + 1);
      sliceEnd = prefetchEnd;
    } else {
      // Progressive EOF sweep
      sliceStart = target.lastProcessedLine + 1;
      sliceEnd = Math.min(target.tokenizer.getLineCount(), sliceStart + 500);
    }

    const result: TokenizeSliceResult = target.tokenizer.tokenizeSlice(sliceStart, sliceEnd, 12);

    target.lastProcessedLine = result.endLine;
    if (result.isCompleted) {
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
