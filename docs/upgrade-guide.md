# Kairo IDE — 升级与回滚说明

> 适用版本：Kairo IDE v0.1.0+
> 最后更新：2026-07-23
> 目标读者：企业 IT 管理员、最终用户

本文档详细说明 Kairo IDE 的升级、回滚和配置迁移流程。Kairo IDE v1 支持离线升级包——不自动更新，不静默下载。

---

## 目录

1. [升级前检查](#1-升级前检查)
2. [升级步骤](#2-升级步骤)
3. [升级后验证](#3-升级后验证)
4. [回滚步骤](#4-回滚步骤)
5. [配置迁移](#5-配置迁移)
6. [已知版本兼容性问题](#6-已知版本兼容性问题)

---

## 1. 升级前检查

### 1.1 备份当前安装目录

升级前必须备份完整的安装目录，以便回滚。

**Windows**：

```powershell
# 备份安装目录
xcopy /E /I %LOCALAPPDATA%\Kairo %LOCALAPPDATA%\Kairo.backup.%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%\

# 备份用户数据目录
xcopy /E /I %APPDATA%\Kairo %APPDATA%\Kairo.backup.%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%\
```

**macOS**：

```bash
# 备份安装目录
cp -r /Applications/Kairo.app /Applications/Kairo.app.backup.$(date +%Y%m%d)

# 备份用户数据目录
cp -r ~/Library/Application\ Support/Kairo \
      ~/Library/Application\ Support/Kairo.backup.$(date +%Y%m%d)
```

**Linux**：

```bash
# 备份安装目录
cp -r /opt/kairo /opt/kairo.backup.$(date +%Y%m%d)

# 备份用户数据目录
cp -r ~/.config/kairo ~/.config/kairo.backup.$(date +%Y%m%d)
```

### 1.2 备份工作区配置

工作区配置位于项目根目录的 `.kairo/` 目录中：

```bash
# 确认 .kairo/ 目录存在并已被版本控制
ls -la .kairo/project.json
ls -la .kairo/run-configurations/
```

建议将 `.kairo/` 目录纳入 Git 版本控制，以便追踪配置变更。

### 1.3 备份用户设置

用户设置文件位置：

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\Kairo\settings.json` |
| macOS | `~/Library/Application Support/Kairo/settings.json` |
| Linux | `~/.config/kairo/settings.json` |

备份用户设置：

```bash
# macOS / Linux
cp ~/Library/Application\ Support/Kairo/settings.json \
   ~/Library/Application\ Support/Kairo/settings.json.backup

# Windows
copy %APPDATA%\Kairo\settings.json %APPDATA%\Kairo\settings.json.backup
```

### 1.4 检查磁盘空间

确保有足够的磁盘空间用于升级：

```bash
# macOS / Linux
df -h /Applications
df -h ~/Library/Application\ Support

# Windows
# 检查 %LOCALAPPDATA% 和 %APPDATA% 所在驱动器的可用空间
wmic logicaldisk get size,freespace,caption
```

**空间要求**：

| 项目 | 所需空间 |
|------|----------|
| 新版本安装 | ~2 GB |
| 备份（旧版本） | ~2 GB |
| 用户数据 | ~500 MB |
| **总计建议** | **≥ 5 GB** |

### 1.5 记录当前版本和配置

升级前记录以下信息，便于回滚和问题排查：

```bash
# 记录当前版本号
kairo-runtime --version

# 记录当前配置
cat ~/Library/Application\ Support/Kairo/config.json  # macOS
type %APPDATA%\Kairo\config.json                       # Windows

# 记录已安装的插件
ls ~/Library/Application\ Support/Kairo/plugins/       # macOS
dir %APPDATA%\Kairo\plugins\                            # Windows
```

---

## 2. 升级步骤

### 2.1 下载新版本安装包

从官方渠道获取新版本安装包：

| 平台 | 安装包格式 |
|------|-----------|
| Windows | `Kairo-IDE-Setup-x.y.z.exe` 或 `Kairo-IDE-x.y.z-win-x64.zip` |
| macOS (Apple Silicon) | `Kairo-IDE-x.y.z-darwin-arm64.dmg` |
| macOS (Intel) | `Kairo-IDE-x.y.z-darwin-x64.dmg` |
| Linux | `Kairo-IDE-x.y.z-linux-x64.tar.gz` |

### 2.2 验证 SHA-256 校验和

**重要**：安装前必须验证校验和，确保安装包未被篡改。

```bash
# macOS / Linux
shasum -a 256 Kairo-IDE-x.y.z-darwin-arm64.dmg
# 对比 dist/checksums.txt 中的值

# Windows PowerShell
Get-FileHash Kairo-IDE-x.y.z-win-x64.zip -Algorithm SHA256
# 对比 dist/checksums.txt 中的值
```

如果校验和不匹配，**不要安装**，立即联系管理员。

**checksums.txt 格式**：

```
SHA256 (Kairo-IDE-0.1.0-darwin-arm64.dmg) = a1b2c3d4e5f6...
SHA256 (Kairo-IDE-0.1.0-win-x64.zip) = f6e5d4c3b2a1...
SHA256 (Kairo-IDE-0.1.0-linux-x64.tar.gz) = 1a2b3c4d5e6f...
```

### 2.3 关闭当前运行的 IDE

升级前必须完全关闭所有 Kairo IDE 实例：

**Windows**：

```powershell
# 关闭所有 IDE 窗口
# 终止所有 Agent 进程
taskkill /F /IM kairo-runtime.exe
taskkill /F /IM Kairo.exe

# 确认无残留进程
tasklist | findstr /I kairo
```

**macOS**：

```bash
# 关闭所有 IDE 窗口 (Cmd+Q)
# 终止所有 Agent 进程
pkill -f kairo-runtime
pkill -f Kairo

# 确认无残留进程
ps aux | grep -i kairo
```

**Linux**：

```bash
pkill -f kairo-runtime
pkill -f kairo-server

ps aux | grep -i kairo
```

**确认 Tomcat 已停止**：

```bash
# 检查 Tomcat 是否还在运行
ps aux | grep tomcat      # macOS / Linux
tasklist | findstr java   # Windows
```

### 2.4 安装新版本

#### Windows Desktop 安装

**方式一：安装包**

1. 双击 `Kairo-IDE-Setup-x.y.z.exe`
2. 选择 `per-user` 安装（不需要管理员权限）
3. 选择安装目录（建议覆盖旧版本目录）
4. 完成安装

**方式二：便携包**

1. 解压 `Kairo-IDE-x.y.z-win-x64.zip`
2. 覆盖旧版本安装目录：
   ```powershell
   # 先删除旧版本（保留 bundled/ 目录中的用户数据）
   rmdir /s /q %LOCALAPPDATA%\Kairo\bin
   rmdir /s /q %LOCALAPPDATA%\Kairo\lib
   rmdir /s /q %LOCALAPPDATA%\Kairo\docs

   # 解压新版本
   Expand-Archive Kairo-IDE-x.y.z-win-x64.zip -DestinationPath %LOCALAPPDATA%\Kairo
   ```

#### macOS Desktop 安装

1. 双击 `.dmg` 文件
2. 将 `Kairo.app` 拖到 `Applications` 文件夹，覆盖旧版本
3. 如果提示"无法验证开发者"，执行：
   ```bash
   xattr -cr /Applications/Kairo.app
   ```

#### Linux 安装

```bash
# 解压新版本
tar -xzf Kairo-IDE-x.y.z-linux-x64.tar.gz -C /opt/

# 替换旧版本
rm -rf /opt/kairo/bin /opt/kairo/lib /opt/kairo/docs
cp -r kairo-ide-x.y.z/* /opt/kairo/
```

### 2.5 启动并验证

1. **启动 IDE**

   双击应用图标或从命令行启动：
   ```bash
   # macOS
   open /Applications/Kairo.app

   # Windows
   %LOCALAPPDATA%\Kairo\Kairo.exe

   # Linux
   /opt/kairo/bin/kairo-server --bind 127.0.0.1 --port 3000
   ```

2. **验证版本号**

   在 IDE 中 **Help → About**，确认版本号正确。

3. **如果升级失败**

   如果 IDE 无法启动，参照 §4 回滚步骤恢复到旧版本。

---

## 3. 升级后验证

### 3.1 检查版本号

1. 打开 IDE
2. 菜单栏 **Help → About**
3. 确认版本号与新版本一致

或通过命令行：
```bash
kairo-runtime --version
```

### 3.2 验证最近项目列表

1. 菜单栏 **File → Open Recent**
2. 确认之前的项目出现在列表中
3. 点击项目，确认可以正常打开

### 3.3 验证运行配置

1. 查看顶部工具栏中的运行配置下拉菜单
2. 确认之前的运行配置仍然存在
3. 选择一个配置，点击 **Run** 确认可以正常启动

### 3.4 验证键盘快捷键

测试常用快捷键是否正常工作：

| 操作 | 快捷键 (Windows) | 快捷键 (macOS) |
|------|-----------------|----------------|
| 命令面板 | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| 快速打开文件 | `Ctrl+P` | `Cmd+P` |
| 搜索文件 | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| 切换断点 | `F9` | `F9` |

### 3.5 验证编码设置

1. 打开一个包含中文内容的文件
2. 确认编码指示器显示正确的编码（如 GBK、UTF-8）
3. 确认中文内容显示正常，无乱码

### 3.6 运行冒烟测试

执行以下冒烟测试，确保核心功能正常：

| 编号 | 测试项 | 操作 | 预期结果 |
|------|--------|------|----------|
| 1 | 打开项目 | 打开最近项目 | 项目正常加载，文件树正常 |
| 2 | 搜索文本 | `Ctrl+Shift+F` 搜索关键字 | 搜索结果显示正确 |
| 3 | 构建项目 | 点击 Build 按钮 | 构建成功，输出正常 |
| 4 | 启动 Tomcat | 选择运行配置，点击 Run | Tomcat 启动成功，状态为 Running |
| 5 | 访问应用 | 点击 Open Browser | 浏览器打开应用，页面正常 |
| 6 | 停止 Tomcat | 点击 Stop | Tomcat 停止，状态为 Stopped |
| 7 | 设置断点 | 在 Java 代码中设置断点，Debug 启动 | 断点命中，变量显示正确 |
| 8 | 关闭重开 | 关闭 IDE，重新打开 | 最近项目列表恢复，配置保留 |

### 3.7 检查日志

查看升级后的日志，确认无异常：

```bash
# macOS / Linux
tail -50 ~/Library/Application\ Support/Kairo/logs/kairo.log

# Windows
# 查看 %APPDATA%\Kairo\logs\kairo.log
```

日志中不应出现：
- `version mismatch`
- `corrupted state`
- `compatibility error`
- `Unknown configuration key`

---

## 4. 回滚步骤

### 4.1 关闭 IDE

确保所有 Kairo IDE 实例已完全关闭：

```bash
# macOS / Linux
pkill -f kairo-runtime
pkill -f Kairo

# Windows
taskkill /F /IM kairo-runtime.exe
taskkill /F /IM Kairo.exe
```

### 4.2 恢复备份的安装目录

**Windows**：

```powershell
# 删除当前安装
rmdir /s /q %LOCALAPPDATA%\Kairo

# 恢复备份
xcopy /E /I %LOCALAPPDATA%\Kairo.backup.YYYYMMDD %LOCALAPPDATA%\Kairo
```

**macOS**：

```bash
# 删除当前安装
rm -rf /Applications/Kairo.app

# 恢复备份
cp -r /Applications/Kairo.app.backup.YYYYMMDD /Applications/Kairo.app
```

**Linux**：

```bash
rm -rf /opt/kairo
cp -r /opt/kairo.backup.YYYYMMDD /opt/kairo
```

### 4.3 恢复工作区配置

如果升级后工作区配置出现问题，恢复备份：

```bash
# macOS / Linux
rm -rf ~/Library/Application\ Support/Kairo
cp -r ~/Library/Application\ Support/Kairo.backup.YYYYMMDD \
      ~/Library/Application\ Support/Kairo

# Windows
rmdir /s /q %APPDATA%\Kairo
xcopy /E /I %APPDATA%\Kairo.backup.YYYYMMDD %APPDATA%\Kairo
```

**注意**：恢复用户数据会丢失升级后所做的任何配置更改。

### 4.4 启动旧版本

```bash
# macOS
open /Applications/Kairo.app

# Windows
%LOCALAPPDATA%\Kairo\Kairo.exe

# Linux
/opt/kairo/bin/kairo-server --bind 127.0.0.1 --port 3000
```

### 4.5 验证功能正常

启动后，执行 §3 的升级后验证步骤，确认所有功能正常。

### 4.6 回滚检查清单

| 序号 | 检查项 | 状态 |
|------|--------|------|
| 1 | IDE 可以正常启动 | ☐ |
| 2 | 版本号已恢复为旧版本 | ☐ |
| 3 | 最近项目列表正常 | ☐ |
| 4 | 运行配置可用 | ☐ |
| 5 | 编码设置正确 | ☐ |
| 6 | 搜索功能正常 | ☐ |
| 7 | 构建功能正常 | ☐ |
| 8 | Tomcat 启动正常 | ☐ |
| 9 | 调试功能正常 | ☐ |
| 10 | 日志无异常错误 | ☐ |

---

## 5. 配置迁移

### 5.1 用户设置迁移

升级通常会自动保留用户设置。如果手动迁移：

**用户设置文件**：`settings.json`

```bash
# macOS / Linux
cp ~/Library/Application\ Support/Kairo.backup/settings.json \
   ~/Library/Application\ Support/Kairo/settings.json

# Windows
copy %APPDATA%\Kairo.backup\settings.json %APPDATA%\Kairo\settings.json
```

**可迁移的设置项**：

| 设置项 | 键名 | 说明 |
|--------|------|------|
| 主题 | `workbench.colorTheme` | 深色/浅色主题 |
| 字体大小 | `editor.fontSize` | 编辑器字体大小 |
| 编码 | `files.encoding` | 默认文件编码 |
| 自动保存 | `files.autoSave` | 自动保存策略 |
| 制表符大小 | `editor.tabSize` | 缩进宽度 |
| 行号 | `editor.lineNumbers` | 行号显示方式 |
| 大文件阈值 | `kairo.largeFiles.*` | 大文件降级模式阈值 |

### 5.2 键盘快捷键迁移

**快捷键文件**：`keybindings.json`

```bash
# macOS / Linux
cp ~/Library/Application\ Support/Kairo.backup/keybindings.json \
   ~/Library/Application\ Support/Kairo/keybindings.json

# Windows
copy %APPDATA%\Kairo.backup\keybindings.json %APPDATA%\Kairo\keybindings.json
```

### 5.3 连接配置迁移

运行配置位于项目根目录的 `.kairo/run-configurations/` 目录中，随项目自动迁移。

**运行配置文件示例**（`.kairo/run-configurations/tomcat6-debug.json`）：

```json
{
  "version": 1,
  "name": "Tomcat 6: Debug",
  "type": "tomcat6",
  "projectId": "legacy-sample",
  "mode": "debug",
  "jdkRef": "jdk6-local",
  "build": {
    "type": "ant",
    "target": "war"
  },
  "server": {
    "httpPort": 18080,
    "debugPort": 8000,
    "contextPath": "/legacy"
  },
  "deploy": {
    "mode": "exploded",
    "artifact": "dist/legacy"
  },
  "env": {}
}
```

### 5.4 项目配置迁移

项目配置文件（`.kairo/project.json`）位于项目根目录，随项目迁移。

**项目配置示例**：

```json
{
  "version": 1,
  "name": "legacy-sample",
  "sourceDirs": ["src/"],
  "webRoot": "WebRoot",
  "encoding": {
    "default": "GBK",
    "overrides": {
      "webapp/": "UTF-8"
    }
  },
  "exclude": [
    "node_modules/",
    ".git/",
    "target/",
    "build/",
    "dist/"
  ],
  "compiler": {
    "compatibility": "emulated-v6",
    "sourceLevel": "1.6",
    "targetLevel": "1.6"
  }
}
```

### 5.5 插件迁移

用户安装的插件位于用户数据目录的 `plugins/` 中：

```bash
# macOS / Linux
cp -r ~/Library/Application\ Support/Kairo.backup/plugins/ \
      ~/Library/Application\ Support/Kairo/plugins/

# Windows
xcopy /E /I %APPDATA%\Kairo.backup\plugins %APPDATA%\Kairo\plugins
```

---

## 6. 已知版本兼容性问题

### 6.1 配置格式变更

如果新版本修改了配置文件的格式，旧版本的配置文件可能无法被新版本正确读取。

**处理方式**：

1. 升级前备份配置文件
2. 升级后如果 IDE 提示配置格式错误，删除配置文件让 IDE 重新生成
3. 手动将旧配置迁移到新格式

**常见配置格式变更**：

| 版本 | 变更 | 迁移方式 |
|------|------|----------|
| 0.1.x → 0.2.x | 如果配置键名变更 | 参考发版说明中的映射表 |

### 6.2 协议版本变更

Kairo IDE 前端与 Runtime Agent 之间使用版本化协议。如果协议版本不兼容：

- **现象**：Agent 连接失败，显示 "协议版本不匹配"
- **原因**：前端和 Agent 版本不一致
- **解决**：确保前端和 Agent 同时升级到同一版本

**验证协议版本**：

```bash
# 检查 Agent 协议版本
curl http://127.0.0.1:18080/api/v1/health
# 响应中应包含 "protocolVersion" 字段
```

### 6.3 API 废弃

**检查 API 废弃警告**：

升级后，查看日志中是否有 `[DEPRECATED]` 警告：

```bash
grep -i deprecated ~/Library/Application\ Support/Kairo/logs/kairo.log
```

如果发现废弃警告，参考发版说明中的替代方案。

### 6.4 依赖版本变更

| 依赖 | 版本锁定 | 说明 |
|------|----------|------|
| JDT LS | 1.55.0 | 在 `supply-chain-lock.json` 中锁定 |
| Tomcat 6 | 6.0.53 | 通过 SHA-256 校验 |
| Node.js | 20.10+ | 最低要求 |
| Go Agent | 1.22+ | 编译时锁定 |

**验证依赖版本**：

```bash
node scripts/verify-bundled-dependencies.cjs
node scripts/supply-chain.test.cjs
```

### 6.5 兼容性矩阵

Kairo IDE 遵循语义化版本。版本号格式：`MAJOR.MINOR.PATCH`

| 版本变更 | 兼容性 | 说明 |
|----------|--------|------|
| PATCH 升级（0.1.0 → 0.1.1） | 完全兼容 | 仅修复 bug，无配置变更 |
| MINOR 升级（0.1.0 → 0.2.0） | 向前兼容 | 新增功能，旧配置可用 |
| MAJOR 升级（0.x → 1.0） | 可能不兼容 | 重大变更，需参考发版说明 |

---

## 附录 A：升级检查清单

**升级前**：

- [ ] 已备份安装目录
- [ ] 已备份用户数据目录
- [ ] 已记录当前版本号
- [ ] 已下载新版本安装包
- [ ] 已验证 SHA-256 校验和
- [ ] 已关闭所有 IDE 实例
- [ ] 已检查磁盘空间

**升级中**：

- [ ] 已安装新版本
- [ ] 安装过程无错误

**升级后**：

- [ ] IDE 可以正常启动
- [ ] 版本号正确
- [ ] 最近项目列表正常
- [ ] 运行配置可用
- [ ] 编码设置正确
- [ ] 键盘快捷键正常
- [ ] 搜索功能正常
- [ ] 构建功能正常
- [ ] Tomcat 启动正常
- [ ] 调试功能正常
- [ ] 日志无异常错误

## 附录 B：回滚检查清单

- [ ] 已关闭 IDE
- [ ] 已恢复备份的安装目录
- [ ] 已恢复工作区配置（如需要）
- [ ] 已启动旧版本
- [ ] 版本号已恢复为旧版本
- [ ] 最近项目列表正常
- [ ] 运行配置可用
- [ ] 编码设置正确
- [ ] 搜索功能正常
- [ ] 构建功能正常
- [ ] Tomcat 启动正常
- [ ] 调试功能正常

## 附录 C：常见升级问题

### Q1: 升级后 IDE 无法启动

**排查步骤**：

1. 检查日志文件中的错误信息
2. 尝试清除缓存目录
3. 如果仍然无法解决，回滚到旧版本

### Q2: 升级后项目打不开

**排查步骤**：

1. 检查 `.kairo/project.json` 文件格式是否正确
2. 尝试删除 `.kairo/` 目录，重新导入项目
3. 如果仍然无法解决，回滚到旧版本

### Q3: 升级后编码设置丢失

**排查步骤**：

1. 检查 `settings.json` 中的 `files.encoding` 设置
2. 手动设置正确的编码
3. 如果混合编码项目，重新配置 `.kairo/project.json` 中的编码覆盖

### Q4: 升级后运行配置丢失

**排查步骤**：

1. 检查 `.kairo/run-configurations/` 目录是否存在
2. 如果目录存在但配置未加载，检查文件格式是否正确
3. 重新创建运行配置

### Q5: 如何检查是否有新版本可用

Kairo IDE v1 不自动检查更新。获取新版本信息的方式：

- 查看企业内部发布通知
- 访问官方下载页面
- 联系 IT 管理员