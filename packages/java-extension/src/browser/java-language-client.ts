// SPDX-License-Identifier: Apache-2.0
//
// Java LanguageClient (browser side) — drives the backend
// JDT LS. The actual LSP child process lives in the Theia
// backend (so the browser never sees the host env), and
// this client is the typed view onto that backend.
//
// In a single-process Theia (used in unit tests and
// `theia-product`'s product-bindings), the JavaLanguageClient
// and JdtLsService share the same Inversify container, so
// we can call the backend service directly. In a real
// remote scenario, the Theia messaging layer provides a
// JsonRpcProxy that bridges the two.

import { injectable, inject, optional, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { JdtLsBackendService, JdtLsFrontendClient } from '../common/java-ls-protocol';
import { JdtLsService } from '../node/jdt-ls-service';
import { JdtLsState } from '../node/jdt-ls-manager';
import { LSPPublishDiagnosticsParams, LSPCompletionList, LSPLocation } from '../common/lsp-protocol';

@injectable()
export class JavaLanguageClient implements JdtLsFrontendClient, Disposable {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(JdtLsService)
  protected readonly backend!: JdtLsService;

  @inject(JdtLsBackendService)
  @optional()
  protected readonly backendProxy?: JdtLsBackendService;

  protected readonly onDiagnosticsEmitter = new Emitter<LSPPublishDiagnosticsParams>();
  readonly onDiagnostics: Event<LSPPublishDiagnosticsParams> = this.onDiagnosticsEmitter.event;
  protected readonly onStateEmitter = new Emitter<JdtLsState>();
  readonly onState: Event<JdtLsState> = this.onStateEmitter.event;
  protected readonly onLogEmitter = new Emitter<{ level: 'stdout' | 'stderr'; line: string }>();
  readonly onLog: Event<{ level: 'stdout' | 'stderr'; line: string }> = this.onLogEmitter.event;
  protected subs: Disposable[] = [];

  @postConstruct()
  protected init(): void {
    this.logger.info('[JavaLanguageClient] initialised');
    this.subs.push(
      this.backend.onEvent(e => this.forwardBackendEvent(e)),
    );
  }

  /** Static helper for the messaging layer. */
  static path(): string {
    return '/services/jdt-ls-backend';
  }

  /**
   * Start the JDT LS for a given workspace. The Theia
   * backend process is the owner of the LSP child process;
   * the browser only drives it.
   */
  async start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const inspect = this.backend.inspect();
    if (!inspect.ok) {
      this.logger.warn(`[JavaLanguageClient] cannot start: ${inspect.reason}`);
      return { ok: false, reason: inspect.reason };
    }
    try {
      await this.backend.start(opts);
      return { ok: true };
    } catch (err) {
      this.logger.error(`[JavaLanguageClient] start failed: ${String(err)}`);
      return { ok: false, reason: String(err) };
    }
  }

  async stop(): Promise<void> {
    await this.backend.stop();
  }

  state(): JdtLsState {
    return this.backend.state();
  }

  didOpen(p: { uri: string; languageId: string; version: number; text: string }): void {
    this.backend.didOpen(p);
  }

  didChange(p: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): void {
    this.backend.didChange(p);
  }

  didClose(uri: string): void {
    this.backend.didClose(uri);
  }

  async completion(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }): Promise<LSPCompletionList> {
    if (this.backendProxy) {
      return this.backendProxy.$completion(p);
    }
    return this.backend.completion(p);
  }

  async definition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    if (this.backendProxy) {
      return this.backendProxy.$definition(p);
    }
    return this.backend.definition(p);
  }

  // --- JdtLsFrontendClient (called from backend) ---

  onStateEvent(state: JdtLsState): void {
    this.onStateEmitter.fire(state);
  }

  onLogEvent(level: 'stdout' | 'stderr', line: string): void {
    this.onLogEmitter.fire({ level, line });
  }

  onDiagnosticsEvent(params: LSPPublishDiagnosticsParams): void {
    this.onDiagnosticsEmitter.fire(params);
  }

  onMessageEvent(message: string): void {
    this.logger.info(`[JavaLanguageClient] backend: ${message}`);
  }

  protected forwardBackendEvent(e: any): void {
    if (e.kind === 'state' && e.state) {
      this.onStateEmitter.fire(e.state as JdtLsState);
    } else if (e.kind === 'log' && e.log) {
      this.onLogEmitter.fire(e.log);
    } else if (e.kind === 'diagnostics' && e.diagnostics) {
      this.onDiagnosticsEmitter.fire(e.diagnostics);
    } else if (e.kind === 'message' && e.message) {
      this.logger.info(`[JavaLanguageClient] backend: ${e.message}`);
    }
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
    this.onDiagnosticsEmitter.dispose();
    this.onStateEmitter.dispose();
    this.onLogEmitter.dispose();
  }
}
