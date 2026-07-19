# check-env-fresh.ps1 - 强制从注册表重读 PATH，再跑 probe
$ErrorActionPreference = 'Stop'

# 从 HKCU\Environment 拿用户 PATH，跟 system PATH 合并
$userPath = & reg.exe query 'HKCU\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
$sysPath = & reg.exe query 'HKLM\System\CurrentControlSet\Control\Session Manager\Environment' /v Path 2>$null |
  Select-String -Pattern 'REG_(SZ|EXPAND_SZ)\s+(.+)$' |
  ForEach-Object { $_.Matches.Groups[2].Value } |
  Select-Object -First 1
# 展开 REG_EXPAND_SZ
$sysPath = [Environment]::ExpandEnvironmentVariables($sysPath)
$merged = if ($userPath) { "$userPath;$sysPath" } else { $sysPath }
$env:Path = $merged
Write-Host "[fresh] PATH reloaded, length=$($merged.Length)" -ForegroundColor Cyan

# 现在跑 worker 4 的 check-env.ps1
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'G:\spaces\kairo-ide\scripts\check-env.ps1'
