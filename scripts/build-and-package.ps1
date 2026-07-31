# build-and-package.ps1 — Kairo IDE 一键构建 + 分卷打包脚本
#
# 功能:
#   1. 构建浏览器前端 (browser app)
#   2. 构建 Go Runtime Agent
#   3. 准备 bundled 资源 (Tomcat 6, JDT LS)
#   4. 拷贝浏览器产物到 desktop
#   5. 编译 TypeScript
#   6. electron-builder 打包 Windows zip
#   7. 创建分卷压缩 (每卷 ≤ 70MB)
#
# 用法:
#   .\scripts\build-and-package.ps1
#   .\scripts\build-and-package.ps1 -VolumeSize 50  # 自定义分卷大小(MB)
#   .\scripts\build-and-package.ps1 -SkipBuild        # 跳过构建,仅打包
#   .\scripts\build-and-package.ps1 -SkipSplit        # 不创建分卷压缩
#
# 环境变量 (可选):
#   $env:KAIRO_TOMCAT6_HOME = "E:\Apps\Tomcat6\apache-tomcat-6.0.53"  # 本地 Tomcat 6
#   $env:KAIRO_JDTLS_HOME   = "E:\Apps\eclipse-jdt-ls"                 # 本地 JDT LS
#   $env:KAIRO_JDTLS_ARCHIVE = "D:\jdtls-1.55.0.tar.gz"                # JDT LS 归档
#
# 产物:
#   apps/desktop/dist/Kairo-0.1.0-win.zip          (完整安装包)
#   apps/desktop/dist/KairoIDE-v0.1.0-win-x64.7z.* (分卷压缩包)

[CmdletBinding()]
param(
    [int]$VolumeSize = 70,
    [switch]$SkipBuild,
    [switch]$SkipSplit,
    [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ─── 路径 ──────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "..")
$DesktopDir = Join-Path $RepoRoot "apps/desktop"
$DistDir    = Join-Path $DesktopDir "dist"
$ZipName    = "Kairo-0.1.0-win.zip"
$ZipPath    = Join-Path $DistDir $ZipName
$SplitBase  = "KairoIDE-v0.1.0-win-x64"

# ─── 颜色输出 ──────────────────────────────────────────────
function Step($msg)   { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Ok($msg)     { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Warn($msg)   { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Err($msg)    { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }

# ─── 标题 ──────────────────────────────────────────────────
$banner = @"
╔══════════════════════════════════════════════════════════╗
║   Kairo IDE — 一键构建 + 分卷打包                          ║
║   分卷大小: ${VolumeSize}MB / 卷                              ║
╚══════════════════════════════════════════════════════════╝
"@
Write-Host $banner -ForegroundColor Cyan

# ─── 阶段 1: 构建 ──────────────────────────────────────────
if (-not $SkipBuild) {
    Step "阶段 1/5: 构建浏览器前端"
    Push-Location $RepoRoot
    try {
        pnpm --filter @kairo/browser build
        if ($LASTEXITCODE -ne 0) { Err "浏览器构建失败" }
        Ok "浏览器前端构建完成"
    } finally { Pop-Location }

    Step "阶段 2/5: 构建 Go Runtime Agent"
    Push-Location $DesktopDir
    try {
        node scripts/build-agent.js
        if ($LASTEXITCODE -ne 0) { Err "Go Agent 构建失败" }
        Ok "Go Runtime Agent 构建完成"
    } finally { Pop-Location }

    Step "阶段 3/5: 准备 bundled 资源"
    $bundledDir = Join-Path $DesktopDir "bundled"

    # Tomcat 6
    $tomcatTarget = Join-Path $bundledDir "tomcat6/apache-tomcat-6.0.53"
    if ((Test-Path $tomcatTarget) -and (Get-ChildItem $tomcatTarget -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        Ok "Tomcat 6 已就绪"
    } elseif ($env:KAIRO_TOMCAT6_HOME -and (Test-Path $env:KAIRO_TOMCAT6_HOME)) {
        Warn "正在从 KAIRO_TOMCAT6_HOME 复制 Tomcat 6..."
        New-Item -ItemType Directory -Force -Path $tomcatTarget | Out-Null
        robocopy $env:KAIRO_TOMCAT6_HOME $tomcatTarget /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Err "Tomcat 6 复制失败" }
        Ok "Tomcat 6 复制完成"
    } else {
        Err @"
缺少 Tomcat 6 运行时。
请设置环境变量:
  `$env:KAIRO_TOMCAT6_HOME = 'E:\Apps\Tomcat6\apache-tomcat-6.0.53'
或手动复制到: $tomcatTarget
"@
    }

    # JDT LS
    $jdtlsTarget = Join-Path $bundledDir "jdtls"
    $jdtlsMarker = Join-Path $jdtlsTarget "config_win/config.ini"
    if ((Test-Path $jdtlsMarker)) {
        Ok "JDT LS 已就绪"
    } elseif ($env:KAIRO_JDTLS_ARCHIVE -and (Test-Path $env:KAIRO_JDTLS_ARCHIVE)) {
        Warn "正在从 KAIRO_JDTLS_ARCHIVE 解压 JDT LS..."
        Remove-Item $jdtlsTarget -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $jdtlsTarget | Out-Null
        tar -xf $env:KAIRO_JDTLS_ARCHIVE -C $jdtlsTarget
        if ($LASTEXITCODE -ne 0) { Err "JDT LS 解压失败" }
        Ok "JDT LS 解压完成"
    } elseif ($env:KAIRO_JDTLS_HOME -and (Test-Path $env:KAIRO_JDTLS_HOME)) {
        Warn "正在从 KAIRO_JDTLS_HOME 复制 JDT LS..."
        Remove-Item $jdtlsTarget -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $jdtlsTarget | Out-Null
        robocopy $env:KAIRO_JDTLS_HOME $jdtlsTarget /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Err "JDT LS 复制失败" }
        Ok "JDT LS 复制完成"
    } else {
        Warn "JDT LS 未找到。Java 智能提示将不可用。"
        Warn "设置 KAIRO_JDTLS_HOME 或 KAIRO_JDTLS_ARCHIVE 环境变量可包含 JDT LS。"
        New-Item -ItemType Directory -Force -Path $jdtlsTarget | Out-Null
        New-Item -ItemType File -Force -Path "$jdtlsTarget/PLACEHOLDER.txt" -Value "JDT LS not bundled. Set KAIRO_JDTLS_HOME env var." | Out-Null
    }

    Step "阶段 4/5: 拷贝浏览器产物 + 编译 TypeScript"
    Push-Location $DesktopDir
    try {
        node scripts/copy-browser-artifacts.js --strict
        if ($LASTEXITCODE -ne 0) { Err "浏览器产物拷贝失败" }
        Ok "浏览器产物拷贝完成"

        pnpm tsc -p tsconfig.json
        if ($LASTEXITCODE -ne 0) { Err "TypeScript 编译失败" }
        Ok "TypeScript 编译完成"
    } finally { Pop-Location }
} else {
    Step "跳过构建阶段 (--SkipBuild)"
}

# ─── 阶段 5: electron-builder 打包 (仅 win-unpacked) ──────
Step "阶段 5/5: electron-builder 打包 (dir 模式, 仅创建目录)"

# 清理旧产物
Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue
Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $DistDir -Filter "$SplitBase.zip.*" -ErrorAction SilentlyContinue | Remove-Item -Force
Remove-Item (Join-Path $DistDir "win-unpacked") -Recurse -Force -ErrorAction SilentlyContinue

Push-Location $DesktopDir
try {
    pnpm electron-builder --win
    if ($LASTEXITCODE -ne 0) {
        $unpackedDir = Join-Path $DistDir "win-unpacked"
        if (Test-Path (Join-Path $unpackedDir "Kairo.exe")) {
            Warn "electron-builder 退出码非零,但 win-unpacked 已生成,继续..."
        } else {
            Err "electron-builder 打包失败"
        }
    }
    Ok "electron-builder 打包完成 (dir 模式)"
} finally { Pop-Location }

# ─── 生成 Kairo-Server.exe (浏览器版) ─────────────────────
Step "生成 Kairo-Server.exe (浏览器版微型 Go 包装器)"

# 编译 Go 包装器 (仅 ~2MB, 替代 201MB 的 Kairo.exe 副本)
$launcherSrc = Join-Path $RepoRoot "scripts/kairo-server-launcher.go"
$unpackedDir = Join-Path $DistDir "win-unpacked"
$serverExe = Join-Path $unpackedDir "Kairo-Server.exe"

if (Test-Path $launcherSrc) {
    $goCmd = "go build -ldflags='-s -w' -o `"$serverExe`" `"$launcherSrc`""
    iex $goCmd
    if ($LASTEXITCODE -ne 0) {
        Warn "Go 包装器编译失败,回退到复制 Kairo.exe"
        Copy-Item (Join-Path $unpackedDir "Kairo.exe") $serverExe -Force
    } else {
        $wrapperSize = [math]::Round((Get-Item $serverExe).Length / 1KB, 1)
        Ok "Kairo-Server.exe 已编译 (Go 包装器, ${wrapperSize}KB)"
    }
} else {
    Warn "未找到 kairo-server-launcher.go,回退到复制 Kairo.exe"
    Copy-Item (Join-Path $unpackedDir "Kairo.exe") $serverExe -Force
}

# ─── 清理冗余文件 ────────────────────────────────────────
Step "清理冗余文件 (减小压缩包体积)"

$removedSize = 0

# 1. 删除 LICENSES.chromium.html (14MB, 仅 Chromium 许可证文本, 用户不需要)
$licenseFile = Join-Path $unpackedDir "LICENSES.chromium.html"
if (Test-Path $licenseFile) {
    $removedSize += (Get-Item $licenseFile).Length
    Remove-Item $licenseFile -Force
    Ok "已删除 LICENSES.chromium.html"
}

# 2. 删除 LICENSE.electron.txt
$licenseFile2 = Join-Path $unpackedDir "LICENSE.electron.txt"
if (Test-Path $licenseFile2) {
    Remove-Item $licenseFile2 -Force
    Ok "已删除 LICENSE.electron.txt"
}

# 3. 删除 JDT LS 非 Windows 平台配置 (config_linux, config_mac 等)
$jdtlsDir = Join-Path $unpackedDir "resources/bundled/jdtls"
if (Test-Path $jdtlsDir) {
    Get-ChildItem $jdtlsDir -Directory | Where-Object {
        $_.Name -match 'config_(linux|mac|ss_linux|ss_mac)'
    } | ForEach-Object {
        $removedSize += (Get-ChildItem $_.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum
        Remove-Item $_.FullName -Recurse -Force
        Write-Host "  [OK]   已删除 JDT LS: $($_.Name)" -ForegroundColor Green
    }
}

if ($removedSize -gt 0) {
    $removedMB = [math]::Round($removedSize / 1MB, 2)
    Ok "共清理 $removedMB MB 冗余文件"
}

# ─── 复制启动脚本到 win-unpacked ──────────────────────────
$startCmd = Join-Path $RepoRoot "scripts/start-browser-mode.cmd"
if (Test-Path $startCmd) {
    Copy-Item $startCmd $unpackedDir -Force
    Ok "start-browser-mode.cmd 已复制到输出目录"
}

# ─── 直接从 win-unpacked 创建分卷压缩 (跳过中间 zip) ─────
Step "创建分卷压缩 (直接从 win-unpacked 目录)"

# 删除旧的分卷文件
Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" -ErrorAction SilentlyContinue | Remove-Item -Force

$splitOutput = Join-Path $DistDir "$SplitBase.7z"
Push-Location $unpackedDir
try {
    & 7z a "-v${VolumeSize}m" $splitOutput * 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Err "7z 分卷压缩失败" }
    Ok "分卷压缩完成 (直接从 win-unpacked 目录)"
} finally { Pop-Location }

# 显示分卷文件
Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" | Sort-Object Name | ForEach-Object {
    $volSize = [math]::Round($_.Length / 1MB, 2)
    Write-Host "  $($_.Name)  ($volSize MB)" -ForegroundColor White
}

# 验证分卷完整性
Step "验证分卷压缩完整性"
$firstVol = Join-Path $DistDir "$SplitBase.7z.001"
& 7z t $firstVol 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Err "分卷压缩验证失败" }
Ok "分卷压缩验证通过"

# 快速冒烟验证
if (-not $SkipSmoke -and (Test-Path (Join-Path $DistDir "win-unpacked/Kairo.exe"))) {
    $agentInDist = Join-Path $DistDir "win-unpacked/resources/bin/kairo-runtime.exe"
    if (Test-Path $agentInDist) {
        Ok "kairo-runtime.exe 已嵌入"
    } else {
        Warn "kairo-runtime.exe 未在 resources/bin/ 中找到"
    }
    $jdtlsInDist = Join-Path $DistDir "win-unpacked/resources/bundled/jdtls/config_win/config.ini"
    if (Test-Path $jdtlsInDist) {
        Ok "JDT LS 已嵌入"
    } else {
        Warn "JDT LS 未嵌入 (Java 智能提示不可用)"
    }
    $tomcatInDist = Join-Path $DistDir "win-unpacked/resources/bundled/tomcat6/apache-tomcat-6.0.53/bin/catalina.bat"
    if (Test-Path $tomcatInDist) {
        Ok "Tomcat 6 已嵌入"
    } else {
        Warn "Tomcat 6 未嵌入"
    }
    $serverExeInDist = Join-Path $DistDir "win-unpacked/Kairo-Server.exe"
    if (Test-Path $serverExeInDist) {
        $wrapperSizeKB = [math]::Round((Get-Item $serverExeInDist).Length / 1KB, 0)
        if ($wrapperSizeKB -lt 5000) {
            Ok "Kairo-Server.exe (Go 包装器, ${wrapperSizeKB}KB) — 已优化"
        } else {
            Ok "Kairo-Server.exe 已生成 (${wrapperSizeKB}KB)"
        }
    } else {
        Warn "Kairo-Server.exe 未生成"
    }
}

# ─── 分卷压缩 ──────────────────────────────────────────────
if (-not $SkipSplit) {
    Step "创建分卷压缩 (每卷 ≤ ${VolumeSize}MB)"
    $splitOutput = Join-Path $DistDir "$SplitBase.7z"
    $volCount = [math]::Ceiling($zipSizeMB / $VolumeSize)

    Write-Host "  原始大小: $zipSizeMB MB, 预计 $volCount 个分卷"

    # 删除旧的分卷文件
    Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" -ErrorAction SilentlyContinue | Remove-Item -Force

    & 7z a "-v${VolumeSize}m" $splitOutput $ZipPath 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Err "7z 分卷压缩失败" }

    Ok "分卷压缩完成"

    # 显示分卷文件
    Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" | Sort-Object Name | ForEach-Object {
        $volSize = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name)  ($volSize MB)" -ForegroundColor White
    }

    # 验证分卷完整性
    Step "验证分卷压缩完整性"
    $firstVol = Join-Path $DistDir "$SplitBase.7z.001"
    & 7z t $firstVol 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Err "分卷压缩验证失败" }
    Ok "分卷压缩验证通过"
}

# ─── 收尾 ──────────────────────────────────────────────────
$endBanner = @"

╔══════════════════════════════════════════════════════════╗
║   打包完成!                                              ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  产物位置: $($DistDir.Replace($RepoRoot, '').TrimStart('\'))
║
║  交付物 (分卷压缩,每卷 ≤ ${VolumeSize}MB):                    ║
"@
Write-Host $endBanner -ForegroundColor Green

if (-not $SkipSplit) {
    Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" | Sort-Object Name | ForEach-Object {
        $volSize = [math]::Round($_.Length / 1MB, 2)
        Write-Host "    $($_.Name) ($volSize MB)" -ForegroundColor White
    }
}

$footer = @"

║                                                          ║
║  发送给内网用户:                                          ║
║    1. 将所有 .7z.00* 文件发给用户                          ║
║    2. 用户用 7-Zip 打开 .7z.001 解压                       ║
║    3. 解压即用,无需安装                                     ║
║                                                          ║
║  启动方式:                                                ║
║    桌面版: 双击 Kairo.exe                                 ║
║    浏览器: 双击 Kairo-Server.exe                          ║
║                                                          ║
║  详细文档: docs/DEPLOY-GUIDE.md                           ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
"@
Write-Host $footer -ForegroundColor Green