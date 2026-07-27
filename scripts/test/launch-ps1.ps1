# Launch Kairo IDE with proper env for testing
$ErrorActionPreference = 'Stop'
$env:KAIRO_DESKTOP_LOG_FILE = 'G:\spaces\kairo-ide\artifacts\e2e-windows\desktop-main.log'
$env:KAIRO_DEV = '1'
$env:KAIRO_NO_DEVTOOLS = '0'

$exe = 'G:\spaces\kairo-ide\dist\win-unpacked\Kairo IDE.exe'
$userData = 'G:\spaces\kairo-ide\artifacts\e2e-windows\userdata'

if (-not (Test-Path $exe)) {
  Write-Host "ERROR: exe not found: $exe"
  exit 1
}

if (Test-Path $userData) {
  Remove-Item -Recurse -Force $userData -ErrorAction SilentlyContinue
}

Write-Host "Launching: $exe"
$proc = Start-Process -FilePath $exe -ArgumentList "--user-data-dir=$userData" -PassThru
Write-Host "Started PID: $($proc.Id)"
