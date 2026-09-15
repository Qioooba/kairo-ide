// SPDX-License-Identifier: Apache-2.0
//
// Java LanguageClient (browser side) — drives the backend
// JDT LS. The actual LSP child process lives in the Theia
// backend (so the browser never sees the host env), and
// this client is the typed view onto that backend.
//
// In a single-process Theia (used in unit tests and
// `theia-product`'s product-bindings), the JavaLanguageClient
// can inject an optional in-process `JdtLsBackendService`
// (bound to the node JdtLsService). In a real remote
// scenario, the Theia messaging layer provides a
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
import type { JdtLsState } from '../common/jdt-ls-state';
import {
  LSPPublishDiagnosticsParams,
  LSPCompletionList,
  LSPCompletionItem,
  LSPLocation,
  LSPLocationLink,
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
  LSPDocumentHighlight,
  LSPSemanticTokens,
} from '../common/lsp-protocol';

/** Connection status for the language client. */
export type ClientConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

/** Backend event forwarded from JDT LS (in-process optional path). */
interface BackendEvent {
  kind: 'state' | 'log' | 'diagnostics' | 'message' | 'progress' | 'initialized' | 'exit';
  state?: JdtLsState;
  log?: { level: 'stdout' | 'stderr'; line: string };
  diagnostics?: LSPPublishDiagnosticsParams;
  message?: string;
  progress?: LSPProgressParams;
}

/** Optional in-process backend may also expose onEvent (unit / single-process). */
type InProcessJdtLsBackend = JdtLsBackendService & {
  onEvent?: Event<BackendEvent>;
};

@injectable()
export class JavaLanguageClient implements JdtLsFrontendClient, Disposable {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  /**
   * Optional in-process backend (single-process tests). Injected via the
   * browser-safe `JdtLsBackendService` symbol — never value-import the
   * node `JdtLsService` class (that pulls child_process into the bundle).
   */
  @inject(JdtLsBackendService)
  @optional()
  protected readonly backend!: InProcessJdtLsBackend;

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
    if (this.backend?.onEvent) {
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
    if (!this.connectionProvider) {
      return undefined;
    }
    if (this.rpcFailed) {
      return undefined;
    }
    if (!this.rpcProxy) {
      try {
        this.rpcProxy = this.connectionProvider.createProxy<JdtLsBackendService>(JdtLsBackendPath, this);
      } catch (err) {
        const msg = String(err);
        // Theia allows only one channel per path. If we dropped our
        // proxy reference while the channel is still open (e.g. after
        // a stop/restart), recreate will throw — do NOT poison RPC.
        if (msg.includes('already open') || msg.includes('connection') || msg.includes('WebSocket') || msg.includes('disposed')) {
          this.logger.warn(`[JavaLanguageClient] backend proxy not ready yet: ${msg.slice(0, 150)}`);
        } else {
          this.logger.warn(`[JavaLanguageClient] backend proxy unavailable: ${msg.slice(0, 150)}`);
          this.rpcFailed = true;
        }
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
      || msg.includes('Pending response rejected')
      || msg.includes('already open');
  }

  /**
   * Lifecycle "not ready yet" is expected while JDT LS starts.
   * It must NOT poison the RPC channel — otherwise every later
   * Find Class / Symbol / completion call falls back to an empty
   * in-process stub forever.
   */
  protected isLifecycleNotReadyError(err: unknown): boolean {
    const msg = String(err);
    return msg.includes('JDT LS not ready')
      || /state=(uninitialized|starting|initializing|stopping|stopped)/i.test(msg);
  }

  /** LSP methods we advertise but haven't wired yet must not kill RPC. */
  protected isUnhandledLspMethodError(err: unknown): boolean {
    const msg = String(err);
    return msg.includes('Unhandled method')
      || msg.includes('Method not found') && msg.includes('workspace/configuration');
  }

  /** Check if an error indicates the backend method is not available. */
  protected isPermanentRpcFailure(err: unknown): boolean {
    const msg = String(err);
    if (this.isUnhandledLspMethodError(err)) return false;
    return msg.includes('method not found')
      || msg.includes('Method not found')
      || msg.includes('Internal error') && msg.includes('no handler');
  }

  /** Mark the RPC path broken (backend has no handler) and fall back. */
  protected markRpcFailed(err: unknown): void {
    if (this.isLifecycleNotReadyError(err)) {
      this.logger.info(`[JavaLanguageClient] backend not ready yet (keeping RPC): ${String(err).slice(0, 200)}`);
      return;
    }
    if (this.isUnhandledLspMethodError(err)) {
      this.logger.warn(`[JavaLanguageClient] unhandled LSP method (keeping RPC): ${String(err).slice(0, 200)}`);
      return;
    }
    if (this.isTransientConnectionError(err)) {
      // Keep rpcProxy: Theia channels are one-per-path. Clearing the
      // reference then calling createProxy again throws "already open"
      // and used to permanently poison Find Class / Symbol.
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
        const proxy = this.proxy();
        if (!proxy) {
          // Permanent RPC failure → fall back immediately (no 4–7.5s wait).
          if (this.rpcFailed) {
            return fallback();
          }
          if (attempt >= retries) break;
          const delay = baseDelay * (attempt + 1);
          this.logger.info(`[JavaLanguageClient] RPC proxy not available, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return await operation();
      } catch (err) {
        lastErr = err;
        if (this.isPermanentRpcFailure(err)) break;
        const retryable = this.isTransientConnectionError(err) || this.isLifecycleNotReadyError(err);
        if (!retryable || attempt >= retries) break;
        const delay = Math.min(baseDelay * (2 ** attempt), 5000);
        this.logger.info(`[JavaLanguageClient] RPC transient/not-ready error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
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
  async start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string; jreHome?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.withRetry(
      () => this.proxy()!.$start(opts),
      async () => {
        if (!this.backend) {
          return { ok: false, reason: 'Backend service not available' };
        }
        try {
          return await this.backend.$start(opts);
        } catch (err) {
          this.logger.error(`[JavaLanguageClient] start failed: ${String(err)}`);
          return { ok: false, reason: String(err) };
        }
      },
      2,
      1000,
    );
  }

  async stop(): Promise<void> {
    return this.withRetry(
      () => this.proxy()!.$stop(),
      async () => {
        if (this.backend) {
          await this.backend.$stop();
        }
      },
    );
  }

  state(): JdtLsState {
    return this.lastKnownState;
  }

  /**
   * Resolve the JDT LS install info (home / JRE / launcher jar) from
   * the backend. The Go agent's /api/v1/jdtls status refers to its own
   * (unused) manager and carries no JRE for the Theia-hosted process,
   * so the status bar uses this to display the real JDK version.
   */
  async inspect(): Promise<{ ok: true; home: string; jre: string; launcherJar: string; javaMajor?: number } | { ok: false; reason: string }> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$inspect();
      } catch (err) {
        this.logger.debug(`[JavaLanguageClient] $inspect via RPC failed: ${String(err)}`);
      }
    }
    if (this.backend?.$inspect) {
      return this.backend.$inspect();
    }
    return { ok: false, reason: 'backend unavailable' };
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
          return this.backend.$state();
        }
        return this.lastKnownState;
      },
      2,
      1000,
    );
  }

  /**
   * Non-blocking state probe for interactive suggest.
   * Never waits on RPC reconnect retries — Monaco hides other
   * providers (Live Templates / Hippie) behind "Loading…" until
   * every completion provider settles.
   */
  async fetchStateQuick(): Promise<JdtLsState> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        const s = await Promise.race([
          proxy.$state(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 200)),
        ]);
        if (s) {
          this.lastKnownState = s;
          return s;
        }
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    if (this.backend) {
      try {
        const s = await this.backend.$state();
        this.lastKnownState = s;
        return s;
      } catch {
        // fall through
      }
    }
    return this.lastKnownState;
  }

  didOpen(p: { uri: string; languageId: string; version: number; text: string }): void {
    const proxy = this.proxy();
    if (proxy) {
      proxy.$didOpen(p).catch(err => this.markRpcFailed(err));
      return;
    }
    void this.backend?.$didOpen(p);
  }

  didChange(p: { uri: string; version: number; changes: { range?: { start: { line: number; character: number }; end: { line: number; character: number } }; rangeLength?: number; text: string }[] }): void {
    const proxy = this.proxy();
    if (proxy) {
      proxy.$didChange(p).catch(err => this.markRpcFailed(err));
      return;
    }
    void this.backend?.$didChange(p);
  }

  didClose(uri: string): void {
    const proxy = this.proxy();
    if (proxy) {
      proxy.$didClose(uri).catch(err => this.markRpcFailed(err));
      return;
    }
    void this.backend?.$didClose(uri);
  }

  async completion(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }): Promise<LSPCompletionList> {
    // Soft timeout for interactive suggest. Must stay under JavaCompletionProvider's
    // COMPLETION_BUDGET_MS so Monaco leaves "Loading…". Do NOT fall through to a
    // second backend.completion() after timeout — that can hang up to 30s (JDT LS
    // request timeout) and keeps the widget stuck (A3 3.1).
    const COMPLETION_RPC_MS = 4_500;
    const emptyIncomplete = (): LSPCompletionList => ({ isIncomplete: true, items: [] });
    const withSoftTimeout = (work: Promise<LSPCompletionList>, label: string) =>
      Promise.race([
        work,
        new Promise<LSPCompletionList>((_, reject) => {
          setTimeout(() => reject(new Error(`${label} timeout`)), COMPLETION_RPC_MS);
        }),
      ]);

    const proxy = this.proxy();
    if (proxy) {
      try {
        return await withSoftTimeout(proxy.$completion(p), 'completion RPC');
      } catch (err) {
        if (/completion RPC timeout/i.test(String(err))) {
          this.logger.warn('[JavaLanguageClient] completion soft-timeout (keeping RPC; provider will fallback)');
          // Signal provider via throw so it uses IntelliSense fallback immediately.
          throw err;
        }
        this.markRpcFailed(err);
      }
    }
    if (this.backend) {
      try {
        return await withSoftTimeout(
          Promise.resolve(this.backend.$completion(p)),
          'completion backend',
        );
      } catch (err) {
        this.logger.warn(`[JavaLanguageClient] completion backend soft-timeout/fail: ${String(err).slice(0, 160)}`);
        return emptyIncomplete();
      }
    }
    return emptyIncomplete();
  }

  async resolveCompletion(item: LSPCompletionItem): Promise<LSPCompletionItem> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$resolveCompletion(item);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.$resolveCompletion?.(item) ?? item;
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
    return this.backend?.$definition(p) ?? null;
  }

  async implementation(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    return this.callBackend('$implementation', p, () => this.backend?.$implementation(p) ?? null);
  }

  async hover(p: { uri: string; line: number; character: number }): Promise<LSPHover | null> {
    return this.callBackend('$hover', p, () => this.backend?.$hover(p) ?? null);
  }

  async references(p: { uri: string; line: number; character: number; includeDeclaration: boolean }): Promise<LSPLocation[]> {
    return this.callBackend('$references', p, () => this.backend?.$references(p) ?? []);
  }

  async typeDefinition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | LSPLocationLink[] | null> {
    return this.callBackend('$typeDefinition', p, () => this.backend?.$typeDefinition(p) ?? null);
  }

  async documentHighlight(p: { uri: string; line: number; character: number }): Promise<LSPDocumentHighlight[]> {
    return this.callBackend('$documentHighlight', p, () => this.backend?.$documentHighlight(p) ?? []);
  }

  async signatureHelp(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string; isRetrigger?: boolean }): Promise<LSPSignatureHelp | null> {
    return this.callBackend('$signatureHelp', p, () => this.backend?.$signatureHelp(p) ?? null);
  }

  async documentSymbols(uri: string): Promise<LSPDocumentSymbolResult> {
    return this.callBackend('$documentSymbols', uri, () => this.backend?.$documentSymbols(uri) ?? []);
  }

  async workspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult> {
    return this.callBackend('$workspaceSymbols', query, () => this.backend?.$workspaceSymbols(query) ?? []);
  }

  async codeActions(p: { uri: string; range: LSPRange; diagnostics: LSPDiagnostic[]; only?: string[] }): Promise<LSPCodeActionResult> {
    return this.callBackend('$codeActions', p, () => this.backend?.$codeActions(p) ?? []);
  }

  async rename(p: { uri: string; line: number; character: number; newName: string }): Promise<LSPWorkspaceEdit | null> {
    return this.callBackend('$rename', p, () => this.backend?.$rename(p) ?? null);
  }

  async prepareCallHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPCallHierarchyItem[]> {
    return this.callBackend('$prepareCallHierarchy', p, () => this.backend?.$prepareCallHierarchy(p) ?? []);
  }

  async incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]> {
    return this.callBackend('$incomingCalls', item, () => this.backend?.$incomingCalls(item) ?? []);
  }

  async outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]> {
    return this.callBackend('$outgoingCalls', item, () => this.backend?.$outgoingCalls(item) ?? []);
  }

  async prepareTypeHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPTypeHierarchyItem[]> {
    return this.callBackend('$prepareTypeHierarchy', p, () => this.backend?.$prepareTypeHierarchy(p) ?? []);
  }

  async supertypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    return this.callBackend('$supertypes', item, () => this.backend?.$supertypes(item) ?? []);
  }

  async subtypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    return this.callBackend('$subtypes', item, () => this.backend?.$subtypes(item) ?? []);
  }

  async codeLens(uri: string): Promise<LSPCodeLens[]> {
    return this.callBackend('$codeLens', uri, () => this.backend?.$codeLens(uri) ?? []);
  }

  async codeLensResolve(lens: LSPCodeLens): Promise<LSPCodeLens> {
    return this.callBackend('$codeLensResolve', lens, () => this.backend?.$codeLensResolve(lens) ?? lens);
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
    return this.backend?.$formatting(uri, options) ?? [];
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
    return this.backend?.$rangeFormatting(uri, range, options) ?? [];
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
    return this.backend?.$inlayHint(uri, range) ?? [];
  }

  async semanticTokensFull(uri: string): Promise<LSPSemanticTokens | null> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$semanticTokensFull(uri);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.$semanticTokensFull(uri) ?? null;
  }

  async semanticTokensRange(uri: string, range: LSPRange): Promise<LSPSemanticTokens | null> {
    const proxy = this.proxy();
    if (proxy) {
      try {
        return await proxy.$semanticTokensRange(uri, range);
      } catch (err) {
        this.markRpcFailed(err);
      }
    }
    return this.backend?.$semanticTokensRange(uri, range) ?? null;
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
    await this.backend?.$buildWorkspace(force);
  }

  /** Invoke one typed backend method through RPC, with the same
   *  durable in-process fallback used by the lifecycle calls. */
  protected async callBackend<K extends '$implementation' | '$hover' | '$references' | '$typeDefinition' | '$documentHighlight' | '$signatureHelp' | '$documentSymbols' | '$workspaceSymbols' | '$codeActions' | '$rename' | '$prepareCallHierarchy' | '$incomingCalls' | '$outgoingCalls' | '$prepareTypeHierarchy' | '$supertypes' | '$subtypes' | '$codeLens' | '$codeLensResolve' | '$formatting' | '$rangeFormatting' | '$inlayHint'>(
    method: K,
    arg: Parameters<JdtLsBackendService[K]>[0],
    fallback: () => ReturnType<JdtLsBackendService[K]>,
  ): Promise<Awaited<ReturnType<JdtLsBackendService[K]>>> {
    return await this.withRetry(
      async () => {
        const proxy = this.proxy();
        if (!proxy) {
          throw new Error('RPC proxy not available');
        }
        const fn = proxy[method] as (value: typeof arg) => ReturnType<JdtLsBackendService[K]>;
        return await fn.call(proxy, arg);
      },
      async () => await fallback(),
      4,
      750,
    ) as Awaited<ReturnType<JdtLsBackendService[K]>>;
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
    this.updateConnectionStatus(state);
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
    this.onConnectionStatusEmitter.dispose();
  }
}
