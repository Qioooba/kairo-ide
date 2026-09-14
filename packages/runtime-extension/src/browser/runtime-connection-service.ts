/**
 * RuntimeConnectionService — the single HTTP client to the Go Runtime Agent.
 *
 * Merged from the old KairoRuntimeImpl (runtime.ts) and the WebSocket event
 * layer. All API calls go through here; the rest of the IDE never issues
 * fetch() calls to /api/v1 directly.
 *
 * Auth contract (per docs/hotfix-windows-test-readiness.md 搂1):
 *   - HTTP: every request (except /api/v1/health and /api/v1/endpoints)
 *     carries `X-Kairo-Secret: <secret>`.
 *   - WebSocket: the browser cannot set custom headers on a WS
 *     upgrade, so the secret is carried as a WebSocket
 *     subprotocol token: `new WebSocket(url, ["kairo-secret-v1",
 *     secret])`. The server echoes the secret back as the
 *     selected subprotocol.
 *
 * Endpoints discovery (per 搂2): the runtime client calls
 * GET /api/v1/endpoints on first use to learn the dynamic
 * host:port the agent bound. The frontend no longer hardcodes
 * 18099 — every WS / EventStream URL is derived from the
 * returned value.
 */

import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import {
  PROTOCOL_VERSION_PATH,
  RequestEnvelope,
  Endpoint,
  ResponseFor,
  WsEvent,
  HealthResponse,
  PortDiagnostics,
} from '@kairo/protocol';
import {
  KairoError,
  normaliseThrown,
  unwrapResponse,
} from './runtime-errors';
import { KairoErrorListener } from './runtime';
import { AgentEndpointValidator } from './runtime-security';

/** Window extensions injected by the Kairo preload script. */
interface KairoWindow {
  __kairo?: {
    agentBaseUrl: string;
    getSecret?: () => string;
  };
  kairoConfig?: {
    agentUrl: string;
  };
}

/** WsEvent with optional sequence number for replay support. */
type WsEventWithSequence = WsEvent & { sequence?: number };

/** Subprotocol name the agent requires for WS auth. */
export const KAIRO_WS_SUBPROTOCOL = 'kairo-secret-v1' as const;

/**
 * Response shape of GET /api/v1/endpoints. Kept local to
 * this package so the change ships in worker 1's commit
 * without touching the @kairo/protocol package (which
 * belongs to the wire-protocol owner).
 */
export interface RuntimeEndpoints {
  /** host:port for the /api/v1/* REST surface. */
  http: string;
  /** host:port for /api/v1/events (WebSocket). */
  events: string;
}

export interface KairoRuntimeConfig {
  baseUrl: string;
  sessionToken?: string;
  csrfToken?: string;
  /**
   * Agent shared secret. Sent as `X-Kairo-Secret` on every
   * HTTP request and as a WebSocket subprotocol token on
   * `/api/v1/events`. The frontend no longer uses
   * `Authorization: Bearer`.
   */
  agentSecret?: string;
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
  /** Multi-subscriber dispatch: workspaceId → set of callbacks. */
  private subscribers = new Map<string, Set<(event: WsEvent) => void>>();
  /**
   * Cached host:port returned by GET /api/v1/endpoints. The
   * frontend used to hardcode 18099; it now fetches this on
   * first use and threads it through every WS / EventStream
   * URL. Cached so the lookup is amortised.
   */
  private cachedEndpoints: RuntimeEndpoints | undefined;
  private endpointsPromise: Promise<RuntimeEndpoints> | undefined;
  /**
   * The single WebSocket / EventStream connection. All event
   * subscriptions flow through this one instance. Created
   * lazily on the first subscribeEvents() call.
   */
  private internalEventStream: EventStream | undefined;
  private statusSubscribers = new Set<(s: 'connecting' | 'open' | 'disconnected' | 'closed') => void>();
  /** Track the current workspaceId for the EventStream URL. */
  private activeWorkspaceId: string = '';
  /** Track the highest sequence seen so far for reconnection. */
  private sequence: number = 0;

  @postConstruct()
  protected init(): void {
    const fromWindow = this.tryInitFromWindow();
    const finishBootstrap = (): void => {
      this.eagerFetchEndpoints();
      this.refreshEventStreamAfterConfig();
    };
    if (!fromWindow) {
      // Browser mode: Theia often serves index.html via sendFile, so the
      // HTML <script> inject may never run. Fetch same-origin config from
      // the Theia backend (KAIRO-QA-002), then discover endpoints.
      // After late bootstrap, reopen EventStream so status bar is not stuck
      // on a pre-config WS that opened with empty URL/secret (KAIRO-QA-004).
      void this.bootstrapFromTheiaConfig().finally(finishBootstrap);
      return;
    }
    if (!this.agentSecret()) {
      // Browser/headless: URL from HTML inject or preload agentBaseUrl, but
      // secret is fetched same-origin from /kairo-agent-secret (S1 fix).
      void this.ensureAgentSecretFromBackend().finally(finishBootstrap);
      return;
    }
    this.eagerFetchEndpoints();
  }

  /**
   * Apply agent URL/secret from Electron preload / injected globals.
   * Browser secret is fetched later via /kairo-agent-secret when absent.
   * @returns true when a concrete agent URL was applied.
   */
  protected tryInitFromWindow(): boolean {
    if (this.config.baseUrl) {
      return true;
    }
    const kairo = (window as unknown as KairoWindow).__kairo;
    if (kairo && typeof kairo.agentBaseUrl === 'string' && kairo.agentBaseUrl) {
      if (AgentEndpointValidator.isAllowedAgentUrl(kairo.agentBaseUrl).allowed) {
        const secret = typeof kairo.getSecret === 'function' ? kairo.getSecret() : '';
        this.initialize(kairo.agentBaseUrl, secret);
        return true;
      }
    }
    const kairoCfg = (window as unknown as KairoWindow).kairoConfig;
    if (kairoCfg && kairoCfg.agentUrl) {
      if (AgentEndpointValidator.isAllowedAgentUrl(kairoCfg.agentUrl).allowed) {
        // Secret is never on kairoConfig; use __kairo.getSecret() only.
        const getSecret = (window as unknown as KairoWindow).__kairo?.getSecret;
        const secret = typeof getSecret === 'function' ? getSecret() : '';
        this.initialize(kairoCfg.agentUrl, secret);
        return true;
      }
    }
    // KAIRO-RC-WEB-015: allow ?kairoAgent= override; otherwise leave
    // baseUrl empty until bootstrapFromTheiaConfig / DEFAULT fallback.
    const fromQuery = typeof window.location?.search === 'string'
      ? new URLSearchParams(window.location.search).get('kairoAgent')
      : null;
    const injected = (globalThis as unknown as { __KAIRO_DEFAULT_RUNTIME_URL__?: string }).__KAIRO_DEFAULT_RUNTIME_URL__;
    const candidate = fromQuery ?? injected ?? '';
    if (candidate && AgentEndpointValidator.isAllowedAgentUrl(candidate).allowed) {
      this.config = { baseUrl: candidate };
      return !!this.config.baseUrl;
    }
    return false;
  }

  /**
   * Load agent URL from Theia backend JSON endpoint (non-secret fields only).
   * Secret comes from preload getSecret() or /kairo-agent-secret (browser).
   */
  async bootstrapFromTheiaConfig(): Promise<boolean> {
    try {
      const res = await fetch('/kairo-agent-config.json', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        if (!this.config.baseUrl) {
          this.config = { baseUrl: DEFAULT_RUNTIME_BASE_URL };
        }
        return false;
      }
      const body = await res.json() as { agentUrl?: string };
      if (body?.agentUrl && AgentEndpointValidator.isAllowedAgentUrl(body.agentUrl).allowed) {
        const secret = await this.resolveAgentSecret();
        this.initialize(body.agentUrl, secret);
        this.invalidateEndpoints();
        return true;
      }
      if (!this.config.baseUrl) {
        this.config = { baseUrl: DEFAULT_RUNTIME_BASE_URL };
      }
      return false;
    } catch {
      if (!this.config.baseUrl) {
        this.config = { baseUrl: DEFAULT_RUNTIME_BASE_URL };
      }
      return false;
    }
  }

  /**
   * When URL is already known (HTML inject / query param) but secret is
   * missing, fetch it from the Theia backend same-origin endpoint.
   */
  protected async ensureAgentSecretFromBackend(): Promise<void> {
    if (!this.config.baseUrl || !AgentEndpointValidator.isAllowedAgentUrl(this.config.baseUrl).allowed) {
      return;
    }
    const secret = await this.resolveAgentSecret();
    if (!secret || !this.config.baseUrl) {
      return;
    }
    this.initialize(this.config.baseUrl, secret);
    this.invalidateEndpoints();
  }

  /**
   * Prefer Electron preload getSecret(); fall back to same-origin backend.
   */
  protected async resolveAgentSecret(): Promise<string> {
    const kairo = (window as unknown as KairoWindow).__kairo;
    if (typeof kairo?.getSecret === 'function') {
      const fromPreload = kairo.getSecret();
      if (fromPreload) {
        return fromPreload;
      }
    }
    const existing = this.agentSecret();
    if (existing) {
      return existing;
    }
    return this.fetchAgentSecretFromBackend();
  }

  /** Same-origin secret channel for browser/headless (not in page source). */
  protected async fetchAgentSecretFromBackend(): Promise<string> {
    try {
      const res = await fetch('/kairo-agent-secret', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return '';
      }
      const body = await res.json() as { secret?: string };
      return body?.secret ?? '';
    } catch {
      return '';
    }
  }

  protected eagerFetchEndpoints(): void {
    // Eagerly resolve the dynamic host:port the agent is actually
    // bound to. Without this, the first ensureEventStream() call
    // (which fires when a view subscribes to events) uses
    // `wsHostPortFromBase(this.config.baseUrl)` as a fallback when
    // `cachedEndpoints` is still undefined. On a dev box where
    // the default port (18080) is already in use by another
    // instance, the fallback points at the wrong runtime and the
    // WebSocket fails to open with ERR_CONNECTION_REFUSED. The
    // resolution is fire-and-forget here so the UI mounts without
    // waiting, but the cache is populated by the time
    // subscribeEvents() is invoked a few hundred ms later.
    this.fetchEndpoints()
      .then(() => {
        // Endpoints (esp. events host:port) may differ from baseUrl —
        // reopen WS so status bar reflects a real agent connection.
        this.refreshEventStreamAfterConfig();
      })
      .catch((err) => {
      // Logged but not rethrown — the fallback path is still
      // functional if the endpoint discovery call fails (e.g.
      // the agent is unreachable at startup, comes up later).
      this.listener.onError(
        err instanceof KairoError ? err : new KairoError({
          code: 'internal',
          message: 'fetchEndpoints failed: ' + (err instanceof Error ? err.message : String(err)),
          cause: err,
        }),
        { endpoint: 'GET /api/v1/endpoints' as Endpoint, attempt: 0 },
      );
    });
  }

  /** Initialize the runtime with the agent URL and secret. */
  initialize(agentUrl: string, agentSecret: string): void {
    const isAllowed = AgentEndpointValidator.isAllowedAgentUrl(agentUrl).allowed;
    if (!isAllowed) {
      this.listener?.onError?.(
        new KairoError({
          code: 'forbidden',
          message: `Rejected disallowed agent URL: ${agentUrl}`,
        }),
        { endpoint: 'GET /api/v1/health' as Endpoint, attempt: 0 },
      );
      return;
    }
    const prevUrl = this.config.baseUrl;
    const prevSecret = this.agentSecret() ?? '';
    this.config = {
      baseUrl: agentUrl,
      agentSecret: agentSecret,
    };
    // Late browser bootstrap (or reconnect with new secret) must not leave
    // a stale EventStream opened against empty/wrong URL (KAIRO-QA-004).
    if (prevUrl !== agentUrl || prevSecret !== agentSecret) {
      this.invalidateEndpoints();
      this.refreshEventStreamAfterConfig();
    }
  }

  /**
   * Close any existing EventStream and reopen when there are subscribers.
   * Safe no-op when baseUrl is empty or nobody is listening yet.
   */
  protected refreshEventStreamAfterConfig(): void {
    if (!this.config.baseUrl) {
      return;
    }
    if (this.internalEventStream) {
      this.closeEventStream();
    }
    if (this.workspaceId && this.subscribers.size > 0) {
      this.ensureEventStream();
    } else if (this.subscribers.size > 0) {
      // Subscribers may have attached before workspaceId was set — still
      // open so status transitions to connecting/open for the status bar.
      this.ensureEventStream();
    }
  }

  configure(cfg: KairoRuntimeConfig): void {
    if (cfg.baseUrl && !AgentEndpointValidator.isAllowedAgentUrl(cfg.baseUrl).allowed) {
      return;
    }
    this.config = { ...this.config, ...cfg };
  }

  setWorkspace(id: string): void {
    if (this.workspaceId === id) {
      return;
    }
    this.workspaceId = id;
    if (this.internalEventStream) {
      this.closeEventStream();
    }
    if (this.workspaceId && this.subscribers.size > 0) {
      this.ensureEventStream();
    }
  }

  workspace(): string {
    return this.workspaceId;
  }

  /** Set the agent shared secret (sent as `X-Kairo-Secret`). */
  setAgentSecret(secret: string | undefined): void {
    if (this.config.baseUrl && !AgentEndpointValidator.isAllowedAgentUrl(this.config.baseUrl).allowed) {
      return;
    }
    this.config.agentSecret = secret;
  }

  baseUrl(): string {
    return this.config.baseUrl;
  }

  lastSeenHealth(): HealthResponse | undefined {
    return this.lastHealth;
  }

  /** Get the active agent secret for WS connections (public accessor). */
  getAgentSecret(): string | undefined {
    return this.agentSecret();
  }

  /**
   * The active agent secret, or undefined if none was configured.
   */
  protected agentSecret(): string | undefined {
    return this.config.agentSecret;
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

  /**
   * Discover the dynamic host:port the agent bound. Cached
   * after the first successful call. If the call fails, the
   * cache is left empty and the caller decides whether to
   * fall back to a pre-configured baseUrl.
   *
   * Per docs/hotfix-windows-test-readiness.md 搂2, this is
   * the single source of truth for the agent's address —
   * the frontend must NOT hardcode 18099.
   */
  async fetchEndpoints(forceRefresh = false): Promise<RuntimeEndpoints> {
    if (!forceRefresh && this.cachedEndpoints) {
      return this.cachedEndpoints;
    }
    if (this.endpointsPromise) {
      return this.endpointsPromise;
    }
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = `${base}/api/v1/endpoints`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.config.defaultTimeoutMs ?? 5_000);
    const promise = (async (): Promise<RuntimeEndpoints> => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          signal: ctl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          throw new KairoError({
            code: 'internal',
            message: `GET /api/v1/endpoints failed: HTTP ${res.status}`,
            httpStatus: res.status,
            details: text.slice(0, 200),
          });
        }
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch (parseErr) {
          throw new KairoError({
            code: 'internal',
            message: 'GET /api/v1/endpoints returned non-JSON',
            details: text.slice(0, 200),
            cause: parseErr,
          });
        }
        const ep = (body as { payload?: RuntimeEndpoints; http?: string; events?: string } | null) ?? null;
        // The agent returns an envelope; tolerate a bare object.
        const payload = (ep && 'payload' in ep && ep.payload ? ep.payload : ep) as
          | RuntimeEndpoints
          | null;
        if (!payload || typeof payload.http !== 'string' || typeof payload.events !== 'string') {
          throw new KairoError({
            code: 'internal',
            message: 'GET /api/v1/endpoints response missing http/events',
            details: text.slice(0, 200),
          });
        }
        this.cachedEndpoints = payload;
        return payload;
      } finally {
        clearTimeout(timer);
      }
    })();
    this.endpointsPromise = promise;
    try {
      return await promise;
    } finally {
      this.endpointsPromise = undefined;
    }
  }

  /**
   * Drop the cached endpoints so the next call re-fetches.
   * Called after a successful runtime restart, because the
   * new agent process may have bound a different port.
   */
  invalidateEndpoints(): void {
    this.cachedEndpoints = undefined;
  }

  /**
   * Query the agent for port diagnostics — check whether a
   * port is occupied and by which process.
   */
  async diagnosePort(port: number): Promise<PortDiagnostics> {
    const url = this.url('GET /api/v1/diagnostics/port', { query: { port: String(port) } });
    const headers: Record<string, string> = { Accept: 'application/json' };
    const secret = this.agentSecret();
    if (secret && AgentEndpointValidator.isAllowedAgentUrl(url).allowed) {
      headers['X-Kairo-Secret'] = secret;
    }
    const res = await fetch(url, { method: 'GET', headers, credentials: 'omit' });
    const body = await res.json().catch(() => undefined);
    const out = unwrapResponse(res, body);
    return out as PortDiagnostics;
  }

  async request<E extends Endpoint>(
    endpoint: E,
    payload: unknown,
    init: KairoRequestInit = {},
  ): Promise<ResponseFor<E>> {
    const env: RequestEnvelope = {
      workspaceId: this.workspaceId,
      requestId: newRequestId(),
      payload: payload as unknown as RequestEnvelope['payload'],
    };
    const method = methodOf(endpoint);
    // BD-P1-3 / S2: GET/HEAD never send a body, so flatten a non-empty
    // payload into query params (call-site `init.query` wins on key clash).
    let requestInit = init;
    if ((method === 'GET' || method === 'HEAD') && payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
      const fromPayload: Record<string, string | number | boolean | undefined> = {};
      for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          fromPayload[k] = v;
        }
      }
      requestInit = {
        ...init,
        query: { ...fromPayload, ...init.query },
      };
    }
    const url = this.url(endpoint, requestInit);
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
    const secret = this.agentSecret();
    if (secret && AgentEndpointValidator.isAllowedAgentUrl(url).allowed) {
      // The contract (§1.1) says the secret rides in
      // `X-Kairo-Secret`, never in `Authorization: Bearer`.
      headers['X-Kairo-Secret'] = secret;
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

  /**
   * Subscribe to connection status changes. The callback
   * fires immediately with the current status, then again
   * whenever the status transitions. Returns an unsubscribe
   * function.
   */
  onStatusChange(handler: (s: 'connecting' | 'open' | 'disconnected' | 'closed') => void): () => void {
    this.statusSubscribers.add(handler);
    // Fire immediately with current status.
    const current = this.internalEventStream?.status() ?? 'disconnected';
    handler(current);
    return () => {
      this.statusSubscribers.delete(handler);
    };
  }

  /**
   * Subscribe to runtime events via the single shared
   * WebSocket. Multiple callers can subscribe
   * simultaneously; each event is dispatched to every
   * registered callback across all workspaceIds.
   * Returns an unsubscribe function — call it when the
   * subscriber is no longer interested (e.g. on dispose).
   *
   * The host:port is taken from the cached
   * `RuntimeEndpoints.events` (NOT a hardcoded 18099), so
   * this method works even when the agent bound a different
   * port at startup.
   */
  subscribeEvents(workspaceId: string, onEvent: (event: WsEvent) => void): () => void {
    const key = workspaceId || '__no_workspace__';
    let subs = this.subscribers.get(key);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(key, subs);
    }
    subs.add(onEvent);

    // Only open the WebSocket once we have a real workspace id. The agent
    // rejects event-stream connections with an empty workspaceId, so opening
    // early produces a reconnect loop that keeps the status bar at
    // "connecting…" forever.
    if (workspaceId) {
      // BD-P1-1: switching workspace must update this.workspaceId so the
      // EventStream reconnects against the new workspace (closing alone
      // left ensureEventStream() reopening with the stale id).
      if (this.workspaceId !== workspaceId) {
        if (this.internalEventStream) {
          this.closeEventStream();
        }
        this.workspaceId = workspaceId;
      }
      this.ensureEventStream();
    }

    return () => {
      const s = this.subscribers.get(key);
      if (s) {
        s.delete(onEvent);
        if (s.size === 0) {
          this.subscribers.delete(key);
          // If no subscribers remain, close the EventStream.
          if (this.subscribers.size === 0) {
            this.closeEventStream();
          }
        }
      }
    };
  }

  /**
   * Force the shared EventStream to reconnect: close the current
   * WebSocket and reopen it against the freshly discovered
   * endpoints. Call this after `invalidateEndpoints()` when the
   * agent restarted (or re-bound a different port) so status and
   * event subscribers move onto the new socket. Existing
   * subscriptions are preserved — events resume once the new
   * stream is open.
   */
  reconnectEventStream(): void {
    this.closeEventStream();
    this.ensureEventStream();
  }

  // --- Private: single EventStream management ---

  /** Ensure the single shared EventStream exists and is
   * wired up for multi-subscriber dispatch. */
  private ensureEventStream(): void {
    if (!this.config.baseUrl) {
      return;
    }
    if (this.internalEventStream && this.internalEventStream.status() !== 'closed') {
      return;
    }
    const hostport = this.cachedEndpoints?.events ?? wsHostPortFromBase(this.config.baseUrl);
    const wsBase = hostport.startsWith('ws://') || hostport.startsWith('wss://')
      ? hostport
      : `ws://${hostport}`;
    let wsUrl = `${wsBase}${PROTOCOL_VERSION_PATH}/events`;
    if (this.workspaceId) {
      wsUrl += `?workspaceId=${encodeURIComponent(this.workspaceId)}`;
    }
    const stream = new EventStream(wsUrl, this.agentSecret(), this.sequence);
    this.internalEventStream = stream;

    // BD-P2-2: ignore status from a replaced/closed stream so a late
    // "disconnected" from the old socket cannot clobber a new open one.
    this.internalEventStream.onStatus(s => {
      if (this.internalEventStream !== stream) {
        return;
      }
      for (const fn of this.statusSubscribers) {
        fn(s);
      }
    });

    // Wire up multi-subscriber dispatch: every event from
    // the single EventStream is forwarded to ALL registered
    // subscribers across all workspaceIds.
    this.internalEventStream.on('*', (e: WsEvent) => {
      if (this.internalEventStream !== stream) {
        return;
      }
      this.sequence = (e as WsEventWithSequence).sequence ?? this.sequence;
      this.internalEventStream?.setSequence(this.sequence);
      for (const subs of this.subscribers.values()) {
        for (const fn of subs) {
          fn(e);
        }
      }
    });
  }

  private closeEventStream(): void {
    if (this.internalEventStream) {
      this.internalEventStream.close();
      this.internalEventStream = undefined;
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
 * Build a `host:port` string from a configured baseUrl
 * (which is typically `http://127.0.0.1:18099` or
 * `https://...`). Used as a fallback when
 * `RuntimeEndpoints` is not yet cached.
 */
function wsHostPortFromBase(baseUrl: string): string {
  const stripped = baseUrl
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
  return stripped || '127.0.0.1:0';
}

/**
 * Dev default for the browser entry (which has no preload to
 * inject the agent URL). Matches runtime-agent/configs/dev.yaml
 * port 18080. The desktop app overrides this via preload.
 * Supports AGENT_PORT environment variable for testing.
 */
const DEFAULT_RUNTIME_BASE_URL = typeof process !== 'undefined' && process.env?.AGENT_PORT
  ? `http://127.0.0.1:${process.env.AGENT_PORT}`
  : 'http://127.0.0.1:18080';

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
  /** Highest sequence number seen. Sent as `?since=` on reconnect for replay. */
  protected sequence: number = 0;

  constructor(protected url: string, protected agentSecret?: string, sequence?: number) {
    if (sequence !== undefined) this.sequence = sequence;
    this.connect();
  }

  /** Set the last known sequence for replay on next reconnect. */
  setSequence(seq: number): void {
    if (seq > this.sequence) this.sequence = seq;
  }

  /** Get the current sequence number. */
  getSequence(): number {
    return this.sequence;
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
      // Per docs/hotfix-windows-test-readiness.md §1.2, the
      // secret rides in a Sec-WebSocket-Protocol token. The
      // server selects this subprotocol on upgrade and rejects
      // anonymous connections.
      const isAllowed = AgentEndpointValidator.isAllowedAgentUrl(this.url).allowed;
      const protocols = (this.agentSecret && isAllowed)
        ? [KAIRO_WS_SUBPROTOCOL, this.agentSecret]
        : [];
      // Sequence replay: on reconnect, send `?since=<seq>` so the
      // server can replay events we missed while disconnected.
      const hasQuery = this.url.includes('?');
      const connectUrl = this.sequence > 0
        ? `${this.url}${hasQuery ? '&' : '?'}since=${this.sequence}`
        : this.url;
      ws = protocols.length > 0
        ? new WebSocket(connectUrl, protocols)
        : new WebSocket(connectUrl);
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
        // Track sequence for replay on reconnect
        if ((e as WsEventWithSequence).sequence !== undefined) {
          this.sequence = Math.max(this.sequence, (e as WsEventWithSequence).sequence!);
        }
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
    // Full jitter: wait = random(0, backoffMs)
    const jittered = Math.random() * this.backoffMs;
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    this.reconnectTimer = setTimeout(() => this.connect(), jittered);
  }

  protected setStatus(s: 'connecting' | 'open' | 'disconnected' | 'closed'): void {
    if (this.currentStatus === s) return;
    this.currentStatus = s;
    for (const fn of this.statusListeners) fn(s);
  }
}
