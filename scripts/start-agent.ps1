# start-agent.ps1
# Launches the Kairo Runtime Agent as a standalone process.
# Writes state to $env:LOCALAPPDATA\kairo-data\agent-state.json
# so other processes (Desktop, Browser launcher) can discover it.
#
# Usage:
#   .\scripts\start-agent.ps1
#   .\scripts\start-agent.ps1 -Port 18080 -DataDir "C:\my-data"
#
# The agent stays running in the foreground. Press Ctrl+C to stop.

param(
    [int]$Port = 18080,
    [string]$DataDir = "",
    [string]$Secret = "",
    [string]$BundledDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# Resolve agent binary path.
$agentBinary = Join-Path $repoRoot "runtime-agent\bin\kairo-runtime.exe"
if (-not (Test-Path $agentBinary)) {
    $agentBinary = Join-Path $repoRoot "runtime-agent\bin\kairo-runtime"
}
if (-not (Test-Path $agentBinary)) {
    Write-Host "[ERROR] Agent binary not found. Build it first: pnpm --filter @kairo/desktop prebuild" -ForegroundColor Red
    Write-Host "  or: cd runtime-agent && go build -o bin/ ./cmd/kairo-runtime/" -ForegroundColor Yellow
    exit 1
}

# Resolve data directory.
if (-not $DataDir) {
    $DataDir = Join-Path $env:LOCALAPPDATA "kairo-data"
}
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# Generate a random secret if not provided.
if (-not $Secret) {
    $Secret = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Kairo Runtime Agent (Standalone)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Binary:   $agentBinary"
Write-Host "  Port:     $Port"
Write-Host "  DataDir:  $DataDir"
Write-Host "  Secret:   $($Secret.Substring(0,8))..."
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the agent." -ForegroundColor Yellow
Write-Host ""

# Build arguments.
$args = @(
    "--bind", "127.0.0.1",
    "--port", $Port,
    "--secret", $Secret,
    "--data-dir", $DataDir,
    "--log-level", "info"
)
if ($BundledDir) {
    $args += "--bundled-dir", $BundledDir
}

# Start agent in foreground.
& $agentBinary @args