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
Set-StrictMode -Version 2.0

# ─── 预检: 必需的工具链 ─────────────────────────────
$missing = @()
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { $missing += "pnpm" }
if (-not (Get-Command go -ErrorAction SilentlyContinue))    { $missing += "go" }
if (-not (Get-Command 7z  -ErrorAction SilentlyContinue))    { $missing += "7z" }
if ($missing.Count -gt 0) {
    Write-Host "  [FAIL] 缺少必需工具: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "         请先安装 (pnpm: npm i -g pnpm; go: https://go.dev; 7z: 7-Zip)" -ForegroundColor Red
    exit 1
}

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

# ─── 工具函数: 把被锁路径 zombie 化 ─────────────────────
# 当某目录因文件被锁(Defender / SearchHost / 上一次 Kairo.exe 残留)无法直接删除或移动时,
# 退而求其次给它加 .zombie 后缀 —— 改目录名不需要打开内部文件句柄,绝大多数情况能成功。
# zombie 后的目录在下次跑脚本时由 Invoke-StaleCleanup 清掉(见下方 glob)。
function ConvertTo-ZombiePath {
    param(
        [Parameter(Mandatory)][string]$Path
    )
    if (-not (Test-Path $Path)) { return $true }
    $leaf = Split-Path -Leaf $Path
    $zombie = "$Path.zombie"
    if (Test-Path $zombie) {
        $i = 1
        while (Test-Path "$zombie.$i") { $i++ }
        $zombie = "$zombie.$i"
    }
    $zombieLeaf = Split-Path $zombie -Leaf
    $parent = Split-Path -Parent $Path
    $quoted = '"' + $Path + '"'
    $quotedZ = '"' + $zombieLeaf + '"'
    # 优先用 cmd rename — 不打开文件内容,只改目录项
    try {
        Start-Process -FilePath cmd.exe -ArgumentList "/c","ren",$quoted,$quotedZ `
                      -Wait -PassThru -NoNewWindow `
                      -RedirectStandardOutput "$env:TEMP\_zr.out" `
                      -RedirectStandardError "$env:TEMP\_zr.err" | Out-Null
        if (Test-Path $zombie) {
            Write-Host "  [ZOMBIE] $leaf -> $zombieLeaf" -ForegroundColor DarkYellow
            return $true
        }
    } catch {}
    # 兜底: PowerShell Rename-Item
    try {
        Rename-Item -LiteralPath $Path -NewName $zombieLeaf -ErrorAction Stop
        Write-Host "  [ZOMBIE] $leaf -> $zombieLeaf" -ForegroundColor DarkYellow
        return $true
    } catch {
        Write-Host "  [STUCK]  $leaf : $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# ─── 清理上一轮残留的旁路目录 ─────────────────────────────
# 上一轮构建因文件锁产生的旁路目录(dist-locked-*, dist-stage-*,
# win-unpacked.locked-*, win-unpacked.stale-*)会留在这里。
# 默认保留最近 1 套(避免误删正在被其他进程读的那个);
# 历史版本的旧脚本可能把这些目录放在 $DesktopDir 而非 $DistDir,
# 这里同时扫两个位置以彻底回收。
function Invoke-StaleCleanup {
    param(
        [int]$KeepLatest = 1
    )

    $patterns = @(
        @{ Dir = $DistDir;    Globs = @(
            "dist-locked-*", "dist-stage-*",
            "win-unpacked.locked-*", "win-unpacked.stale-*",
            "*.zombie", "*.orphan"        # ConvertTo-ZombiePath 兜底产物
        ) },
        @{ Dir = $DesktopDir; Globs = @(
            "dist-locked-*", "dist-stage-*",
            "*.zombie", "*.orphan"        # 历史遗留 + zombie 兜底
        ) }
    )

    $removed = 0
    $freed   = 0L
    foreach ($p in $patterns) {
        if (-not (Test-Path $p.Dir)) { continue }
        foreach ($glob in $p.Globs) {
            $hits = Get-ChildItem -Path $p.Dir -Filter $glob -Force -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending
            if (-not $hits) { continue }
            $skip = [Math]::Min($KeepLatest, $hits.Count)
            $staleList = $hits | Select-Object -Skip $skip
            foreach ($s in $staleList) {
                $size = if ($s.PSIsContainer) {
                    $sum = (Get-ChildItem $s.FullName -Recurse -File -ErrorAction SilentlyContinue |
                            Measure-Object -Property Length -Sum).Sum
                    if ($null -eq $sum) { 0 } else { $sum }
                } else { $s.Length }
                Remove-Item $s.FullName -Recurse -Force -ErrorAction SilentlyContinue
                if (Test-Path $s.FullName) {
                    # 占用中(被锁/无权限)→ 改名加 .zombie 后缀,留待下次或人工回收
                    $zombie = "$($s.FullName).zombie"
                    try { Move-Item $s.FullName $zombie -Force -ErrorAction Stop }
                    catch { Write-Host "  [WARN] 无法清理: $($s.FullName)" -ForegroundColor Yellow; continue }
                    $s = Get-Item $zombie
                }
                $removed++
                $freed += $size
                $sizeStr = if ($size -gt 1MB) { "{0:N1} MB" -f ($size/1MB) } else { "{0:N0} KB" -f ($size/1KB) }
                Write-Host ("  [OK]   清理: {0,-55}  ({1})" -f $s.Name, $sizeStr) -ForegroundColor DarkGray
            }
        }
    }
    if ($removed -gt 0) {
        $freedStr = if ($freed -gt 1MB) { "{0:N1} MB" -f ($freed/1MB) } else { "{0:N0} KB" -f ($freed/1KB) }
        Ok "清理了 $removed 个旧旁路目录,释放 $freedStr"
    } else {
        Ok "无需清理 (无残留旁路目录)"
    }
}

Invoke-StaleCleanup -KeepLatest 1

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

# 注意:win-unpacked 清理失败必须显式报错,否则会掩盖文件占用问题,
# 导致后续 electron-builder 在 EnsureEmptyDir 阶段才以 ERR_ELECTRON_BUILDER_CANNOT_EXECUTE 失败。
$unpackedDir = Join-Path $DistDir "win-unpacked"
if (Test-Path $unpackedDir) {
    try {
        Remove-Item $unpackedDir -Recurse -Force -ErrorAction Stop
        Ok "已清理旧产物 win-unpacked"
    } catch {
        # 如果旧 win-unpacked 被占用(Windows Search / Defender 等系统进程持有 app.asar 句柄
        # 且未授予 FILE_SHARE_DELETE),将旧目录整体搬移到 dist-locked-<timestamp> 旁路。
        # electron-builder 将在全新的输出目录中构建,不会与被锁定的旧文件冲突。
        $stamped = "dist-locked-{0:yyyyMMdd-HHmmss}" -f (Get-Date)
        # 注: 旁路目录必须放在 $DistDir 下,这样下次构建开头清理时能一起回收。
        $staleDir = Join-Path $DistDir $stamped
        Warn "无法直接清理旧 win-unpacked ($($_.Exception.Message)),将旁路到: $stamped"
        try {
            Move-Item $unpackedDir $staleDir -Force -ErrorAction Stop
            Ok "已旁路旧产物 -> $stamped (后台可手工清理)"
        } catch {
            # 连目录也搬不动(整目录内含被锁文件),改用全新输出目录策略
            Warn "旁路旧目录也失败: $($_.Exception.Message);尝试 zombie 化后再用 stage 目录"
            if (ConvertTo-ZombiePath -Path $unpackedDir) {
                Ok "旧 win-unpacked 已 zombie 化,stage 输出不受影响"
            } else {
                Warn "zombie 化也失败,改用全新 stage 目录构建"
            }
        }
    }
}

# 如果 win-unpacked 仍存在(被锁定 + 无法搬移),使用独立 stage 目录构建以彻底避开文件锁。
$useStageOutput = $false
if (Test-Path $unpackedDir) {
    $useStageOutput = $true
}

if ($useStageOutput) {
    $stageDirName = "dist-stage-{0:yyyyMMdd-HHmmss}" -f (Get-Date)
    # 注: stage 目录放在 $DistDir 下,这样下次构建开头清理时能一起回收。
    $stageDir = Join-Path $DistDir $stageDirName
    Warn "使用 stage 目录构建(避免文件锁): $stageDir"
} else {
    $stageDir = $DistDir
    $stageDirName = $null
}

Push-Location $DesktopDir
try {
    if ($useStageOutput) {
        # 用绝对路径,避免相对路径在 $DesktopDir cwd 下被解析到 apps/desktop/$stageDirName 而非 dist/$stageDirName
        pnpm electron-builder --win "--config.directories.output=$stageDir"
    } else {
        pnpm electron-builder --win
    }
    if ($LASTEXITCODE -ne 0) {
        $checkUnpacked = Join-Path $stageDir "win-unpacked"
        if (Test-Path (Join-Path $checkUnpacked "Kairo.exe")) {
            Warn "electron-builder 退出码非零,但 win-unpacked 已生成,继续..."
        } else {
            Err "electron-builder 打包失败"
        }
    }
    Ok "electron-builder 打包完成 (dir 模式)"
} finally { Pop-Location }

# 如果使用了 stage 目录,将其内容合并到 dist (把新生成的 win-unpacked 搬过去;
# 旧 dist\win-unpacked 仍可能因文件锁无法删除,但会被新的覆盖/置于不同名位置,不影响产物)。
if ($useStageOutput) {
    $newUnpacked = Join-Path $stageDir "win-unpacked"
    if (Test-Path $newUnpacked) {
        if (Test-Path $unpackedDir) {
            # 把旧(被锁)的 win-unpacked 暂时改名,再把新的搬到位。
            # 命名统一为 dist-locked-<ts> (与阶段 5 catch 块同语义同 glob,cleanup 函数一并清)。
            $tempOldName = Join-Path $DistDir ("dist-locked-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
            try {
                Move-Item $unpackedDir $tempOldName -Force -ErrorAction Stop
                Move-Item $newUnpacked $unpackedDir -Force -ErrorAction Stop
                Ok "已将新 win-unpacked 合并到 dist,并将旧(被锁)目录移至: $(Split-Path $tempOldName -Leaf)"
            } catch {
                Warn "合并失败: $($_.Exception.Message);尝试 zombie 化旧 win-unpacked"
                if (ConvertTo-ZombiePath -Path $unpackedDir) {
                    # zombie 成功后重试把新 win-unpacked 搬过去
                    try {
                        Move-Item $newUnpacked $unpackedDir -Force -ErrorAction Stop
                        $liveUnpackedDir = $unpackedDir
                        Ok "旧 win-unpacked 已 zombie 化,新 win-unpacked 已合并到 dist"
                    } catch {
                        Warn "新 win-unpacked 仍搬不过去,保留在 stage 目录: $stageDir"
                    }
                } else {
                    Warn "旧 win-unpacked 处理失败,本次构建保留在 stage 目录: $stageDir"
                }
            }
        } else {
            Move-Item $newUnpacked $unpackedDir -Force
            Ok "已将新 win-unpacked 合并到 dist"
        }
    }
}

# 如果使用了 stage 目录,后续所有操作(Kairo-Server.exe, 7z 压缩等)都使用 stage 内的 win-unpacked。
# 同时在最后再尝试把 stage 目录里的内容合并回 dist(若旧 dist\win-unpacked 仍被锁,会在下次构建时清理)。
if ($useStageOutput) {
    $liveUnpackedDir = Join-Path $stageDir "win-unpacked"
} else {
    $liveUnpackedDir = $unpackedDir
}

# ─── 生成 Kairo-Server.exe (浏览器版) ─────────────────────
Step "生成 Kairo-Server.exe (浏览器版微型 Go 包装器)"

# 编译 Go 包装器 (仅 ~2MB, 替代 201MB 的 Kairo.exe 副本)
$launcherSrc = Join-Path $RepoRoot "scripts/kairo-server-launcher.go"
$serverExe = Join-Path $liveUnpackedDir "Kairo-Server.exe"

if (Test-Path $launcherSrc) {
    # 用 & 直接调 go,避免 iex 解析 PowerShell 变量时的特殊字符问题
    Push-Location $RepoRoot
    try {
        & go build -ldflags='-s -w' -o $serverExe $launcherSrc 2>&1 | Out-Null
    } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) {
        Warn "Go 包装器编译失败,回退到复制 Kairo.exe"
        Copy-Item (Join-Path $liveUnpackedDir "Kairo.exe") $serverExe -Force
    } else {
        $wrapperSize = [math]::Round((Get-Item $serverExe).Length / 1KB, 1)
        Ok "Kairo-Server.exe 已编译 (Go 包装器, ${wrapperSize}KB)"
    }
} else {
    Warn "未找到 kairo-server-launcher.go,回退到复制 Kairo.exe"
    Copy-Item (Join-Path $liveUnpackedDir "Kairo.exe") $serverExe -Force
}

# ─── 清理冗余文件 ────────────────────────────────────────
Step "清理冗余文件 (减小压缩包体积)"

$removedSize = 0

# 1. 删除 LICENSES.chromium.html (14MB, 仅 Chromium 许可证文本, 用户不需要)
$licenseFile = Join-Path $liveUnpackedDir "LICENSES.chromium.html"
if (Test-Path $licenseFile) {
    $removedSize += (Get-Item $licenseFile).Length
    Remove-Item $licenseFile -Force
    Ok "已删除 LICENSES.chromium.html"
}

# 2. 删除 LICENSE.electron.txt
$licenseFile2 = Join-Path $liveUnpackedDir "LICENSE.electron.txt"
if (Test-Path $licenseFile2) {
    Remove-Item $licenseFile2 -Force
    Ok "已删除 LICENSE.electron.txt"
}

# 3. 删除 JDT LS 非 Windows 平台配置 (config_linux, config_mac 等)
$jdtlsDir = Join-Path $liveUnpackedDir "resources/bundled/jdtls"
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
    Copy-Item $startCmd $liveUnpackedDir -Force
    Ok "start-browser-mode.cmd 已复制到输出目录"
}

# ─── 直接从 win-unpacked 创建分卷压缩 (跳过中间 zip) ─────
Step "创建分卷压缩 (直接从 win-unpacked 目录)"

# 删除旧的分卷文件
Get-ChildItem $DistDir -Filter "$SplitBase.7z.*" -ErrorAction SilentlyContinue | Remove-Item -Force

$splitOutput = Join-Path $DistDir "$SplitBase.7z"
Push-Location $liveUnpackedDir
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

# 7z 验证通过后, dist 已有完整产物。若当前在 stage 模式下, stage 内的 win-unpacked
# 副本已是冗余 — 主动 zombie 化,避免后续合并失败时 stage 永远残留。
if ($useStageOutput -and (Test-Path $liveUnpackedDir)) {
    Write-Host "  [INFO] 7z 产物已在 dist 生成,主动 zombie 化 stage 内的 win-unpacked 副本" -ForegroundColor Cyan
    ConvertTo-ZombiePath -Path $liveUnpackedDir | Out-Null
    # $liveUnpackedDir 路径已失效,后续冒烟检查用 dist 内的 win-unpacked
    if (Test-Path $unpackedDir) {
        $liveUnpackedDir = $unpackedDir
    }
}

# 快速冒烟验证
if (-not $SkipSmoke -and (Test-Path (Join-Path $liveUnpackedDir "Kairo.exe"))) {
    $agentInDist = Join-Path $liveUnpackedDir "resources/bin/kairo-runtime.exe"
    if (Test-Path $agentInDist) {
        Ok "kairo-runtime.exe 已嵌入"
    } else {
        Warn "kairo-runtime.exe 未在 resources/bin/ 中找到"
    }
    $jdtlsInDist = Join-Path $liveUnpackedDir "resources/bundled/jdtls/config_win/config.ini"
    if (Test-Path $jdtlsInDist) {
        Ok "JDT LS 已嵌入"
    } else {
        Warn "JDT LS 未嵌入 (Java 智能提示不可用)"
    }
    $tomcatInDist = Join-Path $liveUnpackedDir "resources/bundled/tomcat6/apache-tomcat-6.0.53/bin/catalina.bat"
    if (Test-Path $tomcatInDist) {
        Ok "Tomcat 6 已嵌入"
    } else {
        Warn "Tomcat 6 未嵌入"
    }
    $serverExeInDist = Join-Path $liveUnpackedDir "Kairo-Server.exe"
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

# ─── 将 stage 产物合并回 dist(尽力而为) ─────────────────
# 旧 dist\win-unpacked 可能仍被系统进程占用,若仍存在则先改名;然后把新产物搬到位。
# 这只是"软合并"——目的是让 dist 目录里始终是最新构建的产物;
# 被锁的旧目录会在下次系统空闲/重启后被自动清理(脚本下次运行会先尝试回收)。
if ($useStageOutput -and (Test-Path $liveUnpackedDir)) {
    Step "将新构建合并到 dist/win-unpacked (覆盖被锁的旧产物)"
    if (Test-Path $unpackedDir) {
        # 命名统一为 dist-locked-<ts> (与上方 catch 块同 glob,cleanup 函数一并清)
        $staleName = Join-Path $DistDir ("dist-locked-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
        try {
            Move-Item $unpackedDir $staleName -Force -ErrorAction Stop
            Ok "已将旧 win-unpacked 暂时改名 -> $(Split-Path $staleName -Leaf)"
        } catch {
            Warn "无法改名旧 win-unpacked (仍被占用);尝试 zombie 化"
            if (ConvertTo-ZombiePath -Path $unpackedDir) {
                $staleName = "$unpackedDir.zombie"  # zombie 化也算"挪开"了
            } else {
                Warn "旧 win-unpacked 处理失败,本次构建保留在 stage 目录"
                $staleName = $null
            }
        }
    }
    if (-not (Test-Path $unpackedDir)) {
        try {
            Move-Item $liveUnpackedDir $unpackedDir -Force -ErrorAction Stop
            $liveUnpackedDir = $unpackedDir
            Ok "新 win-unpacked 已合并到 dist"
        } catch {
            Warn "新 win-unpacked 搬不动: $($_.Exception.Message);zombie 化 stage 内的副本(产物已在 dist)"
            ConvertTo-ZombiePath -Path $liveUnpackedDir | Out-Null
        }
    }
    # 清理 stage 顶层 zip/installer(若还有),避免冗余
    if ($useStageOutput -and $stageDir -and (Test-Path $stageDir)) {
        $stageTop = Get-ChildItem $stageDir -File -ErrorAction SilentlyContinue
        if ($stageTop) {
            $stageTop | Remove-Item -Force -ErrorAction SilentlyContinue
        }
        # 若 stage 目录已空(win-unpacked 已搬走或 zombie 化),移除它;否则 zombie 化整个 stage
        $remaining = Get-ChildItem $stageDir -Force -ErrorAction SilentlyContinue
        if (-not $remaining) {
            Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
            Ok "stage 目录已清理"
        } else {
            Warn "stage 目录仍有内容, zombie 化整个 stage (产物已在 dist, 不再需要副本)"
            ConvertTo-ZombiePath -Path $stageDir | Out-Null
        }
    }
}

# ─── 收尾 ──────────────────────────────────────────────────
# 注意:7z 分卷压缩已在「创建分卷压缩 (直接从 win-unpacked 目录)」步骤中完成,
# 此处仅做汇总展示,不再重复压缩(之前还有一个从 $ZipPath 再次分卷的旧逻辑,
# 已被替换为直接从 win-unpacked 压缩,更省时间和磁盘)。
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