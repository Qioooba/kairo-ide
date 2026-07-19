$userPath = ((& reg.exe query 'HKCU\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$sysPath = ((& reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null) -join "`n") -replace '.*REG_(SZ|EXPAND_SZ)\s+',''
$env:Path = "$userPath;$([Environment]::ExpandEnvironmentVariables($sysPath))"
$env:JAVA_HOME = 'E:\Tools\jdk17'
$env:KAIRO_TOMCAT6_HOME = 'E:\Apps\Tomcat6\apache-tomcat-6.0.53'
$env:KAIRO_JRE17_HOME = 'E:\Tools\jdk17'

Set-Location 'G:\spaces\kairo-ide\runtime-agent'
& go.exe test -race -count=1 -timeout 300s -skip 'TestAtomicWriteJSON$|TestAtomicWriteJSON_CreatesParentDirs$|TestLoadProjectConfig_Success$|TestSaveProjectConfig$' ./... 2>&1
exit $LASTEXITCODE
