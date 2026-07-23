/**
 * 远程 JDWP 安全隧道 — P3-ADVDBG-03
 *
 * RemoteDebugTunnel service for connecting to remote JDWP
 * via SSH tunnel or direct TLS connection. The tunnel only
 * listens on localhost and never exposes to the network.
 *
 * Connection lifecycle: connect → authenticate → attach → disconnect
 * Timeout: 30s for connection attempt
 * Marked as "Experimental"
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';

/** Authentication types for remote JDWP. */
export type RemoteDebugAuthType = 'none' | 'ssh-key' | 'token';

/** Remote debug connection configuration. */
export interface RemoteDebugConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  authType: RemoteDebugAuthType;
  /** SSH key path for SSH key auth. */
  sshKeyPath?: string;
  /** Token for token-based auth. */
  token?: string;
  /** Local port to bind the tunnel. */
  localPort?: number;
}

/** Tunnel connection state. */
export type TunnelState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Tunnel status information. */
export interface TunnelStatus {
  state: TunnelState;
  config?: RemoteDebugConfig;
  localPort?: number;
  error?: string;
  connectedAt?: number;
}

const TUNNEL_TIMEOUT_MS = 30_000;

@injectable()
export class RemoteDebugTunnel {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  protected readonly onDidChangeStatusEmitter = new Emitter<TunnelStatus>();
  readonly onDidChangeStatus: Event<TunnelStatus> = this.onDidChangeStatusEmitter.event;

  protected _status: TunnelStatus = { state: 'disconnected' };
  protected activeConfig: RemoteDebugConfig | undefined;
  protected connectionTimer: ReturnType<typeof setTimeout> | undefined;

  get status(): Readonly<TunnelStatus> {
    return this._status;
  }

  get isConnected(): boolean {
    return this._status.state === 'connected';
  }

  @postConstruct()
  protected init(): void {
    this.logger.info('远程 JDWP 安全隧道服务已初始化（实验性功能）');
  }

  /**
   * Connect to a remote JDWP endpoint via SSH tunnel.
   *
   * @param config Remote debug configuration
   * @returns The local port that the tunnel is listening on
   */
  async connect(config: RemoteDebugConfig): Promise<number> {
    if (this._status.state === 'connecting' || this._status.state === 'connected') {
      throw new Error('隧道已连接或正在连接中，请先断开当前连接。');
    }

    this.activeConfig = config;
    this.updateStatus({ state: 'connecting', config });

    // Set a connection timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      this.connectionTimer = setTimeout(() => {
        this.updateStatus({
          state: 'error',
          config,
          error: `连接超时 (${TUNNEL_TIMEOUT_MS / 1000}秒)`,
        });
        reject(new Error(`远程 JDWP 连接超时 (${TUNNEL_TIMEOUT_MS / 1000}秒)`));
      }, TUNNEL_TIMEOUT_MS);
    });

    try {
      const localPort = await Promise.race([
        this.establishTunnel(config),
        timeoutPromise,
      ]);

      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = undefined;
      }

      this.updateStatus({
        state: 'connected',
        config,
        localPort,
        connectedAt: Date.now(),
      });

      this.logger.info(`远程 JDWP 隧道已建立: ${config.host}:${config.port} → localhost:${localPort}`);
      return localPort;
    } catch (error) {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = undefined;
      }

      const msg = error instanceof Error ? error.message : String(error);
      this.updateStatus({ state: 'error', config, error: msg });
      throw error;
    }
  }

  /**
   * Disconnect the current tunnel.
   */
  async disconnect(): Promise<void> {
    if (this._status.state === 'disconnected') {
      return;
    }

    try {
      await this.teardownTunnel();
      this.logger.info('远程 JDWP 隧道已断开');
    } catch (error) {
      this.logger.warn(
        `断开隧道时出错: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.activeConfig = undefined;
    this.updateStatus({ state: 'disconnected' });
  }

  /**
   * Show the experimental feature warning.
   */
  showExperimentalWarning(): void {
    this.messages.warn(
      '远程 JDWP 安全隧道是实验性功能。\n\n' +
      '安全说明：\n' +
      '• 隧道仅监听 localhost，不会暴露到网络\n' +
      '• 支持 SSH 密钥和 Token 认证\n' +
      '• 连接超时时间: 30 秒\n' +
      '• 建议在生产环境中使用 SSH 隧道\n\n' +
      '使用前请确保远程主机已配置 JDWP 调试端口。',
    );
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Establish the tunnel via the runtime agent.
   * The agent handles the actual SSH/tunnel setup.
   */
  protected async establishTunnel(config: RemoteDebugConfig): Promise<number> {
    try {
      const result = await this.runtime.request(
        'POST /api/v1/debug/tunnel/connect' as any,
        {
          host: config.host,
          port: config.port,
          authType: config.authType,
          sshKeyPath: config.sshKeyPath,
          token: config.token,
          localPort: config.localPort || 0,
        },
        { noRetry: true },
      ) as unknown as {
        localPort: number;
        success: boolean;
        error?: string;
      } | undefined;

      if (result?.success && result.localPort > 0) {
        return result.localPort;
      }

      throw new Error(result?.error || '隧道建立失败');
    } catch (error) {
      throw new Error(
        `隧道建立失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Tear down the tunnel via the runtime agent.
   */
  protected async teardownTunnel(): Promise<void> {
    try {
      await this.runtime.request(
        'POST /api/v1/debug/tunnel/disconnect' as any,
        undefined,
        { noRetry: true },
      );
    } catch {
      // Best effort — ignore teardown errors
    }
  }

  protected updateStatus(status: TunnelStatus): void {
    this._status = status;
    this.onDidChangeStatusEmitter.fire(status);
  }
}