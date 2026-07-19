/**
 * Kairo status bar — the bottom-of-window strip that always
 * shows the current state of the IDE in one glance.
 *
 * We use the Theia `StatusBar` API to add a few left-aligned
 * entries and one right-aligned "runtime agent" indicator:
 *
 *   [Project: legacy-sample]  [Java: 1.8 → 1.6]  [Encoding: GBK]
 *   [Server: running  :61100]  [Runtime: connected]
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  StatusBar,
  StatusBarAlignment,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common/disposable';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { ServerStore } from '@kairo/tomcat-extension';
import { KairoJavaService, JavaServiceState } from '@kairo/java-extension';
import { KairoEncodingServiceImpl } from '@kairo/encoding-extension';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { ServerInstance } from '@kairo/protocol';

@injectable()
export class KairoStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) protected statusBar!: StatusBar;
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  @inject(KairoJavaService) protected javaSvc!: KairoJavaService;
  @inject(KairoEncodingServiceImpl) protected encodingSvc!: KairoEncodingServiceImpl;
  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(ServerStore) protected serverStore!: ServerStore;

  protected unsubscribeStatus: (() => void) | undefined;
  protected unsubscribeServerEvents: (() => void) | undefined;
  protected unsubscribeJdtState: (() => void) | undefined;
  protected unsubscribeEditor: Disposable | undefined;
  protected unsubscribeServerStore: Disposable | undefined;

  @postConstruct()
  init(): void {
    this.statusBar.setElement('kairo.project', {
      text: '$(file-directory) Project: (no workspace)',
      tooltip: 'Open a legacy Java Web project to get started.',
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
    });
    this.statusBar.setElement('kairo.java', {
      text: '$(coffee) Java: -',
      tooltip: 'Java compiler configuration',
      alignment: StatusBarAlignment.LEFT,
      priority: 99,
    });
    this.statusBar.setElement('kairo.jdtls', {
      text: '$(coffee) JDT LS: idle',
      tooltip: 'Eclipse JDT Language Server (skeleton — no LSP bridge yet)',
      alignment: StatusBarAlignment.LEFT,
      priority: 96,
    });
    this.statusBar.setElement('kairo.encoding', {
      text: '$(text) Encoding: -',
      tooltip: 'Encoding of the active editor (UTF-8 default)',
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
    });
    this.statusBar.setElement('kairo.server', {
      text: '$(server-process) Server: stopped',
      tooltip: 'Tomcat server status',
      alignment: StatusBarAlignment.LEFT,
      priority: 97,
    });
    this.statusBar.setElement('kairo.runtime', {
      text: '$(pulse) Runtime: connecting…',
      tooltip: 'Connection to the Go Runtime Agent',
      alignment: StatusBarAlignment.RIGHT,
      priority: 100,
    });
  }

  async onStart(_app: FrontendApplication): Promise<void> {
    this.unsubscribeStatus = this.runtime.onStatusChange(s => this.setRuntimeStatus(s));
    this.unsubscribeServerEvents = this.runtime.subscribeEvents(this.runtime.workspace(), (e: any) => {
      if (e.type === 'server.state') {
        void this.refreshServerStatus();
      }
    });
    this.unsubscribeJdtState = this.javaSvc.onState((s, st) => this.setJdtStatus(s, st));
    this.unsubscribeEditor = this.editorManager.onCurrentEditorChanged(() =>
      this.refreshEncodingStatus(),
    );
    // Pull the current JDT LS state once on start so the
    // status bar shows truth after a reconnect / window reload.
    void this.refreshJdtStatus();
    void this.refreshEncodingStatus();
    // Subscribe to ServerStore for server status updates.
    this.unsubscribeServerStore = this.serverStore.onDidChange(() => this.renderServerStatus());
    // Load initial server status from store.
    this.renderServerStatus();
  }

  onStop(): void {
    this.unsubscribeStatus?.();
    this.unsubscribeServerEvents?.();
    this.unsubscribeJdtState?.();
    this.unsubscribeEditor?.dispose();
    this.unsubscribeServerStore?.dispose();
  }

  /**
   * Map the JDT LS state machine to a status-bar entry.
   * The state field on the service is the local view
   * (uninitialized / starting / ready / crashed); the agent
   * status is the wire truth (stopped / starting / running /
   * stopping / crashed). Both are useful; we surface the
   * wire truth when we have it.
   */
  protected setJdtStatus(
    s: JavaServiceState,
    st?: { state: string; jre?: string; pid?: number; lastError?: string; version?: string },
  ): void {
    const local = s;
    const wire = st?.state;
    const effective: string = wire ?? local;
    const icon = (iconFor: string): string => {
      switch (iconFor) {
        case 'ready':
        case 'running':
          return '$(coffee)';
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
    const tooltipParts: string[] = [
      `Local: ${local}`,
      wire ? `Agent: ${wire}` : 'Agent: (no status yet)',
    ];
    if (st?.version) tooltipParts.push(`Version: ${st.version}`);
    if (st?.jre) tooltipParts.push(`JRE: ${st.jre}`);
    if (st?.pid) tooltipParts.push(`PID: ${st.pid}`);
    if (st?.lastError) tooltipParts.push(`Last error: ${st.lastError}`);
    tooltipParts.push(
      'Skeleton: HTTP state + status bar only. LSP frame bridge to Monaco is the next round (v0.3-jdt-ls-bridge).',
    );
    this.statusBar.setElement('kairo.jdtls', {
      text: `${icon(effective)} JDT LS: ${effective}`,
      tooltip: tooltipParts.join('\n'),
      alignment: StatusBarAlignment.LEFT,
      priority: 96,
    });
  }

  protected async refreshJdtStatus(): Promise<void> {
    const st = await this.javaSvc.refreshStatus();
    this.setJdtStatus(this.javaSvc.state$(), st);
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
        tooltip: 'No active editor',
        alignment: StatusBarAlignment.LEFT,
        priority: 98,
      });
      return;
    }
    const enc = this.encodingSvc.getEncodingFor(uri as any);
    const isOverride = enc !== 'utf-8';
    this.statusBar.setElement('kairo.encoding', {
      text: `$(text) Encoding: ${enc}${isOverride ? ' *' : ''}`,
      tooltip:
        `${uri.toString()}\n` +
        `Encoding: ${enc}${isOverride ? ' (override)' : ' (default)'}\n` +
        'Kairo: Reopen with Encoding / Save with Encoding to change.',
      alignment: StatusBarAlignment.LEFT,
      priority: 98,
    });
  }

  protected setRuntimeStatus(s: 'connecting' | 'open' | 'disconnected' | 'closed'): void {
    switch (s) {
      case 'open':
        this.statusBar.setElement('kairo.runtime', {
          text: '$(pulse) Runtime: connected',
          tooltip: 'Go Runtime Agent is reachable',
          alignment: StatusBarAlignment.RIGHT,
          priority: 100,
        });
        break;
      case 'connecting':
        this.statusBar.setElement('kairo.runtime', {
          text: '$(sync~spin) Runtime: connecting…',
          tooltip: 'Connecting to the Go Runtime Agent',
          alignment: StatusBarAlignment.RIGHT,
          priority: 100,
        });
        break;
      case 'disconnected':
        this.statusBar.setElement('kairo.runtime', {
          text: '$(error) Runtime: disconnected',
          tooltip: 'Cannot reach the Go Runtime Agent. Build/Run/Deploy will fail until it returns.',
          alignment: StatusBarAlignment.RIGHT,
          priority: 100,
        });
        break;
      case 'closed':
        this.statusBar.setElement('kairo.runtime', {
          text: '$(circle-slash) Runtime: closed',
          tooltip: 'The WebSocket to the Go Runtime Agent was closed by the client.',
          alignment: StatusBarAlignment.RIGHT,
          priority: 100,
        });
        break;
    }
  }

  protected renderServerStatus(): void {
    const servers = this.serverStore.getServers();
    const srv = servers[0];
    if (!srv) {
      this.statusBar.setElement('kairo.server', {
        text: '$(server-process) Server: stopped',
        tooltip: 'No running Tomcat server',
        alignment: StatusBarAlignment.LEFT,
        priority: 97,
      });
      return;
    }
    const port = srv.httpPort ? `:${srv.httpPort}` : '';
    const icon = srv.state === 'running' ? '$(server-process~spin)' : '$(server-process)';
    this.statusBar.setElement('kairo.server', {
      text: `${icon} Server: ${srv.state} ${port}`.trim(),
      tooltip: `Tomcat ${srv.state} (id=${srv.id})`,
      alignment: StatusBarAlignment.LEFT,
      priority: 97,
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
          pid: srv.pid || 0,
          startTime: srv.startedAt || '',
          url: srv.ports.http ? `http://127.0.0.1:${srv.ports.http}` : undefined,
        });
      }
      this.renderServerStatus();
    } catch (_err) {
      // Network blip — keep previous status from store.
    }
  }
}
