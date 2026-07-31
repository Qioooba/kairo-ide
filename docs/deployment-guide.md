# Kairo IDE — 部署管理员指南

> 适用版本：Kairo IDE v0.1.0+
> 最后更新：2026-07-23
> 目标读者：企业 IT 管理员、运维工程师

> **快速使用指南**: 最终用户请参阅 [docs/DEPLOY-GUIDE.md](DEPLOY-GUIDE.md)

本文档面向企业 IT 管理员，涵盖 Kairo IDE 的部署方式、安全配置、企业部署策略和监控维护。

---

## 目录

1. [系统要求](#1-系统要求)
2. [安装方式](#2-安装方式)
3. [预配置](#3-预配置)
4. [安全配置](#4-安全配置)
5. [企业部署](#5-企业部署)
6. [监控与维护](#6-监控与维护)
7. [升级与回滚](#7-升级与回滚)

---

## 1. 系统要求

### 1.1 硬件要求

| 项目 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 2 vCPU | 4 vCPU |
| 内存 | 4 GB RAM | 8 GB RAM |
| 磁盘空间 | 2 GB（安装） | 10 GB（含项目、缓存） |
| 显示器分辨率 | 1280×720 | 1920×1080 |

**实际内存占用估算**（4 GB 环境）：

| 进程 | 内存占用 |
|------|----------|
| Kairo IDE Shell (Theia + Electron) | ~400 MB |
| Runtime Agent (Go) | ~50 MB |
| JDT Language Server (Java 17+) | ~300–768 MB |
| Tomcat 6 (运行中) | ~128–512 MB |
| **稳态总计** | **< 1.2 GB（不含 Tomcat）** |

### 1.2 操作系统要求

| 操作系统 | 版本 | 架构 |
|----------|------|------|
| Windows | Windows 10 或 Windows Server 2022 | x86_64, ARM64 |
| macOS | macOS 14 (Sonoma) 或更新 | x86_64, ARM64 (Apple Silicon) |
| Linux | RHEL 8/9, Ubuntu 22.04/24.04 | x86_64, ARM64 |

### 1.3 软件依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 20.10+ | IDE 运行时 |
| pnpm | 9.x | 包管理（开发模式） |
| Java (JDT LS) | 17+ | JDT Language Server 运行（IDE 自动下载） |
| Java (项目) | 6 | 用户提供的 JDK 6，用于编译和运行遗留项目 |
| WebView2 | 最新 | Windows Desktop 模式需要（Windows 10 需手动安装） |
| Git | 2.30+ | 可选，版本控制功能需要 |

### 1.4 权限要求

- **安装**：不需要管理员权限（`per-user` 安装）
- **运行**：不需要管理员权限
- **网络**：仅需本地回环访问（`127.0.0.1`），无外部网络要求
- **文件系统**：仅需对安装目录和用户数据目录的读写权限

### 1.5 网络要求

Kairo IDE v1 为本地应用，网络要求极低：

- **本地回环**：Agent 绑定 `127.0.0.1`，仅本地通信
- **外部网络**：仅首次使用时下载 Tomcat 6 和 JDT LS（可离线预置）
- **防火墙**：无需开放任何入站端口
- **代理**：支持 HTTP/HTTPS 代理（通过环境变量配置）

---

## 2. 安装方式

### 2.1 Windows Desktop 便携包安装

**适用场景**：最终用户直接使用，最常用的安装方式。

**安装步骤**：

1. **下载安装包**

   获取 `Kairo-IDE-Setup-0.1.0.exe` 或 `Kairo-IDE-0.1.0-win-x64.zip`。

2. **验证 SHA-256 校验和**
   ```powershell
   # PowerShell
   Get-FileHash Kairo-IDE-0.1.0-win-x64.zip -Algorithm SHA256
   # 对比 dist/checksums.txt 中的值
   ```

3. **安装**

   - **安装包**：双击 `Kairo-IDE-Setup-0.1.0.exe`，选择 `per-user` 安装（不需要管理员权限）
   - **便携包**：解压 `Kairo-IDE-0.1.0-win-x64.zip` 到任意目录（如 `%LOCALAPPDATA%\Kairo\`）

4. **安装目录结构**

   ```
   %LOCALAPPDATA%\Kairo\
   ├── bin/
   │   ├── kairo-runtime.exe     # Runtime Agent
   │   └── kairo-server.exe      # Browser 模式服务器
   ├── lib/                       # Theia + 扩展
   ├── bundled/
   │   ├── tomcat6/               # 首次使用自动下载
   │   ├── jdtls/                 # 首次使用自动下载
   │   └── plugins/               # 内置插件
   ├── docs/                      # 本地文档
   ├── third-party-notices.txt
   └── LICENSE
   ```

5. **启动验证**

   双击 `Kairo.exe` 或从开始菜单启动，确认 IDE 正常打开。

### 2.2 Windows localhost Browser 启动

**适用场景**：无需安装桌面应用，通过浏览器使用。

**安装步骤**：

1. 解压 Browser 启动包到任意目录

2. 启动 Kairo 服务器：
   ```powershell
   .\bin\kairo-server.exe --bind 127.0.0.1 --port 3000
   ```

3. 浏览器打开 `http://localhost:3000`

4. 支持的浏览器：
   - Chrome 90+
   - Edge 90+
   - Safari 15+

**注意**：Browser 模式默认不需要认证。如需认证，添加 `--require-auth` 参数。

### 2.3 macOS Desktop 安装

**安装步骤**：

1. **下载安装包**

   获取 `Kairo-IDE-0.1.0-darwin-arm64.dmg`（Apple Silicon）或 `Kairo-IDE-0.1.0-darwin-x64.dmg`（Intel）。

2. **验证 SHA-256**
   ```bash
   shasum -a 256 Kairo-IDE-0.1.0-darwin-arm64.dmg
   ```

3. **安装**

   双击 `.dmg` 文件，将 `Kairo.app` 拖到 `Applications` 文件夹。

4. **首次启动**

   由于应用未签名，首次启动时可能需要：
   ```bash
   # 如果提示"无法验证开发者"
   xattr -cr /Applications/Kairo.app
   ```
   或在 **系统设置 → 隐私与安全性** 中点击 **仍要打开**。

5. **启动验证**

   双击 `Kairo.app`，确认 IDE 正常打开。

### 2.4 离线安装包部署

**适用场景**：内网环境，无法访问外部网络。

**准备工作**（在有网络的机器上）：

1. 构建完整安装包
2. 预下载所有依赖：
   ```bash
   # 预下载 Tomcat 6
   bash scripts/fetch-tomcat6.sh --mirror https://internal-mirror.example.com/

   # 预下载 JDT LS
   bash scripts/prepare-bundled.sh
   ```
3. 将 `bundled/` 目录一并打包

**离线安装**：

1. 将完整安装包（含 `bundled/`）复制到目标机器
2. 解压到安装目录
3. 启动 IDE
4. 确认 IDE 不会尝试下载外部依赖

### 2.5 安装目录说明

| 目录 | 用途 | 权限 |
|------|------|------|
| `bin/` | 可执行文件 | 只读 |
| `lib/` | Theia 前端 + 扩展 | 只读 |
| `bundled/tomcat6/` | Tomcat 6 二进制 | 只读 |
| `bundled/jdtls/` | JDT LS 二进制 | 只读 |
| `bundled/jdk/` | 用户导入的 JDK | 只读 |
| `bundled/plugins/` | 内置插件 | 只读 |

用户数据目录：

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\Kairo\` |
| macOS | `~/Library/Application Support/Kairo/` |
| Linux | `~/.config/kairo/` |

---

## 3. 预配置

### 3.1 预置 JDK 6 路径

在企业环境中，可以预先配置 JDK 6 路径，避免每个用户手动导入。

**方法一：环境变量**

```bash
# Windows
setx JAVA_HOME "C:\Program Files\Java\jdk1.6.0_45"
setx KAIRO_JDK6_HOME "C:\Program Files\Java\jdk1.6.0_45"

# macOS / Linux
export JAVA_HOME=/opt/jdk1.6.0_45
export KAIRO_JDK6_HOME=/opt/jdk1.6.0_45
```

**方法二：预导入到 bundled**

将 JDK 6 复制到 `bundled/jdk/jdk6/` 目录，IDE 启动时自动识别。

### 3.2 预置 Tomcat 6 路径

**方法一：预下载**

```bash
# 在有网络的机器上预下载
bash scripts/fetch-tomcat6.sh

# 将 bundled/tomcat6/ 复制到目标机器
```

**方法二：使用企业已有 Tomcat 6**

在运行配置中指定 Tomcat 6 路径：
```json
{
  "server": {
    "catalinaHome": "C:/apache-tomcat-6.0.53"
  }
}
```

### 3.3 预置 JDT LS 版本

JDT LS 版本在 `supply-chain-lock.json` 中锁定。预置步骤：

```bash
# 验证 JDT LS 版本
bash scripts/verify-bundled-dependencies.cjs

# 预下载 JDT LS
bash scripts/prepare-bundled.sh
```

### 3.4 预置项目模板

可以在 `bundled/templates/` 目录中放置项目模板，用户创建新项目时可以选择模板。

### 3.5 预置搜索索引

首次打开大型项目时，JDT LS 会建立索引。可以在企业环境中预先建立索引：

```bash
# 在项目目录中运行
kairo-runtime --index-project /path/to/project
```

---

## 4. 安全配置

### 4.1 网络访问控制

Kairo IDE v1 的安全策略：

| 组件 | 绑定地址 | 说明 |
|------|----------|------|
| Runtime Agent | `127.0.0.1` | 仅本地回环，不可远程访问 |
| Tomcat 6 | `127.0.0.1` | 仅本地回环，Manager/AJP/JMX/JDWP 均不对外暴露 |
| Browser 模式 | `127.0.0.1`（默认） | 可通过 `--bind` 修改，但需配置 TLS 和认证 |

**拒绝的配置**：
- Agent 绑定 `0.0.0.0`（生产环境禁止）
- Tomcat 绑定非回环地址
- Browser 模式不配置 TLS 和认证时绑定非回环地址

### 4.2 文件系统访问限制

Kairo IDE 实施工作区沙箱策略：

- **工作区根目录**：用户导入的项目目录
- **可读范围**：工作区根目录及其子目录
- **可写范围**：工作区根目录及其子目录、用户数据目录
- **只读保护目录**：`bundled/`、`bin/`、`lib/`
- **符号链接**：指向工作区外部的符号链接会被拒绝访问

**路径穿越防护**：

`../`、`\`、UNC 路径、NTFS 流名称等均会被拒绝。

### 4.3 端口配置

Kairo IDE 使用的默认端口：

| 端口 | 组件 | 用途 | 可配置 |
|------|------|------|--------|
| 18080 | Runtime Agent | HTTP API（开发模式） | 是 |
| 3000 | Browser 模式 | Theia 前端 | 是 |
| 8080 | Tomcat 6 | HTTP 服务 | 是 |
| 8000 | Tomcat 6 | JDWP 调试端口 | 是 |
| 5005 | Tomcat 6 | 备用调试端口 | 是 |

**修改端口配置**：

```bash
# Agent 端口
export KAIRO_RUNTIME_PORT=18080

# Browser 模式端口
kairo-server --port 3000

# Tomcat 和 Debug 端口在运行配置中修改
```

### 4.4 密钥管理

Kairo IDE 的密钥存储方式：

| 密钥类型 | 存储位置 | 加密方式 |
|----------|----------|----------|
| 用户密码 | `secrets.json` | Argon2id 哈希 |
| 会话令牌 | 内存 | 32 字节随机数，base64url |
| JDWP 令牌 | 内存 | 会话级 |
| 数据库密码 | `secrets.json` | OS 级加密（DPAPI/Keychain） |
| SSH 密钥 | `secrets.json` | OS 级加密 |

**secrets.json 保护**：

- 诊断包明确排除 `secrets.json`
- 日志中不记录任何密钥信息
- 环境变量中的敏感信息在诊断包中脱敏
- 用户配置目录权限为 `0700`（仅用户可读）

### 4.5 安全最佳实践

1. **始终使用 HTTPS（Browser 模式）**

   Browser 模式绑定非回环地址时，必须配置 TLS：
   ```bash
   kairo-server \
     --bind 10.0.1.50 \
     --port 443 \
     --tls-cert /etc/kairo/tls.crt \
     --tls-key /etc/kairo/tls.key
   ```

2. **启用认证**

   Browser 模式绑定非回环地址时，必须启用认证：
   ```bash
   kairo-server --require-auth
   ```

3. **限制 Tomcat 端口**

   Tomcat 的所有端口（HTTP、AJP、JMX、JDWP）仅绑定 `127.0.0.1`。

4. **定期审计**

   审计日志位置：`.legacyflow/audit.log.ndjson`
   - 记录所有状态变更操作
   - 记录路径穿越尝试
   - 记录认证失败

5. **禁用不必要的功能**

   在项目配置中禁用不需要的 Tomcat 连接器：
   ```json
   {
     "server": {
       "disableAJP": true,
       "disableJMX": true
     }
   }
   ```

---

## 5. 企业部署

### 5.1 离线环境部署

**完全离线部署步骤**：

1. **在联网机器上准备离线包**

   ```bash
   # 1. 构建所有组件
   pnpm build
   pnpm build:agent

   # 2. 下载所有依赖
   bash scripts/prepare-bundled.sh
   bash scripts/fetch-tomcat6.sh

   # 3. 生成 SBOM 和校验和
   node scripts/generate-sbom.cjs
   node scripts/sign-release.cjs

   # 4. 打包
   tar -czf kairo-offline-bundle.tar.gz dist/ bundled/ docs/
   ```

2. **在离线目标机器上部署**

   ```bash
   # 解压
   tar -xzf kairo-offline-bundle.tar.gz -C /opt/kairo/

   # 验证完整性
   node scripts/verify-bundled-dependencies.cjs
   node scripts/supply-chain.test.cjs

   # 启动
   /opt/kairo/bin/kairo-server --bind 127.0.0.1 --port 3000
   ```

### 5.2 代理环境配置

如果企业网络需要通过代理访问外部资源（用于首次下载依赖）：

**HTTP/HTTPS 代理**：

```bash
# Windows
set HTTP_PROXY=http://proxy.example.com:8080
set HTTPS_PROXY=http://proxy.example.com:8080
set NO_PROXY=localhost,127.0.0.1

# macOS / Linux
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1
```

**npm/pnpm 代理**：

```bash
npm config set proxy http://proxy.example.com:8080
npm config set https-proxy http://proxy.example.com:8080
```

### 5.3 杀毒软件例外配置

为防止杀毒软件干扰 Kairo IDE 的正常运行，建议配置以下例外：

| 路径 | 原因 |
|------|------|
| `%LOCALAPPDATA%\Kairo\` | 安装目录和用户数据 |
| `%APPDATA%\Kairo\` | 用户配置和缓存 |
| 项目工作区目录 | 源代码和构建产物 |

**Windows Defender 例外**：

```powershell
Add-MpPreference -ExclusionPath "%LOCALAPPDATA%\Kairo"
Add-MpPreference -ExclusionPath "%APPDATA%\Kairo"
```

**常见杀毒软件干扰现象**：

- IDE 启动缓慢
- 文件监视器不工作
- 构建产物被隔离
- `kairo-runtime.exe` 被阻止运行

### 5.4 组策略配置

通过 Windows 组策略可以统一管理 Kairo IDE 配置：

**注册表路径**：`HKEY_CURRENT_USER\Software\Kairo\`

| 键名 | 类型 | 值 | 说明 |
|------|------|-----|------|
| `InstallPath` | REG_SZ | `%LOCALAPPDATA%\Kairo` | 安装路径 |
| `Jdk6Path` | REG_SZ | `C:\jdk1.6.0_45` | JDK 6 路径 |
| `TomcatPath` | REG_SZ | `C:\tomcat6` | Tomcat 6 路径 |
| `AgentPort` | REG_DWORD | `18080` | Agent 端口 |
| `LogLevel` | REG_SZ | `info` | 日志级别 |
| `DisableExternalNetwork` | REG_DWORD | `1` | 禁止外部网络访问 |

**配置文件模板**（`%APPDATA%\Kairo\config.json`）：

```json
{
  "jdk6": {
    "path": "C:\\Program Files\\Java\\jdk1.6.0_45",
    "autoDetect": false
  },
  "tomcat": {
    "path": "C:\\apache-tomcat-6.0.53",
    "autoDownload": false
  },
  "network": {
    "allowExternal": false,
    "proxy": "http://proxy.example.com:8080"
  },
  "security": {
    "requireAuth": true,
    "sessionTimeout": 28800
  }
}
```

---

## 6. 监控与维护

### 6.1 日志收集和轮转

**日志位置**：

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\Kairo\logs\` |
| macOS | `~/Library/Application Support/Kairo/logs/` |
| Linux | `~/.config/kairo/logs/` |

**日志文件**：

| 文件 | 内容 | 轮转策略 |
|------|------|----------|
| `kairo.log` | IDE 主日志 | 按大小轮转，保留最近 5 个文件 |
| `agent.log` | Runtime Agent 日志 | 按大小轮转，保留最近 5 个文件 |
| `jdtls.log` | JDT LS 日志 | 按大小轮转，保留最近 3 个文件 |
| `tomcat.log` | Tomcat 运行日志 | 按大小轮转，保留最近 5 个文件 |
| `audit.log.ndjson` | 审计日志 | 按天轮转，保留 90 天 |

**日志级别**：

```bash
export KAIRO_LOG_LEVEL=debug  # debug | info | warn | error
```

### 6.2 诊断包收集

**收集诊断包**：

1. 在 IDE 中执行 **Kairo: 生成诊断包**
2. 或通过命令行：
   ```bash
   curl -X POST http://127.0.0.1:18080/api/v1/diagnostics/bundle
   ```

**诊断包内容**（详见 `docs/troubleshooting.md` §9.2）：

- 版本信息、OS 信息
- 最近 1000 行日志（Agent、JDT LS、Tomcat）
- 进程列表、端口占用
- 环境变量（已脱敏）
- 最近 50 条错误

**诊断包安全**：

- 不包含源代码
- 不包含密钥和密码
- 敏感信息已自动脱敏
- 审计日志不包含在诊断包中

### 6.3 性能监控

**监控指标**：

| 指标 | 目标值 | 检查方法 |
|------|--------|----------|
| IDE 启动时间 | ≤ 8 秒 | 从启动器点击到编辑器可操作 |
| 稳态内存 | < 1.2 GB | 任务管理器 / Activity Monitor |
| 空闲 CPU | < 3% | 任务管理器 / Activity Monitor |
| 磁盘使用 | < 2 GB | 检查安装目录和用户数据目录 |

**监控脚本**：

```bash
# macOS / Linux
ps -o pid,rss,%cpu,command | grep -i kairo

# Windows
tasklist /FI "IMAGENAME eq kairo*" /FO CSV
```

### 6.4 资源使用监控

**定期检查项**：

1. **磁盘空间**

   检查用户数据目录大小：
   ```bash
   # macOS / Linux
   du -sh ~/Library/Application\ Support/Kairo/

   # Windows
   dir /s %APPDATA%\Kairo\
   ```

2. **进程状态**

   检查是否有残留进程：
   ```bash
   # macOS / Linux
   ps aux | grep -E "kairo|tomcat|java.*jdt"

   # Windows
   tasklist | findstr /I "kairo tomcat java"
   ```

3. **端口占用**

   检查是否有端口冲突：
   ```bash
   # macOS / Linux
   lsof -i -P | grep LISTEN

   # Windows
   netstat -ano | findstr LISTENING
   ```

---

## 7. 升级与回滚

### 7.1 版本检查

**检查当前版本**：

在 IDE 中，打开 **Help → About**，查看版本号。

或通过命令行：
```bash
kairo-runtime --version
```

**检查更新**（需要网络）：

```bash
curl https://kairo.example.com/api/v1/version/latest
```

### 7.2 升级前备份

**必须备份的内容**：

```bash
# Windows
xcopy /E /I %LOCALAPPDATA%\Kairo %LOCALAPPDATA%\Kairo.backup\
xcopy /E /I %APPDATA%\Kairo %APPDATA%\Kairo.backup\

# macOS / Linux
cp -r /Applications/Kairo.app /Applications/Kairo.app.backup
cp -r ~/Library/Application\ Support/Kairo ~/Library/Application\ Support/Kairo.backup
```

**备份内容说明**：

| 路径 | 内容 |
|------|------|
| 安装目录 | 程序文件、运行时、bundled 依赖 |
| 用户数据目录 | 配置、缓存、日志、密钥 |

### 7.3 升级步骤

1. **关闭所有 Kairo IDE 实例**

   确保所有 IDE 窗口和 Agent 进程已关闭：
   ```bash
   # macOS / Linux
   pkill -f kairo-runtime

   # Windows
   taskkill /F /IM kairo-runtime.exe
   taskkill /F /IM Kairo.exe
   ```

2. **备份当前安装**（见 §7.2）

3. **安装新版本**

   按照 §2 的安装步骤安装新版本。

4. **启动并验证**（见 §7.4）

### 7.4 升级后验证

1. **检查版本号**

   在 IDE 中 **Help → About** 确认版本号正确。

2. **验证最近项目列表**

   确认 **File → Open Recent** 中显示之前的项目。

3. **验证运行配置**

   确认运行配置下拉菜单中显示之前的配置。

4. **验证编码设置**

   打开文件，确认编码指示器显示正确的编码。

5. **验证键盘快捷键**

   测试常用快捷键是否正常工作。

6. **运行冒烟测试**

   - 打开项目
   - 搜索文本
   - 构建项目
   - 启动 Tomcat
   - 访问应用

### 7.5 回滚步骤

1. **关闭 IDE**

2. **恢复备份的安装目录**
   ```bash
   # Windows
   rmdir /s /q %LOCALAPPDATA%\Kairo
   xcopy /E /I %LOCALAPPDATA%\Kairo.backup %LOCALAPPDATA%\Kairo

   # macOS
   rm -rf /Applications/Kairo.app
   cp -r /Applications/Kairo.app.backup /Applications/Kairo.app
   ```

3. **恢复工作区配置**（如需要）
   ```bash
   # Windows
   rmdir /s /q %APPDATA%\Kairo
   xcopy /E /I %APPDATA%\Kairo.backup %APPDATA%\Kairo

   # macOS / Linux
   rm -rf ~/Library/Application\ Support/Kairo
   cp -r ~/Library/Application\ Support/Kairo.backup ~/Library/Application\ Support/Kairo
   ```

4. **启动旧版本并验证功能正常**

### 7.6 配置迁移

**用户设置迁移**：

用户设置文件位于 `%APPDATA%\Kairo\settings.json`，升级时自动保留。如果手动迁移：

```bash
cp ~/Library/Application\ Support/Kairo.backup/settings.json \
   ~/Library/Application\ Support/Kairo/settings.json
```

**键盘快捷键迁移**：

快捷键配置位于 `%APPDATA%\Kairo\keybindings.json`。

**连接配置迁移**：

运行配置位于 `.kairo/run-configurations/` 目录中，随项目迁移。

**项目配置迁移**：

项目配置（`.kairo/project.json`）位于项目根目录，随项目迁移。

### 7.7 已知版本兼容性问题

| 版本变更 | 影响 | 迁移操作 |
|----------|------|----------|
| 配置格式变更 | 旧版本配置文件可能不兼容 | 备份后手动迁移 |
| 协议版本变更 | Agent 与前端协议不匹配 | 确保同时升级前端和 Agent |
| API 废弃 | 旧 API 路径可能不可用 | 参考发版说明中的变更列表 |

### 7.8 企业级升级策略

**分批升级**：

1. 先在测试组部署新版本
2. 验证功能和兼容性
3. 分批推广到所有用户

**静默升级**：

可以通过组策略或 SCCM 推送升级包，用户下次启动时自动升级。

**回滚准备**：

- 每次升级前保留至少一个可回滚版本
- 记录升级前的版本号和配置
- 准备回滚脚本

---

## 附录 A：安装目录完整结构

```
install-root/
├── bin/
│   ├── kairo-runtime          # Runtime Agent (Go 编译产物)
│   ├── kairo-runtime.exe      # Windows 版本
│   ├── kairo-server            # Browser 模式服务器
│   └── kairo-admin             # 管理工具
├── lib/
│   ├── backend/                # Theia 后端
│   ├── frontend/               # Theia 前端
│   └── extensions/             # Kairo 扩展
├── bundled/
│   ├── tomcat6/                # Apache Tomcat 6.0.53
│   ├── jdtls/                  # Eclipse JDT LS 1.55.0
│   ├── jdk/                    # 用户导入的 JDK
│   │   └── jdk6/               # JDK 6（只读）
│   └── plugins/                # 内置 LegacyFlow 插件
├── docs/                       # 本地文档
│   ├── troubleshooting.md
│   ├── debug-guide.md
│   ├── deployment-guide.md
│   └── upgrade-guide.md
├── scripts/                    # 管理脚本
│   ├── fetch-tomcat6.sh
│   ├── prepare-bundled.sh
│   └── verify-bundled-dependencies.cjs
├── third-party-notices.txt
└── LICENSE
```

## 附录 B：用户数据目录结构

```
{userConfigDir}/kairo/
├── config.json                 # 用户配置
├── settings.json               # 用户设置
├── keybindings.json            # 键盘快捷键
├── secrets.json                # 加密密钥（被排除在诊断包外）
├── cache/                      # 缓存
│   ├── jdtls/                  # JDT LS 缓存
│   └── theia/                  # Theia 前端缓存
├── logs/                       # 日志
│   ├── kairo.log
│   ├── agent.log
│   ├── jdtls.log
│   └── tomcat.log
├── plugins/                    # 用户安装的插件
└── recent-projects.json        # 最近项目列表
```

## 附录 C：环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KAIRO_RUNTIME_PORT` | 18080 | Agent HTTP 端口 |
| `KAIRO_RUNTIME_BIND` | 127.0.0.1 | Agent 绑定地址 |
| `KAIRO_LOG_LEVEL` | info | 日志级别 (debug/info/warn/error) |
| `KAIRO_BUNDLED_DIR` | ./bundled | bundled 依赖目录 |
| `KAIRO_USER_CONFIG_DIR` | 平台默认 | 用户配置目录 |
| `KAIRO_JDK6_HOME` | 未设置 | JDK 6 路径 |
| `KAIRO_JDTLS_MAX_HEAP_MB` | 768 | JDT LS 最大堆内存 (MB) |
| `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND` | 未设置 | Debug Adapter 可执行文件路径 |
| `KAIRO_JAVA_DEBUG_ADAPTER_ARGS` | 未设置 | Debug Adapter 参数 (JSON 数组) |
| `HTTP_PROXY` | 未设置 | HTTP 代理 |
| `HTTPS_PROXY` | 未设置 | HTTPS 代理 |
| `NO_PROXY` | 未设置 | 代理例外列表 |