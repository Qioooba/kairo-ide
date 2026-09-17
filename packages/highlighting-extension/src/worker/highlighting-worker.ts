export * from './highlighting-worker-core';
import { HighlightingWorkerInstance } from './highlighting-worker-core';
import type { WorkerInboundMessage, WorkerOutboundMessage } from '../common/highlight-protocol';

// Isolate dedicated worker environment: do not bind self.onmessage in Window/DOM or Node main threads
const isDedicatedWorker =
  (typeof (globalThis as any).WorkerGlobalScope !== 'undefined' &&
    typeof self !== 'undefined' &&
    self instanceof (globalThis as any).WorkerGlobalScope) ||
  (typeof window === 'undefined' &&
    typeof document === 'undefined' &&
    typeof self !== 'undefined' &&
    typeof (self as any).importScripts === 'function' &&
    typeof (self as any).postMessage === 'function');

if (isDedicatedWorker) {
  const instance = new HighlightingWorkerInstance((msg: WorkerOutboundMessage) => {
    (self as any).postMessage(msg);
  });

  self.onmessage = (e: MessageEvent<WorkerInboundMessage>) => {
    if (e.data) {
      instance.handleMessage(e.data);
    }
  };
}

