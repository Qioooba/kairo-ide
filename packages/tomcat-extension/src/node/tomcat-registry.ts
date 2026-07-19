// SPDX-License-Identifier: Apache-2.0
//
// TomcatRegistry — a process-level singleton that owns the
// map of TomcatManager instances. The frontend (or the
// Agent, via the runtime HTTP API) drives the lifecycle
// through this registry. The registry routes each
// project's server action to the right manager and emits
// a single shared event bus for the UI to subscribe to.

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { TomcatManager, TomcatEvent, TomcatInstance, TomcatStartOptions, TomcatState } from './tomcat-manager';

@injectable()
export class TomcatRegistry {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  protected managers = new Map<string, TomcatManager>();
  protected readonly onEventEmitter = new Emitter<TomcatRegistryEvent>();
  readonly onEvent: Event<TomcatRegistryEvent> = this.onEventEmitter.event;
  /** Bounded ring buffer of recent log lines across all
   *  instances, useful for the global log panel. */
  protected readonly logBuffer: { serverId: string; level: 'stdout' | 'stderr'; line: string; ts: string }[] = [];
  protected readonly logBufferCap = 5_000;

  @postConstruct()
  protected init(): void {
    this.logger.info('[TomcatRegistry] initialised');
  }

  list(): TomcatInstance[] {
    const out: TomcatInstance[] = [];
    for (const m of this.managers.values()) {
      const inst = m.getInstance();
      if (inst) out.push(inst);
    }
    return out;
  }

  get(id: string): TomcatManager | undefined {
    return this.managers.get(id);
  }

  state(id: string): TomcatState {
    return this.managers.get(id)?.getState() ?? 'stopped';
  }

  async start(opts: TomcatStartOptions): Promise<TomcatInstance> {
    let m = this.managers.get(opts.id);
    if (!m) {
      m = new TomcatManager();
      this.managers.set(opts.id, m);
      m.on('event', (e: TomcatEvent) => this.handleEvent(opts.id, e));
    }
    return m.start(opts);
  }

  async stop(id: string, deadlineMs?: number): Promise<void> {
    const m = this.managers.get(id);
    if (!m) return;
    await m.stop({ deadlineMs });
  }

  async restart(opts: TomcatStartOptions): Promise<TomcatInstance> {
    const m = this.managers.get(opts.id);
    if (m) {
      return m.restart(opts);
    }
    return this.start(opts);
  }

  /** Return the last `n` log lines for an instance. */
  recentLogs(id: string, n = 500): { level: 'stdout' | 'stderr'; line: string; ts: string }[] {
    const out: { level: 'stdout' | 'stderr'; line: string; ts: string }[] = [];
    for (let i = this.logBuffer.length - 1; i >= 0 && out.length < n; i--) {
      const e = this.logBuffer[i];
      if (e.serverId === id) out.push(e);
    }
    return out.reverse();
  }

  dispose(): void {
    for (const m of this.managers.values()) {
      m.removeAllListeners();
    }
    this.managers.clear();
    this.onEventEmitter.dispose();
  }

  protected handleEvent(serverId: string, e: TomcatEvent): void {
    if (e.kind === 'log' && e.log) {
      this.logBuffer.push({ serverId, level: e.log.level, line: e.log.line, ts: e.ts });
      if (this.logBuffer.length > this.logBufferCap) {
        this.logBuffer.splice(0, this.logBuffer.length - this.logBufferCap);
      }
    }
    this.onEventEmitter.fire({ serverId, event: e });
  }
}

export interface TomcatRegistryEvent {
  serverId: string;
  event: TomcatEvent;
}
