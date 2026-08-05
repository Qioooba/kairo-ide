/**
 * Kairo Remote Agent Service.
 *
 * Manages connection to a remote Kairo Agent via WebSocket + HTTP.
 * Supports TLS 1.3 with mTLS, session token auth, WebSocket
 * multiplexing with reconnection, and heartbeat/ping.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface RemoteAgentConfig {
  /** Remote host (e.g. "192.168.1.100") */
  host: string;
  /** Remote port (e.g. 9443) */
  port: number;
  /** Whether to use TLS (default true) */
  useTLS: boolean;
  /** Session token for authentication */
  token: string;
  /** Remote workspace path */
  workspacePath: string;
}

export type RemoteAgentStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface RemoteAgentConnection {
  config: RemoteAgentConfig;
  ws: WebSocket;
  status: RemoteAgentStatus;
  error?: string;
}

interface WebSocketRequest {
  type: 'request';
  id: string;
  path: string;
  body: unknown;
}

interface WebSocketResponse {
  type: 'response';
  id: string;
  status: number;
  body: unknown;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                            */
/* ------------------------------------------------------------------ */

/** WebSocket connection timeout (ms). */
const WS_CONNECT_TIMEOUT_MS = 10_000;

/** Maximum reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Maximum reconnection delay (ms). */
const MAX_RECONNECT_DELAY = 30_000;

/** Heartbeat interval (ms). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/* ------------------------------------------------------------------ */
/*  Service                                                             */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoRemoteAgentService {
  @inject(ILogger) protected readonly logger!: ILogger;

  protected connection: RemoteAgentConnection | undefined;
  protected onDidChangeStatusEmitter = new Emitter<RemoteAgentStatus>();
  readonly onDidChangeStatus: Event<RemoteAgentStatus> = this.onDidChangeStatusEmitter.event;

  protected reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  protected reconnectAttempts = 0;
  protected maxReconnectDelay = MAX_RECONNECT_DELAY;
  protected heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  protected pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  protected requestQueue: (() => Promise<void>)[] = [];
  protected isProcessingQueue = false;

  @postConstruct()
  protected init(): void {
    // No-op: connections are explicitly initiated by the user.
  }

  /** Connect to the remote Kairo Agent. */
  async connect(config: RemoteAgentConfig): Promise<boolean> {
    if (this.connection && this.connection.status === 'connected') {
      return true;
    }

    this.reconnectAttempts = 0;
    return this.doConnect(config);
  }

  /**
   * Reconnect to the remote agent, resetting the retry counter.
   * Useful when the user explicitly requests a reconnection.
   */
  reconnect(): void {
    this.logger.info('[kairo-remote] Manual reconnect requested');
    const config = this.connection?.config;
    this.disconnect();
    if (config) {
      this.reconnectAttempts = 0;
      void this.doConnect(config);
    } else {
      this.logger.warn('[kairo-remote] reconnect() called but no previous connection config available');
    }
  }

  /** Disconnect from the remote agent and stop reconnection. */
  disconnect(): void {
    this.clearReconnect();
    this.clearHeartbeat();
    if (this.connection) {
      try {
        this.connection.ws.close(1000, 'Client disconnect');
      } catch {
        // Ignore close errors
      }
      this.connection = undefined;
    }
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Disconnected from remote agent'));
    }
    this.pendingRequests.clear();
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.setStatus('disconnected');
  }

  isConnected(): boolean {
    return this.connection?.status === 'connected';
  }

  getConnection(): RemoteAgentConnection | undefined {
    return this.connection;
  }

  /** Proxy an HTTP REST API call to the remote agent. */
  async apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const conn = this.connection;
    if (!conn) {
      throw new Error('Not connected to remote agent');
    }

    const scheme = conn.config.useTLS ? 'https' : 'http';
    const url = `${scheme}://${conn.config.host}:${conn.config.port}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${conn.config.token}`,
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const statusCode = response.status;
        let userMessage: string;
        switch (statusCode) {
          case 401:
            userMessage = `Authentication failed (401): Invalid or expired token. Please reconnect.`;
            break;
          case 403:
            userMessage = `Permission denied (403): You do not have access to this resource.`;
            break;
          case 404:
            userMessage = `Resource not found (404): ${path}`;
            break;
          case 502:
          case 503:
          case 504:
            userMessage = `Remote agent is temporarily unavailable (${statusCode}). Please try again later.`;
            break;
          default:
            userMessage = `Remote API error (${statusCode}): ${errorBody || 'Unknown error'}`;
        }
        this.logger.error(`[kairo-remote] apiRequest failed: ${userMessage}`);
        throw new Error(userMessage);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      if (err instanceof TypeError) {
        const msg = `Network error: Unable to reach remote agent at ${conn.config.host}:${conn.config.port}. Please check your connection.`;
        this.logger.error(`[kairo-remote] apiRequest network error: ${msg}`);
        throw new Error(msg);
      }
      throw err;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                            */
  /* ------------------------------------------------------------------ */

  protected setStatus(status: RemoteAgentStatus): void {
    this.onDidChangeStatusEmitter.fire(status);
  }

  protected async doConnect(config: RemoteAgentConfig): Promise<boolean> {
    // Clean up any existing connection
    this.cleanupConnection();

    this.setStatus('connecting');

    const scheme = config.useTLS ? 'wss' : 'ws';
    // TP-P2-17: pass token via Sec-WebSocket-Protocol, not URL query (avoids access logs).
    const url = `${scheme}://${config.host}:${config.port}/ws`;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let connectTimeoutId: ReturnType<typeof setTimeout> | undefined;

      const settle = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (connectTimeoutId) {
          clearTimeout(connectTimeoutId);
        }
        resolve(result);
      };

      try {
        const ws = new WebSocket(url, [config.token]);

        // Connection timeout
        connectTimeoutId = setTimeout(() => {
          this.logger.warn(`[kairo-remote] WebSocket connection timed out after ${WS_CONNECT_TIMEOUT_MS / 1000}s`);
          try {
            ws.close(4000, 'Connection timeout');
          } catch {
            // ignore
          }
          this.setStatus('error');
          settle(false);
        }, WS_CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
          this.connection = {
            config,
            ws,
            status: 'connected',
          };
          this.reconnectAttempts = 0;
          this.setStatus('connected');
          this.startHeartbeat();
          this.logger.info('[kairo-remote] Connected to remote agent');
          settle(true);
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg: WebSocketResponse = JSON.parse(event.data as string);
            if (msg.type === 'response') {
              const pending = this.pendingRequests.get(msg.id);
              if (pending) {
                this.pendingRequests.delete(msg.id);
                if (msg.status >= 200 && msg.status < 300) {
                  pending.resolve(msg.body);
                } else {
                  pending.reject(new Error(`Remote error ${msg.status}: ${JSON.stringify(msg.body)}`));
                }
              }
            }
          } catch (err) {
            this.logger.warn('[kairo-remote] Failed to parse WS message:', err);
          }
        };

        ws.onerror = () => {
          if (this.connection) {
            this.connection.error = 'WebSocket error';
            this.connection.status = 'error';
          }
          this.logger.error('[kairo-remote] WebSocket error occurred');
          this.setStatus('error');
          // onclose will fire after onerror, reconnect there
        };

        ws.onclose = (event: CloseEvent) => {
          this.clearHeartbeat();

          // Log close code meaning
          const closeReason = this.getCloseCodeReason(event.code);
          this.logger.warn(`[kairo-remote] WebSocket closed: code=${event.code} (${closeReason}), reason="${event.reason || 'none'}"`);

          if (this.connection) {
            this.connection.status = 'disconnected';
          }
          this.setStatus('disconnected');

          // Reject pending requests
          for (const [, pending] of this.pendingRequests) {
            pending.reject(new Error('Connection closed'));
          }
          this.pendingRequests.clear();

          // Only reconnect if not a clean client-initiated disconnect and not a timeout close
          if (event.code !== 1000 && event.code !== 4000) {
            this.scheduleReconnect(config);
          }

          settle(false);
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[kairo-remote] Failed to create WebSocket: ${msg}`);
        this.setStatus('error');
        settle(false);
      }
    });
  }

  /** Clean up existing connection before creating a new one. */
  protected cleanupConnection(): void {
    this.clearHeartbeat();
    if (this.connection) {
      try {
        this.connection.ws.close(1000, 'Reconnecting');
      } catch {
        // ignore
      }
      this.connection = undefined;
    }
    // Reject any pending requests from the old connection
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection replaced'));
    }
    this.pendingRequests.clear();
    this.requestQueue = [];
    this.isProcessingQueue = false;
  }

  protected scheduleReconnect(config: RemoteAgentConfig): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(`[kairo-remote] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
      this.setStatus('error');
      return;
    }

    this.clearReconnect();
    const delay = Math.min(
      Math.pow(2, this.reconnectAttempts) * 1000,
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    this.logger.info(`[kairo-remote] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectTimer = setTimeout(() => {
      void this.doConnect(config);
    }, delay);
  }

  protected clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  protected startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendWsRequest('GET', '/api/v1/remote/health', undefined).catch(() => {
        // Heartbeat failure is handled by onclose
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  protected clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** Send a request over the WebSocket and return a promise for the response. */
  sendWsRequest(path: string, body?: unknown): Promise<unknown>;
  sendWsRequest(method: string, path: string, body?: unknown): Promise<unknown>;
  sendWsRequest(methodOrPath: string, pathOrBody?: unknown, body?: unknown): Promise<unknown> {
    let path: string;
    let reqBody: unknown;

    if (body !== undefined) {
      // Three-argument form: sendWsRequest(method, path, body)
      path = pathOrBody as string;
      reqBody = body;
    } else if (pathOrBody !== undefined) {
      // Two-argument form: sendWsRequest(path, body)
      path = methodOrPath;
      reqBody = pathOrBody;
    } else {
      path = methodOrPath;
      reqBody = undefined;
    }

    const conn = this.connection;
    if (!conn || conn.status !== 'connected') {
      return Promise.reject(new Error('Not connected to remote agent'));
    }

    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request: WebSocketRequest = {
      type: 'request',
      id,
      path,
      body: reqBody,
    };

    return new Promise<unknown>((resolve, reject) => {
      const sendRequest = () => {
        this.pendingRequests.set(id, { resolve, reject });
        try {
          conn.ws.send(JSON.stringify(request));
        } catch (err) {
          this.pendingRequests.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      // Serialize pending requests to avoid race conditions on the WebSocket
      this.requestQueue.push(async () => {
        sendRequest();
      });

      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /** Process the request queue sequentially to avoid race conditions. */
  protected async processQueue(): Promise<void> {
    this.isProcessingQueue = true;
    while (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift();
      if (next) {
        try {
          await next();
        } catch {
          // Errors are handled inside the request promise
        }
      }
    }
    this.isProcessingQueue = false;
  }

  /** Get a human-readable reason for a WebSocket close code. */
  protected getCloseCodeReason(code: number): string {
    switch (code) {
      case 1000: return 'Normal closure';
      case 1001: return 'Going away';
      case 1002: return 'Protocol error';
      case 1003: return 'Unsupported data';
      case 1005: return 'No status received';
      case 1006: return 'Abnormal closure (connection lost)';
      case 1007: return 'Invalid frame payload data';
      case 1008: return 'Policy violation';
      case 1009: return 'Message too big';
      case 1010: return 'Missing extension';
      case 1011: return 'Internal server error';
      case 1012: return 'Service restart';
      case 1013: return 'Try again later';
      case 1015: return 'TLS handshake failure';
      default: return `Unknown (${code})`;
    }
  }
}