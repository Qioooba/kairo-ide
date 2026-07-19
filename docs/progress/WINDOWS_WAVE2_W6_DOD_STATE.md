# W6 — DoD State (real-time)

> **Owner**: Agent W6 (Integration & Evidence Lead)
> **Branch**: `feature/windows-wave2-product-vertical-slice`
> **Started**: Phase 0 (audit + skeleton; no product code)
> **Source of truth for honesty markers**:
> - Per-criterion acceptance: `docs/WINDOWS_WAVE2_DOD.md`
> - File ownership rule: `docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md` §3
> - Final-report template: same task doc §16

This file is W6's live status ledger. It records:

1. What the Gate currently believes (pending / partial / done / blocked).
2. The exact command, exit code, or evidence backing every claim.
3. What W6 will NOT mark verified without an independent re-run.

W6 does NOT touch the checkboxes in `WINDOWS_WAVE2_DOD.md` itself during
Phase 0 — Phase 0 deliverables are infrastructure only. DoD toggles
become legal only at Phase Gate sign-off, when a Phase X Status Report
exists and W6 has independently re-run the worker-reported commands.

---

## 0. Phase 0 Gate (no product code)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 0.1 | `feature/windows-wave1-readiness` pushed to origin | **pending** | Awaiting W1 confirmation; W6 will `git ls-remote` to confirm. |
| 0.2 | Wave 2 branch based on `1ea3cf9` | **done** | `git log main..HEAD` shows HEAD = `c0c7491` on `feature/windows-wave2-product-vertical-slice`; first parent is `1ea3cf9` (= `feature/windows-wave1-readiness`). |
| 0.3 | Mac-claimed files unmodified (Phase 0 audit) | **done** | `git diff --stat main...HEAD` shows 4 files, all under `docs/`. See `WINDOWS_WAVE2_W6_FILE_OWNERSHIP_AUDIT.md`. |
| 0.4 | `scripts/check-env-fresh.ps1` exits 0 | **pending** | Owned by W1; W6 will re-run before Phase 0 Gate. |
| 0.5 | `pnpm install --frozen-lockfile` exits 0 | **pending** | W1 build step. W6 will re-run with `--frozen-lockfile` after W1 reports. |
| 0.6 | `pnpm build` lists real packages/apps | **pending** | W1 build step. W6 will re-run, parse output, and confirm at least one `apps/*` and `packages/*` are listed (not just a filter glob). |
| 0.7 | `pnpm test` exits 0 | **pending** | W1. W6 will re-run, capture exit code + elapsed. |
| 0.8 | `pnpm test:agent` exits 0 (Windows locking tests skip-allowed) | **pending** | W1. W6 will re-run, capture exit code, list skip reasons. |
| 0.9 | `pnpm --filter @kairo/desktop build:win` produces `Kairo-IDE-*.exe` | **pending** | W1. W6 will independently re-run and verify the produced file with `Get-Item` + `Get-FileHash`. |
| 0.10 | NSIS package SHA-256 captured | **pending** | W1 owns; W6 re-derives SHA-256 and matches against the manifest. |
| 0.11 | NSIS installed silently | **pending** | W1. W6 will independently observe install via `Get-Item "$env:LOCALAPPDATA\Programs\Kairo\*"` or equivalent. |
| 0.12 | Installed `.exe` cold-starts, PIDs captured | **pending** | W1. W6 will re-launch from installed path, not source path, and capture PIDs. |
| 0.13 | `GET /api/v1/health` 200 from installed Agent | **pending** | W1. W6 will re-issue the call, NOT trust the worker log. |
| 0.14 | `GET /api/v1/endpoints` returns dynamic host:port | **pending** | W1. W6 re-runs. |
| 0.15 | Theia backend serves from installed path | **pending** | W1. W6 re-runs. |
| 0.16 | Renderer request with `X-Kairo-Secret` → 200 | **pending** | W1. W6 re-runs; will NOT accept "secret exists in log" as evidence. |
| 0.17 | Renderer request without secret → 401 | **pending** | W1. W6 re-runs. |
| 0.18 | `POST /api/v1/runtime/restart` triggers new Agent PID | **pending** | W1. W6 will diff `old PID != new PID` and re-read `/api/v1/endpoints`. |
| 0.19 | App quit leaves no orphan Agent / Theia / JDT / Tomcat | **pending** | W1. W6 will re-check via `Get-Process` after `--quit` and assert zero hits. |
| 0.20 | No un-redacted secret in evidence | **pending** | W6 will grep evidence bundle for secret patterns and either confirm clean or block Phase 0 sign-off. |
| 0.21 | `WINDOWS_WAVE2_FINAL_REPORT.md` exists with 22 sections | **partial** | Skeleton written by W6; placeholders per §16, no fabricated content. See `WINDOWS_WAVE2_FINAL_REPORT.md`. |

> **Honest marker**: 0.1, 0.4–0.20 are **pending**. Only 0.2, 0.3, 0.21 are at any
> progress level, and 0.21 is **partial** (skeleton only). No "done" exists for
> Phase 0 because Phase 0 has not been actually executed yet.

---

## 1. Phase 1 Gate (Desktop Host reliability)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 1.1 | Electron main owns Agent + Theia (process tree) | **pending** | Phase 1 not started. |
| 1.2 | No production fallback to 3000 / 18099 | **pending** | Phase 1. |
| 1.3 | No `executeJavaScript` config injection | **pending** | Phase 1. |
| 1.4 | secret absent from cmdline / log / storage / global | **pending** | Phase 1. |
| 1.5 | ChildSupervisor unit tests pass | **pending** | Phase 1. |
| 1.6 | Single-instance behaviour verified | **pending** | Phase 1. |

---

## 2. Phase 2 Gate (Runtime Contract)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 2.1 | Single `RuntimeGateway` consumed by all UI | **pending** | Phase 2. |
| 2.2 | Widget / Store have no direct `fetch` | **pending** | Phase 2. |
| 2.3 | EndpointMap re-discovered after restart | **pending** | Phase 2. |
| 2.4 | HTTP timeout / AbortSignal / typed error covered | **pending** | Phase 2. |
| 2.5 | WS auth / reconnect / jitter covered | **pending** | Phase 2. |
| 2.6 | Build / Server snapshot recovery after reconnect | **pending** | Phase 2. |

---

## 3. Phase 3 Gate (Product UI)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 3.1 | Import Wizard persists via real service call | **pending** | Phase 3. |
| 3.2 | ActiveProjectService is the only project context | **pending** | Phase 3. |
| 3.3 | Multi-project selector works (no `projects[0]`) | **pending** | Phase 3. |
| 3.4 | BuildStore from snapshot + events | **pending** | Phase 3. |
| 3.5 | Deploy UI from snapshot + events | **pending** | Phase 3. |
| 3.6 | ServerStore Restart is real stop/start, not just Stop | **pending** | Phase 3. |
| 3.7 | StatusBar reads Store, no independent polling | **pending** | Phase 3. |
| 3.8 | Old `innerHTML` log / build / server views replaced | **pending** | Phase 3. |
| 3.9 | Bounded log memory + DOM | **pending** | Phase 3. |
| 3.10 | loading / empty / error / disabled states visible | **pending** | Phase 3. |
| 3.11 | All key controls have `data-testid` and keyboard | **pending** | Phase 3. |

---

## 4. Phase 4 Gate (JDT LS)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 4.1 | JDT LS launched by Theia backend (PID tree) | **pending** | Phase 4. |
| 4.2 | Distribution SHA-256 verified | **pending** | Phase 4. |
| 4.3 | No full `os.Environ()` leak to browser | **pending** | Phase 4. |
| 4.4 | completion works on a real `.java` | **pending** | Phase 4. |
| 4.5 | F12 definition works | **pending** | Phase 4. |
| 4.6 | Diagnostics add / clear | **pending** | Phase 4. |
| 4.7 | Workspace close leaves no JDT orphan | **pending** | Phase 4. |

---

## 5. Phase 5 Gate (Installed E2E)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 5.1 | Scenario A — install + import + active project | **pending** | Phase 5. |
| 5.2 | Scenario B — build + diagnostics + fix | **pending** | Phase 5. |
| 5.3 | Scenario C — deploy + Tomcat start/restart/stop | **pending** | Phase 5. |
| 5.4 | Scenario D — GBK round-trip byte-verified | **pending** | Phase 5. |
| 5.5 | Scenario E — completion + definition + diagnostics | **pending** | Phase 5. |
| 5.6 | Scenario F — restart, kill, crash, second instance, orphan, non-C, paths w/ spaces / 中文 | **pending** | Phase 5. |

---

## 6. Engineering Quality (cross-Phase)

| # | Criterion | State | Evidence / next action |
|---|-----------|-------|------------------------|
| 6.1 | `git diff --check` clean | **pending** | W6 re-runs before each Phase Gate. |
| 6.2 | `pnpm install --frozen-lockfile` clean | **pending** | W6 re-runs. |
| 6.3 | `pnpm build` clean | **pending** | W6 re-runs. |
| 6.4 | `pnpm test` clean | **pending** | W6 re-runs. |
| 6.5 | `pnpm lint` clean | **pending** | W6 re-runs. |
| 6.6 | `pnpm test:agent` clean | **pending** | W6 re-runs. |
| 6.7 | `pnpm --filter @kairo/desktop build:win` clean | **pending** | W6 re-runs. |
| 6.8 | `scripts/verify-e2e.ps1` exits 0 | **pending** | W6 audits for §5.2 anti-patterns before re-running. |
| 6.9 | No un-explained `skip` | **pending** | W6 grep-asserts. |
| 6.10 | Mac-claimed files unmodified | **done (Phase 0); pending re-check at each Phase Gate** | W6 re-runs `git diff --stat main...HEAD` at every Gate. |
| 6.11 | No un-redacted secret in evidence | **pending** | W6 greps. |
| 6.12 | `WINDOWS_WAVE2_FINAL_REPORT.md` 22 sections | **partial** | Skeleton written; body filled only at Phase 6. |

---

## 7. Honesty rules (binding on W6)

The following four phrasings are **forbidden** in any final-report
text W6 endorses (per task doc §16):

- "代码看起来已经就绪"
- "理论上可以运行"
- "Worker说通过"
- "脚本已经写好所以算完成"

The following four phrasings are the **only** allowed status claims:

- "命令 X 在环境 Y 的退出码为 0"
- "安装版 PID / HTTP / UI 行为证据为……"
- "此项未执行，因此状态仍为 partial"
- "此项因明确原因 blocked，复现为……"

If any of the forbidden four appear in a worker report, W6 will
return the report for rewrite before re-running.

---

## 8. Cron tick log

W6 maintains a cron tick every 30 minutes during Phase 0. Each tick:

1. Pulls latest worker progress from the parent session.
2. Re-runs `git diff --stat main...HEAD` and the file-ownership
   audit (zero Mac-claimed-file changes).
3. Updates this file's `State` column.
4. Re-emits "Phase 0 Gate still N items short" summary at the
   bottom.

Tick history (append-only):

| Tick (UTC+8) | Phase 0 done count | Mac-claimed touches | Notes |
|--------------|--------------------|---------------------|-------|
| 2026-07-19 init | 0 / 21 (0.3 done, 0.21 partial, 0.2 done) | 0 | Branch clean, skeleton written, W6 awaiting W1. |
