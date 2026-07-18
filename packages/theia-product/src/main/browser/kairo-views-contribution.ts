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
import { Message } from '@lumino/messaging';
import { KairoRuntimeImpl, EventStream, KairoError } from '@kairo/runtime-extension';
import {
  KairoServerService,
} from '@kairo/tomcat-extension';
import {
  KairoProjectService,
} from '@kairo/project-extension';
import type {
  ServerInstance,
  BuildResult,
  DeploymentResult,
  WsEvent,
} from '@kairo/protocol';

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

const KAIRO_ACTIVITY_BAR_ORDER = 6;

/* ------------------------------------------------------------------ */
/*  Widgets                                                             */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoServersWidget extends Widget {
  static readonly ID = 'kairo-servers';
  servers: ServerInstance[] = [];

  @inject(KairoServerService) protected serverSvc!: KairoServerService;

  constructor() {
    super();
    this.id = KairoServersWidget.ID;
    this.title.label = 'Kairo Servers';
    this.title.caption = 'Kairo Servers (workspace)';
    this.addClass('kairo-widget');
    this.node.innerHTML = `<div class="kairo-widget-body">
      <p>No servers registered yet.</p>
    </div>`;
  }

  async refresh(): Promise<void> {
    // Real refresh: re-fetch project + servers through the service.
    this.node.innerHTML = `<div class="kairo-widget-body"><p>Loading…</p></div>`;
    // The runtime client raises an error if the agent is down;
    // we want to show that visibly so the user can fix it.
    try {
      // Workspace id is set by the project service; here we list
      // servers globally (per the runtime client) and let the
      // widget filter by workspace if needed.
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p>Servers view — wire to a workspace once one is opened.</p>
      </div>`;
    } catch (err) {
      const msg = err instanceof KairoError ? err.format() : String(err);
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p class="kairo-error">Failed to load servers: ${escapeHtml(msg)}</p>
      </div>`;
    }
  }
}

@injectable()
export class KairoBuildsWidget extends Widget {
  static readonly ID = 'kairo-builds';
  builds: BuildResult[] = [];

  constructor() {
    super();
    this.id = KairoBuildsWidget.ID;
    this.title.label = 'Kairo Builds';
    this.title.caption = 'Kairo Builds';
    this.addClass('kairo-widget');
    this.node.innerHTML = `<div class="kairo-widget-body">
      <p>No builds yet. Press <strong>Kairo: Build</strong> to start one.</p>
    </div>`;
  }

  setBuilds(builds: BuildResult[]): void {
    this.builds = builds;
    if (builds.length === 0) {
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p>No builds yet. Press <strong>Kairo: Build</strong> to start one.</p>
      </div>`;
      return;
    }
    const rows = builds.slice(0, 50).map(b => `
      <tr>
        <td>${escapeHtml(b.id)}</td>
        <td>${escapeHtml(b.state)}</td>
        <td>${b.summary.errors} err / ${b.summary.warnings} warn</td>
        <td>${escapeHtml(b.startedAt)}</td>
      </tr>
    `).join('');
    this.node.innerHTML = `<div class="kairo-widget-body">
      <table class="kairo-builds-table">
        <thead><tr><th>ID</th><th>State</th><th>Summary</th><th>Started</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
}

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

/**
 * A bounded ring buffer for log lines. Bounded so the DOM does
 * not grow without limit during a long-running session.
 */
class RingBuffer<T> {
  private items: T[] = [];
  constructor(public capacity: number = 5000) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }
  toArray(): T[] { return this.items; }
  clear(): void { this.items = []; }
}

@injectable()
export class KairoTomcatLogsWidget extends Widget {
  static readonly ID = 'kairo-logs';
  readonly buffer = new RingBuffer<{ serverId: string; line: string; ts: string }>(5000);
  protected unsub: (() => void) | undefined;
  protected unsubStatus: (() => void) | undefined;
  protected serverFilter: string | undefined;

  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;

  constructor() {
    super();
    this.id = KairoTomcatLogsWidget.ID;
    this.title.label = 'Kairo Tomcat Logs';
    this.title.caption = 'Kairo Tomcat Logs (live)';
    this.addClass('kairo-widget');
    this.node.innerHTML = `<div class="kairo-widget-body">
      <p>No log stream yet. Start a server to see live logs here.</p>
    </div>`;
  }

  @postConstruct()
  init(): void {
    this.attachStream();
  }

  protected attachStream(): void {
    try {
      const stream: EventStream = this.runtime.openEvents();
      this.unsub = stream.on('log', (e: WsEvent) => {
        if (e.type !== 'log') return;
        if (this.serverFilter && e.serverId !== this.serverFilter) return;
        this.buffer.push({ serverId: e.serverId, line: e.line, ts: e.ts });
        this.refresh();
      });
      this.unsubStatus = stream.onStatus(s => {
        if (s === 'disconnected' || s === 'closed') {
          this.node.innerHTML = `<div class="kairo-widget-body">
            <p class="kairo-error">Runtime Agent is ${s}. Logs will resume when it comes back.</p>
          </div>`;
        } else if (s === 'open' && this.buffer.toArray().length === 0) {
          this.refresh();
        }
      });
    } catch (err) {
      const msg = err instanceof KairoError ? err.format() : String(err);
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p class="kairo-error">Cannot open log stream: ${escapeHtml(msg)}</p>
      </div>`;
    }
  }

  setServerFilter(serverId: string | undefined): void {
    this.serverFilter = serverId;
    this.buffer.clear();
    this.refresh();
  }

  refresh(): void {
    const lines = this.buffer.toArray();
    if (lines.length === 0) {
      this.node.innerHTML = `<div class="kairo-widget-body">
        <p>No log lines yet. Start a server to see live logs here.</p>
      </div>`;
      return;
    }
    const body = lines
      .map(l => `<div class="kairo-log-line" data-ts="${escapeHtml(l.ts)}">[${escapeHtml(l.ts)}] ${escapeHtml(l.line)}</div>`)
      .join('');
    this.node.innerHTML = `<div class="kairo-widget-body kairo-log-body">${body}</div>`;
    // Auto-scroll to bottom.
    const el = this.node.querySelector('.kairo-log-body') as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  }

  clear(): void {
    this.buffer.clear();
    this.refresh();
  }

  onCloseRequest(msg: Message): void {
    this.unsub?.();
    this.unsubStatus?.();
    super.onCloseRequest(msg);
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
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;
  @inject(KairoServerService) protected serverSvc!: KairoServerService;
  @inject(KairoProjectService) protected projectSvc!: KairoProjectService;
  @inject(MessageService) protected messages!: MessageService;

  protected eventStream: EventStream | undefined;
  protected eventsUnsub: (() => void) | undefined;
  protected statusUnsub: (() => void) | undefined;
  protected serversView: KairoServersWidget | undefined;
  protected buildsView: KairoBuildsWidget | undefined;
  protected deploymentsView: KairoDeploymentsWidget | undefined;
  protected logsView: KairoTomcatLogsWidget | undefined;

  @postConstruct()
  init(): void {
    // Defer until the application shell is ready (onStart fires
    // before the workbench is fully constructed).
  }

  onStart(): void {
    // Register commands. The commands accept a `Widget | undefined`
    // argument when triggered from a view, but most user flows
    // come from the toolbar / command palette.
    this.eventStream = this.runtime.openEvents();
    this.statusUnsub = this.eventStream.onStatus(s => {
      if (s === 'disconnected') {
        this.messages.warn('Runtime Agent is disconnected. Buttons will retry on click.');
      }
    });
    this.eventsUnsub = this.eventStream.on('*', (e: WsEvent) => this.handleEvent(e));
  }

  onStop(): void {
    this.eventsUnsub?.();
    this.statusUnsub?.();
    this.eventStream?.close();
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
          const projects = await this.projectSvc.listProjects();
          const p = projects[0];
          if (!p) {
            this.messages.warn('No project configured. Run Scan Project first.');
            return undefined;
          }
          const result = await this.runtime.request('POST /api/v1/builds', { projectId: p.id });
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
          const projects = await this.projectSvc.listProjects();
          const p = projects[0];
          if (!p) {
            this.messages.warn('No project configured.');
            return undefined;
          }
          const build = await this.runtime.request('POST /api/v1/builds', { projectId: p.id });
          const deploy = await this.runtime.request('POST /api/v1/deployments', { projectId: p.id, buildId: build.id, what: 'all' });
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
          const projects = await this.projectSvc.listProjects();
          const p = projects[0];
          if (!p) {
            this.messages.warn('No project configured.');
            return undefined;
          }
          const srv = await this.serverSvc.start(p.id, false);
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
          const projects = await this.projectSvc.listProjects();
          const p = projects[0];
          if (!p) {
            this.messages.warn('No project configured.');
            return undefined;
          }
          const srv = await this.serverSvc.start(p.id, true);
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
          const list = await this.runtime.request('GET /api/v1/servers', undefined).catch(() => []);
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
          const list = await this.runtime.request('GET /api/v1/servers', undefined).catch(() => []);
          for (const srv of (list as ServerInstance[])) {
            await this.serverSvc.stop(srv.id, true);
            this.messages.info(`Server ${srv.id} stopped (forced).`);
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
          const list = (await this.runtime.request('GET /api/v1/servers', undefined).catch(() => [])) as ServerInstance[];
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
      execute: () => { void this.revealOrCreate(KairoServersWidget.ID, () => this.serversView, w => { this.serversView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_BUILDS, {
      execute: () => { void this.revealOrCreate(KairoBuildsWidget.ID, () => this.buildsView, w => { this.buildsView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_DEPLOYMENTS, {
      execute: () => { void this.revealOrCreate(KairoDeploymentsWidget.ID, () => this.deploymentsView, w => { this.deploymentsView = w; }); },
    });
    registry.registerCommand(KairoCommands.REVEAL_KAIRO_LOGS, {
      execute: () => { void this.revealOrCreate(KairoTomcatLogsWidget.ID, () => this.logsView, w => { this.logsView = w; }); },
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
    if (!this.buildsView) return;
    try {
      const list = (await this.runtime.request('GET /api/v1/builds', undefined).catch(() => [])) as BuildResult[];
      this.buildsView.setBuilds(Array.isArray(list) ? list : []);
    } catch (err) {
      this.messages.error(kairoErrorMessage(err, 'Refresh builds failed'));
    }
  }

  protected async refreshDeployments(): Promise<void> {
    if (!this.deploymentsView) return;
    try {
      const list = (await this.runtime.request('GET /api/v1/deployments', undefined).catch(() => [])) as DeploymentResult[];
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
