# download-batch.ps1 — 并行下载 ant/tomcat/nsis
#
# 注意：这是开发环境批下载脚本，不参与生产构建。
# 生产构建请使用 scripts/prepare-bundled.ps1 + scripts/supply-chain-lock.json，
# 后者通过环境变量配置归档 URL 与 SHA-256（KAIRO_*_ARCHIVE_URL / KAIRO_*_SHA256），
# 并在 -Strict 模式下做完整性校验。
#
# SHA-256 校验（可选，向后兼容）：
#   在 $jobs 哈希表中为每项添加 'sha256' 键即可启用下载后校验；
#   未提供则跳过校验。获取方法：curl -sL <url> | sha256sum
#
# Tomcat URL 与 install-tools.ps1 的差异：
#   install-tools.ps1 下载 apache-tomcat-6.0.53-windows-x64.zip（含 Windows 专用本地二进制，
#   供 install-tools.ps1 直接配置 CATALINA_HOME 使用）；
#   本脚本下载 apache-tomcat-6.0.53.zip（跨平台通用包），二者均可用于开发环境。
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
# KAIRO_TMP: 优先写到工作区旁, 避免污染 C:\Users\Qi\AppData\Local\Temp
$KairoTmp = if ($env:KAIRO_TMP) { $env:KAIRO_TMP } else { Join-Path $PSScriptRoot '..\tmp' }
New-Item -ItemType Directory -Force -Path $KairoTmp | Out-Null
$Dest = Join-Path $KairoTmp 'kairo-install'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$jobs = @(
  @{ n='ant';    u='https://archive.apache.org/dist/ant/binaries/apache-ant-1.10.15-bin.zip';                                       sha256='' }
  @{ n='tomcat'; u='https://archive.apache.org/dist/tomcat/tomcat-6/v6.0.53/bin/apache-tomcat-6.0.53.zip';                          sha256='' }
  @{ n='nsis';   u='https://nchc.dl.sourceforge.net/project/nsis/NSIS%203/NSIS%203.10/nsis-3.10.zip';                               sha256='' }
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
  $running += [PSCustomObject]@{ n=$j.n; pid=$p.Id; out=$out; log=$log; sha256=$j.sha256 }
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
        if ($r.sha256) {
          $actual = (Get-FileHash -Algorithm SHA256 -Path $r.out).Hash.ToLower()
          $expected = $r.sha256.ToLower()
          if ($actual -ne $expected) {
            "SHA256 MISMATCH expected=$expected actual=$actual" | Out-File -Append $r.log
            Remove-Item $r.out -Force -ErrorAction SilentlyContinue
          } else {
            "SHA256 OK $actual" | Out-File -Append $r.log
          }
        }
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
