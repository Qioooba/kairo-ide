# scripts/prepare-bundled.ps1 — ensure `bundled/tomcat6/` and
# `bundled/jdtls/` exist before packaging.
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
# Release packaging must use -Strict. It verifies Windows-specific runtime
# layout and fails closed instead of allowing first-run network fallback.
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
    [string]$RepoRoot,
    [string]$BundledRoot
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "..")
}
if (-not $BundledRoot) {
    $BundledRoot = if ($Strict) { "apps/desktop/bundled" } else { "bundled" }
}
$bundled = if ([System.IO.Path]::IsPathRooted($BundledRoot)) {
    $BundledRoot
} else {
    Join-Path $RepoRoot $BundledRoot
}
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
    if ((Test-Path $target) -and (Get-ChildItem -Force $target -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        Write-Host "[bundled] $name already present at $target" -ForegroundColor Green
        return $true
    }
    if (-not $resolved) {
        $hint = "provide the corresponding KAIRO_*_HOME variable or place it at one of: $($fallback -join ', ')"
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

function Resolve-ExtractedRoot($extractRoot, $kind) {
    if ($kind -eq "tomcat") {
        $marker = Get-ChildItem -Path $extractRoot -Recurse -File -Filter "catalina.bat" |
            Where-Object { $_.Directory.Name -eq "bin" } | Select-Object -First 1
        if ($marker) { return Split-Path -Parent $marker.Directory.FullName }
    } elseif ($kind -eq "jdtls") {
        $marker = Get-ChildItem -Path $extractRoot -Recurse -File -Filter "config.ini" |
            Where-Object { $_.Directory.Name -eq "config_win" } | Select-Object -First 1
        if ($marker) { return Split-Path -Parent $marker.Directory.FullName }
    }
    return $null
}

function Get-VerifiedArchiveSource($lockId, $kind, $temporaryRoot) {
    $archive = Join-Path $temporaryRoot "$lockId.archive"
    $extractRoot = Join-Path $temporaryRoot "$lockId-extracted"
    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

    & node (Join-Path $RepoRoot "scripts/run-with-timeout.cjs") 45 node `
        (Join-Path $RepoRoot "scripts/fetch-verified-archive.cjs") --id $lockId --output $archive | Out-Host
    if ($LASTEXITCODE -ne 0) { return $null }

    & node (Join-Path $RepoRoot "scripts/run-with-timeout.cjs") 60 tar -xf $archive -C $extractRoot | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[bundled] FAIL: could not extract verified archive for $lockId" -ForegroundColor Red
        return $null
    }
    $resolved = Resolve-ExtractedRoot $extractRoot $kind
    if (-not $resolved) {
        Write-Host "[bundled] FAIL: archive for $lockId has no recognized $kind root" -ForegroundColor Red
        return $null
    }
    return $resolved
}

$temporaryRoot = $null
try {
if ($Strict) {
    foreach ($lockId in @("tomcat6-windows", "jdtls-windows")) {
        & node (Join-Path $RepoRoot "scripts/run-with-timeout.cjs") 30 node `
            (Join-Path $RepoRoot "scripts/fetch-verified-archive.cjs") --id $lockId --check-config
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[bundled] Missing verified Windows archive configuration for $lockId" -ForegroundColor Red
            exit 2
        }
    }
}

$tomcatSrc = Resolve-SourceDir $env:KAIRO_TOMCAT6_HOME @(
    "E:\Apps\Tomcat6\apache-tomcat-6.0.53",
    "E:\Apps\Tomcat6\Tomcat 6.0",
    "$env:ProgramFiles\Apache Software Foundation\Tomcat 6.0",
    "$env:ProgramFiles\Tomcat 6.0"
)
if ($Strict) {
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "kairo-bundled-$PID-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null
    $tomcatSrc = Get-VerifiedArchiveSource "tomcat6-windows" "tomcat" $temporaryRoot
    Remove-Item -Path (Join-Path $bundled "tomcat6") -Recurse -Force -ErrorAction SilentlyContinue
}
$tomcatOk = Ensure-BundledDir "tomcat6/apache-tomcat-6.0.53" $tomcatSrc @(
    "E:\Apps\Tomcat6\apache-tomcat-6.0.53",
    "$env:ProgramFiles\Apache Software Foundation\Tomcat 6.0"
)

$jdtlsSrc = Resolve-SourceDir $env:KAIRO_JDTLS_HOME @(
    "E:\Apps\eclipse-jdt-ls",
    "$env:ProgramFiles\eclipse-jdt-ls",
    "$env:LOCALAPPDATA\kairo\eclipse-jdt-ls"
)
if ($Strict) {
    $jdtlsSrc = Get-VerifiedArchiveSource "jdtls-windows" "jdtls" $temporaryRoot
    Remove-Item -Path (Join-Path $bundled "jdtls") -Recurse -Force -ErrorAction SilentlyContinue
}
$jdtlsOk = Ensure-BundledDir "jdtls" $jdtlsSrc @(
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

if ($Strict) {
    & node (Join-Path $RepoRoot "scripts/run-with-timeout.cjs") 30 node `
        (Join-Path $RepoRoot "scripts/verify-bundled-dependencies.cjs") --platform win32 --bundled-root $bundled
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[bundled] Windows structure/version/license verification failed" -ForegroundColor Red
        exit 2
    }
}
} finally {
    if ($temporaryRoot -and (Test-Path $temporaryRoot)) {
        Remove-Item -Path $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit 0
