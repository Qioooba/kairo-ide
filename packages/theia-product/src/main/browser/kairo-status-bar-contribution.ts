/**
 * Kairo status bar — unified bottom-of-window strip that
 * always shows the current state of the IDE in one glance.
 *
 * Six left-aligned items (P1-INT-01):
 *
 *   [JDK: 1.8]  [Encoding: GBK]  [Build: succeeded]
 *   [Server: running  :61100]  [Debug: connected]  [Agent: connected]
 *
 * Clickable entries carry a real command; the Agent item
 * supports reconnect on click.
 */

import { injectable, inject, postConstruct, Container } from '@theia/core/shared/inversify';
import {
  StatusBar,
  StatusBarAlignment,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common/disposable';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { ServerStore, type HotReloadStatus } from '@kairo/tomcat-extension';
import { KairoJavaService, JavaServiceState } from '@kairo/java-extension';
import { KairoEncodingServiceImpl } from '@kairo/encoding-extension';
import { ActiveProjectService } from '@kairo/project-extension';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { BuildStore } from '@kairo/build-extension';
import type { ServerInstance, WsEvent } from '@kairo/protocol';
import URI from '@theia/core/lib/common/uri';
import { debugStatusBarPresentation, KairoJavaDebugService, type KairoJavaDebugStatus } from './kairo-java-debug-service';
import { KairoI18nService } from '@kairo/i18n';

@injectable()
export class KairoStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) protected statusBar!: StatusBar;
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(WorkspaceContextService) protected workspaceContext!: WorkspaceContextService;
  @inject(KairoJavaService) protected javaSvc!: KairoJavaService;
  @inject(KairoEncodingServiceImpl) protected encodingSvc!: KairoEncodingServiceImpl;
  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(ServerStore) protected serverStore!: ServerStore;
  @inject(ActiveProjectService) protected activeProject!: ActiveProjectService;
  @inject(Container) protected readonly container!: Container;
  protected javaDebug: KairoJavaDebugService | undefined;
  @inject(BuildStore) protected buildStore!: BuildStore;
  @inject(KairoI18nService) protected i18n!: KairoI18nService;

  protected unsubscribeStatus: (() => void) | undefined;
  protected unsubscribeServerEvents: (() => void) | undefined;
  protected unsubscribeServerContext: Disposable | undefined;
  protected unsubscribeJdtState: (() => void) | undefined;
  protected unsubscribeEditor: Disposable | undefined;
  protected unsubscribeEncoding: Disposable | undefined;
  protected unsubscribeServerStore: Disposable | undefined;
  protected unsubscribeProject: Disposable | undefined;
  protected unsubscribeDebug: Disposable | undefined;
  protected unsubscribeBuild: Disposable | undefined;
  protected unsubscribeHotReload: Disposable | undefined;
  private runtimeStatus: 'connecting' | 'open' | 'disconnected' | 'closed' = 'disconnected';
  protected hasProject = false;
  protected lastHotReloadStatus: HotReloadStatus = 'synced';

  /** Returns true for status-bar texts that are placeholders/empty and should be visually dimmed. */
  private isPlaceholderText(text: string): boolean {
    // Normalize Theia codicon prefix (e.g. "$(file-directory) ") and optional session suffix.
    const normalized = text.replace(/^\$\([^)]+\)\s*/, '').replace(/\s*·\s*.*$/, '').replace(/…$/, '');
    return /(?:Project: \(no workspace\)|Project: \(not imported\)|JDK: -|JDK: crashed|JDK: not ready|JDK: stopped|JDK: uninitialized|Encoding: -|Build: -|Build: no record|Server: stopped|Server: disconnected|Server: unavailable|Server: connecting|Agent: disconnected|Agent: closed|Agent: connecting|HotReload: -|Debug: unknown|Debug: unavailable|Debug: terminated|Debug: none|SVN: not found|调试：无|项目：\(无工作区\)|项目：\(未导入\)|JDK：-|JDK：已崩溃|JDK：未就绪|JDK：已停止|编码：-|构建：-|构建：无记录|构建：空闲|构建：等待中|构建：运行中|构建：成功|构建：失败|构建：已取消|服务器：已停止|服务器：启动中|服务器：运行中|服务器：停止中|服务器：错误|服务器：已崩溃|服务器：已断开|服务器：不可用|服务器：连接中…|代理：已断开|代理：已关闭|代理：连接中…|热重载：-|SVN：未找到)$/.test(normalized);
  }

  /** Localized label for a build state (falls back to the raw state id). */
  private buildStateLabel(state: string): string {
    const key = `widget.builds.state.${state}`;
    const label = this.i18n.t(key as never);
    return label === key ? state : label;
  }

  /** Localized label for a server state (falls back to the raw state id). */
  private serverStateLabel(state: string): string {
    const key = `widget.servers.state.${state}`;
    const label = this.i18n.t(key as never);
    return label === key ? state : label;
  }

  /** Build a status-bar element class name that includes its logical group and optional placeholder marker. */
  private statusClass(group: number, placeholder?: boolean): string {
    return `kairo-statusbar-group-${group}${placeholder ? ' kairo-statusbar-placeholder' : ''}`;
  }

  /** Map a runtime/build/server state to a semantic status-bar CSS class. */
  private itemStateClass(state?: string): string {
    if (!state) return '';
    const map: Record<string, string> = {
      succeeded: 'kairo-statusbar-state-success',
      available: 'kairo-statusbar-state-success',
      connected: 'kairo-statusbar-state-success',
      synced: 'kairo-statusbar-state-success',
      running: 'kairo-statusbar-state-active',
      pending: 'kairo-statusbar-state-active',
      starting: 'kairo-statusbar-state-active',
      connecting: 'kairo-statusbar-state-active',
      compiling: 'kairo-statusbar-state-active',
      paused: 'kairo-statusbar-state-warning',
      restart_required: 'kairo-statusbar-state-warning',
      error: 'kairo-statusbar-state-error',
      failed: 'kairo-statusbar-state-error',
      crashed: 'kairo-statusbar-state-error',
      terminated: 'kairo-statusbar-state-error',
      disconnected: 'kairo-statusbar-state-error',
      closed: 'kairo-statusbar-state-error',
      cancelled: 'kairo-statusbar-state-neutral',
      stopped: 'kairo-statusbar-state-neutral',
      uninitialized: 'kairo-statusbar-state-neutral',
      unknown: 'kairo-statusbar-state-neutral',
    };
    return map[state] ?? '';
  }

  @postConstruct()
  init(): void {
    const t = this.i18n.t.bind(this.i18n);
    // ── Group 1: Project / JDK / Encoding ──
    const projectText = t('statusBar.noProject');
    this.statusBar.setElement('kairo.project', {
      text: `$(file-directory) ${projectText}`,
      tooltip: t('statusBar.projectTooltip'),
      alignment: StatusBarAlignment.LEFT,
      priority: 101,
      command: 'kairo.project.select',
      className: this.statusClass(1, this.isPlaceholderText(projectText)),
    });
    const jdkText = t('statusBar.jdk', { version: '-' });
    this.statusBar.setElement('kairo.jdk', {
      text: `$(code) ${jdkText}`,
      tooltip: t('statusBar.jdkTooltip'),
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      command: 'kairo.jdk.switch',
      className: this.statusClass(1, this.isPlaceholderText(jdkText)),
    });
    const encodingText = t('statusBar.noEncoding');
    this.statusBar.setElement('kairo.encoding', {
      text: `$(text) ${encodingText}`,
      tooltip: t('statusBar.encodingTooltip'),
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
      command: 'kairo.encoding.reopen',
      className: this.statusClass(1, this.isPlaceholderText(encodingText)),
    });
    // ── Group 2: Build / Server ──
    const buildText = t('statusBar.noBuild');
    this.statusBar.setElement('kairo.build', {
      text: `$(gear) ${buildText}`,
      tooltip: t('statusBar.buildTooltip'),
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
      command: 'kairo.view.builds',
      className: this.statusClass(2, this.isPlaceholderText(buildText)),
    });
    const serverText = t('statusBar.serverStopped');
    this.statusBar.setElement('kairo.server', {
      text: `$(server-process) ${serverText}`,
      tooltip: t('statusBar.serverTooltip'),
      alignment: StatusBarAlignment.LEFT,
      priority: 97,
      command: 'kairo.view.servers',
      className: this.statusClass(2, this.isPlaceholderText(serverText)),
    });
    // ── Group 3: Debug / Agent ──
    // Debug is resolved lazily in onStart because KairoJavaDebugService
    // transitively depends on @theia/debug's DebugSessionManager, which
    // has an async @postConstruct.
    const agentText = `$(pulse) ${t('statusBar.agentConnecting')}`;
    this.statusBar.setElement('kairo.agent', {
      text: agentText,
      tooltip: t('statusBar.agentTooltipConnecting'),
      alignment: StatusBarAlignment.LEFT,
      priority: 95,
      command: 'kairo.agent.reconnect',
      className: this.statusClass(3, this.isPlaceholderText(agentText)),
    });
    // ── Group 4: Hot Reload (hidden until a project is open) ──
    // Hot reload is only meaningful when a project is loaded; renderProjectStatus
    // will show or hide this entry once the active project state is known.
  }

  async onStart(_app: FrontendApplication): Promise<void> {
    this.unsubscribeStatus = this.runtime.onStatusChange(s => {
      this.runtimeStatus = s;
      this.setAgentStatus(s);
      this.renderServerStatus();
    });
    // N-031: use WorkspaceContextService for the canonical workspace ID.
    // The runtime.workspace() returns empty string on startup, which
    // prevents the WebSocket from opening and server events from flowing.
    const subscribeServerEvents = (workspaceId: string) => {
      this.unsubscribeServerEvents?.();
      this.unsubscribeServerEvents = this.runtime.subscribeEvents(workspaceId, (e: WsEvent) => {
        if (e.type === 'server.state') {
          void this.refreshServerStatus();
        }
      });
    };
    const ctx = this.workspaceContext.context;
    if (ctx) {
      subscribeServerEvents(ctx.workspaceId);
    }
    this.unsubscribeServerContext = this.workspaceContext.onDidChangeContext(c => {
      if (c) {
        subscribeServerEvents(c.workspaceId);
      }
    });
    this.unsubscribeJdtState = this.javaSvc.onState((s, st) => this.setJdkStatus(s, st));
    this.unsubscribeEditor = this.editorManager.onCurrentEditorChanged(() =>
      this.refreshEncodingStatus(),
    );
    this.unsubscribeEncoding = this.encodingSvc.onDidChangeEncoding(() =>
      this.refreshEncodingStatus(),
    );
    void this.refreshJdkStatus();
    void this.refreshEncodingStatus();
    this.unsubscribeServerStore = this.serverStore.onDidChange(() => this.renderServerStatus());
    this.renderServerStatus();
    this.unsubscribeProject = this.activeProject.onDidChangeProject(p => this.renderProjectStatus(p));
    this.renderProjectStatus(this.activeProject.project);
    // Resolve KairoJavaDebugService asynchronously so its transitive
    // async dependency (DebugSessionManager) does not break synchronous
    // FrontendApplicationContribution construction.
    try {
      this.javaDebug = await this.container.getAsync(KairoJavaDebugService);
      this.renderDebugStatus(this.javaDebug.currentStatus);
      this.unsubscribeDebug = this.javaDebug.onDidChangeStatus(status => this.renderDebugStatus(status));
    } catch (e) {
      console.error(`[kairo] Failed to initialize Java debug service in status bar: ${e instanceof Error ? e.message : String(e)}`);
      this.renderDebugStatus({ state: 'unavailable', message: this.i18n.t('statusBar.debugUnavailable') });
    }
    // Subscribe to BuildStore for build status updates
    this.unsubscribeBuild = this.buildStore.onDidChange(() => this.renderBuildStatus());
    this.renderBuildStatus();
    // Subscribe to ServerStore for hot reload status updates
    this.unsubscribeHotReload = this.serverStore.onHotReloadStatusChange(s => this.renderHotReloadStatus(s));
    this.renderHotReloadStatus(this.serverStore.getHotReloadStatus());
    // Language pack loads async after @postConstruct — refresh all
    // status texts once locale is ready / when the user switches language.
    this.i18n.onDidChangeLanguage(() => this.refreshAllStatusTexts());
  }

  /** Re-render every status-bar entry with the current locale. */
  protected refreshAllStatusTexts(): void {
    this.renderProjectStatus(this.activeProject.project);
    void this.refreshJdkStatus();
    void this.refreshEncodingStatus();
    this.renderBuildStatus();
    this.renderServerStatus();
    this.setAgentStatus(this.runtimeStatus);
    this.renderHotReloadStatus(this.lastHotReloadStatus);
    if (this.javaDebug) {
      this.renderDebugStatus(this.javaDebug.currentStatus);
    }
  }

  onStop(): void {
    this.unsubscribeStatus?.();
    this.unsubscribeServerEvents?.();
    this.unsubscribeServerContext?.dispose();
    this.unsubscribeJdtState?.();
    this.unsubscribeEditor?.dispose();
    this.unsubscribeEncoding?.dispose();
    this.unsubscribeServerStore?.dispose();
    this.unsubscribeProject?.dispose();
    this.unsubscribeDebug?.dispose();
    this.unsubscribeBuild?.dispose();
    this.unsubscribeHotReload?.dispose();
  }

  protected renderDebugStatus(status: Readonly<KairoJavaDebugStatus>): void {
    const t = this.i18n.t.bind(this.i18n);
    const presentation = debugStatusBarPresentation(status, t);
    this.statusBar.setElement('kairo.debug', {
      ...presentation,
      alignment: StatusBarAlignment.LEFT,
      priority: 96,
      command: 'kairo.debug.openView',
      className: `${this.statusClass(3, this.isPlaceholderText(presentation.text))} ${this.itemStateClass(status.state)}`.trim(),
    });
  }

  /**
   * Render the Project status entry based on the currently
   * active Kairo project. When no project is selected (e.g.
   * no workspace is open or the workspace contains no
   * project), the entry shows the legacy "(no workspace)"
   * placeholder so users get a clear hint that the Build
   * / Run / Deploy commands will be rejected.
   */
  protected renderProjectStatus(p?: { workspaceId: string; projectId: string; name: string; root: string }): void {
    const t = this.i18n.t.bind(this.i18n);
    this.hasProject = !!p;
    if (!p) {
      const text = t('statusBar.noProject');
      this.statusBar.setElement('kairo.project', {
        text: `$(file-directory) ${text}`,
        tooltip: t('statusBar.projectTooltip'),
        alignment: StatusBarAlignment.LEFT,
        priority: 101,
        command: 'kairo.project.select',
        className: this.statusClass(1, this.isPlaceholderText(text)),
      });
      this.renderHotReloadStatus(this.lastHotReloadStatus);
      return;
    }
    const text = t('statusBar.project', { name: p.name });
    this.statusBar.setElement('kairo.project', {
      text: `$(file-directory) ${text}`,
      tooltip: t('statusBar.projectTooltipWithName', { name: p.name, root: p.root, workspaceId: p.workspaceId, projectId: p.projectId }),
      alignment: StatusBarAlignment.LEFT,
      priority: 101,
      command: 'kairo.project.select',
      className: this.statusClass(1),
    });
    this.renderHotReloadStatus(this.lastHotReloadStatus);
  }

  /** Localize JDK lifecycle states used when no version is known yet. */
  protected jdkStateLabel(state: string): string {
    const map: Record<string, string> = {
      crashed: 'statusBar.jdkState.crashed',
      uninitialized: 'statusBar.jdkState.uninitialized',
      stopped: 'statusBar.jdkState.stopped',
      starting: 'statusBar.jdkState.starting',
      stopping: 'statusBar.jdkState.stopping',
      ready: 'statusBar.jdkState.ready',
      running: 'statusBar.jdkState.running',
    };
    const key = map[state];
    return key ? this.i18n.t(key as any) : state;
  }

  protected setJdkStatus(
    s: JavaServiceState,
    st?: { state: string; jre?: string; pid?: number; lastError?: string; version?: string; javaMajor?: number },
  ): void {
    const t = this.i18n.t.bind(this.i18n);
    const jre = st?.jre;
    const jdkVersion = st?.javaMajor !== undefined
      ? String(st.javaMajor)
      : jre
        ? extractJdkVersion(jre)
        : undefined;
    const local = s;
    const wire = st?.state;
    const effective: string = wire ?? local;
    const icon = (iconFor: string): string => {
      switch (iconFor) {
        case 'ready':
        case 'running':
          return '$(check)';
        case 'starting':
          return '$(sync~spin)';
        case 'stopping':
          return '$(debug-stop)';
        case 'crashed':
          return '$(error)';
        case 'stopped':
        case 'uninitialized':
        default:
          return '$(circle-outline)';
      }
    };
    const versionOrState = jdkVersion ?? this.jdkStateLabel(effective);
    const text = t('statusBar.jdk', { version: versionOrState });
    const tooltip = t('statusBar.jdkTooltipFull', {
      version: jdkVersion ?? this.jdkStateLabel(effective),
      jre: jre ?? '',
      state: this.jdkStateLabel(effective),
      lsVersion: st?.version ?? '',
    });
    this.statusBar.setElement('kairo.jdk', {
      text: `${icon(effective)} ${text}`,
      tooltip,
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      command: 'kairo.jdk.switch',
      className: `${this.statusClass(1, this.isPlaceholderText(text))} ${this.itemStateClass(effective)}`.trim(),
    });
  }

  protected async refreshJdkStatus(): Promise<void> {
    const st = await this.javaSvc.refreshStatus();
    this.setJdkStatus(this.javaSvc.state$(), st);
  }

  /**
   * Render the encoding of the active editor. The encoding
   * service keeps a per-URI override; the EncodingRegistry
   * is the source of truth, this is just the rendering.
   */
  protected refreshEncodingStatus(): void {
    const t = this.i18n.t.bind(this.i18n);
    const w = this.editorManager.currentEditor;
    const uri = w?.editor?.document?.uri;
    if (!uri) {
      const text = t('statusBar.noEncoding');
      this.statusBar.setElement('kairo.encoding', {
        text: `$(text) ${text}`,
        tooltip: t('statusBar.encodingTooltip'),
        alignment: StatusBarAlignment.LEFT,
        priority: 99,
        command: 'kairo.encoding.reopen',
        className: this.statusClass(1, this.isPlaceholderText(text)),
      });
      return;
    }
    const enc = this.encodingSvc.getEncodingFor(uri as unknown as URI);
    const isOverride = enc !== 'utf-8';
    const text = t('statusBar.encoding', { encoding: enc });
    const tooltipKey = isOverride ? 'statusBar.encodingTooltipWithPathOverride' : 'statusBar.encodingTooltipWithPathDefault';
    this.statusBar.setElement('kairo.encoding', {
      text: `$(text) ${text}${isOverride ? ' *' : ''}`,
      tooltip: t(tooltipKey, { path: uri.toString(), encoding: enc }),
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
      command: 'kairo.encoding.reopen',
      className: this.statusClass(1),
    });
  }

  protected setAgentStatus(s: 'connecting' | 'open' | 'disconnected' | 'closed'): void {
    const t = this.i18n.t.bind(this.i18n);
    const configs: Record<typeof s, { text: string; tooltip: string }> = {
      open: { text: `$(pulse) ${t('statusBar.agentConnected')}`, tooltip: t('statusBar.agentTooltipConnected') },
      connecting: { text: `$(sync~spin) ${t('statusBar.agentConnecting')}`, tooltip: t('statusBar.agentTooltipConnecting') },
      disconnected: { text: `$(error) ${t('statusBar.agentDisconnected')}`, tooltip: t('statusBar.agentTooltipDisconnected') },
      closed: { text: `$(circle-slash) ${t('statusBar.agentClosed')}`, tooltip: t('statusBar.agentTooltipClosed') },
    };
    const config = configs[s];
    this.statusBar.setElement('kairo.agent', {
      text: config.text,
      tooltip: config.tooltip,
      alignment: StatusBarAlignment.LEFT,
      priority: 95,
      command: 'kairo.agent.reconnect',
      className: `${this.statusClass(3, this.isPlaceholderText(config.text))} ${this.itemStateClass(s === 'open' ? 'connected' : s)}`.trim(),
    });
  }

  /**
   * Render the build status entry based on the latest build
   * from the BuildStore. Shows the result of the most recent
   * build with status icon and summary.
   */
  protected renderBuildStatus(): void {
    const t = this.i18n.t.bind(this.i18n);
    const latest = this.buildStore.getLatestBuild();
    if (!latest) {
      const text = t('statusBar.noBuildRecord');
      this.statusBar.setElement('kairo.build', {
        text: `$(gear) ${text}`,
        tooltip: t('statusBar.buildTooltip'),
        alignment: StatusBarAlignment.LEFT,
        priority: 98,
        command: 'kairo.view.builds',
        className: this.statusClass(2, this.isPlaceholderText(text)),
      });
      return;
    }
    const icon = (() => {
      switch (latest.state) {
        case 'succeeded': return '$(check)';
        case 'running':
        case 'pending': return '$(sync~spin)';
        case 'failed': return '$(error)';
        case 'cancelled': return '$(circle-slash)';
        default: return '$(gear)';
      }
    })();
    const summary = latest.summary ? ` · ${latest.summary}` : '';
    const buildLabel = this.buildStateLabel(latest.state);
    const text = t('statusBar.build', { state: buildLabel });
    this.statusBar.setElement('kairo.build', {
      text: `${icon} ${text}${summary}`,
      tooltip: t('statusBar.buildTooltipWithDetails', {
        id: latest.id,
        state: buildLabel,
        summary: latest.summary ?? '',
        startTime: latest.startTime ?? '',
        endTime: latest.endTime ?? '',
      }),
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
      command: 'kairo.view.builds',
      className: `${this.statusClass(2)} ${this.itemStateClass(latest.state)}`.trim(),
    });
  }

  protected renderServerStatus(): void {
    const t = this.i18n.t.bind(this.i18n);
    const setServerElement = (text: string, tooltip: string, state?: string) => {
      this.statusBar.setElement('kairo.server', {
        text,
        tooltip,
        alignment: StatusBarAlignment.LEFT,
        priority: 97,
        command: 'kairo.view.servers',
        className: `${this.statusClass(2, this.isPlaceholderText(text))} ${this.itemStateClass(state)}`.trim(),
      });
    };
    if (this.runtimeStatus === 'disconnected' || this.runtimeStatus === 'closed') {
      setServerElement(`$(error) ${t('statusBar.serverDisconnected')}`, t('statusBar.serverTooltip'), this.runtimeStatus);
      return;
    }
    if (this.runtimeStatus === 'connecting') {
      setServerElement(`$(sync~spin) ${t('statusBar.serverConnecting')}`, t('statusBar.serverTooltip'), this.runtimeStatus);
      return;
    }
    const servers = this.serverStore.getServers();
    const srv = servers[0];
    if (!srv) {
      setServerElement(`$(server-process) ${t('statusBar.serverStopped')}`, t('statusBar.serverTooltip'), 'stopped');
      return;
    }
    const port = srv.httpPort ? `:${srv.httpPort}` : '';
    const debugPort = srv.debugPort ? `· JDWP:${srv.debugPort}` : '';
    const icon = srv.state === 'running' ? '$(server-process~spin)' : '$(server-process)';
    const extras = [port, debugPort].filter(Boolean).join(' ');
    const serverLabel = this.serverStateLabel(srv.state);
    const label = t('statusBar.server', { state: serverLabel });
    const text = extras ? `${label} ${extras}` : label;
    setServerElement(`${icon} ${text}`, srv.debugPort
      ? t('statusBar.serverTooltipWithPorts', { state: serverLabel, id: srv.id, debugPort: srv.debugPort })
      : t('statusBar.serverTooltipNoDebug', { state: serverLabel, id: srv.id }), srv.state);
  }

  /**
   * Render the Hot Reload status entry based on the current
   * hot reload status from the ServerStore.
   */
  protected renderHotReloadStatus(status: HotReloadStatus): void {
    this.lastHotReloadStatus = status;
    if (!this.hasProject) {
      void this.statusBar.removeElement('kairo.hotReload');
      return;
    }
    const t = this.i18n.t.bind(this.i18n);
    switch (status) {
      case 'synced':
        this.statusBar.setElement('kairo.hotReload', {
          text: `$(check) ${t('statusBar.hotReloadSynced')}`,
          tooltip: t('statusBar.hotReloadTooltipSynced'),
          alignment: StatusBarAlignment.LEFT,
          priority: 94,
          command: 'kairo.view.servers',
          className: `${this.statusClass(4)} ${this.itemStateClass('synced')}`.trim(),
        });
        break;
      case 'compiling':
        this.statusBar.setElement('kairo.hotReload', {
          text: `$(sync~spin) ${t('statusBar.hotReloadCompiling')}`,
          tooltip: t('statusBar.hotReloadTooltipCompiling'),
          alignment: StatusBarAlignment.LEFT,
          priority: 94,
          command: 'kairo.view.servers',
          className: `${this.statusClass(4)} ${this.itemStateClass('compiling')}`.trim(),
        });
        break;
      case 'restart_required':
        this.statusBar.setElement('kairo.hotReload', {
          text: `$(warning) ${t('statusBar.hotReloadRestartRequired')}`,
          tooltip: t('statusBar.hotReloadTooltipRestart'),
          alignment: StatusBarAlignment.LEFT,
          priority: 94,
          command: 'kairo.view.servers',
          className: `${this.statusClass(4)} ${this.itemStateClass('restart_required')}`.trim(),
        });
        break;
    }
  }

  protected async refreshServerStatus(): Promise<void> {
    try {
      const list = await this.runtime.request('GET /api/v1/servers', undefined);
      const servers = Array.isArray(list) ? list as ServerInstance[] : [];
      const workspaceId = this.workspaceContext.context?.workspaceId || this.runtime.workspace() || '';
      for (const srv of servers) {
        this.serverStore.upsertServer({
          id: srv.id,
          workspaceId,
          projectId: srv.projectId,
          state: srv.state,
          httpPort: srv.ports.http || 0,
          debugPort: srv.ports.debug || 0,
          pid: srv.pid || 0,
          startTime: srv.startedAt || '',
          url: srv.ports.http ? `http://127.0.0.1:${srv.ports.http}` : undefined,
        });
      }
      this.renderServerStatus();
    } catch (err) {
      // Network blip or agent unreachable — keep previous status from store,
      // but update the runtime status bar entry to reflect the error.
      const msg = err instanceof Error ? err.message : String(err);
      const text = `$(error) ${this.i18n.t('statusBar.agentDisconnected')}`;
      this.statusBar.setElement('kairo.agent', {
        text,
        tooltip: this.i18n.t('statusBar.agentDisconnectedTooltip', { message: msg }),
        alignment: StatusBarAlignment.LEFT,
        priority: 95,
        command: 'kairo.agent.reconnect',
        className: this.statusClass(3, this.isPlaceholderText(text)),
      });
    }
  }
}

/**
 * Extract a human-readable JDK version from a JRE path string.
 * E.g., "/usr/lib/jvm/java-8-openjdk" → "1.8"
 *       "/usr/lib/jvm/jdk-11.0.20" → "11"
 */
function extractJdkVersion(jrePath: string): string | undefined {
  // Try to match common patterns: java-8, jdk-11.0.20, jdk1.8.0_202, etc.
  const patterns = [
    /java-(\d+)/i,
    /jdk-?(\d+[.\d]*)/i,
    /jdk(\d+[.\d]*)/i,
    /jre-?(\d+[.\d]*)/i,
    /jre(\d+[.\d]*)/i,
  ];
  for (const p of patterns) {
    const m = p.exec(jrePath);
    if (m) {
      const v = m[1];
      // Normalize: "1.8" → "8", "11.0.20" → "11"
      if (v.startsWith('1.')) return v;
      const major = v.split('.')[0];
      return major;
    }
  }
  return undefined;
}
