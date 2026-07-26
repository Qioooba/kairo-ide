# Kairo IDE 全面 E2E 测试计划

> **文档版本**: v1.0  
> **创建日期**: 2026-07-25  
> **测试范围**: 整个 Kairo IDE 的所有 UI 交互元素、控制台错误、UI 设计合理性  
> **测试策略**: 多 Agent 并行 + 真实项目模拟 + 循环修复直至全部通过

---

## 目录

1. [测试目标与范围](#1-测试目标与范围)
2. [测试基础设施](#2-测试基础设施)
3. [UI 交互元素全景分析](#3-ui-交互元素全景分析)
4. [测试分片设计 (16 个并行 Shard)](#4-测试分片设计)
5. [多 Agent 并行测试架构](#5-多-agent-并行测试架构)
6. [控制台与网络监控策略](#6-控制台与网络监控策略)
7. [UI 设计评审标准](#7-ui-设计评审标准)
8. [真实项目模拟测试](#8-真实项目模拟测试)
9. [循环测试与修复流程](#9-循环测试与修复流程)
10. [测试执行命令](#10-测试执行命令)

---

## 1. 测试目标与范围

### 1.1 核心目标

| 目标 | 描述 | 验证方式 |
|------|------|----------|
| **零控制台错误** | 所有页面操作不产生 console.error | 每步操作后检查 `pageerror` 事件 |
| **零网络请求失败** | 所有 API 请求返回 2xx | 监控 `requestfailed` 事件 |
| **UI 设计合理性** | 颜色对比度、布局一致性、响应式 | 视觉回归截图 + 人工审查 |
| **全功能覆盖** | 每个按钮、菜单、输入框都经过测试 | 自动化点击 + 截图 |
| **真实项目验证** | 使用 legacy-sample 真实项目数据 | 导入真实项目后执行所有操作 |

### 1.2 测试范围矩阵

| 层级 | 覆盖范围 |
|------|----------|
| **Shell 层** | 菜单栏、状态栏、活动栏、侧边栏、底部面板、编辑器区域 |
| **命令面板** | 所有 Kairo: 命令、所有 Theia 标准命令 |
| **视图面板** | Servers, Builds, Deployments, Logs, Maven, TODO, Tests, SQL Console, Remote, Perf, Problems, Output, Terminal, Debug Console, Search, Git, Explorer |
| **编辑器** | Java, JSP, XML, Properties, SQL, JSON, HTML, CSS, Markdown |
| **对话框** | 信任对话框、保存工作区对话框、导入向导、项目选择器、设置 |
| **右键菜单** | 文件资源管理器右键、编辑器右键、终端右键 |
| **键盘快捷键** | 所有注册的快捷键 (F1-F12, Ctrl+组合, Alt+组合) |

---

## 2. 测试基础设施

### 2.1 技术栈

```
Playwright (Chromium headless) + 自定义 Fixtures
├── fixtures.ts          — 核心测试工具函数
├── regression-fixtures.ts — 回归测试专用 fixtures
├── playwright.config.ts  — 标准 E2E 配置
├── regression-k4-playwright.config.ts — K4 回归配置
└── full-regression.config.ts — 全量回归配置
```

### 2.2 关键依赖

```
- Runtime Agent: 端口 18182 (k4) / 18300 (默认)
- Theia Browser: 端口 18301 / 3050 (回归)
- 测试项目: legacy-sample (真实 Tomcat 6 + JDK 6 Web 项目)
- JDT LS: 内嵌 Java 语言服务器
- Tomcat 6: 内嵌 Servlet 容器
```

### 2.3 现有测试文件

```
tests/e2e/
├── fixtures.ts                       # 核心工具函数
├── regression-fixtures.ts            # 回归专用 fixtures
├── playwright.config.ts              # 标准配置
├── regression-k4-playwright.config.ts # K4 回归配置
├── full-regression.config.ts          # 全量回归配置
├── regression/
│   ├── shard-01-shell.spec.ts        # 8 tests: Shell + 状态栏 + 命令面板
│   ├── shard-02-project.spec.ts      # 8 tests: 项目导入 + 文件管理
│   ├── shard-03-java.spec.ts         # 13 tests: Java 语言服务
│   ├── shard-04-multilang.spec.ts    # 9 tests: JSP/XML/Properties
│   ├── shard-05-build.spec.ts        # 11 tests: 构建 + 部署 + Tomcat
│   ├── shard-06-debug.spec.ts        # 13 tests: 调试功能
│   ├── shard-07-search.spec.ts       # 12 tests: 搜索 + Git + 编码
│   ├── shard-08-ui.spec.ts           # 15 tests: UI主题/无障碍/视觉
│   └── shard-99-probe-*.spec.ts      # 探测性测试
├── core-e2e.spec.ts                  # 核心 E2E
├── frontend-e2e.spec.ts              # 前端 E2E
├── desktop-e2e.spec.ts               # 桌面 E2E
├── boundary-e2e.spec.ts              # 边界测试
├── diagnose.spec.ts                  # 诊断测试
└── standalone-smoke.spec.ts          # 独立冒烟测试
```

---

## 3. UI 交互元素全景分析

### 3.1 菜单栏 (Menu Bar)

基于 `/packages/theia-product/src/main/browser/kairo-views-contribution.ts` 分析：

| 菜单 | 子菜单 | 菜单项 | 命令 ID |
|------|--------|--------|----------|
| **File** | | Import Kairo Project... | `kairo.project.import` |
| | | Select Kairo Project... | `kairo.project.select` |
| | | Run Configurations... | `kairo.runConfigurations.manage` |
| **Edit** | | (标准编辑操作) | Theia 内置 |
| **View** | | (标准视图操作) | Theia 内置 |
| **Kairo** | | Import Kairo Project... | `kairo.project.import` |
| | | Select Kairo Project... | `kairo.project.select` |
| | | Scan Workspace | `kairo.project.scan` |
| | | Run Configurations... | `kairo.runConfigurations.manage` |
| | **Build & Run** | Build | `kairo.build` |
| | | Clean Build | `kairo.cleanBuild` |
| | | Build & Deploy | `kairo.buildAndDeploy` |
| | | Start Server | `kairo.server.start` |
| | | Start Server (Debug) | `kairo.server.debug` |
| | | Stop Server | `kairo.server.stop` |
| | | Restart Server | `kairo.server.restart` |
| | | Open Application | `kairo.app.open` |
| | | Check Java Debug Adapter | `kairo.debug.checkAdapter` |
| | **View** | Servers | `kairo.view.servers` |
| | | Builds | `kairo.view.builds` |
| | | Deployments | `kairo.view.deployments` |
| | | Tomcat Logs | `kairo.view.logs` |
| | | Maven | `kairo.view.maven` |
| | | TODO / FIXME | `kairo.view.todo` |
| | | Test Results | `kairo.view.tests` |
| | | SQL Console | `kairo.view.sqlConsole` |
| | | Remote Development | `kairo.view.remote` |
| | | Performance Dashboard | `kairo.view.perf` |
| | **Debug** | Open Debug View | `kairo.debug.openView` |
| | | Open Debug Console | `kairo.debug.openConsole` |
| | | Variables | `kairo.debug.view.variables` |
| | | Call Stack | `kairo.debug.view.callstack` |
| | | Breakpoints | `kairo.debug.view.breakpoints` |
| | | Watch | `kairo.debug.view.watch` |
| | | Debug Toolbar | `kairo.debug.view.toolbar` |
| | | Debug Diagnostics | `kairo:open-debug-diagnostics` |
| | **Window** | Toggle Terminal | `kairo.terminal.toggle` |
| | | Keyboard Shortcuts | `kairo.keymap.open` |
| | | Switch JDK | `kairo.jdk.switch` |
| | | Reconnect Runtime Agent | `kairo.agent.reconnect` |
| **Help** | | Debug Diagnostics | `kairo:open-debug-diagnostics` |

### 3.2 命令面板 (Command Palette) — 所有 Kairo 命令

| 命令 Label | 命令 ID | 类型 |
|------------|---------|------|
| Kairo: Import Project | `kairo.project.import` | 向导 |
| Kairo: Select Project | `kairo.project.select` | 选择器 |
| Kairo: Scan Project | `kairo.project.scan` | 扫描 |
| Kairo: Build | `kairo.build` | 构建 |
| Kairo: Clean Build | `kairo.cleanBuild` | 构建 |
| Kairo: Build and Deploy | `kairo.buildAndDeploy` | 构建+部署 |
| Kairo: Start Server | `kairo.server.start` | 服务器 |
| Kairo: Start Server (Debug) | `kairo.server.debug` | 调试 |
| Kairo: Check Java Debug Adapter | `kairo.debug.checkAdapter` | 诊断 |
| Kairo: Open Debug View | `kairo.debug.openView` | 视图 |
| Kairo: Open Debug Console | `kairo.debug.openConsole` | 视图 |
| Kairo: Stop Server | `kairo.server.stop` | 服务器 |
| Kairo: Restart Server | `kairo.server.restart` | 服务器 |
| Kairo: Open Application | `kairo.app.open` | 浏览器 |
| Kairo: Show Servers | `kairo.view.servers` | 视图 |
| Kairo: Show Builds | `kairo.view.builds` | 视图 |
| Kairo: Show Deployments | `kairo.view.deployments` | 视图 |
| Kairo: Show Tomcat Logs | `kairo.view.logs` | 视图 |
| Kairo: Show Maven | `kairo.view.maven` | 视图 |
| Kairo: Show TODO/FIXME | `kairo.view.todo` | 视图 |
| Kairo: Show SQL Console | `kairo.view.sqlConsole` | 视图 |
| Kairo: Show Test Results | `kairo.view.tests` | 视图 |
| Kairo: Manage Run Configurations | `kairo.runConfigurations.manage` | 配置 |
| Kairo: Switch JDK | `kairo.jdk.switch` | 配置 |
| Kairo: Reconnect Agent | `kairo.agent.reconnect` | 网络 |
| Kairo: Open Keyboard Shortcuts | `kairo.keymap.open` | 帮助 |
| Kairo: Toggle Terminal | `kairo.terminal.toggle` | 终端 |
| Kairo: Show Remote Development | `kairo.view.remote` | 远程 |
| Kairo: Show Performance | `kairo.view.perf` | 性能 |
| Kairo: Show Debug Variables | `kairo.debug.view.variables` | 调试 |
| Kairo: Show Debug Call Stack | `kairo.debug.view.callstack` | 调试 |
| Kairo: Show Debug Breakpoints | `kairo.debug.view.breakpoints` | 调试 |
| Kairo: Show Debug Toolbar | `kairo.debug.view.toolbar` | 调试 |
| Kairo: Show Debug Console | `kairo.debug.view.console` | 调试 |
| Kairo: Show Debug Watch | `kairo.debug.view.watch` | 调试 |
| Kairo: Open Debug Diagnostics | `kairo:open-debug-diagnostics` | 诊断 |

### 3.3 活动栏 (Activity Bar)

| 图标 | 面板 | 测试检查项 |
|------|------|------------|
| Explorer | 文件资源管理器 | 树展开/折叠、文件图标、右键菜单 |
| Search | 搜索面板 | 搜索框、替换框、结果列表 |
| Git/SCM | 源代码管理 | 变更列表、暂存/取消暂存、提交 |
| Debug | 调试面板 | 变量、调用栈、断点、监视 |
| Extensions | 扩展面板 | (Theia 内置) |

### 3.4 状态栏 (Status Bar)

| 状态项 | 预期内容 | 数据来源 |
|--------|----------|----------|
| Project: | 项目名称或 "(no workspace)" | ActiveProjectService |
| JDT LS: | "ready" / "starting" / "error" | JDT LS 状态 |
| Java: | JDK 版本信息 | Java 状态 |
| Encoding: | 文件编码 (如 GBK, UTF-8) | EncodingRegistry |
| Search: | "indexed" / "indexing" | Search 索引状态 |
| Runtime: | "connected" / "disconnected" | Agent 连接状态 |
| Git: | 分支名称 | Git 状态 |
| Ln/Col: | 行列号 | 编辑器光标位置 |
| Language: | 语言模式 (Java, JSP, etc.) | 编辑器语言 |

### 3.5 视图面板 (Views) 及交互元素

#### 3.5.1 Servers View (`data-testid="kairo-server-view"`)

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 服务器列表 | 列表 | `[data-testid="server-item"]` | 查看 |
| 服务器状态 | 文本 | `[data-testid="server-state"]` | 验证 |
| 服务器 PID | 文本 | `[data-testid="server-pid"]` | 验证 |
| 服务器端口 | 文本 | `[data-testid="server-ports"]` | 验证 |
| 启动按钮 | 按钮 | (在工具栏) | 点击 |
| 停止按钮 | 按钮 | (在工具栏) | 点击 |
| 重启按钮 | 按钮 | (在工具栏) | 点击 |

#### 3.5.2 Build View (`data-testid="kairo-build-view"`)

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 构建列表 | 列表 | `[data-testid="build-item"]` | 查看 |
| 构建状态 | 文本 | `[data-testid="build-state"]` | 验证 |
| 构建摘要 | 文本 | `[data-testid="build-summary"]` | 验证 |
| Build 按钮 | 按钮 | "Build" | 点击 |
| Clean Build 按钮 | 按钮 | "Clean Build" | 点击 |
| Cancel 按钮 | 按钮 | "Cancel" | 点击 |
| 诊断列表 | 列表 | 错误/警告信息 | 查看 |
| 构建历史 | 列表 | 历史记录 | 查看 |

#### 3.5.3 Git Commit Widget

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 提交模板选择 | 下拉框 | `<select>` | 选择 |
| 提交信息输入 | 文本框 | `<textarea>` / `<input>` | 输入文本 |
| 提交按钮 | 按钮 | "Commit" | 点击 |
| 跳过检查提交 | 按钮 | "Skip Checks & Commit" | 点击 |
| 强制提交 | 按钮 | "Force Commit" | 点击 |

#### 3.5.4 Git Stash Widget

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 暂存信息输入 | 文本框 | `<input>` | 输入文本 |
| 保存暂存 | 按钮 | "Save Stash" | 点击 |
| 刷新列表 | 按钮 | "Refresh" | 点击 |
| 清空所有 | 按钮 | "Clear All" | 点击 |
| Pop 按钮 | 按钮 | "Pop" | 点击 |
| Apply 按钮 | 按钮 | "Apply" | 点击 |
| Drop 按钮 | 按钮 | "Drop" | 点击 |

#### 3.5.5 Git Changes Widget

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 刷新按钮 | 按钮 | "Refresh" | 点击 |
| 全部暂存 | 按钮 | "Stage All" | 点击 |
| 全部取消暂存 | 按钮 | "Unstage All" | 点击 |
| 文件复选框 | 复选框 | `<input type="checkbox">` | 勾选/取消 |
| 暂存选中 | 按钮 | "Stage Selected" | 点击 |
| 取消暂存选中 | 按钮 | "Unstage Selected" | 点击 |

#### 3.5.6 Git History Widget

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 搜索框 | 文本框 | `<input type="search">` | 输入搜索 |
| 提交列表 | 列表 | 提交记录 | 查看 |

#### 3.5.7 Import Wizard

| 步骤 | 元素 | 选择器 | 操作 |
|------|------|--------|------|
| Step 1 | 路径输入框 | `[data-testid="path-input"]` | 输入路径 |
| Step 1 | 扫描按钮 | `[data-testid="scan-btn"]` | 点击 |
| Step 2 | 导入按钮 | `[data-testid="import-project-btn"]` | 点击 |
| Step 3 | 打开项目按钮 | `[data-testid="open-project-btn"]` | 点击 |

#### 3.5.8 其他视图

| 视图 | Widget ID | Factory ID |
|------|-----------|------------|
| Deployments | `kairo-deployments` | `KAIRO_DEPLOYMENTS_FACTORY_ID` |
| Logs | `kairo-logs` | `KAIRO_LOGS_FACTORY_ID` |
| Maven | `kairo-maven` | `KAIRO_MAVEN_FACTORY_ID` |
| TODO | `kairo-todo` | `KAIRO_TODO_FACTORY_ID` |
| Test Results | `kairo-tests` | `KAIRO_TESTS_FACTORY_ID` |
| SQL Console | `kairo-sql-console` | `KAIRO_SQL_CONSOLE_FACTORY_ID` |
| Perf Dashboard | `kairo-perf` | `KAIRO_PERF_FACTORY_ID` |
| Remote Dev | `kairo-remote` | `KAIRO_REMOTE_FACTORY_ID` |
| Keymap | `kairo-keymap` | `KAIRO_KEYMAP_FACTORY_ID` |
| Run Configs | `kairo-run-configs` | `KAIRO_RUN_CONFIGURATIONS_FACTORY_ID` |
| Problems | `kairo-problems` | `KAIRO_PROBLEMS_FACTORY_ID` |
| Bookmark | `kairo-bookmarks` | `KAIRO_BOOKMARKS_FACTORY_ID` |
| Notification Center | `kairo-notification-center` | `KAIRO_NOTIFICATION_CENTER_FACTORY_ID` |
| Shortcuts | `kairo-shortcuts` | `KAIRO_SHORTCUTS_FACTORY_ID` |
| Welcome | `kairo-welcome` | `KAIRO_WELCOME_FACTORY_ID` |
| Debug Variables | `kairo-debug-variables` | `KAIRO_DEBUG_VARIABLES_FACTORY_ID` |
| Debug Call Stack | `kairo-debug-callstack` | `KAIRO_DEBUG_CALLSTACK_FACTORY_ID` |
| Debug Breakpoints | `kairo-debug-breakpoints` | `KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID` |
| Debug Toolbar | `kairo-debug-toolbar` | `KAIRO_DEBUG_TOOLBAR_FACTORY_ID` |
| Debug Console | `kairo-debug-console` | `KAIRO_DEBUG_CONSOLE_FACTORY_ID` |
| Debug Watch | `kairo-debug-watch` | `KAIRO_DEBUG_WATCH_FACTORY_ID` |
| Debug Module Selector | `kairo-debug-module-selector` | `KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID` |
| Debug Condition Editor | `kairo-debug-condition-editor` | `KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID` |
| Debug HotSwap Status | `kairo-debug-hotswap-status` | `KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID` |
| Debug Diagnostics | `kairo-debug-diagnostics` | `KAIRO_DEBUG_DIAGNOSTICS_FACTORY_ID` |

### 3.6 对话框 (Dialogs)

| 对话框 | 触发条件 | 按钮 | 操作 |
|--------|----------|------|------|
| 工作区信任 | 打开不受信任的工作区 | "Yes, I trust the authors" | 点击确认 |
| 保存工作区配置 | 切换工作区未保存 | "Don't Save" / "Save" / "Cancel" | 点击选择 |
| 文件保存确认 | 关闭未保存文件 | "Save" / "Don't Save" / "Cancel" | 点击选择 |
| 编码警告 | 使用不兼容编码保存 | 警告信息 | 查看 |

### 3.7 编辑器 (Editor) 交互元素

| 元素 | 类型 | 选择器 | 操作 |
|------|------|--------|------|
| 代码编辑区 | Monaco Editor | `.monaco-editor` | 输入、点击 |
| 行号 | 装订线 | `.line-numbers` | 点击设置断点 |
| 断点标记 | 装订线 | `.debug-breakpoint` | 点击切换 |
| 折叠图标 | 装订线 | `.folding-icon` | 点击折叠/展开 |
| 缩进参考线 | 视觉 | `.indent-guide` | 视觉验证 |
| 面包屑 | 导航 | `.breadcrumb` | 点击导航 |
| Minimap | 代码概览 | `.minimap` | 点击滚动 |
| 内联提示 | 参数名 | `.inlay-hint` | 视觉验证 |
| 查找/替换框 | 搜索 | `.find-input` | 输入搜索 |
| 右键菜单 | 上下文菜单 | (动态) | 点击操作 |

### 3.8 键盘快捷键 (Keybindings)

| 快捷键 | 命令 | 用途 |
|--------|------|------|
| `F1` | 命令面板 | 打开命令面板 |
| `F9` | 切换断点 | 调试 |
| `F12` | 跳转到定义 | 导航 |
| `Alt+F12` | 切换终端 | 终端 |
| `Ctrl+S` | 保存 | 文件 |
| `Ctrl+P` | 快速打开 | 文件导航 |
| `Ctrl+Shift+P` | 命令面板 | 打开命令面板 |
| `Ctrl+G` | 跳转到行 | 导航 |
| `Ctrl+B` | 切换侧边栏 | 布局 |
| `Ctrl+F` | 查找 | 搜索 |
| `Ctrl+Shift+F` | 全局搜索 | 搜索 |
| `Ctrl+Z` | 撤销 | 编辑 |
| `Ctrl+Y` | 重做 | 编辑 |
| `Ctrl+A` | 全选 | 编辑 |
| `Ctrl+C` | 复制 | 编辑 |
| `Ctrl+V` | 粘贴 | 编辑 |
| `Ctrl+N` | 新建文件 | 文件 |
| `Ctrl+`` | 切换终端 | 终端 |

---

## 4. 测试分片设计 (16 个并行 Shard)

### 4.1 Shard 分配方案

```
Shard  01: Shell 启动 + 布局 + 状态栏 + 命令面板           (8 tests)
Shard  02: 项目导入向导 + 文件资源管理器 + 多标签编辑        (8 tests)
Shard  03: Java 语言服务 (补全/跳转/重构/诊断)              (13 tests)
Shard  04: JSP/XML/Properties 多语言编辑                    (9 tests)
Shard  05: 构建 + 部署 + Tomcat 服务器管理                  (11 tests)
Shard  06: 调试功能 (断点/单步/变量/热替换)                 (13 tests)
Shard  07: 搜索 + Git/SVN + 编码检测                        (12 tests)
Shard  08: UI 主题/无障碍/视觉回归                           (15 tests)
Shard  09: 菜单栏全覆盖点击 (每个菜单项)                     (新增)
Shard  10: 右键菜单全覆盖 (文件/编辑器/终端)                (新增)
Shard  11: 对话框全覆盖 (信任/保存/编码/确认)               (新增)
Shard  12: 所有视图面板打开/关闭 (27个视图)                 (新增)
Shard  13: 真实项目内容编辑 + 保存 + 编码测序               (新增)
Shard  14: 控制台错误监控 + 网络请求验证                     (新增)
Shard  15: UI 颜色/对比度/布局合理性审查                    (新增)
Shard  16: 性能基线 + 内存泄漏检测                           (新增)
```

### 4.2 Shard 09: 菜单栏全覆盖点击

```typescript
// 测试每个菜单和子菜单项，验证：
// 1. 菜单能正常打开
// 2. 菜单项可点击
// 3. 点击后不产生 console 错误
// 4. 截图记录每个菜单状态

const ALL_MENUS = [
  { menu: 'File', items: ['New File', 'Open File...', 'Open Folder...', 'Save', 'Save As...'] },
  { menu: 'Edit', items: ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Find', 'Replace'] },
  { menu: 'View', items: ['Command Palette...', 'Open View...', 'Appearance', 'Editor Layout'] },
  { menu: 'Kairo', submenus: {
    'default': ['Import Kairo Project...', 'Select Kairo Project...', 'Scan Workspace', 'Run Configurations...'],
    'Build & Run': ['Build', 'Clean Build', 'Build & Deploy', 'Start Server', 'Start Server (Debug)', 'Stop Server', 'Restart Server', 'Open Application', 'Check Java Debug Adapter'],
    'View': ['Servers', 'Builds', 'Deployments', 'Tomcat Logs', 'Maven', 'TODO / FIXME', 'Test Results', 'SQL Console', 'Remote Development', 'Performance Dashboard'],
    'Debug': ['Open Debug View', 'Open Debug Console', 'Variables', 'Call Stack', 'Breakpoints', 'Watch', 'Debug Toolbar', 'Debug Diagnostics'],
    'Window': ['Toggle Terminal', 'Keyboard Shortcuts', 'Switch JDK', 'Reconnect Runtime Agent'],
  }},
  { menu: 'Help', items: ['Debug Diagnostics'] },
];
```

### 4.3 Shard 10: 右键菜单全覆盖

| 上下文 | 右键目标 | 预期菜单项 |
|--------|----------|------------|
| 文件资源管理器 - 文件 | .java 文件 | Open, Open With, Cut, Copy, Paste, Rename, Delete |
| 文件资源管理器 - 文件夹 | 文件夹 | New File, New Folder, Cut, Copy, Paste, Rename, Delete |
| 编辑器 - Java | 代码区域 | Go to Definition, Find References, Rename Symbol, Format Document |
| 编辑器 - JSP | 代码区域 | Go to Definition, Find References, Format Document |
| 编辑器 - XML | 代码区域 | Format Document, Validate XML |
| 终端 | 终端区域 | New Terminal, Copy, Paste, Clear, Kill Terminal |

### 4.4 Shard 12: 所有视图面板

```typescript
const ALL_VIEW_COMMANDS = [
  'Kairo: Show Servers',
  'Kairo: Show Builds',
  'Kairo: Show Deployments',
  'Kairo: Show Tomcat Logs',
  'Kairo: Show Maven',
  'Kairo: Show TODO/FIXME',
  'Kairo: Show Test Results',
  'Kairo: Show SQL Console',
  'Kairo: Show Remote Development',
  'Kairo: Show Performance',
  'Kairo: Show Debug Variables',
  'Kairo: Show Debug Call Stack',
  'Kairo: Show Debug Breakpoints',
  'Kairo: Show Debug Toolbar',
  'Kairo: Show Debug Console',
  'Kairo: Show Debug Watch',
  'Kairo: Open Keyboard Shortcuts',
  'Kairo: Manage Run Configurations',
  'Kairo: Open Debug Diagnostics',
  // Theia 标准视图
  'Explorer: Focus on Files Explorer',
  'Search: Focus on Search View',
  'Git: Focus on Git View',
  'Debug: Focus on Debug View',
  'Output: Focus on Output View',
  'Problems: Focus on Problems View',
  'Terminal: Focus on Terminal View',
];
```

---

## 5. 多 Agent 并行测试架构

### 5.1 架构设计

```
                    ┌─────────────────────────────────┐
                    │      Test Orchestrator           │
                    │  (主控 Agent: 协调 & 汇总)        │
                    └──────────┬──────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Agent Group A  │  │  Agent Group B  │  │  Agent Group C  │
│  (Shard 01-05)  │  │  (Shard 06-10)  │  │  (Shard 11-16)  │
│                 │  │                 │  │                 │
│  Port: 18301    │  │  Port: 18302    │  │  Port: 18303    │
│  Agent: 18182   │  │  Agent: 18183   │  │  Agent: 18184   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 5.2 并行执行策略

```bash
# 启动 3 个独立的 Runtime Agent + Theia 实例
# 每个实例使用不同的端口，互不干扰

# 实例 1 (Group A: Shard 01-05)
AGENT_PORT=18182 THEIA_PORT=18301 \
  npx playwright test --config tests/e2e/playwright.config.ts \
  --grep "SHARD-0[1-5]" &

# 实例 2 (Group B: Shard 06-10)
AGENT_PORT=18183 THEIA_PORT=18302 \
  npx playwright test --config tests/e2e/playwright.config.ts \
  --grep "SHARD-0[6-9]|SHARD-10" &

# 实例 3 (Group C: Shard 11-16)
AGENT_PORT=18184 THEIA_PORT=18303 \
  npx playwright test --config tests/e2e/playwright.config.ts \
  --grep "SHARD-1[1-6]" &

# 等待所有完成
wait
```

### 5.3 Agent 角色分配

| Agent 角色 | 职责 | 工具 |
|------------|------|------|
| **Orchestrator** | 启动测试、收集结果、触发修复循环 | Task + RunCommand |
| **Browser Agent A** | 执行 Shard 01-05 的浏览器测试 | Playwright + 截图 |
| **Browser Agent B** | 执行 Shard 06-10 的浏览器测试 | Playwright + 截图 |
| **Browser Agent C** | 执行 Shard 11-16 的浏览器测试 | Playwright + 截图 |
| **Console Monitor** | 实时监控所有实例的控制台输出 | CheckCommandStatus |
| **Screenshot Reviewer** | 分析截图，检查 UI 合理性 | 视觉对比 |
| **Fix Agent** | 根据失败报告修复代码 | Edit + Write |

---

## 6. 控制台与网络监控策略

### 6.1 控制台错误监控

```typescript
/**
 * 全局控制台错误收集器
 * 在每个测试中注入，收集所有 console.error / pageerror
 */
export function setupConsoleMonitor(page: Page): ConsoleErrorCollector {
  const errors: ConsoleError[] = [];
  const warnings: ConsoleWarning[] = [];

  // 监控页面级错误
  page.on('pageerror', (error) => {
    errors.push({
      type: 'pageerror',
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
    });
  });

  // 监控控制台错误
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console.error',
        message: msg.text(),
        location: msg.location(),
        timestamp: Date.now(),
      });
    }
    if (msg.type() === 'warning') {
      warnings.push({
        type: 'console.warning',
        message: msg.text(),
        timestamp: Date.now(),
      });
    }
  });

  return {
    getErrors: () => [...errors],
    getWarnings: () => [...warnings],
    clear: () => { errors.length = 0; warnings.length = 0; },
    hasErrors: () => errors.length > 0,
    hasWarnings: () => warnings.length > 0,
    report: () => ({
      errorCount: errors.length,
      warningCount: warnings.length,
      errors: errors.slice(0, 20),
      warnings: warnings.slice(0, 20),
    }),
  };
}
```

### 6.2 网络请求监控

```typescript
/**
 * 网络请求失败收集器
 */
export function setupNetworkMonitor(page: Page): NetworkMonitor {
  const failedRequests: FailedRequest[] = [];
  const slowRequests: SlowRequest[] = [];

  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown',
      timestamp: Date.now(),
    });
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push({
        url: response.url(),
        method: response.request().method(),
        failure: `HTTP ${response.status()} ${response.statusText()}`,
        timestamp: Date.now(),
      });
    }
  });

  return {
    getFailed: () => [...failedRequests],
    getSlow: () => [...slowRequests],
    hasFailures: () => failedRequests.length > 0,
    report: () => ({
      failureCount: failedRequests.length,
      failures: failedRequests.slice(0, 20),
    }),
  };
}
```

### 6.3 白名单（预期可忽略的错误）

```typescript
const IGNORED_ERRORS = [
  // 非关键警告
  'non-serializable',
  'favicon.ico',
  // 开发环境已知问题
  'WebSocket connection to',
  'Failed to load resource: net::ERR_CONNECTION_REFUSED',
  // 非关键 React 警告
  'Warning: componentWillReceiveProps',
  'Warning: componentWillMount',
];
```

---

## 7. UI 设计评审标准

### 7.1 颜色与对比度

| 检查项 | 标准 | 验证方法 |
|--------|------|----------|
| 文字对比度 | WCAG AA (4.5:1 正常文本, 3:1 大文本) | 截图分析 |
| 按钮颜色一致性 | 所有主按钮使用 Kairo 品牌色 | 视觉对比 |
| 暗色主题完整性 | 所有面板和对话框支持暗色主题 | 切换主题后截图 |
| 活动状态指示 | 活动标签/按钮有明确视觉区分 | 截图对比 |
| 错误状态颜色 | 红色/橙色用于错误和警告 | 视觉验证 |
| 成功状态颜色 | 绿色用于成功状态 | 视觉验证 |

### 7.2 布局与间距

| 检查项 | 标准 | 验证方法 |
|--------|------|----------|
| 侧边栏宽度 | 默认 300px，可拖拽调整 | 截图测量 |
| 面板间距 | 面板之间无明显重叠 | 全页截图 |
| 按钮间距 | 按钮之间至少有 8px 间距 | 元素检查 |
| 文字溢出 | 长文本应有省略号或换行 | 边界测试 |
| 响应式布局 | 窗口缩放时布局不崩溃 | 调整视口大小 |

### 7.3 交互反馈

| 检查项 | 标准 | 验证方法 |
|--------|------|----------|
| 按钮悬停效果 | 鼠标悬停时按钮有视觉变化 | 截图对比 |
| 加载状态 | 长时间操作有 spinner 或进度条 | 截图 |
| 禁用状态 | 不可用按钮有灰色样式 | 截图 |
| 焦点指示器 | Tab 键导航时有可见焦点环 | 截图 |
| Toast 通知 | 操作结果有 toast 提示 | 截图 |

---

## 8. 真实项目模拟测试

### 8.1 测试项目: legacy-sample

```
legacy-sample/
├── .kairo/
│   └── project.yaml          # Kairo 项目配置
├── .theia/
│   └── launch.json           # 调试配置
├── WebRoot/
│   └── WEB-INF/
│       └── web.xml           # Servlet 配置
├── src/
│   ├── main/
│   │   └── webapp/
│   │       └── index.jsp
│   ├── index.ts              # TypeScript 文件
│   ├── main.py               # Python 文件
│   └── style.css             # CSS 文件
├── lib/
│   └── jstl-1.2.jar          # 依赖库
├── build.xml                 # Ant 构建文件
├── KairoJavaConfig.ini       # Java 配置
└── package.json              # 项目元数据
```

### 8.2 真实内容编辑测试

```typescript
// 测试编辑真实项目文件
const REAL_PROJECT_TESTS = [
  {
    file: 'src/main/webapp/index.jsp',
    edit: '在 <body> 标签内添加新内容',
    save: true,
    verify: '内容保存成功，无编码错误',
  },
  {
    file: 'WebRoot/WEB-INF/web.xml',
    edit: '添加新的 <servlet-mapping>',
    save: true,
    verify: 'XML 格式正确，语法高亮正确',
  },
  {
    file: 'src/style.css',
    edit: '添加新的 CSS 规则',
    save: true,
    verify: 'CSS 语法高亮正确',
  },
  {
    file: 'src/index.ts',
    edit: '添加 TypeScript 代码',
    save: true,
    verify: 'TS 语法高亮正确',
  },
  {
    file: 'src/main.py',
    edit: '添加 Python 代码',
    save: true,
    verify: 'Python 语法高亮正确',
  },
  {
    file: 'build.xml',
    edit: '修改 Ant 构建配置',
    save: true,
    verify: 'XML 语法高亮，Ant 类路径提取',
  },
];
```

### 8.3 完整的项目工作流测试

```
1. 导入项目
   - 打开 Kairo: Import Project 向导
   - 输入项目路径
   - 点击 Scan → Import Project → Open Project Folder
   - 验证: 文件资源管理器显示项目文件

2. 编辑 Java 文件
   - 打开 HelloServlet.java
   - 使用代码补全 (Ctrl+Space)
   - 使用跳转到定义 (F12)
   - 使用查找引用 (Shift+F12)
   - 使用重命名重构 (F2)

3. 构建项目
   - 执行 Kairo: Build
   - 验证: 构建状态显示 "completed"
   - 验证: 构建视图显示构建结果

4. 启动 Tomcat
   - 执行 Kairo: Start Server
   - 验证: 服务器状态显示 "running"
   - 验证: 日志视图显示 Tomcat 启动日志

5. 调试项目
   - 设置断点
   - 执行 Kairo: Start Server (Debug)
   - 验证: 调试器暂停在断点处
   - 验证: 变量视图显示变量值
   - 执行单步 (F10/F11)
   - 验证: 调用栈正确

6. 打开应用
   - 执行 Kairo: Open Application
   - 验证: 浏览器打开应用页面

7. 停止服务器
   - 执行 Kairo: Stop Server
   - 验证: 服务器状态显示 "stopped"
```

---

## 9. 循环测试与修复流程

### 9.1 循环流程

```
┌──────────────────────────────────────────────────────────────────┐
│                    Kairo IDE 测试循环流程                          │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ 1. 启动   │───▶│ 2. 并行   │───▶│ 3. 收集   │───▶│ 4. 分析   │  │
│  │ 测试环境  │    │ 执行测试  │    │ 测试结果  │    │ 失败原因  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                         │       │
│                     ┌───────────────────────────────────┘       │
│                     ▼                                            │
│              ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│              │ 7. 输出   │◀───│ 6. 重新   │◀───│ 5. 修复   │      │
│              │ 测试报告  │    │ 执行测试  │    │ 代码问题  │      │
│              └──────────┘    └──────────┘    └──────────┘      │
│                     │                                            │
│                     ▼                                            │
│              ┌──────────┐                                       │
│              │ 全部通过? │─── No ───▶ 回到步骤 5                 │
│              └──────────┘                                       │
│                     │                                            │
│                     Yes                                          │
│                     ▼                                            │
│              ┌──────────┐                                       │
│              │ 测试完成  │                                       │
│              └──────────┘                                       │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 修复优先级

| 优先级 | 问题类型 | 处理方式 |
|--------|----------|----------|
| P0 | console.error / pageerror | 立即修复 |
| P0 | 网络请求失败 (4xx/5xx) | 立即修复 |
| P0 | 按钮/菜单点击无响应 | 立即修复 |
| P1 | 控制台 warning | 尽快修复 |
| P1 | UI 布局问题 | 尽快修复 |
| P1 | 颜色对比度不达标 | 尽快修复 |
| P2 | 性能问题 | 优化 |
| P2 | 非关键视觉问题 | 优化 |

### 9.3 测试报告格式

```json
{
  "runId": "kairo-full-regression-20260725-001",
  "timestamp": "2026-07-25T10:00:00Z",
  "summary": {
    "total": 128,
    "passed": 120,
    "failed": 5,
    "skipped": 3,
    "duration": "45m"
  },
  "failures": [
    {
      "testId": "TEST-0605",
      "shard": "06",
      "name": "调试单步执行",
      "error": "Timeout waiting for 'Debug: paused'",
      "consoleErrors": ["Cannot read property 'line' of undefined"],
      "screenshot": "test-results/screenshots/shard-06/TEST-0605/failure.png"
    }
  ],
  "consoleErrors": {
    "total": 3,
    "unique": 2,
    "details": [
      {
        "message": "Cannot read property 'line' of undefined",
        "count": 2,
        "source": "debug-toolbar-widget.ts:45"
      }
    ]
  },
  "networkFailures": {
    "total": 0,
    "details": []
  },
  "uiIssues": [
    {
      "type": "contrast",
      "element": ".kairo-build-button",
      "issue": "文字对比度 3.2:1，低于 WCAG AA 标准 4.5:1",
      "severity": "P1"
    }
  ]
}
```

---

## 10. 测试执行命令

### 10.1 环境准备

```bash
# 1. 确保 Runtime Agent 在运行
# Terminal 1:
cd /Users/qi/Documents/spaces/kairo-ide
./runtime-agent/bin/kairo-runtime \
  --config runtime-agent/configs/dev.yaml \
  --port 18182 \
  --bundled-dir .runtime/bundled \
  --data-dir .runtime/data-regression-3001 \
  --log-level=info

# 2. 确保 Theia Browser 在运行
# Terminal 2:
cd /Users/qi/Documents/spaces/kairo-ide
pnpm dev:browser
```

### 10.2 执行单个 Shard

```bash
# 执行单个 shard
npx playwright test \
  --config tests/e2e/playwright.config.ts \
  tests/e2e/regression/shard-01-shell.spec.ts

# 执行指定 shard 范围
npx playwright test \
  --config tests/e2e/playwright.config.ts \
  --grep "SHARD-0[1-5]"
```

### 10.3 执行完整回归

```bash
# 全量回归 (所有 8 个 shard)
npx playwright test \
  --config tests/e2e/playwright.config.ts

# 使用 K4 回归配置
npx playwright test \
  --config tests/e2e/regression-k4-playwright.config.ts

# 使用全量回归配置
npx playwright test \
  --config tests/e2e/full-regression.config.ts
```

### 10.4 带调试模式

```bash
# 调试模式 (显示浏览器)
npx playwright test \
  --config tests/e2e/playwright.config.ts \
  --headed \
  --debug

# 只运行失败的测试
npx playwright test \
  --config tests/e2e/playwright.config.ts \
  --last-failed
```

### 10.5 生成报告

```bash
# 生成 HTML 报告
npx playwright show-report test-results/report

# 生成 JSON 报告
npx playwright test --config tests/e2e/playwright.config.ts --reporter=json
```

### 10.6 多 Agent 并行执行脚本

```bash
#!/bin/bash
# scripts/run-full-regression-parallel.sh

BASE_DIR="/Users/qi/Documents/spaces/kairo-ide"
CONFIG="$BASE_DIR/tests/e2e/playwright.config.ts"

# 启动 3 个并行测试组
echo "Starting parallel test groups..."

# Group A: Shard 01-05
(
  export AGENT_PORT=18182
  export THEIA_PORT=18301
  cd "$BASE_DIR"
  npx playwright test --config "$CONFIG" --grep "SHARD-0[1-5]" 2>&1 | tee test-results/group-a.log
) &

# Group B: Shard 06-10
(
  export AGENT_PORT=18183
  export THEIA_PORT=18302
  cd "$BASE_DIR"
  npx playwright test --config "$CONFIG" --grep "SHARD-0[6-9]|SHARD-10" 2>&1 | tee test-results/group-b.log
) &

# Group C: Shard 11-16
(
  export AGENT_PORT=18184
  export THEIA_PORT=18303
  cd "$BASE_DIR"
  npx playwright test --config "$CONFIG" --grep "SHARD-1[1-6]" 2>&1 | tee test-results/group-c.log
) &

# 等待所有完成
wait

echo "All test groups completed."
echo "Results in test-results/group-*.log"
```

---

## 附录 A: 测试覆盖率矩阵

| 类别 | 元素数量 | 已测试 | 待测试 | 覆盖率 |
|------|----------|--------|--------|--------|
| 菜单项 | 45+ | ~20 | 25+ | 44% |
| 命令面板 | 34 | ~15 | 19 | 44% |
| 视图面板 | 27 | ~10 | 17 | 37% |
| 按钮 | 50+ | ~20 | 30+ | 40% |
| 输入框 | 15+ | ~5 | 10+ | 33% |
| 下拉框 | 5+ | ~2 | 3+ | 40% |
| 复选框 | 10+ | ~2 | 8+ | 20% |
| 对话框 | 4 | ~2 | 2 | 50% |
| 右键菜单 | 10+ | ~0 | 10+ | 0% |
| 键盘快捷键 | 18 | ~8 | 10 | 44% |

---

## 附录 B: 关键 CSS 选择器参考

| 元素 | CSS 选择器 |
|------|-----------|
| Theia Shell | `#theia-app-shell, #theia-shell, .theia-shell` |
| 顶部面板 | `#theia-top-panel` |
| 左侧面板 | `#theia-left-content-panel` |
| 主内容区 | `#theia-main-content-panel` |
| 状态栏 | `#theia-statusBar` |
| 活动栏 | `.theia-activity-bar` |
| 命令面板 | `.quick-input-widget` |
| 命令输入框 | `.quick-input-widget .quick-input-box input` |
| 快速选择列表 | `.monaco-list .monaco-list-row` |
| Monaco 编辑器 | `.monaco-editor` |
| 编辑器行号 | `.monaco-editor .line-numbers` |
| 编辑器内容行 | `.monaco-editor .view-line` |
| 树节点 | `.theia-TreeNode` |
| 对话框 | `.dialogBlock, .workspace-trust-dialog` |
| 信任按钮 | `button:has-text("Yes, I trust")` |
| 面包屑 | `.breadcrumb` |
| Minimap | `.minimap` |
| 查找输入框 | `.find-input` |
| 终端 | `.xterm, .terminal` |
| 构建视图 | `[data-testid="kairo-build-view"]` |
| 服务器视图 | `[data-testid="kairo-server-view"]` |
| 导入向导路径 | `[data-testid="path-input"]` |
| 扫描按钮 | `[data-testid="scan-btn"]` |
| 导入按钮 | `[data-testid="import-project-btn"]` |
| 打开项目按钮 | `[data-testid="open-project-btn"]` |

---

## 附录 C: 强调事项

1. **不能因为没有数据就不进行测试** — 必须创建测试数据，导入真实项目
2. **每个操作都要截图** — 截图是验证 UI 设计合理性的关键证据
3. **控制台错误零容忍** — 每个操作后检查 console.error
4. **网络请求零失败** — 每个操作后检查请求状态
5. **颜色对比度合规** — 暗色主题下所有文字必须满足 WCAG AA 标准
6. **真实项目内容** — 使用 legacy-sample 的真实 Java/JSP/XML 文件
7. **循环修复直到全部通过** — 不能"跳过"失败测试
8. **多 Agent 并行** — 同时运行多个 shard 加速测试
9. **修复后必须重新测试** — 修复代码后立即重新运行相关 shard
10. **完整工作流** — 测试从导入项目到构建部署调试的完整流程