# Kairo IDE：万文件旧 Java/JSP 项目索引性能优化设计

版本：设计稿 1.0｜审查日期：2026-09-14  
审查基线：`Qioooba/kairo-ide@6ea00095d1d2a93c3f79ce2a15803b2f893d92ef`  
交付性质：设计与开发验收规范；未修改项目代码，未对用户真实工作区运行性能测试。

## 0. 最终决策

保留 Theia/Monaco + Node JDT LS + Go Runtime Agent。先修复缓存与生命周期，再建设 Kairo 共享文件清单、可靠变更流、持久化 JSP/Web 关系索引和资源预算调度。Java 的精确语义继续交给 JDT；不自研一套正则 Java 语义引擎，不通过关掉功能制造性能提升。

冷启动目标：减少真实工作量和重复工作，尽早可编辑，后台最终完成全工作区必要分析。
热启动目标：优先复用已验证持久化数据，无变化不重新生成项目配置、不主动全量重建语义索引；允许必要的元数据核验。
增量目标：按实际变化及保守依赖闭包更新，旧任务结果不可污染新版本。
正确性目标：分页不截断覆盖范围；未完成不冒充“没有引用”；缓存过期不能参与未校验的重构写入。

“最优”在此指推荐架构与实施顺序。线程数、堆大小和具体秒数必须用目标设备及真实数据测定，不能宣称已实现某个倍率。

## 1. 审查确认的代码问题

以下确认的是代码行为，不代表已经测出该行为在用户机器上的耗时占比。

| 编号 | 源码位置/符号 | 已确认行为 | 设计处理 |
|---|---|---|---|
| F01 | `java-extension/src/node/jdt-ls-manager.ts`，`start` | 有 `.metadata`、无 `.kairo-clean-exit` 时递归删除整个 JDT 工作区数据目录。[R01] | 改为锁保护、恢复校验、有限修复；全量重建仅作为最后恢复手段。 |
| F02 | 同文件，`doStop` / `markCleanExit` | 先发送终止信号，超时强杀；随后仍调用正常退出标记；该路径未执行 LSP shutdown/exit。[R02] | 协议级优雅退出；强杀/超时不得标为正常；记录真实退出原因。 |
| F03 | 同文件，`attachStreamLogging` | stdout 同时交给 JSON-RPC reader 和逐行日志处理；日志处理设置 UTF-8、拼接字符串、按换行切割；环形缓存按条数限量。[R01][R02] | stdout 仅做协议传输；协议层只采样元信息；stderr 按字节与速率限量。 |
| F04 | `java-ls-lifecycle.ts`，`initialDelayMs` | 首次 prepare 固定等 5 秒。[R03] | 用 runtime/context/project-model 的真实就绪事件代替固定等待。 |
| F05 | 同文件及 `services/jdtls.go` | project/context 都可触发激活；准备与 descriptor 路径都会调用安装确认；最终进程已有 start-key 去重，但不等于准备过程完全去重。[R03][R04] | backend singleflight；安装校验、模型生成、进程启动分别去重。不能据此宣称每次重新下载。 |
| F06 | `jsp-extension/.../workspace-layout.ts` | 通用遍历默认 500 个匹配文件，串行递归前端 FileService；无 completeness 返回；部分工具仅取首个根目录。[R05] | 共享清单、全部根目录、分页游标和明确完整性；不能仅把 500 改为无限。 |
| F07 | `jsp-tld-completion.ts` | 首次递归扫描；任意 TLD 或 WEB-INF/lib JAR 事件清空全部缓存；scanned 在扫描完成前设 true。[R06] | 每个文件/JAR 增量；in-flight Promise + epoch；扫描结束后发布成功状态。 |
| F08 | `startup-performance-tracker.ts` | 文件清单是内存 Map；默认 50,000 容量，满后淘汰条目；该类本身没有持久化机制。[R07] | 完整清单持久化，不可 LRU 淘汰；仅 AST、解码文本、查询页做容量缓存。50,000 并非当前 10,000 文件问题的已证实触发点。 |
| F09 | `jdtproject/generator.go` | 项目模型已有输出 hash 命中缓存，但命中判断发生在 Ant 路径解析、库目录读取、classpath stat 和渲染之后。[R08] | 保留已有缓存；增加前置输入依赖快照与变更驱动失效。不要错误重做整套生成器。 |
| F10 | `project-model.ts` | 若干 update 方法未比较语义内容就递增 revision；是否造成实际重建还需追踪订阅者。[R09] | 无语义变化不升修订号；区分 source-content、classpath、encoding、root/config 版本。 |
| F11 | `java-index-progress.ts` / manager | 暂停只压住进度显示；initialize 成功即 ready；进度 token 为空也不是天然的全工作区一致性证明。[R01][R10] | 真实能力分阶段；透明显示后台仍在运行；全局操作使用版本与就绪屏障。 |
| F12 | manager 配置/生命周期 | 默认 Xmx768m；动态注册处理器仅返回 null；部分配置依赖 sourceLevel，而已读的 lifecycle start 调用未传 sourceLevel。[R01][R03] | 核验有效配置和真实 watcher 通路；堆大小按测量分档，不把参数声明当作生效证明。 |
| F13 | `jdtproject/render.go` | Eclipse 分析级别至少 1.8，真实 source/target 保留在 Kairo 配置；JDT builder 与配置 outputDir 存在共享输出风险。[R11] | 明确分析级别与真实项目级别；分析输出隔离，实际 JDK6 编译和部署不受污染。 |
| F14 | `search/search.go` | 已有流式、取消、并发读等能力；仍以 walk 为输入；默认 10MB 文件限制，并有错误/截断信息。[R12] | 复用既有引擎，替换发现层；大文件走有界慢通道，结果必须报告真实覆盖范围。 |

还应核验但不能凭源码片段定罪：重复源根、同一项目多次导入、窗口重连导致重启、重复 watch、Jar 内容反复读取、杀毒/网络盘时延、GC 与换页、依赖下载等待、未注册到生产路径的“优化类”。

## 2. 架构边界：统一发现，不重复实现 Java 语义

推荐职责：

| 组件 | 唯一职责 | 不应承担的职责 |
|---|---|---|
| Go Workspace Catalog | 文件与目录清单、路径身份、角色、变更事件序号、持久化记录、分页检索 | 不用正则代替 Java 绑定/调用关系解析 |
| Node Workspace Coordinator | 工作区生命周期、JDT 会话所有权、跨进程调度、真实状态和配置投递 | 不在事件循环上同步递归扫描或解析万文件 |
| Node Worker 中的 JSP/Web 分析器 | 复用现有可纯化 TS parser，按内容版本解析 JSP/TLD/web.xml/EL 结构，返回结构事实 | 不在浏览器中做全工作区 FileService 逐目录往返 |
| JDT LS | Java 类型、补全、精确引用、调用/继承关系、重构；受支持的 JSP 派生 Java 单元语义 | 不把全部静态资源都当 Java 源码，不重复触发全量 build |
| Monaco/前端 | 当前编辑缓冲区、局部渲染、增量提交、结果分页和虚拟列表 | 不为未打开的一万个文件创建模型，不保有全部 AST |
| 现有 Search 引擎 | 在清单给出的候选文件上执行匹配、流式输出、取消和编码处理 | 不在每次输入时重复发现整棵目录 |

“统一清单”指 Kairo 自有能力共享发现层，不意味着可以未经验证绕过 JDT 内部资源系统，也不承诺所有进程合计只发生一次物理读取。优先减少可控的重复工作。

禁止增加第二套 Go/TS 全量 Java AST/类型系统。普通文件名与文本搜索不需要等待 Java 索引。JSP 结构索引和 Java 精确语义必须分别标注覆盖与就绪。

## 3. P0：生命周期、协议日志与缓存恢复

### 3.1 唯一所有者

JDT 进程的生产所有者是 Node 后端。Go 提供安装/启动描述，不要改已经弃用的 Go Start/Stop 来假装优化成功。[R04][R13]

以 workspace session 为所有权单位。前端 project/context 事件只是表达目标状态，不能直接多次准备和重启。按稳定 sessionKey 合并同一请求，旧 activation token 的结果丢弃；不同请求在受控状态机中串行切换。

服务端 state 处于 ready 不代表正在服务正确的 root。必须同时核验 sessionKey、实际 root 集合、engine 版本和 dataDir。多窗口必须明确会话隔离，或使用能正确路由多客户端、未保存缓冲区的共享服务；不能简单保留一个 client 指针就声称支持并发共享。

### 3.2 缓存身份

缓存键包含规范化根身份、工作区持久 ID、引擎兼容代际、相关设置代际。不要用随机启动 ID、当前时间、窗口 ID 或目录 basename 作为缓存唯一身份。

classpath 或单文件变化通常触发增量失效，不要直接把所有配置 hash 塞进 dataDir 名称，造成每次调整都冷启动。引擎版本变动按兼容矩阵决定新代际，不与旧版本共写。

路径保留原始展示 URI 与物理身份。Windows 大小写规则按真实卷/目录能力处理，处理盘符、UNC、软链接/junction、循环链接、外部链接源根。不能简单全小写所有路径。

### 3.3 正常退出

在协议已初始化且可用时：停止接纳新任务 → 取消/收束后台请求 → 发送 `shutdown` 并等待响应 → 发送 `exit` → 确认目标进程退出与锁释放 → 原子写入退出结果。LSP 的 shutdown/exit 是两个步骤。[E03]

超时才使用操作系统终止手段。强杀、初始化中断、退出码异常、未收到响应、旧进程仍存活均不能标 clean。退出要有上限，但阈值可配置；不能为了不等退出就允许第二个进程共写 dataDir。

正常退出标记是恢复线索，不是“所有缓存一定有效”的证明。将退出原因、会话代际、协议结果与引擎版本记录到结构化状态中。

### 3.4 异常退出恢复

依次执行：确认没有活跃拥有者并取得锁 → 检查模型/版本一致性 → 尝试引擎自身恢复 → 用可靠的项目模型状态和已知存在的语义探针校验 → 对明确损坏项目做受支持修复 → 最后隔离旧 dataDir 并创建新代际。

空引用结果不能单独证明缓存损坏；可能本来就没有引用或仍在导入。不得在 JDT 存活时手删其内部索引文件。全量恢复必须记录原因、次数并设置重试上限，避免“慢→超时→杀进程→删缓存→更慢”循环。

大量旧缓存的回收放在后台、受预算约束，不能在开项目关键路径 `rmSync` 整棵目录。不能删除源码、用户已有 Eclipse 配置或实际部署输出。

### 3.5 stdout 与日志

stdout 原始流只交给协议 reader，不额外 setEncoding、不按行复制 JSON、不把协议正文广播到前端。默认只记录方法名、耗时、字节数、请求 ID 和错误类别；敏感正文默认不记录。

stderr 使用按总字节、单条长度、速率三重限制的缓冲。没有换行的长数据也必须有界。trace=off 不等于目前额外的 stdout 日志已经关闭，因此要实际拆掉该路径。采样诊断模式需自动到期并能导出摘要。

## 4. 项目模型与导入：避免从一万个文件猜一万个答案

以现有 ProjectModel 能力为起点，先核验它是否已接入真实导入、JDT、搜索与编译调用链。不要仅新增类、导出符号、写 mock 测试。[R07][R09]

明确有序来源：用户显式配置优先；尊重已有 Eclipse/Ant/Maven/Gradle 项目模型；自动探测只补缺失项。重复开项目复用上次模型，只验证其输入依赖是否变化。

模型至少记录 sourceRoots、test/generated roots、webRoots、resourceRoots、orderedClasspath、projectEncoding/per-file overrides、project source/target、compiler JVM、server JVM、language-server host JVM、analysisOutput、realBuildOutput。

缓存输入必须覆盖 Ant import/include、properties、fileset/glob 的匹配目录、依赖项目配置、环境允许项与 jar 目录成员变化。不能只缓存 build.xml 的 mtime；新放入一个满足 glob 的 jar 也会改变 classpath。对于动态/不可确定的 Ant 配置，显式标注需要重新解析，不能冒充精确缓存命中。

现有 generator 已避免输出内容相同就重复写文件，但缓存检查偏后。增加输入依赖指纹命中，跳过重复 Ant 解析与全量路径验证；对于未知变更仍需核验，不许用 TTL 当作正确性依据。[R08]

生成文件采用 write-if-content-changed。保留真实配置文件时间戳，避免触发自激式文件事件。用户手写的 .classpath/.project 不得被无提示覆盖。输出集合验证必须包括必要 prefs 文件存在与有效，不能只认一个缓存 key 文件。

严格保留 classpath 顺序和每个项目的解析上下文。相同内容 Jar 可复用物理解析结果，但不同路径、顺序、项目可见性不能被随意合并。禁止以同名 basename 作为唯一去重依据。类冲突扫描使用缓存的类清单，避免每次模型更新重新展开所有 Jar。

源根重叠需要明确 inclusion/exclusion；webroot 不是天然的 Java source root。生成源码仍是语义输入；纯输出是另一类。输出目录可能也是其他模块的二进制依赖，必须保留其依赖角色。

## 5. 共享文件清单和持久化设计

### 5.1 存储选择

建议新增 Agent 管理的本地 SQLite 派生数据存储，单写者、有界读池、批事务和适当 checkpoint；不引入外部数据库服务。当前读取的 Go module 没有 SQLite 依赖，需在打包、实际 SQLite 内核版本和 Windows 测试通过后引入。[R14]

数据库放在本地用户缓存目录，不放项目网络共享目录。WAL 依赖同主机共享内存，官方明确不适用于网络文件系统。[E04] 如部署在 SMB/漫游盘，必须选择本地缓存位置或经过验证的替代模式，不能强启 WAL。

版本要求：选择包含 WAL-reset 修复的 SQLite 内核；官方列出 3.51.3 及之后、以及特定回移植版本包含修复。检查绑定实际携带的 SQLite 版本，不只看 Go 包版本。[E04]

建议起始参数（待测）：256–1024 条一批，并叠加字节/时间预算；一个写事务完成单文件的新事实替换和版本水位更新；读查询短事务、分页，不让长时间 UI 查询持有 DB 快照阻塞 checkpoint。可重建派生缓存的耐久策略必须与恢复/事件重放语义匹配。源码和用户编辑内容不能按“可丢缓存”对待。

### 5.2 逻辑表

- workspace/root：稳定身份、模式版本、引擎兼容版本、目录能力与最后完整校验状态。
- file：fileId、rootId、relativePath、kind/roles、size、mtime 精度、可用文件系统身份、contentHash、encoding、scanGeneration、deleted/tombstone。
- directory/glob_dependency：目录成员快照及配置 fileset 对它的依赖。
- file_analysis：文件内容版本、parser 版本、结构/关系摘要、错误状态。
- dependency_edge：include、taglib、配置/类/资源等带类型边，正反向均可查询。
- jar_artifact：内容身份、中央目录/类/TLD 摘要、状态和版本；项目 classpath 引用单独存储，保留顺序。
- event_checkpoint / job_checkpoint：已持久提交的事件序号与任务恢复进度。

完整文件清单不能因内存上限淘汰。内存缓存可以仅驻留热点行，剩余由磁盘查询。必须允许超出 50,000 文件，不得删除清单条目后对 UI 宣称“全部完成”。

### 5.3 文件角色与排除规则

区分“目录可见”“参与普通文本搜索”“参与 Java 语义”“参与 JSP/Web 索引”“作为二进制依赖”“部署输出”“版本管理内部数据”。一个文件可以有多个角色。

排除规则由真实模型与用户策略共同确定，并记录可解释的原因。禁止仅凭 `lib`、`build`、`out`、`work` 目录名删除合法源码/依赖。`WEB-INF/lib`、`WEB-INF/classes`、TLD、tag/tagx/jspf、生成源码和外部 source roots 都须覆盖。

版本管理内部数据库可以不做源码解析；源根中的必要文件不能因为被 Git/SVN 忽略就不进入语义索引。用户显式“全部文件搜索”要与默认源码搜索区分。

## 6. 可靠增量：不把“没有收到事件”当“没有变化”

首次扫描采用 watcher-before-scan 协议：先建立观察并获取起始水位，扫描发布文件快照，再重放扫描期间事件，核对水位后提交 generation。若能力无法提供稳定水位或出现丢事件，执行必要的再核验。不能只“扫描完再开始 watch”，留下漏变窗口。

变更归并至少覆盖 create/change/delete/rename、编辑器临时文件替换、短时间连续保存、目录重命名和大小写变更。合并依据是内容版本与物理身份，不是简单把所有同路径事件只保留最后一个。

发生溢出、断连或不可靠事件范围时，对相关子树或整个根重新枚举。Windows ReadDirectoryChangesW 的缓冲溢出可以丢弃通知内容，官方要求枚举目录/子树恢复差异。[E05]

热启动策略：有可靠且连续的持久变更日志时可重放差量；没有时做廉价元数据 reconciliation。IDE 关闭期间的修改不可能凭一个普通实时 watcher 补回来。NTFS USN 是可选加速能力，不作为跨盘、网络盘、权限受限环境的必需条件。

mtime+size 不是内容相等的严格证明。对元数据变化、事件可疑、时间精度不足、配置/Jar 替换以及需要强正确性的操作核验 hash；mtime 和 size 均不可信且无持久日志时，严格校验只能读取更多内容，不能同时承诺零读取和绝对最新。

扫描中的文件可能被再次修改。读取前后验证身份/版本，必要时重试；worker 返回时按 workspaceGeneration + fileVersion + parserVersion 做 compare-and-swap，拒绝陈旧结果。

持久事件与文件分析数据的提交要有可恢复的顺序；崩溃后从最后成功提交水位继续，不复用半写记录。扫描被取消时不得把未扫到的旧文件统统当删除。

JDT 的动态 watcher 注册必须实际实现，并维护注册 ID、模式、kind 和取消注册；将匹配且归并后的事件投递给实际 LS 会话。现有空注册回调要处理。[R01][E06] 在验证该链路前，不能削弱 JDT 自己的资源刷新作为所谓性能优化。

## 7. JSP/Web 关系索引与虚拟 Java

### 7.1 一次解析，多种消费者

针对同一已保存文件内容版本，生成并复用 JSP page model：directive、scriptlet、expression、declaration、taglib 绑定、静态 include、jsp:include、useBean、EL、资源路径、HTML/JS/CSS 区域等。

复用现有 TS parser/page-model/virtual-manager；纯计算移到有界 Node Worker 池。Go 清单提供批次/变更；传输按字节有界，避免为每个文件做浏览器→Node→Go 多次目录 RPC。将结构摘要用于补全、导航、引用、诊断，避免多个 provider 各解析一份全文件字符串。

未保存的编辑器内容为 overlay，优先级高于磁盘。overlay 与持久化快照分离，保存后按实际内容版本合并；旧磁盘事件不能覆盖新 buffer。

### 7.2 TLD 与 JAR

TLD 缓存按每个文件与 Jar 内容身份更新，不是全 workspace.clear。保留未变化记录，变更 Jar 只重读其相关摘要。in-flight 扫描使用共享 Promise 和 generation；失败不永久记成 scanned，旧 generation 不允许回填新工作区。

支持项目声明的散落 TLD、web.xml 标签库映射和 Jar 中的 META-INF TLD。当前读取的 TldCompletionProvider 遍历分支只解析散落 `.tld`；不能把“监听 jar 变化”当成“已经读取了 Jar 内标签库”。[R06]

Jar 内容按需要读取，不全量解压到大量小文件。类清单、TLD、源码附着分别缓存。压缩损坏、受限文件、极端解压比进入可取消/有界错误路径，不能卡死主扫描。

前缀是每个 JSP 的绑定，不可仅凭 TLD short-name 全局套用。相同 URI 的覆盖次序要遵循项目/容器上下文。

### 7.3 依赖传播

修改单 JSP 更新自身结构；修改静态 include 的 jspf/tag/TLD 更新相关消费者闭包；更改 web.xml 或 classpath 仅失效受影响部分，影响无法可靠确定时保守扩大，不凭猜测缩小。

include 图需处理循环、重复包含、编码差异、路径逃逸检查与不同引用上下文。同一个 jspf 在不同页面上下文中不一定能共享同一份完整 Java 语义结果。

区分静态 include 与运行时 include/动态 EL 路径。静态不能确定的动态关系标为“动态/待运行时确认”，保留文本搜索、调试入口，不宣称静态分析穷尽运行时反射与动态路径。

### 7.4 精确 Java 语义与完整性

当前/打开 JSP 的虚拟 Java 单元优先；其他页面后台推进。不能只给打开页创建单元，再声称全局引用/重构覆盖所有 JSP。

需要全局 Java 引用的 JSP 派生单元必须对 JDT 的实际工作区索引可见；短暂 didOpen/didClose 的 standalone 文档不能未经测试就当作持久全局索引。优先固定专用生成源根、稳定虚拟 URI/类型名、增量生成与支持的项目映射。不要为每个文件反复修改 classpath，禁止将生成目录自身重新输入 JSP 生成器。

虚拟单元与 source map 缓存键包含原文件版本、包含依赖版本、配置/语义上下文和翻译器版本。处理 UTF-16 列、CRLF、中文、多字节原编码、插入/删除对诊断与断点映射的影响。

现有 VirtualDocumentManager 的租约与同步能力可复用，但应补 server-generation 切换后的重放、并发 open/update 串行化、版本有效性与容量回收验证。[R15] 回收内存对象不能删除仍用于全局语义的持久单元。

全局重构使用完整性屏障和文件版本再验证；受影响范围尚未知时不能仅扫描热点页。若必须补扫，显示进度并等待，不能返回“没有引用”。

## 8. Java 6、编码和输出隔离：必须通过的兼容性闸门

仓库当前在 Eclipse 项目模型中把低于 1.8 的级别抬高，同时真实编译配置保留原级别。[R11] 官方当前 JDT LS 公开支持范围从 Java 8 开始，运行宿主要求 Java21；不能把“宿主新 JDK”与“项目可以升级语义”混为一谈。[E01]

性能优化期间不得无条件去掉现有兼容措施，也不得宣称抬到 Java8 就与 Java6 完全等价。使用兼容性测试覆盖 Java6 语法、可用类库、泛型/重载、Servlet/JSP API、反射字符串边界和 source map。

明确三套 Java 配置：language-server host、project compiler、Tomcat/WAS runtime。真实 compiler 与运行 JVM 不随语言服务器升级而改变。强 Java6 兼容模式必须由验证过的引擎配置/兼容诊断落实；若当前引擎无法满足，按工作区选用经过测试的 legacy engine profile，而不是默认同时开启两套重型语言服务。

JDT 分析/自动构建输出进入独立缓存目录，不写实际 javac/Ant 输出和热部署目录。实际构建、热替换、部署只使用真实项目工具链产物。索引完成不应触发生产包构建、启动 Tomcat、整站部署或全量 JSP 编译。

编码使用统一规则和已确认配置：GBK、GB18030、UTF-8、BOM、JSP pageEncoding、XML 声明以及 properties 语义分别验证。GB18030 不能为了缓存命中直接等同 GBK；解码器版本和有效编码纳入内容分析键。未知编码不自动改写源文件。

## 9. 搜索、UI、首屏和全功能保留

文件名搜索从完整清单查询。全文检索复用已有 Go 流式/取消引擎，并新增从清单批次输入的路径，不为了统一而丢掉已有编码与替换能力。[R12]

初次打开项目不强制建立一个覆盖全部文本的全量倒排索引。先做到清单共享、流式查询和旧请求取消；若真实测试仍表明重复全文搜索成本过高，再增加可回退的文本候选索引。

trigram 等索引只能作无假阴性的候选过滤。短模式、复杂正则、混合编码、尚未索引文件必须回退精确扫描；不能因过滤器不支持就少结果。

默认 10MB 等资源保护不应变成永远不可搜索。可在有界大文件通道中继续完成；处理正则跨块语义、超长行与取消。确实未完成时列出文件和原因，“完成”与“达到显示上限”是不同状态。

查询响应至少含：workspaceGeneration、snapshotVersion、items、nextCursor、isComplete、pendingScopes、errors、stale，以及按需统计 searched/skipped/cancelled/truncated。游标需要稳定快照与过期策略，防止边翻页边修改导致漏项或重复。

分页/虚拟列表只限制当前显示，不限制后端已发现文件数。全量替换/重命名先校验全范围与文件版本，再应用，不以当前第一页替代全工作区。

UI 首屏、编辑与词法高亮不等 JDT。恢复上次打开文件只创建实际恢复的模型，其他文件只保留轻量元数据。代码高亮全覆盖要求另行保持，不能用禁用 tokenization/语义服务解决索引等待。

CodeLens、inlay hints、调用/类型树按当前视图和展开分批请求；仍可展开全部。文档修改合并增量，不每键重复全文传输；按 model/server generation 去重 didOpen。旧 completion/hover/symbol 查询可取消，不排成长队。

## 10. 资源调度：按 CPU、I/O、内存三个预算分别控制

后台 worker 多不等于更快；建议以目标设备测得的交互与全量完成时间同时优化。不要按本机核心数无限创建 worker/goroutine/Promise。

优先级：交互中的补全/定义/编辑同步最高；用户显式全局查询其次；当前文件依赖和打开文件诊断再次；后台全量索引最低。低优先级任务加入 aging 或保留最小份额，避免持续编辑导致永远不完成。

队列、输入缓冲和结果缓冲按条数及字节双重有界；批次按字节/耗时而非只按文件数切分。单个巨大文件不能独占 worker；能分片的分片，不能分片的放可终止独立任务。取消向跨进程、reader、worker 及写入阶段传播。

Node/Go 可通过 coordinator 领取预算租约，异常退出自动回收。JDT 内部工作无法由外部 semaphore 精确逐文件暂停，应使用它实际支持的设置/任务接口，结合限制 Kairo 外围重任务与减少无谓触发。禁止编造 JDT pause 接口或用停 Java 进程模拟暂停。

建议起始分档（不是性能承诺）：

| 环境 | JDT 最大堆起始候选 | JSP/Web worker | 文件读取并发 | Kairo 额外重任务 |
|---|---|---|---|---|
| 4GB 低配/VDI | 768MiB 与 1024MiB 做 A/B | 1–2 | 本地 SSD 2–4；慢盘 1–2 | JDT 忙时优先 0–1 |
| 8GB 常规 | 1024–1536MiB 做 A/B | 2 | 4 左右起测 | 1–2 |
| 16GB 及以上 | 1536–2048MiB 起测 | 2–4，受核心数约束 | 4–8 起测 | 2 左右起测 |

Xmx 不是进程 RSS，更不是 IDE 总内存。测量 Electron/Node、Go、JDT、编译器、Tomcat 总占用与系统可用内存、GC 和换页。4GB 环境仍同时运行大型业务服务器时不存在靠软件保证任意 workload 全速的方案；用有界磁盘缓存和顺序化保持可用，不删功能。

`java.maxConcurrentBuilds` 控制项目构建数量，不是通用索引线程数；`java.project.resourceFilters` 使用 Java 正则，`java.import.exclusions` 使用 glob，不能互换。[E02] 参数必须验证当前打包的 JDT 版本实际接受。

GC、堆和 worker 调优只能在去掉重复工作后做。不要无依据把 G1/Parallel/ZGC 任一种写成所有机器最佳；禁止索引每批后强制 GC、定时重启进程或定期清缓存。

## 11. 真实就绪状态、诊断和可观测性

定义：editorReady、inventorySnapshotReady、inventoryVerified、javaProtocolReady、projectImported、activeDocumentSemanticReady、workspaceSemanticReady。JSP/Web 各有自己的 generation/coverage，不与 Java 的一个 ready 位混用。

已有 PR15 tracker 可以复用，但必须接入真实代码路径。单调时钟测量阶段跨度；跨进程使用 correlationId 和统一事件结构，避免把不同起点的 Date.now 差值相加。

必须测量：准备/安装确认、模型恢复/生成、发现文件、读取/解码、JSP 解析、Jar 处理、JDT 导入/构建/索引、初次补全、全局结果完整时刻。加上读取字节、重复读取、metadata 调用数、cache hit/miss 原因、实际重建次数、队列等待、取消次数、事件丢失、RSS/heap/GC、CPU/I/O/事件循环延迟。

采样聚合，不为一万个文件生成十万个前端日志事件。提供“为什么现在还在索引”视图：阶段、已发现/已完成、当前阻塞、剩余未知、慢文件/Jar、恢复原因。不能以空进度 token 或任意 sleep 假定全部完成。

全工作区就绪通过已验证的 JDT 作业/项目状态与事件水位屏障实现；若当前可用协议没有可靠屏障，补最小服务端适配，而不是虚构现成 API。不能每次点击全局查询都强制 full build。

“暂停”必须明确作用域：能暂停 Kairo 自有队列就真实暂停；JDT 不支持可靠暂停时如实显示仍运行，提供经验证的低负载调度选项，不只是冻结进度条。[R10]

## 12. 特殊环境与必须覆盖的边界

| 情况 | 必须的行为 |
|---|---|
| 冷启动无缓存 | 全量发现、优先活动文件、后台全部完成；无伪 ready |
| 正常热启动无变化 | 复用缓存，允许必要 metadata 核验，不由 Kairo 强制全量重建 |
| IDE 关闭时外部改文件 | 持久日志重放或 reconciliation；不能信普通 watcher |
| 单文件连续保存/临时文件替换 | 合并事件，最新 buffer 优先，旧结果丢弃 |
| 修改同名同大小 Jar | 依版本/可疑变化核验内容，保留正确 classpath 上下文 |
| Git/SVN 切换/更新上千文件 | 事件批量归并，去重，取消旧版本任务，恢复一致状态 |
| checkout 与扫描/重构并发 | 用版本屏障；重构应用前再校验，不改错文件 |
| watcher overflow/挂载断连 | 标不完整并重扫必要范围，不静默忽略 |
| 多根、多项目、交叉依赖 | 清单全覆盖，依赖图明确，JDT 会话不串项目 |
| 多窗口/双实例同根 | 正确会话锁和缓冲区隔离；不能两个 JDT 写同一 dataDir |
| 符号链接/junction/UNC/中文路径 | 去循环、合法外部根显式建模、保持 URI 映射正确 |
| 磁盘满/权限错误/损坏缓存 | 保持编辑与原文件安全，明确降级和重试，不能报完成 |
| 文件超大/超长行/JSP include 环 | 有界任务与明确诊断；不永久少扫 |
| XML 外部 DTD/依赖仓库不可达 | 使用受控本地解析/缓存；网络等待不进入首屏关键路径 |
| 混合编码/错误编码/GB18030 | 同一编码规则与缓存键；不能错误解码后参与安全重构 |
| 恢复睡眠/VDI 重连/时钟跳变 | 连接重建、单调计时、事件缺口校验，不盲目清缓存 |
| 构建/部署不断产生输出 | 输出角色分离和事件路由，防止索引-构建互相触发循环 |
| 引擎升级/配置变更 | 兼容代际和选择性失效；旧缓存保留到新缓存验证完成 |
| 安全软件/慢盘/共享盘 | 测量文件 I/O 归因；本地缓存与低并发；不得默认关闭安全软件 |
| 同时跑本地大模型/大型 Tomcat | 动态可用内存预算，不按整机总内存分配最大堆 |

安全软件排查只做经用户/管理员允许、范围明确的测试，不建议全盘排除或关闭保护。网络盘源文件可保留原位置；首先将派生缓存放本地并合并读取。源码镜像/远程 Agent 不作为这一轮的必做大重构，只有实测网络是主瓶颈时再设计同步一致性与写回。

## 13. 实施顺序与真实调用链验收

| 阶段 | 交付内容 | 重点入口 | 退出标准 |
|---|---|---|---|
| PERF-00 | 基线、阶段统计、完整性固定用例 | 真正打开项目入口、manager、generator、JSP provider、Search | 能明确拆出等待/扫描/导入/索引/GC；基线可重跑 |
| PERF-01 | 协议 stdout 修复、优雅退出、恢复状态机、singleflight | Node manager/service/lifecycle，Go services/jdtls | 不重复启动、不误写 clean、不无依据清库；异常恢复有证据 |
| PERF-02 | ProjectModel 输入缓存、有效配置、分析输出隔离 | project-model.ts、jdtproject generator/render | 不变配置不重写、不升假 revision；真实 JDK6 产物无污染 |
| PERF-03 | 共享清单、SQLite、变更流、水位与恢复 | 新增 catalog/indexstore/watch 服务并注册生产 services | 10k/50k+ 全清单，不漏增删改，崩溃可恢复 |
| PERF-04 | JSP/TLD/Web 结构缓存和依赖增量 | JSP parser/page-model/TLD/virtual manager、Node Worker | 改单 TLD 不清全库；未打开 JSP 仍可进入全局语义 |
| PERF-05 | 旧消费者迁移、分页、搜索候选输入 | workspace-layout、JSP providers、Search、前端检索入口 | 旧递归发现路径退出生产请求；结果覆盖不退化 |
| PERF-06 | 跨组件资源预算与真实就绪 | coordinator、tracker/progress、所有重任务调用点 | 索引中仍可交互；暂停/完成/错误状态真实 |
| PERF-07 | 压测、兼容回归、打包与恢复演练 | Windows/Electron 真实产物 + 自动化 fixture | 正确性与性能都达标，提供 before/after 报告 |

建议新增目录（名称是设计建议，不是已存在代码）：`runtime-agent/internal/workspacecatalog/`、`indexstore/`、`workspacewatch/`；Node 侧 coordinator/worker 适配按现有扩展结构组织，避免无谓新增一个独立微服务。

每个阶段必须证明真实路径使用了新能力：记录生产调用 span，跑打开项目和实际命令，不接受只有单元测试、导出类或文档。尤其不要误改 `//go:build unwired` 的 APIHandler，或弃用的 Go JDT 进程管理路径。[R13]

迁移期间用 feature flag/协议兼容适配逐个切换消费者；需要对比新旧结果时离线或测试模式运行，生产默认不能新旧索引器同时全量扫描。

## 14. 性能及完整性验收

### 14.1 数据集

至少使用真实旧项目的一份脱敏副本，记录 Java/JSP/JSPF/TLD/XML/JS/CSS/资源数、总字节、行数、Jar 数及展开类数、source roots、依赖图、编码、磁盘类型和主机负载。增加超 500 JSP、超 50,000 文件的合成回归集。

不能以“一万个空文件”代替真实万文件工程。必须将 IDE 派生缓存冷/热与操作系统磁盘缓存冷/热区分，记录测量条件。建议冷启动至少 10 次、热启动至少 30 次，报告样本数、中位数和 P95；极端值保留原因，不能静默丢弃。

### 14.2 性能目标

下列为开发 SLO 候选，不是实测承诺；以目标 4GB Windows 设备和指定真实项目定标。

| 指标 | 候选目标/必须满足的约束 |
|---|---|
| 热开项目到可编辑 | 首轮以 P95 ≤2 秒为目标，入口计时与应用进程冷启动区分 |
| 已验证清单的文件名查询 | 首屏 P95 ≤150–200ms |
| 已就绪活动文件的补全 | P95 ≤300ms 为初始目标，按项目和设备记录 |
| 索引期间键入/滚动 | 跟踪 P95、长任务与最长冻结；不能为总耗时更短牺牲可用性 |
| 不变项目热启动 | Kairo 不主动全量重建；JSP 未变化内容零重复解析；Jar 摘要不重复展开 |
| 单 TLD/JSP 变动 | 仅更新该记录及正确依赖闭包；不能 workspace-wide clear |
| 真正完整索引时间 | 相对基线下降，首轮可设至少 30% 为优化目标；最终由测量归因和报告确认 |
| 内存 | 队列/缓存有界，连续开关项目无增长泄漏；没有 OOM/重启循环 |

性能比较需要同时报告 first-usable 与 all-required-indexes-complete。把全量索引无限延期、不再诊断未打开文件、少扫文件、取消长任务不重试，均不算性能达标。

### 14.3 功能判定

对照三类证据：旧版功能基线、具备明确预期答案的 fixture、必要时与成熟 IDE 的对应功能做交叉核验。旧版本本来就漏掉 500 之后的 JSP 时，不能拿旧结果当完整性 oracle。

必须覆盖补全、定义、引用、方法符号、调用/类型层级、重构预览与应用、JSP 静态 include/EL/TLD/web.xml 导航、Java/JSP 诊断、普通/正则/中文搜索替换、GBK/GB18030 读写、调试断点/source map、JDK6 编译、Tomcat/WAS 配置与热部署。

索引未完成时用全局引用/重命名验证：要么返回明确未完成并继续计算，要么等待屏障后给完整结果；绝不“0 references”就结束。修改文件与重构同时发生时应安全重算或拒绝陈旧应用。

实际界面 E2E：启动打包产物 → 打开真实工程 → 输入/滚动 → 打开 Java/JSP → 补全/跳转 → 全局搜索/引用 → 保存变更 → 关闭/强杀/重开 → 检查缓存和功能。后端接口测试用于定位，不能替代产品路径测试。

## 15. 明确不作为默认方案的方向

不重写整个 IDE；不替换 JDT 为正则/向量库；不默认启动第二个 Java 语义服务；不把全部文件转成 Monaco model；不无上限并行；不扩大堆到占满 4GB；不定期清缓存或自动重启来掩盖泄漏；不强制用户升级业务 JDK；不忽略 WEB-INF/lib/生成源码/未打开 JSP。

JDT 共享索引可在缓存与模型正确之后评估。官方当前仍将 sharedIndexes 标为实验性，必须核验打包版本、跨工作区隔离及性能收益；不能共用可写 `.metadata` 代替共享 Jar 索引。[E02]

USN、预生成依赖摘要、二级文本索引、应用级 JVM 启动缓存、源码本地镜像都是条件优化：测量证明收益、验证正确性后启用，不一起堆入第一轮。可预装/预热公开且版本固定的库索引，不随包携带用户私有工程索引。

## 16. 给实现 AI 的任务书

按本设计分阶段落地。开始先读取当前 HEAD，对照审查基线的变更，不覆盖用户未提交内容。先建立 PERF-00 的真实基线，再处理 PERF-01 与 PERF-02。每阶段给出修改文件、真实调用链、测试命令、基线数据、对比结果、未完成项和风险。

以下条件不可让步：

1. 优化必须接到实际打开项目、JDT、JSP provider 和 Search 的生产路径，不能只写新类或 mock 测试。
2. 不以跳过文件、关闭功能、缩减搜索范围或虚假 ready 获得指标。
3. Java 语义仍由验证过的 JDT profile 负责；JSP 派生单元的全局可见性必须实测。
4. 不变项目的缓存持久复用；崩溃恢复有限、有证据；全量清库不是默认启动策略。
5. 正常退出遵循 shutdown/exit；stdout 原始协议不进入逐行日志；强杀不标 clean。
6. 清单完整持久化；热启动变化核验有可靠路径；watcher 丢事件/离线改动有恢复机制。
7. 索引结果、未保存缓冲、重构和 source map 使用明确版本/代际；旧任务不可覆盖新状态。
8. GBK/GB18030、Java6 实际编译、调试、热部署与分析输出隔离通过回归。
9. CPU/I/O/内存和队列有界；慢机器不丢功能，只降低后台吞吐并真实报告状态。
10. 用真实打包 UI 测量 first-usable 与 full-complete；没有运行的测试明确写未运行，不编造倍数或秒数。

## 来源索引

### 仓库原文（均锁定审查 commit）
- [R01] [packages/java-extension/src/node/jdt-ls-manager.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/java-extension/src/node/jdt-ls-manager.ts#L258-L620)
- [R02] [packages/java-extension/src/node/jdt-ls-manager.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/java-extension/src/node/jdt-ls-manager.ts#L890-L1080)
- [R03] [packages/java-extension/src/browser/java-ls-lifecycle.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/java-extension/src/browser/java-ls-lifecycle.ts)
- [R04] [runtime-agent/internal/services/jdtls.go](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/runtime-agent/internal/services/jdtls.go)
- [R05] [packages/jsp-extension/src/browser/workspace-layout.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/jsp-extension/src/browser/workspace-layout.ts)
- [R06] [packages/jsp-extension/src/browser/jsp-tld-completion.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/jsp-extension/src/browser/jsp-tld-completion.ts#L119-L277)
- [R07] [packages/java-extension/src/browser/startup-performance-tracker.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/java-extension/src/browser/startup-performance-tracker.ts)
- [R08] [runtime-agent/internal/jdtproject/generator.go](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/runtime-agent/internal/jdtproject/generator.go#L213-L487)
- [R09] [packages/java-extension/src/browser/project-model.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/java-extension/src/browser/project-model.ts)
- [R10] [packages/java-extension/src/browser/java-index-progress.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/java-extension/src/browser/java-index-progress.ts)
- [R11] [runtime-agent/internal/jdtproject/render.go](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/runtime-agent/internal/jdtproject/render.go)
- [R12] [runtime-agent/internal/search/search.go](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/runtime-agent/internal/search/search.go#L1-L240)
- [R13] [runtime-agent/internal/api/api_handler.go](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/runtime-agent/internal/api/api_handler.go#L1-L28)
- [R14] [runtime-agent/go.mod](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/runtime-agent/go.mod)
- [R15] [packages/jsp-extension/src/browser/virtual-document-manager.ts](https://github.com/Qioooba/kairo-ide/blob/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef/packages/jsp-extension/src/browser/virtual-document-manager.ts)

### 官方技术依据

- [E01] [Eclipse JDT LS：运行要求、支持范围与 -data 工作区](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
- [E02] [Red Hat vscode-java：资源过滤、构建并发与实验性共享索引](https://github.com/redhat-developer/vscode-java)
- [E03] [Microsoft LSP：shutdown](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_includes/messages/3.17/shutdown.md)
- [E03b] [Microsoft LSP：exit](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_includes/messages/3.17/exit.md)
- [E04] [SQLite：WAL 约束、checkpoint 与 WAL-reset 修复](https://sqlite.org/wal.html)
- [E05] [Microsoft：ReadDirectoryChangesW 与事件溢出](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
- [E06] [Microsoft LSP：动态能力注册](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_includes/messages/3.17/registerCapability.md)
