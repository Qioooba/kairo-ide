# Kairo IDE 对照 Lithe-IDEA：源码审计与分阶段改造方案

**审计日期：2026-09-12**  
**对象：Qioooba/kairo-ide 与 1lck/Lithe-IDEA**  
**交付性质：关键源码调用链审计、开发设计、可拆分 PR 计划，以及独立回归验证。**

> 核心结论：Kairo 最需要解决的，不是换一个更时髦的桌面框架，也不是继续堆功能按钮，而是让“项目 → 文件 → 编译工具链 → 构建产物 → 运行实例 → 调试会话”始终指向同一个对象。已有功能相当多，但这些身份和状态在边界处没有被一致约束，已经产生可以从源码定位的兼容性、错误目标选择、协议和任务生命周期问题。

## 阅读导航

- [1. 审计范围与证据规则](#scope)
- [2. 总体结论：该保留什么、该学什么](#conclusion)
- [3. 两个项目的实际差异](#comparison)
- [4. 问题清单与逐项修复设计](#findings)
- [5. 目标架构与模块责任](#architecture)
- [6. 核心数据契约](#contracts)
- [7. Debug 与 HotSwap 专项改造](#debug)
- [8. Java、JSP、调用关系与索引](#language)
- [9. 文件、编码、搜索与编辑安全](#documents)
- [10. 启动、性能、内存与进程管理](#performance)
- [11. 安全、发布与供应链](#security)
- [12. Lithe 复用清单：直接复制／移植／借鉴／不引入](#reuse)
- [13. 实施顺序与 PR 拆分](#roadmap)
- [14. 验收测试与持续优化机制](#acceptance)
- [15. 本次已经执行的验证](#verification)
- [16. 开发执行约束与完成标准](#execution)
- [17. 源码与规范证据索引](#sources)

<a id="scope"></a>
## 1. 审计范围与证据规则

### 1.1 固定源码快照

| 项目 | 审计 commit | commit 时间（UTC） | 备注 |
|---|---|---|---|
| Kairo | `6f6792213a540fad678cde5ea1790c92b83d3bcd` | 2026-09-12 15:25:17 | `chore: add Apache-2.0 LICENSE for open source` |
| Lithe | `9446a8fd0a318da883a2ce4757d3a429bbdfba03` | 2026-09-11 16:53:39 | 合并 Homebrew cask v0.4.7 相关变更 |

后续所有源码链接都固定到以上 commit，而不是浮动 `main`。提交时间使用 UTC，避免和本地日期混淆。如果仓库继续提交，先对受影响文件做 diff，再应用本报告，不能认定问题永久存在。[Kairo 快照][SK]；[Lithe 快照][SL]。

### 1.2 实际做了什么

本次通过 GitHub 接口读取目录结构，并针对编译、HotSwap、JDWP、HTTP/事件客户端、搜索、编码、JSP 虚拟 Java、语言服务生命周期说明，以及 Lithe 的共享调试内核、Windows 调试适配层、启动组织和边界检查脚本进行源码检查。重要问题尽量追到调用端与被调用端，而不是只读 README。

本次**没有**在容器中取得两个仓库的完整可构建工作树；容器的 GitHub 网络访问失败，后续阅读使用 GitHub 连接器完成。因此，**没有运行两仓库的全量构建、原仓库测试套件、桌面 GUI、Windows/Tomcat 6/WAS/JDK 6 联调或性能基准**。没有测得或声称任何产品级通过率、覆盖率、启动秒数、内存占用优势。

另行编写并实际执行了独立的 Go/Node 行为验证，以及本机 javac 编译实验。它们验证局部逻辑和修复方向，不等价于 Kairo 整体已修复。详见第 15 节与随附日志。

### 1.3 证据分级

| 等级 | 含义 | 本文写法 |
|---|---|---|
| A | 已读取的源码可以直接确定行为或缺口 | “该函数会……”“该路径未传递……” |
| B | 调用链形成实际风险，但需特定环境、并发顺序或集成测试触发 | “在……条件下可能……”，明确复现前提 |
| C | 架构、产品或工程改进建议 | “建议……”，不伪装成已发生的 Bug |

**A 不表示跑过完整应用；B 不表示可以忽略。** 例如错误服务器选择是源码确定的选择规则，其是否损害另一项目仍取决于实际运行实例。严重级别与证据等级分开：P0 为目标兼容性、错误运行目标或破坏性后果相关优先项；P1 为主要工作流稳定性；P2 为后续治理与体验。

### 1.4 需求基线

按你的实际使用环境确定优先级：Windows、本地 Java Web 项目、JDK 1.6、Tomcat 6、JSP/Servlet、GBK 文件，以及启动／断点／调用关系／搜索／补全／热更新。新架构不得把“IDE 内部工具需要较新的运行时”误当成“业务必须升级到新 JDK”。

Lithe 的 macOS、Windows、共享 Rust Core 是不同层次的实现。不能把 macOS 功能表直接当作 Windows 成熟度，更不能把 Core 中的字段存在当成前端已完整接线。

<a id="conclusion"></a>
## 2. 总体结论：该保留什么、该学什么

### 2.1 最重要的决定

**保留 Kairo 当前 Theia／Monaco 与 Go Runtime Agent 路线，做分阶段收敛，不整体替换为 Tauri + Rust。**

理由不是 Go 或 Rust 谁“更高级”，而是当前高风险问题集中在协议、目标绑定、异步状态、编码和兼容性契约；重写语言不会自动消除这些问题。反而会同时重建编辑器接入、平台管理、现有 JSP 能力和打包体系，扩大回归面。这是基于下述源码问题的工程判断，不是两框架性能跑分结论。

### 2.2 Kairo 已有且值得保留的基础

1. **已经有组合根。** 实际入口调用 `bootstrap.NewContainer`，不是架构文档里残留的所有旧实现状态。继续收紧依赖方向即可，不要误以为整个项目没有依赖装配。[K16] [K02]
2. **已有 DAP 和 HotSwap 尝试路径。** 不能把建议写成“先增加 Debug”；应把已经存在的 DAP、直接 JDWP、编译与运行实例整合起来。[K05] [K06] [K07]
3. **GBK 严格编码已经做了一部分正确工作。** `Encode` 在 GBK 分支使用严格 GBK 编码器，而不是无条件用 GB18030 掩盖不可表示字符，应保留。[K12]
4. **搜索已有工作池、容量限制和编码处理。** 优化重点是取消、结果完整性和索引策略，不是再添加一套并行搜索线程池。[K11]
5. **Java 文档同步已有可测试的核心逻辑。** 延迟合并、变更缓冲、语言服务恢复相关基础值得继续复用。[K20]
6. **JSP 扩展并不空白。** 已有脚本块、虚拟 Java、TLD、EL、web.xml、导航、补全及调试相关模块；问题是语义上下文与状态一致性，不是缺少所有功能。[K13] [K14] [K15]

### 2.3 Lithe 最值得学的部分

Lithe 值得学的是：把调试协议、状态转换和宿主 I/O 分离；用确定性的输入输出样例约束复杂逻辑；显式表示会话与操作；在首帧后安排初始化并打点；用脚本阻止架构边界不断退化。这些都有相应源码，而不是仅凭界面印象。[L01] [L02] [L03] [L04] [L06] [L08]

但也必须保持克制：其调试引擎文件本身很大，存在全局会话表及锁；其轻量导航是当前文件标识符匹配；Windows 通用断点模型并未完整承载 Core 的条件／命中／日志断点字段。**借鉴好的约束，不复制新的复杂度和不完整接线。**[L02] [L05] [L07]

### 2.4 第一轮不应该做什么

不要先重写 UI；不要先把 Go 全部翻译为 Rust；不要把多个有状态子系统拆成微服务；不要为了“编译成功”自动升级 Java 目标；不要用文本同名匹配替代 Java 语义重构；不要在目标不明确时悄悄选择第一个服务器。第一轮的成功标准是工作流可靠，而不是新增菜单数量。

<a id="comparison"></a>
## 3. 两个项目的实际差异

| 维度 | Kairo 已读源码显示 | Lithe 已读源码显示 | 对 Kairo 的判断与行动 |
|---|---|---|---|
| 产品适配 | 有明确的旧 Java Web、GBK、JSP 相关实现 | 共享内核及 Windows 通用工作台能力；本次未验证其 Java 6/Tomcat 6 全链路 | Kairo 更值得强化自己的旧系统适配方向；不能据此宣称整体胜出 |
| 模块装配 | 已有 `bootstrap.NewContainer`，同时保留兼容管理器、较大的 API Services 集合 | Core/Host 分离，另有 macOS 服务边界脚本 | 把“文档里的边界”变为 CI 可检查的依赖规则 |
| 编译兼容性 | 会将 source/target 抬到编译器最低支持值 | 本次未对其 Java 6 编译流程建立同等级证据 | 不做无依据胜负比较；Kairo 此问题须独立修复 |
| 调试状态 | DAP 热替换与直接 JDWP 回退共存，依赖可变 currentSession | Core 有会话、待响应请求、效果队列等状态；Windows 用 sessionId/operationId 接入 | 学其明确状态与所有权，不整块搬引擎 |
| 断点高级能力 | 本次没有逐项验证所有前端断点能力，不判定全面缺失 | Core 字段较丰富，但所读 Windows 通用同步函数仅发送 line | 建立端到端能力表，字段到 VM 均验收 |
| 断点编辑迁移 | 本次未证明现有 Monaco/Theia 锚点机制不足 | 有独立 UTF-16 编辑迁移算法与 JSON 样例 | 先测现有机制，缺口再移植，禁止双重迁移 |
| Java 语义 | 已有 Java 文档同步和 JDT 接入基础 | 轻量备用导航仅匹配当前文档标识符；它不是全部 LSP 能力 | 保留 JDT 为精确语义权威，降级结果必须标明 |
| JSP | 已有多个专用模块，虚拟 Java 按块生成 | 本次未形成可直接替换 Kairo JSP 的源码证据 | 自己补全“整页模型 + SourceMap”，不盲目找替代品 |
| 搜索 | 有并行扫描与 GBK 解码，取消链路有缺口 | 本次只定位搜索相关目录，未做完整实现对照 | 不声称谁更快；先修取消和完整性再比较引擎 |
| 首帧与初始化 | 本次没有产品级启动实测 | 工作台在首帧附近打点，并推迟异步 bootstrap | 借鉴分阶段启动与可观测性，而非宣传数字 |
| 测试 | 有大量测试文件，但部分协议预期本身不正确 | 有跨实现使用的契约样例、纯逻辑测试 | 引入规范黄金数据和真实目标环境测试，不能只加行数 |
| 安全 | 桌面模式强制 secret、loopback、路径授权基础已存在 | 本次未完成两项目全量安全审计 | 保留现有措施，补目标身份、认证目标绑定、资源权限矩阵 |

本表的依据集中见 [K04]—[K21] 与 [L01]—[L11]。未读取或未验证的能力没有按“缺失”扣分。不要以文件数量、测试文件字节数或 README 自报指标计算成熟度分数。

<a id="findings"></a>
## 4. 问题清单与逐项修复设计

### 4.1 优先级总表

| ID | 优先级／证据 | 问题 | 第一责任位置 |
|---|---|---|---|
| F01 | P0／A | Java 6 编译目标被自动提高 | `build/compiler.go` |
| F02 | P1／A | file URI 作为系统路径进入编译接口 | 前端 HotSwap → Runtime client → Go handler |
| F03 | P0／A | HotSwap 默认选择第一个可调试服务器 | `resolveJDWPEndpoint` |
| F04 | P0／B | await 后使用可变当前会话，存在跨目标热替换风险 | `java-hotswap-service.ts` |
| F05 | P1／A | 按首个同名 class 文件匹配产物 | `ResolveClassFile` |
| F06 | P0／A | 同名类多 ClassLoader 时直接取第一个 | `RedefineClassLive` |
| F07 | P1／A+B | DAP 错误被统一视为不可用并回退新 JDWP 连接 | `redefineViaDap` 与 agent 回退 |
| F08 | P1／A | JDWP char/short 按四字节编解码 | `jdwp.go` |
| F09 | P1／A | JDWP 握手只调用一次 Read | `jdwp_conn.go` |
| F10 | P1／A | 直接 JDWP 路径缺事件分流与 IDSizes 协商 | `jdwp_conn.go`、`jdwp.go` |
| F11 | P1／A | 协议包长度与部分游标操作缺边界校验 | `jdwp.go` |
| F12 | P1／A | JDWP 错误码表错误，部分测试沿用错误语义 | `jdwp.go`、`jdwp_test.go` |
| F13 | P1／A | 流式搜索消费者退出未取消生产者 | `SearchStreaming` |
| F14 | P1／A | UTF-16 原始字节用于 EOL 检测 | `encoding.Detect` |
| F15 | P1／A | charset 检测过宽，未知编码变成 UTF-8 | 编码探测函数 |
| F16 | P1／A | JSP 单块虚拟 Java 缺页面上下文 | `jsp-virtual-java.ts` |
| F17 | P1／B | JSP 并发补全共享虚拟 URI 的打开／关闭冲突 | JSP completion provider |
| F18 | P1／B | Agent 重启没有端口与就绪交接协议 | `doRestart`、`Listen`、`main` |
| F19 | P2／A | 自定义构建的 timeout cancel 被丢弃 | `handleCustomBuild` |
| F20 | P1／B | 幂等缓存只有 requestId，缺执行中占位及请求指纹 | `server.go` |
| F21 | P1／A | 字符串前缀不是工作区目录包含关系 | `isInWorkspace` |
| F22 | P2／A+B | 文档与现状漂移，兼容代码容易被误用 | 架构文档、JDT 管理器、入口 |
| F23 | P2／B | HotSwap 停止过程未完整拥有订阅与在途操作 | HotSwap lifecycle |
| F24 | P1／B | Agent 地址可配置与 secret 发送目标缺显式绑定 | RuntimeConnectionService |

### F01：Java 6 目标不能以“自动兼容”为名被提高

**证据。** `normalizeLevel` 在请求版本低于编译器最低版本时返回较高版本；`Compile` 将该结果用于 `-source` 和 `-target`。这不是单纯修正参数格式，而是改变了产物兼容目标。[K04]

**触发。** 项目 source/target 为 1.6，选中或回退到了最低支持 8 的编译器。原本应提示工具链不兼容，却生成 Java 8 目标产物。

**影响。** 本次真实 javac 实验已经观察到 target 8 产生 major 52 的 class；Java 6 的最大主版本是 50。不能以“javac 返回 0”作为可部署成功标准。[N03] [N04]

**修复。** 将 `normalizeLevel` 的“抬高”职责移除。新增工具链能力校验：输入项目 source/target、编译器支持集合、目标 JVM；不兼容则返回结构化 `toolchain_incompatible`，列出已安装且可满足目标的工具链，必须由用户显式选择。生成产物后再次校验实际主版本。对于自定义构建，同样扫描输出目录或产物清单，不能绕过目标校验。

**必须一起处理。** 语法级别、class 版本和可用 API 是三个不同约束。即便得到 major 50，若链接到 Java 6 不存在的 API，仍可能运行失败。使用经验证的旧编译工具链与目标类库配置，或经过验证的交叉编译方案；不把当前 JDK 的 `--release` 当作支持任意历史版本的万能参数。[N03]

**验收。** Java6+兼容工具链成功；Java6+不支持6的编译器明确失败；自定义脚本误产 major52 被部署前拦截；语言服务宿主 JRE 升级不会改变业务编译与运行配置。回滚策略是禁止不兼容构建，不是恢复静默提升。

### F02：HotSwap 文件 URI 与文件系统路径混用

**证据链。** 保存事件取 `model.uri.toString()`；HotSwap 编译请求把它作为 `file`；Runtime 客户端将 payload 原样 JSON 序列化；Go handler 对该字段调用 `filepath.Abs`。这条路径没有完成 URI 到宿主文件路径的转换。[K05] [K19] [K06]

**典型输入。** `file:///C:/work/My%20Project/src/A.java` 并不等同于 `C:\work\My Project\src\A.java`。简单去掉 `file://` 也不够，仍涉及盘符、编码、UNC、主机归属与其他 URI scheme。

**修复。** 协议统一接收 `sourceUri` 和 `projectId`，由文件所属宿主在边界解析与授权。内部文件服务返回已规范化的 `ResourceIdentity`，编译器只接受该身份对应的 `NativePath`。或者短期保持 `file` 旧字段，但新增规范化适配器并停止让调用点自行拼接。

**验收。** 空格、中文、`#`、`%`、盘符大小写、UNC、非 file scheme、越界路径都需测试。拒绝未知宿主路径。浏览器所在 Mac 不得把 Windows 目标路径按 Mac 规则转换。

### F03：不能选择“第一个可调试服务器”作为热替换目标

**证据。** `resolveJDWPEndpoint` 在未指定端口时遍历服务器，选择第一个运行／启动／调试状态且有调试端口的实例。前端 agent 回退没有携带能唯一绑定服务器的身份。[K06] [K05]

**触发。** 同时启动项目 A 和 B；保存 B 的类；服务列表中的 A 恰好先返回。

**影响。** 可能连接到错误 JVM；若类名重合，风险不止“热更新失败”，而是改变另一实例的执行逻辑。

**修复。** 将 `serverId`、`projectId`、`runConfigurationId`、`debugSessionId`、`sessionGeneration` 作为必需上下文。由服务端从已授权会话反查 endpoint；不接受客户端任意端口替代身份授权。找不到唯一目标则拒绝并让用户选择，禁止自动取首项。

**验收。** 交换服务器列表顺序不改变目标；只有 A 启动时保存 B 不更新 A；服务器重启并复用端口后，旧 generation 请求失效。该项修复前，建议将不明确目标的自动 HotSwap 关闭。

### F04：异步操作不能重新读取“当前会话”来决定副作用目标

**证据。** 保存触发后的编译存在 await；DAP 热替换函数随后再读取 `currentSession`。多文件 pending 集合被拆成并行 `void performHotSwap(file)`，没有从保存时固定完整目标上下文。[K05]

**风险条件。** A 的编译正在运行，用户切换到 B；或连续保存多个文件，较旧的编译最后完成。存在错误会话选择或旧产物覆盖新产物的风险，实际触发仍须并发联调。

**修复。** 开始操作时捕获不可变 `HotSwapContext`，后续只通过固定 sessionId 找会话；恢复、断线、重启均递增 generation。每个目标维持串行副作用队列，可合并尚未编译的保存，但不得改变已经在执行的操作的目标。编译产物携带 sourceVersion/hash，提交前校验是否仍为有效最新结果。

**验收。** 人工阻塞编译返回，切换会话后放行；B 必须零次收到 redefine。连续保存 v1/v2，强制 v2 先完成，最终状态不得回退为 v1。关闭项目后在途操作不产生部署副作用。

### F05：按文件名寻找首个 class 不是可靠的产物定位

**证据。** `ResolveClassFile` 有根据源文件基本名遍历输出目录、返回首个同名 `.class` 的后备路径。[K07]

**风险。** `a/Foo.java` 与 `b/Foo.java`、嵌套输出目录、旧产物残留时，基本名无法唯一定位。一个源文件还可能产生多个匿名／内部类文件，单个 classPath 不能代表完整编译结果。

**修复。** 构建阶段产出 `BuildArtifactManifest`，记录 source URI → 产生的 binary names → 精确 class 路径与 hash。先以编译产物身份解析，必要时读取 class 的内部名称验证；禁止通过 basename 首项兜底。增量删除旧内部类必须有清单依据，不做通配批量误删。

**验收。** 两包同名类、多个顶级非 public 类、匿名类编号变化、删除内部类、改变输出目录、旧 class 残留等案例；无法唯一定位时明确失败。

### F06：同一 JVM 的同名类必须区分 ClassLoader

**证据。** `RedefineClassLive` 得到 `ClassesBySignature` 返回后直接选择 `refs[0]`。协议允许同名类因不同 ClassLoader 出现多个结果。[K07] [N02]

**风险。** 多 Web 应用或重新部署后的类加载器场景中，相同 FQCN 不足以唯一确定类。连接到了正确 JVM，仍不代表更新了正确应用。

**修复。** 调试会话绑定运行应用／部署代际；查询实际类加载器身份，和部署目标关联。多个匹配无法消歧时返回 `ambiguous_class_loader`，展示安全可读信息供选择，不能取首个结果。类卸载／重新加载必须失效缓存。

**验收。** 同一 Tomcat 两个应用含同名类，只更新指定应用；重新加载后旧 loaderId 不得继续使用。注意：该问题不是仅通过“加 projectId 字段”就自动解决，需要真正建立 loader 与运行应用关联。

### F07：DAP 失败不应统一触发第二条调试连接

**证据。** 前端 `redefineViaDap` 捕获错误后进入不可用回退；agent 的 live redefine 会重新连接 JDWP。直接连接实现中的注释也承认独占连接前提。[K05] [K07]

**风险。** “适配器不支持该命令”“类结构变更不支持”“目标掉线”“请求超时”“类没有加载”是不同结果。将它们混成一个布尔值，会隐藏真正原因，并可能与正在占用目标调试端口的 DAP 路径冲突。

**修复。** 返回带 code、retryability、stage、sessionId 的结果；只有明确能力缺失且确实允许独立连接时才考虑其他实现。长期由 `DebugBroker` 保证每个目标调试传输只有一个所有者；HotSwap、变量读取、断点都通过同一会话能力执行。

**验收。** DAP 返回业务错误时不得第二次 dial；已有会话时不得另建独占 JDWP；超时后不得盲目重试不可幂等副作用。UI 区分重新编译、重载应用、重启服务器，不能一律“重试”。

### F08：JDWP char／short 编解码长度错误

**证据。** `ReadUntaggedValue` 对 char 和 short 调用四字节 `ReadInt`；`WriteTaggedValue` 同样调用四字节 `WriteInt`。协议要求这两种值各占两字节。[K09] [N02]

**影响边界。** 一旦使用这些底层函数解析或写入对应类型，可能消耗后一个字段的字节并破坏帧内对齐。**不能据此说 Kairo 的所有 DAP 变量显示都必然错误**：是否走这段 Go codec，需要对应功能调用链确认。

**修复。** 增加有边界校验的 `ReadUint16`／`ReadInt16` 与两字节写入；char 为无符号 16 位、short 为有符号 16 位。保留现有接口时也应校验传入 Go 值类型，避免 interface 类型断言 panic。

**验收。** 使用规范黄金字节，而不是只让自己的编码器与自己的解码器互相测试。加入 `char='中'`、short=-1、最小／最大 short、紧邻 int 的组合输入；读取后 remaining 应精确归零。随附测试已验证该长度差异与参考编码方案。

### F09：TCP 握手不能假设一次 Read 得到完整内容

**证据。** JDWP 连接握手读取使用单次 `conn.Read(buf)` 后比较完整握手字符串。[K08]

**触发。** 读取被分片为 3+3+… 字节等合法情况。即使对端最终发送了正确内容，当前实现也可能判为错误。

**修复。** 使用 `io.ReadFull` 读取所需字节数，保留握手 deadline、失败关闭连接与清晰错误分类。写路径处理短写；握手完成后重新设置后续操作的 deadline，不能遗留过短的握手超时。

**验收。** 1 字节一片、任意分片、提前 EOF、错误字符串、超时四类输入。随附 `fragmentedReader` 测试已经展示单次 Read 失败而 ReadFull 成功。该验证不是实际 JVM 网络调试性能测试。

### F10：直接 JDWP 客户端需要事件分流和协商 ID 长度

**证据。** 直接连接发送命令后读取下一包并匹配 ID，没有完整的事件分流机制；数据工具中的 object/frame ID 按固定八字节读写。[K08] [K09]

**为什么重要。** JDWP 是双向命令／事件协议，不应假设“下一包必然是我刚发命令的响应”；各种 ID 宽度也应由 VM 的 `IDSizes` 确定。[N01] [N02]

**短期修复。** 收窄该客户端的公开能力，明确它只用于独占、受控的操作；加入 reply flag 验证、ID 尺寸协商，以及不认识的事件的安全处理。遇到不支持的协议状态明确失败，不要静默吞掉。

**长期修复。** 只有在确实需要维护直接 JDWP 时，再增加单读循环、待响应 map、串行写入、事件队列、请求超时和连接关闭传播。不要为了修一个热替换回退重复实现完整 Java Debug Adapter。优先让现有 DAP 会话承担调试功能。

**验收。** 响应前插入 VM 事件、乱序响应、未知 packetId、断线时唤醒所有 pending、四／八字节 ID 的黄金包。该项与 Lithe DAP codec 借鉴的是“帧与状态分离”原则，不是协议格式互换。

### F11：包长度和游标边界需要在分配前校验

**证据。** `ReadJDWPPacket` 读出 length 后，没有先要求 length ≥ 11 并设置最大值；部分情况下小于头长度仍可能返回 packet。长度先转换为 int32 也使异常输入的语义不清。`SkipBytes` 没有拒绝负数。[K09]

**风险。** 畸形数据可能造成协议错位、过量内存分配或游标异常。这里是输入健壮性缺陷，**不等于已经证明可从公网无认证利用**；生产主入口有 loopback 与认证约束。[K16] [K17]

**修复。** 长度先以无符号、足够宽的类型检验最小值、配置上限和平台 int 范围，再分配；所有 count/length/offset 检验负值与剩余容量；游标运算避免溢出。超出容量返回有界错误，日志不要打印完整恶意 payload。

**验收。** 0、10、11、最大允许长度、超上限、`0xffffffff`、截断体、负 skip、巨大类计数、错误 flag。增加 fuzz，不以“没有 panic”替代资源上限断言。

### F12：错误码表错误会误导排障，测试预期也需审查

**证据。** `jdwpErrorMessage` 把 10 映射为 `VM_DEAD`，而规范中 10 为 `INVALID_THREAD`；同一表还有其他错误映射。已读取测试中的案例名称／注释也沿用部分错误语义。[K09] [K10] [N02]

**修复。** 用规范定义建立完整、可追溯的错误码映射；生成代码或维护一份 reviewed 常量表。未知值保留原始数值，不能误贴已知名称。UI 可增加中文说明，但日志始终保留原始 code。

**验收。** 外部黄金表驱动测试，不能从被测函数生成期望值。测试中的“VM_DEAD=10”也必须改，不能只让旧测试继续绿灯。格式化测试和协议语义测试应分开。

**工程教训。** 已经有测试并不意味着预期正确。对二进制协议、编译兼容性和路径授权，测试的 oracle 必须来自规范、真实产物或独立实现，而非重复业务代码里的假设。

### F13：流式搜索取消链不完整

**证据。** `SearchStreaming` 的消费者在回调出错后返回，但没有由该函数拥有并取消生产者的 context。生产者使用带缓冲 channel 向消费者发送；消费者消失后可阻塞在发送和等待过程。`opts.Cancel` 与传入 ctx 还可能不是同一取消源。[K11]

**修复。** 每次搜索创建一个由搜索操作拥有的子 context。消费者返回、回调错误、达到上限、客户端断开、workspace 关闭均取消同一个操作；随后等待所有 worker 收尾。保留原始消费者错误，同时收集生产者清理错误。优先收敛为一个 cancellation 输入，避免同时存在两个来源却语义不清。

**验收。** 第一个批次就回调失败，扫描上万文件，函数返回时生产者必须结束；频繁输入／删除搜索词，不残留旧任务；取消时句柄、goroutine 和 CPU 恢复到稳定范围。随附独立模型验证了取消+join 的设计，但原仓库 worker pool 仍需接入测试。

**不要倒退。** 已有工作池、缓冲区复用、编码处理和文件大小限制应保留。修完所有权，再评估缓存／索引，不要先增加并发掩盖取消问题。

### F14：UTF-16 的 EOL 检测应放在解码之后

**证据。** 检测到 UTF-16 BOM 后，直接把剩余原始字节传给 `detectEOL`。该函数按相邻的单字节 CR/LF 计数。[K12]

**反例。** UTF-16LE 的 `A\r\n` 字节为 `41 00 0D 00 0A 00`；CR 与 LF 被零字节隔开，当前字节算法不能识别其 CRLF。随附测试复现了返回 LF 的行为。

**修复。** 先确定编码并解码，再对 Unicode 文本检测换行；另行记录原始 BOM。对混合换行返回明确统计与 mixed 状态，不把推测的主换行当成无条件重写授权。

**影响声明。** 这是 Detect 返回元数据的确定错误；最终保存是否改写整文件，还取决于文件服务如何使用该结果，本次没有验证完整保存链，不能宣称所有 UTF-16 文件必然被破坏。

**验收。** UTF-16LE/BE 的 LF、CRLF、CR、无末尾换行、混合换行、BOM 有无；读取后无修改保存尽可能字节一致。

### F15：编码声明探测不应把不认识的信息变成 UTF-8 确定结论

**证据。** `detectHTMLCharset` 在前 1024 字节寻找 `charset` 子串，并不严格限定合法标签或指令；`canonicalEncodingName` 对未知名称返回 UTF-8。`canDecodeAs` 的 USASCII 分支也仅用 UTF-8 有效性判断。[K12]

**风险。** 普通 Java 字符串或注释可能被当作编码声明；拼错的 charset 被解释成 UTF-8；ASCII 标签可能接受非 ASCII 内容。对于用户长期依赖的 GBK 工程，错误的高置信结论比明确提示不确定更危险。

**修复。** 编码名称解析返回 `(encoding, known)`；未知值保留原文和警告，不赋高置信度。声明探测按文件类型、合法语法和编码一致性处理。区分 JSP `pageEncoding` 与响应 `contentType` charset，不能把响应编码当成所有情况下唯一的源文件编码依据。USASCII 使用严格字符范围。

**验收。** Java 中出现 `String x="charset=..."` 不改变项目默认；无效名称不自动变 UTF-8；GBK 不可表示字符在保存前提示并拒绝静默损失。不要删除现有的严格 GBK Encode 保护。

### F16：JSP 单块虚拟 Java 不足以表达整个页面语义

**证据。** 补全函数截取当前 JavaBlock，`buildVirtualJavaFile` 包装这个块，加入固定的 JSP 隐式对象字段。生成函数的输入不包含整页 import、声明块、前序脚本块或静态 include 图。[K13] [K14]

**反例。** 页面先写 `<% String user = "a"; %>`，后面另一块 `<%= user %>`；第二块虚拟 Java 无法从该构建函数获得第一块的声明。`<%! ... %>` 的成员、页面 import、跨块控制流也有同类问题。

**修复。** 从“每块一个短命 CU”升级为“每个 JSP 文档一个稳定虚拟编译单元”。将声明合并到类级、脚本块按页面顺序映射到服务方法、表达式映射到合法上下文；收集 page import、静态 include 与目标 Servlet/JSP 类库。所有生成区域都有 SourceMap，不靠全局固定行偏移处理整页。

**验收。** 跨块变量、跨块 if/for、page import、声明方法、静态 include、中文前缀、表达式多行与错误定位。虚拟代码仅供语义服务，不能覆盖真实业务源码；实际部署仍以项目构建和容器行为为准。

### F17：JSP 虚拟文档打开／关闭需要统一所有者

**证据。** 每次补全使用稳定 block URI 执行 didOpen，await 补全，再在 finally didClose。并发请求可能共享同一个 URI；源码还注明诊断使用自己的重新打开过程。[K13] [K14]

**风险条件。** 连续输入触发并发补全，或补全与诊断重叠：重复打开同 URI，一个请求先关闭另一请求仍在使用的文档。取消标志检查不能替代请求取消和文档生命周期管理。

**修复。** `VirtualDocumentManager` 统一持有每个页面模型的版本和生命周期。首次打开 didOpen，后续 didChange；页面关闭／项目关闭时 didClose。短暂任务只获取 lease，不直接开关共享文档。完成响应附带 documentVersion/generation，过期响应不应用。

**验收。** 并发 20 次补全+诊断，记录协议序列；同一 generation 内每个 URI 只有一次有效 open，close 后无 request；取消后不应用过时 edits。补全的额外 import edits 只有在成功映射回 JSP 指令时才应用。

### F18：Agent 重启需要明确的交接协议

**证据链。** `doRestart` 先启动新进程，再执行旧容器 shutdown、HTTP shutdown，最后退出；main 把实际绑定端口固定到重启参数；新进程 `Listen` 直接 `net.Listen`，该函数没有等待旧进程释放端口的重试。[K17] [K16]

**风险条件。** 新进程启动速度快于旧进程释放端口时，新进程绑定失败，随后旧进程仍退出。是否每次触发取决于时序；本次独立端口实验只证明“旧监听仍存在时同地址不能直接接管”，没有跑完整 Agent 重启。

**修复选型。** 桌面模式优先由 Electron/宿主 supervisor 管理 Agent 重启；浏览器模式由明确的 launcher/supervisor 管理。新进程须等待交接信号或经过有界的旧实例退出确认，再绑定；需要 readiness acknowledgment。不要只加一个固定 sleep。实例 ID、PID、启动时间和 secret 代际写入状态文件，原子替换，避免识别到旧实例。

**验收。** 模拟 shutdown 0/2/10 秒、端口被第三方抢占、子进程启动失败、连续点重启、旧实例崩溃；界面最终显示实际状态而非单凭 200 响应宣布成功。子进程未就绪时必须给出可诊断错误与恢复入口。

### F19：自定义构建的 cancel 句柄不能丢弃

**证据。** `handleCustomBuild` 用 `context.WithTimeout(context.Background(), timeout)` 创建默认 30 分钟 context，随后 `_ = cancel`。服务不存在或启动失败也没有释放该 timer。[K18]

**判断。** 让异步构建脱离 HTTP 请求寿命是正确意图；问题不是“必须在 handler defer cancel”，那样会马上取消构建。正确做法是让 JobManager 接管 context 与 cancel，并在完成／失败／取消／关闭时释放。

**修复。** handler 只提交任务；JobManager 创建任务 context，注册进程和 cancel；启动失败立即清理，进程结束后统一 finalize。取消要等待进程树退出并返回最终状态，不能只修改 UI 标签。

**验收。** 快速重复启动失败不会积压到 30 分钟；任务自然完成后 timer 释放；关闭项目与退出 IDE 后无应清理却残留的本地构建进程。

### F20：幂等缓存不是完整的操作幂等性

**证据。** 已读缓存按 requestId 保存响应，lookup/store 分开加锁，没有在这个结构中记录 operation kind、workspace/project、payload 指纹和执行中状态。Runtime 请求默认对暂态错误允许重试，副作用接口需要明确策略。[K17] [K19]

**风险边界。** 两个相同请求并发到达可同时查不到缓存；相同 requestId 用于不同操作可能重放错误响应。具体 handler 是否有额外锁需要逐接口确认，所以此项按 B 处理，不声称所有接口都会重复执行。

**修复。** 新建 `OperationRegistry`：主键至少包含作用域、操作类型和 requestId，保存 payload hash；原子 claim 执行权；其他相同调用等待或返回 operationId；同 key 不同 payload 返回冲突。区分响应丢失与执行失败，提供查询状态接口。构建、部署、启动、重启、热替换分别制定可重试策略。

**验收。** 20 个同 key 并发仅发生一次副作用；请求断线后重试查询同操作；同 key 不同 payload 返回 409；不能把一次真实失败缓存成成功。

### F21：工作区包含关系不能使用 startsWith

**证据。** HotSwap 的工作区判断使用 URI 字符串前缀；部分无根或异常分支采取宽松处理。[K05]

**反例。** `file:///C:/repo-other/A.java` 以 `file:///C:/repo` 开头，但不位于该目录。随附 Node 测试已验证这种差异。

**修复。** 用 URI 解析与路径段比较识别资源所属工程，落到宿主侧再做真实路径和权限校验。Windows junction、符号链接、网络路径和文件替换时的竞态不能仅靠 lexical relative 消除。对于 HotSwap 等副作用，无明确所属项目时拒绝，不以异常为由放行。

**验收。** 同前缀兄弟目录、盘符、大小写、`..`、符号链接／junction、跨 workspace、未打开项目。随附路径函数只示范词法包含关系，不是完整授权实现。

### F22：文档、旧管理器与生产调用链需要同步治理

**证据。** 旧架构文档和里程碑描述与入口当前 `bootstrap.NewContainer`、实际 HotSwap 路由并不完全一致。`jdtls.go` 明确写出其进程生命周期 API 已废弃，生产生命周期由 Theia backend 负责；同时保留安装与兼容职责。[K02] [K03] [K16] [K21]

**风险。** 后续开发者可能按过时文档再实现一套生命周期，或者错误地修改已不在生产路径中的方法，以为修好了产品。

**修复。** 每个服务建立“唯一 owner / 生产入口 / 兼容入口 / 禁止调用方”记录；CI 检查新生产代码不得调用废弃生命周期 API。里程碑是历史记录，现状表由验收测试 ID 支撑。删除兼容代码之前先证明无调用与迁移路径，不能根据注释直接大删。

**验收。** 新开发者能从入口、端点、语言服务 owner 找到真实路径；关键文档列出最后核验 commit；新 PR 涉及行为变更时同时更新能力矩阵与测试证据。

### F23：HotSwap 服务关闭时还需处理订阅与在途工作

**证据。** 已读 HotSwap 服务停止逻辑主要清 timer、pending 集合；保存监听的 disposable 与 in-flight 编译／替换操作没有在该服务中形成完整的取消和释放闭环。[K05]

**风险边界。** 应用框架可能在更外层释放部分对象，但仍要验证该服务的 restart/dispose 场景，不能仅假定窗口关闭就一定清理所有异步工作。

**修复。** 用统一 DisposableCollection 保存订阅；服务拥有 operation cancellation scope；onStop 标记 generation 失效，取消排队和在途可取消部分，等待或隔离不可中断副作用。用 finally 统一释放，不能靠多个 catch 分支各自清理。

**验收。** 重复激活／停止服务后保存事件只触发一次；关闭项目期间编译完成不会再次向 UI 或 VM 提交结果；无监听数量与任务数量增长。

### F24：Agent 地址和认证 secret 应作为同一信任配置绑定

**证据。** Runtime 客户端允许从配置／查询参数得到 Agent URL，并在请求中向配置目标发送当前 secret；已读的 URL 拼接、configure 与 request 路径没有体现“此 secret 只能用于特定已批准 endpoint”的独立约束。[K19]

**风险前提。** 配置来源可受不可信输入影响、secret bootstrap 成功，并且浏览器网络策略允许连接时，认证材料可能发往不应接收它的目标。实际可达性仍需结合 CSP、Theia 配置注入、发布模式和 origin 策略验证；**本次没有证明一个可利用的完整攻击链**。

**修复。** 生产模式禁用任意 URL override，或只允许匹配已认证宿主配置的 loopback endpoint；将 secret 与 agentInstanceId、origin/endpoint 白名单绑定；目标变化必须重新建立信任，不能沿用旧 secret。HTTP 和 WebSocket 都检查这一约束；诊断日志屏蔽认证头。

**验收。** 不可信 query 不改变认证发送目标；切换 endpoint 不沿用认证材料；公开 endpoints 响应不能把 WS 导向任意位置；开发模式例外必须显式启用并可见。

### 4.2 尚未确认为缺陷、不能随意写进修复清单的事项

没有全量检查 Git/SVN、Oracle SQL、插件管理、WAS 管理、所有编译缓存和重构命令。因此不能宣称这些功能不存在、不安全或完全不可用。没有产品级性能数据，也不能说 Kairo 必然比 Lithe 多占多少内存。没有证明 Monaco 当前断点锚点机制失效，也不能直接再叠加一套迁移算法。

这些领域可以加入后续审计 backlog，但应先建立入口、真实调用链与测试，再决定改造，不以目录名或“文件很大”替代证据。

<a id="architecture"></a>
## 5. 目标架构与模块责任

### 5.1 不是推倒重来，而是收紧现有边界

当前已有组合根、Runtime 客户端、JDT 文档同步和多个扩展包。目标应是**现有模块化单体 + 明确进程所有权 + 少量稳定协议**，不是为了“解耦”增加微服务。[K16] [K19] [K20] [K21]

建议逻辑关系如下。图中是目标责任划分，不声称现有代码已经全部如此：

```text
Theia / Monaco 工作台
  ├─ 编辑器、命令、调试 UI、通知（展示与用户意图）
  ├─ Document / VirtualDocument 前端镜像（非磁盘授权权威）
  └─ 类型化客户端 + 操作上下文
             │
Theia Backend / 现有语言与调试宿主
  ├─ JDT LS 生命周期：唯一 owner
  ├─ DebugBroker：对现有 DAP owner 的统一门面
  └─ 语言请求、虚拟文档、调试协议桥接
             │ 已有 RPC / HTTP / WebSocket 边界
Go Runtime Agent
  ├─ API adapters：解码、认证、授权、错误映射
  ├─ Application use cases：Build / Deploy / Launch / Search / Jobs
  ├─ Domain：ProjectModel / ToolchainPolicy / Artifact / TargetBinding
  └─ Infrastructure：文件、进程树、编译器、Tomcat、存储、网络
             │
被管理资源
  ├─ 业务编译器（保留 Java 6 目标）
  ├─ Tomcat / 目标 JVM（独立的运行配置）
  └─ 本机文件与构建产物
```

**关键约束：** DebugBroker 放到现有 DAP 会话实际拥有者一侧；本报告推荐优先在 Theia 调试宿主整合。不能在 Go 和前端各增加一个自认为权威的完整调试会话表。Go 只保存与运行实例相对应的绑定和所需引用，跨进程通过协议交互，不共享可变对象引用。

### 5.2 六个必须清楚的 owner

| 对象 | 权威 owner | 其他层可以保存什么 | 禁止做什么 |
|---|---|---|---|
| 项目配置与有序 classpath | ProjectModel 服务／存储 | 带 revision 的只读快照 | LSP、构建、部署分别猜三套 classpath |
| 磁盘文件与编码保存 | 文件所属宿主的 Document/File 服务 | 编辑器文本和版本镜像 | 前端把 URI 当任意本机路径读写 |
| 构建任务与产物 | Go Build use case + JobManager | operationId、进度、只读 manifest | handler 自己持有失控的后台 context |
| Tomcat 进程与实例代际 | Runtime supervisor / ServerRunner | runtimeInstanceId、状态快照 | 根据端口或 PID 单独认定是同一实例 |
| JDT LS 进程 | 现有 Theia backend owner | capability、ready 状态、descriptor | 废弃 Go Manager 与 Theia 重复启动管理 |
| DAP 会话与 VM 调试操作 | DebugBroker / 现有 DAP owner | sessionId、generation、capabilities | HotSwap 绕开 owner 再连接同一目标 |

### 5.3 建议的目录变化

以下是**拟新增／拟调整路径**，不是对当前文件存在性的陈述：

```text
packages/protocol/src/
  resource.ts                 # URI / 宿主 / 项目身份
  build-artifact.ts           # 构建结果与产物清单
  debug-target.ts             # 不可变目标绑定
  operation.ts                # 任务、状态、错误与取消

packages/java-extension/src/common/
  hotswap-context.ts          # 可独立测试的类型与校验
  hotswap-policy.ts           # 何时允许提交，非网络 I/O

packages/java-extension/src/browser/
  java-hotswap-service.ts     # 缩减为事件接线和 UI 反馈

packages/jsp-extension/src/common/
  jsp-page-model.ts
  jsp-source-map.ts
  virtual-document-state.ts

runtime-agent/internal/app/
  build/                     # 保留现有 app 布局约定后落位
  hotswap/
  operations/

runtime-agent/internal/domain/
  project_model.go
  artifact.go
  target_binding.go
  toolchain_policy.go

runtime-agent/internal/api/
  ...                        # handler 调用 use case，不直接选 JVM
```

不要求一次性移动整个仓库。第一步先抽取纯策略与类型，旧入口调用新实现；通过测试后再删除旧重复路径。文件数量增加必须换来责任减少，而不是把一个大函数原封不动拆成多个互相回调的文件。

### 5.4 架构门禁

借鉴 Lithe 的边界检查思想，而不是复制其 macOS zsh/Swift 正则。[L08]

Go 检查项：domain 不导入 api；domain 不依赖 HTTP、进程启动或具体 UI；use case 通过端口访问文件／编译／运行；API 不自行选择 class 文件、ClassLoader 或 JVM。实现优先读取 Go import/AST 或依赖图，避免只有脆弱的字符串搜索。

TypeScript 检查项：普通 UI 组件不得直接 fetch Runtime endpoint；跨扩展使用公开 API，不穿透私有路径；纯策略模块不依赖 Monaco、DOM、Theia 容器；JSP 语义模块通过明确接口调用 Java 服务，避免隐式全局状态。

允许少量例外，但每个例外有原因、责任人、移除条件与到期复核，不用不断增加 ignore 把门禁变成装饰。

<a id="contracts"></a>
## 6. 核心数据契约

本节接口是建议设计，不是可直接替换当前 `@kairo/protocol` 的完整实现。应先补 schema/契约测试，再逐端点接入。

### 6.1 ResourceIdentity：统一文件身份

```ts
interface ResourceIdentity {
  workspaceId: string;
  projectId: string;
  hostId: string;             // 文件所在宿主，不是当前浏览器设备
  uri: string;               // 标准化文档 URI
  canonicalKey: string;      // 宿主生成的稳定比较键，不拿来展示或执行
  projectRevision: number;
}

interface SavedDocumentSnapshot {
  resource: ResourceIdentity;
  savedVersion: number;
  contentHash: string;
  encoding: string;
  encodingConfidence: 'explicit' | 'validated' | 'heuristic' | 'unknown';
  bom: 'none' | 'utf8' | 'utf16le' | 'utf16be';
  eol: 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';
}
```

磁盘路径只在宿主适配层产生，经过规范化、工作区授权和链接策略校验。`canonicalKey` 不暴露认证信息，也不能成为绕过授权的“万能文件令牌”。保存使用原文件 hash／revision 做冲突检测。

### 6.2 ProjectModel：一份模型派生多个消费者配置

最少应有：项目 root、模块、source roots、resource roots、web roots、输出目录、源文件编码规则、source/target 级别、编译器、运行 JVM，以及**有序且区分用途的** bootstrap／compile／test／runtime classpath。

为每条 classpath 项保留来源：手动添加、WEB-INF/lib、容器库、构建配置、项目依赖。这样才能解释“这个类为何被解析成某个 JAR”。去重不应随意改变前后顺序；同名类冲突应可见，而不是随机选择。

消费者从同一个 revision 派生：JDT 项目描述、编译参数、运行参数、部署内容和 Debug source paths。发生目录或依赖变化时递增 revision，取消旧 revision 上的在途语义请求与构建候选。

**兼容提醒：** 仓库已经说明 JDT 宿主与业务工具链应分离。[K21] 这不是让你重新发明三套配置，而是把现有意图落实到编译校验、产物验证和发布门禁，避免 F01 的行为反向破坏该隔离。

### 6.3 BuildArtifactManifest：构建成功必须能解释产生了什么

```ts
interface BuildArtifactManifest {
  buildId: string;
  projectId: string;
  projectRevision: number;
  inputSnapshotHash: string;
  requestedSourceLevel: string;
  requestedTargetLevel: string;
  actualCompiler: { toolchainId: string; version: string; executableHash?: string };
  status: 'succeeded' | 'failed' | 'cancelled';
  classes: Array<{
    binaryName: string;
    sourceUri: string;
    sourceSavedVersion: number;
    artifactUri: string;
    sha256: string;
    majorVersion: number;
  }>;
  removedArtifacts: string[];
  diagnostics: Array<{ uri: string; message: string; code?: string }>;
}
```

产物 URI 应指向该 build 的不可变 staging 内容，或能通过 hash 验证的文件；不能让多个并行编译无锁改写同一个路径，而后让旧操作读取“路径相同但字节已经换了”的结果。

大项目不必每次复制全部输出。可用内容寻址、受锁定的增量输出与小型清单实现，但要先确定正确性，再测复制或 hash 成本。该架构不要求引入数据库服务器。

### 6.4 DebugTargetBinding：目标必须不可变且可失效

```ts
interface DebugTargetBinding {
  projectId: string;
  runConfigurationId: string;
  runtimeInstanceId: string;   // 一次启动的身份，不等于固定 server 配置 ID
  deploymentGeneration: number;
  debugSessionId: string;
  debugSessionGeneration: number;
  requestKind: 'launch' | 'attach';
  ownsDebuggee: boolean;
  classLoaderId?: string;       // VM ID 使用字符串，不依赖 JS Number 精确表示
}

interface HotSwapRequest {
  operationId: string;
  target: DebugTargetBinding;
  buildId: string;
  artifactHashes: string[];
  expectedProjectRevision: number;
}
```

单凭 serverId、端口、PID、FQCN 中任何一个都不够。配置可以复用，但实例代际必须区分。收到过期请求要返回明确的 `stale_target`，禁止重新猜一个“看起来相同”的目标继续执行。

### 6.5 OperationRecord：后台任务生命周期可查询

状态建议：`queued → running → succeeded/failed/cancelled`；取消中用独立标志或 `cancelling` 状态，明确终止确认。任务至少包含 owner、scope、输入指纹、开始／结束时间、当前 stage、取消能力和最终结构化错误。

API 提交后返回 operationId；WebSocket 只是进度通道，不是结果唯一保存位置。断线重连可以查询最终状态。客户端不能因为漏收事件就再执行同一个部署。事件带 sequence 与 scope，丢失后以 snapshot 校准，不直接重放已经失效的副作用命令。

### 6.6 协议迁移方式

建议采用版本化 payload／capability 协商，先加新字段和新安全路径，再迁移调用者。旧 read-only 查询可以兼容；缺少目标身份的旧 redefine 请求必须明确拒绝或进入用户确认流程，不能为了“向后兼容”继续保留危险首项选择。

新旧端混用测试包括：旧 UI + 新 Agent、新 UI + 旧 Agent、升级后重连、Agent 重启后 secret/generation 改变。协议版本不兼容时给出可操作错误，禁止吞掉错误显示“完成”。

<a id="debug"></a>
## 7. Debug 与 HotSwap 专项改造

### 7.1 一条完整且可追踪的保存到生效链

```text
用户保存
  → 编码验证与文件冲突检查
  → 成功生成 SavedDocumentSnapshot
  → 捕获 project revision + 精确 DebugTargetBinding
  → 合并同目标尚未开始的保存请求
  → 兼容性已校验的增量编译
  → 生成并验证 BuildArtifactManifest
  → 校验 target generation、最新已保存版本与产物 hash
  → 查询并消歧 VM 中对应类 / ClassLoader
  → 经唯一 DebugBroker 提交 redefine
  → 处理断点重新绑定 / 暂停状态刷新 / UI 状态
  → 写入 operation 最终结果与可诊断日志
```

UI 显示的“保存成功”“编译成功”“热替换成功”“需重载”是四种不同状态。不能把文件写入完成就显示“代码已生效”。比较版本应针对最新已保存版本；用户又做了未保存编辑时，是暂停热更新还是继续应用最后保存版本，需要一致的产品策略和明确提示。

### 7.2 调试状态机

建议至少明确：`idle / starting / initializing / configuring / running / stopped / disconnecting / terminated / failed`。状态转换使用结构化事件，副作用从状态计算中分离。

| 当前状态／事件 | 允许动作 | 必须拒绝或限制 |
|---|---|---|
| initializing | 接收能力、准备配置 | 对尚无有效会话的单步、变量读取 |
| configuring | 下发断点与异常设置、完成配置 | UI 提前宣称已运行 |
| running | 暂停、停止；按实际能力热替换 | 使用旧 stackFrameId 读取局部变量 |
| stopped | 栈、作用域、变量、单步、表达式 | 忽略 stopped generation 的旧响应覆盖新栈 |
| disconnecting | 清理和最后结果收集 | 新增无法归属的调试请求 |
| terminated/failed | 呈现结果、显式重新启动 | 使用旧 sessionId 继续写 VM |

每次暂停建立 `stopGeneration`；变量请求、frameId、evaluate 响应都绑定它。继续运行后旧 frame/variable reference 失效，避免“上一次断点的变量出现在下一次暂停里”。

借鉴 Lithe 的 session/request/effect 组织方式，但不搬全局巨型会话锁。按会话隔离状态与队列，避免一个会话的慢请求阻塞另一会话。[L02] [L04]

### 7.3 断点能力矩阵必须端到端

建立 source breakpoint、条件、命中次数、日志断点、异常断点、启用／禁用、待解析、验证失败、代码编辑后迁移、重定义后重新绑定这十类场景。

每类检查四层：UI 能输入 → 协议字段不丢失 → adapter/VM 声明支持 → 真实运行行为正确。Lithe 的共享类型和 Windows 通用前端存在字段差异，正好说明“后端类型支持”不等于产品支持。[L02] [L04] [L05]

**断点迁移先测后改。** Monaco/Theia 可能已经通过 decoration/tracked range 移动锚点。先运行插行、删行、跨行替换、撤销/重做测试；只有实际缺口才移植 Lithe 算法。如果两套机制同时对同一次编辑生效，断点会被移动两次。

### 7.4 变量与表达式求值

变量树采用懒加载、分页、请求合并与过期响应过滤；对十万元素数组不能一次性展开成十万个前端节点。保留 `namedVariables`、`indexedVariables`、evaluateName 与 error 信息，在 adapter 不支持分页时明确限制。

表达式求值不是天然只读。可能调用方法、阻塞线程或改变状态的求值，不应在 hover 时无条件自动执行。区分安全展示、显式 Evaluate 和可能有副作用的执行，给出取消／超时与状态恢复提示。这是建议设计，不表示本次已证明现有 UI 存在该类事故。

Lithe 变量分页 JSON 可作为规范化边界样例，但不能凭复制 JSON 就声称已有分页功能。[L11]

### 7.5 launch 与 attach 的终止语义

本地 launch 通常由 IDE 创建并拥有目标进程；attach 到已有服务不应默认杀掉它。Lithe 的 disconnect fixture 明确区分这两个输入场景，适合直接作为测试数据参考。[L10]

Kairo 中实际是否拥有进程，应依据 runtime owner 记录，不仅根据字符串 request="launch" 推断。对共享 Tomcat 和远程 WAS 场景，停止调试与停止服务器必须是两个动作。测试中要明确“断开后业务服务仍然响应”。

### 7.6 热替换失败分流

| 失败原因 | 正确处理 | 不应做的事情 |
|---|---|---|
| 编译错误 | 显示 diagnostics，不提交 VM | 用上一次 class 冒充本次构建成功 |
| 目标过期／切换 | 取消操作，要求重新确认目标 | 悄悄选择当前 session |
| 类未加载 | 显示未加载状态或按明确策略等待 | 选择其他同名类或另一 JVM |
| ClassLoader 歧义 | 拒绝并给出消歧信息 | refs[0] |
| 能力不支持 | 提示需重载／重启，由用户确认 | 无条件再开独占 JDWP |
| 请求超时 | 查询／标记结果不确定，避免重复副作用 | 马上重放并报成功 |
| 类结构变化 | 按目标 VM/adapter 实际能力处理 | 宣称所有 Java 6 VM 都支持结构热替换 |

重定义后断点、在栈方法与新调用的行为应按实际协议/VM 验收，不能把“返回成功”理解为所有现存执行帧立即使用新逻辑。[N02] 回滚不是任意情况下自动逆向 redefine；必要时保留旧产物并提供受控重新部署／重启方案，明确状态影响。

### 7.7 Debug 完成定义

必须在真实 Java 6 + Tomcat 6 环境做到：启动、断点命中、单步、变量、调用栈、异常、断开、重新附加、普通方法体热更新，以及错误目标拒绝。WAS/IBM JVM 等目标单独建立兼容矩阵；本次未实际验证，不能用 HotSpot 成功代替。

<a id="language"></a>
## 8. Java、JSP、调用关系与索引

### 8.1 一份 ProjectModel，避免三个世界不一致

项目导入先建立可解释的模型：模块、源目录、Web 根、输出目录、依赖和编码。JDT、编译器、Tomcat 运行参数以及调试 sourcePaths 都应从同一模型派生。

建议提供“项目诊断”页面，直接回答：这个 Java 文件属于哪个 source root；某个 FQCN 解析到哪个 JAR；编译器是什么；target 是多少；Tomcat 用哪个 JVM；LSP 当前使用哪个项目 revision。用户无需翻四份日志才能排查“补全正常但编译失败”。

对传统工程，不要强迫先转换为 Maven/Gradle。允许从已存在的项目描述、WEB-INF/lib 和手动配置导入；保留每项来源，冲突时可编辑。识别到同名依赖不自动删除；展示版本／路径／优先级。

### 8.2 精确语义能力与降级能力分开

精确跳转、引用、实现、调用层级、重命名应以 JDT 等真实语义服务结果为主。文本搜索可以作为候选与兜底，但必须标记“文本匹配”，不能伪装成精确引用。

Lithe 的轻量函数会扫描当前文档的标识符，并用近似声明判断筛选结果，适合当前文件补全兜底，不足以判断 Java 的作用域、重载、继承、接口实现或同名局部变量。[L07]

建议结果格式带 `origin: semantic | lexical | text-search`、projectRevision 与 documentVersion。重命名默认只接受 semantic 结果；涉及文本替换的扩展操作必须预览并逐项确认。

### 8.3 LSP 生命周期与请求正确性

保留现有可测试的文档同步核心。[K20] 补齐或验证以下不变量：

| 约束 | 为什么需要 | 验收方式 |
|---|---|---|
| 同一 URI 的 didOpen/didChange/didClose 顺序唯一 | 防止重复模型和丢失变更 | 协议记录回放测试 |
| completion/hover 前 flush 对应文档版本 | 防止语义服务看到旧文本 | 连续输入后立即请求补全 |
| 服务重启后仅重开当前仍打开的文档 | 防止旧项目或已关闭页面复活 | crash/restart + close race |
| workspace/project generation 随关闭或替换失效 | 防止旧响应写进新项目 | 延迟响应+切换工程 |
| 消费者取消传递到语言请求或至少丢弃结果 | 控制后台负担与 UI 错乱 | 快速输入/取消压测 |
| ready 状态来自真实 owner | 防止废弃 Manager 的状态误导 UI | 比对进程、owner 与状态接口 |

语言服务宿主使用新 JRE，不代表其固定版本必然完整支持 Java 6 工程语义。本次没有实测 pinned JDT LS 的全部旧 source/compliance 组合。必须做兼容性测试，必要时调整经验证的语言服务版本或明确显示语义能力受限；不能偷偷抬高业务 source level 来消除错误。

### 8.4 JSP 整页模型的具体实现

建议拆为三层：`JspPageParser` 解析原始页面；`JspSemanticModelBuilder` 构建跨块／include 上下文；`JspJavaEmitter` 输出稳定虚拟 Java 与 SourceMap。

PageModel 最少包含：页面 directives、Java declarations、scriptlets、expressions、HTML/模板片段、静态 include 引用、taglib 前缀与 TLD 来源。解析容忍用户输入中的未闭合块，不能要求每次键入都先形成合法 JSP 才工作。

生成器应区分 declaration 的类级语义与 scriptlet 的方法内语义；处理跨块控制流；对 implicit objects 根据页面设置和适用规则生成，而不是无条件把所有对象视为可用。对旧工程使用对应 `javax.servlet`/JSP 类库，不能换成 `jakarta.*` 后让实际目标无法编译。

静态 include 用有向图管理，检测循环与缺失文件。修改被 include 文件时失效依赖它的页面，不全工程重新扫描。动态 include 不应假装静态文本拼接；给出能力边界。

### 8.5 SourceMap 不是一个固定行数偏移

每个生成片段保存 sourceUri、源起止 UTF-16 offset、生成起止 offset、映射类型和 project/document revision。输入编辑在 source map 更新前不得应用旧 diagnostics 或 edits。

支持三种映射：精确映射区、合成包装区、跨文件映射区。包装区错误可转为页面级说明，不应指向用户不可编辑的第 0 行。无法精确映射的 edit 不应用，尤其是跨 import、跨 include 和多个不连续 source span 的修改。

现有固定 wrapper 行常量在单块包装中有明确用途；本次没有认定这些常量本身算错。改整页模型时再替换为真正 SourceMap，不应为了“优化”盲目改行号。[K14]

### 8.6 补全的 additionalTextEdits

当前 JSP 补全主动丢弃额外 edits，避免把虚拟 Java 的位置直接写进 JSP，这个防御意图正确。[K13] 新方案应把 import 类 edit 转换为合法 JSP page import 指令，处理已有 import 去重、原始编码和多光标／撤销事务；其他无法安全映射的 edit 继续拒绝，不可简单全部放行。

### 8.7 调用关系与 Java/JSP 跨语言导航

用户真正需要的是业务定位：Java 方法调用链、Servlet 映射、JSP include/forward、TLD 标签处理器、EL 属性的来源。建议使用分层结果：Java 精确调用关系来自语义服务；JSP/TLD/web.xml 的声明边来自专用解析；反射、字符串拼装路径和框架动态分派列为推测候选。

显示置信度与来源，例如“精确引用”“配置映射”“字符串候选”。不要为了看起来完整，把反射调用强行显示成确定调用关系。搜索用户自己的旧框架 API 时，可以补项目专用规则，但规则库与 Java 精确索引隔离，可关闭、可测试、可追溯。

### 8.8 重构与批量修改的安全事务

一次重构先计算 WorkspaceEdit，检查所有文件 revision/hash 和可写权限，再显示预览。确认后在各文件原编码下编码验证，生成恢复点，再统一提交。中间失败必须有可恢复记录，不得只提示“部分失败”却不告诉用户哪些文件改过。

保留 CRLF、BOM、文件末尾换行与 GBK，不因一次 rename 顺便格式化整个工程。重构完成后触发 project revision、LSP flush、构建失效与引用刷新。这个流程也适用于 AI 批量修改：AI 不是绕过文件安全层的特权调用者。

<a id="documents"></a>
## 9. 文件、编码、搜索与编辑安全

### 9.1 文件服务的职责收敛

文件服务应统一处理打开、版本、编码检测、重新加载、保存、外部变更、冲突与备份。搜索、格式化、重构和 AI 修改都应依赖同一编码／身份规则，不能各自解析 `charset`、各自拼接路径。

保存推荐流程：检查 expectedDiskHash → 编码可表示性 → 写同目录临时文件 → 必要的同步／关闭 → 平台适配的原子替换 → 更新版本与通知。真实原子替换语义、文件权限、Windows 文件占用与杀毒软件干扰都需要平台测试；不能只把 POSIX rename 经验照搬到 Windows。

当外部进程修改文件，不能用 stale editor buffer 静默覆盖。显示差异并允许三方合并或另存。崩溃恢复点不等于正式保存成功，两者在 UI 中分开。

### 9.2 编码策略

推荐证据顺序并非一刀切硬编码，而是可解释决策：明确的用户文件设置／经过验证的项目规则、BOM、符合该文件类型规范的声明、内容验证与低置信度启发式。不同来源冲突时显示冲突，不暗中覆盖。

对于 GBK 工程，尝试保存 emoji 或不支持字符时必须可见地拒绝或让用户显式选择转换文件编码。自动替换为 `?` 或无提示转 UTF-8 都不可接受。原有严格 GBK Encode 实现应保持。[K12]

编码转换是一项显式操作：预览受影响文件、备份、验证目标编码可表示、记录原编码与新编码。不能在打开、搜索、补全或一次普通保存中偷偷批量转换。

### 9.3 搜索完整性协议

搜索结果不应只有“匹配行列表”，还要明确扫描边界。建议流协议：

```text
started(searchId, query, scope)
matchBatch(searchId, sequence, matches[])
progress(searchId, scannedFiles, matchedFiles)
completed(searchId, totalMatches, scannedFiles,
          skippedTooLarge, skippedBinary, unreadableFiles,
          truncated, cancelled, duration)
```

超过文件大小或结果数量限制时，在 UI 明确显示“结果已截断／跳过多少文件”。否则用户会把“没有找到”误认为项目里确实不存在。此为协议改进建议；本次没有把未读的 API 层错误地判断成一定隐藏全部元数据。

每条结果带 source URI、内容版本或 hash，以及原文件定位坐标。搜索时文件被改动后点击结果，应尽量重新定位并提示可能过期，不能无条件跳到错误列。

### 9.4 搜索引擎优化顺序

先修 F13，再建立文件清单缓存与统一忽略规则，最后根据实测决定是否接入外部搜索引擎。现有 Go 工作池可以继续承担 GBK 等兼容路径，不需要立即新增 Rust 搜索服务。[K11]

文件清单按工作区缓存，文件系统事件增量更新；目录重命名、watcher 丢事件或达到平台监视上限时执行有界校准。忽略规则应覆盖输出目录、VCS、依赖缓存和生成文件，但允许用户显式搜索其中内容。

使用 ripgrep 等引擎前，要验证分发许可、Windows 包装、取消、编码、结果列单位与路径安全；不能将 UTF-8 测试结果外推到混合 GBK 工程。按 encoding policy 路由或提供可控解码管道，确保 Java/JSP 中文仍可准确搜索。

### 9.5 增量索引与重建

将“文件名清单”“全文搜索缓存”“语义索引”区分开。文件清单不需要解析 Java；语义索引由 JDT 等服务维护；全文索引是否落盘由数据规模和磁盘预算决定。不要为了查询文件名就启动完整语言服务，也不要手写一套不可靠 Java 语义索引替代 JDT。

索引带 schemaVersion、projectRevision、encoding policy hash 和构建器版本。升级不兼容时重建，而不是沿用旧格式产生静默错误。重建期间展示进度，保留只读基础编辑能力，允许取消。

<a id="performance"></a>
## 10. 启动、性能、内存与进程管理

### 10.1 先建立测量边界

本次没有测试 Kairo 与 Lithe 的实际启动与内存，任何具体快慢比较都不成立。Lithe 的 `workbench-app.tsx` 有首帧附近打点与延后 bootstrap 的实现，可借鉴这种组织方式；不等于所有重型模块都已懒加载。[L06]

Windows 桌面模式要统计整个进程组：Electron 主/渲染进程、Theia backend、Go Agent、JDT LS、调试适配器及相关子进程。使用适当的 private/commit/working-set 指标，避免简单相加共享内存造成误判。业务 Tomcat 单列，不混进“IDE 空闲内存”。

浏览器从 Mac 连接 Windows 时，两台设备分别计量，不能把浏览器消耗从总成本中隐藏，也不能把它错误算到 Windows Agent 内存。

### 10.2 分阶段启动计划

| 阶段 | 必需完成 | 不应阻塞此阶段的工作 | 记录里程碑 |
|---|---|---|---|
| P0 外壳可见 | 主窗口／页面、基础错误反馈 | 全项目扫描、下载工具链 | processStart、firstVisible |
| P1 基础编辑 | 文件列表、打开与保存文本 | 完整 Java 索引、调试适配器预热 | editorReady |
| P2 工程就绪 | ProjectModel 与编码规则 | 无关插件、全量 VCS 历史 | projectModelReady |
| P3 Java 语义就绪 | JDT 会话、文档同步、必要索引 | 未使用语言与无关数据库连接 | javaReady |
| P4 调试／服务器 | 用户显式启动的目标 | 自动启动所有历史服务器 | debugReady、serverReady |

这不是让用户永远等补全，而是让阶段可见、失败可解释。语言服务失败不能阻止用户打开文件；基础编辑可用也不能虚假显示“Java 就绪”。

### 10.3 4GB 环境的策略

优先控制并发进程与峰值，而不是只追空闲数字。按需启动 JDT／调试器；关闭工程后回收相应资源；限制并发编译；大搜索与大构建抢占时合理排队；对大型变量树分页；限制日志与历史缓存。

不建议直接规定某个很小的 JVM Xmx 并宣布问题解决。过低堆可能增加 GC 和索引失败，应结合项目规模实测。初始预算以用户实际 4GB 虚拟桌面为验收环境，再选择合理的轻量模式默认值。

清理策略要有 owner：哪些资源随窗口、workspace、project、session 或 operation 生命周期释放，必须写明。缓存带大小／数量／时间上限，并有命中率和清理指标；不能无限缓存所有文件文本。

### 10.4 基准场景与数据集

建议至少准备：空工作区；1,000 文件小项目；10,000 文件混合编码工程；50,000 文件大工程；大量 WEB-INF/lib；多个同名前缀工程；10 万行日志；多个同时运行但不同项目的 Tomcat。

使用生成的或脱敏的固定测试工程，保存 seed、文件数、字节量、编码比例、依赖数量与磁盘环境。冷启动、热启动分开；首次依赖下载与已有离线缓存分开；受限网络与离线都测。

指标包括：首帧、编辑可用、Java ready、首次补全、热补全 P50/P95、搜索首批／完成、取消到静止、保存到编译完成、热替换完成、UI 长任务、总进程数、内存峰值、关闭后残留进程。

### 10.5 性能门禁是计划值，不是本次成绩

先建立当前正确版本的基线，再设置可复核的回归阈值，例如同数据集 P95 显著退化时阻断合并，内存／进程数出现持续增长时阻断发布。阈值需结合样本波动确定，不能用一次运行的差值下结论。

建议每次关键性能 PR 至少保存重复运行数据、环境、原始日志与相对变化。对于优化正确性之间的冲突，优先保证不更新错项目、不丢文件、不改变 Java 目标，再降低延迟。

<a id="security"></a>
## 11. 安全、发布与供应链

### 11.1 保留已有措施，不制造“从零补安全”的假象

源码已经存在桌面 secret 强制要求、loopback 监听、认证中间件及路径授权调用。[K16] [K17] [K18] 后续审查应检查每个危险端点是否通过一致的权限与身份链，而不是声称所有接口裸奔。

建立操作权限表：读文件、写文件、运行项目脚本、启动服务器、连接调试端口、热替换、执行 SQL、安装工具链分别列出输入、授权主体、scope、日志脱敏和用户确认策略。不能把“已拿到一个 secret”理解为可无条件修改所有本地资源。

### 11.2 工作区信任与危险操作

项目里带来的脚本、启动配置、编译命令、外部工具配置都应视为可执行内容。打开一个陌生仓库不应立即执行其中命令。采用 workspace trust：受信任后允许用户批准的构建／调试能力，撤销信任后停止未来自动执行。

远程 attach、共享运行实例与数据库写操作应有更严格边界。用户当前主要需求是旧系统开发，不需要为了追赶通用 IDE 功能扩大默认攻击面。

### 11.3 凭据、日志和诊断包

Agent secret、数据库密码、令牌、认证头、连接串中的敏感参数不写入普通日志；诊断包采用字段级 redaction，并向用户展示收集范围。文件路径可能含用户名或内部项目名，上传诊断前可选择脱敏。

为每个后台任务提供 correlationId，但不要把完整源文件或查询内容默认放入日志。日志按大小／数量轮转；异常 storm 限速，保留摘要和计数。

### 11.4 工具链与安装包

固定已验证的 JDT LS、Java Debug Adapter、Tomcat 和其他工具的版本与校验信息。开发用跳过校验开关不得成为正式安装包默认配置。保留离线安装方式与清晰缺失提示，不把联网失败无限自动重试成后台风暴。

重新分发 JDK、第三方二进制、图标、字体、插件与主题时逐项核对许可证，不能以两个仓库顶层 Apache-2.0 代替全部依赖审查。生成第三方清单与可追溯来源；本交付包不包含字体或上述工具链二进制。

### 11.5 发布升级与恢复

配置升级带 schemaVersion 与备份；读取旧配置后迁移，但不能将 unknown 字段静默解释为危险默认。升级中断可恢复；同一个 Agent 端口被新旧实例争用时有明确错误。

版本发布附带已测试环境矩阵、已知限制与回滚说明。不要把“理论上支持 JSP”写成“所有旧 Web 工程开箱即用”；也不要因某一测试通过就覆盖 IBM/HotSpot、不同 Windows 文件系统或代理网络差异。

<a id="reuse"></a>
## 12. Lithe 复用清单：直接复制／移植／借鉴／不引入

### 12.1 分类定义

- **A：可原样复制的独立数据。** 主要是已读 JSON 测试样例；需要接入 Kairo 测试 runner，复制本身不会新增功能。
- **B：可移植的算法或实现骨架。** 必须改语言、依赖或宿主接口，并运行等价性与集成测试。
- **C：只借鉴设计。** 学约束和责任分割，不复制文件。
- **D：不建议作为当前替代方案。** 不匹配旧 Java Web 场景或带来不必要重写。

### 12.2 已经阅读、可以明确标记的项目

| 分类 | Lithe 固定快照文件 | 可拿走的内容 | Kairo 落点（拟议） | 必要适配与限制 |
|---|---|---|---|---|
| A | `shared/fixtures/debug/breakpoint-relocation-v1.json` [L09] | 插行后断点位置与条件信息保持的黄金样例 | `tests/fixtures/upstream/lithe/debug/` | 原样保存；adapter 对齐字段和行列约定；目前该文件仅一个 case，不能替代完整覆盖 |
| A | `shared/fixtures/debug/disconnect-policy-v1.json` [L10] | launch/attach/unstarted 的终止参数样例 | 同上 | 保留原输入输出；Kairo 实际 owner 规则可在额外测试中加强，不要修改上游样例后仍称原样 |
| A | `shared/fixtures/debug/variable-paging-v1.json` [L11] | 分页请求、变量元信息及负数数量归零的样例 | 同上 | 需 Kairo 的请求／响应转换器；验证 adapter 能力，而不是 UI 单独分页假装后端支持 |
| B | `rust/lithe-core/src/debug/breakpoint_relocation.rs` [L03] | UTF-16 编辑锚点迁移、去重和条件保留 | 现有断点模型的纯策略层 | 先验证 Theia/Monaco 已有迁移；移植 TS/Go 时保持坐标和 surrogate pair 语义，避免重复生效 |
| B/C | `rust/lithe-core/src/debug/protocol.rs` [L01] | 帧缓存、长度上限、分片、多个消息处理思路 | 自有 DAP 桥确有缺口时 | **DAP，不是 JDWP**；依赖 Rust/serde/CoreError，不能粘进 Go；已有成熟传输则优先复用 |
| B/C | `windows/tauri/src/features/debugger/services/debug-adapter-service.ts` [L04] | 显式 sessionId/operationId、初始化失败清理、按文件同步断点 | DebugBroker facade | Tauri invoke/listen 改成现有 Theia/RPC；不能复制其仅传 line 的局限；清理所有部分成功的订阅 |
| C | `rust/lithe-core/src/debug/engine.rs` [L02] | 状态机、pending 请求、effects 与宿主分离 | 每会话调试状态与测试 | 不搬全局会话表和巨型文件；只移植行为约束，保留当前 DAP owner |
| C | `windows/tauri/src/workbench-app.tsx` [L06] | 启动里程碑、首帧后调度、生命周期清理 | Theia 启动贡献与监测 | 不替换 Theia 根组件；需验证静态 imports 和实际 lazy 边界 |
| C | `scripts/verify-service-boundaries.sh` [L08] | 架构边界变为自动检查 | Go/TS 依赖检查脚本与 CI | 脚本为 macOS/zsh/Swift 路径与规则，不能当 Windows 现成脚本直接运行 |
| D（仅限替代用途） | `rust/lithe-core/src/lsp/lightweight/symbols.rs` [L07] | 当前文件标识符备用补全 | 可选的明确降级 provider | 不得替代 JDT 精确引用、重命名和调用关系；不要把文本启发式变成批量修改依据 |
| D | 整套 macOS UI / Windows Tauri shell / Rust core 替换 | 当前没有必要整套引入 | 无 | 重写成本与旧系统适配回归大；本次没有性能证据支持全面迁移 |

**直接复用的准确结论：** 本次最适合立即原样引入的是三个已读 JSON fixture；生产代码中，较适合移植的是断点迁移等纯算法。没有哪一个已读 Rust/Swift/Tauri 模块可以完全不适配地替换 Kairo 核心实现。

### 12.3 只定位了路径、尚不标记为可直接采用的候选

目录中还看到 `dap-session-v1.json`、`exception-info-v1.json`、`java-test-launch-v1.json`、`run-in-terminal-v1.json`、`stepping-filters-v1.json` 等调试样例。本次没有逐一读取并分析其完整语义，因此只是下一轮候选，不能写成已审核复用资产。

对 `java-test-launch` 尤其要核验是否带较新 JDK 参数或运行时假设，不能把通用现代 Java 测试启动配置直接套到 Java 6。

### 12.4 引入上游代码的步骤

固定上游 commit → 逐文件检查头部许可及附近第三方说明 → 保存原文件与来源清单 → 先编写 Kairo adapter → 跑原始样例 → 增加旧工程特有边界测试 → 接入功能 flag → 小范围验证 → 合并。

生产算法的变更和上游原样测试数据分开存放。不能为了让移植测试绿灯偷偷改变 expected 输出；确实需要不同语义时，建立 Kairo 扩展样例并写明差异。

### 12.5 来源记录建议

```json
{
  "component": "lithe-debug-contract-fixtures",
  "upstreamRepository": "1lck/Lithe-IDEA",
  "upstreamCommit": "9446a8fd0a318da883a2ce4757d3a429bbdfba03",
  "license": "Apache-2.0",
  "files": [
    "shared/fixtures/debug/breakpoint-relocation-v1.json",
    "shared/fixtures/debug/disconnect-policy-v1.json",
    "shared/fixtures/debug/variable-paging-v1.json"
  ],
  "modifications": "none for original fixtures; Kairo adapters tracked separately"
}
```

正式引入时还应记录下载后的实际 hash、审查者和目标路径；本示例没有虚构 hash 或审查签名。

### 12.6 许可证边界

两个固定快照的顶层 LICENSE 均标示 Apache-2.0。[K22] [L12] 复用时通常需要保留适用版权与许可说明、随分发提供许可证、标记修改，并在上游有适用 NOTICE 时处理相应通知；商标授权不能由代码许可证推定。具体文件或依赖若有单独许可，以其实际条款为准。[N05]

这意味着“可以按条款复用”，不意味着可删除作者信息、把所有第三方资源视为自有，或无审核地搬运安装包。首次引入可建立 `THIRD_PARTY_NOTICES.md` 与来源 manifest。本次交付没有自动把 Lithe 生产模块合并到你的仓库。

<a id="roadmap"></a>
## 13. 实施顺序与 PR 拆分

### 13.1 阶段顺序

**阶段 A：先防止错误结果。** 保护 Java 目标、规范文件身份、禁止猜调试目标、固定会话与产物。该阶段不追求新增功能，完成后用户至少不会因自动流程更新错对象。

**阶段 B：使资源和生命周期可靠。** 修复协议、搜索取消、任务回收、重启接管与编码元数据；完成稳定性基线。

**阶段 C：强化日常开发能力。** 整页 JSP 语义、统一 ProjectModel、端到端调试能力、启动与索引性能。

**阶段 D：形成持续交付能力。** 边界门禁、安全验证、兼容矩阵、配置升级、许可证来源与发布验收。

安全审查和测试贯穿所有阶段；不是等到最后才管。下面 PR 编号用于规划和依赖，不代表已经创建到 GitHub。

### 13.2 PR 级任务表

| PR | 优先级 | 修改范围／关键任务 | 前置 | 完成证据／回滚 |
|---|---|---|---|---|
| PR00 基线与止损 | P0 | 固定快照、记录当前构建命令；补工作流 trace；不明确目标的自动 HotSwap 默认禁用 | 无 | 现有行为可复测；仅配置切换可回滚，不能恢复危险默认 |
| PR01 编译兼容门禁 | P0 | `compiler.go` 去掉 target 提升；支持集检查；编译结果补实际工具链；初版 class major 检查 | PR00 | T01–T04；不兼容时安全失败；旧配置仍可读取 |
| PR02 文件身份 | P1 | `@kairo/protocol`、Runtime client、HotSwap handler 统一 sourceUri/projectId；宿主解析、授权、包含判断 | PR00 | T05–T08；旧 read API 保持；写 API 不接受不安全回退 |
| PR03 目标精确绑定 | P0 | 删除首个服务器选择；target context 必填；project/server/session/instance 校验 | PR02 | T09–T11；缺绑定时禁用自动更新而非猜测 |
| PR04 构建产物清单 | P0 | Build 输出 manifest；按 binaryName/source/hash 映射；增量产物与 staging 管理 | PR01、PR02 | T12–T14；可保留旧构建 UI，但不得复用 basename 首项路径 |
| PR05 DebugBroker 与 HotSwap 队列 | P0 | 固定 session generation；每目标串行副作用；细分错误；取消盲目 DAP→JDWP 回退 | PR03、PR04 | T15–T19；flag 回滚到手动受控更新，不恢复跨目标风险 |
| PR06 JDWP 底层正确性 | P1 | 两字节类型、ReadFull、错误码、包长、IDSizes、事件处理；明确直接客户端能力边界 | PR00 | T20–T24；先纯协议测试再真实 VM；不与 UI 重写混为一 PR |
| PR07 JobManager 与幂等 | P1 | 自定义构建 context 所有权、cancel/finalize、执行中去重、输入指纹和结果查询 | PR00 | T25–T27；保留旧 endpoint facade，新内部实现可隔离切换 |
| PR08 搜索取消与完成元数据 | P1 | `SearchStreaming` owned context+join；暴露 skipped/truncated/cancelled；结果失效处理 | PR07（共享取消契约） | T28–T30；保留现有编码与工作池；性能回归对照 |
| PR09 Agent 重启接管 | P1 | supervisor、就绪确认、端口／实例代际交接、状态文件原子更新 | PR07 | T31–T33；子进程失败可诊断，不能旧新进程同时丢失 |
| PR10 文档与编码安全 | P1 | UTF-16 解码后 EOL、未知 charset、严格 ASCII、保存冲突与显式转码 | PR02 | T34–T37；原字节恢复点；不做全工程自动转码 |
| PR11 虚拟文档 owner | P1 | VirtualDocumentManager、version/lease/cancel；补全诊断共用生命周期 | PR02 | T38–T39；可退回已有安全 snippet，但不重复 open/close |
| PR12 JSP 整页 SourceMap | P1 | 页面级虚拟 Java、imports/declarations/include、edits 回映射 | PR11、PR10 | T40–T43；分能力 flag，上线前旧工程样例通过 |
| PR13 ProjectModel 收敛 | P1 | 已有导入／描述生成基础上统一有序 classpath、来源、revision、增量失效 | PR01、PR02 | T44–T46；旧配置适配层与 migration 测试 |
| PR14 调试体验与断点能力 | P1 | 断点迁移、字段全链路、分页变量、stop generation、attach 终止语义 | PR05、PR06 | T47–T50；先验证现有 Theia 能力，缺口才移植 Lithe |
| PR15 启动与索引性能 | P2 | 分阶段 ready、按需启动、文件清单缓存、资源预算与指标 | 阶段 A/B 稳定 | 固定数据集冷/热基准和峰值；不得牺牲正确性换成绩 |
| PR16 信任与认证目标 | P1 | endpoint-secret 绑定、workspace trust、危险操作权限矩阵、日志脱敏 | PR02、PR03 | T51–T53；开发例外显式，生产默认安全 |
| PR17 架构与上游来源门禁 | P2 | Go/TS 依赖边界、废弃路径禁用、新代码规模检查、fixture 来源与 license manifest | PR00 即可先建骨架 | CI 能阻止违规依赖；例外有记录；原始 fixture 不被改写 |
| PR18 发布与兼容验收 | P1 | Win10/Java6/Tomcat6 全链路、可用时 WAS 专项、离线启动、升级恢复、文档同步 | 所有发布必需项 | 完整验收记录、已知限制和回滚说明；没有记录不宣称支持 |

### 13.3 第一轮具体执行说明

**PR01 的实现顺序。** 先增加一个“请求 1.6，但编译器最低支持 8 必须报错”的失败测试；再修改编译参数生成；再添加产物 major 检查。不要先改测试期望让旧行为合法化。自定义 args 分支也要进入产物检查；只修默认 args 会留下绕过路径。

**PR02 的实现顺序。** 先确定协议中的 sourceUri，建立宿主 URI 解析与安全包含测试；修改 HotSwap 调用端；修改 Go handler；验证旧 endpoint 的兼容错误。不要在若干函数里分别加 `replace('file://', '')`。

**PR03 的实现顺序。** 先禁止 fallback 首项目标；再从现有运行／调试配置解析明确 binding；最后补 UI 的选择与绑定提示。没有可用 binding 时保留“编译”能力，但关闭“自动更新”，而不是整体 IDE 不能编辑。

**PR04 的实现顺序。** 从当前编译结果出发生成小型 manifest；支持一源多产物与输出校验；再由 HotSwap 消费 manifest。先让清单正确，再引入内容寻址或复杂缓存，避免两个大改同时进行。

**PR05 的实现顺序。** 先捕获 sessionId/generation 并在 await 后验证；接着串行化同目标的提交；最后收敛 DAP/直接 JDWP 路径。编译可按策略并行，但提交 VM 的动作必须有顺序和版本条件。

### 13.4 哪些任务可以并行

协议纯函数测试、fixture adapter、文档校正和性能采样工具可以与主要功能修复并行。文件身份和 target 契约必须先定好，否则多人同时开发容易各造一个 projectId/URI/session 模型。

不建议并行大改：ProjectModel schema、JSP SourceMap 和整套 Debug owner。先冻结契约，再按消费者迁移。任何“顺手重构全部导入／全部样式／全部命名”的改动都与修 Bug 分开提交。

### 13.5 PR 模板

```text
解决问题：Fxx / 关联验收 Txx
现有行为：源码入口 + 最小触发条件
设计选择：为什么采用这一方案，为什么不采用整体重写
修改范围：生产路径、兼容路径、协议／配置影响
测试：新增失败测试、修复后结果、Windows/Java6 覆盖范围
未验证：明确列出，不用“应该没问题”替代
风险：文件改写／目标误选／进程残留／兼容性
回滚：flag、适配层、配置备份；禁止恢复危险行为
证据：基线 commit、日志、artifact、上游来源与许可证
```

<a id="acceptance"></a>
## 14. 验收测试与持续优化机制

### 14.1 三层测试，不能互相替代

**纯逻辑／协议层：** 路径规范化、编码元数据、JSP 映射、断点锚点、协议编解码、状态转换。快速运行，使用独立黄金数据。

**组件契约层：** 浏览器客户端到 Agent schema、模拟 DAP/JDWP、LSP 文档生命周期、构建 manifest、搜索取消、进程 owner。重点做错误、超时、乱序、断线与重试。

**真实环境层：** Windows + Java 6 + Tomcat 6、真实 GBK/JSP 工程、多目标调试、离线和权限受限环境。必须检查实际 class、运行结果与进程残留，不能以 mock 返回成功替代。

下面是**待实现的项目验收计划**，不是本次已全部通过的测试成绩。个别底层逻辑有本次独立验证，仍不能替代同名真实集成场景。

### 14.2 验收用例矩阵

| ID | 场景 | 必须满足的结果 |
|---|---|---|
| T01 | source/target=1.6，编译器不支持6 | 明确失败，不提高目标 |
| T02 | Java6 工具链与简单 Servlet 工程 | 实际生成适配目标的 class 并可运行 |
| T03 | 自定义构建产出 major52，目标Java6 | 部署／热替换前拒绝 |
| T04 | 语言服务宿主切换，业务工具链不变 | 编译参数、运行 JVM 不被修改 |
| T05 | 空格、中文、#、% 文件 URI | 定位到正确文件，无双重解码 |
| T06 | 同前缀兄弟目录 | 不属于当前工程，不自动更新 |
| T07 | Windows 盘符、UNC、junction | 按明确宿主授权规则处理 |
| T08 | Mac 浏览器操作 Windows 文件 | URI 在文件所属宿主转换 |
| T09 | 两个项目两个调试服务器 | 只更新绑定目标，顺序改变无影响 |
| T10 | 目标不存在或不可唯一定位 | 拒绝，不选择首项 |
| T11 | 服务重启后复用相同端口 | 旧 generation 请求失效 |
| T12 | 不同 package 中同名 Foo.java | manifest 精确映射，无 basename 误选 |
| T13 | 内部／匿名类增删与重编译 | 产物清单完整，删除可追踪 |
| T14 | 编译完成后产物文件被覆盖 | hash 不符拒绝提交 |
| T15 | 编译期间 A→B 切换调试会话 | 不向 B 提交 A 的产物 |
| T16 | v1/v2 保存，编译完成乱序 | 最终不回退到旧保存版本 |
| T17 | DAP 返回结构变更不支持 | 不另建 JDWP 盲目重试 |
| T18 | 同 JVM 两个 ClassLoader 含相同FQCN | 只操作绑定 loader，歧义拒绝 |
| T19 | 关闭工程后编译返回 | 不产生新部署／热替换副作用 |
| T20 | char、short、相邻多字段黄金包 | 字节数、值与游标正确 |
| T21 | 握手任意分片、超时、EOF | 正确成功或有界失败，连接清理 |
| T22 | length=0/10/11/超大/截断 | 分配前验证，无无限资源增长 |
| T23 | VM事件先于响应，ID宽度差异 | 正确分流和协商或明确不支持 |
| T24 | JDWP规范错误码 | 保留真实code、正确名称与未知值 |
| T25 | 同key 20个并发构建／启动请求 | 仅一次副作用，可查询统一结果 |
| T26 | 同key不同payload | 冲突错误，不重放错误结果 |
| T27 | 构建失败、完成、取消、关闭 | cancel/timer/进程树均收敛 |
| T28 | 搜索第一个batch消费者断开 | 所有生产者退出，不等待默认timeout |
| T29 | 搜索大文件、无权限文件、结果上限 | completed 明示 skipped/truncated |
| T30 | 连续更改查询100次 | 旧搜索不继续占CPU或覆盖新结果 |
| T31 | 重启期间旧实例慢shutdown | 子进程接管有握手，不竞争即退出 |
| T32 | 新进程失败或端口被抢 | UI与日志反映真实失败，可恢复 |
| T33 | 连续重启／退出／崩溃 | 不出现多个互相冒充的Agent实例 |
| T34 | GBK文件加入不可表示字符 | 保存前提示，原文件不被静默损坏 |
| T35 | UTF-16LE/BE CRLF/LF/BOM | 元数据正确，普通保存不乱改 |
| T36 | Java字符串出现charset与未知声明 | 不误判为高置信UTF-8 |
| T37 | 编辑期间外部修改文件 | 冲突可见，不静默覆盖 |
| T38 | 并发补全和诊断同一个JSP | open/change/close合法且唯一 |
| T39 | 虚拟文档关闭后旧响应返回 | 不应用diagnostics或edits |
| T40 | JSP跨脚本块变量和控制流 | 整页语义完整，定位正确 |
| T41 | JSP page import、声明方法、include | 正确依赖和诊断，不强制现代API |
| T42 | JSP中文、emoji、CRLF位置映射 | UTF-16 source map不偏移 |
| T43 | 虚拟Java import额外edit | 安全映射为JSP指令或明确拒绝 |
| T44 | 同名类存在于两个JAR | 有序classpath一致且冲突可解释 |
| T45 | 修改源目录／依赖／输出目录 | LSP、编译、Debug使用同revision |
| T46 | JDT崩溃重启、项目切换 | 重建正确文档集合，不恢复旧工程 |
| T47 | 断点插行/删行/替换/撤销重做 | 只迁移一次，条件和启用状态保留 |
| T48 | 条件／命中／日志／异常断点 | 每一字段通过UI→adapter→VM验收 |
| T49 | 大数组变量分页、暂停切换 | 有界节点数，旧reference响应不覆盖 |
| T50 | attach后停止调试 | 非owned业务进程继续存活 |
| T51 | 不可信URL override | secret不发送到未批准endpoint |
| T52 | 未信任工程包含启动脚本 | 打开工程不自动执行 |
| T53 | 诊断包包含认证和连接信息 | 敏感字段脱敏且收集范围可见 |

### 14.3 真实多目标 HotSwap 验收脚本设计

准备 A/B 两个独立 Web 工程，含相同 FQCN 的简单类，各自返回不同且可观察的文本。各绑定独立运行实例；另外准备同 JVM 不同 Web 应用的 ClassLoader 案例。

正常流程先验证 A 修改仅影响 A；交换服务列表顺序再验证；再阻塞 A 编译，切换到 B 并放行 A；最后让 A 重启并复用端口，释放旧操作。任何一次 B 输出变化、旧实例操作成功或日志目标身份缺失，都不通过。

日志必须记录 operationId、projectId、runConfigurationId、runtimeInstanceId、sessionGeneration、buildId 与被更新的 binaryName/hash，不记录 secret。将实际返回值与日志交叉检查，而不只看 IDE toast。

### 14.4 稳定性与故障注入

模拟磁盘只读、文件被占用、网络断开、Agent/JDT 子进程退出、响应乱序、超时、配置解析失败和取消过程中重复关闭。对每种故障检查最终状态、可恢复性与资源回收。

“catch 后不崩溃”不是合格标准；用户必须知道任务是否执行、是否部分成功、是否需要重新编译或重载。结果不确定时显示不确定，不能为了界面整洁伪装为成功。

### 14.5 持续优化闭环

每轮选一个可测工作流，先记录问题与基线，再加失败测试，再改实现，最后保存正确性和性能证据。复杂方案拆成可回滚 PR，不连续叠加十几项未经验证的“优化”。

建议维护三个短清单：已证实缺陷、待复现风险、后续能力。新发现不能直接塞进“已修复”。每个关闭的缺陷有对应测试与变更 commit；每个性能结论有可复测数据集。

<a id="verification"></a>
## 15. 本次已经执行的验证

### 15.1 实际环境与结果

| 项目 | 本次情况 |
|---|---|
| 容器 | Linux amd64 |
| Go | `go1.23.2` |
| Node | `v22.16.0` |
| javac | `21.0.11` |
| Go 独立测试 | 11 个顶层测试，通过；启用 `-race` |
| Node 行为模型测试 | 3 个测试，通过 |
| 实际 javac 实验 | target1.6 原样参数编译失败；模拟提升为8后成功，class major=52 |
| Java6/Tomcat6/Windows 真实运行 | 未执行 |
| Kairo/Lithe 原仓库全量测试与构建 | 未执行 |
| 远程仓库修改／分支／PR | 未创建，未提交 |

**“测试通过”的含义必须解释清楚：** 一部分测试刻意验证旧行为会出现所指出的问题，例如 1.6 被提升成 8、前缀包含误判、消费者退出后生产者仍在。它们 PASS 表示成功观察到了该行为，**不是说旧实现正确**。另一部分验证参考防护逻辑。所有测试均为独立提取／改写的行为模型，不是直接导入完整 Kairo 服务执行。

### 15.2 本次实现的参考代码

`regression/guards.go` 提供最小参考实现：拒绝静默目标提升、完整握手读取、char/short 两字节编码、分配前包长校验、class header 主版本读取、拥有取消与 join 的 producer/consumer 生命周期。

该代码可供 PR01、PR06、PR07/08 迁移设计参考，**不是完整 JDWP 客户端、完整 class 校验器或通用文件授权库**。代码中的注释已说明边界。整合时必须遵循原仓库类型、错误模型、日志和构建约定，不能直接替换整个模块。

`regression/path-session.test.cjs` 验证 Windows 词法路径包含关系、URI 与本地路径差异，以及 await 前后固定会话身份的行为。词法检查不涵盖 junction/symlink/TOCTOU，不应冒充完整安全实现。

### 15.3 真实 javac 输出摘要

```text
javac 21.0.11
Requested target 1.6, unchanged: exit = 2
error: Source option 6 is no longer supported. Use 8 or later.
error: Target option 6 is no longer supported. Use 8 or later.
After modeled normalizeLevel(1.6, 8): exit = 0
Observed class header: magic=0xcafebabe, minor=0, major=52
Java 6 deployment major-version gate (<=50): REJECT
```

这证明“提高目标以绕过编译器拒绝”产生的实际文件目标不同；没有声称在 Java6 VM 上执行过该 class。主版本对应关系依据 JVM 规范。[N04]

### 15.4 随包目录与复现命令

```text
kairo-audit/
  Kairo_vs_Lithe_Source_Audit_and_Refactoring_Plan_2026-09-12.md
  README.md
  implementation-backlog.json
  source-manifest.json
  LICENSE-APACHE-2.0.txt
  ATTRIBUTION.md
  regression/
    go.mod
    guards.go
    guards_test.go
    path-session.test.cjs
    verify_javac_target.py
  evidence/
    go-isolated-tests.txt
    node-model-tests.txt
    javac-target-experiment.txt
```

在解压后的 `regression` 目录中运行：

```bash
go test -race -count=1 -v ./...
node --test path-session.test.cjs
python verify_javac_target.py
```

Go 模块只使用标准库；`-race` 需要当前平台支持的 race 工具链，Windows 可能需要额外本机编译工具。没有 race 支持时可先运行 `go test -count=1 -v ./...`，但须明确不等于执行过竞态检测。javac 实验需要本机 Java 编译器；其他 JDK 可能有不同输出，不要机械套用本次 21.0.11 的结果。

本次日志保留了真实执行结果。未把失败的 clone 日志、字体、业务数据、工具链二进制或不必要的仓库副本放进交付包。

<a id="execution"></a>
## 16. 开发执行约束与完成标准

### 16.1 可直接交给开发者／编码代理的执行要求

```text
仓库：Qioooba/kairo-ide
基线：6f6792213a540fad678cde5ea1790c92b83d3bcd
原则：保留 Theia/Monaco + Go；不强制业务升级 JDK；小步、可验证、可回滚。

每次只认领一个 PR 任务：
1. 读取当前相关文件、调用方、测试与 package/go 配置；比较与审计快照的差异。
2. 确认生产调用链，不能只修废弃兼容实现。
3. 先写能暴露目标问题的失败测试；预期来自规范或独立样例。
4. 实现最小修复；不要同时重写UI、依赖管理与部署系统。
5. 运行仓库真实存在的脚本和相关测试；不臆造脚本名或测试结果。
6. 针对 Java6/Windows/GBK/多目标调试运行所需集成案例。
7. 记录已通过、未运行、失败及环境，保留原始日志。
8. 更新能力矩阵和相关文档，再提交独立PR。

禁止：
- source/target 自动提升；用新 JDK 代替用户目标。
- 在目标不明确时选择第一个 JVM、服务器、ClassLoader 或 class 文件。
- 将所有 DAP 错误都当“不支持”并盲目回退。
- 为通过测试删除安全校验、降低断言或忽略真实编译错误。
- 未经预览批量转码／重构／删除产物。
- 复制 Lithe 代码却不记录来源或忽略其宿主依赖。
- 把“编译过”说成“Windows和Java6全链路已验证”。
```

### 16.2 首轮发布的完成标准

首轮至少解决 F01–F07 中错误目标与兼容性相关路径，修复影响被使用协议路径的基本错误，并证明搜索／构建／重启不会在常见失败路径失控。无法完成的自动能力默认关闭或清晰标记，不靠隐藏错误维持“功能齐全”。

发布验收必须覆盖你的真实日常闭环：导入旧工程 → 中文文件正常打开保存 → Java/JSP 基础定位补全 → 正确 JDK 构建 → 本地 Tomcat 启动 → 断点命中 → 修改方法体 → 更新精确目标 → 关闭调试不误杀非 owned 服务 → 再次启动无残留冲突。

### 16.3 长期方向

在基础稳定后，优先投资旧工程特有价值：可解释 classpath、JSP/Servlet/TLD 跨文件定位、可靠 Java6 Debug、GBK 安全重构、离线工具链和低内存工作模式。通用 AI 面板、复杂主题、多语言百科式功能和大规模 UI 重写暂后置。

**最终判断：Kairo 不需要变成另一个 Lithe。你需要把 Lithe 的状态隔离、纯逻辑测试、宿主边界和启动观测方法吸收进来，让 Kairo 已有的旧 Java Web 能力真正可靠。** 最有价值的改造不是“新增了多少功能”，而是“每次保存、编译、调试和热更新都能证明作用于正确文件、正确产物与正确运行实例”。

<a id="sources"></a>
## 17. 源码与规范证据索引

下表为本报告使用的关键文件索引。读取局部范围的文件不声称已逐行审计整文件；目录树浏览也不计作该目录下所有源码已经审计。链接固定 commit，便于开发者复核。

| 编号 | 文件／链接 | 实际阅读范围与用途 |
|---|---|---|
| [K01] | `Qioooba/kairo-ide/README.md` | README 定位和功能说明；不视为实测结果 |
| [K02] | `Qioooba/kairo-ide/docs/architecture.md` | 架构说明，与实际入口交叉核对 |
| [K03] | `Qioooba/kairo-ide/docs/MILESTONES.md` | 1–240 行请求范围；历史状态仅作参考 |
| [K04] | `Qioooba/kairo-ide/runtime-agent/internal/build/compiler.go` | 1–240 行；工具链探测、normalizeLevel、编译参数 |
| [K05] | `Qioooba/kairo-ide/packages/java-extension/src/browser/java-hotswap-service.ts` | 1–460 行请求范围，覆盖保存、编译、DAP与Agent路径 |
| [K06] | `Qioooba/kairo-ide/runtime-agent/internal/api/hot_deploy_handlers.go` | 1–405 行；编译、热替换、项目和目标解析 |
| [K07] | `Qioooba/kairo-ide/runtime-agent/internal/debug/redefine_live.go` | 类文件解析、ClassesBySignature 与 live redefine 实现 |
| [K08] | `Qioooba/kairo-ide/runtime-agent/internal/debug/jdwp_conn.go` | 连接握手、命令响应、类查询与重定义 |
| [K09] | `Qioooba/kairo-ide/runtime-agent/internal/debug/jdwp.go` | 包编解码、数值类型、游标和错误码表 |
| [K10] | `Qioooba/kairo-ide/runtime-agent/internal/debug/jdwp_test.go` | 1–240 行；部分黄金包及错误名称案例 |
| [K11] | `Qioooba/kairo-ide/runtime-agent/internal/search/search.go` | 1–525 行；扫描、worker、stream collector与取消 |
| [K12] | `Qioooba/kairo-ide/runtime-agent/internal/encoding/encoding.go` | 1–460 行；Detect、EOL、编码名称与Encode/Decode |
| [K13] | `Qioooba/kairo-ide/packages/jsp-extension/src/browser/jsp-scriptlet-java-completion.ts` | 完整补全实现，含虚拟文档生命周期和edits适配 |
| [K14] | `Qioooba/kairo-ide/packages/jsp-extension/src/browser/jsp-virtual-java.ts` | 完整包装生成与位置映射 |
| [K15] | `Qioooba/kairo-ide/packages/jsp-extension/src/browser/index.ts` | 导出模块清单；不代表每个导出实现已审计 |
| [K16] | `Qioooba/kairo-ide/runtime-agent/cmd/kairo-runtime/main.go` | 1–245 行；容器装配、监听、状态与重启配置 |
| [K17] | `Qioooba/kairo-ide/runtime-agent/internal/api/server.go` | 1–245、280–430、490–745 行；缓存、监听、中间件、路由与重启 |
| [K18] | `Qioooba/kairo-ide/runtime-agent/internal/api/build_handlers.go` | 完整自定义构建handler与状态/取消入口 |
| [K19] | `Qioooba/kairo-ide/packages/runtime-extension/src/browser/runtime-connection-service.ts` | 1–650 行；bootstrap、URL/secret配置、请求序列化与重试 |
| [K20] | `Qioooba/kairo-ide/packages/java-extension/src/browser/java-document-sync-core.ts` | 1–260 行；文档同步核心 |
| [K21] | `Qioooba/kairo-ide/runtime-agent/internal/jdtls/jdtls.go` | 1–215 行；生命周期废弃说明、安装和管理职责 |
| [K22] | `Qioooba/kairo-ide/LICENSE` | 文件开头1–16行；Apache-2.0许可声明，不是所有第三方依赖审核 |
| [L01] | `1lck/Lithe-IDEA/rust/lithe-core/src/debug/protocol.rs` | DAP帧编解码及边界处理实现 |
| [L02] | `1lck/Lithe-IDEA/rust/lithe-core/src/debug/engine.rs` | 1–260行；会话、请求、effects与初始化；非整文件审计 |
| [L03] | `1lck/Lithe-IDEA/rust/lithe-core/src/debug/breakpoint_relocation.rs` | 1–230行；迁移算法与测试开头 |
| [L04] | `1lck/Lithe-IDEA/windows/tauri/src/features/debugger/services/debug-adapter-service.ts` | 完整Windows通用调试宿主门面 |
| [L05] | `1lck/Lithe-IDEA/windows/tauri/src/features/debugger/types/debugger.types.ts` | 完整Windows通用调试类型 |
| [L06] | `1lck/Lithe-IDEA/windows/tauri/src/workbench-app.tsx` | 完整工作台根组件与启动安排 |
| [L07] | `1lck/Lithe-IDEA/rust/lithe-core/src/lsp/lightweight/symbols.rs` | 1–230行；当前文件标识符候选与导航 |
| [L08] | `1lck/Lithe-IDEA/scripts/verify-service-boundaries.sh` | 完整macOS服务边界检查脚本 |
| [L09] | `1lck/Lithe-IDEA/shared/fixtures/debug/breakpoint-relocation-v1.json` | 完整JSON；单个断点插行迁移样例 |
| [L10] | `1lck/Lithe-IDEA/shared/fixtures/debug/disconnect-policy-v1.json` | 完整JSON；launch/attach/unstarted样例 |
| [L11] | `1lck/Lithe-IDEA/shared/fixtures/debug/variable-paging-v1.json` | 完整JSON；分页与变量计数归一化样例 |
| [L12] | `1lck/Lithe-IDEA/LICENSE` | 文件开头1–16行；Apache-2.0标准许可文本开头 |

### 17.1 外部规范

| 编号 | 规范 | 用途 |
|---|---|---|
| [N01] | JDWP 传输与握手规范 | 协议／兼容性／许可核对，非产品性能证据 |
| [N02] | JDWP 协议：类型、ID、类查询、错误码、重定义 | 协议／兼容性／许可核对，非产品性能证据 |
| [N03] | JDK 21 javac 参数规范 | 协议／兼容性／许可核对，非产品性能证据 |
| [N04] | JVM class 格式与版本表 | 协议／兼容性／许可核对，非产品性能证据 |
| [N05] | Apache License 2.0 正文 | 协议／兼容性／许可核对，非产品性能证据 |

### 17.2 复核注意事项

本文中的源码结论以固定快照为准；后续提交可能已经修复部分问题。纯设计建议不代表当前仓库完全没有相似模块。独立验证包没有完成原仓库集成；正式实施应先对齐当前分支并运行真实构建和目标环境测试。

---

[K01]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/README.md
[K02]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/docs/architecture.md
[K03]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/docs/MILESTONES.md
[K04]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/build/compiler.go
[K05]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/packages/java-extension/src/browser/java-hotswap-service.ts
[K06]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/api/hot_deploy_handlers.go
[K07]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/debug/redefine_live.go
[K08]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/debug/jdwp_conn.go
[K09]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/debug/jdwp.go
[K10]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/debug/jdwp_test.go
[K11]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/search/search.go
[K12]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/encoding/encoding.go
[K13]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/packages/jsp-extension/src/browser/jsp-scriptlet-java-completion.ts
[K14]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/packages/jsp-extension/src/browser/jsp-virtual-java.ts
[K15]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/packages/jsp-extension/src/browser/index.ts
[K16]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/cmd/kairo-runtime/main.go
[K17]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/api/server.go
[K18]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/api/build_handlers.go
[K19]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/packages/runtime-extension/src/browser/runtime-connection-service.ts
[K20]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/packages/java-extension/src/browser/java-document-sync-core.ts
[K21]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/runtime-agent/internal/jdtls/jdtls.go
[K22]: https://github.com/Qioooba/kairo-ide/blob/6f6792213a540fad678cde5ea1790c92b83d3bcd/LICENSE
[L01]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/rust/lithe-core/src/debug/protocol.rs
[L02]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/rust/lithe-core/src/debug/engine.rs
[L03]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/rust/lithe-core/src/debug/breakpoint_relocation.rs
[L04]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/windows/tauri/src/features/debugger/services/debug-adapter-service.ts
[L05]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/windows/tauri/src/features/debugger/types/debugger.types.ts
[L06]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/windows/tauri/src/workbench-app.tsx
[L07]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/rust/lithe-core/src/lsp/lightweight/symbols.rs
[L08]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/scripts/verify-service-boundaries.sh
[L09]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/shared/fixtures/debug/breakpoint-relocation-v1.json
[L10]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/shared/fixtures/debug/disconnect-policy-v1.json
[L11]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/shared/fixtures/debug/variable-paging-v1.json
[L12]: https://github.com/1lck/Lithe-IDEA/blob/9446a8fd0a318da883a2ce4757d3a429bbdfba03/LICENSE
[N01]: https://docs.oracle.com/javase/8/docs/technotes/guides/jpda/jdwp-spec.html
[N02]: https://docs.oracle.com/javase/8/docs/platform/jpda/jdwp/jdwp-protocol.html
[N03]: https://docs.oracle.com/en/java/javase/21/docs/specs/man/javac.html
[N04]: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html
[N05]: https://www.apache.org/licenses/LICENSE-2.0
[SK]: https://github.com/Qioooba/kairo-ide/commit/6f6792213a540fad678cde5ea1790c92b83d3bcd
[SL]: https://github.com/1lck/Lithe-IDEA/commit/9446a8fd0a318da883a2ce4757d3a429bbdfba03
