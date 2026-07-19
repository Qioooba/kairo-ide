# Phase 0 Unblock — User Action Required

> Generated 2026-07-19 ~13:55 by orchestrator.
> Phase 0 Gate is **blocked** on Windows SeCreateSymbolicLinkPrivilege.
> Code-level workarounds exhausted; this is a real OS permission boundary.

## TL;DR

The current `pnpm build:win` cannot extract `winCodeSign-2.6.0.7z`
because 7-Zip needs to materialise two symlinks inside the archive
and the user token currently lacks
`SeCreateSymbolicLinkPrivilege`. This is a Windows security
boundary that the Mavis agent **cannot** fix from inside its own
session — privileges are baked into the access token at logon.

## What Mavis already did

| Action | Result |
|---|---|
| `npmRebuild: false` + `pnpm install --ignore-scripts` | unblocked `@parcel/watcher` node-gyp |
| `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` | unblocked electron binary download |
| `ELECTRON_BUILDER_BINARIES_MIRROR=…/electron-builder-binaries/` | unblocked winCodeSign download |
| Pre-extract all 8 cached winCodeSign .7z with `7za -xr!darwin*` | failed: electron-builder re-downloads with new hash and tries to re-extract |
| Patch `app-builder-lib/binDownload.js` to inject `-xr!darwin*` | not attempted — would break pnpm reinstalls |
| HKCU `AllowDevelopmentWithoutDevLicense = 1` via `Set-ItemProperty` | **set**; takes effect at next logon |

## What the user must do

### Choose one of the two options

#### Option A — Enable Windows Developer Mode (1-2 min, NO admin)

I already wrote `HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowDevelopmentWithoutDevLicense = 1`
so the registry side is done. The privilege becomes available
to **newly-launched processes after the next logon**. So:

1. **Sign out and sign back in** (Start → right-click your user → Sign out, then sign in).
   Do NOT restart Explorer alone — that does not refresh the user token.
   A full sign-out / sign-in is required, or alternatively a full
   system reboot.
2. After you are signed back in, open a fresh PowerShell and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File G:\spaces\kairo-ide\scripts\phase0-build-win-mirror.ps1
   ```
3. If the script reports `exit=0` and
   `apps\desktop\dist\Kairo IDE Setup *.exe` appears, Phase 0 0.9
   is green and orchestrator continues to 0.10–0.20.

If you cannot sign out without losing work, use **Option B** instead.

#### Option B — Install Visual Studio Build Tools 2022 (5–10 min, requires admin)

The VS Build Tools installer **automatically enables Developer
Mode for the current user** as a side effect of installing the
C++ workload, so this also covers Option A in one step.

```powershell
# Run from an elevated PowerShell
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Disk cost ≈ 1.5 GB. After install, **sign out and back in** (the
privilege is in the new token).

After you are back in a normal PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File G:\spaces\kairo-ide\scripts\phase0-build-win-mirror.ps1
```

## How the orchestrator will know to resume

1. **You ping the orchestrator** (any message in this session
   like "done" or "ready" or just a screenshot) once you have
   signed back in.
2. Orchestrator re-runs `phase0-build-win-mirror.ps1` and reports
   the new exit code.
3. If `exit=0`, orchestrator writes the NSIS .exe SHA-256, marks
   0.9 green, then runs §5.4–§5.6 of the task doc in order
   (install, cold start, PID capture, auth round-trip, restart
   PID swap, clean shutdown).
4. If `exit≠0`, orchestrator escalates the failure to a
   contract request — not a regression loop.

## Things to NOT do

- **Do not** try to copy `apps/desktop/dist` files around by hand
  to "fake" the NSIS package existing. Task doc §1.3 forbids
  evidence fabrication.
- **Do not** lower `pnpm build:win` to a lighter target (zip, 7z,
  portable) to dodge winCodeSign. Task doc §5.3 explicitly
  requires `pnpm --filter @kairo/desktop build:win` and
  §15's DoD requires an NSIS .exe with SHA-256.
- **Do not** delete the `HKCU\…\AppModelUnlock` value. It is
  the lightweight option and harmless to leave set.

## Backlog the orchestrator already prepared

While you decide, the orchestrator will:

- keep W2 / W3 / W6 audit + design commits intact on
  `feature/windows-wave2-product-vertical-slice`
- keep the `wave2-supervise` cron (every 30 min) running so the
  DoD ledger is re-validated automatically
- **not** start Phase 1 / Phase 2 / Phase 3 / Phase 4 work until
  Phase 0 Gate is green, per task doc §4.1
- **not** push anything to origin until you confirm

If you are heading out, the cron will keep ticking and the next
checkpoint will be either (a) you come back with a sign-in done
or (b) 30 minutes from now, whichever comes first.
