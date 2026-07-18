/**
 * RuntimeConnectionService — the single HTTP client to the Go Runtime Agent.
 *
 * Merged from the old KairoRuntimeImpl (runtime.ts) and the WebSocket event
 * layer. All API calls go through here; the rest of the IDE never issues
 * fetch() calls to /api/v1 directly.
 */

import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import {
  PROTOCOL_VERSION_PATH,
  RequestEnvelope,
  Endpoint,
  WsEvent,
  HealthResponse,
} from '@kairo/protocol';
import {
  KairoError,
  normaliseThrown,
  unwrapResponse,
} from './runtime-errors';
import { KairoErrorListener, KairoErrorListenerImpl } from './runtime';

export interface KairoRuntimeConfig {
  baseUrl: string;
  sessionToken?: string;
  csrfToken?: string;
  /** Bearer token to send in `Authorization` for all requests. */
  bearerToken?: string;
  /** Default request timeout in ms. Defaults to 60_000. */
  defaultTimeoutMs?: number;
  /** Max number of automatic retries for transient errors. */
  maxRetries?: number;
}

export type KairoRequestInit = {
  /** Path parameter substitutions, in the order they appear in the endpoint. */
  pathParams?: Record<string, string>;
  /** Query parameters. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Override the per-request timeout in ms. */
  timeoutMs?: number;
  /**
   * If true, the runtime will not retry on transient failures.
   * Defaults to false (retries are allowed).
   */
  noRetry?: boolean;
};

@injectable()
export class RuntimeConnectionService {
  @inject(KairoErrorListener) protected listener!: KairoErrorListener;
  protected config: KairoRuntimeConfig = { baseUrl: '' };
  protected workspaceId: string = '';
  protected lastHealth: HealthResponse | undefined;
  private eventSocket: WebSocket | undefined;
  private sequence: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  @postConstruct()
  protected init(): void {
    if (!this.config.baseUrl) {
      // Read config from preload script (available before page loads).
      // In the desktop app, the preload exposes window.kairoConfig;
      // in the browser app, the host page may set __KAIRO_DEFAULT_RUNTIME_URL__.
      const kairoCfg = (window as any).kairoConfig;
      if (kairoCfg && kairoCfg.agentUrl) {
        this.initialize(kairoCfg.agentUrl, kairoCfg.agentSecret);
        return;
      }
      const injected = (globalThis as unknown as { __KAIRO_DEFAULT_RUNTIME_URL__?: string }).__KAIRO_DEFAULT_RUNTIME_URL__;
      this.config = { baseUrl: injected ?? '' };
    }
  }

  /** Initialize the runtime with the agent URL and secret. */
  initialize(agentUrl: string, agentSecret: string): void {
    this.config = {
      baseUrl: agentUrl,
      bearerToken: agentSecret,
    };
  }

  configure(cfg: KairoRuntimeConfig): void {
    this.config = { ...this.config, ...cfg };
  }

  setWorkspace(id: string): void {
    this.workspaceId = id;
  }

  workspace(): string {
    return this.workspaceId;
  }

  setBearerToken(token: string | undefined): void {
    this.config.bearerToken = token;
  }

  baseUrl(): string {
    return this.config.baseUrl;
  }

  lastSeenHealth(): HealthResponse | undefined {
    return this.lastHealth;
  }

  url(endpoint: string, init: KairoRequestInit = {}): string {
    const path = stripMethod(endpoint);
    let p = path;
    if (init.pathParams) {
      for (const [k, v] of Object.entries(init.pathParams)) {
        p = p.replace(`{${k}}`, encodeURIComponent(v));
      }
    }
    let url = this.config.baseUrl.replace(/\/$/, '') + p;
    if (init.query) {
      const q: string[] = [];
      for (const [k, v] of Object.entries(init.query)) {
        if (v === undefined) continue;
        q.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
      if (q.length > 0) {
        url += (url.includes('?') ? '&' : '?') + q.join('&');
      }
    }
    return url;
  }

  async request<E extends Endpoint | string>(
    endpoint: E,
    payload: unknown,
    init: KairoRequestInit = {},
  ): Promise<any> {
    const env: RequestEnvelope = {
      workspaceId: this.workspaceId,
      requestId: newRequestId(),
      payload: payload as any,
    };
    const url = this.url(endpoint, init);
    const method = methodOf(endpoint);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Kairo-Request-Id': env.requestId,
    };
    if (env.workspaceId) {
      headers['X-Kairo-Workspace-Id'] = env.workspaceId;
    }
    if (this.config.csrfToken && method !== 'GET') {
      headers['X-Kairo-CSRF'] = this.config.csrfToken;
    }
    if (this.config.bearerToken) {
      headers['Authorization'] = 'Bearer ' + this.config.bearerToken;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }

    const maxRetries = init.noRetry ? 0 : (this.config.maxRetries ?? 2);
    let lastErr: KairoError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const ctl = composeAbort(init.signal, init.timeoutMs ?? this.config.defaultTimeoutMs);
      try {
        const fetchInit: RequestInit = {
          method,
          headers,
          credentials: 'omit',
          signal: ctl.signal,
        };
        if (method !== 'GET' && method !== 'HEAD') {
          fetchInit.body = JSON.stringify(env);
        }
        const res = await fetch(url, fetchInit);
        const text = await res.text();
        let body: unknown;
        if (text.length === 0) {
          body = undefined;
        } else {
          try {
            body = JSON.parse(text);
          } catch (parseErr) {
            throw new KairoError({
              code: 'internal',
              message: 'Runtime agent returned non-JSON response',
              httpStatus: res.status,
              details: text.slice(0, 200),
              cause: parseErr,
            });
          }
        }
        const out = unwrapResponse(res, body);
        if ((endpoint as string) === 'GET /api/v1/health' && out && typeof out === 'object') {
          this.lastHealth = out as HealthResponse;
        }
        return out;
      } catch (raw) {
        const err = normaliseThrown(raw, `Request to ${url} failed`);
        this.listener.onError(err, { endpoint: endpoint as Endpoint, attempt });
        lastErr = err;
        if (!err.isTransient() || attempt === maxRetries || ctl.signal.aborted) {
          throw err;
        }
        const backoffMs = Math.min(2000, 100 * Math.pow(2, attempt));
        await delay(backoffMs, ctl.signal);
      } finally {
        ctl.dispose();
      }
    }
    throw lastErr ?? new KairoError({ code: 'internal', message: 'unreachable' });
  }

  openEvents(): EventStream {
    const wsBase = this.config.baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
    const wsUrl = `${wsBase}${PROTOCOL_VERSION_PATH}/events`;
    return new EventStream(wsUrl, this.config.bearerToken);
  }

  // --- WebSocket event methods (from old RuntimeConnectionService) ---

  connectEvents(workspaceId: string, onEvent: (event: any) => void): void {
    this.disconnectEvents();
    const wsUrl = `ws://127.0.0.1:18099/api/v1/events?workspaceId=${encodeURIComponent(workspaceId)}&after=${this.sequence}`;
    this.eventSocket = new WebSocket(wsUrl);
    this.eventSocket.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        this.sequence = event.sequence;
        onEvent(event);
      } catch { /* ignore parse errors */ }
    };
    this.eventSocket.onclose = () => {
      const delay = 1000 + Math.random() * 2000;
      this.reconnectTimer = setTimeout(() => this.connectEvents(workspaceId, onEvent), delay);
    };
  }

  disconnectEvents(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.eventSocket) {
      this.eventSocket.close();
      this.eventSocket = undefined;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Supporting utilities                                                */
/* ------------------------------------------------------------------ */

interface AbortCtl {
  signal: AbortSignal;
  dispose(): void;
}

function composeAbort(parent: AbortSignal | undefined, timeoutMs: number | undefined): AbortCtl {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParentAbort = () => ctl.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) ctl.abort(parent.reason);
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
  }
  return {
    signal: ctl.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (parent) parent.removeEventListener('abort', onParentAbort);
    },
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(t);
      reject(new KairoError({ code: 'timeout', message: 'Request was aborted during backoff' }));
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new KairoError({ code: 'timeout', message: 'Request was aborted during backoff' }));
    }, { once: true });
  });
}

function stripMethod(endpoint: string): string {
  const m = /^[A-Z]+\s+(\/.*)$/.exec(endpoint);
  return m ? m[1] : endpoint;
}

function methodOf(endpoint: string): string {
  const m = /^[A-Z]+\s+/.exec(endpoint);
  return m ? m[0].trim() : 'GET';
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return uuidv4();
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * A typed WebSocket subscription with exponential backoff
 * reconnect. The Theia side listens for log / build.progress /
 * deployment.progress / server.state events and re-emits them
 * on the inversify event bus so views do not depend on a
 * singleton runtime.
 */
export class EventStream {
  protected ws: WebSocket | null = null;
  protected listeners = new Map<string, Set<(e: WsEvent) => void>>();
  protected backoffMs = 250;
  protected maxBackoffMs = 15_000;
  protected closedByCaller = false;
  protected reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  protected statusListeners = new Set<(s: 'connecting' | 'open' | 'disconnected' | 'closed') => void>();
  protected currentStatus: 'connecting' | 'open' | 'disconnected' | 'closed' = 'disconnected';

  constructor(protected url: string, protected bearerToken?: string) {
    this.connect();
  }

  on(type: string, handler: (e: WsEvent) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  onStatus(handler: (s: 'connecting' | 'open' | 'disconnected' | 'closed') => void): () => void {
    this.statusListeners.add(handler);
    handler(this.currentStatus);
    return () => this.statusListeners.delete(handler);
  }

  status(): 'connecting' | 'open' | 'disconnected' | 'closed' {
    return this.currentStatus;
  }

  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.setStatus('closed');
  }

  protected connect(): void {
    if (this.closedByCaller) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = this.bearerToken
        ? new WebSocket(this.url, [this.bearerToken])
        : new WebSocket(this.url);
    } catch (_err) {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.backoffMs = 250;
      this.setStatus('open');
    });
    ws.addEventListener('message', ev => {
      try {
        const e: WsEvent = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        const set = this.listeners.get(e.type);
        if (set) for (const fn of set) fn(e);
        const all = this.listeners.get('*');
        if (all) for (const fn of all) fn(e);
      } catch (_err) {
        // ignore malformed message
      }
    });
    ws.addEventListener('close', () => {
      this.setStatus('disconnected');
      if (!this.closedByCaller) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      this.setStatus('disconnected');
    });
  }

  protected scheduleReconnect(): void {
    if (this.closedByCaller) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => this.connect(), wait);
  }

  protected setStatus(s: 'connecting' | 'open' | 'disconnected' | 'closed'): void {
    if (this.currentStatus === s) return;
    this.currentStatus = s;
    for (const fn of this.statusListeners) fn(s);
  }
}