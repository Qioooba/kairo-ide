# go-build-agent.ps1
$userPath = ((& reg.exe query 'HKCU\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$sysPath  = ((& reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$env:Path = "$userPath;$([Environment]::ExpandEnvironmentVariables($sysPath))"
$env:JAVA_HOME = 'E:\Tools\jdk17'

Set-Location 'G:\spaces\kairo-ide\runtime-agent'
& go.exe build -trimpath -o 'kairo-runtime.exe' .\cmd\kairo-runtime 2>&1
"exit=$LASTEXITCODE"
exit $LASTEXITCODE
