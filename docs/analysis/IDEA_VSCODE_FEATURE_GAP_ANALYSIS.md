# Kairo IDE vs IDEA / VS Code — Java 后端开发功能差距分析报告

> 生成时间：2026-07-21
> 分析模型：DeepSeek-V4-Pro
> 分析范围：对比 IntelliJ IDEA 和 VS Code，针对 Java 后端开发（JSP/Servlet/老项目），分析 kairo-ide 缺失的核心功能
> 项目基线：最新 main 分支代码，Wave 0 Gate 已通过，Wave 4 Java 语言智能集成中

---

## 一、项目现状总结

### 1.1 已具备的功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 代码补全 (Completion) | 部分实现 | JDT LS 驱动，Monaco 注册了 completion provider，但 Wave 4 未完全验收 |
| 跳转到定义 (Go to Definition / F12) | 部分实现 | JDT LS 驱动，definition provider 已注册 |
| 悬停信息 (Hover) | 部分实现 | JDT LS 驱动，hover provider 已注册 |
| 诊断/错误提示 (Diagnostics) | 部分实现 | JDT LS publishDiagnostics → Monaco markers |
| JSP 语法高亮 | 已实现 | Monarch 语法定义 |
| 文件搜索 (文本/正则) | 已实现 | Go Agent 后端 + ripgrep，通过 `/api/v1/search` |
| 工作区管理 | 已实现 | 打开/关闭/持久化 workspace |
| 项目导入 | 已实现 | 导入向导，扫描 legacy 项目布局 |
| Tomcat 6 管理 | 已实现 | 启动/停止/部署/日志 |
| 构建 (Ant/javac) | 部分实现 | Ant/javac provider |
| 编码处理 (GBK/UTF-8) | 已实现 | BOM 检测 + 编码转换 |
| 文件浏览器 | 已实现 | Theia 原生 |
| 编辑器基础 | 已实现 | 多标签、分屏、撤销、多光标 |

### 1.2 架构关键信息

- **前端**：Theia + Monaco Editor
- **后端**：Go Runtime Agent (HTTP/WebSocket `/api/v1`)
- **Java 语言服务**：Eclipse JDT LS（通过 `vscode-jsonrpc` stdio 通信）
- **LSP 能力声明**：在 `jdt-ls-manager.ts` 的 `initialize` 中声明了 completion、hover、definition、references、documentSymbol、signatureHelp、rename、formatting、codeAction 等能力，但**前端只接线了 completion、definition、hover、diagnostics 四种**

---

## 二、缺失功能清单（按重要性排序）

### 等级说明

- **P0 — 必须**：没有这个功能，IDE 不可用于生产级 Java 开发
- **P1 — 重要**：严重影响开发效率，IDEA 用户日常依赖
- **P2 — 建议**：提升体验，但不是阻塞项

---

### 2.1 Java Debugger（Java 调试器） ⭐ P0 — 必须

**功能描述**：
在代码中设置断点（Breakpoint），当程序运行到断点时暂停执行，开发者可以逐行执行（Step Over/Into/Out）、查看变量值（Variables）、计算表达式（Evaluate Expression）、查看调用栈（Call Stack）、条件断点（Conditional Breakpoint）等。

**使用场景**：
- 排查运行时 Bug：Servlet 请求处理逻辑出错，需要看请求参数在哪个环节被篡改
- 理解 legacy 代码：老项目缺少文档，通过调试跟踪代码执行路径
- 验证修复：修完 Bug 后设断点确认新逻辑正确执行
- 远程调试：生产环境 Tomcat 连不上，通过 JDWP 远程 attach 调试

**IDEA 中怎么用**：
- 代码行号左侧点击设断点（红点）
- 右键断点 → 设置条件（如 `userId == null`）
- `F5` 启动 Debug 模式 → Tomcat 以 debug 模式启动
- 浏览器发 HTTP 请求 → 断点命中，IDE 自动切换到 Debug 视角
- Debug 面板显示：Frames（调用栈）、Variables（变量）、Watches（监视表达式）
- `F8` Step Over, `F7` Step Into, `Shift+F8` Step Out
- `Alt+F8` 打开 Evaluate Expression 窗口，实时执行任意 Java 代码

**VS Code 中怎么用**：
- 安装 Extension Pack for Java（含 Debugger for Java）
- 创建 `launch.json` 配置，选择 `Java: Attach to Remote Program`
- 同样支持断点、变量、调用栈、监视

**kairo-ide 当前状态**：
- 完全缺失。`/api/v1/servers/{id}/debug` 端点已存在但无实际实现
- 产品需求文档明确标注 Debug 为「deferred (post-v1)」
- BLOCKERS.md 记录了 B-004：JDWP debug adapter 对 Java 6 兼容性问题

**实现方案**：
1. Go Agent 端：在启动 Tomcat 时附加 JDWP 参数（如 `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=localhost:5005`）
2. Theia 端：集成 `vscode-java-debug`（基于 Eclipse JDI 的 DAP 适配器），或使用 Theia 原生 Debug API
3. 前端 UI：Debug 面板（Variables、Call Stack、Breakpoints、Watch）+ 编辑器断点标记
4. 协议层：扩展 `/api/v1/servers/{id}/debug` 端点，返回 JDWP 连接信息

**实现难度**：★★★★★（极高）
**实现周期**：4-6 周
**依赖**：需要解决 Java 6 JDWP 协议兼容性（BLOCKERS B-004）

---

### 2.2 Find References / Find Usages（查找引用） ⭐ P0 — 必须

**功能描述**：
选中一个类、方法、字段或变量，查找项目中所有引用它的位置。结果显示在搜索结果面板中，支持按文件/包分组，点击跳转。

**使用场景**：
- 重构前评估影响范围：修改 `UserService.login()` 方法签名前，需要知道所有调用方
- 删除废弃代码：确认某个字段/方法已无引用才能安全删除
- 理解代码逻辑：从某个 DAO 方法出发，追踪所有调用链
- 排查 Bug：某个字段被意外修改，查找所有写入位置

**IDEA 中怎么用**：
- 光标放在符号上 → `Alt+F7`（或右键 → Find Usages）
- 结果显示在 Find 工具窗口，按「项目」「包」「文件」分组
- 支持 Scope 筛选（Project、Module、Directory 等）
- 支持「Show Usages」预览（Ctrl+鼠标悬停）

**kairo-ide 当前状态**：
- LSP 能力声明中 `references: { dynamicRegistration: true }` 已声明
- 但前端 Java Language Client **没有实现 references provider**
- `jdt-ls-manager.ts` 的 `completion()` 和 `definition()` 方法存在，但**没有 `references()` 方法**

**实现方案**：
1. 在 `jdt-ls-manager.ts` 中添加 `references()` 方法，调用 `textDocument/references` LSP 请求
2. 在 `java-language-client.ts` 中暴露 `references()` 接口
3. 在 Monaco 中注册 Reference Provider
4. 前端显示 References 结果面板（可复用搜索面板）

**实现难度**：★★★☆☆（中等）
**实现周期**：1-2 周
**依赖**：JDT LS 已支持该 LSP 能力，只需前端接线

---

### 2.3 Rename Refactoring（重命名重构） ⭐ P0 — 必须

**功能描述**：
选中一个类、方法、变量或字段，一键重命名，IDE 自动更新所有引用位置。支持预览变更列表，确认后统一应用。

**使用场景**：
- 变量/方法命名规范化：`tmp` → `userSession`
- 类名重构：`UserDAO` → `UserRepository`
- 包名调整：移动类到新包时自动更新所有 import 语句
- 全局重命名：老项目中的拼音变量名改为英文

**IDEA 中怎么用**：
- 光标放在符号上 → `Shift+F6`
- 输入新名称 → IDE 实时预览所有变更位置
- 回车确认 → 所有引用同步更新（包括注释中的引用，可选）

**kairo-ide 当前状态**：
- LSP 能力声明中 `rename: { dynamicRegistration: true, prepareSupport: true }` 已声明
- 但前端**完全未实现**
- 这是一个零依赖的高价值功能，JDT LS 本身就支持

**实现方案**：
1. 在 `jdt-ls-manager.ts` 中添加 `rename()` 方法，调用 `textDocument/rename` + `textDocument/prepareRename`
2. 在 Monaco 中注册 Rename Provider
3. 前端实现 Rename 预览对话框

**实现难度**：★★☆☆☆（较低）
**实现周期**：3-5 天
**依赖**：JDT LS 已原生支持

---

### 2.4 Code Actions / Quick Fix（快速修复） ⭐ P0 — 必须

**功能描述**：
当代码有错误或警告时，IDE 提供一键修复建议。例如：未导入的类按 `Alt+Enter` 自动添加 import，未处理的异常自动添加 try-catch，未实现的方法自动生成 stub。

**使用场景**：
- 编译错误修复：`HttpServlet` 显示红色，按快捷键自动 `import javax.servlet.http.HttpServlet`
- 生成缺失方法：实现接口时自动生成所有方法 stub
- 异常处理：调用了抛出 checked exception 的方法，自动包裹 try-catch
- 类型转换：自动添加 cast
- 变量声明：自动创建局部变量/字段

**IDEA 中怎么用**：
- 光标在红色/黄色波浪线处 → `Alt+Enter`
- 弹出菜单列出所有可用修复方案
- 选择方案后自动应用

**kairo-ide 当前状态**：
- LSP 能力声明中 `codeAction: { dynamicRegistration: true }` 已声明
- 但前端**完全未实现**
- 这是老项目开发中**最高频**的功能之一

**实现方案**：
1. 在 `jdt-ls-manager.ts` 中添加 `codeAction()` 方法，调用 `textDocument/codeAction`
2. 在 Monaco 中注册 Code Action Provider
3. 前端实现灯泡图标 + 下拉菜单

**实现难度**：★★★☆☆（中等）
**实现周期**：1-2 周
**依赖**：JDT LS 已支持，但需要处理 `workspace/applyEdit` 来应用复杂的代码修改

---

### 2.5 Go to Implementation（跳转到实现） ⭐ P1 — 重要

**功能描述**：
从接口方法跳转到其具体实现类，或从抽象方法跳转到子类实现。与 Go to Definition 不同，Definition 跳转到声明处，Implementation 跳转到具体实现。

**使用场景**：
- 查看接口的实现：`UserService` 接口 → 跳转到 `UserServiceImpl`
- 查看抽象方法实现：`doPost()` → 跳转到具体 Servlet 子类的实现
- 查看继承链：某个方法被子类 override 了哪些地方

**IDEA 中怎么用**：
- 光标放在接口方法上 → `Ctrl+Alt+B`（或 `Cmd+Option+B`）
- 如果有多个实现，弹出列表选择

**kairo-ide 当前状态**：
- LSP 能力声明中 `implementation: { dynamicRegistration: true, linkSupport: true }` 已声明
- 但前端**完全未实现**

**实现方案**：
1. 在 `jdt-ls-manager.ts` 中添加 `implementation()` 方法
2. 在 Monaco 中注册 Implementation Provider

**实现难度**：★★☆☆☆（较低）
**实现周期**：2-3 天
**依赖**：JDT LS 已支持

---

### 2.6 Document Symbols / Outline（文档大纲/符号列表） ⭐ P1 — 重要

**功能描述**：
显示当前 Java 文件的结构概览，包括类、方法、字段等。在侧边栏以树形结构展示，点击可快速跳转。等效于 IDEA 的 Structure 视图。

**使用场景**：
- 快速导航：打开一个 2000 行的 Servlet，通过 Outline 直接跳到 `doPost()` 方法
- 概览类结构：快速了解一个类有哪些方法和字段
- 大文件定位：老项目遗留的巨型 Java 文件中快速定位目标方法

**IDEA 中怎么用**：
- `Alt+7` 打开 Structure 面板（或 `Ctrl+F12` 弹出）
- 树形展示：类 → 方法 → 内部类
- 支持排序（按名称/按源码顺序）
- 支持过滤（输入关键词缩小范围）

**kairo-ide 当前状态**：
- LSP 能力声明中 `documentSymbol: { dynamicRegistration: true }` 已声明
- UI Spec 中设计了 Outline 面板（右侧区域：Java Type Hierarchy）
- 但**前端未实现**

**实现方案**：
1. 在 `jdt-ls-manager.ts` 中添加 `documentSymbol()` 方法
2. 在 Monaco 中注册 Document Symbol Provider
3. 前端实现 Outline 树形面板（Theia 有现成的 Outline View 可复用）

**实现难度**：★★☆☆☆（较低）
**实现周期**：3-5 天
**依赖**：JDT LS 已支持

---

### 2.7 Search Everywhere / Go to File / Go to Symbol（全局搜索） ⭐ P1 — 重要

**功能描述**：
一个统一的搜索入口，输入关键词可以同时搜索：
- Go to File（`Ctrl+P`）：按文件名搜索
- Go to Symbol（`Ctrl+T`）：按类名/方法名搜索
- 更广义的 Search Everywhere（双击 Shift）：搜索文件、类、符号、IDE 设置

**使用场景**：
- 打开文件：知道文件名 `HelloServlet.java`，按 `Ctrl+P` 输入 `hello` 即可定位
- 跳转类：记住类名 `UserService`，按 `Ctrl+T` 输入 `user` 直接跳转
- 老项目文件多：几十个 JSP、Servlet，快速定位目标文件

**IDEA 中怎么用**：
- 双击 `Shift`：Search Everywhere（搜索一切）
- `Ctrl+N`：Go to Class（搜索类）
- `Ctrl+Shift+N`：Go to File（搜索文件）
- `Ctrl+Alt+Shift+N`：Go to Symbol（搜索符号）

**kairo-ide 当前状态**：
- UI Spec 中定义了 `Ctrl+P`（Quick Open File）和 `Ctrl+T`（Open Symbol）快捷键
- 但**实际未实现**
- 目前只有文件搜索（文本内容搜索），没有按文件名/符号名搜索

**实现方案**：
1. 基于 Theia 的 Quick Open 基础设施实现文件搜索
2. 利用 JDT LS 的 `workspace/symbol` 请求实现符号搜索
3. 合并为统一的 Search Everywhere 弹窗

**实现难度**：★★★☆☆（中等）
**实现周期**：1-2 周
**依赖**：Theia 有 QuickOpen 基础组件

---

### 2.8 Code Formatting（代码格式化） ⭐ P1 — 重要

**功能描述**：
自动格式化 Java 代码，统一缩进、换行、空格、括号风格等。支持自定义格式化规则（如每行最大字符数、大括号位置等）。

**使用场景**：
- 老项目代码风格混乱：缩进不统一（空格/Tab 混用），格式化后一致
- 团队协作：提交前格式化确保代码风格一致
- 粘贴代码：从别处复制代码后格式化

**IDEA 中怎么用**：
- `Ctrl+Alt+L` 格式化当前文件
- 设置 → Editor → Code Style → Java 配置格式化规则
- 支持格式化选定区域

**kairo-ide 当前状态**：
- LSP 能力声明中 `formatting: { dynamicRegistration: true }` 已声明
- JDT LS 初始化选项中 `java.format.enabled: true`
- 但**前端未实现格式化功能**

**实现方案**：
1. 在 `jdt-ls-manager.ts` 中添加 `formatting()` 方法
2. 在 Monaco 中注册 Document Formatting Provider
3. 绑定快捷键 `Ctrl+Alt+L`

**实现难度**：★★☆☆☆（较低）
**实现周期**：2-3 天
**依赖**：JDT LS 已支持

---

### 2.9 Organize Imports（组织导入） ⭐ P1 — 重要

**功能描述**：
自动整理 Java 文件的 import 语句：删除未使用的 import、添加缺失的 import、排序 import、合并同包的 import 为 `*`。

**使用场景**：
- 删除代码后遗留了无用的 import
- 粘贴代码后缺少 import
- 老项目中有大量未使用的 import 语句

**IDEA 中怎么用**：
- `Ctrl+Alt+O` 优化 import
- 设置 → Editor → Code Style → Java → Imports 配置规则

**kairo-ide 当前状态**：
- 初始化选项中 `advancedOrganizeImportsSupport: true` 已声明
- 但**前端未实现**

**实现方案**：
1. 利用 JDT LS 的 `textDocument/codeAction` 中 `source.organizeImports` 类型
2. 绑定快捷键 `Ctrl+Alt+O`

**实现难度**：★★☆☆☆（较低）
**实现周期**：1-2 天
**依赖**：依赖 Code Actions 功能

---

### 2.10 Call Hierarchy（调用层次结构） ⭐ P1 — 重要

**功能描述**：
查看某个方法的调用链：谁调用了这个方法（Caller），这个方法调用了谁（Callee）。以树形结构展示，支持展开多级调用链。

**使用场景**：
- 理解代码流程：从 `doPost()` 开始，追踪所有方法调用链
- 影响分析：修改 `validateUser()` 方法前，查看所有调用方
- 老项目代码理解：没有文档时通过调用链理解业务逻辑

**IDEA 中怎么用**：
- 光标放在方法上 → `Ctrl+Alt+H`
- 左侧面板显示 Call Hierarchy 树
- 切换 Caller / Callee 视图

**kairo-ide 当前状态**：
- 完全缺失。LSP 中有 `callHierarchy` 协议（3.16+），但 JDT LS 的初始化参数中未声明，前端也未实现

**实现方案**：
1. 确认 JDT LS 版本是否支持 `textDocument/prepareCallHierarchy` + `callHierarchy/incomingCalls` + `callHierarchy/outgoingCalls`
2. 在 jdt-ls-manager 中添加相关方法
3. 前端实现 Call Hierarchy 树形面板

**实现难度**：★★★★☆（较高）
**实现周期**：1-2 周
**依赖**：需要 JDT LS 1.35+ 的 callHierarchy 支持

---

### 2.11 Type Hierarchy（类型层次结构） ⭐ P1 — 重要

**功能描述**：
查看某个类/接口的继承关系：父类、子类、接口实现。以树形结构展示。

**使用场景**：
- 理解继承关系：`BaseServlet` → `AbstractServlet` → `ConcreteServlet` 的继承链
- 查看接口实现：`Serializable` 接口有哪些类实现了
- 老项目重构：理解复杂的继承体系

**IDEA 中怎么用**：
- 光标放在类名上 → `Ctrl+H`
- 显示 Type Hierarchy 面板，包含 Supertypes 和 Subtypes

**kairo-ide 当前状态**：
- LSP 中有 `typeHierarchy` 协议（3.16+），但 JDT LS 初始化参数中未声明
- UI Spec 中设计了 Type Hierarchy 面板

**实现方案**：
1. 确认 JDT LS 是否支持 typeHierarchy
2. 在 jdt-ls-manager 中添加相关方法
3. 前端实现 Type Hierarchy 树形面板

**实现难度**：★★★★☆（较高）
**实现周期**：1-2 周
**依赖**：需要 JDT LS 的 typeHierarchy 支持

---

### 2.12 Git / Version Control Integration（版本控制集成） ⭐ P1 — 重要

**功能描述**：
在 IDE 内完成 Git 操作：查看文件变更（Diff）、提交（Commit）、推送（Push）、分支管理（Branch）、查看历史（Log）、解决冲突（Merge Conflict）、Blame 注解等。

**使用场景**：
- 日常提交：修改代码后直接在 IDE 内 commit + push
- 代码审查：查看某个文件的修改历史，了解谁改了什么
- 分支管理：创建 feature 分支、切换分支、合并分支
- 冲突解决：合并时在 IDE 内可视化解决冲突

**IDEA 中怎么用**：
- `Alt+9` 打开 Git 面板
- 左侧 Commit 面板显示变更文件列表
- 双击文件查看 Diff 对比
- `Ctrl+K` 提交，`Ctrl+Shift+K` 推送
- 右键 → Git → Show History 查看文件历史
- 代码行号左侧显示 Git Blame 信息

**kairo-ide 当前状态**：
- 完全缺失。项目中没有 Git 相关的扩展或集成
- 产品需求文档中将 Git 相关功能列为「out of scope for v1」

**实现方案**：
1. Theia 有内置的 Git 扩展（`@theia/git`），可直接集成
2. 配置 Git 操作的前端 UI（变更列表、Diff 编辑器、提交面板）
3. 绑定 Git 快捷键

**实现难度**：★★★☆☆（中等 — 可复用 Theia 内置 Git 支持）
**实现周期**：1-2 周
**依赖**：Theia 原生 Git 支持

---

### 2.13 Integrated Terminal（集成终端） ⭐ P1 — 重要

**功能描述**：
在 IDE 内嵌终端，可以直接执行命令行操作，如 `mvn clean install`、`git status`、`tail -f catalina.out` 等，无需切换到外部终端。

**使用场景**：
- 执行 Maven/Ant 命令
- 查看 Tomcat 日志
- Git 命令行操作
- 快速执行脚本

**IDEA 中怎么用**：
- `Alt+F12` 打开/关闭终端
- 支持多标签终端
- 支持分屏

**kairo-ide 当前状态**：
- 完全缺失。项目中没有终端相关的扩展
- UI Spec 中设计了 Bottom Panel 的 Terminal 标签页

**实现方案**：
1. Theia 有内置终端扩展（`@theia/terminal`），可直接集成
2. 配置终端在 Bottom Panel 中显示

**实现难度**：★★☆☆☆（较低 — 可复用 Theia 内置终端）
**实现周期**：3-5 天
**依赖**：Theia 原生终端支持

---

### 2.14 Java Code Generation（代码生成） ⭐ P1 — 重要

**功能描述**：
自动生成常见 Java 代码结构：Getters/Setters、构造函数、toString()、equals()/hashCode()、Delegate Methods、Override Methods 等。

**使用场景**：
- 创建新 POJO/DTO：一键生成所有 Getter/Setter
- 实现接口：自动生成方法 stub
- 重写父类方法：自动生成 override 方法

**IDEA 中怎么用**：
- `Alt+Insert`（或 `Cmd+N`）→ 弹出 Generate 菜单
- 选择 Getter、Setter、Constructor、toString 等
- 勾选需要的字段后一键生成

**kairo-ide 当前状态**：
- 初始化选项中声明了 `overrideMethodsPromptSupport`、`hashCodeEqualsPromptSupport`、`generateToStringPromptSupport`、`advancedGenerateAccessorsSupport`、`generateConstructorsPromptSupport`、`generateDelegateMethodsPromptSupport`
- 但**前端未实现**

**实现方案**：
1. 利用 JDT LS 的 `workspace/executeCommand` 执行 `java.generate.*` 系列命令
2. 前端实现 Generate 右键菜单

**实现难度**：★★★☆☆（中等）
**实现周期**：1-2 周
**依赖**：JDT LS 已支持 generate 命令

---

### 2.15 Problems View / Error List（问题面板） ⭐ P1 — 重要

**功能描述**：
集中展示整个项目中的所有错误和警告，按文件/严重级别分组，支持点击跳转到对应位置。

**使用场景**：
- 编译后查看全局错误清单
- 代码审查时快速定位问题文件
- 修复所有编译错误后再运行

**IDEA 中怎么用**：
- `Alt+6` 打开 Problems 面板
- 显示所有文件的错误/警告列表
- 双击跳转到错误位置

**kairo-ide 当前状态**：
- 诊断信息已通过 JDT LS 的 `publishDiagnostics` 推送到 Monaco
- 但**没有全局 Problems 面板**汇总所有文件的诊断信息
- UI Spec 中设计了 Bottom Panel 的 Problems 标签页

**实现方案**：
1. 收集所有文件的 diagnostics 并汇总到 Problems 面板
2. 前端实现 Problems 列表组件（UI Spec 中已有 `KairoProblemsList`）

**实现难度**：★★☆☆☆（较低）
**实现周期**：3-5 天
**依赖**：Diagnostics 数据已就绪，只需汇总展示

---

### 2.16 JUnit Test Runner（测试运行器） ⭐ P2 — 建议

**功能描述**：
在 IDE 内直接运行 JUnit 测试，显示测试结果（通过/失败/跳过），支持运行单个测试方法、单个测试类或整个测试套件。

**使用场景**：
- 运行单元测试验证代码
- 回归测试
- 修改代码后快速验证

**IDEA 中怎么用**：
- 测试方法左侧有绿色运行按钮
- 点击运行单个测试
- 测试结果面板显示通过/失败详情

**kairo-ide 当前状态**：
- 完全缺失。JDT LS 有 JUnit 相关插件但未集成

**实现难度**：★★★★☆（较高）
**实现周期**：2-3 周

---

### 2.17 Local History（本地历史） ⭐ P2 — 建议

**功能描述**：
IDE 自动保存文件的修改历史，即使没有 Git 也可以回退到之前的版本。支持按时间查看变更、对比差异、恢复特定版本。

**使用场景**：
- 误删代码后恢复
- 对比当前版本和 1 小时前的版本
- 撤回到某个中间状态

**IDEA 中怎么用**：
- 右键文件 → Local History → Show History
- 左侧显示所有历史版本的时间戳
- 右侧 Diff 对比

**kairo-ide 当前状态**：
- 完全缺失

**实现难度**：★★★☆☆（中等）
**实现周期**：1-2 周

---

### 2.18 Maven / Gradle Integration（构建工具集成） ⭐ P2 — 建议

**功能描述**：
识别 Maven 的 `pom.xml` 或 Gradle 的 `build.gradle`，自动管理依赖、下载源码、提供构建生命周期可视化。

**使用场景**：
- 项目管理：添加/删除依赖
- 依赖分析：查看依赖树
- 构建生命周期：clean → compile → test → package

**kairo-ide 当前状态**：
- JDT LS 插件中包含 `org.eclipse.m2e.*`（Maven 支持），但前端未集成
- 项目主要面向 Ant/javac 老项目，Maven 支持优先级较低

**实现难度**：★★★★☆（较高）
**实现周期**：2-3 周

---

## 三、功能优先级排序

| 优先级 | 功能 | 实现难度 | 实现周期 | 是否阻塞 v1 |
|--------|------|----------|----------|------------|
| P0 | Java Debugger | ★★★★★ | 4-6 周 | 否（已 defer 到 post-v1） |
| P0 | Find References | ★★★☆☆ | 1-2 周 | 建议纳入 v1 |
| P0 | Rename Refactoring | ★★☆☆☆ | 3-5 天 | 建议纳入 v1 |
| P0 | Code Actions / Quick Fix | ★★★☆☆ | 1-2 周 | 建议纳入 v1 |
| P1 | Go to Implementation | ★★☆☆☆ | 2-3 天 | 否 |
| P1 | Document Symbols / Outline | ★★☆☆☆ | 3-5 天 | 否 |
| P1 | Search Everywhere / Go to File | ★★★☆☆ | 1-2 周 | 否 |
| P1 | Code Formatting | ★★☆☆☆ | 2-3 天 | 否 |
| P1 | Organize Imports | ★★☆☆☆ | 1-2 天 | 否 |
| P1 | Call Hierarchy | ★★★★☆ | 1-2 周 | 否 |
| P1 | Type Hierarchy | ★★★★☆ | 1-2 周 | 否 |
| P1 | Git Integration | ★★★☆☆ | 1-2 周 | 否 |
| P1 | Integrated Terminal | ★★☆☆☆ | 3-5 天 | 否 |
| P1 | Java Code Generation | ★★★☆☆ | 1-2 周 | 否 |
| P1 | Problems View | ★★☆☆☆ | 3-5 天 | 否 |
| P2 | JUnit Test Runner | ★★★★☆ | 2-3 周 | 否 |
| P2 | Local History | ★★★☆☆ | 1-2 周 | 否 |
| P2 | Maven/Gradle Integration | ★★★★☆ | 2-3 周 | 否 |

---

## 四、IDEA 体验对标关键点

如果目标是让 kairo-ide 的界面和 IDEA 比较相似，以下是需要重点对齐的 UI/UX 层面：

### 4.1 布局
- IDEA 的 Project 视图（左侧）→ kairo 已有 Explorer，但缺少包视图（Package View）
- IDEA 的 Structure 面板（左侧底部）→ kairo 未实现
- IDEA 的底部面板（Problems / Terminal / Version Control / Run / Debug）→ kairo 部分实现

### 4.2 编辑器
- IDEA 的代码折叠（Code Folding）→ Monaco 支持，需确认启用
- IDEA 的 Breadcrumb 导航（编辑器顶部路径栏）→ 未实现
- IDEA 的 Gutter Icon（行号左侧的图标：断点、实现、覆盖、错误标记）→ 部分实现
- IDEA 的 Parameter Info（方法参数提示）→ LSP signatureHelp 已声明但未实现
- IDEA 的 Quick Documentation（`Ctrl+Q` 弹出文档）→ Hover 已有，但缺少独立弹窗

### 4.3 导航
- IDEA 的 Recent Files（`Ctrl+E`）→ 未实现
- IDEA 的 Last Edit Location（`Ctrl+Shift+Backspace`）→ 未实现
- IDEA 的 Back/Forward Navigation（`Ctrl+Alt+Left/Right`）→ 未实现
- IDEA 的 Bookmarks（`F11`）→ 未实现

### 4.4 快捷键体系
- UI Spec 中已定义了一套与 IDEA 一致的快捷键体系，但大部分功能未实现
- 快捷键与实际功能的绑定需要完善

---

## 五、v1 范围内的建议

根据产品需求文档，v1 的 success criteria 是：
1. 导入 GBK、JDK 1.6、Tomcat 6 项目 ✓
2. 文件树 + 编码检测 ✓
3. 编辑 .java 文件 + JDT LS 补全和导航 ✓（部分）
4. 一键运行 Tomcat 6 ✓
5. JSP 保存后浏览器可见 ✓
6. 同一项目在桌面版和浏览器版都能运行 ✓

**v1 强烈建议补充的功能**（不影响 v1 发布但极大提升可用性）：
- **Find References**（P0）— 实现难度中等，JDT LS 已支持
- **Rename Refactoring**（P0）— 实现难度低，JDT LS 已支持
- **Code Actions**（P0）— 实现难度中等，JDT LS 已支持
- **Search Everywhere / Go to File**（P1）— 实现难度中等
- **Problems View**（P1）— 实现难度低

**post-v1 必须实现的功能**：
- **Java Debugger**（P0）— 产品需求文档已明确 defer
- **Git Integration**（P1）— 可复用 Theia 内置支持
- **Integrated Terminal**（P1）— 可复用 Theia 内置支持

---

## 六、对 JSP 老项目的特殊考虑

kairo-ide 的目标用户是维护 JDK 6 / Tomcat 6 / JSP / Servlet 老项目的开发者，以下功能对这类项目特别重要：

1. **JSP 文件内的 Java 代码补全**（JSP scriptlet 中的 Java 代码）— 目前只有 JSP 语法高亮，没有 JSP 内的 Java 补全
2. **JSP ↔ Servlet 跳转**（从 JSP 跳转到编译后的 Servlet 源码）— 未实现
3. **web.xml 编辑辅助**（Servlet mapping、filter 配置等）— 未实现
4. **TLD（Tag Library Descriptor）支持**（自定义标签的补全和验证）— `tld-parser.ts` 已存在但可能未集成到编辑器
5. **JSP 调试**（在 JSP 中设断点）— 未实现，依赖 Java Debugger

---

## 七、总结

### 当前最大差距（按影响程度排序）

1. **Java Debugger** — 最大的功能缺口，但已明确 defer 到 post-v1
2. **Find References** — JDT LS 已支持，前端未接线，属于「低垂的果实」
3. **Code Actions / Quick Fix** — 老项目开发中最高频使用的功能之一
4. **Rename Refactoring** — 实现难度低，JDT LS 原生支持
5. **Search Everywhere** — 大项目中快速定位文件的基础能力
6. **Git Integration** — 任何现代 IDE 的标配
7. **Integrated Terminal** — 日常开发必备

### 快速见效的路径

如果要在 2-3 周内让 kairo-ide 更像一个「真正的 IDE」，建议优先实现：
1. Find References（1-2 周）
2. Rename Refactoring（3-5 天）
3. Code Actions / Quick Fix（1-2 周）
4. Document Symbols / Outline（3-5 天）
5. Code Formatting（2-3 天）
6. Problems View（3-5 天）

这些功能的共同特点是：**JDT LS 已经支持，只需前端接线**，实现难度低，效果立竿见影。

---

> 本文档将作为后续功能迭代的参考基线。建议与其他模型的分析结果进行交叉验证，综合得出最终的功能优先级列表。