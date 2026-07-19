# Kairo IDE Post-Wave2 架构收敛、清理重构与发布级测试总任务书

> 文档用途：直接交给 DeepSeek V4 Pro 多 Agent 团队执行  
> 审计基线：`main` / `8be4e86`  
> 审计日期：2026-07-19  
> 上游设计基线：`docs/REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`、`docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md`  
> 本文性质：增量审计结论、架构裁决、代码删除清单、开发合同和验收合同  
> 当前状态：`main` 不是绿色基线，不允许继续宣称 Wave2 已完成或进入发布阶段

---

## 0. 给执行团队的结论与强制约束

今天的开发修复了很多真实问题，包括 Desktop 三进程启动、动态端口发现、preload 注入、Tomcat 启停、Windows 进程身份校验、安全 DTO、原子写、前端 Store 快照和事件订阅。这些成果应保留。

但是，当前代码没有完成上一份总任务书要求的“架构收敛”。在 `f8abe48` 这个明确标记为 `wip` 的提交中，约 9430 行强类型 application/use-case 代码和对应测试被删除；生产系统继续使用 `internal/services/services.go + json.RawMessage + JSON 整体存储`。与此同时，ADR-0011、ADR-0012、MILESTONES、DELIVERY 和最终报告仍描述已经被删除或没有接入生产的架构。

当前形成了四套互相冲突的事实：

1. `docs/architecture.md` / ADR-0011 声明 domain + typed use case + repository + provider；
2. 生产入口实际使用 `api.ServerRunner` 等 `json.RawMessage` 接口和 1700 行 `services.go`；
3. `internal/repository`、`internal/runtimeplan`、`internal/provider/runtime` 等包仍存在并有测试，但不进入最终二进制；
4. `DELIVERY.md` / `MILESTONES.md` 引用已删除文件并记录过期测试结果。

本轮目标不是继续增加新功能，而是先建立唯一、可运行、可解释的产品架构，并把主分支恢复为全绿。

### 0.1 强制规则

1. 从 `main@8be4e86` 创建 `feature/post-wave2-convergence`，禁止直接向 `main` 提交 WIP。
2. 第一阶段只修红灯和确定架构，不开发 Remote Server、插件系统、DAP、Class HotSwap、亮色主题或 SQLite。
3. 不得通过删除失败测试、降低断言、增加无条件 skip、catch 后返回空值、保留“绿色 stub job”等方式制造通过。
4. JSON 只允许存在于 HTTP/WS adapter 和持久化 codec 边界；业务服务不得接收或返回 `json.RawMessage`。
5. 前端只保留一个 RuntimeConnectionService、一个 WebSocket 和一个 Theia frontend composition root。
6. 客户端不得提交 `projectRoot`、`javaHome`、`webappDir`、`target`、`CatalinaBase` 等执行路径；路径必须由 Agent 根据 workspace/project/toolchain ID 解析。
7. 所有报告的“完成”必须来自本轮重新执行的命令和真实行为证据，不能复制以前报告中的结论。
8. Mac 交叉编译、FakeProcess 和 Windows ARM VM 不能替代目标 Windows 10 x64 真机验收。

---

## 1. 本次独立验证结果

以下命令已在 `main@8be4e86`、macOS arm64 上独立执行。

| Gate | 实际结果 | 当前问题 |
|---|---:|---|
| `go vet ./...` | 通过 | 仅代表 vet 未发现错误 |
| `go test -count=1 -timeout 300s ./...` | **失败** | `internal/search` 4 个回归测试失败 |
| `gofmt -l` | **失败** | `cmd/kairo-runtime/main.go`、`internal/tomcat6/tomcat6.go` |
| `pnpm build` | **失败** | encoding recode 的协议 response 被定义为 `void` |
| `pnpm test` | **失败** | Theia command test 缺少 `BuildStore` binding |
| `pnpm lint` | **失败** | 根包没有安装 `eslint`，也没有 ESLint 配置 |
| `git diff --check` | 通过 | 无空白符错误 |
| 工作区状态 | 干净 | 失败不是本地未提交文件造成的 |

### 1.1 Search 回归的根因

`internal/search/search.go` 新增“检测到系统 `rg` 就直接调用 ripgrep”的快速路径，但该路径没有保持原有 Search 契约：

- 一行多个 regex match 只计为一条；
- 没有应用 `DefaultExcludes`，会搜索 `node_modules`；
- 返回绝对路径，而纯 Go 路径返回相对路径；
- 没有 GBK/GB18030 解码策略；
- 不生成 `Column`、`Replacement`、context before/after；
- `--no-messages` 会隐藏部分文件错误；
- 使用文本 `file:line:text` 格式，在 Windows 盘符和包含冒号的内容上不可靠；
- `rgAvailable` 被 `sync.Once` 全局缓存，测试和运行时环境切换困难。

因此这不是“测试没更新”，而是生产行为回归。不得修改测试来适配残缺结果。

### 1.2 TypeScript 编译失败的根因

`packages/protocol/src/index.ts` 将：

```ts
'POST /api/v1/encoding/recode': { request: EncodingRecodeRequest; response: void };
```

定义为 `void`，但生产 `KairoEncodingServiceImpl.recode()` 声明返回：

```ts
Promise<{ ok: true; bytes: number }>
```

必须增加共享 `EncodingRecodeResponse` 并同步 Go DTO/handler/contract test，不能用 `as any` 绕过。

### 1.3 Theia 测试失败的根因

`KairoViewsContribution` 新增了 `BuildStore` 注入，但命令测试手工构造的容器没有绑定它。这同时暴露出测试方式不正确：测试重复手工列举依赖，不能证明正式 frontend module 能被 Theia 容器加载。

应新增 composition smoke test：加载正式唯一模块，解析全部 contribution、store、widget factory，并检查没有 missing/ambiguous binding。

---

## 2. 对最初设计目标的符合度裁决

### 2.1 已符合、应保留的部分

1. **Theia + Go Runtime Agent 一级架构正确。** 不重写 IDE 内核，不改为 Electron 主进程直接执行 Java/Tomcat。
2. **Desktop 三进程方向正确。** Electron main 管理 Theia backend 和 Go Agent，renderer 不直接 spawn 进程。
3. **Agent loopback + 每次会话随机 secret 方向正确。** secret 通过子进程环境传递，没有放在命令行参数。
4. **preload/contextIsolation 方向正确。** 已替代 `did-finish-load + executeJavaScript` 的错误注入时序。
5. **Tomcat 使用 `proc.ManagedProcess` 方向正确。** Windows identity、Job Object、taskkill fallback 代码值得保留。
6. **安全 API DTO 方向正确。** `serverMetaResponse` 和 `api.ServerResponse` 采用字段白名单，不直接序列化内部运行计划。
7. **Atomic file package 方向正确。** 应成为全仓唯一原子写原语。
8. **桌面优先、Remote 暂停方向正确。** `apps/server` placeholder 已删除，这是合理收缩。
9. **BuildStore/ServerStore 有上限并订阅真实事件方向正确。** 需要进一步统一 WebSocket 所有权。
10. **ActiveProject 替代 `projects[0]` 方向正确。** 需要完成持久化和导入闭环。

### 2.2 部分符合、仍需重构的部分

1. Tomcat 能启动，但当前 `realServerRunner` 仍接受客户端提供的 JavaHome、WebappDir、端口等路径/执行参数，违反“客户端只提交 ID 和意图”。
2. Windows identity 已实现，但正式 Server 生命周期没有使用 ADR-0011 的 typed command、generation、desired/observed state 和持久化一致性模型。
3. Safe DTO 已实现两套：一套服务于当前 legacy runner，一套服务于已删除的 ServerUseCase。需要只保留生产所需的一套。
4. Event 多订阅覆盖问题局部修复，但代码中同时存在 `subscribeEvents()` 和独立 `EventStream`；当前至少会建立三条 WebSocket。
5. DI 已尝试补齐，但 `bindKairoFrontend()` 本身绑定服务，`product-frontend.ts` 随后又调用 `bindKairoProduct()`，存在重复 binding 和多 composition root。
6. Desktop 通过解析 Theia 日志发现端口可以作为临时兼容策略，但长期应使用明确的启动 API/IPC ready message，而不是依赖日志文本格式。
7. 搜索引入 ripgrep 是正确性能方向，但实现只覆盖了原契约的一小部分，当前必须修正。

### 2.3 不符合、必须重新设计的部分

1. **业务层仍是 RawMessage God Service。** `internal/api/services.go` 和 `internal/services/services.go` 继续承担 transport、业务编排、路径解析、持久化和 response encoding。
2. **强类型架构被删除但 ADR 未废止。** 不能一边删除 use case，一边继续把 ADR-0011 标为 Accepted 和已完成。
3. **生产存在一批未链接包。** `catalinabase`、`deploy`、`pathpolicy`、`provider/runtime`、`repository`、`runtimeplan` 不在 `go list -deps ./cmd/kairo-runtime` 的生产依赖中。
4. **测试资产被大规模删除。** Server persistence、log cursor、Windows lifecycle、core integration 等测试连同实现一起删除，安全回归门槛下降。
5. **文档体系失真。** MILESTONES/DELIVERY 引用已删除文件；ADR、最终报告和代码互相矛盾。
6. **CI 本身不可执行或会制造假绿。** Windows runner 使用 Unix 环境变量前缀和 bash `for`；contract job 是永远成功的说明文字；Go 版本 1.22/1.23 混用；lint 命令没有依赖。

---

## 3. 最终架构裁决：采用“轻量垂直切片”，不恢复两套极端方案

本轮不应在以下两个错误极端中二选一：

- 极端 A：继续保留 1700 行 `services.go`、RawMessage、全局 map 和双重 JSON 解析；
- 极端 B：原样恢复此前 9000 多行通用 DDD/use-case/provider/repository scaffold，即使只有一个 Tomcat 和两个 build provider。

目标采用轻量垂直切片架构：每个核心业务包拥有强类型 Service、Plan 和 Repository；HTTP 层只负责 DTO 映射；底层能力保持具体、可测试，不提前建设第三方插件框架。

```text
runtime-agent/internal/
  api/                 HTTP/WS adapter、request/response DTO、错误映射
  workspace/           WorkspaceService + WorkspaceRepository
  project/             ProjectService + canonical project.yaml repository
  buildsvc/            BuildService + BuildPlan + history + Ant/Javac adapter
  deploysvc/           DeployService + DeployPlan + sync adapter
  serversvc/           ServerService + RuntimePlan + history + lifecycle
  search/              SearchService + pure Go/rg backend
  encoding/            EncodingService
  toolchain/           ToolchainService + registry
  proc/                OS process supervision
  tomcat6/             concrete Tomcat 6 execution adapter
  atomicfile/          single cross-platform atomic writer
  security/            workspace sandbox/auth
  transport/events/    one EventHub/WS transport
```

### 3.1 层次规则

1. `api` 可以依赖各业务 Service 接口和 DTO mapper。
2. Service 接收强类型 command/query，返回强类型 result；不得返回 JSON bytes。
3. Repository 负责 schema、atomic write、corruption recovery 和 migration；读操作绝不写磁盘。
4. 执行路径只存在于 Agent 内部的 trusted plan；HTTP request 只包含 workspaceId/projectId/serverId/buildId 和意图。
5. `proc`、`tomcat6`、`deploy` 是可复用技术原语，不了解 HTTP。
6. 只有出现第二个真正 ServerRuntime 时再抽象 provider registry；v1 不建设动态 runtime plugin。

### 3.2 持久化裁决

本轮不迁移 SQLite。Desktop 单用户数据规模小，SQLite 不能自动解决双真相和业务契约错误。

v1 规则：

- canonical project config：项目目录内 `.kairo/project.yaml`；兼容读取 `.legacyflow/project.yaml`，保存时一次性迁移；
- workspace catalog、build/server/deploy history：DataDir 下按实体拆分、带 schemaVersion 的原子 JSON；
- 每个写操作 temp + fsync + atomic replace；错误必须上抛；
- 损坏文件隔离为 `.corrupt-<timestamp>` 并返回可见诊断；
- 限制 history 数量并实现清理；
- 只有未来恢复 Remote 多用户并出现事务/查询需求时再通过 Repository 接口迁移 SQLite。

---

## 4. 删除、归档、迁移清单

### 4.1 立即从 Git 删除

| 对象 | 动作 | 原因 |
|---|---|---|
| `runtime-agent/kairo-runtime` | 删除并加入 `.gitignore` | 12 MB macOS arm64 编译产物，不应进入源码仓库，也不能用于 Windows |
| `artifacts/windows-wave2/**` | 从 Git 删除；CI 证据改用 Actions artifact | 运行证据和环境快照不属于长期源码，可能携带机器信息；仓库已出现 30+ 个临时证据文件 |
| `apps/browser/src/index.ts` 中 deprecated `configureKairoRuntime` | 唯一模块稳定后删除 | 当前无调用方，保留会重新加载 product module 并产生重复 binding |
| `RuntimeConnectionService.connectEvents/disconnectEvents` legacy API | consumer 全部迁移后删除 | 会强关所有订阅者连接，和新订阅模型重复 |
| `EventStream` 或 `subscribeEvents` 其中一套 | 只保留 Service 管理的单例实现 | 当前多个 owner 建立多条 WebSocket，状态/重连/序号不统一 |
| 重复的 `KairoProduct`/default module/binder | 合并后删除多余文件或 export | 当前至少三套 composition 入口，容易重复 singleton/binding |
| `packages/theia-product` 的 `start:server` 及根 `dev:server` | Remote 暂停期间删除或改为显式 experimental 且仅 loopback | 当前绑定 `0.0.0.0`，与桌面优先和安全 fail-closed 冲突 |

### 4.2 归档而不是继续作为当前事实

将以下文档移动到 `docs/archive/2026-07-19-wave2/`，保留历史，不再让实现 Agent 当作当前任务：

- `docs/progress/PHASE0_BLOCKED.md`
- `docs/progress/PHASE0_UNBLOCK_STEPS.md`
- `docs/progress/WINDOWS_WAVE2_W1_HINT_BUILD_WIN.md`
- `docs/progress/WINDOWS_WAVE2_W2_AUDIT.md`
- `docs/progress/WINDOWS_WAVE2_W2_DESIGN.md`
- `docs/progress/WINDOWS_WAVE2_W3_AUDIT.md`
- `docs/progress/WINDOWS_WAVE2_W3_DESIGN.md`
- `docs/progress/WINDOWS_WAVE2_W6_DOD_STATE.md`
- `docs/progress/WINDOWS_WAVE2_W6_FILE_OWNERSHIP_AUDIT.md`
- 当前 skeleton/旧版 Windows final report

`docs/progress/` 最终只保留当前状态报告和最新一次可复现 Gate 结果。

### 4.3 不得直接删除，必须“接入或迁移后删除”的包

以下包虽然当前不进入生产二进制，但包含有价值逻辑。Integration Agent 必须逐包裁决，不允许因为 `go list -deps` 不可达就整目录删除：

| 包 | 推荐裁决 |
|---|---|
| `internal/deploy` | 接入 `deploysvc`，删除 `services.go` 内重复同步实现 |
| `internal/pathpolicy` | 接入所有 ID/路径入口，作为 sandbox 前置验证 |
| `internal/runtimeplan` | 迁移 PortAllocator/Lease 到 `serversvc`，生产接入后删除无用 registry/fake |
| `internal/catalinabase` | 迁移 ownership/layout/preparer 到真实 server plan，删除重复 CatalinaBase 拼接 |
| `internal/repository` | 选择可用 repository/atomic 逻辑并迁入垂直业务包；禁止与旧 store 双写 |
| `internal/provider/runtime` | 将真实需要的 Tomcat provider 行为迁入 `serversvc/tomcat6 adapter`；只有一个 runtime 时删除通用 registry |
| `internal/domain` | 保留跨切片稳定 ID/value types；删除只服务已废弃通用框架的类型 |

### 4.4 应恢复测试意图，但不应原样恢复旧实现

从历史提交 `a9072fa`、`7bec1da` 或删除前版本提取以下测试场景，迁移到新 `serversvc/buildsvc`：

- running 状态持久化失败必须停止已启动进程；
- port exhaustion 和 lease release；
- readiness timeout 清理；
- PID reuse/identity mismatch 不得 signal；
- Agent shutdown 回收完整进程树；
- monotonic log cursor + gap；
- restart generation/ID continuity；
- concurrent start/stop/restart serialization；
- build cancel 真正取消进程并持久化 terminal state；
- corrupted history recovery；
- deploy traversal/symlink/mirror delete 安全。

---

## 5. 分阶段实施任务

## Wave 0：恢复可信绿色基线

### W0-1 修 Search 回归

二选一，优先方案 A：

**方案 A（短期推荐）**：暂时删除自动 ripgrep 快速路径，恢复纯 Go Search 为唯一实现；增加 benchmark 后再合入完整 rg adapter。

**方案 B（完整实现）**：使用 `rg --json`，不得解析 `file:line:text`；实现：

- submatches 逐个计数并计算 UTF-8/rune column；
- DefaultExcludes + caller includes/excludes；
- Windows 盘符和非 UTF-8 路径；
- GBK/GB18030：明确调用 `--encoding` 或对非 UTF 文件回退 Go decoder；
- replacement preview；
- context lines；
- max results/cancel；
- errors/gap/truncated；
- 与 pure-Go backend 的 contract conformance test，两套 backend 对同一 fixture 输出等价结果。

### W0-2 修协议和 TS build

1. 新增 `EncodingRecodeResponse { ok: true; bytes: number }`。
2. 更新 EndpointMap、Go protocol DTO、handler 返回值、前端 service。
3. 增加 TS compile-time contract test 和 Go HTTP contract test。
4. 禁止 `as any`、`as unknown as` 绕过。

### W0-3 修 Theia test 和 composition test

1. 临时补齐旧命令测试的 BuildStore dependency，使现有测试恢复。
2. 新增正式 composition smoke test：加载唯一 frontend module，解析 contributions、stores、services、widgets。
3. 检查同一 identifier 没有 ambiguous bindings，singleton 获取两次是同一对象。
4. 测试 command execution 使用 fake RuntimeGateway，不只检查字符串注册。

### W0-4 格式化、lint、CI 基础

1. 对全部 Go 文件执行 gofmt。
2. 安装并固定 ESLint + TypeScript parser/config，或明确删除 lint Gate 并用 `tsc --noEmit` 替代；禁止保留无法执行的 script。
3. Go 版本统一为 `go.mod`、CI、文档同一版本。
4. Windows job 使用 `shell: pwsh` 合法语法；不使用 `VAR=value command` 和 bash `for`。
5. 跨编译只放在 Linux/bash job，Windows runner 执行本机 `go test` 和真实 PowerShell E2E。
6. Windows `-race` 若缺少受支持 C toolchain，不得伪装；race 放 Linux/macOS，Windows 运行普通测试和真实进程测试。
7. 删除永远退出 0 的 `contract-test (stub)`；实现真实 contract test 后再恢复 job。

### Wave 0 Gate

```bash
cd runtime-agent
gofmt -l $(rg --files -g '*.go')   # 输出必须为空
go vet ./...
go test -count=1 -timeout 300s ./...
go test -race -count=1 -timeout 420s ./...

cd ..
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
git diff --check
```

所有命令必须 exit 0，失败时不得进入 Wave 1。

## Wave 1：文档与产品范围收敛

1. 创建 ADR-0013：DeploymentOwnerToken capability（当前代码注释引用但文档不存在）。
2. 创建 ADR-0014：Desktop + localhost Browser 为 v1；Remote Linux Server 延后。
3. 创建 ADR-0015：轻量垂直切片取代 God Service 和未接线通用 DDD scaffold。
4. 新 ADR supersede ADR-0004 第三层 LegacyFlow runtime plugin；v1 只保留 Theia extensions 和 Go 内部 adapter。
5. 更新 `product-requirements.md`：Remote、DAP、动态插件、Class HotSwap 不再是桌面 v1 发布阻塞项；保留后续路线图。
6. 更新 `architecture.md` 的目录、进程模型、真实 composition root、协议来源和 deployment forms。
7. 重写 `MILESTONES.md`、`DELIVERY.md`，只记录当前文件和本轮重跑证据。
8. README 删除 `apps/server`、LegacyFlow plugin 和不存在的命令/目录描述。

### Wave 1 Gate

- 任一 Accepted ADR 描述的生产包必须在 `go list -deps ./cmd/kairo-runtime` 或前端实际入口中可达；否则标为 Proposed/Deprecated。
- 文档中不得引用已删除文件作为 current implementation。
- `rg "apps/server|internal/app/server_impl|LegacyFlow runtime plugin" README.md docs/{architecture.md,product-requirements.md,MILESTONES.md,DELIVERY.md}` 的剩余命中必须是明确的历史/延期说明。

## Wave 2：Go 后端轻量垂直切片重构

### W2-1 Project 单一真相

1. Workspace open/register 后将 root 加入 sandbox。
2. Import Wizard/scan 创建 canonical `.kairo/project.yaml`。
3. ProjectRepository 负责 defaults、schema version、legacy migration、validation 和 atomic save。
4. ProjectID 是 opaque ID，不得被当作路径。
5. Toolchain 通过 ID 引用，执行前重新校验路径和 fingerprint。

### W2-2 拆分 `services.go`

按业务切片迁移，每迁移一个 endpoint 就删除 `services.go` 对应代码，不长期双写：

1. workspace/project/toolchain；
2. search/encoding；
3. build；
4. deploy；
5. server；
6. auth/JDT descriptor。

目标：`services.go` 最终删除，或只剩不超过 200 行 composition helper；`api/services.go` 不再出现 `json.RawMessage` 业务接口。

### W2-3 Server 生命周期

必须保留以下安全属性，但实现不必恢复过度通用框架：

- ServerID 独立于 ProjectID；restart 保持 logical ServerID；
- Start/Stop/Restart 同一 server 串行；
- RuntimePlan 只由 Agent 解析；
- 端口分配 + PortLease 真实进入生产；
- CatalinaBase ownership + safe cleanup；
- proc identity 在 signal 前 fail-closed；
- Windows Job Object；
- 启动/持久化失败回滚；
- Agent clean exit 停止托管 Tomcat；
- 状态和事件一致；
- bounded log ring + monotonic sequence/gap。

不要宣称 crash 后跨 Agent reattach，除非有真实 Windows/Linux 进程重新附着测试。v1 可采用更安全的规则：clean exit 全部停止，crash 后记录 orphan diagnostic，用户显式清理/重启。

### W2-4 Build/Deploy

- Build command 只含 IDs/intent；BuildPlan 内部解析 source roots、classpath、output、toolchain；
- Ant 为遗留项目优先 provider；raw javac 先保证全量正确，不做时间戳伪增量；
- Cancel 必须取消 OS 进程；
- DeployPlan 明确 classes → `WEB-INF/classes`、libs → `WEB-INF/lib`、web resources → context root；
- static sync 与 Java class reload 在 UI/协议中明确区分；
- mirror delete 必须限制在 Kairo-owned deployment root。

### Wave 2 Gate

- `go list -deps ./cmd/kairo-runtime` 包含所有被 Accepted ADR 声明为生产能力的业务包。
- HTTP handler 以 typed DTO 调用 typed Service。
- `rg "json.RawMessage" runtime-agent/internal` 只允许出现在 HTTP/WS codec 和兼容 migration reader。
- build/deploy/server E2E request 不包含绝对执行路径。
- 删除 legacy runner 和重复 store 前，全部行为测试已迁移。

## Wave 3：前端 composition、事件和状态单一化

### W3-1 唯一 frontend module

1. 以 `kairo-product-frontend-module.ts` 或新的 `frontend-module.ts` 为唯一默认 Theia frontend module。
2. 服务、store、widget、contribution 每个只 bind 一次。
3. 删除 `product-frontend.ts` / `product-bindings.ts` 中重复职责，保留最小 export facade。
4. 删除 deprecated `configureKairoRuntime`。
5. 用真实 module composition test 代替手工重复 dependency list。

### W3-2 唯一 RuntimeGateway / EventStream

目标 API 示例：

```ts
interface RuntimeGateway {
  request<E extends Endpoint>(endpoint: E, request: RequestOf<E>, init?: RequestInitOf<E>): Promise<ResponseOf<E>>;
  subscribe(type: WsEvent['type'] | '*', handler: (event: WsEvent) => void): Disposable;
  onStatus(handler: (status: RuntimeStatus) => void): Disposable;
}
```

- RuntimeConnectionService 内部拥有唯一 socket；
- stores、views、status bar、log viewer 全部调用 subscribe；
- 支持 sequence replay、gap、jitter、连接 open 时 snapshot refresh；
- workspace 切换时重新订阅；
- 最后一个 subscriber dispose 后可延迟关闭；
- 删除 `openEvents()` 新建 socket 和 legacy connect/disconnect API。

### W3-3 Store/UI

- BuildStore/ServerStore 只注入一个 runtime 字段，删除重复注入；
- snapshot 和 event reducer 使用共享 typed mapper；
- ActiveProject 持久化 last selection，多项目时明确选择；
- Import Wizard 真正保存配置并显示校验错误；
- Deployment widget 改为 ReactWidget，补 `data-testid`、ARIA 和 capped render；
- Log viewer 批量刷新、bounded buffer、gap 提示，不引入新虚拟滚动库，除非低配基准不通过。

### Wave 3 Gate

- 整个 renderer 对 Agent 只有一条 WebSocket；
- composition test 无 missing/ambiguous bindings；
- Build、Server、Log 同时订阅互不覆盖；
- workspace 切换不会保留旧 workspace 状态；
- 5000 条日志压力测试不阻塞 UI，内存有界。

## Wave 4：Desktop 主链与真实 Contract/E2E

1. Desktop 启动 Agent → 等待真实 health → 启动 Theia → 接收明确 ready/port → 创建 BrowserWindow。
2. 失败时终止已启动子进程，显示可行动错误；禁止孤儿进程。
3. quit 时 bounded graceful shutdown，超时后 kill tree。
4. Agent secret 威胁模型写清楚：它防止其他本机网页/进程随意调用 loopback Agent，但不能防御已经获得 renderer/XSS 执行能力的攻击者。
5. 如果要让 renderer 不接触 secret，需要增加 Theia backend BFF/proxy；没有实现前不得在文档中声称 secret 对 renderer 不可读。
6. 用真实协议测试启动 Go Agent，覆盖所有 EndpointMap 路由、method、status、DTO 和错误码。
7. Playwright 必须从 UI 执行 import/build/deploy/start/restart/stop/GBK 保存，不得用 direct API 替代主要步骤。
8. JDT completion/definition/diagnostics 和 DAP 分开记账；JDT 没有真实证据前不能标 done。

---

## 6. Mac 上模拟/验证 Windows 的三级方案

### Level A：Mac 原生静态和交叉验证（每次提交）

能验证：

- `GOOS=windows GOARCH=amd64/arm64` 编译；
- Windows build tags、syscall symbol、类型和依赖是否可编译；
- TypeScript/协议/纯逻辑测试；
- Electron Windows 配置的静态检查；
- PowerShell 脚本可用 PSScriptAnalyzer 做部分语法检查。

不能验证：NTFS rename/file lock、Job Object、taskkill、console control event、NSIS/UAC、Windows Defender、JDK6/Tomcat6 实际进程树、低配性能。

### Level B：Mac 上 Windows 11 ARM 虚拟机（高频集成验证）

Apple Silicon Mac 可以运行 Windows 11 ARM64 VM。可使用任一可靠虚拟化软件，并从微软官方 Windows 11 Arm64 ISO 创建虚拟机。推荐配置成目标约束：2 vCPU、4 GB RAM；仓库复制到 VM 内部 NTFS 磁盘，不要只在共享文件夹中运行，以便暴露真实 Windows 文件锁和路径行为。

VM 内安装：

- Git；
- Node 20；
- pnpm 9；
- Go 项目规定版本；
- JDK 17/21（运行 JDT LS）；
- 用户导入的 JDK 6 和 Tomcat 6 fixture；
- 不依赖管理员权限的常规开发工具。

VM 每日执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:agent
pnpm --filter @kairo/desktop build:win
powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1
```

VM 能较真实验证 Windows API、NTFS、PowerShell、Electron/NSIS 和进程树。但 Windows 11 ARM 与目标 Windows 10 x64 仍不同；x64 Node/Electron/JDK6 可能运行在模拟层，因此性能和兼容性不能作为最终发布证据。

### Level C：GitHub Actions Windows runner（持续自动验证）

配置 `windows-latest` x64 job，用 PowerShell 原生运行：

- Go unit tests；
- TypeScript build/tests；
- Windows agent build；
- Tomcat fixture smoke；
- installer build；
- 安装后启动/退出进程证据；
- artifact 上传，而不是提交到 Git。

GitHub Windows runner 适合自动回归，但其资源、权限、系统版本和目标 2 vCPU/4 GB/无管理员云桌面不同，不能替代目标环境性能和安装验收。

### Level D：目标 Windows 10 x64 真机（Release Gate，不能省略）

以下项目必须回到真实 Windows 10 x64、2 vCPU/4 GB、无管理员权限机器验收：

1. NSIS 安装、升级、卸载和残留；
2. Electron + Theia + Agent + Tomcat 的完整 PID tree；
3. Job Object 在正常退出和 Electron crash 后的子进程回收；
4. PID reuse/identity mismatch fail-closed；
5. Windows Defender/杀毒软件导致的 rename、binary、下载锁定；
6. JDK6 32/64 位、Tomcat 6、中文路径、长路径、空格路径；
7. GBK/GB18030 与 CRLF 原样保存；
8. 企业代理、无管理员权限、受限 TEMP/HOME；
9. 冷启动、内存、completion、build、search 性能预算；
10. breakpoint/JDWP（进入对应里程碑后）。

Docker Desktop for Mac 运行的是 Linux VM，不能运行原生 Windows 容器或提供 Windows 内核，因此不用于上述 Windows 验收。Wine/CrossOver 也不能证明 Job Object、NSIS、NTFS 和真实 JDK/Tomcat 行为。

---

## 7. 多 Agent 执行组织与文件所有权

建议最多 5 个并行角色，Integration Lead 独占共享文件：

| Agent | 范围 | 禁止同时修改 |
|---|---|---|
| A：Baseline/CI | Search 回归、protocol recode、tests、CI、gofmt/lint | 不改业务架构 |
| B：Backend Convergence | Project/Build/Deploy/Server typed slices | 不改 frontend/CI |
| C：Frontend Convergence | DI、RuntimeGateway、Event、Stores、Widgets | 不改 Go domain |
| D：Desktop/E2E | Electron lifecycle、Playwright、packaging | 不改 protocol shape |
| E：Integration Lead | protocol、composition root、docs、最终 merge/gates | 不开发大块 feature |

规则：

- `packages/protocol/src/index.ts`、`runtime-agent/internal/api/**`、composition root、lockfile、CI、MILESTONES 由 Integration Lead 合并；
- 每个 Agent 使用独立 branch/worktree；
- 每个 Wave 一个可回滚提交序列，禁止 `wip` 提交进入 main；
- 合并前必须 rebase/merge 最新 integration branch 并重跑本范围测试；
- Integration Lead 必须独立执行 Gate，不接受“其他 Agent 说通过”。

---

## 8. 最终 Definition of Done

### 架构

- [ ] 生产没有 RawMessage business interface。
- [ ] `services.go` God Service 已删除或只剩最小 composition helper。
- [ ] Project config 只有一个 canonical truth。
- [ ] 所有 Accepted ADR 与生产依赖图一致。
- [ ] 未接线的重复 provider/repository/runtimeplan 已迁移或删除。
- [ ] Remote/动态插件没有混入桌面 v1。

### 后端

- [ ] Search 两种 backend contract 等价，或只保留正确的一种。
- [ ] Build/Deploy/Server request 不接受绝对执行路径。
- [ ] Server port lease、identity、persistence rollback、shutdown cleanup 有行为测试。
- [ ] JSON/YAML 写入原子、错误可见、损坏可恢复。
- [ ] 安全 DTO 不泄漏路径、env、JVM secrets、marker、shutdown port。

### 前端

- [ ] 唯一 frontend composition root。
- [ ] 唯一 RuntimeGateway 和唯一 WebSocket。
- [ ] 无重复 singleton/ambiguous binding。
- [ ] ActiveProject、多项目选择、Import Wizard 真正闭环。
- [ ] Build/Server/Log/Status 同时更新且断线状态诚实。

### 测试

- [ ] Go fmt/vet/unit/race 全绿。
- [ ] pnpm build/test/lint 全绿。
- [ ] Linux/macOS/Windows CI 使用各自合法 shell。
- [ ] contract job 执行真实 Agent，不是 echo stub。
- [ ] Playwright 核心步骤无 gated/skip/direct API 替代。
- [ ] Windows ARM VM 日常测试通过。
- [ ] Windows 10 x64 真机 Release Gate 通过。

### 文档与仓库卫生

- [ ] 删除 tracked runtime binary。
- [ ] 运行 artifacts 不再提交 Git。
- [ ] 历史 Wave 文档已归档。
- [ ] MILESTONES、DELIVERY、README、architecture、PRD 与代码一致。
- [ ] 最终报告列出 commit、命令、exit code、环境和真实证据位置。

---

## 9. 推荐执行顺序

```text
Wave 0  恢复所有红灯
  ↓
Wave 1  产品范围、ADR、文档与仓库卫生收敛
  ↓
Wave 2  Go 后端 typed vertical slices，删除 God Service/双架构
  ↓
Wave 3  前端唯一 DI + RuntimeGateway + WebSocket + Store
  ↓
Wave 4  Desktop 主链 + contract + Playwright
  ↓
Mac Windows 11 ARM VM 高频验证
  ↓
Windows 10 x64 真机发布验收
```

当前下一步明确是：**先执行 Wave 0 + Wave 1，然后再开始 Wave 2 重构。不是继续堆新功能，也不是立即做 DAP/JDWP。**

