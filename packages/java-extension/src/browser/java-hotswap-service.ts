/**
 * Java HotSwap Service — P3-ADVDBG-01
 *
 * Listens for Java file save events during debug sessions and
 * performs class hot-swapping:
 *   1. Compiles the changed file via javac (Go Agent)
 *   2. Calls the debug adapter's redefineClasses to hot-swap
 *   3. Shows a notification: "HotSwap: Reloaded ClassName.java"
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
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { Endpoint } from '@kairo/protocol';
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
      // Process the last file in the debounce window (most recent save)
      const lastFile = files[files.length - 1];
      void this.performHotSwap(lastFile);
    }, HOTSWAP_DEBOUNCE_MS);
  }

  /** Perform the actual HotSwap: compile + redefine, with retries. */
  async performHotSwap(filePath: string): Promise<HotSwapHistoryEntry> {
    const fileName = filePath.split('/').pop() || filePath;
    const entry: HotSwapHistoryEntry = {
      id: `hs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

        // Step 2: Redefine the class via the debug adapter
        await this.redefineClass(filePath);

        entry.status = 'success';
        entry.message = `HotSwap: Reloaded ${fileName}`;
        entry.durationMs = Date.now() - startTime;

        this.messages.info(`HotSwap: Reloaded ${fileName}`);
        this.logger.info(`[HotSwap] Successfully hot-swapped ${fileName} (${entry.durationMs}ms, attempt ${attempt})`);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[HotSwap] Attempt ${attempt}/${MAX_HOTSWAP_RETRIES} failed for ${fileName}: ${lastError.message}`);

        if (attempt < MAX_HOTSWAP_RETRIES) {
          // Small delay before retry
          await this.delay(500);
        }
      }
    }

    if (entry.status === 'failed') {
      entry.message = lastError?.message || 'HotSwap failed';
      entry.durationMs = Date.now() - startTime;

      // Provide user-friendly error messages
      let userMessage = `HotSwap failed for ${fileName}`;
      if (lastError) {
        const errMsg = lastError.message;
        if (errMsg.includes('Compilation failed')) {
          userMessage = `HotSwap: Compilation failed for ${fileName}. Check the Problems panel for details.`;
          this.messages.warn(userMessage);
        } else if (errMsg.includes('redefinition failed') || errMsg.includes('redefine')) {
          userMessage = `HotSwap: Cannot reload ${fileName} — class schema has changed. Restart the debug session.`;
          this.messages.warn(userMessage);
        } else if (errMsg.includes('no longer active')) {
          userMessage = `HotSwap: Debug session ended for ${fileName}.`;
          this.messages.info(userMessage);
        } else {
          userMessage = `HotSwap failed for ${fileName}: ${entry.message}`;
          this.messages.warn(userMessage);
        }
      }

      this.logger.error(`[HotSwap] Failed to hot-swap ${fileName} after ${entry.attempts} attempt(s): ${entry.message}`);
    }

    this.addToHistory(entry);
    this.onDidSwapEmitter.fire(entry);
    return entry;
  }

  /** Compile a single Java file via the Go Agent. */
  protected async compileFile(filePath: string): Promise<{
    success: boolean;
    classPath?: string;
    error?: string;
  }> {
    try {
      const result = await this.runtime.request(
        'POST /api/v1/jvm/compile' as Endpoint,
        { file: filePath },
        { noRetry: true },
      ) as unknown as {
        success: boolean;
        classPath?: string;
        error?: string;
      } | undefined;

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

  /** Request the debug adapter to redefine a class. */
  protected async redefineClass(sourcePath: string): Promise<void> {
    try {
      const result = await this.runtime.request(
        'POST /api/v1/jvm/redefine' as Endpoint,
        { sourcePath },
        { noRetry: true },
      ) as unknown as {
        success: boolean;
        error?: string;
      } | undefined;

      if (result?.success !== true) {
        throw new Error(result?.error || 'Class redefinition request failed');
      }
    } catch (error) {
      throw new Error(
        `Class redefinition failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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