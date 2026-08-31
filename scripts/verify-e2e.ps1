# verify-e2e.ps1 — Kairo IDE end-to-end smoke for Windows.
#
# Authoritative contract: docs/hotfix-windows-test-readiness.md §9.
#
# This script runs the Kairo post-Wave-0 E2E flow:
#
#   1. pnpm -r --filter "./packages/*" build + pnpm -r --filter "./apps/*" build
#   2. go test -count=1 ./... (in runtime-agent)
#   3. go build -> apps/desktop/resources/bin/kairo-runtime.exe
#   4. pnpm --filter @kairo/desktop build:win  (NSIS / portable)
#   5. Start the installed .exe (or fall back to the dev binary if
#      packaging is not available) and verify the new agent
#      contract end-to-end:
#         GET  /api/v1/health         200
#         GET  /api/v1/endpoints      200
#         WS   auth roundtrip         (Sec-WebSocket-Protocol selects <secret>)
#         POST /api/v1/runtime/restart 200 (process replaced)
#
# The script is INTENTIONALLY tolerant: if a step cannot run on the
# current machine (e.g. NSIS requires electron-builder / wine; JDK is
# missing; the new endpoints have not landed yet) the step is
# reported as SKIPPED with a yellow marker, and the run continues.
# Only outright FAILED steps (build broken, agent refuses a
# supported endpoint, etc.) cause a non-zero exit.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1 `
#       -Port 18099 -Secret "test-secret" -RepoRoot "G:\spaces\kairo-ide"
#
# Parameters:
#   -Port             port to bind the runtime agent on (default 18099).
#                     The agent will pick the next free port if this
#                     is taken; we re-read /api/v1/endpoints after
#                     start to discover the actual port.
#   -Secret           auth secret for X-Kairo-Secret + WS subprotocol.
#                     Default: "verify-e2e-secret".
#   -TomcatPort       legacy Tomcat 6 port for the legacy-sample
#                     smoke (default 61100). Not used by the new
#                     contract; left for backward compatibility.
#   -RepoRoot         repository root (auto-resolved if omitted).
#   -SkipBuild        skip the pnpm / go build steps.
#   -SkipAgent        skip starting the agent and testing endpoints.
#   -UseDevAgent      force using the dev binary even if an installed
#                     .exe is found in apps/desktop/dist/.

[CmdletBinding()]
param(
  [int]$Port = 18099,
  [string]$Secret = "verify-e2e-secret",
  [int]$TomcatPort = 61100,
  [string]$KairoTomcat6Home = $env:KAIRO_TOMCAT6_HOME,
  [string]$RepoRoot,
  [switch]$SkipBuild,
  [switch]$SkipAgent,
  [switch]$UseDevAgent,
  # When set, the api.endpoints step does not fail if the payload is
  # missing or malformed. Useful for diagnostic runs against an older
  # agent that does not yet implement the contract. Default: $false
  # (a missing/malformed payload is still a failure).
  [switch]$SkipMissing
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Paths & helpers
# ---------------------------------------------------------------------------
if (-not $RepoRoot) {
  $RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "..")
}
Push-Location $RepoRoot

$logDir = Join-Path $RepoRoot ".runtime\verify"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "verify-$(Get-Date -Format yyyyMMddHHmmss).log"
$script:failures = New-Object System.Collections.Generic.List[string]
$script:skips    = New-Object System.Collections.Generic.List[string]

function Step($name, [scriptblock]$body) {
  Write-Host "[$name] starting" -ForegroundColor Cyan
  try {
    & $body
    Write-Host "[$name] OK" -ForegroundColor Green
  } catch {
    Write-Host "[$name] FAILED: $_" -ForegroundColor Red
    $script:failures.Add("$name : $_")
  }
}

function Skip($name, $reason) {
  Write-Host "[$name] SKIP: $reason" -ForegroundColor Yellow
  $script:skips.Add("$name : $reason")
}

# ---------------------------------------------------------------------------
# 0. preflight
# ---------------------------------------------------------------------------
Step "preflight" {
  foreach ($t in @("node", "pnpm", "go")) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
      throw "missing tool: $t"
    }
  }
  # git is checked by check-env.ps1 but is not strictly required for
  # this script — only mention.
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    Write-Host "  git: $($git.Source)" -ForegroundColor DarkGray
  } else {
    Write-Host "  git: not on PATH (informational only)" -ForegroundColor DarkYellow
  }
  $java = Get-Command java -ErrorAction SilentlyContinue
  if ($java) {
    Write-Host "  java: $($java.Source)" -ForegroundColor DarkGray
  } else {
    Write-Host "  java: not on PATH (informational only — required for Tomcat 6 smoke only)" -ForegroundColor DarkYellow
  }
}

# ---------------------------------------------------------------------------
# 1. build packages + apps
# ---------------------------------------------------------------------------
if ($SkipBuild) {
  Skip "build.packages" "-SkipBuild was set"
  Skip "build.apps"    "-SkipBuild was set"
} else {
  Step "build.packages" {
    & pnpm -r --filter "./packages/*" build 2>&1 | Tee-Object -FilePath $logFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "packages build failed" }
  }
  Step "build.apps" {
    # Apps include the Electron shell which may need an internet-fetched
    # electron binary. We swallow non-zero exit here and downgrade to a
    # SKIP rather than a hard failure: the rest of the E2E flow only
    # needs the agent binary, not the Electron shell.
    & pnpm -r --filter "./apps/*" build 2>&1 | Tee-Object -FilePath $logFile | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "apps build failed"
    }
  }
}

# ---------------------------------------------------------------------------
# 2. go test
# ---------------------------------------------------------------------------
if ($SkipBuild) {
  Skip "test.agent" "-SkipBuild was set"
} else {
  Step "test.agent" {
    & node (Join-Path $RepoRoot "scripts/test-agent.js") 2>&1 |
      Tee-Object -FilePath $logFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "go test failed" }
  }
}

# ---------------------------------------------------------------------------
# 3. go build + copy to apps/desktop/resources/bin/
# ---------------------------------------------------------------------------
$devAgentBin = Join-Path $RepoRoot "runtime-agent\bin\kairo-runtime.exe"
$instAgentDir = Join-Path $RepoRoot "apps\desktop\resources\bin"
$instAgentBin = Join-Path $instAgentDir "kairo-runtime.exe"

if ($SkipBuild) {
  Skip "agent.build" "-SkipBuild was set"
} else {
  Step "agent.build" {
    New-Item -ItemType Directory -Force -Path $instAgentDir | Out-Null
    Push-Location (Join-Path $RepoRoot "runtime-agent")
    try {
      & go build -trimpath -ldflags='-s -w' -o bin\kairo-runtime.exe .\cmd\kairo-runtime 2>&1 `
        | Tee-Object -FilePath $logFile | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "go build failed" }
    } finally {
      Pop-Location
    }
    if (-not (Test-Path $devAgentBin)) {
      throw "agent binary missing at $devAgentBin after go build"
    }
    Copy-Item -Force $devAgentBin $instAgentBin
    Write-Host "  copied to $instAgentBin" -ForegroundColor DarkGray
  }
}

# ---------------------------------------------------------------------------
# 4. NSIS / portable packaging
# ---------------------------------------------------------------------------
$nsisExe = $null
$portableExe = $null
if ($SkipBuild -or $UseDevAgent) {
  Skip "agent.package" "skipping package step"
} else {
  Step "agent.package" {
    Push-Location $RepoRoot
    try {
      # electron-builder can take a long time and may fail on machines
      # without a full toolchain (NSIS needs makensis on PATH, code
      # signing, etc.). We try once and degrade gracefully.
      & pnpm --filter @kairo/desktop build:win 2>&1 | Tee-Object -FilePath $logFile | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "pnpm build:win failed (likely missing makensis / electron toolchain)"
      }
    } finally {
      Pop-Location
    }
  }
  if ($script:failures.Count -gt 0 -and $script:failures[-1].StartsWith("agent.package")) {
    # Remove the failure from the list — the package step is optional.
    $script:failures.RemoveAt($script:failures.Count - 1)
    $script:skips.Add("agent.package : build:win not available on this host (dev agent will be used)")
  }
  # Look for the produced installer / portable in apps/desktop/dist.
  $distDir = Join-Path $RepoRoot "apps\desktop\dist"
  if (Test-Path $distDir) {
    $nsisExe     = Get-ChildItem -Path $distDir -Filter "*Setup*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    $portableExe = Get-ChildItem -Path $distDir -Filter "*.exe"          -Recurse -ErrorAction SilentlyContinue |
                     Where-Object { $_.Name -notlike "*Setup*" } | Select-Object -First 1
  }
}

# ---------------------------------------------------------------------------
# 5. start the agent
# ---------------------------------------------------------------------------
$agentProc = $null
$actualPort = $Port
$agentUrl   = $null

if ($SkipAgent) {
  Skip "agent.start" "-SkipAgent was set"
} else {
  Step "agent.start" {
    $dataDir = Join-Path $RepoRoot ".runtime\verify\data"
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

    # Prefer the dev binary unless an installed .exe exists.
    $useBin = $devAgentBin
    if (-not $UseDevAgent) {
      if ($portableExe -and (Test-Path $portableExe.FullName)) {
        $useBin = $portableExe.FullName
        Write-Host "  using installed portable: $useBin" -ForegroundColor DarkGray
      } elseif ($nsisExe -and (Test-Path $nsisExe.FullName)) {
        Write-Host "  installed NSIS found at $($nsisExe.FullName) but NSIS is not run unattended here; using dev binary" -ForegroundColor DarkYellow
      } else {
        Write-Host "  no installed .exe found, using dev binary" -ForegroundColor DarkGray
      }
    }
    if (-not (Test-Path $useBin)) {
      throw "no agent binary available at $useBin"
    }

    # Pass secret via env so it never appears in process listings (S1).
    $env:KAIRO_LOCAL_SECRET = $Secret
    $args = @("--bind", "127.0.0.1", "--port", "$Port",
              "--data-dir", $dataDir,
              "--log-level", "info")
    $script:agentProc = Start-Process -FilePath $useBin -ArgumentList $args -PassThru -NoNewWindow
    Write-Host "[agent] pid: $($script:agentProc.Id)"

    # Wait for /api/v1/health. We DO NOT assume the agent binds the
    # requested -Port: the packaged Kairo IDE may pick a free port
    # if the requested one is busy (see the [kairo] Starting agent
    # --port NNNNNN line in the packaged app's stdout). We probe
    # Get-NetTCPConnection for the kairo-runtime process's LISTEN
    # socket, then GET /api/v1/health to confirm it's the agent and
    # not a stale socket from a prior run.
    $script:actualPort = $null
    $script:agentUrl   = $null
    for ($i = 0; $i -lt 80; $i++) {
      $candidates = @()
      try {
        $agentPids = @(Get-Process -Name 'kairo-runtime' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        if ($agentPids.Count -gt 0) {
          $candidates = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -in $agentPids -and
                            ($_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::')) } |
            Select-Object -ExpandProperty LocalPort -Unique)
        }
      } catch {}
      foreach ($port in $candidates) {
        try {
          $r = Invoke-WebRequest -Uri "http://127.0.0.1`:$port/api/v1/health" -UseBasicParsing -TimeoutSec 1
          if ($r.StatusCode -eq 200) {
            $script:actualPort = $port
            $script:agentUrl  = "http://127.0.0.1`:$port"
            if ($port -ne $Port) {
              Write-Host "  agent bound fallback port $port (requested $Port was busy)" -ForegroundColor DarkYellow
            } else {
              Write-Host "  agent ready on port $port" -ForegroundColor DarkGray
            }
            return
          }
        } catch {}
      }
      Start-Sleep -Milliseconds 500
    }
    throw "agent did not become healthy (requested port $Port, no healthy port found on any kairo-runtime process)"
  }
}

# ---------------------------------------------------------------------------
# 6. test the new contract endpoints
# ---------------------------------------------------------------------------
if ($SkipAgent -or -not $script:agentProc) {
  Skip "api.health"    "agent not started"
  Skip "api.endpoints" "agent not started"
  Skip "ws.auth"       "agent not started"
  Skip "api.restart"   "agent not started"
} else {
  $baseUrl = "http://127.0.0.1`:$($script:actualPort)"
  $secretHdr = @{ "X-Kairo-Secret" = $Secret }
  $failuresBefore = $script:failures.Count

  Step "api.health" {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/v1/health" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -ne 200) { throw "expected 200, got $($r.StatusCode)" }
  }

  Step "api.endpoints" {
    $r = Invoke-WebRequest -Uri "$baseUrl/api/v1/endpoints" -Headers $secretHdr -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 404) {
      throw "GET /api/v1/endpoints returned 404 — contract not yet implemented by the agent"
    }
    if ($r.StatusCode -ne 200) { throw "expected 200, got $($r.StatusCode)" }

    # The wire format is a ResponseEnvelope that wraps RuntimeEndpoints:
    #   { "requestId": "...", "ok": true,
    #     "payload": { "http": "host:port", "events": "host:port" } }
    # Read the payload defensively — accept either a nested
    # `.payload.http` (current contract) or a top-level `.http`
    # (legacy / un-wrapped shape) so this script keeps working across
    # agent versions.
    $httpHostPort = $null
    try {
      $j = $r.Content | ConvertFrom-Json
      if ($j -eq $null) {
        throw "ConvertFrom-Json returned null"
      }
      $payload = $null
      # Current wire: payload is a PSCustomObject with .http / .events.
      # Some older or hand-rolled servers returned the endpoints object
      # directly (top-level .http). Try both.
      if ($j.PSObject.Properties['payload'] -and $j.payload) {
        $payload = $j.payload
      } elseif ($j.PSObject.Properties['http']) {
        $payload = $j
      }
      if ($payload) {
        if ($payload.PSObject.Properties['http'])      { $httpHostPort = [string]$payload.http }
        elseif ($payload.ContainsKey -and $payload.ContainsKey('http'))      { $httpHostPort = [string]$payload['http'] }
        elseif ($payload -is [hashtable] -and $payload.ContainsKey('http'))   { $httpHostPort = [string]$payload['http'] }
      }
    } catch {
      # Malformed JSON / unexpected shape — degrade to a Skip if the
      # caller asked for tolerant mode, otherwise fail.
      if ($SkipMissing) {
        Write-Host "  api.endpoints: payload parse failed, -SkipMissing was set ($($_.Exception.Message))" -ForegroundColor Yellow
        return
      }
      throw "endpoints payload parse failed: $($_.Exception.Message) — body: $($r.Content)"
    }

    if (-not $httpHostPort) {
      if ($SkipMissing) {
        Write-Host "  api.endpoints: missing 'http' field, -SkipMissing was set" -ForegroundColor Yellow
        return
      }
      throw "endpoints payload missing 'http' field: $($r.Content)"
    }

    # Diagnostic only — the actual port may differ from -Port if the
    # requested port was busy. We do not re-anchor $baseUrl because
    # the ws.auth step binds its own port literally; mismatches
    # would be reported as a separate, more visible WS failure.
    Write-Host "  endpoints.http = $httpHostPort" -ForegroundColor DarkGray
  }

  Step "ws.auth" {
    # WebSocket auth roundtrip: the client offers
    # `Sec-WebSocket-Protocol: kairo-secret-v1, <secret>`. The server
    # validates the adjacent secret token and echoes that token as the
    # selected protocol. RFC 6455 requires the selected value to be one of
    # the offered protocols; selecting the secret both proves authentication
    # and lets browser WebSocket clients complete the handshake.
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $ws.Options.AddSubProtocol("kairo-secret-v1")
    $ws.Options.AddSubProtocol($Secret)
    $cts = [System.Threading.CancellationTokenSource]::new()
    try {
      $uri = [Uri]"ws://127.0.0.1`:$($script:actualPort)/api/v1/events?workspaceId=verify-e2e"
      $connectTask = $ws.ConnectAsync($uri, $cts.Token)
      $connected = $connectTask.Wait(5000)
      if (-not $connected) { throw "WS connect timed out" }
      $connectTask.GetAwaiter().GetResult()
      if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
        throw "WS not open after ConnectAsync: state=$($ws.State)"
      }
      if ($ws.SubProtocol -ne $Secret) {
        throw "expected negotiated secret subprotocol, got '$($ws.SubProtocol)'"
      }
      Write-Host "  WS subprotocol negotiated: $($ws.SubProtocol)" -ForegroundColor DarkGray
    } finally {
      try { $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "verify", $cts.Token).Wait(2000) | Out-Null } catch {}
      $ws.Dispose()
      $cts.Dispose()
    }
  }

  Step "api.restart" {
    $oldPid = $script:agentProc.Id
    $r = Invoke-WebRequest -Method POST -Uri "$baseUrl/api/v1/runtime/restart" `
            -Headers $secretHdr -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 404) {
      throw "POST /api/v1/runtime/restart returned 404 — contract not yet implemented"
    }
    if ($r.StatusCode -ne 200) { throw "expected 200, got $($r.StatusCode)" }
    # The old process should exit and a new one should bind the same
    # port. Wait for the new health to come up.
    for ($i = 0; $i -lt 80; $i++) {
      try {
        $r2 = Invoke-WebRequest -Uri "$baseUrl/api/v1/health" -UseBasicParsing -TimeoutSec 1
        if ($r2.StatusCode -eq 200) {
          Write-Host "  restart round-trip OK (old pid=$oldPid)" -ForegroundColor DarkGray
          # Update the tracked process so teardown uses the new one.
          $script:agentProc = Get-Process -Name "kairo-runtime" -ErrorAction SilentlyContinue |
                                Where-Object { $_.Id -ne $oldPid } | Select-Object -First 1
          if (-not $script:agentProc) {
            Write-Host "  could not find the post-restart process for teardown" -ForegroundColor DarkYellow
          }
          return
        }
      } catch { Start-Sleep -Milliseconds 250 }
    }
    throw "agent did not become healthy after restart"
  }
}

# ---------------------------------------------------------------------------
# teardown
# ---------------------------------------------------------------------------
if ($script:agentProc -and -not $script:agentProc.HasExited) {
  try { Stop-Process -Id $script:agentProc.Id -Force -ErrorAction SilentlyContinue } catch {}
}
Get-Process -Name "kairo-runtime" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Pop-Location

# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "================ SUMMARY ================" -ForegroundColor Cyan
if ($script:failures.Count -gt 0) {
  Write-Host "FAILURES:" -ForegroundColor Red
  $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}
if ($script:skips.Count -gt 0) {
  Write-Host "SKIPS:" -ForegroundColor Yellow
  $script:skips | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
if ($script:failures.Count -gt 0) {
  Write-Host "RESULT: FAIL" -ForegroundColor Red
  exit 1
}
Write-Host "RESULT: PASS" -ForegroundColor Green
exit 0
