import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { DebugService } from '@theia/debug/lib/common/debug-service';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import {
  createKairoJavaAttachConfiguration,
  KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV,
  KAIRO_JAVA_DEBUG_TYPE,
  type KairoJavaAttachTarget,
} from '../common/kairo-java-debug';

/** Browser-safe token keeps the service testable without loading Monaco DOM code. */
export const KairoDebugSessionManager = Symbol('KairoDebugSessionManager');

export type KairoJavaDebugState =
  | 'unknown'
  | 'unavailable'
  | 'available'
  | 'connecting'
  | 'connected'
  | 'paused'
  | 'terminated'
  | 'error';

export interface KairoJavaDebugStatus {
  state: KairoJavaDebugState;
  sessionId?: string;
  serverId?: string;
  message?: string;
}

@injectable()
export class KairoJavaDebugService {
  @inject(DebugService) protected readonly debugService!: DebugService;
  @inject(KairoDebugSessionManager) protected readonly sessions!: DebugSessionManager;

  protected status: KairoJavaDebugStatus = { state: 'unknown' };
  protected stopRequested = false;
  protected readonly statusEmitter = new Emitter<KairoJavaDebugStatus>();
  readonly onDidChangeStatus: Event<KairoJavaDebugStatus> = this.statusEmitter.event;

  get currentStatus(): Readonly<KairoJavaDebugStatus> {
    return this.status;
  }

  @postConstruct()
  protected init(): void {
    this.sessions.onDidStopDebugSession(session => {
      if (this.status.sessionId === session.id) {
        this.update({ ...this.status, state: 'paused', message: 'Paused at a verified DAP stop event.' });
      }
    });
    this.sessions.onDidChange(session => {
      // Theia 1.73 DebugState.Running is 2. Do not import DebugState here:
      // that browser module eagerly loads Monaco DOM code and breaks the
      // browser-safe service boundary used by backend/unit tests.
      if (session && this.status.sessionId === session.id && this.status.state === 'paused' && this.sessions.state === 2) {
        this.update({ ...this.status, state: 'connected', message: undefined });
      }
    });
    this.sessions.onDidDestroyDebugSession(session => this.handleDestroyed(session.id));
  }

  async probeAvailability(): Promise<KairoJavaDebugStatus> {
    if (this.status.state === 'connecting' || this.status.state === 'connected' || this.status.state === 'paused') {
      return this.status;
    }
    try {
      const configurations = await this.debugService.provideDebugConfigurations(KAIRO_JAVA_DEBUG_TYPE, undefined);
      if (configurations.some(configuration => configuration.type === KAIRO_JAVA_DEBUG_TYPE)) {
        this.update({ state: 'available' });
      } else {
        this.update({
          state: 'unavailable',
          message: `No Java Debug Adapter is configured. Set ${KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV} to an approved DAP-over-stdio executable.`,
        });
      }
    } catch (error) {
      this.update({ state: 'error', message: toMessage(error) });
    }
    return this.status;
  }

  async attach(target: KairoJavaAttachTarget): Promise<KairoJavaDebugStatus> {
    if (this.status.state === 'connecting' || this.status.state === 'connected' || this.status.state === 'paused') {
      throw new Error(`Java Debug session is already ${this.status.state}`);
    }
    this.stopRequested = false;
    const capability = await this.probeAvailability();
    if (capability.state !== 'available') {
      throw new Error(capability.message ?? 'Java Debug Adapter is unavailable');
    }

    const configuration = createKairoJavaAttachConfiguration(target);
    this.update({ state: 'connecting', serverId: target.serverId });
    let createdSession: ReturnType<DebugSessionManager['getSession']>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedDisposable: { dispose(): void } | undefined;
    let destroyedDisposable: { dispose(): void } | undefined;
    try {
      // DebugSessionManager.start returns as soon as the browser session object
      // is created. Only onDidStartDebugSession proves that DAP initialize and
      // the attach request both succeeded, so never label the earlier boundary
      // as connected.
      const started = new Promise<{ id: string }>((resolve, reject) => {
        startedDisposable = this.sessions.onDidStartDebugSession(session => {
          if (session.configuration.type === KAIRO_JAVA_DEBUG_TYPE &&
              session.configuration.__kairoServerId === target.serverId) {
            resolve(session);
          }
        });
        destroyedDisposable = this.sessions.onDidDestroyDebugSession(session => {
          if (session.configuration.type === KAIRO_JAVA_DEBUG_TYPE &&
              session.configuration.__kairoServerId === target.serverId) {
            reject(new Error('Java Debug Adapter session ended before attach completed'));
          }
        });
        timer = setTimeout(
          () => reject(new Error(`Java Debug Adapter attach timed out after ${this.attachTimeoutMs()}ms`)),
          this.attachTimeoutMs(),
        );
      });

      const session = await this.sessions.start({
        name: configuration.name,
        configuration,
        workspaceFolderUri: fileUri(target.projectRoot),
        startedByUser: true,
      });
      if (!session || typeof session === 'boolean') {
        throw new Error('Theia did not create a Java Debug session');
      }
      createdSession = session;
      this.update({ state: 'connecting', sessionId: session.id, serverId: target.serverId });
      const attached = await started;
      if (attached.id !== session.id) {
        throw new Error('Java Debug Adapter started an unexpected session');
      }
      this.update({ state: 'connected', sessionId: session.id, serverId: target.serverId });
    } catch (error) {
      if (createdSession) await this.sessions.terminateSession(createdSession);
      this.update({ state: 'error', serverId: target.serverId, message: toMessage(error) });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      startedDisposable?.dispose();
      destroyedDisposable?.dispose();
    }
    return this.status;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const id = this.status.sessionId;
    if (id) {
      const session = this.sessions.getSession(id);
      if (session) await this.sessions.terminateSession(session);
    }
    if (this.status.state !== 'unknown' && this.status.state !== 'unavailable') {
      this.update({ state: 'terminated' });
    }
  }

  protected handleDestroyed(sessionId: string): void {
    if (this.status.sessionId !== sessionId) return;
    if (this.stopRequested) {
      this.update({ state: 'terminated' });
    } else {
      this.update({
        state: 'error',
        serverId: this.status.serverId,
        message: 'Java Debug Adapter session ended unexpectedly. Tomcat may still be running.',
      });
    }
  }

  protected attachTimeoutMs(): number {
    return 30_000;
  }

  protected update(status: KairoJavaDebugStatus): void {
    this.status = status;
    this.statusEmitter.fire(status);
  }
}

export function debugStatusBarPresentation(status: Readonly<KairoJavaDebugStatus>): { text: string; tooltip: string } {
  const icon = status.state === 'connected' ? '$(debug-alt)'
    : status.state === 'paused' ? '$(debug-pause)'
      : status.state === 'connecting' ? '$(sync~spin)'
        : status.state === 'error' ? '$(error)'
          : status.state === 'available' ? '$(pass)'
            : '$(debug-alt-small)';
  const session = status.sessionId ? ` · ${status.sessionId}` : '';
  return {
    text: `${icon} Debug: ${status.state}${session}`,
    tooltip: [
      `Kairo Java Debug Adapter: ${status.state}`,
      status.serverId ? `服务器: ${status.serverId}` : undefined,
      status.sessionId ? `会话: ${status.sessionId}` : undefined,
      status.message,
      '点击打开 Debug 视图。',
    ].filter(Boolean).join('\n'),
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileUri(path: string): string {
  return URI.fromFilePath(path).toString();
}
