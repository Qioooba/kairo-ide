# Windows Wave 2 — Definition of Done (working checklist)

> This file tracks per-criterion completion as the Wave 2
> work-stream progresses. Cross-references
> `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §15.

## Branch / baseline

- [ ] `feature/windows-wave1-readiness` pushed to origin
- [ ] `feature/windows-wave2-product-vertical-slice` based on
      `1ea3cf9` (Wave 1 + task doc)
- [ ] Mac-claimed files unmodified on this branch
      (verified by `git diff --stat main...HEAD`)

## Phase 0 — Real NSIS seal

- [ ] `scripts/check-env-fresh.ps1` exits 0
- [ ] `pnpm install --frozen-lockfile` exits 0
- [ ] `pnpm build` (root) lists packages and apps in output
- [ ] `pnpm test` exits 0
- [ ] `pnpm test:agent` exits 0 (with repository Windows skip)
- [ ] `pnpm --filter @kairo/desktop build:win` produces
      `Kairo-IDE-*.exe`
- [ ] NSIS package SHA-256 captured
- [ ] NSIS installed silently
- [ ] Installed `.exe` cold-starts (PIDs captured)
- [ ] Agent `GET /api/v1/health` returns 200 from installed path
- [ ] Agent `GET /api/v1/endpoints` returns dynamic host:port
- [ ] Theia backend serves from installed path
- [ ] Renderer request with `X-Kairo-Secret` returns 200
- [ ] Renderer request without secret returns 401
- [ ] `POST /api/v1/runtime/restart` triggers new Agent PID
- [ ] `app --quit` leaves no orphan Agent / Theia / JDT / Tomcat

## Phase 1 — Desktop Host

- [ ] Electron main owns Agent + Theia (verified by process tree)
- [ ] No production fallback to 3000 / 18099
- [ ] No `executeJavaScript` config injection
- [ ] secret absent from cmdline / log / storage / global
- [ ] ChildSupervisor unit tests pass
- [ ] Single-instance behaviour verified

## Phase 2 — Runtime Contract

- [ ] Single `RuntimeGateway` consumed by all UI
- [ ] Widget / Store have no direct `fetch`
- [ ] EndpointMap re-discovered after restart
- [ ] HTTP timeout / AbortSignal / typed error covered
- [ ] WS auth / reconnect / jitter covered
- [ ] Build/Server snapshot recovery after reconnect

## Phase 3 — Product UI

- [ ] Import Wizard persists project via real service call
- [ ] ActiveProjectService is the only project context
- [ ] Multi-project selector works (no hard-coded projects[0])
- [ ] BuildStore from snapshot + events
- [ ] Deploy UI from snapshot + events
- [ ] ServerStore Restart is real stop/start, not just Stop
- [ ] StatusBar reads Store, no independent polling
- [ ] Old `innerHTML` log / build / server views replaced
- [ ] Bounded log memory + DOM
- [ ] loading / empty / error / disabled states visible
- [ ] All key controls have `data-testid` and keyboard

## Phase 4 — JDT LS

- [ ] JDT LS launched by Theia backend (verified by PID tree)
- [ ] Distribution SHA-256 verified
- [ ] No full `os.Environ()` leak to browser
- [ ] completion works on a real `.java`
- [ ] F12 definition works
- [ ] Diagnostics add / clear
- [ ] Workspace close leaves no JDT orphan

## Phase 5 — Installed E2E

- [ ] Scenario A: install + import + active project
- [ ] Scenario B: build + diagnostics + fix
- [ ] Scenario C: deploy + Tomcat start/restart/stop
- [ ] Scenario D: GBK round-trip byte-verified
- [ ] Scenario E: completion + definition + diagnostics
- [ ] Scenario F: Agent restart, kill, crash, second instance,
                orphan cleanup, non-C drive, paths with
                spaces / Chinese

## Engineering quality

- [ ] `git diff --check` clean
- [ ] `pnpm install --frozen-lockfile` clean
- [ ] `pnpm build` clean
- [ ] `pnpm test` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test:agent` clean
- [ ] `pnpm --filter @kairo/desktop build:win` clean
- [ ] `scripts/verify-e2e.ps1` exits 0
- [ ] No un-explained `skip`
- [ ] Mac-claimed files unmodified
- [ ] No un-redacted secret in evidence
- [ ] `docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md` written
