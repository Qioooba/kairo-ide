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
import { KairoRuntimeImpl, EventStream, KairoError } from '@kairo/runtime-extension';
import { KairoProjectService } from '@kairo/project-extension';
import { KairoServerService } from '@kairo/tomcat-extension';
import { KairoJavaService, JavaServiceState } from '@kairo/java-extension';
import type { ServerInstance } from '@kairo/protocol';

@injectable()
export class KairoStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) protected statusBar!: StatusBar;
  @inject(KairoRuntimeImpl) protected runtime!: KairoRuntimeImpl;
  @inject(KairoProjectService) protected projectSvc!: KairoProjectService;
  @inject(KairoServerService) protected serverSvc!: KairoServerService;
  @inject(KairoJavaService) protected javaSvc!: KairoJavaService;

  protected eventStream: EventStream | undefined;
  protected unsubscribeStatus: (() => void) | undefined;
  protected unsubscribeServerEvents: (() => void) | undefined;
  protected unsubscribeJdtState: (() => void) | undefined;
  protected pollTimer: ReturnType<typeof setInterval> | undefined;

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
      tooltip: 'Default file encoding',
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

  async onStart(app: FrontendApplication): Promise<void> {
    this.eventStream = this.runtime.openEvents();
    this.unsubscribeStatus = this.eventStream.onStatus(s => this.setRuntimeStatus(s));
    this.unsubscribeServerEvents = this.eventStream.on('server.state', () => this.refreshServerStatus());
    this.unsubscribeJdtState = this.javaSvc.onState((s, st) => this.setJdtStatus(s, st));
    // Pull the current JDT LS state once on start so the
    // status bar shows truth after a reconnect / window reload.
    void this.refreshJdtStatus();
    // Poll once on start so the user immediately sees the
    // current state. After that the WebSocket keeps things in sync.
    try {
      await this.runtime.request('GET /api/v1/health', undefined);
    } catch (err) {
      if (err instanceof KairoError) {
        this.statusBar.setElement('kairo.runtime', {
          text: '$(error) Runtime: error',
          tooltip: err.format(),
          alignment: StatusBarAlignment.RIGHT,
          priority: 100,
        });
      }
    }
    this.pollTimer = setInterval(() => {
      void this.refreshServerStatus();
      void this.refreshJdtStatus();
    }, 5_000);
  }

  onStop(): void {
    this.unsubscribeStatus?.();
    this.unsubscribeServerEvents?.();
    this.unsubscribeJdtState?.();
    this.eventStream?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
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

  protected async refreshServerStatus(): Promise<void> {
    try {
      const list = (await this.runtime.request('GET /api/v1/servers', undefined).catch(() => [])) as ServerInstance[];
      const srv = list[0];
      if (!srv) {
        this.statusBar.setElement('kairo.server', {
          text: '$(server-process) Server: stopped',
          tooltip: 'No running Tomcat server',
          alignment: StatusBarAlignment.LEFT,
          priority: 97,
        });
        return;
      }
      const port = srv.ports.http ? `:${srv.ports.http}` : '';
      const icon = srv.state === 'running' ? '$(server-process~spin)' : '$(server-process)';
      this.statusBar.setElement('kairo.server', {
        text: `${icon} Server: ${srv.state} ${port}`.trim(),
        tooltip: `Tomcat ${srv.state} (id=${srv.id})`,
        alignment: StatusBarAlignment.LEFT,
        priority: 97,
      });
    } catch {
      // Network blip — keep previous status.
    }
  }
}
