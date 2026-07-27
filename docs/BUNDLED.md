# `bundled/` — off-line vendor layout

The Kairo Runtime Agent expects to find the Tomcat 6.0.53
distribution and the Eclipse JDT Language Server (pinned to
jdtls 1.55.0, released 2026-01-13) under `<repo>/bundled/`
so that a cold first launch on a developer machine with no
network access still works.

If `bundled/` is empty, the agent fails fast with
`jdtls is not installed and the archive could not be
obtained` / `no JDK 17 found and no local archive
available` (no silent fallback to a public URL — this
is the offline-by-design policy).

## Layout

```
bundled/
├── .manifest.json          (written by prepare-bundled.ps1)
├── tomcat6/
│   ├── apache-tomcat-6.0.53/
│   ├── apache-tomcat-6.0.53.tar.gz
│   ├── LICENSE
│   └── NOTICE
└── jdtls/
    ├── plugins/
    ├── config_linux/
    ├── config_win/
    └── config_mac/
```

## How to prepare (Windows)

```powershell
# 1. Get the Tomcat 6.0.53 tarball and verify it against
#    the Apache KEYS file (out-of-band; see BLOCKERS.md
#    B-002 for why no .sha256 is published).
$env:KAIRO_TOMCAT6_SHA256 = '<64-hex chars>'

# 2. Run the prepare script. Without -Strict it only copies
#    from local source paths (KAIRO_TOMCAT6_HOME /
#    KAIRO_JDTLS_HOME or the fallback locations). Pass
#    -Strict to force a verified download via
#    KAIRO_*_ARCHIVE_URL + SHA-256 check; release
#    packaging must use -Strict.
pnpm exec pwsh scripts/prepare-bundled.ps1
```

The script is **idempotent**. Re-running it is a no-op
when both directories are already populated. Parameters:
`-Strict` (force verified download via `KAIRO_*_ARCHIVE_URL`
+ SHA-256, fail closed — release packaging must use this),
`-RepoRoot` / `-BundledRoot` (override default paths).
There is no `-Force` flag.

## CI / release pipeline

`apps/desktop/package.json` has a `build:win` script.
The recommended chain is:

```jsonc
{
  "scripts": {
    "bundled:prepare": "pwsh scripts/prepare-bundled.ps1",
    "prebuild": "pnpm run bundled:prepare && node scripts/build-agent.js && node scripts/copy-browser-artifacts.js",
    "build:win": "tsc -p tsconfig.json && electron-builder --win"
  }
}
```

`prebuild` already runs before `build:win`, so adding
`bundled:prepare` to `prebuild` covers CI without
extra wiring.

## How to prepare (macOS / Linux)

`scripts/fetch-tomcat6.sh` already exists for the
Tomcat half. A future `scripts/prepare-bundled.sh`
should mirror the Windows script. For now, run the
Windows script via PowerShell Core (it is
PowerShell-only, no `bash`-specific syntax).

## Manual fallback (no network)

If the build machine has no network at all, copy
`bundled/` from a known-good developer machine and
check `.manifest.json` into source control (or a CI
cache). The runtime agent reads `bundled/` on every
startup; it does not need the file to be re-stamped
at build time.

## Verification

After `prepare-bundled.ps1` returns 0:

```powershell
Test-Path bundled/tomcat6/apache-tomcat-6.0.53
# True

Test-Path bundled/jdtls/plugins
# True

Get-Content bundled/.manifest.json | ConvertFrom-Json
# Should show a manifest with the SHA-256 you supplied.
```

The runtime agent reads `bundled/` automatically — no
further wiring is required.

## P0-15 status

The `bundled/` directory was empty in the wave-2
repository. This document and `prepare-bundled.ps1`
are the mitigation: the developer / CI now has a
one-line command to populate `bundled/` with verified
binaries before the first launch. The runtime-agent
fall-back to the network download path remains
unchanged for environments that prefer it.

## 完全离线/内网部署清单 (Air-Gapped Deployment) 🆕

Session 10 联网审计后,Kairo IDE 在打包 zip 后部署到完全内网 Windows 机器上时,需满足以下条件才能 0 公网访问运行。

### 强制前置条件

| # | 条件 | 说明 |
|---|------|------|
| 1 | JDK 17 已预装或通过 `KAIRO_JDK_HOME`/`KAIRO_JDK_ARCHIVE`/`KAIRO_JDK_ARCHIVE_URL` 注入 | runtime-agent 不会自动从公网下载 JDK；`KAIRO_JDK_ARCHIVE_URL` 支持内网镜像（HTTP/HTTPS 或 `file://`），配合 `KAIRO_JDK_SHA256` 校验 |
| 2 | `bundled/jdtls/` 已用 `prepare-bundled.ps1 -Strict` 预打包 | `-Strict` 模式强制要求,无 archive 时直接 exit 2 |
| 3 | `bundled/tomcat6/` 已用 `prepare-bundled.ps1 -Strict` 预打包 | 同上 |
| 4 | 构建机执行过 `pnpm build:win` | 把 bundled 目录打入 NSIS/zip 安装包 |
| 5 | 内网构建机无 `KAIRO_CODE_SIGN_TIMESTAMP` 时跳过时间戳 | sign-win.cjs 已删除 `http://timestamp.digicert.com` 默认值 |
| 6 | 内网构建机无 `KAIRO_UPGRADE_ENDPOINT` 时 KAIRO_ALLOW_UPGRADE_CHECK 不为 1 | KairoUpgradeChecker 默认 disabled |
| 7 | 内网构建机无 `KAIRO_TELEMETRY_ENDPOINT` 时 KAIRO_ALLOW_TELEMETRY 不为 1 | KairoTelemetry 默认 disabled |

### 主进程运行时联网边界(已强制)

| 行为 | 触发条件 | 拦截位置 |
|------|----------|----------|
| `shell.openExternal(http/https)` | `KAIRO_ALLOW_EXTERNAL_LINKS=1` 才放开 | `apps/desktop/src/main.ts:596` |
| 顶层导航到非 `127.0.0.1`/`localhost` | 默认拦截 | `apps/desktop/src/main.ts:619` (`will-navigate`) |
| `fetch()` 跨域 | CSP `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*` 拦截 | `apps/desktop/src/main.ts:660-666` |
| `<img>` 引用外网 | CSP `img-src 'self' data:` 拦截 | `apps/desktop/src/main.ts:664` |
| JDTLS 下载到公网 | 无任何代码路径会回退到 `https://download.eclipse.org/...` | `runtime-agent/internal/jdtls/distribution.go` (常量已注释) |
| 升级检查 | `KAIRO_ALLOW_UPGRADE_CHECK != '1'` 时直接 no-op | `kairo-upgrade-check.ts:67` |
| 遥测上报 | `KAIRO_ALLOW_TELEMETRY != '1'` 时事件仅本地存储 | `kairo-telemetry.ts:62` |
| Windows 注册表 URLInfoAbout | NSIS 写入 `file:///$INSTDIR/docs/index.html`,不会触发 explorer 联网 | `scripts/installer/kairo-setup.nsi:9` |

### NSIS 安装包内网部署步骤

1. **构建机** (需联网,一次):
   - `pnpm prepare-bundled -Strict`  → 拉取 Tomcat + JDT LS 到 `apps/desktop/bundled/`
   - `pnpm build:win`                → 产出 `dist/Kairo IDE-*-win-x64.exe` 和 `*-win-x64.zip`
2. **拷贝** `dist/Kairo IDE-*-win-x64.zip` 到内网 Windows 机器
3. **目标机** (全离线):
   - 解压 zip 到任意目录,或运行 NSIS exe 装到 Program Files
   - 双击 `KairoIDE.exe` 启动
   - 首次启动时,Go Agent 会读取 `apps/desktop/bundled/` 或 `<DataDir>/bundled/`
   - 无任何主动网络请求

### 已知限制

- **代码签名时间戳**: 离线签名时 `sign-win.cjs` 不会带 trusted timestamp。Windows 仍可安装,但 SmartScreen 信誉建立会变慢。如需时间戳,需在有内网 RFC 3161 时间戳服务器的环境重新签名。
- **外部帮助链接**: 默认拦截所有外链。如需在 IDE 内访问内网文档/工单,设置 `KAIRO_ALLOW_EXTERNAL_LINKS=1` 并在内网只放行特定域(由 CSP/CORS 配合)。
- **Maven 在线模式**: 用户主动选择"在线解析依赖"时,会调用系统 `mvn` 二进制,该二进制自身的 repository/mirror 配置由用户控制。如需严格隔离,使用 `KAIRO_MAVEN_OFFLINE=1`(若启用)。
