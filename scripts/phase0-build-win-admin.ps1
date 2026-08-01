# phase0-build-win-admin.ps1
# Run this from an ELEVATED PowerShell (Start-Process -Verb RunAs, or
# right-click the Start menu → "Windows PowerShell (Admin)").
# It will:
#   1. Refresh PATH from the registry
#   2. Confirm HKCU\...\AppModelUnlock\AllowDevelopmentWithoutDevLicense = 1
#   3. Grant SeCreateSymbolicLinkPrivilege to the current user via secedit
#   4. Run pnpm --filter @kairo/desktop build:win with the npmmirror env
#   5. Capture exit code + elapsed time into artifacts/windows-wave2/commands/
#
# After this script finishes successfully, return to the Mavis session
# and say "build:win done" so the orchestrator can continue with §5.4–§5.6.

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# 1) Refresh PATH
$userPath = ((& reg.exe query 'HKCU\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$sysPath  = ((& reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$env:Path = "$userPath;$([Environment]::ExpandEnvironmentVariables($sysPath))"
$env:JAVA_HOME = 'E:\Tools\jdk17'

# 2) Ensure Developer Mode bit is on (no-op if already set)
$key = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
Set-ItemProperty -Path $key -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord

# 3) Grant SeCreateSymbolicLinkPrivilege via secedit
# KAIRO_TMP: 优先写到工作区旁, 避免污染 C:\Users\Qi\AppData\Local\Temp
$KairoTmp = if ($env:KAIRO_TMP) { $env:KAIRO_TMP } else { Join-Path $PSScriptRoot '..\tmp' }
New-Item -ItemType Directory -Force -Path $KairoTmp | Out-Null
$tmpInf = Join-Path $KairoTmp 'kairo-seclink.inf'
$tmpSdb = Join-Path $KairoTmp 'kairo-seclink.sdb'
@"
[Unicode]
Unicode=yes
[Version]
signature="`$CHICAGO`$"
Revision=1
[Privilege Rights]
SeCreateSymbolicLinkPrivilege = *S-1-1-0
"@ | Out-File -FilePath $tmpInf -Encoding Unicode
& secedit /import /db $tmpSdb /cfg $tmpInf | Out-Null
& secedit /configure /db $tmpSdb | Out-Null
Write-Host "[admin] SeCreateSymbolicLinkPrivilege granted to current user (effective next logon)" -ForegroundColor Cyan

# 4) Verify the privilege is present
$priv = whoami /priv 2>$null | Select-String 'SeCreateSymbolicLinkPrivilege'
if ($priv) { Write-Host "[admin] current token has the privilege" -ForegroundColor Green }
else       { Write-Host "[admin] WARNING: privilege not in current token — start a NEW elevated PowerShell and run this script there" -ForegroundColor Yellow }

# 5) Run pnpm build:win with the npmmirror env
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

Set-Location 'G:\spaces\kairo-ide'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& pnpm.cmd --filter @kairo/desktop build:win 2>&1 | Tee-Object -FilePath 'artifacts\windows-wave2\commands\pnpm.build.win.admin.log' | Out-Null
$sw.Stop()
$result = @{
  name = 'pnpm.build.win.admin'
  cmd  = 'pnpm'
  args = @('--filter','@kairo/desktop','build:win')
  exitCode = $LASTEXITCODE
  elapsedMs = [int]$sw.ElapsedMilliseconds
  logFile = 'G:\spaces\kairo-ide\artifacts\windows-wave2\commands\pnpm.build.win.admin.log'
  mirror = 'https://npmmirror.com/mirrors/'
  capturedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5
$result | Out-File 'artifacts\windows-wave2\commands\pnpm.build.win.admin.json' -Encoding UTF8
"exit=$LASTEXITCODE  elapsed=$($sw.ElapsedMilliseconds)ms"
exit $LASTEXITCODE
