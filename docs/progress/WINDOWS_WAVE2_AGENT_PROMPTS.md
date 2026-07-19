# Windows Wave 2 — Agent prompts (W1–W6)

> Each Agent below runs as a hidden branch session of Mavis
> (`general` agent, `run_in_background=true`). The orchestrator
> (this root session) freezes the contract, dispatches the
> prompts, and only advances Phase when the Gate is green.
>
> The shared contract is the Wave 2 task doc:
> `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md`

## File-ownership matrix (binding for all Agents)

### Windows MAY edit

```
apps/desktop/**
apps/browser/**
packages/runtime-extension/**
packages/project-extension/**
packages/build-extension/**
packages/tomcat-extension/**
packages/java-extension/**
packages/theia-product/**
packages/protocol/**              # Contract Agent only
packages/ui-kit/**                # only for real UI changes
runtime-agent/internal/api/**
runtime-agent/internal/bootstrap/**
runtime-agent/internal/transport/**
runtime-agent/internal/app/jdtls_descriptor.go
runtime-agent/internal/jdtls/**
runtime-agent/cmd/**
scripts/*.ps1
.github/workflows/**
apps/desktop/test/**              # new
packages/*/src/**/*.test.*        # new
test/e2e/windows/**               # new
docs/progress/WINDOWS_WAVE2_*.md
```

### Windows MUST NOT edit

```
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

If a Windows E2E surfaces a Mac-claimed file bug, file a
contract request in `docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md`.

---

## W1 — Release Qualification (Phase 0 lead, Phase 5 lead)

Prompt:

```text
You are Agent W1 (Release Qualification) for Kairo IDE
Windows Wave 2. Work in `G:\spaces\kairo-ide` on branch
`feature/windows-wave2-product-vertical-slice`. Read
`docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §5 first
and obey every force-principle in §1.

Your scope (Windows may edit):
  apps/desktop/**, scripts/**, docs/progress/WINDOWS_WAVE2_*.md,
  test/e2e/windows/** (new), and the limited `runtime-agent`
  adapter files.

You are the Phase 0 lead. Execute §5.1–§5.6 in order:

1. Save environment evidence to artifacts/windows-wave2/environment.txt
   (use scripts/check-env-fresh.ps1; do NOT echo secrets).
2. Audit scripts/verify-e2e.ps1 for the anti-patterns in §5.2.
   If it is hollow, rewrite it so that every step actually
   asserts the required behavior (readiness, PID, HTTP, etc).
3. Clean build: pnpm install --frozen-lockfile; pnpm build;
   pnpm test; pnpm test:agent; pnpm --filter @kairo/desktop
   build:win. Record every command, exit code, and elapsed
   time. Save to artifacts/windows-wave2/commands/.
4. Capture the produced NSIS .exe absolute path, byte count,
   and SHA-256. Save to artifacts/windows-wave2/package/.
5. Install the NSIS silently and launch the installed .exe
   (NOT the source). Capture Electron PID, Theia PID, Agent
   PID, listening ports, screenshot, startup elapsed. Save to
   artifacts/windows-wave2/process-snapshots/.
6. Auth round-trip:
     GET  /api/v1/health (no secret)  -> 200
     GET  protected no secret         -> 401
     GET  protected wrong secret      -> 401
     GET  protected correct secret    -> 200
     WebSocket no subprotocol         -> rejected
     WebSocket valid subprotocol      -> connected
     POST /api/v1/runtime/restart     -> 200
   Then confirm the new Agent PID differs from the old one and
   the new endpoints map is reachable.
7. Clean shutdown: verify no Agent / Theia / JDT / Tomcat
   process survives.
8. Write artifacts/windows-wave2/manifest.json + manifest.md
   indexing every artifact.
9. Commit per §2.3 — one commit per topic. Do not push.

Forbidden: skip, swallow exceptions, mock the E2E, or accept
"scripts exist therefore it works" reasoning. If anything
fails, fix it and re-run; only after the Phase 0 Gate is fully
green should you signal completion.

Required deliverables before reporting back:
  - artifacts/windows-wave2/manifest.md
  - artifacts/windows-wave2/environment.txt
  - artifacts/windows-wave2/package/SHA256SUMS.txt
  - All exit codes (commands/manifest)
  - PID timeline (process-snapshots/)
  - Honest partial/blocked markers (no fake green)
```

---

## W2 — Desktop Host (Phase 1 lead)

Prompt:

```text
You are Agent W2 (Desktop Host) for Kairo IDE Windows Wave 2.
Work in `G:\spaces\kairo-ide` on branch
`feature/windows-wave2-product-vertical-slice`. Read
`docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §6 first.

Your scope: apps/desktop/**, runtime-agent/cmd/**, and the
adapter slices in runtime-agent/internal/api/** and
runtime-agent/internal/transport/** — only the parts that
move readiness, restart, secret and packaged-path.

You lead Phase 1. After Phase 0 Gate is green, execute §6.2–
§6.7:

1. Introduce `ChildSupervisor` (TS, in apps/desktop/src/main)
   per §6.2 — ChildState machine, ManagedChild interface,
   serialised restart, bounded logs, crash backoff, no
   throws in event callbacks.
2. Replace any direct child_process.spawn in the desktop
   shell with supervisor instances. Single owner: Electron
   main.
3. Per §6.3, replace fixed-port assumptions with bind-to-0
   + readiness file/stdout-message. Reject TCP-only readiness.
4. Per §6.4, generate per-session secret with crypto RNG,
   pass only via env to Agent, expose minimal
   KairoDesktopRuntimeConfig through preload. Remove every
   `window.__KAIRO_CONFIG__` and similar enumerable global.
5. Per §6.5, fix path resolution to use
   `app.getAppPath()` / `process.resourcesPath` only.
6. Per §6.6, cover single-instance, second-instance focus,
   before-quit, window-close vs app-quit semantics,
   Agent/Theia crash, app crash orphan cleanup, shutdown
   signals.
7. Write tests under apps/desktop/test/ that exercise the
   supervisor with a fake child (ready / timeout /
   error-before-spawn / exit-during-start / concurrent
   restart / stop-during-start / deadline-kill / 5x crash
   / packaged-path snapshot / log redaction / dev smoke).
8. One commit per topic per §2.3. Do not push.

Forbidden: renderer-side child_process, fixed 3000/18099
fallback, executeJavaScript config injection, secrets in
cmdline/logs/localStorage.

Required deliverables:
  - ChildSupervisor implementation + tests
  - Updated main.ts / preload.ts
  - Snapshot test for packaged vs dev paths
  - Honest status report
```

---

## W3 — Runtime Contract (Phase 2 lead)

Prompt:

```text
You are Agent W3 (Runtime Contract) for Kairo IDE Windows
Wave 2. Work in `G:\spaces\kairo-ide` on branch
`feature/windows-wave2-product-vertical-slice`. Read
`docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §7.

Your scope: packages/runtime-extension/**, packages/protocol/**
(only as the single owner), runtime-agent/internal/api/**
adapter (no business logic), runtime-agent/internal/transport/**.

You lead Phase 2. After Phase 1 Gate is green:

1. Per §7.1, define and export a single `RuntimeGateway`
   interface. Remove every parallel fetch wrapper,
   `KairoRuntimeImpl` second truth, and ad-hoc EventStream
   copy.
2. Per §7.2, implement `EndpointMap` that fetches
   /api/v1/endpoints once, validates schema, freezes a
   snapshot, re-discovers on Agent restart, and emits a
   single connection event. No fallback to 18099.
3. Per §7.3, normalise HTTP behaviour: X-Kairo-Secret,
   request ID, JSON content type, typed error, timeout,
   AbortSignal, 401 triggers connection invalidation (not
   infinite retry), 409 conflict, 422 validation, 5xx
   preserves request ID, runtime response-schema check, no
   secret in logs.
4. Per §7.4, normalise WS: subprotocol auth, connected/
   reconnecting states, heartbeat or idle detect,
   exponential backoff + jitter + upper bound, single
   socket + single reconnect timer, post-reconnect snapshot
   pull, no double snapshot replay, dispose cleans up
   everything.
5. Per §7.5, write contract tests using a real local
   HTTP/WS test server (no fetch mock).
6. Per §7.6, keep `runtime-agent/internal/api` as a thin
   wire adapter; do not embed Project/Build/Deploy logic.
7. One commit per topic per §2.3. Do not push.

Forbidden: any second Runtime client / EventStream;
JSON-in-handler business logic; arbitrary fetch from
widgets / stores.

Required deliverables:
  - Single RuntimeGateway used by all packages
  - Contract tests for HTTP + WS, snapshot recovery
  - Adapter thin-ness demonstrated (no business logic)
  - Honest status report
```

---

## W4 — Product UI (Phase 3 lead)

Prompt:

```text
You are Agent W4 (Product UI) for Kairo IDE Windows Wave 2.
Work in `G:\spaces\kairo-ide` on branch
`feature/windows-wave2-product-vertical-slice`. Read
`docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §8.

Your scope: packages/runtime-extension/** (consumer side),
packages/project-extension/**, packages/build-extension/**,
packages/tomcat-extension/**, packages/java-extension/**,
packages/theia-product/**, apps/browser/**, packages/ui-kit/**
(only for the real UI changes this Phase requires).

You lead Phase 3. After Phase 2 Gate is green:

1. Per §8.1, build the real Import Wizard: directory pick
   → service call → render detected build.xml / web.xml /
   source roots / web root → toolchain confirmation →
   validation errors → save → active project → store refresh.
   Save button calls a real service, disabled during save,
   preserves user input on error, cancel does not leave a
   half project, duplicate-import handled, paths with
   spaces / Chinese render, reopen restores last active
   project, stale active project is cleaned up.
2. Per §8.2, ship `ActiveProjectService` as the only project
   context (per §8.2 interface).
3. Per §8.3, build `BuildStore` from snapshot + events,
   bounded history, terminal events idempotent, cancel
   only enabled when running, error never collapses to
   empty array.
4. Per §8.4, deploy UI: build-and-deploy only after build
   succeeded, preflight/executing/succeeded/partial/failed,
   static/JSP vs class publish copy, no Class HotSwap
   claim, partial-failure affected files + recovery
   suggestion, destructive mirror delete requires
   confirmation, no editable local absolute deploy path.
5. Per §8.5, ServerStore: start/stop/restart/debug, debug
   hidden/disabled if not implemented, restart is real
   stop+start+reconcile, states stopped/starting/running/
   stopping/failed, current URL + PID (diagnostic only) +
   startedAt + lastError, one instance per project, port
   conflict surfaces actionable error, snapshot+event
   source, StatusBar reads the Store, reconnect preserves
   stale state and marks it.
6. Per §8.6, replace old `innerHTML` log/build/server
   views with ReactWidget/TreeWidget. Bounded log memory
   + DOM, no per-line full rebuild, pause-on-scroll,
   copy/clear buffer, stderr/diagnostic distinction, no
   unbounded reconnect message loop, 10k-event stress
   doesn't freeze the renderer.
7. Per §8.7, accessibility: data-testid, label/aria-label,
   keyboard focus, disabled reason, loading/empty/error
   states, destructive confirm, no colour-only state,
   100/125/150% scale, 1366×768 main action visible.
8. Per §8.8, use a real Inversify container; no
   source-regex tests; tests instantiate contributions
   end-to-end (Import success/fail/cancel, multi-project,
   active project recovery, command enablement, BuildStore
   snapshot/event/reconnect, ServerStore state machine,
   restart command, loading/empty/error render, 10k log
   event bounded memory, dispose-no-listener).
9. One commit per topic per §2.3. Do not push.

Forbidden: direct fetch, reading local files from the
renderer, hard-coded `projects[0]`, regex-on-source
proves, mocking the contribution graph.

Required deliverables:
  - Import Wizard, ActiveProjectService, BuildStore,
    Deploy UI, ServerStore, Log/Server views
  - Component tests with real container
  - Honest status report
```

---

## W5 — Java Intelligence (Phase 4 lead)

Prompt:

```text
You are Agent W5 (Java Intelligence) for Kairo IDE Windows
Wave 2. Work in `G:\spaces\kairo-ide` on branch
`feature/windows-wave2-product-vertical-slice`. Read
`docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §9.

Your scope: packages/java-extension/**,
packages/theia-product/** (backend only),
apps/browser/**, runtime-agent/internal/jdtls/** (only
security-closure / deprecation migration),
runtime-agent/internal/app/jdtls_descriptor.go.

You lead Phase 4. After Phase 3 Gate is green:

1. Per §9.1, ensure JDT LS is owned by the Theia backend,
   not by the browser. Stop the runtime agent from
   returning the full process environment to the browser;
   shrink the descriptor to an allowlist that does not
   include the agent secret.
2. Per §9.2, fix distribution integrity: pinned version,
   pinned SHA-256, download via temp + hash + atomic
   move, hash mismatch deletes temp and fails, offline
   mode shows a clear error, packaged build can pre-bundle
   the distribution (record license + size), no per-launch
   re-download, only one prepare under concurrent boot.
3. Per §9.3, launch JDT LS under host JDK 17, project
   compiler/source level per project config, isolated
   workspace data dir, Windows paths correctly quoted,
   bounded stdout/stderr, startup deadline, init failure
   terminates, workspace close / app quit terminate, crash
   restarts with a cap, no agent secret / full env leak.
4. Per §9.4, create a real `LanguageClient` and prove
   completion, definition, diagnostics on a real `.java`,
   including classpath containing the legacy sample
   dependencies, workspace/project switch updates or
   restarts the session, app close leaves no JDT orphan.
5. Per §9.5, document the Java 6 reality in the report
   (host JDK 17, project source/target as configured,
   build truth = Ant/Javac, editor intelligence =
   JDT LS best effort). Do not modify the user's
   build.xml or upgrade their project to Java 17 just to
   make completion pass.
6. Per §9.6, write distribution hash, concurrent prepare,
   launch-args Windows snapshot, env allowlist, startup
   timeout, crash/restart, LanguageClient lifecycle,
   completion / definition / diagnostics tests, and
   shutdown-no-orphan tests.
7. One commit per topic per §2.3. Do not push.

Forbidden: DAP / JDWP, Class HotSwap, modifying Mac build
core, shipping an Environment blob to the browser.

Required deliverables:
  - Real LanguageClient wired to a real JDT LS
  - Distribution SHA verification
  - Honest Java 6 vs JDK 17 separation in the report
  - Honest status report
```

---

## W6 — Integration & Evidence Lead (Phase 6 lead)

Prompt:

```text
You are Agent W6 (Integration & Evidence Lead) for Kairo
IDE Windows Wave 2. Work in `G:\spaces\kairo-ide` on branch
`feature/windows-wave2-product-vertical-slice`. Read
`docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §11
and §12 and §16.

Your scope: docs/progress/WINDOWS_WAVE2_*.md,
.github/workflows/**, scripts/verify-e2e.ps1 (audit only,
not the rewrite), and the integration gates. You do not
edit product code; you verify it.

You lead Phase 6. Across all earlier Phases you:

1. Independently re-run the core commands from §14 and
   confirm exit codes match the worker-reported exit codes.
   Do not trust worker reports blindly.
2. Maintain `docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md`
   and reject any commit that modifies a Mac-claimed file.
3. After every Phase Gate, write a Phase X Status Report
   into docs/progress/ and update
   docs/progress/WINDOWS_WAVE2_DOD.md checkboxes.
4. Per §11.4, build artifacts/windows-wave2/ evidence
   bundle (manifest.json, commands/, logs/, screenshots/,
   process-snapshots/, test-results/, package/, environment
   — redacted).
5. Per §16, write
   docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md with the
   22 required sections, using only the four allowed
   phrasings (X exited 0 / evidence X / partial because Y
   / blocked because Z). Reject the four forbidden
   phrasings.
6. Per §12, when Mac Core is ready, drive the integration
   branch and re-run Phase 5 fully.

Forbidden: marking verified without re-run evidence;
letting "script exists" stand in for "test passed";
hiding Mac-claimed edits.

Required deliverables:
  - Phase Gate status reports
  - Final report (22 sections)
  - Evidence bundle (no secrets)
  - Honesty about partial / blocked
```
