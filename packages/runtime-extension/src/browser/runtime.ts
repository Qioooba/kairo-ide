/**
 * KairoRuntime — the HTTP client to the Go Runtime Agent.
 *
 * Single point of contact. The rest of the IDE never issues
 * fetch() calls to /api/v1; they go through here. The base URL
 * is configured at startup (in the desktop form it is the
 * in-process agent; in the server form it is the remote agent).
 */

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import {
  PROTOCOL_VERSION_PATH,
  RequestEnvelope,
  Endpoint,
  WsEvent,
  type RequestFor,
  type ResponseFor,
} from '@kairo/protocol';

/**
 * The interface for the Kairo runtime client. Extensions bind
 * to `KairoRuntime` (this Symbol) and receive an injectable.
 */
export const KairoRuntime = Symbol('KairoRuntime');

export interface KairoRuntimeConfig {
  baseUrl: string;
  sessionToken?: string;
  csrfToken?: string;
}

export type KairoRequestInit = {
  /** Path parameter substitutions, in the order they appear in the endpoint. */
  pathParams?: Record<string, string>;
  /** Query parameters. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Abort signal. */
  signal?: AbortSignal;
};

@injectable()
export class KairoRuntimeImpl {
  protected config: KairoRuntimeConfig = { baseUrl: '' };
  protected workspaceId: string = '';

  @postConstruct()
  init(): void {
    // Fall back to the host-injected default URL (set by
    // apps/browser and apps/desktop) or the canonical local
    // agent URL. Without this, baseUrl stayed '' and every
    // request hit a relative URL on the wrong origin.
    if (!this.config.baseUrl) {
      const injected = (globalThis as unknown as { __KAIRO_DEFAULT_RUNTIME_URL__?: string }).__KAIRO_DEFAULT_RUNTIME_URL__;
      this.config = { baseUrl: injected ?? '' };
    }
  }

  configure(cfg: KairoRuntimeConfig): void {
    // Merge instead of replace so partial updates (e.g. just a
    // new sessionToken) don't silently drop the baseUrl.
    this.config = { ...this.config, ...cfg };
  }

  setWorkspace(id: string): void {
    this.workspaceId = id;
  }

  workspace(): string {
    return this.workspaceId;
  }

  /**
   * Build the full URL for an endpoint, applying pathParams and
   * query.
   */
  url(endpoint: Endpoint, init: KairoRequestInit = {}): string {
    let path = endpoint;
    const m = /^[A-Z]+\s+(\/.*)$/.exec(endpoint);
    if (m) {
      path = m[1] as Endpoint;
    }
    if (init.pathParams) {
      for (const [k, v] of Object.entries(init.pathParams)) {
        path = path.replace(`{${k}}`, encodeURIComponent(v)) as Endpoint;
      }
    }
    let url = this.config.baseUrl.replace(/\/$/, '') + path;
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

  /**
   * Issue a typed request. The endpoint's payload type is
   * inferred from the EndpointMap.
   */
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
    const m = /^[A-Z]+\s+/.exec(endpoint);
    const method = m ? m[0].trim() : 'GET';

    // GET endpoints cannot carry a JSON body. If the endpoint
    // declares a payload (e.g. GET /servers/{id}/logs with
    // {follow,since}), lift the payload fields into query params.
    // Previously the payload was wrapped in the envelope and then
    // discarded, so `follow=true` never reached the agent.
    if (method === 'GET' && payload && typeof payload === 'object') {
      init = {
        ...init,
        query: {
          ...(init.query ?? {}),
          ...(payload as Record<string, string | number | boolean | undefined>),
        },
      };
    }

    const url = this.url(endpoint, init);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Kairo-Request-Id': env.requestId,
    };
    if (env.workspaceId) {
      headers['X-Kairo-Workspace-Id'] = env.workspaceId;
    }
    if (this.config.csrfToken && method !== 'GET') {
      headers['X-Kairo-CSRF'] = this.config.csrfToken;
    }
    if (this.config.sessionToken) {
      headers['Authorization'] = 'Bearer ' + this.config.sessionToken;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(env),
        signal: init.signal,
      });
    } catch (e) {
      // Network error or abort. Distinguish aborts so callers can
      // ignore them (e.g. debounced search).
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw e;
      }
      const err = new Error(`kairo request failed: ${(e as Error).message}`);
      Object.assign(err, { code: 'internal', requestId: env.requestId, retryable: true });
      throw err;
    }
    if (!res.ok) {
      // Try to parse the error envelope; fall back to HTTP status.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* not JSON — e.g. HTML 502 from a proxy */
      }
      const kerr = (body as { error?: { code?: string; message?: string; details?: unknown; retryable?: boolean } } | null)?.error;
      const e = new Error(kerr?.message ?? `HTTP ${res.status} ${res.statusText}`);
      Object.assign(e, {
        code: kerr?.code ?? 'internal',
        requestId: env.requestId,
        correlationId: (body as { correlationId?: string } | null)?.correlationId,
        details: kerr?.details,
        retryable: kerr?.retryable,
      });
      throw e;
    }
    let json: { ok: true; payload: ResponseFor<E> } | { ok: false; error: { code: string; message: string; details?: unknown; retryable?: boolean } };
    try {
      json = await res.json();
    } catch (e) {
      const err = new Error(`kairo response was not JSON: ${(e as Error).message}`);
      Object.assign(err, { code: 'internal', requestId: env.requestId });
      throw err;
    }
    if (!json.ok) {
      const kerr = (json as { ok: false; error: { code?: string; message?: string } }).error;
      const e = new Error(kerr?.message || 'request failed');
      Object.assign(e, { code: kerr?.code });
      throw e;
    }
    return (json as { ok: true; payload: ResponseFor<E> }).payload;
  }

  /**
   * Open a WebSocket to /api/v1/events. The returned object
   * exposes on(type, handler) and close().
   */
  openEvents(): EventStream {
    const wsUrl = this.config.baseUrl
      .replace(/^http/, 'ws')
      .replace(/\/$/, '') + PROTOCOL_VERSION_PATH + '/events';
    const protocols = this.config.sessionToken ? [this.config.sessionToken] : undefined;
    const ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
    return new EventStream(ws);
  }
}

export class EventStream {
  protected ws: WebSocket;
  protected listeners = new Map<string, Set<(e: WsEvent) => void>>();
  protected readonly onMessage: (ev: MessageEvent) => void;
  protected readonly onClose: () => void;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.onMessage = (ev: MessageEvent) => this.handleMessage(ev);
    this.onClose = () => this.emitClose();
    this.ws.addEventListener('message', this.onMessage);
    this.ws.addEventListener('close', this.onClose);
    this.ws.addEventListener('error', this.onClose);
  }

  private handleMessage(ev: MessageEvent): void {
    // Only swallow JSON parse errors. A throwing listener must
    // not abort iteration over the rest of the Set, and we want
    // to know about it.
    let e: WsEvent;
    try {
      e = JSON.parse(ev.data) as WsEvent;
    } catch {
      return;
    }
    const snapshot = (set: Set<(ev: WsEvent) => void> | undefined) =>
      set ? Array.from(set) : [];
    for (const fn of snapshot(this.listeners.get(e.type))) {
      try {
        fn(e);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[kairo] event listener threw', err);
      }
    }
    // Also fire the wildcard subscribers, unless this event IS
    // a wildcard broadcast (which would be a degenerate loop).
    // Cast to string because WsEvent.type is a strict union of
    // real event names; '*' is a subscription channel, not an
    // event type, so the union correctly doesn't include it.
    if ((e.type as string) !== '*') {
      for (const fn of snapshot(this.listeners.get('*'))) {
        try {
          fn(e);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[kairo] event listener threw', err);
        }
      }
    }
  }

  private emitClose(): void {
    // Notify subscribers via the wildcard channel so the UI can
    // re-open the stream. Previously a dropped socket was silent.
    const synthetic: WsEvent = { type: '__close__' } as unknown as WsEvent;
    for (const fn of Array.from(this.listeners.get('*') ?? [])) {
      try {
        fn(synthetic);
      } catch {
        /* ignore */
      }
    }
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

  close(): void {
    // Remove listeners so the WebSocket can be GC'd. Previously
    // the message listener was never detached, leaking on every
    // openEvents() call.
    this.ws.removeEventListener('message', this.onMessage);
    this.ws.removeEventListener('close', this.onClose);
    this.ws.removeEventListener('error', this.onClose);
    this.listeners.clear();
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

function newRequestId(): string {
  // Prefer crypto.randomUUID (UUIDv4, available in modern browsers
  // and Node 19+) per the protocol contract. Fall back to a
  // random base36 string for older runtimes.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return 'req_' + Math.random().toString(36).slice(2, 14);
}
