# Start browser instances B1–B6 for Round 10 full matrix
$ErrorActionPreference = 'Continue'
$root = 'G:\spaces\kairo-ide'
Set-Location $root

# Ensure agent binary exists
$agent = Join-Path $root 'runtime-agent\bin\kairo-runtime.exe'
if (-not (Test-Path $agent)) {
  powershell -File (Join-Path $root 'scripts\go-build-agent.ps1')
}

Write-Host "=== Starting B1 ==="
powershell -File (Join-Path $root 'scripts\test\qa\start-b1-b3.ps1')

Write-Host "=== Starting B2 B3 B4 B5 ==="
powershell -File (Join-Path $root 'scripts\test\qa\start-b2-b3.ps1') b2 b3 b4 b5

# B6 for A8 (not in start-b2-b3 default list beyond b5)
Write-Host "=== Starting B6 ==="
$jdtJre = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$jdtHome = Join-Path $root 'apps\desktop\bundled\jdtls'
$env:KAIRO_JDT_LS_JRE = $jdtJre
$env:KAIRO_JDT_LS_HOME = $jdtHome
$env:KAIRO_JDTLS_HOME = $jdtHome
$env:KAIRO_BUNDLED_DIR = Join-Path $root 'apps\desktop\bundled'

function New-Secret {
  -join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
}
function Stop-PortListeners([int]$Port) {
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id $_ -Force -EA SilentlyContinue }
  } catch {}
}

$ws6 = Join-Path $root 'artifacts\qa\a8\workspace'
New-Item -ItemType Directory -Force -Path $ws6 | Out-Null
if (-not (Test-Path (Join-Path $ws6 '.kairo\project.yaml'))) {
  node -e "const h=require('./scripts/test/qa/_helpers.cjs'); h.copyLegacySample(process.argv[1]);" $ws6
}
$data6 = Join-Path $root 'artifacts\qa\b6\data'
New-Item -ItemType Directory -Force -Path $data6 | Out-Null
Stop-PortListeners 18106
Stop-PortListeners 3006
Start-Sleep -Seconds 1
$secret = New-Secret
# Pass secret via env so it never appears in process listings (S1).
$env:KAIRO_LOCAL_SECRET = $secret
$proc = Start-Process -FilePath $agent -ArgumentList @(
  '--bind','127.0.0.1','--port','18106','--data-dir',$data6,'--log-level','info'
) -PassThru -WindowStyle Hidden
Write-Host "agent b6 port=18106 pid=$($proc.Id)"

$logDir = Join-Path $root 'artifacts\qa\b6\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'theia.log'
$err = Join-Path $logDir 'theia.err.log'
Set-Content $log '' -Encoding utf8
Set-Content $err '' -Encoding utf8
$theia = Join-Path $root 'node_modules\.bin\theia.cmd'
$browserDir = Join-Path $root 'apps\browser'
$cmd = "set KAIRO_AGENT_URL=http://127.0.0.1:18106&& set KAIRO_AGENT_SECRET=$secret&& set KAIRO_JDT_LS_JRE=$jdtJre&& set KAIRO_JDT_LS_HOME=$jdtHome&& set KAIRO_JDTLS_HOME=$jdtHome&& set KAIRO_BUNDLED_DIR=$($env:KAIRO_BUNDLED_DIR)&& cd /d `"$browserDir`"&& `"$theia`" start `"$ws6`" --hostname=127.0.0.1 --port=3006"
Start-Process -FilePath cmd.exe -ArgumentList '/c', $cmd -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden
Write-Host 'theia b6 port=3006'

Write-Host 'Waiting 25s for Theia boot...'
Start-Sleep -Seconds 25
foreach ($port in @(3001,3002,3003,3004,3005,3006)) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 4 -UseBasicParsing
    Write-Host "port $port -> $($r.StatusCode)"
  } catch {
    Write-Host "port $port -> DOWN"
  }
}
Write-Host 'Browser fleet ready'
