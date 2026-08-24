# Kairo IDE 真实项目 · 真实点击 · 全量覆盖测试文档

**版本**: v2.0（取代 v1.0 浏览器版计划的"真实性"升级版）
**创建日期**: 2026-08-23
**适用对象**: Kairo IDE 桌面版（Electron）与浏览器版（Theia headless）双形态
**核心原则**: 真实的项目数据 + 真实的鼠标/键盘点击 + 覆盖到每一个可交互项
**前置教训**: 本计划针对 N-047（假 UI 测试实为 API 直调）与 N-048（GATED 放行）设计硬性防线

---

## 一、被测项目分析（真实基线）

### 1.1 产品定位

Kairo IDE 是面向 **JDK 1.6 / Tomcat 6 / GBK 编码遗留 Java Web 项目** 的桌面 IDE：

| 层 | 技术 | 说明 |
|---|---|---|
| 壳 | Electron（`apps/desktop`） | 主进程注入 `window.kairoIPC`：菜单动作、切换 JDK、DevTools |
| 前端 | Eclipse Theia 1.73.1（`packages/theia-product` + 各扩展包） | 所有业务 UI 都是 Kairo 自研 widget |
| 后端 | Go Runtime Agent（`runtime-agent`），默认端口 18080 | 约 45 个 `/api/v1/*` endpoint + WebSocket `/api/v1/events` |
| 工具链 | JDT LS、Tomcat 6.0.53、Ant/javac、JUnit、Maven | 由 Agent 托管进程 |

### 1.2 前端可点击面（本计划的测试对象全集）

来源：`packages/theia-product/src/main/browser/kairo-views-contribution.tsx`

| 类别 | 数量 | 清单位置 |
|---|---|---|
| 注册命令（KairoCommands） | **49** | kairo-views-contribution.tsx:89-139 |
| Kairo 主菜单项（含子菜单） | **40** | registerMenus():1340-1554 |
| File/Help 追加菜单项 | 4 | :1559-1583 |
| 视图/面板（factory ID） | **35+** | kairo-factory-ids.ts |
| React widget 内 `data-testid` | **286 个唯一值** | 各 *-widget.tsx |
| 状态栏可点条目 | 7 组 | kairo-status-bar-contribution.ts:116-589 |
| IDEA 快捷键绑定 | Ctrl+F10/Ctrl+F2/Ctrl+F5/Alt+F8 等 | registerKeybindings():1586-1633 |

### 1.3 关键 UI 面板 → data-testid 映射（节选，全量见附录 A）

| 面板 | 主要 testid |
|---|---|
| Welcome（kairo-welcome） | welcome-quickstart, quickstart-{import,config,run}, quickstart-*-action, welcome-recent, recent-{id}, welcome-recent-empty/loading, welcome-tips, welcome-error |
| 导入向导（kairo-import-wizard） | wizard-title, step-1..3, step-content-1..3, path-input, browse-btn, scan-btn, scan-error, select-source-version/target-version/encoding/build-tool, input-context-path/build-script/source-dirs/lib-dirs/web-root/output-dir/jdk-version/project-name, toggle-advanced, import-project-btn, import-ready, import-error, detection-warnings |
| 项目选择器（kairo-project-selector） | project-selector, project-list, open-project-btn, back-to-select, project-selector-error/loading |
| Servers（kairo-server-view） | server-view, server-view-toolbar, server-start/stop/restart/debug/open-button, server-list, server-info-list, server-info-{id,pid,port,debug-port,start-time}, server-state, server-empty/disconnected/loading, server-url-link |
| Builds（kairo-build-view） | build-view, build-button, clean-build-button, cancel-build-button, build-list/history/summary/diagnostics/state, build-empty/loading/disconnected |
| Deployments（kairo-deployments） | deployments-view, deployments-deploy-button, deployments-refresh-button, deployments-state, deployment-{id}, deployments-empty/error/loading |
| Tomcat Logs（kairo-log-viewer） | log-viewer, log-empty |
| Maven（maven-view） | maven-view, maven-detect-btn/button, maven-path-input, maven-tabs, maven-overview/info-table/module-tree/dep-tree/goals/lifecycle/tasks, maven-refresh-deps/deps-button, maven-progress-bar/output/error/empty/not-found/conflicts |
| 搜索中心（search-center） | search-center-modal, search-everywhere/query/result, find-file/class/symbol/action(+ -query/-result/-backdrop), search-form/submit/cancel/count/idle/loading/empty/error/cancelled, filter-word/case/regex/file-types/exclude, everywhere-query/item/open-error, replace-text, find-tool-{count,group,result,idle,empty,cancel} |
| Git（5 个 widget） | git-changes-view/header/toolbar, git-commit-form/message/button/options/result/empty, git-staged/unstaged-section, git-diff-view/file/content/loading/error/empty, git-history-view/searchbar/detail/no-results, git-stash-view/push-section/list-section/show-section, git-branch, git-amend-checkbox/warning, git-signoff-checkbox, git-noverify-checkbox, git-skip-checks-commit, git-precommit-* , git-suggestions, git-template-select |
| SVN | svn-changes-view/header/toolbar, svn-diff-editor/status, svn-history-view, svn-branch, svn-error |
| 测试（kairo-test-tree / output） | test-tree, test-run-selector, run-all-tests, discover-tests, cancel-tests, test-results-list, test-run-detail/header/state/summary, test-passed/failed/skipped/error-count, test-count, cancel-test-error, test-output-view/toolbar/raw-output/empty, test-disconnected/loading/empty/error |
| 性能仪表盘 | perf-run-benchmark, perf-clear-history |
| 远程 | remote-panel-widget / remote-connection-widget（文本选择器兜底） |
| SQL 控制台 / TODO / Problems / Keymap / Bookmarks / 通知中心 / 快捷键速查 | 无 testid，按 **可见文案 + role** 定位（见各用例） |
| 调试全家桶 | debug-tool-window-widget 及 variables/callstack/breakpoints/watch/console/hover/diagnostics widget（文本选择器兜底）；IDEA 式 toolbar-idea/frames-idea |

### 1.4 后端支撑面（仅用于"事后断言"，禁止用于"驱动操作"）

`runtime-agent/internal/api/server.go:526-615` 共约 45 个 endpoint：
health/endpoints/workspaces/projects(detect/import/recent)/toolchains/builds(build/custom/ant-classpath)/deployments/servers(start/stop/restart/reload/logs/recoverable)/search(files/stream)/encoding(detect/recode/validate)/jdtls(distribution/project)/run-configurations(launch)/maven(detect/dependencies/run)/sql(execute/test-connection)/debug(adapter/status,jdk/download)/java(run,detect)/jvm(compile,redefine)/events/auth/audit。

### 1.5 已知风险回归点（必须转化为用例）

| ID | 风险 | 回归用例 |
|---|---|---|
| N-027/N-028 | 导入向导 Save 不落盘、失败也 reload 假装成功 | TC-B03/B04/B05 |
| N-029/N-032 | 新旧两套 widget 并存；Store 无快照接线 | TC-F01/F08 |
| N-030 | Restart 实为 Stop 循环 | TC-E05 |
| N-031 | 断线伪装成空列表 | TC-I01/I02 |
| N-033 | 日志视图假数据 | TC-F06 |
| N-034 | 三份主题源 | TC-H12 |
| N-011 | encoding API sandbox 未授权即 500 | TC-H07 |
| N-036~N-040 | Java 智能可能不可用 | SHARD-D 全组（先探测再判定） |
| N-047/N-048 | 假 UI 测试/GATED 放行 | 第二章铁律 R3/R4 |

---

## 二、真实性铁律（本计划的强制约束）

> 违反任意一条，该轮结果整体作废。

### R1 真实的项目
- 被测项目必须是仓库内真实的遗留工程 **`legacy-sample/`**（含 `.kairo/project.yaml`、`src/main/java/com/example/**`、`WebRoot/hello.jsp`、GBK 的 `messages.properties`、ant `build.xml`、lib jar），禁止使用临时拼凑的空目录。
- 构建/部署/运行必须走真实工具链：JDK 1.6（javac）、Tomcat 6.0.53、Ant；部署后必须能用外部浏览器访问 `http://127.0.0.1:{port}/…` 得到 HTTP 200 且页面内容正确。
- 另需准备一份 **GBK 编码副本**（把 `messages.properties` 与一个 jsp 用 GBK 重存）用于编码类用例。

### R2 真实的点击
- 每个操作步骤必须通过 **UI 事件** 完成：Playwright 的 `click()/fill()/press()` 或真人操作；优先 `data-testid` 选择器，无 testid 的用「角色 + 可见文案」（如 `role=menuitem[name="Kairo: Build"]`）。
- **禁止** 在用例主体中调用 `fetch/request('POST /api/v1/...')`、`executeCommand`、`page.evaluate` 直改状态来代替点击。
- API 仅允许出现在 **断言区**（验证 UI 操作后的后端事实，如磁盘文件、HTTP 200、进程存在）。
- 同一命令至少从两种入口触发过一次：菜单 / 命令面板 / 工具栏按钮 / 快捷键（矩阵标注入口覆盖）。

### R3 结果只分 PASS / FAIL，无 GATED
- 任何一步观察不到预期现象 = FAIL，不允许"跳过但算通过"。
- 环境性阻塞（如无 JDK6）必须在开跑前自检失败并终止整轮，不得边测边降级。

### R4 证据链
每个用例必须留档到 `test-results/evidence/{SHARD}/{CASE-ID}/`：
1. 每个关键步骤前后截图（UI 状态变化对比）；
2. Playwright trace（自动化执行时）或录屏（手工执行时）；
3. 浏览器/Electron DevTools console 全程捕获（有未捕获异常即 FAIL，见 shard-14 先例）；
4. 断言区的 API/磁盘事实输出（curl 结果、文件 hash、进程列表）。

### R5 每项必答
第七章覆盖矩阵中每一行都必须能回答："由哪个用例的哪几步覆盖？PASS 还是 FAIL？"——出现空白行视为测试未完成。

---

## 三、环境与真实数据准备

### 3.1 软硬件

| 项 | 要求 | 来源 |
|---|---|---|
| OS | Windows 10+（主）/ macOS（兼容轮次） | — |
| Node ≥ 20.10 / pnpm 9.15.9 / Go 1.21+ | 构建与启动 | package.json |
| JDK 21+ | 宿主 + JDT LS | scripts/jdk-check |
| JDK 1.6.0_45 | 被测项目编译/运行 | KAIRO_JDK6_HOME |
| Apache Ant 1.9.x | legacy-sample build.xml | PATH |
| Tomcat 6.0.53 | 解压版，CATALINA_HOME 由 Agent 管理 | bundled/ 或 KAIRO_TOMCAT6_HOME |
| Playwright chromium | 自动化点击 | tests/e2e |

### 3.2 被测项目数据

```powershell
# 1) 主项目：直接使用仓库自带 legacy-sample（勿改动其 .kairo/project.yaml）
# 2) GBK 副本：复制 legacy-sample → %TEMP%\legacy-sample-gbk，
#    将 src\main\resources\messages.properties 与 WebRoot\utf8.jsp 以 GBK 重新保存，
#    并在导入向导中显式选择 GBK。
```

### 3.3 启动顺序与自检（顺序错误=环境 FAIL）

```
① pnpm agent:run            # Runtime Agent :18080
② pnpm dev:browser          # Theia :3000 （桌面形态则直接启动打包产物 Kairo.exe）
③ 自检：
   GET http://127.0.0.1:18080/api/v1/health → {"ok":true}   （仅自检允许 curl）
   打开 http://localhost:3000 → 状态栏 Agent 显示 connected
```

### 3.4 端口表

| 端口 | 用途 |
|---|---|
| 18080 | Runtime Agent HTTP/WS |
| 3000 | Theia backend（浏览器形态）|
| 8080+ | Tomcat http（Agent 动态分配，读 server-info-port）|
| 8000+ | Tomcat jdwp（读 server-info-debug-port）|

---

## 四、测试分片总览

| 分片 | 域 | 用例数 | 依赖 |
|---|---|---|---|
| SHARD-A | 启动 / Shell / Welcome / 菜单遍历 / 命令面板 / 状态栏 | 10 | 环境 |
| SHARD-B | 项目导入向导（全字段落盘）/ 选择器 / 扫描 | 8 | A |
| SHARD-C | 文件树 / 编辑器 / 多标签 / 保存 / 查找跳转 | 10 | B |
| SHARD-D | Java 语言服务（JDT LS 补全/跳转/重构/诊断） | 8 | C |
| SHARD-E | 构建（普通/清理/自定义/Ant/Maven 视图） | 9 | C |
| SHARD-F | 部署 / 服务器生命周期 / 日志 / 热部署闭环 | 11 | E |
| SHARD-G | 调试全家桶（断点→单步→变量→Watch→HotSwap→诊断） | 14 | F |
| SHARD-H | 搜索中心 / Git / SVN / 编码 / TODO / 测试 / SQL / 远程 / 性能 / 键位 / 主题 / 无障碍 | 16 | C |
| SHARD-I | 异常路径与已知缺陷回归（断线/时序/i18n） | 8 | 相关分片 |

共 **94** 个用例；全部通过第七章矩阵反查保证"每一项"至少一条用例覆盖。

---

## 五、详细测试用例

> 步骤中的 `[tid:x]` 表示 `data-testid=x`；`[txt:"…"]` 表示按可见文案定位；`[key:…]` 表示按键。所有用例默认开启 console 监听。

### SHARD-A 启动与 Shell

**TC-A01 首次启动（冷启动，无最近项目）**
| # | 点击/操作 | 预期（可观察） |
|---|---|---|
| 1 | 打开 IDE | Shell 加载完成，无白屏；console 无 Uncaught Error |
| 2 | 观察 main 区域 | `[tid:welcome-recent]` 存在；无项目时显示 `[tid:welcome-recent-empty]` |
| 3 | 观察 toast | 出现"首次导入"引导提示（≤5s 自动消失） |
| 4 | 截图存证 | evidence/A01/* |

**TC-A02 Welcome 快速入口逐一点击**
1. 点 `[tid:quickstart-import-action]` → 打开导入向导（`[tid:wizard-title]` 可见）→ Esc/关闭返回 Welcome；
2. 点 `[tid:quickstart-config-action]` → 打开项目选择器 `[tid:project-selector]`；
3. 点 `[tid:quickstart-run-action]` → 出现构建/运行相关反馈（toast 或 Build 视图打开）；
4. 每步截图对比。

**TC-A03 主布局与活动栏**
依次点击活动栏 Explorer/Search/Source Control/Debug 图标 → 侧边栏对应面板切换且高亮正确；Ctrl+B 收起/展开侧边栏两次。

**TC-A44→TC-A04 菜单栏全遍历（40 项 Kairo 菜单逐一 hover 展开 + 截图）**
1. 顶层 `Kairo` 菜单可见，含 4 个直接项（Import Project / Select Project / Scan Project / Manage Run Configurations）与 4 个子菜单（构建与运行 / 视图 / 调试 / 窗口）；
2. 展开每个子菜单截图，核对条目数：构建与运行=13、视图=10、调试=9、窗口=4（对照 §7.2 矩阵 M2）;
3. `File > Import Project`、`Help > Welcome / Toggle Developer Tools / Debug Diagnostics` 各存在。

**TC-A05 命令面板可达性**
F1 → 输入 `Kairo:` → 列表应包含 §7.1 中全部 49 条命令标签；↑↓ 可选、Enter 执行第一条（执行目标选无副作用的 `Kairo: Show Servers`）、Esc 关闭。

**TC-A06 状态栏七组条目**
逐一点击：Project（→选择器）、Java/JDK（→切 JDK）、Encoding（→重开编码对话框）、Builds（→Builds 视图）、Servers（→Servers 视图）、Agent（→重连）、Debug（→调试视图）。每次点击后面板/toast 反馈正确。

**TC-A07 终端**
`[menu 窗口>Toggle Terminal]` 与 `` Ctrl+` `` 各一次 → 底部终端出现，输入 `echo kairo` 回显；新建/切换/关闭终端标签。

**TC-A08 视图开合幂等性**
连续两次执行同一视图命令（如 `Kairo: Show Servers` ×2）→ 不产生重复 tab，焦点落在已存在实例（对应 revealOrCreate 幂等逻辑）。

**TC-A09 桌面专属（仅 Electron 形态）**
原生菜单点击 Import Project → IPC → 向导打开；Help>Toggle Developer Tools 能开/关 DevTools 窗口。

**TC-A10 焦点管理（D4.1）**
任一视图命令执行后，Tab 键第一停点在该面板第一个可聚焦控件上（focusFirstFocusable 行为）。

### SHARD-B 项目导入向导（真实落盘验证）

**TC-B01 向导三步结构**
`Kairo: Import Project` → `[tid:step-1][step-2][step-3]` 步骤指示器可见；初始在 step-content-1。

**TC-B02 扫描 legacy-sample**
[path-input] 填入 `G:\spaces\kairo-ide\legacy-sample` → 点 `[tid:scan-btn]` → `[tid:detection-warnings]`/识别结果显示：发现 WebRoot、src、lib、build.xml、编码线索；无 `[tid:scan-error]`。

**TC-B03 全字段落盘（核心，防 N-027 复发）**
1. 高级开关 `[tid:toggle-advanced]` 展开；
2. 逐字段填入非默认值：source level=`1.6`、target=`1.6`、encoding=`GBK`、build tool=`ant`、context-path=`/legacy-sample`、output dir=`build/classes`、web root=`WebRoot`、lib dirs=`WebRoot\WEB-INF\lib`；
3. 点 `[tid:import-project-btn]` → 出现 `[tid:import-ready]`，无 `[tid:import-error]`；
4. **断言（API/磁盘事实）**：读取 `<project>\.kairo\project.yaml`，八个字段与输入一致；状态栏 Project 显示项目名；Explorer 树出现。
5. 任一字段不一致 = FAIL（N-027 回归）。

**TC-B04 失败路径不假装成功（防 N-028）**
path-input 填不存在目录 → Import → 必须显示 `[tid:import-error]` 或消息框；页面不得自动 reload；关闭向导后 Welcome 仍无新项目记录。

**TC-B05 取消/重复导入保护**
对已导入项目再次走完向导 → 有明确提示（已存在/重新导入确认），不产生双份 `.kairo` 目录（断言磁盘仅一份）。

**TC-B06 项目选择器**
`Kairo: Select Project` → `[tid:project-list]` 列出 recent 项目；选中一行 → `[tid:open-project-btn]` 可用 → 点击 → 状态栏/Explorer 切换；`[tid:back-to-select]` 返回列表正常。

**TC-B07 最近项目持久化**
重启 IDE → Welcome `[tid:welcome-recent]` 列出上轮项目；点击 `recent-{id}` 直接激活该项目（状态栏同步）。

**TC-B08 Scan Project 命令**
无工作区时执行 `Kairo: Scan Project` → 警告 toast"请先打开工作区"；有项目时执行 → 成功 toast 含根路径。

### SHARD-C 编辑器与文件管理

**TC-C01 Explorer 树完整性**
展开 legacy-sample 全部层级：src/main/java/com/example/{HelloWorld, legacy/HelloServlet, legacy/I18nServlet}.java、WebRoot/{hello.jsp, utf8.jsp, WEB-INF/web.xml, lib/*.jar}、lib/*.jar、build.xml —— 与磁盘一致。

**TC-C02 新建/重命名/删除（右键上下文菜单）**
src 下 New File `Tmp.java` → 输入内容保存 → Rename 为 `TmpRenamed.java` → Delete 确认；每步断言磁盘变化。

**TC-C03 多标签编辑**
依序打开 HelloWorld.java / hello.jsp / web.xml → 3 个 tab；点 tab 切换内容正确；拖拽换序；× 关闭；右键 Close All。

**TC-C04 编辑与脏标记**
HelloWorld.java 末尾加 `// click-test` → tab 出现脏点 → Ctrl+S → 脏点消失 → **断言磁盘文件包含该注释** → 刷新页面重开仍在。

**TC-C05 Ctrl+P 快速打开**
输入 HelloServlet → Enter → 对应文件打开；输入 utf8.jsp → 打开 JSP。

**TC-C06 Ctrl+G 转到行**
web.xml 第 20 行跳转，状态栏行列号一致。

**TC-C07 大文件策略**
打开 >阈值的大文件（可用 log 文件模拟）→ 只读提示/降载策略生效（large-file-policy）。

**TC-C08 Local History**
修改并保存两次 → 右键文件 → Open Timeline/Local History → 两个历史版本可见 → 还原上一版 → **断言磁盘内容回退**。

**TC-C09 书签**
右键行 → Add Bookmark → `[bookmarks 视图]` 出现条目；点击条目跳转；删除书签。

**TC-C10 通知中心**
制造一条警告（如断开 agent 一瞬）→ 通知铃铛计数 +1 → 展开列表、清除单条/全部。

### SHARD-D Java 语言服务（先探测，后判定）

**TC-D00 前置探测**
状态栏 JDT LS 从 starting → ready（≤120s）。若 5 分钟仍非 ready：SHARD-D 整体记 **FAIL（环境阻断）**，不得跳过——这本身就是 N-036~N-040 的判据。

**TC-D01 语法高亮**：HelloServlet.java 关键字/字符串/注释/数字着色区分（截图比对）。

**TC-D02 补全**：`System.out.` 触发补全含 println；Ctrl+Space 强制触发；Enter 插入。

**TC-D03 转到定义**：光标于 `HttpServlet` 按 F12 → 跳转到 class 反编/源码视图；Alt+F12 Peek 内联。

**TC-D04 查找引用**：`HelloServlet` Shift+F12 → 引用列表含 web.xml/自身；点击引用跳转正确。

**TC-D05 重命名重构**：局部变量 F2 改名 → 同文件所有引用更新且编译仍绿。

**TC-D06 Hover**：悬停 `HttpServletResponse` → 显示签名/文档。

**TC-D07 诊断闭环**：故意写入 `INVALID;` → 红线 + Problems 面板条目 → 点击条目跳转 → 删除后红线消失、Problems 清零（problems-widget）。

**TC-D08 类型层级**：右键类名 → Type Hierarchy（java-hierarchy-widget）→ 树中显示 HttpServlet 父链。

### SHARD-E 构建

**TC-E01 Build 按钮（Builds 视图）**
打开 Builds 视图 → 点 `[tid:build-button]` → `[tid:build-loading]` → 终态 `[tid:build-state]=success`；toast 显示 success；`[tid:build-history]` 新增一行。
**断言**：`GET /api/v1/builds` 最新一条 state=success（断言区允许）。

**TC-E02 Clean Build 按钮 ≠ Build（KAIRO-RC-WEB-007 回归）**
先构建一次 → 点 `[tid:clean-build-button]` → **断言请求体 clean=true 的证据**：build 详情 summary 显示 clean，或输出目录重建时间戳刷新（磁盘 atime/mtime 断言）。

**TC-E03 构建失败诊断联动**
人为在 HelloWorld.java 制造语法错误 → Build → 终态 failed → `[tid:build-diagnostics]` 列出 file:line → 点击诊断项 → 编辑器跳到该行 → toast 显示 `failedAt` 信息。

**TC-E04 Cancel Build**
大项目构建进行中点 `[tid:cancel-build-button]` → 状态 cancelled；无僵尸 javac 进程（任务管理器断言）。

**TC-E05 Restart 是真重启（N-030 回归）**
Start Server → 记录 pid₁ → `Kairo: Restart Server` → toast 显示新 pid₂ ≠ pid₁；**断言**：`GET /api/v1/servers` 该实例 pid 更新且 state=running（若实现为 Stop 序列导致最终 stopped = FAIL）。

**TC-E06 自定义构建**
custom-build 区域：`[tid:custom-build-input]` 填 ant target `-Dx=1 compile` → `[tid:custom-build-run]` → `[tid:custom-build-output]` 流式输出 → `[tid:custom-build-result]` 终态；`[tid:custom-build-cancel]` 生效。

**TC-E07 Maven 视图检测**
`Kairo: Show Maven` → `[tid:maven-path-input]` 填一个含 pom.xml 的样例（testdata 提供）→ `[tid:maven-detect-btn]` → `[tid:maven-project-info]` 显示坐标；tabs 切 Overview/Modules/Dependencies/Tasks 正常渲染。

**TC-E08 Maven 依赖树与冲突**
`[tid:maven-deps-button]` → `[tid:maven-dep-tree]` 渲染；构造冲突样例 → `[tid:maven-conflicts]` 列出 conflict-item；`[tid:maven-refresh-deps]` 进度条走完。

**TC-E09 Ant classpath 分析入口**
Maven/Ant 相关按钮触发 analyze → 结果表格非空（对应 /api/v1/ant/classpath/analyze 的 UI 入口）。

### SHARD-F 部署 / 服务器 / 日志 / 热部署

**TC-F01 Store 时序双验证（N-032 回归）**
顺序甲：先 Start Server，再第一次打开 Servers 视图 → 列表立即有数据（bootstrap 快照）；顺序乙：先打开空的 Builds 视图，再触发一次 Build → 无需刷新视图自动出现新行（事件 reducer 接线）。

**TC-F02 Build & Deploy 一键**
Deployments 视图 `[tid:deployments-deploy-button]` → toast `buildState/deployState` → `[tid:deployments-state]` 图标变 check → 表格新增 `deployment-{id}` 行，Files/Bytes/Trigger(manual)/Reload 列有值。
**断言**：Tomcat webapps 目录出现应用产物（classes 位于 `WEB-INF/classes`，防 N-007 回归）。

**TC-F03 Publish（静态增量）**
修改 `hello.jsp` 保存 → `Kairo: Publish` → toast 显示 files≥1 → **断言** webapps 中该 jsp 内容已更新。

**TC-F04 Start Server（Run 模式）**
`[tid:server-start-button]` → `[tid:server-state]`=running，`[tid:server-info-pid/port/start-time]` 有值 → 点 `[tid:server-url-link]` 外部浏览器打开 `http://127.0.0.1:{port}/…` HTTP 200。

**TC-F05 Stop Server**
`[tid:server-stop-button]` → state=stopped → **断言**进程消失；对已停止服务器再点 Stop → 提示 no running server，不报错。

**TC-F06 日志是真日志（N-033 回归）**
服务器 running 时打开 Logs 视图 → 内容随请求滚动增长（连续截图 diff）；**反向**：agent 停止时不得凭空出现新行；`[tid:log-empty]` 空态正确。

**TC-F07 Open Application**
`Kairo: Open Application` → 新窗口打开当前 server URL；无运行服务器时 → warn toast `noRunningServerHttp`。

**TC-F08 Update Application（Ctrl+F10 热更新闭环）**
修改 Servlet 输出文本 → 保存 → `[key:ctrl+f10]` → hot-reload 徽章 synced → 刷新浏览器页面内容为新文本（无需重启 Tomcat）。

**TC-F09 Reload Context**
`Kairo: Reload Context` → Tomcat 日志出现 reload 痕迹 → 应用仍可访问。

**TC-F10 部署视图 Refresh / 错误横幅**
`[tid:deployments-refresh-button]` 重取列表；杀掉 agent 后 refresh → `[tid:deployments-error]` 横幅出现并可关闭（Close 按钮）。

**TC-F11 部署空态**
新 workspace 首次打开 Deployments → `[tid:deployments-empty]` 空态文案 + 无表格。

### SHARD-G 调试全家桶（14 例）

前置：TC-F04 通过；`Check Java Debug Adapter` 显示 available（否则整片 FAIL，不得 GATED）。

| 用例 | 步骤摘要 | 预期 |
|---|---|---|
| TC-G01 | `Kairo: Check Java Debug Adapter` | info toast "available"；否则记录 adapter 缺失为 FAIL |
| TC-G02 | Debug Server（菜单 b5） | Tomcat 以 debug 起（server-info-debug-port 有值），attach 成功 toast 含 sessionId |
| TC-G03 | attach 失败回滚 | 预置坏端口 → 命令报错且 Tomcat 被自动停止（无孤儿进程） |
| TC-G04 | 断点切换 | 编辑器行号沟点击设/删断点，Breakpoints 视图同步增删 |
| TC-G05 | 命中断点 | 浏览器请求触发 servlet → 编辑器暂停高亮行；状态进入 inDebugMode |
| TC-G06 | Step Over F8（toolbar-idea） | 高亮行前进一行，Variables 刷新 |
| TC-G07 | Step Into F7 / Step Out | 进入/跳出方法帧 |
| TC-G08 | Variables 树展开嵌套对象 | 子字段可见且值正确 |
| TC-G09 | Watch 添加表达式 `request.getMethod()` | 值 "GET"；删除 watch 生效 |
| TC-G10 | Evaluate Expression Alt+F8 | Console 输入 `1+1` 求值 = 2 |
| TC-G11 | Drop Frame | 帧回退重新执行；不支持时出现 warn toast（不崩溃） |
| TC-G12 | Mute Breakpoints | 全部断点旁路：带断点请求不再暂停；再点恢复 |
| TC-G13 | Inline Values 开关 | 暂停处行内显示变量值；二次点击隐藏 |
| TC-G14 | Rerun Ctrl+F5 / Stop Ctrl+F2 | 会话重启（新 sessionId）；Stop 后 server 停止、调试面板清空 |
| TC-G15 | Hot Swap History | 修改方法体内代码 → Ctrl+F10 → History 视图新增 swap 记录 |
| TC-G16 | Debug Diagnostics | Help>Debug Diagnostics 打开诊断页，各 section 数据非空 |

（注：TC-G15/G16 使本分片实际 16 条，编号沿用以便矩阵对齐。）

### SHARD-H 搜索 / 版本控制 / 编码 / 周边

**TC-H01 搜索中心模态**：快捷键唤起 `[tid:search-center-modal]` → 四个 tab（File/Class/Symbol/Action）各自输入关键字出 `[tid:*-result]`，点击结果完成跳转。

**TC-H02 全文搜索**：search-everywhere 输入 `doGet` → `[tid:search-count]` 计数正确；五个过滤器 word/case/regex/file-types/exclude 逐个开关并验证结果集变化；replace-text 替换预览；Cancel 出现 `[tid:search-cancelled]`。

**TC-H03 搜索流式与取消**：大范围搜索期间点 `[tid:search-cancel]` → 立即停止且界面标示取消态。

**TC-H04 Git Changes**：git init 的副本项目中改文件 → `[tid:git-changes-view]` staged/unstaged 分区正确；diff 视图显示差异。

**TC-H05 Git Commit**：message 输入 → commit → history 视图出现新提交；amend/signoff/noverify 复选框各自生效；空 message 时 commit 被阻止（git-commit-empty）。

**TC-H06 Git Stash**：stash push → 列表出现 → show 查看 → pop 恢复。

**TC-H07 编码检测/转换（N-011 回归）**：对 GBK 副本的 messages.properties 右键 Reopen with Encoding → 选 GBK 中文正常；Convert to UTF-8 → **断言磁盘字节变化**且中文不乱码；构造不可逆转换 → 出现拒绝对话框而非静默损坏。

**TC-H08 TODO/FIXME**：todo-view 打开 → 列出源码中 TODO 注释；点击跳转。

**TC-H09 Test Results**：test-tree 发现 JUnit 用例 → run-all-tests → passed/failed 计数正确（构造一红一绿两个用例）→ test-output raw 输出可见 → run selector 切换历史运行。

**TC-H10 SQL Console**：sql-console 打开 → 连接 SQLite/H2 样例库 → test connection 成功 → execute 查询表格渲染；错误 SQL 显示错误横幅。

**TC-H11 Remote 面板**：remote 视图打开 → 新建连接表单校验（非法 host 报错）；loopback 连接成功列出远端文件树（本地模式）。

**TC-H12 主题一致性（N-034 回归）**：Settings 切 Dark/Light → 状态栏/视图/对话框三处取样色一致，无"半黑半白"混排；CSS 变量实际生效（computed style 断言）。

**TC-H13 快捷键速查与 Keymap**：窗口>Keyboard Shortcuts 打开 keymap 视图 → 速查表（cheatsheet）渲染 → 修改一条绑定并生效（触发验证）。

**TC-H14 IDEA 键位集抽查**：Ctrl+F10 / Ctrl+F2 / Ctrl+F5 / Alt+F8 / Alt+5 按平台 keymap 生效（macOS 轮次验 Cmd 系）。

**TC-H15 性能仪表盘**：perf 视图 → perf-run-benchmark → 结果曲线/表格出现；clear-history 清空；cold-start 指标 ≤ 基线（testdata/perf-baseline.json 对照）。

**TC-H16 无障碍抽查**：axe-core 扫描 Welcome/导入向导/Servers 三个页面：无 critical violation；所有按钮有 aria-label；Tab 顺序合理（结合 D4.1）。

### SHARD-I 异常路径与缺陷回归

**TC-I01 断线不伪装（N-031 回归）**
杀掉 Agent 进程 → 状态栏 Agent 变红/断开 + warn toast（12s 超时消失）；Servers 视图显示 `[tid:server-disconnected]` 而非空白列表；Builds/Tests 同理（build-disconnected/test-disconnected）。

**TC-I02 重连**
`Kairo: Reconnect Agent`（Agent 已恢复）→ success toast；健康探针通过；事件流恢复（新建部署能实时出现在视图）。

**TC-I03 双真相排查（N-029）**
同一动作（如 Clean Build）分别从 旧入口与新视图触发 → 行为一致（同一 API payload），不存在一套真一套假。

**TC-I04 i18n 语言切换**
Settings 切换 中文↔English → 菜单、命令面板标签、视图标题、toast 全部跟随（refreshCommandLabels 生效）；截图双语对照。

**TC-I05 事件去重与陈旧 toast（KAIRO-RC-WEB-017）**
冷启动瞬间不得出现"Runtime: disconnected"残留 toast 与 connected 状态栏并存超过 12s。

**TC-I06 Welcome 自动关闭**
导入成功后 Welcome tab 自动关闭（onDidChangeProject 逻辑）；Help>Welcome 可手动再次打开。

**TC-I07 Windows 长路径/中文路径**
以含中文+空格目录复制项目并导入/构建/部署 → 全流程成功（javac argfile、catalina base 路径安全，防 N-003/N-016 复发）。

**TC-I08 并发操作**
Build 进行中点 Deploy、Server 启动中点 Stop → 有序排队或明确报错，无 UI 卡死、无双重进程。

---

## 六、执行方式

### 6.1 自动化（首选）

```bash
cd tests/e2e
npx playwright test --config regression-playwright.config.ts --workers=1 --grep "@SHARD-A"
```
- fixtures 复用：navigateToTheia / waitForTheiaShell / openCommandPalette / runCommandViaPalette / takeScreenshot（tests/e2e/fixtures.ts）。
- 新增 spec 按 `shard-XX-domain.spec.ts` 落在 `tests/e2e/regression/`，用例标题前缀 `CASE-ID`。
- trace + video + screenshot 全开（retain-on-failure 之外，本计划要求全量留存）。

### 6.2 手工（桌面形态 / 无法自动化的原生交互）

按本文档逐步勾选；每步截图命名 `{CASE-ID}-{STEP}-{desc}.png` 上传至 `test-results/evidence/`；使用 `tests/e2e-windows/auto-click-all-buttons.cjs` 作为"按钮普查器"辅助发现遗漏按钮（结果仅作线索，不作判定）。

### 6.3 轮次

| 轮次 | 形态 | 触发条件 |
|---|---|---|
| R1 | 浏览器版全量 94 例 | 每迭代末 |
| R2 | 桌面版全量（含 TC-A09/原生菜单） | 发版前 |
| R3 | macOS 兼容（Cmd 键位） | 平台变更时 |

---

## 七、全量覆盖矩阵

> 维护规则：每条用例完成后在对应行填写 `✅{CASE-ID}` 或 `❌{CASE-ID}(原因)`；出现空白行=测试未完成。

### M1 命令 × 入口（49 项）

| # | 命令 ID | 菜单入口 | 面板入口 | 快捷键 | 覆盖用例 |
|---|---|---|---|---|---|
| 1 | kairo.project.import | Kairo/File | Welcome CTA | — | TC-B01/B03 |
| 2 | kairo.project.select | Kairo | 状态栏 | — | TC-B06 |
| 3 | kairo.project.scan | Kairo | — | — | TC-B08 |
| 4 | kairo.build | 构建>1 | build-button | — | TC-E01 |
| 5 | kairo.cleanBuild | 构建>2 | clean-build-button | — | TC-E02 |
| 6 | kairo.buildAndDeploy | 构建>3 | deployments-deploy-button | — | TC-F02 |
| 7 | kairo.publish | 构建>4 | — | — | TC-F03 |
| 8 | kairo.server.start | 构建>7 | server-start-button | — | TC-F04 |
| 9 | kairo.server.debug | 构建>8 | server-debug-button | — | TC-G02 |
| 10 | kairo.debug.checkAdapter | 构建>13 | — | — | TC-G01 |
| 11 | kairo.debug.openView | 调试>1 | 状态栏 Debug | Alt+5 | TC-G04 |
| 12 | kairo.debug.openConsole | 调试>2 | — | — | TC-G10 |
| 13 | kairo.server.stop | 构建>10 | server-stop-button | Ctrl+F2* | TC-F05 |
| 14 | kairo.server.restart | 构建>11 | server-restart-button | — | TC-E05 |
| 15 | kairo.app.open | 构建>12 | server-open-button | — | TC-F07 |
| 16 | kairo.view.servers | 视图>1 | 状态栏 | — | TC-A08/F01 |
| 17 | kairo.view.builds | 视图>2 | 状态栏 | — | TC-E01 |
| 18 | kairo.view.deployments | 视图>3 | — | — | TC-F02 |
| 19 | kairo.view.logs | 视图>4 | — | — | TC-F06 |
| 20 | kairo.view.maven | 视图>5 | — | — | TC-E07 |
| 21 | kairo.view.todo | 视图>6 | — | — | TC-H08 |
| 22 | kairo.view.sqlConsole | 视图>8 | — | — | TC-H10 |
| 23 | kairo.view.tests | 视图>7 | — | — | TC-H09 |
| 24 | kairo.runConfigurations.manage | Kairo 直项 | — | — | TC-B06 附带（打开配置管理器，CRUD 一套配置并 launch） |
| 25 | kairo.jdk.switch | 窗口>3 | 状态栏 Java | — | TC-A06（Electron 原生 picker + 浏览器 fallback 两形态） |
| 26 | kairo.agent.reconnect | 窗口>4 | 状态栏 Agent | — | TC-I02 |
| 27 | kairo.keymap.open | 窗口>2 | — | — | TC-H13 |
| 28 | kairo.terminal.toggle | 窗口>1 | — | Ctrl+` | TC-A07 |
| 29 | kairo.view.remote | 视图>9 | — | — | TC-H11 |
| 30 | kairo.view.perf | 视图>10 | — | — | TC-H15 |
| 31 | kairo.debug.view.variables | 调试>3 | tool-window tab | — | TC-G08 |
| 32 | kairo.debug.view.callstack | 调试>4 | tool-window tab | — | TC-G07 |
| 33 | kairo.debug.view.breakpoints | 调试>5 | — | — | TC-G04 |
| 34 | kairo.debug.view.toolbar | 调试>8 | — | — | TC-G06 |
| 35 | kairo.debug.view.console | 调试>2' | — | — | TC-G10 |
| 36 | kairo.debug.view.watch | 调试>6 | tool-window tab | — | TC-G09 |
| 37 | kairo.java.hotswap.showHistory | 调试>6a | — | — | TC-G15 |
| 38 | kairo:open-debug-diagnostics | 调试>9 / Help | — | — | TC-G16 |
| 39 | kairo.debug.openToolWindow | — | — | — | TC-G06（底部 IDEA 式窗口） |
| 40 | kairo.debug.restart | — | toolbar-idea | Ctrl+F5 | TC-G14 |
| 41 | kairo.debug.dropFrame | — | callstack 右键 | — | TC-G11 |
| 42 | kairo.debug.toggleInlineValues | — | — | — | TC-G13 |
| 43 | kairo.debug.muteBreakpoints | — | breakpoints 面板 | — | TC-G12 |
| 44 | kairo.debug.evaluateExpression | — | — | Alt+F8 | TC-G10 |
| 45 | kairo.debug.console.focus | — | console | — | TC-G10 |
| 46 | kairo.server.update | 构建>5 | — | Ctrl+F10 | TC-F08 |
| 47 | kairo.server.reloadContext | 构建>6 | — | — | TC-F09 |
| 48 | kairo.welcome.show | Help>1 | — | — | TC-I06 |
| 49 | kairo.devtools.toggle | Help>2 | — | — | TC-A09 |

\* Ctrl+F2 绑定的是 workbench.action.debug.stop，与 STOP_SERVER 场景合并验证。

### M2 菜单项清单核对（44 项）

Kairo 顶菜单直项 4（a1-a4）＋ 构建与运行 13（b1-b9,b3a-b3c）＋ 视图 10（c1-c10）＋ 调试 9（d1-d8,d6a）＋ 窗口 4（e1-e4）＝ 40；File>Import 1；Help 3。全部条目在 TC-A04 截图核对，功能行为分散于 M1 对应用例。

### M3 视图 × 空态 / 加载 / 数据 / 断线 四态

每个视图（servers/builds/deployments/logs/maven/test/git×5/svn/search/todo/sql/perf/remote/welcome/import-wizard/selector/keymap/problems/bookmarks/run-configurations/debug×9/extensions）必须四态各截一张图：
- 空态：fresh workspace（TC-F11 等）
- 加载态：慢网/首帧（loading testid）
- 数据态：正常流程
- 断线态：TC-I01
矩阵执行表见 `test-results/evidence/COVERAGE-M3.xlsx`（由脚本 `scripts/gen-m3-matrix.cjs` 汇总生成）。

### M4 缺陷回归映射

N-003→TC-I07；N-007→TC-F02；N-011→TC-H07；N-016→TC-I07；N-027/028→TC-B03/B04；N-029→TC-I03；N-030→TC-E05；N-031→TC-I01；N-032→TC-F01；N-033→TC-F06；N-034→TC-H12；N-036~040→SHARD-D；N-047/048→第二章 R2/R3（流程性）。

---

## 八、判定标准与退出准则

### 8.1 单用例判定
- **PASS**：所有步骤按 R2 以真实点击完成 + 所有可观察预期满足 + 证据齐全。
- **FAIL**：任一预期不满足、console 出现未捕获异常、或证据缺失。
- 不存在第三种状态；阻塞型环境问题记 FAIL 并在报告标注 `BLOCKED-ENV`（不计入通过率分母的豁免需 QA 负责人书面批准）。

### 8.2 整轮退出准则（Release Gate）
1. P0 链路用例（A01,B03,E01,E02,F02,F04,F05,F08,G02,G05,I01）100% PASS；
2. 总通过率 ≥ 95%，FAIL 均有缺陷单号挂接；
3. M1/M2/M3/M4 矩阵无空白行；
4. 无未处理的 critical console error（对照 shard-14 基线）；
5. 性能：cold start ≤ baseline（testdata/perf-baseline.json）。

### 8.3 报告模板
`docs/testing/report-{date}.md`：分片通过率 / 缺陷列表（复用 N-xxx 编号续编 N-051+）/ 证据索引 / 矩阵终版。

---

## 附录 A：286 个 data-testid 全量清单（按域分组，供脚本生成选择器）

生成方式：`rg -o 'data-testid="([^"]+)"' packages --no-filename -r '$1' -g '*.tsx' | sort -u`

- **build**(18): build-view, build-view-header, build-view-toolbar, build-button, clean-build-button, cancel-build-button, cancel-build-error, build-state, build-summary, build-diagnostics, build-history, build-list, build-empty, build-loading, build-disconnected, custom-build-view/header/input/run/cancel/output/result/toolbar
- **deployments**(10): deployments-view(-header/-toolbar), deployments-deploy-button, deployments-refresh-button, deployments-state, deployments-empty, deployments-error, deployments-loading, deployment-{id}
- **server**(20): server-view(-header/-toolbar), server-start/stop/restart/debug/open-button, server-list(-section), server-info(-list), server-info-id/pid/port/debug-port/start-time, server-state, server-url(-link), server-empty/disconnected/loading, no-project
- **import-wizard**(25): wizard-title, step-1..3, step-content-1..3, path-input, path-row, browse-btn, scan-btn, scan-error, selected-path, input-{project-name,source-dirs,lib-dirs,web-root,output-dir,build-script,jdk-version,context-path}, select-{source-version,target-version,encoding,build-tool}, toggle-advanced, import-project-btn, import-ready, import-error, detection-warnings, ready-root, ready-encoding, ready-close-btn
- **selector/welcome**(14): project-selector(-error/-loading), project-list, open-project-btn, back-to-select, welcome-error, welcome-quickstart, welcome-recent(-empty/-loading), welcome-tips, quickstart-{import,config,run}(-action), recent-{id}
- **log**(2): log-viewer, log-empty
- **maven**(31): maven-view(-header/-toolbar), maven-detect-btn/button, maven-path-input, maven-tabs, maven-overview, maven-project-info, maven-info-table, maven-coords, maven-module-tree, maven-modules, maven-tree, maven-dep-tree, maven-dep-list, maven-dependencies, maven-deps-button, maven-conflicts, maven-conflict-item, maven-goals, maven-lifecycle, maven-phase-list, maven-tasks(-list), maven-refresh-deps, maven-progress-bar, maven-output(-text), maven-build-output/progress, maven-summary, maven-empty, maven-error, maven-not-found, maven-loading, maven-content, maven-warnings
- **search**(38): search-center-modal/backdrop, search-everywhere, search-form/submit/cancel/count/idle/loading/empty/error/cancelled/group/result(s), search-query, search-results-panel, everywhere-query/item/open-error, replace-text, find-file/class/symbol/action(+backdrop/query/result), find-tool-{count,group,result,idle,empty,cancel}, filter-{word,case,regex,file-types,exclude}
- **git**(48): git-changes-view/header/toolbar, git-staged-section, git-unstaged-section, git-commit-(form/message/button/options/result/empty/view/header), git-branch, git-diff-(view/file/content/loading/error/empty/header), git-history-(view/searchbar/detail/no-results/header/empty/loading), git-stash-(view/push-section/list-section/show-section/empty/error/header/loading), git-amend-checkbox/warning, git-signoff-checkbox, git-noverify-checkbox, git-skip-checks-commit, git-precommit-(build/lint/test/options/progress/summary), git-suggestions, git-template-select, git-commit-anyway, git-error
- **svn**(7): svn-changes-view/header/toolbar, svn-diff-editor/status, svn-history-view, svn-branch, svn-error
- **test**(24): test-tree, test-view(-toolbar), test-run-selector, run-all-tests, discover-tests, cancel-tests, cancel-test-error, test-results-list, test-run-(detail/header/state/summary), test-passed/failed/skipped/error-count, test-count, test-output-(view/toolbar/raw-output/empty), test-disconnected/loading/empty/error
- **perf**(2): perf-run-benchmark, perf-clear-history
- 其余（约 30）：hot-reload-indicator/section, scope-selector, runconfig-summary, open-find-window … 见生成命令输出。

---

## 附录 B：与既有测试资产的关系

| 资产 | 关系 |
|---|---|
| docs/testing/KAIRO_BROWSER_FULL_REGRESSION_TEST_PLAN.md (v1.0) | 本文取代其"判定纪律"部分；v1.0 用例表仍可作为步骤细节参考 |
| tests/e2e/regression/shard-01..16 | 承接自动化落地；用例标题需补 CASE-ID 前缀以对齐矩阵 |
| tests/e2e-windows/auto-*.cjs | 降级为"探索型普查脚本"，结果不作判定（R3） |
| docs/testing/KAIRO_BROWSER_FULL_REGRESSION_TEST_REPORT.md | 历史报告；后续报告按 §8.3 模板另起 |
