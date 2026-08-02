$ErrorActionPreference = 'Continue'
$root = 'G:\spaces\kairo-ide'
$agent = Join-Path $root 'runtime-agent\bin\kairo-runtime.exe'

function New-Secret {
  # Must sample WITH replacement — Get-Random -Count on a 16-char alphabet
  # returns at most 16 unique chars (caused 16-char secrets and auth flakes).
  -join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
}

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    try {
      Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
          Write-Host "Stopping PID $_ on port $port"
          Stop-Process -Id $_ -Force -EA SilentlyContinue
        }
    } catch {}
  }
}

function Start-KairoAgent {
  param([int]$Port, [string]$DataDir)
  Stop-PortListeners -Ports @($Port)
  Start-Sleep -Seconds 1
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
  param([string]$Url, [int]$Seconds = 30)
  for ($i = 0; $i -lt $Seconds; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

$jdtJre = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$jdtHome = Join-Path $root 'apps\desktop\bundled\jdtls'
$env:KAIRO_JDT_LS_JRE = $jdtJre
$env:KAIRO_JDT_LS_HOME = $jdtHome
$env:KAIRO_JDTLS_HOME = $jdtHome
$env:KAIRO_BUNDLED_DIR = Join-Path $root 'apps\desktop\bundled'

function Ensure-Workspace {
  param([string]$Ws)
  New-Item -ItemType Directory -Force -Path $Ws | Out-Null
  if (-not (Test-Path (Join-Path $Ws '.kairo\project.yaml'))) {
    Write-Host "Seeding $Ws from legacy-sample"
    node -e "const h=require('./scripts/test/qa/_helpers.cjs'); h.copyLegacySample(process.argv[1]);" $Ws
  }
}

function Start-TheiaBackend {
  param(
    [int]$Port,
    [int]$AgentPort,
    [string]$Secret,
    [string]$Workspace,
    [string]$Id
  )
  Stop-PortListeners -Ports @($Port)
  Start-Sleep -Seconds 1
  $logDir = Join-Path $root "artifacts\qa\$Id\logs"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
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

$targets = @()
if ($args.Count -eq 0) {
  $targets = @('b2', 'b3')
} else {
  $targets = $args | ForEach-Object { $_.ToLower() }
}

foreach ($t in $targets) {
  switch ($t) {
    'b2' {
      $ws = Join-Path $root 'artifacts\qa\a4\workspace'
      Ensure-Workspace $ws
      $secret = Start-KairoAgent -Port 18102 -DataDir (Join-Path $root 'artifacts\qa\b2\data')
      Write-Host ("b2 agent health: " + (Wait-Health -Url 'http://127.0.0.1:18102/api/v1/health'))
      Start-TheiaBackend -Port 3002 -AgentPort 18102 -Secret $secret -Workspace $ws -Id 'b2'
    }
    'b3' {
      $ws = Join-Path $root 'artifacts\qa\a5\workspace'
      Ensure-Workspace $ws
      $secret = Start-KairoAgent -Port 18103 -DataDir (Join-Path $root 'artifacts\qa\b3\data')
      Write-Host ("b3 agent health: " + (Wait-Health -Url 'http://127.0.0.1:18103/api/v1/health'))
      Start-TheiaBackend -Port 3003 -AgentPort 18103 -Secret $secret -Workspace $ws -Id 'b3'
    }
    'b1' {
      $ws = Join-Path $root 'artifacts\qa\a3\workspace'
      Ensure-Workspace $ws
      $secret = Start-KairoAgent -Port 18101 -DataDir (Join-Path $root 'artifacts\qa\b1\data')
      Write-Host ("b1 agent health: " + (Wait-Health -Url 'http://127.0.0.1:18101/api/v1/health'))
      Start-TheiaBackend -Port 3001 -AgentPort 18101 -Secret $secret -Workspace $ws -Id 'b1'
    }
    'b4' {
      $ws = Join-Path $root 'artifacts\qa\a6\workspace'
      if (-not (Test-Path (Join-Path $ws '.svn'))) {
        # Prefer existing SVN checkout from prior A6 runs
        Ensure-Workspace $ws
      }
      $secret = Start-KairoAgent -Port 18104 -DataDir (Join-Path $root 'artifacts\qa\b4\data')
      Write-Host ("b4 agent health: " + (Wait-Health -Url 'http://127.0.0.1:18104/api/v1/health'))
      Start-TheiaBackend -Port 3004 -AgentPort 18104 -Secret $secret -Workspace $ws -Id 'b4'
    }
    'b5' {
      $ws = Join-Path $root 'artifacts\qa\a7\workspace'
      Ensure-Workspace $ws
      $secret = Start-KairoAgent -Port 18105 -DataDir (Join-Path $root 'artifacts\qa\b5\data')
      Write-Host ("b5 agent health: " + (Wait-Health -Url 'http://127.0.0.1:18105/api/v1/health'))
      Start-TheiaBackend -Port 3005 -AgentPort 18105 -Secret $secret -Workspace $ws -Id 'b5'
    }
    default { Write-Host "Unknown target: $t (use b1/b2/b3/b4/b5)" }
  }
}

Write-Host 'Waiting 20s for Theia boot...'
Start-Sleep -Seconds 20
foreach ($port in @(3001, 3002, 3003, 3004, 3005)) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 4 -UseBasicParsing
    Write-Host "port $port -> $($r.StatusCode)"
  } catch {
    Write-Host "port $port -> DOWN"
  }
}
