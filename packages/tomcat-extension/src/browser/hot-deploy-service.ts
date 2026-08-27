/**
 * HotDeployService — IDEA-style intelligent hot deployment.
 *
 * Listens for file save events and triggers the appropriate
 * update strategy based on file type:
 *
 *   - JSP/HTML/CSS/JS/XML/properties: no action needed —
 *     Tomcat direct docBase mode serves directly from source.
 *   - Java files (debug mode): JavaHotSwapService handles.
 *   - Java files (non-debug): incremental compile + sync classes.
 *
 * Also provides:
 *   - "Update Application" (Ctrl+F10): save all + compile + sync
 *   - On frame deactivation: auto-save + sync
 *   - Debounce to avoid rapid consecutive updates
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { CommandService } from '@theia/core/lib/common/command';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import { ServerStore } from './server-store';
import type { ServerInstance } from './server-store';
import { BuildStore } from '@kairo/build-extension';

/** File extensions that are static resources (direct docBase, no action needed). */
const STATIC_EXTENSIONS = ['.jsp', '.html', '.htm', '.css', '.js', '.jsx',
  '.xml', '.properties', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];

/** File extensions that trigger Java compilation. */
const JAVA_EXTENSIONS = ['.java'];

@injectable()
export class HotDeployService implements FrontendApplicationContribution {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(CommandService) protected readonly commands!: CommandService;
  @inject(PreferenceService) protected readonly preferences!: PreferenceService;
  @inject(MonacoWorkspace) protected readonly monacoWorkspace!: MonacoWorkspace;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(ServerStore) protected readonly serverStore!: ServerStore;
  @inject(BuildStore) protected readonly buildStore!: BuildStore;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
  protected pendingJavaFiles = new Set<string>();
  protected unsubscribeBuild: Disposable | undefined;
  protected saveDisposable: Disposable | undefined;
  protected blurHandler: (() => void) | undefined;

  protected get debounceMs(): number {
    return this.preferences.get('kairo.hotReload.debounceMs', 500) as number;
  }

  protected get isAutoSyncEnabled(): boolean {
    return this.preferences.get('kairo.hotReload.autoSyncOnSave', true) as boolean;
  }

  protected get isOnFrameDeactivationEnabled(): boolean {
    return this.preferences.get('kairo.hotReload.onFrameDeactivation', true) as boolean;
  }

  @postConstruct()
  protected init(): void {
    this.logger.info('[HotDeploy] HotDeployService initialized');
  }

  onStart(_app: FrontendApplication): void {
    // Listen for text document save events
    this.saveDisposable = this.monacoWorkspace.onDidSaveTextDocument((model: MonacoEditorModel) => {
      const uri = model.uri?.toString();
      if (!uri) return;

      if (this.isJavaFile(uri)) {
        this.onJavaFileSaved(uri);
      } else if (this.isStaticFile(uri)) {
        // Static files: in direct docBase mode, Tomcat serves
        // directly from source directory — no action needed.
        this.logger.info(`[HotDeploy] Static file saved: ${uri} (direct docBase, no sync needed)`);
      }
    });

    // On frame deactivation: auto-save + sync
    if (typeof window !== 'undefined') {
      this.blurHandler = () => this.onWindowBlur();
      window.addEventListener('blur', this.blurHandler);
    }

    // Listen for build completion events — auto-sync classes to running server
    let previousBuildState: string | undefined;
    this.unsubscribeBuild = this.buildStore.onDidChange(() => {
      const latest = this.buildStore.getLatestBuild();
      if (!latest) return;
      if (latest.state === 'succeeded' && previousBuildState !== 'succeeded') {
        this.onBuildCompleted();
      }
      previousBuildState = latest.state;
    });

    this.logger.info('[HotDeploy] Save listeners, frame deactivation handler, and build listener registered');
  }

  onStop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.pendingJavaFiles.clear();
    this.unsubscribeBuild?.dispose();
    this.saveDisposable?.dispose();
    if (this.blurHandler && typeof window !== 'undefined') {
      window.removeEventListener('blur', this.blurHandler);
      this.blurHandler = undefined;
    }
  }

  /** Check if a URI represents a Java source file. */
  protected isJavaFile(uri: string): boolean {
    return JAVA_EXTENSIONS.some(ext => uri.endsWith(ext));
  }

  /** Check if a URI represents a static resource file. */
  protected isStaticFile(uri: string): boolean {
    return STATIC_EXTENSIONS.some(ext => uri.endsWith(ext));
  }

  /** Check if there is a running server for the current project. */
  protected getRunningServer(): ServerInstance | undefined {
    const servers = this.serverStore.getServers();
    return servers.find(s => s.state === 'running');
  }

  /** Called when a Java file is saved. */
  protected onJavaFileSaved(uri: string): void {
    if (!this.isAutoSyncEnabled) {
      this.logger.info('[HotDeploy] Auto-sync is disabled');
      return;
    }

    const server = this.getRunningServer();
    if (!server) {
      return; // No running server, nothing to sync to
    }

    this.pendingJavaFiles.add(uri);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const files = Array.from(this.pendingJavaFiles);
      this.pendingJavaFiles.clear();
      void this.compileAndSync(files, server);
    }, this.debounceMs);
  }

  /** Compile changed Java files and sync classes to the running server. */
  async compileAndSync(files: string[], server: ServerInstance): Promise<void> {
    if (files.length === 0) return;

    this.logger.info(`[HotDeploy] Compiling ${files.length} changed Java file(s)...`);
    this.serverStore.setHotReloadStatus('compiling');

    try {
      // BD-P2-8: agent expects filesystem paths, not Monaco URIs.
      const fsPaths = files.map(f => {
        try {
          return f.includes('://') ? FileUri.fsPath(f) : f;
        } catch {
          return f;
        }
      });
      const result = await this.requestCompileIncremental({ files: fsPaths, projectId: server.projectId });
      this.applyCompileResult(result, files.length);
    } catch (error) {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[HotDeploy] Compile and sync failed: ${msg}`);
      this.messages.warn(this.i18n.t('widget.servers.hotReload.failed', { msg }));
    }
  }

  /**
   * Update Application (Ctrl+F10): save all, compile changed Java files,
   * sync classes, optionally reload context.
   */
  async updateApplication(): Promise<void> {
    const server = this.getRunningServer();
    if (!server) {
      this.messages.warn(this.i18n.t('widget.servers.hotReload.noRunningServer'));
      return;
    }

    this.logger.info('[HotDeploy] Update Application triggered');
    this.serverStore.setHotReloadStatus('compiling');

    try {
      // Trigger incremental compile via the agent
      const result = await this.requestCompileIncremental({ projectId: server.projectId });
      if (result.state === 'success') {
        this.serverStore.setHotReloadStatus('synced');
        this.messages.info(this.i18n.t('widget.servers.hotReload.applicationUpdated', {
          count: result.filesCompiled ?? 0,
        }));
      } else if (result.state === 'failure') {
        this.serverStore.setHotReloadStatus('restart_required');
        this.messages.warn(this.i18n.t('widget.servers.hotReload.compilationFailed'));
      } else {
        this.serverStore.setHotReloadStatus('restart_required');
        this.messages.warn(this.i18n.t('widget.servers.hotReload.unexpectedState', {
          state: result.state || 'unknown',
        }));
      }
    } catch (error) {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.messages.error(this.i18n.t('widget.servers.hotReload.updateFailed', { msg }));
    }
  }

  /**
   * Reload Context: touch WEB-INF/web.xml to trigger Tomcat context reload.
   * This is a heavier operation — only done on explicit user request.
   */
  async reloadContext(): Promise<void> {
    const server = this.getRunningServer();
    if (!server) {
      this.messages.warn(this.i18n.t('widget.servers.hotReload.noRunningServer'));
      return;
    }

    this.logger.info('[HotDeploy] Reload Context triggered');
    this.serverStore.setHotReloadStatus('compiling');

    try {
      await this.runtime.request(
        'POST /api/v1/servers/{serverId}/reload',
        undefined,
        { pathParams: { serverId: server.id }, noRetry: true },
      );
      this.serverStore.setHotReloadStatus('synced');
      this.messages.info(this.i18n.t('widget.servers.hotReload.contextReloaded'));
    } catch (error) {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.messages.error(this.i18n.t('widget.servers.hotReload.contextReloadFailed', { msg }));
    }
  }

  /** Handle window blur (frame deactivation) — auto-save all files. */
  protected onWindowBlur(): void {
    if (!this.isOnFrameDeactivationEnabled) return;

    const server = this.getRunningServer();
    if (!server) return;

    this.logger.info('[HotDeploy] Frame deactivation — auto-save triggered');
    this.commands.executeCommand('core.saveAll');
  }

  /**
   * Called when a build completes successfully.
   * If there is a running server, trigger incremental compile
   * and sync to automatically update the deployed application.
   * This is the "Build完成后自动同步" feature from IDEA —
   * after Ctrl+Shift+B build, the changes are synced to the
   * running server without manual intervention.
   */
  protected onBuildCompleted(): void {
    const server = this.getRunningServer();
    if (!server) {
      this.logger.info('[HotDeploy] Build completed but no running server — skipping auto-sync');
      return;
    }

    this.logger.info('[HotDeploy] Build completed — triggering auto-sync to running server');
    this.serverStore.setHotReloadStatus('compiling');

    this.requestCompileIncremental({ projectId: server.projectId }).then(result => {
      if (result.state === 'success') {
        this.serverStore.setHotReloadStatus('synced');
        this.logger.info('[HotDeploy] Build auto-sync completed');
      } else {
        this.serverStore.setHotReloadStatus('restart_required');
        this.logger.warn(`[HotDeploy] Build auto-sync failed (state=${result.state})`);
      }
    }).catch((error: unknown) => {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[HotDeploy] Build auto-sync error: ${msg}`);
    });
  }

  /**
   * Start an incremental compile and, when the agent returns queued/running,
   * poll GET /api/v1/builds/{id} until a terminal Go state (success|failure|…).
   * Go vocabulary is queued|running|success|failure|cancelled — not completed/failed.
   */
  protected async requestCompileIncremental(payload: {
    projectId: string;
    files?: string[];
  }): Promise<{ state: string; filesCompiled?: number; id?: string }> {
    const started = await this.runtime.request(
      'POST /api/v1/jvm/compile-incremental',
      payload,
      { noRetry: true },
    ) as { state?: string; filesCompiled?: number; id?: string };

    let state = String(started?.state || '');
    let filesCompiled = started?.filesCompiled;
    const buildId = started?.id;
    if (buildId && /^(queued|running|pending)$/i.test(state)) {
      const terminal = await this.waitForBuildTerminal(buildId, 120_000);
      state = String(terminal.state || state);
      if (typeof terminal.filesCompiled === 'number') {
        filesCompiled = terminal.filesCompiled;
      }
    }
    return { state, filesCompiled, id: buildId };
  }

  protected async waitForBuildTerminal(
    buildId: string,
    timeoutMs: number,
  ): Promise<{ state?: string; filesCompiled?: number }> {
    const deadline = Date.now() + timeoutMs;
    // Exponential backoff (500ms → 2s cap): compiles typically take tens of
    // seconds; fixed 500ms polling burned ~240 HTTP round-trips per build.
    let delay = 500;
    while (Date.now() < deadline) {
      try {
        const b = await this.runtime.request(
          'GET /api/v1/builds/{buildId}',
          undefined,
          { pathParams: { buildId }, noRetry: true },
        ) as { state?: string; filesCompiled?: number };
        if (b?.state && !/^(pending|running|queued)$/i.test(b.state)) {
          return b;
        }
      } catch {
        // keep polling
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 2000);
    }
    return { state: 'failure' };
  }

  protected applyCompileResult(
    result: { state: string; filesCompiled?: number },
    fileCount: number,
  ): void {
    if (result.state === 'success') {
      this.serverStore.setHotReloadStatus('synced');
      this.logger.info(`[HotDeploy] Compiled and synced (${fileCount} file(s))`);
    } else if (result.state === 'failure' || result.state === 'cancelled') {
      this.serverStore.setHotReloadStatus('restart_required');
      this.messages.warn(this.i18n.t('widget.servers.hotReload.compilationFailedCount', {
        count: fileCount,
      }));
    } else {
      this.serverStore.setHotReloadStatus('restart_required');
      this.logger.warn(`[HotDeploy] Unexpected compile state: ${result.state}`);
    }
  }
}