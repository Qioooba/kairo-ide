/**
 * KairoRuntime — the HTTP client to the Go Runtime Agent.
 *
 * Single point of contact. The rest of the IDE never issues
 * fetch() calls to /api/v1; they go through here. The base URL
 * is configured at startup (in the desktop form it is the
 * in-process agent; in the server form it is the remote agent).
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  PROTOCOL_VERSION_PATH,
  RequestEnvelope,
  ResponseFor,
  Endpoint,
  RequestFor,
  WsEvent,
} from '@kairo/protocol';

export const KairoRuntime = Symbol('KairoRuntime');
export const KairoRuntimeFactory = Symbol('KairoRuntimeFactory');

export interface KairoRuntimeConfig {
  baseUrl: string;
  /** Optional session token for the server form. */
  sessionToken?: string;
  /** Optional CSRF token; the client adds it to state-changing requests. */
  csrfToken?: string;
}

@injectable()
export class KairoRuntime {
  protected config: KairoRuntimeConfig = { baseUrl: '' };
  protected workspaceId: string = '';

  configure(cfg: KairoRuntimeConfig): void {
    this.config = cfg;
  }

  setWorkspace(id: string): void {
    this.workspaceId = id;
  }

  workspace(): string {
    return this.workspaceId;
  }

  /** Build the full URL for an endpoint. */
  url<E extends Endpoint>(endpoint: E, ...pathParams: string[]): string {
    let path = endpoint;
    if (pathParams.length > 0) {
      // Replace `{id}` in the path with the first param.
      path = path.replace('{id}', encodeURIComponent(pathParams[0])) as E;
    }
    // Strip the HTTP method, e.g. "GET /api/v1/health" -> "/api/v1/health".
    const m = /^[A-Z]+\s+(\/.*)$/.exec(endpoint);
    if (m) {
      path = m[1] as E;
    }
    return this.config.baseUrl.replace(/\/$/, '') + path;
  }

  /**
   * Issue a typed request. The endpoint's payload type is
   * inferred from the EndpointMap.
   */
  async request<E extends Endpoint>(
    endpoint: E,
    payload: RequestFor<E>['payload'],
    opts?: { signal?: AbortSignal },
  ): Promise<ResponseFor<E>> {
    const env: RequestEnvelope<RequestFor<E>['payload']> = {
      workspaceId: this.workspaceId,
      requestId: newRequestId(),
      payload,
    };
    const url = this.url(endpoint);
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
      signal: opts?.signal,
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
    const ws = new WebSocket(wsUrl, this.config.sessionToken ? [this.config.sessionToken] : []);
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
      } catch (err) {
        // ignore
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
