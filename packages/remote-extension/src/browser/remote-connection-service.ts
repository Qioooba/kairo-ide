/**
 * P3-REMOTE: Remote Agent Connection Service
 *
 * Manages TLS 1.3 + WebSocket connection to a remote Kairo Agent,
 * including authentication, session management, reconnection,
 * and API proxying through the remote tunnel.
 *
 * Marked as "Experimental" — Phase 3 feature.
 */
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { MessageService } from '@theia/core/lib/common/message-service';

/** Remote connection state. */
export type RemoteConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/** Remote agent configuration. */
export interface RemoteAgentConfig {
  /** Remote agent host (e.g., "kairo-agent.internal") */
  host: string;
  /** Remote agent TLS port (default: 9443) */
  port: number;
  /** Session token from login */
  sessionToken?: string;
  /** Reconnect token for session resumption */
  reconnectToken?: string;
  /** Whether to verify TLS certificates */
  verifyTLS: boolean;
  /** Reconnection max retries (0 = no reconnection) */
  maxReconnectRetries: number;
  /** Reconnection base delay in ms */
  reconnectBaseDelay: number;
  /** Reconnection max delay in ms */
  reconnectMaxDelay: number;
}

/** Remote connection status. */
export interface RemoteConnectionStatus {
  state: RemoteConnectionState;
  host?: string;
  port?: number;
  sessionToken?: string;
  connectedAt?: number;
  error?: string;
  reconnectAttempt?: number;
}

/** Remote login credentials. */
export interface RemoteLoginCredentials {
  username: string;
  password: string;
}

/** Remote login response. */
export interface RemoteLoginResponse {
  sessionToken: string;
  reconnectToken: string;
  expiresAt: string;
  user: {
    username: string;
    role: string;
  };
}

const DEFAULT_CONFIG: RemoteAgentConfig = {
  host: 'localhost',
  port: 9443,
  verifyTLS: true,
  maxReconnectRetries: 5,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
};

const STORAGE_KEY_CONFIG = 'kairo.remote.agentConfig';
const STORAGE_KEY_SESSION = 'kairo.remote.session';

@injectable()
export class RemoteConnectionService {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  private config: RemoteAgentConfig = { ...DEFAULT_CONFIG };
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  private readonly onStatusChangeEmitter = new Emitter<RemoteConnectionStatus>();
  readonly onStatusChange: Event<RemoteConnectionStatus> = this.onStatusChangeEmitter.event;

  private readonly onMessageEmitter = new Emitter<{ type: string; data: any }>();
  readonly onMessage: Event<{ type: string; data: any }> = this.onMessageEmitter.event;

  private _state: RemoteConnectionState = 'disconnected';
  private _connectedAt: number = 0;

  get state(): RemoteConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'connected';
  }

  @postConstruct()
  protected init(): void {
    this.logger.info('[Remote] RemoteConnectionService initialized');
    this.loadSavedSession();
  }

  /** Load previously saved session from storage. */
  private loadSavedSession(): void {
    try {
      const savedConfig = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (savedConfig) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
      }
      const savedSession = localStorage.getItem(STORAGE_KEY_SESSION);
      if (savedSession) {
        const session = JSON.parse(savedSession);
        if (session.expiresAt && new Date(session.expiresAt) > new Date()) {
          this.config.sessionToken = session.sessionToken;
          this.config.reconnectToken = session.reconnectToken;
          this.logger.info('[Remote] Loaded saved session');
        } else {
          this.clearSession();
        }
      }
    } catch (err) {
      this.logger.warn('[Remote] Failed to load saved session', err);
    }
  }

  /** Save session to storage. */
  private saveSession(session: RemoteLoginResponse): void {
    try {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
      this.config.sessionToken = session.sessionToken;
      this.config.reconnectToken = session.reconnectToken;
    } catch (err) {
      this.logger.warn('[Remote] Failed to save session', err);
    }
  }

  /** Clear saved session. */
  private clearSession(): void {
    this.config.sessionToken = undefined;
    this.config.reconnectToken = undefined;
    localStorage.removeItem(STORAGE_KEY_SESSION);
  }

  /** Configure the remote agent connection. */
  configure(config: Partial<RemoteAgentConfig>): void {
    this.config = { ...this.config, ...config };
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
  }

  /** Authenticate with the remote agent. */
  async login(credentials: RemoteLoginCredentials): Promise<RemoteLoginResponse> {
    const url = `https://${this.config.host}:${this.config.port}/api/v1/remote/login`;
    this.logger.info('[Remote] Logging in to', url);

    this._state = 'connecting';
    this.emitStatus();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        // In production, TLS verification must be enabled
        // signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          (error as any).error?.message || `Login failed with status ${response.status}`
        );
      }

      const session: RemoteLoginResponse = await response.json();
      this.saveSession(session);
      this._state = 'connected';
      this._connectedAt = Date.now();
      this.emitStatus();
      this.logger.info('[Remote] Login successful');
      return session;
    } catch (err: any) {
      this._state = 'error';
      this.emitStatus();
      this.logger.error('[Remote] Login failed', err);
      throw err;
    }
  }

  /** Connect WebSocket to the remote agent. */
  async connect(): Promise<void> {
    if (!this.config.sessionToken) {
      throw new Error('[Remote] No session token — login first');
    }

    const url = `wss://${this.config.host}:${this.config.port}/api/v1/remote/ws`;
    this._state = 'connecting';
    this.emitStatus();

    this.logger.info('[Remote] Connecting WebSocket to', url);

    try {
      this.ws = new WebSocket(url, [this.config.sessionToken]);

      this.ws.onopen = () => {
        this.logger.info('[Remote] WebSocket connected');
        this._state = 'connected';
        this._connectedAt = Date.now();
        this.reconnectAttempt = 0;
        this.emitStatus();
        this.startPing();
      };

      this.ws.onclose = (event) => {
        this.logger.warn('[Remote] WebSocket closed', { code: event.code, reason: event.reason });
        this.stopPing();
        this.ws = null;
        this.attemptReconnect();
      };

      this.ws.onerror = (_event) => {
        this.logger.error('[Remote] WebSocket error');
        this._state = 'error';
        this.emitStatus();
      };

      this.ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          this.onMessageEmitter.fire(frame);
        } catch (err) {
          this.logger.warn('[Remote] Failed to parse WebSocket message', err);
        }
      };

      // Wait for connection with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('[Remote] WebSocket connection timeout (15s)'));
        }, 15000);

        const checkConnection = setInterval(() => {
          if (this._state === 'connected') {
            clearTimeout(timeout);
            clearInterval(checkConnection);
            resolve();
          }
          if (this._state === 'error') {
            clearTimeout(timeout);
            clearInterval(checkConnection);
            reject(new Error('[Remote] WebSocket connection failed'));
          }
        }, 100);
      });
    } catch (err: any) {
      this._state = 'error';
      this.emitStatus();
      this.logger.error('[Remote] Connection failed', err);
      throw err;
    }
  }

  /** Disconnect from the remote agent. */
  disconnect(): void {
    this.logger.info('[Remote] Disconnecting');
    this.stopPing();
    this.stopReconnect();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this._state = 'disconnected';
    this.emitStatus();
  }

  /** Logout and clear session. */
  async logout(): Promise<void> {
    this.disconnect();
    this.clearSession();
    this.logger.info('[Remote] Logged out');
  }

  /** Send a message through the WebSocket. */
  send(type: string, data: any): void {
    if (!this.ws || this._state !== 'connected') {
      throw new Error('[Remote] Not connected');
    }
    this.ws.send(JSON.stringify({ type, data }));
  }

  /** Send an API request through the remote tunnel. */
  async apiRequest<T = any>(method: string, path: string, body?: any): Promise<T> {
    if (!this.config.sessionToken) {
      throw new Error('[Remote] No session token');
    }

    const url = `https://${this.config.host}:${this.config.port}/api/v1/${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.sessionToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as any).error?.message || `API request failed with status ${response.status}`
      );
    }

    return response.json();
  }

  /** Attempt reconnection with exponential backoff. */
  private attemptReconnect(): void {
    if (this.config.maxReconnectRetries <= 0) {
      this._state = 'disconnected';
      this.emitStatus();
      return;
    }

    if (this.reconnectAttempt >= this.config.maxReconnectRetries) {
      this.logger.error('[Remote] Max reconnection retries reached');
      this._state = 'error';
      this.emitStatus();
      this.messageService.error('Remote connection lost. Please reconnect manually.');
      return;
    }

    this.reconnectAttempt++;
    this._state = 'reconnecting';
    this.emitStatus();

    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempt - 1),
      this.config.reconnectMaxDelay
    );

    this.logger.info(
      `[Remote] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${this.config.maxReconnectRetries})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error('[Remote] Reconnection failed', err);
        // connect() will call attemptReconnect() again on close
      });
    }, delay);
  }

  /** Stop reconnection attempts. */
  private stopReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  /** Start WebSocket ping to keep connection alive. */
  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  /** Stop WebSocket ping. */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /** Emit current status. */
  private emitStatus(): void {
    this.onStatusChangeEmitter.fire({
      state: this._state,
      host: this.config.host,
      port: this.config.port,
      sessionToken: this.config.sessionToken,
      connectedAt: this._connectedAt,
      reconnectAttempt: this.reconnectAttempt,
    });
  }
}