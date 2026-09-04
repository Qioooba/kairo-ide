# build-and-package.ps1 — Kairo IDE 一键构建 + 分卷打包脚本
#
# 功能:
#   0. 清理残留进程 (避免 conpty.node / win-unpacked 被锁)
#   1. 构建浏览器前端 (browser app)
#   2. 构建 Go Runtime Agent
#   3. 准备 bundled 资源 (Tomcat 6, JDT LS, JDI Bridge)
#   4. 拷贝浏览器产物 (含 prebuilds) 到 desktop + 编译 TypeScript
#   5. electron-builder --win dir + afterPack 展开 native
#   6. 生成 Kairo-Server.exe + 7z 分卷 (每卷 ≤ 70MB)
#   7. 硬冒烟: 缺关键文件则失败 (可用 -AllowDegraded 降级为警告)
#   8. 上传分卷到挂载盘 (默认 Z:\KairoIDE\yyyy-MM-dd\)
#
# 用法:
#   .\scripts\build-and-package.ps1
#   .\scripts\build-and-package.ps1 -VolumeSize 50
#   .\scripts\build-and-package.ps1 -SkipBuild
#   .\scripts\build-and-package.ps1 -SkipSplit
#   .\scripts\build-and-package.ps1 -AllowDegraded   # JDT LS / JDI 缺失时不硬失败
#   .\scripts\build-and-package.ps1 -SkipLockCleanup # 不杀残留进程
#   .\scripts\build-and-package.ps1 -PublishRoot "Z:\发布\KairoIDE"
#   .\scripts\build-and-package.ps1 -PublishDate "2026-08-03"
#   .\scripts\build-and-package.ps1 -SkipPublish
#   .\scripts\build-and-package.ps1 -PublishRequired  # Z 盘不可用则整次失败
#
# 环境变量 (可选):
#   $env:KAIRO_TOMCAT6_HOME = "E:\Apps\Tomcat6\apache-tomcat-6.0.53"
#   $env:KAIRO_JDTLS_HOME   = "E:\Apps\eclipse-jdt-ls"
#   $env:KAIRO_JDTLS_ARCHIVE = "D:\jdtls-1.55.0.tar.gz"
#   $env:KAIRO_PUBLISH_ROOT = "Z:\KairoIDE"          # 上传根目录 (其下按日期建子目录)
#
# 产物 (内网交付):
#   apps/desktop/dist/KairoIDE-v0.1.0-win-x64.7z.*   (分卷, 解压即用)
#   apps/desktop/dist/win-unpacked/                  (本地调试目录)
#   <PublishRoot>\<yyyy-MM-dd>\*.7z.*                (挂载盘副本)

[CmdletBinding()]
param(
    [int]$VolumeSize = 70,
    [switch]$SkipBuild,
    [switch]$SkipSplit,
    [switch]$SkipSmoke,
    [switch]$AllowDegraded,
    [switch]$SkipLockCleanup,
    [string]$PublishRoot = "",
    [string]$PublishDate = "",
    [switch]$SkipPublish,
    [switch]$PublishRequired
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version 2.0

# Resolve publish root: -PublishRoot > env > default Z:\KairoIDE
if ([string]::IsNullOrWhiteSpace($PublishRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($env:KAIRO_PUBLISH_ROOT)) {
        $PublishRoot = $env:KAIRO_PUBLISH_ROOT.Trim()
    } else {
        $PublishRoot = "Z:\KairoIDE"
    }
}
if ([string]::IsNullOrWhiteSpace($PublishDate)) {
    $PublishDate = Get-Date -Format "yyyy-MM-dd"
} else {
    # Normalize common inputs: 20260803 / 2026/08/03 / 2026-08-03
    $rawDate = $PublishDate.Trim()
    if ($rawDate -match '^\d{8}$') {
        $PublishDate = "{0}-{1}-{2}" -f $rawDate.Substring(0,4), $rawDate.Substring(4,2), $rawDate.Substring(6,2)
    } elseif ($rawDate -match '^\d{4}[/-]\d{1,2}[/-]\d{1,2}$') {
        $PublishDate = (Get-Date $rawDate).ToString("yyyy-MM-dd")
    }
}

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

# Soft requirement: warn-only when -AllowDegraded, otherwise hard-fail.
function Require-OrDegrade {
    param(
        [Parameter(Mandatory)][string]$Message,
        [switch]$Critical
    )
    if ($AllowDegraded -and -not $Critical) {
        Warn $Message
        return $false
    }
    Err $Message
    return $false
}

# Kill leftover Kairo / Theia / agent processes that lock package files
# (conpty.node, app.asar, win-unpacked). Does NOT touch Cursor itself.
function Stop-KairoLockHolders {
    $patterns = @(
        'kairo-runtime\.exe',
        'Kairo\.exe',
        'Kairo-Server\.exe',
        'apps\\browser\\lib\\backend',
        'apps\\desktop\\dist\\win-unpacked',
        'artifacts\\qa\\',
        'KAIRO_AGENT_URL='
    )
    $hit = @()
    try {
        $hit = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $name = $_.Name
            $cmd = if ($null -eq $_.CommandLine) { '' } else { $_.CommandLine }
            if ($name -match '^(kairo-runtime|Kairo|Kairo-Server)\.exe$') { return $true }
            foreach ($p in $patterns) {
                if ($cmd -match $p) { return $true }
            }
            return $false
        })
    } catch {
        Warn "无法枚举进程: $($_.Exception.Message)"
        return
    }
    if ($hit.Count -eq 0) {
        Ok "无残留 Kairo/Theia 占用进程"
        return
    }
    Warn "发现 $($hit.Count) 个可能锁文件的残留进程,正在结束..."
    $killed = 0
    foreach ($proc in $hit) {
        $id = $proc.ProcessId
        # Skip our own shell / current packaging tree by name only — taskkill /T is enough.
        & taskkill.exe /F /T /PID $id 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $killed++ }
    }
    Start-Sleep -Seconds 2
    Ok "已尝试结束 $killed / $($hit.Count) 个残留进程"

    # If browser prebuilds are still locked, rename aside so theia can recopy.
    $conpty = Join-Path $RepoRoot "apps/browser/lib/prebuilds/win32-x64/conpty.node"
    if (Test-Path $conpty) {
        try {
            $fs = [System.IO.File]::Open($conpty, 'Open', 'ReadWrite', 'None')
            $fs.Close()
        } catch {
            $aside = "$conpty.locked-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            try {
                Move-Item -LiteralPath $conpty -Destination $aside -Force -ErrorAction Stop
                Warn "conpty.node 仍被占用,已旁路为 $(Split-Path $aside -Leaf)"
            } catch {
                Warn "conpty.node 旁路失败: $($_.Exception.Message)"
            }
        }
    }
}

# Preflight: required inputs must exist before electron-builder runs.
function Assert-PackPreflight {
    param([string]$DesktopRoot)

    $checks = @(
        @{ Path = (Join-Path $DesktopRoot "lib/main.js"); Crit = $true; Label = "lib/main.js"; Msg = "desktop lib/main.js 缺失 — 先编译 TypeScript" },
        @{ Path = (Join-Path $DesktopRoot "lib/backend/main.js"); Crit = $true; Label = "lib/backend/main.js"; Msg = "browser backend 未拷贝 — 运行 copy-browser-artifacts" },
        @{ Path = (Join-Path $DesktopRoot "lib/prebuilds/win32-x64/conpty.node"); Crit = $true; Label = "conpty.node"; Msg = "prebuilds/conpty.node 缺失 — 终端将不可用" },
        @{ Path = (Join-Path $DesktopRoot "lib/backend/native/watcher.node"); Crit = $true; Label = "watcher.node"; Msg = "backend/native/watcher.node 缺失" },
        @{ Path = (Join-Path $DesktopRoot "bundled/tomcat6/apache-tomcat-6.0.53/bin/catalina.bat"); Crit = $true; Label = "tomcat6"; Msg = "Tomcat 6 未就绪" },
        @{ Path = (Join-Path $DesktopRoot "bundled/kairo-jdi-bridge.jar"); Crit = $false; Label = "kairo-jdi-bridge.jar"; Msg = "kairo-jdi-bridge.jar 未就绪 — Java 调试不可用" },
        @{ Path = (Join-Path $DesktopRoot "bundled/jdtls/config_win/config.ini"); Crit = $false; Label = "jdtls"; Msg = "JDT LS 未就绪 — Java 智能提示不可用" },
        @{ Path = (Join-Path $RepoRoot "runtime-agent/bin/kairo-runtime.exe"); Crit = $true; Label = "kairo-runtime.exe"; Msg = "kairo-runtime.exe 未构建" }
    )
    foreach ($c in $checks) {
        $exists = $false
        if (Test-Path -LiteralPath $c.Path) {
            $item = Get-Item -LiteralPath $c.Path
            $exists = $item.PSIsContainer -or ($item.Length -gt 0)
        }
        if ($exists) {
            Ok "preflight: $($c.Label)"
        } else {
            Require-OrDegrade -Message $c.Msg -Critical:$c.Crit
        }
    }
}

# Smoke check helper (shared counter via script scope)
$script:smokeFailCount = 0
function Invoke-SmokeCheck {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$OkMsg,
        [Parameter(Mandatory)][string]$FailMsg,
        [switch]$Critical
    )
    if ((Test-Path -LiteralPath $Path) -and ((Get-Item -LiteralPath $Path).PSIsContainer -or (Get-Item -LiteralPath $Path).Length -gt 0)) {
        Ok $OkMsg
        return
    }
    if ($AllowDegraded -and -not $Critical) {
        Warn $FailMsg
    } else {
        Write-Host "  [FAIL] $FailMsg" -ForegroundColor Red
        $script:smokeFailCount++
    }
}

# Copy split volumes to mounted share: <PublishRoot>\<yyyy-MM-dd>\
function Publish-ReleaseArtifacts {
    param(
        [Parameter(Mandatory)][string]$SourceDist,
        [Parameter(Mandatory)][string]$SplitName,
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$DateFolder
    )

    if ($SkipPublish) {
        Warn "已跳过上传 (-SkipPublish)"
        return $null
    }
    if ($SkipSplit) {
        Warn "已跳过分卷 (-SkipSplit), 无 .7z 可上传"
        return $null
    }

    $volumes = @(Get-ChildItem -Path $SourceDist -Filter "$SplitName.7z.*" -File -ErrorAction SilentlyContinue |
                 Sort-Object Name)
    if ($volumes.Count -eq 0) {
        $msg = "未找到分卷 $SplitName.7z.* ,无法上传到 $Root"
        if ($PublishRequired) { Err $msg } else { Warn $msg }
        return $null
    }

    $rootDrive = [System.IO.Path]::GetPathRoot($Root)
    if ($rootDrive -and -not (Test-Path -LiteralPath $rootDrive)) {
        $msg = "发布盘不可用: $rootDrive (检查挂载)。目标应为 $Root\$DateFolder"
        if ($PublishRequired) { Err $msg } else { Warn $msg }
        return $null
    }

    $dest = Join-Path $Root $DateFolder
    try {
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
    } catch {
        $msg = "无法创建发布目录 $dest : $($_.Exception.Message)"
        if ($PublishRequired) { Err $msg } else { Warn $msg }
        return $null
    }

    Step "上传分卷到发布目录"
    Write-Host "  目标: $dest" -ForegroundColor Cyan
    $copied = 0
    $bytes = 0L
    foreach ($vol in $volumes) {
        $target = Join-Path $dest $vol.Name
        try {
            Copy-Item -LiteralPath $vol.FullName -Destination $target -Force -ErrorAction Stop
            $copied++
            $bytes += $vol.Length
            $sizeMb = [math]::Round($vol.Length / 1MB, 2)
            Ok "$($vol.Name)  ($sizeMb MB)"
        } catch {
            $msg = "复制失败 $($vol.Name): $($_.Exception.Message)"
            if ($PublishRequired) { Err $msg } else { Warn $msg; return $null }
        }
    }

    $readme = Join-Path $dest "README-解压说明.txt"
    $readmeBody = @"
Kairo IDE 内网分发包 — $DateFolder

解压:
  1. 安装 7-Zip
  2. 右键 $SplitName.7z.001 → 7-Zip → 解压到当前文件夹
  3. 得到程序目录后双击:
       Kairo.exe          桌面版
       Kairo-Server.exe   浏览器版 (无窗口)

目标机需 JDK 17+。
详见仓库 docs/DEPLOY-GUIDE.md
"@
    try {
        Set-Content -LiteralPath $readme -Value $readmeBody -Encoding UTF8
        Ok "README-解压说明.txt"
    } catch {
        Warn "无法写入说明文件: $($_.Exception.Message)"
    }

    $totalMb = [math]::Round($bytes / 1MB, 1)
    Ok "已上传 $copied 个分卷到 $dest  (共 $totalMb MB)"
    return $dest
}

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

    # 每组可单独指定保留数量:
    #   - 模式化旁路目录保留最近 1 套;
    #   - 固定名校验/运行 scratch 目录(asar-*、kairo-extract、kairo-run、run)
    #     是纯临时产物,全部回收(占用中会走 .zombie 兜底)。此前它们不在
    #     清理范围内,曾累积到 ~12.9 GB。
    $patterns = @(
        @{ Dir = $DistDir;    Keep = $KeepLatest; Globs = @(
            "dist-locked-*", "dist-stage-*",
            "win-unpacked.locked-*", "win-unpacked.stale-*",
            "*.zombie", "*.orphan"        # ConvertTo-ZombiePath 兜底产物
        ) },
        @{ Dir = $DesktopDir; Keep = $KeepLatest; Globs = @(
            "dist-locked-*", "dist-stage-*",
            "*.zombie", "*.orphan"        # 历史遗留 + zombie 兜底
        ) },
        @{ Dir = $DistDir;    Keep = 0;           Globs = @(
            "asar-old", "asar-temp", "asar-verify", "kairo-extract",
            "kairo-run", "run"
        ) }
    )

    $removed = 0
    $freed   = 0L
    foreach ($p in $patterns) {
        if (-not (Test-Path $p.Dir)) { continue }
        foreach ($glob in $p.Globs) {
            $hits = @(Get-ChildItem -Path $p.Dir -Filter $glob -Force -ErrorAction SilentlyContinue |
                    Sort-Object LastWriteTime -Descending)
            if ($hits.Count -eq 0) { continue }
            $skip = [Math]::Min($p.Keep, $hits.Count)
            $staleList = $hits | Select-Object -Skip $skip
            foreach ($s in $staleList) {
                $size = if ($s.PSIsContainer) {
                    $m = Get-ChildItem $s.FullName -Recurse -File -ErrorAction SilentlyContinue |
                         Measure-Object -Property Length -Sum
                    if ($null -eq $m) { 0 } else { $m.Sum }
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

# ─── 阶段 0: 清理占用 + 旁路目录 ───────────────────────────
if (-not $SkipLockCleanup) {
    Step "阶段 0: 清理残留进程 (防文件锁)"
    Stop-KairoLockHolders
} else {
    Warn "已跳过残留进程清理 (-SkipLockCleanup)"
}

Invoke-StaleCleanup -KeepLatest 1

# ─── 阶段 1+2: 构建(浏览器前端 ∥ Go Agent 并行) ───────────
if (-not $SkipBuild) {
    Step "阶段 1/5: 构建浏览器前端 (Go Agent 构建已并行启动)"
    # Go Agent 构建与浏览器构建互不依赖;放到后台 Job 与最慢的
    # 浏览器 esbuild 同时执行,缩短总墙钟时间。
    $agentJob = Start-Job -ScriptBlock {
        param($desktopDir)
        Set-Location $desktopDir
        node scripts/build-agent.js
        # 把子命令退出码带回主进程
        $global:AGENT_EXIT = if ($LASTEXITCODE -ne 0) { $LASTEXITCODE } else { 0 }
    } -ArgumentList $DesktopDir

    Push-Location $RepoRoot
    try {
        pnpm --filter @kairo/browser build
        if ($LASTEXITCODE -ne 0) { Err "浏览器构建失败" }
        Ok "浏览器前端构建完成"
    } finally { Pop-Location }

    Step "阶段 2/5: 等待 Go Runtime Agent 构建完成"
    Receive-Job -Job $agentJob -Wait | Out-Null
    $agentFailed = ($agentJob.State -eq 'Failed') -or ($agentJob.ChildJobs[0].JobStateInfo.State -eq 'Failed')
    $agentExit   = if ($null -ne $agentJob.ChildJobs[0].Output) { @($agentJob.ChildJobs[0].Output)[-1] } else { 0 }
    Remove-Job -Job $agentJob -Force -ErrorAction SilentlyContinue
    if ($agentFailed -or ($agentExit -is [int] -and $agentExit -ne 0)) { Err "Go Agent 构建失败" }
    Ok "Go Runtime Agent 构建完成"

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
        Require-OrDegrade -Message @"
JDT LS 未找到。设置环境变量后重试:
  `$env:KAIRO_JDTLS_HOME = 'E:\Apps\eclipse-jdt-ls'
或 `$env:KAIRO_JDTLS_ARCHIVE = 'D:\jdtls-1.55.0.tar.gz'
或手动放到: $jdtlsTarget
"@
        New-Item -ItemType Directory -Force -Path $jdtlsTarget | Out-Null
        New-Item -ItemType File -Force -Path "$jdtlsTarget/PLACEHOLDER.txt" -Value "JDT LS not bundled. Set KAIRO_JDTLS_HOME env var." | Out-Null
    }

    # JDI Bridge jar (Java Debug Adapter)
    $jdiJarTarget = Join-Path $bundledDir "kairo-jdi-bridge.jar"
    $jdiJarRoot = Join-Path $RepoRoot "bundled/kairo-jdi-bridge.jar"
    $jdiBuildCmd = Join-Path $RepoRoot "scripts/build-jdi-bridge.cmd"
    if ((Test-Path $jdiJarTarget) -and ((Get-Item $jdiJarTarget).Length -gt 0)) {
        Ok "kairo-jdi-bridge.jar 已就绪"
    } elseif ((Test-Path $jdiJarRoot) -and ((Get-Item $jdiJarRoot).Length -gt 0)) {
        Copy-Item $jdiJarRoot $jdiJarTarget -Force
        Ok "kairo-jdi-bridge.jar 已从 repo bundled/ 复制"
    } elseif (Test-Path $jdiBuildCmd) {
        Warn "正在编译 kairo-jdi-bridge.jar..."
        & cmd.exe /c $jdiBuildCmd
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $jdiJarRoot)) {
            Require-OrDegrade -Message "JDI Bridge 编译失败 — Java 调试适配器将不可用"
        } else {
            Copy-Item $jdiJarRoot $jdiJarTarget -Force
            Ok "kairo-jdi-bridge.jar 已编译并复制"
        }
    } else {
        Require-OrDegrade -Message "kairo-jdi-bridge.jar 未找到 — 运行 scripts/build-jdi-bridge.cmd"
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
    $bundledDir = Join-Path $DesktopDir "bundled"
    $jdiJarTarget = Join-Path $bundledDir "kairo-jdi-bridge.jar"
    $jdiJarRoot = Join-Path $RepoRoot "bundled/kairo-jdi-bridge.jar"
    if (-not (Test-Path $jdiJarTarget) -and (Test-Path $jdiJarRoot)) {
        New-Item -ItemType Directory -Force -Path $bundledDir | Out-Null
        Copy-Item $jdiJarRoot $jdiJarTarget -Force
        Ok "SkipBuild: 已补拷 kairo-jdi-bridge.jar"
    }
    # Refresh browser artifacts if prebuilds were never staged (common after old packs).
    $conptyDesktop = Join-Path $DesktopDir "lib/prebuilds/win32-x64/conpty.node"
    if (-not (Test-Path $conptyDesktop)) {
        Warn "SkipBuild: 缺少 prebuilds,正在补拷浏览器产物..."
        Push-Location $DesktopDir
        try {
            node scripts/copy-browser-artifacts.js --strict
            if ($LASTEXITCODE -ne 0) { Err "SkipBuild 补拷浏览器产物失败" }
            Ok "SkipBuild: 浏览器产物已补齐"
        } finally { Pop-Location }
    }
}

# ─── 打包前预检 ────────────────────────────────────────────
Step "打包前预检 (关键资源)"
Assert-PackPreflight -DesktopRoot $DesktopDir

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
    # dir target only — NSIS/zip are slow and zip lacks Kairo-Server.exe;
    # intranet distribution uses the 7z volumes created below.
    if ($useStageOutput) {
        pnpm electron-builder --win --config.win.target=dir "--config.directories.output=$stageDir"
    } else {
        pnpm electron-builder --win --config.win.target=dir
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
        $_.Name -match 'config_(linux|mac|ss_linux|ss_mac|ss_win)'
    } | ForEach-Object {
        $m2 = Get-ChildItem $_.FullName -Recurse -File | Measure-Object -Property Length -Sum
        $removedSize += if ($null -eq $m2) { 0 } else { $m2.Sum }
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

# 冒烟验证 — 关键项默认硬失败; -AllowDegraded 时非关键项降级为警告
if (-not $SkipSmoke -and (Test-Path (Join-Path $liveUnpackedDir "Kairo.exe"))) {
    Step "冒烟验证 (产物完整性)"
    $script:smokeFailCount = 0

    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "Kairo.exe") `
        -OkMsg "Kairo.exe 已生成" -FailMsg "Kairo.exe 缺失"
    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "Kairo-Server.exe") `
        -OkMsg "Kairo-Server.exe 已生成" -FailMsg "Kairo-Server.exe 缺失"
    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "resources/bin/kairo-runtime.exe") `
        -OkMsg "kairo-runtime.exe 已嵌入" -FailMsg "kairo-runtime.exe 未嵌入"
    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "resources/bundled/tomcat6/apache-tomcat-6.0.53/bin/catalina.bat") `
        -OkMsg "Tomcat 6 已嵌入" -FailMsg "Tomcat 6 未嵌入"
    Invoke-SmokeCheck -Path (Join-Path $liveUnpackedDir "resources/bundled/jdtls/config_win/config.ini") `
        -OkMsg "JDT LS 已嵌入" -FailMsg "JDT LS 未嵌入 (Java 智能提示不可用)"
    Invoke-SmokeCheck -Path (Join-Path $liveUnpackedDir "resources/bundled/kairo-jdi-bridge.jar") `
        -OkMsg "kairo-jdi-bridge.jar 已嵌入" -FailMsg "kairo-jdi-bridge.jar 未嵌入 (Java 调试不可用)"
    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "resources/app.asar.unpacked/lib/backend/native/watcher.node") `
        -OkMsg "asar.unpacked native (watcher.node) 已展开" -FailMsg "asar.unpacked/native 缺失 — afterPack 未生效"
    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "resources/app.asar.unpacked/lib/prebuilds/win32-x64/conpty.node") `
        -OkMsg "asar.unpacked prebuilds (conpty.node) 已展开" -FailMsg "asar.unpacked/prebuilds 缺失 — 终端不可用"
    Invoke-SmokeCheck -Critical -Path (Join-Path $liveUnpackedDir "resources/app.asar.unpacked/lib/backend/windows-trash.exe") `
        -OkMsg "asar.unpacked windows-trash.exe 已展开" -FailMsg "windows-trash 未展开 — 回收站删除不可用"
    Invoke-SmokeCheck -Path (Join-Path $liveUnpackedDir "start-browser-mode.cmd") `
        -OkMsg "start-browser-mode.cmd 已复制" -FailMsg "start-browser-mode.cmd 未复制"

    if ($script:smokeFailCount -gt 0) {
        Err "冒烟验证失败: $($script:smokeFailCount) 项关键产物缺失。修复后重跑,或加 -AllowDegraded 仅作降级包。"
    }
    Ok "冒烟验证全部通过"
} elseif (-not $SkipSmoke) {
    Err "冒烟验证失败: 未找到 win-unpacked/Kairo.exe"
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

# ─── 上传到挂载盘 ──────────────────────────────────────────
$publishedDir = $null
if (-not $SkipPublish) {
    $publishedDir = Publish-ReleaseArtifacts `
        -SourceDist $DistDir `
        -SplitName $SplitBase `
        -Root $PublishRoot `
        -DateFolder $PublishDate
}

# ─── 收尾 ──────────────────────────────────────────────────
# 注意:7z 分卷压缩已在「创建分卷压缩 (直接从 win-unpacked 目录)」步骤中完成,
# 此处仅做汇总展示,不再重复压缩(之前还有一个从 $ZipPath 再次分卷的旧逻辑,
# 已被替换为直接从 win-unpacked 压缩,更省时间和磁盘)。
$publishLine = if ($publishedDir) {
    "║  已上传: $publishedDir"
} elseif ($SkipPublish) {
    "║  上传: 已跳过 (-SkipPublish)"
} else {
    "║  上传: 未完成 (检查 $PublishRoot 是否可写; 可用 -PublishRequired 强制失败)"
}

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
$publishLine
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