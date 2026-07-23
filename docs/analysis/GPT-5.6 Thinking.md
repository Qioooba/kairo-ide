# GPT-5.6 Thinking：Kairo IDE 与 IntelliJ IDEA / VS Code 的 Java 后端核心功能差距分析

> 分析日期：2026-07-21  
> 项目：Kairo IDE（JDK 1.6 / Tomcat 6 / Servlet / JSP / GBK）  
> 结论口径：以“能否完成真实遗留 Java Web 日常开发闭环”为准，不以代码中是否存在占位类或依赖包为准。

## 一、执行结论

Kairo IDE 已具备一个有价值的专用 IDE 骨架：Theia/Monaco 外壳、Go Runtime Agent、编码安全、搜索后端、Ant/Javac、部署与 Tomcat 管理、JSP 语法和 JDT LS 生命周期基础。但它距离可替代 IDEA/VS Code 的关键差距，不是主题和菜单，而是以下四个闭环：

1. **项目模型闭环**：真实 Ant/JDK/JAR/WebRoot 模型必须同时驱动补全、构建、部署和调试。
2. **Java 语义闭环**：补全、跳转、引用、重命名、快速修复、结构、层次必须稳定可用。
3. **运行调试闭环**：保存→构建→部署→Tomcat→断点→变量→日志→问题定位。
4. **跨语言闭环**：Java、JSP、web.xml、TLD、EL、Servlet URL 映射之间能互相跳转和查找。

最优先的不是继续仿 IDEA 外观，而是依次完成：**项目模型 → Java LSP → Problems → 搜索替换 → 运行配置 → Debug → JSP/Servlet 跨语言导航**。

## 二、代码审查后的当前能力判断

- 已有：Theia 编辑器外壳、文件树、标签页、多编辑器基础；`@theia/search-in-workspace`、`@theia/terminal`、`@theia/debug`、`@theia/markers`、`@theia/outline-view` 依赖。
- 已有：Go Agent 的搜索、构建、部署、Tomcat 生命周期、日志游标、编码相关能力。
- 已有：JDT LS 进程管理、文档同步、completion/definition/diagnostics 的部分适配。
- 已有：JSP Monarch 语法规则和 TLD 解析器。
- 关键判断：上述很多能力仍是“底座存在”或“后端存在”，尚不能等同于用户可依赖的端到端功能。

## 三、必须开发的功能总表

|编号|功能|优先级|难度|周期|
|---|---|---|---|---|
|P0-01|可信项目模型与类路径解析|必须|极高|4–7周|
|P0-02|Java 语义服务完整闭环|必须|极高|4–6周|
|P0-03|Java Debug 调试闭环（DAP/JDWP）|必须|极高|6–10周|
|P0-04|统一 Problems/错误中心|必须|中高|2–4周|
|P0-05|全局搜索与安全批量替换闭环|必须|中高|2–4周|
|P0-06|查找引用 / 使用位置|必须|中|2–3周|
|P0-07|安全重命名重构|必须|中高|3–5周|
|P0-08|构建—部署—运行—日志一键闭环|必须|高|4–7周|
|P0-09|运行/调试配置体系|必须|中高|3–5周|
|P0-10|JSP/Servlet/XML 跨文件智能导航|必须|高|5–8周|
|P1-01|代码结构/Outline 与面包屑|高|中|2–3周|
|P1-02|快速修复与自动导入|高|中高|3–5周|
|P1-03|调用层次与类型层次|高|中高|3–5周|
|P1-04|工作区符号与“到处搜索”|高|中|2–4周|
|P1-05|代码格式化、保存动作和模板|高|中|2–4周|
|P1-06|Git/差异比较/提交基础能力|高|中|2–4周|
|P1-07|本地历史与安全恢复|高|中高|3–5周|
|P1-08|依赖/JAR 浏览与源码反编译|高|高|4–7周|
|P1-09|终端与常用工具窗口产品化|高|低中|1–2周|
|P1-10|测试运行器（JUnit 3/4 优先）|高|中高|3–5周|
|P2-01|代码生成|增强|中|2–3周|
|P2-02|重构扩展|增强|高|5–8周|
|P2-03|代码检查与质量规则|增强|中高|3–6周|
|P2-04|数据库/SQL 辅助|增强|高|6–10周|
|P2-05|性能与索引可观测性|增强|中|2–4周|
|P2-06|快捷键/菜单/布局对齐 IDEA|增强|中|2–4周|

## 四、每项功能详细说明

### P0-01 可信项目模型与类路径解析
- **作用**：JDK/source level、源码目录、输出目录、WEB-INF/lib、外部 jar、Servlet API、Ant classpath 必须准确映射给 JDT LS 与 javac。
- **典型场景与用法**：打开任意遗留工程后，补全、跳转、报错、构建使用同一份模型；修改 build.xml 或 jar 后自动刷新。
- **本项目缺口**：已有 jdtproject 生成器与扫描接口，但缺少可视化模型、变更监听、冲突诊断、完整 Ant path/refid 解析，以及“语言服务模型=真实构建模型”的验收闭环。

### P0-02 Java 语义服务完整闭环
- **作用**：把 JDT LS 真正接入 Monaco/Theia，提供语义高亮、补全、悬停、参数提示、定义/类型定义/实现跳转、诊断。
- **典型场景与用法**：写 Servlet、DAO、工具类时实时补全；查看第三方 jar 类型；F12 跨模块跳转；错误立即定位。
- **本项目缺口**：当前自定义 LSP 类型较多，但前端明确落地的主要是 completion、definition、diagnostics；其余能力声明多、UI/provider 少，且里程碑仍标记未完成。

### P0-03 Java Debug 调试闭环（DAP/JDWP）
- **作用**：支持启动/附加 Tomcat 调试，断点、条件断点、异常断点、单步、调用栈、线程、变量、Watch、Evaluate、Debug Console。
- **典型场景与用法**：定位 Servlet 请求、过滤器链、事务逻辑、老系统运行时数据；附加到已用 JPDA 启动的 Tomcat。
- **本项目缺口**：已有 @theia/debug 依赖和服务器 debug 启动入口，但无 Java Debug Adapter 注册、launch/attach 配置生成、断点到 JDWP 的验证，也无变量/栈帧闭环。

### P0-04 统一 Problems/错误中心
- **作用**：统一汇总 JDT LS 诊断、javac/Ant 错误、JSP/TLD/XML 配置问题，并支持过滤、分组、双击定位、下一错误。
- **典型场景与用法**：一次构建出现 80 个错误时按项目/文件/严重度筛选；修复后自动清除陈旧错误。
- **本项目缺口**：Theia markers 已引入，Java diagnostics 与 Build 结果各自存在，但缺少统一数据模型、去重、生命周期、来源标识和稳定导航。

### P0-05 全局搜索与安全批量替换闭环
- **作用**：不仅能搜，还要有结果树、上下文、include/exclude、正则、大小写、整词、替换预览、逐项勾选、编码安全写回。
- **典型场景与用法**：改包名、接口地址、SQL 字段、JSP 文案；跨 GBK/UTF-8 文件替换前审查影响。
- **本项目缺口**：后端已有 cancellable search 与 previewReplace 字段，Theia 也自带 workspace search；需确认实际 UI 路由、结果导航、replace apply、GBK 原子写回、忽略目录和大仓性能。

### P0-06 查找引用 / 使用位置
- **作用**：查找类、方法、字段在全项目中的引用，按文件分组并支持预览。
- **典型场景与用法**：修改公共方法前评估影响；追踪某 Servlet、DAO、常量、SQL helper 被谁调用。
- **本项目缺口**：LSP capability 类型已声明 references，但未看到完整 provider、结果面板、取消、进度与大结果集处理。

### P0-07 安全重命名重构
- **作用**：对类、方法、字段、局部变量、包执行语义级 rename，先预览 WorkspaceEdit，再原子应用并支持撤销。
- **典型场景与用法**：重命名公共 API、Servlet 类、工具方法，避免纯文本替换误伤字符串与注释。
- **本项目缺口**：声明了 rename 能力但缺少 UI、prepareRename、跨文件 edit 应用、只读/编码冲突处理、失败回滚与 JSP/XML 关联更新策略。

### P0-08 构建—部署—运行—日志一键闭环
- **作用**：一个 Run 配置串联保存、增量/完整构建、部署、Tomcat 启动/重启、浏览器打开、日志定位。
- **典型场景与用法**：修改 Java 后一键重新编译部署；修改 JSP 后快速同步；失败时停在具体阶段。
- **本项目缺口**：后端 Ant/Javac/Deploy/Tomcat 能力较多，但前端 store/event wiring、真实日志、状态一致性曾标 partial；需要把“按钮可点”提升到可重复成功的工作流。

### P0-09 运行/调试配置体系
- **作用**：类似 IDEA Run Configuration：项目、JDK、Tomcat、端口、context path、VM options、环境变量、构建前任务、启动模式可保存。
- **典型场景与用法**：多个老项目、多个 Tomcat 实例、不同 JPDA 端口和 JVM 参数之间切换。
- **本项目缺口**：现有配置分散在项目/服务器/agent 描述中，缺少用户可理解的配置编辑器、校验、复制、默认选择和状态栏入口。

### P0-10 JSP/Servlet/XML 跨文件智能导航
- **作用**：识别 web.xml、@WebServlet、JSP include、taglib/TLD、EL、Java bean/Servlet 映射，实现跳转、引用和错误提示。
- **典型场景与用法**：从 JSP form action 跳到 Servlet；从 taglib prefix 跳 TLD；从 web.xml servlet-class 跳 Java 类。
- **本项目缺口**：目前 JSP 主要是 Monarch 语法和 TLD parser，缺少嵌入 Java/EL 语义、XML schema、Servlet 映射索引、include 依赖图和跨语言引用。

### P1-01 代码结构/Outline 与面包屑
- **作用**：显示类、字段、构造器、方法、内部类，支持排序、过滤和快速跳转。
- **典型场景与用法**：在几千行老类中快速定位方法；查看当前文件整体结构。
- **本项目缺口**：Theia outline-view 已依赖，但需由 documentSymbol 提供 Java 结构，并验证刷新、图标、继承成员和 JSP 结构。

### P1-02 快速修复与自动导入
- **作用**：Alt+Enter 提供导入类型、创建方法/字段、修正类型、异常处理、组织 imports。
- **典型场景与用法**：粘贴代码后补 import；解决同名类冲突；清理未使用 import。
- **本项目缺口**：声明 codeAction，但缺少完整 provider、菜单/灯泡、WorkspaceEdit、命令执行与冲突选择 UI。

### P1-03 调用层次与类型层次
- **作用**：展示方法调用者/被调用者、类继承/实现关系。
- **典型场景与用法**：分析老系统入口、模板方法、接口实现，快速理解影响范围。
- **本项目缺口**：未见 callHierarchy/typeHierarchy 的前端实现与专用树视图。

### P1-04 工作区符号与“到处搜索”
- **作用**：按类、方法、文件、命令统一搜索，支持模糊匹配和最近访问。
- **典型场景与用法**：记得类名一部分时秒开；快速执行 Build、Restart、Open Problems。
- **本项目缺口**：Theia 命令框可复用，但 Java workspaceSymbol、文件/动作/符号统一排名与索引状态提示尚未形成。

### P1-05 代码格式化、保存动作和模板
- **作用**：Java 格式化、选区格式化、保存时组织 import、代码片段、live templates。
- **典型场景与用法**：统一团队格式；快速生成 try/catch、Servlet 模板、日志语句。
- **本项目缺口**：LSP formatting 类型有声明，但未见可配置 formatter profile、save actions 与模板管理。

### P1-06 Git/差异比较/提交基础能力
- **作用**：文件状态、diff、stage、commit、branch、历史、冲突基础处理。
- **典型场景与用法**：查看自己改了什么；提交前检查；回退错误修改。
- **本项目缺口**：产品依赖未看到 @theia/scm/git；当前缺少专业开发最低限度的变更审查闭环。

### P1-07 本地历史与安全恢复
- **作用**：即使未提交 Git，也对编辑/批量替换/重构保留时间点快照。
- **典型场景与用法**：AI 或批量替换改坏文件；误删代码；GBK 转码后需要恢复。
- **本项目缺口**：未见 local history；对于老项目和 AI 辅助开发，这是高价值防损功能。

### P1-08 依赖/JAR 浏览与源码反编译
- **作用**：展示 Libraries，浏览 jar 包类，附源码或反编译，跳转回调用处。
- **典型场景与用法**：查看旧版第三方库、Servlet API、公司内部 jar 的方法签名和实现。
- **本项目缺口**：JDT 类路径可包含 jar，但缺少库树、source attachment、class file editor、反编译器和缓存策略。

### P1-09 终端与常用工具窗口产品化
- **作用**：内置终端、Build、Server、Problems、Search、Debug、Structure 统一布局和快捷键。
- **典型场景与用法**：运行 ant、查看环境、执行脚本，同时保留 IDE 上下文。
- **本项目缺口**：Theia terminal 已依赖，重点是默认布局、工作目录、编码、环境继承和 Windows shell 兼容。

### P1-10 测试运行器（JUnit 3/4 优先）
- **作用**：发现、运行、调试测试，显示通过/失败、堆栈和重跑。
- **典型场景与用法**：维护老项目回归测试；修复 bug 后单测验证。
- **本项目缺口**：未见测试资源管理器或 Java test adapter；需优先兼容 JUnit 3/4，而非只追新版本。

### P2-01 代码生成
- **作用**：生成 getter/setter、构造器、equals/hashCode、toString、override methods。
- **典型场景与用法**：减少样板代码，保证签名正确。
- **本项目缺口**：可基于 JDT LS codeAction/commands，但当前未产品化。

### P2-02 重构扩展
- **作用**：提取方法/变量/常量、内联、移动类、修改方法签名。
- **典型场景与用法**：拆分超长方法、整理遗留代码。
- **本项目缺口**：需要复杂 WorkspaceEdit、冲突检测和跨语言引用，晚于 rename。

### P2-03 代码检查与质量规则
- **作用**：未使用代码、空指针风险、资源泄漏、可疑比较等检查，可按项目禁用。
- **典型场景与用法**：日常编码即发现潜在缺陷。
- **本项目缺口**：JDT 有部分诊断，但缺少规则配置、严重度、抑制和全项目分析。

### P2-04 数据库/SQL 辅助
- **作用**：连接 Oracle、SQL 高亮执行、结果表、表字段补全。
- **典型场景与用法**：老 Java 后端大量排查 SQL 和表结构。
- **本项目缺口**：项目当前无数据库工具；价值高但不应阻塞核心 IDE v1。

### P2-05 性能与索引可观测性
- **作用**：显示 JDT LS 状态、项目导入进度、内存、慢请求、重启语言服务、清缓存。
- **典型场景与用法**：4GB VDI 上定位为什么补全失效或卡顿。
- **本项目缺口**：已有生命周期/日志事件基础，但缺少面向用户的健康中心与降级策略。

### P2-06 快捷键/菜单/布局对齐 IDEA
- **作用**：提供 IntelliJ 风格 keymap、Project/Structure/Problems/Terminal 工具窗布局、双击/右键行为。
- **典型场景与用法**：降低从 IDEA 迁移学习成本。
- **本项目缺口**：现有 Theia/VS Code 风格底座，需要兼容层而不是复制 IDEA 全部 UI。

## 五、推荐路线图

### 阶段 A：可用编辑器（6–10周）
项目模型、JDT LS 稳定接入、语义高亮/补全/跳转/诊断、Problems、搜索与安全替换、Outline。

### 阶段 B：可用 Java Web IDE（8–12周）
运行配置、构建部署运行闭环、Tomcat 真实日志、DAP/JDWP Debug、查找引用、重命名、Quick Fix。

### 阶段 C：遗留 JSP 专用优势（6–10周）
web.xml/@WebServlet/JSP include/taglib/TLD/EL/Servlet URL 跨语言索引和导航，GBK 全链路验收。

### 阶段 D：效率与安全（6–10周）
Git、Local History、JUnit、JAR 浏览/反编译、层次结构、格式化与代码生成、IDEA 风格 keymap。

以上周期按 **2 名熟悉 TypeScript/Theia + 1 名熟悉 Java/JDT/DAP + 1 名 Go/测试工程师**估算；单人开发通常需乘以 2.5–4，并预留 30% 集成与 Windows/GBK 回归时间。

## 六、验收原则

每个功能必须用 `legacy-sample` 和至少一个真实大型 GBK/Ant/JSP 项目验证，不接受“菜单出现”作为完成。关键验收包括：冷启动后可用、4GB 内存可控、取消与超时有效、跨平台路径正确、GBK 不损坏、错误可定位、操作可撤销、JDT LS 崩溃可恢复。

## 七、官方资料依据

- IntelliJ IDEA Project Analysis：项目分析支撑补全、检查、重构、导航和查找用法。https://www.jetbrains.com/help/idea/project-analysis.html
- IntelliJ IDEA Source Navigation：https://www.jetbrains.com/help/idea/navigating-through-the-source-code.html
- IntelliJ IDEA Refactoring：https://www.jetbrains.com/help/idea/refactoring-source-code.html
- VS Code Java Overview：https://code.visualstudio.com/docs/languages/java
- VS Code Java Debugging：https://code.visualstudio.com/docs/java/java-debugging
- VS Code Java Refactoring：https://code.visualstudio.com/docs/java/java-refactoring
- VS Code Java Projects：https://code.visualstudio.com/docs/java/java-project
- VS Code Application Servers：https://code.visualstudio.com/docs/java/java-tomcat-jetty
- Eclipse JDT LS：https://projects.eclipse.org/projects/eclipse.jdt.ls
- Eclipse LSP4J：https://projects.eclipse.org/projects/technology.lsp4j

## 八、最终优先级结论

**绝对必须（不完成就不能称为 Java IDE）**：P0-01 至 P0-09。  
**Kairo 面向 JSP 老项目的差异化必需项**：P0-10。  
**接近 IDEA 日常效率的最低集合**：P1-01 至 P1-10。  
**可延后但很有价值**：P2 系列。

不要把 AI 聊天、插件市场、云同步、复杂主题、数据库工具放在 Debug、项目模型、Java 语义和 Problems 之前。