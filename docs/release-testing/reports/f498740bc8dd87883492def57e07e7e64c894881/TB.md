# Kairo IDE — MAC/WEB 发布盲测基线 (TB.md)

> - TESTED_COMMIT: `f498740bc8dd87883492def57e07e7e64c894881`
> - 分支: `qa/mac-m4-mavis-blind` (从 f498740 fork)
> - 审计基线: 2026-07-20
> - 目标: 真实执行,不写"测试计划",不参考历史报告
> - 端口: 浏览器 `3030` (避开 3000), Runtime Agent `18892` (避开 18890)
> - 工具链: Chromium (playwright) + WebKit (playwright) + 系统 Safari

## 0. 总览

- **测试机线 (Agent lines)**: 6 大类
  1. **ENV** (环境/基线) — 12 case
  2. **UI** (UI 库存/点击) — 160 case
  3. **VIS** (视觉/对比度/可访问性) — 80 case
  4. **FLOW** (业务流程) — 80 case
  5. **API** (接口) — 60 case
  6. **COMPAT/PERF/SEC/STAB** (兼容/性能/安全/稳定) — 60 case
  - **合计 ~452 个 case**
- **界面元素 (UI Inventory) 静态盘点**:
  - 状态栏: 6 个 (Project / Java / JDT LS / Encoding / Server / Runtime + LargeFile)
  - 命令面板命令: ~30 个 Kairo: 命令 + 大量 Theia 内建命令
  - 视图/Widget: Build / Server / Deployments / Logs / Import Wizard / Project Selector / File Tree / Editor / Terminal / Output
  - 工具栏: Build (Build/Clean) / Server (Start/Stop/Restart/Open App) / Logs (Clear/Selector)
  - 表单: Import Wizard (项目名, 4×sourceLevel, 4×encoding, 2×buildTool)
  - 编辑器: Monaco + Java/JSP/CSS/JS
- **截图矩阵**: ~120 张主截图 (UI 库存+ 11 类状态 × 多 viewport)
- **接口点**: 30+ endpoint (workspace/project/build/deploy/server/search/toolchain/jdtls/encoding)
- **业务流**: 6 个主流程 (WEB-FLOW-01~06)

---

## 1. ENV — 环境和基线 (12 case)

| ID | Case | 验收 |
|---|---|---|
| ENV-01 | Node 20.x 通过 | `node --version` ≥ 20.10.0 |
| ENV-02 | pnpm 9.15.9 通过 | `pnpm --version` 9.15.9 |
| ENV-03 | Go 1.22+ 通过 | `go version` |
| ENV-04 | Java 21+ 通过 | `java -version` |
| ENV-05 | `pnpm install --frozen-lockfile` 0 error | exit 0 |
| ENV-06 | `pnpm build` 0 error | exit 0 |
| ENV-07 | `pnpm test` 0 error (包级 unit) | exit 0 |
| ENV-08 | `pnpm lint` 0 error (0 warning) | exit 0 |
| ENV-09 | `pnpm -r --filter "./packages/*" exec tsc --noEmit` 0 error | exit 0 |
| ENV-10 | `cd runtime-agent && gofmt -l $(rg --files -g '*.go')` 无输出 | exit 0 |
| ENV-11 | `cd runtime-agent && go vet ./...` 0 error | exit 0 |
| ENV-12 | `cd runtime-agent && go test -count=1 ./...` 全绿 | exit 0 |

---

## 2. UI — UI 库存与点击 (~160 case)

### 2.1 状态栏 (7 项)

| ID | Case |
|---|---|
| UI-SB-01 | Project 默认 "(no workspace)" |
| UI-SB-02 | Project 导入后显示 project name |
| UI-SB-03 | Project tooltip 含 root/workspaceId/projectId |
| UI-SB-04 | Java 默认 "-" |
| UI-SB-05 | JDT LS 状态 idle/starting/running/ready/crashed 正确 |
| UI-SB-06 | JDT LS tooltip 含 Local/Agent/Version/JRE/PID |
| UI-SB-07 | Encoding 默认 "-" |
| UI-SB-08 | Encoding 切换文件后更新 |
| UI-SB-09 | Encoding override 显示 "*" |
| UI-SB-10 | Encoding tooltip 含 URI 和 default/override 提示 |
| UI-SB-11 | Server 状态 stopped/starting/running/stopping/error/crashed |
| UI-SB-12 | Server 显示端口 `:xxxx` (running) |
| UI-SB-13 | Runtime 状态 connecting/open/disconnected/closed |
| UI-SB-14 | Runtime disconnected 时 Server 也显示 disconnected |
| UI-SB-15 | LargeFile 显示 "Large file mode" / "Huge file: lightweight mode" |
| UI-SB-16 | LargeFile 状态消失时 (回到 normal) status bar 条目消失 |

### 2.2 命令面板 — Kairo: 命令 (≥ 12 个)

| ID | Case |
|---|---|
| UI-CMD-01 | F1 打开命令面板 |
| UI-CMD-02 | 输入 "Kairo" 过滤命令 |
| UI-CMD-03 | Kairo: Scan Project (无 workspace → warn) |
| UI-CMD-04 | Kairo: Scan Project (有 workspace → 调用) |
| UI-CMD-05 | Kairo: Build (无 project → error) |
| UI-CMD-06 | Kairo: Build (有 project → 触发 POST /api/v1/builds) |
| UI-CMD-07 | Kairo: Build and Deploy |
| UI-CMD-08 | Kairo: Start Server |
| UI-CMD-09 | Kairo: Start Server (Debug) |
| UI-CMD-10 | Kairo: Stop Server |
| UI-CMD-11 | Kairo: Restart Server |
| UI-CMD-12 | Kairo: Open Application |
| UI-CMD-13 | Kairo: Show Servers |
| UI-CMD-14 | Kairo: Show Builds |
| UI-CMD-15 | Kairo: Show Deployments |
| UI-CMD-16 | Kairo: Show Tomcat Logs |
| UI-CMD-17 | Kairo: Reopen with Encoding… |
| UI-CMD-18 | Kairo: Save with Encoding… |
| UI-CMD-19 | Kairo: Show File Encoding |
| UI-CMD-20 | Large File: Toggle Full Editor Features |

### 2.3 Theia 内建命令/菜单

| ID | Case |
|---|---|
| UI-FILE-01 | File 菜单 New File |
| UI-FILE-02 | File 菜单 Open File |
| UI-FILE-03 | File 菜单 Open Folder |
| UI-FILE-04 | File 菜单 Save |
| UI-FILE-05 | File 菜单 Save As |
| UI-FILE-06 | File 菜单 Auto Save toggle |
| UI-FILE-07 | File 菜单 Revert File |
| UI-FILE-08 | Edit 菜单 Undo |
| UI-FILE-09 | Edit 菜单 Redo |
| UI-FILE-10 | Edit 菜单 Cut/Copy/Paste |
| UI-FILE-11 | Edit 菜单 Find/Replace |
| UI-FILE-12 | View 菜单 Toggle Sidebar |
| UI-FILE-13 | View 菜单 Toggle Panel |
| UI-FILE-14 | View 菜单 Toggle Terminal |
| UI-FILE-15 | View 菜单 Toggle Word Wrap |
| UI-FILE-16 | Terminal 菜单 New Terminal |
| UI-FILE-17 | Help 菜单 About |
| UI-FILE-18 | 菜单不可用项 disabled (无项目时) |

### 2.4 视图/Widget (核心 8 个)

| ID | Case |
|---|---|
| UI-EXP-01 | File Explorer 默认空 |
| UI-EXP-02 | File Explorer 打开 workspace 后树渲染 |
| UI-EXP-03 | File Explorer 文件夹展开/折叠 |
| UI-EXP-04 | File Explorer 新建/删除/重命名 |
| UI-EXP-05 | Project Selector Widget 打开/关闭 |
| UI-EXP-06 | Project Selector Widget 显示当前项目名 |
| UI-EXP-07 | Project Selector Widget 点击外部关闭 |
| UI-EXP-08 | Project Selector Widget Escape 关闭 |
| UI-EXP-09 | Import Wizard 4 步骤切换 |
| UI-EXP-10 | Import Wizard Step 1 Open Workspace Folder 按钮 |
| UI-EXP-11 | Import Wizard Step 2 Continue / Create New Configuration |
| UI-EXP-12 | Import Wizard Step 3 表单完整 |
| UI-EXP-13 | Build View 5 状态: loading/disconnected/idle/pending/running/succeeded/failed/cancelled |
| UI-EXP-14 | Build View 按钮 Build / Clean Build |
| UI-EXP-15 | Build View Diagnostics 列表 |
| UI-EXP-16 | Build View Build History |
| UI-EXP-17 | Server View 状态显示 |
| UI-EXP-18 | Server View 按钮 Start/Stop/Restart/Open App |
| UI-EXP-19 | Server View Server Info (ID/Port/PID/Started) |
| UI-EXP-20 | Server View All Servers 列表 |
| UI-EXP-21 | Server View URL 链接 |
| UI-EXP-22 | Deployments View empty 状态 |
| UI-EXP-23 | Deployments View 50 行上限 |
| UI-EXP-24 | Deployments View 表格列 ID/State/Files/Trigger/Reload |
| UI-EXP-25 | Server Logs View toolbar |
| UI-EXP-26 | Server Logs View Clear 按钮 |
| UI-EXP-27 | Server Logs View 多 server selector |
| UI-EXP-28 | Server Logs View 自动滚动 |
| UI-EXP-29 | Server Logs View 用户上滚暂停 |
| UI-EXP-30 | Server Logs View error/warning/info 颜色区分 |
| UI-EXP-31 | Server Logs View 500 可见/1000 上限 |
| UI-EXP-32 | Notifications 显示/消失 |

### 2.5 编辑器/工具 (Monaco)

| ID | Case |
|---|---|
| UI-ED-01 | 创建 .java 文件并打开 |
| UI-ED-02 | 创建 .jsp 文件并打开 |
| UI-ED-03 | 创建 .properties 文件并打开 |
| UI-ED-04 | 创建 .css 文件并打开 |
| UI-ED-05 | 创建 .js 文件并打开 |
| UI-ED-06 | 语法高亮可见 |
| UI-ED-07 | dirty 状态显示 |
| UI-ED-08 | close dirty 文件确认弹窗 |
| UI-ED-09 | undo/redo |
| UI-ED-10 | search/find |
| UI-ED-11 | 缩放/字号调整 |
| UI-ED-12 | 1MB 大文件滚动 |
| UI-ED-13 | 10MB 大文件 largeFile 模式激活 |

### 2.6 Import Wizard 详细

| ID | Case |
|---|---|
| UI-IMP-01 | 4 步进度条 (step-1/2/3/4) |
| UI-IMP-02 | Step 1 选 workspace 文件夹 |
| UI-IMP-03 | Step 1 selected-path 显示 |
| UI-IMP-04 | Step 2 扫描 loading |
| UI-IMP-05 | Step 2 显示 detectedConfig JSON |
| UI-IMP-06 | Step 2 "Continue" 按钮 |
| UI-IMP-07 | Step 2 "Create New Configuration" 按钮 |
| UI-IMP-08 | Step 3 项目名 input (默认 my-project) |
| UI-IMP-09 | Step 3 项目名 (空) |
| UI-IMP-10 | Step 3 项目名 (超长) |
| UI-IMP-11 | Step 3 项目名 (中文) |
| UI-IMP-12 | Step 3 sourceLevel 4 选项 (1.5/1.6/1.7/1.8) |
| UI-IMP-13 | Step 3 encoding 4 选项 (UTF-8/GBK/GB18030/ISO-8859-1) |
| UI-IMP-14 | Step 3 buildTool 2 选项 (ant/javac) |
| UI-IMP-15 | Step 3 Save Configuration 按钮 |
| UI-IMP-16 | Step 3 saving 状态 (按钮 disabled) |
| UI-IMP-17 | Step 3 save-error 区域 |
| UI-IMP-18 | Step 4 (实现缺失 - 应该显示成功) |

### 2.7 交互细节 (UI/UX)

| ID | Case |
|---|---|
| UI-UX-01 | 按钮 hover 颜色变化 |
| UI-UX-02 | 按钮 focus 焦点环可见 |
| UI-UX-03 | Tab 顺序符合视觉 |
| UI-UX-04 | Enter/Space 触发 button |
| UI-UX-05 | Escape 关闭 dialog |
| UI-UX-06 | 重复点击 build 不会 double submit |
| UI-UX-07 | 通知不能瞬间消失到不可读 |
| UI-UX-08 | disabled 按钮不可点击 |
| UI-UX-09 | 1280×720 viewport 不截断 |
| UI-UX-10 | 200% zoom 不截断 |
| UI-UX-11 | 长中文不换行错乱 |
| UI-UX-12 | 长英文不溢出 |
| UI-UX-13 | 窗口缩放 1920→1280 不破布局 |
| UI-UX-14 | codicon 渲染 (非 emoji 替代) |
| UI-UX-15 | 状态文字英文大小写一致 |

---

## 3. VIS — 视觉、对比度、可访问性 (~80 case)

### 3.1 对比度 (WCAG AA)

| ID | Case | 验收 |
|---|---|---|
| VIS-CT-01 | 状态栏普通文字 ≥ 4.5:1 | axe |
| VIS-CT-02 | 标题大文字 ≥ 3:1 | axe |
| VIS-CT-03 | 按钮边界 ≥ 3:1 | axe |
| VIS-CT-04 | 焦点环 ≥ 3:1 | axe |
| VIS-CT-05 | 通知文字 vs 背景 ≥ 4.5:1 | axe |
| VIS-CT-06 | 链接文字 ≥ 4.5:1 | axe |
| VIS-CT-07 | 输入框 placeholder ≥ 3:1 | axe |
| VIS-CT-08 | disabled 文字 ≥ 3:1 | axe |

### 3.2 可访问性 (a11y)

| ID | Case |
|---|---|
| VIS-AX-01 | 所有 button 有 accessible name |
| VIS-AX-02 | 所有 input 有 label |
| VIS-AX-03 | 图标按钮有 aria-label |
| VIS-AX-04 | 装饰图标 aria-hidden |
| VIS-AX-05 | 无重复 ID |
| VIS-AX-06 | select 关联 label |
| VIS-AX-07 | 错误区域 role="alert" |
| VIS-AX-08 | 键盘可完成主链 |
| VIS-AX-09 | 无 keyboard trap |
| VIS-AX-10 | Tab 顺序符合视觉 |
| VIS-AX-11 | 焦点不丢 (视图刷新/日志追加) |
| VIS-AX-12 | 200% zoom 无信息丢失 |
| VIS-AX-13 | Reduced Motion 下无持续动画 |
| VIS-AX-14 | Monaco 原生键盘语义 |

### 3.3 视觉

| ID | Case |
|---|---|
| VIS-VD-01 | 8px/4px 节奏对齐 |
| VIS-VD-02 | 标题/列/按钮/图标基线对齐 |
| VIS-VD-03 | 720p 下核心按钮可见 |
| VIS-VD-04 | 无水平滚动泄漏 |
| VIS-VD-05 | 面板 resize 重排合理 |
| VIS-VD-06 | 主/次/危险按钮区分 |
| VIS-VD-07 | 状态不能只靠红/绿 |
| VIS-VD-08 | 错误/警告/成功深色主题可辨 |
| VIS-VD-09 | Codicon 不变成 emoji 风格 |
| VIS-VD-10 | Retina 下图标清晰 |
| VIS-VD-11 | 滚动区域不抢滚轮 |
| VIS-VD-12 | sticky header 不遮内容 |
| VIS-VD-13 | 对话框 z-index 正确 |
| VIS-VD-14 | 对话框 Escape 关闭 |
| VIS-VD-15 | 中文系统无乱码/tofu |
| VIS-VD-16 | 同一概念大小写一致 (Server/Servers) |

### 3.4 截图矩阵 (按区域)

| 区域 | 必截状态 |
|---|---|
| 全窗口 | 空/加载/正常/hover/focus/disabled/busy/成功/错误/断连/长内容 |
| Build View | 5 状态 × 默认 |
| Server View | 6 状态 × 默认 |
| Deployments | empty/有 1 行/有 50 行/有 51 行 |
| Logs | empty/100 行/500 行/1000 行/有 error warn |
| Import Wizard | step 1/2/3/4 |
| Status Bar | 各状态 |
| Theme | Dark |
| Viewport | 1280×720 / 1440×900 / 1920×1080 / 200% zoom |

---

## 4. FLOW — 业务流程 (~80 case)

### 4.1 WEB-FLOW-01 首次导入

| ID | Case |
|---|---|
| F01-01 | 冷启动 → Welcome 状态 |
| F01-02 | 打开 Import Wizard |
| F01-03 | Step 1 选临时复制的 legacy-sample |
| F01-04 | Step 2 扫描 loading |
| F01-05 | Step 2 detectedConfig 显示 |
| F01-06 | Step 3 名称空 |
| F01-07 | Step 3 名称超长 |
| F01-08 | Step 3 名称中文 |
| F01-09 | Step 3 sourceLevel 切换 (1.5/1.6/1.7/1.8) |
| F01-10 | Step 3 encoding 切换 (UTF-8/GBK/GB18030/ISO-8859-1) |
| F01-11 | Step 3 buildTool 切换 (ant/javac) |
| F01-12 | Step 3 Save → 关闭 wizard |
| F01-13 | Project Selector 更新 |
| F01-14 | 磁盘 config 存在 |
| F01-15 | 重开 wizard 看到已有项目 |
| F01-16 | 故意让 Runtime 断开后保存 → 错误可见 |
| F01-17 | 表单值不丢 |
| F01-18 | 恢复后重试不重复创建 |

### 4.2 WEB-FLOW-02 文件与编辑器

| ID | Case |
|---|---|
| F02-01 | 文件树展开 |
| F02-02 | 打开 .java 文件 |
| F02-03 | 打开 .jsp 文件 |
| F02-04 | 打开 .properties 文件 |
| F02-05 | File 菜单测试 |
| F02-06 | 快捷键测试 |
| F02-07 | 新建文件 |
| F02-08 | 重命名文件 |
| F02-09 | 复制文件 |
| F02-10 | 删除文件 |
| F02-11 | dirty 标识 |
| F02-12 | close 确认 |
| F02-13 | auto save |
| F02-14 | 刷新页面恢复 |
| F02-15 | Java completion 真实 |
| F02-16 | F12 definition 真实 |
| F02-17 | JSP 语法高亮 |
| F02-18 | 1MB 文件 |
| F02-19 | 10MB 文件 large mode |
| F02-20 | 搜索结果 |

### 4.3 WEB-FLOW-03 编码安全 (GBK)

| ID | Case |
|---|---|
| F03-01 | 记录 GBK fixture SHA-256 |
| F03-02 | UI Reopen with Encoding GBK |
| F03-03 | 中文正确显示 |
| F03-04 | Status Bar Encoding 同步 |
| F03-05 | 修改为 GBK 可表示 |
| F03-06 | 保存 → 字节正确 |
| F03-07 | 重开 → 字节相同 |
| F03-08 | HTTP 输出正确 |
| F03-09 | 输入 GBK 不可表示字符 |
| F03-10 | UI 阻止并说明 |
| F03-11 | 文件 SHA-256 不变 |
| F03-12 | Save with Encoding UTF-8 |
| F03-13 | 再转回 GBK |
| F03-14 | BOM 检测 |
| F03-15 | 换行不被破坏 |

### 4.4 WEB-FLOW-04 构建

| ID | Case |
|---|---|
| F04-01 | 点 Build |
| F04-02 | state: idle→pending→running→succeeded |
| F04-03 | 按钮 busy 状态 |
| F04-04 | summary 显示 |
| F04-05 | history 更新 |
| F04-06 | 时间正确 |
| F04-07 | 磁盘 class 存在 |
| F04-08 | 制造编译错误 |
| F04-09 | failed 状态 |
| F04-10 | diagnostic 真实 |
| F04-11 | 点击 diagnostic 定位 |
| F04-12 | 修复后构建成功 |
| F04-13 | 历史保留 |
| F04-14 | 错误清除 |
| F04-15 | Clean & Build 语义 |

### 4.5 WEB-FLOW-05 部署与 Tomcat

| ID | Case |
|---|---|
| F05-01 | Build and Deploy |
| F05-02 | Deployments View 记录 |
| F05-03 | 文件数/字节 |
| F05-04 | Start Server |
| F05-05 | state: starting→running |
| F05-06 | ID/PID/port/startedAt |
| F05-07 | Open App 实际打开 |
| F05-08 | servlet HTTP 200 |
| F05-09 | JSP HTTP 200 |
| F05-10 | 修改 JSP 保存 |
| F05-11 | 重新部署 |
| F05-12 | 浏览器页面更新 |
| F05-13 | Restart 后 ID 不变 |
| F05-14 | Restart 后 PID 变 |
| F05-15 | Logs 显示历史 |
| F05-16 | Logs live tail |
| F05-17 | Clear 按钮 |
| F05-18 | 错误/警告分类 |
| F05-19 | Stop 状态 |
| F05-20 | 端口释放 |
| F05-21 | 进程树回收 |
| F05-22 | 再次 Start 成功 |
| F05-23 | Tomcat 端口占用错误 |
| F05-24 | 缺 Java 错误 |
| F05-25 | 缺 Tomcat 错误 |
| F05-26 | 启动超时错误 |

### 4.6 WEB-FLOW-06 断线、刷新、并发

| ID | Case |
|---|---|
| F06-01 | 终止 Runtime |
| F06-02 | 状态栏 disconnected |
| F06-03 | 各视图 disconnected |
| F06-04 | 点击按钮错误出现一次 |
| F06-05 | 重启 Runtime |
| F06-06 | 自动重连 |
| F06-07 | snapshot 恢复 |
| F06-08 | WS 不重复订阅 |
| F06-09 | build 中刷新页面 |
| F06-10 | 重新加载后状态一致 |
| F06-11 | 两标签打开同 workspace |
| F06-12 | 事件广播 |
| F06-13 | 并发操作 |
| F06-14 | 关闭行为 |

---

## 5. API — 接口测试 (~60 case)

按 protocol/index.ts 的 EndpointMap 30+ endpoint:

### 5.1 Workspaces
| ID | Case |
|---|---|
| API-W-01 | GET /api/v1/workspaces |
| API-W-02 | POST /api/v1/workspaces (rootPath) |
| API-W-03 | POST /api/v1/workspaces (name) |
| API-W-04 | POST /api/v1/workspaces (path 不存在) |
| API-W-05 | DELETE /api/v1/workspaces/{id} |
| API-W-06 | POST /api/v1/workspaces/{id}/scan (deep=true) |
| API-W-07 | POST /api/v1/workspaces/{id}/scan (deep=false) |
| API-W-08 | POST /api/v1/workspaces/{id}/java/prepare |
| API-W-09 | GET /api/v1/workspaces/{id}/java/launch-descriptor |

### 5.2 Projects
| ID | Case |
|---|---|
| API-P-01 | GET /api/v1/projects |
| API-P-02 | GET /api/v1/projects/{id} |
| API-P-03 | GET /api/v1/projects/{id} (不存在 → 404) |
| API-P-04 | PUT /api/v1/projects/{id} |

### 5.3 Builds
| ID | Case |
|---|---|
| API-B-01 | GET /api/v1/builds |
| API-B-02 | POST /api/v1/builds |
| API-B-03 | POST /api/v1/builds (clean=true) |
| API-B-04 | POST /api/v1/builds (intent=selected-files) |
| API-B-05 | GET /api/v1/builds/{id} |
| API-B-06 | GET /api/v1/builds/{id} (不存在) |
| API-B-07 | DELETE /api/v1/builds/{id} |

### 5.4 Deployments
| ID | Case |
|---|---|
| API-D-01 | GET /api/v1/deployments |
| API-D-02 | POST /api/v1/deployments (all) |
| API-D-03 | POST /api/v1/deployments (classes) |
| API-D-04 | POST /api/v1/deployments (webapp) |
| API-D-05 | GET /api/v1/deployments/{id} |

### 5.5 Servers
| ID | Case |
|---|---|
| API-S-01 | GET /api/v1/servers |
| API-S-02 | POST /api/v1/servers |
| API-S-03 | GET /api/v1/servers/{id} |
| API-S-04 | POST /api/v1/servers/{id}/restart |
| API-S-05 | POST /api/v1/servers/{id}/debug |
| API-S-06 | DELETE /api/v1/servers/{id} |
| API-S-07 | DELETE /api/v1/servers/{id} (force=true) |
| API-S-08 | GET /api/v1/servers/{id}/logs (follow=false) |
| API-S-09 | GET /api/v1/servers/{id}/logs (follow=true) |

### 5.6 Search
| ID | Case |
|---|---|
| API-SR-01 | POST /api/v1/search (query) |
| API-SR-02 | POST /api/v1/search (regex) |
| API-SR-03 | POST /api/v1/search (case sensitive) |
| API-SR-04 | POST /api/v1/search (whole word) |
| API-SR-05 | POST /api/v1/search (maxResults) |
| API-SR-06 | POST /api/v1/search (10k 文件 perf) |

### 5.7 Toolchains
| ID | Case |
|---|---|
| API-T-01 | GET /api/v1/toolchains |
| API-T-02 | POST /api/v1/toolchains/import |

### 5.8 JDT LS
| ID | Case |
|---|---|
| API-J-01 | GET /api/v1/jdtls (状态) |
| API-J-02 | POST /api/v1/jdtls (触发安装) |
| API-J-03 | GET /api/v1/jdtls/distribution |
| API-J-04 | GET /api/v1/projects/{id}/launch-descriptor |
| API-J-05 | POST /api/v1/jdtls/project |

### 5.9 Encoding
| ID | Case |
|---|---|
| API-E-01 | POST /api/v1/encoding/detect |
| API-E-02 | POST /api/v1/encoding/detect (GBK fixture) |
| API-E-03 | POST /api/v1/encoding/recode (GBK→UTF-8) |
| API-E-04 | POST /api/v1/encoding/recode (UTF-8→GBK) |
| API-E-05 | POST /api/v1/encoding/validate (合法字符) |
| API-E-06 | POST /api/v1/encoding/validate (非法字符) |

### 5.10 Health
| ID | Case |
|---|---|
| API-H-01 | GET /api/v1/health (ok, version) |

---

## 6. COMPAT/PERF/SEC/STAB (~60 case)

### 6.1 兼容性

| ID | Case |
|---|---|
| CP-01 | Chromium 主链 |
| CP-02 | WebKit/Safari 主链 |
| CP-03 | 文件名含空格 |
| CP-04 | 文件名含中文 |
| CP-05 | 文件名含 # & () |
| CP-06 | 长路径 |
| CP-07 | 无 URL/path 双重编码 |
| CP-08 | macOS 权限拒绝 |
| CP-09 | 只读文件 |
| CP-10 | 无执行权限 |
| CP-11 | 端口占用 |
| CP-12 | macOS Cmd 快捷键 |
| CP-13 | 不显示 Windows Ctrl 文案 |

### 6.2 性能 (median/p95 至少 5 次)

| ID | Case | Gate |
|---|---|---|
| PF-01 | 冷启动到 shell 可交互 | ≤ 8s |
| PF-02 | 打开 1000 行 Java (不含 JDT 下载) | ≤ 1s |
| PF-03 | 1000 日志单次主线程长任务 | ≤ 100ms |
| PF-04 | Runtime 断开重连 + snapshot | ≤ 3s |
| PF-05 | 10k 文件搜索首个结果 | ≤ 3s |
| PF-06 | 10k 文件搜索 p95 | ≤ 5s |
| PF-07 | 空闲 30 分钟无 CPU 异常 | ✓ |
| PF-08 | WebSocket 30 分钟无线性增长 | ✓ |
| PF-09 | Browser/Theia/Runtime/JDT/Tomcat CPU/RSS 记录 | ✓ |
| PF-10 | 与基线对比 ±15% 警告 | ✓ |

### 6.3 安全

| ID | Case |
|---|---|
| SEC-01 | Runtime 非 loopback 绑定 fail closed |
| SEC-02 | secret 缺失/错误不访问受保护 API |
| SEC-03 | URL/console/DOM/localStorage 无 secret 泄漏 |
| SEC-04 | workspace sandbox 拒绝 `..` |
| SEC-05 | symlink escape 拒绝 |
| SEC-06 | workspace 外路径拒绝 |
| SEC-07 | `<script>` 按文本显示 (Deployment/Logs) |
| SEC-08 | Open App 使用 noopener |
| SEC-09 | 外链无 opener |
| SEC-10 | 20 次启停无孤儿进程 |

### 6.4 稳定性

| ID | Case |
|---|---|
| ST-01 | 20 次连续运行无崩溃 |
| ST-02 | 进程清理验证 (Runtime/JDT/Tomcat/Theia) |
| ST-03 | 端口可回收 |
| ST-04 | 旧进程清理 |

---

## 7. 修复与回归

每发现一个缺陷:
- 创建 `defects.jsonl` 记录 (ID/TESTED_COMMIT/级别/前置/复现/期望/实际/证据/根因/修复/回归/状态)
- 写最小复现测试
- 修复并提交
- 跑 Wave 回归
- 跑全量 Gate

---

## 8. 报告与 Gate

最终 `MAC_WEB_GATE=PASS` 必须:
- [ ] 两台机器测试同 SHA
- [ ] build/test/lint 全绿
- [ ] UI inventory 100% 覆盖
- [ ] Chromium 全量 + WebKit 主链通过
- [ ] 所有页面有截图
- [ ] WCAG AA + 键盘 + 200% zoom 通过
- [ ] 导入→编辑→编码→构建→部署→启动→停止主链通过
- [ ] 所有状态 (成功/失败/loading/empty/disabled/disconnected/reconnect) 通过
- [ ] GBK 不可表示字符不破坏原文件
- [ ] 性能/安全/30min/20 进程通过
- [ ] P0/P1/P2/P3 全修
- [ ] 无 FAIL/BLOCKED/SKIP/gated
- [ ] 报告可由另一 Agent 复现
