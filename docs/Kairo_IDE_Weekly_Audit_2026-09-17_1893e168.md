# Kairo IDE 最近一周代码审计与 AI 修复任务书

仓库：Qioooba/kairo-ide（不是 Qioooba/kairo）  
审计日期：2026-09-17  
审计窗口：2026-09-10 至 2026-09-17  
基线：`a30b7af41bc005ca3ec7d743d5b50e2031a5f610`  
核对版本：`1893e1685640afe5a4c3c2665009a4b97f1ac793`，main

## 使用方法

把本文件整份交给实现 AI。先按源码复核本报告的函数与调用链，再分阶段实现；不是让 AI 仅重新写一份方案。所有建议代码结构、测试场景和性能指标都是待实现/待执行的要求，不是声称已经提交或测试通过的补丁。

本轮核对了窗口内 5 次 main 提交，并检查高亮、JSP、HotSwap、搜索、相关启动绑定、测试与部分 JDT/构建实现。属于围绕本周变更和关键调用链的静态审计，不是整个仓库所有文件逐行通过认证；没有运行完整本地构建、Go 测试、打包 Electron、JDK 1.6/Tomcat 6 集成测试。未证明这些问题都首次由本周引入；这里列的是核对版本仍存在、且与本周修改链路相关的问题。

## 提交范围（日期按 UTC）

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-09-12 | 6f679221 | 许可证更新 |
| 2026-09-14 | 6ea00095 | PR00–PR18 审计相关功能/修复 |
| 2026-09-15 | bf67da84 | UI-01–UI-18 与新高亮扩展 |
| 2026-09-15 | e3096807 | 审计修复、工具链状态等 |
| 2026-09-16 | 1893e168 | 搜索无限模式、日志、主题、工具栏与国际化 |

提交清单：[main 历史](https://github.com/Qioooba/kairo-ide/commits/main/)。上述每个发现的源码链接均固定到本次审计 SHA，后续实现时要核对工作分支差异。

## CI 当前证据与验证边界

最新 SHA 的 Actions run `35107368466`（2026-09-16）结果为 failure；查询返回的 jobs 为空，commit check-runs 数量为 0。本次没有取得失败原因，因此不直接归因于某个编译错误、YAML 错误或依赖问题。

[对应运行](https://github.com/Qioooba/kairo-ide/actions/runs/35107368466)。修复交付前必须检查运行失败原因，恢复真正执行的验证任务，并附可追溯日志。不能将提交说明中的“修复 P0”或仓库内存在测试文件当成绿灯证明。

## 本次发现概要

P1 表示需要优先修复的功能/目标一致性问题；P2 表示精度或接口契约问题。不将未经证实的潜在影响夸大为已发生的事故。

| 编号 | 优先级 | 问题 |
|---|---|---|
| KAIRO-W01 | P1 / 发布前优先 | HotSwap 未校验源文件项目与调试目标项目的一致性 |
| KAIRO-W02 | P1 | 高亮增量编辑只更新版本号，没有修改文本 |
| KAIRO-W03 | P1 | 自定义 token 数组不符合 Monaco 编码协议 |
| KAIRO-W04 | P1 | 所谓 Worker 实际在 UI 线程运行，入口还有 window 副作用 |
| KAIRO-W05 | P1 | 新词法器丢失跨行状态，并未保持原有混合语言覆盖 |
| KAIRO-W06 | P1 | 视口优先扫描会遗漏前缀，却仍宣告整份文档完成 |
| KAIRO-W07 | P1 | JSP 整页诊断和分块诊断相互覆盖 |
| KAIRO-W08 | P1 | 静态 include 在真实调用中未解析，且模型展开顺序错误 |
| KAIRO-W09 | P2 | SourceMap 的 offset 使用平均长度估算，表达式后偏移累计漂移 |
| KAIRO-W10 | P1 | 搜索连接中断被判定完成，旧 socket 关闭会清空新 socket 引用 |

## KAIRO-W01 — HotSwap 未校验源文件项目与调试目标项目的一致性

**优先级：P1 / 发布前优先**

### 具体位置与固定版本源码

- [`packages/java-extension/src/browser/java-hotswap-service.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/java-extension/src/browser/java-hotswap-service.ts)
- [`runtime-agent/internal/api/hot_deploy_handlers.go`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/runtime-agent/internal/api/hot_deploy_handlers.go)

### 代码证据与影响

定位：onJavaFileSaving / isInWorkspace / captureContext / compileFile / redefineViaDap，以及 handleJvmCompile / resolveTargetEndpoint。

前端只验证文件属于任一工作区根目录，captureContext 却绑定当前调试会话的项目。compileFile 只发送 file/sourceUri，不携带冻结上下文中的 projectId；Go 端于是按文件路径推导编译项目。随后 DAP 请求仍发给冻结的当前会话。

后端显式 serverId 分支核对运行状态、调试端口及部分代次，却没有验证 srv.ProjectID 与请求 projectId 一致；顶层 projectId/serverId 与 target 内部字段冲突也没有统一拒绝。

推演场景：工作区同时打开 A、B；当前调试会话是 B；保存 A 的 Java 文件。当前代码会允许进入自动热替换链路，编译 A，再向 B 的 DAP 会话提交 A 的产物。能确定的是目标不一致请求被允许；是否实际替换成功取决于 JVM、类加载器和同名类等运行条件，本次没有执行真实 JVM 误替换实验。自动 HotSwap 当前默认关闭；风险在用户启用该功能后触发。

### 具体实现任务

1. 保存时通过项目模型、规范化路径和 sourceRoots 解析 sourceProjectId。多根工作区、Windows 盘符大小写、空格 URI 必须使用现有路径策略，不能直接字符串 startsWith。
2. 建立一个权威的目标校验函数：源文件项目、编译项目、会话绑定项目、服务器部署项目必须一致。共享源码只允许通过明确的依赖/部署关联授权，不能因文件在工作区中就放行。缺失或冲突时拒绝自动执行，不选择“第一个可用会话”。
3. compileFile 改为接收 HotSwapContext，显式传 projectId、源版本及产物关联标识；Go 端再次验证文件属于该项目授权的源码范围。
4. resolveTargetEndpoint 对顶层字段与 target 字段做冲突校验；显式 serverId 分支增加项目归属验证。用同一规范化 target 传递到后续流程，避免各函数重新推断。
5. 编译完成后、任何 redefine 之前，重新验证 debug session、runtime instance、deployment generation。DAP 和原始 JDWP 两条路径都必须经过同一校验，不只保护后备路径。
6. 产物返回构建 ID、实际输出文件清单及哈希，绑定同一个 target。保留现有串行队列、版本淘汰、结构变化拒绝和禁止抢占 DAP 连接的逻辑。

### 回归测试与完成条件

A/B 两项目各有相同全限定类名，激活 B 后保存 A：断言 B 的 DAP/JDWP redefine 调用次数为 0。向后端提交 projectId=A、serverId=B：必须明确拒绝。编译等待期间重启服务器或结束会话：旧上下文必须失效。合法同项目方法体修改：能成功，且不建立第二条 JDWP 连接。

## KAIRO-W02 — 高亮增量编辑只更新版本号，没有修改文本

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/highlighting-extension/src/worker/incremental-tokenizer.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/incremental-tokenizer.ts)
- [`packages/highlighting-extension/src/worker/highlighting-worker.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/highlighting-worker.ts)
- [`packages/highlighting-extension/src/worker/highlighting-scheduler.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/highlighting-scheduler.ts)
- [`packages/highlighting-extension/src/browser/highlighting-service.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/browser/highlighting-service.ts)
- [`packages/highlighting-extension/src/browser/monaco-tokenization-adapter.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/browser/monaco-tokenization-adapter.ts)

### 代码证据与影响

定位：IncrementalTokenizer.applyEdits，Worker 的 edit 分支，Scheduler.updateContent，HighlightingService.handleWorkerMessage。

applyEdits 在没有 fullTextFallback 时仅调用 cache.setVersion(version) 然后 return 1，完全没有应用 changes。生产 edit 消息只传差量，没有 fullTextFallback。因此后续扫描的是旧 lines，却标成新版本；插入、删除、换行后均会出错。

另有同一正确性边界缺口：updateContent 未校验 beforeVersion；接收 token batch 时没有核对 documentVersion 与 Monaco 当前版本；modelInstanceId 实际复用了 URI，不能区分同 URI 关闭再打开。

### 具体实现任务

1. 为每个模型维护原始 UTF-16 文本镜像和行起始偏移。保留真实 EOL；不要将 CRLF 拆成 lines 后再用 LF 拼回去计算原始 rangeOffset。
2. 对同一个 Monaco change event 中、基于编辑前文本的 changes，验证范围并按 rangeOffset 降序应用；相同偏移/重叠范围须按该版本 Monaco 的实际约定处理，无法保证时请求全量重同步。不同版本的 edit 消息按序处理，不能一起倒排。
3. beforeVersion 必须等于镜像版本。断档、越界或模型代次不符时请求 snapshot，禁止把旧文本强行标为 afterVersion。
4. 计算 earliestDirtyLine，失效受影响的 tokens/checkpoints/覆盖区间；首版可从最早受影响行之后的全部后缀重算，之后再增加状态收敛后的安全复用。返回真实脏行，而不是固定 1。
5. 注册模型时分配不复用的 instanceId；URI 单独保存。batch 必须包含 instanceId、documentVersion、languageGeneration。接收端全部匹配才允许 setTokens/setEndState/completed。
6. 给模型语言变化和关闭/重开统一建代次边界。旧请求和旧 dispose 回调不能删除新 session。

### 回归测试与完成条件

通过真实 snapshot → edit → token batch 链路测试插入、删除、多光标、多行、撤销/重做、CRLF、中文及 emoji。每次增量结果须与“编辑后完整文本重新分词”的结果相同。旧版本 batch、关闭再打开后的 batch、缺失中间版本的 edit 必须被拒绝或重同步。不能只用 fullTextFallback 来让测试通过。

## KAIRO-W03 — 自定义 token 数组不符合 Monaco 编码协议

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/highlighting-extension/src/browser/monaco-tokenization-adapter.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/browser/monaco-tokenization-adapter.ts)
- [`packages/highlighting-extension/src/worker/incremental-tokenizer.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/incremental-tokenizer.ts)

### 代码证据与影响

定位：tokenizeEncoded / applyTokenBatch / tokenizeSingleLine。

lexer 实际产出 [endOffset, kindId]，其中 kindId 是自定义的 0..11。tokenizeEncoded 原样返回该数组；Monaco 的 provider 编码协议要求 [startIndex, metadata]，metadata 是带语言 ID、标准 token 类型、样式和主题颜色的位编码，不是自定义枚举。

后台 ContiguousMultilineTokens 使用结束偏移与 provider 使用开始偏移是不同边界。后台数据的 endOffset 不能一律改成 startIndex；但自定义 kindId 也不能直接成为其 metadata。

### 具体实现任务

1. 明确三层数据：LexicalToken（词法种类/范围）、ProviderTokens（开始偏移/Monaco metadata）、StoredLineTokens（结束偏移/同一 metadata）。使用不同类型或命名，禁止 Uint32Array 在三个边界间无转换复用。
2. Worker 输出独立于主题的 kind/scope 与范围；主线程建立基于锁定 Monaco 版本的 scope → metadata 映射，并缓存主题结果。不要把常数 1..11 当颜色或语言编码。
3. provider 转换：第一个 token 的 startIndex 为 0，后续 startIndex 为前一个 token 的 endOffset；每项 metadata 都来自合法编码适配器。
4. 后台存储转换保持结束偏移，确保最后结束位置等于该行 UTF-16 长度；空行、无 token 行和边界按实际 Monaco 接口处理。
5. 主题切换时使 metadata 缓存失效并重新应用颜色；未通过契约测试之前保留旧的成熟 provider 作为可回退方案，避免新模块无条件夺取全部 Java/JSP 高亮。

### 回归测试与完成条件

针对 int x = 1;、注释、字符串、JSP/EL 测试 token 起止偏移、metadata 解码与文本长度。必须使用项目锁定的 @theia/monaco-editor-core@1.108.201 做实际 provider/后台存储集成；切换明暗主题检查真实颜色。只验证数组长度和偶数位递增不合格。

## KAIRO-W04 — 所谓 Worker 实际在 UI 线程运行，入口还有 window 副作用

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/highlighting-extension/src/browser/highlighting-service.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/browser/highlighting-service.ts)
- [`packages/highlighting-extension/src/worker/highlighting-worker.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/highlighting-worker.ts)
- [`packages/highlighting-extension/src/worker/highlighting-scheduler.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/highlighting-scheduler.ts)
- [`packages/highlighting-extension/src/worker/incremental-tokenizer.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/incremental-tokenizer.ts)

### 代码证据与影响

定位：HighlightingService.initWorker；highlighting-worker.ts 底部全局 hook；Scheduler.triggerSchedule；tokenizeSlice。

前端直接 new HighlightingWorkerInstance，再直接调用 handleMessage；这不会创建独立线程。setTimeout 只是在同一个事件循环中调度。tokenizeSlice 的 fast-forward 在计时前执行，单行扫描内部又没有让出预算，因此长行仍可能长时间占用 UI 线程。

Worker 入口的判断只检查 self 和 self.postMessage；浏览器 window 同样满足。入口被前端直接 import 时会设置 self.onmessage，即覆盖 window.onmessage。产品前端已调用 bindHighlightingExtension，这不是仅存在于测试中的类。

### 具体实现任务

1. 拆成无全局副作用的 worker-core.ts 与只在 Dedicated Worker 中执行的 worker-entry.ts；浏览器服务只能导入 transport/factory，不能导入 entry。
2. 利用现有 Theia 构建链添加真实 Worker 资源，在浏览器和打包后的 Electron 中都验证资源路径、CSP 与启动方式；不要假设未经验证的打包语法可直接使用。
3. 浏览器通过 postMessage/onmessage 通信。Worker 消息显式序列化 LexerState，并在接收端恢复需要 clone/equals 的对象；真实 Worker 的结构化克隆不会保留类原型。
4. 长行也要可分片：保存行内 offset 与词法状态，按字符预算和截止时间续算。把 checkpoint 前推算也算进预算；编辑和取消消息不能一直排在整条巨行扫描之后。
5. 避免 tokenizeEncoded 同步回退再次扫描完整超长行；依照锁定 Monaco 的后台分词合同维护 pending/完成状态，不能把占位结果宣告为最终结果。
6. stop/dispose 取消定时器、清空模型任务、终止 Worker、释放 adapter/owner 注册。Worker 错误要进入可见状态与受控恢复，不能只有 console.warn。

### 回归测试与完成条件

验证分词不在 window 线程，且导入前后 window.onmessage 不变。浏览器版和打包 Electron 都能启动 Worker。对 10 万/100 万字符单行连续输入、滚动、取消及关闭：UI 不被同步全行扫描阻塞，旧任务不能在关闭后继续提交。性能指标须实际采样，不能把 12ms 常量当测量结果。

## KAIRO-W05 — 新词法器丢失跨行状态，并未保持原有混合语言覆盖

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/highlighting-extension/src/worker/incremental-tokenizer.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/incremental-tokenizer.ts)

### 代码证据与影响

定位：tokenizeJavaLine / tokenizeJavaSnippet / tokenizeSingleLine。

Java snippet 扫描遇到未闭合 /* 只生成本行 comment token，不返回延续状态；tokenizeJavaLine 最后固定返回 root，下一行就不再处于注释中。

JSP 分支会设置 directive 状态，却缺少相应的下一行续接处理；HTML 标签分支把整个标签作为一个 token 吞掉，属性中的 EL 不再分开处理，也没有完整的 script/style 内嵌语言路径。不能把“扫描到行尾”视为正确完成混合语言高亮。

### 具体实现任务

1. 统一 scanner 返回 tokens + nextState，不能由上层不加判断地重置 root。Java block comment、字符串/字符字面量、转义和 JSP scriptlet 中的 Java 状态必须可续接。
2. 优先复用或适配仓库现有成熟 Java/JSP grammar 的规则，不再建立与原有功能覆盖脱节的简化替代品。明确各语言进入和退出状态，形成覆盖表。
3. JSP directive、标签属性、EL、Java scriptlet、JavaScript/CSS 嵌入分别维护上下文；保留 %> 出现在字符串/注释时的边界规则。
4. 长行只是调度问题，不是删减语法分支的理由。保留上一个可靠 provider 的受控回退，直到新的实际输出通过黄金样例。

### 回归测试与完成条件

Java 多行 /* 注释 */ 中的 class/return 必须始终是注释；JSP 跨行 page directive、带 EL 的标签属性、script/style、scriptlet 字符串中的 %> 均需黄金输出。比较 token scope/种类和跨行 endState，而不只比较“有 token”。

## KAIRO-W06 — 视口优先扫描会遗漏前缀，却仍宣告整份文档完成

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/highlighting-extension/src/worker/highlighting-scheduler.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/highlighting-scheduler.ts)
- [`packages/highlighting-extension/src/worker/incremental-tokenizer.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/worker/incremental-tokenizer.ts)
- [`packages/highlighting-extension/src/common/token-cache.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/highlighting-extension/src/common/token-cache.ts)

### 代码证据与影响

定位：processNextSlice / pickNextTarget / tokenizeSlice / getClosestCheckpoint。

以 1000 行文档、首个视口 400..450 为例，prefetchStart=100。调度器从第 100 行开始输出，再扫到 EOF；第 1..99 行只可能被前推状态扫描经过，并没有输出 token batch，却在到达第 1000 行时置 completed。completed 模型再请求前面的视口仍被 pickNextTarget 跳过。

checkpoint 还把处理完第 N 行的状态保存在 N，却从 N 重新开始扫描。这混淆了“行前状态”和“行后状态”；getClosestCheckpoint 明确允许等于目标行，因此从检查点行重新取 tokens 时会用错初始状态。

### 具体实现任务

1. 拆分视口任务、脏区间任务和背景补全任务。维护已覆盖区间/未完成区间，不用单个 lastProcessedLine 代表整文档覆盖。
2. 视口优先后必须回补前缀与所有空洞；只有 [1, lineCount] 对当前版本完全覆盖且 endState 有效，才调用 backgroundTokenizationFinished。
3. updateViewport 在模型标为完成后仍应核对该区间是否真的有当前版本缓存；新编辑按受影响区间重新置脏。多文档按时间片轮转，不能让活动文档独占到 EOF。
4. checkpoint 统一为“处理第 N 行之前的状态”；若保存第 N 行之后的状态，则键记为 N+1。恢复扫描从该键对应的位置开始，并校验 documentVersion。
5. fast-forward 也要受时间预算限制，且不能把仅计算状态的行算成已经提交给 Monaco 的 token 覆盖。

### 回归测试与完成条件

分别从文首、文中、文末开始；收集所有 batch 的行号并断言最终无任何空洞。中途滚到前缀不能永远缺少颜色。在第 256 行放 <%、后续放 Java 和 %>；先顺序扫描建 checkpoint，再从 256 行重扫，结果必须与无缓存全扫相同。增加 255/256/257 和多文档公平性测试。

## KAIRO-W07 — JSP 整页诊断和分块诊断相互覆盖

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/jsp-extension/src/browser/jsp-scriptlet-diagnostics.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/jsp-extension/src/browser/jsp-scriptlet-diagnostics.ts)

### 代码证据与影响

定位：runDiagnostics，以及 client.onDiagnostics 回调。

runDiagnostics 在成功同步整页虚拟 Java 后，仍为每个 Java block 同步独立虚拟文档。收到 page 诊断与 block 诊断时，两条分支都用 setModelMarkers(model, 'jsp-scriptlet-java', markers) 替换同一个集合。

因此最后收到哪个虚拟文档的结果，界面就只保留哪一份。合法跨 scriptlet 共享变量在孤立分块文档中可能被误报；后到的空诊断也能清掉整页真实错误。这不只是多跑了一些请求，而是结果正确性受消息顺序影响。

### 具体实现任务

1. 将整页模型作为主诊断来源。整页成功时不要继续创建用于诊断的分块文档，并关闭旧模式残留文档。
2. 确实需要 fallback 时才切换到分块模式。建立 activeDiagnosticMode 和虚拟文档白名单；不同模式的迟到通知不能写回当前模型。
3. fallback 的 block 结果保存在 Map<virtualUri, diagnostics>，按当前文档版本聚合后一次设置 markers，不能每来一块就覆盖整页集合。
4. 让虚拟 Java 文本、sourceMap、模型版本和文档代次属于同一快照。LSP 有 version 时校验 version；没有 version 时用受控的虚拟文档代次/URI 轮次区分旧结果，不能简单将当前 seq 标签贴到旧 notification 上。
5. include 接通后，按 mapped sourceUri 投递诊断，不能把被包含文件的行号直接画到主 JSP 上。

### 回归测试与完成条件

主 JSP 使用两个 scriptlet：第一个声明 x，第二个 out.println(x)。整页分析后不能被孤立块的 x 未定义覆盖。两个位置各有一个真实错误时两者必须同时保留。把 page/block 通知顺序反转、插入旧版本空诊断，最终集合应不变。

## KAIRO-W08 — 静态 include 在真实调用中未解析，且模型展开顺序错误

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/jsp-extension/src/browser/jsp-page-model.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/jsp-extension/src/browser/jsp-page-model.ts)
- [`packages/jsp-extension/src/browser/jsp-scriptlet-java-completion.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/jsp-extension/src/browser/jsp-scriptlet-java-completion.ts)
- [`packages/jsp-extension/src/browser/jsp-scriptlet-diagnostics.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/jsp-extension/src/browser/jsp-scriptlet-diagnostics.ts)

### 代码证据与影响

定位：buildPageVirtualJava / resolveIncludeTree，以及补全和诊断对 builder 的调用。

builder 支持可选 resolver，但当前补全和诊断调用仅传 URI/content，没有提供 resolver；静态 include 中的声明、imports 与方法未进入这两条真实语义链路。

即使提供 resolver，resolveIncludeTree 返回 root 优先的 pages 列表；构建方法体时遍历“每页的所有 bodyBlocks”，会先输出主文件所有 scriptlet，再输出 include 的块，而不是在 include directive 所在位置展开。代码虽然记录 startOffset，却没有用它重建顺序。

### 具体实现任务

1. 引入共享 JspPageModelService，由补全和诊断共同使用。通过 Theia FileService/现有编码服务和打开文档缓冲读取 include；优先未保存 buffer，并保留真实 URI、版本和 GBK 解码语义。
2. 相对路径以当前包含文件为基准；以 / 开头的 JSP include 以 Web 根目录为基准，不以操作系统文件系统根目录为基准。统一路径授权并限制在项目允许范围。
3. 把 scriptlet、expression、include 等形成按源 offset 排序的事件流。在 include 的位置递归插入子流，保留 occurrenceId/sourceUri/sourceRange；不要简单按 pages 列表拼接。
4. 循环检测用当前递归栈，避免全局去重误吞合法重复 include。重复包含要保留独立 occurrence。设置深度/总规模保护并给出诊断，而非无限展开。
5. 建立 include 依赖图与版本化缓存；被包含文件变化使依赖页失效。并发补全、诊断共享同一页构建结果，避免重复整页解析。

### 回归测试与完成条件

主文件先 include vars.jspf 再使用其中变量：生成 Java 的声明必须早于使用。测试 include 位于两个 scriptlet 中间、父块打开大括号而 include 内继续执行的顺序、嵌套/重复/循环 include。通过实际 provider 调用验证 resolver 已接线，而不只直接测试 builder。覆盖 GBK 与未保存 include。

## KAIRO-W09 — SourceMap 的 offset 使用平均长度估算，表达式后偏移累计漂移

**优先级：P2**

### 具体位置与固定版本源码

- [`packages/jsp-extension/src/browser/jsp-sourcemap.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/jsp-extension/src/browser/jsp-sourcemap.ts)
- [`packages/jsp-extension/src/browser/jsp-page-model.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/jsp-extension/src/browser/jsp-page-model.ts)

### 代码证据与影响

定位：mapJspPositionToVirtual / mapVirtualPositionToJsp，以及表达式分支 emitLine 后追加分号。

多行 offset 使用 span 总长度乘行号比例来估算，不是实际行起始偏移。即使行/列正确，offset 也可能指向另一个字符。例如三行 a、1234567890、z 的文本，第 2 行起点实际 offset=2；对覆盖这三行的零缩进 span 做平均分配却会得到 7。

builder 又在 emitLine 统计 currentOffset 后直接给最后一行追加 ';'，没有补计 offset；后续每经过一个表达式都可能再差一个字符。表达式的合成前缀还可能被映射为 inUserCode=true。

影响边界：当前已读的补全、诊断主要消费 line/character，所以不能据此声称已经发生批量重构写坏文件；但 offset API 已明确不精确，并有合成区误映射问题。

### 具体实现任务

1. 为原始各 sourceUri 文本和最终 virtualJava 建立精确 UTF-16 lineStarts；offsetAt(line, character) = lineStarts[line] + character，经范围验证后使用。删除按平均长度插值的逻辑。
2. 生成器使用统一 append/emit API 统计字符；生成后可依据实际最终文本再建立索引，避免后续字符串修补遗漏 currentOffset。不要通过双向都采用同一种错误估算来伪造 round-trip 正确。
3. 映射分段明确区分用户文本、缩进、表达式包装前后缀和合成声明。合成区返回 null 或 inUserCode=false，不把位置 clamp 到第一个用户字符。
4. 清理表达式尾部空白/换行时同步更新映射范围；处理 CRLF、中文、emoji，offset 以 JS/Monaco 的 UTF-16 单元为准，不改用 UTF-8 字节。
5. 位置查询与编辑范围采用明确边界策略；多个 include occurrence 使用上下文消除歧义。

### 回归测试与完成条件

不同长度的多行内容中，断言 mapped.offset 等于实际目标模型的 getOffsetAt(mapped.position)。测试连续两个 expression 之后的 scriptlet、CRLF/emoji、尾部空白清理和合成前缀。不只断言往返后的行/列相同。

## KAIRO-W10 — 搜索连接中断被判定完成，旧 socket 关闭会清空新 socket 引用

**优先级：P1**

### 具体位置与固定版本源码

- [`packages/search-extension/src/browser/search-stream-service.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/search-extension/src/browser/search-stream-service.ts)
- [`packages/search-extension/src/browser/search-session-model.ts`](https://github.com/Qioooba/kairo-ide/blob/1893e1685640afe5a4c3c2665009a4b97f1ac793/packages/search-extension/src/browser/search-session-model.ts)

### 代码证据与影响

定位：SearchStreamService.searchStream 的 close handler 和 finish；SessionModel 的 done 分支。

close handler 只要发现当前状态还是 streaming，就切成 done 并 resolve，不要求收到后端 event.done。连接异常中断或服务端提前关闭时，已有部分结果会被展示成正常结束。

同一个 close handler 在检查 signal.aborted 之前先执行 this.ws = null。查询 A 取消后立即启动 B，A 的 close 异步到达时就能清空 B 的 socket 引用；后续取消 B 的资源控制会受影响。

### 具体实现任务

1. 每次查询创建独立的 StreamSession：generation、socket、abort、timers、terminalReceived、settled。事件回调先验证 session 身份，再读写共享状态。
2. 只有明确收到协议 done 才能进入完整成功。close 在 done 前发生时应为 interrupted/error；保留已收到结果，但显示“搜索中断，结果不完整”。正常取消与异常中断应区分。
3. cleanup/finish 只能结算一次；只清理属于本 session 的资源。清除 this.ws 时必须检查 this.ws === ws，旧 A 回调不得影响 B。
4. 终结前刷新累计 buffer 的真实数量和 revision。全部替换等操作必须知道结果是否完整，不能把半份结果作为完整搜索集合静默使用。
5.保留现有可变结果 buffer、120ms 通知合并和虚拟列表，不退回每批复制全部数组或渲染全部 DOM 的方式。

### 回归测试与完成条件

收到一批结果后在 done 前触发 close：界面应为中断而非完成。A 取消→B 建立→A close：B 的引用、计时器和 Promise 不变，B 仍可取消。done 后 close 不得重复结算。无结果完成、显式截断、服务器报错和用户取消都需独立断言。


## 推荐实现顺序

先为 HotSwap 补齐项目/目标一致性拒绝和测试，同时保留自动 HotSwap 默认关闭；然后修复高亮文本镜像、协议、真实 Worker、词法状态和完整覆盖；再统一 JSP 诊断/include/SourceMap；最后修复搜索生命周期并完成全链路回归。CI 恢复与每项回归测试贯穿所有阶段，不等到最后才补。

高亮 W02–W06 是一条相互依赖的链路。不要只把分词类移进 Worker 就宣布完成，也不要只修颜色而继续给新版本应用旧内容。允许分 PR，但只有整条链路通过集成验收后才默认启用替代 provider。

## 可以直接采用的结构设计（设计建议，不是已编译补丁）

```ts
interface HighlightSessionIdentity {
  instanceId: string;        // 每个模型生命周期唯一，不直接使用 URI
  uri: string;
  documentVersion: number;
  languageGeneration: number;
}

interface LogicalToken {
  endOffset: number;         // UTF-16 偏移；内部词法层使用的结束位置
  scope: string;             // 不直接用自定义整数当 Monaco metadata
}

interface ImmutablePageSnapshot {
  rootUri: string;
  rootVersion: number;
  generation: number;
  virtualUri: string;
  virtualJava: string;
  dependencyVersions: ReadonlyMap<string, number | string>;
  // sourceMap 与上面文本、版本、依赖必须属于同一个构建快照
}
```

### 高亮编辑实现的关键约束

输入差量的 offset 基于编辑前文本；同一次 Monaco change event 的非重叠 edits 才按旧 offset 降序应用。保留 CRLF 原始长度。应用成功后才推进版本；失败则发起 snapshot 重同步。旧文档/旧语言/旧版本 batch 在进入 Monaco 之前丢弃。

### 主题与 token 协议参考

[Monaco 官方 IEncodedLineTokens](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.languages.IEncodedLineTokens.html) 明确 provider 使用 startIndex/metadata。本项目锁定的依赖版本是 1.108.201；实现者须同时核对其内部后台 token store 合同，不可把公共 provider 格式与内部结束偏移格式混为一谈。

## 测试门禁与执行记录

先阅读各包当前测试脚本和 mock/register hook。新增测试要调用实现或真实组件，不用源码字符串匹配代替行为验证。具体推荐命令如下；本审计没有执行这些命令，也不保证当前版本可通过：

```sh
pnpm install --frozen-lockfile
pnpm build:packages
pnpm typecheck
pnpm lint
pnpm -r --filter './packages/*' test
node --test tests/highlighting/*.test.cjs

# 在 runtime-agent 目录执行：
go test -race -count=1 -timeout 285s ./...
```

实际 Monaco 集成、真实 Worker 与 Electron 资源加载必须另有浏览器/桌面测试；纯 Node 的数组测试不代替上屏验证。新增测试路径须显式接入必跑 CI，不依赖开发者手动运行一个散落的文件。

验收数据覆盖 Windows 路径/空格/盘符大小写、GBK 文件及未保存编辑、CRLF、中文/emoji、JDK 1.6 业务工具链、Tomcat 6、上万文件工程、超长行。JDT-LS 的宿主 Java 与业务编译/运行 JDK 分离，不为了修复本次问题把业务项目升级到新 JDK。

建议记录：首次打开/回到前缀/连续编辑时的高亮覆盖，主线程长任务、输入延迟、CPU、内存、Worker 排队与取消耗时，以及 JSP 构建依赖失效次数。这些是待测项目，不是现有性能测试成绩。

## 不要倒退的已有修复

当前 JavaHotSwapService 已有冻结上下文、按目标串行、保存版本淘汰、默认关闭、结构变化拒绝及 DAP 连接保护；保留这些基础，在其上补项目/目标一致性。

当前 jdt-ls-manager.ts 已将 stdout 留给 JSON-RPC reader，并且默认异常恢复只清 JDT core 索引，整份 LS 工作区重置需显式强制选项；本报告没有把历史的“默认删除整个工作区”再次列为当前缺陷。

当前搜索已有可变累积 buffer、通知合并及 VirtualList；本报告没有把“缺少虚拟列表”列为缺陷。修复生命周期时不要取消这些性能措施。

## 给实现 AI 的总指令

请在 Qioooba/kairo-ide 工作分支基于实际 HEAD 实现 KAIRO-W01 至 W10。先用本报告的固定 SHA/函数核对差异，已修复项必须给出真实证据，仍存在的项先补失败测试再修改生产代码。

保持 Theia + Monaco + JDT-LS + Go Agent 的架构，保持 JDK 1.6/JSP/Servlet/GBK/CRLF 兼容。不要通过禁用必要功能、删测试、提高超时、设置无限阈值、吞异常、返回伪成功或只更新文档来“修复”。不能为了匹配测试写另一套与生产脱节的模拟实现。

分阶段交付，每阶段报告：修改文件/函数、修复的编号、根因如何消除、实际命令及结果、失败/跳过原因、浏览器/桌面截图或日志、兼容性和残留风险。说明每项是源码确认、自动化测试通过还是实际桌面/JVM 验证通过。没有运行的测试不得写通过。

完成标准：编辑后的 token 与文本版本一致；Monaco 协议和主题正确；真实后台处理且整文档无覆盖空洞；JSP 只有一致的诊断来源、include 顺序正确、映射精确；HotSwap 不跨项目目标；搜索中断不冒充成功；对应 CI 真正运行并有可追踪结果。
