// SPDX-License-Identifier: Apache-2.0
//
// JDT-LS process manager — the Theia backend side of the Java
// language client.
//
// Real-world flow (per the JDT LS docs at
// https://github.com/eclipse-jdtls/eclipse.jdt.ls):
//
//   1. Resolve the host JRE (`KAIRO_JDT_LS_JRE` or `java` on
//      PATH) and the JDT LS launcher JAR
//      (`KAIRO_JDT_LS_HOME/plugins/org.eclipse.equinox.launcher_*.jar`).
//   2. Build the classpath: every `*.jar` under
//      `<home>/plugins/*.jar`. JDT LS does NOT bundle its
//      dependencies into one fat jar; the equinox launcher
//      expects the full OSGi bundle set on the classpath.
//   3. Spawn `<jre>/bin/java -jar <equinox-launcher>.jar
//        -configuration <home>/config_*/ -data <workspace>`
//      with stdin/stdout piped. The LSP server speaks
//      `vscode-jsonrpc` over stdin/stdout — same framing
//      VS Code uses.
//   4. Send `initialize` (with the workspace folder URI),
//      wait for `InitializeResult`, send `initialized`, then
//      `textDocument/didOpen`, etc.
//
// We DO NOT call the agent for the launch descriptor in this
// worker because the agent bridge for JDT LS is still on
// the Mac work-stream's plate (CR-001). Instead the manager
// reads `KAIRO_JDT_LS_HOME` and `KAIRO_JDT_LS_JRE` from
// process.env so it works in a packaged desktop build as
// well as in a dev shell.

import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { Readable, Writable } from 'stream';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
  MessageConnection,
} from 'vscode-jsonrpc/node';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import {
  LSPInitializeParams,
  LSPInitializeResult,
  LSPPublishDiagnosticsParams,
  LSPLocation,
  LSPLocationLink,
  LSPCompletionList,
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
  LSPInlayHint,
  LSPTextEdit,
  LSPDocumentHighlight,
} from '../common/lsp-protocol';

/** What the manager knows about the install of JDT LS. */
export interface JdtLsDistribution {
  /** Absolute path to a JRE bin dir (containing `java[.exe]`). */
  jre: string;
  /** Absolute path to the equinox launcher jar. */
  launcherJar: string;
  /** Absolute path to the JDT LS install root. */
  home: string;
  /** Config to pass to `-configuration`, if any. */
  configDir?: string;
  /** All the plugin jars (used for `-classpath`). */
  pluginJars: string[];
}

/** Public reasons the manager might fail to start. */
export type JdtLsStartError =
  | { kind: 'env'; message: string }
  | { kind: 'spawn'; message: string };

/** Lifecycle events the manager emits to its owner. */
export type JdtLsEvent =
  | { kind: 'state'; state: JdtLsState }
  | { kind: 'log'; level: 'stdout' | 'stderr'; line: string }
  | { kind: 'diagnostics'; params: LSPPublishDiagnosticsParams }
  | { kind: 'initialized'; result: LSPInitializeResult }
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'progress'; params: LSPProgressParams };

export type JdtLsState =
  | 'uninitialized'
  | 'starting'
  | 'initializing'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'failed';

export type JdtLsEventListener = (event: JdtLsEvent) => void;

export const JDT_LS_INITIALIZE_TIMEOUT_MS = 60_000;
export const JDT_LS_REQUEST_TIMEOUT_MS = 30_000;

export class JdtLsRequestTimeoutError extends Error {
  readonly code = 'JDT_LS_REQUEST_TIMEOUT';

  constructor(readonly method: string, readonly timeoutMs: number) {
    super(`JDT LS request ${method} timed out after ${timeoutMs}ms`);
    this.name = 'JdtLsRequestTimeoutError';
  }
}

/**
 * Manager for a single JDT LS child process. The manager
 * owns the process and the vscode-jsonrpc MessageConnection
 * bound to it. It exposes a small typed API (initialize,
 * didOpen, completion, definition) that the browser-side
 * LanguageClient drives.
 */
export class JdtLsManager implements Disposable {
  protected process: ChildProcess | undefined;
  protected connection: MessageConnection | undefined;
  protected state: JdtLsState = 'uninitialized';
  protected listeners = new Set<JdtLsEventListener>();
  /** Bounded ring buffer of recent log lines, useful for the
   *  status bar's "Show Logs" affordance. */
  protected readonly logRing: { level: 'stdout' | 'stderr'; line: string; ts: number }[] = [];
  protected readonly logRingCap = 500;
  /** Guard so we never fire 'exit' after 'disposed'. */
  protected disposed = false;
  /** Pending initialize request, so we can resolve it when the
   *  InitializeResult arrives. */
  protected initializeResolver: ((result: LSPInitializeResult) => void) | undefined;
  protected initializeRejecter: ((err: Error) => void) | undefined;
  protected stopPromise: Promise<void> | undefined;

  constructor(protected readonly logger?: ILogger) {}

  state$(): JdtLsState {
    return this.state;
  }

  onEvent(fn: JdtLsEventListener): Disposable {
    this.listeners.add(fn);
    return { dispose: () => this.listeners.delete(fn) };
  }

  /** Get a snapshot of recent log lines (most recent last). */
  recentLogs(): { level: 'stdout' | 'stderr'; line: string; ts: number }[] {
    return [...this.logRing];
  }

  /**
   * Resolve the JDT LS install. We accept the install root as
   * either an env var, a constructor argument, or a value
   * baked into the launch descriptor returned by the agent.
   */
  static resolveDistribution(opts: { home?: string; jreHome?: string }): JdtLsDistribution | JdtLsStartError {
    const home = opts.home ?? process.env.KAIRO_JDT_LS_HOME;
    if (!home) {
      return {
        kind: 'env',
        message:
          'JDT LS home not set. Set KAIRO_JDT_LS_HOME to the eclipse-jdt-ls install root (the directory that contains `plugins/`, `config_linux/`, etc.) and restart the IDE.',
      };
    }
    const homeAbs = resolve(home);
    if (!existsSync(homeAbs)) {
      let diag = '';
      try {
        statSync(homeAbs);
      } catch (e) {
        const proc = typeof process !== 'undefined' ? `pid=${process.pid}, cwd=${process.cwd()}` : 'no-process';
        diag = ` (stat error: ${(e as NodeJS.ErrnoException).code}, ${proc}, home=${JSON.stringify(home)})`;
      }
      return {
        kind: 'env',
        message: `KAIRO_JDT_LS_HOME points to a path that does not exist: ${homeAbs}${diag}`,
      };
    }
    const pluginsDir = join(homeAbs, 'plugins');
    if (!existsSync(pluginsDir) || !statSync(pluginsDir).isDirectory()) {
      return {
        kind: 'env',
        message: `JDT LS home is missing a plugins/ directory: ${homeAbs}`,
      };
    }

    // Find the equinox launcher jar. The name pattern is
    // `org.eclipse.equinox.launcher_<version>.jar` and there
    // is normally exactly one. Native FRAGMENT jars also match
    // a naive /equinox.launcher/ test (e.g.
    // `org.eclipse.equinox.launcher.cocoa.macosx.aarch64_*.jar`)
    // and readdir order can return them first — spawning with
    // one makes the JVM die with "no main manifest attribute"
    // (KAIRO-RC-WEB-251, captured from the child's stderr).
    const plugins = readdirSync(pluginsDir)
      .filter(n => n.endsWith('.jar'))
      .map(n => join(pluginsDir, n));
    const launcherJar = plugins.find(p => /equinox\.launcher_\d/.test(p));
    if (!launcherJar) {
      return {
        kind: 'env',
        message:
          'JDT LS install is missing the Equinox launcher jar (org.eclipse.equinox.launcher_*.jar). Re-download eclipse-jdt-ls.',
      };
    }

    // Find a configuration dir. The distribution ships one
    // per platform (config_linux, config_mac, config_win);
    // we pick the best match.
    const configDir = pickConfigDir(homeAbs);

    // Resolve a JRE. We prefer the explicit override, then
    // JAVA_HOME, then `java` on PATH.
    const jre = opts.jreHome ?? process.env.KAIRO_JDT_LS_JRE ?? process.env.JAVA_HOME;
    if (!jre) {
      return {
        kind: 'env',
        message:
          'JDT LS needs a JRE. Set KAIRO_JDT_LS_JRE or JAVA_HOME to a JDK 17 install (host JRE; the project source level stays on its configured level).',
      };
    }
    const jreAbs = resolve(jre);
    if (!existsSync(jreAbs)) {
      return {
        kind: 'env',
        message: `JRE path does not exist: ${jreAbs}`,
      };
    }
    const javaBin = process.platform === 'win32' ? join(jreAbs, 'bin', 'java.exe') : join(jreAbs, 'bin', 'java');
    if (!existsSync(javaBin)) {
      return {
        kind: 'env',
        message: `JRE at ${jreAbs} does not contain a java executable (${javaBin}).`,
      };
    }

    return {
      jre: javaBin,
      launcherJar,
      home: homeAbs,
      configDir,
      pluginJars: plugins,
    };
  }

  /**
   * Spawn the JDT LS process. Throws if the install cannot
   * be resolved; the caller should catch and report the
   * `{ kind, message }` error to the UI.
   */
  async start(opts: { rootUri: string; workspaceDataDir: string; sourceLevel?: string; home?: string }): Promise<void> {
    if (this.state === 'starting' || this.state === 'initializing' || this.state === 'ready' || this.state === 'stopping' || this.stopPromise) {
      throw new Error(`JDT LS already in state ${this.state}`);
    }
    // opts.home (derived from the Go agent's launch descriptor)
    // wins over the KAIRO_JDT_LS_HOME env fallback inside
    // resolveDistribution.
    const dist = JdtLsManager.resolveDistribution({ home: opts.home });
    if ('kind' in dist) {
      this.setState('failed');
      throw new Error(dist.message);
    }
    this.setState('starting');

    // The Equinox launcher takes:
    //   -data <workspaceDataDir>          workspace storage
    //   -configuration <configDir>         OSGi bundles
    // and we put every plugin jar on -classpath so the
    // launcher can find them.
    const args: string[] = [
      '-classpath',
      dist.pluginJars.join(process.platform === 'win32' ? ';' : ':'),
      '-Xms50m',
      '-Xmx1024m',
      '-Declipse.application=org.eclipse.jdt.ls.core.id1',
      '-Dosgi.bundles.defaultStartLevel=4',
      '-Declipse.product=org.eclipse.jdt.ls.core.product',
      '-Dlog.level=INFO',
      '-Dfile.encoding=UTF-8',
      '-noverify',
      '-Xss2m',
      '--add-modules=ALL-SYSTEM',
      '--add-opens=java.base/java.util=ALL-UNNAMED',
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.io=ALL-UNNAMED',
      '--add-opens=java.base/java.nio=ALL-UNNAMED',
      '-jar',
      dist.launcherJar,
    ];
    if (dist.configDir) {
      args.push('-configuration', dist.configDir);
    }
    args.push('-data', opts.workspaceDataDir);

    const spawnOpts: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        // JDT LS prints a banner; we capture stdout/stderr
        // ourselves and never want it to use a console
        // window on Windows.
        JAVA_TOOL_OPTIONS: '',
        // Project source level — many JDT LS behaviours
        // (compliance, forbidden references, etc.) key off
        // this. We forward it so a Java 6 project gets a
        // Java 6 compile graph.
        ...(opts.sourceLevel ? { '_JAVA_OPTIONS': `-Dsource.level=${opts.sourceLevel}` } : {}),
      },
    };

    this.logger?.info(`[JDT LS] spawning: ${dist.jre} ${args.slice(0, 6).join(' ')} … (${args.length} args total)`);
    const child = spawn(dist.jre, args, spawnOpts);
    this.process = child;

    // Wire up stdout/stderr line buffering. JDT LS writes
    // its log output to stderr; the LSP frames go to
    // stdout. We must NOT collapse stderr to a single
    // data event because the line order matters.
    this.attachStreamLogging(child.stdout, 'stdout');
    this.attachStreamLogging(child.stderr, 'stderr');

    child.on('error', (err: Error) => {
      this.logger?.error(`[JDT LS] process error: ${err.message}`);
      this.fire({ kind: 'log', level: 'stderr', line: `[spawn-error] ${err.message}` });
      if (this.process === child) this.cleanup('crashed');
    });
    child.on('exit', (code, signal) => {
      this.logger?.info(`[JDT LS] exit code=${code} signal=${signal ?? ''}`);
      this.fire({ kind: 'log', level: 'stdout', line: `[exit] code=${code} signal=${signal ?? ''}` });
      this.fire({ kind: 'exit', code, signal });
      // An old child may exit after a bounded stop has already
      // allowed a replacement to start. Never let that stale exit
      // dispose the replacement connection or mark it crashed.
      if (this.process === child) {
        this.cleanup(this.state === 'stopping' ? 'stopped' : 'crashed');
      }
    });

    // Build the vscode-jsonrpc MessageConnection. We give it
    // the child stdout reader and stdin writer directly so
    // the framing is fully handled by the library.
    const reader = new StreamMessageReader(child.stdout as Readable);
    const writer = new StreamMessageWriter(child.stdin as Writable);
    this.connection = createMessageConnection(reader, writer, this.makeLogger());

    // Surface publishDiagnostics to the event bus so the
    // browser-side provider can render squiggles.
    this.connection.onNotification('textDocument/publishDiagnostics', (params: LSPPublishDiagnosticsParams) => {
      this.fire({ kind: 'diagnostics', params });
    });

    this.connection.onRequest('window/workDoneProgress/create', () => null);
    this.connection.onRequest('client/registerCapability', () => null);
    this.connection.onRequest('client/unregisterCapability', () => null);
    this.connection.onNotification('$/progress', (params: LSPProgressParams) => {
      this.fire({ kind: 'progress', params });
    });

    this.connection.listen();

    this.setState('initializing');
    try {
      const initParams: LSPInitializeParams = {
        processId: process.pid,
        clientInfo: { name: 'kairo-ide', version: '0.1.0' },
        locale: 'en',
        rootUri: opts.rootUri,
        capabilities: {
          workspace: {
            applyEdit: true,
            configuration: true,
            didChangeConfiguration: { dynamicRegistration: true },
            didChangeWatchedFiles: { dynamicRegistration: true },
            executeCommand: { dynamicRegistration: true },
            workspaceEdit: { documentChanges: true },
            workspaceFolders: true,
            symbol: { dynamicRegistration: true },
          },
          textDocument: {
            synchronization: { dynamicRegistration: true, willSave: true, didSave: true },
            completion: {
              dynamicRegistration: true,
              completionItem: {
                snippetSupport: false,
                commitCharactersSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                deprecatedSupport: true,
              },
              contextSupport: true,
            },
            hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: { dynamicRegistration: true },
            definition: { dynamicRegistration: true, linkSupport: true },
            typeDefinition: { dynamicRegistration: true, linkSupport: true },
            implementation: { dynamicRegistration: true, linkSupport: true },
            references: { dynamicRegistration: true },
            documentHighlight: { dynamicRegistration: true },
            documentSymbol: { dynamicRegistration: true, symbolKind: { valueSet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26] } },
            codeAction: { dynamicRegistration: true },
            rename: { dynamicRegistration: true, prepareSupport: false },
            formatting: { dynamicRegistration: true },
            rangeFormatting: { dynamicRegistration: true },
            callHierarchy: { dynamicRegistration: true },
            typeHierarchy: { dynamicRegistration: true },
            inlayHint: { dynamicRegistration: true },
            publishDiagnostics: { relatedInformation: true, versionSupport: false, codeDescriptionSupport: true },
          },
          window: { showMessage: { dynamicRegistration: true } },
        },
        initializationOptions: {
          extendedClientCapabilities: {
            progressReportProvider: true,
            classFileContentsSupport: true,
            overrideMethodsPromptSupport: true,
            hashCodeEqualsPromptSupport: true,
            advancedOrganizeImportsSupport: true,
            generateToStringPromptSupport: true,
            advancedGenerateAccessorsSupport: true,
            generateConstructorsPromptSupport: true,
            generateDelegateMethodsPromptSupport: true,
          },
          settings: {
            java: {
              completion: { enabled: true, guessMethodArguments: true },
              import: { enabled: true },
              format: { enabled: true },
              references: { includeDecompiledSources: true },
              signatureHelp: { enabled: true },
              implementationsCodeLens: { enabled: true },
              configuration: {
                checkProjectSettingsExclusions: false,
                updateBuildConfiguration: 'interactive',
              },
              // KAIRO-PERF: trace disabled in production to reduce excessive
              // JDT LS logging. Set KAIRO_JDT_TRACE=verbose to re-enable
              // for debugging language server issues.
              trace: { server: process.env.KAIRO_JDT_TRACE === 'verbose' ? 'verbose' : 'off' },
            },
          },
        },
        trace: process.env.KAIRO_JDT_TRACE === 'verbose' ? 'verbose' : 'off',
      };

      const result = await this.initializeConnection(initParams, child);
      // Acknowledge — the LSP spec requires a `initialized`
      // notification before any other request.
      this.connection.sendNotification('initialized', {});
      this.setState('ready');
      this.fire({ kind: 'initialized', result });
      this.logger?.info(`[JDT LS] ready: ${result.serverInfo?.name ?? 'unknown'} ${result.serverInfo?.version ?? ''}`);
    } catch (err) {
      this.logger?.error(`[JDT LS] initialize failed: ${String(err)}`);
      // An explicit stop may interrupt initialize. Preserve stopped /
      // stopping so the lifecycle does not misclassify user shutdown
      // as a crash and schedule recovery.
      const currentState = this.state$();
      if (currentState !== 'stopping' && currentState !== 'stopped') {
        this.cleanup('failed');
      }
      throw err;
    }
  }

  /** Send `textDocument/didOpen` for a new file. */
  didOpen(params: { uri: string; languageId: string; version: number; text: string }): void {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    this.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: params.uri,
        languageId: params.languageId,
        version: params.version,
        text: params.text,
      },
    });
  }

  didChange(params: { uri: string; version: number; changes: { text: string; rangeLength?: number }[] }): void {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    this.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: params.uri, version: params.version },
      contentChanges: params.changes,
    });
  }

  didClose(uri: string): void {
    if (!this.connection || this.state !== 'ready') {
      return;
    }
    this.connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
  }

  /** Drive the LSP `textDocument/completion` request. */
  async completion(params: {
    uri: string;
    line: number;
    character: number;
    triggerKind?: 1 | 2 | 3;
    triggerCharacter?: string;
  }): Promise<LSPCompletionList> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const list = await this.sendRequestWithTimeout<LSPCompletionList>('textDocument/completion', {
      textDocument: { uri: params.uri },
      position: { line: params.line, character: params.character },
      context: { triggerKind: params.triggerKind ?? 1, triggerCharacter: params.triggerCharacter },
    });
    this.logger?.info(`[JDT LS] completion result items=${list?.items?.length ?? -1} uri=${params.uri} pos=${params.line}:${params.character}`);
    return list;
  }

  /** Drive the LSP `textDocument/definition` request. */
  async definition(params: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPLocation | LSPLocation[] | null>(
      'textDocument/definition',
      {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      },
    );
    this.logger?.info(`[JDT LS] definition result=${JSON.stringify(result)?.slice(0, 200) ?? 'null'} uri=${params.uri} pos=${params.line}:${params.character}`);
    return result;
  }

  async implementation(params: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | null> {
    return this.sendTextDocumentPositionRequest<LSPLocation | LSPLocation[] | null>(
      'textDocument/implementation', params,
    );
  }

  async hover(params: { uri: string; line: number; character: number }): Promise<LSPHover | null> {
    return this.sendTextDocumentPositionRequest<LSPHover | null>('textDocument/hover', params);
  }

  async references(params: { uri: string; line: number; character: number; includeDeclaration: boolean }): Promise<LSPLocation[]> {
    const result = await this.sendTextDocumentPositionRequest<LSPLocation[]>('textDocument/references', params, {
      context: { includeDeclaration: params.includeDeclaration },
    });
    return result ?? [];
  }

  async typeDefinition(params: { uri: string; line: number; character: number }): Promise<LSPLocation | LSPLocation[] | LSPLocationLink[] | null> {
    return this.sendTextDocumentPositionRequest<LSPLocation | LSPLocation[] | LSPLocationLink[] | null>(
      'textDocument/typeDefinition', params,
    );
  }

  async documentHighlight(params: { uri: string; line: number; character: number }): Promise<LSPDocumentHighlight[]> {
    const result = await this.sendTextDocumentPositionRequest<LSPDocumentHighlight[]>('textDocument/documentHighlight', params);
    return result ?? [];
  }

  async signatureHelp(params: {
    uri: string;
    line: number;
    character: number;
    triggerKind?: 1 | 2 | 3;
    triggerCharacter?: string;
    isRetrigger?: boolean;
  }): Promise<LSPSignatureHelp | null> {
    return this.sendTextDocumentPositionRequest<LSPSignatureHelp | null>('textDocument/signatureHelp', params, {
      context: {
        triggerKind: params.triggerKind ?? 1,
        triggerCharacter: params.triggerCharacter,
        isRetrigger: params.isRetrigger ?? false,
      },
    });
  }

  async documentSymbols(uri: string): Promise<LSPDocumentSymbolResult> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    return this.sendRequestWithTimeout<LSPDocumentSymbolResult>('textDocument/documentSymbol', {
      textDocument: { uri },
    });
  }

  async workspaceSymbols(query: string): Promise<LSPWorkspaceSymbolResult> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    return this.sendRequestWithTimeout<LSPWorkspaceSymbolResult>('workspace/symbol', { query });
  }

  async codeActions(params: {
    uri: string;
    range: LSPRange;
    diagnostics: LSPDiagnostic[];
    only?: string[];
  }): Promise<LSPCodeActionResult> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    return this.sendRequestWithTimeout<LSPCodeActionResult>('textDocument/codeAction', {
      textDocument: { uri: params.uri },
      range: params.range,
      context: { diagnostics: params.diagnostics, only: params.only },
    });
  }

  async rename(params: { uri: string; line: number; character: number; newName: string }): Promise<LSPWorkspaceEdit | null> {
    return this.sendTextDocumentPositionRequest<LSPWorkspaceEdit | null>('textDocument/rename', params, {
      newName: params.newName,
    });
  }

  async codeLens(uri: string): Promise<LSPCodeLens[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPCodeLens[]>('textDocument/codeLens', {
      textDocument: { uri },
    });
    return result ?? [];
  }

  async formatting(uri: string, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPTextEdit[]>('textDocument/formatting', {
      textDocument: { uri },
      options: { tabSize: options?.tabSize ?? 4, insertSpaces: options?.insertSpaces ?? true },
    });
    return result ?? [];
  }

  async rangeFormatting(uri: string, range: LSPRange, options?: { tabSize?: number; insertSpaces?: boolean }): Promise<LSPTextEdit[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPTextEdit[]>('textDocument/rangeFormatting', {
      textDocument: { uri },
      range,
      options: { tabSize: options?.tabSize ?? 4, insertSpaces: options?.insertSpaces ?? true },
    });
    return result ?? [];
  }

  async inlayHint(uri: string, range?: LSPRange): Promise<LSPInlayHint[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPInlayHint[]>('textDocument/inlayHint', {
      textDocument: { uri },
      range,
    });
    return result ?? [];
  }

  /** Force workspace reindex (clear cache and rebuild). */
  async buildWorkspace(): Promise<void> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    await this.sendRequestWithTimeout<unknown>('java/buildWorkspace', true);
  }

  protected async sendTextDocumentPositionRequest<T>(
    method: string,
    params: { uri: string; line: number; character: number },
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    return this.sendRequestWithTimeout<T>(method, {
      textDocument: { uri: params.uri },
      position: { line: params.line, character: params.character },
      ...extra,
    });
  }

  /**
   * Fetch the contents of a class file (JDT LS extension
   * request `java/classFileContents`) — this is what makes
   * go-to-definition into library jars viewable: the LS
   * returns jdt:// URIs, and this fetches their (decompiled
   * or source-attached) text.
   */
  async classFileContents(uri: string): Promise<string> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<string>('java/classFileContents', { uri });
    return typeof result === 'string' ? result : '';
  }

  /** Call Hierarchy */

  async prepareCallHierarchy(params: { uri: string; line: number; character: number }): Promise<LSPCallHierarchyItem[]> {
    const result = await this.sendTextDocumentPositionRequest<LSPCallHierarchyItem[]>('textDocument/prepareCallHierarchy', params);
    return result ?? [];
  }

  async incomingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyIncomingCall[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPCallHierarchyIncomingCall[]>('callHierarchy/incomingCalls', { item });
    return result ?? [];
  }

  async outgoingCalls(item: LSPCallHierarchyItem): Promise<LSPCallHierarchyOutgoingCall[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPCallHierarchyOutgoingCall[]>('callHierarchy/outgoingCalls', { item });
    return result ?? [];
  }

  /** Type Hierarchy */

  async prepareTypeHierarchy(params: { uri: string; line: number; character: number }): Promise<LSPTypeHierarchyItem[]> {
    const result = await this.sendTextDocumentPositionRequest<LSPTypeHierarchyItem[]>('textDocument/prepareTypeHierarchy', params);
    return result ?? [];
  }

  async supertypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPTypeHierarchyItem[]>('typeHierarchy/supertypes', { item });
    return result ?? [];
  }

  async subtypes(item: LSPTypeHierarchyItem): Promise<LSPTypeHierarchyItem[]> {
    if (!this.connection || this.state !== 'ready') {
      throw new Error(`JDT LS not ready (state=${this.state})`);
    }
    const result = await this.sendRequestWithTimeout<LSPTypeHierarchyItem[]>('typeHierarchy/subtypes', { item });
    return result ?? [];
  }

  /** Stop the process; the `stopped` state fires when the child
   *  actually exits. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === 'stopped' || this.state === 'uninitialized') {
      return Promise.resolve();
    }
    const pending = this.doStop();
    const shared = pending.finally(() => {
      if (this.stopPromise === shared) this.stopPromise = undefined;
    });
    this.stopPromise = shared;
    return shared;
  }

  protected async doStop(): Promise<void> {
    if (!this.process) {
      this.connection?.dispose();
      this.connection = undefined;
      this.setState('stopped');
      return;
    }
    this.setState('stopping');
    const child = this.process;
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    // give it 3s to die, then SIGKILL
    await new Promise<void>(resolve => {
      let killWait: ReturnType<typeof setTimeout> | undefined;
      const t = setTimeout(() => {
        // ChildProcess.killed only means a signal was sent, not
        // that the child exited. Always escalate if this exact
        // process is still owned after the grace period.
        if (this.process === child) {
          child.kill('SIGKILL');
        }
        killWait = setTimeout(() => {
          // SIGKILL should exit promptly, but the lifecycle must
          // remain bounded even for a broken ChildProcess shim.
          // Stale child events are identity-guarded in start().
          if (this.process === child) this.cleanup('stopped');
          resolve();
        }, this.stopKillWaitMs());
      }, this.stopGracePeriodMs());
      child.once('exit', () => {
        clearTimeout(t);
        if (killWait) clearTimeout(killWait);
        resolve();
      });
    });
  }

  protected stopGracePeriodMs(): number {
    return 3_000;
  }

  protected stopKillWaitMs(): number {
    return 1_000;
  }

  protected initializeTimeoutMs(): number {
    return JDT_LS_INITIALIZE_TIMEOUT_MS;
  }

  protected requestTimeoutMs(): number {
    return JDT_LS_REQUEST_TIMEOUT_MS;
  }

  protected initializeConnection(params: LSPInitializeParams, child: ChildProcess): Promise<LSPInitializeResult> {
    return this.sendRequestWithTimeout<LSPInitializeResult>('initialize', params, {
      timeoutMs: this.initializeTimeoutMs(),
      timeoutState: 'failed',
      onTimeout: () => child.kill('SIGKILL'),
    });
  }

  protected sendRequestWithTimeout<T>(
    method: string,
    params: unknown,
    options: { timeoutMs?: number; timeoutState?: JdtLsState; onTimeout?: () => void } = {},
  ): Promise<T> {
    const connection = this.connection;
    if (!connection) return Promise.reject(new Error(`JDT LS connection unavailable for ${method}`));
    const child = this.process;
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs();
    const request = connection.sendRequest<T>(method, params);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new JdtLsRequestTimeoutError(method, timeoutMs);
        this.appendLog('stderr', `[timeout] ${error.message}`);
        try {
          if (options.onTimeout) options.onTimeout();
          else if (child && this.process === child) child.kill('SIGKILL');
        } catch (err) {
          this.appendLog('stderr', `[timeout-cleanup] ${String(err)}`);
        }
        if (this.connection === connection) this.cleanup(options.timeoutState ?? 'crashed');
        reject(error);
      }, timeoutMs);
      request.then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Keep the child identity until the bounded stop completes;
    // clearing it immediately would suppress SIGKILL escalation
    // and could leak a process that ignores SIGTERM.
    void this.stop().catch(() => undefined).finally(() => {
      this.connection?.dispose();
      this.connection = undefined;
      this.process = undefined;
    });
    this.listeners.clear();
  }

  /** Internal: append a log line to the ring + fire event. */
  protected appendLog(level: 'stdout' | 'stderr', line: string): void {
    const entry = { level, line, ts: Date.now() };
    this.logRing.push(entry);
    if (this.logRing.length > this.logRingCap) {
      this.logRing.splice(0, this.logRing.length - this.logRingCap);
    }
    this.fire({ kind: 'log', level, line });
  }

  /** Internal: attach line-buffered logging to a stream. */
  protected attachStreamLogging(stream: NodeJS.ReadableStream | null, level: 'stdout' | 'stderr'): void {
    if (!stream) return;
    let pending = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      pending += chunk;
      const idx = pending.lastIndexOf('\n');
      if (idx >= 0) {
        const lines = pending.slice(0, idx);
        pending = pending.slice(idx + 1);
        for (const line of lines.split('\n')) {
          if (line.length > 0) {
            this.appendLog(level, line);
          }
        }
      }
    });
    stream.on('end', () => {
      if (pending.length > 0) {
        this.appendLog(level, pending);
        pending = '';
      }
    });
  }

  protected makeLogger() {
    return {
      error: (m: string) => this.logger?.error(`[JDT LS rpc] ${m}`),
      warn: (m: string) => this.logger?.warn(`[JDT LS rpc] ${m}`),
      info: (m: string) => this.logger?.info(`[JDT LS rpc] ${m}`),
      log: (m: string) => this.logger?.debug?.(`[JDT LS rpc] ${m}`) ?? this.logger?.info(`[JDT LS rpc] ${m}`),
    };
  }

  protected setState(state: JdtLsState): void {
    if (this.state === state) return;
    this.state = state;
    this.fire({ kind: 'state', state });
  }

  protected fire(event: JdtLsEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        this.logger?.error(`[JDT LS] listener threw: ${String(err)}`);
      }
    }
  }

  protected cleanup(toState: JdtLsState): void {
    if (this.disposed) return;
    this.connection?.dispose();
    this.connection = undefined;
    this.process = undefined;
    this.setState(toState);
  }
}

/** Pick the best config dir for this OS. JDT LS ships
 *  `config_linux`, `config_mac`, `config_win` and a generic
 *  `config` directory. */
function pickConfigDir(home: string): string | undefined {
  // JDT LS ships per-arch configs (config_mac, config_mac_arm,
  // config_linux, config_linux_arm). Picking the x86 config on an
  // arm64 host makes the Equinox launcher exit code=1 immediately
  // (KAIRO-RC-WEB-251, reproduced live: config_mac_arm starts fine).
  const os =
    process.platform === 'win32'
      ? 'config_win'
      : process.platform === 'darwin'
        ? 'config_mac'
        : 'config_linux';
  const candidates = process.arch === 'arm64' && os !== 'config_win'
    ? [join(home, `${os}_arm`), join(home, os), join(home, 'config')]
    : [join(home, os), join(home, 'config')];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

// Re-export for unit tests.
export { encodeLspMessage, LSPMessageParser } from '../common/lsp-protocol';
