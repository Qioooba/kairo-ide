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
import { Command, CommandRegistry, CommandService, MenuContribution, MenuModelRegistry, MessageService } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { isOSX } from '@theia/core/lib/common/os';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import {
  KairoServerService,
} from '@kairo/tomcat-extension';
import {
  KairoProjectService,
  ActiveProjectService,
} from '@kairo/project-extension';
import { BuildViewWidget } from '@kairo/build-extension';
import { BuildStore, mapBuildResult } from '@kairo/build-extension';
import { ServerViewWidget, LogViewerWidget } from '@kairo/tomcat-extension';
import { ImportWizardWidget, ProjectSelectorWidget } from '@kairo/project-extension';
import { MavenViewWidget } from './maven-view-widget';
import { KairoTodoWidget } from './kairo-todo-widget';
import { KairoRemoteWidget } from './kairo-remote-widget';
import { KAIRO_WELCOME_FACTORY_ID } from './kairo-welcome-widget';
import {
  KAIRO_IMPORT_WIZARD_FACTORY_ID,
  KAIRO_PROJECT_SELECTOR_FACTORY_ID,
  KAIRO_RUN_CONFIGURATIONS_FACTORY_ID,
  KAIRO_KEYMAP_FACTORY_ID,
  KAIRO_MAVEN_FACTORY_ID as _KAIRO_MAVEN_FACTORY_ID,
  KAIRO_TODO_FACTORY_ID,
  KAIRO_TESTS_FACTORY_ID,
  KAIRO_REMOTE_FACTORY_ID,
  KAIRO_SQL_CONSOLE_FACTORY_ID,
  KAIRO_PERF_FACTORY_ID,
  KAIRO_DEBUG_VARIABLES_FACTORY_ID,
  KAIRO_DEBUG_CALLSTACK_FACTORY_ID,
  KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID,
  KAIRO_DEBUG_TOOLBAR_FACTORY_ID,
  KAIRO_DEBUG_CONSOLE_FACTORY_ID,
  KAIRO_DEBUG_WATCH_FACTORY_ID,
} from './kairo-factory-ids';
import type {
  ServerInstance,
  BuildResult,
  DeploymentResult,
  WsEvent,
} from '@kairo/protocol';
import { KairoJavaDebugService } from './kairo-java-debug-service';

/* ------------------------------------------------------------------ */
/*  Commands                                                            */
/* ------------------------------------------------------------------ */

export namespace KairoCommands {
  export const IMPORT_PROJECT: Command = { id: 'kairo.project.import', label: 'Kairo: Import Project' };
  export const SELECT_PROJECT: Command = { id: 'kairo.project.select', label: 'Kairo: Select Project' };
  export const SCAN_PROJECT: Command = { id: 'kairo.project.scan', label: 'Kairo: Scan Project' };
  export const BUILD: Command = { id: 'kairo.build', label: 'Kairo: Build' };
  export const CLEAN_BUILD: Command = { id: 'kairo.cleanBuild', label: 'Kairo: Clean Build' };
  export const BUILD_AND_DEPLOY: Command = { id: 'kairo.buildAndDeploy', label: 'Kairo: Build and Deploy' };
  export const START_SERVER: Command = { id: 'kairo.server.start', label: 'Kairo: Start Server' };
  export const DEBUG_SERVER: Command = { id: 'kairo.server.debug', label: 'Kairo: Start Server (Debug)' };
  export const CHECK_DEBUG_ADAPTER: Command = { id: 'kairo.debug.checkAdapter', label: 'Kairo: Check Java Debug Adapter' };
  export const OPEN_DEBUG_VIEW: Command = { id: 'kairo.debug.openView', label: 'Kairo: Open Debug View' };
  export const OPEN_DEBUG_CONSOLE: Command = { id: 'kairo.debug.openConsole', label: 'Kairo: Open Debug Console' };
  export const STOP_SERVER: Command = { id: 'kairo.server.stop', label: 'Kairo: Stop Server' };
  export const RESTART_SERVER: Command = { id: 'kairo.server.restart', label: 'Kairo: Restart Server' };
  export const OPEN_APPLICATION: Command = { id: 'kairo.app.open', label: 'Kairo: Open Application' };
  export const REVEAL_KAIRO_SERVERS: Command = { id: 'kairo.view.servers', label: 'Kairo: Show Servers' };
  export const REVEAL_KAIRO_BUILDS: Command = { id: 'kairo.view.builds', label: 'Kairo: Show Builds' };
  export const REVEAL_KAIRO_DEPLOYMENTS: Command = { id: 'kairo.view.deployments', label: 'Kairo: Show Deployments' };
  export const REVEAL_KAIRO_LOGS: Command = { id: 'kairo.view.logs', label: 'Kairo: Show Tomcat Logs' };
  export const REVEAL_KAIRO_MAVEN: Command = { id: 'kairo.view.maven', label: 'Kairo: Show Maven' };
  export const REVEAL_KAIRO_TODO: Command = { id: 'kairo.view.todo', label: 'Kairo: Show TODO/FIXME' };
  export const REVEAL_KAIRO_SQL_CONSOLE: Command = { id: 'kairo.view.sqlConsole', label: 'Kairo: Show SQL Console' };
  export const REVEAL_KAIRO_TESTS: Command = { id: 'kairo.view.tests', label: 'Kairo: Show Test Results' };
  export const MANAGE_RUN_CONFIGURATIONS: Command = { id: 'kairo.runConfigurations.manage', label: 'Kairo: Manage Run Configurations' };
  export const SWITCH_JDK: Command = { id: 'kairo.jdk.switch', label: 'Kairo: Switch JDK' };
  export const RECONNECT_AGENT: Command = { id: 'kairo.agent.reconnect', label: 'Kairo: Reconnect Agent' };
  export const OPEN_KEYMAP: Command = { id: 'kairo.keymap.open', label: 'Kairo: Open Keyboard Shortcuts' };
  export const TOGGLE_TERMINAL: Command = { id: 'kairo.terminal.toggle', label: 'Kairo: Toggle Terminal' };
  export const REVEAL_KAIRO_REMOTE: Command = { id: 'kairo.view.remote', label: 'Kairo: Show Remote Development', iconClass: 'codicon codicon-remote' };
  export const REVEAL_KAIRO_PERF: Command = { id: 'kairo.view.perf', label: 'Kairo: Show Performance' };
  export const REVEAL_KAIRO_DEBUG_VARIABLES: Command = { id: 'kairo.debug.view.variables', label: 'Kairo: Show Debug Variables' };
  export const REVEAL_KAIRO_DEBUG_CALLSTACK: Command = { id: 'kairo.debug.view.callstack', label: 'Kairo: Show Debug Call Stack' };
  export const REVEAL_KAIRO_DEBUG_BREAKPOINTS: Command = { id: 'kairo.debug.view.breakpoints', label: 'Kairo: Show Debug Breakpoints' };
  export const REVEAL_KAIRO_DEBUG_TOOLBAR: Command = { id: 'kairo.debug.view.toolbar', label: 'Kairo: Show Debug Toolbar' };
  export const REVEAL_KAIRO_DEBUG_CONSOLE: Command = { id: 'kairo.debug.view.console', label: 'Kairo: Show Debug Console' };
  export const REVEAL_KAIRO_DEBUG_WATCH: Command = { id: 'kairo.debug.view.watch', label: 'Kairo: Show Debug Watch' };
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
      this.node.innerHTML = `<div class="kairo-widget-body" role="status">
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
      <table class="kairo-deployments-table" aria-label="Deployments list">
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
export class KairoViewsContribution implements FrontendApplicationContribution, MenuContribution, KeybindingContribution {
  @inject(ApplicationShell) protected shell!: ApplicationShell;
  @inject(WidgetManager) protected widgetManager!: WidgetManager;
  @inject(CommandService) protected commands!: CommandService;
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(KairoServerService) protected serverSvc!: KairoServerService;
  @inject(KairoProjectService) protected projectSvc!: KairoProjectService;
  @inject(ActiveProjectService) protected activeProject!: ActiveProjectService;
  @inject(MessageService) protected messages!: MessageService;
  @inject(BuildStore) protected buildStore!: BuildStore;
  @inject(KairoJavaDebugService) protected javaDebug!: KairoJavaDebugService;

  protected eventsUnsub: (() => void) | undefined;
  protected statusUnsub: (() => void) | undefined;
  protected serversView: ServerViewWidget | undefined;
  protected buildsView: BuildViewWidget | undefined;
  protected deploymentsView: KairoDeploymentsWidget | undefined;
  protected logsView: LogViewerWidget | undefined;
  protected mavenView: MavenViewWidget | undefined;
  protected todoView: KairoTodoWidget | undefined;

  @postConstruct()
  init(): void {
    // Defer until the application shell is ready (onStart fires
    // before the workbench is fully constructed).
  }

  onStart(): void {
    // Register commands. The commands accept a `Widget | undefined`
    // argument when triggered from a view, but most user flows
    // come from the toolbar / command palette.
    // KAIRO-RC-WEB-017: onStatusChange fires immediately with the
    // current status, which is 'disconnected' before the first
    // connect — warning on that initial emission produced a stale
    // "disconnected" toast sitting next to a "Runtime: connected"
    // status bar. Only warn on a genuine open -> disconnected
    // transition, and let the toast time out so it cannot linger
    // past a reconnect.
    let lastStatus: string | undefined;
    this.statusUnsub = this.runtime.onStatusChange(s => {
      if (s === 'disconnected' && lastStatus === 'open') {
        this.messages.warn('Runtime Agent is disconnected. Buttons will retry on click.', { timeout: 12000 });
      }
      lastStatus = s;
    });
    this.eventsUnsub = this.runtime.subscribeEvents(this.runtime.workspace(), (e: WsEvent) => this.handleEvent(e));

    // N-029: clear the WidgetManager cache so the new React Build/Server
    // views replace any stale cached factories from earlier module loads.
    const wm = this.widgetManager as unknown as { _cachedFactories?: unknown; factories?: Map<string, unknown> };
    if (wm._cachedFactories) {
      wm._cachedFactories = undefined;
      void wm.factories?.size;
    }

    // KAIRO-RC-WEB-018: cold start with no active project shows
    // the Welcome tab so the first task is discoverable; the tab
    // closes itself once a project is selected.
    // P2-UX-02: on first launch (no recent projects), auto-open the
    // import wizard to guide the user through onboarding.
    void this.maybeOpenWelcome();
    this.activeProject.onDidChangeProject(p => {
      if (p) void this.closeWelcome();
    });
  }

  protected async maybeOpenWelcome(): Promise<void> {
    if (this.activeProject.project) {
      return;
    }
    try {
      await this.revealOrCreateMain(KAIRO_WELCOME_FACTORY_ID, () => undefined, () => { /* singleton via WidgetManager */ });
      // P2-UX-02: detect first launch — if no recent projects exist,
      // auto-open the import wizard to guide the user.
      try {
        const recent = await this.projectSvc.getRecentProjects();
        if (recent.length === 0) {
          // First launch: show a brief welcome tip before opening the import wizard
          this.messages.info('Welcome to Kairo IDE! Let\'s import your first project.', { timeout: 5000 });
          // Auto-open the import wizard after a short delay
          setTimeout(() => {
            void this.commands.executeCommand('kairo.project.import');
          }, 500);
        }
      } catch {
        // If getRecentProjects fails (e.g., agent not connected),
        // still show the welcome page but skip auto-import.
      }
    } catch (err) {
      console.warn('[kairo] welcome tab failed to open', err);
    }
  }

  protected async closeWelcome(): Promise<void> {
    const w = this.shell.getWidgets('main').find(widget => widget.id === KAIRO_WELCOME_FACTORY_ID);
    w?.close();
  }

  onStop(): void {
    this.eventsUnsub?.();
    this.statusUnsub?.();
  }

  async registerCommands(registry: CommandRegistry): Promise<void> {
    console.log('[kairo] KairoViewsContribution.registerCommands called');

    registry.registerCommand(KairoCommands.IMPORT_PROJECT, {
      execute: async () => {
        try {
          await this.revealOrCreateMain<ImportWizardWidget>(
            KAIRO_IMPORT_WIZARD_FACTORY_ID,
            () => undefined,
            _w => { /* singleton via WidgetManager */ },
          );
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Open Import Wizard failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.SELECT_PROJECT, {
      execute: async () => {
        try {
          await this.revealOrCreateMain<ProjectSelectorWidget>(
            KAIRO_PROJECT_SELECTOR_FACTORY_ID,
            () => undefined,
            _w => { /* singleton via WidgetManager */ },
          );
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Open Project Selector failed'));
        }
        return undefined;
      },
    });

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

    // Same as Build but with clean:true — the backend wipes the
    // previous build output first. The Build view's "Clean Build"
    // button must run THIS (KAIRO-RC-WEB-007: it used to fire
    // buildAndDeploy, contradicting its label).
    registry.registerCommand(KairoCommands.CLEAN_BUILD, {
      execute: async () => {
        try {
          const p = await this.activeProject.requireProject();
          const result = await this.runtime.request('POST /api/v1/builds', { projectId: p.projectId, clean: true });
          this.messages.info(`Clean build ${result.state}.`);
          await this.refreshBuilds();
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, 'Clean build failed'));
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
        let serverId: string | undefined;
        try {
          const p = await this.activeProject.requireProject();
          const capability = await this.javaDebug.probeAvailability();
          if (capability.state !== 'available') {
            throw new Error(capability.message ?? 'Java Debug Adapter is unavailable');
          }
          const srv = await this.serverSvc.start(p.projectId, true);
          serverId = srv.id;
          const port = srv.ports.debug;
          if (!port) throw new Error('Tomcat started without a verified JDWP port');
          const status = await this.javaDebug.attach({
            serverId: srv.id,
            projectId: p.projectId,
            projectName: p.name,
            projectRoot: p.root,
            port,
          });
          this.messages.info(`Java Debug Adapter connected to JDWP 127.0.0.1:${port} (session ${status.sessionId}).`);
        } catch (err) {
          if (serverId) {
            try { await this.serverSvc.stop(serverId, false); } catch { /* preserve the attach error */ }
          }
          this.messages.error(kairoErrorMessage(err, 'Server debug start failed'));
        }
        return undefined;
      },
    });

    registry.registerCommand(KairoCommands.CHECK_DEBUG_ADAPTER, {
      execute: async () => {
        const status = await this.javaDebug.probeAvailability();
        if (status.state === 'available') this.messages.info('Java Debug Adapter is available.');
        else this.messages.warn(status.message ?? `Java Debug Adapter state: ${status.state}`);
        return status;
      },
    });

    registry.registerCommand(KairoCommands.OPEN_DEBUG_VIEW, {
      execute: () => this.commands.executeCommand('debug:toggle'),
    });
    registry.registerCommand(KairoCommands.OPEN_DEBUG_CONSOLE, {
      execute: () => this.commands.executeCommand('debug:console:toggle'),
    });

    registry.registerCommand(KairoCommands.STOP_SERVER, {
      execute: async () => {
        try {
          // A broken adapter must not prevent the owned Tomcat process from
          // being stopped. Preserve the debug error for the user, but continue
          // with server teardown as the authoritative cleanup boundary.
          let debugStopError: unknown;
          try { await this.javaDebug.stop(); } catch (error) { debugStopError = error; }
          const list = (await this.runtime.request('GET /api/v1/servers', undefined)) as ServerInstance[];
          // Only stop servers that are actually up — the agent
          // persists server metadata across sessions, so the list
          // contains stale stopped/error entries whose ids are dead
          // (stopping them used to fail the whole command).
          const alive = list.filter(s => s.state !== 'stopped' && s.state !== 'error' && s.state !== 'crashed');
          if (alive.length === 0) {
            this.messages.info('No running server.');
            return undefined;
          }
          const failures: string[] = [];
          for (const srv of alive) {
            try {
              await this.serverSvc.stop(srv.id, false);
              this.messages.info(`Server ${srv.id} stopped.`);
            } catch (err) {
              failures.push(`${srv.id}: ${(err as Error).message}`);
            }
          }
          if (failures.length > 0) {
            this.messages.error(`Failed to stop: ${failures.join('; ')}`);
          }
          if (debugStopError) {
            this.messages.warn(`Debug Adapter termination reported an error; Tomcat stop was still attempted: ${kairoErrorMessage(debugStopError, 'unknown error')}`);
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
          await this.activeProject.requireProject();
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
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_MAVEN, {
      execute: () => { void this.revealOrCreate(MavenViewWidget.ID, () => this.mavenView, w => { this.mavenView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_TODO, {
      execute: () => { void this.revealOrCreate(KairoTodoWidget.ID, () => this.todoView, w => { this.todoView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_TESTS, {
      execute: () => { void this.revealOrCreate(KAIRO_TESTS_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_PERF, {
      execute: () => { void this.revealOrCreate(KAIRO_PERF_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_SQL_CONSOLE, {
      execute: () => { void this.revealOrCreateMain(KAIRO_SQL_CONSOLE_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_REMOTE, {
      execute: () => { void this.revealOrCreateMain(KAIRO_REMOTE_FACTORY_ID, () => undefined, () => undefined); },
    });
    // ── Debug View Commands ──────────────────────────────────────
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEBUG_VARIABLES, {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_VARIABLES_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEBUG_CALLSTACK, {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_CALLSTACK_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEBUG_BREAKPOINTS, {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEBUG_TOOLBAR, {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_TOOLBAR_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEBUG_CONSOLE, {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_CONSOLE_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEBUG_WATCH, {
      execute: () => { void this.revealOrCreate(KAIRO_DEBUG_WATCH_FACTORY_ID, () => undefined, () => undefined); },
    });
    registry.registerCommand(KairoCommands.MANAGE_RUN_CONFIGURATIONS, {
      execute: () => { void this.revealOrCreateMain(KAIRO_RUN_CONFIGURATIONS_FACTORY_ID, () => undefined, () => undefined); },
    });
    // P1-INT-01: JDK switch — opens the project selector so the user
    // can switch to a different project / JDK configuration.
    registry.registerCommand(KairoCommands.SWITCH_JDK, {
      execute: async () => {
        try {
          await this.revealOrCreateMain<ProjectSelectorWidget>(
            KAIRO_PROJECT_SELECTOR_FACTORY_ID,
            () => undefined,
            _w => { /* singleton via WidgetManager */ },
          );
        } catch (err) {
          this.messages.error(kairoErrorMessage(err, '打开项目选择器失败'));
        }
        return undefined;
      },
    });
    // P1-INT-01: Agent reconnect — forces the EventStream to
    // disconnect and reconnect to the Runtime Agent.
    registry.registerCommand(KairoCommands.RECONNECT_AGENT, {
      execute: () => {
        this.runtime.disconnectEvents();
        this.runtime.openEvents();
        return undefined;
      },
    });

    // G1: P2-UX-01 — Open the Keyboard Shortcuts (Keymap) widget.
    registry.registerCommand(KairoCommands.OPEN_KEYMAP, {
      execute: () => {
        void this.revealOrCreateMain(KAIRO_KEYMAP_FACTORY_ID, () => undefined, () => undefined);
      },
    });

    // Terminal toggle — delegates to @theia/terminal's built-in command.
    registry.registerCommand(KairoCommands.TOGGLE_TERMINAL, {
      execute: () => this.commands.executeCommand('terminal:new'),
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

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_OPEN, {
      commandId: KairoCommands.IMPORT_PROJECT.id,
      label: 'Import Kairo Project...',
      order: 'a1',
    });
    menus.registerMenuAction(CommonMenus.FILE_OPEN, {
      commandId: KairoCommands.MANAGE_RUN_CONFIGURATIONS.id,
      label: 'Run Configurations...',
      order: 'a3',
    });
    menus.registerMenuAction(CommonMenus.FILE_OPEN, {
      commandId: KairoCommands.SELECT_PROJECT.id,
      label: 'Select Kairo Project...',
      order: 'a2',
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: KairoCommands.TOGGLE_TERMINAL.id,
      keybinding: 'alt+f12',
    });
  }

  protected async revealOrCreateMain<T extends Widget>(
    id: string,
    _getter: () => T | undefined,
    _setter: (w: T) => void,
  ): Promise<void> {
    const w = await this.widgetManager.getOrCreateWidget(id) as T;
    try {
      this.shell.addWidget(w, { area: 'main' });
    } catch (_e) {
      // Already attached — that's fine.
    }
    this.shell.activateWidget(w.id);
    w.update();
    // Focus the first focusable element in the target panel (D4.1)
    this.focusFirstFocusable(w.node);
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
    // `getOrCreateWidget` only creates the widget instance; it
    // does NOT add the widget to any visible shell area. We
    // attach it to the left sidebar (the canonical location for
    // the Servers / Builds / Deployments / Logs views) and only
    // then activate it. Without `addWidget`, the widget exists
    // in memory but never appears in the DOM, and `activateWidget`
    // is a silent no-op.
    try {
      this.shell.addWidget(w, { area: 'left' });
    } catch (_e) {
      // Already attached — that's fine.
    }
    this.shell.activateWidget(w.id);
    // `ReactWidget` only mounts its React tree on `onUpdateRequest`,
    // and theia 1.73 does not always fire that immediately after
    // `addWidget`. Force a render so the React content shows up
    // on first open (otherwise the node is just a `<div
    // class="kairo-widget">` shell with scrollbar placeholders and
    // no `data-testid`).
    w.update();
    // Focus the first focusable element in the target panel (D4.1)
    this.focusFirstFocusable(w.node);
  }

  protected async refreshBuilds(): Promise<void> {
    try {
      const list = (await this.runtime.request('GET /api/v1/builds', undefined)) as BuildResult[];
      if (Array.isArray(list)) {
        // KAIRO-RC-WEB-237: delegate to the null-tolerant mapper —
        // the inline version crashed on b.summary.errors for builds
        // whose compiler never ran (summary: null), killing the
        // whole refresh and leaving the Build view empty.
        const ws = this.runtime.workspace() ?? '';
        this.buildStore.setBuilds(list.map(b => mapBuildResult(b, ws)));
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

  protected handleEvent(e: WsEvent): void {
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
      // N-033: log events are handled by the LogViewerWidget's own
      // subscription; we forward them here to ensure the event stream
      // is known to carry log data.
      case 'log':
        return;
      default:
        return;
    }
  }

  /** Focus the first focusable element inside a container node (D4.1). */
  protected focusFirstFocusable(container: HTMLElement): void {
    const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const el = container.querySelector<HTMLElement>(selector);
    if (el) {
      // Use requestAnimationFrame to allow React/monaco to finish
      // rendering before attempting focus.
      requestAnimationFrame(() => el.focus());
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
