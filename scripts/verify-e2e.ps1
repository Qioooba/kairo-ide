# verify-e2e.ps1 — Kairo end-to-end smoke test for Windows.
#
# 1. Build all packages + apps.
# 2. Start the Go Runtime Agent.
# 3. Build a small Tomcat 6 deployable from legacy-sample.
# 4. Hit /api/v1/builds, /api/v1/deployments, /api/v1/servers.
# 5. Start a server, hit it with a real HTTP client, modify a
#    JSP, re-deploy, hit it again, confirm the change is live.
# 6. Stop the server and the agent.
# 7. Fail loudly with a non-zero exit code if any step fails.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1 -Port 18099
#   -Port 18099 is the default; pick a different one if the
#   default is taken on the host.

[CmdletBinding()]
param(
  [int]$Port = 18099,
  [int]$TomcatPort = 61100,
  [string]$KairoTomcat6Home = $env:KAIRO_TOMCAT6_HOME,
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "..")
}
Push-Location $RepoRoot

$logDir = Join-Path $RepoRoot ".runtime\verify"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "verify-$(Get-Date -Format yyyyMMddHHmmss).log"
$script:failures = New-Object System.Collections.Generic.List[string]
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

# --- 0. preflight ----------------------------------------------------------
Step "preflight" {
  foreach ($t in @("node", "pnpm", "go", "java")) {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
      throw "missing tool: $t"
    }
  }
  $agentBin = Join-Path $RepoRoot "runtime-agent\bin\kairo-runtime.exe"
  if (-not (Test-Path $agentBin)) {
    throw "agent binary missing at $agentBin; run 'go build' first"
  }
  if (-not $KairoTomcat6Home) {
    throw "KAIRO_TOMCAT6_HOME not set and -KairoTomcat6Home not provided"
  }
  if (-not (Test-Path $KairoTomcat6Home)) {
    throw "KAIRO_TOMCAT6_HOME does not exist: $KairoTomcat6Home"
  }
}

# --- 1. build ------------------------------------------------------------
Step "build" {
  & pnpm install --frozen-lockfile=false --ignore-scripts | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
  & pnpm -r --filter './packages/*' build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "packages build failed" }
}

# --- 2. start the agent ---------------------------------------------------
$proc = $null
Step "agent.start" {
  $dataDir = Join-Path $RepoRoot ".runtime\verify\data"
  $env:KAIRO_DATA_DIR = $dataDir
  $env:KAIRO_TOMCAT6_HOME = $KairoTomcat6Home
  $agentBin = Join-Path $RepoRoot "runtime-agent\bin\kairo-runtime.exe"
  # The agent supports both --data-dir and KAIRO_DATA_DIR. We
  # pass the flag explicitly so the script's behaviour does
  # not depend on environment variables that may or may not
  # be inherited from the calling shell. --data-dir is a
  # first-class flag (see runtime-agent/internal/config).
  $args = @("--bind", "127.0.0.1", "--port", "$Port",
            "--data-dir", $dataDir, "--log-level", "info")
  $proc = Start-Process -FilePath $agentBin -ArgumentList $args -PassThru -NoNewWindow
  Write-Host "[agent] pid: $($proc.Id)"
  for ($i = 0; $i -lt 80; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1`:$Port/api/v1/health" -UseBasicParsing -TimeoutSec 1
      if ($r.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  throw "agent did not become healthy"
}

# --- 3. compile + deploy + start + smoke ---------------------------------
$serverId = $null
try {
  Step "build.compile" {
    $body = @{
      requestId = "verify-build-1"
      payload = @{
        projectId = "legacy-sample"
        clean = $true
      }
    } | ConvertTo-Json -Depth 6
    $r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1`:$Port/api/v1/builds" `
           -ContentType "application/json" -Body $body -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "build returned $($r.StatusCode)" }
    $j = $r.Content | ConvertFrom-Json
    if (-not $j.ok) { throw "build error envelope: $($j.error.message)" }
    if ($j.payload.state -ne "success") {
      throw "build state $($j.payload.state) — diagnostics: $($j.payload.diagnostics | Out-String)"
    }
  }
  Step "deploy.classes" {
    $body = @{ requestId = "verify-deploy-1"; payload = @{ projectId = "legacy-sample"; what = "all" } } | ConvertTo-Json -Depth 6
    $r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1`:$Port/api/v1/deployments" `
           -ContentType "application/json" -Body $body -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "deploy returned $($r.StatusCode)" }
  }
  Step "server.start" {
    $body = @{
      requestId = "verify-server-1"
      payload = @{ projectId = "legacy-sample"; debug = $false }
    } | ConvertTo-Json -Depth 6
    $r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1`:$Port/api/v1/servers" `
           -ContentType "application/json" -Body $body -UseBasicParsing
    if ($r.StatusCode -ne 200) { throw "start returned $($r.StatusCode)" }
    $j = $r.Content | ConvertFrom-Json
    $script:serverId = $j.payload.id
  }
  Step "http.smoke" {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1`:$TomcatPort/kairo/hello?name=Kairo" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -ne 200) { throw "GET /kairo/hello returned $($r.StatusCode)" }
    if ($r.Content -notmatch "Kairo") { throw "GET /kairo/hello did not contain greeting: $($r.Content)" }
  }
  Step "jsp.staticSync" {
    $jsp = Join-Path $RepoRoot "legacy-sample\WebRoot\hello.jsp"
    $backup = Get-Content $jsp -Raw
    try {
      (Get-Content $jsp -Raw) -replace "你好", "你好-E2E-$(Get-Date -Format HHmmss)" | Set-Content $jsp -NoNewline -Encoding UTF8
      $body = @{
        requestId = "verify-deploy-2"
        payload = @{ projectId = "legacy-sample"; what = "webapp" }
      } | ConvertTo-Json -Depth 6
      $r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1`:$Port/api/v1/deployments" `
             -ContentType "application/json" -Body $body -UseBasicParsing
      if ($r.StatusCode -ne 200) { throw "second deploy returned $($r.StatusCode)" }
      Start-Sleep -Seconds 1
      $r = Invoke-WebRequest -Uri "http://127.0.0.1`:$TomcatPort/kairo/hello.jsp" -UseBasicParsing -TimeoutSec 5
      if ($r.Content -notmatch "E2E-") { throw "JSP did not reflect the change" }
    } finally {
      Set-Content $jsp -Value $backup -NoNewline -Encoding UTF8
    }
  }
} finally {
  if ($serverId) {
    try {
      $body = @{ requestId = "verify-server-stop"; payload = @{ force = $true } } | ConvertTo-Json -Depth 6
      $null = Invoke-WebRequest -Method DELETE -Uri "http://127.0.0.1`:$Port/api/v1/servers/$serverId" `
               -ContentType "application/json" -Body $body -UseBasicParsing
    } catch {}
  }
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
  # ensure no java.exe is left over
  Get-Process -Name "java" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*$TomcatPort*"
  } | Stop-Process -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "FAILURES:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Pop-Location
  exit 1
}
Write-Host ""
Write-Host "ALL E2E STEPS PASSED." -ForegroundColor Green
Pop-Location
exit 0
