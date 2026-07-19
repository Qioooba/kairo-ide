/**
 * Kairo views — the Theia-side panels the user actually sees
 * while working in the IDE.
 *
 *   * Kairo Servers View     — tree of server instances, start/stop/restart
 *   * Kairo Build View       — list of builds with progress and diagnostics
 *   * Kairo Deployment View  — list of deployments with file counts
 *   * Kairo Tomcat Logs View — live log lines from the active server
 *
 * The views subscribe to the Runtime Agent's WebSocket event
 * stream so the UI updates as the agent reports progress, log
 * lines, and state changes. No polling, no fake events.
 *
 * Buttons in the editor area title bar (Build / Build & Deploy /
 * Start / Debug / Stop / Restart / Open Application) trigger
 * commands that go through the high-level services (Server,
 * Project). The buttons do NOT bypass the API by spawning
 * javac or Tomcat locally.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  Widget,
  WidgetManager,
  FrontendApplicationContribution,
  ApplicationShell,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry, CommandService, MessageService } from '@theia/core/lib/common';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import {
  KairoServerService,
} from '@kairo/tomcat-extension';
import {
  KairoProjectService,
  ActiveProjectService,
} from '@kairo/project-extension';
import { BuildViewWidget } from '@kairo/build-extension';
import { BuildStore } from '@kairo/build-extension';
import { ServerViewWidget, LogViewerWidget } from '@kairo/tomcat-extension';
import type {
  ServerInstance,
  BuildResult,
  DeploymentResult,
} from '@kairo/protocol';
import { mapBuildState } from '@kairo/protocol';

/* ------------------------------------------------------------------ */
/*  Commands                                                            */
/* ------------------------------------------------------------------ */

export namespace KairoCommands {
  export const SCAN_PROJECT: Command = { id: 'kairo.project.scan', label: 'Kairo: Scan Project' };
  export const BUILD: Command = { id: 'kairo.build', label: 'Kairo: Build' };
  export const BUILD_AND_DEPLOY: Command = { id: 'kairo.buildAndDeploy', label: 'Kairo: Build and Deploy' };
  export const START_SERVER: Command = { id: 'kairo.server.start', label: 'Kairo: Start Server' };
  export const DEBUG_SERVER: Command = { id: 'kairo.server.debug', label: 'Kairo: Start Server (Debug)' };
  export const STOP_SERVER: Command = { id: 'kairo.server.stop', label: 'Kairo: Stop Server' };
  export const RESTART_SERVER: Command = { id: 'kairo.server.restart', label: 'Kairo: Restart Server' };
  export const OPEN_APPLICATION: Command = { id: 'kairo.app.open', label: 'Kairo: Open Application' };
  export const REVEAL_KAIRO_SERVERS: Command = { id: 'kairo.view.servers', label: 'Kairo: Show Servers' };
  export const REVEAL_KAIRO_BUILDS: Command = { id: 'kairo.view.builds', label: 'Kairo: Show Builds' };
  export const REVEAL_KAIRO_DEPLOYMENTS: Command = { id: 'kairo.view.deployments', label: 'Kairo: Show Deployments' };
  export const REVEAL_KAIRO_LOGS: Command = { id: 'kairo.view.logs', label: 'Kairo: Show Tomcat Logs' };
}

/* ------------------------------------------------------------------ */
/*  Widgets                                                             */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoDeploymentsWidget extends Widget {
  static readonly ID = 'kairo-deployments';
  deployments: DeploymentResult[] = [];

  constructor() {
    super();
    this.id = KairoDeploymentsWidget.ID;
    this.title.label = 'Kairo Deployments';
    this.title.caption = 'Kairo Deployments';
    this.addClass('kairo-widget');
    this.node.innerHTML = `<div class="kairo-widget-body">
      <p>No deployments yet.</p>
    </div>`;
  }

  setDeployments(deployments: DeploymentResult[]): void {
    this.deployments = deployments;
    if (deployments.length === 0) {
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p>No deployments yet.</p>
      </div>`;
      return;
    }
    const rows = deployments.slice(0, 50).map(d => `
      <tr>
        <td>${escapeHtml(d.id)}</td>
        <td>${escapeHtml(d.state)}</td>
        <td>${d.filesTouched} files / ${d.bytes} bytes</td>
        <td>${escapeHtml(d.trigger)}</td>
        <td>${escapeHtml(d.hotReloadMode)}</td>
      </tr>
    `).join('');
    this.node.innerHTML = `<div class="kairo-widget-body">
      <table class="kairo-deployments-table">
        <thead><tr><th>ID</th><th>State</th><th>Files</th><th>Trigger</th><th>Reload</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
}

/* ------------------------------------------------------------------ */
/*  Contribution — wires commands, views, and event subscriptions       */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoViewsContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell) protected shell!: ApplicationShell;
  @inject(WidgetManager) protected widgetManager!: WidgetManager;
  @inject(CommandService) protected commands!: CommandService;
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(KairoServerService) protected serverSvc!: KairoServerService;
  @inject(KairoProjectService) protected projectSvc!: KairoProjectService;
  @inject(ActiveProjectService) protected activeProject!: ActiveProjectService;
  @inject(MessageService) protected messages!: MessageService;
  @inject(BuildStore) protected buildStore!: BuildStore;

  protected eventsUnsub: (() => void) | undefined;
  protected statusUnsub: (() => void) | undefined;
  protected serversView: ServerViewWidget | undefined;
  protected buildsView: BuildViewWidget | undefined;
  protected deploymentsView: KairoDeploymentsWidget | undefined;
  protected logsView: LogViewerWidget | undefined;

  @postConstruct()
  init(): void {
    // Defer until the application shell is ready (onStart fires
    // before the workbench is fully constructed).
  }

  onStart(): void {
    // Register commands. The commands accept a `Widget | undefined`
    // argument when triggered from a view, but most user flows
    // come from the toolbar / command palette.
    this.statusUnsub = this.runtime.onStatusChange(s => {
      if (s === 'disconnected') {
        this.messages.warn('Runtime Agent is disconnected. Buttons will retry on click.');
      }
    });
    this.eventsUnsub = this.runtime.subscribeEvents(this.runtime.workspace(), (e: any) => this.handleEvent(e));
  }

  onStop(): void {
    this.eventsUnsub?.();
    this.statusUnsub?.();
  }

  async registerCommands(registry: CommandRegistry): Promise<void> {
    registry.registerCommand(KairoCommands.SCAN_PROJECT, {
      execute: async () => {
        try {
          const ws = this.projectSvc.currentWorkspace();
          if (!ws) {
            this.messages.warn('Open a workspace first via File > Open Folder.');
            return undefined;
          }
          const out = await this.projectSvc.detectLayout(ws.id);
          this.messages.info(`Scanned ${ws.rootPath}.`);
          return out;
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Scan failed'));
          return undefined;
        }
      },
    });

    registry.registerCommand(KairoCommands.BUILD, {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const result = await this.runtime.request('POST /api/v1/builds', { projectId: p.projectId });
          this.messages.info(`Build ${result.state}.`);
          await this.refreshBuilds();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Build failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.BUILD_AND_DEPLOY, {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const build = await this.runtime.request('POST /api/v1/builds', { projectId: p.projectId });
          const deploy = await this.runtime.request('POST /api/v1/deployments', { projectId: p.projectId, buildId: build.id, scope: 'all' });
          this.messages.info(`Build ${build.state} → Deploy ${deploy.state}.`);
          await this.refreshBuilds();
          await this.refreshDeployments();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Build and deploy failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.START_SERVER, {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const srv = await this.serverSvc.start(p.projectId, false);
          this.messages.info(`Server ${srv.id} ${srv.state}.`);
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server start failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.DEBUG_SERVER, {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const srv = await this.serverSvc.start(p.projectId, true);
          this.messages.info(`Server ${srv.id} (debug) ${srv.state}.`);
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server debug start failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.STOP_SERVER, {
      execute: async () => {
        try {
          const list = await this.runtime.request('GET /api/v1/servers', undefined);
          for (const srv of (list as ServerInstance[])) {
            await this.serverSvc.stop(srv.id, false);
            this.messages.info(`Server ${srv.id} stopped.`);
          }
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server stop failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.RESTART_SERVER, {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const list = await this.runtime.request('GET /api/v1/servers', undefined) as ServerInstance[];
          for (const srv of list) {
            const result = await this.runtime.request(
              'POST /api/v1/servers/{serverId}/restart',
              undefined,
              { pathParams: { serverId: srv.id } },
            ) as ServerInstance;
            this.messages.info(`Server ${result.id} restarted, new PID: ${result.pid}`);
          }
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Server restart failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.OPEN_APPLICATION, {
      execute: async () => {
        try {
          const list = (await this.runtime.request('GET /api/v1/servers', undefined)) as ServerInstance[];
          const srv = list[0];
          if (!srv || !srv.ports.http) {
            this.messages.warn('No running server with an HTTP port.');
            return undefined;
          }
          const url = `http://127.0.0.1:${srv.ports.http}`;
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Open application failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.REVEAL_KAIRO_SERVERS, {
      execute: () => { void this.revealOrCreate(ServerViewWidget.ID, () => this.serversView, w => { this.serversView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_BUILDS, {
      execute: () => { void this.revealOrCreate(BuildViewWidget.ID, () => this.buildsView, w => { this.buildsView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEPLOYMENTS, {
      execute: () => { void this.revealOrCreate(KairoDeploymentsWidget.ID, () => this.deploymentsView, w => { this.deploymentsView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_LOGS, {
      execute: () => { void this.revealOrCreate(LogViewerWidget.ID, () => this.logsView, w => { this.logsView = w; }); },
    });
  }

  async registerViewContainers(): Promise<void> {
    // In Theia 1.73.1 views are wired via the WidgetManager and
    // the ApplicationShell's `getDockPanel` API. We register the
    // widget factories in the frontend module (see
    // `kairo-product-frontend-module.ts`) and the
    // `WidgetManager.getOrCreateWidget` call below opens the
    // right panel.
  }

  protected async revealOrCreate<T extends Widget>(
    id: string,
    getter: () => T | undefined,
    setter: (w: T) => void,
  ): Promise<void> {
    let w: T | undefined = getter();
    if (!w) {
      const created = await this.widgetManager.getOrCreateWidget(id);
      w = created as T;
      setter(w);
    }
    this.shell.activateWidget(w.id);
  }

  protected async refreshBuilds(): Promise<void> {
    try {
      const list = (await this.runtime.request('GET /api/v1/builds', undefined)) as BuildResult[];
      if (Array.isArray(list)) {
        const builds = list.map(b => {
          mapBuildState(b.state);
          return {
            id: b.id,
            workspaceId: this.runtime.workspace(),
            projectId: '',
            state: (b.state === 'success' ? 'succeeded' : b.state === 'failure' ? 'failed' : b.state === 'queued' ? 'pending' : b.state) as 'succeeded' | 'failed' | 'pending' | 'running' | 'cancelled',
            startTime: b.startedAt,
            endTime: b.finishedAt,
            summary: `${b.summary.errors} errors, ${b.summary.warnings} warnings`,
            diagnostics: b.diagnostics.map(d => ({
              file: d.file,
              line: d.line,
              column: d.column,
              severity: d.severity === 'hint' ? 'info' : d.severity,
              message: d.message,
            })),
          };
        });
        this.buildStore.setBuilds(builds);
      }
    } catch (err) {
      this.messages.error(kairoErrorMessage(err, 'Refresh builds failed'));
    }
  }

  protected async refreshDeployments(): Promise<void> {
    if (!this.deploymentsView) return;
    try {
      const list = (await this.runtime.request('GET /api/v1/deployments', undefined)) as DeploymentResult[];
      this.deploymentsView.setDeployments(Array.isArray(list) ? list : []);
    } catch (err) {
      this.messages.error(kairoErrorMessage(err, 'Refresh deployments failed'));
    }
  }

  protected handleEvent(e: any): void {
    switch (e.type) {
      case 'build.progress':
        void this.refreshBuilds();
        return;
      case 'deployment.progress':
        void this.refreshDeployments();
        return;
      case 'server.state':
        void this.refreshBuilds();
        void this.refreshDeployments();
        return;
      default:
        return;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function kairoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof KairoError) return err.format();
  if (err instanceof Error) return `${fallback}: ${err.message}`;
  return fallback;
}
