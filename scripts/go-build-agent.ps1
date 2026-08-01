# go-build-agent.ps1
$userPath = ((& reg.exe query 'HKCU\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$sysPath  = ((& reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$env:Path = "$userPath;$([Environment]::ExpandEnvironmentVariables($sysPath))"
$env:JAVA_HOME = 'E:\Tools\jdk17'

$RepoRoot = 'G:\spaces\kairo-ide'
$RuntimeAgentDir = Join-Path $RepoRoot 'runtime-agent'
$BinDir = Join-Path $RuntimeAgentDir 'bin'
$OutPath = Join-Path $BinDir 'kairo-runtime.exe'

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Set-Location $RuntimeAgentDir
& go.exe build -trimpath -o $OutPath .\cmd\kairo-runtime 2>&1
"exit=$LASTEXITCODE"
exit $LASTEXITCODE
