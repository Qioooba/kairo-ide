# start-browser-mode.ps1 — Kairo IDE 浏览器模式 (PowerShell)
#
# 启动后端服务并自动打开浏览器,无需桌面窗口。
# 适合:
#   - 仅通过浏览器使用 IDE
#   - 在同一台机器上让多个用户访问
#   - 低资源消耗场景
#
# 用法:
#   .\start-browser-mode.ps1
#   .\start-browser-mode.ps1 -Port 3000 -NoBrowser
#
# 与桌面版的关系:
#   - 桌面版 Kairo.exe 已在运行 → 复用其代理,仅启动新后端
#   - 桌面版未运行 → 自动启动代理 + 后端
#   - 桌面版和浏览器版可同时使用,共享代理

param(
    [int]$Port = 0,          # 0 = 自动分配端口
    [switch]$NoBrowser,      # 不自动打开浏览器
    [int]$AgentPort = 18080
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# 切换到脚本所在目录
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $ScriptDir

# 检查启动方式: 优先 Kairo-Server.exe, 回退 Kairo.exe --headless
$kairoExe = $null
$kairoArgs = @()
if (Test-Path "Kairo-Server.exe") {
    $kairoExe = ".\Kairo-Server.exe"
    Write-Host "[OK] 使用 Kairo-Server.exe 启动浏览器模式" -ForegroundColor Green
} elseif (Test-Path "Kairo.exe") {
    $kairoExe = ".\Kairo.exe"
    $kairoArgs = @("--headless")
    Write-Host "[INFO] 未找到 Kairo-Server.exe, 使用 Kairo.exe --headless" -ForegroundColor Yellow
} else {
    Write-Host "[ERROR] 未找到 Kairo.exe 或 Kairo-Server.exe" -ForegroundColor Red
    Write-Host "        请将本脚本放在 Kairo 解压目录中" -ForegroundColor Yellow
    Write-Host "        当前目录: $(Get-Location)" -ForegroundColor Yellow
    pause
    exit 1
}

# 检查 JDK
$javaFound = $false
try {
    $null = Get-Command java -ErrorAction Stop
    $javaFound = $true
    Write-Host "[OK] Java 已检测到" -ForegroundColor Green
} catch {
    if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
        $javaFound = $true
        Write-Host "[OK] Java 已检测到 (JAVA_HOME=$env:JAVA_HOME)" -ForegroundColor Green
    }
}
if (-not $javaFound) {
    Write-Host "[WARN] 未检测到 Java。Java 功能将不可用。" -ForegroundColor Yellow
    Write-Host "       请安装 JDK 17+ 或设置 JAVA_HOME 环境变量" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kairo IDE — 浏览器模式" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  正在启动后端服务..." -ForegroundColor Gray
Write-Host ""

# 构建启动参数 (Kairo-Server.exe 不需要 --headless, 它自带)
if ($Port -gt 0) {
    $kairoArgs += "--port=$Port"
}

# 启动 Kairo
$proc = Start-Process -FilePath $kairoExe -ArgumentList $kairoArgs -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\kairo-headless.log" -RedirectStandardError "$env:TEMP\kairo-headless-err.log"

# 等待后端启动并发现端口
$maxWait = 60
$waited = 0
$theiaPort = 0
$logFile = "$env:TEMP\kairo-headless.log"

while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++

    if ($proc.HasExited) {
        Write-Host "[ERROR] Kairo 进程意外退出 (退出码: $($proc.ExitCode))" -ForegroundColor Red
        if (Test-Path "$env:TEMP\kairo-headless-err.log") {
            Write-Host "--- 错误日志 ---" -ForegroundColor Red
            Get-Content "$env:TEMP\kairo-headless-err.log" -Tail 20
        }
        Pop-Location
        pause
        exit 1
    }

    # 尝试从日志中发现 Theia 端口
    if (Test-Path $logFile) {
        $log = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if ($log -match "Theia:\s+http://127\.0\.0\.1:(\d+)") {
            $theiaPort = [int]$Matches[1]
            break
        }
    }
}

if ($theiaPort -eq 0) {
    Write-Host "[WARN] 未能发现后端端口,请检查日志:" -ForegroundColor Yellow
    Write-Host "       $logFile" -ForegroundColor Yellow
}

$theiaUrl = "http://127.0.0.1:$theiaPort"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Kairo IDE — 浏览器模式 已启动                          ║" -ForegroundColor Cyan
Write-Host "╠══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host ("║   IDE 地址:  $theiaUrl".PadRight(56) + "║") -ForegroundColor Green
Write-Host "║                                                          ║" -ForegroundColor Cyan
Write-Host "║   在浏览器中打开上述地址即可使用 IDE                       ║" -ForegroundColor Cyan
Write-Host "║   关闭此窗口将停止所有服务                                 ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if (-not $NoBrowser -and $theiaPort -gt 0) {
    Start-Process $theiaUrl
}

Write-Host "按 Ctrl+C 停止服务..." -ForegroundColor Yellow

# 等待进程退出
try {
    $proc.WaitForExit()
} catch {
    # Ctrl+C 会触发异常
    if (-not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "[INFO] Kairo 服务已停止" -ForegroundColor Gray
Pop-Location