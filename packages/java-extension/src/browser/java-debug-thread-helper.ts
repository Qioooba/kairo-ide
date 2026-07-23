/**
 * Multi-thread switching helper for Java Debug.
 *
 * Theia's native DebugThreadsWidget already shows all threads
 * in the Debug view. This service adds convenience commands
 * for switching the current thread and inspecting thread state.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import type { DebugThread } from '@theia/debug/lib/browser/model/debug-thread';

export interface ThreadInfo {
  id: number;
  name: string;
  stopped: boolean;
  isCurrent: boolean;
}

export interface ThreadListState {
  threads: ThreadInfo[];
  currentThreadId: number | undefined;
  sessionId: string | undefined;
}

@injectable()
export class JavaThreadSwitchHelper {
  @inject(DebugSessionManager) protected readonly sessionManager!: DebugSessionManager;

  protected readonly onDidChangeThreadsEmitter = new Emitter<ThreadListState>();
  readonly onDidChangeThreads: Event<ThreadListState> = this.onDidChangeThreadsEmitter.event;

  /**
   * Get all threads from the current debug session.
   */
  getThreads(): ThreadInfo[] {
    const session = this.sessionManager.currentSession;
    if (!session) return [];
    const current = session.currentThread;
    const threads: ThreadInfo[] = [];
    for (const thread of session.threads) {
      threads.push({
        id: thread.threadId,
        name: thread.raw.name,
        stopped: thread.stopped,
        isCurrent: current?.threadId === thread.threadId,
      });
    }
    return threads;
  }

  /**
   * Get the current thread state.
   */
  getState(): ThreadListState {
    const session = this.sessionManager.currentSession;
    return {
      threads: this.getThreads(),
      currentThreadId: session?.currentThread?.threadId,
      sessionId: session?.id,
    };
  }

  /**
   * Switch the current thread to the given thread ID.
   */
  switchThread(threadId: number): boolean {
    const session = this.sessionManager.currentSession;
    if (!session) return false;
    for (const thread of session.threads) {
      if (thread.threadId === threadId) {
        session.currentThread = thread;
        this.fireChange();
        return true;
      }
    }
    return false;
  }

  /**
   * Switch to the next stopped thread.
   */
  switchToNextStoppedThread(): boolean {
    const session = this.sessionManager.currentSession;
    if (!session) return false;

    const stoppedThreads: DebugThread[] = [];
    for (const thread of session.stoppedThreads) {
      stoppedThreads.push(thread);
    }
    if (stoppedThreads.length === 0) return false;

    const current = session.currentThread;
    const currentIdx = current
      ? stoppedThreads.findIndex(t => t.threadId === current.threadId)
      : -1;
    const nextIdx = (currentIdx + 1) % stoppedThreads.length;
    session.currentThread = stoppedThreads[nextIdx];
    this.fireChange();
    return true;
  }

  /**
   * Switch to the previous stopped thread.
   */
  switchToPreviousStoppedThread(): boolean {
    const session = this.sessionManager.currentSession;
    if (!session) return false;

    const stoppedThreads: DebugThread[] = [];
    for (const thread of session.stoppedThreads) {
      stoppedThreads.push(thread);
    }
    if (stoppedThreads.length === 0) return false;

    const current = session.currentThread;
    const currentIdx = current
      ? stoppedThreads.findIndex(t => t.threadId === current.threadId)
      : -1;
    const prevIdx = currentIdx <= 0
      ? stoppedThreads.length - 1
      : currentIdx - 1;
    session.currentThread = stoppedThreads[prevIdx];
    this.fireChange();
    return true;
  }

  /**
   * Get detailed info about a specific thread.
   */
  getThreadDetail(threadId: number): DebugThread | undefined {
    const session = this.sessionManager.currentSession;
    if (!session) return undefined;
    for (const thread of session.threads) {
      if (thread.threadId === threadId) return thread;
    }
    return undefined;
  }

  protected fireChange(): void {
    this.onDidChangeThreadsEmitter.fire(this.getState());
  }
}