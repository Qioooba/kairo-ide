# `bundled/` — off-line vendor layout

The Kairo Runtime Agent expects to find the Tomcat 6
distribution and the Eclipse JDT Language Server under
`<repo>/bundled/` so that a cold first launch on a
developer machine with no network access still works.

If `bundled/` is empty, the agent falls back to
downloading these tools at runtime. On a network with
`https://archive.apache.org/` and
`https://download.eclipse.org/` blocked or unreliable,
the fallback path fails and the user sees a hard error
("tomcat6 not available" / "jdtls distribution missing").

## Layout

```
bundled/
├── .manifest.json          (written by prepare-bundled.ps1)
├── tomcat6/
│   ├── apache-tomcat-6.0.53/
│   ├── apache-tomcat-6.0.53.tar.gz
│   ├── LICENSE
│   └── NOTICE
└── eclipse-jdt-ls/
    └── latest/
        ├── plugins/
        ├── config_linux/
        ├── config_win/
        └── config_mac/
```

## How to prepare (Windows)

```powershell
# 1. Get the Tomcat 6.0.53 tarball and verify it against
#    the Apache KEYS file (out-of-band; see BLOCKERS.md
#    B-002 for why no .sha256 is published).
$env:KAIRO_TOMCAT6_SHA256 = '<64-hex chars>'

# 2. Run the prepare script. This downloads + verifies +
#    extracts both binaries into bundled/.
pnpm exec pwsh scripts/prepare-bundled.ps1
```

The script is **idempotent**. Re-running it is a no-op
when `.manifest.json` is current. Pass `-Force` to
re-download.

## CI / release pipeline

`apps/desktop/package.json` has a `build:win` script.
The recommended chain is:

```jsonc
{
  "scripts": {
    "bundled:prepare": "pwsh scripts/prepare-bundled.ps1",
    "prebuild": "pnpm run bundled:prepare && node scripts/build-agent.js && node scripts/copy-browser-artifacts.js",
    "build:win": "tsc -p tsconfig.json && electron-builder --win"
  }
}
```

`prebuild` already runs before `build:win`, so adding
`bundled:prepare` to `prebuild` covers CI without
extra wiring.

## How to prepare (macOS / Linux)

`scripts/fetch-tomcat6.sh` already exists for the
Tomcat half. A future `scripts/prepare-bundled.sh`
should mirror the Windows script. For now, run the
Windows script via PowerShell Core (it is
PowerShell-only, no `bash`-specific syntax).

## Manual fallback (no network)

If the build machine has no network at all, copy
`bundled/` from a known-good developer machine and
check `.manifest.json` into source control (or a CI
cache). The runtime agent reads `bundled/` on every
startup; it does not need the file to be re-stamped
at build time.

## Verification

After `prepare-bundled.ps1` returns 0:

```powershell
Test-Path bundled/tomcat6/apache-tomcat-6.0.53
# True

Test-Path bundled/eclipse-jdt-ls/latest/plugins
# True

Get-Content bundled/.manifest.json | ConvertFrom-Json
# Should show a manifest with the SHA-256 you supplied.
```

The runtime agent reads `bundled/` automatically — no
further wiring is required.

## P0-15 status

The `bundled/` directory was empty in the wave-2
repository. This document and `prepare-bundled.ps1`
are the mitigation: the developer / CI now has a
one-line command to populate `bundled/` with verified
binaries before the first launch. The runtime-agent
fall-back to the network download path remains
unchanged for environments that prefer it.
