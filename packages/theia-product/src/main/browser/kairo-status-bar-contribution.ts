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
import { ServerStore } from '@kairo/tomcat-extension';
import { KairoJavaService, JavaServiceState } from '@kairo/java-extension';
import { KairoEncodingServiceImpl } from '@kairo/encoding-extension';
import { ActiveProjectService } from '@kairo/project-extension';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { BuildStore } from '@kairo/build-extension';
import type { ServerInstance, WsEvent } from '@kairo/protocol';
import URI from '@theia/core/lib/common/uri';
import { debugStatusBarPresentation, KairoJavaDebugService, type KairoJavaDebugStatus } from './kairo-java-debug-service';

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
  private runtimeStatus: 'connecting' | 'open' | 'disconnected' | 'closed' = 'disconnected';

  @postConstruct()
  init(): void {
    // ── Project: current project (kept for project selection) ──
    this.statusBar.setElement('kairo.project', {
      text: '$(file-directory) Project: (no workspace)',
      tooltip: '打开一个 Java Web 项目以开始使用。点击选择项目。',
      alignment: StatusBarAlignment.LEFT,
      priority: 101,
      command: 'kairo.project.select',
    });
    // ── JDK: current project JDK version ──────────────────────
    this.statusBar.setElement('kairo.jdk', {
      text: '$(code) JDK: -',
      tooltip: '当前项目 JDK 版本。点击切换 JDK。',
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      command: 'kairo.jdk.switch',
    });
    // ── Encoding: current file encoding ───────────────────────
    this.statusBar.setElement('kairo.encoding', {
      text: '$(text) Encoding: -',
      tooltip: '当前文件编码（默认 UTF-8）。点击以其他编码重新打开。',
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
      command: 'kairo.encoding.reopen',
    });
    // ── Build: last build result ──────────────────────────────
    this.statusBar.setElement('kairo.build', {
      text: '$(gear) Build: -',
      tooltip: '最近一次构建结果。点击打开构建面板。',
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
      command: 'kairo.view.builds',
    });
    // ── Server: Tomcat running status ─────────────────────────
    this.statusBar.setElement('kairo.server', {
      text: '$(server-process) Server: stopped',
      tooltip: 'Tomcat 服务器状态。点击打开服务器视图。',
      alignment: StatusBarAlignment.LEFT,
      priority: 97,
      command: 'kairo.view.servers',
    });
    // ── Debug: Debug session status (resolved lazily in onStart)
    // because KairoJavaDebugService transitively depends on
    // @theia/debug's DebugSessionManager, which has an async
    // @postConstruct and cannot be resolved during synchronous
    // FrontendApplicationContribution construction.
    // ── Agent: Runtime Agent connection status ────────────────
    this.statusBar.setElement('kairo.agent', {
      text: '$(pulse) Agent: 连接中…',
      tooltip: 'Runtime Agent 连接状态。点击重连。',
      alignment: StatusBarAlignment.LEFT,
      priority: 95,
      command: 'kairo.agent.reconnect',
    });
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
      this.renderDebugStatus({ state: 'unavailable', message: 'Java Debug service unavailable' });
    }
    // Subscribe to BuildStore for build status updates
    this.unsubscribeBuild = this.buildStore.onDidChange(() => this.renderBuildStatus());
    this.renderBuildStatus();
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
  }

  protected renderDebugStatus(status: Readonly<KairoJavaDebugStatus>): void {
    const presentation = debugStatusBarPresentation(status);
    this.statusBar.setElement('kairo.debug', {
      ...presentation,
      alignment: StatusBarAlignment.LEFT,
      priority: 96,
      command: 'kairo.debug.openView',
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
    if (!p) {
      this.statusBar.setElement('kairo.project', {
        text: '$(file-directory) Project: (no workspace)',
        tooltip: '打开一个 Java Web 项目以开始使用。点击选择项目。',
        alignment: StatusBarAlignment.LEFT,
        priority: 101,
        command: 'kairo.project.select',
      });
      return;
    }
    this.statusBar.setElement('kairo.project', {
      text: `$(file-directory) Project: ${p.name}`,
      tooltip: `${p.name}\n${p.root}\nWorkspace: ${p.workspaceId}\nProject: ${p.projectId}\n点击选择其他项目。`,
      alignment: StatusBarAlignment.LEFT,
      priority: 101,
      command: 'kairo.project.select',
    });
  }

  /**
   * Render the JDK status entry based on the JDT LS state.
   * Shows the current project JDK version from the JDT status.
   */
  protected setJdkStatus(
    s: JavaServiceState,
    st?: { state: string; jre?: string; pid?: number; lastError?: string; version?: string },
  ): void {
    const jre = st?.jre;
    const jdkVersion = jre ? extractJdkVersion(jre) : undefined;
    const local = s;
    const wire = st?.state;
    const effective: string = wire ?? local;
    const _icon = (iconFor: string): string => {
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
    const tooltipParts: string[] = [];
    if (jdkVersion) tooltipParts.push(`JDK: ${jdkVersion}`);
    if (jre) tooltipParts.push(`JRE 路径: ${jre}`);
    tooltipParts.push(`JDT LS 状态: ${effective}`);
    if (st?.version) tooltipParts.push(`JDT LS 版本: ${st.version}`);
    tooltipParts.push('点击切换 JDK。');
    this.statusBar.setElement('kairo.jdk', {
      text: jdkVersion ? `$(code) JDK: ${jdkVersion}` : `$(code) JDK: ${effective}`,
      tooltip: tooltipParts.join('\n'),
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      command: 'kairo.jdk.switch',
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
    const w = this.editorManager.currentEditor;
    const uri = w?.editor?.document?.uri;
    if (!uri) {
      this.statusBar.setElement('kairo.encoding', {
        text: '$(text) Encoding: -',
        tooltip: '没有活动编辑器',
        alignment: StatusBarAlignment.LEFT,
        priority: 99,
        command: 'kairo.encoding.reopen',
      });
      return;
    }
    const enc = this.encodingSvc.getEncodingFor(uri as unknown as URI);
    const isOverride = enc !== 'utf-8';
    this.statusBar.setElement('kairo.encoding', {
      text: `$(text) Encoding: ${enc}${isOverride ? ' *' : ''}`,
      tooltip:
        `${uri.toString()}\n` +
        `编码: ${enc}${isOverride ? ' (覆盖)' : ' (默认)'}\n` +
        '点击以其他编码重新打开。',
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
      command: 'kairo.encoding.reopen',
    });
  }

  protected setAgentStatus(s: 'connecting' | 'open' | 'disconnected' | 'closed'): void {
    switch (s) {
      case 'open':
        this.statusBar.setElement('kairo.agent', {
          text: '$(pulse) Agent: 已连接',
          tooltip: 'Runtime Agent 连接正常。点击重连。',
          alignment: StatusBarAlignment.LEFT,
          priority: 95,
          command: 'kairo.agent.reconnect',
        });
        break;
      case 'connecting':
        this.statusBar.setElement('kairo.agent', {
          text: '$(sync~spin) Agent: 连接中…',
          tooltip: '正在连接 Runtime Agent…',
          alignment: StatusBarAlignment.LEFT,
          priority: 95,
          command: 'kairo.agent.reconnect',
        });
        break;
      case 'disconnected':
        this.statusBar.setElement('kairo.agent', {
          text: '$(error) Agent: 已断开',
          tooltip: '无法连接到 Runtime Agent。构建/运行/部署将不可用。点击重连。',
          alignment: StatusBarAlignment.LEFT,
          priority: 95,
          command: 'kairo.agent.reconnect',
        });
        break;
      case 'closed':
        this.statusBar.setElement('kairo.agent', {
          text: '$(circle-slash) Agent: 已关闭',
          tooltip: 'Runtime Agent WebSocket 已被客户端关闭。点击重连。',
          alignment: StatusBarAlignment.LEFT,
          priority: 95,
          command: 'kairo.agent.reconnect',
        });
        break;
    }
  }

  /**
   * Render the build status entry based on the latest build
   * from the BuildStore. Shows the result of the most recent
   * build with status icon and summary.
   */
  protected renderBuildStatus(): void {
    const latest = this.buildStore.getLatestBuild();
    if (!latest) {
      this.statusBar.setElement('kairo.build', {
        text: '$(gear) Build: 无记录',
        tooltip: '暂无构建记录。点击打开构建面板。',
        alignment: StatusBarAlignment.LEFT,
        priority: 98,
        command: 'kairo.view.builds',
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
    this.statusBar.setElement('kairo.build', {
      text: `${icon} Build: ${latest.state}${summary}`,
      tooltip: [
        `构建 ID: ${latest.id}`,
        `状态: ${latest.state}`,
        latest.summary ? `结果: ${latest.summary}` : undefined,
        latest.startTime ? `开始: ${latest.startTime}` : undefined,
        latest.endTime ? `结束: ${latest.endTime}` : undefined,
        '点击打开构建面板。',
      ].filter(Boolean).join('\n'),
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
      command: 'kairo.view.builds',
    });
  }

  protected renderServerStatus(): void {
    if (this.runtimeStatus === 'disconnected' || this.runtimeStatus === 'closed') {
      this.statusBar.setElement('kairo.server', {
        text: '$(error) Server: 已断开',
        tooltip: '无法连接到 Runtime Agent。服务器命令不可用。点击打开服务器视图。',
        alignment: StatusBarAlignment.LEFT,
        priority: 97,
        command: 'kairo.view.servers',
      });
      return;
    }
    if (this.runtimeStatus === 'connecting') {
      this.statusBar.setElement('kairo.server', {
        text: '$(sync~spin) Server: 连接中…',
        tooltip: '正在连接 Runtime Agent…点击打开服务器视图。',
        alignment: StatusBarAlignment.LEFT,
        priority: 97,
        command: 'kairo.view.servers',
      });
      return;
    }
    const servers = this.serverStore.getServers();
    const srv = servers[0];
    if (!srv) {
      this.statusBar.setElement('kairo.server', {
        text: '$(server-process) Server: 已停止',
        tooltip: '没有运行中的 Tomcat 服务器。点击打开服务器视图。',
        alignment: StatusBarAlignment.LEFT,
        priority: 97,
        command: 'kairo.view.servers',
      });
      return;
    }
    const port = srv.httpPort ? `:${srv.httpPort}` : '';
    const debugPort = srv.debugPort ? ` · JDWP:${srv.debugPort}` : '';
    const icon = srv.state === 'running' ? '$(server-process~spin)' : '$(server-process)';
    this.statusBar.setElement('kairo.server', {
      text: `${icon} Server: ${srv.state} ${port}${debugPort}`.trim(),
      tooltip: srv.debugPort
        ? `Tomcat ${srv.state} (id=${srv.id}); JDWP 监听 ${srv.debugPort}。点击打开服务器视图。`
        : `Tomcat ${srv.state} (id=${srv.id})。点击打开服务器视图。`,
      alignment: StatusBarAlignment.LEFT,
      priority: 97,
      command: 'kairo.view.servers',
    });
  }

  protected async refreshServerStatus(): Promise<void> {
    try {
      const list = await this.runtime.request('GET /api/v1/servers', undefined);
      const servers = Array.isArray(list) ? list as ServerInstance[] : [];
      for (const srv of servers) {
        this.serverStore.upsertServer({
          id: srv.id,
          workspaceId: '',
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
      this.statusBar.setElement('kairo.agent', {
        text: '$(error) Agent: 已断开',
        tooltip: `无法连接到 Runtime Agent。${msg}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 95,
        command: 'kairo.agent.reconnect',
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
