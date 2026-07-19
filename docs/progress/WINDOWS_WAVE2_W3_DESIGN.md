# Agent W3 — RuntimeGateway Design (Phase 0, design only)

> **Owner**: Agent W3 (Runtime Contract) — Windows Wave 2
> **Branch**: `feature/windows-wave2-product-vertical-slice` @ `c0c7491`
> **Companion**: `WINDOWS_WAVE2_W3_AUDIT.md` (gap catalogue, severity ranking)
> **Reference contract**: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §7
> **Mode**: design only. No TS code in `packages/runtime-extension/src/`.
> No Go code in `runtime-agent/internal/`. The interface in §2 is
> a TypeScript draft; the Go-side wiring is described in prose
> with the exact file/line it will touch. **No code is committed
> in this Phase 0 round.**
> **Status**: **proposal**, pending Phase 0 Gate, W2 preload-contract
> review, W6 sign-off, and (for §3.4 + §3.5) Mac Core acceptance
> of the two Contract Requests (CR-W3-01, CR-W3-02).

This document is the bridge between the audit's gap list and
the Phase 2 implementation. Every design decision cites the
audit gap it resolves and the §7 clause it satisfies.

---

## 0. Scope and non-goals

**In scope** (Phase 2 deliverable):

- The `RuntimeGateway` TypeScript interface (§2) — the single
  surface every Widget / Store / StatusBar / Service injects.
- The `EndpointMap` runtime contract and the dynamic-endpoints
  discovery protocol (§3).
- The HTTP behaviour spec — typed error enum, AbortSignal
  propagation, request-id preservation, retry policy, 401 → connection
  invalidation (§4).
- The WebSocket behaviour spec — subprotocol auth, backoff +
  jitter, single-socket / single-timer guarantee, snapshot
  recovery on reconnect, post-restart `invalidateEndpoints`
  hook (§5).
- The migration path that deletes the legacy `connectEvents`
  path, the orphaned `KairoRuntimeImpl` test imports, and the
  `preload.ts:20` `18099` literal (§6).
- The Phase 2 commit plan and the Contract Requests to Mac Core
  for the items W3 cannot implement from the Windows branch
  alone (§7).

**Out of scope** (different Agent / different phase):

- Desktop main / preload rewrite → W2 (Phase 1).
- Theia widgets / store visual layer → W4 (Phase 3).
- JDT LS distribution / launch descriptor → W5 (Phase 4).
- `runtime-agent/internal/services/*` business logic → Mac Core.
- `runtime-agent/internal/transport/events/eventhub.go` →
  Mac Core (B3 schema migration; see §3.4 below).
- `runtime-agent/internal/services/services.go:78` wiring of
  `EventBus` → Mac Core (B2; see §3.5 below).

**Non-goals** (explicit "do not do" in Phase 2):

- No second Runtime client / EventStream (deletes the
  `connectEvents` path entirely; §6.2).
- No JSON-in-handler business logic on the Go side
  (stays as a thin wire adapter per §7.6).
- No universal event-sourcing framework (snapshot recovery
  uses the existing `EventHub.GetHistory` / `Sequence`
  mechanism; no Kafka, no NATS).
- No protocol DTO renames that would break the existing
  `WsEvent` / `BuildResult` / `ServerInstance` consumers.
- No opaque ID → path translation in the renderer (the
  contract §12.1 forbids the renderer sending paths;
  W3 does not relax this).

---

## 1. Design principles

1. **The interface is the contract.** Every Widget, Store,
   StatusBar, and Service depends on the `RuntimeGateway`
   interface (or a narrow sub-interface like
   `RuntimeReadGateway` / `RuntimeWriteGateway` if the
   read-only / read-write split becomes useful). None
   depends on `RuntimeConnectionService` directly.
2. **The class implements the interface; the interface is
   what consumers see.** Test doubles, the
   `FakeRuntimeGateway` for W4, the production class — all
   satisfy the same `RuntimeGateway` interface.
3. **The endpoint discovery is a first-class part of the
   gateway, not a side-method.** The gateway owns the
   `EndpointMap` snapshot and re-discovers on Agent
   restart; consumers never know which "moment" they got
   the snapshot from.
4. **Errors are typed and stable.** Every error from the
   gateway is a `KairoError` (or a subclass) with a closed
   enum `code`. The renderer never sees a raw `Error`.
5. **Secrets never leave the gateway's boundary.** The
   `agentSecret` field is set once by the preload (per W2's
   contract) and never serialised through any public method
   (`status()`, `lastSeenHealth()`, listener payloads, etc.).
6. **WebSocket is a single resource, owned by the gateway.**
   The gateway owns one `WebSocket`, one `reconnectTimer`,
   one `setTimeout` for the backoff. Consumers subscribe via
   `subscribe(listener)` which returns a `Disposable`. The
   gateway multiplexes event types internally.
7. **Phase 2 is a net deletion.** The legacy `connectEvents`
   path is removed; the legacy `KairoRuntimeImpl` test
   imports are replaced; the `preload.ts:20` `18099` literal
   is removed. The total line count of the runtime
   extension goes **down**, not up.

---

## 2. The `RuntimeGateway` interface

This is the single TypeScript interface every consumer
injects. It is a draft — the final wording will be
frozen after W2's preload contract and W4's
BuildStore / ServerStore review.

```ts
// packages/runtime-extension/src/common/runtime-gateway.ts
// (new file; re-exported from src/index.ts and src/browser/index.ts)

import type { Disposable, Event } from '@theia/core';   // Theia type aliases
import type { RequestEnvelope, WsEvent, KairoErrorCode } from '@kairo/protocol';

/**
 * A stable, machine-readable description of a runtime
 * endpoint. Populated from the dynamic `/api/v1/endpoints`
 * discovery call; refreshed automatically on Agent restart.
 */
export interface RuntimeEndpoint {
  /** `host:port` (no scheme) for the HTTP REST surface. */
  readonly http: string;
  /** `host:port` (no scheme) for the `/api/v1/events` WS. */
  readonly events: string;
  /** Agent version string (from `/api/v1/health`). */
  readonly agentVersion: string;
  /** Last time the snapshot was fetched. */
  readonly fetchedAt: string;       // ISO-8601
}

/**
 * A typed error response. The `code` is a closed enum
 * (see @kairo/protocol KairoErrorCode). The `retryable` flag
 * tells the caller whether to attempt the same call again.
 * The `requestId` is the server's `X-Kairo-Request-Id`
 * header (or the client's UUID for early-stage failures).
 */
export interface RuntimeErrorShape {
  readonly code: KairoErrorCode;
  readonly message: string;
  readonly httpStatus?: number;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly observedAt: string;     // ISO-8601
  readonly cause?: unknown;        // low-level cause (e.g. DOMException)
}

/**
 * Per-call options. All fields are optional; the gateway
 * applies defaults from its configuration.
 */
export interface RequestOptions {
  /** Abort the request when the signal fires. */
  readonly signal?: AbortSignal;
  /** Per-request timeout in ms. Overrides gateway default. */
  readonly timeoutMs?: number;
  /** Skip the automatic transient retry. Default false. */
  readonly noRetry?: boolean;
  /** Extra path substitutions (in addition to those on the
   *  operation). Rare; most callers use the `Operation.pathParams`. */
  readonly pathParams?: Readonly<Record<string, string>>;
  /** Query string parameters. */
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
}

/**
 * A typed operation. Bundles the wire endpoint string with
 * its expected request / response payload types. The
 * `Operation<TReq, TRes>` is a phantom-typed view over a
 * string; the runtime does not do compile-time
 * `EndpointMap` lookup (zod / io-ts is Phase 6 work), but
 * the shape makes the call site self-documenting.
 */
export interface Operation<TReq, TRes> {
  /** Wire endpoint, e.g. "GET /api/v1/servers/{serverId}". */
  readonly endpoint: string;
  /** Compile-time type tag; the runtime does not inspect it. */
  readonly __req?: TReq;
  readonly __res?: TRes;
}

/**
 * Helper: builds a typed operation. Consumers write
 *
 *   const StartBuild = operation<StartBuildRequest, BuildResult>(
 *     'POST /api/v1/builds',
 *   );
 *
 * and pass `StartBuild` to `gateway.request(...)`. The
 * runtime does not consume `__req` / `__res`; they exist
 * only for compile-time inference of the call signature.
 */
export function operation<TReq, TRes>(endpoint: string): Operation<TReq, TRes> {
  return { endpoint };
}

/**
 * Connection snapshot for the UI. Emitted on the
 * `onConnectionChange` event and returned by
 * `gateway.status()`. Includes last-error so a banner can
 * show "Runtime Agent: 401 since 14:02".
 */
export interface ConnectionSnapshot {
  /** Last-known endpoint snapshot, or undefined if the
   *  gateway has not yet discovered the agent. */
  readonly endpoint: RuntimeEndpoint | undefined;
  /** High-level connection state. */
  readonly state:
    | 'uninitialized'        // never contacted
    | 'discovering'          // calling /api/v1/endpoints
    | 'connected'            // last health check OK
    | 'reconnecting'         // WS down, retrying with backoff
    | 'failed';              // gave up (e.g. 401 repeated, no port)
  /** Last error observed, or undefined. */
  readonly lastError: RuntimeErrorShape | undefined;
  /** Last time the connection state changed. */
  readonly stateChangedAt: string;   // ISO-8601
  /** Current WS reconnect attempt (0 if never tried). */
  readonly reconnectAttempts: number;
  /** Last successful `request()` (any operation). */
  readonly lastSuccessAt: string | undefined;
}

/**
 * Listener for typed runtime events. The gateway fires
 * these on the single WebSocket. Consumers subscribe via
 * `subscribe(listener)` and receive a `Disposable` for
 * teardown.
 */
export interface RuntimeEventListener {
  /** Called for every WsEvent that arrives. The listener
   *  receives a `WsEvent` (typed discriminated union) and
   *  decides whether to handle it. */
  onEvent(event: WsEvent): void;
}

/* ------------------------------------------------------------------ */
/*  The single gateway surface                                          */
/* ------------------------------------------------------------------ */

/**
 * RuntimeGateway — the single connection entry point that
 * every Widget / Store / StatusBar / Service injects.
 *
 * Implementations are responsible for:
 *   - Endpoint discovery (§3) and refresh on Agent restart.
 *   - HTTP request signing (§4): X-Kairo-Secret, request id,
 *     JSON content type, AbortSignal / timeout, typed error
 *     unwrap, transient retry.
 *   - WebSocket subscription (§5): subprotocol auth, backoff
 *     + jitter, single socket, snapshot recovery on reconnect.
 *   - Connection-state events (§4.7, §5.9) for the StatusBar
 *     and the renderer-side banner.
 *
 * Implementations are NOT responsible for:
 *   - Project / Build / Deploy business logic (Mac Core).
 *   - Widget / Store presentation (W4).
 *   - JDT LS distribution or process lifecycle (W5).
 */
export interface RuntimeGateway {
  /* ---- HTTP ---- */

  /**
   * Issue a typed HTTP request.
   *
   * Returns the unwrapped payload (`payload` of the success
   * envelope). Throws `RuntimeError` (a typed error class
   * implementing `RuntimeErrorShape`) on any non-2xx, on
   * any `ok: false` envelope, on timeout, on AbortSignal,
   * on network errors, and on schema-validation failures.
   */
  request<TReq, TRes>(
    operation: Operation<TReq, TRes>,
    body: TReq,
    options?: RequestOptions,
  ): Promise<TRes>;

  /**
   * Issue a GET that takes no body. Convenience wrapper.
   */
  get<TRes>(
    operation: Operation<undefined, TRes>,
    options?: RequestOptions,
  ): Promise<TRes>;

  /* ---- WebSocket ---- */

  /**
   * Subscribe to the live event stream. The listener is
   * invoked for every WsEvent that the gateway receives
   * over the single WebSocket. Returns a `Disposable` that
   * unsubscribes. Multiple listeners are allowed; the
   * gateway multiplexes internally.
   *
   * The subscription survives WS reconnects: the listener
   * receives events from the new socket without the
   * consumer having to resubscribe.
   */
  subscribe(listener: RuntimeEventListener): Disposable;

  /* ---- Connection state ---- */

  /**
   * Snapshot of the current connection. Always defined;
   * the `state` field carries the full lifecycle.
   * `onConnectionChange` fires on every state transition.
   */
  status(): ConnectionSnapshot;

  /**
   * Subscribe to connection state transitions. Fires for
   * every change to `status()`. Returns a `Disposable`.
   */
  onConnectionChange(listener: (snap: ConnectionSnapshot) => void): Disposable;

  /**
   * Force a re-discovery of the Agent endpoints. The
   * gateway will re-call `/api/v1/endpoints`, re-open the
   * WS, and emit a `'connected'` state when the new
   * endpoint is verified. Returns a Promise that resolves
   * when the re-discovery is complete (or rejects on
   * failure; the rejection is also surfaced as the next
   * `status()` payload's `lastError`).
   */
  reconnect(): Promise<void>;

  /**
   * Drop all internal caches (endpoint snapshot, last
   * health) and force a re-discovery on the next call.
   * This is the public hook W2's supervisor calls when
   * it observes an Agent crash; it is also called
   * internally on any 401 from `/api/v1/health`.
   */
  invalidate(): void;
}

/**
 * RuntimeError — the only error class the gateway throws.
 * Implements `RuntimeErrorShape` so consumers can use
 * structured-typed narrowing:
 *
 *   try {
 *     await gateway.request(StopServer, { id });
 *   } catch (err) {
 *     if (err.code === 'conflict') {
 *       messages.warn('Server is currently busy.');
 *     } else if (err.code === 'unauthenticated') {
 *       // handled by the connection banner; no toast
 *     } else {
 *       throw err;
 *     }
 *   }
 */
export class RuntimeError extends Error implements RuntimeErrorShape {
  readonly code: KairoErrorCode;
  readonly httpStatus?: number;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly observedAt: string;
  readonly cause?: unknown;

  constructor(init: RuntimeErrorShape) {
    super(init.message, { cause: init.cause });
    this.name = 'RuntimeError';
    Object.assign(this, init);
  }

  /** True if the gateway considers the failure transient
   *  (timeout, network, 5xx, retryable agent response). */
  isTransient(): boolean { /* see §4.6 */ }

  /** True if the error implies the connection itself is
   *  invalid (401, schema-violation, port mismatch). The
   *  gateway emits a 'reconnecting' / 'failed' state in
   *  response. */
  invalidatesConnection(): boolean { /* see §4.7 */ }
}
```

### 2.1 What this interface deletes

- `KairoRuntime` Symbol — gone. Consumers inject
  `RuntimeGateway` directly. The Symbol is removed
  (`runtime.ts:14` and `index.ts:12,20,32,68-71`).
- `KairoErrorListener` — gone. Replaced by the
  `onConnectionChange` event on the gateway. The legacy
  `runtime-connection-service.ts:391` `listener.onError(...)`
  call becomes a no-op (or is removed; the gateway emits
  state events on its own).
- `KairoRuntimeImpl` test imports — replaced by
  `RuntimeConnectionService` (or `FakeRuntimeGateway` in W4
  tests).
- `connectEvents(workspaceId, onEvent)` — gone. The single
  WS resource is owned by the gateway. `BuildStore` and
  `ServerStore` migrate to `gateway.subscribe(...)`.
- `setBearerToken` (the deprecated alias) — gone.
- `RUNTIME_BASE_URL` constant — gone. The gateway
  discovers its own base URL via `/api/v1/endpoints`.

### 2.2 Backwards compatibility for one release

The audit's `m1` and `m10` minor items are still in the
interface as a one-release shim:

```ts
// In RuntimeConnectionService (the production class), keep
// these as thin wrappers that delegate to the gateway so
// existing consumers that still call them keep working.
class RuntimeConnectionService implements RuntimeGateway {
  // ... full interface ...

  /** @deprecated use gateway.request with a typed operation */
  request<E extends string>(endpoint: E, payload: unknown, init?: KairoRequestInit): Promise<unknown> {
    return this.request(operation<unknown, unknown>(endpoint), payload, init);
  }

  /** @deprecated the gateway manages the WS; this becomes
   *  a one-shot subscription that returns a Disposable */
  openEvents(): EventStreamHandle { return ... }

  /** @deprecated use gateway.subscribe(listener) */
  connectEvents(workspaceId: string, onEvent: (e: any) => void): () => void { ... }
}
```

The `EventStream` class becomes an internal detail of the
gateway (renamed `EventStreamHandle` to make the boundary
clear). It is **not exported** from `index.ts`. W4
constructs a `FakeRuntimeGateway` for tests; nothing else
needs the handle.

---

## 3. EndpointMap design

### 3.1 Static vs dynamic endpoints

§7.2 says the gateway must:

1. Get the bootstrap endpoint from Desktop config.
2. Call `GET /api/v1/endpoints` to learn the real host:port.
3. Validate the response shape.
4. Store an immutable snapshot.
5. Re-discover on Agent restart.
6. Emit a single connection event when the endpoint changes.

**Today**, the static `EndpointMap` interface
(`packages/protocol/src/index.ts:518-548`) is a compile-time
table of 22 endpoint strings → request / response DTO pairs.
**The dynamic `/api/v1/endpoints` response is a separate
shape** (`RuntimeEndpoints { http: string; events: string }`,
defined locally in
`runtime-connection-service.ts:79-82`).

The Phase 2 design unifies the two:

```ts
// packages/protocol/src/index.ts — add (do not break existing)

// The dynamic response from the Agent, with versioning
// and an explicit `schemaVersion` field.
export interface RuntimeEndpoints {
  /** Schema version. Bumped on breaking changes to the
   *  shape. Phase 2 ships `1`. */
  readonly schemaVersion: 1;
  /** `host:port` (no scheme) for the HTTP REST surface. */
  readonly http: string;
  /** `host:port` (no scheme) for `/api/v1/events` (WS). */
  readonly events: string;
  /** Agent version string. Mirrored from /api/v1/health. */
  readonly agentVersion: string;
  /** `host:port` that the Agent is actually bound to
   *  (may differ from `http` if a proxy fronts it). */
  readonly bindAddress?: string;
  /** True iff the Agent has TLS enabled. */
  readonly tls: boolean;
}
```

The gateway fetches this on construction; rejects anything
that does not pass the schema; caches the snapshot; and
re-fetches whenever `invalidate()` is called or a 401 / 5xx
implies the port has rotated.

### 3.2 Schema validation

The simplest schema check that catches typos is
**type-guard** at the boundary, not full zod validation:

```ts
function isRuntimeEndpoints(x: unknown): x is RuntimeEndpoints {
  return !!x && typeof x === 'object'
    && (x as any).schemaVersion === 1
    && typeof (x as any).http === 'string'
    && typeof (x as any).events === 'string'
    && typeof (x as any).agentVersion === 'string'
    && typeof (x as any).tls === 'boolean';
}
```

Anything that fails the guard throws a
`RuntimeError{ code: 'invalid_request', message: '/api/v1/endpoints did not match schema', details: body.slice(0, 200) }`
and the gateway enters `'failed'` state. This is the §7.2.3
"validate schema/version" requirement.

Full payload validation per endpoint (zod / io-ts) is **Phase
6 work** — see audit M2 / m6. Phase 2 ships the
`RuntimeEndpoints` validator only.

### 3.3 Re-discovery on Agent restart

§7.2.5: "Agent restart后重新发现".

The `POST /api/v1/runtime/restart` handler
(`runtime-agent/internal/api/handlers.go:679-707`) responds
200 immediately, then spawns the replacement process and
exits. The replacement binds a new (possibly different) port.
The gateway must:

1. See the restart through the HTTP path (the new Agent's
   `/api/v1/health` will respond with a new `agentVersion`
   and possibly a different `port`).
2. Detect the port change (compare the new `/api/v1/endpoints`
   `http` to the cached snapshot).
3. Re-open the WS to the new endpoint.
4. Emit a single `onConnectionChange({ state: 'reconnecting', ... })`
   followed by `'connected'` once verified.

The implementation: the gateway exposes
`invalidate(): void` (audit B4). The `EventStream` `onclose`
calls `invalidate()` automatically. The `RuntimeConnectionService`
**no longer** has a `cachedEndpoints` field that the caller
must manually flush; the gateway owns the cache.

### 3.4 The `WsEvent` ↔ `events.Event` schema (audit B3)

The Go side has its own `events.Event` struct with
discriminators like `build.started` and `build.completed`
(`internal/transport/events/eventhub.go:13-32`). The TS side
has `WsEvent` with `build.progress` / `server.state` /
`log` / `audit` / `diagnostic` / `deployment.progress`
(`packages/protocol/src/index.ts:577-592`).

**Three options:**

| Option | Description | Cost | W3 owns? |
|--------|-------------|------|----------|
| A. Translate in the Go `handleEvents` path | The `handleEvents` middleware, after the subprotocol auth, normalises the generic `events.Event` to a `protocol.WsEvent` before sending | ~0.5 day. Re-uses the existing middleware; no consumer changes | Yes (W3 edits `handlers.go`) |
| B. Rename Go events to match `WsEvent` | Rename `EventBuildStarted` → never published (start is progress), `EventBuildCompleted` → `build.progress` with state=`success`, etc. | ~1 day; touches every use-case publisher. Higher risk of regression | No (Mac Core owns `eventhub.go`) |
| C. Add a thin schema-conformance contract test, ship a `events.Event → WsEvent` translator on the TS side, mark B3 partial | Skip the Go-side work; document the contract gap; deliver in Phase 6 | 0 days of Go work; ships as a known partial | Mixed |

**Recommendation: Option A** (translate in `handleEvents`).
W3 owns `runtime-agent/internal/api/handlers.go` (per the
file-ownership matrix §3.1). The `handleEvents` middleware
already does subprotocol auth; adding a translation step
just before the WS upgrade is a small, isolated change.
**Contract Request CR-W3-01** documents the proposed
translation table; Mac Core reviews; if they reject,
fall back to Option C.

### 3.5 The `EventBus` wiring (audit B2)

`runtime-agent/internal/services/services.go:78` constructs
the `*api.Services` struct but never sets `EventBus`. The
`EventHub` exists in the `Container` but is not connected.

**W3 does not own** `internal/services/...` (Mac Core). W3
files **Contract Request CR-W3-02**:

> Wire `container.EventHub` to `container.Services.EventBus`
> via a one-line adapter that calls `EventHub.ServeWS`. The
> adapter is in
> `runtime-agent/internal/api/eventbus_adapter.go` (new
> file, W3-owned). Mac Core adds the field assignment in
> `internal/services/services.go`.

The adapter:

```go
// runtime-agent/internal/api/eventbus_adapter.go
// (W3-owned, drafted here for review; not committed in Phase 0)

package api

import "net/http"
import "github.com/kairo-ide/runtime-agent/internal/transport/events"

// EventBusAdapter wraps an *events.EventHub so it satisfies
// the api.EventBus interface. The Handle method delegates
// to EventHub.ServeWS, which already does the gorilla
// upgrade and the publish loop. W3 owns this file; the
// Mac Core NewMemoryServices factory assigns the wrapped
// value to api.Services.EventBus.
//
// Why we need an adapter rather than adding Serve to the
// EventHub directly: ServeWS is on *events.EventHub which
// is a *transport-layer* type. api.EventBus is an *api-layer*
// interface. Keeping the dependency direction
// api → transport (not the other way) is the layering rule
// from the Wave-1 contract.
type EventBusAdapter struct{ Hub *events.EventHub }

func (a EventBusAdapter) Serve(w http.ResponseWriter, r *http.Request) {
    a.Hub.ServeWS(w, r)
}
```

Once CR-W3-02 lands, the WS path becomes live; the gateway's
`openEvents()` returns a real stream; `BuildStore` and
`ServerStore` can drop `connectEvents()`.

### 3.6 No production fallback to 18099/3000

§7.2.7 forbids the fallback. The `apps/desktop/src/preload.ts:20`
literal is deleted as part of the W2 + W3 cross-cutting work:

- W2 rewrites the preload to expose a `getEndpoints()` async
  method (replacing the plain-object `kairoConfig` per W2
  audit `B1`).
- W3's `RuntimeConnectionService.configure()` accepts an
  `endpointProvider: () => Promise<RuntimeEndpoints>` callback.
- The preload `getEndpoints()` returns the live map; the
  gateway uses it as the bootstrap.

In `pnpm start` (dev), if no preload is present, the
gateway reads `process.env.KAIRO_AGENT_URL` (or the
`(globalThis as any).__KAIRO_DEFAULT_RUNTIME_URL__` global
for the browser dev path). **No literal `18099`** in the
production path; if the env is unset the gateway enters
`'failed'` state with a clear message instead of
silently pointing at a dead port.

---

## 4. HTTP behaviour spec

### 4.1 Headers

Every request to a non-`/api/v1/health`, non-`/api/v1/endpoints`
URL carries:

```text
X-Kairo-Secret:        <secret, from preload>
X-Kairo-Request-Id:    <UUIDv4, generated by the gateway>
X-Kairo-Workspace-Id:  <workspaceId, set via setWorkspace>
X-Kairo-CSRF:          <csrfToken, when present and method != GET>
Content-Type:          application/json   (for non-GET, non-HEAD)
Accept:                application/json
```

`Authorization: Bearer` is **not** set. The audit found
no place it is set today; this is preserved.

### 4.2 Request envelope

`runtime-connection-service.ts:320-326` already builds the
envelope correctly:

```ts
const env: RequestEnvelope = {
  workspaceId: this.workspaceId,
  requestId: newRequestId(),
  payload: payload as any,
};
```

`projectId` is **not** included by the gateway; the server
resolves it from the workspace context. The renderer never
sends a path (per §12.1).

### 4.3 AbortSignal propagation

The composition of parent-signal + timeout is preserved
(`runtime-connection-service.ts:458-479`, `composeAbort`).
Two refinements:

1. **Distinct abort code.** Today, caller-initiated abort
   surfaces as `KairoError{ code: 'timeout' }` (audit M7).
   Phase 2 splits this:
   - `code: 'aborted'` — caller called `controller.abort()`.
   - `code: 'timeout'` — our internal timer fired.
2. **Per-call `timeoutMs` defaults.** The default is
   `defaultTimeoutMs` (60 000ms) for normal calls, but
   the gateway exposes a distinct `endpointsTimeoutMs`
   (default 5 000ms) for `/api/v1/endpoints`. This fixes
   audit M5.

### 4.4 Response envelope unwrap

`unwrapResponse` (`runtime-errors.ts:142-194`) is the
canonical unwrap. Phase 2 changes:

- It now reads the `X-Kairo-Request-Id` response header
  (audit m3) and stores it on the `RuntimeError` as
  `requestId`. The renderer can show
  "request req_abc123 timed out" in toasts.
- It surfaces the 4xx status code in the typed
  `code` field with one extra value: 422 is split out
  from `invalid_request` into `validation_failed` (audit
  m2). The `KairoErrorCode` enum grows by one entry;
  the Go side grows by one constant. (Both are
  backwards-compatible additions.)

### 4.5 Transient retry policy

Today, `isTransient()` (`runtime-errors.ts:67-76`) returns
`true` for `code === 'timeout'`, `'io_error'`,
`'process_spawn_failed'`, and `httpStatus >= 500`. Phase 2
adds:

- `code === 'aborted'` is **not** transient (caller
  decided to cancel; retrying would be wrong).
- `code === 'validation_failed'` (422) is **not** transient.
- `code === 'unauthenticated'` (401) is **not** transient
  *and* sets `invalidatesConnection() === true` (§4.7).
- `code === 'conflict'` (409) is **not** transient.

The retry budget is `maxRetries` (default 2), with backoff
`100ms * 2^attempt` capped at 2 000ms (today's policy,
audit m5: missing jitter — Phase 2 adds ±25% jitter).

### 4.6 401 → connection invalidation (audit B3 in §3 audit → here §4.6)

§7.3 seventh bullet, DoD §3.5. The gateway's
`onConnectionChange` listener fires with:

```ts
{
  state: 'reconnecting',
  lastError: { code: 'unauthenticated', message: '...', httpStatus: 401, requestId: '...', ... },
  // endpoint snapshot is preserved (it's still the right host:port)
}
```

The gateway then re-runs `/api/v1/endpoints` once (in case
the Agent rotated its secret, unlikely, but defensive). If
the secret mismatch persists, the state moves to `'failed'`
after 3 consecutive 401s with a clear "Runtime Agent
authentication failed" message. The status bar and the
banner show this without spamming toasts.

### 4.7 `KairoError` → `RuntimeError` (audit m8)

The audit's `KairoError` class
(`runtime-errors.ts:33-85`) is renamed to `RuntimeError`
and **moved** to `packages/runtime-extension/src/common/runtime-gateway.ts`
(where the new interface lives). It implements
`RuntimeErrorShape` and adds two methods: `isTransient()`
and `invalidatesConnection()`. The `format()` method is
preserved for backward-compat with `kairoErrorMessage` in
`kairo-views-contribution.ts:389-394`.

The `KairoErrorListener` (Symbol + interface + default impl
in `runtime.ts:14-25`) is **deleted**. The
`onConnectionChange` event replaces it: listeners receive
the full `ConnectionSnapshot` (which includes the last
error) instead of a per-request callback. This is a
cleaner model and removes the no-op dead code (audit m8).

### 4.8 Schema-validation stub (audit m6)

`unwrapResponse` is extended with a **single** payload
validator: the `RuntimeEndpoints` shape (audit §3.2).
Everything else is best-effort. Full zod-based validation
is Phase 6. This is the minimum that catches the
"Agent returned garbage" failure mode that today just
shows a generic internal error.

### 4.9 Log redaction (audit m9)

`KairoError.details` is `unknown` and could in principle
carry the secret if a future Go handler put it there. The
Phase 2 contract doc (`docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md`)
adds a rule:

> Agent MUST NOT place the `X-Kairo-Secret` value, or any
> sub-string matching the secret length, in any field of
> the `KairoError` payload. The Go redactor
> (`runtime-agent/internal/log/log.go:78-99`) MUST be
> applied to the response body before serialisation.

The TS side adds a `sanitiseError(err: RuntimeError): RuntimeError`
helper that strips any value longer than 16 chars from
`details` if `process.env.NODE_ENV === 'production'`
(paranoid; the rule is enforced on the server side, this
is a belt-and-braces check).

---

## 5. WebSocket behaviour spec

### 5.1 Single resource, single owner

The gateway owns:

- One `WebSocket` instance.
- One `reconnectTimer: ReturnType<typeof setTimeout>`.
- One `closedByCaller: boolean` flag.
- One `backoffMs: number` (starts at 250ms).
- One `maxBackoffMs: number` (15 000ms).
- One `currentSequence: number` (from the last server
  event with `sequence > 0`).
- One listener Set: `Set<RuntimeEventListener>`.
- One status listener Set: `Set<(snap: ConnectionSnapshot) => void>`.

The legacy `connectEvents(workspaceId, onEvent)` is deleted.
The `eventSocket` / `sequence` / `reconnectTimer` fields
on `RuntimeConnectionService` (lines 100-102) are deleted.
The `EventStream` class is renamed `EventStreamHandle`,
moved into a `private` sub-module, and **not exported**.

### 5.2 Subprotocol auth

`new WebSocket(this.url, [KAIRO_WS_SUBPROTOCOL, this.agentSecret])`
(`runtime-connection-service.ts:574-579`, preserved). The
server side (`handlers.go:545-591`) is correct; the test
(`handlers_test.go:402-465`) covers no-subprotocol and
wrong-secret. W3 adds one more test: the gateway's
`onConnectionChange` emits `state: 'failed'` after 3
consecutive 401s on the WS upgrade (the server's auth
failures propagate as immediate close).

### 5.3 States

The gateway has a single `state` field with five values
(`uninitialized`, `discovering`, `connected`,
`reconnecting`, `failed` — see §2 `ConnectionSnapshot`).
Transitions:

```text
uninitialized → discovering       (constructor / first call)
discovering   → connected         (endpoints call returned valid snapshot + WS open)
discovering   → failed            (endpoints call failed N times, or schema invalid)
connected     → reconnecting      (WS onclose / onerror)
reconnecting  → connected         (WS onopen after backoff)
reconnecting  → failed            (3 consecutive 401 / 5 consecutive network errors)
failed        → discovering       (caller invokes reconnect())
```

`onConnectionChange` fires on every transition. The legacy
`EventStream.status()` 4-state machine is replaced by the
5-state gateway-level machine. Consumers that previously
called `eventStream.onStatus(handler)` migrate to
`gateway.onConnectionChange(handler)`.

### 5.4 Backoff with jitter

`backoffMs = min(maxBackoffMs, backoffMs * 2) * (0.75 + Math.random() * 0.5)`
— exponential, capped at 15s, with ±25% jitter (audit m5).
On `state → connected` (successful open), `backoffMs` resets
to 250ms. On `state → failed`, the timer is cleared and no
further reconnect attempts are made until the caller invokes
`reconnect()`.

### 5.5 Snapshot recovery on reconnect

`?after=${this.currentSequence}` is appended to the WS URL
(per audit §4.6: the legacy `connectEvents` had this; the
new `EventStream` did not). The Go `EventHub.GetHistory`
returns events with `Sequence > afterSequence`; the TS
gateway dispatches them as if they had arrived live.

Sequence tracking:

- Each event with a `sequence` field updates
  `currentSequence` to `max(currentSequence, event.sequence)`.
- The WsEvent schema does **not** currently include
  `sequence`; this is fixed in the schema expansion
  (§3.4 Option A or §3.4 fallback).

### 5.6 Heartbeat / idle detect (audit §4.3)

The TS side adds a 30s idle timer. If no message arrives
in 30s and the socket is in `open` state, the gateway
sends a WebSocket ping frame
(`this.ws.send(JSON.stringify({ type: 'ping' }))` — text
frame, not control frame, because the underlying
`gorilla/websocket` server does not currently respond to
WS protocol pings with pongs in a way the browser's
`WebSocket` API exposes). On the server side, W3 adds
a `?type=ping` handler to `EventHub.ServeWS` (a 5-line
change) that simply responds with an empty 200 OK and
resets the read deadline. This is enough to keep the
socket alive through NAT / load-balancer timeouts.

The idle timer is **disabled** in `pnpm start` (dev) so
that local dev doesn't churn pings; in production it
runs.

### 5.7 Listener multiplexing

```ts
subscribe(listener: RuntimeEventListener): Disposable {
  this.listeners.add(listener);
  return { dispose: () => this.listeners.delete(listener) };
}
```

The gateway dispatches each parsed `WsEvent` to all
listeners. `BuildStore` and `ServerStore` both register
themselves; they each get the same events. No consumer
ever calls `connectEvents` directly. The legacy
`onEvent` single-callback shape is gone.

### 5.8 Dispose

`gateway.subscribe(l)` returns a `Disposable`. Calling
`dispose()` removes the listener. The gateway itself
lives for the lifetime of the Inversify container; it is
**not** user-disposable. The Theia `onStop` hook in
`KairoViewsContribution` (`kairo-views-contribution.ts:158-163`)
unsubscribes its own listeners; the gateway continues
running until the container is torn down.

### 5.9 Agent restart → reconnecting, not data-clear

§7.4 last paragraph: "Agent restart期间 UI 显示 reconnecting
而不是清空数据."

Implementation:

1. The runtime/restart response is a 200 with no
   subscription side-effect on the gateway.
2. The Agent's process exits; the WS `onclose` fires.
3. The gateway transitions to `'reconnecting'`, **does
   not** flush the listener Set, **does not** emit
   `WsEvent { type: 'diagnostic', ... }` "connection lost"
   spam.
4. The backoff fires; the new Agent's `/api/v1/endpoints`
   is fetched; if the new port is the same, the existing
   WS URL still works (the gateway re-uses the same
   `EventStreamHandle`).
5. If the new port is different, the gateway re-opens
   with the new URL and the new `?after=${currentSequence}`.
6. The `lastError` on the `ConnectionSnapshot` is **not**
   set to a "connection lost" message during this window;
   it stays at whatever it was before the restart. The
   state carries the `'reconnecting'` semantic.

The Stores' `lastEvent` timestamps and `lastError` are
preserved through the window. UI shows "Runtime Agent
reconnecting…" for the duration.

### 5.10 Schema-conformance check (audit B3)

If the `WsEvent` JSON doesn't match the typed
discriminated union (e.g. the server publishes a future
event type the TS doesn't know about), the gateway
dispatches a synthetic event to the `*` listener only:

```ts
{ type: 'unknown', raw: any, observedAt: string }
```

The store consumers (`build-store.ts:74`,
`server-store.ts:60`) check `event.type` with a
discriminated union (`if (event.type === 'build.progress')`).
The compiler still narrows correctly because the
`'unknown'` type is a separate branch they don't handle.
W3 adds a `KairoError{ code: 'invalid_request', ... }` for
events that fail JSON parse entirely (today silently
swallowed, audit §4.8).

---

## 6. Migration path

The order matters. Each step is its own commit; each is
independently testable; each is reversible.

### 6.1 Commit 1 — Add the new `RuntimeGateway` interface

Files added (no edits elsewhere):

- `packages/runtime-extension/src/common/runtime-gateway.ts` (new)
  — the `RuntimeGateway` / `RuntimeError` / `Operation` /
  `ConnectionSnapshot` / `RuntimeEventListener` definitions
  from §2.

Files edited:

- `packages/runtime-extension/src/index.ts` — re-export the
  new module.
- `packages/protocol/src/index.ts` — add `RuntimeEndpoints`
  (§3.1) and grow `KairoErrorCode` with
  `'validation_failed' | 'aborted'` (§4.4).

No consumers are touched. The legacy
`RuntimeConnectionService` continues to work; the new
interface is **additive** for this commit.

### 6.2 Commit 2 — Implement the new gateway in `RuntimeConnectionService`

Files edited:

- `packages/runtime-extension/src/browser/runtime-connection-service.ts`:
  - `class RuntimeConnectionService implements RuntimeGateway` (full).
  - Add `subscribe(listener): Disposable` (§5.7).
  - Add `status(): ConnectionSnapshot` (§2).
  - Add `onConnectionChange(listener): Disposable` (§2).
  - Add `reconnect(): Promise<void>` (§3.3).
  - Add `invalidate(): void` (§3.3, replaces the
    `invalidateEndpoints` private method).
  - Refactor `request()` to return `Promise<TRes>` with the
    new error class.
  - Add the new `RuntimeError` class (§4.7); keep
    `KairoError` as a deprecated alias for one release.
  - Delete the `connectEvents` / `disconnectEvents` /
    `eventSocket` / `sequence` / `reconnectTimer` fields.
  - The internal `EventStream` class becomes a private
    sub-class, not exported.

- `packages/runtime-extension/src/browser/index.ts`:
  - Export `RuntimeGateway` / `RuntimeError` /
    `RuntimeEndpoints` from the new module.
  - Drop the `KAIRO_WS_SUBPROTOCOL` re-export (now internal).
  - Drop the `RUNTIME_BASE_URL` constant.
  - Bind `RuntimeGateway` to `RuntimeConnectionService` in
    the DI module (additive; both interfaces resolve to the
    same class).

Tests:

- Update `runtime.test.cjs` to use `RuntimeConnectionService`
  (or `RuntimeGateway` token) instead of `KairoRuntimeImpl`.
  All 14 wire-protocol tests pass without semantic change.
- Update `runtime-dynamic-routes.test.cjs` likewise.

### 6.3 Commit 3 — Fix the 401 / 422 / 5xx / WS schema behaviour

Files edited:

- `packages/runtime-extension/src/browser/runtime-connection-service.ts`:
  - 401 → `onConnectionChange` with `'reconnecting'` (§4.6).
  - 422 → `'validation_failed'` (§4.4).
  - 5xx → preserve `X-Kairo-Request-Id` in `RuntimeError`
    (§4.4).
  - Caller-abort → `code: 'aborted'`, not `'timeout'`
    (§4.3).
  - WS schema: add the `{ type: 'unknown', raw, observedAt }`
    fallback (§5.10).
- `packages/protocol/src/index.ts`:
  - Add `'aborted' | 'validation_failed'` to `KairoErrorCode`.

- `runtime-agent/internal/api/protocol/types.go`:
  - Add `ErrAborted` and `ErrValidationFailed` constants.

Tests:

- New test in `runtime.test.cjs` for 401 → reconnecting.
- New test for 422 → validation_failed.
- New test for caller-abort → aborted (not timeout).

### 6.4 Commit 4 — Expand `EndpointMap` in `packages/protocol`

Files edited:

- `packages/protocol/src/index.ts`:
  - Add the missing 12+ endpoints (§audit §2.1):
    `'/api/v1/endpoints'`, `'/api/v1/runtime/restart'`,
    `'/api/v1/auth/login'`, `'/api/v1/auth/logout'`,
    `'/api/v1/audit'`, `'/api/v1/toolchains'`,
    `'/api/v1/toolchains/import'`, `'/api/v1/jdtls'`,
    `'/api/v1/jdtls/project'`, `'/api/v1/search'`,
    `'/api/v1/encoding/validate'`,
    `'/api/v1/servers/{serverId}/restart'`,
    `'/api/v1/servers/{serverId}/debug'`,
    `'/api/v1/workspaces/{workspaceId}/java/launch-descriptor'`,
    `'/api/v1/events'`.
  - Add the corresponding request / response DTOs
    (`LoginRequest` / `LoginResponse` are already in the
    file; the rest need adding).
  - Re-export the missing types from the existing
    `WsEvent` block.
- `runtime-agent/internal/api/protocol/types.go`:
  - Mirror the new DTOs. (The Go side already has
    `LoginRequest` inlined in `services.go`; promote it
    to `protocol/types.go`.)

Tests:

- New `protocol-types-parity.test.ts` that introspects
  `EndpointMap` and asserts the Go mirror has matching
  JSON shape (the structural-equivalence script that the
  protocol preamble promised in Phase 1 — Phase 2 ships
  it).

### 6.5 Commit 5 — Migrate `BuildStore` and `ServerStore`

Files edited:

- `packages/build-extension/src/browser/build-store.ts`:
  - `@inject(RuntimeConnectionService)` →
    `@inject(RuntimeGateway)`.
  - `runtimeConnection.connectEvents(ctx.workspaceId, (e) => ...)`
    → `gateway.subscribe({ onEvent: (e) => ... })`.
  - The `dispose` is registered in a `postConstruct` field;
    Theia disposes the store on container teardown.

- `packages/tomcat-extension/src/browser/server-store.ts`:
  - Same pattern.

Tests:

- New `build-store.test.ts` using a `FakeRuntimeGateway`
  that emits synthetic `WsEvent` payloads. Asserts
  `buildStore.builds` updates correctly.
- New `server-store.test.ts` likewise.

### 6.6 Commit 6 — Migrate `KairoViewsContribution` and `KairoStatusBarContribution`

Files edited:

- `packages/theia-product/src/main/browser/kairo-views-contribution.ts`:
  - `this.eventStream = this.runtime.openEvents()` →
    `const off = this.runtime.onConnectionChange(snap => { ... })`.
  - `this.eventStream.on('*', e => this.handleEvent(e))` →
    `const off = this.runtime.subscribe({ onEvent: e => this.handleEvent(e) })`.
  - `onStop()` now disposes the two `off` handles.

- `packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts`:
  - Same pattern.

- `packages/theia-product/src/main/browser/kairo-commands.test.cjs`:
  - Replace `KairoRuntimeImpl` with `RuntimeConnectionService`
    in the `container.bind(...)` lines.

### 6.7 Commit 7 — File the Mac Core Contract Requests

No code changes. New file:

- `docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md`:
  - **CR-W3-01**: WsEvent ↔ events.Event schema translation
    (§3.4).
  - **CR-W3-02**: Wire `EventBus` to `EventHub.ServeWS` via
    the `EventBusAdapter` (§3.5).

These land in Mac Core's branch, not Windows. Windows
proceeds with the rest of Phase 2 once both land; if
Mac Core rejects either, Windows falls back to Option C
(§3.4) and ships B2 as a known partial.

### 6.8 Commit 8 — Drop the `18099` literal in `preload.ts`

W2 owns the preload rewrite (per the audit cross-ref to
W2's `B1`). W3's contribution is the runtime-side
contract: `RuntimeGateway.configure({ endpointProvider: () => Promise<RuntimeEndpoints> })`.
The literal disappears when W2 lands its preload.

If W2 has not yet landed by the time W3 is ready, W3
opens **CR-W3-03** asking W2 to remove the literal as
part of W2's own commit. W3 does not edit `preload.ts`
itself (W2 owns it; see file ownership §3.1).

### 6.9 Commit 9 — Delete the deprecated back-compat shims

Final commit, Phase 2 close:

- Drop the `setBearerToken` alias.
- Drop the `RUNTIME_BASE_URL` constant.
- Drop the `KairoErrorListener` Symbol and the
  `KairoError` (replaced by `RuntimeError`).
- Drop the `KAIRO_WS_SUBPROTOCOL` export (now internal).
- Update `product-bindings.ts` to bind `RuntimeGateway`
  instead of `KairoRuntime`.

All consumers have been migrated. The legacy aliases
have had one full Phase cycle to remove their imports.

### 6.10 Net effect

| File | Lines before | Lines after | Notes |
|------|--------------|-------------|-------|
| `packages/runtime-extension/src/browser/runtime-connection-service.ts` | 620 | ~480 | Deleted `connectEvents` / `disconnectEvents` / `eventSocket` / `sequence` / `reconnectTimer` (~80 lines), renamed `EventStream` to internal ~`EventStreamHandle` (~30 lines), added `RuntimeError` (replacing `KairoError` via re-export) (~30 lines), added `subscribe` / `onConnectionChange` / `reconnect` / `invalidate` (~60 lines). Net **−140**. |
| `packages/runtime-extension/src/browser/runtime.ts` | 26 | 0 | Deleted (`KairoRuntime` symbol, `KairoErrorListener`). |
| `packages/runtime-extension/src/browser/runtime-errors.ts` | 194 | 0 | Replaced by `RuntimeError` in `runtime-gateway.ts`. |
| `packages/runtime-extension/src/common/runtime-gateway.ts` | 0 | ~280 | New. |
| `packages/protocol/src/index.ts` | 623 | ~720 | +90 lines for missing endpoints + DTOs. |

Net Phase 2 line count: **+130**, dominated by the new
interface and the EndpointMap expansion. The runtime
extension itself shrinks.

---

## 7. Contract Requests and Phase 2 commit plan

### 7.1 Mac Core Contract Requests

#### CR-W3-01: WsEvent ↔ events.Event schema translation

| Field | Value |
|-------|-------|
| Severity | **Major** |
| Windows scenario | Phase 2 / Phase 3 / Phase 5 |
| Current endpoint | WS `/api/v1/events` |
| Current response | Go `events.Event` struct (generic, 9 discriminator values) |
| Expected typed behaviour | TS `WsEvent` discriminated union (6 variants, §audit §1.6) |
| Why UI cannot work around it | TS side type-narrows on `event.type`; mismatched discriminators result in no-op dispatch and silent event loss |
| Reproduction | With B2 wired up, observe that the TS `EventStream` receives events but `event.type === 'build.started'` (Go) does not match `'build.progress'` (TS). The `*` wildcard fires; the typed `event.type === 'build.progress'` branch in `build-store.ts:75` is never taken. |
| Evidence | Audit §1.6 + runtime-extension `runtime-connection-service.ts:583-595` |
| Requested owner | Mac Core (`internal/transport/events/eventhub.go` + `internal/api/handlers.go`) — translation can also be done in `handlers.go` which is W3-owned; Mac Core's role is to bless the field-name changes |
| Blocking phase | Phase 2 / Phase 5 |

#### CR-W3-02: Wire `api.Services.EventBus` to `*events.EventHub`

| Field | Value |
|-------|-------|
| Severity | **Blocker** |
| Windows scenario | Phase 2 onwards (every event-driven UI) |
| Current endpoint | WS `/api/v1/events` returns 500 "EventBus not configured" |
| Current response | `{ ok: false, error: { code: 'internal', message: 'EventBus not configured on this agent' } }` |
| Expected typed behaviour | The WS upgrades and streams events from the existing `EventHub` |
| Why UI cannot work around it | The whole `EventHub` subsystem is published to but never read; cannot be fixed from the renderer side |
| Reproduction | `curl --include --no-buffer -H "Sec-WebSocket-Protocol: kairo-secret-v1, <secret>" -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" http://127.0.0.1:<port>/api/v1/events` against a production agent → 500 |
| Evidence | Audit §1.5; `internal/services/services.go:78-92`; `internal/api/handlers.go:546-549` |
| Requested owner | Mac Core (`internal/services/services.go:78` line; new field assignment) |
| Blocking phase | Phase 2 |

#### CR-W3-03: Drop the `18099` fallback in `apps/desktop/src/preload.ts`

| Field | Value |
|-------|-------|
| Severity | **Major** |
| Windows scenario | Phase 2 / Phase 5 |
| Current endpoint | `apps/desktop/src/preload.ts:20` |
| Current response | Hardcoded fallback to `http://127.0.0.1:18099` if `KAIRO_AGENT_URL` is unset |
| Expected typed behaviour | Fail-loud if the env is unset; the gateway enters `'failed'` state with a clear message |
| Why UI cannot work around it | The literal is in `preload.ts`, owned by W2 |
| Reproduction | Delete the env-var assignment in `main.ts:298` and reload — the renderer silently points at a dead port and the user sees a confusing timeout |
| Evidence | Audit M4 |
| Requested owner | W2 (Phase 1) — W3 files as a cross-Phase coordination note |
| Blocking phase | Phase 1 / Phase 2 |

### 7.2 Phase 2 commit plan

| Commit | Topic | Depends on | Files |
|--------|-------|------------|-------|
| C1 | Add `RuntimeGateway` interface | — | runtime-extension/src/common/runtime-gateway.ts (new) + index.ts + protocol/index.ts |
| C2 | Implement the gateway | C1 | runtime-connection-service.ts (rewrite) + tests |
| C3 | Fix 401/422/5xx/abort | C2 | runtime-connection-service.ts + protocol + agent protocol mirror |
| C4 | Expand `EndpointMap` | — | protocol/index.ts + agent protocol mirror + parity test |
| C5 | Migrate BuildStore / ServerStore | C2 | build-extension + tomcat-extension + tests |
| C6 | Migrate ViewsContribution / StatusBar | C2 | theia-product + test fix |
| C7 | File CR-W3-01 / CR-W3-02 | — | WINDOWS_WAVE2_CONTRACT_REQUESTS.md |
| C8 | Coordinate with W2 on `preload.ts:20` (CR-W3-03) | W2 | n/a (just the request) |
| C9 | Delete deprecated shims | C5, C6, C8 landed | runtime-connection-service.ts + index.ts + tests |

### 7.3 Phase 2 Gate

The Phase 2 Gate is green when:

- `pnpm test`, `pnpm test:dynamic`, `pnpm test:mocha` all
  pass.
- A real `http.createServer` test asserts the 401 →
  reconnecting state transition.
- A real `http.createServer` test asserts the WS schema
  conformance for all 6 WsEvent variants.
- The `protocol-types-parity.test.ts` script (C4) passes.
- A `FakeRuntimeGateway` is used in
  `KairoViewsContribution.registerCommands` tests
  (currently broken by the `KairoRuntimeImpl` import;
  C6 fixes).
- The `RuntimeConnectionService` class satisfies
  `RuntimeGateway` (TS-level `implements` check; verified
  by `tsc`).

### 7.4 Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Mac Core rejects CR-W3-01 (schema change in `eventhub.go`) | Medium | High | Fall back to Option C (§3.4) — ship a `events.Event → WsEvent` translator on the TS side; mark Phase 5 evidence partial for WS schema until Mac Core accepts. |
| Mac Core rejects CR-W3-02 (EventBus wiring) | Low | High | Without CR-W3-02, the WS path is dead. W3 can ship a `EventBusAdapter` in `internal/api/eventbus_adapter.go` (W3-owned) and ask Mac Core to add a one-line `Services.EventBus = EventBusAdapter{Hub: eventHub}` in `internal/services/services.go:78`. If even that is rejected, Phase 2 is blocked; W6 must escalate. |
| W2 preload contract slips past Phase 1 | Low | Medium | W3 can ship a temporary `(window as any).kairoConfig` shim; the `18099` literal is the only blocker. |
| `BuildStore` / `ServerStore` migration breaks phase 3 E2E | Medium | Medium | New unit tests (C5) cover the migration. E2E falls to Phase 5; until then, the build/server status may regress in the installed smoke. |
| `WsEvent` type expansion causes `protocol` patch release | Low | Low | Adding new variants is a non-breaking change; old consumers that handle the `*` wildcard keep working. |

---

## 8. Acceptance criteria for the design

This design is **accepted** when:

- W2 confirms the preload contract change
  (`endpointProvider` callback) is implementable in
  Phase 1 without further W3 input.
- W4 confirms the `RuntimeGateway` interface covers every
  existing call site in the `BuildStore` / `ServerStore`
  / `ViewsContribution` / `StatusBarContribution`.
- W6 confirms the Phase 2 commit plan and Gate criteria
  match the Wave 2 task doc §7 + DoD.
- W5 confirms the `WsEvent` expansion does not break the
  JDT LS launch descriptor flow (it does not — the JDT
  paths use HTTP, not WS, today).
- (Conditional) Mac Core reviews CR-W3-01 / CR-W3-02 and
  either accepts the proposal or proposes a counter.

If any of the above is rejected, the design iterates. The
audit's gaps and the design's interface are independent
of Mac Core's response; only the schema migration (B3)
and the EventBus wiring (B2) are blocked on them.
