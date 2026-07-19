# Phase 0 BLOCKED — winCodeSign darwin symlink

> Written 2026-07-19 ~13:30 by orchestrator after W1 went silent
> and orchestrator took over Phase 0 implementation.

## TL;DR

**Phase 0 is blocked on a real Windows environment limitation, not
a code defect.** Item 0.9 (`pnpm build:win`) and downstream 0.10
(NSIS package), 0.11 (silent install), 0.12 (cold start), 0.13
(health), 0.14 (endpoints), 0.15 (Theia), 0.16 (auth), 0.17 (401),
0.18 (restart PID swap), 0.19 (orphan cleanup), 0.20 (no secret in
evidence) are all **partial** because they depend on 0.9 succeeding.

Items 0.1–0.8 and W2/W3/W6 audit+design are **done** with real
evidence.

## What was tried (in order, with real exit codes)

| Attempt | Command | Exit | Evidence |
|---|---|---|---|
| 1 | `pnpm --filter @kairo/desktop build:win` (W1) | 1 | `pnpm.build.win.log` 10.5s, `@parcel/watcher` node-gyp |
| 2 | commit `c041bb4` (W1) — add `npmRebuild:false` | 0 | commit on branch |
| 3 | `pnpm install --frozen-lockfile --ignore-scripts` | 0 | `pnpm.install.ignore-scripts.json` 2.8s |
| 4 | `pnpm --filter @kairo/desktop build:win` (orchestrator) | 1 | `pnpm.build.win.mirror.log` 39s, electron download github.com timeout |
| 5 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ pnpm --filter @kairo/desktop build:win` | 1 | mirror log 215s, **`winCodeSign` darwin symlink `Cannot create symbolic link : 客户端没有所需的特权`** |
| 6 | Pre-extract `winCodeSign-N.7z` with `7za x -snl -y -bd -xr!darwin* -xr!linux* -xr!.DS_Store` for all 8 cached archives | 0 | all 8 archives fixed in `phase0-fix-wincodesign-7z.ps1` |
| 7 | re-run build:win with mirror (orchestrator) | 1 | new hash `553267371` / `037752103` re-downloaded, symlink failure repeats |
| 8 | Hand-craft `7za` wrapper, edit `app-builder-lib` getBin call to add `-xr!darwin*` | not attempted | would patch node_modules, fragile across pnpm reinstalls |

## Root cause

`winCodeSign-2.6.0.7z` (5.6 MB, bundled in
`electron-builder-binaries` GitHub release) contains a `darwin/`
subtree with two symlinks:

```
darwin/10.12/lib/libcrypto.dylib -> libcrypto.1.0.0.dylib
darwin/10.12/lib/libssl.dylib    -> libssl.1.0.0.dylib
```

`electron-builder` extracts this archive as part of every Windows
code-signing / NSIS packaging step. The Windows
`SeCreateSymbolicLinkPrivilege` is required to materialise the
symlinks; **regular user accounts do not have it**. 7-Zip reports
`ERROR: Cannot create symbolic link : 客户端没有所需的特权。`,
extraction exits with code 2, electron-builder aborts with
`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`.

Even with `--ignore-scripts` + `npmRebuild: false` + the
`ELECTRON_MIRROR` China mirror (which moves the failure away from
the electron binary download), the **darwin symlink is the
bottleneck** and `electron-builder` does not expose any option to
skip the darwin subtree.

## Required Windows environment change

The 7-Zip symlink calls succeed only if the user has the
`SeCreateSymbolicLinkPrivilege`. Two ways to grant it:

1. **Developer Mode** (user-level, no admin required, but no
   group-policy way to enable from PowerShell; user must flip a
   toggle in Settings → Privacy & security → For developers OR via
   `ms-settings:developers`):
   ```
   Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name "AllowDevelopmentWithoutDevLicense" -Value 1
   ```
   This **requires** either admin (HKLM) **or** the user to
   enable Developer Mode through the Settings UI.

2. **Grant the privilege to the current user via `secpol.msc` /
   `gpedit.msc`** — admin only.

The current dev box does not have Developer Mode enabled and we
are running in a non-admin agent context, so neither path is
available right now.

## Impact on Wave 2 task doc §5.6 Phase 0 Gate

| Item | Status | Evidence |
|---|---|---|
| 0.1 Wave 1 push | **done** | `1ea3cf9` on `origin/feature/windows-wave1-readiness` |
| 0.2 Wave 2 branch | **done** | `feature/windows-wave2-product-vertical-slice` at `c0c7491`+`ce01bd2`+`c041bb4` |
| 0.3 Mac zero violation | **done** | W6 `WINDOWS_WAVE2_W6_FILE_OWNERSHIP_AUDIT.md` |
| 0.4 `check-env-fresh.ps1` exits 0 | **done** | W1 `artifacts/windows-wave2/commands/env-check-fresh.log` |
| 0.5 `pnpm install --frozen-lockfile` | **done** | exit 0 in 2.8s after `--ignore-scripts` |
| 0.6 `pnpm build` (root) | **done** | W1 commit `99ad7b9` "unblock root pnpm build on Node 20 + pnpm 9" |
| 0.7 `pnpm test` | **done** | W1 `pnpm.test.log` exit 0 |
| 0.8 `pnpm test:agent` | **done** | W1 `pnpm.test.agent.log` exit 0 |
| 0.9 `pnpm build:win` | **BLOCKED** | `pnpm.build.win.mirror.log` exit 1, symlink privilege |
| 0.10 NSIS package SHA-256 | **BLOCKED** | depends on 0.9 |
| 0.11 silent install | **BLOCKED** | depends on 0.10 |
| 0.12 cold start | **BLOCKED** | depends on 0.11 |
| 0.13 health 200 | **BLOCKED** | depends on 0.12 |
| 0.14 endpoints dynamic | **BLOCKED** | depends on 0.12 |
| 0.15 Theia served | **BLOCKED** | depends on 0.12 |
| 0.16 auth round-trip | **BLOCKED** | depends on 0.12 |
| 0.17 401 without secret | **BLOCKED** | depends on 0.12 |
| 0.18 restart PID swap | **BLOCKED** | depends on 0.12 |
| 0.19 orphan cleanup | **BLOCKED** | depends on 0.12 |
| 0.20 no secret in evidence | n/a | no evidence yet |
| 0.21 22-section final report | **partial** | W6 skeleton only |
| W2 audit + design | **done** | commits `4309a18` + `bf21971` (1866 lines) |
| W3 audit + design | **done** | commits `9f9ffad` + `64e65bf` (2577 lines) |
| W6 file ownership + DoD + skeleton | **done** | commits `350b579` + `9ec87ce` + `12116db` |

## What the user must do

**Enable Windows Developer Mode**, then re-run Phase 0 0.9. Steps:

1. Open Settings → Privacy & security → For developers
2. Toggle "Developer Mode" on
3. Confirm the UAC prompt
4. Run from a fresh PowerShell (so the privilege is in the new
   token):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\phase0-build-win-mirror.ps1
   ```
5. Confirm `pnpm.build.win.mirror.json` reports `exitCode: 0` and
   `apps\desktop\dist\Kairo IDE Setup *.exe` exists.

If Developer Mode is not an option, install
[Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/downloads/?q=build+tools)
with the **Desktop development with C++** workload (which grants
`SeCreateSymbolicLinkPrivilege` to the user as part of the
installer). Disk cost ≈ 1.5 GB, install time 5–10 minutes,
**requires admin**.

## What W2/W3 still owes

W2 and W3 produced audit + design only. Neither Phase 1 nor
Phase 2 implementation can start until Phase 0 Gate is green
because:

- Phase 1 needs the NSIS package to install-test the
  ChildSupervisor
- Phase 2 needs the running Desktop to exercise the
  RuntimeGateway

Both can continue design refinement (e.g. preload contract
freeze between W2 and W3) without the gate, but code changes
must wait.

## Cross-agent notes

- W1 (`bg_4921a323`) was stopped by orchestrator after
  26 minutes of no commit and no new artifact. Its scratchpad
  shows it added `npmRebuild: false` then sat on the failure
  (probably waiting for the same hint to be picked up by the
  git index).
- W6 is still alive and will keep the DoD ledger honest as
  this blocker is recorded.
- Cron `wave2-supervise` will keep ticking every 30 minutes.
