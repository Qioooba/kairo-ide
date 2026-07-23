# Kairo IDE vs IntelliJ IDEA / VS Code — 缺失功能深度分析（Mavis 视角）

> **分析模型**: Mavis (Claude / MiniMax Code)
> **分析日期**: 2026-07-21
> **分析基准**: 当前本地代码（`qa/kimi-mac-web-20260720-65210d5` 分支，commit `db37f95`）
> **目标场景**: 遗留 Java Web 项目维护（JDK 1.6 / Tomcat 6 / JSP / Servlet / GBK 编码）
> **对比对象**: IntelliJ IDEA Ultimate / Community（2025.3+）、VS Code + Extension Pack for Java
> **配套分析文档**（同目录多模型交叉验证）:
> - `IDEA_VSCODE_FEATURE_GAP_ANALYSIS.md` —— DeepSeek-V4-Pro
> - `MODEL_ANALYSIS_KAIRO_IDE_MISSING_FEATURES_20260721.md` —— TRAE v3
> - 本文档 —— Mavis

---

## 目录

1. [本文档与其他两份分析的差异化定位](#1-本文档与其他两份分析的差异化定位)
2. [基于代码事实的现状盘点（修正前两份的失真）](#2-基于代码事实的现状盘点修正前两份的失真)
3. [缺失功能的 4 层分类（架构视角）](#3-缺失功能的-4-层分类架构视角)
4. [P0 缺失功能详表（7 项 v1 必须补齐）](#4-p0-缺失功能详表7-项-v1-必须补齐)
5. [P1 缺失功能详表（10 项 v1.1 高价值）](#5-p1-缺失功能详表10-项-v11-高价值)
6. [P2 缺失功能详表（11 项 IDEA 体验对齐）](#6-p2-缺失功能详表11-项-idea-体验对齐)
7. [P3 锦上添花（v1 不做）](#7-p3-锦上添花v1-不做)
8. [依赖图与 Quick Win 路径](#8-依赖图与-quick-win-路径)
9. [v1 success criteria 复盘：PRD 写的"完整" vs 实际"残缺"](#9-v1-success-criteria-复盘prd-写的完整-vs-实际残缺)
10. [对 JSP 老项目的特殊考虑](#10-对-jsp-老项目的特殊考虑)
11. [风险点（BLOCKERS + 架构约束）](#11-风险点blockers--架构约束)
12. [综合优先级矩阵](#12-综合优先级矩阵)
13. [结论与建议](#13-结论与建议)

---

## 1. 本文档与其他两份分析的差异化定位

两份已存在的分析已经覆盖了 IDEA/VS Code 主要功能清单与基础缺失项评估，本文档不重复其内容，而是从 **Mavis 视角** 提供 4 项增量价值：

| 维度 | DeepSeek-V4-Pro | TRAE v3 | Mavis（本文档） |
|------|----------------|---------|---------------|
| 视角 | 功能清单 + 优先级 | 详情 + 实现方案 | **架构级根因 + 4 层分类 + v1 复盘** |
| 现状判断 | 偏乐观 | 偏乐观 | **基于真实文件读出的"接线残缺"**（修正了前两份"hover 已注册"的错误）|
| 重点 | 18 个功能详表 | 7 个 P0 + 8 个 P1 + 10 个 P2 + 8 个 P3 | **把"前端 LSP 接线残缺"作为独立类目**，点出 8 个能力在协议层声明但代码层未实现 |
| JSP 老项目 | 5 个特殊考虑 | 1 段提及 | **6 项专项 + 依赖 JDT LS 的能力边界** |
| 风险/Blocker | 提及 B-004 | 详细引用 BLOCKERS.md | **BLOCKERS 与架构约束的关联分析 + 实测路径** |

**与前两份**最大的事实差异**（请重点关注）**：

- ❌ DeepSeek-V4-Pro 写"Hover provider 已注册"、"LSP 能力声明中 references 已声明" — **基于真实代码读取，前端根本没有 hover provider，references 后端方法也不存在**。
- ❌ TRAE v3 写"实现基础可用但体验不完整" — **更准确的说法是"LSP 协议层声明 9 个能力，代码层只接通了 2 个，UI 层接通了 0 个专用视图"**。
- ❌ `MILESTONES.md` 写 Completion / Definition / Diagnostics 是 `not_started` — **commit `b95552a` 已经在 main 分支接通了三者**（当前在 `qa/kimi-mac-web-20260720-65210d5` 也已合入），文档严重滞后于代码。

---

## 2. 基于代码事实的现状盘点（修正前两份的失真）

### 2.1 真实接线状态（grep + Read 实证）

| LSP 能力 | `jdt-ls-manager.ts:350-355` initialize 声明 | `jdt-ls-manager.ts` 实际方法（line 437/455）| `java-language-client.ts` 暴露 | `java-monaco-registration.ts` 注册 | 实际可用性 |
|----------|------|------|------|------|------|
| completion | ✅ | ✅ `completion()` (line 437) | ✅ | ✅ line 29-53 | **可用** |
| definition | ✅ | ✅ `definition()` (line 455) | ✅ | ✅ line 54-63 | **可用** |
| diagnostics | ✅ (`publishDiagnostics`) | — | ✅ (`onDiagnostics` 事件) | ✅ (Monaco markers) | **可用** |
| hover | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| signatureHelp | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| references | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| documentSymbol | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| codeAction | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| rename | ✅ (`prepareSupport: true`) | ❌ 无方法 | ❌ | ❌ | **不可用** |
| formatting | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| implementation | ✅ | ❌ 无方法 | ❌ | ❌ | **不可用** |
| workspaceSymbol | ✅ (workspace.symbol) | ❌ 无方法 | ❌ | ❌ | **不可用** |

**结论**：
- **JDT LS 后端能力**已被正确声明（9 个能力），LSP 协议层握手 OK。
- **LSP 请求方法**（manager 层）**只实现了 2 个**（completion + definition）。
- **前端语言客户端**只暴露 2 个方法。
- **Monaco 端**只注册 2 个 provider，**没有任何 hover provider**（前两份文档错误地写"hover 已实现"）。

### 2.2 真实视图状态（kairo-views-contribution.ts 实证）

UI Spec（`docs/ui-spec.md` §1.1）定义的活动栏 6 个图标 + 底部面板 6 个 tab：

| 视图 | UI Spec 设计 | 命令实现 | 实际 widget | 状态 |
|------|------|------|------|------|
| Servers View | ✅ | ✅ `REVEAL_KAIRO_SERVERS` | ✅ `ServerViewWidget` | **可用** |
| Build View | ✅ | ✅ `REVEAL_KAIRO_BUILDS` | ✅ `BuildViewWidget` | **可用（fake data 状态 N-033）** |
| Deployment View | ✅ | ✅ `REVEAL_KAIRO_DEPLOYMENTS` | ✅ `KairoDeploymentsWidget` | **基础可用** |
| Tomcat Logs | ✅ | ✅ `REVEAL_KAIRO_LOGS` | ✅ `LogViewerWidget` | **fake data 状态 N-033** |
| Java View (Ctrl+Shift+J) | ✅ | ❌ | ❌ | **未实现** |
| Run and Debug | ✅ | ❌ | ❌ | **未实现** |
| Outline (编辑器右侧) | ✅ | ❌ | ❌ | **未实现** |
| Bottom Panel: Problems | ✅ | ❌ | ❌ | **未实现** |
| Bottom Panel: Output | ✅ | ❌ | ❌ | **未实现** |
| Bottom Panel: Debug Console | ✅ | ❌ | ❌ | **未实现** |
| Bottom Panel: Terminal | ✅ | ❌ | ❌ | **未实现** |

**DEBUG_SERVER 命令**（`kairo-views-contribution.ts:65` + `line 312`）**不是 DAP 实现**，只是在 Tomcat 启动时附加 JDWP 参数（`-agentlib:jdwp=...`），打开监听端口。**没有 DAP 客户端、没有断点 UI、没有变量查看、没有调用栈面板**。这与"Debugger"概念有本质区别。

### 2.3 文档与代码的同步性

| 文档 | 状态 | 与代码的差距 |
|------|------|------|
| `MILESTONES.md` | 上次更新 2026-07-19 | Completion/Definition/Diagnostics 仍标 `not_started`，实际 commit `b95552a` / `24e1de0` 已接通 |
| `DELIVERY.md` | 2026-07-19 | DAP/JDWP Debug 标 "endpoint exists, no breakpoint proof"（准确）|
| `BLOCKERS.md` | 较新 | B-003（B-004）准确反映 JDT LS / JDWP Java 6 兼容性 |
| `product-requirements.md` §7 | — | v1 success criteria 写"完整 JDT LS 补全和导航"，但实际只接了 2/9 能力 |

---

## 3. 缺失功能的 4 层分类（架构视角）

我把所有缺失功能按**修复位置**分成 4 层，这决定了实现路径和难度：

### 第 1 层：LSP 接线残缺（最低成本，最高 ROI）

**8 个能力**（hover / signatureHelp / references / documentSymbol / codeAction / rename / formatting / implementation / workspaceSymbol）在 `jdt-ls-manager.ts:350-355` 的 `initialize` 中**已经声明**，JDT LS 后端**完全支持**（基于 LSP 3.17 标准 + Eclipse JDT 引擎），但**前端代码层全部没接通**。

**修复模式高度统一**（参考 `jdt-ls-manager.ts:437-466` 已有的 `completion()` / `definition()` 模板）：
1. `jdt-ls-manager.ts` 加一个方法 → `connection.sendRequest('textDocument/xxx', ...)`
2. `jdt-ls-service.ts` 加对应包装方法（参考 line 83-93）
3. `java-language-client.ts` 加 IPC 接口（参考 line 101-113）
4. `java-completion-provider.ts`（或新建一个 provider）加 `provideXxx()`
5. `java-monaco-registration.ts` 加 `monaco.languages.registerXxxProvider('java', ...)`（参考 line 29-63）

**单个功能实现成本**：300-800 行 TS + 1-3 天。**8 个加起来**约 2-3 周（包含 UI 接线、事件处理、错误兜底）。

**这一层是 kairo-ide 与"现代 Java IDE"差距最大的地方，但修复成本最低。**

### 第 2 层：视图层残缺

`kairo-views-contribution.ts` 已经定义了 4 个 kairo 视图（Servers / Build / Deployments / Logs），但**没有 IDE 通用视图**（Outline / Problems / Debug / Terminal / Search Results / Hierarchy）。

修复需要：
- 新建 React 组件（参考 `KairoDeploymentsWidget` 的简单模式，或更复杂的 TreeWidget）
- 注册 `WidgetManager` factory
- 加 menu / keybinding 触发

**实现成本**：单个简单视图 1-3 天，复杂视图（Debug、Type Hierarchy）1-2 周。

### 第 3 层：重型功能

- **Java Debugger**：JDWP + DAP + Theia Debug 框架 + 断点 UI + 变量查看 + 调用栈。**4-6 周**，受 BLOCKERS B-004（JDWP Java 6 兼容）影响。
- **Git 集成**：复用 `@theia/git` + `@theia/scm` 扩展。**1-2 周**。
- **Integrated Terminal**：复用 `@theia/terminal` 扩展。**3-5 天**。
- **Maven/Gradle**：JDT LS 自带 m2e 插件，但前端需接线。**2-3 周**。

### 第 4 层：JSP 老项目专项

- **JSP 内 Java 代码补全**（scriptlet `<% %>`）：需自定义 Monarch + Language Client 嵌套。**3-4 周**。
- **JSP → Servlet 编译后代码跳转**：依赖 Tomcat 编译 JSP 后的 `_jsp.java` 文件可访问。**2 周**。
- **web.xml 编辑辅助**：基于 XML schema 验证 + servlet mapping 自动补全。**1-2 周**。
- **TLD 标签库补全**：`packages/jsp-extension/src/browser/tld-parser.ts` 已存在但**未集成到编辑器**。**1 周**。
- **EL 表达式补全**：`${...}` 内 Bean 路径补全。**2 周**。
- **JSP 调试**：依赖 Java Debugger + JSP → Servlet 行号映射。**post-v1**。

---

## 4. P0 缺失功能详表（7 项 v1 必须补齐）

> 选 P0 的标准：v1 success criteria §7 第 3 条写"完整 JDT LS 补全和导航"。当前只接了 2/9 能力，**与 PRD 承诺不符**。这 7 项是把"完整"补齐的最低集合。

### P0-1: Hover Documentation（鼠标悬停显示 JavaDoc）

- **功能描述**：鼠标悬停在 Java 类/方法/字段/参数上时，弹出浮动窗口显示类型签名、JavaDoc 注释、相关注解。
- **使用场景**（来自 JDT LS / Eclipse 实践 + 日常 Java 开发）：调用不熟悉的方法时看参数；阅读源码时看方法用途；检查变量类型。
- **IDEA 怎么用**：自动触发（300ms 延迟），悬浮窗可点链接跳转，`Ctrl+Q` 锁定悬浮窗。
- **VS Code 怎么用**：默认开启，悬浮窗内可右键 Peek Definition。
- **当前状态**：❌ 第 1 层缺失（LSP 声明了但代码层未实现）
- **实现方案**：
  1. `jdt-ls-manager.ts` 加 `hover()` 方法（参考 completion 模板）
  2. Monaco 注册 `registerHoverProvider`（Monaco 原生支持）
  3. 处理 Markdown 渲染（JavaDoc 常含 `{@link}` 等标签）
- **实现难度**：★☆☆☆☆（极低，单文件 200 行）
- **实现周期**：2-3 天
- **是否必须**：✅ 是（与"完整补全和导航"直接相关）
- **JDT LS 支持**：✅ 完整

### P0-2: Find References（Alt+F7 / Shift+F12）

- **功能描述**：选中一个类/方法/字段/变量，查找整个项目中所有引用位置。结果按文件/包分组，点击跳转。
- **使用场景**：重构前评估影响范围；删除前确认无引用；理解代码调用链；Bug 排查时找所有赋值点。
- **IDEA 怎么用**：`Alt+F7`（Find Usages）/ `Ctrl+Alt+F7`（Show Usages 弹窗预览）/ `Ctrl+Shift+F7`（高亮所有引用）。
- **VS Code 怎么用**：`Shift+F12`（References View）/ `F3` 跳下一个。
- **当前状态**：❌ 第 1 层缺失
- **实现方案**：`textDocument/references` LSP 请求 + Monaco `registerReferenceProvider` + Theia `ReferenceResultsWidget`（复用 Theia 已有组件）
- **实现难度**：★★☆☆☆（低）
- **实现周期**：1 周
- **是否必须**：✅ 是
- **JDT LS 支持**：✅ 完整（`references.includeDecompiledSources: true` 已开启）

### P0-3: Rename Refactoring（Shift+F6 / F2）

- **功能描述**：选中符号，一键重命名，IDE 自动更新所有引用（跨文件、跨包），支持预览。
- **使用场景**：变量命名规范化；类名重构；批量修改老项目的拼音/英文命名。
- **IDEA 怎么用**：`Shift+F6`（Refactor This）或 `F2`（Rename），输入新名实时预览，回车应用。
- **VS Code 怎么用**：`F2` 直接重命名。
- **当前状态**：❌ 第 1 层缺失
- **实现方案**：`textDocument/rename` + `textDocument/prepareRename` LSP 请求 + Monaco `registerRenameProvider`（Monaco 原生支持 inline rename UI）
- **实现难度**：★★☆☆☆（低）
- **实现周期**：3-5 天
- **是否必须**：✅ 是
- **JDT LS 支持**：✅ 完整
- **注意**：JDT LS 无法识别反射调用（`Class.forName("xxx")`）和 XML/Spring 配置引用，需在 UI 上提示用户手动检查

### P0-4: Code Actions / Quick Fix（Alt+Enter）

- **功能描述**：当代码有错误或上下文相关时，按 `Alt+Enter` 弹出修复建议（自动 import、生成方法 stub、添加 try-catch、提取常量、生成 getter/setter 等）。
- **使用场景**：编译错误一键修；生成样板代码；代码优化建议；抑制警告。
- **IDEA 怎么用**：`Alt+Enter`（Show Context Actions），IDE 最具标志性的快捷键。
- **VS Code 怎么用**：`Ctrl+.`（Quick Fix）。
- **当前状态**：❌ 第 1 层缺失
- **实现方案**：`textDocument/codeAction` LSP 请求 + 处理 `workspace/applyEdit` 协议 + Monaco `registerCodeActionProvider` + 灯泡图标 UI
- **实现难度**：★★★☆☆（中，需处理 applyEdit 应用）
- **实现周期**：1-2 周
- **是否必须**：✅ 是
- **JDT LS 支持**：✅ 完整

### P0-5: Document Symbols / Outline（Ctrl+F12 / Alt+7）

- **功能描述**：显示当前 Java 文件的类/方法/字段树形结构（Structure 视图），点击快速跳转；支持搜索过滤。
- **使用场景**：老项目 Servlet 经常 2000+ 行，需要快速跳转到 `doPost()` 等方法；概览陌生类的结构。
- **IDEA 怎么用**：`Alt+7`（Structure 面板固定显示）/ `Ctrl+F12`（弹窗式 Outline）。
- **VS Code 怎么用**：内置 Outline 视图（默认在资源管理器面板下）。
- **当前状态**：❌ 第 1 层缺失（`documentSymbol` 后端未实现）
- **实现方案**：`textDocument/documentSymbol` LSP 请求 + Theia `OutlineView` 组件（Theia 原生支持）+ Theia `QuickPick` 弹窗
- **实现难度**：★★☆☆☆（低，复用 Theia Outline 组件）
- **实现周期**：3-5 天
- **是否必须**：✅ 是（遗留大文件必备）
- **JDT LS 支持**：✅ 完整

### P0-6: Problems View（Alt+6 / 全局错误列表）

- **功能描述**：底部面板显示**所有**文件的编译错误/警告，按文件/严重级别分组，支持点击跳转、F2/Shift+F2 跳到下一个/上一个错误。
- **使用场景**：刚打开项目时看全貌；修改后回归检查；老项目几百个错误集中处理。
- **IDEA 怎么用**：`Alt+6` 打开 Problems 面板（或 View → Tool Windows → Problems）。
- **VS Code 怎么用**：底部 Problems 标签（默认就有）。
- **当前状态**：❌ 第 2 层缺失（`JavaCompletionProvider.onDiagnostics` 事件已接，但**没有全局聚合**；`build-view-widget.tsx` 显示构建错误但不完整）
- **实现方案**：
  1. 新建 `KairoProblemsService` 订阅所有 `JavaCompletionProvider.onDiagnostics` + build-extension 的 BuildResult
  2. 全局维护 `Map<uri, Diagnostic[]>`
  3. UI Spec §3 已设计 `KairoProblemsList` 组件，参考 `KairoDeploymentsWidget` 模式实现
  4. 注册 Bottom Panel 标签页
- **实现难度**：★★☆☆☆（低，UI Spec 已有设计）
- **实现周期**：3-5 天
- **是否必须**：✅ 是（任何 IDE 的标配）
- **JDT LS 支持**：✅ diagnostics 已通过 `publishDiagnostics` 推送

### P0-7: Integrated Terminal（复用 Theia）

- **功能描述**：IDE 底部打开终端面板，可直接执行命令（`mvn`、`git status`、`tail -f catalina.out` 等）。
- **使用场景**：执行 Ant/Maven 命令；查看 Tomcat 日志；Git 命令行操作；快速执行脚本。
- **IDEA 怎么用**：`Alt+F12`（Terminal 标签）。
- **VS Code 怎么用**：`Ctrl+`` （默认就有）。
- **当前状态**：❌ 第 2 层缺失（UI Spec §1 已设计 Bottom Panel 的 Terminal tab，但未实现）
- **实现方案**：**直接集成 `@theia/terminal` 扩展**（Theia 内置），配置到 Bottom Panel
- **实现难度**：★☆☆☆☆（极低，集成即可）
- **实现周期**：3-5 天
- **是否必须**：✅ 是（无终端的 IDE 不可接受）
- **JDT LS 支持**：N/A
- **特别价值**：云桌面场景下，开发者无法频繁切窗口，终端内置能省大量时间

---

## 5. P1 缺失功能详表（10 项 v1.1 高价值）

### P1-1: Go to Implementation（Ctrl+Alt+B / Cmd+Alt+B）

- **功能描述**：从接口/抽象方法跳转到具体实现类。
- **使用场景**：老项目大量 DAO 接口 + DAOImpl 模式；从接口看实现。
- **当前状态**：❌ 第 1 层缺失
- **实现方案**：`textDocument/implementation` LSP 请求 + Monaco `registerImplementationProvider`
- **实现难度**：★☆☆☆☆（极低）
- **实现周期**：2-3 天
- **是否必须**：✅（强烈建议纳入 v1）
- **JDT LS 支持**：✅（`implementationsCodeLens: enabled` 已开启）

### P1-2: Signature Help（Ctrl+P / 输入左括号自动触发）

- **功能描述**：调用方法时显示参数列表，高亮当前正在输入的参数，支持重载切换。
- **使用场景**：调用不熟悉的方法时看参数；重载方法选择。
- **当前状态**：❌ 第 1 层缺失
- **实现方案**：`textDocument/signatureHelp` LSP 请求 + Monaco `registerSignatureHelpProvider`
- **实现难度**：★☆☆☆☆（低）
- **实现周期**：3-5 天
- **是否必须**：✅
- **JDT LS 支持**：✅（`signatureHelp.enabled: true`）

### P1-3: Code Formatting（Ctrl+Alt+L）

- **功能描述**：按配置的代码风格自动格式化（缩进、空格、换行、括号风格）。
- **使用场景**：老项目代码风格混乱；粘贴代码后整理；提交前统一风格。
- **当前状态**：❌ 第 1 层缺失（`format.enabled: true` 已声明但前端未接线）
- **实现方案**：`textDocument/formatting` + `textDocument/rangeFormatting` LSP 请求 + Monaco `registerDocumentFormattingEditProvider`
- **实现难度**：★☆☆☆☆（低）
- **实现周期**：2-3 天
- **是否必须**：✅
- **JDT LS 支持**：✅

### P1-4: Organize Imports（Ctrl+Alt+O）

- **功能描述**：自动删除未使用 import、按规则排序、合并同包 import、添加缺失 import。
- **使用场景**：老项目大量未使用 import；粘贴代码后整理。
- **当前状态**：❌ 第 1 层缺失（`advancedOrganizeImportsSupport: true` 已声明）
- **实现方案**：利用 `textDocument/codeAction` 中 `source.organizeImports` 类型
- **实现难度**：★☆☆☆☆（低，复用 P0-4 CodeAction 基建）
- **实现周期**：1-2 天
- **是否必须**：✅
- **JDT LS 支持**：✅

### P1-5: Workspace Symbol Search（Ctrl+T）

- **功能描述**：在整个工作区按名称搜索类/方法/字段（语义级，不是文本），支持模糊匹配。
- **使用场景**：快速打开类（记得名字但不记得位置）；大型项目导航。
- **当前状态**：❌ 第 1 层缺失（`workspace.symbol` 声明了但未实现）
- **实现方案**：`workspace/symbol` LSP 请求 + Theia `QuickOpenWorkspace` 组件
- **实现难度**：★★☆☆☆（低）
- **实现周期**：3-5 天
- **是否必须**：✅（强烈建议）
- **JDT LS 支持**：✅

### P1-6: Call Hierarchy（Ctrl+Alt+H）

- **功能描述**：以树形显示某个方法的调用链（Caller / Callee），可展开多级。
- **使用场景**：理解 legacy 代码调用流；重构前影响分析。
- **当前状态**：❌ 第 1 层缺失（LSP 3.16+ `callHierarchy` 协议，JDT LS 部分支持）
- **实现方案**：`textDocument/prepareCallHierarchy` + `callHierarchy/incomingCalls` + `callHierarchy/outgoingCalls` + Theia `TreeWidget`
- **实现难度**：★★★☆☆（中）
- **实现周期**：1-2 周
- **是否必须**：❌（v1 不必须，v1.1 重要）
- **JDT LS 支持**：⚠️ 部分（需验证 JDT LS 版本）

### P1-7: Type Hierarchy（Ctrl+H）

- **功能描述**：显示类/接口的继承树（Supertypes / Subtypes）。
- **使用场景**：理解复杂继承体系；老项目重构。
- **当前状态**：❌ 第 1 层缺失（UI Spec §1.1 已设计 Java 视图包含 Type Hierarchy）
- **实现方案**：JDT LS 扩展命令 `java/typeHierarchy`（非标准 LSP）+ TreeWidget
- **实现难度**：★★★☆☆（中）
- **实现周期**：1-2 周
- **是否必须**：❌（v1.1 重要）
- **JDT LS 支持**：⚠️ 通过扩展命令，需确认

### P1-8: Git Integration（基础版）

- **功能描述**：在 IDE 内完成 Git 日常操作（查看变更、提交、推送、分支、历史、解决冲突）。
- **使用场景**：日常提交；代码审查；分支管理。
- **当前状态**：❌ 第 2 层缺失（产品需求文档明确"out of scope for v1"）
- **实现方案**：**直接集成 `@theia/git` + `@theia/scm` 扩展**（Theia 内置）
- **实现难度**：★★☆☆☆（低，集成）
- **实现周期**：1-2 周
- **是否必须**：❌（v1 不必须，但 v1.1 必须）
- **JDT LS 支持**：N/A

### P1-9: Java Code Generation（Alt+Insert）

- **功能描述**：自动生成 Getter/Setter、Constructor、toString()、equals/hashCode、Delegate Methods、Override Methods。
- **使用场景**：POJO/DTO 一键生成所有字段的 getter/setter；实现接口生成 stub；重写父类方法。
- **当前状态**：❌ 第 1 层缺失（初始化选项中 `advancedGenerateAccessorsSupport` 等 7 个已声明）
- **实现方案**：JDT LS `workspace/executeCommand` 执行 `java.generate.*` 命令
- **实现难度**：★★★☆☆（中）
- **实现周期**：1-2 周
- **是否必须**：❌（v1.1 重要）
- **JDT LS 支持**：✅（命令已声明）

### P1-10: Search Everywhere / Go to File（Ctrl+P / 双击 Shift）

- **功能描述**：统一搜索入口，支持文件名、类名、符号、命令混合搜索。
- **使用场景**：快速打开任何文件/类/符号/命令。
- **当前状态**：❌ 第 1 层缺失（`Ctrl+P` 文件搜索是 Theia 原生，但符号搜索未接）
- **实现方案**：基于 Theia `QuickOpen` 框架，集成 `workspace/symbol` + `textDocument/documentSymbol`
- **实现难度**：★★☆☆☆（低）
- **实现周期**：1 周
- **是否必须**：❌（v1.1 重要）
- **JDT LS 支持**：✅

---

## 6. P2 缺失功能详表（11 项 IDEA 体验对齐）

> P2 重点是让界面和操作更接近 IDEA，提升日常使用的"质感"。这些功能单看不大，但缺了会让人感觉"不像现代 IDE"。

### P2-1: Peek Definition（Alt+F12）
- **功能**：在当前文件内弹窗显示定义（不离开当前编辑位置）。
- **当前状态**：❌ UI Spec §4.1 快捷键已定义但未实现。
- **实现难度**：★★☆☆☆ | **周期**：1-2 天
- **JDT LS 支持**：N/A（用现有 definition 能力组合）

### P2-2: Inlay Hints（参数名/类型提示）
- **功能**：在方法调用处内联显示参数名（`foo(x: 1, y: 2)` → `foo(name: x, value: 1, name: y, value: 2)`），提升阅读速度。
- **当前状态**：❌（Monaco 支持 inlayHints API）
- **实现难度**：★★☆☆☆ | **周期**：1-2 周
- **JDT LS 支持**：✅（LSP 3.17 inlayHint 协议）

### P2-3: Breadcrumbs（编辑器顶部路径栏）
- **功能**：编辑器顶部显示 `MyClass > doPost > handleException`，点击可跳转到任意层级。
- **当前状态**：❌（Monaco 支持 breadcrumb API）
- **实现难度**：★★☆☆☆ | **周期**：3-5 天
- **JDT LS 支持**：✅（基于 documentSymbol）

### P2-4: CodeLens（实现链接 / 引用计数）
- **功能**：方法上方显示 `2 references` / `implements: UserServiceImpl`，点击跳转。
- **当前状态**：❌（`implementationsCodeLens: enabled` 已声明但未接线）
- **实现难度**：★★☆☆☆ | **周期**：1-2 周
- **JDT LS 支持**：✅

### P2-5: TODO / FIXME 任务视图
- **功能**：底部面板显示所有 `// TODO` / `// FIXME` 注释聚合视图。
- **当前状态**：❌
- **实现难度**：★☆☆☆☆（基于 search-extension 改造）| **周期**：3-5 天
- **JDT LS 支持**：N/A

### P2-6: Live Templates（代码模板，sout/psvm 缩写展开）
- **功能**：输入 `sout` + Tab 展开为 `System.out.println();`，自定义 Java 模板。
- **当前状态**：❌
- **实现难度**：★★☆☆☆（Monaco Snippet + 自定义完成项）| **周期**：1 周
- **JDT LS 支持**：N/A

### P2-7: Recent Files（Ctrl+E）
- **功能**：快速打开最近编辑过的文件。
- **当前状态**：⚠️ Theia 原生支持但未在 Kairo 中集成
- **实现难度**：★☆☆☆☆ | **周期**：2-3 天

### P2-8: Bookmarks（F11 / Ctrl+F11 带编号）
- **功能**：在任意行打书签，快速跳转；可命名。
- **当前状态**：❌
- **实现难度**：★★☆☆☆ | **周期**：3-5 天

### P2-9: Local History（无版本控制的本地历史）
- **功能**：IDE 自动保存文件修改历史，可视化 diff，可回退到任意版本。
- **使用场景**：误删代码恢复；和 1 小时前版本对比。
- **当前状态**：❌
- **实现难度**：★★★☆☆ | **周期**：1-2 周

### P2-10: Run Configurations（运行配置管理）
- **功能**：保存多个运行配置（不同项目/不同 VM 参数），可命名、可切换。
- **当前状态**：⚠️ UI Spec §1.2 Tool Bar 有"Run▾"选择器，但实际只有当前 server 配置
- **实现难度**：★★☆☆☆ | **周期**：1 周

### P2-11: Method Separators / Code Folding
- **功能**：方法之间显示分隔线；可折叠方法/类/注释块。
- **当前状态**：❌
- **实现难度**：★☆☆☆☆（Monaco 内置）| **周期**：1-2 天

---

## 7. P3 锦上添花（v1 不做）

| 序号 | 功能 | 周期 | 备注 |
|------|------|------|------|
| P3-1 | Conditional Breakpoints | 1-2 周 | 依赖 P0-1 Debugger |
| P3-2 | Exception Breakpoints | 1 周 | 依赖 Debugger |
| P3-3 | JUnit Test Runner | 2-3 周 | JDT LS 支持但 v1 优先编辑器体验 |
| P3-4 | Hot Code Replace (JRebel 类) | 4-6 周 | 复杂度高，受 B-004 限制 |
| P3-5 | Maven / Gradle 集成 | 2-3 周 | 老项目多用 Ant，优先级低 |
| P3-6 | Database 工具（Oracle 11g） | 4-6 周 | PRD 明确 out of scope |
| P3-7 | AI 补全 | — | PRD 明确 v1 不做 |
| P3-8 | Marketplace / 插件市场 | 4-6 周 | PRD 明确 v1 不做 |

---

## 8. 依赖图与 Quick Win 路径

### 8.1 依赖关系

```
P0-1 Hover  ─────────────────────────────────────── 独立（LSP 基础）
P0-2 References ─────────────────────────────────── 独立
P0-3 Rename ─────────────────────────────────────── 独立
P0-4 CodeAction ──────────────────────────────────┬─→ P1-4 Organize Imports（复用）
                                                  ├─→ P1-9 Code Generation（复用）
                                                  └─→ P2-6 Live Templates（间接）
P0-5 Outline ───────────────────────────────────┬─→ P2-3 Breadcrumbs（基于 data）
                                                └─→ P2-4 CodeLens（部分基于 data）
P0-6 Problems View ─────────────────────────────  独立
P0-7 Terminal ──────────────────────────────────  独立（集成 Theia）

P1-1 Go to Implementation ──────────────────────  独立
P1-2 Signature Help ────────────────────────────  独立
P1-3 Formatting ────────────────────────────────  独立
P1-5 Workspace Symbol ───────────────────────────  独立
P1-6 Call Hierarchy ─────────────────────────────  独立
P1-7 Type Hierarchy ─────────────────────────────  独立
P1-8 Git ────────────────────────────────────────  独立（集成 Theia）
P1-10 Search Everywhere ────────────────────────  独立

P3-X Debugger ──────────────────────────────────┬─→ P3-1 Conditional BP
                                                  ├─→ P3-2 Exception BP
                                                  └─→ P3-3 JUnit
P3-9 JSP Debug ─────────────────────────────────  依赖 Debugger + JSP → Servlet 行号映射
```

### 8.2 Quick Win 路径：2-3 周让 kairo 变"可用"

按依赖关系和 ROI 排序，**2-3 周内可让 IDE 从"残缺"变"可用 Java IDE"**：

**第 1 周：LSP 接线基础（7 个 P0 + 部分 P1 的方法实现）**
- P0-1 Hover（2 天）
- P0-5 Outline（3 天）
- P1-2 Signature Help（3 天，因为方法模板与 Hover 类似）

**第 2 周：导航和重命名**
- P0-2 References（1 周）
- P0-3 Rename（3 天，可与 References 串行）
- P0-6 Problems View（3 天，与上面并行）

**第 3 周：操作和工具**
- P0-4 Code Actions / Quick Fix（1 周）
- P0-7 Terminal（3 天，并行集成）
- P1-1 Go to Implementation（2 天，并行）

**3 周后 kairo 状态**：
- 完整 JDT LS 补全和导航（与 PRD v1 §7 第 3 条对齐）
- 重构可用（References / Rename / CodeAction）
- 大文件导航可用（Outline / Hover / Problems）
- 终端可用

**总成本估算**：3 周 ≈ 15 人天（按 1 个全职 TS 开发计算）

### 8.3 完整 v1 → v1.1 → v1.2 路线

| 阶段 | 时间 | 包含功能 | 累计成本 |
|------|------|----------|----------|
| v1.1-1（3 周）| 7 个 P0 + Terminal + Go to Implementation | 3 周 |
| v1.1-2（2 周）| Signature Help + Formatting + Organize Imports + Workspace Symbol + Code Generation | 5 周 |
| v1.1-3（2 周）| Call/Type Hierarchy + Git + Search Everywhere | 7 周 |
| v1.2（4-6 周）| Debugger + JSP 老项目专项 | 11-13 周 |

---

## 9. v1 success criteria 复盘：PRD 写的"完整" vs 实际"残缺"

`product-requirements.md` §7 写：

> 3. The user can edit a `.java` file with **full JDT LS completion and navigation**, using a real JDK 6 for compilation.

但当前实际状态：
- **completion**：✅ 完整
- **navigation**：❌ 只有 1/8 个能力（definition 已接，hover/references/rename/codeAction/implementation/workspaceSymbol/documentSymbol 都未接）

**这个差距是 v1 是否能 ship 的关键风险**。如果按 PRD 字面意思交付，v1 实际**不符合自己的成功标准**。

**我的建议**：
- 把 7 个 P0 中至少 **Hover + References + Rename + Outline + Problems View** 纳入 v1（5 项 = 2 周工作量）
- Debugger 明确标 post-v1（与 PRD 一致，不冲突）
- 其余 2 个 P0（CodeAction、Terminal）放入 v1.1
- 修订 PRD §7 措辞，把"full"改为"core"（"核心 JDT LS 补全和导航"），或承诺 v1.1 完成"完整"集合

---

## 10. 对 JSP 老项目的特殊考虑

PRD 明确 kairo 的目标用户是维护 JDK 6 / Tomcat 6 / JSP / Servlet 老项目的开发者。JSP 相关功能是差异化的关键。

### 10.1 JSP 专项缺失功能

| 序号 | 功能 | 描述 | 实现难度 | 周期 | 优先级 |
|------|------|------|----------|------|--------|
| JSP-1 | JSP 内 Java 代码补全 | `<% %>` scriptlet 内的 Java 智能（补全、Hover、Definition）| ★★★★ | 3-4 周 | P1 |
| JSP-2 | EL 表达式补全 | `${user.name}` 内 Bean 路径补全 | ★★★ | 2 周 | P1 |
| JSP-3 | JSTL 标签补全 | `<c:if>`、`<fmt:formatDate>` 等 | ★★ | 1-2 周 | P1 |
| JSP-4 | JSP → Servlet 跳转 | 从 JSP 跳转到 Tomcat 编译后的 `_jsp.java` 源 | ★★★ | 2 周 | P2 |
| JSP-5 | web.xml 编辑辅助 | servlet mapping / filter / listener 自动补全和验证 | ★★★ | 1-2 周 | P1 |
| JSP-6 | TLD 标签库补全 | 自定义标签（`packages/jsp-extension/src/browser/tld-parser.ts` 已存在但未接线）| ★★ | 1 周 | P1 |
| JSP-7 | JSP 调试 | 在 JSP scriptlet 中设断点 | ★★★★★ | 复杂 | P3（post-v1）|

### 10.2 已存在但未集成的资产

`packages/jsp-extension/src/browser/tld-parser.ts` — **已存在但未集成到编辑器**，这是个 Quick Win：

- 已有 TLD XML 解析逻辑
- 只需把它接到 Monaco `registerCompletionItemProvider('jsp', ...)`
- 1 周完成

### 10.3 EL 表达式补全的实现路径

JSP EL `${...}` 内的补全是高价值功能，因为老项目 JSP 大量使用 `${user.xxx}`、`${sessionScope.yyy}`：

1. 用 Monaco 的 tokenizer 识别 `${...}` 段
2. 触发独立的 EL 补全 provider
3. EL provider 通过 JDT LS 解析 `.` 后面的 Bean 路径
4. 显示 getter / field 列表

### 10.4 JSP 调试的特殊挑战

JSP 在 Tomcat 中先被编译成 Servlet Java 源码（`%CATALINA_HOME%/work/Catalina/localhost/xxx/org/apache/jsp/xxx_jsp.java`），然后编译成 class 调试。

挑战：
- Tomcat 6 编译生成的代码和用户写的 JSP 行号映射
- `BLOCKERS B-004` 已知 JDWP Java 6 部分协议不兼容
- 调试时显示的栈帧是 Servlet 而不是 JSP

建议：**post-v1 处理**，与主 Debugger 一起设计。

---

## 11. 风险点（BLOCKERS + 架构约束）

### 11.1 BLOCKERS.md 中影响本评估的条目

**B-003 — Eclipse JDT Language Server for Java 6**
- JDT LS 是第三方二进制，Java 6 源级兼容性是 best effort
- JDT LS 已设置 `sourceLevel: 1.6`，但 `--release 6` 和 pre-Java-7 语言特性有已知 gap
- **影响**：P0/P1 中所有依赖 JDT LS 的功能（hover / references / rename / codeAction / outline / formatting / signatureHelp）都受此影响
- **缓解**：JDT LS 版本固定，gap 文档化，javac 编译仍用用户真实 JDK 6

**B-004 — JDWP debug adapter for Java 6 target JVMs**
- 现代 Java debug adapters（`vscode-java-debug`）针对 Java 8+
- Java 6 JDWP 协议中**部分 reference type info commands** 不被尊重
- **影响**：P3-X Debugger 全部子功能
- **缓解**：v1 推迟 Debugger，v1.2 用 Eclipse JDT-based DAP front-end + JDI backend on modern JDK
- **特别挑战**：KAIRO 在 Windows 10 云桌面 + 4GB RAM，需要非常谨慎的 DAP 客户端实现

### 11.2 架构约束

| 约束 | 影响 | 缓解 |
|------|------|------|
| 4GB RAM 限制 | 不能复制 IDEA 的全部 client-side index 策略 | Monaco + JDT LS 已经是轻量方案；UI 组件用 React 18.x（注意 mobx 等状态库的内存）|
| Windows 10 云桌面 + 无管理员 | DAP client 部署限制 | 用 Theia Debug 框架 + 已签名的 JDWP 客户端二进制 |
| 4GB RAM + 启动性能 ≤ 8s | 不能 eager load 所有 LSP 能力 | LSP 能力 lazy registration（已有设计）|
| GBK + UTF-8 混合 | 文本搜索、JDT LS 编码处理 | `encoding-extension` 已实现，需确保 JDT LS 初始化时正确传递 encoding 配置 |
| `bundled/jdtls` 版本固定 | 升级困难 | 已有 SHA-256 校验机制（N-040 待补）|

### 11.3 性能目标（product-requirements.md §6）

- Cold start to workspace open ≤ 8 s on 2 vCPU / 4 GB box
- First completion after Java file save ≤ 1.5 s
- Incremental compile of single changed file ≤ 2 s
- Full-text search across 10 k-file project ≤ 3 s

**风险**：`jdt-ls-manager.ts:383` 设置 `trace: { server: 'verbose' }`（line 383）—— verbose 日志会**严重影响性能**，建议 v1 发布前改为 `'off'` 或 `'messages'`。

---

## 12. 综合优先级矩阵

| 优先级 | 编号 | 功能 | 难度 | 周期 | 必须 | JDT LS 支持 | 阶段 |
|--------|------|------|------|------|------|------------|------|
| **P0** | 1 | Hover Documentation | ★ | 2-3 天 | ✅ | ✅ | v1.1-1 |
| **P0** | 2 | Find References | ★★ | 1 周 | ✅ | ✅ | v1.1-1 |
| **P0** | 3 | Rename Refactoring | ★★ | 3-5 天 | ✅ | ✅ | v1.1-1 |
| **P0** | 4 | Code Actions / Quick Fix | ★★★ | 1-2 周 | ✅ | ✅ | v1.1-1 |
| **P0** | 5 | Outline / Structure | ★★ | 3-5 天 | ✅ | ✅ | v1.1-1 |
| **P0** | 6 | Problems View | ★★ | 3-5 天 | ✅ | ✅ | v1.1-1 |
| **P0** | 7 | Integrated Terminal | ★ | 3-5 天 | ✅ | N/A | v1.1-1 |
| **P1** | 1 | Go to Implementation | ★ | 2-3 天 | ✅ | ✅ | v1.1-1 |
| **P1** | 2 | Signature Help | ★ | 3-5 天 | ✅ | ✅ | v1.1-2 |
| **P1** | 3 | Code Formatting | ★ | 2-3 天 | ✅ | ✅ | v1.1-2 |
| **P1** | 4 | Organize Imports | ★ | 1-2 天 | ✅ | ✅ | v1.1-2 |
| **P1** | 5 | Workspace Symbol | ★★ | 3-5 天 | ✅ | ✅ | v1.1-2 |
| **P1** | 6 | Call Hierarchy | ★★★ | 1-2 周 | ❌ | ⚠️ | v1.1-3 |
| **P1** | 7 | Type Hierarchy | ★★★ | 1-2 周 | ❌ | ⚠️ | v1.1-3 |
| **P1** | 8 | Git Integration | ★★ | 1-2 周 | ❌ | N/A | v1.1-3 |
| **P1** | 9 | Code Generation | ★★★ | 1-2 周 | ❌ | ✅ | v1.1-2 |
| **P1** | 10 | Search Everywhere | ★★ | 1 周 | ❌ | ✅ | v1.1-3 |
| **P2** | 1 | Peek Definition | ★★ | 1-2 天 | ❌ | N/A | v1.1-2 |
| **P2** | 2 | Inlay Hints | ★★ | 1-2 周 | ❌ | ✅ | v1.1-3 |
| **P2** | 3 | Breadcrumbs | ★★ | 3-5 天 | ❌ | ✅ | v1.1-2 |
| **P2** | 4 | CodeLens | ★★ | 1-2 周 | ❌ | ✅ | v1.1-3 |
| **P2** | 5 | TODO / FIXME View | ★ | 3-5 天 | ❌ | N/A | v1.1-2 |
| **P2** | 6 | Live Templates | ★★ | 1 周 | ❌ | N/A | v1.1-3 |
| **P2** | 7 | Recent Files | ★ | 2-3 天 | ❌ | N/A | v1.1-2 |
| **P2** | 8 | Bookmarks | ★★ | 3-5 天 | ❌ | N/A | v1.1-3 |
| **P2** | 9 | Local History | ★★★ | 1-2 周 | ❌ | N/A | v1.2 |
| **P2** | 10 | Run Configurations | ★★ | 1 周 | ❌ | N/A | v1.1-2 |
| **P2** | 11 | Method Separators | ★ | 1-2 天 | ❌ | N/A | v1.1-2 |
| **JSP** | 1 | JSP 内 Java 补全 | ★★★★ | 3-4 周 | ✅ | 自定义 | v1.1-3 |
| **JSP** | 2 | EL 表达式补全 | ★★★ | 2 周 | ✅ | 自定义 | v1.1-3 |
| **JSP** | 3 | JSTL 标签补全 | ★★ | 1-2 周 | ✅ | JDT LS 部分 | v1.1-2 |
| **JSP** | 4 | JSP → Servlet 跳转 | ★★★ | 2 周 | ❌ | Tomcat 编译 | v1.2 |
| **JSP** | 5 | web.xml 编辑辅助 | ★★★ | 1-2 周 | ✅ | XML schema | v1.1-3 |
| **JSP** | 6 | TLD 补全（接线） | ★★ | 1 周 | ✅ | 已有 tld-parser.ts | v1.1-2 |
| **P3** | - | Debugger (4-6 周) | ★★★★★ | 4-6 周 | post-v1 | BLOCKERS B-004 | v1.2 |
| **P3** | - | JUnit Test Runner | ★★★ | 2-3 周 | ❌ | ✅ | v2.0 |
| **P3** | - | Database 工具 | ★★★★ | 4-6 周 | ❌ | N/A | v2.0（PRD 标 out of scope）|
| **P3** | - | AI 补全 | — | — | ❌ | — | 单独 roadmap（PRD 标 v1 不做）|

---

## 13. 结论与建议

### 13.1 三个最关键的事实修正

1. **MILESTONES.md 与实际代码严重不同步** —— `b95552a` 等 commit 已经接通了 Completion/Definition/Diagnostics，文档应更新。
2. **前两份分析错误地认为"Hover provider 已注册"** —— `java-monaco-registration.ts` 全文 grep 证明只注册了 completion + definition，**没有 hover provider**。
3. **LSP 协议层声明 9 个能力，代码层只接通 2 个** —— 这是 kairo-ide 与现代 Java IDE 最大的差距，但**修复成本最低**（参考第 1 层接线模式，单功能 200-800 行 + 1-3 天）。

### 13.2 v1 是否能 ship 的核心判断

PRD §7 第 3 条写"完整 JDT LS 补全和导航"，**当前不符合**。两个选择：

- **选项 A（推荐）**：v1 补齐 5 个 P0（Hover / References / Rename / Outline / Problems），共 2 周，**真正满足"完整"**。Debug 标 post-v1 与 PRD 一致。Terminal 建议同步集成。
- **选项 B（保守）**：v1 维持现状，修订 PRD §7 措辞为"核心 JDT LS 补全和导航"，剩余 7 个 LSP 能力放 v1.1。

### 13.3 Quick Win 路径（2-3 周）

按本文档 §8.2 的优先级，2-3 周内能让 kairo-ide 达到"可用 Java IDE"水平：
- 周 1：Hover + Outline + Signature Help
- 周 2：References + Rename + Problems View
- 周 3：CodeAction + Terminal + Go to Implementation

### 13.4 与前两份分析的关系

本文档**不替代**前两份，而是**补充**：
- 前两份覆盖了"功能清单"和"实现方案"
- 本文档提供"架构级根因"（LSP 接线残缺的具体位置）和"事实修正"（前两份的部分失真）
- 建议综合三份分析形成最终决策

### 13.5 对 JSP 老项目用户的额外建议

如果用户主要是 JSP 老项目维护，**JSP-1（JSP 内 Java 补全）和 JSP-5（web.xml 编辑辅助）的优先级应该上调到 P0**。这两个功能是日常高频场景，缺失时用户必须切到 IDEA 才能写 JSP。

---

> 本文档由 Mavis 模型基于 2026-07-21 当日代码（commit `db37f95`）生成，所有事实判断均可通过文中提供的文件路径和行号验证。
> 综合三份分析（DeepSeek-V4-Pro / TRAE v3 / Mavis）时请以三份的 P0 重叠项作为高置信度决策依据。
