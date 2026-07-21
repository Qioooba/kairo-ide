// SPDX-License-Identifier: Apache-2.0
//
// JdtLsService — a process-level singleton over the
// JdtLsManager. The browser side talks to this through the
// LanguageClient bridge; the manager spawns the JDT LS
// process on first need and shares the connection across
// documents and workspaces.

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { JdtLsManager, JdtLsEvent, JdtLsState, JdtLsDistribution } from './jdt-ls-manager';
import { LSPPublishDiagnosticsParams, LSPCompletionList, LSPLocation } from '../common/lsp-protocol';

export interface JdtLsServiceEvent {
  kind: 'state' | 'log' | 'diagnostics' | 'initialized' | 'exit' | 'message';
  state?: JdtLsState;
  log?: { level: 'stdout' | 'stderr'; line: string };
  diagnostics?: LSPPublishDiagnosticsParams;
  message?: string;
}

@injectable()
export class JdtLsService {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  protected manager: JdtLsManager | undefined;
  protected readonly onEventEmitter = new Emitter<JdtLsServiceEvent>();
  readonly onEvent: Event<JdtLsServiceEvent> = this.onEventEmitter.event;
  protected subscription: Disposable | undefined;

  @postConstruct()
  protected init(): void {
    this.logger.info('[JdtLsService] initialised');
  }

  state(): JdtLsState {
    return this.manager?.state$() ?? 'uninitialized';
  }

  /** Inspect the install without starting it. Returns
   *  `{ ok: true, dist }` or `{ ok: false, reason }`.
   *  `home` (from the agent's launch descriptor) wins over
   *  the KAIRO_JDT_LS_HOME env fallback. */
  inspect(home?: string): { ok: true; dist: JdtLsDistribution } | { ok: false; reason: string } {
    const r = JdtLsManager.resolveDistribution({ home });
    if ('kind' in r) {
      return { ok: false, reason: r.message };
    }
    return { ok: true, dist: r };
  }

  async start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string }): Promise<void> {
    if (!this.manager) {
      this.manager = new JdtLsManager(this.logger);
      this.subscription = this.manager.onEvent(e => this.handleManagerEvent(e));
    }
    if (this.manager.state$() === 'ready' || this.manager.state$() === 'initializing') {
      return;
    }
    await this.manager.start(opts);
  }

  async stop(): Promise<void> {
    if (!this.manager) return;
    await this.manager.stop();
  }

  didOpen(p: { uri: string; languageId: string; version: number; text: string }): void {
    this.manager?.didOpen(p);
  }

  didChange(p: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): void {
    this.manager?.didChange(p);
  }

  didClose(uri: string): void {
    this.manager?.didClose(uri);
  }

  async completion(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }): Promise<LSPCompletionList> {
    if (!this.manager) {
      return { isIncomplete: false, items: [] };
    }
    return this.manager.completion(p);
  }

  async definition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    if (!this.manager) return null;
    return this.manager.definition(p);
  }

  recentLogs() {
    return this.manager?.recentLogs() ?? [];
  }

  protected handleManagerEvent(e: JdtLsEvent): void {
    switch (e.kind) {
      case 'state':
        this.onEventEmitter.fire({ kind: 'state', state: e.state });
        break;
      case 'log':
        this.onEventEmitter.fire({ kind: 'log', log: { level: e.level, line: e.line } });
        break;
      case 'diagnostics':
        this.onEventEmitter.fire({ kind: 'diagnostics', diagnostics: e.params });
        break;
      case 'initialized':
        this.onEventEmitter.fire({ kind: 'state', state: 'ready' });
        break;
      case 'exit':
        this.onEventEmitter.fire({ kind: 'message', message: `JDT LS exited code=${e.code} signal=${e.signal ?? ''}` });
        break;
    }
  }

  dispose(): void {
    this.subscription?.dispose();
    this.manager?.dispose();
    this.manager = undefined;
    this.onEventEmitter.dispose();
  }
}
