# check-env.ps1 — pre-flight for the Kairo IDE dev / CI workflow on Windows.
#
# Authoritative contract: docs/hotfix-windows-test-readiness.md §9.
#
# This script does NOT install anything. It only probes each required
# tool and reports whether it is on PATH, what its path / version is,
# and exits non-zero if any *required* tool is missing.
#
# Required (the script exits non-zero if any of these are missing):
#   - git         (clone / branch / version)
#   - node        (>= 20.10, per root package.json engines)
#   - pnpm        (>= 9.0,  per root package.json engines)
#   - go          (>= 1.23,  per runtime-agent/go.mod)
#
# Optional (the script reports MISS but does not fail):
#   - java / javac       (Tomcat 6 + JDT LS)
#   - ant                (legacy Java Web build)
#   - KAIRO_TOMCAT6_HOME (Tomcat 6 install dir)
#   - KAIRO_JRE17_HOME   (modern JRE for packaging)
#   - makensis           (NSIS — used by electron-builder --win)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1 -Json
#   powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1 -Strict

[CmdletBinding()]
param(
  [switch]$Json,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Probe helpers
# ---------------------------------------------------------------------------
function Probe($name, [scriptblock]$versionBlock = $null) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) {
    $version = $null
    if ($versionBlock) {
      try { $version = & $versionBlock 2>$null | Select-Object -First 1 } catch {}
    }
    return @{
      tool    = $name
      found   = $true
      path    = $cmd.Source
      version = $version
      required = $true
    }
  }
  return @{
    tool    = $name
    found   = $false
    required = $true
  }
}

function ProbeOptional($name, [scriptblock]$versionBlock = $null) {
  $r = Probe $name $versionBlock
  $r.required = $false
  return $r
}

function ProbeEnvVar($name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ($v) {
    return @{
      tool    = $name
      found   = $true
      path    = $v
      required = $false
    }
  }
  return @{
    tool    = $name
    found   = $false
    required = $false
  }
}

# ---------------------------------------------------------------------------
# Run all probes
# ---------------------------------------------------------------------------
$checks = New-Object System.Collections.Generic.List[object]

# Required: the toolchain that the verify-e2e.ps1 + pnpm + go test
# steps need to actually run.
$checks.Add( (Probe "git"   { & git --version }) )
$checks.Add( (Probe "node"  { & node --version }) )
$checks.Add( (Probe "pnpm"  { & pnpm --version }) )
$checks.Add( (Probe "go"    { & go version }) )

# Optional: needed for the legacy Java Web / Tomcat 6 / JDT LS
# surface but not for the new contract E2E.
$checks.Add( (ProbeOptional "java"  { & java  -version }) )
$checks.Add( (ProbeOptional "javac" { & javac -version }) )
$checks.Add( (ProbeOptional "ant"   { & ant   -version }) )
$checks.Add( (ProbeOptional "makensis" { & makensis /VERSION }) )

# Optional environment variables.
$checks.Add( (ProbeEnvVar "KAIRO_TOMCAT6_HOME") )
$checks.Add( (ProbeEnvVar "KAIRO_JRE17_HOME") )

# ---------------------------------------------------------------------------
# Emit
# ---------------------------------------------------------------------------
$missingRequired = @($checks | Where-Object { $_.required -and -not $_.found })

if ($Json) {
  $checks | ConvertTo-Json -Depth 4
} else {
  Write-Host "Kairo IDE environment check" -ForegroundColor Cyan
  Write-Host "  (required = must be on PATH; optional = reported but non-fatal)" -ForegroundColor DarkGray
  Write-Host ""
  foreach ($c in $checks) {
    if ($c.found) {
      $marker = if ($c.required) { "REQ  " } else { "OPT  " }
      $ver = if ($c.version) { "  $($c.version)" } else { "" }
      Write-Host ("  {0}  {1,-22} {2}{3}" -f $marker, $c.tool, $c.path, $ver) -ForegroundColor Green
    } else {
      $marker = if ($c.required) { "REQ  " } else { "OPT  " }
      Write-Host ("  {0}  {1,-22} MISSING" -f $marker, $c.tool) -ForegroundColor Red
    }
  }
  Write-Host ""
  if ($missingRequired.Count -gt 0) {
    Write-Host "FAIL: required tools missing: $($missingRequired.tool -join ', ')" -ForegroundColor Red
    if ($Strict) { exit 1 }
  } else {
    Write-Host "OK: all required tools present." -ForegroundColor Green
  }
  $missingOptional = @($checks | Where-Object { -not $_.required -and -not $_.found })
  if ($missingOptional.Count -gt 0) {
    Write-Host ("INFO: optional tools/env missing: {0}" -f ($missingOptional.tool -join ', ')) -ForegroundColor Yellow
  }
}

if ($missingRequired.Count -gt 0) {
  exit 1
}
exit 0
