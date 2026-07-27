# 冒烟测试:启动 Kairo.exe,25s 后看进程状态
$exe = "C:\Users\Qi\AppData\Local\Temp\kairo-smoke2\Kairo.exe"
$logDir = "C:\Users\Qi\AppData\Local\Temp\kairo-smoke-logs"
if (Test-Path $logDir) { Remove-Item $logDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdoutLog = Join-Path $logDir "kairo-stdout.log"
$stderrLog = Join-Path $logDir "kairo-stderr.log"
Write-Host "启动 $exe ..."
$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Normal -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
Write-Host "Kairo.exe PID = $($proc.Id)"
Start-Sleep -Seconds 25
Write-Host "`n[25s 后进程状态]"
Get-Process | Where-Object {
    $_.Path -like "*kairo-smoke*" -or $_.ProcessName -eq "kairo-runtime"
} | Select-Object Id,ProcessName,Path,@{N="WS(MB)";E={[math]::Round($_.WorkingSet64/1MB,1)}},StartTime,MainWindowTitle | Format-Table -AutoSize -Wrap
Write-Host "`n[stdout 末尾]"
if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Tail 30 }
Write-Host "`n[stderr 末尾]"
if (Test-Path $stderrLog) { Get-Content $stderrLog -Tail 30 }
Write-Host "`n[resources 目录]"
$resourcesDir = "C:\Users\Qi\AppData\Local\Temp\kairo-smoke\resources"
if (Test-Path $resourcesDir) {
    Get-ChildItem $resourcesDir -Directory | Select-Object Name,@{N="Size(MB)";E={[math]::Round((Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB,1)}} | Format-Table -AutoSize
}
Write-Host "`n[检查端口 3000-3100]"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3100 } | Select-Object LocalPort,OwningProcess | Format-Table -AutoSize
