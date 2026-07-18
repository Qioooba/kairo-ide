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
    // default config; can be overridden via configure()
  }

  configure(cfg: KairoRuntimeConfig): void {
    this.config = cfg;
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
    const url = this.url(endpoint, init);
    const m = /^[A-Z]+\s+/.exec(endpoint);
    const method = m ? m[0].trim() : 'GET';
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
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(env),
      signal: init.signal,
    });
    const json = await res.json();
    if (!json.ok) {
      const err = json.error;
      const e = new Error(err?.message || 'request failed');
      // @ts-expect-error attach code
      e.code = err?.code;
      throw e;
    }
    return json.payload;
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

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', ev => {
      try {
        const e: WsEvent = JSON.parse(ev.data);
        const set = this.listeners.get(e.type);
        if (set) {
          for (const fn of set) fn(e);
        }
        const all = this.listeners.get('*');
        if (all) {
          for (const fn of all) fn(e);
        }
      } catch (_err) {
        // ignore malformed messages
      }
    });
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

  close(): void {
    this.ws.close();
  }
}

function newRequestId(): string {
  return 'req_' + Math.random().toString(36).slice(2, 14);
}
