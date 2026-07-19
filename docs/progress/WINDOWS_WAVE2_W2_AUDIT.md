# Agent W2 — Desktop Host Audit (Phase 0, read-only)

> **Owner**: Agent W2 (Desktop Host) — Windows Wave 2
> **Branch**: `feature/windows-wave2-product-vertical-slice` @ `c0c7491`
> **Reference contract**: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §6 (Phases 1.1–1.7)
> **Scope of this audit**: `apps/desktop/**`, `runtime-agent/cmd/**`,
> the readiness / secret / path-adjacent adapter slices in
> `runtime-agent/internal/api/**` and `runtime-agent/internal/transport/**`.
> **Mode**: read-only. No product code touched. No test code created.
> Two documentation files are written:
> `WINDOWS_WAVE2_W2_AUDIT.md` (this file) and `WINDOWS_WAVE2_W2_DESIGN.md`.

This audit follows W6's honesty rules: every gap is anchored to a
specific file/line, every command output is captured, and partial /
blocked is the only status used where the runtime cannot prove the
claim.

---

## 0. Method

```powershell
# 0.1 Branch state
cd G:\spaces\kairo-ide
git status --short
# (clean)
git log --oneline --decorate -3
# c0c7491 (HEAD -> feature/windows-wave2-product-vertical-slice)
# 1ea3cf9 (origin/feature/windows-wave1-readiness, feature/windows-wave1-readiness)
# c3dc8f2 (main)
git branch --show-current
# feature/windows-wave2-product-vertical-slice
```

The audit reads (no edits) the following files:

| File | Purpose | Relevant lines |
|------|---------|----------------|
| `apps/desktop/src/main.ts` | Electron main, lifecycle, spawn | 1–430 |
| `apps/desktop/src/preload.ts` | Preload bridge | 1–46 |
| `apps/desktop/lib/main.js` | Compiled main (sanity check) | — |
| `apps/desktop/lib/preload.js` | Compiled preload (sanity check) | — |
| `apps/desktop/package.json` | Build / packaging config | 1–80 |
| `apps/desktop/scripts/copy-browser-artifacts.js` | Browser backend copy | 1–110 |
| `apps/desktop/tsconfig.json` | TS config | 1–20 |
| `apps/server/src/index.ts` (read-only, cross-ref) | Server-side runtime spawn | 1–120 |
| `runtime-agent/cmd/kairo-runtime/main.go` | Agent entry | 1–100 |
| `runtime-agent/internal/config/config.go` | Agent flags | 1–250 |
| `runtime-agent/internal/api/server.go` | Agent HTTP server | 1–450 |
| `runtime-agent/internal/api/handlers.go` | Endpoints + restart handler | 1–702 |
| `packages/runtime-extension/src/browser/runtime-connection-service.ts` | Frontend consumer of preload globals | 1–160 |
| `packages/runtime-extension/src/browser/runtime.test.cjs` | Existing test pattern | 1–100 |
| `docs/hotfix-windows-test-readiness.md` | Wave-1 contract | 1–120 |
| `docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md` | N-018…N-025 legacy issue IDs | 105–130 |

`apps/desktop/test/` does not exist (verified `Get-ChildItem`).
`apps/desktop/lib/` contains only the compiled main.js / preload.js
from the previous Wave-1 build (no test artifacts).

Searches used:

- `grep "secret|SECRET|LocalSecret" apps packages` → 14 hits
- `grep "18099|3000"` → 30+ hits (most are CI/script fixtures; see §A.3)
- `grep "__KAIRO_|executeJavaScript"` → 8 hits
- `grep "localStorage|sessionStorage"` → 7 hits
- `grep "ChildSupervisor|supervisor|ManagedChild"` → no `ChildSupervisor`
  exists in TS code; only Go-side process supervisor in
  `runtime-agent/internal/proc` and one stale ADR
- `grep "crash|backoff|restart|deadline|jitter"` under
  `apps/desktop` → no production logic
- `grep "stdio|spawn\(|fork\("` under `apps/desktop` → exactly 2 spawn
  sites (agent + Theia), both inline in `main.ts`
- `grep "app\.on\(|app\.requestSingle|process\.on\("` under
  `apps/desktop/src` → 12 events; see §A.6

---

## 1. Headline numbers

| Bucket | Count |
|--------|-------|
| Total gaps identified | **32** |
| Blocker (DoD-failing or §6 hard violation) | **8** |
| Major (will not pass Phase 1 Gate without work) | **14** |
| Minor (deserves attention, not Phase-Gate-blocking) | **10** |
| `ChildSupervisor` instances in TS code today | **0** |
| `ManagedChild` interfaces in TS code today | **0** |
| Plain `window.__KAIRO_*` enumerable globals | **2** |
| Fixed-port fallbacks in production code path | **0** (already correct) |
| `executeJavaScript` config injection sites | **0** (already correct) |
| `apps/desktop/test/` directory | **missing** |

---

## 2. Process ownership — current state

### 2.1 What is in `apps/desktop/src/main.ts` today

Module-level mutable globals (lines 25–31):

```ts
let agentProcess: ChildProcess | null = null;
let agentPort: number = 0;
let agentSecret: string = '';
let theiaProcess: ChildProcess | null = null;
let theiaPort: number = 0;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
```

Two near-duplicate functions spawn the two children:

- `startAgent(dataDir: string): Promise<{port, secret}>` (lines 77–161)
- `startTheiaBackend(): Promise<number>` (lines 175–241)

Each function:

1. Calls `findFreePort()` (a TOCTOU-bounded helper at lines 33–43)
2. Calls `spawn(agentPath, ['--bind', '127.0.0.1', '--port', String(port), …])`
   with `stdio: ['ignore', 'pipe', 'pipe']`
3. Wires three listeners: `stdout`, `stderr`, `error`, `exit`
4. Polls `http.get(healthURL)` every 300/500 ms until 200 or
   15s/30s timeout

`stopAgent()` (lines 163–172) and `stopTheiaBackend()` (lines 266–275)
are also duplicates: SIGTERM, then 5-second `setTimeout` → SIGKILL.
Neither is `await`-able; neither returns a `Promise`.

The two children are wired into the app lifecycle in the `app.on('ready')`
handler (lines 351–392). On failure: `dialog.showErrorBox` →
`stopTheiaBackend()` → `stopAgent()` → `app.quit()`.

### 2.2 What is **not** in `main.ts` today

- No `ChildSupervisor` class / `ManagedChild` interface
- No `ChildState` machine
- No event stream that callers can subscribe to ("agent crashed",
  "agent backoff=2s", "supervisor failed")
- No bounded log buffer for child stdout/stderr
- No crash backoff / no `failed` state
- No restart serialisation — concurrent `start()` calls are not
  guarded and create a race
- No `requestSingleInstanceLock` + child supervision interaction
- No per-child `AbortSignal` for cancellation
- No structured readiness protocol (stdout / ready file / port
  identity)
- No PID identity check on readiness (a stale Agent on the same port
  would falsely pass readiness)

### 2.3 Restart behaviour today

- **Agent restart (runtime-level)**: `POST /api/v1/runtime/restart`
  is implemented in Go (`runtime-agent/internal/api/handlers.go:668+`,
  `server.go:319+`); it does a 3-second graceful shutdown then
  respawns itself via `os.Executable()` with `os.Args[1:]`. The
  Electron main **does not** know this happened: its
  `agentProcess` reference is the old PID. After restart, the
  Electron main is still tracking the dead PID. `stopAgent()`
  either no-ops (if Windows recycled the PID) or kills the new
  Agent (if it got the same number). The new Agent's port (which
  is the same `--port` value from the original args) is unchanged,
  so the bug is invisible **unless** `--port` was a dynamic value
  the new Agent could not honour.
- **Agent crash**: handler logs `console.error` and sets
  `agentProcess = null`. No re-spawn. No user-visible notification.
- **Theia crash**: same pattern. No recovery.
- **Desktop Host crash (Electron main dies)**: `process.on('exit')`
  sends SIGKILL to both children if they're still tracked, but
  this event is essentially useless on Windows; real cleanup
  requires synchronous work in `before-quit`.

### 2.4 Reference: how `apps/server/src/index.ts` does it

The server entry has a single `startRuntime(runtimePort)` function
(lines 71–115) with the same shape. It also pipes stdio
(`['ignore', 'inherit', 'inherit']`) and exits the whole process if
the runtime dies (`shutdown(1)`). The server does **not** spawn
Theia (it serves placeholder HTML) — that is a known limitation
documented in `REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md:268+`
("Server 返回 placeholder HTML，未托管 Theia"). Phase 1 will need
to decide whether to lift the supervisor pattern from server into
a shared module (cleaner) or duplicate the abstraction in
desktop (faster, but divergent). §A.7 in this audit covers the
trade-off.

---

## 3. Secret lifecycle — current state

### 3.1 Where the secret is generated

`apps/desktop/src/main.ts:74-76` (`generateSecret`):

```ts
function generateSecret(): string {
  return randomBytes(32).toString('hex');
}
```

`randomBytes(32)` is `crypto.randomBytes` from Node's `crypto` module
(imported on line 24). This is 256 bits of entropy, hex-encoded = 64
characters. **Satisfies §6.4.1** (cryptographic RNG, per-session).

Generation happens once at `app.on('ready')` time, inside
`startAgent` (line 79). It is **not** rotated on Agent restart —
the same `agentSecret` is passed to the respawned Agent's env on
each `restart()`. This is consistent with §6.4.7 ("同一 Desktop
session可沿用，完整 app restart必须轮换") but the policy is
**implicit**; there is no comment in `main.ts` stating it. **Gap
M6.**

### 3.2 Where the secret is transmitted

Two paths, both via `env`:

1. `main.ts:91-95` — passed to **Agent** as `KAIRO_LOCAL_SECRET` in
   the spawn `env`. Agent reads it in
   `runtime-agent/internal/config/config.go:154-156`
   (`os.Getenv("KAIRO_LOCAL_SECRET")`) and stores it in
   `cfg.Secret` for middleware to compare via
   `subtle.ConstantTimeCompare` (`handlers.go:580`). **Satisfies
   §6.4.2 / §6.4.3** (env-only, not in CLI args).
2. `main.ts:198-199` — passed to **Theia backend** as
   `KAIRO_AGENT_SECRET` so the backend can connect to the Agent
   with the correct `X-Kairo-Secret` header. The Theia backend
   then re-exposes the secret via `preload.ts`.

### 3.3 Secret exposure surface (grep summary)

| Site | Surface | Verdict |
|------|---------|---------|
| `main.ts:79-80` | local variable `secret` | OK — function-scoped |
| `main.ts:94` | `env.KAIRO_LOCAL_SECRET` | OK — passed to Agent, never logged |
| `main.ts:158` | module-level `agentSecret` | OK — main process only |
| `main.ts:199` | `env.KAIRO_AGENT_SECRET` | OK — passed to Theia backend, not logged |
| `main.ts:296-297` | `process.env.KAIRO_AGENT_URL` / `KAIRO_AGENT_SECRET` | **OK in main, but the secret is now in the main-process env where preload can read it** |
| `preload.ts:21` | `process.env.KAIRO_AGENT_SECRET` | **loaded from env, used immediately** |
| `preload.ts:24-29` | `contextBridge.exposeInMainWorld('kairoConfig', { agentUrl, agentSecret, … })` | **VIOLATION — see §3.4** |
| `preload.ts:45` | `contextBridge.exposeInMainWorld('__KAIRO_DEFAULT_RUNTIME_URL__', agentUrl)` | **OK** (only URL, not secret) but **enumerable global anti-pattern** |
| `runtime-connection-service.ts:120-122` | reads `(window as any).kairoConfig` and forwards `agentSecret` into the `KairoRuntimeConfig` | down-stream |
| `runtime-connection-service.ts:125-126` | reads `globalThis.__KAIRO_DEFAULT_RUNTIME_URL__` | down-stream |
| `main.ts:329` | comment: "No executeJavaScript — avoids the race condition" | OK — confirms no `executeJavaScript` |
| `main.ts:82` | `console.log('[kairo] Starting agent: ${agentPath} --port ${port}')` | OK — secret is not in this log |
| `main.ts:184` | `console.log('[kairo] Starting Theia backend: ${theiaEntry} on port ${port}')` | OK — secret is not in this log |
| `main.ts:159` | `console.log('[kairo] Agent healthy on port ${port}')` | OK |
| `runtime-connection-service.ts:309-312` | `headers['X-Kairo-Secret'] = secret` | OK — over `X-Kairo-Secret` header (matches `handlers.go:580`) |
| `active-project-service.ts:47-48,77-78` | `localStorage.getItem/setItem(LAST_PROJECT_KEY, projectId)` | OK — only `projectId`, not the secret |
| `runtime.test.cjs:335-345` | test uses `agentSecret: 'secret-token'` | OK — test fixture only |

### 3.4 The plain-object secret exposure — **Blocker**

`apps/desktop/src/preload.ts:24-29`:

```ts
contextBridge.exposeInMainWorld('kairoConfig', {
    agentUrl,
    agentSecret,
    platform: process.platform,
    appVersion: process.env.KAIRO_APP_VERSION || '0.1.0',
});
```

This violates §6.4.5 directly:

> preload只暴露最小的受控 RuntimeConfig API

The current shape exposes the **raw secret string** as a property
on a plain object. Any code in the renderer can read
`window.kairoConfig.agentSecret` (e.g.
`runtime-connection-service.ts:120-122` does exactly this and
forwards it into `KairoRuntimeConfig.agentSecret`, which then
gets serialised through the runtime error listener and is in
principle reachable from any Theia widget that logs the config).

The task doc explicitly anticipates this and offers a fix in
§6.4.5:

> 如果安全评审认为直接返回 secret范围过大，改为 preload 代理
> fetch/WS token握手。不要把 secret放在 `window.__KAIRO_CONFIG__`
> 普通对象上。

Plus the Wave 2 prompt:

> Remove every `window.__KAIRO_CONFIG__` and similar enumerable
> global.

The companion `__KAIRO_DEFAULT_RUNTIME_URL__` global
(`preload.ts:45`) is not strictly a secret leak, but it is the
"similar enumerable global" the prompt calls out.

`RuntimeConnectionService` currently uses both: `kairoConfig` for
the desktop path, `__KAIRO_DEFAULT_RUNTIME_URL__` for the browser
fallback (`runtime-connection-service.ts:117-126`). The fix needs
to preserve the browser path while cleaning up the desktop path.

### 3.5 Crash dump / diagnostic bundle

- No crash dump is written today. Electron will produce a `.dmp`
  on hard crashes (default behaviour on Windows) into
  `app.getPath('crashDumps')`. Nothing in `main.ts` redacts these.
- No diagnostic bundle is produced. The `electron-builder` config
  does not set `crashReporter`; `app.setName('Kairo IDE')` is
  never called. **No policy, no risk today, but no future-proofing
  either.** **Gap M13.**

### 3.6 DevTools

- `webPreferences.devTools` is not set. Default is `true`. **Gap
  M14.**

---

## 4. Path resolution — current state

### 4.1 Agent binary (`resolveAgentPath`, `main.ts:55-72`)

```ts
function resolveAgentPath(): string {
  if (process.env.KAIRO_AGENT_PATH) {
    return process.env.KAIRO_AGENT_PATH;
  }
  const resourcesDir = process.resourcesPath;
  if (!resourcesDir) {
    throw new Error('process.resourcesPath is not set. …');
  }
  const binaryName = process.platform === 'win32' ? 'kairo-runtime.exe' : 'kairo-runtime';
  return path.join(resourcesDir, 'bin', binaryName);
}
```

`process.resourcesPath` is the **Electron canonical** way to resolve
the `extraResources` directory in a packaged build. The
`electron-builder` config in `package.json:46-50` places the Agent
binary at `resources/bin/kairo-runtime[.exe]`. **Satisfies §6.5
for the Agent.**

**Caveats** (not blockers, but worth noting):

- The `KAIRO_AGENT_PATH` env override is **unchecked**: any string
  passes through to `spawn`. If the user sets it to a non-existent
  path, `spawn` raises `ENOENT` from the `'error'` event. The
  current code does **not** `await` or re-throw; it logs and lets
  the health-check promise reject. Acceptable but the error
  message could be clearer.
- `process.resourcesPath` is `undefined` in plain `node` mode (not
  Electron). The current code does not run in plain `node` mode
  (main is loaded by Electron), so this is fine.

### 4.2 Theia backend entry (`main.ts:178-182`)

```ts
const theiaEntry = path.join(__dirname, 'backend', 'main.js');
```

`__dirname` is `apps/desktop/lib/` (the compiled output). The
`copy-browser-artifacts.js` script (`apps/desktop/scripts/copy-browser-artifacts.js`)
copies `apps/browser/lib/backend/` into `apps/desktop/lib/backend/`
during `prebuild` and `prestart`. The `package.json files` rule
includes `lib/backend/**/*`. **Satisfies §6.5 for the Theia
backend in both dev and packaged modes.**

**Caveats**:

- The script does `fs.copyFileSync` (not atomic on Windows; a power
  loss mid-copy produces a half-written bundle). The `electron-builder`
  package step will then include a broken `main.js`. **Gap m7 / M5.**
- The script does not verify the destination `lib/backend/` is
  writeable, or that the source `apps/browser/lib/backend/` is
  newer than the destination (no `mtime` check). This is a build
  ergonomics problem, not a runtime safety one, but it does mean
  stale dev builds can be packaged by accident.
- `app.getAppPath()` is **not** used. `__dirname` works in dev and
  packaged for `lib/backend/main.js`, but the choice is implicit.
  Switching to `app.getAppPath()` would be more explicit. **Gap
  M7.**

### 4.3 Path matrix coverage (current state)

| Mode | Agent | Theia backend | Frontend assets | Notes |
|------|-------|---------------|-----------------|-------|
| dev (`pnpm start`) | `process.resourcesPath` (undefined in dev!) — falls through to throw | `__dirname/backend/main.js` (works if `copy:browser` was run) | `lib/frontend/**` (works if `copy:browser` was run) | **dev Agent path is BROKEN** — see below |
| packaged (NSIS) | `process.resourcesPath/bin/kairo-runtime.exe` | `lib/backend/main.js` (copied into `app.asar`) | `lib/frontend/**` | works |
| Path with spaces | unverified (no test) | unverified (no test) | unverified (no test) | Gap M8 |
| Non-C: install | unverified (no test) | unverified (no test) | unverified (no test) | Gap M8 |

**The dev Agent path is broken**: `process.resourcesPath` is
`undefined` in `pnpm start` mode (Electron only sets it for
packaged builds). Today, the only way to run the desktop
`pnpm start` flow is to set `KAIRO_AGENT_PATH` manually. The
existing `dev.ps1` (`scripts/dev.ps1`) does **not** set this env,
so the desktop `pnpm start` flow is currently non-functional
without a manual workaround. **Blocker B8-light / part of B7.**

### 4.4 Path matrix — what is required by §6.5

§6.5 requires a 4×3 matrix of "must pass":

- dev / packaged / spaces / non-C for Agent, Theia, frontend.

Today:

- dev: works for Theia (with `copy:browser`), broken for Agent
- packaged: works for all
- spaces: not tested
- non-C: not tested

A snapshot test under `apps/desktop/test/` (currently missing) is
the natural way to lock this in.

---

## 5. Restart / crash / shutdown handling

### 5.1 Current behaviour matrix

| Event | Current behaviour | §6.6 expected | Gap |
|-------|-------------------|---------------|-----|
| Cold start | `app.on('ready')` → `startAgent` → `startTheiaBackend` → `createWindow` | same | OK |
| App quit (menu) | `before-quit` → `isQuitting = true` → fire-and-forget SIGTERM, 5s later SIGKILL | graceful first, hard deadline | **M5** (5s setTimeout not awaited) |
| App quit (Cmd+Q) | same as menu | same | M5 |
| Window close | `closed` event clears `mainWindow`; `window-all-closed` quits on non-darwin | distinguishable from app quit | OK |
| `activate` (mac) | recreate window (but no agent/theia) | recreate window only if children still healthy | **m2** |
| Second instance | `requestSingleInstanceLock` → existing window focused | same | OK |
| Agent crash | log, set `agentProcess = null`, no re-spawn | supervisor notices, bounded backoff, eventually `failed` | **B4, M9** |
| Theia crash | log, set `theiaProcess = null`, no re-spawn | supervisor notices, user-visible error, restart policy | **M9, M10** |
| Agent restart via `/api/v1/runtime/restart` | respawn happens inside Agent, Electron main does not update `agentProcess` | supervisor notices PID change, updates `agentProcess`, re-runs readiness | **B6** |
| Theia backend restart | no path today | same as Agent | M10 |
| App crash (Electron main dies) | `process.on('exit')` sends SIGKILL to tracked children | full process tree cleaned up; on Windows, use `before-quit` | **M11** |
| Windows shutdown / logoff | unhandled | `app.on('session-end')` / `WM_QUERYENDSESSION` | **M12** |
| Update / uninstall before-quit | unhandled | `app.on('quit')` for installer hooks | M12 |
| `render-process-gone` | unhandled | show error / restart window | **m3** |
| `child-process-gone` | unhandled | same as Agent/Theia crash | **m4** |

### 5.2 Concrete code issues (with line numbers)

- `main.ts:163-172` — `stopAgent()` is synchronous, fires SIGTERM,
  and the 5s timeout is unguarded. If `before-quit` is called
  twice, two SIGKILL timers run. If `app.quit()` returns before
  the SIGKILL fires, the child survives the parent.
- `main.ts:266-275` — same shape, same issues, for Theia.
- `main.ts:111-115` — `agentProcess.on('exit', …)` only logs;
  the readiness promise is left pending (it is actually rejected
  earlier by the `!agentProcess` check, so this is OK in practice,
  but if the Agent exits **after** readiness succeeded — e.g.
  runtime restart — there is no `onExit` subscriber on the
  success side).
- `main.ts:215-219` — same for Theia.
- `main.ts:413-421` — `process.on('exit')` handler does SIGKILL
  on `agentProcess` and `theiaProcess`. This is **not** a
  reliable cleanup path on Windows (the `exit` event is best
  effort). The proper Windows pattern is to do all work in
  `before-quit`, which runs synchronously and is the
  installer/uninstaller hook point.
- `main.ts:394-398` — `before-quit` does fire-and-forget
  `stopTheiaBackend()` and `stopAgent()`. The 5s SIGKILL timer
  may not fire if the main process exits.
- `main.ts:400-404` — `window-all-closed` calls `app.quit()`
  unconditionally on non-darwin. This is fine for the DoD but
  means a user cannot keep the Agent running after closing the
  window. (Phase 1 may want to make this configurable; not a
  blocker.)

### 5.3 Theia backend is started with `process.execPath`

`main.ts:186`:

```ts
theiaProcess = spawn(process.execPath, [theiaEntry], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', THEIA_PORT: String(port), KAIRO_AGENT_URL: ..., KAIRO_AGENT_SECRET: ... }
});
```

`process.execPath` in packaged Electron is the Electron binary
itself; the `ELECTRON_RUN_AS_NODE=1` env makes it act as plain
Node. In dev (`pnpm start`), `process.execPath` is also the
Electron binary under `node_modules/.bin/electron`, so the same
env trick works. **OK** in principle, but fragile:

- The `lib/backend/main.js` must be CommonJS (since Electron-as-Node
  uses `require`). Verified — the Browser backend is CJS
  (browser/package.json:6, `@theia/electron` backend).
- Any code in the Browser backend that touches `electron` globals
  will crash. Currently none, but it's an implicit contract.

---

## 6. Readiness protocol — current state

### 6.1 What readiness looks like today

`main.ts:117-160` (Agent) and `main.ts:202-240` (Theia):

1. Spawn child
2. Wait 0–300/500ms
3. `http.get(healthURL)` with 2s/3s per-request timeout
4. If 200, resolve
5. If non-200 or error, retry until 15s/30s elapsed
6. Reject with `Error('Agent health check timed out…')`

The URL is `http://127.0.0.1:${port}/api/v1/health` for the Agent
and `http://127.0.0.1:${port}/` for Theia.

### 6.2 What readiness should look like (per §6.3)

Per §6.3:

> readiness 不能只检查 TCP connect，应验证:
> - Agent health 响应包含产品 identity/version
> - Theia 页面返回预期入口
> - readiness 来自本次启动 PID，而不是旧进程

Today:

- **Agent health identity**: not checked. The handler returns
  `{ok: true, payload: {ok: true, version: "0.1.0", agentVersion:
  "0.1.0"}}` (`runtime-agent/internal/api/health.go:13+`), but
  `main.ts` only checks `res.statusCode === 200`. **Gap M1.**
- **Theia entry check**: `GET /` returns the Theia HTML, but the
  check only asserts 200. Could be any 200 server. **Gap M8.**
- **PID identity check**: none. A stale Agent still listening on
  the same port would falsely pass readiness. **Gap M2.**

### 6.3 Bind-to-0 vs fixed port

The Electron main process picks a free port with
`net.createServer().listen(0)` (`main.ts:33-43`) and passes it to
the Agent as `--port`. The Agent's own `bind` is `127.0.0.1:port`
(so the Agent does **not** bind to 0 itself). This is a small
TOCTOU window (the port is released by `findFreePort` before the
Agent binds it), but in practice on a single-user desktop the
window is microseconds wide. **Acceptable** but **not ideal**;
§6.3 says:

> 不要先选择"看起来空闲"的端口再长时间等待，因为存在 TOCTOU。
> 优先让子进程绑定 `127.0.0.1:0` 并通过受控 channel/ready file/
> stdout structured message 返回实际端口。

This is a real gap; the chosen readiness protocol is the
single largest design decision for Phase 1. The
`WINDOWS_WAVE2_W2_DESIGN.md` document covers the three options
and the recommendation.

---

## 7. Single-instance & window close — current state

### 7.1 Single-instance lock

`main.ts:340-343`:

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { … });
```

**Satisfies §6.6 single-instance + second-instance focus.**

The `second-instance` handler restores and focuses the existing
window. **However**:

- It does **not** forward the second instance's command-line argv
  (e.g. to open a project file passed as a CLI arg). **Minor
  gap** (`m6` in the list).
- It does **not** handle the case where the existing window was
  destroyed but the app is still running (e.g. the user closed
  the window on macOS, kept the app running, then a second
  instance fires). `mainWindow` is `null`, the `if (mainWindow)`
  guard short-circuits, and the second instance dies silently.
  **Minor gap** (`m2`).

### 7.2 Window close vs app quit

`main.ts:400-404`:

```ts
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

On Windows, closing the main window quits the app. This is the
right default for the DoD. On macOS, the app keeps running
(standard Cocoa behaviour). No need to change.

### 7.3 before-quit semantics

`main.ts:394-398`:

```ts
app.on('before-quit', () => {
  isQuitting = true;
  stopTheiaBackend();
  stopAgent();
});
```

`stop*` is fire-and-forget; the 5s SIGKILL timer is started but
not awaited. **Gap M5** (see §5.2).

---

## 8. Gap catalogue — ordered by severity

Severity rules (consistent with W6 ledger §0 / N-018..N-025):

- **Blocker**: §6 explicitly forbids it, or DoD checkbox is
  not achievable.
- **Major**: will not pass Phase 1 Gate without work; flagged by
  §6 or §6.7.
- **Minor**: not Phase-Gate-blocking; worth a fix in Phase 1
  where convenient.

### 8.1 Blockers (8)

| # | Anchor | §6 ref | What | Why blocker |
|---|--------|--------|------|-------------|
| **B1** | `preload.ts:24-29` | §6.4.5 | `contextBridge.exposeInMainWorld('kairoConfig', { agentUrl, agentSecret, … })` exposes the raw secret string in a plain object | §6.4.5 explicitly forbids plain-object secret exposure; downstream `runtime-connection-service.ts:120-122` reads it and forwards it to any error listener that serialises the config |
| **B2** | `preload.ts:45` | §6.4.5 / Wave 2 prompt | `contextBridge.exposeInMainWorld('__KAIRO_DEFAULT_RUNTIME_URL__', agentUrl)` is an "enumerable global" the Wave 2 prompt calls out for removal | DoD Phase 1 §6.1 checkbox is "no `executeJavaScript`" — satisfied — but the Wave 2 prompt goes further and forbids the enumerable-global shape itself |
| **B3** | `apps/desktop/src/main.ts` (whole) | §6.2 | No `ChildSupervisor` class, no `ManagedChild` interface, no `ChildState` machine | Phase 1 deliverable per the Wave 2 prompt is "Introduce `ChildSupervisor` (TS, in apps/desktop/src/main) per §6.2"; DoD 1.5 requires "ChildSupervisor unit tests pass" — impossible without the class |
| **B4** | `main.ts:111-115, 215-219` | §6.2.10, §6.2.11 | No crash backoff, no `failed` state, no "5次连续crash进入failed" logic | §6.2.10/11 mandate; DoD 1.5 requires unit tests for "5x crash" — impossible without the state machine |
| **B5** | `main.ts:163-172, 266-275, 394-398, 413-421` | §6.6 | `stopAgent` / `stopTheiaBackend` are fire-and-forget; the 5s SIGKILL timer is unguarded; `before-quit` does not await the deadline; `process.on('exit')` cleanup is unreliable on Windows | If `app.quit()` returns before the 5s timer fires, the child survives the parent. §6.6 requires deterministic teardown |
| **B6** | `main.ts:111-115` (re: `/api/v1/runtime/restart`) | §6.6 | When the Agent self-restarts via `POST /api/v1/runtime/restart`, the Electron main does not update its `agentProcess` reference; the new PID is never tracked | Subsequent `stopAgent()` either no-ops (if Windows recycled the PID) or kills the new process. The Electron main has no way to know the Agent restarted |
| **B7** | `apps/desktop/test/` (missing) | §6.7 | `apps/desktop/test/` does not exist; no fake child infrastructure, no supervisor unit tests | §6.7 lists 11 mandatory test categories; DoD 1.5 requires unit tests to pass; cannot satisfy |
| **B8** | `main.ts:33-43, 55-72` (dev) | §6.5 | Dev-mode Agent path uses `process.resourcesPath`, which is `undefined` outside a packaged build — desktop `pnpm start` is non-functional without manually setting `KAIRO_AGENT_PATH` | §6.5 row 1 ("dev: workspace build output") is not satisfied; the test matrix cannot be built |

### 8.2 Major (14)

| # | Anchor | §6 ref | What | Why major |
|---|--------|--------|------|-----------|
| M1 | `main.ts:120-126` | §6.3 | Readiness only checks HTTP 200; does not parse `/api/v1/health` body for `version` / `agentVersion` | §6.3 requires product identity in readiness response |
| M2 | `main.ts:120-126, 202-225` | §6.3 | No PID identity check — a stale Agent on the same port falsely passes readiness | §6.3 explicit |
| M3 | `main.ts:101-108, 191-198` | §6.2.3 | No bounded log buffer for child stdout/stderr; pipe is forwarded to parent stdout with no size cap | §6.2.3 explicit |
| M4 | `main.ts:77-161, 175-241` | §6.2.8 | No restart serialisation — concurrent `start()` calls create a race | §6.2.8 explicit |
| M5 | `main.ts:77-241` | §6.2.6 | `startAgent` and `startTheiaBackend` are near-duplicates; the supervisor abstraction will end up duplicating unless unified | maintainability |
| M6 | `main.ts:79, 158` | §6.4.7 | Restart policy for the secret is implicit; the `runtime/restart` endpoint does not rotate the secret but this is not stated in code | §6.4.7 requires an explicit policy |
| M7 | `main.ts:178-182` | §6.5 | `path.join(__dirname, 'backend', 'main.js')` works but is implicit; `app.getAppPath()` would be more explicit | §6.5 says "All paths must be resolved from `app.getAppPath()`, `process.resourcesPath` or explicit configuration" |
| M8 | `main.ts:202-225` | §6.5 | Theia backend readiness only checks `GET /` → 200; the HTML response carries no product identity | §6.3 + §6.5 |
| M9 | `main.ts:111-115` | §6.6 | Agent crash: log + null-out the reference; no re-spawn, no user notification, no `failed` state | §6.6 / §6.2.10 |
| M10 | `main.ts:215-219` | §6.6 | Theia crash: same as M9 | §6.6 |
| M11 | `main.ts:413-421` | §6.6 | `process.on('exit')` SIGKILL is unreliable on Windows; the proper hook is `before-quit` (synchronous, runs for installer / logoff) | §6.6 |
| M12 | (no code today) | §6.6 | No handling of `WM_QUERYENDSESSION`, `app.on('session-end')`, `app.on('quit')` for installer | §6.6 / §6 DoD "Windows关机/注销信号" |
| M13 | (no code today) | §6.4.10 | No crash-dump redaction policy; no diagnostic bundle | §6.4.10 |
| M14 | `main.ts:303-313` | §6.4.9 | `webPreferences.devTools` is not set; default is `true`; renderer DevTools are open in production | §6.4.9 "DevTools默认生产关闭" |

### 8.3 Minor (10)

| # | Anchor | What | Note |
|---|--------|------|------|
| m1 | `main.ts:33-43` | `findFreePort` has no retry / no error context if `listen` fails | not exercised in practice |
| m2 | `main.ts:406-409` | `app.on('activate')` doesn't check if children are still alive before recreating the window | macOS only |
| m3 | (no code) | No `render-process-gone` handler | renderer crash currently leaves a blank window |
| m4 | (no code) | No `child-process-gone` handler | related to M9 / M10 |
| m5 | `main.ts:74-76` | `generateSecret()` is inline; no `secretRotatedAt` timestamp, no policy object | cleanliness |
| m6 | `main.ts:343-349` | `second-instance` doesn't forward argv; doesn't handle the case where the existing window is closed but the app is still running | not Phase 1 blocking |
| m7 | `scripts/copy-browser-artifacts.js:75` | `fs.copyFileSync` is not atomic on Windows; mid-copy power loss can leave a broken bundle | build hygiene |
| m8 | `main.ts:82-88` | Agent `--port` is fixed; the Agent does not `bind-to-0` itself | §6.3 prefers bind-to-0; accepted in the design but worth flagging |
| m9 | (no flag today) | No `--stdio-structured-messages` or `--ready-file` flag on the Agent | would require a small Agent contract change; see `WINDOWS_WAVE2_W2_DESIGN.md` §3 |
| m10 | (no code) | No structured event stream from supervisor to UI (e.g. "agent restarting, backoff=2s") | observability |

---

## 9. Cross-cutting observations

### 9.1 Two stale issue IDs still in flight

- **N-018** (`docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md:122`):
  "Desktop main config mismatch" — the Wave-1 hotfix renamed
  `__KAIRO_CONFIG__` to `kairoConfig`, but the **plain-object
  shape** is what B1 is about. This audit is a continuation of
  N-018's fix, not a new problem.
- **N-022** (`docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md:126`):
  "Desktop child error handler `throw err`" — the Wave-1 hotfix
  already changed `throw err` to `console.error` (line 105 of
  current `main.ts`). **Closed.** No action.

### 9.2 Two open follow-ups worth flagging to W3 (Runtime Contract)

These are **not** W2's scope but are visible from the audit and
will be needed for the Phase 2 Gate:

- The `preload.ts:24-29` `kairoConfig.agentSecret` is read by
  `runtime-connection-service.ts:120-122` and forwarded into
  `KairoRuntimeConfig.agentSecret`. The proposed Phase 1
  preload contract (`KairoDesktopRuntimeConfig` with
  `requestSecret()` method) must be paired with a W3-side
  consumer change. **W3 needs to know before W2 freezes the
  contract.**
- The agent's `/api/v1/health` response shape will be read by
  the new supervisor for identity. W3 owns the response shape;
  W2's supervisor will assert `version === agentVersion`. The
  fields are already present (`runtime-agent/internal/api/health.go`),
  so this is a pure consumer change. No contract change.

### 9.3 Two open follow-ups worth flagging to W6 (Integration Lead)

- The path-matrix snapshot test (M8) is the kind of test that
  fits naturally into the W6 re-run bundle. Recommend W6 owns
  the test script (`scripts/verify-packaged-paths.ps1`) and
  W2 contributes the supervisor helper. Not blocking Phase 0.
- The crash-dump redaction policy (M13) has a long tail:
  Electron crash-dump redaction is non-trivial. Recommend
  deferring to Phase 6 (CI/Evidence), where W6 owns the
  evidence-bundle redaction anyway.

### 9.4 What is already correct (preserved during the refactor)

These are **not** gaps; they are anchors W2 will not regress:

- `app.requestSingleInstanceLock()` (§6.6 single-instance)
- `app.on('second-instance')` focus (§6.6)
- No `executeJavaScript` (§6.1)
- `contextIsolation: true`, `nodeIntegration: false`
  (`preload.ts` via `main.ts:309-313`)
- `crypto.randomBytes(32).toString('hex')` for the secret
  (`main.ts:74-76`) — 256-bit entropy
- `subtle.ConstantTimeCompare` on the Agent side
  (`runtime-agent/internal/api/handlers.go:580`)
- `X-Kairo-Secret` header (not `Authorization: Bearer`) —
  verified in `runtime-connection-service.ts:307-312` and
  the Agent's middleware
- WS auth via subprotocol token (`kairo-secret-v1`) — matches
  the Wave-1 contract `docs/hotfix-windows-test-readiness.md §1.2`
- No production fallback to fixed `3000` / `18099` in the
  desktop main (the only `18099` / `3000` references in the
  desktop path are in the `preload.ts:20` fallback string,
  which is **not** reachable in packaged builds because the
  env is set, but is **reachable** in dev — see B2 and the
  design doc's §3 for handling)

---

## 10. Phase 1 size estimate (sanity check)

The W2 design doc covers the supervisor + preload contract
proposal. Based on the 32 gaps:

- 8 blockers, average ~0.5–1 person-day each
- 14 majors, average ~0.25–0.5 person-day each
- 10 minors, average ~0.1 person-day each

**Total estimated Phase 1 effort: 9–13 person-days** of W2
implementation work, plus:

- ~1.5 person-days for the W3 preload-contract consumer change
  (downstream of W2's `KairoDesktopRuntimeConfig` interface)
- ~0.5 person-days for the test scaffold (`apps/desktop/test/`
  layout, fake-child helper, test runner config)

**Recommended Phase 1 sequencing**:

1. Freeze the preload contract with W3 (1 day)
2. Implement `ChildSupervisor` (Agent first, then Theia)
3. Wire supervisor into `main.ts` (replacing the two ad-hoc
   functions)
4. Update `preload.ts` to expose the new typed
   `KairoDesktopRuntimeConfig` and remove the plain-object
   `kairoConfig` and the `__KAIRO_DEFAULT_RUNTIME_URL__` global
5. Update `runtime-connection-service.ts` to consume the new
   contract
6. Write the 11 §6.7 test categories
7. Add packaged-path snapshot test
8. Independent re-run by W6; Phase 1 Gate

The design document at
`docs/progress/WINDOWS_WAVE2_W2_DESIGN.md` is the deliverable
for steps 1–2 of this sequencing (contract + supervisor shape);
implementation is for Phase 1.

---

## 11. What this audit did **not** cover (explicit non-scope)

- `apps/browser/src/index.ts` browser-mode config injection
  (read-only cross-ref; not in W2 scope)
- `apps/server/src/index.ts` server-mode supervisor
  (read-only cross-ref; not in W2 scope)
- `runtime-agent/internal/proc` Go-side process supervisor
  (different abstraction; managed by W3 if any change needed)
- `packages/runtime-extension/**` runtime client (W3 scope; W2
  only flagged the consumer change needed for B1)
- Theia product bindings (`packages/theia-product/**`)
- JDT LS launch / distribution (W5 scope)

---

## 12. Re-run rule (W6 cron)

W6 re-runs this audit before Phase 1 Gate. Any change in
`apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts`, or
`apps/desktop/package.json` invalidates the §2 / §3 / §4 / §6
sections; the gap catalogue (§8) must be re-derived from
current code, not from this document.
