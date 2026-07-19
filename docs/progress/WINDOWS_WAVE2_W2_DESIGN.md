# Agent W2 — ChildSupervisor + Preload Contract Design (Phase 0)

> **Owner**: Agent W2 (Desktop Host) — Windows Wave 2
> **Branch**: `feature/windows-wave2-product-vertical-slice` @ `c0c7491`
> **Companion**: `WINDOWS_WAVE2_W2_AUDIT.md` (gap catalogue)
> **Reference contract**: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §6
> **Mode**: design only. No TS code in `apps/desktop/src/`. No
> preload edits (awaiting W3 contract freeze per Wave 2 prompt).
> **Status**: **proposal**, pending Phase 0 Gate, W3 contract
> review, and W6 sign-off.

This document is the bridge between the audit's gap list and the
Phase 1 implementation. Every design decision cites the audit gap
it resolves and the §6 clause it satisfies.

---

## 0. Scope and non-goals

**In scope** (Phase 1 deliverable):

- `ChildSupervisor` TypeScript class in `apps/desktop/src/main/`
  (new directory; the existing `apps/desktop/src/main.ts` becomes
  `apps/desktop/src/main/index.ts` after the refactor)
- `ManagedChild` interface and `ChildState` machine (§6.2)
- Preload contract: `KairoDesktopRuntimeConfig` typed surface
  (§6.4) — interface only; implementation requires W3 contract
  freeze
- Readiness protocol choice and justification (§6.3)
- Path matrix resolver (§6.5)
- Test scaffold plan (§6.7)

**Out of scope** (different Agent):

- Runtime client consumer change in
  `packages/runtime-extension/src/browser/runtime-connection-service.ts`
  → W3 (Phase 2)
- Go-side restart / supervisor logic in `runtime-agent/internal/api`
  → Mac Core + W3
- Theia frontend React widgets / store changes → W4
- JDT LS launch / distribution → W5

**Non-goals** (explicit "do not do"):

- No child-process abstraction for the **renderer** (Electron
  context isolation already prevents this; §6.1)
- No second `RuntimeConnectionService` instance (W3 owns that;
  §7.1)
- No second `HostSupervisor` in the Go agent (the Mac side
  already deleted the old one per `DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md:419`;
  this design is the single owner)
- No event-sourcing layer for the supervisor state (just an
  in-memory `EventEmitter` is enough for Phase 1)
- No cross-window state for the secret (single secret per
  Electron main; if a second window is ever created it inherits)

---

## 1. ChildState state machine

### 1.1 The six states (verbatim from §6.2)

```ts
type ChildState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'crashed'
  | 'failed';
```

### 1.2 State diagram

```text
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
   ┌──────┐   start()   ┌──────────┐  readiness  ┌──────┐ │
   │ idle │ ──────────► │ starting │ ──────────► │ready │ │
   └──────┘             └──────────┘             └──────┘ │
       ▲                    │   ▲                     │   │
       │                    │   │                     │   │
       │              fail  │   │ retry               │   │
       │                    ▼   │ (backoff)            │   │
       │                exit   │                     │   │
       │                before │                     │   │
       │                ready  │                     │   │
       │                    │   │                     │   │
       │                    ▼   │                     │   │
       │                ┌──────────┐                  │   │
       │                │ crashed  │                  │   │
       │                └──────────┘                  │   │
       │                    │   ▲                     │   │
       │                    │   │                     │   │
       │      N crashes in  │   │ restart succeeds    │   │
       │      window ≤ 5    │   │ (backoff=reset)     │   │
       │                    ▼   │                     │   │
       │                ┌──────────┐                  │   │
       └──── stop() ──── │ stopping │ ◄─── stop() ───┘   │
                         └──────────┘                      │
                              │                            │
                              │ exit before stop deadline  │
                              ▼                            │
                         ┌──────────┐                      │
                         │ crashed  │ ─────────────────────┘
                         └──────────┘
                              │
                              │ 5 consecutive crashes
                              │ within backoff window
                              ▼
                         ┌──────────┐
                         │  failed  │   (terminal until user / app
                         └──────────┘    calls reset() or stop()
                                          then start())
```

### 1.3 State transition table

| From | Event | To | Side effects |
|------|-------|-----|--------------|
| (any) | `ctor` | `idle` | none |
| `idle` | `start()` | `starting` | spawn child, set startup deadline timer, register `ready` listener |
| `starting` | readiness signal received | `ready` | clear startup deadline timer, reset `crashCount` for the new lifetime |
| `starting` | `error` event (no spawn) | `idle` (or `crashed` if retries > 0) | attempt to clean up any half-spawned resources |
| `starting` | `exit` event before `ready` | `crashed` (or `failed` if at limit) | schedule restart with backoff, OR enter `failed` |
| `ready` | `stop()` | `stopping` | send `SIGTERM`, start stop deadline timer |
| `ready` | `error` / unexpected `exit` | `crashed` | schedule restart with backoff |
| `stopping` | `exit` before deadline | `idle` (or `crashed` if `restartPending`) | clear stop deadline timer |
| `stopping` | deadline elapsed | `idle` (or `crashed`) | send `SIGKILL`, force exit poll |
| `crashed` | backoff elapsed | `starting` | spawn child again |
| `crashed` | `stop()` | `idle` (cancel pending backoff) | clear backoff timer |
| `failed` | `stop()` | `idle` | manual reset; user / app must explicitly call |
| `failed` | `reset()` | `idle` | clear crash count, allow fresh start attempts |

### 1.4 Properties this design guarantees

- **Idempotent start**: a second `start()` while in `starting`,
  `ready`, or `crashed` returns the existing start promise; it
  does not spawn a second process. (Resolves audit **M4**.)
- **Single start/exit promise**: `start()` resolves with
  `ReadyInfo` exactly once; `exit` events that arrive after
  resolve do not cause a second resolution. (Resolves audit
  M5-related issues.)
- **No throws in event callbacks**: every EventEmitter
  subscriber is wrapped; an exception is logged + emitted as a
  supervisor-level `error` event but does not crash the main
  process. (Resolves the legacy N-022 class of bugs.)
- **Serialised restart**: a `restart()` while a backoff timer
  is pending cancels the pending timer and starts immediately;
  a `restart()` while in `starting` is a no-op (returns the
  in-flight promise). (Resolves audit **M4**.)
- **Backoff with jitter + upper bound**: `min(maxBackoffMs,
  baseBackoffMs * 2^n) ± jitter`, capped at 5 attempts within
  60 seconds; the 6th attempt within the window enters
  `failed`. (Resolves audit **B4**.)
- **Shutdown does not auto-restart**: while `shuttingDown === true`,
  `exit` events transition to `idle` (or `failed` only if
  already at the limit), not `crashed`. (Resolves audit
  §6.2.9.)
- **No leaks on start failure**: if the child process errors
  before it is fully spawned, the half-spawned resources (PID
  table entry, env-block handle on Windows) are cleaned up.
  (Resolves audit §6.2.5.)
- **Bounded logs**: `RingBuffer(MAX_LOG_LINES)`; oldest line
  is evicted on overflow. Both `stdout` and `stderr` lines
  flow through the same buffer. (Resolves audit **M3**.)

### 1.5 Bounded backoff algorithm

```text
backoff(n) = min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2^n) * U(0.75, 1.25)
n = consecutive crashes since last successful ready
fail window = 60_000 ms (sliding)
fail threshold = 5 crashes within the fail window → state = 'failed'
```

Initial values (tunable, constants in the supervisor):

```ts
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 8_000;
const FAIL_WINDOW_MS = 60_000;
const FAIL_THRESHOLD = 5;
```

This puts the first restart at ~250ms, the second at ~500ms,
the third at ~1s, the fourth at ~2s, the fifth at ~4s, the
sixth (if it occurs) at ~8s, all jittered ±25%. Five crashes
within 60s → `failed`.

### 1.6 Observability

The supervisor extends `EventEmitter`. Events:

- `state-change` — `{ from: ChildState, to: ChildState, reason: string }`
- `ready` — `ReadyInfo`
- `log-line` — `{ stream: 'stdout' | 'stderr', line: string }`
- `crash` — `{ exitCode: number | null, signal: string | null, at: number }`
- `backoff` — `{ attempt: number, delayMs: number }`
- `failed` — `{ reason: 'crash-budget' | 'never-started' }`
- `error` — `{ stage: string, err: Error }` (supervisor-level
  failures; never thrown, always emitted)

The main process forwards `state-change` to the StatusBar (via
the existing `KairoDesktopRuntimeConfig.subscribe` preload API;
see §4) so the UI can show "Reconnecting…" / "Agent stopped"
without polling.

---

## 2. ManagedChild interface

### 2.1 The interface (draft TS, **not** committed)

```ts
// apps/desktop/src/main/managed-child.ts
//
// The single owner of a child process. Two implementations
// live in this directory:
//   - AgentChild   (wraps the Go runtime agent binary)
//   - TheiaChild   (wraps the Theia backend node process)
// Both share the same interface so the supervisor doesn't
// care which child it owns.
//
// Per §6.2: "start 幂等或明确返回 conflict; error/exit 只完成
// 一次 promise; start 失败清理半启动进程". The interface below
// is the minimum needed to satisfy §6.2 + §6.3 + §6.6.

import type { ChildProcess } from 'node:child_process';
import type { AbortSignal } from 'node:events';

/** Information needed to talk to the child once it's ready. */
export interface ReadyInfo {
  /** host:port the child is listening on, loopback only. */
  readonly address: { host: '127.0.0.1'; port: number };
  /** Identity the child reported during readiness handshake. */
  readonly identity: {
    /** Must equal `agentVersion` / `theiaVersion` from the
     *  build's `package.json`. The supervisor asserts this
     *  to defend against a stale process on the same port
     *  (resolves audit M2). */
    readonly version: string;
    /** Optional per-child type, e.g. "kairo-runtime" or
     *  "theia-backend". */
    readonly product?: string;
  };
  /** The PID that produced this ReadyInfo. Used by the
   *  supervisor to correlate later exit events. */
  readonly pid: number;
  /** Wall-clock when readiness was confirmed. */
  readonly readyAt: number;
}

/** Configuration for one ManagedChild instance. */
export interface ManagedChildConfig {
  /** Human-readable label for logs / UI ("agent", "theia"). */
  readonly label: 'agent' | 'theia' | string;
  /** Absolute path to the binary (agent) or to a Node
   *  entrypoint (theia). Resolved at construction time by
   *  the path resolver (§5). */
  readonly command: string;
  /** Command-line args. MUST NOT include the secret
   *  (audit §3.2). */
  readonly args: readonly string[];
  /** Environment to merge into `process.env`. MUST contain
   *  `KAIRO_LOCAL_SECRET` for the agent; MUST NOT contain
   *  the secret for the theia backend (it should reach the
   *  theia backend via the secret-handshake preload contract;
   *  see §4). */
  readonly env: Readonly<Record<string, string>>;
  /** How long `start()` may wait for readiness before
   *  rejecting with `TimeoutError`. */
  readonly startupDeadlineMs: number;
  /** How long `stop()` may wait for graceful exit before
   *  sending `SIGKILL`. */
  readonly stopDeadlineMs: number;
  /** AbortSignal: when aborted, the child is stopped
   *  immediately and `start()` rejects. The supervisor
   *  passes the same signal that the app's `before-quit`
   *  uses so cancellation is consistent. */
  readonly signal: AbortSignal;
  /** Stdout/stderr line callback; the supervisor attaches a
   *  bounded ring buffer + a redaction filter (§4.5). */
  readonly onLogLine: (line: string, stream: 'stdout' | 'stderr') => void;
  /** Stdio config; the supervisor always uses
   *  `['ignore', 'pipe', 'pipe']` for the agent and theia
   *  to keep control of the log pipeline. */
  readonly stdio: ['ignore', 'pipe', 'pipe'];
}

export interface ManagedChild {
  /** Identity the supervisor can show in the UI. */
  readonly label: string;

  /**
   * Start the child. Idempotent:
   *   - in `starting`: returns the in-flight promise
   *   - in `ready`: returns a resolved promise
   *                (no-op; supervisor treats as already up)
   *   - in `crashed` or `idle`: spawns now
   *   - in `failed`: throws a typed `ChildInFailedStateError`;
   *                  caller must call `reset()` first
   * Rejects with:
   *   - `StartupTimeoutError` if readiness not seen in time
   *   - `SpawnError` if `spawn` itself failed
   *   - `IdentityMismatchError` if readiness signal carried
   *     a wrong identity (audit M1 / M2)
   */
  start(): Promise<ReadyInfo>;

  /**
   * Stop the child. Sends `SIGTERM` first, then `SIGKILL`
   * after `stopDeadlineMs`. Resolves once the process has
   * actually exited (PID is gone, exit received). Safe to
   * call from `before-quit`.
   */
  stop(deadlineMs?: number): Promise<void>;

  /**
   * Stop + start with the same config. Serialised: a
   * concurrent call returns the in-flight promise. If the
   * child is in `failed`, throws `ChildInFailedStateError`.
   */
  restart(reason: string): Promise<ReadyInfo>;

  /** Current state. Cheap; safe to call from UI tick. */
  state(): import('./child-state').ChildState;

  /**
   * The most recent ReadyInfo (or undefined if not yet
   * ready). UI may read this to show "Agent listening on
   * 127.0.0.1:54123" without subscribing to events.
   */
  readyInfo(): ReadyInfo | undefined;

  /** Last N log lines (bounded by the supervisor's ring
   *  buffer). UI may read this for a "show recent logs"
   *  view. */
  recentLogs(opts?: { stream?: 'stdout' | 'stderr' | 'both'; limit?: number }): readonly string[];

  /** Subscribe to supervisor events. Returns an
   *  `unsubscribe` function. */
  on<E extends keyof SupervisorEventMap>(
    event: E,
    listener: (payload: SupervisorEventMap[E]) => void,
  ): () => void;
}

export interface SupervisorEventMap {
  'state-change': { from: ChildState; to: ChildState; reason: string };
  ready: ReadyInfo;
  'log-line': { stream: 'stdout' | 'stderr'; line: string };
  crash: { exitCode: number | null; signal: string | null; at: number };
  backoff: { attempt: number; delayMs: number };
  failed: { reason: 'crash-budget' | 'never-started' };
  error: { stage: string; err: Error };
}

/** Typed error surface so callers can distinguish. */
export class SpawnError extends Error { readonly code = 'SPAWN_ERROR' as const; }
export class StartupTimeoutError extends Error { readonly code = 'STARTUP_TIMEOUT' as const; }
export class IdentityMismatchError extends Error { readonly code = 'IDENTITY_MISMATCH' as const; }
export class ChildInFailedStateError extends Error { readonly code = 'CHILD_IN_FAILED_STATE' as const; }
export class AlreadyStoppingError extends Error { readonly code = 'ALREADY_STOPPING' as const; }
```

### 2.2 What the interface deliberately does **not** expose

- The raw `ChildProcess` handle. The supervisor owns it; the
  caller never needs `process.kill`, `process.pid`, or
  `process.stdout`. (This is what eliminates the audit
  M-class issues around ad-hoc `kill('SIGTERM')` calls.)
- Any way to inject extra env at start time. Env is fixed in
  the config so the secret is provably in only one place.
- A "fire-and-forget start" — every start returns a promise.
  The previous code's behaviour of "spawn, then poll readiness
  with a 300ms loop" was a footgun; the new shape is
  promise-only.
- A "restart" without a `reason` string. The reason is logged
  and emitted on the supervisor's `backoff` event so
  crash-bursts are debuggable.

### 2.3 Supervisor vs Adapter split

```text
ChildSupervisor (apps/desktop/src/main/child-supervisor.ts)
  - owns the ChildState machine
  - owns the ring buffer
  - owns the backoff timer
  - generic over a ManagedChild implementation

ManagedChild interface (apps/desktop/src/main/managed-child.ts)

  - AgentManagedChild   (apps/desktop/src/main/agent-child.ts)
      wraps the Go agent spawn
      uses AgentReadySignalParser
  - TheiaManagedChild   (apps/desktop/src/main/theia-child.ts)
      wraps the Theia backend spawn
      uses TheiaReadySignalParser

  - FakeManagedChild    (apps/desktop/src/main/fake-child.ts)
      test double, no real spawn
      in-memory ring buffer
      injected clock for backoff tests
```

The supervisor knows nothing about agent vs theia. The
implementations know nothing about backoff or state — they
only emit readiness / exit / log signals, and the supervisor
translates them into state transitions.

This split is what makes the §6.7 test categories cheap:
FakeManagedChild is the only test double; the supervisor's
state machine is exercised with the fake; the real
implementations are covered by a separate dev-smoke test.

---

## 3. Startup readiness protocol

### 3.1 The three options §6.3 mentions

> 不要先选择"看起来空闲"的端口再长时间等待，因为存在 TOCTOU。
> 优先让子进程绑定 `127.0.0.1:0` 并通过受控 channel/ready
> file/stdout structured message 返回实际端口。

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| **A. Bind-to-0 + stdout structured message** | child writes `{"kairo-ready": {"port": 12345, "version": "0.1.0", "pid": 6789}}` to stdout, parent reads line-by-line | No port re-use race; readiness = child self-declares; identity included in same message | Requires Agent contract change (new flag like `--ready-message`); Theia backend may not be easy to modify |
| **B. Bind-to-0 + ready file** | child writes `ready.json` atomically to a temp path the parent passed via env; parent polls the file | Robust to stdout buffering; ready file can carry rich identity | Race on file read vs write; Windows file-locking semantics; cleanup of temp file |
| **C. Parent pre-binds port (current) + identity-validating GET** | parent picks a free port, passes to child, child binds; parent polls `/health` and validates the body | No Agent contract change; backward compatible with Wave 1 | TOCTOU window (microseconds, but exists); readiness does not carry the PID; a stale Agent on the same port would falsely pass |

### 3.2 Recommendation: **A (bind-to-0 + stdout structured message)** for the agent, **C (with identity validation)** for the theia backend

**Why A for the agent**:

- The Agent is Go. We own the binary. Adding a `--ready-message`
  flag is a 30-line change to `cmd/kairo-runtime/main.go` and
  a 50-line change to `internal/api/server.go` to emit the
  message once the listener is bound and `services` is ready.
- Stdout is already piped (current code, `main.ts:90`).
- A structured message on stdout (a single JSON line) is the
  simplest possible cross-platform contract. No files, no
  TOCTOU, no port-reuse races.
- The message can carry `pid` so the supervisor can correlate
  later exit events.
- The message can carry `version` / `agentVersion` so the
  supervisor can assert identity and reject a stale process.

**Why C for the theia backend**:

- Theia backend is a pre-built Node script
  (`apps/browser/lib/backend/main.js`) that we **do not** own
  at the source level. Adding a stdout structured message
  would require either a wrapper script or modifying the
  Theia build, both of which are out of scope.
- A GET to the Theia entry path, validated for the presence of
  a `data-kairo-version` marker in the response (a `<meta>`
  tag injected by the Theia product bindings, owned by W4) is
  the minimum viable identity check.
- The TOCTOU window for Theia is acceptable because the
  backend has no security boundary (the security boundary is
  the Agent, not Theia). A stale Theia on the same port is a
  bug we want to know about, not a security hole.

### 3.3 Ready message format (Agent)

```json
{
  "kairo-ready": {
    "product": "kairo-runtime",
    "version": "0.1.0",
    "agentVersion": "0.1.0",
    "pid": 12345,
    "address": "127.0.0.1:54123",
    "capabilities": ["http", "ws"]
  }
}
```

The Agent emits exactly one such line on stdout once
`http.Server.ListenAndServe` has bound and the secret middleware
is registered. The line is prefixed with a constant token
(`kairo-ready`) so the supervisor can distinguish it from
normal log output. The supervisor's line-reader accumulates
until the JSON parses, then transitions to `ready`.

### 3.4 Identity validation

The supervisor asserts:

- `body.kairo-ready.product === expectedProduct`
  (e.g. `kairo-runtime` for the agent)
- `body.kairo-ready.version === packageJson.version`
  (the version of the Kairo IDE package, not the agent's)
- `body.kairo-ready.pid === childProcess.pid`
  (defends against the rare case of a zombie agent on the
  same port — the `pid` will not match)

For the Theia backend, the supervisor asserts:

- `res.statusCode === 200`
- `res.headers['content-type']` is `text/html`
- The HTML body contains `<meta name="kairo-version"
  content="<version>"` matching `packageJson.version`
  (W4 owns the meta-tag injection; this is a one-line
  addition to the Theia product bindings)

### 3.5 Bounded readiness wait

```text
deadline: config.startupDeadlineMs (default 15_000 for agent, 30_000 for theia)
poll: every 250ms checking the line-buffer for the ready line
fail: deadline elapsed + no ready line → StartupTimeoutError
```

The 250ms poll is internally driven (not a `setInterval`); it
cancels on the first ready line and on abort signal. This is
strictly better than the current "300ms setTimeout in a recursive
loop" which can stack up if the child is slow.

### 3.6 Backwards compat: Wave-1 verify-e2e.ps1

The Wave-1 verify script (`scripts/verify-e2e.ps1`) calls the
Agent directly with a fixed `--port` and asserts `/api/v1/health`
returns 200. The new Agent contract must remain compatible with
this:

- The `--port` flag stays. The new `--ready-message` flag is
  optional; if unset, the Agent continues to use stdout for
  logs only and the supervisor falls back to the GET /health
  poll (with a warning logged that PID identity cannot be
  verified).
- `/api/v1/health` is unchanged.

This keeps the Wave-1 contract intact while enabling the
stronger protocol for Wave 2.

### 3.7 The contract request to Mac (if needed)

If the Agent contract change is on the Mac side, W2 will file
`CR-XXX: Agent ready-message stdout protocol` once the contract
is finalised. If it is implemented in a Windows-adapter slice
(`runtime-agent/cmd/kairo-runtime/main.go` is in the Windows
MAY-edit list per §3.1), no contract request is needed.

---

## 4. Secret lifecycle (§6.4 — 10 clauses)

### 4.1 Per-clause design

| §6.4 | Requirement | Design |
|------|-------------|--------|
| **1** | Electron main creates per-session secret via cryptographic RNG | `randomBytes(32).toString('hex')` in `apps/desktop/src/main/secret.ts`; created once at `app.on('ready')`. |
| **2** | Passed only via child env to Agent | `env: { KAIRO_LOCAL_SECRET: secret }` in `AgentManagedChild.env`; **never** in `args`. The supervisor refuses to start a child if the secret appears in the args (assertion in `AgentManagedChild.start()`). |
| **3** | Not in command line | See above; supervisor asserts this at spawn time. |
| **4** | Not in normal logs | All log lines are routed through a redaction filter (`apps/desktop/src/main/log-redactor.ts`) that replaces any 64-hex-char token matching the secret length with `[REDACTED]`. The filter is applied to both the in-memory ring buffer and the parent stdout mirror. |
| **5** | Preload exposes minimal controlled API | New `KairoDesktopRuntimeConfig` interface (see §4.2). No plain-object global. The renderer never sees the secret as a property; it sees a `requestSecret()` function that returns a `Promise<string>`. The renderer can call it; it cannot enumerate it. |
| **6** | Not in localStorage / sessionStorage | Preload does not write to either. Runtime client is updated to receive the secret via `requestSecret()` and keep it in a non-enumerable class field (set via `Object.defineProperty(this, 'agentSecret', { value, writable: false, enumerable: false, configurable: false })`). |
| **7** | Restart policy: same session reuses, full app restart rotates | Supervisor owns a `SecretSession` object. On `AgentChild.start()` after a runtime restart, the same secret is reused (same Electron session, same `SecretSession` object). On `app.on('ready')` (full app start), a new `SecretSession` is created and the old one is destroyed (`secret = null`, GC). The rotation is a single line: `secret = randomBytes(32).toString('hex')`. |
| **8** | Renderer error logs do not serialise config | The `KairoErrorListener` (already in `packages/runtime-extension`) is updated to **not** include the `agentSecret` field in serialised error reports. Test: `runtime-errors.test.cjs` (new) asserts the secret does not appear in any serialised error. |
| **9** | DevTools off in production | `webPreferences.devTools = !app.isPackaged` in the BrowserWindow config. Verified in dev (DevTools available) and prod (DevTools not available). |
| **10** | Crash dump / diagnostic bundle redaction | The Electron crash reporter is not enabled by default; if it is enabled in the future, the redaction filter is wired into the crash-dump writer. The diagnostic bundle (artifacts/windows-wave2/logs/) is filtered by the same `LogRedactor` at bundle-generation time. W6 owns the bundle generation; W2 contributes the redactor. |

### 4.2 The preload contract (draft)

```ts
// packages/protocol/src/runtime-config.ts (new, contract owner = W3)
//
// Single source of truth for the renderer-side configuration
// object. W3 owns this interface; W2 consumes it for the
// preload implementation.

export interface KairoDesktopRuntimeConfig {
  /** Stable per-Desktop-session id. May be logged.
   *  Survives runtime restarts; rotates on full app restart. */
  readonly sessionId: string;

  /** Base URL for HTTP API calls. Loopback only. */
  readonly agentBaseUrl: string;

  /** URL for WebSocket event stream. Loopback only. */
  readonly eventUrl: string;

  /** Schema version of the runtime config; renderer can
   *  assert to refuse startup if mismatched. */
  readonly schemaVersion: 1;

  /** Product identity for the host process; renderer
   *  surfaces this in Help → About. */
  readonly hostVersion: string;

  /** Request the current secret. Each call returns a fresh
   *  Promise; the implementation may cache for a short
   *  interval (50ms) to avoid per-request overhead. The
   *  Promise resolves to the same string for the entire
   *  session (until full app restart). */
  requestSecret(): Promise<string>;

  /** Subscribe to runtime lifecycle events (the supervisor's
   *  `state-change` events). The listener receives a stable
   *  snapshot per call. Returns an `unsubscribe` function. */
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
}

/** A snapshot the renderer can render in a status bar. */
export interface RuntimeSnapshot {
  readonly agent: ChildSnapshot;
  readonly theia: ChildSnapshot;
  readonly secretRotatedAt: number | null;
}

export interface ChildSnapshot {
  readonly state:
    | 'idle' | 'starting' | 'ready' | 'stopping' | 'crashed' | 'failed';
  readonly address: { host: '127.0.0.1'; port: number } | null;
  readonly lastError: string | null;
  readonly restartCount: number;
}
```

### 4.3 Why `requestSecret()` and not a property

The `requestSecret()` shape is the recommended shape per §6.4.5
("如果安全评审认为直接返回 secret 范围过大，改为 preload 代理
fetch/WS token握手"). The function form:

- Is not enumerable as a property of any object (it is a
  function on the `KairoDesktopRuntimeConfig` interface, not a
  string field).
- Can be wrapped in a side-effect-free proxy that asserts the
  call is from a known renderer context (a `WeakMap<Window,
  number>` of "secret request counts"; a renderer that
  requests the secret more than N times per second is rate-
  limited and the call returns a sentinel).
- Can be replaced with a token handshake (the alternative
  §6.4.5 mentions) without changing the renderer call site:
  `requestSecret()` returns the same `Promise<string>` either
  way.

The alternative `window.kairoConfig.agentSecret` shape (current
code) makes both the rate-limiting and the handshake swap
impossible without a renderer-side migration.

### 4.4 Secret rotation policy (explicit)

```text
SecretSession {
  secret: string              // 256 bits hex
  createdAt: number           // wall-clock
  rotatedAt: number | null    // wall-clock of last full app restart
}

// Rotation triggers:
// 1. Full app start:     SecretSession() with new secret
// 2. Runtime restart:    no rotation; reuse the same secret
// 3. Secret handshake:   no rotation; reuse the same secret
// 4. Manual rotation:    not exposed; reserved for future security review

// On `before-quit`:
//   secret = null   (defensive: don't keep it in memory if
//                    the process crashes before exit handler
//                    runs on Windows)
```

### 4.5 LogRedactor (interface only)

```ts
// apps/desktop/src/main/log-redactor.ts
export interface LogRedactor {
  /** Redact any occurrence of the secret in `line`. Returns
   *  the redacted line. Pure function. */
  redact(line: string): string;
  /** Update the active secret (e.g. on rotation). */
  setSecret(secret: string | null): void;
}

// The implementation matches a 64-char hex string OR a base64
// string of equivalent entropy; replaces the matched substring
// with `[REDACTED]` followed by the secret's length so the
// reader knows redaction happened.
```

### 4.6 Removal of `window.__KAIRO_*` globals

The new preload exposes **only** the typed
`KairoDesktopRuntimeConfig` via `contextBridge.exposeInMainWorld('kairoRuntime', …)`.
The `__KAIRO_DEFAULT_RUNTIME_URL__` global is removed. The
`runtime-connection-service.ts:117-126` browser-mode fallback
is updated to read from the same typed interface (W3 owns the
consumer change; the interface is identical in browser and
desktop modes).

---

## 5. Path matrix (§6.5)

### 5.1 The four modes (verbatim from §6.5)

| Mode | Agent | Theia backend | frontend assets |
|------|-------|---------------|-----------------|
| dev | workspace build output | workspace node entry | workspace assets |
| packaged | `process.resourcesPath` exe | packaged backend | packaged frontend |
| spaces in path | must pass | must pass | must pass |
| non-C: install | must pass | must pass | must pass |

### 5.2 PathResolver design

```ts
// apps/desktop/src/main/path-resolver.ts
//
// Single source of truth for "where is the binary /
// entrypoint / asset in this build?". Used by AgentManagedChild,
// TheiaManagedChild, and the test scaffold.

import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ResolvedPaths {
  /** Absolute path to the Go agent binary. */
  agent: string;
  /** Absolute path to the Theia backend entry. */
  theiaBackend: string;
  /** Absolute directory holding frontend assets. */
  frontend: string;
  /** Absolute path to the user data dir (for agent `--data-dir`). */
  userData: string;
}

export class PathResolver {
  /**
   * Resolve all paths for the current runtime. Pure
   * function of the current `app.getPath('exe')`,
   * `app.getAppPath()`, `process.resourcesPath`, and
   * `process.env`.
   */
  resolve(): ResolvedPaths {
    const env = process.env;
    const isPackaged = app.isPackaged;

    // -- agent --------------------------------------------------------
    let agent: string;
    if (env.KAIRO_AGENT_PATH) {
      agent = path.resolve(env.KAIRO_AGENT_PATH);
    } else if (isPackaged) {
      // Electron canonical: extraResources puts the agent at
      // <resourcesPath>/bin/kairo-runtime[.exe]
      const bin = process.platform === 'win32' ? 'kairo-runtime.exe' : 'kairo-runtime';
      agent = path.join(process.resourcesPath, 'bin', bin);
    } else {
      // Dev mode: the agent is built into
      // <repoRoot>/runtime-agent/bin/kairo-runtime[.exe] by
      // `pnpm --filter @kairo/desktop prebuild`. We resolve
      // relative to the current source file (which is in
      // apps/desktop/src/main/) and walk up.
      const bin = process.platform === 'win32' ? 'kairo-runtime.exe' : 'kairo-runtime';
      const candidates = [
        path.resolve(__dirname, '..', '..', '..', '..', 'runtime-agent', 'bin', bin),
        path.resolve(__dirname, '..', '..', '..', '..', '..', 'runtime-agent', 'bin', bin),
      ];
      const found = candidates.find(c => fs.existsSync(c));
      if (!found) {
        throw new Error(
          `Kairo agent binary not found. Tried:\n  ${candidates.join('\n  ')}\n` +
          `Build it with: pnpm --filter @kairo/desktop build (which runs go build)`
        );
      }
      agent = found;
    }

    // -- theia backend ------------------------------------------------
    // In dev: <appPath>/lib/backend/main.js (created by
    //          scripts/copy-browser-artifacts.js from
    //          apps/browser/lib/backend/)
    // In packaged: <appPath>/lib/backend/main.js (bundled
    //          via the `files` rule in package.json)
    const theiaBackend = path.join(app.getAppPath(), 'lib', 'backend', 'main.js');
    if (!fs.existsSync(theiaBackend)) {
      throw new Error(
        `Theia backend entry not found at ${theiaBackend}. ` +
        `Run 'pnpm --filter @kairo/desktop copy:browser' to copy the browser artifacts.`
      );
    }

    // -- frontend -----------------------------------------------------
    // In dev: <appPath>/lib/frontend/
    // In packaged: <appPath>/lib/frontend/ (bundled)
    const frontend = path.join(app.getAppPath(), 'lib', 'frontend');

    // -- user data ----------------------------------------------------
    const userData = path.join(app.getPath('userData'), 'kairo-data');

    return { agent, theiaBackend, frontend, userData };
  }
}
```

### 5.3 Why this design satisfies §6.5

| Mode | Agent | Theia | Frontend | Notes |
|------|-------|-------|----------|-------|
| dev | `__dirname`-relative walk to `runtime-agent/bin/` (no env required) | `app.getAppPath()/lib/backend/main.js` (created by `copy:browser`) | `app.getAppPath()/lib/frontend/` | no `process.resourcesPath` dependency |
| packaged | `process.resourcesPath/bin/kairo-runtime[.exe]` | `app.getAppPath()/lib/backend/main.js` (bundled) | `app.getAppPath()/lib/frontend/` (bundled) | works with the `files` rule in `package.json:36-44` |
| spaces in path | all `path.join` calls produce correctly-escaped paths; Windows `spawn` accepts spaced paths | same | same | covered by §6.7 path-snapshot test |
| non-C: install | same code path; no `C:` assumption | same | same | covered by `app.getPath('userData')` resolution on non-C: drives |

### 5.4 Test strategy

A snapshot test under `apps/desktop/test/path-resolver.test.ts`:

```ts
test('path matrix: dev / packaged / spaces / non-C: all four paths resolve and exist on disk', () => {
  // Run the test once per mode; the mode is selected by env
  // KAIRO_PATH_TEST_MODE = 'dev' | 'packaged' | 'spaces' | 'non-c'
  // The CI matrix runs all four.
});
```

The four CI jobs:

1. `path-test-dev`: `KAIRO_PATH_TEST_MODE=dev`; `agent` resolves
   to `runtime-agent/bin/...`; `theia` resolves to
   `app.getAppPath()/lib/backend/main.js` after `copy:browser`.
2. `path-test-packaged`: `KAIRO_PATH_TEST_MODE=packaged`;
   `agent` resolves to `process.resourcesPath/bin/...`; same
   theia path.
3. `path-test-spaces`: install Kairo to a path containing
   `Program Files (x86)\Kairo IDE\test spaces\`; assert all
   paths resolve and the agent can be spawned.
4. `path-test-non-c`: install to `D:\kairo-ide-install` (or
   whatever the test runner's non-C drive is); assert same.

Jobs 3 and 4 are slow (full install / uninstall cycle) and run
in the nightly job, not PR.

---

## 6. Lifecycle (§6.6)

### 6.1 Mapping of §6.6 requirements to events

| §6.6 requirement | Event hook | Owner |
|------------------|------------|-------|
| single instance lock | `app.requestSingleInstanceLock()` (already correct) | existing |
| second instance focuses | `app.on('second-instance', …)` (already correct) | existing |
| `before-quit` runs once | supervisor ref-counts `stop()` calls; `before-quit` calls `supervisor.shutdown()` which calls `stop()` on each child with a 5s deadline | W2 (new) |
| window close vs app quit | `window-all-closed` → `app.quit()`; `before-quit` stops children; `activate` recreates window only if `supervisor.state() !== 'failed'` | existing + W2 tweak |
| Agent self-restart | supervisor's `agentReady` listener watches for `pid !== oldPid`; updates internal reference atomically | W2 (resolves B6) |
| Agent unexpected crash | supervisor transitions to `crashed`, schedules backoff | W2 (resolves M9) |
| Theia crash | same as Agent | W2 (resolves M10) |
| Electron main crash → orphan cleanup | a watchdog sibling process (Windows Job Object) is overkill for Phase 1; documented in §6.3 as a Phase 6 follow-up. Phase 1 relies on `before-quit` + `process.on('exit')` SIGKILL on the children directly tracked. | Phase 1 best-effort; Phase 6 hardened |
| Windows shutdown / logoff | `app.on('session-end')` + `app.on('quit')` both call `supervisor.shutdown()`; on Windows, `before-quit` is the official hook and runs for logoff | W2 (resolves M12) |
| Update / uninstall before-quit | `app.on('quit', …)` is a no-op for now; future installer hook | deferred |

### 6.2 Supervisor lifecycle in the main process

```text
app.requestSingleInstanceLock() → if not got, app.quit()
  app.on('second-instance', focus existing window)
  app.on('ready', async () => {
    paths = pathResolver.resolve()
    secretSession = new SecretSession(randomBytes(32).toString('hex'))
    supervisor = new ChildSupervisor({ signal: appQuitSignal })
    supervisor.register(new AgentManagedChild({ config: { ... }, env: { KAIRO_LOCAL_SECRET: secretSession.secret } }))
    supervisor.register(new TheiaManagedChild({ config: { ... } }))

    const { agent: agentInfo, theia: theiaInfo } = await supervisor.startAll()
    preloadConfig = buildPreloadConfig(agentInfo, theiaInfo, secretSession)
    mainWindow = createMainWindow(preloadConfig)
  })
  app.on('before-quit', () => {
    supervisor.shutdown({ deadlineMs: 5_000 })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(preloadConfig)
    }
  })
  process.on('exit', () => {
    // Best-effort SIGKILL on the tracked children. The real
    // cleanup is in before-quit; this is a safety net for
    // hard crashes (Electron main SIGKILLed externally).
    supervisor.killAllSync()
  })
```

The `shutdown` call is `await`ed; `before-quit` accepts the
await. On Windows, `before-quit` runs synchronously for logoff
and uninstaller events, so the supervisor's `shutdown` must
respect an `AbortSignal` to short-circuit the wait if Electron
forces the main process to exit.

### 6.3 Second-instance argv forwarding

The current `second-instance` handler does not forward the
new instance's argv. Phase 1 design:

```ts
app.on('second-instance', (_event, argv, _cwd) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  // If the second instance was launched with a project file
  // arg, forward it to the active project service.
  if (argv.length > 1 && mainWindow) {
    mainWindow.webContents.send('open-from-cli', argv.slice(1));
  }
});
```

This is a small change; W4 owns the consumer in
`ActiveProjectService`.

---

## 7. Test plan (§6.7 — 11 categories)

### 7.1 The 11 categories and which test file exercises each

| §6.7 category | Test file | Notes |
|---------------|-----------|-------|
| fake child: ready | `apps/desktop/test/child-supervisor.test.ts` | happy path |
| fake child: timeout | same | `startupDeadlineMs: 50`, fake child never emits ready |
| fake child: error-before-spawn | same | fake child's `start()` throws `SpawnError` |
| fake child: exit-during-start | same | fake child emits `exit` before `ready` |
| concurrent restart only produces one new process | same | supervisor serialisation |
| stop during start | same | start() then stop() before ready |
| stop deadline → kill | same | fake child ignores SIGTERM, supervisor sends SIGKILL after deadline |
| shutdown no auto-respawn | same | call `shutdown()` then simulate exit, assert no `start()` call |
| 5 crashes → failed | same | simulate 5 quick crashes, assert `state() === 'failed'` |
| packaged path snapshot | `apps/desktop/test/path-resolver.test.ts` | see §5.4 |
| config not enumerable global | `apps/desktop/test/preload-contract.test.ts` | assert `Object.keys(window).filter(k => k.startsWith('__KAIRO_'))` is empty in renderer; W3 contributes the renderer-side probe |
| log redaction | `apps/desktop/test/log-redactor.test.ts` | assert secret in stdout is replaced with `[REDACTED]` in the ring buffer |
| real dev smoke | `scripts/dev-smoke-windows.ps1` (new) | `pnpm start` → `/api/v1/health` 200 from real Electron |
| real installed smoke | `scripts/installed-smoke-windows.ps1` (new) | NSIS install → cold start → readiness → restart → quit → no orphans. W1 owns this; W2 contributes the supervisor + helper. |

### 7.2 Test runner

`apps/desktop/package.json` will add:

```json
{
  "scripts": {
    "test:desktop": "node --test --import tsx 'src/**/*.test.ts'"
  }
}
```

`tsx` is already a transitive dep of the workspace; if not,
Phase 1 adds it. `node --test` is the runner (no Jest / Mocha
dependency added).

### 7.3 FakeManagedChild sketch

```ts
// apps/desktop/src/main/fake-child.ts
export interface FakeChildOptions {
  /** Mocked ready line. If undefined, never becomes ready. */
  readyAfterMs?: number;
  /** Mocked exit code emitted at startup. */
  exitBeforeReadyWith?: { code: number; atMs: number };
  /** Mocked crash after becoming ready. */
  crashAfterReadyWith?: { code: number; atMs: number };
  /** Mocked hang on SIGTERM. */
  ignoreSigterm?: boolean;
  /** In-memory log lines to inject. */
  logLines?: { stream: 'stdout' | 'stderr'; line: string; atMs: number }[];
}

export class FakeManagedChild implements ManagedChild {
  // Implements the full interface. The supervisor doesn't
  // know it's a fake; tests can swap implementations freely.
}
```

### 7.4 The "5 crashes → failed" test (worked example)

```ts
test('5 consecutive crashes within 60s → state = failed', async () => {
  const clock = new FakeClock();
  const fake = new FakeManagedChild({
    exitBeforeReadyWith: { code: 1, atMs: 0 },
  });
  const supervisor = new ChildSupervisor({ clock, startupDeadlineMs: 1, backoff: { baseMs: 1, maxMs: 1, failWindowMs: 60_000, failThreshold: 5 } });
  supervisor.register(fake);

  await supervisor.startAll().catch(() => { /* expected */ });

  for (let i = 0; i < 5; i++) {
    clock.advance(1);
    await fake.simulateCrash({ code: 1 });
    await clock.flushTimers();
  }

  assert.strictEqual(supervisor.stateOf('agent'), 'failed');
});
```

The `FakeClock` is the only test-only injection. The supervisor
uses `setTimeout` / `setInterval` indirectly through the clock,
so tests are deterministic.

---

## 8. Cross-cutting: what the preload contract freezes

The interface in §4.2 is the **only** thing Phase 1 publishes
to the rest of the workspace. W3 will need:

- `KairoDesktopRuntimeConfig`
- `RuntimeSnapshot`
- `ChildSnapshot`

W4 will need `ChildSnapshot.state` to render a connection
status banner.

W5 does not need anything from this contract (JDT LS is owned
by the Theia backend, not the desktop main).

If W3 / W4 need fields the design above does not include, the
right path is:

1. W2 + W3 agree on the additional field in a side-channel
2. W2 updates this document
3. W3 opens a CR if the field requires a backend change
4. Phase 1 implementation picks up the field

No silent additions.

---

## 9. Out-of-scope (explicit)

The following are **not** in this design and will be deferred
or owned by other agents:

- Two-runtime-config / dual client (forbidden by §7.1, W3 owns)
- Event sourcing for child state (only `EventEmitter` is used)
- WebSocket reconnect / jitter in the supervisor
  (the supervisor does not own the WS connection; W3 owns that
  in `RuntimeConnectionService`)
- JDT LS lifecycle (W5 owns; the supervisor does not know
  about it; Theia backend spawns it)
- Tomcat lifecycle (the Agent owns it; the supervisor only
  knows "agent ready / not ready")
- Installer / auto-update hooks (Phase 6 / out of scope per
  §1.13)
- Cross-window secret sharing (single secret per Electron
  main; second windows, if ever created, read from the same
  preload instance)
- Process tree cleanup beyond the directly-tracked children
  (Phase 6 follow-up; see audit §5.1)

---

## 10. Re-run rule (W6 cron)

W6 re-runs this design doc review before Phase 1 Gate. Any
change in `apps/desktop/src/main.ts` (the current monolithic
file) invalidates the implementation; the **interface** in §2.1
is stable across the refactor.
