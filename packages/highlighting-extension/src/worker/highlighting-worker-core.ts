/**
 * Highlighting Worker Core.
 * Pure logic and message routing — no direct Web Worker / DOM side-effects.
 */

import { HighlightingScheduler } from './highlighting-scheduler';
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  TokenBatchMessage,
} from '../common/highlight-protocol';

export class HighlightingWorkerInstance {
  private scheduler: HighlightingScheduler;
  private postMessageFn: (msg: WorkerOutboundMessage) => void;

  constructor(postMessage: (msg: WorkerOutboundMessage) => void) {
    this.postMessageFn = postMessage;
    this.scheduler = new HighlightingScheduler((batch: TokenBatchMessage) => {
      this.postMessageFn(batch);
    });
  }

  handleMessage(msg: WorkerInboundMessage): void {
    try {
      switch (msg.type) {
        case 'snapshot':
          this.scheduler.registerModel(
            msg.modelInstanceId,
            msg.languageId,
            msg.dialect ?? msg.languageId,
            msg.version,
            msg.text,
            msg.activeViewport,
          );
          break;

        case 'edit':
          this.scheduler.updateContent(
            msg.modelInstanceId,
            msg.beforeVersion,
            msg.afterVersion,
            msg.changes,
          );
          if (msg.activeViewport) {
            this.scheduler.updateViewport(
              msg.modelInstanceId,
              msg.activeViewport.startLine,
              msg.activeViewport.endLine,
            );
          }
          break;

        case 'viewport':
          this.scheduler.updateViewport(
            msg.modelInstanceId,
            msg.startLine,
            msg.endLine,
          );
          break;

        case 'dispose':
          this.scheduler.disposeModel(msg.modelInstanceId);
          break;
      }
    } catch (e: any) {
      this.postMessageFn({
        type: 'error',
        modelInstanceId: (msg as any).modelInstanceId,
        message: e?.message ?? String(e),
        stack: e?.stack,
      });
    }
  }

  getScheduler(): HighlightingScheduler {
    return this.scheduler;
  }
}
