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
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { CommandService } from '@theia/core/lib/common/command';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
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

  protected debounceTimer: ReturnType<typeof setTimeout> | undefined;
  protected pendingJavaFiles = new Set<string>();
  protected unsubscribeBuild: Disposable | undefined;

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
    this.monacoWorkspace.onDidSaveTextDocument((model: MonacoEditorModel) => {
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
      window.addEventListener('blur', () => {
        this.onWindowBlur();
      });
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
      const result = await this.runtime.request(
        'POST /api/v1/jvm/compile-incremental',
        { files, projectId: server.projectId },
        { noRetry: true },
      ) as any;

      if (result && result.state === 'completed') {
        this.serverStore.setHotReloadStatus('synced');
        const fileNames = files.map(f => f.split('/').pop() || f).join(', ');
        this.logger.info(`[HotDeploy] Compiled and synced: ${fileNames}`);
      } else if (result && result.state === 'failed') {
        this.serverStore.setHotReloadStatus('restart_required');
        this.messages.warn(`Compilation failed for ${files.length} file(s). Check the Problems panel.`);
      } else {
        this.serverStore.setHotReloadStatus('synced');
      }
    } catch (error) {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[HotDeploy] Compile and sync failed: ${msg}`);
      this.messages.warn(`Hot deploy failed: ${msg}`);
    }
  }

  /**
   * Update Application (Ctrl+F10): save all, compile changed Java files,
   * sync classes, optionally reload context.
   */
  async updateApplication(): Promise<void> {
    const server = this.getRunningServer();
    if (!server) {
      this.messages.warn('No running server. Start the server first.');
      return;
    }

    this.logger.info('[HotDeploy] Update Application triggered');
    this.serverStore.setHotReloadStatus('compiling');

    try {
      // Trigger incremental compile via the agent
      const result = await this.runtime.request(
        'POST /api/v1/jvm/compile-incremental',
        { projectId: server.projectId },
        { noRetry: true },
      ) as any;

      if (result && result.state === 'completed') {
        this.serverStore.setHotReloadStatus('synced');
        this.messages.info(`Application updated: ${result.filesCompiled ?? 0} file(s) compiled.`);
      } else if (result && result.state === 'failed') {
        this.serverStore.setHotReloadStatus('restart_required');
        this.messages.warn('Compilation failed. Some changes require a reload or restart.');
      } else {
        this.serverStore.setHotReloadStatus('synced');
        this.messages.info('Application updated.');
      }
    } catch (error) {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.messages.error(`Update failed: ${msg}`);
    }
  }

  /**
   * Reload Context: touch WEB-INF/web.xml to trigger Tomcat context reload.
   * This is a heavier operation — only done on explicit user request.
   */
  async reloadContext(): Promise<void> {
    const server = this.getRunningServer();
    if (!server) {
      this.messages.warn('No running server. Start the server first.');
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
      this.messages.info('Context reloaded. The application should reflect your changes.');
    } catch (error) {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.messages.error(`Context reload failed: ${msg}`);
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

    this.runtime.request(
      'POST /api/v1/jvm/compile-incremental',
      { projectId: server.projectId },
      { noRetry: true },
    ).then((result: any) => {
      if (result && result.state === 'completed') {
        this.serverStore.setHotReloadStatus('synced');
        this.logger.info('[HotDeploy] Build auto-sync completed');
      } else {
        this.serverStore.setHotReloadStatus('restart_required');
        this.logger.warn('[HotDeploy] Build auto-sync failed');
      }
    }).catch((error: unknown) => {
      this.serverStore.setHotReloadStatus('restart_required');
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[HotDeploy] Build auto-sync error: ${msg}`);
    });
  }
}