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
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
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

  get swapHistory(): readonly HotSwapHistoryEntry[] {
    return this.history;
  }

  /** Whether hotswap is enabled via configuration. */
  get isEnabled(): boolean {
    try {
      const stored = localStorage.getItem('kairo.java.hotswap.enabled');
      if (stored === null) {
        return true; // default: enabled
      }
      return stored !== 'false';
    } catch {
      return true;
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
    // Listen for text document save events via MonacoWorkspace.
    this.monacoWorkspace.onDidSaveTextDocument((model: MonacoEditorModel) => {
      const uri = model.uri?.toString();
      if (uri && this.isJavaFile(uri)) {
        this.onJavaFileSaving(uri);
      }
    });
  }

  onStop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.pendingFiles.clear();
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
        // No workspace open — allow hotswap anyway
        return true;
      }
      return roots.some(root => {
        const rootUri = root.resource.toString();
        return uri.startsWith(rootUri);
      });
    } catch {
      this.logger.warn('[HotSwap] Failed to check workspace roots, allowing hotswap');
      return true;
    }
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

    this.pendingFiles.add(uri);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const files = Array.from(this.pendingFiles);
      this.pendingFiles.clear();
      // Hot-swap every file saved in the debounce window (Save All).
      for (const file of files) {
        void this.performHotSwap(file);
      }
    }, HOTSWAP_DEBOUNCE_MS);
  }

  /** Perform the actual HotSwap: compile + redefine, with retries. */
  async performHotSwap(filePath: string): Promise<HotSwapHistoryEntry> {
    const fileName = filePath.split('/').pop() || filePath;
    const entry: HotSwapHistoryEntry = {
      id: `hs-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`}`,
      timestamp: Date.now(),
      fileName,
      status: 'failed',
      durationMs: 0,
      attempts: 0,
    };

    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_HOTSWAP_RETRIES; attempt++) {
      entry.attempts = attempt;

      // Re-verify debug session is still active before each attempt
      if (!this.hasActiveDebugSession()) {
        lastError = new Error('Debug session is no longer active');
        break;
      }

      try {
        // Step 1: Compile the changed file
        const compileResult = await this.compileFile(filePath);
        if (!compileResult.success) {
          throw new Error(`Compilation failed: ${compileResult.error || 'unknown error'}`);
        }

        // Step 2: Redefine via agent JDWP (exclusive listener) or fail honestly
        await this.redefineClass(filePath, compileResult.classPath);

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
  protected async compileFile(filePath: string): Promise<{
    success: boolean;
    classPath?: string;
    error?: string;
  }> {
    try {
      const result = await this.runtime.request(
        'POST /api/v1/jvm/compile',
        { file: filePath },
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
   * Prefer redefine via the already-attached DAP session (BD-P1-4).
   * Returns true when the adapter accepted redefineClasses.
   */
  protected async redefineViaDap(sourcePath: string, classPath?: string): Promise<boolean> {
    const session = this.sessionManager.currentSession;
    if (!session || session.configuration.type !== KAIRO_JAVA_DEBUG_TYPE) {
      return false;
    }
    try {
      await session.sendCustomRequest('redefineClasses', {
        classPaths: classPath ? [classPath] : [],
        sourcePaths: [sourcePath],
      });
      return true;
    } catch (err) {
      this.logger.info(
        `[HotSwap] DAP redefineClasses unavailable, will try agent JDWP: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Redefine via DAP when attached; otherwise exclusive agent JDWP.
   * Never claims success on unsupported/501 agent responses.
   */
  protected async redefineClass(sourcePath: string, classPath?: string): Promise<void> {
    if (await this.redefineViaDap(sourcePath, classPath)) {
      return;
    }

    try {
      const result = await this.runtime.request(
        'POST /api/v1/jvm/redefine',
        { sourcePath, classPath },
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
