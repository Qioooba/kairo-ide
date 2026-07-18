# dev.ps1 — Kairo IDE dev launcher for Windows.
#
# Starts the Go Runtime Agent in the background, waits for its
# /api/v1/health endpoint to come up, then starts the Theia
# browser app. Both children are tracked so that closing the
# PowerShell window (or hitting Ctrl-C) tears the agent down
# too — no stray java.exe is left behind.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
#   $env:KAIRO_BIND = "0.0.0.0"   # opt-in to a public bind
#   $env:KAIRO_TOMCAT6_HOME = "F:\tools\tomcat6"
#   $env:KAIRO_JRE17_HOME   = "F:\tools\jdk17"
#
# Defaults:
#   Bind  : 127.0.0.1  (override with $env:KAIRO_BIND)
#   Ports : Agent 18099, Theia 3000
#   Data  : .\.runtime\data  (created if missing)
#
# Behaviour:
#   * Refuses to start if Node / pnpm / java are missing and the
#     user did not pass -SkipEnvCheck.
#   * Stops on Ctrl-C (calls Stop-Process on both children).
#   * Sets KAIRO_BIND explicitly; default is loopback so the
#     server form does not silently expose itself.

[CmdletBinding()]
param(
  [switch]$SkipEnvCheck,
  [int]$AgentPort = 18099,
  [int]$TheiaPort = 3000,
  [string]$Bind = $env:KAIRO_BIND
)
$ErrorActionPreference = "Stop"

if (-not $Bind) { $Bind = "127.0.0.1" }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir "..")
Push-Location $RepoRoot

$dataDir   = Join-Path $RepoRoot ".runtime\data"
$bundled   = Join-Path $RepoRoot ".runtime\bundled"
$agentBin  = Join-Path $RepoRoot "runtime-agent\bin\kairo-runtime.exe"
$tomcat6   = $env:KAIRO_TOMCAT6_HOME
$jre17     = $env:KAIRO_JRE17_HOME

if (-not $SkipEnvCheck) {
  $missing = @()
  foreach ($tool in @("node", "pnpm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
  }
  if ($missing.Count -gt 0) {
    Write-Error "Missing tools: $($missing -join ', '). Install or pass -SkipEnvCheck."
    Pop-Location
    exit 1
  }
  if (-not (Test-Path $agentBin)) {
    Write-Error "Runtime agent binary not found at $agentBin. Run 'pnpm agent:build' first."
    Pop-Location
    exit 1
  }
  if ($tomcat6 -and -not (Test-Path $tomcat6)) {
    Write-Warning "KAIRO_TOMCAT6_HOME=$tomcat6 does not exist. Tomcat start commands will fail."
  }
  if ($jre17 -and -not (Test-Path $jre17)) {
    Write-Warning "KAIRO_JRE17_HOME=$jre17 does not exist. JDT LS start will fail."
  }
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $bundled | Out-Null

# --- Start the agent ------------------------------------------------------
Write-Host "[kairo] starting runtime agent on $Bind`:$AgentPort" -ForegroundColor Cyan
$env:KAIRO_DATA_DIR = $dataDir
if ($tomcat6) { $env:KAIRO_TOMCAT6_HOME = $tomcat6 }
$agentArgs = @("--bind", $Bind, "--port", "$AgentPort", "--data-dir", $dataDir, "--log-level", "info")
$agentProc = Start-Process -FilePath $agentBin -ArgumentList $agentArgs -PassThru -NoNewWindow
Write-Host "[kairo] agent pid: $($agentProc.Id)"

# --- Wait for /api/v1/health ---------------------------------------------
$healthUrl = "http://$Bind`:$AgentPort/api/v1/health"
$ready = $false
for ($i = 0; $i -lt 80; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 250
  }
}
if (-not $ready) {
  Write-Error "[kairo] agent did not become healthy in 20s. Aborting."
  Stop-Process -Id $agentProc.Id -Force -ErrorAction SilentlyContinue
  Pop-Location
  exit 1
}
Write-Host "[kairo] agent ready" -ForegroundColor Green

# --- Trap Ctrl-C / window close so the agent is killed -------------------
$cleanup = {
  param($proc)
  if ($proc -and -not $proc.HasExited) {
    Write-Host "[kairo] stopping agent pid $($proc.Id)" -ForegroundColor Yellow
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
Register-ObjectEvent -InputObject $agentProc -EventName Exited -Action $cleanup | Out-Null
[Console]::TreatControlCAsInput = $true

# --- Start Theia ----------------------------------------------------------
Write-Host "[kairo] starting Theia browser app on $Bind`:$TheiaPort" -ForegroundColor Cyan
$theiaArgs = @("dev:browser", "--", "--hostname=$Bind", "--port=$TheiaPort")
$theiaProc = Start-Process -FilePath (Get-Command pnpm).Source -ArgumentList $theiaArgs -PassThru -NoNewWindow
Write-Host "[kairo] theia pid: $($theiaProc.Id)"
Write-Host ""
Write-Host "Kairo IDE is up:" -ForegroundColor Green
Write-Host "  * Agent  : $healthUrl" -ForegroundColor Green
Write-Host "  * Browser: http://$Bind`:$TheiaPort" -ForegroundColor Green
Write-Host "  * Workspace: $RepoRoot\legacy-sample" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl-C to stop. The agent will be torn down with you." -ForegroundColor Yellow

try {
  while (-not $theiaProc.HasExited -and -not $agentProc.HasExited) {
    Start-Sleep -Seconds 1
  }
} finally {
  Write-Host "[kairo] shutting down" -ForegroundColor Yellow
  if (-not $theiaProc.HasExited) { Stop-Process -Id $theiaProc.Id -Force -ErrorAction SilentlyContinue }
  if (-not $agentProc.HasExited) { Stop-Process -Id $agentProc.Id -Force -ErrorAction SilentlyContinue }
  # Belt-and-braces: kill any java.exe or kairo-runtime.exe
  # that may have been spawned by the agent (Tomcat JVM, JDT LS).
  foreach ($name in @("kairo-runtime", "java")) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -like "*kairo*" -or $_.CommandLine -like "*kairo*"
    } | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
