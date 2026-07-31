# start-browser.ps1
# Launches Kairo IDE in browser-only mode (no Electron window).
# Starts the Go Runtime Agent if not already running, then starts
# the Theia backend and opens the default browser.
#
# If the agent is already running (detected via agent-state.json),
# the browser mode reuses it — no duplicate agent is started.
#
# Usage:
#   .\scripts\start-browser.ps1
#   .\scripts\start-browser.ps1 -Port 3000 -AgentPort 18080
#   .\scripts\start-browser.ps1 -Workspace "C:\my-project"

param(
    [int]$Port = 3000,
    [int]$AgentPort = 18080,
    [string]$Workspace = "",
    [string]$DataDir = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# Resolve data directory.
if (-not $DataDir) {
    $DataDir = Join-Path $env:LOCALAPPDATA "kairo-data"
}

# ─── Agent Discovery ─────────────────────────────────

$agentUrl = ""
$agentSecret = ""
$statePath = Join-Path $DataDir "agent-state.json"

if (Test-Path $statePath) {
    try {
        $state = Get-Content $statePath -Raw | ConvertFrom-Json
        if ($state.port -and $state.port -gt 0) {
            # Verify agent is still alive.
            $healthUrl = "http://127.0.0.1:$($state.port)/api/v1/health"
            try {
                $response = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing
                if ($response.StatusCode -eq 200) {
                    $agentUrl = "http://127.0.0.1:$($state.port)"
                    $agentSecret = $state.secret
                    Write-Host "[OK] Reusing existing agent on port $($state.port) (pid $($state.pid))" -ForegroundColor Green
                }
            } catch {
                Write-Host "[WARN] Agent state file found but agent is not healthy, will start a new one" -ForegroundColor Yellow
                Remove-Item $statePath -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        Write-Host "[WARN] Agent state file corrupted, will start a new one" -ForegroundColor Yellow
        Remove-Item $statePath -Force -ErrorAction SilentlyContinue
    }
}

if (-not $agentUrl) {
    # Start the agent.
    Write-Host "[INFO] Starting agent on port $AgentPort..." -ForegroundColor Cyan
    $agentBinary = Join-Path $repoRoot "runtime-agent\bin\kairo-runtime.exe"
    if (-not (Test-Path $agentBinary)) {
        $agentBinary = Join-Path $repoRoot "runtime-agent\bin\kairo-runtime"
    }
    if (-not (Test-Path $agentBinary)) {
        Write-Host "[ERROR] Agent binary not found. Build it first." -ForegroundColor Red
        Write-Host "  cd runtime-agent && go build -o bin/ ./cmd/kairo-runtime/" -ForegroundColor Yellow
        exit 1
    }

    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }

    $agentSecret = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })

    $agentArgs = @(
        "--bind", "127.0.0.1",
        "--port", $AgentPort,
        "--secret", $agentSecret,
        "--data-dir", $DataDir,
        "--log-level", "info"
    )

    # Start agent in background.
    $agentProcess = Start-Process -FilePath $agentBinary -ArgumentList $agentArgs -PassThru -WindowStyle Hidden

    # Wait for agent to be healthy.
    $agentUrl = "http://127.0.0.1:$AgentPort"
    $healthUrl = "$agentUrl/api/v1/health"
    $maxWait = 30
    $waited = 0
    while ($waited -lt $maxWait) {
        try {
            $response = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                Write-Host "[OK] Agent healthy on port $AgentPort (pid $($agentProcess.Id))" -ForegroundColor Green
                break
            }
        } catch {
            Start-Sleep -Seconds 1
            $waited++
        }
    }
    if ($waited -ge $maxWait) {
        Write-Host "[ERROR] Agent failed to start within ${maxWait}s" -ForegroundColor Red
        exit 1
    }
}

# ─── Theia Backend ─────────────────────────────────

Write-Host "[INFO] Starting Theia backend on port $Port..." -ForegroundColor Cyan

$env:KAIRO_AGENT_URL = $agentUrl
$env:KAIRO_AGENT_SECRET = $agentSecret

$theiaArgs = @(
    "start"
)
if ($Workspace) {
    $theiaArgs += $Workspace
} else {
    $theiaArgs += (Join-Path $env:TEMP "kairo-workspace")
}
$theiaArgs += "--hostname=127.0.0.1"
$theiaArgs += "--port=$Port"

# Use the Theia CLI from the browser app.
$browserDir = Join-Path $repoRoot "apps\browser"
$theiaCli = Join-Path $repoRoot "node_modules\.bin\theia.cmd"
if (-not (Test-Path $theiaCli)) {
    $theiaCli = Join-Path $repoRoot "node_modules\.bin\theia"
}

Push-Location $browserDir
try {
    Write-Host "[INFO] Running: theia $($theiaArgs -join ' ')" -ForegroundColor DarkGray
    Write-Host "[INFO] Agent URL: $agentUrl" -ForegroundColor DarkGray
    Write-Host ""

    $theiaUrl = "http://127.0.0.1:$Port"

    if (-not $NoBrowser) {
        # Open browser after a short delay to let Theia start.
        $scriptBlock = {
            param($url)
            Start-Sleep -Seconds 3
            Start-Process $url
        }
        Start-Job -ScriptBlock $scriptBlock -ArgumentList $theiaUrl | Out-Null
    }

    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Kairo IDE — Browser Mode" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Open in browser: $theiaUrl" -ForegroundColor Green
    Write-Host "  Agent:           $agentUrl" -ForegroundColor DarkGray
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the Theia backend." -ForegroundColor Yellow
    Write-Host "(Agent will keep running for other sessions.)" -ForegroundColor DarkGray
    Write-Host ""

    & $theiaCli @theiaArgs
} finally {
    Pop-Location
    # Clean up env vars.
    Remove-Item Env:\KAIRO_AGENT_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\KAIRO_AGENT_SECRET -ErrorAction SilentlyContinue
}