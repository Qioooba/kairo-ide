# restart-theia.ps1 [-Workspace path] — 只重启 Theia(18301)，不碰其他 node 进程
param(
  [string]$Workspace = "G:\spaces\kairo-ide\legacy-sample",
  [switch]$Build,
  [switch]$PostBuild
)
$root = "G:\spaces\kairo-ide"
# 1) stop listeners on 18301 (theia backend tree)
$conns = Get-NetTCPConnection -LocalPort 18301 -State Listen -ErrorAction SilentlyContinue
$pids = @()
foreach ($c in $conns) { $pids += $c.OwningProcess }
# include child node processes of those pids (theia spawns workers)
foreach ($p in $pids) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | ForEach-Object { $pids += $_.ProcessId }
}
$pids = $pids | Sort-Object -Unique
foreach ($p in $pids) {
  try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Write-Host "stopped $p" } catch {}
}
Start-Sleep -Seconds 2
if ($Build) {
  Push-Location $root
  pnpm --filter @kairo/browser exec theia build --mode production 2>&1 | Select-Object -Last 2
  Pop-Location
}
if ($PostBuild) {
  Push-Location "$root\apps\browser"
  node postbuild.cjs 2>&1 | Select-String "worker window|polyfill injected|patched successfully|already patched" | Select-Object -First 6
  Pop-Location
}
Start-Process -FilePath "pnpm" -ArgumentList "--filter @kairo/browser exec theia start $Workspace --hostname=127.0.0.1 --port=18301" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\tmp\theia-wd-out.log" -RedirectStandardError "$root\tmp\theia-wd-err.log"
Start-Sleep -Seconds 8
$up = $false
foreach ($i in 1..15) {
  Start-Sleep -Seconds 2
  try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:18301/" -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $up = $true; break } } catch {}
}
Write-Host ("THEIA " + $(if ($up) { "UP" } else { "DOWN" }))
