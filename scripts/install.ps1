# scripts/install.ps1 — Windows-friendly pnpm install wrapper.
#
# The Kairo IDE monorepo pulls in a few native modules transitively
# (@theia/ffmpeg, native-keymap) that build via node-gyp. On a
# clean Windows box without Visual Studio Build Tools installed
# (the documented "2 vCPU / 4 GB / no admin" target environment)
# node-gyp fails and `pnpm install` exits non-zero, blocking the
# rest of the toolchain.
#
# The desktop app loads these native modules as optional features
# (keyboard layout detection, media previews). The v1 acceptance
# path does not depend on either being functional — Theia
# gracefully falls back to JavaScript equivalents at runtime.
#
# This script:
#   1. Runs `pnpm install --frozen-lockfile --ignore-scripts` by
#      default so a vanilla Windows install succeeds.
#   2. If `-RebuildNative` is passed, attempts to rebuild the
#      two native modules; failures are surfaced but non-fatal.
#
# Exit codes:
#   0 — install succeeded (native modules may or may not be built)
#   1 — install failed
#   2 — preflight missing required tool

[CmdletBinding()]
param(
    [switch]$RebuildNative,
    [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "..")
}
Push-Location $RepoRoot

# Preflight
foreach ($t in @("pnpm", "node")) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
        Write-Error "missing required tool: $t"
        exit 2
    }
}

Write-Host "[install] pnpm install --frozen-lockfile --ignore-scripts" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& pnpm install --frozen-lockfile --ignore-scripts 2>&1 | Tee-Object -FilePath "artifacts\acceptance-2026-07-19\logs\install.log" | Out-Null
$rc = $LASTEXITCODE
$sw.Stop()
Write-Host ("[install] exit={0} elapsed={1}s" -f $rc, [int]$sw.Elapsed.TotalSeconds)
if ($rc -ne 0) {
    Pop-Location
    exit 1
}

if ($RebuildNative) {
    Write-Host "[install] attempting native rebuild (node-gyp)" -ForegroundColor Cyan
    $nativePkgs = @("native-keymap", "@theia/ffmpeg")
    foreach ($pkg in $nativePkgs) {
        Write-Host "  -> $pkg"
        & pnpm rebuild $pkg 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "  $pkg rebuild failed (non-fatal — feature degrades gracefully)"
        }
    }
} else {
    Write-Host "[install] native modules NOT rebuilt (default)." -ForegroundColor Yellow
    Write-Host "          If you need keyboard layout or media preview features, run:" -ForegroundColor Yellow
    Write-Host "            .\scripts\install.ps1 -RebuildNative" -ForegroundColor Yellow
}

Pop-Location
exit 0
