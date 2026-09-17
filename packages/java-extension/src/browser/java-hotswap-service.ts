/**
 * Java HotSwap Service — P3-ADVDBG-01 / BD-P1-4
 *
 * Listens for Java file save events during debug sessions and
 * performs class hot-swapping:
 *   1. Compiles the changed file via javac (Go Agent)
 *   2. Prefers DAP sendCustomRequest('redefineClasses') on the
 *      active debug session (no second JDWP attach when DAP owns the port)
 *   3. Falls back to POST /api/v1/jvm/redefine for exclusive JDWP;
 *      never treats unsupported/501 as success
 *
 * Debounces saves (500ms) to avoid rapid consecutive hot-swaps.
 * Tracks hot-swap history (last 20 operations).
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DebugTargetBinding } from '@kairo/protocol';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';

/** A single HotSwap operation record. */
export interface HotSwapHistoryEntry {
  id: string;
  timestamp: number;
  fileName: string;
  status: 'success' | 'failed';
  durationMs: number;
  message?: string;
  attempts?: number;
}

/** Immutable execution context captured at save time (PR05 / F04). */
export interface HotSwapContext {
  readonly id: string;
  readonly session: {
    readonly id: string;
    readonly configuration: any;
    sendCustomRequest(command: string, args?: any): Promise<any>;
    readonly isDisposed?: boolean;
  };
  readonly target: DebugTargetBinding;
  readonly filePath: string;
  readonly version: number;
  readonly serviceGeneration: number;
}

const KAIRO_JAVA_DEBUG_TYPE = 'kairo-java';
const HOTSWAP_DEBOUNCE_MS = 500;
const MAX_HISTORY = 20;
const MAX_HOTSWAP_RETRIES = 3;

/** File extensions that trigger HotSwap. */
const JAVA_EXTENSIONS = ['.java'];

@injectable()
export class JavaHotSwapService implements FrontendApplicationContribution {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(DebugSessionManager) protected readonly sessionManager!: DebugSessionManager;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  @inject(MonacoWorkspace) protected readonly monacoWorkspace!: MonacoWorkspace;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

  protected readonly onDidSwapEmitter = new Emitter<HotSwapHistoryEntry>();
  readonly onDidSwap: Event<HotSwapHistoryEntry> = this.onDidSwapEmitter.event;

  protected history: HotSwapHistoryEntry[] = [];
  protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
  protected pendingFiles = new Set<string>();

  // PR05 (F04, F23): Target serialization queue, monotonic versions, and disposable lifecycle
  protected readonly toDispose = new DisposableCollection();
  protected serviceGeneration = 0;
  protected readonly pendingContexts = new Map<string, HotSwapContext>();
  protected readonly activeTargetQueues = new Map<string, Promise<void>>();
  protected readonly latestSavedVersions = new Map<string, number>();

  get swapHistory(): readonly HotSwapHistoryEntry[] {
    return this.history;
  }

  /**
   * Whether hotswap is enabled via configuration.
   * PR00 Baseline & Risk Mitigation: Defaults to false when unconfigured.
   * Prevents unconfigured saves from performing blind redefinition against
   * the first available server until PR03/PR05 target binding is active.
   */
  get isEnabled(): boolean {
    try {
      const stored = localStorage.getItem('kairo.java.hotswap.enabled');
      if (stored === null) {
        return false; // default: disabled for safety until explicit binding
      }
      return stored === 'true';
    } catch {
      return false;
    }
  }

  set isEnabled(value: boolean) {
    try {
      localStorage.setItem('kairo.java.hotswap.enabled', String(value));
    } catch {
      this.logger.warn('[HotSwap] Failed to persist hotswap enabled setting');
    }
  }

  @postConstruct()
  protected init(): void {
    this.logger.info('[HotSwap] Java HotSwap Service initialized');
  }

  onStart(_app: FrontendApplication): void {
    this.serviceGeneration++;
    // Listen for text document save events via MonacoWorkspace.
    this.toDispose.push(
      this.monacoWorkspace.onDidSaveTextDocument((model: MonacoEditorModel) => {
        const uri = model.uri?.toString();
        if (uri && this.isJavaFile(uri)) {
          this.onJavaFileSaving(uri);
        }
      })
    );
  }

  onStop(): void {
    this.serviceGeneration++;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.pendingFiles.clear();
    this.pendingContexts.clear();
    this.activeTargetQueues.clear();
    this.latestSavedVersions.clear();
    this.toDispose.dispose();
  }

  /** Check if a URI represents a Java source file. */
  protected isJavaFile(uri: string): boolean {
    return JAVA_EXTENSIONS.some(ext => uri.endsWith(ext));
  }

  /** Check if a debug session is currently active and of the correct type. */
  protected hasActiveDebugSession(): boolean {
    const session = this.sessionManager.currentSession;
    if (!session) return false;
    return session.configuration.type === KAIRO_JAVA_DEBUG_TYPE;
  }

  /** Check if a file URI is within the current workspace. */
  protected isInWorkspace(uri: string): boolean {
    try {
      const roots = this.workspaceService.tryGetRoots();
      if (roots.length === 0) {
        // Strict safety baseline (PR02 / F21): No workspace open -> reject
        return false;
      }
      return roots.some(root => {
        const rootUri = root.resource.toString();
        return isUriContained(rootUri, uri);
      });
    } catch {
      this.logger.warn('[HotSwap] Failed to check workspace roots, skipping hotswap');
      return false;
    }
  }

  /**
   * Resolves the project ID for a given file URI based on workspace roots.
   * Uses longest contained prefix match with proper URI normalization.
   */
  resolveProjectIdForFile(uri: string): string | undefined {
    try {
      const roots = this.workspaceService.tryGetRoots();
      if (!roots || roots.length === 0) {
        return undefined;
      }
      let bestRoot: any = undefined;
      let bestLen = -1;
      for (const root of roots) {
        const rootUri = root.resource.toString();
        if (isUriContained(rootUri, uri)) {
          if (rootUri.length > bestLen) {
            bestRoot = root;
            bestLen = rootUri.length;
          }
        }
      }
      if (bestRoot) {
        return bestRoot.projectId || bestRoot.name || bestRoot.resource?.path?.base;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Authoritative target consistency validation:
   * Checks whether the source file project matches the bound debug session project.
   */
  validateTargetConsistency(filePath: string, sessionProjectId: string): boolean {
    if (!sessionProjectId) {
      return false;
    }
    const sourceProjectId = this.resolveProjectIdForFile(filePath);
    if (sourceProjectId && sourceProjectId !== sessionProjectId) {
      this.logger.warn(`[HotSwap] Target consistency mismatch: source file ${filePath} belongs to "${sourceProjectId}", but debug session is bound to "${sessionProjectId}"`);
      return false;
    }
    return true;
  }

  /**
   * Captures an immutable execution context at save time (PR05 / F04 / T15).
   * Fixed target binding prevents cross-target redefinition if the user switches active UI sessions during compilation.
   */
  protected captureContext(filePath: string): HotSwapContext | undefined {
    const session = this.sessionManager.currentSession;
    if (!session || session.configuration.type !== KAIRO_JAVA_DEBUG_TYPE) {
      return undefined;
    }
    const config = session.configuration as any;
    const projectId = config?.projectId || config?.project || '';
    if (!projectId) {
      this.logger.warn('[HotSwap] Current debug session does not specify a projectId');
      return undefined;
    }
    if (!this.validateTargetConsistency(filePath, projectId)) {
      this.logger.warn(`[HotSwap] Target consistency rejected for ${filePath}: file does not belong to session project ${projectId}`);
      return undefined;
    }
    const serverId = config?.serverId;
    const target: DebugTargetBinding = {
      projectId,
      serverId,
      runtimeInstanceId: config?.runtimeInstanceId,
      deploymentGeneration: config?.deploymentGeneration,
      debugSessionId: session.id,
      debugSessionGeneration: config?.debugSessionGeneration || 1,
      requestKind: config?.request,
      ownsDebuggee: config?.ownsDebuggee !== false,
      classLoaderId: config?.classLoaderId,
    };
    const version = (this.latestSavedVersions.get(filePath) || 0) + 1;
    this.latestSavedVersions.set(filePath, version);

    return {
      id: `hs-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`}`,
      session,
      target,
      filePath,
      version,
      serviceGeneration: this.serviceGeneration,
    };
  }

  /** Called when a Java file is about to be saved. */
  protected onJavaFileSaving(uri: string): void {
    if (!this.isEnabled) {
      this.logger.info('[HotSwap] HotSwap is disabled via configuration');
      return;
    }

    if (!this.hasActiveDebugSession()) {
      return;
    }

    if (!this.isInWorkspace(uri)) {
      this.logger.info(`[HotSwap] Skipping hotswap for file outside workspace: ${uri}`);
      return;
    }

    const context = this.captureContext(uri);
    if (!context) {
      return;
    }

    this.pendingFiles.add(uri);
    this.pendingContexts.set(uri, context);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const files = Array.from(this.pendingFiles);
      const contexts = new Map(this.pendingContexts);
      this.pendingFiles.clear();
      this.pendingContexts.clear();
      for (const file of files) {
        const ctx = contexts.get(file);
        if (ctx) {
          void this.enqueueHotSwap(ctx);
        }
      }
    }, HOTSWAP_DEBOUNCE_MS);
  }

  /**
   * Enqueue a HotSwap operation onto the target's serial queue (PR05 / F04 / T15, T16).
   */
  protected enqueueHotSwap(ctx: HotSwapContext): Promise<HotSwapHistoryEntry | undefined> {
    const targetKey = `${ctx.target.projectId}:${ctx.target.serverId || ctx.target.debugSessionId || 'default'}`;
    const prev = this.activeTargetQueues.get(targetKey) || Promise.resolve();
    const next = prev.then(async () => {
      // Check if service was stopped during wait (T19)
      if (this.serviceGeneration !== ctx.serviceGeneration) {
        return undefined;
      }
      // Check if a newer save of the same file has superseded this one (T16)
      const currentLatest = this.latestSavedVersions.get(ctx.filePath);
      if (currentLatest !== undefined && currentLatest > ctx.version) {
        this.logger.info(`[HotSwap] Superseded: skipping obsolete v${ctx.version} of ${ctx.filePath} (current is v${currentLatest})`);
        return undefined;
      }
      return this.performHotSwap(ctx);
    }).catch(err => {
      this.logger.error(`[HotSwap] Target queue execution error for ${ctx.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    });

    this.activeTargetQueues.set(targetKey, next.then(() => {}));
    return next;
  }

  /** Perform the actual HotSwap: compile + redefine, with retries (PR05 / F04, F23). */
  async performHotSwap(input: string | HotSwapContext): Promise<HotSwapHistoryEntry> {
    const ctx: HotSwapContext | undefined = typeof input === 'string' ? this.captureContext(input) : input;
    const filePath = typeof input === 'string' ? input : input.filePath;
    const fileName = filePath.split('/').pop() || filePath;
    const entry: HotSwapHistoryEntry = {
      id: ctx ? ctx.id : `hs-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`}`,
      timestamp: Date.now(),
      fileName,
      status: 'failed',
      durationMs: 0,
      attempts: 0,
    };

    if (!ctx) {
      entry.message = 'No active Java debug session bound for HotSwap';
      return entry;
    }

    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_HOTSWAP_RETRIES; attempt++) {
      entry.attempts = attempt;

      // PR05 (F23 / T19): Check lifecycle state before attempt
      if (this.serviceGeneration !== ctx.serviceGeneration) {
        return entry;
      }

      // PR05 (F04 / T15): Verify the bound debug session is still active.
      // Notice: Do NOT check currentSession because user may have switched active tab to another session.
      // If bound session ended, abort without redirecting to another session!
      if (ctx.session.isDisposed || (this.sessionManager.sessions && this.sessionManager.sessions.every((s: { id: string }) => s.id !== ctx.session.id))) {
        lastError = new Error('Bound debug session is no longer active');
        break;
      }

      // Pre-compile validation: re-verify target consistency and active session
      if (!this.validateTargetConsistency(filePath, ctx.target.projectId)) {
        lastError = new Error(`Target consistency rejected: ${filePath} does not match target project ${ctx.target.projectId}`);
        break;
      }

      try {
        // Step 1: Compile the changed file
        const compileResult = await this.compileFile(filePath, ctx);
        if (!compileResult.success) {
          throw new Error(`Compilation failed: ${compileResult.error || 'unknown error'}`);
        }
        if (compileResult.projectId && ctx.target.projectId && compileResult.projectId !== ctx.target.projectId) {
          throw new Error(`Compilation output project mismatch: compiled for ${compileResult.projectId}, but session bound to ${ctx.target.projectId}`);
        }

        // PR05 (F23 / T19): Check if service stopped while compile was awaiting
        if (this.serviceGeneration !== ctx.serviceGeneration) {
          return entry;
        }

        // PR05 (F04 / T16): Check if a newer version completed compilation while we were compiling
        const currentLatest = this.latestSavedVersions.get(filePath);
        if (currentLatest !== undefined && currentLatest > ctx.version) {
          this.logger.info(`[HotSwap] Skipping redefine for v${ctx.version} of ${fileName}; v${currentLatest} is newer`);
          return entry;
        }

        // Pre-redefine validation: ensure target consistency and bound session validity
        if (ctx.session.isDisposed || (this.sessionManager.sessions && this.sessionManager.sessions.every((s: { id: string }) => s.id !== ctx.session.id))) {
          lastError = new Error('Bound debug session is no longer active');
          break;
        }
        if (!this.validateTargetConsistency(filePath, ctx.target.projectId)) {
          lastError = new Error(`Target consistency check failed before redefine: file project does not match session project ${ctx.target.projectId}`);
          break;
        }

        // Step 2: Redefine via DAP (if attached) or agent JDWP, using bound immutable context
        await this.redefineClassWithContext(ctx, compileResult.classPath);

        entry.status = 'success';
        entry.message = this.i18n.t('widget.java.hotswap.toast.reloaded', { fileName });
        entry.durationMs = Date.now() - startTime;

        this.messages.info(entry.message);
        this.logger.info(`[HotSwap] Successfully hot-swapped ${fileName} (${entry.durationMs}ms, attempt ${attempt})`);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[HotSwap] Attempt ${attempt}/${MAX_HOTSWAP_RETRIES} failed for ${fileName}: ${lastError.message}`);

        // Do not retry permanent capability gaps (501 / unsupported) or compile failures.
        if (this.isNonRetryableHotSwapError(lastError) || attempt >= MAX_HOTSWAP_RETRIES) {
          break;
        }
        await this.delay(500);
      }
    }

    if (this.serviceGeneration !== ctx.serviceGeneration) {
      // Stopped during retry or redefine
      return entry;
    }

    if (entry.status === 'failed') {
      entry.message = lastError?.message || 'HotSwap failed';
      entry.durationMs = Date.now() - startTime;
      this.showHotSwapFailure(fileName, lastError);
      this.logger.error(`[HotSwap] Failed to hot-swap ${fileName} after ${entry.attempts} attempt(s): ${entry.message}`);
    }

    this.addToHistory(entry);
    this.onDidSwapEmitter.fire(entry);
    return entry;
  }

  /** Permanent failures that should not burn retries. */
  protected isNonRetryableHotSwapError(error: Error): boolean {
    if (error instanceof KairoError) {
      if (error.code === 'unsupported' || error.httpStatus === 501) {
        return true;
      }
      if (!error.isTransient()) {
        return true;
      }
    }
    const msg = error.message.toLowerCase();
    return msg.includes('unsupported')
      || msg.includes('not implemented')
      || msg.includes('compilation failed')
      || /\b501\b/.test(msg);
  }

  protected showHotSwapFailure(fileName: string, lastError: Error | undefined): void {
    if (!lastError) {
      this.messages.warn(this.i18n.t('widget.java.hotswap.toast.failed', {
        fileName,
        message: 'HotSwap failed',
      }));
      return;
    }

    const errMsg = lastError.message;
    if (errMsg.includes('Compilation failed')) {
      this.messages.warn(this.i18n.t('widget.java.hotswap.toast.compileFailed', { fileName }));
      return;
    }
    if (this.isUnsupportedRedefineError(lastError)) {
      this.messages.warn(this.i18n.t('widget.java.hotswap.toast.unsupported', {
        message: errMsg,
      }));
      return;
    }
    if (errMsg.includes('redefinition failed') || errMsg.toLowerCase().includes('redefine')) {
      this.messages.warn(this.i18n.t('widget.java.hotswap.toast.redefineFailed', { fileName }));
      return;
    }
    if (errMsg.includes('no longer active')) {
      this.messages.info(this.i18n.t('widget.java.hotswap.toast.sessionEnded', { fileName }));
      return;
    }
    this.messages.warn(this.i18n.t('widget.java.hotswap.toast.failed', {
      fileName,
      message: errMsg,
    }));
  }

  protected isUnsupportedRedefineError(error: Error): boolean {
    if (error instanceof KairoError) {
      return error.code === 'unsupported' || error.httpStatus === 501;
    }
    const msg = error.message.toLowerCase();
    return msg.includes('unsupported') || msg.includes('not implemented') || /\b501\b/.test(msg);
  }

  /** Compile a single Java file via the Go Agent. */
  protected async compileFile(filePath: string, ctx?: HotSwapContext): Promise<{
    success: boolean;
    classPath?: string;
    projectId?: string;
    error?: string;
  }> {
    try {
      const nativePath = filePath.includes('://') ? FileUri.fsPath(filePath) : filePath;
      const result = await this.runtime.request(
        'POST /api/v1/jvm/compile',
        {
          file: nativePath,
          sourceUri: filePath,
          projectId: ctx?.target.projectId,
        },
        { noRetry: true },
      );

      if (result) {
        return result;
      }

      return { success: false, error: 'Compilation service unavailable' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Prefer redefine via the already-attached DAP session (BD-P1-4 / PR05 F07 / T17).
   * Returns true when the adapter accepted redefineClasses.
   * If DAP rejected due to structural changes (hierarchy change / schema change) or
   * owns the connection, prohibited from blind raw JDWP fallback.
   */
  protected async redefineViaDap(ctx: HotSwapContext, sourcePath: string, classPath?: string): Promise<boolean> {
    const session = ctx.session;
    if (!session) {
      return false;
    }
    const nativeSource = sourcePath.includes('://') ? FileUri.fsPath(sourcePath) : sourcePath;
    try {
      await session.sendCustomRequest('redefineClasses', {
        classPaths: classPath ? [classPath] : [],
        sourcePaths: [nativeSource],
      });
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const lower = errMsg.toLowerCase();

      // PR05 (F07 / T17): Class structure changes rejected by DAP must fail cleanly without raw JDWP fallback
      const isSchemaChange =
        lower.includes('hierarchy change') ||
        lower.includes('schema change') ||
        lower.includes('add method') ||
        lower.includes('delete method') ||
        lower.includes('class format') ||
        lower.includes('not permitted');

      if (isSchemaChange) {
        throw new KairoError({
          code: 'unsupported',
          message: `DAP redefinition rejected (class structure change not supported): ${errMsg}`,
        });
      }

      // If DAP owns debuggee connection, dialing raw JDWP causes port collision
      if (ctx.target.ownsDebuggee === true) {
        throw new KairoError({
          code: 'unsupported',
          message: `DAP session owns debuggee connection; JDWP fallback prohibited to prevent port collision: ${errMsg}`,
        });
      }

      this.logger.info(`[HotSwap] DAP redefineClasses unavailable, will try agent JDWP: ${errMsg}`);
      return false;
    }
  }

  /**
   * Redefine via DAP when attached; otherwise exclusive agent JDWP.
   * Never claims success on unsupported/501 agent responses.
   */
  protected async redefineClassWithContext(ctx: HotSwapContext, classPath?: string): Promise<void> {
    if (await this.redefineViaDap(ctx, ctx.filePath, classPath)) {
      return;
    }

    try {
      const nativeSource = ctx.filePath.includes('://') ? FileUri.fsPath(ctx.filePath) : ctx.filePath;
      const result = await this.runtime.request(
        'POST /api/v1/jvm/redefine',
        {
          sourcePath: nativeSource,
          sourceUri: ctx.filePath,
          classPath,
          projectId: ctx.target.projectId,
          serverId: ctx.target.serverId,
          classLoaderId: ctx.target.classLoaderId,
          target: ctx.target,
        },
        { noRetry: true },
      );

      if (result?.success !== true) {
        throw new KairoError({
          code: 'internal',
          message: result?.error || 'Class redefinition request failed',
        });
      }
    } catch (error) {
      // Preserve KairoError so callers can detect unsupported / 501 without retries.
      if (error instanceof KairoError) {
        throw error;
      }
      throw new KairoError({
        code: 'internal',
        message: `Class redefinition failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      });
    }
  }

  protected async redefineClass(sourcePath: string, classPath?: string): Promise<void> {
    const ctx = this.captureContext(sourcePath);
    if (!ctx) {
      throw new KairoError({ code: 'internal', message: 'No active debug context for redefineClass' });
    }
    return this.redefineClassWithContext(ctx, classPath);
  }

  /** Add an entry to the swap history, keeping last MAX_HISTORY entries. */
  protected addToHistory(entry: HotSwapHistoryEntry): void {
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }
  }

  /** Delay helper. */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Checks whether childUri is strictly contained within or equal to parentUri.
 * PR02 / F21: Does NOT use naive string startsWith, preventing sibling
 * collision (e.g. /repo vs /repo-other).
 */
export function isUriContained(parentUri: string, childUri: string): boolean {
  if (!parentUri || !childUri) {
    return false;
  }
  const p = parentUri.replace(/\/+$/, '');
  const c = childUri.replace(/\/+$/, '');
  if (p === c) {
    return true;
  }
  return c.startsWith(p + '/');
}
