# download-batch.ps1 — 并行下载 ant/tomcat/nsis
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$Dest = 'C:\Users\Qi\AppData\Local\Temp\kairo-install'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$jobs = @(
  @{ n='ant';    u='https://archive.apache.org/dist/ant/binaries/apache-ant-1.10.15-bin.zip' }
  @{ n='tomcat'; u='https://archive.apache.org/dist/tomcat/tomcat-6/v6.0.53/bin/apache-tomcat-6.0.53.zip' }
  @{ n='nsis';   u='https://nchc.dl.sourceforge.net/project/nsis/NSIS%203/NSIS%203.10/nsis-3.10.zip' }
)

$running = @()
foreach ($j in $jobs) {
  $out = "$Dest\$($j.n).zip"
  $log = "E:\Tools\_install_logs\$($j.n).log"
  "started $($j.n) at $(Get-Date -Format 'HH:mm:ss')" | Out-File $log
  $p = Start-Process -FilePath 'curl.exe' -ArgumentList @(
    '-L','--retry','8','--retry-delay','3','--retry-all-errors',
    '--connect-timeout','30','--max-time','1800',
    '-o',$out,$j.u
  ) -WindowStyle Hidden -PassThru -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err"
  $running += [PSCustomObject]@{ n=$j.n; pid=$p.Id; out=$out; log=$log }
}

# wait up to 10 minutes
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline -and $running.Count -gt 0) {
  Start-Sleep -Seconds 10
  $still = @()
  foreach ($r in $running) {
    $alive = Get-Process -Id $r.pid -ErrorAction SilentlyContinue
    if ($alive) {
      $still += $r
    } else {
      if (Test-Path $r.out) {
        $sz = (Get-Item $r.out).Length
        "OK $sz bytes at $(Get-Date -Format 'HH:mm:ss')" | Out-File -Append $r.log
      } else {
        "FAIL no file" | Out-File -Append $r.log
      }
    }
  }
  $running = $still
  "still running: $($running.n -join ',')" | Out-File "E:\Tools\_install_logs\batch-status.log" -Append
}

foreach ($r in $running) {
  Stop-Process -Id $r.pid -Force -ErrorAction SilentlyContinue
  "TIMEOUT killed" | Out-File -Append $r.log
}
"all done at $(Get-Date -Format 'HH:mm:ss')" | Out-File "E:\Tools\_install_logs\batch-status.log" -Append
