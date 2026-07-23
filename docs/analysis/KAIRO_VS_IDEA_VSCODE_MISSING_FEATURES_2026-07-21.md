# Kairo IDE vs IntelliJ IDEA / VS Code — Java 后端开发缺失功能分析

> 作者: MiniMax-M3 (kairo-ide 项目深度分析)
> 日期: 2026-07-21
> 分析对象: 本地工作区 `/Users/qi/Documents/spaces/kairo-ide` (分支 `qa/kimi-mac-web-20260720-65210d5`, 与 `main` 对比)
> 用途: 横向对比 Kairo IDE 当前实现 与 IDEA / VS Code 在 Java 后端开发上的差距,作为后续功能开发的输入

---

## 0. 阅读说明

- 每个功能点都给出:
  - **是什么 / 怎么用 / 场景**: 在 IDEA / VS Code 里的真实使用方式
  - **Kairo 现状**: 当前已实现 / 部分实现 / 缺失
  - **证据文件**: 实际代码位置
  - **必须性**: P0(必备)/ P1(重要)/ P2(增值)
  - **实现难度**: ★(1-5)/ 周期: 人·周
  - **建议实现路径**: 落点(前端 / 后端 / 配置)

---

## 1. 项目基线快照 (本次分析基于的事实)

| 维度 | 现状 | 证据 |
|------|------|------|
| 平台 | Theia 1.73.1 + Monaco 1.108.201 | `packages/theia-product/package.json` |
| 形态 | Electron Desktop + 浏览器 Localhost | `apps/desktop`, `apps/browser` |
| 后端 | Go Runtime Agent(单一进程) | `runtime-agent/cmd/kairo-runtime/main.go` |
| Java 编译 | 真实 javac + Ant 1.6 兼容 | `BLOCKERS.md` B-001, B-002 |
| Java 智能 | JDT LS 1.55.0 (bundled/jdtls) 已就绪,但**仅完成** Completion + Definition + Diagnostics;**没有** Hover/Refactor/Format/SignatureHelp/Rename/Reference | `packages/java-extension/src/browser/java-monaco-registration.ts` |
| 调试 | `/api/v1/servers/{id}/debug` 端点存在,**无 DAP 适配** | `MILESTONES.md` 标 `deferred (post-v1)` |
| JSP | Monarch 词法高亮(基础 directive/scriptlet/EL/JSTL),**没有** Java 内嵌高亮,没有 taglib 补全,没有 EL 校验 | `packages/jsp-extension/src/browser/jsp-monarch.ts` |
| 搜索 | 后端 ripgrep(Go) + 前端 `KairoSearchService`(debounce/cancel) + Theia `@theia/search-in-workspace` 已声明,**但没有任何 tsx 视图组件**,即没有"Search"侧边栏 UI | `packages/search-extension/src/browser/search-service.ts`, `packages/search-extension` 目录下无 `*.tsx` |
| Outline | `@theia/outline-view` 已声明依赖,但**未在 `kairo-views-contribution` 中注册** | `packages/theia-product/src/main/browser/kairo-views-contribution.ts` |
| 主题 | Kairo Dark 自定义主题(3-tone 灰 + 紫色) | `packages/ui-kit/src/browser/kairo-theme.ts` |
| 文件树 | 走 Theia 自带 Navigator | Theia `@theia/navigator` |
| 状态栏 | Project / Encoding / JDT LS / Server / Runtime 5 项 | `packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts` |
| VCS | 完全没有 Git/SCM 集成 | grep `git` 在 `packages/` 几乎无业务代码 |
| 测试 | 没有 JUnit/TestNG 集成 | `bundled/jdtls/plugins/` 含 jdt.junit 4 但未使用 |
| 终端 | Theia `@theia/terminal` 已声明,但未验证是否注册 | `package.json` |
| 数据库 | 无;BLOCKERS / 产品定位里**不做** | `product-requirements.md` §2.2 |
| AI 补全 | 明确**不做**(低规格目标) | `product-requirements.md` §5 |

---

## 2. P0 必备功能(必须做,否则不算"能用")

### P0-1 · Debug — Java 后端的命根子

| 项 | 内容 |
|----|------|
| **是什么** | 在 JSP/Servlet 业务代码里下断点,启动 Tomcat 时带 JDWP 参数,挂上调试器后能 Step Over/Into/Out、查看变量、Watch、Condition、断点命中后 Evaluate 表达式、Console 输出 |
| **怎么用(IDEA)** | 在行号栏点击下断点 → 右上角 Debug 按钮(甲壳虫图标)启动 → Run/Debug 工具窗口显示 Frames + Variables + Watches + Console → F8/F7/Shift+F8 单步 → Alt+F8 Evaluate |
| **怎么用(VS Code)** | 安装 Java Extension Pack → 左侧 Run and Debug 视图 → 弹出的 debug 配置(`launch.json`) 自动检测 Java 项目 → 断点、变量、Watch、Call Stack、Debug Console 同 IDEA |
| **场景** | JSP 跳到 Servlet 后参数值错了、循环里某次 i 异常、SQL 查出来 null 但代码逻辑没问题 — 任何"线上报错但本地复现不出"的情况 |
| **Kairo 现状** | ❌ **完全缺失**。`@theia/debug` 在 package.json 里,但**没有 DAP client 适配、没有 JDWP transport、没有 breakpoint→hit 证明**。`MILESTONES.md` 标记 deferred(post-v1)。`BLOCKERS.md` B-004 也承认了 Java 6 JDWP 的兼容性难点。`kairo-views-contribution.ts` 注册了 `KairoCommands.DEBUG_SERVER` 但只是调用 `serverSvc.start(p.projectId, true)` — 并没有真正挂调试器 |
| **证据** | `packages/theia-product/src/main/browser/kairo-views-contribution.ts:312-323` `MILESTONES.md:79-91` `BLOCKERS.md:70-89` `architecture.md:215` |
| **必须性** | **P0 — 不做这个,Kairo 永远不能替代 IDEA** |
| **实现难度** | ★★★★★ |
| **周期** | 6-10 人·周 |
| **建议路径** | (1) Go Agent: 实现 `DebugAdapterProvider` 接口,JDT LS 自带 `org.eclipse.jdt.ls.debug` DAP 适配器,通过 LSP `/jdtls/launch` 启动挂 JDWP 的 Java 进程。(2) Theia 端: 实现 `DebugConfigurationProvider` + `DebugSessionManager`,复用 `@theia/debug`。(3) 前端: 用 Theia 的 `BreakpointManager` + `DebugWidget`。Java 6 兼容性走 BLOCKERS B-004 的兜底方案(用 JDI 桥接) |

---

### P0-2 · 全工程搜索 / Find in Path(带结果面板)

| 项 | 内容 |
|----|------|
| **是什么** | 跨整个工作区搜索一个字符串/正则,**带左侧结果树、文件分组、Preview 面板、单文件跳转** |
| **怎么用(IDEA)** | `Ctrl+Shift+F` 弹出 Find in File 工具窗口,输入 query → 右侧实时显示匹配列表(按文件分组) → 双击跳转到具体行 → 工具栏有 Regex / Case Sensitive / Whole Words / File Mask(`*.java,!*.class` 等)→ Replace in Path 直接替换 |
| **怎么用(VS Code)** | 左侧放大镜图标 → Search 侧边栏 → 输入框 + 行内 regex/case/whole-word 开关 → 结果按文件分组 + 上下文预览 + replace 输入框 |
| **场景** | "找哪个 Servlet 调用了 `getUserById`" / "全局替换日志格式 `LOG.info(` → `LOG.warn(`" / "找哪些 JSP 引用了 `taglib uri="/WEB-INF/struts-bean.tld"`" |
| **Kairo 现状** | ⚠️ **后端 OK,前端 UI 残缺**。后端 `POST /api/v1/search` 已经实现 ripgrep 调用(`runtime-agent/internal/search/`);前端 `KairoSearchService` 实现了 debounce + cancel + 错误转译;`@theia/search-in-workspace` 包在 `package.json` 声明依赖。但**`packages/search-extension` 目录下没有任何 `.tsx`**,即**没有"Search"侧边栏视图组件**。用户既看不到搜索框,也看不到结果列表 |
| **证据** | `packages/search-extension/src/browser/search-service.ts` (66 行,只有 service,没有 widget) / `packages/search-extension` Glob `*.tsx` 返回 No files found |
| **必须性** | **P0 — 没有这个,改一个全局变量名等于逐个文件搜** |
| **实现难度** | ★★ |
| **周期** | 1-2 人·周 |
| **建议路径** | 写 `search-view-widget.tsx`(ReactWidget)+ Theia `SearchInWorkspace` 适配,把 KairoSearchService 接到 `@theia/search-in-workspace` 的 `SearchService` 上,直接复用 Theia 官方 Search 视图 + Kairo 后端做"replacing ripgrep" |

---

### P0-3 · Go to Class / Go to File / Go to Symbol(项目级符号导航)

| 项 | 内容 |
|----|------|
| **是什么** | 在工作区里**用类名/文件路径/符号名**直接跳转,**支持驼峰前缀缩写**(`UserService` 输 `US` 就出来) |
| **怎么用(IDEA)** | `Ctrl+N` Go to Class / `Ctrl+Shift+N` Go to File / `Ctrl+Alt+Shift+N` Go to Symbol。**支持搜 jar 包里的 class、project 里的 class、目录里的 file**。支持 `MyClass.foo` 直接定位到字段 |
| **怎么用(VS Code)** | `Ctrl+P` 文件 / `Ctrl+T` 符号(工作区) / `Ctrl+Shift+O` 当前文件符号 |
| **场景** | "我要看 UserDao" 输 `UD` → 跳过去。`Ctrl+N` 找到 `org.apache.struts.action.Action` 查源码 |
| **Kairo 现状** | ❌ **完全没有**。JDT LS 实际支持 `textDocument/documentSymbol` 和 `workspace/symbol`,但 Kairo **没有注册 Monaco 的 `registerDocumentSymbolProvider` 也没注册 workspace symbol provider** |
| **证据** | `packages/java-extension/src/browser/java-monaco-registration.ts` 只有 completion + definition 两个 register。`@theia/outline-view` 声明了但未接线 |
| **必须性** | **P0** |
| **实现难度** | ★★ |
| **周期** | 1-2 人·周 |
| **建议路径** | (1) `JavaMonacoRegistrationContribution` 加 `registerDocumentSymbolProvider` + `OutlineContentProvider` 接 `@theia/outline-view`。(2) 后端协议加 `workspace/symbol` 透传到 JDT LS。前端用 Theia 的 Quick Open(`@theia/quick-open`)加一个 namespace-filtered 输入框 |

---

### P0-4 · Find Usages / References

| 项 | 内容 |
|----|------|
| **是什么** | 在方法/类/字段上右键 → Find Usages → **列出整个工作区里所有引用点**,按文件分组,能跳、能分组(Read/Write/Method call/Import 等) |
| **怎么用(IDEA)** | 光标放在符号上 → `Alt+F7`(默认在 Editor) / `Ctrl+Alt+F7`(在弹窗里)→ Find 工具窗口显示所有引用 → 双击跳转 |
| **场景** | "改 `User.getName()` 前看看哪些地方在调用" / "哪个 Service 注入了这个 Dao" |
| **Kairo 现状** | ❌ **完全没有**。JDT LS 支持 `textDocument/references`,但 Kairo 只暴露了 `definition` (`jdt-ls-manager.ts` / `JdtLsBackendService` 接口) |
| **证据** | `packages/java-extension/src/common/java-ls-protocol.ts:30` `JdtLsBackendService.$definition` 是唯一定位 API |
| **必须性** | **P0** |
| **实现难度** | ★★ |
| **周期** | 1-2 人·周 |
| **建议路径** | 后端 `$references` 接 JDT LS `textDocument/references` → 前端 register ReferenceProvider → Theia `@theia/callhierarchy` 或自建 ReactWidget 显示树形结果 |

---

### P0-5 · Outline / Structure View(文件结构大纲)

| 项 | 内容 |
|----|------|
| **是什么** | 编辑器右上角/左侧实时显示**当前 Java 文件的类/方法/字段/import 树**;点击节点跳转到对应行 |
| **怎么用(IDEA)** | View → Tool Windows → Structure / `Ctrl+F12` File Structure 弹窗(只显示本类成员) |
| **怎么用(VS Code)** | Explorer 面板的 OUTLINE 折叠区 |
| **场景** | 一个 800 行的 Servlet,想跳到 `doPost` 方法 |
| **Kairo 现状** | ❌ **声明了但未接线**。`@theia/outline-view` 在 `package.json`,但 `kairo-views-contribution.ts` 的 `registerViewContainers` 是空实现,Outline 视图不会自动出现 |
| **证据** | `packages/theia-product/src/main/browser/kairo-views-contribution.ts:409-416` 空方法 |
| **必须性** | **P0**(对一个老 JSP 项目特别重要 — 经常一个 .java 文件 1000+ 行) |
| **实现难度** | ★ |
| **周期** | 0.5-1 人·周 |
| **建议路径** | 给 `JavaMonacoRegistrationContribution` 加 `monaco.languages.registerDocumentSymbolProvider` + 写一个 `KairoOutlineContribution extends OutlineContribution`,复用 Theia `@theia/outline-view` 的视图。JSP 文件可以加一个**粗粒度 outline**(找 `<%!` / `<%@ page` / `<%--` 注释作为顶层节点) |

---

### P0-6 · Refactor(项目级重构)

| 项 | 内容 |
|----|------|
| **是什么** | Rename(项目级所有引用一起改)/ Extract Method / Extract Variable / Inline / Change Signature / Move Class |
| **怎么用(IDEA)** | `Shift+F6` Rename → 弹输入框 → 全工作区预览变更 → Confirm 一次完成 / `Ctrl+Alt+M` Extract Method / `Ctrl+Alt+V` Extract Variable / `Ctrl+Alt+N` Inline |
| **场景** | 改一个枚举名 / 抽公共方法 / 抽常量 |
| **Kairo 现状** | ❌ **完全没有**。JDT LS 支持 `textDocument/rename` 和 `textDocument/codeAction`(对应 refactor 菜单),Kairo 一个都没接 |
| **证据** | `JdtLsBackendService` 接口只有 start/stop/state/didOpen/didChange/didClose/completion/definition — **没有 `$rename` `$codeAction` `$formatting`** |
| **必须性** | **P0**(Java 后端开发的核心生产力来源) |
| **实现难度** | ★★★ |
| **周期** | 3-5 人·周 |
| **建议路径** | (1) 后端 JdtLsBackendService 加 `$rename` `$codeAction` `$formatting` `$rangeFormatting` `$executeCommand` 五个 RPC;(2) 前端注册 Monaco provider + 右键菜单 + 快捷键;(3) 跟"Save Actions"绑定(saving 之前自动 format) |

---

### P0-7 · Java Code Generation(代码生成)

| 项 | 内容 |
|----|------|
| **是什么** | 右键 → Generate → Constructor / Getter/Setter / equals/hashCode / toString / Override Methods(选中父类方法)/ Delegate Methods / Properties(老 Eclipse 习惯) |
| **怎么用(IDEA)** | `Alt+Insert` 在类体内 → 弹出对话框,多选,一次生成 |
| **怎么用(VS Code)** | 装 `Java Code Generators` 扩展 / `Code Runner` |
| **场景** | 新写一个 DTO 类 — `Alt+Insert` → 一键生成 5 个字段的 getter/setter/toString |
| **Kairo 现状** | ❌ **完全没有**。JDT LS 不直接提供 Generate,但能通过 `textDocument/codeAction(kind: 'source.generate.constructors' 等)` 给提示;Kairo 没接 |
| **必须性** | **P1(但与 P0-6 一组)** |
| **实现难度** | ★★ |
| **周期** | 2-3 人·周 |
| **建议路径** | 接 P0-6 之后,codeAction kind 过滤 `source.generate.*` 触发 QuickPick 多选 + 调用 JDT LS `workspace/executeCommand` |

---

### P0-8 · Live Templates + Postfix Completion

| 项 | 内容 |
|----|------|
| **是什么** | 输入缩写 → 展开成模板;IDEA 的 `.var` / `.if` / `.for` / `.try` / `sout` / `psvm` 等等 |
| **怎么用(IDEA)** | `Settings → Editor → Live Templates` 看全部。`.var` 把表达式变成 `Type name = expr;`,`.sout` 把当前行包成 `System.out.println(...);` |
| **Kairo 现状** | ❌ **完全没有**。Monaco 支持 `registerCompletionItemProvider` 的 `insertText` + `insertTextRules`,语法上能实现 |
| **必须性** | **P1**(熟练 Java 开发每天用几十次) |
| **实现难度** | ★★ |
| **周期** | 2 人·周 |
| **建议路径** | (1) 写一份 `kairo.templates.json`(20-30 个最常用的)。(2) `KairoLiveTemplateProvider` 接 Monaco completion provider,append 到 JDT LS 的 items 之前。(3) Preferences 里加配置 UI |

---

### P0-9 · VCS / Git 集成

| 项 | 内容 |
|----|------|
| **是什么** | 编辑器左侧 gutter 显示修改行颜色,左侧 SCM 面板显示 Changed Files,内置 diff viewer,Commit / Pull / Push / Branch / Log / Blame / Stash / Tag 全部 IDE 里完成 |
| **怎么用(IDEA)** | `Alt+9` Commit 工具窗口 / `Ctrl+K` Commit / `Ctrl+Shift+K` Push / 右上角分支切换 / 行号右键 Annotate with Git Blame |
| **怎么用(VS Code)** | `@theia/scm` 自带,左侧源代码管理图标,Gutter 颜色,内置 diff editor |
| **场景** | 老 Java 项目虽然旧,但一般都在 Git/SVN 上;每天 commit + 看 diff + blame 改一行问"谁写的"是日常 |
| **Kairo 现状** | ❌ **完全没有**。Theia 1.73 有 `@theia/git` 包,**但 `packages/theia-product/package.json` 没声明** |
| **证据** | `packages/theia-product/package.json` deps 中没有 `@theia/git` |
| **必须性** | **P0**(老项目用 SVN 的话,这块非做不可 — 不然连 diff 都没法看) |
| **实现难度** | ★★ |
| **周期** | 1-2 人·周 |
| **建议路径** | (1) `pnpm add @theia/git` + 在 frontend module 启用。(2) Go 端如果要做 SVN,可以再写一个 `ScmProvider`,但 v1 只做 Git(老项目大都迁过 Git)。(3) 配置 `user.name/user.email` UI |

---

### P0-10 · JSP / Java 嵌入式代码深度支持

| 项 | 内容 |
|----|------|
| **是什么** | `<% ... %>` 里的 Java 代码也要有完整高亮、补全、错误检查;`<%= %>` EL 表达式高亮 + bean 补全;taglib(`<c:if>`)参数补全;HTML 部分也高亮 |
| **怎么用(IDEA)** | 内置 JSP 支持,`<%` 内 Java 完全语法高亮,`${user.name}` 弹出 `user` 对象的属性,`<c:if test="...">` 自动提示 JSTL 属性 |
| **怎么用(VS Code)** | 装 `Java Server Pages` 扩展;对内嵌 Java 支持仍较弱 |
| **场景** | 一个 .jsp 里有 30 行 HTML + 50 行 Java + 10 行 EL + 5 个 JSTL — **IDEA 里所有这些都活** |
| **Kairo 现状** | ❌ **极弱**。`jsp-monarch.ts` 把 `<% ... %>` 整段标成一个 token `tag.jsp-scriptlet`,**里面 Java 代码没有任何颜色**;EL 也只标成 `metatag`,没有 `user.name` 的补全;JSTL 只识别 13 个固定 tag 名,其他都不识别;TLD 解析器有写但未挂到补全上 |
| **证据** | `packages/jsp-extension/src/browser/jsp-monarch.ts:14-66` 全部 `jspScriptlet` 状态只匹配 `%>` 跳出,中间全是一个 token |
| **必须性** | **P0**(Kairo 的目标就是 JSP 老项目) |
| **实现难度** | ★★★★ |
| **周期** | 4-6 人·周 |
| **建议路径** | (1) 用 TextMate 语法或 Language Server 替换 Monarch:`vscode-jsp`(社区)有完整 grammar。(2) 把 scriptlet 内部的 Java 文本**单独**作为一个 `embedded Java` document 喂给 JDT LS(inlay 的方案),这样 `<% UserService u = new ...; %>` 也能补全。(3) EL 解析器写一个 `el-parser.ts` 提取 `${...}` 内表达式,做 bean 路径补全 |

---

## 3. P1 重要功能(没有也能用,但效率明显低)

### P1-1 · Signature Help(参数提示)

- **是什么**: 写方法调用时弹出参数列表,高亮当前参数,Tab 跳到下一个
- **IDEA 快捷键** `Ctrl+P`
- **JDT LS 支持**: `textDocument/signatureHelp`
- **Kairo 现状**: ❌ 无
- **难度**: ★★ / 周期 1-2 人·周

### P1-2 · Hover(类型 / 文档悬浮)

- **是什么**: 鼠标移到符号上 → 弹出 Javadoc + 签名 + 跳转到定义
- **IDEA 快捷键** `Ctrl+Q` Quick Documentation / `Ctrl+Shift+I` Quick Definition
- **JDT LS 支持**: `textDocument/hover`
- **Kairo 现状**: ❌ 无
- **难度**: ★ / 周期 1 人·周

### P1-3 · Inlay Hints(参数名内嵌显示)

- **是什么**: 方法调用 `getUser(123, true)` 旁边显示 `(int id, boolean active)`
- **IDEA 默认** 开启
- **JDT LS 支持**: `textDocument/inlayHint`
- **Kairo 现状**: ❌ 无
- **难度**: ★★ / 周期 1-2 人·周

### P1-4 · Code Formatting(代码格式化)

- **是什么**: 整个文件 / 选中区域 / 保存时自动格式化,带 Java 代码风格(Eclipse / Google / 自定义)
- **IDEA 快捷键** `Ctrl+Alt+L`
- **JDT LS 支持**: `textDocument/formatting` + `textDocument/rangeFormatting`
- **Kairo 现状**: ❌ 无
- **难度**: ★★ / 周期 1-2 人·周
- **说明**: 老 JSP 项目**特别需要** — 10 年没人维护的代码风格一塌糊涂,新来的人写完 save 一下自动格式化

### P1-5 · Optimize Imports(自动整理 import)

- **是什么**: 删除未使用的 import、按字母排序、合并 `java.util.*` 等
- **IDEA 快捷键** `Ctrl+Alt+O`
- **JDT LS 支持**: `textDocument/codeAction` kind=`source.organizeImports`
- **Kairo 现状**: ❌ 无
- **难度**: ★ / 周期 0.5 人·周

### P1-6 · Save Actions(保存时自动触发)

- **是什么**: 每次 `Ctrl+S` 时: 自动 format / optimize imports / 去掉 trailing whitespace / 添加 final 等
- **Kairo 现状**: ❌ 无
- **难度**: ★ / 周期 0.5 人·周
- **建议**: Preferences 里加开关,默认开 format + optimize imports

### P1-7 · JUnit Test Runner(测试运行 + 覆盖率)

- **是什么**: 右键 Test 类 → Run Tests / 显示红绿条 / 显示覆盖率
- **IDEA 集成**:`@RunWith(JUnit4.class)` 自动识别
- **JDT LS 自带** `org.eclipse.jdt.junit.core` 已经 bundled
- **Kairo 现状**: ❌ 无 — 但 v1 范围里有"build",如果加上 test 任务,工具链已就绪
- **难度**: ★★★ / 周期 3-4 人·周
- **建议路径**: Go Agent 跑 junit JAR(就在 `bundled/jdtls/plugins/org.junit_4.13.2.v20240929-1000.jar`)→ 输出 XML 报告 → 前端新 TestResultsWidget

### P1-8 · Maven / Gradle 导入 + 依赖管理

- **是什么**: 打开 `pom.xml` / `build.gradle` 自动识别依赖、依赖补全、依赖冲突提示、依赖图
- **Kairo 现状**: ⚠️ **bundled/jdtls 里有 m2e core 1.7.6**(包括 maven runtime 3.9.11),JDT LS 自带 Maven 项目识别能力,**但 Kairo 没有任何 import 流程让用户把 Maven 项目当 Kairo 项目用**。当前只支持 Ant + javac
- **场景**: 客户说"我们项目已经迁到 Maven 了,你这个 IDE 还能用吗?" — 现在答案是"用不了"
- **难度**: ★★★ / 周期 3-4 人·周
- **建议路径**: (1) Import Wizard 加"Import Maven Project"选项;(2) `KairoProjectService` 加 m2e 适配;(3) 实际上 JDT LS 在 `mvn` 项目上自动能跑,JSP 老项目 m2e-maven 集成比 Ant 简单

### P1-9 · Problems Panel / 错误列表

- **是什么**: 编辑器下方集中显示**所有文件**的编译错误/警告,能跳、能分组
- **IDEA** `Alt+F6` / `View → Tool Windows → Problems`
- **Theia** 有 `@theia/markers` 声明,但要 wiring
- **Kairo 现状**: ⚠️ `@theia/markers` 声明了但未注册 ProblemsWidget
- **难度**: ★★ / 周期 1-2 人·周
- **建议路径**: 接 JDT LS `textDocument/publishDiagnostics` + 写 `KairoProblemsWidget`

### P1-10 · Todo 注释扫描

- **是什么**: 扫 `// TODO` / `// FIXME` / `// XXX`,集中面板显示,能跳
- **IDEA** View → Tool Windows → TODO
- **Kairo 现状**: ❌ 无
- **难度**: ★ / 周期 0.5 人·周
- **建议**: 后端 search 走 `/api/v1/search` 复用,但加 TODO widget

### P1-11 · Bookmarks

- **是什么**: 在某行加书签,跨文件跳(`Ctrl+1..9` 跳到第 N 个书签)
- **IDEA** `F11` 加书签 / `Ctrl+Shift+[0-9]` 跳
- **Theia** 有 `@theia/cpp` 用的 bookmark 机制
- **Kairo 现状**: ❌ 无
- **难度**: ★★ / 周期 1-2 人·周

### P1-12 · Recent Files / Recent Locations

- **IDEA** `Ctrl+E` 最近文件 / `Ctrl+Shift+E` 最近位置
- **Theia** 默认有,需要 keybinding 配置
- **Kairo 现状**: ⚠️ Theia 自带,但未在 Kairo 主题中验证菜单绑定

### P1-13 · Local History(本地历史)

- **是什么**: 每次保存保留一个本地快照,能 diff、能恢复(类似 Git 但自动)
- **Kairo 现状**: ❌ 无
- **难度**: ★★★ / 周期 3-4 人·周
- **建议**: Go 端写 `local_history` 服务,每个文件保留 50 个 snapshot,压缩存储

### P1-14 · Terminal

- **现状**: `@theia/terminal` 声明,**默认 Theia 就有**,但 Kairo 需要验证 1.73.1 在 Kairo product 加载时是否自动启用
- **场景**: 老项目常用 `tail -f logs/catalina.out`,集成终端是必备

### P1-15 · Database Tool (Oracle 11g)

- **产品定位说** v1 不做(`product-requirements.md` §2.2)
- **但场景** 老项目 90% 都连 Oracle,开发时 SQL 报错必须能直接查表
- **难度**: ★★★★★(独立产品量级) / 周期 12+ 人·周
- **建议**: **不做完整版**,只做一个 SQL Console(Webview + jOOQ+JDBC 桥)

### P1-16 · Maven Repository / 依赖补全(写到 `pom.xml`)

- 老项目即便不用 Maven,也会引一堆 `lib/*.jar`,**JDT LS 实际上能扫 lib/**
- **Kairo 现状**: JDT LS init 时不会自动扫 `lib/`(只扫 classpath 上的 JAR),需要让 Go Agent 在 project 启动时把 `lib/*.jar` 加到 classpath

---

## 4. P2 增值功能(竞争力功能,后 v1 做)

| # | 功能 | 难度 | 周期 | 备注 |
|---|------|------|------|------|
| P2-1 | Class Hierarchy (`Ctrl+H`) | ★★ | 2 人·周 | JDT LS `textDocument/typeHierarchy` |
| P2-2 | Call Hierarchy (`Ctrl+Alt+H`) | ★★★ | 3 人·周 | JDT LS `textDocument/prepareCallHierarchy` + `callHierarchy/incomingCalls` |
| P2-3 | Method Hierarchy | ★★ | 2 人·周 | 自实现(基于 typeHierarchy 过滤) |
| P2-4 | UML Class Diagram | ★★★★★ | 8+ 人·周 | IDEA Ultimate 才有,做不了就用 PlantUML export |
| P2-5 | HTTP Client (.http 文件) | ★★ | 2 人·周 | Theia `@theia/editor` + 自实现 quick-parse |
| P2-6 | Code Coverage (JaCoCo) | ★★★★ | 4-6 人·周 | 跑测试时插桩,结果显示 |
| P2-7 | Profiler / Flame Graph | ★★★★★ | 12+ 人·周 | async-profiler + JFR |
| P2-8 | Local History(见 P1-13) | ★★★ | 3-4 人·周 | |
| P2-9 | AI Completion | ✗ | - | 产品定位明确**不做**(`product-requirements.md` §5) |
| P2-10 | Plugin Marketplace | ★★★★ | 6-8 人·周 | 明确**不做** v1 |
| P2-11 | Spring/J2EE Framework Awareness | ★★★★ | 4-6 人·周 | 识别 `@RequestMapping` `@Autowired`,提供 controller 路由图 |
| P2-12 | HTTP Request Inspector(替代 Postman) | ★★★ | 3-4 人·周 | 老项目用 SoapUI / Postman 测接口,集成进去 |
| P2-13 | JSP 热部署(类 HotSwap) | ★★★★★ | 8+ 人·周 | BLOCKERS B-004 同源,需 JDWP agent |
| P2-14 | 远程 Linux Server | ★★★★ | 6-8 人·周 | ADR-0014 明确 deferred |
| P2-15 | Database SQL Editor 完整版 | ★★★★★ | 12+ 人·周 | |

---

## 5. 当前已有 / 不需要做(防止重复发明)

| 功能 | 状态 | 证据 |
|------|------|------|
| Monaco 编辑器 | ✅ Theia 自带 | |
| 文件树(Navigator) | ✅ Theia 自带 | `@theia/navigator` |
| 打开/保存/另存为 | ✅ Theia 自带 + KairoFileCommands 兜底 | `kairo-file-commands.ts` |
| Multi-cursor / Find Replace in file | ✅ Theia 自带 | |
| 编码检测 + 重新打开 + 另存为编码 | ✅ 已实现 | `encoding-extension` |
| 主题(Kairo Dark) | ✅ 已实现 | `kairo-theme.ts` |
| Tomcat 启停/部署/日志 | ✅ 已实现 | `tomcat-extension` |
| Ant / javac 构建 | ✅ 已实现 | `build-extension` |
| 状态栏(5 项) | ✅ 已实现 | `kairo-status-bar-contribution.ts` |
| Welcome Widget | ✅ 已实现 | `kairo-welcome-widget.tsx` |
| Import Wizard / Project Selector | ✅ 已实现 | `project-extension` |
| Build / Deployment / Servers / Logs Views | ✅ 已实现 | `kairo-views-contribution.ts` |
| 菜单 / Command Palette / Keybindings | ✅ Theia 自带 | |
| 大文件策略 | ✅ 已实现 | `large-file-policy.ts` |
| Kairo Runtime Agent WS 事件流 | ✅ 已实现 | `runtime-extension` |
| GBK / UTF-8 编码无损重编 | ✅ 已实现 | `encoding-extension` |

---

## 6. 推荐实施路线图(优先级矩阵)

### 第一波(2-3 周,显著提效)
1. **P0-5 Outline View** ★ 最快,1 人·周,1 改 1 加
2. **P0-2 Search UI** ★★ 1-2 人·周,直接复用 Theia Search
3. **P1-2 Hover** ★ 1 人·周,补 JDT LS `textDocument/hover`
4. **P1-5 Optimize Imports** ★ 0.5 人·周
5. **P1-6 Save Actions** ★ 0.5 人·周

### 第二波(3-5 周,核心功能)
1. **P0-3 Go to Class/Symbol/File** ★★ 1-2 人·周
2. **P0-4 Find Usages** ★★ 1-2 人·周
3. **P1-1 Signature Help** ★★ 1-2 人·周
4. **P1-4 Code Formatting** ★★ 1-2 人·周
5. **P1-9 Problems Panel** ★★ 1-2 人·周
6. **P0-9 VCS / Git 集成** ★★ 1-2 人·周
7. **P2-1 Class Hierarchy** ★★ 2 人·周(顺手做了)

### 第三波(6-10 周,生产力)
1. **P0-6 Refactor** ★★★ 3-5 人·周
2. **P0-7 Code Generation** ★★ 2-3 人·周
3. **P0-8 Live Templates** ★★ 2 人·周
4. **P1-3 Inlay Hints** ★★ 1-2 人·周
5. **P2-2 Call Hierarchy** ★★★ 3 人·周
6. **P1-11 Bookmarks** ★★ 1-2 人·周

### 第四波(高难度攻坚)
1. **P0-10 JSP 深度支持** ★★★★ 4-6 人·周
2. **P0-1 Debug** ★★★★★ 6-10 人·周
3. **P1-7 JUnit Test Runner** ★★★ 3-4 人·周
4. **P1-8 Maven 集成** ★★★ 3-4 人·周
5. **P1-13 Local History** ★★★ 3-4 人·周
6. **P1-15 Database SQL Console(轻量版)** ★★★★ 4-6 人·周

---

## 7. 总结

按"**做了能不能替代 IDEA 80% 日常**"这个目标衡量:

- **当前 Kairo** ≈ 50% 的"工程"功能(打开、编辑、构建、部署、Tomcat 管理),但只有 ≈ 10% 的"语言智能"和 ≈ 0% 的"调试"和 ≈ 0% 的"VCS"。
- **如果只做第一波 + 第二波**,能做到 ≈ 60%,**已经接近"能用的开发环境"**,但**写 Java 仍然难受**。
- **加上第三波**,做到 ≈ 80%,**这时候开发者才会觉得"可以替代 IDEA 写日常业务"**。
- **加上第四波**(Debug + JSP 深度),**才能喊出"Kairo 完整体验"**。

---

## 8. 待多模型交叉验证的关键问题

请其他模型在分析时重点回答:

1. **JSP 内嵌 Java 走"文档嵌套 + JDT LS"还是"自写 Parser"?** 我倾向 JDT LS(已有 grammar 优势),但要权衡延迟
2. **P0-1 Debug 在 Java 6 上的 JDWP 兼容性是否真能用 BLOCKERS B-004 的方案打通?** 这是该项目最大的技术风险
3. **Maven 集成是 v1 必须还是 v1.1?** 老项目 50% 已经迁了 Maven,不做 v1 等于放弃一半用户
4. **VCS 是只做 Git 还是 Git+SVN?** 老 Java 项目 SVN 比例仍很高(尤其政府/国企)
5. **Database 工具是"P0 必须"还是"P1 重要"?** 我标 P1,但你可能认为是 P0(老项目几乎 100% 要查 Oracle)
6. **Outline / Search / Hover 这种"显然要做"的东西,Kairo 团队为什么没做?** 是优先级没排上,还是 JDT LS 没真起来?(`MILESTONES.md` 显示 JDT LS lifecycle 还在 fix)

---

## 9. 文档元数据

- **生成方式**: 本地代码深度阅读 + 联网搜索(JDT LS、IDEA、VS Code Java 扩展相关)综合分析
- **分析时间**: 2026-07-21
- **数据来源**:
  - 本地: `docs/architecture.md`, `docs/product-requirements.md`, `docs/MILESTONES.md`, `docs/BLOCKERS.md`, `docs/specs/WAVE4_JAVA_LANGUAGE_INTELLIGENCE.md`(Wave 4 还在做 completion/F12/diagnostics 的真集成,验证了我的分析)
  - 代码: `packages/java-extension/`, `packages/search-extension/`, `packages/jsp-extension/`, `packages/theia-product/`
  - Git: 分支 `qa/kimi-mac-web-20260720-65210d5` vs `main`
  - 联网: IntelliJ IDEA 2025/2026 新功能、VS Code Java Extension Pack、IDEA 快捷键大全、IDEA Refactor 文档、JDT LS 协议
- **下一步**: 用户会用其他模型再分析同一项目,请把这些建议结论作为参考输入,**不要直接当结论使用**
