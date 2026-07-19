param([string]$Filter = '.')
$userPath = & reg.exe query 'HKCU\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$sysPath = & reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$env:Path = if ($userPath) { "$userPath;$([Environment]::ExpandEnvironmentVariables($sysPath))" } else { $sysPath }
$env:JAVA_HOME = 'E:\Tools\jdk17'

Set-Location 'G:\spaces\kairo-ide\runtime-agent'
& go.exe test -count=1 -run $Filter -v ./internal/api 2>&1
exit $LASTEXITCODE
