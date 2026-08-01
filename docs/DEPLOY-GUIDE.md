# Kairo IDE — 部署与使用手册

> 适用版本: Kairo IDE v0.1.0+
> 最后更新: 2026-07-30
> 目标读者: 内网用户、IT 管理员

---

## 目录

1. [快速开始](#1-快速开始)
2. [两种启动模式](#2-两种启动模式)
3. [环境要求](#3-环境要求)
4. [内网离线部署](#4-内网离线部署)
5. [一键打包（管理员用）](#5-一键打包管理员用)
6. [常见问题](#6-常见问题)

---

## 1. 快速开始

### 1.1 获取安装包

从管理员处获取分卷压缩包（如 `KairoIDE-v0.1.0-win-x64.7z.001` ~ `.004`）。

### 1.2 解压

**步骤:**
1. 安装 [7-Zip](https://7-zip.org/)（如未安装）
2. 右键 `KairoIDE-v0.1.0-win-x64.7z.001` → **7-Zip → 解压到当前文件夹**
3. 得到 `Kairo-0.1.0-win.zip`
4. 将 `Kairo-0.1.0-win.zip` 解压到任意目录（支持中文路径、空格）

**解压后的目录结构:**

```
Kairo/
├── Kairo.exe                  # 桌面版启动程序
├── Kairo-Server.exe           # 浏览器版启动程序
├── start-browser-mode.cmd     # 浏览器版启动脚本（双击）
├── resources/
│   ├── bin/
│   │   └── kairo-runtime.exe  # 后台服务
│   └── bundled/
│       ├── tomcat6/           # Apache Tomcat 6.0.53
│       └── jdtls/             # Java 语言服务器
└── ...
```

### 1.3 启动

**桌面版**: 双击 `Kairo.exe` → 打开独立 IDE 窗口

**浏览器版**: 双击 `Kairo-Server.exe`（或 `start-browser-mode.cmd`）→ 后台启动，浏览器打开 `http://127.0.0.1:<端口号>`

---

## 2. 两种启动模式

### 2.1 桌面版 — 双击 Kairo.exe

**适用场景:**
- 个人日常开发使用
- 需要完整的 IDE 桌面体验

**特点:**
- 打开独立窗口，类似 VS Code / IDEA
- 自带菜单栏、快捷键
- 同时启动后台 HTTP 服务，**浏览器也可访问**

**操作:**
```
双击 Kairo.exe
→ IDE 窗口自动打开
→ 首次使用需导入项目
```

> 桌面版启动后，后台会运行 HTTP 服务。同一台机器上的其他用户可以通过浏览器访问 `http://127.0.0.1:<端口号>` 使用 IDE。

### 2.2 浏览器版 — 双击 Kairo-Server.exe

**适用场景:**
- 不需要桌面窗口，仅通过浏览器使用
- 同一台机器多人共享使用
- 低资源消耗（比桌面版少 ~200MB 内存）
- CI/CD 或自动化环境

**原理:**
`Kairo-Server.exe` 是一个微型 Go 包装器（约 2MB），启动时自动找到同目录下的 `Kairo.exe` 并以 `--headless` 参数启动它。程序自动进入 headless 模式 — 启动代理和后端，但不打开桌面窗口。

**特点:**
- 不打开桌面窗口，仅启动后端服务
- 在浏览器中打开 `http://127.0.0.1:<端口号>` 使用
- 可以同时运行多个实例（不同端口）
- 与桌面版共享同一个代理，可同时运行

**操作:**

| 方式 | 操作 |
|------|------|
| 双击启动 | 双击 `Kairo-Server.exe` |
| 脚本启动 | 双击 `start-browser-mode.cmd` |
| 命令行 | `Kairo.exe --headless` |

**启动后:**
```
╔══════════════════════════════════════════════════════════╗
║   Kairo IDE — Headless (Browser) Mode                   ║
║   Theia:    http://127.0.0.1:3000                       ║
║   Open the Theia URL in any browser to use the IDE.      ║
╚══════════════════════════════════════════════════════════╝
```

### 2.3 两种模式对比

| 特性 | 桌面版 | 浏览器版 |
|------|--------|----------|
| 启动方式 | 双击 Kairo.exe | 双击 Kairo-Server.exe |
| 桌面窗口 | 有 | 无 |
| 浏览器访问 | 支持 | 支持 |
| 内存占用 | ~1.2 GB | ~1.0 GB |
| 关闭方式 | 关闭窗口 | 关闭控制台窗口 |

---

## 3. 环境要求

### 3.1 必需

| 依赖 | 版本 | 说明 |
|------|------|------|
| Windows | Windows 10+ | 64 位 |
| Java (JDK) | 17+ | 用于 Java 智能提示和 Tomcat 运行 |

**安装 JDK 17+:**

推荐 [Adoptium Temurin 17](https://adoptium.net/download/) 或任何 JDK 17+。

安装后设置环境变量:
```powershell
# 系统环境变量
JAVA_HOME = C:\Program Files\Java\jdk-17.0.9
```

### 3.2 可选

| 依赖 | 说明 |
|------|------|
| JDK 6 | 编译 Java 6 遗留项目时需要 |
| WebView2 | 桌面版需要（Windows 10 需手动安装） |
| Git | 版本控制功能 |

### 3.3 端口

Kairo 使用以下端口（均在 `127.0.0.1` 回环地址，不对外暴露）:

| 端口 | 用途 | 说明 |
|------|------|------|
| 18080 | Agent 端口 | 后台服务 |
| 3000 | 浏览器端口 | 默认，可通过 `--port` 修改 |
| 8080 | Tomcat 端口 | 运行配置中指定 |

---

## 4. 内网离线部署

### 4.1 准备工作

**在构建机器上（有网络）:**

```powershell
# 设置环境变量
$env:KAIRO_TOMCAT6_HOME = "E:\Apps\Tomcat6\apache-tomcat-6.0.53"
$env:KAIRO_JDTLS_HOME   = "E:\Apps\eclipse-jdt-ls"

# 一键构建 + 分卷打包
.\scripts\build-and-package.ps1
```

产物在 `apps/desktop/dist/`:
- `Kairo-0.1.0-win.zip` — 完整安装包
- `KairoIDE-v0.1.0-win-x64.7z.001` ~ `.004` — 分卷压缩包

### 4.2 部署到目标机器

1. 将全部 `.7z.00*` 文件复制到目标机器
2. 用 7-Zip 解压 → 得到 `Kairo-0.1.0-win.zip`
3. 解压 `Kairo-0.1.0-win.zip` 到目标目录（如 `D:\Kairo\`）
4. 确保目标机器已安装 JDK 17+
5. 双击 `Kairo.exe` 或 `scripts\start-browser-mode.cmd` 启动

### 4.3 完全离线验证

Kairo IDE 已预打包所有依赖，无需外网:

| 组件 | 状态 | 说明 |
|------|------|------|
| Electron 外壳 | 已打包 | 自带 Chromium 内核 |
| Theia 前端/后端 | 已打包 | 所有 JS/CSS 已编译 |
| Go Runtime Agent | 已打包 | kairo-runtime.exe |
| Tomcat 6.0.53 | 已打包 | 完整嵌入 |
| JDT LS 1.55.0 | 已打包 | Java 智能提示 |
| JDK 17+ | 需安装 | 目标机器自行安装 |

> 如果 JDT LS 未打包（因构建时下载失败），Java 文件将退化为纯文本编辑模式。可通过 `KAIRO_JDTLS_HOME` 环境变量指定 JDT LS 路径。

---

## 5. 一键打包（管理员用）

### 5.1 命令

```powershell
# 完整构建 + 打包 + 分卷压缩（每卷 70MB）
.\scripts\build-and-package.ps1

# 自定义分卷大小
.\scripts\build-and-package.ps1 -VolumeSize 50

# 跳过构建（仅重新打包）
.\scripts\build-and-package.ps1 -SkipBuild

# 跳过分卷压缩
.\scripts\build-and-package.ps1 -SkipSplit
```

### 5.2 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `KAIRO_TOMCAT6_HOME` | 本地 Tomcat 6 安装目录 | `E:\Apps\Tomcat6\apache-tomcat-6.0.53` |
| `KAIRO_JDTLS_HOME` | 已解压的 JDT LS 目录 | `E:\Apps\eclipse-jdt-ls` |
| `KAIRO_JDTLS_ARCHIVE` | JDT LS tar.gz 归档文件 | `D:\jdtls-1.55.0.tar.gz` |

### 5.3 构建流程

```
build-and-package.ps1
├── 阶段 1: pnpm --filter @kairo/browser build    (浏览器前端)
├── 阶段 2: node scripts/build-agent.js            (Go Agent)
├── 阶段 3: 准备 bundled/tomcat6 + bundled/jdtls
├── 阶段 4: copy-browser-artifacts + tsc           (组装)
├── 阶段 5: electron-builder --win                 (打包)
└── 阶段 6: 7z 分卷压缩                            (分卷)
```

### 5.4 其他可用脚本

| 脚本 | 用途 |
|------|------|
| `scripts/build-and-package.ps1` | 一键构建 + 打包 + 分卷 |
| `scripts/package-zip-green.ps1` | 绿色版 zip 打包（已有脚本） |
| `scripts/start-browser-mode.cmd` | 浏览器模式启动（双击） |
| `scripts/start-browser-mode.ps1` | 浏览器模式启动（PowerShell） |
| `scripts/start-agent.ps1` | 独立启动代理 |
| `scripts/start-browser.ps1` | 开发环境浏览器启动 |

---

## 6. 常见问题

### Q: 桌面版和浏览器版有什么区别？

A: 桌面版 = 浏览器版 + 桌面窗口。桌面版启动后同时运行后台 HTTP 服务，浏览器也能访问。浏览器版不打开桌面窗口，更省资源。

### Q: 可以同时运行桌面版和浏览器版吗？

A: 可以。它们共享同一个 Go Runtime Agent。先启动桌面版，再启动浏览器版时，浏览器版会自动复用已有的代理。

### Q: 需要联网吗？

A: 不需要。所有依赖已预打包。首次使用也不需要下载任何东西。

### Q: 启动报错 "未找到 JDK 17+"？

A: 安装 JDK 17+ 并设置 `JAVA_HOME` 环境变量。没有 JDK 17+ 也能启动，但 Java 智能提示和 Tomcat 运行功能不可用。

### Q: 如何修改端口？

A: 桌面版端口自动分配。浏览器版可通过 `--port` 参数指定:
```powershell
.\Kairo.exe --headless --port=8080
```

### Q: 如何给同事使用？

A: 将分卷压缩包发给同事，他们解压后即可使用。所有依赖已预打包，无需额外安装。

### Q: 启动后浏览器显示空白？

A: 确保端口号正确。检查控制台输出的 `Theia: http://127.0.0.1:XXXX` 地址。

### Q: 如何彻底关闭？

A: 桌面版: 关闭窗口。浏览器版: 在控制台按 `Ctrl+C`。

### Q: 杀毒软件报毒？

A: 将 Kairo 安装目录添加到杀毒软件白名单:
```powershell
Add-MpPreference -ExclusionPath "D:\Kairo"
```