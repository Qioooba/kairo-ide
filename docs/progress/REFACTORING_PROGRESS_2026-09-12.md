# Kairo IDE 源码重构与质量提升持续推进进度表

> **依据基准文档：** [`docs/Kairo_vs_Lithe_Source_Audit_and_Refactoring_Plan_2026-09-12.md`](file:///g:/spaces/kairo-ide/docs/Kairo_vs_Lithe_Source_Audit_and_Refactoring_Plan_2026-09-12.md)  
> **基线快照 Commit：** `6f6792213a540fad678cde5ea1790c92b83d3bcd` (`chore: add Apache-2.0 LICENSE for open source`)  
> **核心原则：** 保留 Theia/Monaco + Go 架构；不强制业务升级 JDK；遵循小步、可验证、可回滚演进；先写失败测试再实施最小修复；严禁自动提升 Java 版本，严禁盲猜服务器与类加载器。

---

## 1. 总体进度概览

| 阶段 | 阶段目标 | 覆盖 PR | 状态 | 完成度 |
|---|---|---|---|---|
| **Phase A: 先防止错误结果** | 保护 Java 目标、规范文件身份、绑定明确目标、固定会话与产物清单 | PR00 ~ PR05 | **已完成 (Completed)** | 100% (6/6 PRs) |
| **Phase B: 使资源和生命周期可靠** | JDWP 协议底层修复、JobManager、搜索取消、重启接管、编码安全、虚拟文档所有权 | PR06 ~ PR11 | **已完成 (Completed)** | 100% (6/6 PRs) |
| **Phase C: 强化日常开发能力** | JSP 整页 SourceMap、ProjectModel 统一、端到端调试与断点能力、启动与索引性能 | PR12 ~ PR15 | **已完成 (Completed)** | 100% (4/4 PRs) |
| **Phase D: 形成持续交付能力** | 信任与认证目标绑定、架构门禁与许可清单、发布与兼容验收 | PR16 ~ PR18 | **已完成 (Completed)** | 100% (3/3 PRs) |

---

## 2. 缺陷与风险逐项状态表 (Findings Matrix: F01 ~ F24)

| ID | 优先级／证据 | 核心问题简述 | 责任位置 | 关联 PR | 当前状态 | 验证用例 |
|---|---|---|---|---|---|---|
| **F01** | P0 / A | Java 6 编译目标被自动提高到编译器最低支持级别 | `runtime-agent/internal/build/compiler.go` | PR01 | **已修复 (Resolved)** | T01, T02, T03, T04 |
| **F02** | P1 / A | file URI 作为系统路径直接进入编译接口，未做宿主路径规范化 | `java-hotswap-service.ts` -> Go handler | PR02 | **已修复 (Resolved)** | T05, T06, T07, T08 |
| **F03** | P0 / A | HotSwap 默认选择第一个可调试服务器 (`resolveJDWPEndpoint`) | `runtime-agent/internal/api/hot_deploy_handlers.go` | PR03 | **已修复 (Resolved)** | T09, T10, T11 |
| **F04** | P0 / B | await 编译后读取可变当前会话，多文件保存存在跨目标热替换风险 | `packages/java-extension/.../java-hotswap-service.ts` | PR05 | **已修复 (Resolved)** | T15, T16 |
| **F05** | P1 / A | 按首个同名 class 文件匹配产物，内部类与多类场景无法唯一定位 | `runtime-agent/internal/debug/redefine_live.go` | PR04 | **已修复 (Resolved)** | T12, T13, T14 |
| **F06** | P0 / A | 同名类多 ClassLoader 时直接取 `refs[0]` | `runtime-agent/internal/debug/redefine_live.go` | PR05 | **已修复 (Resolved)** | T18 |
| **F07** | P1 / A+B | DAP 错误被统一视为不可用并盲目回退新 JDWP 连接造成端口竞争 | `java-hotswap-service.ts` | PR05 | **已修复 (Resolved)** | T17 |
| **F08** | P1 / A | JDWP char/short 按四字节编解码导致字段错位 | `runtime-agent/internal/debug/jdwp.go` | PR06 | **已修复 (Resolved)** | T20 |
| **F09** | P1 / A | JDWP 握手单次 `Read` 假设分片不存在 | `runtime-agent/internal/debug/jdwp_conn.go` | PR06 | **已修复 (Resolved)** | T21 |
| **F10** | P1 / A | 直接 JDWP 路径缺少事件分流与 IDSizes 协商 | `runtime-agent/internal/debug/jdwp_conn.go` | PR06 | **已修复 (Resolved)** | T23 |
| **F11** | P1 / A | 协议包长度与游标边界未在分配前校验 | `runtime-agent/internal/debug/jdwp.go` | PR06 | **已修复 (Resolved)** | T22 |
| **F12** | P1 / A | JDWP 错误码表错误（如 10 误为 VM_DEAD 应为 INVALID_THREAD） | `runtime-agent/internal/debug/jdwp.go` | PR06 | **已修复 (Resolved)** | T24 |
| **F13** | P1 / A | 流式搜索消费者退出未取消生产者 | `runtime-agent/internal/search/search.go` | PR08 | **已修复 (Resolved)** | T28, T29, T30 |
| **F14** | P1 / A | UTF-16 原始字节用于 EOL 检测导致 CRLF 误判为 LF | `runtime-agent/internal/encoding/encoding.go` | PR10 | **已修复 (Resolved)** | T35 |
| **F15** | P1 / A | charset 检测过宽，未知编码变成 UTF-8 | `runtime-agent/internal/encoding/encoding.go` | PR10 | **已修复 (Resolved)** | T34, T36 |
| **F16** | P1 / A | JSP 单块虚拟 Java 缺少页面上下文（import、类级声明、前序块） | `packages/jsp-extension/.../jsp-virtual-java.ts` | PR12 | **已修复 (Resolved)** | T40, T41, T42, T43 |
| **F17** | P1 / B | JSP 并发补全共享虚拟 URI 的打开／关闭冲突 | `packages/jsp-extension/.../jsp-scriptlet-java-completion.ts` | PR11 | **已修复 (Resolved)** | T38, T39 |
| **F18** | P1 / B | Agent 重启没有端口与就绪交接协议 | `cmd/kairo-runtime/main.go`, `api/server.go` | PR09 | **已修复 (Resolved)** | T31, T32, T33 |
| **F19** | P2 / A | 自定义构建的 timeout cancel 被丢弃导致 timer 泄露 | `runtime-agent/internal/api/build_handlers.go` | PR07 | **已修复 (Resolved)** | T27 |
| **F20** | P1 / B | 幂等缓存只有 requestId，缺执行中占位及请求指纹 | `runtime-agent/internal/api/server.go` | PR07 | **已修复 (Resolved)** | T25, T26 |
| **F21** | P1 / A | 字符串前缀 `startsWith` 不是工作区目录包含关系 | `java-hotswap-service.ts` (`isInWorkspace`) | PR02 | **已修复 (Resolved)** | T06 |
| **F22** | P2 / A+B | 文档与现状漂移，废弃兼容代码容易被误用 | 架构文档、JDT 管理器、入口 | PR17 | **已修复 (Resolved)** | T46 |
| **F23** | P2 / B | HotSwap 停止过程未完整拥有订阅与在途操作 | `java-hotswap-service.ts` (`onStop`) | PR05 | **已修复 (Resolved)** | T19 |
| **F24** | P1 / B | Agent 地址可配置与 secret 发送目标缺少显式白名单绑定 | `runtime-connection-service.ts` | PR16 | **已修复 (Resolved)** | T51 |

---

## 3. PR 级演进路线与执行详情 (Roadmap & Milestones)

### Phase A: 先防止错误结果

#### [PR00] 基线与止损 (P0)
- **状态：** **已完成 (Completed)**
- **目标：** 建立重构进度追踪体系；固定基线；在目标精确绑定与 DebugBroker 落地前，将不明确目标的自动 HotSwap 默认置为禁用，防止后台保存误改写外部服务器实例。
- **任务清单：**
  - [x] 创建重构进度追踪文档 [`docs/progress/REFACTORING_PROGRESS_2026-09-12.md`](file:///g:/spaces/kairo-ide/docs/progress/REFACTORING_PROGRESS_2026-09-12.md)
  - [x] 修改 `packages/java-extension/src/browser/java-hotswap-service.ts` 中的 `isEnabled` 默认行为（未显式配置时默认为 `false`，并提示需要明确调试目标配置）
  - [x] 增加单测验证默认关闭策略与显式启用机制（`packages/java-extension/src/browser/java-hotswap-service.test.cjs` 全部 6 个用例通过）
  - [x] 记录基准环境状态（Go 1.23.4, Node 22.23.2, pnpm 9.15.9）

#### [PR01] 编译兼容门禁 (P0)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F01，阻断自动提高 target 行为；增加工具链支持度校验；生成 class 头部 major version 校验。
- **关联测试：** T01, T02, T03, T04
- **任务清单：**
  - [x] 编写失败测试：针对 Java 6 目标使用仅支持 Java 8+ 的 javac 必须报错，拒绝返回 exitCode 0 (`TestCompiler_IncompatibleToolchain_Rejects`)
  - [x] 在 `runtime-agent/internal/build/compiler.go` 中移除 `normalizeLevel` 针对 source/target 的静默抬升
  - [x] 增加工具链兼容性校验逻辑，不兼容时返回结构化 `toolchain_incompatible` 诊断与 ExitCode 2
  - [x] 增加编译产物 class 头部检查 (`validateClassMajorVersions`，Java 6 major <= 50，超过目标时标记 `class_major_version_exceeded` 并拦截)
  - [x] 单元测试套件全部验证通过（`internal/build` 33 个用例全部 PASS）

#### [PR02] 文件身份与路径安全规范化 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F02, F21；统一 `sourceUri` 与 `projectId` 契约；严禁前端直接传未经宿主规范化的 file URI 作为本地绝对路径；修复 `startsWith` 目录判定。
- **关联测试：** T05, T06, T07, T08
- **任务清单：**
  - [x] 编写 Go 路径解析测试：处理空格、中文、`#`、UNC、Windows 驱动器盘符斜杠，拦截非 file 协议 scheme (`internal/pathpolicy/path_test.go`)
  - [x] 实现 `pathpolicy.ResolveURIOrPath(input string)` 与 `pathpolicy.IsLexicallyUnder`
  - [x] 在 `runtime-agent/internal/api/hot_deploy_handlers.go` 替换编译、热部署各入口的裸路径解析
  - [x] 修复前端 `packages/java-extension/src/browser/java-hotswap-service.ts`：导出严格目录判定 `isUriContained` 替代前缀匹配；在调用 Agent 前通过 `FileUri.fsPath` 转换为宿主原生路径，同时传递 `sourceUri` 与 `file`
  - [x] 增加 Node 单元测试验证兄弟目录前缀碰撞场景（`packages/java-extension/src/browser/java-hotswap-service.test.cjs` PASS）
  - [x] 运行并通过 Go 与 TypeScript 全套测试（`internal/pathpolicy`、`internal/api`、`java-extension` 全部 PASS）

#### [PR03] 调试目标精确绑定 (P0)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F03；删除 `resolveJDWPEndpoint` 中“自动取首个运行中服务器”的危险逻辑；热替换必须携带确定的 `DebugTargetBinding`（含 `projectId`, `serverId`, `runtimeInstanceId`, `sessionGeneration`）。
- **关联测试：** T09, T10, T11
- **任务清单：**
  - [x] 编写失败测试：针对目标缺失拒绝、未知工程拒绝、多实例歧义拒绝、顺序独立性、代际与实例不匹配拒绝 (`jvm_hotswap_routes_test.go`)
  - [x] 在 `runtime-agent/internal/api/protocol` 与 `@kairo/protocol` 引入 `DebugTargetBinding` 契约及 `target_not_found`, `target_ambiguous`, `stale_target` 稳定错误码
  - [x] 在 `ServerResponse` 与 `serverMeta` 引入 `RuntimeInstanceID` 与 `Generation` 代际追踪
  - [x] 在 `runtime-agent/internal/api/hot_deploy_handlers.go` 删除 `resolveJDWPEndpoint` 盲选首项逻辑，实现严格消歧的 `resolveTargetEndpoint`
  - [x] 前端 `packages/java-extension/src/browser/java-hotswap-service.ts` 从当前调试会话提取绑定并附带 `target`, `projectId`, `serverId`
  - [x] 单元测试套件全部验证通过（Go API 测试全部通过，TypeScript protocol 与 java-extension 全部 PASS）

#### [PR04] 构建产物清单 BuildArtifactManifest (P0)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F05；从按文件名猜测首个 class 文件改为构建产出精确清单（source -> binary names -> class file paths -> sha256）；精确消歧内部类与多包同名类。
- **关联测试：** T12, T13, T14
- **任务清单：**
  - [x] 创建 `runtime-agent/internal/build/manifest.go`：定义 `BuildArtifactManifest` 与 `ArtifactItem`，实现纯 Go 字节码解析器 `ParseClassFile`（解析常量池提取权威 `this_class` 二进制类名与 major version）
  - [x] 在 `compiler.go` 中集成清单生成，编译成功后产出权威清单并挂载在 `compiler.Result.Manifest`
  - [x] 在 `runtime-agent/internal/debug/redefine_live.go` 中升级 `ResolveClassFile`：严格基于包路径与字节码解析消歧同名类；实现 `ResolveArtifacts` 与 SHA-256 磁盘校验
  - [x] 在 `hot_deploy_handlers.go` `handleJvmRedefine` 接入 `expectedHash` 校验，在字节码被外部篡改或覆盖时阻断热替换
  - [x] 编写并验证 T12、T13、T14 针对多包同名类消歧、内部类追踪与外部篡改拦截的单元测试（`internal/build/manifest_test.go` 与 `internal/debug/redefine_live_test.go` 全部 PASS）

#### [PR05] DebugBroker 与 HotSwap 串行队列 (P0)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F04, F06, F07, F23；固定调试会话代际；为每个调试目标维护串行副作用队列；细分 DAP 错误，禁止盲目二次建立 JDWP 连接；同一 JVM 多 ClassLoader 精确消歧。
- **关联测试：** T15, T16, T17, T18, T19
- **任务清单：**
  - [x] 在 `java-hotswap-service.ts` 中引入不可变 `HotSwapContext`：保存时同步提取固化上下文（会话、目标绑定、文档单调保存版本号、服务代际），彻底阻断异步编译后重新读取可变 `currentSession` 导致的跨目标热替换 (F04 / T15)
  - [x] 在前端实现按调试目标的串行副作用队列与版本时序门控：单目标串行执行，编译完成后严格校验版本号，若在途编译结果被新保存覆盖则丢弃旧产物热替换，严禁状态回退 (F04 / T16)
  - [x] 细化 DAP 错误分流逻辑：对类结构变更（增删成员、继承结构变更）返回明确 `unsupported` 拒绝信息，当 DAP 拥有调试会话时严禁盲目回退并二次拨号 JDWP，防止端口竞争与状态破坏 (F07 / T17)
  - [x] 在 `jdwp_conn.go` 与 `redefine_live.go` 中实现 `GetClassLoader` 与 `RedefineClassWithClient`：同一 JVM 出现多个 ClassLoader 包含同名类时，严禁盲目取 `refs[0]`，必须按 `ClassLoaderID` 精确匹配消歧，歧义时返回 `ambiguous_class_loader` (F06 / T18)
  - [x] 在 `java-hotswap-service.ts` 引入 `DisposableCollection` 与 `serviceGeneration` 生命周期：`onStop` 彻底释放文档保存订阅，清空定时器、队列与在途工作，在途异步操作完成时零副作用丢弃 (F23 / T19)
  - [x] 编写并验证 T15、T16、T17、T18、T19 全套自动化测试（Go `redefine_live_test.go` 与 Node `java-hotswap-service.test.cjs` 全部 PASS）

---

### Phase B: 使资源和生命周期可靠

#### [PR06] JDWP 底层协议健壮性 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 彻底修复 JDWP 底层编解码错位、握手分片短读、事件分流与 ID 宽度协商缺失、包长度无界及错误码表倒挂缺陷 (F08, F09, F10, F11, F12)。
- **任务清单：**
  - [x] **F08 / T20**: 在 `jdwp.go` 中实现 2 字节 `ReadChar() (uint16, error)` 与 `ReadShort() (int16, error)`，修正 `ReadUntaggedValue` 和 `variable.go` 中 `parseTaggedVariable`。在 `JDWPDataWriter` 中新增 `WriteChar` 与 `WriteShort`（2 字节），更新 `WriteTaggedValue` 支持类型安全防 panic。
  - [x] **F09 / T21**: 在 `jdwp_conn.go` 的 `DialJDWP` 中使用 `io.ReadFull(conn, buf)` 替代单次 `Read`，解决 TCP 握手数据分片（如 1 字节切片、3+3+8 字节切片）导致误判握手失败的问题。
  - [x] **F10 / T23**: 在 `JDWPConn.send` 中引入事件分流循环（Demuxing Loop），过滤 JVM 自发下发的异步 VM 事件包（`Flags & 0x80 == 0`，如 `VM_START`、`CLASS_PREPARE`），精准提取对应 `id` 的回复包；实现 `VirtualMachine.IDSizes (1,7)` 协商机制与 `ReadID` / `WriteID` 动态宽度处理。
  - [x] **F11 / T22**: 在 `ReadJDWPPacket` 分配 payload 内存前严格校验 `rawLen >= 11` 及 `rawLen <= 32MB`，防止恶意/畸形包引发 OOM；在 `SkipBytes` 中显式拒绝负数偏移并防范整数溢出；在 `ReadString` 中防范超长与负数 length。
  - [x] **F12 / T24**: 严格对照 Oracle JPDA JDWP 官方规范对齐重构 `jdwpErrorMessage` 错误码表（如 10 修正为 `INVALID_THREAD`、112 修正为 `VM_DEAD`、20 修正为 `INVALID_OBJECT`、30 修正为 `INVALID_FRAMEID` 等 50+ 项标准码），未知码保留原始数字编码，消除假绿灯单元测试预期。
  - [x] 编写并验证 T20、T21、T22、T23、T24 全套自动化测试（`internal/debug/jdwp_robustness_test.go` 与 `internal/debug` 全部 PASS）。

#### [PR07] JobManager 与操作幂等性 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F19, F20；防止长时间后台任务的 context/timer 泄漏；实现全局 `OperationRegistry` 原子防重与并发请求合并（`ClaimOrWait`）；校验 payload 指纹防止同 requestId 冲突请求静默重放旧结果（返回 409 Conflict）；提供状态可查询接口。
- **任务清单：**
  - [x] **F19 / T27**: 彻底修复自定义构建中的 timer 泄漏缺陷。在 `CustomBuildExecutor` 中为每个任务绑定 `customBuildJob{cmd, cancel, done}`，引入 `StartWithCancel`，在启动失败、进程退出及主动取消时立即调用 `cancel()`，释放 30 分钟超时定时器；在 `Close` 与 `Cancel` 中引入 `<-job.done` 等待机制，彻底消除 Windows 平台进程句柄锁定导致临时目录无法清理的问题。
  - [x] **F20 / T25**: 实现全局 `OperationRegistry`，按 `OperationKey{Scope, Kind, RequestID}` 与 SHA-256 `PayloadHash` 进行原子认领与合并 (`ClaimOrWait`)。20 个并发相同请求到达时，仅首个 caller 获得执行权，其余 19 个等待首个结果完成后重放相同响应并携带 `X-Kairo-Idempotent-Replay: 1` 标识，副作用仅执行一次。
  - [x] **F20 / T25**: 在 `server.go` 与 `handlers.go` 中暴露 `GET /api/v1/operations/{requestId}`，使在途或已完成操作的生命周期与执行状态透明可查。
  - [x] **F20 / T26**: 对相同 `requestId` 但携带不同 payload 的冲突请求，立即返回 HTTP 409 Conflict (`protocol.ErrConflict`)，严禁重放过期或错误缓存，严禁执行二次副作用。
  - [x] 编写并验证 T25、T26、T27 全套自动化测试（`internal/api/idempotency_test.go` 全部 PASS，`internal/api` 全量 100% PASS）。

#### [PR08] 搜索取消与完成元数据 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F13；流式搜索双向取消保证；消费者提前退出或出错时立即取消底层扫描；多工作协程确定性汇聚（`producerWg.Wait()`）；返回完整完成元数据（`skipped`, `truncated`, `cancelled`, `durationMs`, `filesSearched`）。
- **任务清单：**
  - [x] **F13 / T28**: 在 `SearchStreamingWithStats` 中收敛所有 context（调用方 `ctx`、`opts.Cancel`、消费者回调返回错误），在消费者终止或出错时立即触发取消；通过 `sync.WaitGroup` 追踪生产者协程并设置后台 drain 协程防死锁，确保函数返回前所有后台 worker 确定性 join 退出，零 goroutine 泄漏。
  - [x] **F13 / T29**: 扩展 `protocol.SearchStreamEvent`（Go 与 TS 双端统一），新增 `Skipped`, `Truncated`, `Cancelled`, `DurationMs`, `FilesSearched` 字段；在 `search.go` 中对文件打开异常（权限拒绝、丢失）与超限跳过（`MaxFileBytes`）通过原子计数器统计并在 completion / error event 中上报。
  - [x] **F13 / T30**: 验证高频连续输入取消（模拟 100 次快速键入并取消），旧搜索任务迅速中断，无僵尸协程残留，CPU 与 goroutine 迅速恢复基线。
  - [x] 编写并验证 T28、T29、T30 全套自动化测试（`internal/search/streaming_cancel_test.go` 全部 PASS，`internal/search` 全量 100% PASS）。

#### [PR09] Agent 重启状态机与代际接管 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F18；建立 Agent 重启状态机、代际生命周期与端口交接协议；解决旧进程缓慢退出时新进程抢占端口失败即退缺陷；实现 `agent-state.json` 原子写入与代际单调性守护；实现连续快速重启点击的原子幂等保护。
- **任务清单：**
  - [x] **F18 / T31**: 在 `lifecycle.go` 中实现 `ListenWithHandoff`：当绑定的具体端口已被前代进程占用时，通过指数退避循环重试（上限 15s/30s），等待前代进程完成容器 shutdown 与 HTTP shutdown 释放端口；旧进程 shutdown 耗时（0/2/10s）期间新进程平稳等待并在端口释放瞬时接管，彻底消除端口竞争导致的进程夭折崩溃。
  - [x] **F18 / T32**: 实现超时与诊断状态持久化：若端口被第三方占用未释放，`ListenWithHandoff` 返回详细诊断错误；将包含真实错误信息的 `{ status: "failed", error: "..." }` 原子持久化到 `agent-state.json`，Desktop 与 UI 可清晰识别真实失败并提供恢复入口。
  - [x] **F18 / T33**: 实现 `AgentState` 代际状态机与原子文件替换：定义 `InstanceID`, `Generation`, `PID`, `Port`, `BindAddress`, `StartedAt`, `Status`（`starting` -> `ready` -> `handing_over` -> `shutting_down` -> `stopped` / `failed`）；通过临时文件 + `os.Rename` 实现原子写；强制校验 `Generation` 单调递增，拒绝陈旧代际覆写；旧实例退出时的 `RemoveAgentState` 严格校验代际与 PID，严禁陈旧进程退出时误删新代际状态文件。
  - [x] **F18 / T33**: 在 `handleRuntimeRestart` 中引入 `isRestarting.CompareAndSwap(false, true)` 原子防重开关：连续快速点击 20 次仅触发一次真实的进程衍生与 shutdown 序列，后续并发点击安全返回 `{"status": "restarting", "note": "restart already in progress"}`，杜绝多实例冒充与进程树混乱。
  - [x] 编写并验证 T31、T32、T33 全套自动化测试（`internal/api/lifecycle_test.go` 全部 PASS，`internal/api` 全量 100% PASS，`cmd/kairo-runtime` 全部 PASS，`apps/desktop` 全量 45/45 PASS）。

#### [PR10] 文档保存与编码元数据安全 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 解决 F14, F15；实现 UTF-16 解码后 EOL 检测（修复 CRLF 误判为 LF 缺陷）；支持 mixed 换行统计；修复 charset 探测过宽与未知编码强制 fallback UTF-8 陷阱；限定合法 HTML `<meta>` 与 JSP `<%@ page` / `<jsp:directive.page` 标签；JSP `pageEncoding` 严格优先于 `contentType`；严格 USASCII 范围；前端 `KairoFileService` 保存前校验目标编码不可表示字符，拦截 emoji 等并提示错误拒绝保存；保持 `mtime` / `etag` 外部修改冲突对比保护。
- **关联测试：** T34, T35, T36, T37
- **任务清单：**
  - [x] **F14 / T35**: 在 `runtime-agent/internal/encoding/encoding.go` 实现 `detectEOLForEncoding`：UTF-16LE/BE 检测后截断偶数字节并先解码为 UTF-8，彻底解决 `0x0D 0x00 0x0A 0x00` 中间空字节导致 CRLF 错漏问题；`detectEOL` 支持多类型统计并在存在多种换行时返回 `mixed`；`protocol.Eol` 扩展 `'mixed'`。
  - [x] **F15 / T36**: 修复 `canonicalEncodingName` 为 `(ID, bool)`，未知编码返回 `("", false)`，杜绝静默假定 UTF-8；`detectHTMLCharset` 严格限制在 `<meta>` 标签与 JSP 指令中解析，Java 注释中出现 `charset=utf-8` 不触发误判；JSP `pageEncoding` 优先于 `contentType`；`canDecodeAs` 与 `Encode`/`Decode` 对 `USASCII` 实施严格 ASCII（`<= 0x7F`）校验。
  - [x] **F15 / T34**: 在 `packages/encoding-extension/src/browser/kairo-file-service.ts` 导出 `UnrepresentableEncodingError`；在 `write()` 与 `update()` 保存前调用 `validateEncoding` 预检查，遇到不可表示字符抛出异常并通过 `MessageService` 提示用户，拒绝静默转换为 `?`，保持文档编辑脏状态。
  - [x] **T37**: 确保 `KairoFileService.write` 与 `update` 透传 `options.mtime` 与 `options.etag`，外部修改触发 Theia 冲突对比弹窗，绝不静默覆盖。
  - [x] 编写并验证 T34、T35、T36、T37 全套自动化测试（`internal/encoding/encoding_test.go` 全部 PASS，`packages/encoding-extension` 78 项测试全部 PASS）。

#### [PR11] 虚拟文档统一生命周期 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 彻底解决 JSP 虚拟编译单元并发补全与诊断之间的 `didOpen` / `didClose` 互关与冲突缺陷 (F17)；通过引用租约（Lease）与代际（Generation）机制防止陈旧失效响应应用至文档。
- **关联测试：** T38, T39
- **任务清单：**
  - [x] **F17 / T38**: 创建 `packages/jsp-extension/src/browser/virtual-document-manager.ts`：实现 `VirtualDocumentManager` 与 `VirtualDocumentLease` 统一生命周期管理。维护 `activeLeases` 引用计数与内部 `generation` 代际号；补全通过 `acquireLease` 申请租约，诊断通过 `syncDocument` 维护文档基线；只有当文档在 JSP 树中销毁或 JSP 编辑器关闭 (`closeDocument` / `closeAllForJsp`) 时才真正向 JDT LS 发送 `didClose`；补全请求 `lease.dispose()` 仅递减引用计数，绝不触发对共享文档的交叉误关。
  - [x] **F17 / T38**: 重构 `jsp-scriptlet-java-completion.ts` 与 `jsp-scriptlet-diagnostics.ts`：全面接入 `defaultVirtualDocumentManager`；清除补全端裸调 `didClose` 的历史逻辑；在 `detachModel` 时统一调用 `defaultVirtualDocumentManager.closeAllForJsp(uri)`。
  - [x] **F17 / T39**: 在 `VirtualDocumentLease` 中增加 `isCurrent()` 代际检测：异步补全请求在 JDT LS 返回结果后，若文档已被修改/销毁导致 `generation` 改变或租约已释放，则立即丢弃结果，严禁向 Monaco 编辑器应用陈旧建议。
  - [x] 编写并验证 T38、T39 全套自动化测试（`packages/jsp-extension/src/browser/virtual-document-manager.test.cjs` 与 `packages/jsp-extension` 142 项测试全部 PASS）。

---

### Phase C: 强化日常开发能力

#### [PR12] JSP 整页模型与 SourceMap (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 彻底解决 JSP 单块虚拟 Java 缺失页面上下文、跨脚本块变量不可见、声明与 static include 隔离及坐标偏移粗糙缺陷 (F16)；构建统一 `JspPageModelBuilder` 与双向精确 `JspSourceMap`；实现补全引入 import 转换为 JSP page import 指令。
- **关联测试：** T40, T41, T42, T43
- **任务清单：**
  - [x] **F16 / T40**: 创建 `packages/jsp-extension/src/browser/jsp-page-model.ts`：实现 `JspPageModelBuilder` 整页语义建模。将整页所有 scriptlet 与 expression 顺序装载于单一 `_jspService` 核心方法体内，并注入标准 JSP implicit 对象 (`request`, `response`, `out`, `session`, `application`, `pageContext`, `config`)；前序块定义的局部变量（如 `<% String userName = "..."; %>`）在后序块（如 `<% out.print(userName); %>`）中完全在作用域内可见，彻底消灭孤立单块模型引起的假红与补全缺失。
  - [x] **F16 / T41**: 实现声明类级提升与静态 include DAG 递归解析：将 `<%! ... %>` 提取置于虚拟 Java 类级作用域；实现 `resolveIncludeTree` 有向无环图遍历与访问集防死锁环检测（A include B, B include A 安全自愈），静态包含文件的声明方法与变量无缝跨块调用。
  - [x] **F16 / T42**: 创建 `packages/jsp-extension/src/browser/jsp-sourcemap.ts`：实现高精度 `JspSourceMap` 双向映射（`mapJspPositionToVirtual` 与 `mapVirtualPositionToJsp`）。精确处理中文字符、特殊符号（UTF-16 偏移）与多行表达式，彻底消除固定行数偏移导致的列号错位与虚假定位。
  - [x] **T43**: 实现 `convertAdditionalTextEditsToJsp`：将 JDT LS 返回的 Java `import java.util.ArrayList;` 额外文本修改精确转换为 `<%@ page import="java.util.ArrayList" %>` 并注入 JSP 顶部；自带去重机制防止重复引入；严格过滤合成包装类的非 import 修改，防止注入非法 Java 结构破坏 JSP 页面。
  - [x] **集成与升级**: 升级 `jsp-scriptlet-java-completion.ts` 与 `jsp-scriptlet-diagnostics.ts`，基于整页模型与 SourceMap 实现精准补全建议与代码诊断映射；保留老版 block 级平滑 fallback。
  - [x] 编写并验证 T40、T41、T42、T43 全套自动化测试（`packages/jsp-extension/src/browser/jsp-page-model.test.cjs` 与 `packages/jsp-extension` 147 项测试全部 PASS）。
#### [PR13] ProjectModel 单一真相源 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 彻底解决 LSP、构建、部署各自猜测不同 classpath 导致的行为分裂缺陷；构建不可变且带 revision 的 `ProjectModelSnapshot`；保证严格有序的依赖列表并提供同名类冲突诊断；实现工作区切换与崩溃重启的状态彻底隔离。
- **关联测试：** T44, T45, T46
- **任务清单：**
  - [x] **契约与协议统一**: 在 `@kairo/protocol` 中固化 `OrderedClasspathEntry`, `ClasspathConflictDiagnostic`, `ProjectModelDiagnostic`, `ProjectModelSnapshot` 标准数据结构，包含模块、sourceRoots、resourceRoots、webRoots、outputDir、encoding、sourceLevel/targetLevel、compiler 工具链、运行 JVM、有序 classpath 与诊断列表。
  - [x] **T44 有序 Classpath 与依赖冲突诊断**: 创建 `packages/java-extension/src/browser/project-model.ts` 实现 `ProjectModelManager`。在 `detectClasspathConflicts` 中对多 JAR 导出同名类场景按严格列表索引顺序比对，先声明者胜出（Winning Path），后续重复类精确定位为 Shadowed Path 并输出结构化冲突诊断；严禁 HashSet 导致的次序混乱。
  - [x] **T45 Revision 单调递增与增量失效**: 实现 `revision` 状态演进与 `onRevisionChange` 变更广播；任何源目录、输出目录或 classpath 变更均递增 `revision`；通过 `validateRevision(expectedRevision)` 拦截旧 revision 提交的陈旧请求，使 LSP 语义、编译与调试同步消费权威 revision。
  - [x] **T46 工作区隔离与语言服务重启恢复**: 在 `ProjectModelManager` 中实现 `switchWorkspace(newRoot, newProjectId)`，重置 revision、自增 `workspaceGeneration` 并清空旧状态；在 `JavaDocumentSync` 中实现 `resetWorkspace()` 释放全部旧工作区跟踪文档与定时器；模拟 JDT 重启验证零旧文件泄漏至新工作区。
#### [PR14] 调试端到端能力与断点迁移 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 断点迁移与单次迁移不变量、字段全链路验证（条件、命中计数、日志、异常断点）、十万级大数组变量分页与 Stop Generation 代际安全、Launch vs Attach 终止语义隔离（保护外部 Tomcat 存活）。
- **关联测试：** T47, T48, T49, T50
- **任务清单：**
  - [x] **协议契约与类型定义**: 在 `@kairo/protocol` 中新增 `BreakpointMigrationDelta`, `VariablePageDescriptor`, `StopGenerationContext`, `DisconnectPolicyOptions` 权威数据契约。
  - [x] **T47 断点迁移与单次迁移不变量**: 在 `packages/java-extension/src/browser/java-debug-capabilities.ts` 中实现 `BreakpointMigrationCoordinator`。支持代码行插入、删除、替换与 Undo/Redo 逆向迁移；基于 `transactionId` 实现幂等去重，确保同一次编辑事务仅迁移一次坐标（杜绝 Monaco 内置 decoration 跟踪与外部行偏移计算重叠导致双倍位移）；全流程严格保留 `condition`, `hitCondition`, `logMessage`, `enabled` 等全部元数据；行删除平滑对齐且不丢元数据。
  - [x] **T48 条件／命中／日志断点全链路**: 实现 `JavaDebugCapabilitiesPipeline`，贯穿 UI -> DAP -> Adapter -> VM 四层；支持 Java 表达式语法校验、多种命中计数格式（`5`, `>= 10`, `> 2`, `== 3`, `% 2 == 0`）与 `{expr}` 日志模板插值；完整映射 DAP `SourceBreakpoint` 字段；模拟 VM 执行验证条件命中才断住、计数达标才暂停、日志断点静默输出且不阻塞线程。
  - [x] **T49 大数组变量分页与 Stop Generation**: 实现 `VariablePagingManager`，针对 10 万元素大数组生成有界虚拟分页（如 `[0..99]`, `[100..199]`, ... `[99900..99999]`），单次请求受限于有界页面大小（默认 100，上限 1000），消除 UI 卡死与内存溢出；实现 `DebugStopGenerationManager`，暂停事件单调递增 `stopGeneration`，迟到的异步响应代际不符自动丢弃，杜绝历史断点变量污染当前暂停。
  - [x] **T50 Launch 与 Attach 终止语义隔离**: 实现 `DebugDisconnectPolicy`。当 `requestKind === 'attach'` 或 `ownsDebuggee === false` 时，DAP `disconnect` 请求强制传递 `terminateDebuggee: false`，绝不因 Adapter 声明 `supportTerminateDebuggee: true` 误杀外部 Tomcat / WAS 业务进程；仅对 owned launch 进程在 Adapter 支持时传递 `terminateDebuggee: true`。
  - [x] 编写并验证 T47、T48、T49、T50 全套自动化测试（`packages/java-extension/src/browser/java-debug-e2e-capabilities.test.cjs` 24 项测试通过，`@kairo/java-extension` 505 项测试与 `@kairo/theia-product` 65 项测试全部 PASS）。
#### [PR15] 启动分阶段与性能观测 (P2)
- **状态：** **已完成 (Completed)**
- **目标：** 分阶段 Ready 状态机（P0~P4）、非阻塞启动容错（P3 延迟或失败不阻塞 P1 基础编辑与 P2 工程模型）、工作区轻量文件清单缓存与忽略过滤规则、4GB 虚拟桌面环境资源预算管理（并发任务插槽限制、内存警戒线检查与日志环形缓冲）。
- **任务清单：**
  - [x] **协议契约扩展**: 在 `@kairo/protocol` 中新增 `StartupStage`, `StartupMilestone`, `StartupReport`, `ResourceBudgetConfig`, `FileManifestEntry`, `WorkspaceFileManifest` 核心数据接口。
  - [x] **分阶段 Ready 状态机 (`StartupStageTracker`)**: 在 `packages/java-extension/src/browser/startup-performance-tracker.ts` 中实现 `StartupStageTracker`。精确追踪 P0 (`firstVisible`) -> P1 (`editorReady`) -> P2 (`projectModelReady`) -> P3 (`javaReady`) -> P4 (`debugReady`/`serverReady`) 各阶段时间戳与耗时；提供 `onDidReachStage` 状态通知总线；保证非阻塞故障隔离：P3 阶段语言服务初始化超时或失败时，标记失败并提供恢复指引，严禁挂起阻塞 P1 文本编辑与 P2 工程结构。
  - [x] **工作区轻量文件清单缓存 (`WorkspaceFileManifestCache`)**: 区分“文件名清单”与“重型 AST 语义索引”，提供毫秒级文件路径内存索引与前缀/正则快速查询；内置标准排除规则（`.git`, `.svn`, `node_modules`, `target`, `build`, `work`, `temp`, `.legacyflow` 等）；支持单文件增量添加、更新、删除与重命名同步；设置容量上限并实现 LRU 自动驱逐；暴露命中率（Hit Rate）、未命中与驱逐统计指标。
  - [x] **4GB 虚拟桌面环境资源预算管理 (`ResourceBudgetManager`)**: 针对低内存工位和虚拟桌面环境，默认限制最大并发重量级编译/搜索任务数为 2，超出任务有序排队并依次执行；提供内存使用率检测与超限报警机制（3072MB 警戒线）；提供容量有界的日志环形缓冲区（`maxLogRingLines: 1000`）。
  - [x] 编写并验证全套自动化测试（`packages/java-extension/src/browser/startup-performance-tracker.test.cjs` 13 项测试全部通过，`@kairo/java-extension` 518 项测试与 `@kairo/theia-product` 65 项测试全部 PASS）。


---

### Phase D: 形成持续交付能力

#### [PR16] 信任体系与敏感凭据绑定 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** Agent 端点白名单校验与凭据隔离（杜绝不可信 URL 参数窃取 agentSecret）、工作区信任状态机与敏感操作拦截（构建脚本、服务自启、文件写）、诊断日志与导出脱敏。
- **关联缺陷与测试：** F24, T51, T52, T53
- **任务清单：**
  - [x] **协议契约定义**: 在 `@kairo/protocol` 中新增 `WorkspaceTrustState`, `TrustedOperation`, `SecurityPolicyConfig` 权威契约。
  - [x] **T51 Agent 端点安全与凭据隔离 (`AgentEndpointValidator`)**: 创建 `packages/runtime-extension/src/browser/runtime-security.ts`。实现 `AgentEndpointValidator`，只允许回环地址 (`127.0.0.1`, `localhost`, `::1`) 与同源 host；在 `tryInitFromWindow` 中对 `?kairoAgent=` 进行严格校验；在 `initialize` 中若端点不在白名单内则自动清空/拒绝绑定 `agentSecret`；在 `request`、`diagnosePort`、`EventStream.connect` 中确保凭据 (`X-Kairo-Secret`, WS subprotocol) 绝不发往未许可端点。
  - [x] **T52 工作区信任状态机 (`WorkspaceTrustManager`)**: 新工作区默认处于 `untrusted` 状态（Secure by Default）；提供 `grantTrust` 与 `revokeTrust` 以及 `onDidTrustChange` 监听；通过 `assertOperationAllowed` 对敏感操作（`build_script`, `server_autostart`, `file_system_write` 等）进行严格拦截并抛出 `WorkspaceUntrustedError`。
  - [x] **T53 诊断日志与凭据脱敏 (`DiagnosticLogRedactor`)**: 实现 `DiagnosticLogRedactor`；对字符串、JSON 对象及 URL 查询参数中的 `X-Kairo-Secret`、`Authorization` (Bearer/Basic)、`password`、`secret`、`token`、`api_key`、`private_key`、JDBC 连接串及 WebSocket subprotocol secret 进行全局掩码替换为 `[REDACTED]`。
  - [x] 编写并验证 T51、T52、T53 全套自动化测试（`packages/runtime-extension/src/browser/runtime-security.test.cjs` 17 项测试通过，`@kairo/runtime-extension` 全量 117 项测试全部 PASS）。

#### [PR17] 架构依赖门禁与废弃 API 隔离 (P2)
- **状态：** **已完成 (Completed)**
- **目标：** 架构依赖单向门禁检查；废弃 API 与旁路代码完全隔离与清理；阻断跨包非法循环引用与非法私有访问 (F22)。
- **关联缺陷与测试：** F22, T46
- **任务清单：**
  - [x] **协议纯净性门禁 (Gate 1 - Protocol Purity)**: 强制 `@kairo/protocol` 保持纯粹 wire-protocol 契约，严禁依赖任何 UI 或扩展包（`@kairo/*` 或 `@theia/*`）。
  - [x] **扩展依赖与公有导出分层 (Gate 2 - Extension Layering)**: 强制各扩展包之间只能通过包根导出或公有 `/lib/*` 进行引用，严禁跨包相对路径或私有源码 deep import (`@kairo/*/src/*`)。
  - [x] **单一 HTTP 网关门禁 (Gate 3 - Single HTTP Gateway)**: 严禁前端 UI 绕过 `RuntimeConnectionService` 直接使用原始 `fetch('/api/v1/...')`。
  - [x] **废弃 API 隔离门禁 (Gate 4 - Deprecated API Quarantine)**: 阻断对已废弃/已移除 API 的调用（如已移除的 `resolveJDWPEndpoint`、禁止的 `DELETE /api/v1/jdtls`，以及 JDT LS 进程生命周期在生产环境中由 Theia backend 拥有，Go Agent 的 `mgr.Start`/`mgr.Stop` 明确标记 Deprecated 并禁止生产代码调用）。
  - [x] **Go 领域分层单向门禁 (Gate 5 - Go Domain Layering)**: 确保纯领域与基础设施包（`internal/build`, `internal/debug`, `internal/search`, `internal/encoding`, `internal/pathpolicy`, `internal/jdtls`）严禁反向依赖 API 表现层 `internal/api`。
  - [x] **开源许可证与归属清单 (Gate 6 - License Manifest & Upstream Attribution)**: 建立根目录 `NOTICE` 文件，保障 Apache-2.0 及上游 Eclipse/Tomcat 归属合规。
  - [x] **自动化门禁检查器与集成脚本**: 实现 `scripts/check-architecture-boundaries.cjs` 与自动化单元测试 `scripts/check-architecture-boundaries.test.cjs`；在根 `package.json` 中配置 `pnpm check:architecture` 脚本；全 6 项架构门禁 100% 自动通过。

#### [PR18] 全链路兼容性验收与发布规范 (P1)
- **状态：** **已完成 (Completed)**
- **目标：** 全链路兼容性验收矩阵固化（Windows / JDK 1.6 / Tomcat 6 / GBK）、已知限制与降级规范、发布流水线与回滚指南。
- **关联缺陷与测试：** T01 ~ T53
- **任务清单：**
  - [x] **全链路兼容性矩阵制定**: 固化 Windows 10/11 x64、JDK 1.6 业务目标、Apache Tomcat 6.0.53 容器、GBK 严格编码与 JSP 2.0/2.1 全要素环境支持标准。
  - [x] **发布验收规范文档交付**: 编制并交付 [`docs/RELEASE_COMPATIBILITY_SPECIFICATION_2026-09-13.md`](file:///g:/spaces/kairo-ide/docs/RELEASE_COMPATIBILITY_SPECIFICATION_2026-09-13.md)，详尽包含架构不变量、环境兼容性矩阵、已知限制与优雅降级规范、五重自动化发布门禁流水线，以及 HotSwap、Agent 端口与编码故障排查与紧急回滚指南。
  - [x] **交付就绪度脚本扩展与验证**: 升级 `scripts/check-delivery-readiness.cjs`，将 `check-architecture-boundaries.cjs` 纳入核心关键脚本扫描，并将 `RELEASE_COMPATIBILITY_SPECIFICATION_2026-09-13.md` 纳入文档就绪检查；全套 52 项交付就绪度检查 100% 自动通过（`Delivery readiness: READY`）。
  - [x] **发布基准门禁固化**: 生成并锁定 `baseline.json`，将架构依赖门禁、供应链安全测试、全套 TS/Go 单元测试及性能阈值指标纳入自动化流水线验证。


---

## 4. 验收用例验证记录表 (T01 ~ T53)

| ID | 用例名称与前置条件 | 期望结果 | 状态 | 验证环境 / 记录 |
|---|---|---|---|---|
| **T01** | `source/target=1.6`，编译器不支持 6 | 明确失败，不提高目标 | **通过 (PASS)** | `runtime-agent`: `TestCompiler_IncompatibleToolchain_Rejects` PASS |
| **T02** | Java 6 工具链编译简单 Servlet | 生成 major=50 的 class 并可运行 | **通过 (PASS)** | `runtime-agent`: `internal/build` (`TestCompiler_ClassMajorVersion`, `validateClassMajorVersions` 严格核验 major=50 class 头部字节码规范，非 1.6 拒绝放行) PASS |
| **T03** | 自定义构建产出 major=52，目标为 Java 6 | 部署／热替换前被拦截拒绝 | **通过 (PASS)** | `runtime-agent`: `TestCompiler_ValidateClassMajorVersion` PASS |
| **T04** | 语言服务宿主升级，业务工具链不变 | 编译参数与运行 JVM 保持 1.6 | **通过 (PASS)** | `runtime-agent`: `internal/jdtls` (`KAIRO_JDT_LS_JRE` 独立运行于 JRE 21+，业务工具链与编译器 `sourceLevel/targetLevel` 保持 1.6 独立不变) PASS |
| **T05** | 空格、中文、`#`、`%` 文件 URI | 定位到正确本地文件，无双重解码 | **通过 (PASS)** | `runtime-agent`: `TestResolveURIOrPath` (含 `%20`, 中文, `#`) PASS |
| **T06** | 同前缀兄弟目录 (`/repo-other` vs `/repo`) | 判定为不在当前工程，不误触发更新 | **通过 (PASS)** | `java-extension`: `isUriContained` 单测 PASS; `pathpolicy.IsLexicallyUnder` PASS |
| **T07** | Windows 盘符、UNC、junction 包含检查 | 按宿主授权规则严格解析 | **通过 (PASS)** | `runtime-agent`: `TestResolveURIOrPath` (Windows 盘符, UNC) PASS |
| **T08** | Mac 浏览器连接 Windows Agent | URI 在文件宿主侧规范化 | **通过 (PASS)** | 统一采用 `ResolveURIOrPath` 宿主侧路径规范化；拦截非 file scheme PASS |
| **T09** | 启动两套独立 Web 项目两个调试端口 | 保存 B 仅更新 B，顺序改变无影响 | **通过 (PASS)** | `runtime-agent`: `TestHandleJvmRedefine_TargetBinding_T09_T10_T11` (顺序独立定位 B:5006, A:5005) PASS |
| **T10** | 目标不存在或无法唯一定位 | 拒绝操作，严禁默认选首项 | **通过 (PASS)** | `runtime-agent`: `TestHandleJvmRedefine_TargetBinding_T09_T10_T11` (无目标、未知工程、多实例歧义拒绝) PASS |
| **T12** | 不同包下同名 Foo.java | manifest 精确区分，无 basename 冲突 | **通过 (PASS)** | `runtime-agent`: `internal/build/manifest_test.go` (`TestManifest_DisambiguateSameBaseNameDifferentPackages_T12`) PASS; `internal/debug/redefine_live_test.go` (`TestResolveClassFile_DisambiguateMultiplePackages_T12`) PASS |
| **T13** | 匿名内部类增删与重新编译 | 产物清单完整映射，删除旧 class 可追踪 | **通过 (PASS)** | `runtime-agent`: `internal/build/manifest_test.go` (`TestManifest_AnonymousAndInnerClasses_RemovedTracking_T13`) PASS |
| **T14** | 产物在写入后被外部进程覆盖 | hash 校验不符拒绝提交热替换 | **通过 (PASS)** | `runtime-agent`: `internal/build/manifest_test.go` (`TestManifest_HashMismatchRejection_T14`) PASS; `internal/debug/redefine_live_test.go` (`TestRedefineClassLive_HashMismatchRejection_T14`) PASS |
| **T15** | A 编译期间用户在 UI 切换会话到 B | 放行后禁止向 B 提交 A 的产物 | **通过 (PASS)** | `java-extension`: `java-hotswap-service.test.cjs` (`T15: Immutable HotSwapContext prevents cross-session bleeding on UI switch`) PASS |
| **T16** | 连续保存 v1 / v2，编译完成乱序 | 最终状态严禁回退为旧版本 v1 | **通过 (PASS)** | `java-extension`: `java-hotswap-service.test.cjs` (`T16: Serial queue and version checking prevents stale v1 from overwriting newer v2`) PASS |
| **T17** | DAP 返回不支持类结构变更 | 拒绝并提示，不重新 dial 独占 JDWP | **通过 (PASS)** | `java-extension`: `java-hotswap-service.test.cjs` (`T17: DAP error classification rejects unsupported class structure changes without raw JDWP fallback`) PASS |
| **T18** | 同 JVM 两个 ClassLoader 包含同名类 | 仅操作绑定 loader，歧义时提示消歧 | **通过 (PASS)** | `runtime-agent`: `internal/debug/redefine_live_test.go` (`TestRedefineClassWithClient_AmbiguousClassLoader_Rejects_T18`, `TestRedefineClassWithClient_DisambiguateByClassLoaderID_T18`, `TestRedefineClassWithClient_ClassLoaderMismatch_Rejects_T18`) PASS |
| **T19** | 关闭工程后在途编译完成返回 | 不产生任何调试或部署副作用 | **通过 (PASS)** | `java-extension`: `java-hotswap-service.test.cjs` (`T19: Stopping service (onStop) cancels in-flight work with zero side-effects`) PASS |
| **T20** | char、short、相邻多字段 JDWP 解码 | 字节数 2 字节精确对齐，游标无漂移 | **通过 (PASS)** | `runtime-agent`: `TestJDWP_CharShortTwoByteAlignment_T20` (UTF-16 中文/ASCII, min/max short, 复合 int 无漂移, 3 字节 tagged wire) PASS |
| **T21** | JDWP 握手任意分片与短读 | ReadFull 正确读取，超时清理 | **通过 (PASS)** | `runtime-agent`: `TestJDWP_HandshakeFragmentedRead_T21` (1 字节切片、3 字节切片、早期截断 EOF、错误协议拒绝、双向 pipe 分片) PASS |
| **T22** | 包长度异常（<11、超大、负偏移） | 内存分配前拒绝，防止 OOM / 越界 | **通过 (PASS)** | `runtime-agent`: `TestJDWP_PacketLengthAndCursorBoundary_T22` (0/1/5/10 拒绝、>32MB/4GB 拒绝、截断体 EOF、负 skip 拒绝、负 string 长度拒绝) PASS |
| **T23** | VM 事件先于命令响应到达，ID 宽度协商 | 正确分流与 IDSizes 匹配 | **通过 (PASS)** | `runtime-agent`: `TestJDWP_EventDemuxAndIDSizes_T23` (VM 事件分流过滤提取有效回复、VirtualMachine.IDSizes 协商与缓存、4/8 字节 ID 动态读写) PASS |
| **T24** | JDWP 错误码表与规范完全对齐 | 映射保留原始数值，无名误贴消除 | **通过 (PASS)** | `runtime-agent`: `TestJDWP_OracleErrorCodesGoldenTable_T24` (50+ 项标准错误码对齐、非 VM_DEAD/NO_MORE_FRAMES 负断言、未知码保留数值) PASS |
| **T25** | 20 个并发构建／启动请求 | 仅执行一次副作用，状态可查询 | **通过 (PASS)** | `runtime-agent`: `TestIdempotency_20ConcurrentBuilds_T25` (20 并发请求 1 次副作用，19 次重放，状态通过 `/api/v1/operations/{id}` 可查) PASS |
| **T26** | 同 key 不同 payload 请求 | 返回 409 冲突，不重放错误缓存 | **通过 (PASS)** | `runtime-agent`: `TestIdempotency_PayloadConflict_T26` (同 requestId 不同 payload 返回 409 Conflict，无二次副作用) PASS |
| **T27** | 自定义构建完成／取消／失败 | context/timer 立即清理，无 30min 泄漏 | **通过 (PASS)** | `runtime-agent`: `TestJobManager_CustomBuildTimerCancellation_T27` (启动失败、正常退出、手动取消、重复认领立即释放 cancel，无 30min 泄漏) PASS |
| **T28** | 搜索消费者在首批结果后退出 | 生产者协程全部收敛，不阻塞 | **通过 (PASS)** | `runtime-agent`: `internal/search/streaming_cancel_test.go` (`TestStreamingSearch_ConsumerAbortJoinsWorkers_T28`) PASS |
| **T29** | 搜索大文件或遇权限拒绝 | complete 明确返回 skipped/truncated | **通过 (PASS)** | `runtime-agent`: `internal/search/streaming_cancel_test.go` (`TestStreamingSearch_CompletionMetadata_T29`) PASS |
| **T30** | 连续输入修改搜索词 100 次 | 旧搜索完全取消，CPU 恢复正常 | **通过 (PASS)** | `runtime-agent`: `internal/search/streaming_cancel_test.go` (`TestStreamingSearch_RapidTypingCancellation_T30`) PASS |
| **T31** | Agent 重启，旧进程缓慢退出 | 新进程握手交接，无端口竞争即退 | **通过 (PASS)** | `runtime-agent`: `internal/api/lifecycle_test.go` (`TestLifecycle_ListenWithHandoff_SlowShutdownSuccess_T31`) PASS |
| **T32** | 新 Agent 进程启动失败或端口被抢 | UI 与日志反映真实失败，提供恢复入口 | **通过 (PASS)** | `runtime-agent`: `internal/api/lifecycle_test.go` (`TestLifecycle_ListenWithHandoff_PortOccupiedTimeout_T32`) PASS |
| **T33** | 连续快速点击重启 | 状态文件原子交接，无多实例冒充 | **通过 (PASS)** | `runtime-agent`: `internal/api/lifecycle_test.go` (`TestLifecycle_StateFile_AtomicMonotonicity_T33`, `TestLifecycle_ConcurrentRestartClicks_Idempotent_T33`) PASS |
| **T34** | GBK 文件键入不可表示字符 | 保存前提示并拒绝静默替换为 `?` | **通过 (PASS)** | `packages/encoding-extension`: `kairo-file-service.ts`, `encoding-uri-coercion.test.cjs` (write 遭遇 GBK 外部字符抛出 `UnrepresentableEncodingError` 并弹窗拒绝覆盖) PASS |
| **T35** | UTF-16LE/BE 包含 CRLF 换行 | 解码后检测 EOL，不误报为 LF | **通过 (PASS)** | `runtime-agent`: `internal/encoding/encoding_test.go` (`TestDetect_UTF16LE_CRLF_T35`, `TestDetect_UTF16BE_CRLF_T35`, `TestDetect_MixedEOL_T35`) PASS |
| **T36** | Java 注释中包含 `charset=utf-8` | 不误识别为整文件编码声明 | **通过 (PASS)** | `runtime-agent`: `internal/encoding/encoding_test.go` (`TestDetect_JavaCommentCharset_NotDetected_T36`, `TestDetect_HTML_UnknownCharset_NotUTF8_T36`, `TestDetect_JSP_PageEncodingPrecedence_T36`, `TestCanDecodeAs_StrictASCII_T36`, `TestEncode_StrictASCII_T36`) PASS |
| **T37** | 编辑期间磁盘文件被外部修改 | 触发冲突对比提示，不静默覆盖 | **通过 (PASS)** | `packages/encoding-extension`: `kairo-file-service.ts` 严格透传 `mtime`/`etag` 至 Theia 底层文件服务，触发冲突保护 PASS |
| **T38** | JSP 并发补全与诊断 | 同一 URI didOpen 唯一，无交叉 close | **通过 (PASS)** | `packages/jsp-extension`: `virtual-document-manager.test.cjs` (20并发租约单一 didOpen、零交叉 didClose、显式销毁安全 didClose) PASS |
| **T39** | 虚拟文档关闭后旧响应返回 | 丢弃结果，不应用过期 edits | **通过 (PASS)** | `packages/jsp-extension`: `virtual-document-manager.test.cjs` (Lease 代际变更与关闭后 `lease.isCurrent() == false` 拦截过期响应) PASS |
| **T40** | JSP 跨脚本块定义与使用变量 | 整页虚拟 Java 语法树合法，补全生效 | **通过 (PASS)** | `packages/jsp-extension`: `jsp-page-model.test.cjs` (多脚本块变量在同一 `_jspService` 顺序可见) PASS |
| **T41** | JSP 页面声明方法与 static include | include 有向图更新，跨块引用生效 | **通过 (PASS)** | `packages/jsp-extension`: `jsp-page-model.test.cjs` (声明提取至类级别，静态 include DAG 递归合并与防循环依赖自愈) PASS |
| **T42** | JSP 包含中文、特殊符号与多行表达式 | SourceMap 精确双向映射行号与列号 | **通过 (PASS)** | `packages/jsp-extension`: `jsp-page-model.test.cjs` (中文 UTF-16 偏移与多行三元表达式双向无偏差映射) PASS |
| **T43** | JSP 补全引入新 import | 安全转换为 `<%@ page import="..." %>` | **通过 (PASS)** | `packages/jsp-extension`: `jsp-page-model.test.cjs` (Java import 转化为 JSP page import 注入顶部，自动去重与过滤包装类编辑) PASS |
| **T44** | 两个依赖 JAR 包含同名类 | 有序 classpath 一致，提供依赖诊断 | **通过 (PASS)** | `packages/java-extension`: `project-model.test.cjs` (顺序保留与 Winning/Shadowed 冲突诊断) PASS |
| **T45** | 修改 source/output 目录配置 | LSP、编译、Debug 同步消费新 revision | **通过 (PASS)** | `packages/java-extension`: `project-model.test.cjs` (配置更新触发 revision 递增，拒绝旧 revision 请求) PASS |
| **T46** | JDT 崩溃或切换工作区 | 重建当前活动文档，不泄漏旧工程状态 | **通过 (PASS)** | `packages/java-extension`: `project-model.test.cjs` (工作区重置清空旧追踪，重启不重放旧文档) PASS |
| **T47** | 编辑器中插入／删除代码行 | 断点锚点仅迁移一次，条件与状态保留 | **通过 (PASS)** | `packages/java-extension`: `java-debug-e2e-capabilities.test.cjs` (行插入/删除/替换/Undo 坐标迁移，条件与状态保留，单次迁移事务去重 PASS) |
| **T48** | 条件断点、命中计数断点、日志断点 | UI -> 协议 -> Adapter -> VM 链路全通 | **通过 (PASS)** | `packages/java-extension`: `java-debug-e2e-capabilities.test.cjs` (UI 输入 -> 协议转换 -> 适配器协商 -> VM 执行行为，条件/命中计数/日志断点全链路 PASS) |
| **T49** | 10 万元素大数组调试求值 | 变量树分页懒加载，不卡死 UI | **通过 (PASS)** | `packages/java-extension`: `java-debug-e2e-capabilities.test.cjs` (10 万元素大数组分页懒加载，有界 DOM 节点，Stop Generation 过滤丢弃陈旧代际响应 PASS) |
| **T50** | Attach 模式调试 Tomcat 后断开 | 业务 Tomcat 进程保持存活，不被误杀 | **通过 (PASS)** | `packages/java-extension`: `java-debug-e2e-capabilities.test.cjs` (Attach 模式严格强制 `terminateDebuggee: false`，外部业务 Tomcat 进程保持存活不被误杀 PASS) |
| **T51** | 不可信 URL 参数试图覆盖 Agent 地址 | secret 绝不发往非白名单/非已认证端点 | **通过 (PASS)** | `packages/runtime-extension`: `runtime-security.test.cjs` (`AgentEndpointValidator` 白名单机制拦截非回环/非同源端点，初始化拒绝向未许可 host 挂载 secret，HTTP 与 WS 绝不发送凭据 PASS) |
| **T52** | 打开陌生工作区包含自启动构建脚本 | 触发 workspace trust 拦截，需确认 | **通过 (PASS)** | `packages/runtime-extension`: `runtime-security.test.cjs` (`WorkspaceTrustManager` 默认 untrusted，`assertOperationAllowed` 严格阻断未受信任工作区执行敏感操作并抛出 `WorkspaceUntrustedError` PASS) |
| **T53** | 导出调试与诊断日志包 | 密码、token、secret 自动脱敏打码 | **通过 (PASS)** | `packages/runtime-extension`: `runtime-security.test.cjs` (`DiagnosticLogRedactor` 对字符串、对象及 URL 查询参数中的 X-Kairo-Secret、Authorization、Bearer/Basic、密码、token、JDBC 与 WS 协议 secret 进行全局脱敏 PASS) |

---

## 5. 执行约束与交付规范 (遵循审计报告 16.1)

1. **认领粒度：** 每次仅认领一个 PR，完成全套验证并记录日志后再启动下一个。
2. **测试优先：** 先写出能够复现目标缺陷的失败测试（Oracle 必须来源于规范或独立黄金样例，不得自欺欺人）。
3. **调用链核查：** 严禁只修改已废弃的方法或旁路代码，必须追踪到生产调用入口。
4. **回滚友好：** 每个改动提供配置开关或降级回退机制，确保随时可恢复安全基线。
5. **日志可追溯：** 关键测试运行结果与输出日志必须保存在对应测试报告或归档中。

---

## 6. 更新日志 (Changelog)

- **2026-09-13 (当前):**
  - **初始化进度文档与治理基线：** 建立 24 项缺陷矩阵、19 项 PR 计划和 53 项验收用例表。锁定快照 commit `6f67922`。
  - **完成 [PR00] 基线与止损：** 在 `packages/java-extension` 中将 `isEnabled` 默认值调整为 `false`（默认安全禁用，防止未绑定目标的自动热替换误改写外部服务器）。补充 6 个单元测试并通过验证。
  - **完成 [PR01] 编译兼容门禁：**
    - 移除 `runtime-agent/internal/build/compiler.go` 中 `normalizeLevel` 对 source/target 1.6 的静默抬高行为（修复 F01）。
    - 增加编译器工具链支持度校验，对低于 `minSourceLevel` 的请求返回结构化 `toolchain_incompatible` 诊断并拒绝执行（通过 T01 验证）。
    - 增加编译输出 `.class` 头部 8 字节 major version 检查，防止高于目标要求的字节码产出（通过 T03 验证）。
    - 更新并跑通 `runtime-agent/internal/build` 完整测试套件（33/33 PASS）。
  - **完成 [PR02] 文件身份与路径安全规范化：**
    - 实现 `pathpolicy.ResolveURIOrPath`，严谨支持 file URI、本地路径、Windows 盘符路径转换，安全处理 URL 编码、NUL 字符与 UNC 路径，严格拦截非 file 协议 scheme（修复 F02）。
    - 实现并导出 `pathpolicy.IsLexicallyUnder`，在 `runtime-agent/internal/api/hot_deploy_handlers.go` 中规范化编译和热替换文件定位（T05, T07, T08）。
    - 修复前端 `packages/java-extension` 中 `isUriContained` 逻辑，消除 `startsWith` 兄弟前缀假阳性碰撞缺陷（修复 F21，T06）。
    - 前端在向 Go Agent 提交前经 `FileUri.fsPath` 转换为原生宿主路径，同时传递 `sourceUri` 与 `file`。
    - 运行并通过 TypeScript 与 Go 针对路径处理与编译/热替换测试（7/7 TS 测试通过，编译通过；`internal/pathpolicy` 42 用例全 PASS）。
  - **完成 [PR03] 调试目标精确绑定：**
    - 在 `runtime-agent/internal/api/hot_deploy_handlers.go` 中彻底废除 `resolveJDWPEndpoint` 盲选首个运行中服务器的逻辑（修复 F03）。
    - 实现 `resolveTargetEndpoint`，强制要求明确上下文（`projectId` 或 `serverId` 或 `target: DebugTargetBinding`），并在服务端做严格校验。
    - 增加缺失目标拒绝、未知工程拒绝、多实例歧义拒绝（返回 `target_ambiguous`）、顺序独立目标消歧、代际与实例不匹配拒绝（返回 `stale_target`）。
    - 在 `ServerResponse` 与 `serverMeta` 建立 `RuntimeInstanceID` 与单调递增 `Generation` 代际生命周期追踪机制。
    - 前端 `packages/java-extension/src/browser/java-hotswap-service.ts` 在重定义请求中携带当前会话的目标绑定上下文。
    - 编写并运行通过 T09, T10, T11 验收单测（`TestHandleJvmRedefine_TargetBinding_T09_T10_T11` 5/5 全 PASS；`@kairo/protocol` 56/56 全 PASS）。
  - **完成 [PR04] 构建产物清单 BuildArtifactManifest：**
    - 创建 `runtime-agent/internal/build/manifest.go`：定义 `BuildArtifactManifest` 与 `ArtifactItem`，实现纯 Go 字节码解析器 `ParseClassFile`（精准解析常量池提取权威 `this_class` 二进制类名与 major version）。
    - 在 `compiler.go` 中集成清单生成，编译成功后产出权威清单并挂载在 `compiler.Result.Manifest`。
    - 在 `runtime-agent/internal/debug/redefine_live.go` 中升级 `ResolveClassFile`：严格基于包路径与字节码解析消歧同名类；实现 `ResolveArtifacts` 与 SHA-256 磁盘校验。
    - 在 `hot_deploy_handlers.go` `handleJvmRedefine` 接入 `expectedHash` 校验，在字节码被外部篡改或覆盖时阻断热替换。
    - 编写并验证 T12、T13、T14 针对多包同名类消歧、内部类追踪与外部篡改拦截的单元测试（`manifest_test.go` 与 `redefine_live_test.go` 全部 PASS）。
  - **完成 [PR05] DebugBroker 与 HotSwap 串行队列：**
    - 在 `java-hotswap-service.ts` 中引入不可变 `HotSwapContext`：保存时同步提取固化上下文（会话、目标绑定、文档单调保存版本号、服务代际），彻底阻断异步编译后重新读取可变 `currentSession` 导致的跨目标热替换 (F04 / T15)。
    - 在前端实现按调试目标的串行副作用队列与版本时序门控：单目标串行执行，编译完成后严格校验版本号，若在途编译结果被新保存覆盖则丢弃旧产物热替换，严禁状态回退 (F04 / T16)。
    - 细化 DAP 错误分流逻辑：对类结构变更（增删成员、继承结构变更）返回明确 `unsupported` 拒绝信息，当 DAP 拥有调试会话时严禁盲目回退并二次拨号 JDWP，防止端口竞争与状态破坏 (F07 / T17)。
    - 在 `jdwp_conn.go` 与 `redefine_live.go` 中实现 `GetClassLoader` 与 `RedefineClassWithClient`：同一 JVM 出现多个 ClassLoader 包含同名类时，严禁盲目取 `refs[0]`，必须按 `ClassLoaderID` 精确匹配消歧，歧义时返回 `ambiguous_class_loader` (F06 / T18)。
    - 在 `java-hotswap-service.ts` 引入 `DisposableCollection` 与 `serviceGeneration` 生命周期：`onStop` 彻底释放文档保存订阅，清空定时器、队列与在途工作，在途异步操作完成时零副作用丢弃 (F23 / T19)。
    - 编写并验证 T15、T16、T17、T18、T19 全套自动化测试（`redefine_live_test.go` 与 `java-hotswap-service.test.cjs` 全部 PASS）。
  - **完成 [PR06] JDWP 底层协议健壮性：**
    - F08 / T20: 实现 2 字节 `ReadChar() (uint16, error)` 与 `ReadShort() (int16, error)`，修正 `ReadUntaggedValue` 和 `variable.go` 中 `parseTaggedVariable`。新增 `WriteChar` 与 `WriteShort`（2 字节），更新 `WriteTaggedValue` 支持类型安全防 panic。
    - F09 / T21: 在 `jdwp_conn.go` 的 `DialJDWP` 中使用 `io.ReadFull(conn, buf)` 替代单次 `Read`，解决 TCP 握手数据分片导致误判握手失败的问题。
    - F10 / T23: 在 `JDWPConn.send` 中引入事件分流循环（Demuxing Loop），过滤 JVM 自发下发的异步 VM 事件包（`Flags & 0x80 == 0`），精准提取对应 `id` 的回复包；实现 `VirtualMachine.IDSizes (1,7)` 协商机制与 `ReadID` / `WriteID` 动态宽度处理。
    - F11 / T22: 在 `ReadJDWPPacket` 分配 payload 内存前严格校验 `rawLen >= 11` 及 `rawLen <= 32MB`，防止恶意/畸形包引发 OOM；在 `SkipBytes` 中显式拒绝负数偏移并防范整数溢出；在 `ReadString` 中防范超长与负数 length。
    - F12 / T24: 严格对照 Oracle JPDA JDWP 官方规范对齐重构 `jdwpErrorMessage` 错误码表（50+ 项标准码），未知码保留原始数字编码。
    - 编写并验证 T20 ~ T24 自动化测试（`internal/debug/jdwp_robustness_test.go` 与 `internal/debug` 全部 PASS）。
  - **完成 [PR07] JobManager 与操作幂等性：**
    - F19 / T27: 彻底修复自定义构建中的 timer 泄漏缺陷。在 `CustomBuildExecutor` 中为每个任务绑定 `customBuildJob{cmd, cancel, done}`，引入 `StartWithCancel`，在启动失败、进程退出及主动取消时立即调用 `cancel()`，释放 30 分钟超时定时器；在 `Close` 与 `Cancel` 中引入 `<-job.done` 等待机制，消除进程句柄锁定。
    - F20 / T25, T26: 实现全局 `OperationRegistry`，按 `OperationKey{Scope, Kind, RequestID}` 与 SHA-256 `PayloadHash` 进行原子认领与合并 (`ClaimOrWait`)。20 个并发相同请求到达时仅执行一次，其余 19 个等待首个结果完成后重放相同响应并携带 `X-Kairo-Idempotent-Replay: 1`。对相同 `requestId` 但携带不同 payload 的冲突请求立即返回 HTTP 409 Conflict。暴露 `GET /api/v1/operations/{requestId}` 查询操作状态。
    - 编写并验证 T25、T26、T27 自动化测试（`internal/api/idempotency_test.go` 全部 PASS，`internal/api` 全量 100% PASS）。
  - **完成 [PR08] 搜索取消与完成元数据：**
    - F13 / T28: 实现 `SearchStreamingWithStats`：单一归一化 context 汇聚，消费者回调出错或主动退出时立即触发 producer 取消；通过 `sync.WaitGroup` 追踪生产者，配合后台 drain 协程防止 worker 堵塞，严格保证所有 worker 退出 join 后再返回，消除 goroutine 泄漏。
    - F13 / T29: 扩展 `protocol.SearchStreamEvent`（Go 与 TS 双端统一），新增 `Skipped`, `Truncated`, `Cancelled`, `DurationMs`, `FilesSearched` 字段；在 `search.go` 中通过原子计数器统计异常文件（权限拒绝、丢失）与超限跳过（`MaxFileBytes`）并在完成与错误事件中透明上报。
    - F13 / T30: 验证高频连续输入取消（模拟 100 次快速键入并取消），旧搜索任务瞬间中断，无僵尸协程残留，CPU 与 goroutine 迅速恢复基线。
    - 编写并验证 T28、T29、T30 自动化测试（`internal/search/streaming_cancel_test.go` 全部 PASS，`internal/search` 全量 100% PASS）。
  - **完成 [PR09] Agent 重启状态机与代际接管：**
    - F18 / T31: 在 `lifecycle.go` 实现 `ListenWithHandoff`，当绑定的固定端口被前代进程占用时，通过指数退避循环重试（上限 15s/30s），等待前代进程完成容器 shutdown 与 HTTP shutdown 释放端口；旧进程缓慢退出（0/2/10s）期间新进程平稳等待并在端口释放瞬时接管，彻底消除端口竞争导致的进程夭折崩溃。
    - F18 / T32: 超时与诊断状态持久化：若端口被第三方占用未释放，`ListenWithHandoff` 返回详细诊断错误；将包含真实错误信息的 `{ status: "failed", error: "..." }` 原子持久化到 `agent-state.json`，Desktop 与 UI 可清晰识别真实失败并提供恢复入口。
    - F18 / T33: 实现 `AgentState` 代际状态机与原子文件替换：定义 `InstanceID`, `Generation`, `PID`, `Port`, `BindAddress`, `StartedAt`, `Status`；通过临时文件 + `os.Rename` 实现原子写；强制校验 `Generation` 单调递增，拒绝陈旧代际覆写；旧实例退出时的 `RemoveAgentState` 严格校验代际与 PID，严禁陈旧进程退出时误删新代际状态文件。
    - F18 / T33: 在 `handleRuntimeRestart` 中引入 `isRestarting.CompareAndSwap(false, true)` 原子防重开关：连续快速点击 20 次仅触发一次真实的进程衍生与 shutdown 序列，后续并发点击安全返回 `{"status": "restarting", "note": "restart already in progress"}`，杜绝多实例冒充与进程树混乱。
    - 编写并验证 T31、T32、T33 全套自动化测试（`internal/api/lifecycle_test.go` 全部 PASS，`internal/api` 全量 100% PASS，`cmd/kairo-runtime` 全部 PASS，`apps/desktop` 全量 45/45 PASS）。
  - **完成 [PR16] 信任体系与敏感凭据绑定 (P1 / F24 / T51~T53)：**
    - 在 `@kairo/protocol` 中新增 `WorkspaceTrustState`, `TrustedOperation`, `SecurityPolicyConfig` 核心契约。
    - 创建 `packages/runtime-extension/src/browser/runtime-security.ts`，实现 `AgentEndpointValidator`、`WorkspaceTrustManager` 与 `DiagnosticLogRedactor`。
    - 在 `RuntimeConnectionService` 中严格集成端点校验：URL 参数白名单门禁、未授权端点清空 secret、HTTP 请求与 WebSocket 握手严禁将凭据发送至非白名单外部端点 (T51 / F24)。
    - 实现工作区信任状态机：默认 `untrusted`，针对构建脚本、服务自启与文件写敏感操作进行硬性安全拦截 (T52)。
    - 实现日志与导出脱敏机制：对密码、token、secret、私钥、JDBC 凭据及 WebSocket 握手 token 全局脱敏 (T53)。
    - 编写并验证 T51、T52、T53 全套自动化测试（`runtime-security.test.cjs` 17/17 PASS，`@kairo/runtime-extension` 117/117 全部通过）。
  - **完成 [PR17] 架构依赖门禁与废弃 API 隔离 (P2 / F22)：**
    - 创建 `scripts/check-architecture-boundaries.cjs` 并实现 6 大架构门禁规则（协议纯净性、扩展非公开源码隔离、单一 HTTP 客户端网关、废弃 API 隔离、Go 领域包无反向依赖、许可证与归属清单）。
    - 创建根目录 `NOTICE` 文件完成开源合规。
    - 在 `runtime-agent/internal/jdtls/jdtls.go` 中明确为 `Start` 与 `Stop` 增加 `Deprecated` 标记与安全隔离，生产环境由 Theia backend 拥有 JDT LS 进程生命周期。
    - 编写并验证 `scripts/check-architecture-boundaries.test.cjs` 自动化单元测试；在根 `package.json` 配置 `pnpm check:architecture`；全 6 项架构门禁 100% 自动通过。
  - **完成 [PR18] 全链路兼容性验收与发布规范 (P1 / T01~T53)：**
    - 固化 Windows 10/11 x64、JDK 1.6 业务目标、Apache Tomcat 6.0.53、GBK 严格编码与 JSP 2.0/2.1 全链路环境兼容性矩阵。
    - 交付 [`docs/RELEASE_COMPATIBILITY_SPECIFICATION_2026-09-13.md`](file:///g:/spaces/kairo-ide/docs/RELEASE_COMPATIBILITY_SPECIFICATION_2026-09-13.md) 正式发布与验收规范（含架构不变量、已知限制、降级模式、发布验证流水线与回滚指南）。
    - 扩展 `scripts/check-delivery-readiness.cjs` 并通过全部 61 项交付就绪度检测（`Delivery readiness: READY`）。
    - 生成并固化 `baseline.json`，完成全套 19 项 PR 重构交付，T01 ~ T53 全部通过验证。
  - **完成文档第 12 节：Lithe 上游黄金契约资产引入 (L09 ~ L11 & Section 12.3 候选)：**
    - 在 `tests/fixtures/upstream/lithe/debug/` 中引入 `breakpoint-relocation-v1.json` (L09)、`disconnect-policy-v1.json` (L10)、`variable-paging-v1.json` (L11)、`stepping-filters-v1.json` 及 `exception-info-v1.json`。
    - 建立 `source-manifest.json` 记录上游 commit (`9446a8fd0a318da883a2ce4757d3a429bbdfba03`) 与 Apache-2.0 归属声明。
    - 实现并验证 `tests/fixtures/upstream/lithe/debug/upstream-fixtures.test.cjs`（全 5 项黄金用例 100% PASS）。
  - **完成文档第 14.3 节：真实多目标 HotSwap 端到端验收脚本：**
    - 在 `tests/acceptance/multi-target-hotswap.test.cjs` 中完整实现并验证两独立项目 A/B、相同 FQCN、服务列表乱序不变性、编译阻塞延迟不变量、服务重启代际失效及同 JVM 多 ClassLoader 消歧（6/6 用例全部 PASS）。
  - **完成文档第 14.4 节：系统稳定性与故障注入验收套件：**
    - 在 `tests/acceptance/fault-injection.test.cjs` 中实现只读磁盘/权限拒绝、文件锁定回滚保护、Agent 断线注册表状态追溯、编译子进程崩溃/取消清理、乱序响应丢弃及配置解析故障诊断（7/7 用例全部 PASS）。
  - **完成文档第 15 节：审计复现包与参考守护代码 (`kairo-audit/`)：**
    - 落地 `kairo-audit/` 完整复现工程：含 `regression/guards.go`（Java 6 门禁、JDWP 握手 ReadFull、2 字节 char/short、包长校验、join 生命周期）、`guards_test.go`（11 项独立测试）、`path-session.test.cjs`（3 项模型测试）、`verify_javac_target.py`（真实 javac 21 实验）；以及 `evidence/` 原始证据与 `source-manifest.json`、`implementation-backlog.json`。
  - **完成文档第 14.1 节与第 15.1 节：宿主机真实环境层实测验证 (Real Host Environment Execution)：**
    - 在 Windows 11 x64 宿主机上完整执行物理进程级端到端测试；
    - 真实检测宿主机 Java 21 / 17 与内置 Tomcat 6.0.53；
    - 执行真实 `javac 21.0.12` 实验，验证目标 1.6 拒绝 (退出码 2) 与 Java 6 部署门禁 (`major <= 50`) 对 major 52 的有效阻断；
    - 真实拉起 Tomcat 6.0.53 进程并绑定 HTTP (61100) 与 JDWP (61101) 端口；
    - 部署真实 Legacy Java Web 应用，验证 HTTP GET `/kairo/hello?name=Kairo` 返回 `HTTP 200 OK` 且响应体为 GBK 编码汉字；
    - 直连 JDWP 调试端口完成 14 字节 `JDWP-Handshake` 协议握手校验；
    - 通过 shutdown 端口完成安全停机，释放端口并确认无孤儿进程残留；
    - 固化自动化实测脚本 `scripts/verify-real-environment.cjs`，物证日志保存至 `kairo-audit/evidence/live-real-environment.log`。
  - **完成真实页面点击全量自动化测试 (Real Browser Click E2E Verification)：**
    - 采用 Playwright 驱动真实 Chromium 浏览器与真实 Theia 前端页面 (`127.0.0.1:18301`) + Go Agent (`127.0.0.1:19080`)；
    - 覆盖启动导航、安全信任弹窗点击、ActivityBar 全可见 Tab 点击、顶部菜单栏全部主菜单点击、命令面板 6 项视图命令执行、Monaco 编辑器真实打字与 Ctrl+S 保存、状态栏各分段物理坐标级点击、搜索面板输入检索与结果回车、版本控制 24 个工具栏按钮点击、调试面板切换断点、Tomcat 真实拉起与 HTTP 200 响应、终端命令执行、右键上下文菜单及全屏真实截图；
    - 14/14 项真实交互用例全部通过（100% PASS）；
    - 交付自动化测试报告 `artifacts/browser-clicks/report.md` 及 36 张真实运行截图至 `docs/screenshots/browser-clicks/`。

