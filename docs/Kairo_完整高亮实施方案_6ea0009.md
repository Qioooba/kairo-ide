# Kairo IDE：完整高亮与性能治理实施任务书

审查基线：`Qioooba/kairo-ide@6ea00095d1d2a93c3f79ce2a15803b2f893d92ef`，2026-09-14。

本文是交给实现 AI 的开发与验收要求，不是修复完成报告。已经核对仓库相关源码和上游官方资料，但没有在用户的 Windows 安装包、实际故障 JSP 或指定基准机上运行测试。本文中的时延、内存和覆盖率要求是建议验收目标，不是已有实测成绩。开始实施时记录实际 HEAD，保留用户此后新增的修改。

## 一、目标与边界

保留 Theia + Monaco + 现有 Java/JSP 扩展和 Go Runtime Agent 架构。不得为了高亮强制升级业务项目 JDK、修改业务源码、格式化压缩 JS、拆分 JSP、替换整个编辑器或要求联网。Java 6、Tomcat 6、Windows、GBK、CRLF、离线环境必须继续受支持。IDE 自身运行时与业务项目语言级别分开处理。

目标是“词法完整覆盖 + 正确的混合语言边界 + 可用的真实语义增强 + 可交互的渐进完成”，不是把每个字符涂成彩色。空白、正文和普通标识符可以保持主题默认色；正确识别为多行注释的区域可以一直显示注释色。不能通过统一染色、错误清空状态、跳过长行、关闭语法、只染当前屏或宣称未完成结果已完成来通过验收。

对产品声明支持且能够正常加载、编辑的源文件，不得因为行号、文件规模或单行长度而静默放弃后续词法处理。文档版本稳定后，词法扫描必须最终推进至 EOF；在此之前要有真实的进度与原因。有限硬件不承诺无限尺寸文件瞬时完成；超过经过验证的内存安全边界时，必须明确说明资源限制和可选处理方式，而不是伪装成高亮成功。

主要验收语言为 Java、JSP/JSP fragment、JSP XML、tag/tagx、HTML、JavaScript、CSS、XML、JSON/JSONC、Properties；同时审计产品已经宣称支持的其他语言，不得通过本次重构撤掉其现有能力。

## 二、已核实问题：不要继续沿用错误诊断

### 2.1 两个阈值都是单行相关，不是“一万行以下正常”

`editor.stopRenderingLineAfter` 的含义是每行渲染到多少字符，默认 10000；它不是整个文件只显示前 10000 行。`editor.maxTokenizationLineLength` 是单行词法处理阈值。把后者改为 200000 仍会留下 200001 字符等更长行的缺口。[S1][S2]

仓库 `kairo-editor-preferences.ts` 已设置 200000/-1，但注释和描述存在把字符数写成行数的问题。修正文案，保留资源级配置优先级，不要用写全局默认值冒充实际生效。

### 2.2 “JSP 永远没调渐进染色”不符合当前代码

`java-monaco-registration.ts` 对启动时已有模型的遍历只处理 Java；但 `onDidCreateModel` 中没有 Java 过滤，会对所有新模型调用 `cacheModel`，进而调用 `scheduleProgressiveTokenization`，后者包含 JSP 白名单。[S3][S4]

真实问题是创建时语言尚未确定、空模型后续加载、语言变化、旧模型补接、重复启动和销毁等生命周期没有统一治理。不能在 JSP 扩展里简单再挂一个监听器，否则可能重复调度。另一方面，目前新模型的编辑监听会调用 `getValue()` 更新 Java 缓存，不能把所有语言的全文读取开销继续留在键入热路径。

### 2.3 JSP 规则确实有遗漏，而且远不止 JSP 注释

`jsp-monarch.ts` 没有 `<%-- --%>` 专用规则，也没有 script/style 的 JavaScript/CSS 嵌入状态。[S5]

`root` 的 `/[^<]+/` 会从正文前缀开始吞掉后面的 `${...}`、`#{...}`。属性值的 `/[^"$]+/` 和 `/[^'$]+/` 没有排除 `#`，会吞掉带前缀的 `#{...}`。属性中的 JSP 表达式、嵌套/转义 EL 也不能靠现有规则完整覆盖。

`jsp-grammar.ts` 把 `.jsp/.jspx/.tag/.tagx` 交给同一套普通 JSP 规则；当前扩展名列表没有 `.jspf`。这里要按文档方言处理，不能把 XML JSP 当普通 HTML JSP。[S6]

### 2.4 `%>` 的权威规则不能取自当前导航扫描器

`jsp-java-nav.ts::findClosingScriptlet` 会跳过 Java 字符串和注释中的 `%>`。不能因此认定它就是高亮分区的正确答案。[S7]

JSP 规范规定，脚本元素内部需要字面的 `%>` 时使用 `%\>` 引用；Tomcat 的 JSP Parser 按 JSP 分隔符寻找脚本结束，而不是先解析完整 Java 字符串。因此“让高亮无条件跳过 Java 字符串里的 `%>`”可能把正确边界改错。[S8][S9]

实现时用项目实际支持的 Tomcat 6/JSP 版本构造可复核测试，不引入 Jakarta 包名迁移。区分 JSP 原始源码、JSP 转义后的 Java 内容与生成的虚拟 Java 坐标。

### 2.5 大文件不能只看行数和语言 ID

`large-file-policy.ts` 的判断是字符数或行数满足其一：large 为 5,000,000 字符或 100,000 行，huge 为 50,000,000 字符或 500,000 行。10000 行也可能达到字符阈值。[S10]

保留 `languageId=jsp` 不等于 Monaco 必然继续词法处理。上游另有模型创建时的大文件 tokenization/sync 门槛；当前上游参考代码的 tokenization 门槛是约 20 Mi 个 UTF-16 单元或 300000 行，且该判断在模型构造时固定。必须核验仓库锁定的 `@theia/monaco-editor-core@1.108.201`，不得把上游 main 的数值直接当作已验证的安装包事实。[S11][S12]

### 2.6 主线程空闲回调不是后台线程

`scheduleProgressiveTokenization` 的 `forceTokenization` 是同步调用。单次调用耗时不受外层空闲预算抢占；当前实现还缺少取消、版本、去重和模型销毁管理，且在 idle 超时回调的 `timeRemaining()==0` 情况下可能没有进展。[S4]

不要把调大阈值、逐行同步 force、setTimeout 包一层或更大的空闲预算作为最终性能方案。

### 2.7 IDEA 效果需要分层，不是“Monarch 对 PSI”二选一

IntelliJ 的高亮也分词法、语法和语义标注等层次；VS Code 同样区分基础语法与语义增强。[S13][S14]

当前 Java Monarch 用大小写、下划线、后面是否有左括号等推断 type/constant/method，是词法启发式，不是真实的符号分类。Java 普通字符串缺失引号时也需要按语言规则恢复，不能错误地把后续合法行长期视为同一字符串。[S15]

## 三、确定采用的架构

采用：统一高亮服务 + 可恢复的 JSP 分区扫描器 + Worker 增量词法处理 + Monaco 原生 token 存储适配 + 现有语言服务语义增强。

不重写通用编译器，不把本次修复变成 Tree-sitter 全量迁移，不从头手写所有通用语言语法。普通语言使用经过审计、打包在本地的成熟规则；JSP 外层采用可序列化状态、可暂停的确定性扫描器，控制混合语言边界。保留已有可工作的语言特性提供者。

建议新增一个 `@kairo/highlighting-extension` 包：

```text
src/common/
  highlight-protocol.ts
  language-coverage.ts
  jsp-region-scanner.ts
  lexer-state.ts
  token-cache.ts
  grammars/...
src/browser/
  highlighting-service.ts
  tokenizer-owner-registry.ts
  monaco-tokenization-adapter.ts
  highlighting-diagnostics.ts
src/worker/
  highlighting-worker.ts
  incremental-tokenizer.ts
  highlighting-scheduler.ts
```

`common` 必须是纯逻辑，不导入 DOM/Theia 服务、Java 扩展或 JSP 扩展。Worker 只能引用可在 Worker 中运行的入口。Java/JSP 现有模块可依赖公共扫描接口，高亮包不得反向依赖它们，避免循环依赖。现有语法导出路径可保留为兼容导出，不能复制出多份独立真相。通过现有产品装配注入服务，更新架构边界检查与打包清单。

### 3.1 一份 JSP 分区结果供各功能共享

高亮、Java block 提取、导航、背景区块、虚拟文档和 source map 应读取同一套 JSP 分区事实，不能一个按正则、一个跳过字符串、一个按另一种规则分块。

基础分区使用原始编辑器文本的 UTF-16 偏移，范围为左闭右开；记录方言、语言、父状态、嵌入栈、源码版本、起止位置以及是否确定。不能用 GBK 字节偏移充当 Monaco 列号。未闭合片段必须有显式状态，不得直接丢弃后半文件。

经典 JSP 支持 JSP 注释、指令、声明、表达式、scriptlet、HTML 标签与正文、JSTL/自定义标签、EL、script/style、属性内嵌入。检查 web.xml/page 指令等相关配置对 EL、deferred syntax、脚本禁用的影响；识别已知标签 body-content 语义，不能无条件在 tagdependent 内容里套用普通 JSP 处理。

JSP XML/tagx 支持命名空间、XML 注释、CDATA、XML 形式脚本元素及实体引用。可以保持兼容的语言 ID，通过方言字段分派；不要未经迁移就破坏现有 completion/definition 的 language selector。

宿主 JSP/HTML/XML 分隔规则优先于内嵌 Java/JS/CSS 的颜色规则。例如 JSP 服务端分隔符和 HTML script 结束标签不能一律用“里面是字符串所以忽略”处理。JavaScript 模板字符串和 JSP EL 的冲突按宿主配置判定，不凭颜色猜测。

### 3.2 错误恢复不允许伪造语法正确性

按语言规则能够确定非法换行的普通 Java 字符串，可以在行尾标记错误并恢复。合法多行注释、合法 XML 属性、合法文本块不能被“超过 N 行强制 pop”截断。遇到无法确定的损坏文档，保留诊断及不确定状态，使用有证据的同步点恢复；禁止把猜测标为精确解析。

JSP 结束符属于宿主层。不要为了保留 Java 字符串颜色而越过真实 JSP 结束边界。转义后的 `%\>`、属性转义和 XML 实体必须在语义虚拟文档映射中处理其长度变化。

### 3.3 基础语法不能依赖 JDT LS 或索引就绪

JDT LS 未启动、崩溃、初始化或项目尚未索引时，基础词法仍必须完整。JDT 只在其能力就绪后增强类型、字段、局部变量、参数、方法、常量等真实分类，不能用语义服务成败决定文件有没有基础颜色。

## 四、Worker、增量与版本协议

### 4.1 Worker 和模型管理

默认每个编辑器窗口一个高亮 Worker，多文档共享调度器。不要每个文件创建 Worker。确有实测收益再允许有限并发；同一文件的有状态词法不能按任意行段从 root 并行处理。

每个模型只注册一组生命周期监听。覆盖启动时已有模型、新建模型、空模型异步填充、languageId 变化、语法延迟注册、修改、撤销重做、diff 编辑器、分屏和销毁。相同模型多个编辑器共享任务和缓存，视口优先级聚合；关闭一个编辑器不应销毁仍被使用的模型任务。

区分 URI 与 modelInstanceId，避免关闭后同 URI 重开时旧响应污染新模型。用注册表确定一个语言的基础 tokenization owner；Java 与 JSP 扩展不得重复争抢 Java tokenizer，所有注册句柄可销毁、可查。

### 4.2 同步协议

首次同步受版本保护的文本快照；大快照分批发送，并处理快照发送期间新增的编辑事件。后续只发送增量 edit，包含 beforeVersion/afterVersion、UTF-16 rangeOffset/rangeLength、插入内容和 EOL 信息。明确多光标事件的坐标基准及应用顺序，不要把同一事件内的旧坐标当顺序更新后的坐标。

所有返回数据携带 modelInstanceId、documentVersion、language/dialect、grammarRevision、configurationRevision。已编码颜色的数据还要携带 themeRevision；优先缓存与主题无关的 token 类别，使换主题只重映射颜色而非重新扫描整文件。

不能仅用 debounce 防乱序。任何旧文档版本、旧语法/配置版本、销毁实例、错误 source-map 版本的结果都不得作为当前精确结果提交。Worker 重启时按当前模型快照恢复，而不是重放无法确定起点的旧队列。

### 4.3 增量扫描和检查点

普通检查点初始建议每 256 行保存一次，记录完整外层/嵌入状态；编辑后从编辑位置之前最近的有效检查点重算。只有确认新旧词法结束状态等价且其后源码未变化，才可以复用后缀。状态 equals 不能只比较状态名称，必须比较嵌入栈、引号/注释模式、EL 深度等会影响后续分词的信息。

跨块 token、转义、代理对、CRLF、分隔符和缓冲尾部不完整词素都要正确保留。不能把每 8K 字符直接当独立文本交给原本按整行工作的正则语法，也不能在人工切块处伪造行尾。

视口优先，但不能伪造其起始词法状态。首次跳到 EOF 且没有检查点时，必须从最近可信状态推进，并显示真实进度；不得直接把第 90000 行当 root 开始扫描并宣称精确。

### 4.4 调度与内存

优先级为活跃视口/编辑区域、附近预取、其余已打开文件的后台扫尾。需要公平调度，不能让后台某份文件永远停在未完成。建议视口预取约 300 行，作为可调整起点，不作为只处理这些行的硬限制。

主线程单次 token 应用以 2–4ms 为初始预算；Worker 以 8–16ms 时间片或适应性字符预算运行，在安全词法边界让出执行权。预算包括消息解码、合并缓存、token 提交和刷新开销。单个复杂正则无法被空闲回调抢占，必须审计表达式，设置 Worker 健康检查并具有重建路径。

原生 Monaco 调度与自建 Worker 不得反复处理同一区间。受管模式完成接入后，移除旧的重复 forceTokenization 队列；临时保留时必须去重、可取消、具备版本和销毁检查，并保证 idle 超时且零预算时不会永远不前进。

token/cache 初始总预算建议 128MiB/窗口，使用 LRU 和紧凑数组；原文镜像、Monaco 模型、语义数据的占用单独测量，不能只报告 token 缓存。缓存淘汰不意味着文件永远不再高亮，应利用检查点按需恢复。记录“当前驻留缓存”与“此版本已完成扫描范围”，不要混为一谈。

## 五、Monaco 接入必须真实落地

### 5.1 不伪造公开 API

Monaco 常规 TokensProvider 的 tokenize 是同步接口。不能把它改成 async 返回 Promise，然后宣称 Worker 已接入。不能用几百万个 decoration 模拟基础语法高亮，也不能把全部词法 token 冒充 semantic tokens。[S16]

先以锁定的 `@theia/monaco-editor-core@1.108.201` 编写可运行的接入测试，证明 Worker 生成的 token 和结束状态能够进入 Monaco 实际使用的语法 token 存储，并通知正确范围刷新。上游内部有 `ITokenizationSupport.createBackgroundTokenizer`、`IBackgroundTokenizationStore` 等机制可供调查；这些不是稳定公共 API，名称与签名必须以锁定版本源码为准。[S16]

所有内部导入、兼容处理和必要补丁集中于 `monaco-tokenization-adapter.ts` 及少量受控 patch。优先使用已有可用扩展点；确实需要变更核心门槛/前台 fallback 时，通过可追踪的 pnpm patch、版本断言和兼容性测试完成。禁止到处 `as any`、静默 catch，或直接手改 node_modules 后不提交。

### 5.2 必须核实的四个接入条件

其一，后台 token 与行末状态能一起提交，编辑失效范围能正确回传，EOF 完成状态有真实意义。

其二，大文件模型级 gate 和单行 gate 不会在 Worker 成功后仍覆盖掉结果或拒绝进入 token 管线。查看真实 model creation options，而不是只查看 editor.updateOptions。

其三，前台 cache miss 不会同步扫描整份文件或百万字符单行；未计算出的状态不可被当作确定 root 状态固化。允许短暂 pending，但必须有正确的后台收敛路径，不能把 pending 当完整成功。

其四，超大模型的默认 Worker 同步限制不会导致镜像缺失；必要时由高亮专用增量镜像提供同步，不能假定普通编辑器 Worker 一定拿到了全文。

这四项须在本轮交付中提供测试，不接受留下空实现、“以后再对接”或只有数据在 Worker 中打印。

### 5.3 设置与模型创建

`editor.maxTokenizationLineLength` 不要凭名字塞进不存在的 `EditorOptions.maxTokenizationLineLength.defaultValue`。普通模式通过真实 Theia 配置路径处理。受管高亮模式下，长行应路由到经过验证的 Worker 路径，而不是简单提高一个有限数字或让主线程无限正则处理。

不得全局关闭 largeFileOptimizations 来解决少数文件。对受管源语言在模型创建前应用有内存边界的策略，保留无关大文件、堆操作和其他工作线程的保护。仅当锁定版本确实没有足够细的开关时，再对受管模式做最小、受测试的 gate 适配。

不允许为了改变模型创建时的标志而静默重建用户正在编辑的模型，丢失未保存内容、undo、选区、断点或 URI 身份。实现从加载/模型创建路径治理；存量模型切换策略必须明确、安全，并有回归测试。

`kairo-large-file-contribution.ts` 不得把早期记录的 plaintext 语言或过时 originalOptions 在档位变化时错误写回。只恢复本功能确实修改过的字段，并尊重当前用户配置和语言识别状态。大文件 UI 文案要分别说明词法、语义、装饰功能的真实情况。

## 六、超长单行：计算与渲染必须分别处理

把 tokenization 搬到 Worker 不自动解决 DOM、布局、长行 token 合并和横向滚动的成本。

对 200001 字符、1000000 字符及更多的单行构造测试。使用可恢复的扫描状态处理长行；通用整行语法若无法安全拆分，不能硬切假装等价，要选择经过验证的长行实现或在 Worker 中执行真实整行规则并控制其风险。任何切块方案必须和不切块参考结果做等价性测试。

优先利用 Monaco 已有的视口/横向渲染能力并测量；只有实际发现瓶颈时，才针对锁定版本补充受管的长行可见窗口渲染适配。单行的全文数据、列号、选区、复制、搜索、定位和横向可达性必须不变，不能只是不显示后半行。

大文件允许关闭 minimap、CodeLens、折叠、粘性滚动、昂贵装饰及超长行自动换行，但不能把基础词法一起关掉。不能只把 stopRenderingLineAfter 设为 -1 就认定渲染问题已解决。

## 七、语义增强与主题

先盘点仓库已经存在的 semantic tokens 注册和 JDT 协议通道，复用可以工作的实现，不另建互相覆盖的 provider。按服务端协商能力选择 full/range/delta，不能假定三者都支持，也不能把 hover/definition 转发测试视为 semantic tokens 已完成。

Java 语义分类通过真实符号信息区分 type、method、field、parameter、local、constant 等；当前正则启发式保留为明确的词法 fallback，而非宣称等同语义。语言级别按业务项目配置，不把现代 Java contextual keyword 一律当 Java 6 的保留字。

JSP 使用现有 `jsp-page-model.ts`、`jsp-sourcemap.ts`、`virtual-document-manager.ts` 完善虚拟 Java 与映射。[S17] 验证不同 scriptlet 之间变量可见性、声明区、静态 include 原位置展开及循环、源文件 URI、多行缩进、CRLF、UTF-16 和 JSP 转义长度变化。不要给每个 scriptlet 分别建一个孤立 Java 文件。生成的 wrapper/package/import/scaffolding 不得投影成用户 JSP 的高亮。

语义请求可合并并取消，初始 debounce 建议 100–200ms；旧 resultId、旧文档版本、旧虚拟文档版本或旧映射不得覆盖新文本。语义失败不能清掉词法底色，也不应对整文件每次键入重复构建映射和请求全量结果。

主题层检查 token scope 到颜色的完整映射，尤其嵌入 Java、JSP/JSTL/taglib、属性、EL、JS/CSS。浅色、深色和高对比度主题都测试。已生成 token 却显示默认色，与没有生成 token 是两类问题；诊断必须能够区分。

## 八、按顺序交付，避免只做一个看起来有效的小补丁

### PR0：基线与可观测性

新增 `Kairo: Inspect Highlighting`，显示构建 SHA、Theia/Monaco 版本、实际语言/方言、provider owner、偏好设置实际值与来源、字符数/行数/最长行、模型级 gate、当前文档版本、词法完成范围、长行路径、Worker 状态、语义状态、缓存用量和最后失败原因。

输出可用于验收的 JSON，默认不包含用户源码和敏感路径。用真实用户故障文件本地复现；不能拿“状态栏还是 JSP”或“等 5 秒”作为根因结论。

### PR1：确定性语法缺陷与注册生命周期修复

补 JSP 注释、正文/属性 EL 漏匹配、script/style、必要的属性内嵌入和 Java 错误恢复；新增 `.jspf` 与方言识别测试。集中管理 tokenizer owner 和模型生命周期，清理 Java 对无关模型的全文缓存刷新。每个修复先写失败样例，再提供修复后的真实 token 断言。

### PR2：共享 JSP 分区与语义坐标基础

统一高亮和导航使用的 JSP 分区事实；将 `%>`、转义、注释和 XML 方言差异纳入目标容器兼容测试。保证 source-map 版本和偏移单位正确，保持现有功能可用。

### PR3：Worker 与 Monaco 真正接通

完成锁定版本适配、token/state 提交、版本失效、增量镜像、检查点、视口优先、全文件扫尾和可取消调度；完成大文件 gate、前台 fallback 和长行路径测试。不得只提交 Worker 文件而不改变实际显示管线。

### PR4：长行渲染和大文件策略

用实际 DOM/帧时间验证横向长行、EOF、快速滚动和编辑。只关闭昂贵增强项，不关闭基础词法；修正文案、旧配置恢复和模型生命周期问题。

### PR5：语义、主题与发布验收

接通/修正已有 JDT semantic tokens，完善 JSP 虚拟映射，完成主题矩阵、离线资源与 Windows 安装包测试，提交准确性和性能结果。前几项修完不等于可提前宣称全部验收完成。

## 九、自动化验收矩阵

### 9.1 词法正确性

提供 token golden 测试，不只断言存在 provider 或源码包含某个字符串。对每个期望范围验证类别、起止 UTF-16 偏移、嵌入语言和状态，区分基础词法与语义覆盖。

必须包含：带文字前缀的 `${...}`；带文字前缀的 `#{...}` 属性；合法转义；属性内 JSP 表达式；JSP 注释和 HTML/XML 注释差异；跨 10000 行合法注释；未闭合的普通 Java 字符串与未闭合多行结构；EL 内引号与右花括号；script/style；自定义标签；JSPX/tagx 的 CDATA 和实体；JSP 转义前后长度变化。

分别验证未引用的 `%>` 与 `%\>` 的目标 JSP 行为。不能把现有导航扫描器的输出直接复制成测试期望；用目标容器和规范决定期望。

### 9.2 阈值和规模

行数覆盖 9999/10000/10001、100000、300000、500000；不是认为 10000 行有原生上限，而是排除用户观察到的位置巧合。单行长度覆盖 19999/20000/20001、199999/200000/200001、1000000。文件字符数分别跨越 Kairo 5M/50M 及锁定 Monaco 实际门槛。

磁盘字节数、解码字符数和 UTF-16 单元数分开记录。GBK 中文、CRLF、emoji/代理对、超长第一行、每行很短但行数多的文件分别测试。不能只用重复空行代表实际 JSP 负载。

### 9.3 生命周期与增量

测试空模型后加载大文件、先 plaintext 后 JSP、启动恢复、语法延迟注册、分屏/diff、多文件公平调度、首行修改导致末尾状态变化、撤销重做、大段粘贴、连续输入、主题切换、关闭重开相同 URI、Worker 崩溃重启、旧响应乱序和配置更新。

有状态扫描必须在正确修复后恢复整份文档的结果，不能固定“只重算后面 200 行”。模型销毁后不得继续积累任务、监听器或缓存。

### 9.4 真实界面

通过真实 Monaco 实例检查首部、中部、EOF、超长行最右侧、快速跳转与滚动后的可见 token 和 DOM 样式。计算正确但没有投影到编辑器，不算通过。token 范围覆盖率 100% 不等于“有任意默认色 token 就算完整”，被 gate 跳过的长行也不能算成功。

Java/JSP fixture 中指定关键 token 的正确分类率要求 100%；语义类别仅对具有可用语义上下文的独立 fixture 计分。包含损坏源码的测试按定义好的错误恢复预期验收，不臆测用户原本想写什么。

### 9.5 建议性能目标，必须实测

统一记录 CPU、内存、分辨率、Electron/Theia/Monaco/JDT 版本和是否冷启动。用普通办公机/云桌面实测，不只用高端开发机。

| 样本 | 首屏正确基础高亮目标 | 稳定版本全文词法完成目标 |
| --- | --- | --- |
| 1 万行，约 2Mi UTF-16 单元内混合 JSP | 500ms 内 | 2s 内 |
| 10 万行，约 10Mi UTF-16 单元内混合 JSP | 500ms 内 | 8s 内 |
| 50 万行，约 50Mi UTF-16 单元内混合 JSP | 1000ms 内 | 30s 内 |
| 100 万 UTF-16 单元单行 JS/含嵌入的 JSP | 1000ms 内首个可见窗口 | 5s 内整行词法完成 |

这些是起始验收预算，不是承诺所有硬件和任意复杂源码都已达到。测量从模型内容可用/版本稳定时开始，文件读盘和解码另外记录，避免统计混淆。首次冷跳到 EOF、已有检查点的跳转和已缓存跳转分开报告。

输入到下一帧更新 p95 建议不超过 50ms；主线程 token 应用 p95 目标不超过 4ms。将超过 50ms 的高亮相关长任务作为重点失败项，提交归因和修复，不得通过禁用基础语法让图表达标。记录后台扫尾期间输入/滚动延迟、峰值内存和关闭文件后的回收情况。

对比 IDEA 时使用相同文件、机器、主题可读性标准、冷/热启动条件和已安装版本。区分词法覆盖、语义精度、响应时延、索引耗时和内存。没有实际对比数据不得写“超过 IDEA”。

## 十、构建、离线、交付证据

沿用并通过仓库实际脚本：`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm check:architecture`；把新增测试加入真实执行列表，而不是只创建测试文件。运行相关 `pnpm test:e2e:playwright`、`pnpm test:e2e:desktop`，并记录环境依赖及未执行项。[S18]

Worker、语法数据、需要的 WASM/其他静态资源必须打包本地，并检查许可证。覆盖开发环境、浏览器构建、Windows Electron 安装包、CSP、资源路径、asar、断网启动和 JDT 不可用的情况。不要引入 CDN、后台遥测上传用户源码或为图省事扩大 CSP 权限。

最终交付包括：变更文件及迁移说明；失败样例与修复后的 token 结果；真实安装包截图或录屏；基准数据 JSON；版本与环境；实际运行的命令及结果；超预算项及原因；准确的未验证项。不得用“编译成功”“单元测试通过”“下半页看起来有颜色”代替端到端验收。

修复目标不是解释为什么大 JSP 应该拆分，而是让现有业务文件在产品承诺范围内正确工作。

## 参考来源与复核入口

仓库文件均固定于上述审查 SHA；实施前核对后续变更。

[S1] VS Code / Monaco editorOptions，stopRenderingLineAfter 定义：
`https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorOptions.ts`

[S2] Kairo `packages/theia-product/src/main/browser/kairo-editor-preferences.ts`。

[S3] Kairo `packages/java-extension/src/browser/java-monaco-registration.ts`。

[S4] Kairo `packages/java-extension/src/browser/monaco-tokenization-config.ts`。

[S5] Kairo `packages/jsp-extension/src/browser/jsp-monarch.ts`。

[S6] Kairo `packages/jsp-extension/src/browser/jsp-grammar.ts`。

[S7] Kairo `packages/jsp-extension/src/browser/jsp-java-nav.ts`。

[S8] JSP 规范，Comments / Quoting and Escape Conventions；引用其语法规则不表示要求升级用户项目：
`https://jakarta.ee/specifications/pages/3.0/jakarta-server-pages-spec-3.0`

[S9] Apache Tomcat，JSP Parser（上游参考；目标 Tomcat 6 另行兼容测试）：
`https://raw.githubusercontent.com/apache/tomcat/main/java/org/apache/jasper/compiler/Parser.java`

[S10] Kairo `packages/theia-product/src/main/browser/large-file-policy.ts` 和 `kairo-large-file-contribution.ts`。

[S11] VS Code TextModel 模型门槛参考（main 非锁定依赖）：
`https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/model/textModel.ts`

[S12] Kairo `packages/java-extension/package.json`、`packages/theia-product/package.json`。

[S13] JetBrains 插件文档，Syntax and Error Highlighting：
`https://plugins.jetbrains.com/docs/intellij/syntax-highlighting-and-error-highlighting.html`

[S14] VS Code Syntax Highlight Guide：
`https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide`

[S15] Kairo `packages/java-extension/src/browser/java-monarch.ts`。

[S16] VS Code tokenization interfaces，部分接口为内部接口，不是稳定公开 API：
`https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/languages.ts`

[S17] Kairo `packages/jsp-extension/src/browser/jsp-page-model.ts`、`jsp-sourcemap.ts`、`virtual-document-manager.ts`。本次读取确认这些组件存在；不能由文件名推断所有映射行为已经正确。

[S18] Kairo 根目录 `package.json`，构建和测试脚本。

固定仓库入口：
`https://github.com/Qioooba/kairo-ide/tree/6ea00095d1d2a93c3f79ce2a15803b2f893d92ef`
