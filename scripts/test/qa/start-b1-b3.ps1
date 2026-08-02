$ErrorActionPreference = 'Continue'
$root = 'G:\spaces\kairo-ide'
$agent = Join-Path $root 'runtime-agent\bin\kairo-runtime.exe'

function New-Secret {
  # Must sample WITH replacement — Get-Random -Count on a 16-char alphabet
  # returns at most 16 unique chars (caused 16-char secrets and auth flakes).
  -join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
}

function Start-KairoAgent {
  param([int]$Port, [string]$DataDir)
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $secret = New-Secret
  $proc = Start-Process -FilePath $agent -ArgumentList @(
    '--bind', '127.0.0.1',
    '--port', "$Port",
    '--secret', $secret,
    '--data-dir', $DataDir,
    '--log-level', 'info'
  ) -PassThru -WindowStyle Hidden
  @{ pid = $proc.Id; secret = $secret; port = $Port } | ConvertTo-Json |
    Set-Content (Join-Path $DataDir 'agent-state.json') -Encoding utf8
  Write-Host "agent port=$Port pid=$($proc.Id)"
  return $secret
}

function Wait-Health {
  param([string]$Url, [int]$Seconds = 60)
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

# B1 only (A3 retest) — with JDK 21+ for JDT LS
$jdtJre = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$jdtHome = Join-Path $root 'apps\desktop\bundled\jdtls'
# Agent uses KAIRO_JDTLS_HOME; Theia backend uses KAIRO_JDT_LS_HOME — set both.
$env:KAIRO_JDT_LS_JRE = $jdtJre
$env:KAIRO_JDT_LS_HOME = $jdtHome
$env:KAIRO_JDTLS_HOME = $jdtHome
$env:KAIRO_BUNDLED_DIR = Join-Path $root 'apps\desktop\bundled'
Write-Host "KAIRO_JDT_LS_JRE=$env:KAIRO_JDT_LS_JRE"
Write-Host "KAIRO_JDTLS_HOME=$env:KAIRO_JDTLS_HOME"
Write-Host "KAIRO_BUNDLED_DIR=$env:KAIRO_BUNDLED_DIR"

# Ensure B1 workspace has .kairo/project.yaml (JDT ActiveProject bind)
$b1ws = Join-Path $root 'artifacts\qa\b1\workspace'
$a3ws = Join-Path $root 'artifacts\qa\a3\workspace'
New-Item -ItemType Directory -Force -Path $b1ws | Out-Null
if (-not (Test-Path (Join-Path $b1ws '.kairo\project.yaml'))) {
  Write-Host "Refreshing B1 workspace from legacy-sample (missing .kairo)"
  node -e "const h=require('./scripts/test/qa/_helpers.cjs'); h.copyLegacySample(process.argv[1]);" $b1ws
}
if (-not (Test-Path (Join-Path $a3ws '.kairo\project.yaml'))) {
  node -e "const h=require('./scripts/test/qa/_helpers.cjs'); h.copyLegacySample(process.argv[1]);" $a3ws
}

function Start-TheiaBackend {
  param(
    [int]$Port,
    [int]$AgentPort,
    [string]$Secret,
    [string]$Workspace,
    [string]$Id
  )
  $logDir = Join-Path $root "artifacts\qa\$Id\logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  # Truncate old logs for this round
  Set-Content -Path (Join-Path $logDir 'theia.log') -Value '' -Encoding utf8
  Set-Content -Path (Join-Path $logDir 'theia.err.log') -Value '' -Encoding utf8
  $log = Join-Path $logDir 'theia.log'
  $err = Join-Path $logDir 'theia.err.log'
  $theia = Join-Path $root 'node_modules\.bin\theia.cmd'
  $browserDir = Join-Path $root 'apps\browser'
  $cmd = "set KAIRO_AGENT_URL=http://127.0.0.1:$AgentPort&& set KAIRO_AGENT_SECRET=$Secret&& set KAIRO_JDT_LS_JRE=$jdtJre&& set KAIRO_JDT_LS_HOME=$jdtHome&& set KAIRO_JDTLS_HOME=$jdtHome&& set KAIRO_BUNDLED_DIR=$($env:KAIRO_BUNDLED_DIR)&& cd /d `"$browserDir`"&& `"$theia`" start `"$Workspace`" --hostname=127.0.0.1 --port=$Port"
  Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmd -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden
  Write-Host "theia $Id port=$Port"
}

# B1 — use a3 workspace (has .kairo) for A3 Java LS train
$s1 = Start-KairoAgent -Port 18101 -DataDir (Join-Path $root 'artifacts\qa\b1\data')
Write-Host ("b1 agent health: " + (Wait-Health -Url 'http://127.0.0.1:18101/api/v1/health'))
Start-TheiaBackend -Port 3001 -AgentPort 18101 -Secret $s1 -Workspace $a3ws -Id 'b1'

Start-Sleep -Seconds 25
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/" -TimeoutSec 5 -UseBasicParsing
  Write-Host "port 3001 -> $($r.StatusCode)"
} catch {
  Write-Host "port 3001 -> DOWN"
}
