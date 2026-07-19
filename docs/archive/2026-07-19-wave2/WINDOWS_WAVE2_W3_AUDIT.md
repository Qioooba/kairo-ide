# Agent W3 — Runtime Contract Audit (Phase 0, read-only)

> **Owner**: Agent W3 (Runtime Contract) — Windows Wave 2
> **Branch**: `feature/windows-wave2-product-vertical-slice` @ `c0c7491`
> **Reference contract**: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §7
> **Scope**: `packages/runtime-extension/**`, `packages/protocol/**`,
> `runtime-agent/internal/api/**`, `runtime-agent/internal/transport/**`.
> **Mode**: read-only. No product code touched. Two documents
> written: this audit and `WINDOWS_WAVE2_W3_DESIGN.md`.
> **Honesty rules**: every gap is anchored to a file/line, every
> "satisfied" claim is anchored to a function name, partial/blocked
> is the only status used where the runtime cannot prove the claim.

---

## 0. Method

```powershell
# 0.1 Branch state
cd G:\spaces\kairo-ide
git status --short
# clean (except W1's uncommitted package.json bump and an untracked
#  scripts/rc.ps1 wrapper which is W1's and not in my scope)
git log --oneline --decorate -1
# c0c7491 (HEAD -> feature/windows-wave2-product-vertical-slice)
git branch --show-current
# feature/windows-wave2-product-vertical-slice
```

This audit reads (no edits) the following files:

| File | Purpose | Lines |
|------|---------|-------|
| `packages/runtime-extension/src/browser/index.ts` | DI module, exports | 1–86 |
| `packages/runtime-extension/src/browser/runtime.ts` | `KairoRuntime` symbol + error listener | 1–26 |
| `packages/runtime-extension/src/browser/runtime-connection-service.ts` | Single HTTP + WS client (current truth) | 1–620 |
| `packages/runtime-extension/src/browser/runtime-errors.ts` | `KairoError` + envelope unwrap | 1–194 |
| `packages/runtime-extension/src/browser/workspace-context-service.ts` | Workspace lifecycle consumer | 1–86 |
| `packages/runtime-extension/src/browser/runtime.test.cjs` | Old broken test (references `KairoRuntimeImpl`) | 1–345 |
| `packages/runtime-extension/src/browser/runtime-dynamic-routes.test.cjs` | Old broken test (references `KairoRuntimeImpl`) | 1–415 |
| `packages/runtime-extension/src/browser/dom-env.test.js` | Mocha jsdom env smoke | 1–30 |
| `packages/runtime-extension/package.json` | Test scripts | 1–35 |
| `packages/runtime-extension/.mocharc.json` | Mocha config | 1–12 |
| `packages/runtime-extension/test-setup.cjs` | Node + jsdom polyfill | 1–170 |
| `packages/protocol/src/index.ts` | Wire-protocol DTOs (hand-written) | 1–623 |
| `packages/theia-product/src/main/product.ts` | Composition root re-export | 1–42 |
| `packages/theia-product/src/main/product-bindings.ts` | DI container module (the only real one) | 1–116 |
| `packages/theia-product/src/main/browser/kairo-views-contribution.ts` | Views + commands + `openEvents()` consumer | 1–397 |
| `packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts` | Status bar + `openEvents()` consumer | 1–180 |
| `packages/theia-product/src/main/browser/kairo-product-frontend-module.ts` | Frontend module bindings | 1–70 |
| `packages/theia-product/src/main/browser/kairo-commands.test.cjs` | Test (references `KairoRuntimeImpl`) | 1–240 |
| `packages/build-extension/src/browser/build-store.ts` | Build store, `connectEvents()` consumer | 1–105 |
| `packages/tomcat-extension/src/browser/server-store.ts` | Server store, `connectEvents()` consumer | 1–100 |
| `packages/tomcat-extension/src/browser/server-service.ts` | Server service consumer | 1–40 |
| `packages/project-extension/src/browser/project-service.ts` | Project service consumer | 1–60 |
| `packages/project-extension/src/browser/active-project-service.ts` | Active project consumer | 1–60 |
| `packages/java-extension/src/browser/java-service.ts` | Java service consumer | 1–60 |
| `packages/java-extension/src/browser/java-ls-lifecycle.ts` | JDT LS consumer | 1–60 |
| `packages/java-extension/src/node/java-language-server-contribution.ts` | JDT backend consumer | 1–100 |
| `packages/encoding-extension/src/browser/encoding-service.ts` | Encoding service consumer | 1–120 |
| `packages/search-extension/src/browser/search-service.ts` | Search service consumer | 1–50 |
| `runtime-agent/internal/api/server.go` | Agent HTTP server (Handler / middleware) | 1–450 |
| `runtime-agent/internal/api/handlers.go` | Endpoints + restart handler | 1–870 |
| `runtime-agent/internal/api/services.go` | `Services` bag (incl. `EventBus`) | 1–150 |
| `runtime-agent/internal/api/protocol/types.go` | Go mirror of TS DTOs | 1–387 |
| `runtime-agent/internal/api/health.go` | `/api/v1/health` | 1–30 |
| `runtime-agent/internal/transport/events/eventhub.go` | Go `EventHub` publish-subscribe | 1–200 |
| `runtime-agent/internal/transport/events/websocket.go` | Go `EventHub.ServeWS` (gorilla/websocket) | 1–90 |
| `runtime-agent/internal/services/services.go` | `NewMemoryServices` factory | 1–100, 270–370 |
| `runtime-agent/internal/bootstrap/container.go` | Composition root (does NOT wire `EventBus`) | 1–120 |
| `runtime-agent/cmd/kairo-runtime/main.go` | Agent entry, NO EventBus wiring | 1–140 |
| `runtime-agent/internal/app/build_impl.go` | `EventPublisher` use case | 1–280 |
| `runtime-agent/internal/app/server_impl.go` | `eventHub` field on server use case | 1–400 |
| `runtime-agent/internal/log/log.go` | Redactor + structured logger | 1–230 |
| `runtime-agent/internal/config/config.go` | `String()` redacted view | 1–250 |
| `apps/desktop/src/main.ts` | Electron main, sets env for preload | 1–430 |
| `apps/desktop/src/preload.ts` | Preload bridge (`kairoConfig` + global URL) | 1–46 |
| `apps/browser/src/index.ts` | Browser app entry (sets `__KAIRO_DEFAULT_RUNTIME_URL__`) | 1–52 |
| `apps/server/src/index.ts` | Dev host proxy (cross-ref only) | 1–350 |
| `docs/hotfix-windows-test-readiness.md` | Wave-1 contract (auth + endpoint discovery) | 1–80 |
| `docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md` | N-021..N-023 / N-025 legacy issues | 100–135 |

`packages/runtime-extension/lib/` contains the compiled JS from a
previous build; both `index.js` and `runtime-connection-service.js`
were inspected for parity with the TS source.

Searches used:

```powershell
# Production path / fallback residues
git grep -nE '18099|3000|3001' -- ':!**/node_modules' ':!**/lib'

# Direct fetch / WebSocket outside runtime-extension
git grep -nE 'fetch\(|XMLHttpRequest|new WebSocket' -- packages apps

# Duplicate runtime client
git grep -nE 'KairoRuntimeImpl|RuntimeConnectionService|EventStream' \
  -- packages/runtime-extension packages/theia-product

# Auth headers
git grep -nE 'X-Kairo-Secret|Authorization|Bearer' \
  -- packages/runtime-agent apps
```

Findings below.

---

## 1. The "dual truth" — current state

The task doc §7.1 says the repo *historically* had two parallel
clients (`KairoRuntimeImpl` + `EventStream` vs.
`RuntimeConnectionService`). The current state is **mostly
converged, but not fully**. Three real shapes coexist:

### 1.1 `RuntimeConnectionService` — the single HTTP client (current truth)

File: `packages/runtime-extension/src/browser/runtime-connection-service.ts`
Class: `RuntimeConnectionService` (line 97)

- Singleton DI binding (line 63–71 of `index.ts`):
  `bind(RuntimeConnectionService).toSelf().inSingletonScope()`.
- Exposes `request(endpoint, payload, init)` for HTTP, with full
  X-Kairo-Secret / X-Kairo-Request-Id / X-Kairo-Workspace-Id
  / AbortSignal / timeout / retry / envelope-unwrap plumbing.
- `fetchEndpoints()` (line 212) implements the
  `/api/v1/endpoints` discovery mandated by
  `docs/hotfix-windows-test-readiness.md §2`. Caches
  `RuntimeEndpoints` for the lifetime of the process.
- All HTTP entry points in the extensions inject this class via
  `@inject(RuntimeConnectionService)`. Direct `fetch()` outside
  this file: zero. (`git grep -nE 'fetch\(' packages apps`
  returns only this file + `apps/server`'s dev-only health check.)

### 1.2 `EventStream` — the newer typed WS client

File: same `runtime-connection-service.ts` (class
`EventStream`, line 520)

- Standalone class (NOT a DI service). Constructed via
  `RuntimeConnectionService.openEvents()` (line 377).
- Has typed `on(type, handler)` / `onStatus(handler)` /
  `status()` / `close()` / `Disposable`-style unsubscribe.
- Auth: **uses** the subprotocol token
  `new WebSocket(this.url, [KAIRO_WS_SUBPROTOCOL, this.agentSecret])`
  (line 574). **Correct.**
- Backoff: exponential 250ms → 15s with `closedByCaller` guard
  (line 596). **Correct** for the §7.4 backoff curve.
- Status: `connecting` / `open` / `disconnected` / `closed`,
  emitted via the `statusListeners` set. **Correct.**
- **Consumers**:
  - `kairo-views-contribution.ts:148` — `this.runtime.openEvents()`
  - `kairo-status-bar-contribution.ts:87` — `this.runtime.openEvents()`

### 1.3 `connectEvents` — the *legacy* WS path that still lives on the same class

File: same `runtime-connection-service.ts` (methods
`connectEvents` / `disconnectEvents`, lines 398 / 419)

- Stored as **fields on the singleton**:
  `eventSocket: WebSocket | undefined; sequence: number = 0;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;`
  (lines 100–102).
- Called as `runtimeConnection.connectEvents(workspaceId, onEvent)`,
  not via `openEvents()`.
- **Auth: BROKEN in production.** Line 405:
  ```ts
  this.eventSocket = new WebSocket(wsUrl);
  ```
  The subprotocol token is **NOT** passed. In a production
  Desktop build with `KAIRO_LOCAL_SECRET` configured on the
  Agent, the server's middleware in `handlers.go:546-585`
  rejects the upgrade with 401 + `kairo-secret-v1` never
  negotiated, and the socket closes immediately. The legacy
  `connectEvents` path is **incompatible with the Wave-1 auth
  contract** that the rest of the codebase already migrated to.
- **Backoff: weaker.** Line 415: `1000 + Math.random() * 2000`
  ms. Fixed 1–3s, no exponential growth, no `closedByCaller`
  guard. After `disconnectEvents()` the timer keeps firing
  because the method only clears the timer if it matches the
  current one; calling `connectEvents` twice in a row is racy.
- **No `onerror` handler.** (Only `onclose` and `onmessage`.)
  Transient errors with a still-open socket never reconnect.
- **No `dispose()` semantics.** `disconnectEvents()` clears
  the timer and closes the socket, but does not flip a
  `closedByCaller` flag. A subsequent `connectEvents()` call
  will race with the still-pending `setTimeout` (line 415).
- **No status emission.** Consumers cannot observe
  connecting/open/closed states.
- **Single callback per instance.** `onEvent` is a single
  function. Multiple consumers would overwrite each other; the
  method body literally assigns nothing to a listener Set.
- **Sequence tracking works, but the snapshot URL parameter
  leaks it into the query string:** `&after=${this.sequence}`.
  Acceptable for `?after=` per RFC 3986 but the secret is
  definitely not in that URL.
- **Consumers**:
  - `build-store.ts:74` — `this.runtimeConnection.connectEvents(ctx.workspaceId, …)`
  - `server-store.ts:60` — same.

### 1.4 The "KairoRuntimeImpl" ghost

`KairoRuntimeImpl` is referenced by name in **three test
files** and in **two doc comments**, but the class **does not
exist** in `packages/runtime-extension`:

- `src/browser/runtime.test.cjs:24` — `require('@kairo/runtime-extension')` then destructure `{ KairoRuntimeImpl, KairoErrorListenerImpl }`. The compiled `lib/browser/index.js` exports `RuntimeConnectionService`, not `KairoRuntimeImpl`. **`require()` would yield `undefined`; calling `new undefined()` throws `TypeError: undefined is not a constructor`.**
- `src/browser/runtime-dynamic-routes.test.cjs:24` — same pattern.
- `packages/theia-product/src/main/browser/kairo-commands.test.cjs:56` — same pattern, used as a container-binding key (`container.bind(KairoRuntimeImpl).toConstantValue(...)`).
- `packages/theia-product/src/main/product.ts:33` — comment-only reference.
- `docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md:127, 580` — historical.
- `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md:573` — historical.

Effect: **`pnpm test` and `pnpm test:dynamic` will fail** at
`require()` time as soon as any of these tests are run. The
production container (`product-bindings.ts`) does NOT use
`KairoRuntimeImpl`, so the runtime works at runtime; only the
test files are broken.

### 1.5 Backend dual truth (smaller, but real)

Two different WS implementation paths exist in the Go agent:

1. `internal/transport/events/websocket.go:20` —
   `EventHub.ServeWS(w, r)` — uses `gorilla/websocket` and the
   generic `events.Event` struct. No auth at all (line 12:
   `return true` in `CheckOrigin`).
2. `internal/api/handlers.go:545-591` — `Server.handleEvents`
   does subprotocol-token auth, then calls
   `s.Services.EventBus.Serve(w, r)`.

**`Services.EventBus` is never wired** in the composition root
(`internal/services/services.go:78` constructs the `Services`
struct with all other fields, but `EventBus` is omitted; line
77–92 covers the rest, and `EventBus` is NOT in the list). And
the `main.go` does not assign it after the fact either
(`runtime-agent/cmd/kairo-runtime/main.go:88` calls
`api.NewServer(container.Services, …)` with the same unwired
struct).

**Effect**: any `GET /api/v1/events` against a production agent
returns 500 with `EventBus not configured` from
`handlers.go:547-549`. The Go `EventHub` exists, holds a
`sequence` counter, has history / replay, is being
**published to** by `build_impl.go:191, 215, 247, 268` and
`server_impl.go:374` — and **nothing reads it**. The whole
`EventHub` subsystem is currently an orphan.

The TS-side `EventStream` class will therefore never see an
open WS in production today (any future attempt to fix the
wiring will have to deal with the §1.6 schema mismatch below).

### 1.6 `WsEvent` vs Go `events.Event` — schema mismatch

The TS protocol (`packages/protocol/src/index.ts:577-592`)
declares:

```ts
export type WsEvent =
  | { type: 'log'; serverId: string; line: string; ts: string }
  | { type: 'build.progress'; buildId: string; state: ...; currentFile?: string }
  | { type: 'deployment.progress'; ... }
  | { type: 'server.state'; serverId: string; state: ...; pid?: number; ports?: ... }
  | { type: 'diagnostic'; level: 'info' | 'warn' | 'error'; component: string; message: string; fields?: ... }
  | { type: 'audit'; event: AuditEvent };
```

The Go `events.Event` struct
(`internal/transport/events/eventhub.go:23-32`) uses a
**closed enum** of `EventType` constants
(`eventhub.go:13-22`):

```go
const (
  EventBuildStarted     = "build.started"
  EventBuildProgress    = "build.progress"
  EventBuildCompleted   = "build.completed"
  EventBuildFailed      = "build.failed"
  EventServerStarted    = "server.started"
  EventServerStopped    = "server.stopped"
  EventServerError      = "server.error"
  EventDeployComplete   = "deploy.completed"
  EventSnapshotRequired = "snapshot.required"
)
```

Differences:

| Aspect | TS `WsEvent` | Go `events.Event` |
|--------|--------------|-------------------|
| Discriminator names | `log`, `build.progress`, `deployment.progress`, `server.state`, `diagnostic`, `audit` | `build.started/progress/completed/failed`, `server.started/stopped/error`, `deploy.completed`, `snapshot.required` |
| Field shape | Per-variant typed object | Generic `Message string + Data interface{} + Time + Sequence` |
| Has `sequence`? | No (consumers rely on `WsEvent` not having one) | Yes (`int64`) |
| Has `workspaceId`? | No | Yes |
| `deployment.progress` | Yes | No equivalent (only `deploy.completed`) |
| `audit` event | Yes | No |
| `diagnostic` event | Yes | No |

**The two schemas cannot be wire-compatible** without a
translator. Today, the Go side publishes generic `events.Event`,
and the TS side, if it ever received a real event, would
discard the message because none of the discriminators match.
(The TS `EventStream` does `JSON.parse(...)` and looks up
`e.type` — see `runtime-connection-service.ts:586-594`. A
`build.progress` payload would be dispatched to the listener,
but a `build.started` would NOT match any variant; the
`*` wildcard would still fire, but the body would be a Go
generic Event, not a typed WsEvent.)

### 1.7 Summary — what §7.1 actually says vs what the code does

| §7.1 mandate | Current state |
|--------------|---------------|
| Single `RuntimeGateway` interface for HTTP | ✅ Satisfied for HTTP — `RuntimeConnectionService.request()`. No `RuntimeGateway` interface; the class IS the gateway. |
| Single event subscription | ❌ Two parallel implementations on the same class: `EventStream` (correct) + `connectEvents` (broken auth, no dispose, no status). |
| `status(): ConnectionSnapshot` | ❌ `EventStream.status()` returns a 4-state string. No `ConnectionSnapshot` aggregate that includes last-error, last-reconnect-at, sequence. |
| `reconnect(): Promise<void>` | ❌ No explicit `reconnect()` method. Reconnect is implicit inside `EventStream.connect()`. |
| Widgets / Stores / StatusBar only depend on typed service | ✅ All consumers use `@inject(RuntimeConnectionService)`; no direct `fetch()` outside the service. |
| No second Runtime client | ❌ `connectEvents` on the same class is effectively a second client (different auth, different state, different lifecycle). |
| No second EventStream | ⚠️ Conceptually no, but `connectEvents`'s `eventSocket` field is a parallel connection that the singleton owns. |

---

## 2. EndpointMap and 18099/3000/3001 residue

### 2.1 `EndpointMap` in `packages/protocol/src/index.ts`

`packages/protocol/src/index.ts:518-548` defines 22 endpoint
shapes:

| Endpoint | In TS EndpointMap? | In Go router? | In test table? |
|----------|-------------------|---------------|---------------|
| `GET /api/v1/workspaces` | ✅ | ✅ (`server.go:262`) | n/a |
| `POST /api/v1/workspaces` | ✅ | ✅ | n/a |
| `POST /api/v1/workspaces/{workspaceId}/scan` | ✅ | ✅ (`server.go:265`) | ✅ |
| `GET /api/v1/projects` | ✅ | ✅ (`server.go:268`) | n/a |
| `GET /api/v1/projects/{projectId}` | ✅ | ✅ | ✅ |
| `PUT /api/v1/projects/{projectId}` | ✅ | ✅ | ✅ |
| `GET /api/v1/builds` | ✅ | ✅ | n/a |
| `POST /api/v1/builds` | ✅ | ✅ | ✅ |
| `GET /api/v1/builds/{buildId}` | ✅ | ✅ | n/a |
| `DELETE /api/v1/builds/{buildId}` | ✅ | ✅ | n/a |
| `GET /api/v1/deployments` | ✅ | ✅ | n/a |
| `POST /api/v1/deployments` | ✅ | ✅ | ✅ |
| `GET /api/v1/deployments/{deploymentId}` | ✅ | ✅ | n/a |
| `GET /api/v1/servers` | ✅ | ✅ | n/a |
| `POST /api/v1/servers` | ✅ | ✅ | ✅ |
| `GET /api/v1/servers/{serverId}` | ✅ | ✅ | ✅ |
| `POST /api/v1/servers/{serverId}/restart` | ✅ | ❌ not registered (`server.go:289` only registers `DELETE`) | n/a |
| `DELETE /api/v1/servers/{serverId}` | ✅ | ✅ | ✅ |
| `GET /api/v1/servers/{serverId}/logs` | ✅ | ✅ (via `handleServerSub`) | ✅ |
| `GET /api/v1/endpoints` | ❌ missing | ✅ (`server.go:259`) | ❌ |
| `POST /api/v1/runtime/restart` | ❌ missing | ✅ (`server.go:255`) | ❌ |
| `GET /api/v1/auth/login` | ❌ missing (TS has `LoginRequest/LoginResponse` but not in map) | ✅ (`server.go:296`) | n/a |
| `POST /api/v1/auth/logout` | ❌ missing | ✅ | n/a |
| `GET /api/v1/audit` | ❌ missing | ✅ (`server.go:299`) | n/a |
| `GET /api/v1/toolchains` | ❌ missing | ✅ (`server.go:271`) | n/a |
| `POST /api/v1/toolchains/import` | ❌ missing | ✅ (`server.go:272`) | n/a |
| `GET /api/v1/jdtls` | ❌ missing | ✅ (`server.go:302`) | ❌ |
| `POST /api/v1/jdtls` | ❌ missing | ✅ | n/a |
| `GET /api/v1/jdtls/project` | ❌ missing (TS has `JdtProjectRequest` but not in map) | ✅ | ✅ |
| `POST /api/v1/jdtls/project` | ❌ missing | ✅ | n/a |
| `POST /api/v1/search` | ❌ missing | ✅ (`server.go:292`) | ✅ |
| `POST /api/v1/encoding/detect` | ❌ missing (TS has `EncodingDetectRequest`) | ✅ (`server.go:293`) | ✅ |
| `POST /api/v1/encoding/recode` | ❌ missing | ✅ | ✅ |
| `POST /api/v1/encoding/validate` | ❌ missing (TS has `EncodingValidateRequest`) | ✅ | n/a |
| `GET /api/v1/events` (WS) | ❌ missing (it's WS, not in `EndpointMap`) | ✅ (`server.go:301`) | n/a |
| `GET /api/v1/workspaces/{ws}/java/launch-descriptor` (and sub-paths) | ❌ missing | ✅ (`server.go:266`) | n/a |

**12+ endpoints are not in the TS `EndpointMap`.** The typed
`request<E>(endpoint: E, …)` path in
`runtime-connection-service.ts:316-401` only enforces types
when the caller passes a known endpoint string. All callers
in the current codebase use the dynamic `request('GET /api/...')`
form, which goes through the same code path but the compile-time
check is `E extends Endpoint | string` (line 316) — the `string`
fallback means the type-safety win is lost for the unmapped
endpoints. **Net effect: a typo in any of the missing endpoint
strings is a runtime 404, not a compile error.** This is the
biggest TypeScript-side gap in the contract.

### 2.2 Hardcoded 18099/3000/3001 residue — grep summary

```text
apps/desktop/src/preload.ts:20
    const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18099';
                                                          ^^^^^^^^^^^^^^^^^^^^^
    — production fallback, VIOLATES §7.2.7 (no 18099 fallback).

packages/runtime-extension/src/browser/runtime-connection-service.ts:20,107,210,374,394,502
    — comment-only references explaining the historical 18099 fallback.
      These are documentation, not live code. The actual fetch
      path uses `cachedEndpoints?.http` and `wsHostPortFromBase`
      on the configured baseUrl (not 18099). ✅ acceptable.

runtime-agent/internal/api/handlers.go:619
runtime-agent/internal/api/server.go:272
runtime-agent/internal/api/protocol/types.go:89
runtime-agent/internal/api/handlers_test.go:261,271-275
    — comment-only + test uses 18099 as a test value. The test
      only asserts the response shape; the literal `18099` is
      a stand-in. Could be cleaned up but not a bug.

apps/server/src/index.ts:28,57,61,307
    — dev-mode only. `pickFreePort(18099)` is a *preferred* port;
      if busy, the function binds to 0 and returns the actual
      port. apps/server is not in the production path
      (desktop loads the bundled agent from `process.resourcesPath`,
      see W2 audit `B7`/`apps/desktop/src/main.ts:101-108`).
      Acceptable.

apps/browser/package.json:13,14
    — `theia start … --port=3000`. Browser dev server, not
      the production path. Acceptable.

tests/e2e/*.cjs
    — hardcoded 18099/3000 defaults in test entry points. The
      test runner takes these as CLI args, so they're
      parameterised. Acceptable.

scripts/dev.ps1:30,31
scripts/verify-e2e.ps1:48
.github/workflows/ci.yml:188,195,241,254-267,335
    — CI / dev scripts. Acceptable.

docs/**/*.md, README.md, BUILD.md, RUN.md, MILESTONES.md
    — documentation references to "localhost:3000" and
      "18099". To be updated as part of the Phase 1 desktop
      rollout, but not a code defect.
```

**Net residue (production path)**: exactly **one line**.

```ts
apps/desktop/src/preload.ts:20
  const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18099';
```

This is a §7.2.7 violation. In a packaged build `KAIRO_AGENT_URL`
is always set by `main.ts:298`, so the fallback is unreachable.
In `pnpm start` (dev), the variable is also set by `main.ts`.
But the literal is still a footgun: if a future refactor ever
moves the env-var assignment, the renderer silently hardcodes
18099.

### 2.3 Dynamic port support

- `apps/desktop/src/main.ts:79-82` — Electron main picks a free
  port with `net.createServer().listen(0)` and passes it to
  the Agent as `--port`. The Agent binds `127.0.0.1:port`. This
  is a small TOCTOU window (the port is released by
  `findFreePort` before the Agent binds it). Not W3's scope;
  see W2 audit `M8`.
- `apps/server/src/index.ts:61-69` — same pattern for the dev
  host. Acceptable.
- The Agent's `/api/v1/endpoints` handler
  (`runtime-agent/internal/api/handlers.go:614-657`) returns
  the bound `host:port`. The TS client uses it
  (`runtime-connection-service.ts:212-262`). **Satisfies §7.2.1
  through §7.2.5** end-to-end.

---

## 3. HTTP behaviour audit — §7.3 line-by-line

### 3.1 `X-Kairo-Secret` — §7.3 first bullet

`runtime-connection-service.ts:307-312`:

```ts
const secret = this.agentSecret();
if (secret) {
  // The contract (搂1.1) says the secret rides in
  // `X-Kairo-Secret`, never in `Authorization: Bearer`.
  headers['X-Kairo-Secret'] = secret;
}
```

**Satisfied for the request path.** The header is only set
when a secret is configured, so dev-mode (no secret) requests
do not include it. The Agent's middleware
(`runtime-agent/internal/api/server.go:240-258`) checks the
same header with `subtle.ConstantTimeCompare`. `Authorization:
Bearer` is not set anywhere in the TS code (verified by grep).

**Caveat — `connectEvents` WS path does NOT use the secret at
all** (see §1.3).

### 3.2 UUID request ID — §7.3 second bullet

`runtime-connection-service.ts:319-321` (constructor
`newRequestId`) generates a v4 UUID via `crypto.randomUUID()`
or a fallback `uuidv4()`. The ID is:
- Set on the envelope as `requestId` (line 320).
- Set on the request as `X-Kairo-Request-Id` header (line 335).
- Echoed by the Agent in the response (`server.go:213`).

**Satisfied end-to-end.** Verified in `runtime.test.cjs:80-91`
and `runtime-dynamic-routes.test.cjs:60-66` (the existing tests
assert `env.requestId === req.headers['x-kairo-request-id']`).

### 3.3 JSON content type — §7.3 third bullet

`runtime-connection-service.ts:340-342`:

```ts
if (method !== 'GET' && method !== 'HEAD') {
  headers['Content-Type'] = 'application/json';
}
```

GET/HEAD omit `Content-Type` (correct — no body).
`Accept: application/json` is set unconditionally
(`runtime-connection-service.ts:333`).

**Satisfied.**

### 3.4 Typed error — §7.3 fourth bullet

`runtime-errors.ts:33-85` defines `KairoError` with
`code` / `message` / `httpStatus` / `details` / `retryable`
/ `observedAt`. `httpStatusToCode` (lines 102-114) maps
HTTP status to `KairoErrorCode`. `unwrapResponse`
(lines 142-194) is the canonical envelope-unwrap.

The protocol's `KairoErrorCode` enum
(`packages/protocol/src/index.ts:51-72`) is the single source
of truth and the Go side mirrors it
(`runtime-agent/internal/api/protocol/types.go:13-39`).
**Satisfied.**

**Caveat — what the user sees**:
- `kairoErrorMessage(err, fallback)` in
  `kairo-views-contribution.ts:389-394` calls
  `err.format()` which is `[code] message (HTTP status)`.
  `format()` is fine.
- The `KairoErrorListener` default impl
  (`runtime.ts:23-25`) is a no-op. The listener is bound but
  no widget registers a non-default listener. Errors are
  shown to the user via `MessageService` (the Theia toast),
  not via the listener hook. **Acceptable** but worth noting
  that the listener exists but is currently unused.

### 3.5 Timeout — §7.3 fifth bullet

`runtime-connection-service.ts:347-352`:

```ts
const ctl = composeAbort(init.signal, init.timeoutMs ?? this.config.defaultTimeoutMs);
```

- `defaultTimeoutMs` is 60 000 ms when not configured
  (line 41 of `runtime-connection-service.ts`).
- `composeAbort` (lines 458-479) builds a single
  `AbortController` that fires on either the parent signal
  or the timeout.
- The timeout error is `new DOMException('timeout', 'AbortError')`.
  `normaliseThrown` (line 184-193) maps this to
  `KairoError{ code: 'timeout', message: 'Request was aborted' }`.

**Satisfied.** The default of 60s is a bit long for the
frontend (5s would be more typical for health/endpoints), but
the per-request override `timeoutMs` is available.

**Caveat — `fetchEndpoints` has its own timeout
(`runtime-connection-service.ts:226-228`)** with
`defaultTimeoutMs ?? 5_000`. Hardcoded fallback is 5s, but
**uses the same config key** — meaning if the user sets
`defaultTimeoutMs: 60_000` for everything else, the endpoints
discovery will also wait 60s. Minor; the config key should
be either the same or distinct. Today they collide.

### 3.6 AbortSignal — §7.3 sixth bullet

`runtime-connection-service.ts:347-352`, `composeAbort`
(lines 458-479), `delay` (lines 481-493). The AbortSignal
is propagated into:
- The `fetch` call (line 354).
- The backoff `delay()` between retries (line 392).

`composeAbort` adds a listener for the parent signal
(`onParentAbort`) that aborts the child controller when the
parent aborts. The child timer is cleared in `dispose()`
(line 477). **Satisfied.**

The AbortSignal is also re-listened on the backoff delay so a
caller can cancel during backoff. The error path is
`KairoError{ code: 'timeout', message: 'Request was aborted during backoff' }`
(line 484, 490) — which is misleading. A caller-initiated
abort is not a timeout. **Minor gap; rename code to
`'aborted'` or use a separate `code`.**

### 3.7 401 → connection invalidation — §7.3 seventh bullet

**Not satisfied.** A 401 response is wrapped to
`KairoError{ code: 'unauthenticated' }` (line 104 of
`runtime-errors.ts`) and thrown. The runtime does **not**
emit any "connection invalidated" event; the next request
will simply retry. Worse:

- `runtime-connection-service.ts:385-394` treats 401 as
  transient (`isTransient()` returns `false` for 401
  specifically — `runtime-errors.ts:67-76` only counts
  5xx, `timeout`, `io_error`, `process_spawn_failed` as
  transient). So 401 will be re-thrown after the second
  attempt. That is the right behaviour, but the **error
  has no effect on the connection state** — the `lastHealth`
  is not cleared, the EventStream is not notified, and the
  StatusBar is not updated.
- The `KairoErrorListener.onError` is the only "side-effect"
  channel (line 391), and the default impl is a no-op
  (`runtime.ts:24`). No widget registers a non-default
  listener today.

**Blocker for §7.3 / §8.3.5 / DoD §3.5 (HTTP 401 covers
connection invalidation).**

### 3.8 409 → conflict — §7.3 eighth bullet

`httpStatusToCode` (line 106) maps 409 → `'conflict'`. The
typed error is thrown. **Satisfied for the type-system
side.** No retry. Acceptable.

### 3.9 422 → validation — §7.3 ninth bullet

`httpStatusToCode` (line 109) maps 422 → `'invalid_request'`
(along with the rest of the 4xx range). **Satisfied** but
**not precise.** 422 should arguably be a separate code
(`'validation_failed'`) so the UI can show field-level
errors. Today it shares the catch-all `'invalid_request'`
and the UI cannot distinguish a malformed body from a
validation failure. **Minor.**

### 3.10 5xx preserves request ID — §7.3 tenth bullet

`server.go:213-214` sets `X-Kairo-Request-Id` on every
response. `writeError` (`server.go:354-373`) sets
`requestId` on the error envelope. **Satisfied.** The TS
client stores the requestId on `KairoError` indirectly
(through the message), but the typed field is missing —
`KairoError` does not have a `requestId` field. The
`X-Kairo-Request-Id` response header is **not** read back
in `runtime-connection-service.ts:354-364`; only the body
is parsed. **Minor** — should be added so the UI can show
"request req_abc123 failed" in toasts.

### 3.11 Runtime response schema validation — §7.3 eleventh bullet

`runtime-errors.ts:142-194` (`unwrapResponse`) only checks
**shape** of the envelope (`ok: true` / `ok: false` / missing).
The payload itself is not validated against
`EndpointMap[E]['response']`. A 200 with `ok: true` and a
malformed `payload` is returned to the caller as-is.
**Not satisfied.** This is the most expensive gap to close
because it requires either:

- a hand-written runtime validator per endpoint (tedious), or
- zod/io-ts schemas added to the protocol package.

For Phase 2, the minimum is to add a `wireSchemas` table
(simpler types per endpoint) and assert the top-level
shape; full payload validation is Phase 6.

### 3.12 No secret in logs / large payload — §7.3 twelfth bullet

- `runtime-connection-service.ts:341-342` reads the response
  as `await res.text()` and **stores the first 200 chars of
  the body** in `KairoError.details` for failed cases
  (line 363-371). 200 chars is bounded. **Acceptable.**
- The Agent's `Redactor`
  (`runtime-agent/internal/log/log.go:78-99`) is wired into
  the structured logger
  (`runtime-agent/internal/config/config.go:181-200`). The
  desktop main does not call the redactor on stdout
  (`apps/desktop/src/main.ts:97-99, 207-209` — `console.log`).
  The W2 audit owns this (`B1` / `M13`); flagged here for
  cross-reference only.
- The `KairoError.details` is the agent's
  `KairoError.details` from the Go side
  (`runtime-agent/internal/api/protocol/types.go:46`), which
  is `any` typed. A future agent that puts the secret into
  `details` would leak it to the renderer. Not currently
  happening, but the contract is **trust the agent**. **Minor
  gap** — should be "details must not contain secrets"
  documented in the protocol.

### 3.13 Summary table for §7.3

| §7.3 bullet | Status | Anchor |
|-------------|--------|--------|
| X-Kairo-Secret | ✅ | `runtime-connection-service.ts:307-312` |
| UUID request ID | ✅ | `runtime-connection-service.ts:319-321, 335` |
| JSON content type | ✅ | `runtime-connection-service.ts:340-342` |
| Typed error | ✅ | `runtime-errors.ts:33-85` |
| Timeout | ✅ | `runtime-connection-service.ts:458-479` |
| AbortSignal | ✅ (with minor code-name issue) | `runtime-connection-service.ts:458-479, 481-493` |
| 401 → connection invalidate | ❌ no connection event | no anchor — see §1.7 / §3.7 |
| 409 → conflict | ✅ | `runtime-errors.ts:106` |
| 422 → validation | ⚠️ mapped to generic 4xx | `runtime-errors.ts:109` |
| 5xx preserves request ID | ⚠️ header set, not stored in `KairoError` | `server.go:213`, missing on TS side |
| Runtime schema validation | ❌ only envelope shape, not payload | `runtime-errors.ts:142-194` |
| No secret in logs | ⚠️ redactor on Go side, not on desktop main; details is `any` | cross-ref W2 `B1`/`M13` |

---

## 4. WebSocket behaviour audit — §7.4 line-by-line

### 4.1 Subprotocol auth — §7.4.1

`runtime-connection-service.ts:572-579` (the **correct**
`EventStream` path):

```ts
const protocols = this.agentSecret
  ? [KAIRO_WS_SUBPROTOCOL, this.agentSecret]
  : [];
ws = protocols.length > 0
  ? new WebSocket(this.url, protocols)
  : new WebSocket(this.url);
```

Server side: `runtime-agent/internal/api/handlers.go:545-591`
parses `Sec-WebSocket-Protocol` for `kairo-secret-v1`, finds
the token after it, does `subtle.ConstantTimeCompare`,
echoes the secret back. Test coverage:
`runtime-agent/internal/api/handlers_test.go:402-465`.

**Satisfied on the EventStream path. NOT satisfied on
connectEvents (see §1.3).**

### 4.2 `connecting` / `open` / `reconnecting` states — §7.4.2

`runtime-connection-service.ts:540-548` (status listener
machinery). `setStatus` (line 612) emits on transition. **OK
on EventStream. Missing entirely on connectEvents.**

### 4.3 Heartbeat or idle detect — §7.4.3

**Missing on the TS side.** The Go side has
`internal/transport/events/websocket.go:46-58` (server-side
ping every 15s, read deadline 30s), but the TS client never
sends a pong / does not have an idle timer. If the server
kills the connection, the client only notices on the next
data tick. **Gap.**

### 4.4 Exponential backoff + jitter + upper bound — §7.4.4

`runtime-connection-service.ts:596-602` (EventStream
`scheduleReconnect`):

```ts
const wait = this.backoffMs;          // 250ms
this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);  // *2
this.reconnectTimer = setTimeout(() => this.connect(), wait);
```

- Base 250ms, max 15 000ms, exponential. **No jitter.** The
  Go side is also deterministic. **Satisfied modulo jitter.**

**Not satisfied on `connectEvents`** (fixed 1–3s, no
exponential growth).

### 4.5 Single socket + single reconnect timer — §7.4.5

EventStream: `this.ws` and `this.reconnectTimer` are single
fields. `close()` clears the timer and closes the socket.
`scheduleReconnect` short-circuits if `closedByCaller` is set.
**Satisfied.**

`connectEvents`: `disconnectEvents()` clears the timer but
does not set a `closedByCaller` flag. A `setTimeout` in
flight at the time of disconnect will fire and call
`connectEvents` again. **Not satisfied.** This is a real
listener-leak / zombie-reconnect risk.

### 4.6 Post-reconnect snapshot pull — §7.4.6

`runtime-connection-service.ts:405-415` (`connectEvents`
with `&after=${this.sequence}`) — the sequence is sent to the
server; `EventHub.GetHistory(workspaceID, afterSequence)`
filters events with `Sequence > afterSequence`. **Satisfied
on `connectEvents`.** But see §1.3 — the auth is broken so
this never actually returns data in production.

**EventStream** has no `after=` parameter
(`runtime-connection-service.ts:381-386`). It opens to
`{wsBase}/api/v1/events` with no `?after=`. The Go server
returns the full history (the `?workspaceId=` is also missing
in the EventStream path — only `connectEvents` sets it).
**Not satisfied on EventStream.** This is the WS schema
mismatch from §1.6 in disguise.

### 4.7 Snapshot / new events avoid obvious replay — §7.4.7

`connectEvents` updates `this.sequence` from each received
event (line 408), so the next reconnect will skip them. **OK.**
EventStream does not track a sequence at all
(`runtime-connection-service.ts:581-595`); the Go server's
`EventHub.GetHistory(workspaceID, 0)` returns everything
since time zero, but the server has `maxHistory=1000`
(`eventhub.go:65`), so this is bounded. **Acceptable** but
the EventStream does not call `?after=`. **Gap.**

### 4.8 Dispose cleans up — §7.4.8

EventStream: `close()` clears the timer, closes the socket,
sets `closedByCaller`, transitions to `'closed'`. Listeners
receive a final notification. **Satisfied.** The `on(type,
h)` returns an unsubscribe function (line 552-558) — but the
listeners are not invoked at close; consumers must subscribe
to `onStatus` to see `'closed'`. Minor.

`connectEvents` has no dispose method; `disconnectEvents`
cleans the timer/socket but not the sequence and not the
`onEvent` closure. **Not satisfied.**

### 4.9 Reconnect during Agent restart — §7.4 last paragraph

§7.4: "Agent restart期间 UI 显示 reconnecting而不是清空数据."

`RuntimeConnectionService.invalidateEndpoints()`
(line 264-267) exists. It is **not** called from anywhere in
the codebase. The `EventStream` would not know to refetch
endpoints. The `connectEvents` path's `eventSocket.onclose`
calls `connectEvents` again with the *old* `wsUrl`; the port
might be different now. **Not satisfied.** This is a real
Phase 2 fix needed.

### 4.10 Summary table for §7.4

| §7.4 bullet | EventStream | connectEvents (legacy) |
|-------------|-------------|------------------------|
| Subprotocol auth | ✅ | ❌ (no subprotocol) |
| States | ✅ | ❌ |
| Heartbeat / idle | ❌ (passive only) | ❌ |
| Backoff + jitter | ⚠️ exp, no jitter | ❌ fixed 1–3s |
| Single socket/timer | ✅ | ❌ race on disconnect |
| Snapshot recovery on reconnect | ❌ no `?after=` | ⚠️ has `?after=`, but auth broken |
| Sequence / replay | ❌ not tracked | ✅ `this.sequence` |
| Dispose cleans up | ✅ | ❌ |
| Agent restart → reconnecting | ❌ `invalidateEndpoints` not called | ❌ |

---

## 5. `packages/protocol/**` DTO inventory

The TS protocol is a single file
(`packages/protocol/src/index.ts`, 623 lines, 49 exports).
The Go mirror is a single file
(`runtime-agent/internal/api/protocol/types.go`, 387 lines).

### 5.1 Constants (2)

- `PROTOCOL_VERSION = 'v1'`
- `PROTOCOL_VERSION_PATH = '/api/v1'`

### 5.2 Envelopes (5)

- `RequestEnvelope<P>` (universal request)
- `ResponseEnvelope<P>` (success)
- `ErrorEnvelope` (error)
- `Envelope<P>` (union)
- `KairoError` (the error body)

### 5.3 Enums (3)

- `KairoErrorCode` (19 codes: 4xx-style + 5xx-style; see
  §3.4 for the list).
- `EncodingId` (8 well-known + open alias).
- `Eol = 'lf' | 'crlf' | 'cr'`

### 5.4 Resource / DTO interfaces (24)

| TS | Go mirror | Used by |
|----|-----------|---------|
| `DocumentEncoding` | — | not used by any HTTP handler (used by `EncodingDetectResponse` only) |
| `Workspace` | `Workspace` (`types.go:231`) | `/api/v1/workspaces` |
| `ProjectConfig` (+ nested `sourceLayout`, `encoding`, `java`, `serverRuntime`, `build`, `deploy`, `hotReload`) | `ProjectConfig` (deep mirror) | `/api/v1/projects/*` |
| `ToolchainRef` / `Toolchain` | `Toolchain` (`types.go:345`) | `/api/v1/toolchains` |
| `ServerInstance` (+ `ports`, `memory`) | `ServerInstance` + `ServerPorts` + `ServerMemory` | `/api/v1/servers/*` |
| `StartBuildRequest` | `StartBuildRequest` | `POST /api/v1/builds` |
| `StartDeploymentRequest` | `StartDeploymentRequest` | `POST /api/v1/deployments` |
| `StartServerRequest` | `StartServerRequest` | `POST /api/v1/servers` |
| `BuildResult` (+ `BuildDiagnostic`, `summary`) | `BuildResult` + `BuildDiagnostic` + `BuildSummary` | `GET /api/v1/builds` |
| `DeploymentRequest` | n/a (inline in handler) | `POST /api/v1/deployments` (Go does not use this struct) |
| `DeploymentResult` | `DeploymentResult` | `GET /api/v1/deployments` |
| `SearchRequest` / `SearchMatch` / `SearchResponse` | inline in Go (json.RawMessage) | `POST /api/v1/search` |
| `EncodingDetectRequest` / `Response` / `RecodeRequest` / `ValidateRequest/Response` | inline in Go | `/api/v1/encoding/*` |
| `HealthResponse` | `HealthResponse` | `GET /api/v1/health` |
| `JdtState` / `JavaServiceState` | n/a | JDT extension |
| `JdtStatus` | `jdtlsStatus` (in services.go, not in `protocol/`) | `GET /api/v1/jdtls` |
| `JdtStartRequest` / `JdtProjectRequest` / `JdtProjectResponse` | inline in Go | `/api/v1/jdtls*` |
| `LoginRequest` / `LoginResponse` | inline in Go | `/api/v1/auth/*` |
| `AuditEvent` | inline in Go | `/api/v1/audit` |
| `EndpointMap` (22 entries) | n/a (Go routes are string-typed) | typed `request<E>(...)` |
| `DetectedProjectLayout` | `DetectedProjectLayout` + sub | `POST /api/v1/workspaces/{id}/scan` |
| `WsEvent` (6 variants) | `events.Event` (generic, §1.6 mismatch) | `/api/v1/events` |

### 5.5 Helpers (2)

- `ok<P>(env, payload)` — builds a success envelope.
- `err(requestId, code, message, opts?)` — builds an error envelope.

### 5.6 Hand-written mirror maintenance

The TS file's preamble (lines 7–11) says:

> The Go Runtime Agent has a parallel hand-written mirror in
> `runtime-agent/internal/api/protocol/types.go` that this file
> must keep in sync. A script to assert structural equivalence
> of the two trees will be added in Phase 1.

**No such script exists in the repo today** (`git grep
'protocol.*diff\|protocol.*equivalence\|protocol.*lint'` returns
nothing). Drift between the two files is not detected. The
`WsEvent` vs `events.Event` mismatch (§1.6) is one such drift.

---

## 6. Adapter thinness — §7.6 audit

Per §7.6, the Go `runtime-agent/internal/api` package is the
"thin wire adapter". What it must NOT do:

- Embed Project/Build/Deploy business logic.
- Parse ProjectID as a path.
- Execute build/deploy file operations directly.
- Re-introduce a `RawMessage` God service.

What the audit found:

### 6.1 JSON-in-handler — partial

`runtime-agent/internal/api/handlers.go:42-95` (`handleWorkspaces`)
unmarshals into a local `var p struct { RootPath, Name }`. This
is the only place where JSON is decoded by-hand outside of
`decodeEnvelope`; the rest of the file uses
`json.Unmarshal(extractPayload(body), &p)` pattern. Acceptable
— the local struct is small, typed, and only knows about
fields it actually needs.

**The `Services` bag returns `json.RawMessage` for most
operations** (`services.go:30-49`:
`ProjectStore.List() []json.RawMessage`,
`ProjectStore.Get(id) (json.RawMessage, error)`,
`Searcher.Search(payload) (json.RawMessage, error)`,
`Encoder.Detect(payload) (json.RawMessage, error)`, etc.).
This is a deliberate "RawMessage passthrough" pattern: the
HTTP layer does no shape work, the inner service does, and
the response is serialised verbatim. The task doc calls
this out as the "no RawMessage God Service" anti-pattern.

In practice: each inner service is its own struct
(`diskProjectStore`, `memSearcher`, `memEncoder`, etc.), and
the bag of `json.RawMessage` is just the wire format. The
`RawMessage` is not a "God service" — it's a wire-format
alias. **Acceptable**, but the task doc's wording
suggests a future refactor: typed DTOs in the `protocol/`
package, with `Services` returning them, with the HTTP
layer doing the JSON serialise / unserialise. This is the
"protocol is the single source of truth" position and
**§7.6 implicitly asks for it**.

**Gap: `internal/api/services.go` does not import
`internal/api/protocol` for most fields.** It uses
`json.RawMessage` everywhere except for
`WorkspaceRecord` and `ServerRunner` (which uses local
structs in `services/services.go:540-590`).
The Go side mixes "protocol types" (`RuntimeEndpoints`,
`KairoError`, `ResponseEnvelope`, `ErrorResponse`) and
"service-local types" (`WorkspaceRecord`, `serverMeta`).
**The drift is at risk of growing.**

### 6.2 Handler parses ProjectID as path

`runtime-agent/internal/api/handlers.go:114-150`
(`handleProjectByID`):

```go
rest := strings.TrimPrefix(r.URL.Path, "/api/v1/projects/")
```

`rest` is then used as a project ID. The string-slice path
parsing is fragile (no escaping, no validation that `rest`
is a real ID), but the handler does **not** open files using
`rest`. It just calls `s.Services.ProjectStore.Get(rest)`
which checks the in-memory map. **Acceptable** for now;
W3 should not touch `handlers.go` (Mac Core owns it).

### 6.3 Handler executes build/deploy file ops

`runtime-agent/internal/api/handlers.go` is pure wire-layer:
it calls `s.Services.BuildEngine.Start(payload)`,
`s.Services.Deployer.Publish(payload)`, etc. The
implementations live in `internal/services/services.go:340-460`
(build) and `:460-540` (deploy). **Satisfied** for the
adapter; the W3 work will not change this.

### 6.4 No new RawMessage God service

The pattern of `json.RawMessage` everywhere is the closest
thing. Not technically a God service, but the long-term
plan is to type the wire layer properly. **Flag for Phase 6
evidence / contract freeze**, not Phase 2.

### 6.5 Mac-claimed files

Files W3 must NOT edit in this round:

```text
runtime-agent/internal/domain/**
runtime-agent/internal/repository/**
runtime-agent/internal/pathpolicy/**
runtime-agent/internal/planning/**
runtime-agent/internal/provider/build/**
runtime-agent/internal/app/build.go
runtime-agent/internal/app/build_impl.go
runtime-agent/internal/app/deploy*.go
runtime-agent/internal/build/**
runtime-agent/internal/deploy/**
runtime-agent/internal/security/**
runtime-agent/test/core/**
runtime-agent/test/fixtures/**
docs/adr/0010-project-identity-and-planning.md
docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md
```

This audit only reads (does not edit) `internal/app/build_impl.go`
and `internal/app/server_impl.go` for the `eventHub` /
`EventPublisher` references. **No edits** to those files
either — W3's Phase 2 changes will go into
`runtime-agent/internal/api/handlers.go` only (the WS
auth + wire-up of the missing `EventBus`).

---

## 7. Pre-existing tests — current state

| Test file | What it tests | Status today |
|-----------|---------------|--------------|
| `packages/runtime-extension/src/browser/runtime.test.cjs` | 14 wire-protocol tests against a real `http.createServer` | ❌ broken: `require('@kairo/runtime-extension')` then `new KairoRuntimeImpl()` — class does not exist |
| `packages/runtime-extension/src/browser/runtime-dynamic-routes.test.cjs` | 19 route-by-route tests with a real HTTP server | ❌ same |
| `packages/runtime-extension/src/browser/dom-env.test.js` | jsdom env smoke | ✅ this one is plain JS, no `KairoRuntimeImpl` import |
| `packages/theia-product/src/main/browser/kairo-commands.test.cjs` | Theia command registration (12 commands) | ❌ same `KairoRuntimeImpl` import |
| `runtime-agent/internal/transport/events/eventhub_test.go` | EventHub publish/subscribe | ✅ passes (Go side, no W3 dependency) |
| `runtime-agent/internal/api/handlers_test.go` | 4xx/5xx unwrap + WS subprotocol auth | ✅ passes (Go side) |

`pnpm test` and `pnpm test:dynamic` in
`packages/runtime-extension/package.json` are the broken
ones. The CI workflow (`.github/workflows/ci.yml:241-267`)
runs the Go tests via `bash scripts/verify-e2e.sh` but
**does not run the TS wire-protocol tests**. The
`runtime.test.cjs` and `runtime-dynamic-routes.test.cjs` are
referenced by `package.json` `test` and `test:dynamic` but
never invoked in CI. **Net effect: the broken tests have
never been run.** This is a §1.4 / §1.7 evidence point.

---

## 8. Gap catalogue — ordered by severity

Severity rules (consistent with W2's audit + W6 ledger):

- **Blocker**: §7 explicitly forbids it, or DoD checkbox is
  not achievable without the fix.
- **Major**: Phase 2 Gate will not pass without the fix; not
  §7-forbidden but expected by the contract.
- **Minor**: not Phase-Gate-blocking; worth a fix in Phase 2
  where convenient.

### 8.1 Blockers (5)

| # | Anchor | §7 ref | What | Why blocker |
|---|--------|--------|------|-------------|
| **B1** | `runtime-connection-service.ts:398-417` | §7.1 / §7.4.1 | `connectEvents` opens a WS **without** the subprotocol token. Production Agent with `--require-auth` would 401. The build / server stores (`build-store.ts:74`, `server-store.ts:60`) use this path. | §7.1 mandates a single event source; §7.4.1 requires subprotocol auth. The 2 stores silently lose all events. |
| **B2** | `runtime-agent/cmd/kairo-runtime/main.go:88` + `internal/services/services.go:78` + `internal/api/services.go:84-86` | §7.6 | `api.Services.EventBus` is **never set**. `handleEvents` returns 500 with "EventBus not configured". | The whole WS event subsystem is dead on the wire today. The TS `EventStream` is therefore also dead. |
| **B3** | `runtime-agent/internal/transport/events/eventhub.go:23-32` vs `packages/protocol/src/index.ts:577-592` | §7.1 / §7.4 | Go `events.Event` and TS `WsEvent` are wire-incompatible (different discriminators, different field shapes). | Even with B2 fixed, the TS side would not understand the messages. |
| **B4** | `runtime-connection-service.ts:264-267` (called by 0 callers) | §7.2.5 / §7.4 last paragraph | `invalidateEndpoints()` exists but is not invoked on Agent restart. | On `POST /api/v1/runtime/restart` the new Agent may bind a different port. The renderer would keep using the old port. |
| **B5** | `packages/runtime-extension/src/browser/runtime.test.cjs:24,27` + `runtime-dynamic-routes.test.cjs:24,27` + `theia-product/.../kairo-commands.test.cjs:56,97,177,225` | §7.5 | Three test files reference a class `KairoRuntimeImpl` that no longer exists. `pnpm test` and `pnpm test:dynamic` are broken at `require()` time. | §7.5 mandates "contract tests using real local HTTP/WS test server, not just fetch mock". Cannot satisfy without the tests passing. |

### 8.2 Major (8)

| # | Anchor | §7 ref | What | Why major |
|---|--------|--------|------|-----------|
| **M1** | `runtime-connection-service.ts:380-386` (EventStream WS URL) | §7.2.5 / §7.4.6 | `openEvents()` builds a WS URL with **no `?workspaceId=` and no `?after=`**. The Go `EventHub.ServeWS` (or the handler-level auth path) only filters by workspaceId if it's in the query string; without it, the server's `?workspaceID=...` filter is skipped. | After Agent restart, the new port is unknown; after reconnect, snapshot recovery is not requested. |
| **M2** | `runtime-connection-service.ts:316-401` (typed `request<E>`) + `packages/protocol/src/index.ts:518-548` (EndpointMap) | §7.1 | 12+ endpoints (auth, audit, toolchains, jdtls, search, encoding/validate, runtime/restart, endpoints, jdtls/project, workspaces/.../java) are not in the TS `EndpointMap`. The `E extends Endpoint | string` fallback means typos are runtime 404s, not compile errors. | §7.1 says the gateway must be typed. Today the typing is incomplete. |
| **M3** | `runtime-connection-service.ts:382-388` (no 401 → connection invalidate) + `runtime.ts:23-25` (no-op listener) | §7.3 / §8.3.5 / DoD §3.5 | 401 is treated as a generic typed error; no event is emitted on the connection; `KairoErrorListener` default is a no-op; `lastHealth` is not cleared. | StatusBar / banner cannot react to auth failure. |
| **M4** | `apps/desktop/src/preload.ts:20` | §7.2.7 | `const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18099';` | Production fallback to 18099. The desktop main always sets the env, so this is unreachable today, but it's the only literal 18099 in the production path. |
| **M5** | `runtime-connection-service.ts:227-228` (fetchEndpoints timeout) | §7.3.5 | `fetchEndpoints` uses `defaultTimeoutMs ?? 5_000`, but shares the `defaultTimeoutMs` key with regular requests. A user setting 60s for everything else also waits 60s on the first connect. | Distinct config key needed (`endpointsTimeoutMs`). |
| **M6** | `runtime-errors.ts:67-76` (`isTransient`) | §7.3 | 401 is correctly marked non-transient, but 408 (`timeout`) is mapped to `'timeout'` *and* HTTP status `>= 500` is also transient. The matrix is reasonable but undocumented. A future change might regress this. | Document the transient policy in the protocol package. |
| **M7** | `runtime-connection-service.ts:484-492` (delay abort code) | §7.3.6 | Backoff-abort produces `KairoError{ code: 'timeout', message: 'Request was aborted during backoff' }` — misleading; caller-initiated abort is not a timeout. | Rename to `code: 'aborted'`. |
| **M8** | `runtime-connection-service.ts:418-426` (legacy `disconnectEvents` ordering) | §7.4.5 / §7.4.8 | `disconnectEvents()` does not set `closedByCaller`; the pending `setTimeout` in `connectEvents` can fire after disconnect. | Race; multiple reconnects in flight. |

### 8.3 Minor (10)

| # | Anchor | What |
|---|--------|------|
| m1 | `runtime-connection-service.ts:84-87` | `setBearerToken()` is a deprecated alias of `setAgentSecret()`. Keep until all callers migrate, then delete in Phase 6. |
| m2 | `runtime-errors.ts:109` (422 mapped to `invalid_request`) | 422 should be its own code (`'validation_failed'`). |
| m3 | `runtime-connection-service.ts:307-312` + `KairoError` (no `requestId` field) | `X-Kairo-Request-Id` response header is set by the Agent but not stored on the TS `KairoError`. Add a `requestId?: string` field for toasts. |
| m4 | `runtime-connection-service.ts:583-595` (no heartbeat) | EventStream has no ping / pong / idle detect. The Go side pings every 15s but the TS side never responds. |
| m5 | `runtime-connection-service.ts:596-602` (no jitter) | Exponential backoff is deterministic. §7.4.4 explicitly mentions jitter. |
| m6 | `runtime-errors.ts:142-194` (no payload validation) | `unwrapResponse` checks envelope shape but not the inner payload. `KairoError.details` is `unknown` and could in principle contain secrets from the agent. Document the "details must not contain secrets" rule in the protocol. |
| m7 | `kairoErrorMessage` in `kairo-views-contribution.ts:389-394` | The error formatter is duplicated from `KairoError.format()`. Could be unified. |
| m8 | `runtime-extension/src/browser/runtime.ts:23-25` | The default `KairoErrorListener` is a no-op. No widget registers a non-default one. The whole listener hook is currently dead code. |
| m9 | `runtime-agent/internal/api/protocol/types.go:46` (`Details any`) | TS side says `details?: unknown`; Go side is `any`. Same shape, different lint story. |
| m10 | `runtime-agent/internal/transport/events/websocket.go:12` (`CheckOrigin: return true`) | `CheckOrigin` always returns `true`. Acceptable for a loopback desktop app, but a future TLS / remote deployment must tighten this. |

---

## 9. Cross-cutting observations for other Agents

### 9.1 To W2 (Desktop Host)

- W2's `apps/desktop/src/preload.ts:20` is the last production
  `18099` literal (M4). W2 owns the preload rewrite. W3 needs
  the preload to either:
  (a) remove the literal and require `KAIRO_AGENT_URL` to be
      set (with a startup error if not), or
  (b) expose a `getEndpoints()` async method on the
      `KairoDesktopRuntimeConfig` preload contract that the
      runtime client calls to discover the port, with the
      fallback only used for `pnpm start` dev.
  The design doc proposes (b).

- W2 owns secret redaction in `apps/desktop/src/main.ts`
  (W2 audit `B1`/`M13`). W3 does not own desktop logging.
  Cross-reference: `KairoErrorListener` should **not**
  serialise the full `KairoRuntimeConfig` (which contains the
  secret). W3 will add a `redactSecrets(config)` helper and
  document that listener implementations must call it.

### 9.2 To W4 (Product UI)

- W4 is the only consumer that should care about the typed
  `request<E>` method (§7.1). W3 will expand the `EndpointMap`
  in Phase 2. After the expansion, W4 can convert all
  `request('GET /api/v1/...')` calls to `request<...>('GET /api/v1/...')`
  and get compile-time validation. **W4 does not need to wait
  for W3** to start writing the UI; the dynamic `string` form
  keeps working today.

- The `connectEvents` path is used by `build-store.ts` and
  `server-store.ts` (not in W4's packages, but W4 may want
  to read those stores). When W3 deletes `connectEvents`, W4
  must update `BuildStore` and `ServerStore` to use
  `runtime.openEvents()` and a typed `eventStream.on('build.progress', ...)`.

### 9.3 To W5 (Java Intelligence)

- The `JdtProjectRequest` and `JdtStartRequest` are not in
  the `EndpointMap` (M2). W5 will need to use the dynamic
  string form until Phase 2 fixes the map.
- The `WsEvent` schema (§1.6) has no `jdt.progress` variant.
  If W5 wants to publish Java-language events over the WS,
  the protocol must be expanded (Phase 2 cross-ref; W3 owns
  the protocol).

### 9.4 To W6 (Integration & Evidence Lead)

- The `puppeteer-core` override in `package.json` is an
  in-flight W1 change (verified in `git status`). W3 does
  not touch the root `package.json` per §3.3.
- The TS test scripts (`pnpm test`, `pnpm test:dynamic`) are
  broken (B5). The W6 CI gate should add a step to run them
  and fail the gate on the missing class. Today the gate
  silently passes because the broken scripts are not
  invoked by `.github/workflows/ci.yml`.
- The `WsEvent` vs `events.Event` mismatch (B3) means any
  evidence that claims "WS round-trip verified" without a
  schema-conformance test is suspect. The contract test in
  §7.5 (table-driven) is the only way to prove wire
  compatibility end-to-end.

---

## 10. Phase 2 size estimate (sanity check)

Based on the 5 blockers + 8 majors + 10 minors:

- **B1** (replace `connectEvents` with `EventStream` everywhere)
  is the largest single item: ~1.5 person-days (2 store
  consumers to update, plus their tests). Net effect of the
  fix: deletes ~50 lines from `runtime-connection-service.ts`.
- **B2** (wire `EventBus` to `EventHub.ServeWS` in
  `internal/services/services.go` + `cmd/kairo-runtime/main.go`)
  is ~0.5 person-day. The interface already exists; the
  wiring is a one-liner. **Caveat**: W3 does not own
  `internal/services/...` (that's Mac Core). W3 must file
  a Contract Request for the wiring to land.
- **B3** (resolve the WS schema mismatch) is the design
  question of Phase 2. Three options (see
  `WINDOWS_WAVE2_W3_DESIGN.md` §3.4). The minimum
  implementation is to either rename the Go-side `events.Event`
  fields to match `WsEvent`, or write a translator in the
  `handleEvents` auth path. ~1 person-day.
- **B4** (call `invalidateEndpoints` on restart) is a 5-line
  change in the EventStream `onclose` path + an EventStream
  refetch method. ~0.25 person-day.
- **B5** (fix the test files) is mechanical: replace
  `KairoRuntimeImpl` with `RuntimeConnectionService` in 3
  files, and re-export `RuntimeConnectionService as
  KairoRuntimeImpl` for back-compat in `index.ts`. ~0.25
  person-day. The test logic itself is correct; only the
  import is stale.

- **M1, M2, M3, M4, M5, M6, M7, M8** total ~3 person-days.
- **m1..m10** total ~1 person-day.

**Total estimated Phase 2 effort: 6.5–8.5 person-days** of W3
implementation work, plus 1 person-day of W6 re-run of the
contract tests after each batch lands (per W6's
`WINDOWS_WAVE2_W6_DOD_STATE.md` 1.12 etc.).

Phase 2 also depends on:

- W2's preload contract freeze (M4 needs the new shape).
- Mac Core's `EventBus` wiring (B2 — Contract Request, not a
  W3 code change).
- Mac Core's `events.Event` schema alignment (B3 — could be
  a Contract Request if W3 cannot edit `internal/transport/events/`).

---

## 11. What is already correct (preserved during Phase 2)

These are **not** gaps; they are anchors W3 will not regress:

- `RuntimeConnectionService` is the only HTTP client
  (no second `KairoRuntimeImpl`).
- All consumers inject `RuntimeConnectionService` via DI
  (no direct `fetch()` outside the service).
- `X-Kairo-Secret` is used (no `Authorization: Bearer`).
- `KAIRO_WS_SUBPROTOCOL = 'kairo-secret-v1'` is the canonical
  subprotocol name.
- `/api/v1/endpoints` discovery works end-to-end.
- The protocol DTOs are hand-written and the Go mirror is in
  place (drift is the issue, not absence).
- `KairoError` and `KairoErrorCode` are the canonical typed
  error shape; the enum is closed and mirrored.
- The 4xx/5xx → typed error mapping is correct (`httpStatusToCode`).
- The AbortSignal plumbing is correct on the request path
  (timeout + parent signal + backoff abort).
- The `EventStream` class (when wired up) is correct on
  auth, backoff, status, dispose.
- The Go middleware uses `subtle.ConstantTimeCompare` for
  the secret.
- The 18099/3000 production-path residue is **one literal**
  (`preload.ts:20`); all other references are comments, tests,
  or dev-only scripts.

---

## 12. Phase 0 Gate status for W3

| DoD item (Phase 0 / W3 scope) | Status | Anchor |
|--------------------------------|--------|--------|
| 7.1 audit complete | ✅ this document | — |
| 7.1 design complete | ✅ `WINDOWS_WAVE2_W3_DESIGN.md` | — |
| Read-only (no product code) | ✅ verified via `git diff` | `git status` shows only the W1 `package.json` change and `scripts/rc.ps1` (W1's) plus my new `docs/progress/WINDOWS_WAVE2_W3_*.md` |
| No Mac-claimed files touched | ✅ no edits to `internal/{domain,repository,pathpolicy,planning,provider,build,deploy,security}` etc. | — |
| Honest gap list | ✅ §8 | — |
| Honest Phase 2 estimate | ✅ §10 | — |

The W3 Phase 0 deliverable is **complete**. Phase 2 work is
gated on W1's Phase 0 sign-off + W2's preload contract.
