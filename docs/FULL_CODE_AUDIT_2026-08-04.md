# Kairo IDE 全量代码审查报告（2026-08-04）

> 面向对象：**负责修复与测试的 AI/工程师**。
> 目的：本文档是一次覆盖前端样式、前端逻辑、后端逻辑、业务/操作/用户流程的**全量代码审查**结果，逐条给出 `文件:行号`、问题、修复建议、验证方法，可直接据此建立修复工单并回归测试。
> 审查方式：6 个并行审查代理逐文件真实阅读源码（不是只看文件名），关键跨板块结论已由主审二次核实。
> 审查范围：`runtime-agent/`（Go 后端）、`packages/theia-product/`、`packages/java-extension/` + `packages/jsp-extension/`、构建/部署/Tomcat/项目/编码/协议七包、git/svn/search/sql/test/remote/plugin/i18n/ui-kit 十包、`apps/desktop` + `apps/browser` + 工程化脚本/CI。

---

## 0. 如何使用本文档

1. **严重级别定义**
   - **P0**：安全漏洞、数据丢失/损坏、必现崩溃、核心功能事实不可用。**必须最先修**。
   - **P1**：明显功能错误、业务逻辑缺陷、前后端契约破裂、状态机漏洞。
   - **P2**：边界情况、竞态、资源泄漏、UX 缺陷、平台兼容。
   - **P3**：代码质量、死代码、重复代码、i18n 硬编码、样式适配、工程化卫生。

2. **编号规则**：`区块代号-级别序号`。区块代号：
   - `GO` = Go 后端 runtime-agent
   - `TP` = theia-product 前端核心包
   - `JV` = java-extension / jsp-extension
   - `BD` = 构建/部署/Tomcat/项目/编码/协议七包
   - `VC` = git/svn/search/sql/test/remote/plugin/i18n/ui-kit 十包
   - `DK` = desktop/browser/工程化

3. **修复顺序建议**：先做第 1 节「跨板块系统性问题」（一次修复消除一整类 bug），再按区块处理 P0 → P1 → P2 → P3。

4. **验证前提**：修复后请务必执行对应「验证方法」；Go 侧统一加 `go test -race`，前端补端到端冒烟（当前大量“类型/单测通过但集成跑不通”的功能，正是缺集成验收所致）。

---

## 1. 跨板块系统性问题（最高优先，多个独立审查一致命中）

这些问题横跨多个包/语言，是本项目**风险最集中**的地方。逐个根治比逐条打补丁更有效。

### S1. Agent 会话密钥在至少 4 处泄露（本地提权 → 完整 RCE）
整个 agent 的安全模型押在“loopback 绑定 + 单一会话 secret”上，但该 secret 在以下位置全部可被同机其他用户或一次 XSS 获取，拿到后即可调用构建/部署/起 Tomcat/跑 javac 等本机命令执行接口：
- **GO-P0-1** `runtime-agent/cmd/kairo-runtime/main.go:39-51` — `agent-state.json` 以 `0o644` 明文落盘。
- **DK-P0-1** `apps/desktop/src/main.ts:352-358` — 通过 `--secret <hex>` 命令行参数传子进程，`tasklist /v` 可读。
- **TP-P0-3 / DK-P0-2** `packages/theia-product/src/main/node/kairo-agent-config-contribution.ts:30-33` — **无鉴权** GET `/kairo-agent-config.json` 直接返回 `agentSecret`（已核实）。
- **DK-P0-4** `apps/desktop/src/preload.ts:47-49` 与上面同文件 `:47-50` — 密钥被挂到 `window.kairoConfig.agentSecret`（主世界任意脚本可读，已核实）。

**统一修复方向**：secret 只走内存/一次性 token；state 文件权限 0600 且不含 secret；命令行改用 env/stdin 传递；配置端点只返回 `agentUrl` 不返回 secret；`window` 上不暴露明文密钥。修好后全链路回归：`Get-CimInstance Win32_Process | ? Name -eq kairo-runtime.exe | % CommandLine` 不含 secret；`curl /kairo-agent-config.json` 无 secret；DevTools `window.kairoConfig` 无 secret；`stat agent-state.json` 权限 0600。

### S2. TS↔Go 前后端契约漂移（类型说有、后端说无 / 参数丢失）
`@kairo/protocol` 只有 TS 类型、没有运行时校验，也没有承诺过的 TS↔Go 结构对拍脚本，导致成片“看起来能用实则跑不通”：
- **BD-P0-3** Maven 视图裸 `fetch('/api/v1/maven/detect', {rootPath:'.'})`（已核实）——错误 origin、缺 `X-Kairo-Secret`、无 envelope、相对路径。
- **JV-P1-7** `maven-service.ts` 三个请求把参数包成 `{body:{...}}`，agent 收不到 `rootPath`。
- **BD-P1-3** GET `/servers/{id}/logs` 的 `tail`/`since` 从未转 query，恒 tail=0。
- **BD-P1-4 / JV-P1-13** protocol 声明了 Go 未实现的 `/jdtls/distribution`、`/jvm/compile`、`/jvm/redefine`，调用即 404（热替换链路直接断）。
- **BD-P0-4** 热部署前端判 `state==='completed'/'failed'`，而 Go 只返回 `queued/success/failure` → 永远误判成功。
- **BD-P2-14** `EncodingRecodeRequest.eol` 被 Go 静默忽略。

**统一修复方向**：新增 CI 测试把 `EndpointMap` 与 Go 路由表/DTO 对拍；`RuntimeConnectionService.request()` 对 GET+payload 显式报错或自动转 query；所有前端请求统一走 `runtime.request(...)`（禁止裸 `fetch`）。

### S3. 编码 id 三套值域混乱（GBK 卖点被内部瓦解）
Kairo id（`utf-8`/`gbk`）、Theia id（`utf8`/`utf8bom`/`iso88591`）、Go 别名三套值域在缓存、比较、wire 请求间随意穿梭：
- **BD-P0-1** `utf-8-bom` 被 `normalizeEncodingLabel` 映射成 `utf-8`，保存静默丢 BOM。
- **BD-P1-6/7/8** Convert/Reopen 用错 id、缓存键值域混乱且永不失效、“Already using X”判等恒假。
- **BD-P1-9/10** 目录级 override 命中“注册顺序优先”而非“最深路径优先”，且 Disposable 被丢弃永久残留。
- **BD-P2-10** Go `memEncoder` 的 `fileEncoding` map 无锁并发写 → panic 击落 agent。

**统一修复方向**：建立单一 `EncodingIdent` 规范化模块（显式 Kairo↔Theia↔Go 转换），所有边界强制过这一层；registry 提供“按项目可释放的 override 句柄”；Go 端 map 加锁。

### S4. 英文 locale 假设 + Windows 路径/URI 处理错误（目标平台正确性）
产品目标是 Windows + 中文遗留项目，但大量解析/路径逻辑按英文 locale 和 POSIX 写：
- **VC-P1-1** Windows 下 `file://` 前缀处理错误 → git 文件状态角标、blame 装饰**整平台失效**。
- **VC-P1-2** git status porcelain 未处理 `core.quotepath` 八进制转义 → 中文/空格文件名状态全丢。
- **VC-P2-6** cherry-pick 冲突判定、svn/ git 修订号与变更数解析全依赖英文输出。
- **JV-P1-5** `pathToFileUri` 不做百分号编码 → 含空格/中文路径的 rootUri 非法，JDT LS 起不来。
- **JV-P1-6** 诊断按 URI 字符串反查 model，盘符大小写/编码不一致 → Windows 上 Java 诊断不显示。
- **BD-P0-6** `btoa(中文路径)` 抛异常 → 离线打开中文项目兜底失效。
- **BD-P2-12** `.kairo/project.yaml` 恒按 UTF-8 解码 → GBK 写入的中文 name 乱码。

**统一修复方向**：所有路径统一 `FileUri.fsPath` / `vscode-uri`；子进程执行强制 `LANG=C`/机读格式（`--xml`、`-z`、`--porcelain`）；`btoa` 前 `encodeURIComponent`。

### S5. 大量“半成品/未接线”死代码（误导维护者，掩盖真实边界）
多处功能“代码存在、UI 挂在菜单、实际是死的”：
- **GO-P3-1/2/3** 整个 `internal/remote/` 包、`APIHandler`/`app` 用例层、RBAC/SSO 均未接线（真正在跑的只有 `server.go:routes()` + `NewMemoryServices`）。
- **BD-P1-15** `tomcat-extension` node 端 ~550 行 `TomcatManager/TomcatRegistry` 无 DI 绑定。
- **BD-P1-18** `BuildMarkerAdapter` 绑定但从未实例化 → 诊断进不了 Problems 面板。
- **BD-P0-5** Custom Build Runner 永远停在 running。
- **JV-P1-16** “多模块调试”是纯 mock。
- **JV-P2-17** `KairoJavaLanguageClientContribution` 整类死代码且配置与真实来源矛盾。
- **TP-P2-5** debug module-selector / hotswap-status / console stdout 是空壳面板。

**统一修复方向**：逐一决定“接完 or 删除”，二者必选其一；被删除前不得出现在菜单/键位/协议里。

### S6. i18n 全面失控（面向中文用户，关键错误提示却是英文/中英混杂）
视图层大多接了 `KairoI18nService`，但服务层几乎全是硬编码，且中英文混在同一交互路径：
- **BD-P3-9** `hot-deploy-service.ts`、`encoding-commands.ts`、`safe-encoding-service.ts` 等服务层全英文（含编码保存被拒的关键提示）。
- **JV-P2-16** 同一路径中文补全 detail vs 英文模板、中文命令名 vs 英文命令名混杂。
- **TP-P3-6** `kairo-views-contribution.ts:804` 中文错误 + `:825` 英文错误；`kairo-problems-widget.tsx:517` 构造函数 `title.label='问题'` 首帧闪中文。
- 注：**VC 区块的 `packages/i18n`（en.ts / zh-CN.ts）本身质量很高**，经脚本比对各 2157 键、零差集、零占位符错位。问题在“调用方没走 i18n”，不在词表本身。

**统一修复方向**：服务层注入 i18n；`i18n.t(key as any)` 改强类型 key（让拼写错误在编译期暴露）。

---

## 2. Go 后端 runtime-agent（区块 GO，41 项）
> 详见审查代理 [Go 后端审查](89b19b6c-20bc-4494-ad05-8146cda05a99)。全部含代码证据。

### P0
- **GO-P0-1** `cmd/kairo-runtime/main.go:39-51`（安全）：`agent-state.json` 以 `0o644` 写入含 `Secret` 明文，同机任意用户可读 → 本地提权/RCE。修复：`0o600` 且用 `OpenFile` 避免先建 0644 再 chmod 的竞态。验证：`stat` 权限=600；单测断言 `FileMode().Perm()==0o600`。见 S1。
- **GO-P0-2** `internal/transport/events/eventhub.go:212-227` 发送 与 `:158-171` `close(ch)`（并发/崩溃）：`Publish` 锁外发送、`unsubscribe` 锁内 `close(ch)`，并发触发 `send on closed channel` panic，且不在 HTTP recover 覆盖内 → 整个 agent 崩溃。修复：每订阅者用 `done chan` + `select`，订阅者只关 `done` 绝不关数据 channel。验证：多订阅者持续 Publish + 随机 unsubscribe，`-race` 无 panic。
- **GO-P0-3** `internal/api/server.go:344-353`（同 `search_events.go:24-31`、`transport/events/websocket.go:36-44`）（安全/CORS）：Origin 用 `HasPrefix` → `http://localhost.evil.com` 被判可信并回显 `Allow-Credentials:true`；WS 还放行 `origin==""`。修复：`url.Parse` 后精确比对 `Hostname()`，三处统一。验证：单测 `isSafeOrigin("http://localhost.evil.com")==false`。

### P1
- **GO-P1-1** `internal/services/launch_orchestrator.go:205,258`（业务/路径）：把已解析的**绝对**artifact 路径传给只接受相对路径的 `pathpolicy.ResolveWithin` → 任何 `beforeLaunchTasks=[deploy]` 的运行配置 100% 失败。修复：改用绝对路径校验（`filepath.Rel`+前缀）。验证：含 before-launch deploy 的运行配置能编排成功。
- **GO-P1-2** `internal/api/sql_handler.go:118-152`（业务/契约）：硬编码 placeholder 凭据、忽略 `connectionId`、恒返回空结果；`writeOK` 双层 envelope 嵌套。修复：明确 501 或落地真实连接；修正 envelope。验证：响应单层 envelope；无驱动返回明确错误码。
- **GO-P1-3** `internal/services/config.go:64-86` + `internal/api/build_handlers.go:43-46`（装配缺失）：`NewMemoryServices` 从不设 `CustomBuild` → `/build/custom` 永远 500。修复：注入或删路由。验证：POST `/build/custom` 非 500。
- **GO-P1-4** `internal/services/config.go:64-86` + `internal/api/debug_handlers.go:48-51,64-67`（装配缺失）：`JDKManager` 未注入 → `/debug/adapter/status`、`/debug/jdk/download` 永远 500。修复：注入 `jdkmanager.New`。验证：返回真实 JDK 状态。
- **GO-P1-5** `internal/services/server.go:397-405,296-308,448-455,533-537`（data race）：`realServerRunner` 在获取 `r.mu` 前修改共享 `*serverMeta` 字段，与持锁的 `Get/List` 竞争。修复：所有 `m.*` 写入放进临界区。验证：`go test -race` 并发 Restart+List。
- **GO-P1-6** `internal/api/search_events.go:109-124`（安全/授权不一致）：流式搜索直接调 `search.SearchStreaming` 绕过 sandbox，可读工作区外任意目录。修复：加 `sandbox.AuthorizeReadAbs`。验证：工作区外 rootPath 返回 `ErrPathForbidden`。

### P2
- **GO-P2-1** `internal/api/rate_limiter.go:115-125`（限流）：优先信任客户端 `X-Forwarded-For` 作为 key，可伪造绕过。修复：loopback 用 `RemoteAddr`。
- **GO-P2-2** `handlers.go:281,1749,1776,1812`、`java_run_handlers.go:90-95`、`build_handlers.go:30-37`（路径遍历/命令执行）：接受 `rootPath` 的端点仅 `filepath.Abs`，不校验是否在授权工作区；`/maven/run` 会优先执行 `rootPath/mvnw` → 任意代码执行。修复：统一过 sandbox；maven task 对白名单校验。
- **GO-P2-3** `internal/jdkmanager/download.go:483-489`（归档解压）：tar 符号链接 `Linkname` 未校验 → 符号链接逃逸。修复：校验目标在 destDir 内或跳过 symlink。
- **GO-P2-4** `internal/build/custom_executor.go:56-58,122-148`（并发/输出丢失）：`cmd.Wait()` 与 pipe 读取竞争致输出截断；handler 回调在锁内 → 潜在死锁。修复：`WaitGroup` 等读完再 Wait；回调移出锁。
- **GO-P2-5** `internal/sql/oracle.go:590-634`（SQL 注入潜在）：`escapeParamValue` 字符串拼接转义。修复：改预处理绑定变量。
- **GO-P2-6** `internal/debug/multi_vm_orchestrator.go:166-176,180-190`（并发）：`SuspendAll/ResumeAll` 持 `RLock` 却写 `session.State`；且为空实现。修复：改 `Lock()`；补齐或移除。
- **GO-P2-7** `internal/api/server.go:169,177-186`（goroutine 泄漏）：`SetRateLimit(0)` 置 nil 前未 `Stop()` 旧限流器 → 清理 goroutine 泄漏。修复：置 nil 前 Stop。
- **GO-P2-8** `internal/services/auth.go:51-99`（认证）：空密码哈希接受任意密码、无凭据接受任意登录、sessionToken 从不校验、`Logout` 空操作；`KAIRO_SECRET` vs `KAIRO_LOCAL_SECRET` 命名不一致。修复：未配置应拒绝；落地会话校验；统一命名。
- **GO-P2-9** `internal/transport/events/eventhub.go:132-143`（事件顺序）：历史 replay 与实时 Publish 无序，`afterSequence` 续传语义被破坏。修复：串行化 replay 与实时。
- **GO-P2-10** `internal/services/server.go:190-212`（资源泄漏）：`tomcat6.Start` 失败后 `runtime/<id>` 目录不清理。修复：失败 `RemoveAll(base)`。
- **GO-P2-11** `internal/services/deploy.go:100-103,140-142`（增长）：`diskDeployer.items` 只增不减。修复：比照构建历史裁剪。

### P3
- **GO-P3-1** 整个 `internal/remote/` 包不可达（`main.go:196-199` 拒绝非 loopback），却含 `docker/podman exec/cp/build` 等高权限逻辑。建议删除或 build tag 隔离。见 S5。
- **GO-P3-2** `internal/api/api_handler.go` 类型化边界 + `internal/app/*` 用例 + `security.RBACManager/sso/retention` 全未接线，存在两套 HTTP 层只跑一套。
- **GO-P3-3** `internal/transport/events/websocket.go:190-192` `ServeWSCompat` 是无认证 WS 处理器（仅测试引用），且鉴权子协议方案与生产 `kairo-secret-v1` 不一致。建议删除。
- **GO-P3-4** `internal/debug/jdwp.go:26-28` `cmdSetMethod=9`（应为 6）且与 `cmdSetObjectReference=9` 重复。修复：`cmdSetMethod=6` 或删未用常量。
- **GO-P3-5** `internal/api/java_run_handlers.go:541-551` `init()` 永久 ticker goroutine + `:214,230` 调试端口硬编码 `18400`。修复：缓存加 TTL、端口动态分配。
- **GO-P3-6** `internal/config/config.go:46,168-172,255-257` `RequireAuth` 定义但从不生效（中间件只看 `secret!=""`）。
- **GO-P3-7** `internal/api/port_diagnostics.go:65-210` 依赖 `lsof/ss/netstat/tasklist` 文本解析脆弱；`:29-32` vs `:223` 端口范围文案与逻辑不一致。
- **GO-P3-8** `internal/services/server.go:358` `IsPortBound` 探测与真正绑定间 TOCTOU 竞态。建议以绑定失败重试为准。

**架构评价**：分层意图清晰（domain/repository/app/api/bootstrap + pathpolicy/security 双原语 + 带身份校验的 proc），局部质量高；但存在“双实现、半接线”系统性问题——实际只跑 `server.go:routes()` + `NewMemoryServices` 一条通路，`app`/`APIHandler`/`remote`/RBAC/SSO 大量正统架构代码从未接线。安全模型几乎全押在“loopback + 单一 secret”，一旦 secret 0644 落盘即被本地攻破成完整 RCE；sandbox 授权只在部分端点生效。并发与“最后一公里接线”是主要可靠性风险（EventHub panic、server data race、三个端点漏装配、orchestrator 绝对路径喂相对校验器）。

---

## 3. theia-product 前端核心包（区块 TP，43 项）
> 详见审查代理 [theia-product 审查](6b917499-5878-4592-9eeb-37bc34e03731)。

### P0
- **TP-P0-1** `debug-toolbar-widget.tsx:263`（配 `setState` 360-364、`init` 235）（必现崩溃）：覆写 `update()` 调 `setState()`，`setState()` 末尾又调 `update()`，无终止条件 → 打开即栈溢出，且从不 `super.update()`。修复：状态计算改名 `refreshFromSession()`，`setState` 内调 `super.update()`，不覆写 `update()`。验证：打开工具栏面板不崩、按钮 disabled 随 paused/running 变化。
- **TP-P0-2** `kairo-editor-contribution.ts:389-398`（配 `onCloseRequest` 94-100）（数据丢失）：外部修改冲突对话框 “Keep” 分支执行 `revert()` 丢弃未保存修改，Esc 默认也走 keep。修复：“Keep” 只更新 mtime；新增 “Reload from Disk” 承担 revert；`onCloseRequest` 默认 no-op。验证：改动不保存 → 外部改同文件 → Esc/Keep 都保留用户版本。
- **TP-P0-3** `kairo-agent-config-contribution.ts:30-33`（安全）：无鉴权返回 `agentSecret`（已核实）。见 S1。

### P1
- **TP-P1-1** `kairo-debug-session-service.ts:244`（DAP 契约）：`scopes` 请求传了 `threadId` 而非 `frameId` → 变量面板取错帧。修复：用 `session.currentFrame?.raw?.id`。
- **TP-P1-2** `kairo-debug-session-service.ts:409-423`（断点同步）：Run to Cursor 用 `setBreakpoints` 全量替换清掉既有断点，命中后不恢复。修复：发 `[...原断点, 临时行]`，命中后恢复。
- **TP-P1-3** `debug-callstack-widget.tsx:198-200`（同 `debug-variables-widget.tsx:220-222`）（状态错误）：只监听 stop/destroy 不监听 resume，Continue 后仍显示过期栈/变量。修复：订阅 `onDidChangeState` + `isSuspended`。
- **TP-P1-4** `debug-callstack-widget.tsx:269-278`（业务/不可变性）：`selectFrame` 原地 mutate 且不真正切帧。修复：调切帧 API + 不可变更新。
- **TP-P1-5** `kairo-java-debug-service.ts:50-62`（状态机）：用 `onDidStopDebugSession` 当暂停 + 魔数 `===2` 判 Running。修复：用 DAP `stopped/continued` + 常量。
- **TP-P1-6** `kairo-run-configuration-service.ts:221-224`（承诺未兑现）：`saveAll()` 空实现，debug 前不保存 → 构建旧代码、断点错位。修复：`core.saveAll`。
- **TP-P1-7** `kairo-views-contribution.ts:1150-1163`（命令映射错误）：Drop Frame 误用 `stepBack`（应 `restartFrame`），JDWP 桥不支持静默失败。修复：改 `restartFrame`，不支持给提示。
- **TP-P1-8** `debug-toolbar-widget.tsx:345-350`（标签不符）：“Restart” 只 stop 不 restart。修复：复用 `sessionService.restart()`。
- **TP-P1-9** `debug-hover-widget.tsx:436`（配 `debug-hover-provider.ts:59,176-191`）（内存泄漏/重复注册）：scroll 监听从不 dispose，provider 每次 hover new 新实例。修复：存 disposable 并释放/复用单实例。
- **TP-P1-10** `kairo-settings-service.ts:74-79`（设置读写）：用 `key in obj` 判覆盖，`null` 值绕过默认。修复：用 `!== undefined`。
- **TP-P1-11** `kairo-settings-service.ts:51-57`（事件数据错误）：`onPreferenceChanged` 恒发 `value: undefined`。修复：`value: e.newValue`。
- **TP-P1-12** `kairo-debug-session-service.ts:270-283`（边界）：`frameId===0` 被当无帧跳过。修复：`=== undefined` 判空。
- **TP-P1-13** `kairo-run-configuration-service.ts:187,257`（状态一致性）：launch 后无条件 `adopt`，attach 失败未撤销 store 条目。修复：失败移除条目/刷新列表。

### P2
- **TP-P2-1** `kairo-perf-sampler.ts:117,360`：状态栏项 `kairo.perf.toggleGraph` 命令未注册，点击报错。
- **TP-P2-2** `kairo-idea-windows-keymap.ts:94-96,116,156`（及 mac）：绑定 `recentLocations`/`lastEditLocation`/`runToCursor`/`copyPath` 等未实现命令；实际注册的是 `recentFiles`，ID 不一致。
- **TP-P2-3** `kairo-idea-windows-keymap.ts:71,149`：两命令绑同 `ctrl+alt+shift+j`，后者覆盖前者。
- **TP-P2-4** `debug-condition-editor-widget.tsx:329-345`：校验用 `length>0` 兜底 → 任意非空串判 valid。
- **TP-P2-5** `debug-module-selector-widget.tsx:176-202`、`debug-hotswap-status-widget.tsx:243-265`：空壳面板（`setModules`/`addEntry` 无调用者）。见 S5。
- **TP-P2-6** `debug-tool-window-widget.tsx:60-70`（Windows 路径）：手拼 `file://${path}`，Windows 打不开。修复：`URI.fromFilePath`。
- **TP-P2-7** `debug-console-widget.tsx:419-421`：`addEntry` 原地 push + 无上限。
- **TP-P2-8** `debug-watches-idea.tsx:196-220,246-291`：stale closure + 直接 mutate 子节点。
- **TP-P2-9** `debug-watches-idea.tsx:174`：watch 存储 key 无工作区维度，切项目串数据；与 `debug-watch-widget.tsx` 各存一份。
- **TP-P2-10** `kairo-problems-widget.tsx:269-292`：window 上无条件抢占 F8/Shift+F8（与调试 stepOver 冲突）；effect 依赖致频繁重绑。
- **TP-P2-11** `kairo-problems-widget.tsx:188-197`：`setInterval 2000` 轮询“是否有编辑器打开”。修复：`onCurrentEditorChanged`。
- **TP-P2-12** `kairo-run-configurations-widget.tsx:297`：删除用 `window.confirm`。修复：Theia `ConfirmDialog`。
- **TP-P2-13** `debug-breakpoints-widget.tsx:300-302`：“Enable/Disable All” 实际切全局静音而非逐条。
- **TP-P2-14** `debug-inline-values.ts:164-183,129-158`：`/(\w+)\s*=/` 误判 `==`/字符串；每次暂停全量扫描到 lineCount。
- **TP-P2-15** `kairo-local-history.ts:109-134,172-180`：快照按文件名前缀 includes 过滤 → `Foo.java` 匹配 `FooBar.java`，cleanup 删错。
- **TP-P2-16** `kairo-local-history.ts:331-374`：`innerHTML=` 拼表 + 重建监听（与全项目 React 风格不一致）。
- **TP-P2-17** `kairo-remote-agent-service.ts:228`：token 放 WebSocket URL 查询串，易入访问日志。
- **TP-P2-18** `debug-hover-widget.tsx:274,193`（及 `debug-variables-idea.tsx:281-315`）：硬编码颜色/Darcula fallback，亮主题对比度差。
- **TP-P2-19** `kairo-status-bar-contribution.ts:504-510,562-573`：server 文本裸空格；`workspaceId:''` 硬塞污染 store。
- **TP-P2-20** `debug-console-widget.tsx`：注释宣称展示 debuggee stdout/stderr，但从不订阅 `output` 事件。

### P3
- **TP-P3-1** `kairo-views-contribution.tsx:742` 等 6 处遗留 `console.log`。
- **TP-P3-2** `debug-callstack-widget.tsx:292-304`（`_mapStackTraceFrame`）等死代码。
- **TP-P3-3** `(session as any).breakpoints`、`i18n.t(key as any)` 遍布 → 绕过类型检查。见 S6。
- **TP-P3-4** `classifyValue/getValueStyle/getIconColor` 三处逐字复制。
- **TP-P3-5** `kairo-upgrade-check.ts:385-392`（伪哈希）：无 `crypto.subtle` 时 `simpleHash` 冒充 SHA-256 用于“完整性校验”。修复：直接判失败。
- **TP-P3-6** i18n 硬编码/中英混杂（见 S6 举例）。
- **TP-P3-7** `debug-collapsible-section.tsx:26-51`：折叠 header 无 `role/aria-expanded`/键盘支持。
- **TP-P3-8** `kairo-telemetry.ts:265-274`：`generateSessionId` 用 `Math.random`，他处已用 `crypto.randomUUID`。
- **TP-P3-9** `kairo-idea-windows-keymap.ts:33-38,53`：浏览器 `ctrl+w` 重映射与 `smartSelect.expand` 绑定重叠。

**架构评价**：围绕 `KairoDebugSessionService` 的集中式状态门面 + IDEA 工具窗是全板块质量最高的一组，`safeContribution`/node 端调试适配器探测显示出对 Theia 1.73 + Inversify 异步坑与安全的深刻理解。但存在**两套并行不对等的调试 UI**（旧独立 widget vs 新 IDEA 工具窗），旧的一套明显缺维护（P0-1 递归、P1-1/3 用错事件/ID），且共享逻辑各自复制、各存一份状态。多个占位面板/未实现命令已挂进菜单键位造成静默失效。安全面 secret 明文下发、remote token 进 URL、伪 SHA 需收口。建议收敛到 IDEA 工具窗单一实现，统一订阅 `onDidChangeState`，摘除占位入口。

---

## 4. java-extension / jsp-extension（区块 JV，46 项）
> 详见审查代理 [Java/JSP 审查](5e9e3516-5fdb-4b11-9a9e-a72577fb621e)。

### P0
- **JV-P0-1** `java-extension/src/node/jdt-ls-manager.ts:872-913`（LSP 生命周期）：任意请求超时默认 `SIGKILL` 整个 JDT LS，叠加 `java-ls-lifecycle.ts:437-443` 的 3 次重启配额 → 大型工程冷索引时语言服务**全程死亡**。修复：请求超时只 reject 该请求（发 `$/cancelRequest`），仅 `initialize` 超时才终止进程。验证：mock LS 对 codeLens 延迟 35s，断言超时后仍 ready 且补全正常。
- **JV-P0-2** `jsp-extension/src/browser/jsp-debug-breakpoint.ts:522-529`（数据丢失）：对真实 `file://…/index.jsp` `createModel('')` 空内容并塞进编辑器，污染 model 注册表，Ctrl+S 可写空。修复：改用 `EditorManager.open`，不 createModel。
- **JV-P0-3** `java-extension/src/browser/java-save-actions.ts:73-129`（文档同步/完整性）：保存时不 `flushPending`，格式化与 organize-imports 两组基于同一旧快照的编辑一次性叠加应用 → 文本损坏；且发生在 save 之后与 format-on-save 语义相反。修复：`onWillSave` 内先 flush，两动作串行。

### P1（JSP 虚拟文档映射链是重灾区）
- **JV-P1-1** `jsp-virtual-java.ts:63-64,95-99`：`expression` 块 trim 后仍用原始偏移映射 → 列偏移错；多行表达式假设单行完全错位。
- **JV-P1-2** `jsp-scriptlet-diagnostics.ts:45-66,241-249`：诊断回映射首行列不加块起始列偏移；expression 前缀 16 列未扣；`:244` 死代码。
- **JV-P1-3** `jsp-java-nav.ts:59-76`：`findJavaBlocks` 把 `<%-- --%>` 注释当 scriptlet；`<%\s*` 吞空白致偏移语义漂移；不跳过字符串内 `%>`。
- **JV-P1-4** `jsp-scriptlet-java-completion.ts:136-142`：`blocks.indexOf(ctx.block)` 跨两次解析对象恒等比较恒 `-1` → 所有块用 `#block0` 虚拟 URI，诊断错位。
- **JV-P1-5** `java-ls-lifecycle.ts:559-564`（URI 编码）：`pathToFileUri` 不编码空格/中文/UNC → rootUri 非法。修复：`URI.file(p).toString()`。见 S4。
- **JV-P1-6** `java-document-sync.ts:52-60`（URI/诊断）：按 URI 字符串反查 model，Windows 盘符大小写/编码不一致 → squiggle 不显示。见 S4。
- **JV-P1-7** `maven-service.ts:167-171,184-188,208-212`（契约）：三请求参数包成 `{body:{...}}`，agent 收不到 rootPath。见 S2。
- **JV-P1-8** `java-junit-runner.ts:501,337-348`（JUnit）：正则漏掉自闭合 `<testcase/>`（=所有通过用例）→ passed 恒 0；`-cp` 用 `:` 分隔符（Windows 应 `;`）、不经 JUnitCore、`target/` Maven 布局、workspaceSymbols('@Test') 查不到。
- **JV-P1-9** `el-expression-provider.ts:245-254`、`jsp-tld-completion.ts:20-29`、`properties-language.ts:114-121`：补全 `range` 恒 `(1,1,1,1)` → 前缀过滤失效/接受项插到文件头。修复：`getWordUntilPosition`。
- **JV-P1-10** `java-live-templates.ts:1003-1031`：`prefix.toLowerCase()` 后与含大写的 `tpl.prefix` 比较 → camelCase 模板永远匹配不到；`:1004` 死条件。
- **JV-P1-11** `java-monaco-registration.ts:233-246`：硬编码 `incomplete:false` 丢弃 JDT `isIncomplete` → 大工程截断列表不再重查。
- **JV-P1-12** `java-language-client.ts:223-252,567-585`：降级路径每次 hover/引用空转 4~7.5s 重试才落 fallback。修复：`rpcFailed` 立即 fallback。
- **JV-P1-13** `jsp-debug-breakpoint.ts:406-441,62,253-276`：命令用 `new` 实例化 DI 服务（注入全空）；映射假设 Tomcat6 生成 `// line N` 注释（不成立）；`split('/')` 处理反斜杠；`fetch('file://')` 失败。见 S2/S5。
- **JV-P1-14** `java-diagnostics-manager.ts:33` + `browser/index.ts:204-207`：自建 `MarkerManager` 实例，Problems 面板读不到；每键击一次 RPC+全文扫描。修复：注入全局 `ProblemManager` + 防抖。
- **JV-P1-15** `xml-dtd-validator.ts:96-110,137-181,54-57`：对每个本地 DTD 引用无条件报“可能不存在”；注释/CDATA 内标签当真；HTML void 表误判 XML；同步 `withTimeout` 摆设 + O(n²) 定位；只 onCreate 验证一次。
- **JV-P1-16** `java-multi-module-debug.ts:384-392,183-194`：纯 mock（`simulateStartup` 后报 running），从不建 JDWP 连接。见 S5。
- **JV-P1-17** `java-monaco-registration.ts:1208-1255`：workspace edit 只应用到已打开 model，未打开文件修改被静默丢弃；资源操作被跳过 → 重构半成品但报成功。修复：走 `MonacoWorkspace.applyBulkEdit`。
- **JV-P1-18** `jdt-ls-manager.ts:268-292`：`-classpath`（被 `-jar` 忽略的死参数）拼 100+ jar 绝对路径 → 可能超 Windows 32767 命令行限制；`_JAVA_OPTIONS:-Dsource.level` 非 JDT 设置。修复：删除。

### P2
- **JV-P2-1** `jsp-scriptlet-java-completion.ts:145-156`、`jsp-scriptlet-diagnostics.ts:112-135`：对同一虚拟 URI 反复 `didOpen`（补全侧从不 didClose）违反 LSP。
- **JV-P2-2** `java-completion-provider.ts:145-158`：补全预算 `Promise.race` 定时器从不清除，5s 后仍打假告警。
- **JV-P2-3** `java-hippie-completion.ts:24-45,116-148`：每次全量扫描所有 model，`excludeUri` 死参数，无焦点改任意编辑器。
- **JV-P2-4** `java-hotswap-service.ts:163-170`：防抖只热替换“最后一个”文件，Save All 其余静默丢弃。
- **JV-P2-5** `jsp-tld-completion.ts:190-208,126-133`：跳过一切名为 `lib` 的目录（含 `WEB-INF/lib`）；只扫 `roots[0]`；缓存永不失效。
- **JV-P2-6** `tld-parser.ts:70-75`：`required/rtexprvalue` 只认 `true` 不认 `yes`（JSP 规范合法）。
- **JV-P2-7** `jsp-navigation.ts:91-99,128-135`：webapp 绝对路径 `/WEB-INF/...` 按当前目录拼接错误；不校验目标存在。
- **JV-P2-8** `jsp-scriptlet-diagnostics.ts:164-192`：只在 `onDidCreateModel` 挂钩，已打开 JSP 无诊断；不处理语言切换。
- **JV-P2-9** `jdt-ls-service.ts:94-103` + `jdt-ls-manager.ts:249-251`：start guard 缺 `starting`，并发第二次 `$start` 抛异常并消耗重启配额。
- **JV-P2-10** `jdt-ls-manager.ts:1036-1049,1060-1084`：`spawnSync` 串行探测 JRE 阻塞事件循环 ~30s；硬编码 `E:\Tools`。
- **JV-P2-11** `java-run-service.ts:172-195`：@Test 独占一行时方法名恒为 "test"，行号指向注解行。
- **JV-P2-12** `kairo-java-debug-breakpoint-contribution.ts:185-187`：hitCondition 校验拒绝纯数字 `5`（DAP 合法）。
- **JV-P2-13** `java-refactoring.ts:147-172`：`extractMethod` 重命名只改声明不改调用点 → 产出不可编译代码（当前是死路径）。
- **JV-P2-14** `el-expression-provider.ts:201-216`：跨行 EL range 产生负列号。
- **JV-P2-15** `java-multi-module-debug.ts:119-124`（实例化即弹全局警告）、`jsp-debug-breakpoint.ts:428-436`（结果只 `console.log`）。
- **JV-P2-16** i18n 中英混杂（见 S6）。
- **JV-P2-17** `java-language-client-contribution.ts` 整类死代码，配置与 `jdt-ls-manager.javaSettings()` 矛盾。见 S5。

### P3
- **JV-P3-1** `java-live-templates.ts:942,950,957,1035,1051,1054` 等每次按键热路径遗留 `console.log`。
- **JV-P3-2** `java-monaco-registration.ts:184-189`、`java-diagnostics-manager.ts:61-72`、`java-document-sync.ts:82-104`：per-model 监听塞进永不收缩的 `this.subs`。
- **JV-P3-3** `java-language-client.ts:29-30`：browser 层直接 import node 模块（把 child_process/fs 拖进前端 bundle）。
- **JV-P3-4** 死代码：`jdt-ls-manager.ts:141-144`、`java-live-templates.ts:79-84`（`$METHOD_NAME$` 垃圾文本）、`_TAGLIB_PREFIX_RE`、`_isWebXml`、`_markers`、`ant-classpath-service.ts:118-124`。
- **JV-P3-5** 重复实现：`adaptHover/adaptRange`、`SRC_ROOTS`+`resolveJavaClass`、`sout/psvm/fori` 片段双份维护。
- **JV-P3-6** `java-live-templates.ts:754-787`：postfix 模板未转义 `$`/`}`。
- **JV-P3-7** `common/lsp-protocol.ts:454-465`：`Buffer.concat` 每次全量拷贝 O(n²)（仅测试用）。
- **JV-P3-8** `java-language-client.ts:675-682`：`dispose` 漏 `onConnectionStatusEmitter`。

**架构评价**：browser→JSON-RPC→backend→JDT LS 分层清晰，monaco-free 可测内核 + 伴生测试的习惯好；但每层自带一套“防御性回退”，叠加后产生最严重的复合故障（超时杀进程 × 重启配额 × 降级后每请求 7.5s × 假回退诊断），错误分类靠 `String(err).includes` 脆弱。JSP 虚拟文档这条最有价值的链路实现最粗糙——映射分散在四个文件、各持不同“块起点”假设，应抽象单一双向 `SourceMap` 作为唯一事实来源。多处功能只做到“代码存在+内部单测通过”而无端到端验收（多模块调试 mock、JUnit 命令 Windows 跑不通、Maven 参数错层、Problems 集成失效、补全 range 全错），应优先偿还 JV-P0-1/P1-5/P1-6 三个让 Windows 真实项目 Java 体验“集体沉默”的债。

---

## 5. 构建/部署/Tomcat/项目/编码/协议七包（区块 BD，48 项）
> 详见审查代理 [构建部署链路审查](839cdd3d-4a44-491a-9bbe-f6486d0b5d8d)。

### P0
- **BD-P0-1** `encoding-extension/src/browser/encoding-utils.ts:26-28` + `encoding-service.ts:289-295`：`utf-8-bom` 被映射成 `utf-8`，保存静默丢 BOM（同文件有正确的 `utf8bom` 映射却没用）。修复：write/read 改用 `toTheiaEncodingId()`。见 S3。
- **BD-P0-2** `encoding-commands.ts:101-113` + `reopen-strategy.ts:62-68`：Reopen 在 dirty 拒绝路径下不回滚已注册 override → 后续 Ctrl+S 静默改变文件编码。修复：`refused-dirty` 时恢复 override，或把 dirty 检查提前。
- **BD-P0-3** `build-extension/src/browser/maven-view-widget.tsx:165-169,205-209`：裸 `fetch` 错误 origin/无鉴权/无 envelope/`rootPath:'.'`（已核实）。见 S2。
- **BD-P0-4** `tomcat-extension/src/browser/hot-deploy-service.ts:174,178,214,217,294` vs `services/build.go:184`：判 `completed/failed`（后端不存在）→ 永远误报成功。见 S2。
- **BD-P0-5** `build-extension/src/browser/kairo-custom-build-runner.tsx:109-117,142-147`：`pollBuildStatus` 是空壳，永远停在 running、无输出/退出码、cancel 不复位。见 S5。
- **BD-P0-6** `runtime-extension/src/browser/workspace-context-service.ts:192-196`：`btoa(中文路径)` 抛异常 → 离线兜底失效。见 S4。

### P1
- **BD-P1-1** `runtime-connection-service.ts:600-607`：WS 切 workspace 只关流不更新 `this.workspaceId` → 仍订阅旧 workspace，新事件全丢。
- **BD-P1-2** `runtime-connection-service.ts:505-556` + `services/build.go:123-223`：POST 默认重试 + Go 无 requestId 去重 → 双份构建/部署/抢端口。修复：这三类端点 `noRetry:true` + Go 幂等缓存。
- **BD-P1-3** `log-viewer-widget.tsx:113` + `runtime-connection-service.ts:516-518`：GET logs 的 `tail/since` 从不转 query，恒 tail=0。见 S2。
- **BD-P1-4** `protocol/src/index.ts:767,795,796` vs `server.go:367-450`：声明了 Go 未实现的 `/jdtls/distribution`、`/jvm/compile`、`/jvm/redefine`（热替换 404）。见 S2。
- **BD-P1-5** `tomcat-extension/src/browser/server-store.ts:42-49,193-203`：状态机拒绝合法转换（外部 kill 的 running→stopped、断线错过 starting 的 stopped→running），被拒只 warn 不重拉快照 → 面板永久卡死。修复：拒绝时 `GET /servers` 对账。
- **BD-P1-6** `encoding-commands.ts:218-224`：Convert 三处契约错误（`workspaceId:''`、Windows `/g:/...` 路径、`from` 用 Theia id）。见 S3/S4。
- **BD-P1-7** `encoding-service.ts:116,207,279,294,218-225`：编码缓存键/值三重值域混乱且永不失效。见 S3。
- **BD-P1-8** `encoding-commands.ts:91-97,181-184`：“Already using X” 用 Kairo id `===` Theia id 恒假。见 S3。
- **BD-P1-9** `kairo-encoding-registry.ts:37-41`：目录 override 按注册顺序而非最深路径优先 → override 失效。见 S3。
- **BD-P1-10** `encoding-service.ts:234-241,249-265`：项目/目录 override 的 Disposable 被丢弃，切项目永久残留 + 重复叠加。见 S3。
- **BD-P1-11** `server-view-widget.tsx:169-187`：Hot Reload 按钮 1 秒后无条件报成功，忽略命令 Promise。
- **BD-P1-12** `server-view-widget.tsx:127-129,192` vs `hot-deploy-service.ts:61-63`：Auto-sync 开关写 localStorage、执行方读 PreferenceService → 开关无效。
- **BD-P1-13** `project-structure-dialog.tsx:669-714,536-624`：Dependencies 页手动 classpath 编辑从不持久化（save 不含 classpath，且 `autoDetectClasspath:true` 重算）。见 S5。
- **BD-P1-14** `import-wizard-widget.tsx:182-183`：扫描即 `openWorkspace` 创建后端 workspace + 切全局上下文，取消/关闭无回滚 → 孤儿 workspace + 上下文错位。修复：推迟到确认导入。
- **BD-P1-15** `tomcat-extension/src/node/tomcat-manager.ts`、`tomcat-registry.ts` 全文件死代码；且状态词汇 `failed` vs protocol `error`、Windows kill 不带 `/T` 致孤儿 java.exe、依赖英文 banner。见 S5。
- **BD-P1-16** `config-schema/src/index.ts:157-172`：`toolchainCompiler` 的 `allOf`+`additionalProperties:false` 在 draft 2020-12 下恒不通过；`fingerprint` pattern 与前端发的空串冲突。修复：改 `unevaluatedProperties`。
- **BD-P1-17** `build-store.ts:156-168,190-193`：`build.progress` 只 update 已知构建（对未知 id no-op），终态不 refetch → 外部发起的构建不显示、诊断永远空。修复：未知/终态时 `GET /builds/{id}` upsert。
- **BD-P1-18** `build-extension/src/browser/index.ts:21`：`BuildMarkerAdapter` 绑定但从未实例化 → Problems 集成整体死。见 S5。

### P2
- **BD-P2-1** `build-store.ts:124-134`、`server-store.ts:151-161`：bootstrap 竞态致 WS 订阅泄漏 + 事件双份。
- **BD-P2-2** `runtime-connection-service.ts:857-862,909-915,681-685`：EventStream 替换后旧连接 close 仍广播 disconnected。
- **BD-P2-3** `reopen-strategy.ts:62-74`：close/reopen 兜底路径对 dirty 编辑器不检查 → 丢弃未保存修改。
- **BD-P2-4** `log-viewer-widget.tsx:152-166` + `log-buffer.ts:52-57,75-83`：WS live 与 2s 轮询去重不完整致重复行；merge 又可能误吞同时间戳合法行。
- **BD-P2-5** `server-view-widget.tsx:260-293`：stopping 期间仍可点 Stop/Start（重复请求/抢端口）。
- **BD-P2-6** `project-structure-dialog.tsx:652`、`server-view-widget.tsx:179`：Electron 下 `window.prompt` 恒 null → Add Source Dir 静默失效。
- **BD-P2-7** `project-structure-dialog.tsx:598-616`：保存后编码/项目变更不广播 → 改动不即时生效。
- **BD-P2-8** `hot-deploy-service.ts:76-93,152-156`：save/blur 监听泄漏；`files` 传的是 URI 不是路径（Windows 编译退化）。
- **BD-P2-9** `tomcat-registry.ts:84-90`：dispose 不停子进程 → 孤儿（死代码，接线即踩）。
- **BD-P2-10** `runtime-agent/internal/services/encoding.go:48-51,101-104,135-140`：`fileEncoding` map 无锁并发写 → panic 击落 agent。见 S3。
- **BD-P2-11** `runtime-errors.ts:97-98`：408 被归为不可重试 `invalid_request`（408 分支死代码）。
- **BD-P2-12** `workspace-context-service.ts:228`：`.kairo/project.yaml` 恒 UTF-8 解码 → GBK 中文 name 乱码。见 S4。
- **BD-P2-13** `encoding-tab-decorator.ts:52-58`：只装饰当前激活 tab（与“每个打开文件”注释矛盾）。
- **BD-P2-14** `protocol/src/index.ts:491-500` vs `encoding.go:62-71`：`eol` 被 Go 静默忽略。见 S2。

### P3
- **BD-P3-1** `properties-escape.ts:112-162`：`escapeProperties` 按文档整篇调用会摧毁 .properties（无调用方=危险死代码）。
- **BD-P3-2** `protocol/src/index.ts:1010-1017`：`mapBuildState` 状态值与实际枚举不匹配的死助手。
- **BD-P3-3** `kairo-custom-build-runner.css:31,55-59`：硬编码纯绿 `rgba(0,255,0,.1)` + 暗色 fallback，浅色主题差。
- **BD-P3-4** `import-wizard-widget.tsx:256,663` 等遗留 `console.log`（含自标注“临时”）。
- **BD-P3-5** `hot-deploy-service.ts:172,212,293` 响应 `as any`（正是 BD-P0-4 值域错配未被编译器抓住的原因）；各视图 `i18n.t(key as any)`。
- **BD-P3-6** `maven-view-widget.tsx:19-74` 重复定义 protocol 已有类型；`build-store.ts:18-24` BuildDiagnostic 丢 `endLine/endColumn/code`。
- **BD-P3-7** `build-marker-adapter.ts:68`、`server-view-widget.tsx:173/183`、`runtime-connection-service.ts:746-750` 未清理的监听/定时器。
- **BD-P3-8** `active-project-service.ts:39,54,173`、`server-service.ts:21-27`（只写不读 cache）、`server-model.ts:10`（`workspaceId:''` 硬编码）。
- **BD-P3-9** 服务层 i18n 硬编码英文（见 S6）。
- **BD-P3-10** 杂项：`import-wizard-widget.tsx:137` `defaultEncoding:'GBK'` 大写与 `<option value="gbk">` 不匹配；`build-store.ts:176-178` `getLatestBuild` 依赖服务端顺序；`run-configuration.ts:94` / `index.ts:96` `contextPath` pattern 不允许多级路径 `/app/admin`；`build-view-widget.tsx:30-38` 相对诊断路径无 scheme 打不开；`server-store.ts:216-221` `hotreload.status` 未验证 cast。

**架构评价**：`@kairo/protocol` + 单出口 `RuntimeConnectionService` + envelope/错误码 + 退避重试是正确骨架且细节认真，但契约只有类型没有运行时校验，也无 TS↔Go 对拍脚本，积累出一整类“类型说有、后端说无”的问题（见 S2）。编码子系统是投入最重、修复痕迹最多的部分（round-trip 校验、错误上浮、层级 override 都由真实事故驱动），却被“三套编码 id 值域”从内部瓦解（见 S3）。状态管理呈“防御性补丁堆叠”特征，缺统一对账原则——建议改为“事件只当刷新信号、一切以带节流的快照 refetch 为准”，可消掉一半竞态补丁；两块半成品（node Tomcat 栈、Custom Build Runner、未实例化的 BuildMarkerAdapter）要么接完要么删除。

---

## 6. git/svn/search/sql/test/remote/plugin/i18n/ui-kit 十包（区块 VC，45 项）
> 详见审查代理 [工具扩展与 UI 审查](eafedd1b-0f8b-4d8a-8f99-f382ab35f5e6)。

### P0
- **VC-P0-1** `plugin-extension/src/node/kairo-extension-installer.ts:170-181`（Zip Slip）：VSIX 条目名不规范化即 `path.join`+`writeFileSync` → `extension/..\..\startup.bat` 可写任意文件。修复：`path.resolve` 后校验 `startsWith(targetDir+sep)`，拒绝符号链接/绝对路径条目。
- **VC-P0-2** `kairo-extension-installer.ts:144-150`（签名缺失/allowlist 绕过）：无签名/哈希校验，非白名单“照样安装”（strict 分支被注释），`extensionId` 攻击者自填 → 任意代码执行。修复：签名验证 + 默认 strict + 二次确认。
- **VC-P0-3** `sql-extension/src/browser/sql-connection-service.ts:174-176`（明文凭据）：密码经 StorageService 明文写盘（注释谎称 securely）。修复：OS 密钥链/`safeStorage`。
- **VC-P0-4** `sql-connection-service.ts:178-184`（凭据残留）：`setData(key, undefined)` 未真正删除。修复：真正 remove。

### P1
- **VC-P1-1** `git-file-status-decorator.ts:74-78`、`git-blame-decorator.ts:59-64`（Windows）：`file://` 前缀处理错误（残留 `/G:`）→ git 状态角标/blame 整平台失效。见 S4。
- **VC-P1-2** `git-service.ts:151-172`：status porcelain 未处理 `core.quotepath` 八进制转义 → 中文/空格文件名状态全丢。见 S4。
- **VC-P1-3** `git-service.ts:295-297`、`svn-backend-service.ts:498-515`：命令未用 `--` 隔离文件参数 → 以 `-` 开头文件名被当选项（`git add -A` 误暂存全部）。修复：路径列表前插 `'--'`。
- **VC-P1-4** `git-commit-widget.tsx:366-385` + `git-service.ts:323-335`：signoff/no-verify 复选框完全无效（未透传 `--signoff/--no-verify`）。
- **VC-P1-5** `git-cherrypick-service.ts:43-111`：`continue()` 后又手动 `cherry-pick nextHash` → 同一提交应用两次。
- **VC-P1-6** `svn-parser.ts:51-118`：手写正则 XML 解析器不处理 CDATA/注释/属性内 `>` → SVN 全线解析风险。
- **VC-P1-7** `git-stash-service.ts:97-103` + `git-stash-widget.tsx:81-113`：drop `catch{}` 吞错仍报成功；drop/clear 无确认（不可恢复）。
- **VC-P1-8** `sql-connection-service.ts:287-294`：导入连接一律空密码静默创建。

### P2
- **VC-P2-1** `search-center.css:155,184,251,...`：大量硬编码 `rgba(255,255,255,α)`（含作为文字色）+ `!important` → 亮主题白底白字不可见。修复：`--theia-*` 变量。
- **VC-P2-2** `svn-dialogs.css:164-170`：状态徽章文字色固定 HEX，暗主题对比度低。修复：`--theia-editorWarning/Success/Error-foreground`。
- **VC-P2-3** `ui-kit/src/browser/virtual-list.tsx:140`：窗口化 slice 按绝对索引，窗口模式渲染错行。
- **VC-P2-4** `virtual-list.tsx:121-133,145-190`：`scrollToIndex` 不复位；键盘导航不自动滚动到可视区。
- **VC-P2-5** `git-diff-widget.tsx:60-85`：`\ No newline at end of file` 与末尾空行破坏行号。
- **VC-P2-6** `git-cherrypick-service.ts:61,96`、`svn-service.ts:353-356,378`：冲突判定/修订号/变更数解析依赖英文 locale。见 S4。
- **VC-P2-7** `svn-service.ts:511-518`：annotate 拼接遗留 CRLF 的 `\r`。修复：`split(/\r?\n/)`。
- **VC-P2-8** `remote-sandbox-service.ts:85,150-156`：路径校验在 browser 端；`includes('..')` 误杀 `foo..bar`；`matchPattern` 未锚定 + `includes` 兜底过宽；`~/.ssh` 不展开。
- **VC-P2-9** `git-blame-decorator.ts:71-104,107-113`：blame 缓存不失效（显示过期作者）+ 全量行内装饰（大文件卡顿）+ await 后未校验 editor。
- **VC-P2-10** `sql-execution-service.ts:422-427`：CSV 导出未防 `=+-@` 开头 → Excel 公式注入。
- **VC-P2-11** `git-commit-widget.tsx:60-62`：模板索引初始化用旧闭包 `templates`。
- **VC-P2-12** `git-stash-service.ts:57`：stash 分支解析正则宽松 + 依赖英文 "On/WIP on"。

### P3
- **VC-P3-1** `svn-command-queue.ts` 与 `node/svn-backend-service.ts:330-448`：两套并行命令队列，browser 端为死代码。见 S5。
- **VC-P3-2** `svn-backend-service.ts:351-369`：长 write 期间只读命令饥饿、无取消。
- **VC-P3-3** `svn-service.ts:143`、`svn-backend-service.ts:417-424`、`kairo-extensions-widget.tsx:76,238` `as any`/错误 code 断言。
- **VC-P3-4** `git-service.ts:328-331`：commit hash/filesChanged 解析依赖英文且脆弱。
- **VC-P3-5** `git-service.ts:71-82,102-111`：轮询无重入保护；dispose 漏 `onDidChangeEmitter`。
- **VC-P3-6** `kairo-compatibility.ts:234-243`：score<0.2 标为 "unknown"（应为 incompatible）。
- **VC-P3-7** `kairo-allowlist.ts:80-99`：allowlist 明文 + `addToAllowlist` 无鉴权 → 信任根可被改写。
- **VC-P3-8** `svn-backend-service.ts:312`、`sql-execution-service.ts:89,191`、`sql-connection-service.ts:100`：`Math.random().toString(36)` 生成 id 有碰撞面。修复：`crypto.randomUUID()`。

**架构评价**：VCS 后端下沉（browser→common→node JSON-RPC）是正确选择；`packages/i18n` 质量最高（en/zh-CN 各 2157 键完全对应、占位符零错位、切换即时生效）；搜索 `SearchReplaceService` 两阶段事务 + 指纹/mtime 校验 + 逆序补偿回滚 + Undo 是亮点。但安全边界与平台正确性是系统性短板：插件安装链（Zip Slip + 无签名 + allowlist 装饰品）构成从“安装 .vsix”到“任意代码执行/文件覆盖”的完整攻击链；SQL 明文凭据；英文 locale 假设贯穿 git/svn 解析；Windows `file://` 处理错误使 git 装饰器在主要目标平台整体失效。代码层面有“半成品与重复”味道（svn 双队列、cherry-pick 与 git 序列语义打架、signoff/no-verify 死 UI）。

---

## 7. desktop / browser / 工程化脚本 / CI（区块 DK，30 项）
> 详见审查代理 [桌面端与工程化审查](0c6afea5-0e79-4ae4-b474-3dc616814f7a)。

### P0
- **DK-P0-1** `apps/desktop/src/main.ts:352-358`（及 respawn `:436-440`）：secret 经 `--secret` 命令行参数传递可被 `tasklist /v` 读取；`start-agent.ps1:52` 还打印前 8 位。见 S1。
- **DK-P0-2** `kairo-agent-config-contribution.ts:30-33`：无鉴权端点吐 secret（0.0.0.0 模式下局域网可读）。见 S1/TP-P0-3。
- **DK-P0-3** `apps/desktop/src/main.ts:1288-1299`（CSP）：`script-src` 同开 `unsafe-eval` + `unsafe-inline` → CSP 对 XSS 几乎失效。修复：去 `unsafe-inline`，内联用 nonce/hash。
- **DK-P0-4** `apps/desktop/src/preload.ts:38,47-49`：`kairoConfig.agentSecret` 明文挂 `window`（与头部“never leaks”注释矛盾）。见 S1。
- **DK-P0-5** `apps/desktop/src/main.ts:1121-1146`：打包版自动点掉 Workspace Trust 对话框（`executeJavaScript` 偷点按钮）→ 打开任意恶意工作区都完全信任。
- **DK-P0-6** `main.js:621`：仓库根陈旧编译产物启用 `remote-debugging-port 9222`（CDP 端口 = 完全控制进程）。修复：删除根 `main.js`。
- **DK-P0-7** `apps/desktop/src/main.ts:1190-1193,1210-1221`：`will-navigate`/`setWindowOpenHandler` 只校验 hostname 不校验端口 → 可导航到 Agent API 任意本地端口。

### P1
- **DK-P1-1** `apps/desktop/src/main.ts:442-445`：agent 自动重生只传 `KAIRO_DESKTOP=1`，丢失 `KAIRO_JDK_CONFIG/KAIRO_TOMCAT_CONFIG` → 恢复后 Java/服务器功能失效。修复：抽 `buildAgentEnv()` 共用。
- **DK-P1-2** `apps/desktop/src/main.ts:345-369`：`findFreePort` 到 `spawn` 之间端口 TOCTOU。修复：让 Go agent bind `:0` 回写端口。
- **DK-P1-3** `scripts/verify-version-lock.cjs:31-36` vs `supply-chain-lock.json:31`：ADR 参考值 jdtls `1.21.0` 与实际锁定 `1.55.0` 不符 → 校验必然误报（说明从未有效运行）。修复：更新为 1.55.0 并纳入 CI。
- **DK-P1-4** `.github/workflows/ci.yml:132-141` vs `package.json:9-17`：CI 调用根本不存在的 `pnpm build/clean/lint` → 关键门禁一直失败或无效。修复：补齐脚本或改 `pnpm -r`。
- **DK-P1-5** `eslint.config.mjs:9`：`files` 只覆盖 `packages/*/src`，最敏感的 `apps/desktop/src`（Electron 主进程/preload）未被 lint。修复：加入 `apps/*` + 安全规则。
- **DK-P1-6** `apps/desktop/electron-builder.yml` vs `package.json:37-131`：两套 electron-builder 配置漂移（productName/executableName/afterPack/resources 均不同）。修复：只保留一份。
- **DK-P1-7** `apps/desktop/src/main.ts:1503-1509`：headless 判活用 `&&` + 崩溃后置 null → 子进程都死也未必 quit，占端口/占 JVM。修复：`if (!agentProcess && !theiaProcess)`。
- **DK-P1-8** `scripts/fetch-verified-archive.cjs:90-92`：供应链下载器允许明文 HTTP。修复：非本地强制 https，HTTP 需显式 opt-in。
- **DK-P1-9** `apps/desktop/src/jdk-check.ts:241-257`：`parseMajorVersion` 对 `+build`/`-ea`/厂商前缀处理靠 parseInt 容错，缺显式测试。修复：严格正则 + 样本单测。
- **DK-P1-10** `apps/desktop/src/main.ts:1379-1432`：JDK/Tomcat 缺失时“暂时跳过”后仍继续启动 → 长时健康超时 + 技术性错误框。修复：进入明确降级模式 + 可操作指引。

### P2
- **DK-P2-1** `apps/desktop/src/main.ts:593-597`：复用场景 `stopAgent` 直接 return → 孤儿 `kairo-runtime.exe` 残留（`dev.ps1` 靠扫进程名兜底清杀）。
- **DK-P2-2** `apps/desktop/src/main.ts:571-607`：`killProcessTree` fire-and-forget + 崩溃置 null 使升级逻辑几乎不触发；`main.ts` 没用功能完整的 `ProcessManager`。
- **DK-P2-3** `apps/desktop/src/process-manager.ts` 整个文件 vs `main.ts:571-735`：两套进程管理并存，唯一有单测的 `ProcessManager` 反而没被主进程使用。
- **DK-P2-4** `apps/desktop/src/main.ts:1312-1321`：单实例锁下第二实例静默退出（headless 无反馈）。
- **DK-P2-5** `apps/desktop/src/main.ts:644-657`：Theia 端口发现靠 stdout 日志正则（非契约格式）→ 升级即失败。
- **DK-P2-6** `electron-builder.yml:85-108` 与 `scripts/installer/kairo-setup.nsi`：两份 NSIS 不一致；`deleteAppDataOnUninstall:true` 静默删用户数据；`.nsi` 版本号 1.0.0 与实际不符、`RMDir /r $INSTDIR` 危险、引用不产出的 `dist\win`。
- **DK-P2-7** `apps/desktop/scripts/sign-win.cjs:27,48-49,123-124`：无证书/签名失败一律 `exit(0)` → 产出未签名 exe 无硬失败。修复：`KAIRO_REQUIRE_SIGNING=1` 时失败即退出。
- **DK-P2-8** `apps/desktop/src/main.ts:270-337`（读）/`:476-480`（写）：state 文件 secret 落盘权限未收紧。见 S1/GO-P0-1。
- **DK-P2-9** `apps/desktop/src/main.ts:1210-1221`：`will-navigate` 未覆盖 `will-redirect`/子框架/webview。

### P3
- **DK-P3-1** 仓库根游离并被追踪：`main.js`、`rebuild-asar.js`、`test-exe-launch.js`（硬编码旧产物名）、`screenshot-bottom.cjs`（从公网 CDN 拉 CSS，与离线定位矛盾）、`backend*.log`、`theme-test.html`。
- **DK-P3-2** `scripts/test/` ~125 个 `_probe/_find/_patch/deep-e2e-v*` 一次性脚本与 `.txt` 快照未清理。
- **DK-P3-3** `apps/browser/postbuild.cjs:48-101,177-193`：对 inversify/ApplicationError/drivelist 压缩产物做字符串级 patch，minifier 变量改名即静默失效（未命中只打印不失败）。
- **DK-P3-4** 被追踪的巨量构建产物：多份 `app.asar`（各上百 MB）、`artifacts/**` 解包目录；`.gitignore` 缺 `*.asar`/`artifacts/`。
- **DK-P3-5** `tsconfig.json:8-14`、`tsconfig.base.json:15-16`：include 路径与实际不符；`noUnusedLocals=false`；类型检查不含 `apps/*`。
- **DK-P3-6** `.husky/pre-commit:166-173`：`echo | while` 子 shell 里设的 `HAS_ERRORS` 丢失 → lint 失败不阻断提交（lint 门禁名存实亡）。修复：改 `for` 循环或进程替换。
- **DK-P3-7** `.npmrc:6` 全局 `shamefully-hoist=true` 放大 phantom deps。修复：`public-hoist-pattern` 精细化。
- **DK-P3-8** `.github/dependabot.yml:73-78` + `ci.yml:124,747`：CI actions 用浮动 major tag，`govulncheck@latest` 与“可复现构建”自相矛盾。修复：固定 SHA/版本。
- **DK-P3-9** `scripts/run-with-timeout.cjs:41`：上限 300s，冷缓存 `pnpm build`/E2E 常超时被 SIGKILL（退出码 124）。
- **DK-P3-10** `scripts/dev.ps1:132-138`：`Get-Process` 无 `CommandLine` 属性，兜底清杀实际只靠 `Path -like *kairo*`，可能误杀/漏杀 java。
- **DK-P3-11** `apps/browser/package.json:14-18`：`security.workspace.trust.enabled:false` 全局关闭信任，与桌面端自动信任叠加，无集中记录。

**架构评价**：主进程体现了对 Electron 安全模型的正确认知（contextIsolation/sandbox/nodeIntegration:false、导航拦截、离线优先），但这些防线被一系列自相矛盾的实现抵消——密钥在“命令行参数、落盘 state、全局对象、无鉴权 HTTP 端点”四处可被拿到，是最需优先修的系统性问题。进程生命周期出现“有完整实现且有单测的 `ProcessManager` 却没人用、真正在跑的 `main.ts` 反而无测试”的割裂。工程化基建看似齐全但多处“形似神不在”：version-lock 校验必然误报、pre-commit lint 门禁不阻断、ESLint 不覆盖 `apps/*`、CI 调不存在的脚本、两套打包配置漂移。仓库卫生拖后腿（根目录游离文件、~125 个一次性脚本、被追踪的上百 MB asar）。当前更接近“功能跑通、冲刺内网交付的原型”，离“可长期维护、安全默认值可信”的生产工程尚有距离。

---

## 8. 建议的修复批次（给修复 AI 的执行顺序）

**批次 1 — 安全收口（P0，先做）**
S1 密钥四处泄露（GO-P0-1、DK-P0-1/2/4、TP-P0-3）、GO-P0-3 Origin 精确匹配、DK-P0-3 CSP、DK-P0-5 自动信任、DK-P0-6 删 main.js/9222、VC-P0-1/2 VSIX Zip Slip+签名、VC-P0-3/4 SQL 凭据。

**批次 2 — 崩溃与数据丢失（P0）**
GO-P0-2 EventHub panic、BD-P2-10 encoding.go map panic、TP-P0-1 工具栏递归、TP-P0-2 冲突对话框丢改动、JV-P0-2/3 JSP 空 model/保存损坏、BD-P0-1/2 编码丢 BOM/静默改编码、BD-P0-6 中文路径 btoa。

**批次 3 — 核心功能事实不可用（P0/P1，恢复卖点）**
JV-P0-1 JDT LS 超时杀进程、JV-P1-5/6 Windows URI/诊断、BD-P0-3/4 + JV-P1-7 Maven/热部署契约（并落地 S2 的 TS↔Go 对拍测试）、BD-P0-5 Custom Build、BD-P1-16 config-schema、BD-P1-13/BD-P1-18 classpath 持久化/Problems 集成。

**批次 4 — 状态机与契约（P1）**
BD-P1-1/2/3/4/5、GO-P1-1~6、TP-P1-*、VC-P1-1~8、JV-P1-* 其余、S3 编码 id 统一模块、S4 locale/路径统一。

**批次 5 — P2 竞态/泄漏/UX + 样式主题适配**
各区块 P2；VC-P2-1/2、BD-P3-3、TP-P2-18 的主题变量化。

**批次 6 — P3 工程化卫生与死代码清理**
S5 半成品接完或删除；S6 i18n 收口；DK-P3-* 仓库瘦身、门禁修复；各区块 P3。

**回归测试要求**：Go 侧全部 `go test -race`；前端为每条“用户可见链路”补最小端到端冒烟（补全出现在光标处、诊断进 Problems、Maven detect 返回真数据、服务器状态机随外部 kill 更新、编码保存不乱码、Windows 中文路径能起 JDT LS）；新增 EndpointMap↔Go 路由对拍 CI；secret 泄露四点各加断言。

---

*报告完。共 253 项带代码证据的问题（GO 41 / TP 43 / JV 46 / BD 48 / VC 45 / DK 30）。每条均可按 `文件:行号` 直接定位。*
