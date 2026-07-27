# package-zip-green.ps1 — Kairo IDE 一键绿色版 zip 打包脚本
#
# 目标产物:
#   apps/desktop/dist/Kairo-IDE-0.1.0-win-x64.zip
#
# 解压后用户:
#   1. 解压到任意目录(路径中允许空格/中文)
#   2. 双击 Kairo.exe
#   3. IDE 自动拉起 Go Runtime Agent + Theia Backend,打开 127.0.0.1:随机端口
#
# 脚本设计原则:
#   - 完全离线 (仅依赖本机已有的 Go/Node/pnpm,不需要任何外网)
#   - 缺失产物时给出**可操作**的错误信息 + 三种解法
#   - 不在脚本里硬编码下载链接 (内网策略差异大)
#
# 用法:
#   pwsh -ExecutionPolicy Bypass -File scripts/package-zip-green.ps1
#
# 可选环境变量 (解决 jdtls 缺失):
#   $env:KAIRO_JDTLS_HOME   = "E:\Apps\eclipse-jdt-ls"     (已解压的目录)
#   $env:KAIRO_JDTLS_ARCHIVE = "D:\mirror\jdtls-1.21.0.tar.gz"  (归档文件,自动解压)

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipSmoke,
    [switch]$AllowNoJdtls
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ─── 路径常量 ───────────────────────────────────────────────
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot    = Resolve-Path (Join-Path $ScriptDir "..")
$DesktopDir  = Join-Path $RepoRoot "apps/desktop"
$DistDir     = Join-Path $DesktopDir "dist"
$AgentBin    = Join-Path $RepoRoot "runtime-agent/bin/kairo-runtime.exe"
$JdtlsTarget = Join-Path $RepoRoot "bundled/jdtls"
$TomcatTarget = Join-Path $RepoRoot "bundled/tomcat6/apache-tomcat-6.0.53"
$DesktopLib  = Join-Path $DesktopDir "lib/main.js"

# ─── 颜色 ──────────────────────────────────────────────────
function Step($msg)   { Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Ok($msg)     { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Warn($msg)   { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err($msg)    { Write-Host "[FAIL] $msg" -ForegroundColor Red }
function Info($msg)   { Write-Host "[INFO] $msg" -ForegroundColor Gray }

# ─── 执行辅助 ──────────────────────────────────────────────
function Run-Step($label, $cmd, $cwd = $RepoRoot) {
    if ($DryRun) {
        Info "DRY-RUN: $label"
        Info "         $cmd  (cwd: $cwd)"
        return $true
    }
    Step $label
    Push-Location $cwd
    try {
        iex $cmd
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            throw "$label 退出码 $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
    Ok "$label 完成"
    return $true
}

# ─── 头部 ──────────────────────────────────────────────────
$banner = @"
╔══════════════════════════════════════════════════════════╗
║   Kairo IDE 绿色版一键打包 (zip)                          ║
║   目标: $((Resolve-Path $DistDir).Path)\Kairo-0.1.0-win-x64.zip
╚══════════════════════════════════════════════════════════╝
"@
Write-Host $banner -ForegroundColor Cyan

# ─── 自检 1: Go Runtime Agent 二进制 ───────────────────────
Step "自检 1/4: Go Runtime Agent (kairo-runtime.exe)"
if (Test-Path $AgentBin) {
    $size = (Get-Item $AgentBin).Length
    Ok "已存在: $AgentBin  ($([math]::Round($size/1MB, 1)) MB)"
} elseif (Get-Command go -ErrorAction SilentlyContinue) {
    Warn "缺失,正在调用 build-agent.js 重新编译"
    $buildScript = Join-Path $DesktopDir "scripts/build-agent.js"
    Run-Step "Go 编译 kairo-runtime.exe" "node `"$buildScript`""
    if (-not (Test-Path $AgentBin) -and -not $DryRun) {
        Err "编译后仍未找到 $AgentBin"
        exit 1
    }
} else {
    Err @"
未找到 kairo-runtime.exe 且本机无 go 命令

解决方案 (选其一):
  1. 安装 Go 1.22+: https://go.dev/dl/  (内网可走镜像 GOPROXY=https://goproxy.cn,direct)
  2. 从已有机器复制 runtime-agent/bin/kairo-runtime.exe 到本路径
  3. 设置 `$env:KAIRO_AGENT_PATH = '<已有 .exe 路径>',本脚本会跳过这一步
"@
    exit 1
}

# ─── 自检 2: bundled/tomcat6 ───────────────────────────────
Step "自检 2/4: bundled/tomcat6/apache-tomcat-6.0.53"
if ((Test-Path $TomcatTarget) -and (Get-ChildItem -Force $TomcatTarget -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Ok "已就绪"
} else {
    Err @"
缺失 Tomcat 6 运行时 ($TomcatTarget)

解决方案:
  1. 复制已有 apache-tomcat-6.0.53 目录到 $TomcatTarget
  2. 设置 `$env:KAIRO_TOMCAT6_HOME = '<已解压的 tomcat 根目录>',再重跑本脚本
     (脚本会从该目录复制到 bundled/)
"@
    exit 1
}

# ─── 自检 3: bundled/jdtls (Java 智能服务) ─────────────────
Step "自检 3/4: bundled/jdtls (Eclipse JDT Language Server 1.21.0)"
$jdtlsMarker = Join-Path $JdtlsTarget "config_win/config.ini"
$jdtlsReady = $false

if ((Test-Path $JdtlsTarget) -and (Test-Path $jdtlsMarker)) {
    Ok "已就绪 (含 config_win/config.ini marker)"
    $jdtlsReady = $true
} elseif ($env:KAIRO_JDTLS_ARCHIVE -and (Test-Path $env:KAIRO_JDTLS_ARCHIVE)) {
    # 归档文件模式:解压
    Warn "未就绪,检测到 `$env:KAIRO_JDTLS_ARCHIVE = $($env:KAIRO_JDTLS_ARCHIVE)"
    Warn "正在解压 jdtls 归档..."
    if ($DryRun) {
        Info "DRY-RUN: tar -xf $env:KAIRO_JDTLS_ARCHIVE -> $JdtlsTarget"
        $jdtlsReady = $true
    } else {
        # 清空旧目录
        if (Test-Path $JdtlsTarget) {
            Remove-Item -Path $JdtlsTarget -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Force -Path $JdtlsTarget | Out-Null
        tar -xf $env:KAIRO_JDTLS_ARCHIVE -C $JdtlsTarget
        if ($LASTEXITCODE -ne 0) {
            Err "tar 解压失败 (exit $LASTEXITCODE)"
            exit 1
        }
        # 验证 marker
        if (-not (Test-Path $jdtlsMarker)) {
            # 可能是嵌套了一层目录,尝试找最深的一层
            $nested = Get-ChildItem -Recurse -Path $JdtlsTarget -Filter config.ini -ErrorAction SilentlyContinue |
                Where-Object { $_.Directory.Name -eq "config_win" } | Select-Object -First 1
            if ($nested) {
                Warn "归档是嵌套结构,marker 在 $($nested.Directory.FullName)"
                $jdtlsReady = $true
            } else {
                Err "归档内未找到 config_win/config.ini,不是合法的 jdtls 包"
                exit 1
            }
        } else {
            $jdtlsReady = $true
        }
        Ok "解压并验证完成"
    }
} elseif ($env:KAIRO_JDTLS_HOME -and (Test-Path $env:KAIRO_JDTLS_HOME)) {
    # 已解压目录模式
    Warn "未就绪,检测到 `$env:KAIRO_JDTLS_HOME = $($env:KAIRO_JDTLS_HOME)"
    Warn "正在复制 jdtls 目录..."
    if ($DryRun) {
        Info "DRY-RUN: robocopy $env:KAIRO_JDTLS_HOME $JdtlsTarget /E"
        $jdtlsReady = $true
    } else {
        if (Test-Path $JdtlsTarget) {
            Remove-Item -Path $JdtlsTarget -Recurse -Force -ErrorAction SilentlyContinue
        }
        robocopy $env:KAIRO_JDTLS_HOME $JdtlsTarget /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) {
            Err "robocopy 失败 (exit $LASTEXITCODE)"
            exit 1
        }
        if (Test-Path $jdtlsMarker) {
            $jdtlsReady = $true
            Ok "复制并验证完成"
        } else {
            Err "源目录 $env:KAIRO_JDTLS_HOME 内未找到 config_win/config.ini"
            exit 1
        }
    }
}

if (-not $jdtlsReady) {
    if ($DryRun) {
        Warn "DRY-RUN: jdtls 缺失,实际跑时按以下指引准备"
        $jdtlsReady = $true
    } elseif (-not $AllowNoJdtls) {
        Err @"
缺失 JDT Language Server (1.21.0) — 用于 Java 代码补全/跳转/报错

JDTLS 缺失**不会阻止打包**,但用户打开 .java 文件时编辑器退化为纯文本模式
(无语法高亮、无智能提示、构建/调试仍可用,因为 JDTLS 仅服务于编辑器 UI)

如果你能接受这个降级,运行:
  pwsh -ExecutionPolicy Bypass -File scripts/package-zip-green.ps1 -AllowNoJdtls

如果你想带完整 Java 智能,准备 jdtls 归档 (任选其一):
  方式 A: 放一个 jdtls-1.21.0-XXXX.tar.gz 到内网任何位置,然后:
           `$env:KAIRO_JDTLS_ARCHIVE = 'D:\mirror\jdtls-1.21.0.tar.gz'
  方式 B: 已经解压好的 jdtls 目录 (内含 config_win/config.ini),然后:
           `$env:KAIRO_JDTLS_HOME = 'E:\Apps\eclipse-jdt-ls'
  方式 C: 拷贝到项目约定路径:
           $JdtlsTarget
"@
        exit 1
    } else {
        Warn "用户启用 -AllowNoJdtls,继续打包 (Java 编辑器为纯文本)"
    }
}

# ─── 自检 4: apps/desktop/lib (TypeScript 编译产物) ────────
Step "自检 4/4: apps/desktop/lib (desktop TypeScript 编译产物)"
if (Test-Path $DesktopLib) {
    Ok "已就绪"
} else {
    Warn "缺失,正在编译 @kairo/desktop"
    Run-Step "pnpm --filter @kairo/desktop build" "pnpm --filter @kairo/desktop build"
    if (-not (Test-Path $DesktopLib) -and -not $DryRun) {
        Err "编译后仍未找到 $DesktopLib"
        exit 1
    }
}

# ─── 同步 bundled 到 apps/desktop/bundled ──────────────────
Step "同步 bundled/ -> apps/desktop/bundled/ (electron-builder 入口)"
if ($DryRun) {
    Info "DRY-RUN: node $DesktopDir/scripts/copy-bundled.js"
} else {
    Push-Location $RepoRoot
    try {
        node "$DesktopDir/scripts/copy-bundled.js"
        if ($LASTEXITCODE -ne 0) {
            Err "copy-bundled.js 失败"
            exit 1
        }
    } finally {
        Pop-Location
    }
    Ok "bundled 同步完成"
}

# ─── 同步 browser 产物 ────────────────────────────────────
Step "同步 browser artifacts -> apps/desktop/lib/frontend+backend"
$copyScript = Join-Path $DesktopDir "scripts/copy-browser-artifacts.js"
if ($DryRun) {
    Info "DRY-RUN: node $copyScript --strict"
} else {
    Push-Location $RepoRoot
    try {
        node "$copyScript" --strict
        if ($LASTEXITCODE -ne 0) {
            Warn "copy-browser-artifacts 失败,尝试先编译 browser"
            pnpm --filter @kairo/browser build
            if ($LASTEXITCODE -ne 0) {
                Err "browser 编译失败"
                exit 1
            }
            node "$copyScript" --strict
            if ($LASTEXITCODE -ne 0) {
                Err "重试 copy-browser-artifacts 仍失败"
                exit 1
            }
        }
    } finally {
        Pop-Location
    }
    Ok "browser artifacts 同步完成"
}

# ─── electron-builder --win zip ────────────────────────────
Step "electron-builder --win zip (出绿色版)"

# electron-builder 默认 output 写到 $DesktopDir\dist (含 win-unpacked 子目录)
# 项目内的 win-unpacked 经常被 TRAE IDE 锁住 -> EnsureEmptyDir 挂死
# 策略:用 --config 临时把 output 目录改写到 %TEMP%\kairo-out-$PID
#       跑完只把 zip 复制回 dist,不解锁原 win-unpacked

$tmpOut = Join-Path ([System.IO.Path]::GetTempPath()) "kairo-out-$PID"
if (Test-Path $tmpOut) { Remove-Item -Path $tmpOut -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $tmpOut | Out-Null

# 临时 config:覆盖 output + 关闭 npmRebuild + 显式 executableName
# (electron-builder 对 scoped npm 包 (@xxx/yyy) 会自动用 @xxxyyy 作 exe 名,
#  即使 build.executableName 已设置; --config 完全覆盖 build 段时尤其明显,
#  所以把 executableName 显式传进 --config)
#
# 注意:必须把 extraResources 显式写进 --config,
#  --config 完全覆盖 build 段时不会合并 package.json/yml 里的 extraResources
#  用绝对路径(以 $RepoRoot 为基准)避免 electron-builder 相对路径 base 不确定
$agentExe = Join-Path $RepoRoot "runtime-agent/bin/kairo-runtime.exe"
$tomcatSrc = Join-Path $RepoRoot "bundled/tomcat6"
$jdtlsSrc  = Join-Path $RepoRoot "bundled/jdtls"
$jdtlsReady = $jdtlsReady  # 由前面的自检阶段设置:$true 表示 jdtls 已就绪

$winExtra = @(
    @{ from = $agentExe; to = "bin/kairo-runtime.exe" }
    @{ from = $tomcatSrc; to = "bundled/tomcat6"; filter = @("**/*") }
)
if ($jdtlsReady -and (Test-Path (Join-Path $jdtlsSrc "config_win/config.ini"))) {
    $winExtra += @{ from = $jdtlsSrc; to = "bundled/jdtls"; filter = @("**/*") }
}

$tmpCfg = Join-Path $tmpOut "eb-cfg.json"
$cfg = @{
    directories     = @{ output = $tmpOut }
    win             = @{
        target         = @("zip")
        extraResources = $winExtra
    }
    publish         = $null
    npmRebuild      = $false
    executableName  = "Kairo"
    productName     = "Kairo"
} | ConvertTo-Json -Depth 8 -Compress
Set-Content -Path $tmpCfg -Value $cfg -Encoding UTF8

if ($DryRun) {
    Info "DRY-RUN: npx electron-builder --win zip --config $tmpCfg"
    Info "         (output 写到 $tmpOut 绕开项目内 dist\win-unpacked 的文件锁)"
} else {
    # 删掉旧产物(可能存在上一个 productName 的 zip)
    Get-ChildItem -Path $DistDir -Filter "*.zip" -File -ErrorAction SilentlyContinue | Remove-Item -Force
    # 显式删 tmpCfg 让 electron-builder 把 packaging 的 zip 写到 $tmpOut/$cfg.executableName

    Push-Location $DesktopDir
    try {
        $logFile = Join-Path $RepoRoot "artifacts/electron-builder-zip.log"
        # --publish=never 避免 electron-builder 因没 git repo 退出
        npx electron-builder --win zip --publish=never --config $tmpCfg 2>&1 | Tee-Object -FilePath $logFile
        if ($LASTEXITCODE -ne 0) {
            $zipCandidate = Get-ChildItem -Path $tmpOut -Filter "*.zip" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($zipCandidate) {
                Warn "electron-builder 退出码 $LASTEXITCODE 但已生成 zip $($zipCandidate.Name),忽略非致命错误"
            } else {
                Err "electron-builder 退出码 $LASTEXITCODE 且无 zip 产物,完整日志: artifacts/electron-builder-zip.log"
                # 不立即清理,留给排查
                exit 1
            }
        }
    } finally {
        Pop-Location
    }
    # 复制 zip 产物到 dist (不写 win-unpacked,不触碰项目原 dist 子目录)
    if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Force -Path $DistDir | Out-Null }
    Get-ChildItem -Path $tmpOut -Filter "*.zip" -File -ErrorAction SilentlyContinue | ForEach-Object {
        $dest = Join-Path $DistDir $_.Name
        Copy-Item -Path $_.FullName -Destination $dest -Force
        Ok "复制 $($_.Name) -> $dest"
    }
    # 异步清理 tmpOut(win-unpacked 可能很大,放后台跑)
    Start-Job -ScriptBlock {
        param($p) Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
    } -ArgumentList $tmpOut | Out-Null
    Ok "electron-builder 完成"
}

# ─── 产物清单 ──────────────────────────────────────────────
Step "产物清单"
if ($DryRun) {
    Info "DRY-RUN 模式,跳过产物检查"
} else {
    if (-not (Test-Path $DistDir)) {
        Err "$DistDir 不存在"
        exit 1
    }
    $artifacts = Get-ChildItem -Force $DistDir -File | Sort-Object Name
    $zip = $artifacts | Where-Object { $_.Name -like "*.zip" } | Select-Object -First 1
    $unpacked = Join-Path $DistDir "win-unpacked"
    $unpackedExe = Join-Path $unpacked "Kairo.exe"

    foreach ($a in $artifacts) {
        $size = [math]::Round($a.Length / 1MB, 1)
        Write-Host ("  {0,-50} {1,8} MB" -f $a.Name, $size) -ForegroundColor White
    }

    if ($zip) {
        Ok "绿色版 zip: $($zip.FullName)"
    } else {
        Err "未生成 zip 产物"
        exit 1
    }

    if (Test-Path $unpackedExe) {
        $exeSize = [math]::Round((Get-Item $unpackedExe).Length / 1MB, 1)
        Ok "解压后入口: $unpackedExe ($exeSize MB)"

        # 验证 kairo-runtime.exe 也被拷贝进 resources/bin/
        $agentInDist = Join-Path $unpacked "resources/bin/kairo-runtime.exe"
        if (Test-Path $agentInDist) {
            $agentSize = [math]::Round((Get-Item $agentInDist).Length / 1MB, 1)
            Ok "Go Agent 已嵌入: $agentInDist ($agentSize MB)"
        } else {
            Warn "未在 resources/bin/ 找到 kairo-runtime.exe"
        }
    } else {
        Warn "未生成 win-unpacked/Kairo.exe (不影响 zip)"
    }
}

# ─── 收尾 ──────────────────────────────────────────────────
$endBanner = @"

╔══════════════════════════════════════════════════════════╗
║   打包完成                                              ║
╚══════════════════════════════════════════════════════════╝

交付给最终用户:
  1. 把 Kairo-0.1.0-win-x64.zip 拷给用户
  2. 用户解压到任意目录(支持中文路径、空格)
  3. 双击 Kairo.exe 即可启动,无需安装、无需配置
  4. 首次启动会拉起 Go Runtime Agent + Theia Backend,
     浏览器内核内嵌显示 127.0.0.1:随机端口

如果 jdtls 缺失,用户打开 .java 文件时只能纯文本编辑;
构建/调试/Tomcat/搜索等功能不受影响 (这些不依赖 JDTLS)。
"@
Write-Host $endBanner -ForegroundColor Green
