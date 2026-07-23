# Kairo IDE 与 IntelliJ IDEA / VS Code 对比 — Java 后端开发核心功能缺失分析

> **分析模型**：GLM-5.2
> **分析日期**：2026-07-21
> **分析范围**：`/Users/qi/Documents/spaces/kairo-ide` 当前 `qa/kimi-mac-web-20260720-65210d5` 分支
> **分析方法**：
> 1. 深度阅读 Kairo 项目源码（`packages/`、`runtime-agent/`、`apps/`、`bundled/`、`docs/`）
> 2. 联网检索 IntelliJ IDEA 官方文档、VS Code Java 官方文档、Eclipse JDT LS GitHub README、IDEA 2025/2026 EAP 发布说明、IDEA vs VS Code 对比博客（共 15+ 来源）
> 3. 对比三方功能矩阵，标注 Kairo 当前实现度与缺失项
> **目的**：为后续多模型综合评估提供本模型独立的输入；最终结论将以多模型共识为准。
> **读者**：项目负责人、架构师、产品经理

---

## 0. TL;DR — 一句话结论

Kairo IDE 当前对 Java 后端开发的支持水平**相当于「一个能语法高亮 + Ctrl+Space 补全 + F12 跳转的 Monaco 编辑器 + 一个能起停 Tomcat 的脚本」**，距离 IDEA / VS Code + Java Pack 在 **Debug、重构、代码导航深度、JSP/Tomcat 集成、Git、Test Runner、Search 写盘替换** 等核心能力上存在巨大差距。**P0 必须补齐的功能有 10 项**，其中最关键的是 **Java Debug（JDWP/DAP）、Java Hover/References/Rename/Format、JSP 深度支持、Git 集成、Call/Type Hierarchy、Find Usages、JUnit Runner、热部署（HotSwap）**。

---

## 1. 分析方法与基线

### 1.1 Kairo 当前实现度速览（基于源码静态阅读）

| 能力域 | 状态 | 说明 |
|---|---|---|
| 编辑器（Monaco + Theia） | ✅ working | 文件树、Tabs、Splits、Encoding、UTF-8/GBK 切换 |
| Java 补全（Ctrl+Space） | 🟡 partial | JDT LS 真实接通，仅 completion + definition + diagnostics 桥接 Monaco |
| Java F12 跳转 | 🟡 partial | 仅 Go to Definition，无 Find References / Call Hierarchy / Type Hierarchy |
| Java Hover | ❌ not_started | LSP capability 声明但 Monaco 端无 provider |
| Java Rename / Refactor | ❌ not_started | 完全缺失 |
| Java Format | ❌ not_started | 配置声明 enabled 但无 provider |
| Java Document Symbol / Outline | ❌ not_started | `@theia/outline-view` 装了但 Java 未桥接 |
| Java Signature Help | ❌ not_started | 同上 |
| Java Quick Fix / Code Action | ❌ not_started | 未调用 `textDocument/codeAction` |
| JSP 语法高亮 | 🟡 partial | Monarch 覆盖 directive/EL/JSTL/scriptlet-block，无 scriptlet 内 Java 高亮 |
| JSP EL 补全 / TLD 提示 | ❌ not_started | `TldParser` 实现完整但无调用方 |
| JSP 调试 | ❌ not_started | 完全缺失 |
| 文本搜索（正则/glob/preview） | 🟡 partial | 后端真实工作但 contextLines 是死代码，无 replace 写盘 |
| 搜索 UI 集成 | ❌ not_started | `KairoSearchService` 未与 `@theia/search-in-workspace` 桥接 |
| Java Debug（断点/JDWP/DAP） | ❌ not_started | `@theia/debug` 装了但零集成；Tomcat "debug" 模式未加 JDWP 参数 |
| JUnit Test Runner | ❌ not_started | JDT LS 已含 junit 插件但未调用 |
| Git 集成 | ❌ not_started | `@theia/git` 未安装 |
| 重构（Rename/Extract/Inline） | ❌ not_started | 完全缺失 |
| Tomcat 启停 / 日志 | ✅ working | Go agent 真实 spawn Bootstrap |
| Tomcat 部署（staticSync） | 🟡 partial | 仅 staticSync 模式，无 classHotSwap / contextReload |
| Ant 构建 | ❌ dead code | `AntProvider` 实现完整但 bootstrap 未 wire |
| Javac 构建 | ✅ working | `asyncBuildEngine` 真实编译 |
| 终端 | 🟡 partial | 依赖 Theia 默认，无 Kairo 集成 |
| 数据库工具 | ❌ not_started | 完全缺失 |
| HTTP Client | ❌ not_started | 完全缺失 |
| 项目视图（包/类树） | ❌ not_started | 仅有 Theia 标准文件树 |
| Import Wizard | 🟡 partial | UI 存在，部分状态机不完整 |
| Live Templates / Postfix | ❌ not_started | 完全缺失 |
| Inspections / Quick Fix | ❌ not_started | 完全缺失 |

### 1.2 IDEA / VS Code 必备功能基线

依据 JetBrains 官方文档、Microsoft VS Code Java 官方文档、Eclipse JDT LS README（截至 2026-07），对 Java 后端开发（特别是维护 JDK 1.6 / Tomcat 6 / JSP 老项目）的「必备」功能如下：

- **P0 必须（11 项）**：智能补全、代码导航（Find Usages / Call / Type Hierarchy）、全文搜索（含替换）、调试器（断点/Step/Evaluate/远程）、重构（Rename/Extract）、Inspections+Quick Fix、增量编译错误高亮、Maven/Ant 集成、Git 集成、Project Structure/SDK 管理、Keymap。
- **P1 重要（10 项）**：Live Templates、Postfix Completion、JSP/EL/TLD 支持、Tomcat Run/Debug Config、HotSwap、HTTP Client、Database、Terminal、Code Format、JUnit Runner。
- **P2 加分（多项）**：SSR、Decompiler、Language Injections、Profiler、Quick Definition、AI Assistant、Spring/Web 框架支持、OpenAPI 预览。

---

## 2. Kairo 缺失的核心功能详细分析

> **说明**：以下每项按「功能用途 / 使用场景 / IDEA 怎么用 / VS Code 怎么用 / Kairo 现状 / 实现难度 / 实现周期 / 是否必须 / 设计建议」九段式描述。
> **实现周期估算口径**：1 名熟练 Theia/Java 工程师全职投入；S=1-2 周，M=3-6 周，L=2-3 个月，XL=3 个月以上。
> **必要性**：P0=必备，无此功能不能称为 Java IDE；P1=重要，缺失显著降效；P2=加分。

---

### 2.1 【P0】Java Debug（断点 / Step / Evaluate / Watches / 调用栈 / 远程调试）

**功能用途**：在 IDE 内对运行中的 Java 进程下断点、单步执行、查看/修改变量、动态求值表达式、查看调用栈和线程，是定位运行时 bug 的核心工具。

**使用场景**：
- 调试 Tomcat 上跑的 servlet 链路（HTTP 请求 → doGet → service → DAO）
- 排查老 JSP 编译后行为异常
- 远程调试测试环境 Tomcat 6（生产不能装 IDE）
- 在测试中下断点验证假设

**IDEA 怎么用**：
- 行断点 `Ctrl+F8`，条件断点右键设置 Condition
- Step Over `F8` / Step Into `F7` / Step Out `Shift+F8` / Resume `F9`
- Evaluate Expression `Alt+F8`，Watches 面板添加监视
- Reload Changed Classes（HotSwap）：`Ctrl+F9` 重新加载修改过的 class
- Remote Debug：Run → Edit Configurations → Remote JVM Debug，自动生成 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005` 启动参数模板

**VS Code 怎么用**：
- 创建 `.vscode/launch.json`，选 Java + Tomcat Local 或 Attach
- Debugger for Java 扩展提供行/条件/Log 断点、Step、Variables、Watch、Evaluate
- 远程调试用 Attach 模式填 host:port
- HotSwap 受限（仅方法体）

**Kairo 现状**：❌ **完全缺失**
- `@theia/debug` 1.73.1 已安装但 Kairo 代码零引用
- 没有 `DebugConfigurationProvider` 注册
- 没有 DAP 适配器代码
- 没有 launch.json 概念
- `tomcat6.Spec.DebugPort` 字段存在但 `tomcat6.go:Start` 中 JVM args 没加 `-agentlib:jdwp=...`
- 命令 `kairo.server.debug` 仅调 `serverSvc.start(projectId, true)`，"debug=true" 在 Go agent 中只分配端口，不实际开 JDWP

**实现难度**：L-Hard
**实现周期**：8-12 周
**是否必须**：P0（**Java 后端开发无 debug 不可用**）
**设计建议**：
1. Go 端：`tomcat6.go:Start` 在 `spec.Debug=true` 时构造 JVM args 追加 `-agentlib:jdwp=transport=dt_socket,server=y,suspend={n|y},address=*:{debugPort}`
2. 前端：基于 `@theia/debug` 注册 `JavaDebugConfigurationProvider`，提供 "Debug on Tomcat 6" 与 "Attach to Remote JVM" 两种 launch type
3. DAP 适配器：用 `java-debug`（微软开源，`microsoft/java-debug`）作为 DAP server，在 Theia backend spawn 它，stdin/stdout 接 `@theia/debug` 的 `DebugAdapter` 通道
4. 断点管理：复用 `@theia/debug` 的 Breakpoint UI；Java source map 由 JDT LS 提供
5. HotSwap：第一步只做 "Restart Tomcat"，第二步接 `java-debug` 的 `redefineClass` 能力做方法体级 HotSwap

---

### 2.2 【P0】Java Hover（悬停显示类型 / Javadoc）

**功能用途**：鼠标悬停在 Java 标识符上时弹出该符号的类型、Javadoc、文档链接，是阅读代码的基础能力。

**使用场景**：
- 接手老项目时快速查看陌生方法的签名与文档
- 区分重载方法
- 查看 enum 常量值

**IDEA 怎么用**：鼠标悬停自动弹；`Ctrl+Q` 手动触发 Quick Documentation；`Ctrl+Shift+I` Quick Definition。

**VS Code 怎么用**：鼠标悬停自动弹（JDT LS 提供 hover）。

**Kairo 现状**：❌ not_started
- `jdt-ls-manager.ts:initialize` 声明 `hover` capability
- `JdtLsManager` 没有 `hover` 方法
- Monaco 端没注册 `registerHoverProvider`
- `KairoJavaLanguageClientContribution.hoverProvider` getter 返回 true 但无人读

**实现难度**：S-Easy
**实现周期**：1-2 周
**是否必须**：P0
**设计建议**：
1. `JdtLsManager` 增加 `hover({uri, line, character})` 方法发送 `textDocument/hover`
2. `java-monaco-registration.ts` 增加 `monaco.languages.registerHoverProvider('java', {...})`，调用 `JavaCompletionProvider.provideHover()`
3. 在 `JavaCompletionProvider` 增加 `provideHover` 方法委托 client
4. 处理 markdown 文档（JDT LS 返回 `MarkupContent`）

---

### 2.3 【P0】Find References / Find Usages（Shift+F12 / Alt+F7）

**功能用途**：查找符号在整个工作区的所有引用点，支持跨文件、跨模块，是重构与代码理解的前置依赖。

**使用场景**：
- 重命名前确认影响范围
- 接手老代码时梳理「谁调用了这个 servlet 方法」
- 删除方法前做 Safe Delete 检查

**IDEA 怎么用**：
- Find Usages：`Alt+F7`（弹窗）/ `Ctrl+Alt+F7`（下拉）
- Show Usages：`Ctrl+Alt+F7` 在编辑器内 inline
- 支持按用法类型过滤（read / write / import / call）

**VS Code 怎么用**：
- Find All References：`Shift+F12`（peek）/ `Ctrl+Shift+F12`（侧栏）
- 基于 JDT LS 的 `textDocument/references`

**Kairo 现状**：❌ not_started
- `references` capability 在 `initialize` 时声明
- `JdtLsManager` 无 `references` 方法
- Monaco 无 `registerReferenceProvider`

**实现难度**：S-Easy
**实现周期**：1-2 周
**是否必须**：P0
**设计建议**：
1. `JdtLsManager` 增加 `references({uri, line, character, includeDeclaration})`
2. Monaco `registerReferenceProvider`，结果走 Theia的 `peekReferences` widget
3. 配合 `Ctrl+Click` 中键点击直接跳转首个引用

---

### 2.4 【P0】Document Symbol / Quick Outline（Ctrl+F12）

**功能用途**：在当前 Java 文件内展示方法/字段/内部类列表，支持模糊搜索跳转。是阅读长 Java 文件的基础。

**使用场景**：
- 在 1000 行的 Servlet 类里快速跳到 `doPost` 方法
- 查看一个类的所有字段
- 切换到内部类

**IDEA 怎么用**：`Ctrl+F12` 弹出 File Structure；再按 `Ctrl+F12` 排序。

**VS Code 怎么用**：Outline 视图（左侧）+ `Ctrl+Shift+O` 文件内符号搜索。

**Kairo 现状**：❌ not_started
- `documentSymbol` capability 已声明
- `@theia/outline-view` 已安装但 Java 未桥接
- `JdtLsManager` 无 `documentSymbol` 方法

**实现难度**：S-Easy
**实现周期**：1 周
**是否必须**：P0
**设计建议**：
1. `JdtLsManager` 增加 `documentSymbol({uri})` 方法
2. 实现 `OutlineSymbolProvider` 接口注册到 Theia `OutlineSymbolProviderRegistry`
3. 自动填充左侧 Outline 视图

---

### 2.5 【P0】Workspace Symbol Search（Ctrl+T / Ctrl+N）

**功能用途**：在整个工作区内按类名/符号名搜索，无需知道文件路径。

**使用场景**：老项目里只知道类名 `UserServlet` 不知道路径，直接 `Ctrl+T` 跳过去。

**IDEA 怎么用**：
- Go to Class：`Ctrl+N`
- Go to Symbol：`Ctrl+Alt+Shift+N`
- Search Everywhere：双击 `Shift`

**VS Code 怎么用**：
- Go to Symbol in Workspace：`Ctrl+T`
- JDT LS 提供 `workspace/symbol`

**Kairo 现状**：❌ not_started
- `workspaceSymbol` capability 未声明
- 无对应 Monaco provider

**实现难度**：S-Easy
**实现周期**：1 周
**是否必须**：P0
**设计建议**：注册 Theia `WorkspaceSymbolProvider`，调用 JDT LS `workspace/symbol`。

---

### 2.6 【P0】Call Hierarchy（Ctrl+Alt+H）与 Type Hierarchy（Ctrl+H）

**功能用途**：
- Call Hierarchy：查看一个方法/类的调用者与被调用者层级
- Type Hierarchy：查看一个类的继承树（父类 + 子类 + 接口实现）

**使用场景**：
- 接手老 servlet 链路时梳理调用关系
- 查看 `BaseAction` 有哪些子类
- IDEA 2026.1 起类级 Call Hierarchy 还覆盖默认构造函数的 `new Class()` 调用

**IDEA 怎么用**：`Ctrl+Alt+H` / `Ctrl+H`；右侧面板树形展开。

**VS Code 怎么用**：Call Hierarchy 视图（右键 → Show Call Hierarchy），Type Hierarchy 同样支持（JDT LS 提供）。

**Kairo 现状**：❌ not_started
- `callHierarchy` / `typeHierarchy` capability 未声明
- `@theia/callhierarchy` / `@theia/typehierarchy` 模块未安装
- `JdtLsManager` 无对应方法

**实现难度**：M-Medium
**实现周期**：3-4 周
**是否必须**：P0（对老项目代码理解至关重要）
**设计建议**：
1. 安装 `@theia/callhierarchy` + `@theia/typehierarchy`
2. `JdtLsManager` 增加 `prepareCallHierarchy`、`callHierarchyIncoming`、`callHierarchyOutgoing`、`typeHierarchy`、`typeHierarchySubtypes`、`typeHierarchySupertypes` 方法
3. 注册 Theia `CallHierarchyProvider` / `TypeHierarchyProvider`
4. JDT LS 1.55 已支持这些方法

---

### 2.7 【P0】Java Rename（F2）与其他基础重构

**功能用途**：跨文件、跨模块安全重命名符号（类/方法/字段/变量），IDE 保证所有引用同步更新。

**使用场景**：
- 重命名老 servlet 方法 `doGetUser` → `doFetchUser`，IDE 自动改 web.xml、JSP、调用方
- 提取公共代码为 `Extract Method`

**IDEA 怎么用**：
- Rename：`Shift+F6`
- Extract Method：`Ctrl+Alt+M`
- Extract Variable：`Ctrl+Alt+V`
- Inline：`Ctrl+Alt+N`
- Change Signature：`Ctrl+F6`
- Safe Delete：`Alt+Delete`
- 全部重构入口：`Ctrl+Alt+Shift+T`

**VS Code 怎么用**：
- Rename：`F2`（JDT LS `textDocument/rename`）
- Extract Method/Variable：右键 → Refactor
- Change Signature：右键 → Refactor

**Kairo 现状**：❌ not_started
- `rename` capability 在 `lsp-protocol.ts:151` 声明但 `JdtLsManager` 无 `rename` 方法
- Monaco 无 `registerRenameProvider`
- 完全无 Extract / Inline / Change Signature

**实现难度**：S-Medium（Rename 容易，其他重构需要 CodeAction 桥接）
**实现周期**：2-4 周（仅 Rename）；6-8 周（含 Extract/Inline）
**是否必须**：P0（Rename 必备；Extract P1）
**设计建议**：
1. 第一步：`JdtLsManager.rename({uri, line, character, newName})` + Monaco `registerRenameProvider`，支持 prepareRename
2. 第二步：实现 `codeAction` 请求，桥接 JDT LS 的 Source Action / Refactoring 快速修复
3. 第三步：UI 上提供右键菜单 "Refactor → Extract Method" 等

---

### 2.8 【P0】Java 代码格式化（Reformat / Optimize Imports）

**功能用途**：按规则格式化整个文件或选区，清理无用 import。

**使用场景**：保存前统一代码风格；老项目接入时批量格式化。

**IDEA 怎么用**：`Ctrl+Alt+L` Reformat；`Ctrl+Alt+O` Optimize Imports；配置：Settings → Editor → Code Style → Java。

**VS Code 怎么用**：`Shift+Alt+F` Format Document；`Shift+Alt+O` Organize Imports（JDT LS 提供）。

**Kairo 现状**：❌ not_started
- `format.enabled=true` 已在 `initializationOptions` 中声明
- `formatting` capability 声明但 `JdtLsManager` 无 `formatting` 方法
- Monaco 无 `registerDocumentFormattingEditProvider`

**实现难度**：S-Easy
**实现周期**：1 周
**是否必须**：P0
**设计建议**：
1. `JdtLsManager.formatting({uri, options})` + `rangeFormatting({uri, range, options})`
2. Monaco `registerDocumentFormattingEditProvider` + `registerDocumentRangeFormattingEditProvider`
3. 增加 "Format on Save" preference
4. 实现 `organizeImports` code action

---

### 2.9 【P0】Java Signature Help（参数提示）

**功能用途**：调用方法时显示参数列表与当前参数位置，对重载方法尤其重要。

**使用场景**：调用老 servlet 的多参数 `service(req, resp, userId, sessionId)` 时知道每个参数名。

**IDEA 怎么用**：`Ctrl+P` Parameter Info。

**VS Code 怎么用**：输入 `(` 自动弹（JDT LS `textDocument/signatureHelp`）。

**Kairo 现状**：❌ not_started
- `signatureHelp.enabled=true` 已声明
- Monaco 无 `registerSignatureHelpProvider`

**实现难度**：S-Easy
**实现周期**：1 周
**是否必须**：P0
**设计建议**：`JdtLsManager.signatureHelp({uri, line, character})` + Monaco `registerSignatureHelpProvider`，触发字符 `(`, `,`。

---

### 2.10 【P0】Quick Fix / Code Action（Alt+Enter）

**功能用途**：在错误/警告处提供一键修复建议（添加 import、未实现方法、try-catch 包裹、变量提取等）。

**使用场景**：
- 红线错误处按 `Alt+Enter` 自动添加 import
- 未实现接口方法时自动生成 stub
- `try-with-resources` 自动包裹

**IDEA 怎么用**：`Alt+Enter` Show Intention Actions。

**VS Code 怎么用**：点击 💡 或 `Ctrl+.` Quick Fix。

**Kairo 现状**：❌ not_started
- `codeAction` capability 未声明
- `JdtLsManager` 无 `codeAction` 方法
- Monaco 无 `registerCodeActionProvider`

**实现难度**：M-Medium
**实现周期**：3-4 周
**是否必须**：P0
**设计建议**：
1. `JdtLsManager.codeAction({uri, range, context})` 发送 `textDocument/codeAction`
2. 注册 Monaco `CodeActionProvider`，将 LSP CodeAction 转为 Monaco `CodeAction`
3. 处理 `command` 类型的 CodeAction（如 `java.apply.workspaceEdit`）
4. UI 上提供 💡 灯泡和右键 Refactor 子菜单

---

### 2.11 【P0】Inspections / 实时错误诊断（红线 + 警告）

**功能用途**：实时静态分析，写代码过程中即时提示潜在 bug、未使用变量、空指针风险、过时 API。

**使用场景**：写代码时即时看到类型错误；找出 `==` 比字符串、未关闭 InputStream 等隐患。

**IDEA 怎么用**：Settings → Editor → Insptions（700+ 项可配置）；问题处 `Alt+Enter` 修复。

**VS Code 怎么用**：JDT LS `publishDiagnostics` 自动推送到 Problems 面板。

**Kairo 现状**：🟡 partial
- `publishDiagnostics` 真实工作，通过 `JavaCompletionProvider.onDiagnostics` 推送到 Monaco markers
- 但没有映射到 Theia的 `@theia/markers` Problems 面板
- 没有 Inspections 配置面板

**实现难度**：S-Easy
**实现周期**：1-2 周
**是否必须**：P0
**设计建议**：
1. 把 diagnostics 同时推送到 Theia `MarkerManager`（`@theia/markers`）
2. Problems 面板按 error/warning/info 分类显示
3. F2/Shift+F2 在错误间跳转

---

### 2.12 【P0】Git 集成（提交 / Diff / Blame / Branch / Conflict）

**功能用途**：在 IDE 内完成 commit / push / pull / branch 切换、查看文件历史、annotate（blame）、3-way merge。

**使用场景**：
- 对比分支差异
- 查 JSP 是谁在 2012 年改过
- 解决合并冲突

**IDEA / VS Code 怎么用**：Git 工具窗口 / Source Control 视图；Annotate 编辑器左侧；内置 GitHub PR 面板。

**Kairo 现状**：❌ not_started
- `@theia/git` 未在 `package.json` 中声明
- 无任何 Git 代码

**实现难度**：M-Medium
**实现周期**：4-6 周（基于 `@theia/git`）
**是否必须**：P0（团队协作必备）
**设计建议**：
1. `apps/browser/package.json` + `packages/theia-product/package.json` 添加 `@theia/git` 1.73.1
2. 在 `kairo-product-frontend-module.ts` 注册 GitContributions
3. 状态栏增加分支指示器（`⎇ main`）
4. 实现 `KairoGitService` 包装 Theia Git API，对接 Kairo的 Go agent 可选

---

### 2.13 【P0】Ant 构建集成

**功能用途**：运行老项目的 `build.xml`，支持 target 选择、属性传递、错误解析。

**使用场景**：维护 JDK 6 + Ant 老项目时一键 `ant clean compile war`。

**IDEA 怎么用**：Ant Build 工具窗口（右侧）；打开 `build.xml` 自动识别 targets。

**VS Code 怎么用**：需装第三方 Ant 扩展。

**Kairo 现状**：❌ dead code
- `runtime-agent/internal/provider/build/ant.go` 完整实现 `AntProvider`
- 但 `bootstrap/container.go` 从未实例化
- `internal/app/build_usecase.go:190` 中 `buildProvider` 为 nil 时走 "simulate success"

**实现难度**：S-Easy
**实现周期**：1-2 周
**是否必须**：P0（老项目维护必备）
**设计建议**：
1. `bootstrap/container.go` wire `NewAntProvider`，根据 `ProjectConfig.build.mode == "ant"` 选择
2. `build_usecase.go` 修正 nil 检查
3. 前端 Build View 显示 Ant target 列表，支持多选执行
4. 解析 Ant 的 `javac` task 输出，转为 diagnostics

---

### 2.14 【P0】JSP 深度支持（EL 补全 / TLD 提示 / JSP 调试）

**功能用途**：JSP 内 Java 代码高亮、EL 表达式补全、TLD 自定义标签提示、JSP 行断点调试。

**使用场景**：维护老 Tomcat 6 项目里大量 JSP（典型如 `<c:forEach>`、`${user.name}`、自定义 `<my:tag>`）。

**IDEA Ultimate 怎么用**：
- JSP 文件获得完整 Java 语法高亮与补全（scriptlet 内）
- EL `${...}` 自动补全 request/session attribute
- TLD 标签提示
- JSP 行断点可直接命中（IDEA 把 JSP 编译为 servlet 后映射回行号）

**VS Code 怎么用**：几乎不支持，需第三方插件且效果差。

**Kairo 现状**：🟡 partial
- `jsp-monarch.ts` 覆盖 directive / EL / JSTL / scriptlet-block
- scriptlet 内 Java 无高亮
- `TldParser` 实现完整但无调用方
- 无 EL 补全、无 TLD 提示、无 JSP 调试

**实现难度**：L-Hard（特别是 JSP 调试）
**实现周期**：8-12 周（全部）；2-3 周（仅 EL/TLD 补全）
**是否必须**：P0（老 Web 项目硬伤）
**设计建议**：
1. 第一阶段：scriptlet 内 Java 高亮——用 Monaco embedded language 机制，把 `<% ... %>` 内容注册为 java language
2. 第二阶段：`TldParser` 接入 `KairoJspLanguageContribution`，扫描 `WEB-INF/*.tld` 缓存标签库；JSP 中输入 `<` 时提示
3. 第三阶段：EL 补全——解析 `${...}` 中的属性名，从 request/session/作用域变量补全
4. 第四阶段（最难）：JSP 调试——需要 jasper 编译 JSP → servlet，把 JSP 行号映射到生成的 .java 行号，再下断点；可考虑直接复用 Tomcat 6 的 JDT-like 能力或借助 IDEA 的 jasper 集成思路

---

### 2.15 【P0】HotSwap / Class Hot Reload

**功能用途**：Debug 模式下修改 Java 方法体后无需重启 Tomcat，直接重新加载 class。

**使用场景**：调试老 servlet 时改一个变量名/逻辑，立即生效，节省分钟级重启时间。

**IDEA 怎么用**：Debug 模式下 `Ctrl+F9` Make Project，IDEA 自动调用 JVM 的 HotSwap。

**VS Code 怎么用**：Debugger for Java 支持 HotSwap（受限）。

**Kairo 现状**：❌ not_started
- `hotReloadMode` 协议定义支持 `staticSync | compileOnly | classHotSwap | contextReload`
- `deploy.go` 硬编码 `"staticSync"`
- 无 JDWP 集成，无法 HotSwap

**实现难度**：L-Hard（依赖 Debug 完成）
**实现周期**：4-6 周（前置 Debug 完成后）
**是否必须**：P0（依赖 2.1 Debug）
**设计建议**：
1. 前置：完成 2.1 Java Debug
2. `deploy.go` 增加 `classHotSwap` 模式，调用 `java-debug` 的 `redefineClass`
3. 配合 javac 增量编译单文件
4. UI 上显示 "Reloaded: UserService.java" 通知

---

### 2.16 【P0】Search Replace 写盘 + Search UI 集成

**功能用途**：在整个工作区内批量搜索替换文本，写入文件系统。

**使用场景**：重命名常量后批量替换所有引用；修改老 JSP 中的版权头。

**IDEA 怎么用**：`Ctrl+Shift+R` Replace in Files，预览每个匹配的 diff 后确认替换。

**VS Code 怎么用**：`Ctrl+Shift+H` Replace in Files。

**Kairo 现状**：❌ partial
- `KairoSearchService` 后端支持 `previewReplace` 字段
- 但 `search.go:buildMatch` 只返回 preview，不写盘
- `KairoSearchService` 未与 `@theia/search-in-workspace` UI 集成
- `contextLines` 字段是死代码（永远返回空串）

**实现难度**：S-Medium
**实现周期**：2-3 周
**是否必须**：P0
**设计建议**：
1. Go 端：新增 `POST /api/v1/search/replace` 接受 `query`、`replacement`、`include`、`exclude`，写盘前做 atomic write + 备份
2. 修复 `search.go:buildMatch` 的 `contextLines` 实际返回上下文行
3. 前端：实现 `SearchInWorkspaceClient` 适配器，让 Theia 默认搜索 UI 走 Kairo Go 后端
4. UI 上提供 "Replace All" / "Replace Selected" 按钮，带 diff 预览

---

### 2.17 【P0】JUnit Test Runner

**功能用途**：在 IDE 内运行/调试 JUnit 3/4/5 测试，查看结果树、失败堆栈、覆盖率。

**使用场景**：跑老 JUnit 4 测试做回归；断点调试单个测试方法。

**IDEA 怎么用**：类/方法旁绿色三角运行；Run with Coverage `Alt+Shift+F6`。

**VS Code 怎么用**：Java Test Runner 扩展提供同样的 UI。

**Kairo 现状**：❌ not_started
- `bundled/jdtls/plugins/` 含 `org.eclipse.jdt.junit.core_3.14.100.jar`
- 未调用 JDT LS 的 `java.test.run` 或 `java.test.navigate`
- `@theia/test` 未安装

**实现难度**：M-Medium
**实现周期**：4-6 周
**是否必须**：P0（回归测试必备）
**设计建议**：
1. 安装 `@theia/test`
2. 注册 `TestRunner` 适配 JDT LS 的 `java.test.run` 命令
3. 在 Java 编辑器中 CodeLens 显示 "Run | Debug"
4. Test 视图树形展示结果，失败用例点击跳到失败行

---

### 2.18 【P0】Java 项目视图（包/类树）

**功能用途**：按 Java 包结构展示项目（`com.example.controller` / `com.example.dao`），而非按文件系统目录。

**使用场景**：老项目里包结构层次深，按目录看不易理解。

**IDEA 怎么用**：Project 视图 → Project / Packages / Project Files 视角切换。

**VS Code 怎么用**：Java Projects 视图（Project Manager for Java 扩展）。

**Kairo 现状**：❌ not_started
- 仅有 Theia 默认文件树
- 无 Java 包视图

**实现难度**：M-Medium
**实现周期**：3-4 周
**是否必须**：P0
**设计建议**：
1. 实现 `KairoJavaProjectView` widget，调用 JDT LS `workspace/symbol` + `getProjectInfo`
2. 树形展示：source root → package → class（含 icon 区分 class/interface/enum）
3. 支持切换 "Packages" / "Files" 视角

---

### 2.19 【P0】Java Decompiler（反编译）

**功能用途**：双击无源码 jar 里的 class 自动反编译为可读 Java，可在反编译代码里下断点。

**使用场景**：老项目依赖大量无源码 jar（老版 struts1、log4j 1.x），需要看内部实现或断点调试。

**IDEA 怎么用**：双击 jar 内 class 自动反编译；FernFlower 默认引擎。

**VS Code 怎么用**：装 Decompiler 扩展。

**Kairo 现状**：❌ not_started
- JDT LS 含 `org.eclipse.jdt.core.compiler.batch_3.45.0.jar` 但无反编译 UI

**实现难度**：M-Medium
**实现周期**：3-4 周
**是否必须**：P0（老项目硬伤）
**设计建议**：
1. 引入 FernFlower 或 CFR 反编译器（jar 形式）
2. 在 `JdtLsManager` 增加 `decompile(classFileUri)` 方法
3. 编辑器打开 .class 文件时自动反编译并展示
4. 高级：在反编译代码上下断点（需要 source map，复杂度 L）

---

### 2.20 【P0】Project Structure / SDK 管理

**功能用途**：管理 Project SDK、Module SDK、Sources/Tests/Resources 根、依赖顺序。

**使用场景**：
- 老 Java 6 项目指定 JDK 6
- JSP 源根配置
- 多模块依赖管理

**IDEA 怎么用**：`File → Project Structure` (`Ctrl+Alt+Shift+S`)；IDEA 2025.3 增强多版本 JDK 管理。

**VS Code 怎么用**：`java.configuration.runtimes` in settings.json；Java Projects 视图。

**Kairo 现状**：🟡 partial
- `ProjectConfig` 已含 `compiler.javaHome` / `sourceLevel` / `targetLevel`
- `ImportWizard` 4 步配置
- 但无图形化 Project Structure 对话框
- 无 Module 概念（仅单 project）

**实现难度**：M-Medium
**实现周期**：3-4 周
**是否必须**：P0
**设计建议**：
1. 实现 `KairoProjectStructureDialog`，展示/编辑 `ProjectConfig`
2. 增加 Module 概念（多模块项目）
3. JDK 选择器（从 `GET /api/v1/toolchains` 拉）
4. Sources/Tests/Resources 根配置

---

### 2.21 【P1】Live Templates / Postfix Completion

**功能用途**：缩写展开为完整代码块（`psvm` → main 方法），减少重复打字。

**使用场景**：老项目里写 servlet `doGet` 骨架、`try-catch` 模板。

**IDEA 怎么用**：输入缩写 + Tab；管理：Settings → Editor → Live Templates。

**VS Code 怎么用**：需自定义 snippet。

**Kairo 现状**：❌ not_started

**实现难度**：S-Easy
**实现周期**：2-3 周
**是否必须**：P1
**设计建议**：
1. Monaco `registerCompletionItemProvider` 注入 snippet 项
2. 提供 Java 内置模板集（`psvm`, `sout`, `iter`, `trycatch`）
3. 支持用户自定义模板（JSON 配置文件）

---

### 2.22 【P1】Tomcat Run/Debug Configuration（图形化）

**功能用途**：图形化配置 Tomcat 启动参数、部署 artifact、VM options、Server 选项卡。

**使用场景**：配置 "On 'Update' action: Update classes and resources" 实现热部署。

**IDEA 怎么用**：Run → Edit Configurations → Tomcat Server → Local/Remote。

**VS Code 怎么用**：launch.json 配 Tomcat 类型。

**Kairo 现状**：🟡 partial
- `ProjectConfig.serverRuntime` 已含 ports / contextPath / env / vmOptions
- 但无 Run Configuration 概念，直接按 ProjectConfig 启动

**实现难度**：M-Medium
**实现周期**：3-4 周
**是否必须**：P1
**设计建议**：基于 `@theia/debug` 的 `DebugConfigurationProvider` 提供 "Tomcat 6 Local" 类型，UI 上可编辑 vmOptions / ports / contextPath / deployment。

---

### 2.23 【P1】HTTP Client（内置 REST 测试）

**功能用途**：在 `.http` 文件中编写并执行 HTTP 请求，支持变量、环境、断言。

**使用场景**：测试老 servlet 接口；固化调用样例。

**IDEA 怎么用**：新建 `.http` 文件；从 Controller 旁的小地球图标一键 "Open in HTTP client"。

**VS Code 怎么用**：REST Client 扩展。

**Kairo 现状**：❌ not_started

**实现难度**：M-Medium
**实现周期**：4-6 周
**是否必须**：P1
**设计建议**：
1. 自定义 `.http` 文件 grammar
2. `KairoHttpClientService` 调 Go agent `POST /api/v1/http` 执行请求
3. 编辑器内 "Send Request" CodeLens
4. 响应面板展示 status / headers / body / time

---

### 2.24 【P1】Database 工具

**功能用途**：连接 MySQL/Oracle/PG，执行 SQL、表结构浏览、数据导出、SQL 补全。

**使用场景**：排查老项目的数据问题、查表结构。

**IDEA 怎么用**：View → Tool Windows → Database。

**VS Code 怎么用**：SQL Tools / Database 扩展。

**Kairo 现状**：❌ not_started
- `docs/product-requirements.md:86` 明确说"用外部 SQL 工具"

**实现难度**：L-Hard
**实现周期**：8-12 周
**是否必须**：P1
**设计建议**：
1. 引入 JDBC 驱动管理
2. Go agent 增加 `POST /api/v1/db/query` 接口
3. SQL 编辑器（基于 Monaco SQL grammar）
4. 表结构树 + 数据网格

---

### 2.25 【P1】Code Completion 增强（Smart Completion + Postfix）

**功能用途**：
- Smart Completion：基于类型的智能补全（只给出类型匹配的项）
- Postfix Completion：`obj.sout` → `System.out.println(obj)`

**Kairo 现状**：🟡 partial（仅基础补全）

**实现难度**：M-Medium
**实现周期**：4 周
**是否必须**：P1
**设计建议**：JDT LS 1.55 已支持链式补全与类型过滤，只需在 Monaco `CompletionItemProvider` 中正确传递 `context.triggerKind` 并按 LSP `sortText` 排序。

---

### 2.26 【P1】Quick Definition（Ctrl+Shift+I）

**功能用途**：弹窗查看符号定义，不跳走。

**Kairo 现状**：❌ not_started

**实现难度**：S-Easy
**实现周期**：1 周
**是否必须**：P1
**设计建议**：基于已有的 `definition` 请求，弹 peek widget 展示。

---

### 2.27 【P1】Go to Implementation（Ctrl+Alt+B）

**功能用途**：在接口方法上跳转到实现类。

**Kairo 现状**：❌ not_started

**实现难度**：S-Easy
**实现周期**：1 周
**是否必须**：P1
**设计建议**：调用 JDT LS `textDocument/implementation`。

---

### 2.28 【P1】Terminal 增强

**功能用途**：IDE 内嵌 shell，自动 cd 到 catalina.base、跑 ant 等。

**Kairo 现状**：🟡 partial（依赖 Theia 默认）

**实现难度**：S-Easy
**实现周期**：1-2 周
**是否必须**：P1
**设计建议**：在 Tomcat 启动时自动开 terminal 到 `catalina.base/logs` 目录便于 `tail -f`。

---

### 2.29 【P1】Maven 集成

**功能用途**：自动导入依赖、解析 pom.xml、运行 goal、依赖图。

**Kairo 现状**：❌ not_started
- JDT LS 内置 m2e 支持 Maven，但 Kairo 未启用
- `bundled/jdtls/plugins/` 含 `org.eclipse.m2e.core_2.7.600.jar`

**实现难度**：M-Medium
**实现周期**：4-6 周
**是否必须**：P1（看用户项目类型）
**设计建议**：
1. 在 JDT LS `initializationOptions` 中启用 m2e
2. 增加 Maven 工具窗口
3. pom.xml 编辑器（基于 `@theia/json` 或自定义）

---

### 2.30 【P1】Code Lens（References / Implementations / Run）

**功能用途**：在类/方法上方显示 "3 references" / "Run | Debug" 等可点击文字。

**Kairo 现状**：❌ not_started

**实现难度**：S-Easy
**实现周期**：2 周
**是否必须**：P1
**设计建议**：注册 Monaco `CodeLensProvider`，调用 `references` + `implementation`。

---

### 2.31 【P2】Decompiler 断点调试

**功能用途**：在反编译的 .class 代码上下断点调试。

**Kairo 现状**：❌ not_started

**实现难度**：XL-Very Hard
**实现周期**：12 周+
**是否必须**：P2
**设计建议**：依赖 source map，复杂度高，先做反编译展示即可。

---

### 2.32 【P2】Structural Search & Replace (SSR)

**功能用途**：按代码结构模板搜索替换，超越纯文本匹配。

**Kairo 现状**：❌ not_started

**实现难度**：L-Hard
**实现周期**：8-10 周
**是否必须**：P2
**设计建议**：基于 JDT LS 的 `java.search.structurally` 扩展。

---

### 2.33 【P2】Language Injections（SQL/JSON/RegExp 注入）

**功能用途**：在 Java 字符串里获得 SQL/JSON/RegExp 的补全与高亮。

**Kairo 现状**：❌ not_started

**实现难度**：L-Hard
**实现周期**：6-8 周
**是否必须**：P2
**设计建议**：用 Monaco embedded language 机制。

---

### 2.34 【P2】Profiler

**功能用途**：CPU/内存采样、火焰图。

**Kairo 现状**：❌ not_started
- `docs/product-requirements.md:88` 明确 out of scope for v1

**实现难度**：XL
**实现周期**：12 周+
**是否必须**：P2

---

### 2.35 【P2】AI Assistant / Copilot 集成

**功能用途**：代码补全 / 代码解释 / 重构建议。

**Kairo 现状**：❌ not_started
- `docs/product-requirements.md:90` 明确 AI completion out of scope for v1

**实现难度**：M-Medium（接入第三方）
**实现周期**：4-6 周
**是否必须**：P2
**设计建议**：未来接入 Continue / Copilot 等扩展。

---

### 2.36 【P2】Spring / Web 框架深度支持

**功能用途**：Bean 导航、@Autowired 注入点提示、Endpoint 路由表、application.yml 补全。

**Kairo 现状**：❌ not_started

**实现难度**：L-Hard
**实现周期**：8-12 周
**是否必须**：P2（Kairo 主打老 servlet/JSP，Spring 不是核心）

---

## 3. 功能缺失汇总表（按优先级与实现周期排序）

| # | 功能 | Kairo 现状 | 必要性 | 难度 | 周期 | 依赖 |
|---|---|---|---|---|---|---|
| 2.1 | Java Debug（JDWP/DAP/远程/HotSwap 入口） | ❌ | P0 | L | 8-12w | — |
| 2.2 | Java Hover | ❌ | P0 | S | 1-2w | — |
| 2.3 | Find References / Find Usages | ❌ | P0 | S | 1-2w | — |
| 2.4 | Document Symbol / Quick Outline | ❌ | P0 | S | 1w | — |
| 2.5 | Workspace Symbol Search (Ctrl+T) | ❌ | P0 | S | 1w | — |
| 2.6 | Call Hierarchy + Type Hierarchy | ❌ | P0 | M | 3-4w | 2.4 |
| 2.7 | Java Rename + 基础重构 | ❌ | P0 | S-M | 2-4w | 2.3 |
| 2.8 | Java Code Format + Optimize Imports | ❌ | P0 | S | 1w | — |
| 2.9 | Java Signature Help | ❌ | P0 | S | 1w | — |
| 2.10 | Quick Fix / Code Action | ❌ | P0 | M | 3-4w | 2.11 |
| 2.11 | Inspections / Problems 面板集成 | 🟡 | P0 | S | 1-2w | — |
| 2.12 | Git 集成 | ❌ | P0 | M | 4-6w | — |
| 2.13 | Ant 构建集成 | dead code | P0 | S | 1-2w | — |
| 2.14 | JSP 深度支持（EL/TLD/调试） | 🟡 | P0 | L | 8-12w | 2.1 |
| 2.15 | HotSwap (Class Hot Reload) | ❌ | P0 | L | 4-6w | 2.1 |
| 2.16 | Search Replace 写盘 + UI 集成 | 🟡 | P0 | S-M | 2-3w | — |
| 2.17 | JUnit Test Runner | ❌ | P0 | M | 4-6w | 2.1 |
| 2.18 | Java 项目视图（包/类树） | ❌ | P0 | M | 3-4w | 2.4, 2.5 |
| 2.19 | Java Decompiler | ❌ | P0 | M | 3-4w | — |
| 2.20 | Project Structure / SDK 管理 | 🟡 | P0 | M | 3-4w | — |
| 2.21 | Live Templates / Postfix | ❌ | P1 | S | 2-3w | — |
| 2.22 | Tomcat Run/Debug Configuration | 🟡 | P1 | M | 3-4w | 2.1 |
| 2.23 | HTTP Client | ❌ | P1 | M | 4-6w | — |
| 2.24 | Database 工具 | ❌ | P1 | L | 8-12w | — |
| 2.25 | Smart Completion + Postfix | 🟡 | P1 | M | 4w | — |
| 2.26 | Quick Definition (Ctrl+Shift+I) | ❌ | P1 | S | 1w | 2.1 |
| 2.27 | Go to Implementation | ❌ | P1 | S | 1w | — |
| 2.28 | Terminal 增强 | 🟡 | P1 | S | 1-2w | — |
| 2.29 | Maven 集成 | ❌ | P1 | M | 4-6w | — |
| 2.30 | Code Lens | ❌ | P1 | S | 2w | 2.3 |
| 2.31 | Decompiler 断点调试 | ❌ | P2 | XL | 12w+ | 2.1, 2.19 |
| 2.32 | Structural Search & Replace | ❌ | P2 | L | 8-10w | — |
| 2.33 | Language Injections | ❌ | P2 | L | 6-8w | — |
| 2.34 | Profiler | ❌ | P2 | XL | 12w+ | — |
| 2.35 | AI Assistant | ❌ | P2 | M | 4-6w | — |
| 2.36 | Spring 框架深度支持 | ❌ | P2 | L | 8-12w | — |

**总计 P0：20 项，估算工作量 ≈ 60-80 周（1 人全职）**
**总计 P1：10 项，估算工作量 ≈ 25-35 周**
**总计 P2：6 项，估算工作量 ≈ 50-70 周**

---

## 4. 建议的实施路线图（分阶段）

### 阶段 1：补齐 Java LSP 桥接「轻量快速胜利」（4-6 周，S 难度）

> 这批功能底层 JDT LS 已支持，只需 Monaco provider 桥接，性价比最高。

- 2.2 Hover
- 2.3 Find References
- 2.4 Document Symbol
- 2.5 Workspace Symbol
- 2.8 Code Format
- 2.9 Signature Help
- 2.11 Problems 面板集成
- 2.26 Quick Definition
- 2.27 Go to Implementation
- 2.30 Code Lens

### 阶段 2：补齐重构与导航深度（4-6 周，S-M 难度）

- 2.7 Rename + Extract Method
- 2.10 Quick Fix / Code Action
- 2.6 Call Hierarchy + Type Hierarchy

### 阶段 3：Debug 与热部署核心（10-14 周，L 难度，但价值最高）

- 2.1 Java Debug（JDWP/DAP）
- 2.15 HotSwap
- 2.17 JUnit Test Runner
- 2.22 Tomcat Run Configuration

### 阶段 4：老项目栈深度（10-14 周，L 难度）

- 2.13 Ant 构建集成（其实只是 wire，1-2 周）
- 2.14 JSP 深度支持（EL 补全 → TLD → JSP 调试）
- 2.19 Decompiler
- 2.20 Project Structure
- 2.18 Java 项目视图

### 阶段 5：工程化（6-10 周，M 难度）

- 2.12 Git 集成
- 2.16 Search Replace 写盘 + UI 集成
- 2.21 Live Templates
- 2.28 Terminal 增强
- 2.29 Maven 集成

### 阶段 6：差异化加分项（按需，P2）

- 2.23 HTTP Client
- 2.24 Database
- 2.31–2.36 其他

---

## 5. 关键风险与注意事项

1. **JDT LS 集成应迁移到 `@theia/languages` 标准 LanguageClient 框架**（N-036/N-037），目前手搓的 `JdtLsManager` 难以扩展。建议在阶段 1 之前先做这个迁移，否则后续每个 LSP 功能都要重复手搓。
2. **`@theia/debug` 已装但零使用**——这是最大的「已付代价未收获」的地方，阶段 3 应优先激活。
3. **Ant provider 是死代码**——修复成本极低（只需 wire），价值高，应立即做。
4. **`contextLines` 死代码与 Search UI 未集成**——这两块是 Search 体验的硬伤，应作为阶段 5 的优先项。
5. **JSP 调试是 XL 难度**——可考虑分阶段：先做 EL 补全 + TLD 提示（2-3 周），JSP 调试延后甚至作为 v2 目标。
6. **多模型对比**——本文档是 GLM-5.2 模型的独立分析，建议与其他模型（如 DeepSeek、Kimi、Claude）的同类分析交叉对比，最终结论以共识为准。

---

## 6. 与 `docs/MILESTONES.md` 中 Deferred 项的关系

`docs/MILESTONES.md:86-95` 明确将以下能力 deferred 到 post-v1：

| Deferred 项 | MILESTONES 立场 | 本模型立场 |
|---|---|---|
| DAP/JDWP Debug | deferred | **应升级为 v1 P0**，无 Debug 不能称为 Java IDE |
| Remote Linux Server | deferred | 同意 deferred |
| LegacyFlow runtime plugins | deferred | 同意 deferred |
| Class HotSwap | future roadmap | **应升级为 v1 P0**，依赖 Debug |
| Dynamic plugins | future roadmap | 同意 future |
| Remote audit log | deferred | 同意 deferred |

**建议**：重新评估 v1 scope，把 Debug + HotSwap 提进 v1。若资源不足，至少 Debug 的 "行断点 + Step + 变量查看" 应在 v1 实现（Attach 模式即可）。

---

## 7. 参考来源

- IntelliJ IDEA 官方功能页：https://www.jetbrains.com.cn/en-us/idea/features/
- IntelliJ IDEA 重构文档：https://www.jetbrains.com.cn/en-us/help/idea/refactoring-source-code.html
- IntelliJ IDEA 调试文档：https://www.jetbrains.com.cn/help/idea/debugging-code.html
- IntelliJ IDEA 2025.1 新功能：https://segmentfault.com/a/1190000046473376
- IntelliJ IDEA 2026.1 EAP 1：https://cloud.tencent.com/developer/article/2630524
- IntelliJ IDEA 远程调试教程：https://m.jb51.net/program/352161g8o.htm
- VS Code Java Tutorial：https://code.visualstudio.com/docs/java/java-tutorial
- VS Code Java Debugging：https://code.visualstudio.com/docs/java/java-debugging
- VS Code Java Refactoring：https://code.visualstudio.com/docs/java/java-refactoring
- Eclipse JDT LS GitHub README：https://github.com/eclipse-jdtls/eclipse.jdt.ls
- IDEA vs VS Code 对比：https://blog.csdn.net/z_344791576/article/details/138838973

---

## 附录 A：Kairo 项目核心文件清单（用于后续模型复核）

### A.1 Java 语言智能
- `packages/java-extension/src/browser/java-language-client.ts` — 手搓 LanguageClient
- `packages/java-extension/src/browser/java-language-client-contribution.ts` — 死代码类
- `packages/java-extension/src/browser/java-completion-provider.ts` — Completion + Definition provider
- `packages/java-extension/src/browser/java-monaco-registration.ts` — Monaco 注册（仅 completion + definition）
- `packages/java-extension/src/browser/java-document-sync.ts` — didOpen/didChange 缓冲
- `packages/java-extension/src/browser/java-ls-lifecycle.ts` — JDT LS 启动生命周期
- `packages/java-extension/src/node/jdt-ls-manager.ts` — JDT LS 进程管理 + LSP 请求（仅 completion/definition/didOpen/didChange/didClose）
- `packages/java-extension/src/node/jdt-ls-service.ts` — Node 服务
- `packages/java-extension/src/common/lsp-protocol.ts` — LSP 类型声明

### A.2 JSP
- `packages/jsp-extension/src/browser/jsp-monarch.ts` — Monarch 语法
- `packages/jsp-extension/src/browser/jsp-grammar.ts` — 注册
- `packages/jsp-extension/src/browser/tld-parser.ts` — TLD 解析器（无调用方）

### A.3 调试
- `runtime-agent/internal/tomcat6/tomcat6.go:90-105` — JVM args 构造（缺 JDWP）
- `apps/browser/package.json:31` — `@theia/debug` 依赖（已装未用）

### A.4 搜索
- `packages/search-extension/src/browser/search-service.ts` — Kairo Search Service（未集成 Theia）
- `runtime-agent/internal/search/search.go` — Go 后端 search

### A.5 构建/部署
- `runtime-agent/internal/provider/build/ant.go` — Ant Provider（死代码）
- `runtime-agent/internal/build/compiler.go` — Javac（真实工作）
- `runtime-agent/internal/services/deploy.go:96` — 硬编码 staticSync
- `runtime-agent/internal/tomcat6/tomcat6.go` — Tomcat 进程管理

### A.6 Git
- `apps/browser/package.json` — 未声明 `@theia/git`

### A.7 Theia 模块
- 已装：`@theia/core`, `@theia/debug`(未用), `@theia/editor`, `@theia/filesystem`, `@theia/markers`, `@theia/messages`, `@theia/monaco`, `@theia/navigator`, `@theia/outline-view`(Java未桥接), `@theia/preferences`, `@theia/search-in-workspace`(Kairo未集成), `@theia/terminal`, `@theia/variable-resolver`, `@theia/workspace`
- 未装：`@theia/git`, `@theia/scm`, `@theia/test`, `@theia/callhierarchy`, `@theia/typehierarchy`, `@theia/languages`, `@theia/java`, `@theia/json`

---

**文档结束。本分析基于 GLM-5.2 模型对 Kairo IDE 2026-07-21 状态的独立评估，仅供多模型综合决策参考。**
