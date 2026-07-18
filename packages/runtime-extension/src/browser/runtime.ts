/**
 * KairoRuntime — the HTTP client to the Go Runtime Agent.
 *
 * Single point of contact. The rest of the IDE never issues
 * fetch() calls to /api/v1; they go through here. The base URL
 * is configured at startup (in the desktop form it is the
 * in-process agent; in the server form it is the remote agent).
 */

import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import {
  PROTOCOL_VERSION_PATH,
  RequestEnvelope,
  Endpoint,
  WsEvent,
  HealthResponse,
  type RequestFor,
  type ResponseFor,
} from '@kairo/protocol';
import { KairoError, normaliseThrown, unwrapResponse } from './runtime-errors';

export const KairoRuntime = Symbol('KairoRuntime');

/**
 * Listener for client-side errors. The Theia side uses this to
 * drive the status bar ("Runtime Agent: disconnected"), the
 * notifications service, and the audit log.
 */
export const KairoErrorListener = Symbol('KairoErrorListener');
export interface KairoErrorListener {
  onError(err: KairoError, ctx: { endpoint: Endpoint; attempt: number }): void;
}

export class KairoErrorListenerImpl implements KairoErrorListener {
  onError(_err: KairoError, _ctx: { endpoint: Endpoint; attempt: number }): void {
    // Default no-op; views register themselves.
  }
}

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
export class KairoRuntimeImpl {
  @inject(KairoErrorListener) protected listener!: KairoErrorListener;
  protected config: KairoRuntimeConfig = { baseUrl: '' };
  protected workspaceId: string = '';
  protected lastHealth: HealthResponse | undefined;

  @postConstruct()
  init(): void {
    // default config; can be overridden via configure()
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

  url(endpoint: Endpoint, init: KairoRequestInit = {}): string {
    const path = stripMethod(endpoint);
    let p = path;
    if (init.pathParams) {
      for (const [k, v] of Object.entries(init.pathParams)) {
        p = p.replace(`{${k}}`, encodeURIComponent(v)) as Endpoint;
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

  async request<E extends Endpoint>(
    endpoint: E,
    payload: RequestFor<E>['payload'],
    init: KairoRequestInit = {},
  ): Promise<ResponseFor<E>> {
    const env: RequestEnvelope<RequestFor<E>['payload']> = {
      workspaceId: this.workspaceId,
      requestId: newRequestId(),
      payload: payload as RequestFor<E>['payload'],
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
        if (endpoint === 'GET /api/v1/health' && out && typeof out === 'object') {
          this.lastHealth = out as HealthResponse;
        }
        return out as ResponseFor<E>;
      } catch (raw) {
        const err = normaliseThrown(raw, `Request to ${url} failed`);
        this.listener.onError(err, { endpoint, attempt });
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
}

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

function stripMethod(endpoint: Endpoint): string {
  const m = /^[A-Z]+\s+(\/.*)$/.exec(endpoint);
  return m ? m[1] : (endpoint as string);
}

function methodOf(endpoint: Endpoint): string {
  const m = /^[A-Z]+\s+/.exec(endpoint);
  return m ? m[0].trim() : 'GET';
}

function newRequestId(): string {
  return 'req_' + Math.random().toString(36).slice(2, 14);
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
    return () => set!.delete(handler);
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
