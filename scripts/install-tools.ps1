# install-tools.ps1 — Windows Test Readiness 环境装机脚本
# 用户偏好：E 盘，不动 machine PATH（避免管理员权限），用户级 PATH 追加
# 来源约定：全部 zip 解压（msiexec /qn 易 1603、winget 装桌面工具易 0x80073CF6）

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$TOOLS    = 'E:\Tools'
$APPS     = 'E:\Apps'
$DOWNLOAD = Join-Path $env:TEMP 'kairo-install'
New-Item -ItemType Directory -Force -Path $DOWNLOAD | Out-Null

function Get-File {
  param([string]$Url, [string]$Out)
  Write-Host "[fetch] $Url -> $Out"
  # github.com 直连不稳（21s TCP 超时），走 ghproxy.com 镜像
  $real = $Url
  if ($Url -like '*github.com*' -or $Url -like '*githubusercontent.com*' -or $Url -like '*releases/*') {
    $real = "https://ghproxy.com/$Url"
  }
  # curl --connect-timeout 15 避免单连接卡死
  & curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 600 -o $Out $real
  if ($LASTEXITCODE -ne 0) { throw "download failed: $real" }
}

function Expand-Zip {
  param([string]$Zip, [string]$Dest)
  Write-Host "[expand] $Zip -> $Dest"
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Expand-Archive -Path $Zip -DestinationPath $Dest -Force
}

function Add-UserPath {
  param([string]$Dir)
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($cur -notlike "*$Dir*") {
    Write-Host "[path]  + $Dir"
    [Environment]::SetEnvironmentVariable('Path', "$cur;$Dir", 'User')
    $env:Path = "$env:Path;$Dir"
  }
}

# === 1) pnpm via npm（corepack 0.31 自带 keyset 跟新 pnpm 不匹配，改用 npm 全局装）===
Write-Host "`n=== [1/6] pnpm via npm ==="
# 用独立 prefix 装到 E:\Tools\pnpm，避免污染 E:\Tools\nodejs
$pnpmPrefix = 'E:\Tools\pnpm'
New-Item -ItemType Directory -Force -Path $pnpmPrefix | Out-Null
$env:NPM_CONFIG_PREFIX = $pnpmPrefix
[Environment]::SetEnvironmentVariable('NPM_CONFIG_PREFIX', $pnpmPrefix, 'User')
& 'E:\Tools\nodejs\npm.cmd' install -g pnpm@9.15.9
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
Add-UserPath "$pnpmPrefix"
& "$pnpmPrefix\pnpm.cmd" --version

# === 2) Go 1.23 ===
# 第一次运行时已下载到 E:\Tools\Go\go\，跳过重新下载；幂等
Write-Host "`n=== [2/6] Go 1.23 ==="
$goBin = "$TOOLS\Go\go\bin"
if (-not (Test-Path "$goBin\go.exe")) {
  $goZip = Join-Path $DOWNLOAD 'go.zip'
  Get-File 'https://go.dev/dl/go1.23.4.windows-amd64.zip' $goZip
  $tmp = Join-Path $DOWNLOAD 'go-extract'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Expand-Zip $goZip $tmp
  $goInner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $TOOLS\Go | Out-Null
  Move-Item $goInner.FullName "$TOOLS\Go\go"
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Add-UserPath $goBin
$env:GOPATH = 'E:\Tools\Go-GoPath'
$env:GOBIN  = "$env:GOPATH\bin"
New-Item -ItemType Directory -Force -Path $env:GOBIN -ErrorAction SilentlyContinue | Out-Null
[Environment]::SetEnvironmentVariable('GOPATH', $env:GOPATH, 'User')
[Environment]::SetEnvironmentVariable('GOBIN',  $env:GOBIN,  'User')
& "$goBin\go.exe" version

# === 3) Temurin JDK 17 ===
Write-Host "`n=== [3/6] Temurin JDK 17 ==="
$jdkZip = Join-Path $DOWNLOAD 'jdk17.zip'
Get-File 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk' $jdkZip
if (Test-Path "$TOOLS\jdk17") { Remove-Item "$TOOLS\jdk17" -Recurse -Force }
# adoptium zip 内顶层是 jdk-17.x.x 这种目录，重命名到 jdk17
$tmp = Join-Path $DOWNLOAD 'jdk17-extract'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Expand-Zip $jdkZip $tmp
$jdkInner = Get-ChildItem $tmp -Directory | Select-Object -First 1
Move-Item $jdkInner.FullName "$TOOLS\jdk17"
Remove-Item $tmp -Recurse -Force
$env:JAVA_HOME = "$TOOLS\jdk17"
[Environment]::SetEnvironmentVariable('JAVA_HOME', $env:JAVA_HOME, 'User')
Add-UserPath "$env:JAVA_HOME\bin"
& "$env:JAVA_HOME\bin\java.exe" -version

# === 4) Apache Ant ===
Write-Host "`n=== [4/6] Apache Ant 1.10.15 ==="
$antZip = Join-Path $DOWNLOAD 'ant.zip'
Get-File 'https://archive.apache.org/dist/ant/binaries/apache-ant-1.10.15-bin.zip' $antZip
if (Test-Path "$TOOLS\Ant") { Remove-Item "$TOOLS\Ant" -Recurse -Force }
Expand-Zip $antZip "$TOOLS\Ant"
$env:ANT_HOME = "$TOOLS\Ant\apache-ant-1.10.15"
[Environment]::SetEnvironmentVariable('ANT_HOME', $env:ANT_HOME, 'User')
Add-UserPath "$env:ANT_HOME\bin"
& "$env:ANT_HOME\bin\ant.cmd" -version

# === 5) Tomcat 6.0.53 ===
Write-Host "`n=== [5/6] Tomcat 6.0.53 ==="
$tcZip = Join-Path $DOWNLOAD 'tomcat6.zip'
Get-File 'https://archive.apache.org/dist/tomcat/tomcat-6/v6.0.53/bin/apache-tomcat-6.0.53-windows-x64.zip' $tcZip
if (Test-Path "$APPS\Tomcat6") { Remove-Item "$APPS\Tomcat6" -Recurse -Force }
Expand-Zip $tcZip "$APPS\Tomcat6"
$env:CATALINA_HOME = "$APPS\Tomcat6\apache-tomcat-6.0.53"
[Environment]::SetEnvironmentVariable('CATALINA_HOME', $env:CATALINA_HOME, 'User')
Add-UserPath "$env:CATALINA_HOME\bin"
& "$env:CATALINA_HOME\bin\version.cmd" 2>$null | Select-Object -First 5

# === 6) NSIS 3.10 ===
Write-Host "`n=== [6/6] NSIS 3.10 ==="
$nsisZip = Join-Path $DOWNLOAD 'nsis.zip'
# SourceForge 镜像，3.10 是稳定版
Get-File 'https://nchc.dl.sourceforge.net/project/nsis/NSIS%203/NSIS%203.10/nsis-3.10.zip' $nsisZip
if (Test-Path "$TOOLS\NSIS") { Remove-Item "$TOOLS\NSIS" -Recurse -Force }
Expand-Zip $nsisZip "$TOOLS\NSIS"
Add-UserPath "$TOOLS\NSIS"
& "$TOOLS\NSIS\makensis.exe" /VERSION

Write-Host "`n=== ALL DONE ==="
Write-Host "如果某个 makensis / version 没出，请新开一个 PowerShell 让 PATH 刷新"
