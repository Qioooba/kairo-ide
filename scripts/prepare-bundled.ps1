# scripts/prepare-bundled.ps1 — ensure `bundled/tomcat6/` and
# `bundled/eclipse-jdt-ls/` exist before packaging.
#
# The Kairo IDE first-run flow expects the bundled/ directory
# to contain Tomcat 6.0.53 and Eclipse JDT Language Server.
# On a clean checkout these directories are empty; the runtime
# agent then tries to download them on first launch, which
# fails in offline / air-gapped environments. This script
# populates the directories from a known local location so
# that packaging (pnpm --filter @kairo/desktop build:win) and
# the resulting NSIS installer ship self-contained.
#
# Sources are taken, in order, from:
#   1. KAIRO_TOMCAT6_HOME / KAIRO_JDTLS_HOME env vars
#   2. %ProgramFiles%\Apache Software Foundation\Tomcat 6.0
#   3. E:\Apps\Tomcat6\apache-tomcat-6.0.53 (project default)
#
# If neither source exists, the script prints a clear error
# explaining how to install and exits 0 — packaging still
# succeeds, the runtime will attempt first-run download.
#
# Usage:
#   pwsh -ExecutionPolicy Bypass -File scripts/prepare-bundled.ps1
#   pwsh -ExecutionPolicy Bypass -File scripts/prepare-bundled.ps1 -Strict
#
# Exit codes:
#   0 — both directories exist (either pre-existing or just populated)
#   1 — pre-flight missing required tool
#   2 — at least one directory could not be populated and -Strict was set

[CmdletBinding()]
param(
    [switch]$Strict,
    [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "..")
}
$bundled = Join-Path $RepoRoot "bundled"
New-Item -ItemType Directory -Force -Path $bundled | Out-Null

function Resolve-SourceDir($envVar, [string[]]$fallback) {
    if ($envVar -and (Test-Path $envVar)) { return $envVar }
    foreach ($p in $fallback) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Ensure-BundledDir($name, $resolved, [string[]]$fallback) {
    $target = Join-Path $bundled $name
    if (Test-Path $target) {
        Write-Host "[bundled] $name already present at $target" -ForegroundColor Green
        return $true
    }
    if (-not $resolved) {
        $hint = "set $($envVar) or place it at one of: $($fallback -join ', ')"
        Write-Host "[bundled] WARN: $name missing — $hint" -ForegroundColor Yellow
        return $false
    }
    Write-Host "[bundled] copying $name from $resolved -> $target" -ForegroundColor Cyan
    # Use robocopy for a large directory tree; /MIR would delete
    # unrelated files in the target so /E instead.
    robocopy $resolved $target /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Host "[bundled] FAIL: robocopy exit $LASTEXITCODE copying $resolved" -ForegroundColor Red
        return $false
    }
    Write-Host "[bundled] OK: $name populated at $target" -ForegroundColor Green
    return $true
}

$tomcatSrc = Resolve-SourceDir $env:KAIRO_TOMCAT6_HOME @(
    "E:\Apps\Tomcat6\apache-tomcat-6.0.53",
    "E:\Apps\Tomcat6\Tomcat 6.0",
    "$env:ProgramFiles\Apache Software Foundation\Tomcat 6.0",
    "$env:ProgramFiles\Tomcat 6.0"
)
$tomcatOk = Ensure-BundledDir "tomcat6" $tomcatSrc @(
    "E:\Apps\Tomcat6\apache-tomcat-6.0.53",
    "$env:ProgramFiles\Apache Software Foundation\Tomcat 6.0"
)

$jdtlsSrc = Resolve-SourceDir $env:KAIRO_JDTLS_HOME @(
    "E:\Apps\eclipse-jdt-ls",
    "$env:ProgramFiles\eclipse-jdt-ls",
    "$env:LOCALAPPDATA\kairo\eclipse-jdt-ls"
)
$jdtlsOk = Ensure-BundledDir "eclipse-jdt-ls" $jdtlsSrc @(
    "E:\Apps\eclipse-jdt-ls",
    "$env:ProgramFiles\eclipse-jdt-ls"
)

if (-not $tomcatOk -or -not $jdtlsOk) {
    if ($Strict) {
        Write-Host "[bundled] -Strict set: failing" -ForegroundColor Red
        exit 2
    }
    Write-Host "[bundled] Continuing — runtime will attempt first-run download" -ForegroundColor Yellow
} else {
    Write-Host "[bundled] All bundled dependencies present" -ForegroundColor Green
}
exit 0
