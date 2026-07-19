# phase0-ignore-scripts-install.ps1 - pnpm install --ignore-scripts + capture
$userPath = ((& reg.exe query 'HKCU\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$sysPath = ((& reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$env:Path = "$userPath;$([Environment]::ExpandEnvironmentVariables($sysPath))"
$env:JAVA_HOME = 'E:\Tools\jdk17'

Set-Location 'G:\spaces\kairo-ide'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& pnpm.cmd install --frozen-lockfile --ignore-scripts 2>&1 | Tee-Object -FilePath 'artifacts\windows-wave2\commands\pnpm.install.ignore-scripts.log' | Out-Null
$sw.Stop()
$result = @{
  name = 'pnpm.install.ignore-scripts'
  cmd  = 'pnpm'
  args = @('install','--frozen-lockfile','--ignore-scripts')
  exitCode = $LASTEXITCODE
  elapsedMs = [int]$sw.ElapsedMilliseconds
  logFile = 'G:\spaces\kairo-ide\artifacts\windows-wave2\commands\pnpm.install.ignore-scripts.log'
  capturedAt = (Get-Date).ToString('o')
} | ConvertTo-Json
$result | Out-File 'artifacts\windows-wave2\commands\pnpm.install.ignore-scripts.json' -Encoding UTF8
"exit=$LASTEXITCODE  elapsed=$($sw.ElapsedMilliseconds)ms"
exit $LASTEXITCODE
