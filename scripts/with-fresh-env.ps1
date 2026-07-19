# with-fresh-env.ps1 - 给当前进程强制刷用户 PATH，再 exec 传入命令
$userPath = & reg.exe query 'HKCU\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$sysPath = & reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$sysPath = [Environment]::ExpandEnvironmentVariables($sysPath)
$env:Path = if ($userPath) { "$userPath;$sysPath" } else { $sysPath }

# 也刷 JAVA_HOME / ANT_HOME / CATALINA_HOME / GOPATH
foreach ($n in 'JAVA_HOME','ANT_HOME','CATALINA_HOME','GOPATH','GOBIN','KAIRO_TOMCAT6_HOME','KAIRO_JRE17_HOME') {
  $v = & reg.exe query 'HKCU\Environment' /v $n 2>$null |
    Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
    ForEach-Object { $_.Matches.Groups[2].Value } |
    Select-Object -First 1
  if ($v) { Set-Item -Path "Env:$n" -Value $v }
}

# 切到工作目录
Set-Location 'G:\spaces\kairo-ide'
Write-Host "[fresh] PATH length=$($env:Path.Length)" -ForegroundColor Cyan

# 执行传入脚本块
$sb = $args[0]
& ([scriptblock]::Create($sb))
