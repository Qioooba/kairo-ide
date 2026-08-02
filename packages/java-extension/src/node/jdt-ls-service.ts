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
  LSPCallHierarchyItem,
  LSPCallHierarchyIncomingCall,
  LSPCallHierarchyOutgoingCall,
  LSPTypeHierarchyItem,
  LSPCodeLens,
  LSPProgressParams,
  LSPTextEdit,
  LSPInlayHint,
  LSPDocumentHighlight,
} from '../common/lsp-protocol';
import { JdtLsBackendService, JdtLsFrontendClient } from '../common/java-ls-protocol';

export interface JdtLsServiceEvent {
  kind: 'state' | 'log' | 'diagnostics' | 'initialized' | 'exit' | 'message' | 'progress';
  state?: JdtLsState;
  log?: { level: 'stdout' | 'stderr'; line: string };
  diagnostics?: LSPPublishDiagnosticsParams;
  message?: string;
  progress?: LSPProgressParams;
}

@injectable()
export class JdtLsService implements JdtLsBackendService {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  protected manager: JdtLsManager | undefined;
  protected readonly onEventEmitter = new Emitter<JdtLsServiceEvent>();
  readonly onEvent: Event<JdtLsServiceEvent> = this.onEventEmitter.event;
  protected subscription: Disposable | undefined;
  /**
   * The frontend client proxy, set by the messaging
   * ConnectionHandler when a browser connects. Events are
   * forwarded over JSON-RPC so the browser never needs the
   * node service in-process (KAIRO-RC-WEB-251: the browser
   * bundle used to instantiate this node service directly —
   * every fs check was a webpack-shim phantom and JDT LS
   * could never start in the web product).
   */
  protected client: JdtLsFrontendClient | undefined;

  @postConstruct()
  protected init(): void {
    this.logger.info('[JdtLsService] initialised');
  }

  setClient(client: JdtLsFrontendClient | undefined): void {
    this.client = client;
  }

  state(): JdtLsState {
    return this.manager?.state$() ?? 'uninitialized';
  }

  /** Inspect the install without starting it. Returns
   *  `{ ok: true, dist }` or `{ ok: false, reason }`.
   *  `home` / `jreHome` (from the agent's launch descriptor) win over
   *  the KAIRO_JDT_LS_HOME / JAVA_HOME env fallbacks. */
  inspect(home?: string, jreHome?: string): { ok: true; dist: JdtLsDistribution } | { ok: false; reason: string } {
    const r = JdtLsManager.resolveDistribution({ home, jreHome });
    if ('kind' in r) {
      return { ok: false, reason: r.message };
    }
    return { ok: true, dist: r };
  }

  async start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string; jreHome?: string }): Promise<void> {
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

  async resolveCompletion(item: LSPCompletionItem): Promise<LSPCompletionItem> {
    if (!this.manager) {
      return item;
    }
    return this.manager.resolveCompletion(item);
  }

  async definition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    if (!this.manager) return null;
    return this.manager.definition(p);
  }

  async implementation(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    if (!this.manager) return null;
    return this.manager.implementation(p);
  }

  async hover(p: { uri: string; line: number; character: number }): Promise<LSPHover | null> {
    if (!this.manager) return null;
    return this.manager.hover(p);
  }

  async references(p: { uri: string; line: number; character: number; includeDeclaration: boolean }): Promise<LSPLocation[]> {
    if (!this.manager) return [];
    return this.manager.references(p);
  }

  async typeDefinition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | LSPLocationLink[] | null> {
    if (!this.manager) return null;
    return this.manager.typeDefinition(p);
  }

  async documentHighlight(p: { uri: string; line: number; character: number }): Promise<LSPDocumentHighlight[]> {
    if (!this.manager) return [];
    return this.manager.documentHighlight(p);
  }

  async signatureHelp(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string; isRetrigger?: boolean }): Promise<LSPSignatureHelp | null> {
    if (!this.manager) return null;
    return this.manager.signatureHelp(p);
  }

  async documentSymbols(uri: string): Promise<LSPDocumentSymbolResult> {
    if (!this.manager) return null;
    return this.manager.documentSymbols(uri);
  }

  async workspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult> {
    if (!this.manager) return null;
    return this.manager.workspaceSymbols(query);
  }

  async codeActions(p: { uri: string; range: LSPRange; diagnostics: LSPDiagnostic[]; only?: string[] }): Promise<LSPCodeActionResult> {
    if (!this.manager) return null;
    return this.manager.codeActions(p);
  }

  async rename(p: { uri: string; line: number; character: number; newName: string }): Promise<LSPWorkspaceEdit | null> {
    if (!this.manager) return null;
    return this.manager.rename(p);
  }

  async prepareCallHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPCallHierarchyItem[]> {
    if (!this.manager) return [];
    return this.manager.prepareCallHierarchy(p);
  }

  async incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]> {
    if (!this.manager) return [];
    return this.manager.incomingCalls(item);
  }

  async outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]> {
    if (!this.manager) return [];
    return this.manager.outgoingCalls(item);
  }

  async prepareTypeHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPTypeHierarchyItem[]> {
    if (!this.manager) return [];
    return this.manager.prepareTypeHierarchy(p);
  }

  async supertypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    if (!this.manager) return [];
    return this.manager.supertypes(item);
  }

  async subtypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    if (!this.manager) return [];
    return this.manager.subtypes(item);
  }

  async codeLens(uri: string): Promise<LSPCodeLens[]> {
    if (!this.manager) return [];
    return this.manager.codeLens(uri);
  }

  async formatting(uri: string, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    if (!this.manager) return [];
    return this.manager.formatting(uri, options);
  }

  async rangeFormatting(uri: string, range: LSPRange, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    if (!this.manager) return [];
    return this.manager.rangeFormatting(uri, range, options);
  }

  async inlayHint(uri: string, range?: LSPRange): Promise<LSPInlayHint[]> {
    if (!this.manager) return [];
    return this.manager.inlayHint(uri, range);
  }

  async buildWorkspace(): Promise<void> {
    if (!this.manager) return;
    await this.manager.buildWorkspace();
  }

  recentLogs() {
    return this.manager?.recentLogs() ?? [];
  }

  protected handleManagerEvent(e: JdtLsEvent): void {
    switch (e.kind) {
      case 'state':
        this.onEventEmitter.fire({ kind: 'state', state: e.state });
        this.client?.onStateEvent(e.state);
        break;
      case 'log':
        this.onEventEmitter.fire({ kind: 'log', log: { level: e.level, line: e.line } });
        // Also mirror to the backend log — when the LS dies during
        // initialize the RPC client may never attach, and without
        // this the child's stderr (the actual failure reason) is
        // lost (KAIRO-RC-WEB-251 debugging).
        this.logger.info(`[JDT LS ${e.level}] ${e.line}`);
        this.client?.onLogEvent(e.level, e.line);
        break;
      case 'diagnostics':
        this.onEventEmitter.fire({ kind: 'diagnostics', diagnostics: e.params });
        this.client?.onDiagnosticsEvent(e.params);
        break;
      case 'initialized':
        this.onEventEmitter.fire({ kind: 'state', state: 'ready' });
        this.client?.onStateEvent('ready');
        break;
      case 'exit':
        this.onEventEmitter.fire({ kind: 'message', message: `JDT LS exited code=${e.code} signal=${e.signal ?? ''}` });
        this.client?.onMessageEvent(`JDT LS exited code=${e.code} signal=${e.signal ?? ''}`);
        break;
      case 'progress':
        this.onEventEmitter.fire({ kind: 'progress', progress: e.params });
        this.client?.onProgressEvent(e.params);
        break;
    }
  }

  // ---- JdtLsBackendService (JSON-RPC surface) -----------------

  async $start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string; jreHome?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const inspect = this.inspect(opts.home, opts.jreHome);
    if (!inspect.ok) {
      return { ok: false, reason: inspect.reason };
    }
    try {
      await this.start(opts);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  async $stop(): Promise<void> {
    return this.stop();
  }

  async $state(): Promise<JdtLsState> {
    return this.state();
  }

  async $inspect(): Promise<{ ok: true; home: string; jre: string; launcherJar: string } | { ok: false; reason: string }> {
    const r = this.inspect();
    if (!r.ok) {
      return r;
    }
    return { ok: true, home: r.dist.home, jre: r.dist.jre, launcherJar: r.dist.launcherJar };
  }

  async $didOpen(p: { uri: string; languageId: string; version: number; text: string }): Promise<void> {
    this.didOpen(p);
  }

  async $didChange(p: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): Promise<void> {
    this.didChange(p);
  }

  async $didClose(uri: string): Promise<void> {
    this.didClose(uri);
  }

  async $completion(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string }): Promise<LSPCompletionList> {
    return this.completion(p);
  }

  async $resolveCompletion(item: LSPCompletionItem): Promise<LSPCompletionItem> {
    return this.resolveCompletion(item);
  }

  async $definition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    return this.definition(p);
  }

  async $implementation(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    return this.implementation(p);
  }

  async $hover(p: { uri: string; line: number; character: number }): Promise<LSPHover | null> {
    return this.hover(p);
  }

  async $references(p: { uri: string; line: number; character: number; includeDeclaration: boolean }): Promise<LSPLocation[]> {
    return this.references(p);
  }

  async $typeDefinition(p: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | LSPLocationLink[] | null> {
    return this.typeDefinition(p);
  }

  async $documentHighlight(p: { uri: string; line: number; character: number }): Promise<LSPDocumentHighlight[]> {
    return this.documentHighlight(p);
  }

  async $signatureHelp(p: { uri: string; line: number; character: number; triggerKind?: 1 | 2 | 3; triggerCharacter?: string; isRetrigger?: boolean }): Promise<LSPSignatureHelp | null> {
    return this.signatureHelp(p);
  }

  async $documentSymbols(uri: string): Promise<LSPDocumentSymbolResult> {
    return this.documentSymbols(uri);
  }

  async $workspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult> {
    return this.workspaceSymbols(query);
  }

  async $codeActions(p: { uri: string; range: LSPRange; diagnostics: LSPDiagnostic[]; only?: string[] }): Promise<LSPCodeActionResult> {
    return this.codeActions(p);
  }

  async $rename(p: { uri: string; line: number; character: number; newName: string }): Promise<LSPWorkspaceEdit | null> {
    return this.rename(p);
  }

  async $classFileContents(uri: string): Promise<string> {
    if (!this.manager) return '';
    return this.manager.classFileContents(uri);
  }

  async $recentLogs(): Promise<{ level: 'stdout' | 'stderr'; line: string; ts: number }[]> {
    return this.recentLogs();
  }

  async $prepareCallHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPCallHierarchyItem[]> {
    return this.prepareCallHierarchy(p);
  }

  async $incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]> {
    return this.incomingCalls(item);
  }

  async $outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]> {
    return this.outgoingCalls(item);
  }

  async $prepareTypeHierarchy(p: { uri: string; line: number; character: number }): Promise<LSPTypeHierarchyItem[]> {
    return this.prepareTypeHierarchy(p);
  }

  async $supertypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    return this.supertypes(item);
  }

  async $subtypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    return this.subtypes(item);
  }

  async $codeLens(uri: string): Promise<LSPCodeLens[]> {
    return this.codeLens(uri);
  }

  async $formatting(uri: string, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    return this.formatting(uri, options);
  }

  async $rangeFormatting(uri: string, range: LSPRange, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    return this.rangeFormatting(uri, range, options);
  }

  async $inlayHint(uri: string, range?: LSPRange): Promise<LSPInlayHint[]> {
    return this.inlayHint(uri, range);
  }

  async $buildWorkspace(_force: boolean): Promise<void> {
    await this.buildWorkspace();
  }

  dispose(): void {
    this.subscription?.dispose();
    this.manager?.dispose();
    this.manager = undefined;
    this.onEventEmitter.dispose();
  }
}
