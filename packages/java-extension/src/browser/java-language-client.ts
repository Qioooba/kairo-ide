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
//
// Connection lifecycle:
//   - The client monitors the backend state and emits events
//     for disconnection/reconnection.
//   - When the backend disconnects unexpectedly, the client
//     enters a "reconnecting" state and notifies listeners.
//   - The JavaLanguageServerLifecycle handles the actual
//     restart logic based on these events.

import { injectable, inject, optional, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import { JdtLsBackendService, JdtLsFrontendClient, JdtLsBackendPath } from '../common/java-ls-protocol';
import { JdtLsService } from '../node/jdt-ls-service';
import { JdtLsState } from '../node/jdt-ls-manager';
import {
  LSPPublishDiagnosticsParams,
  LSPCompletionList,
  LSPLocation,
  LSPHover,
  LSPSignatureHelp,
  LSPDocumentSymbolResult,
  LSPWorkspaceSymbolResult,
  LSPWorkspaceEdit,
  LSPCodeActionResult,
  LSPDiagnostic,
  LSPRange,
  LSPCodeLens,
  LSPProgressParams,
  LSPCallHierarchyItem,
  LSPCallHierarchyIncomingCall,
  LSPCallHierarchyOutgoingCall,
  LSPTypeHierarchyItem,
  LSPTextEdit,
  LSPInlayHint,
} from '../common/lsp-protocol';

/** Connection status for the language client. */
export type ClientConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

/** Backend event forwarded from JDT LS. */
interface BackendEvent {
  kind: 'state' | 'log' | 'diagnostics' | 'message' | 'progress' | 'initialized' | 'exit';
  state?: JdtLsState;
  log?: { level: 'stdout' | 'stderr'; line: string };
  diagnostics?: LSPPublishDiagnosticsParams;
  message?: string;
  progress?: LSPProgressParams;
}

@injectable()
export class JavaLanguageClient implements JdtLsFrontendClient, Disposable {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(JdtLsService)
  @optional()
  protected readonly backend!: JdtLsService;

  @inject(WebSocketConnectionProvider)
  @optional()
  protected readonly connectionProvider?: WebSocketConnectionProvider;

  protected readonly onDiagnosticsEmitter = new Emitter<LSPPublishDiagnosticsParams>();
  readonly onDiagnostics: Event<LSPPublishDiagnosticsParams> = this.onDiagnosticsEmitter.event;
  protected readonly onStateEmitter = new Emitter<JdtLsState>();
  readonly onState: Event<JdtLsState> = this.onStateEmitter.event;
  protected readonly onLogEmitter = new Emitter<{ level: 'stdout' | 'stderr'; line: string }>();
  readonly onLog: Event<{ level: 'stdout' | 'stderr'; line: string }> = this.onLogEmitter.event;
  protected readonly onProgressEmitter = new Emitter<LSPProgressParams>();
  readonly onProgress: Event<LSPProgressParams> = this.onProgressEmitter.event;
  protected readonly onConnectionStatusEmitter = new Emitter<ClientConnectionStatus>();
  /** Emitted when the client's connection status changes. */
  readonly onConnectionStatus: Event<ClientConnectionStatus> = this.onConnectionStatusEmitter.event;
  protected subs: Disposable[] = [];

  /**
   * JSON-RPC proxy to the backend-hosted JdtLsService. Created
   * lazily; undefined in single-process mode (unit tests). If a
   * call through it fails, we permanently fall back to the
   * in-process service for this session.
   */
  protected rpcProxy: JdtLsBackendService | undefined;
  protected rpcFailed = false;

  /** Connection status tracking. */
  protected connectionStatus: ClientConnectionStatus = 'disconnected';
  private lastKnownState: JdtLsState = 'uninitialized';

  @postConstruct()
  protected init(): void {
    this.logger.info('[JavaLanguageClient] initialised');
    if (this.backend) {
      this.subs.push(
        this.backend.onEvent(e => this.forwardBackendEvent(e)),
      );
    }
  }

  /** Returns the current connection status. */
  getConnectionStatus(): ClientConnectionStatus {
    return this.connectionStatus;
  }

  /** Static helper for the messaging layer. */
  static path(): string {
    return '/services/jdt-ls-backend';
  }

  /**
   * The backend proxy, when the Theia backend hosts the JDT LS
   * service (web product and desktop). In single-process test
   * containers there is no WebSocket layer — undefined, and the
   * caller uses the in-process service.
   */
  protected proxy(): JdtLsBackendService | undefined {
    if (this.rpcFailed || !this.connectionProvider) {
      return undefined;
    }
    if (!this.rpcProxy) {
      try {
        this.rpcProxy = this.connectionProvider.createProxy<JdtLsBackendService>(JdtLsBackendPath, this);
      } catch (err) {
        this.logger.warn(`[JavaLanguageClient] backend proxy unavailable, using in-process service: ${String(err)}`);
        this.rpcFailed = true;
        return undefined;
      }
    }
    return this.rpcProxy;
  }

  /** Check if an error is a transient connection/disposal error. */
  protected isTransientConnectionError(err: unknown): boolean {
    const msg = String(err);
    return msg.includes('connection got disposed')
      || msg.includes('connection is disposed')
      || msg.includes('WebSocket is not open')
      || msg.includes('connection closing')
      || msg.includes('Pending response rejected');
  }

  /** Check if an error indicates the backend method is not available. */
  protected isPermanentRpcFailure(err: unknown): boolean {
    const msg = String(err);
    return msg.includes('method not found')
      || msg.includes('Method not found')
      || msg.includes('Internal error') && msg.includes('no handler');
  }

  /** Mark the RPC path broken (backend has no handler) and fall back. */
  protected markRpcFailed(err: unknown): void {
    if (this.isTransientConnectionError(err)) {
      this.rpcProxy = undefined;
      this.logger.warn(`[JavaLanguageClient] backend RPC connection transient error (will retry on next call): ${String(err).slice(0, 200)}`);
      return;
    }
    this.rpcFailed = true;
    this.rpcProxy = undefined;
    this.logger.warn(`[JavaLanguageClient] backend RPC failed, falling back to in-process service: ${String(err).slice(0, 200)}`);
  }

  /** Retry an RPC operation with exponential backoff for transient errors. */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    retries = 5,
    baseDelay = 1000,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.rpcProxy = undefined;
        const proxy = this.proxy();
        if (!proxy) break;
        return await operation();
      } catch (err) {
        lastErr = err;
        if (this.isPermanentRpcFailure(err)) break;
        if (!this.isTransientConnectionError(err) || attempt >= retries) break;
        const delay = Math.min(baseDelay * (2 ** attempt), 5000);
        this.logger.info(`[JavaLanguageClient] RPC transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    return fallback();
  }

  /**
   * Start the JDT LS for a given workspace. The Theia
   * backend process is the owner of the LSP child process;
   * the browser only drives it.
   *
   * `home` is the JDT LS install root derived from the Go
   * agent's launch descriptor; when present it wins over
   * the KAIRO_JDT_LS_HOME env fallback in the backend.
   */
  async start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.withRetry(
      () => this.proxy()!.$start(opts),
      async () => {
        if (!this.backend) {
          return { ok: false, reason: 'Backend service not available' };
        }
        const inspect = this.backend.inspect(opts.home);
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
      },
    );
  }

  async stop(): Promise<void> {
    return this.withRetry(
      () => this.proxy()!.$stop(),
      async () => {
        if (this.backend) {
          await this.backend.stop();
        }
      },
    );
  }

  state(): JdtLsState {
    return this.lastKnownState;
  }

  async fetchState(): Promise<JdtLsState> {
    return this.withRetry(
      async () => {
        const s = await this.proxy()!.$state();
        this.lastKnownState = s;
        return s;
      },
      async () => {
        if (this.backend) {
          return this.backend.state();
        }
        return this.lastKnownState;
      },
    );
  }

  didOpen(p: { uri: string; languageId: string; version: number; text: string }): void {
    const proxy = this.proxy();
    if (proxy) {
      proxy.$didOpen(p).catch(err => this.markRpcFailed(err));
      return;
    }
    this.backend?.didOpen(p);
  }

  didChange(p: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): void {
    const proxy = this.proxy();
    if (proxy) {
      proxy.$didChange(p).catch(err => this.markRpcFailed(err));
      return;
    }
    this.backend?.didChange(p);
  }

  didClose(uri: string): void {
    const proxy = this.proxy();
    if (proxy) {
      proxy.$didClose(uri).catch(err => this.markRpcFailed(err));
      return;
    }
    this.backend?.didClose(uri);
  }

  async completion(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }): Promise<LSPCompletionList> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$completion(p);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.completion(p) ?? { isIncomplete: false, items: [] };
  }

  async definition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$definition(p);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.definition(p) ?? null;
  }

  async implementation(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    return this.callBackend('$implementation', p, () => this.backend?.implementation(p) ?? null);
  }

  async hover(p: { uri: string; line: number; character: number }): Promise<LSPHover | null> {
    return this.callBackend('$hover', p, () => this.backend?.hover(p) ?? null);
  }

  async references(p: { uri: string; line: number; character: number; includeDeclaration: boolean }): Promise<LSPLocation[]> {
    return this.callBackend('$references', p, () => this.backend?.references(p) ?? []);
  }

  async signatureHelp(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string; isRetrigger?: boolean }): Promise<LSPSignatureHelp | null> {
    return this.callBackend('$signatureHelp', p, () => this.backend?.signatureHelp(p) ?? null);
  }

  async documentSymbols(uri: string): Promise<LSPDocumentSymbolResult> {
    return this.callBackend('$documentSymbols', uri, () => this.backend?.documentSymbols(uri) ?? []);
  }

  async workspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult> {
    return this.callBackend('$workspaceSymbols', query, () => this.backend?.workspaceSymbols(query) ?? []);
  }

  async codeActions(p: { uri: string; range: LSPRange; diagnostics: LSPDiagnostic[]; only?: string[] }): Promise<LSPCodeActionResult> {
    return this.callBackend('$codeActions', p, () => this.backend?.codeActions(p) ?? []);
  }

  async rename(p: { uri: string; line: number; character: number; newName: string }): Promise<LSPWorkspaceEdit | null> {
    return this.callBackend('$rename', p, () => this.backend?.rename(p) ?? null);
  }

  async prepareCallHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPCallHierarchyItem[]> {
    return this.callBackend('$prepareCallHierarchy', p, () => this.backend?.prepareCallHierarchy(p) ?? []);
  }

  async incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]> {
    return this.callBackend('$incomingCalls', item, () => this.backend?.incomingCalls(item) ?? []);
  }

  async outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]> {
    return this.callBackend('$outgoingCalls', item, () => this.backend?.outgoingCalls(item) ?? []);
  }

  async prepareTypeHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPTypeHierarchyItem[]> {
    return this.callBackend('$prepareTypeHierarchy', p, () => this.backend?.prepareTypeHierarchy(p) ?? []);
  }

  async supertypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    return this.callBackend('$supertypes', item, () => this.backend?.supertypes(item) ?? []);
  }

  async subtypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    return this.callBackend('$subtypes', item, () => this.backend?.subtypes(item) ?? []);
  }

  async codeLens(uri: string): Promise<LSPCodeLens[]> {
    return this.callBackend('$codeLens', uri, () => this.backend?.codeLens(uri) ?? []);
  }

  async formatting(uri: string, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$formatting(uri, options);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.formatting(uri, options) ?? [];
  }

  async rangeFormatting(uri: string, range: LSPRange, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$rangeFormatting(uri, range, options);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.rangeFormatting(uri, range, options) ?? [];
  }

  async inlayHint(uri: string, range?: LSPRange): Promise<LSPInlayHint[]> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$inlayHint(uri, range);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.inlayHint(uri, range) ?? [];
  }

  async buildWorkspace(force: boolean): Promise<void> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        await proxy.$buildWorkspace(force);
        return;
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    await this.backend?.buildWorkspace();
  }

  /** Invoke one typed backend method through RPC, with the same
   *  durable in-process fallback used by the lifecycle calls. */
  protected async callBackend<K extends '$implementation' | '$hover' | '$references' | '$signatureHelp' | '$documentSymbols' | '$workspaceSymbols' | '$codeActions' | '$rename' | '$prepareCallHierarchy' | '$incomingCalls' | '$outgoingCalls' | '$prepareTypeHierarchy' | '$supertypes' | '$subtypes' | '$codeLens' | '$formatting' | '$rangeFormatting' | '$inlayHint'>(
    method: K,
    arg: Parameters<JdtLsBackendService[K]>[0],
    fallback: () => ReturnType<JdtLsBackendService[K]>,
  ): Promise<Awaited<ReturnType<JdtLsBackendService[K]>>> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        const fn = proxy[method] as (value: typeof arg) => ReturnType<JdtLsBackendService[K]>;
        return await fn.call(proxy, arg) as Awaited<ReturnType<JdtLsBackendService[K]>>;
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return await fallback() as Awaited<ReturnType<JdtLsBackendService[K]>>;
  }

  /**
   * Contents of a jdt:// class-file URI (source or decompiled),
   * used by the monaco jdt:// content provider so F12 into
   * library jars actually opens.
   */
  async classFileContents(uri: string): Promise<string> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$classFileContents(uri);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.$classFileContents(uri) ?? '';
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

  onProgressEvent(params: LSPProgressParams): void {
    this.onProgressEmitter.fire(params);
  }

  protected forwardBackendEvent(e: BackendEvent): void {
    if (e.kind === 'state' && e.state) {
      const state = e.state as JdtLsState;
      this.updateConnectionStatus(state);
      this.onStateEmitter.fire(state);
    } else if (e.kind === 'log' && e.log) {
      this.onLogEmitter.fire(e.log);
    } else if (e.kind === 'diagnostics' && e.diagnostics) {
      this.onDiagnosticsEmitter.fire(e.diagnostics);
    } else if (e.kind === 'message' && e.message) {
      this.logger.info(`[JavaLanguageClient] backend: ${e.message}`);
    } else if (e.kind === 'progress' && e.progress) {
      this.onProgressEmitter.fire(e.progress);
    }
  }

  /** Update connection status based on backend state changes. */
  private updateConnectionStatus(newState: JdtLsState): void {
    const prev = this.connectionStatus;
    this.lastKnownState = newState;

    switch (newState) {
      case 'ready':
        this.connectionStatus = 'connected';
        break;
      case 'crashed':
      case 'failed':
        this.connectionStatus = 'disconnected';
        break;
      case 'starting':
      case 'initializing':
        if (this.connectionStatus === 'disconnected') {
          this.connectionStatus = 'reconnecting';
        }
        break;
      case 'uninitialized':
      case 'stopping':
      case 'stopped':
        this.connectionStatus = 'disconnected';
        break;
    }

    if (this.connectionStatus !== prev) {
      this.logger.info(`[JavaLanguageClient] connection status: ${prev} → ${this.connectionStatus}`);
      this.onConnectionStatusEmitter.fire(this.connectionStatus);
    }
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
    this.onDiagnosticsEmitter.dispose();
    this.onStateEmitter.dispose();
    this.onLogEmitter.dispose();
    this.onProgressEmitter.dispose();
  }
}
