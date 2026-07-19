# Kairo IDE Mac Wave 2 长任务书：Core 封板与可信 Runtime/Server Lifecycle

> 执行机器：Mac 开发机  
> 执行方式：DeepSeek V4 Pro 多 Agent  
> 当前基础：`b22ac39` 上的未提交 Mac Project/Build/Deploy Core  
> 第一阶段分支：`feature/mac-project-build-core`  
> 第二阶段堆叠分支：`feature/mac-runtime-server-core`  
> 任务类型：交付审计修复、分批提交、Runtime Planning、Tomcat Provider、Server 状态机、进程生命周期、深度测试  
> Windows 并行边界：Mac 不修改 Desktop、Frontend、API Adapter、Bootstrap、JDT LS 和 Windows E2E

---

## 0. 审核结论

Mac Project/Build/Deploy Core 已经完成了大量有价值工作，整体方向正确，以下独立验证真实通过：

```text
go vet ./...                                      PASS
go test -count=1 -timeout 240s ./...              PASS
go test -race -count=1 -timeout 360s ./...        PASS
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build    PASS
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build    PASS
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build  PASS
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build  PASS
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build   PASS
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build   PASS
```

值得保留：

- opaque ID方向正确；
- Project Catalog方向正确；
- `.kairo/project.yaml` 使用真实 YAML；
- BuildUseCase已经从同步骨架变成异步状态机；
- Race Test通过；
- PlanResolver已经有真实实现；
- Deploy 已有大规模 traversal/symlink/mirror测试；
- atomic temp + fsync + rename方向正确；
- Core integration fixture和测试已建立；
- ADR-0010记录了关键决策。

但是当前状态还不适合直接作为“最终完成”提交，必须先修复审计问题。原因不是整体失败，而是报告对若干安全和一致性保证描述过强，实际实现仍有缺口。

最终决策：

```text
不要直接在 main 提交当前工作树
  → 先创建 feature/mac-project-build-core
  → 完成 Phase 0 审计修复
  → 独立复验
  → 按逻辑拆分提交并 push feature branch
  → 再创建堆叠分支 feature/mac-runtime-server-core
  → 开始 Runtime/Server 长任务
```

---

## 1. 当前交付审计发现

### 1.1 Critical：Deploy root没有真正的授权来源

位置：

- `internal/planning/resolver.go` 的 `ResolveDeploy(... deploymentRoot string)`；
- `internal/deploy/plan.go` 的 `validateRoot`。

当前问题：

1. `deploymentRoot` 仍由调用方以普通字符串传入；
2. Resolver只检查非空；
3. Deploy PlanBuilder把任意 absolute path当作 root；
4. `ErrRootNotOwned` 只在 root为空时返回；
5. 没有证明 root来自 Kairo-owned Catalina base；
6. 没有与 Workspace/Project/Server identity建立绑定。

这违反了核心安全原则：客户端不能提交执行路径。

目标：

- deployment root必须来自受信任 RuntimePlan/DeploymentTargetResolver；
- Deploy intent只提交 WorkspaceID、ProjectID、BuildID、ServerID或受限 target identity；
- PlanResolver从 repository/runtime plan解析绝对路径；
- DeployEngine还要做 defense-in-depth containment验证；
- 普通字符串不能绕过授权层。

### 1.2 Critical：Deploy preflight不是零写入

`internal/deploy/plan.go` 的 `validateRoot` 会在检查 entries之前执行 `os.MkdirAll(root)`。

如果后续 entry因 traversal、duplicate、symlink等失败，deployment root已经被创建，因此“preflight failure = 0 writes”并不真实。

目标：

- validate阶段必须纯读取；
- root不存在时返回 typed error或由受信任 runtime preparation阶段创建；
- Execute只有在完整 preflight通过后才能创建目录/临时文件；
- 添加“不存在root + invalid entry”测试，验证文件系统完全无变化。

### 1.3 Critical：Build terminal persistence仍被静默丢弃

`internal/app/build_impl.go`：

- running状态的 history Save错误被 `_ =` 丢弃；
- terminal Save错误被 `_ =` 丢弃；
- publisher错误被 `_ =` 丢弃；
- terminal Save失败后仍从 running map删除；
- Agent重启后可能只看到陈旧 queued/running状态。

最终报告中的“persistence errors returned and build remains queryable”目前只覆盖 Start时 queued Save失败，不覆盖异步 terminal persistence。

目标：

- terminal persistence失败不可静默；
- terminal BuildRun仍可查询；
- 产生明确的 persistence-failed event/diagnostic；
- 使用不依赖已取消 build context的 bounded lifecycle context持久化；
- 定义 retry或 recovery journal策略，但不要建设通用消息队列；
- 测试 started Save失败、terminal Save失败、event publish失败和cancel后Save失败。

### 1.4 High：Build List会返回重复 build

Start时 queued已经保存到 history，running后又保存。`List`先读取 history，再把 running map追加，因此同一 BuildID可能出现两次。

同时存在：

- append后没有重新排序；
- append后没有重新应用 limit；
- running snapshot和history snapshot可能状态冲突。

目标：

- 以 BuildID merge；
- 内存中的最新状态覆盖持久化旧状态；
- 按 QueuedAt/StartedAt稳定排序；
- merge后应用 limit；
- 返回值深拷贝 Diagnostics等 slice。

### 1.5 High：Repository在 List/Get中吞 corruption

`FileProjectRepo.List` 遇到 path resolution或 YAML错误直接 `continue`。

`FileBuildHistoryRepo.Get/List` 遇到某个 project history损坏也直接 `continue`。

影响：

- 用户看到项目或 build“消失”；
- corruption报告与实际行为矛盾；
- 故障无法诊断；
- API可能误报 not found。

目标二选一并统一：

1. fail whole operation并返回 typed aggregate error；或
2. 返回 `items + []ItemLoadError` 的 partial result。

v1建议 fail明确错误，避免 UI误以为数据不存在。不要静默跳过。

### 1.6 Critical：Repository路径没有在边界验证 ID

`FileBuildHistoryRepo` 和 `FileServerHistoryRepo` 使用：

```go
filepath.Join(dataDir, string(workspaceID), string(projectID)+".json")
```

这本身可以接受，但前提是 ID在 repository入口强制验证。当前测试大量使用 `ws_1`、`prj_1`，说明 repository没有执行 opaque ID格式验证。

`BuildUseCase.Get/List/Cancel` 也没有统一验证外部 ID。

目标：

- 任何用 ID构造文件路径的 repository入口先验证 ID；
- API/UseCase和 repository形成双层防护；
- 测试 `../`、absolute、volume、UNC、错误prefix、错误length；
- 测试 DataDir外 sentinel不变化；
- 测试合法crypto ID正常读写。

### 1.7 High：跨平台 path lexical validation依赖当前 GOOS

`hasVolumeName` 只有 `runtime.GOOS == windows` 时才识别 Windows volume/UNC。

影响：

- Mac上的配置验证可能接受 `C:/outside`；
- Mac生成的 catalog/config复制到 Windows后语义改变；
- cross-compile只证明编译，不证明相同输入在各平台有一致安全结果。

目标：

- 配置路径格式采用平台无关 slash-relative grammar；
- 在任何 OS 都拒绝 `^[A-Za-z]:[\\/]`；
- 在任何 OS 都拒绝 `//server/share` 和 `\\server\share`；
- 明确是否拒绝所有 raw backslash；建议配置统一 `/`；
- 测试不能用 `if runtime.GOOS == windows`隐藏 lexical cases。

### 1.8 High：ResolveWithin对多级不存在路径的symlink祖先检查不完整

当前不存在目标只尝试 `EvalSymlinks(filepath.Dir(target))`。如果该 parent也不存在，会退回 lexical path，可能漏掉更上层已经存在且指向 root外的 symlink。

需要 nearest-existing-ancestor算法：

1. 从target向上寻找第一个存在祖先；
2. EvalSymlinks该祖先；
3. 验证真实祖先仍在真实root内；
4. 再将剩余未创建 segments lexical拼接；
5. 写入前重新验证，降低 TOCTOU窗口。

添加：`root/link -> outside`，target=`link/nonexistent/deeper/file`。

### 1.9 High：Windows atomic replace实现只重试，不一定能覆盖现有文件

Windows实现调用 `os.Rename(src, dst)` 并只重试 sharing violation。Windows对已存在 destination的rename语义与Unix不同；cross-build无法证明覆盖式更新可用。

目标：

- 使用明确的 Windows replacement primitive；
- 区分 destination exists、sharing violation、access denied；
- retry有deadline/jitter且尊重 context；
- 不允许先删除 destination再rename制造数据丢失窗口，除非文档明确不原子且有恢复；
- Windows实际测试由 Windows workflow执行并回传证据；
- Mac测试 platform-independent contract和fault injection。

### 1.10 High：Runtime provider仍派生错误 ServerID

`Tomcat6Provider.Prepare` 仍将 `project.ID` 转为 `ServerID`。同时 `server_impl.go` 又有另一套 hex ID generator，不符合 ADR中 `srv_<26 base32>`。

目标：

- 全仓只保留一个 injected CryptoIDGenerator；
- RuntimeProvider不生成 identity；
- ServerUseCase或 RuntimePlanResolver生成 ServerID；
- ProjectID、ServerID永远不互相转换。

### 1.11 Medium：报告和改动边界不准确

必须修正：

- 报告日期写成 2025-03-18，当前基线日期应为实际日期；
- 报告称“Branch: work in progress”，需要最终分支和commit；
- 报告称 provider/build交付，但该目录相对 `b22ac39` 没有改动，应标注“继承并验证”而不是“本轮实现”；
- 报告称只越界修改 provider/runtime，但 `server_impl.go`也有逻辑改动；
- 多个 `internal/app`文件只是补末尾换行，应清理无关diff或单独解释；
- ADR示例 ID含 base32 alphabet不允许的字符 `0/1/8/9`，示例必须由真实 generator生成；
- provider/runtime仍有 gofmt/EOF newline问题；
- Windows真正 atomic replace尚未实机验证，ADR不能写成无条件保证。

---

## 2. 第一阶段：Project/Build/Deploy Core 封板

### 2.1 先创建分支，不提交

当前所有开发堆在 `main` 未提交工作树。先保护：

```bash
git status --short
git switch -c feature/mac-project-build-core
```

创建分支不会丢失工作树。此时不要 commit，先完成 Phase 0修复。

### 2.2 本阶段允许修改

```text
runtime-agent/internal/domain/**
runtime-agent/internal/pathpolicy/**
runtime-agent/internal/repository/**
runtime-agent/internal/planning/**
runtime-agent/internal/provider/build/**
runtime-agent/internal/app/build.go
runtime-agent/internal/app/build_impl.go
runtime-agent/internal/deploy/**
runtime-agent/internal/security/**
runtime-agent/test/core/**
runtime-agent/test/fixtures/**
docs/adr/0010-project-identity-and-planning.md
docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md
```

为修复编译产生的 provider/runtime和server字段适配，先保留最小改动，但必须在报告中准确列出；Runtime行为在第二阶段重构。

### 2.3 清理无关 diff

逐个核对：

```text
internal/app/encoding_impl.go
internal/app/jdtls_descriptor.go
internal/app/project.go
internal/app/recode_impl.go
internal/app/server.go
```

如果与 baseline相比只有 EOF newline，不要混入 Core逻辑提交。可以恢复为原内容，或放进独立 style提交；优先减少并行冲突。

不得使用会覆盖用户工作的大范围 reset/checkout。只对已确认的单文件单行差异做精确 patch。

### 2.4 Phase 0A：Identity与path修复

实现：

1. repository边界 ID验证；
2. use case公共方法 ID验证；
3. platform-neutral path grammar；
4. nearest-existing-ancestor symlink验证；
5. root本身 symlink canonicalization；
6. Unicode、case和Windows volume测试；
7. 去掉测试中的非法短 ID，全部使用 deterministic valid fixture IDs；
8. 文档示例使用 generator实际输出。

不要把 ID变成有业务语义的 slug，也不要加入可逆路径信息。

### 2.5 Phase 0B：Repository错误与一致性

实现：

1. Project List不吞 YAML/path错误；
2. Build history Get/List不吞 corruption；
3. 复制返回对象中的 slice/map/pointer嵌套内容；
4. context取消在耗时scan/list中生效；
5. duplicate ID/root有明确 conflict；
6. catalog record Put前验证 workspaceID/projectID/root；
7. Workspace Save验证 canonical existing root或定义允许不存在策略；
8. Project Save对 config与catalog双写失败定义补偿行为；
9. Delete不得忽略 config删除错误后仍报告完全成功；
10. corruption backup只在用户显式repair/migrate时创建，普通read不修改文件。

不引入 SQLite，不发明通用 transaction framework。

### 2.6 Phase 0C：Build异步持久化

需要明确状态和顺序：

```text
Resolve/Validate
→ generate BuildID
→ persist queued
→ expose in running map
→ publish queued
→ persist running
→ provider execution
→ derive terminal snapshot
→ persist terminal with bounded non-cancelled lifecycle context
→ publish terminal
→ remove running only after durable terminal save
```

如果 terminal Save失败：

- 不得把错误吞掉；
- 内存中保留 terminal run；
- Get/List仍返回终态和 persistence error；
- 发布可观察的 persistence failure；
- 可提供有限显式 retry；
- Shutdown报告未持久化状态；
- 不无限后台重试。

修复 List dedupe/sort/limit。

构造函数对 nil resolver/history/registry/idGen/publisher做 fail-fast或提供明确 no-op publisher。

### 2.7 Phase 0D：Deploy capability与纯 preflight

推荐接口方向：

```go
type DeploymentTarget struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    ServerID    ServerID
    Root        string
    OwnerToken  DeploymentOwnerToken
}

type DeploymentTargetResolver interface {
    ResolveDeploymentTarget(ctx context.Context, ws WorkspaceID, project ProjectID, server ServerID) (DeploymentTarget, error)
}
```

`OwnerToken`不是加密安全token，而是防止任意外部DTO直接构造执行路径的内部 capability。可以通过 package visibility或构造器控制，不要序列化到 API。

要求：

1. ResolveDeploy不接收任意 root string；
2. root来自 trusted resolver；
3. PlanBuilder validate不创建root；
4. source必须来自 ResolvedProject允许区域；
5. preflight完整通过后才写；
6. 写前recheck target ancestor；
7. Mirror只允许 Kairo-owned exploded webapp root；
8. protected paths策略可配置但默认最小；
9. partial failure语义与 preflight failure区分；
10. Windows replacement明确实现。

避免把 deployment root放回 HTTP DTO来快速接线。

### 2.8 Phase 0E：Provider验证修正

`provider/build`虽然不是本轮新增，但应补齐交付保证：

- `scanLines`返回 scanner error；
- callback nil安全或构造器保证；
- Ant不要无条件注入 Maven命名的 compiler property；
- build properties应来自受限、明确 plan字段；
- Javac argfile使用真实 Java launcher规则测试quote；
- argfile放受控 temp目录并关闭后执行；
- selected sources再次 defense-in-depth containment；
- command env明确继承策略；
- cancel后进程树退出测试；
- Windows executable path和长路径测试。

不要在本阶段做增量编译。

### 2.9 Phase 0F：文档真实性

更新 ADR和 Final Report：

- 使用实际日期；
- 写准确 branch/commit；
- 区分 inherited、modified、new；
- 删除无效 ID示例；
- 对 Windows实机未验证项标记 pending；
- 列出所有越界机械改动；
- 记录本次审计修复；
- 不再使用“所有保证均已完成”概括未实机验证部分。

### 2.10 Core封板 Gate

```bash
git diff --check
owned_files=$(git diff --name-only b22ac39 -- 'runtime-agent/**/*.go')
gofmt -l $owned_files
cd runtime-agent
go vet ./...
go test -count=1 -timeout 300s ./...
go test -race -count=1 -timeout 420s ./...
go test -count=20 -timeout 900s \
  ./internal/app \
  ./internal/deploy \
  ./internal/pathpolicy \
  ./internal/planning \
  ./internal/repository \
  ./test/core
```

注意 zsh不能假设普通变量会按换行拆分；格式检查建议使用 NUL：

```bash
git diff --name-only -z b22ac39 -- 'runtime-agent/**/*.go' | xargs -0 gofmt -l
```

Cross build：

```bash
CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build ./...
CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build ./...
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build ./...
CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build ./...
CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build ./...
CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build ./...
```

### 2.11 Core提交策略

Gate通过后分批提交：

```text
feat(domain,path): enforce opaque identities and canonical path policy
feat(repository): add versioned catalogs and strict YAML persistence
feat(planning): resolve trusted project build and deploy plans
refactor(build): make async lifecycle durable cancellable and race-free
refactor(deploy): enforce authorized preflight and safe atomic sync
test(core): cover concurrency corruption traversal and integration
docs(adr): record project identity planning and verified limitations
```

每次 `git add` 使用明确路径，不要 `git add -A`。尤其不要误把以下 Windows协调文档混入 Core逻辑提交：

```text
docs/WINDOWS_WAVE2_PRODUCT_VERTICAL_SLICE_TASK.md
```

任务文档可以单独 `docs(planning)` 提交。

提交前逐个检查：

```bash
git diff --cached --stat
git diff --cached --check
git diff --cached
```

然后 push feature branch，不直接 push main：

```bash
git push -u origin feature/mac-project-build-core
```

---

## 3. 第二阶段：可信 Runtime/Server Core 长任务

Core封板并 push后创建堆叠分支：

```bash
git switch -c feature/mac-runtime-server-core
```

此分支暂时以 `feature/mac-project-build-core` 为父分支。最终先合 Core，再rebase/合 Runtime分支。

### 3.1 本阶段目标链

```text
WorkspaceRepository
  → ProjectRepository
  → ToolchainRepository
  → RuntimeRegistry
  → RuntimePlanResolver
  → Kairo-owned CatalinaBase
  → DeploymentTarget capability
  → Tomcat6Provider
  → ServerUseCase state machine
  → ServerHistoryRepository
  → process identity/reconciliation
  → bounded logs + typed server events
```

最终证明：

1. ServerID由统一 CryptoIDGenerator生成；
2. RuntimePlan不由 provider猜路径；
3. CatalinaHome、JavaHome、WebappDir、CatalinaBase全部来自 trusted repositories/planning；
4. Server Start/Stop/Restart并发安全、可取消、可持久化；
5. Restart不是简单 Stop，也不会丢失计划；
6. Agent重启后可以reconcile persisted state；
7. PID复用不会导致误杀无关进程；
8. Tomcat只写 Kairo-owned CatalinaBase；
9. Deployment root通过 RuntimePlan提供给 Deploy planning；
10. 不依赖 HTTP、Theia、Electron或 Windows UI也能深度测试。

---

## 4. Runtime阶段文件所有权

### 4.1 Mac允许修改

```text
runtime-agent/internal/domain/**
runtime-agent/internal/planning/**
runtime-agent/internal/app/server.go
runtime-agent/internal/app/server_impl.go
runtime-agent/internal/app/server*_test.go
runtime-agent/internal/provider/runtime/**
runtime-agent/internal/tomcat6/**
runtime-agent/internal/proc/**
runtime-agent/internal/repository/server_history_repo.go
runtime-agent/internal/repository/server_history_repo_test.go
runtime-agent/internal/runtimeplan/**                 # 可新增
runtime-agent/internal/catalinabase/**                # 可新增
runtime-agent/test/runtime/**                         # 可新增
runtime-agent/test/fixtures/tomcat6/**                # 仅最小fixture，不复制完整发行包
docs/adr/0011-runtime-server-lifecycle.md
docs/progress/MAC_RUNTIME_SERVER_FINAL_REPORT.md
```

可以小幅修改 Deploy planning来接入 trusted DeploymentTarget，但不要重写已封板 DeployEngine。

### 4.2 Mac严禁修改

Windows Wave 2正在拥有：

```text
apps/**
packages/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.github/**
scripts/**
runtime-agent/internal/api/**
runtime-agent/internal/bootstrap/**
runtime-agent/internal/transport/**
runtime-agent/internal/jdtls/**
runtime-agent/internal/app/jdtls_descriptor.go
docs/progress/WINDOWS_WAVE2_*.md
```

Mac不能为了“快速从 UI跑通”修改 API/bootstrap。所有接线需求写入：

```text
docs/progress/MAC_RUNTIME_INTEGRATION_REQUESTS.md
```

---

## 5. Runtime多 Agent分工

### Agent M1 — Runtime Domain与ADR

- RuntimeID、ServerID、RuntimePlan；
- ServerState合法转换；
- command/intent；
- typed errors；
- ADR-0011；
- 冻结接口。

### Agent M2 — RuntimePlanResolver与CatalinaBase

- trusted path resolution；
- runtime/toolchain registry；
- port policy；
- CatalinaBase layout；
- DeploymentTarget capability；
- config generation plan。

### Agent M3 — Process与Tomcat6Provider

- injectable process runner；
- process tree停止；
- readiness；
- Tomcat6 start/stop/inspect；
- bounded logs；
- fake provider tests。

### Agent M4 — ServerUseCase与History

- lifecycle state machine；
- operation serialization；
- persistence；
- restart；
- reconcile；
- recovery。

### Agent M5 — QA/Security/Integration

- fault injection；
- race/count stress；
- PID reuse；
- symlink/path；
- real optional Tomcat smoke；
- cross-build；
- final evidence。

### Integration Lead

- 冻结domain contract；
- 审核文件边界；
- 合并顺序；
- 独立复验；
- 生成 Integration Requests和最终报告。

同一时间只能一个 Agent修改 `domain/project.go`、`app/server_impl.go`、`proc/proc.go`。

---

## 6. Phase R1：Runtime Domain Contract

### R1.1 Identity

- ServerID使用 `srv_<26 chars>`；
- RuntimeID表示配置/安装（例如 `rtm_...` 或受控 builtin ID），与ServerID不同；
- ProjectID不能转 ServerID；
- Restart是同一 logical server identity还是创建新 instance，必须决策。

建议：

- logical ServerID在restart中保持不变；
-增加 `Generation`或 `ProcessInstanceID` 表示新进程；
- UI的同一 server row不会因restart变成新对象；
- PID和StartedAt变化证明进程已替换。

### R1.2 ServerState

定义：

```text
stopped → preparing → starting → running
running → stopping → stopped
running → restarting → starting → running
preparing/starting/running/stopping/restarting → failed
running → crashed
crashed/failed → starting 或 stopped（显式恢复）
```

禁止非法直接转换。transition函数集中实现并测试。

### R1.3 RuntimePlan

至少包含：

```go
type RuntimePlan struct {
    WorkspaceID    WorkspaceID
    ProjectID      ProjectID
    ServerID       ServerID
    RuntimeID      string
    JavaHome       string
    CatalinaHome   string
    CatalinaBase   string
    WebappDir      string
    DeploymentRoot string
    ContextPath    string
    HTTPPort       int
    ShutdownPort   int
    DebugPort      int
    JVMOptions     []string
    Env            []string
    Generation     uint64
}
```

字段是否持久化、是否敏感、是否可序列化分别标注。Env不能含全量 `os.Environ()` snapshot。

### R1.4 Commands

```go
type StartServerCommand struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    ServerID    *ServerID // nil创建；非nil恢复已知logical server
}
```

Stop/Restart只接收 IDs和force意图，不接收路径、PID、port或JavaHome。

### R1 Gate

- domain不import repository/provider/api；
- ID/state tests；
- deep-copy tests；
- JSON持久化兼容测试；
- `go test -race ./internal/domain ./internal/app`。

---

## 7. Phase R2：RuntimePlanResolver

### R2.1 输入来源

Resolver必须注入：

- WorkspaceRepository；
- ProjectRepository；
- ToolchainRepository；
- RuntimeRepository/Registry；
- PathAuthorizer；
- ServerIDGenerator；
- PortAllocator policy；
- Kairo runtime data root。

不允许：

- 扫 workspace找第一个 `.kairo/project.yaml`；
- 选择 toolchains[0]；
- fallback任意 JAVA_HOME，除非产品配置明确允许并验证后入repo；
- provider自行拼 project root；
- CatalinaBase放公共 temp且无owner metadata。

### R2.2 Resolve流程

```text
validate IDs
→ ResolveProject
→ load selected ToolchainID
→ load selected RuntimeID
→ validate JavaHome/CatalinaHome
→ allocate/reuse logical ServerID
→ create trusted CatalinaBase plan
→ determine context path and ports
→ determine exploded deployment root
→ build immutable RuntimePlan
```

### R2.3 CatalinaBase layout

建议：

```text
<DataDir>/runtime/servers/<ServerID>/
  owner.json
  conf/
  logs/
  temp/
  work/
  webapps/
  state/
```

`owner.json`包括 WorkspaceID、ProjectID、ServerID、RuntimeID、schemaVersion和createdAt，不含secret。

所有 destructive cleanup必须先读取 owner并匹配 IDs。不得对 caller-derived目录 RemoveAll。

### R2.4 DeploymentTarget

RuntimePlanResolver是 deployment root受信任来源：

```text
RuntimePlan.DeploymentRoot
  = <CatalinaBase>/webapps/<normalized context>
```

- ROOT context映射规则明确；
- context path不能 traversal；
- Windows保留名/尾点/尾空格校验；
- DeployPlan只能引用该 target；
- ServerID与ProjectID必须匹配。

### R2.5 Ports

不要在 planning阶段长期占用“查到空闲”的port后再慢启动。定义 PortLease抽象：

- 测试可注入；
- 同一 server的HTTP/shutdown/debug互不重复；
- range可配置；
- startup失败释放；
- persisted plan仅为偏好，restart必须重新确认；
- Windows excluded ranges/权限错误可解释。

不要建立分布式port服务，本地单Agent锁足够。

### R2 Gate

- wrong workspace/project relation；
- missing toolchain/runtime；
- moved root；
- invalid context path；
- Catalina symlink escape；
- owner mismatch；
- port exhaustion；
- concurrent resolve；
- deterministic fake registry tests。

---

## 8. Phase R3：ServerHistory Repository

当前实现没有mutex、ID验证、atomic versioned document和deep copy，需要统一到新 repository标准。

要求：

1. ID验证；
2. versioned JSON；
3. atomic write；
4. mutex保护 read-modify-write；
5. corruption不吞；
6. stable sort；
7. deep copy LastPlan/JVMOptions/Env；
8. context取消；
9. 不使用 workspaceID路径前不验证；
10. 记录 logical state和process observation分离。

建议持久化：

```go
type ServerRecord struct {
    ID              ServerID
    WorkspaceID     WorkspaceID
    ProjectID       ProjectID
    DesiredState    DesiredServerState
    ObservedState   ServerState
    Generation      uint64
    PID             int
    ProcessIdentity string
    RuntimePlan     RuntimePlan
    LastError       string
    StartedAt       *time.Time
    StoppedAt       *time.Time
    UpdatedAt       time.Time
}
```

不要只凭 PID认定进程归属。

### R3 Gate

- 100并发 Save/Get/List；
- race/count20；
- corruption；
- invalid ID sentinel；
- deep copy；
- Agent crash留下 running record；
- schema mismatch；
- duplicate logical server policy。

---

## 9. Phase R4：Process Abstraction

### R4.1 范围

这里的 Process supervisor只管理 Tomcat子进程，不管理 Electron、Theia或 Runtime Agent。避免与 Windows Desktop Host重复。

### R4.2 Process identity

PID会复用。启动时记录可验证 identity：

- executable canonical path；
- startedAt；
- server marker/env/token或 command fingerprint；
- CatalinaBase；
- platform可获得的 process start time。

Stop/Reconcile在向 persisted PID发信号前验证 identity。无法确认时标记 orphaned/unknown，不杀进程。

### R4.3 Runner interface

```go
type ProcessSpec struct {
    Executable string
    Args       []string
    Dir        string
    Env        []string
    LogDir     string
}

type ManagedProcess interface {
    Start(ctx context.Context, spec ProcessSpec) (ProcessObservation, error)
    GracefulStop(ctx context.Context, identity ProcessIdentity) error
    ForceStop(ctx context.Context, identity ProcessIdentity) error
    Inspect(ctx context.Context, identity ProcessIdentity) (ProcessObservation, error)
    SubscribeLogs(listener LogListener) Disposable
}
```

### R4.4 修复当前 proc问题

- `StdoutReader()`不能永远返回 nil；若不用就删除接口；
- captureWriter必须正确缓存跨Write的partial line；
- scanner/read错误返回；
- Process重复Start语义；
- Wait在未Start时不能永久阻塞；
- ForceStop不能持锁执行潜在慢syscall；
- wait goroutine close channel只一次；
- context deadline与internal lifecycle分离；
- Windows CTRL_BREAK只有在console/process group条件满足时使用；
- taskkill fallback必须验证PID identity；
- Unix group kill避免误杀复用PGID；
- log buffer按bytes和lines双重上限。

### R4 Gate

- fake short process success；
- child process tree；
- graceful timeout→force；
- concurrent stop；
- stop during start；
- process already exited；
- PID identity mismatch不kill；
- partial log writes；
- 1MB line；
- 100k log lines bounded；
- race/count20；
- Windows cross-build。

---

## 10. Phase R5：Tomcat6 Provider

### R5.1 Provider职责

Provider接收完全解析的 RuntimePlan，只负责：

- 验证所需文件；
- 准备 CatalinaBase内容；
- 生成受控启动命令；
- 启动；
- readiness；
- graceful stop；
- force stop；
- inspect；
- logs。

不得：

- 从ProjectID猜路径；
-选择第一个toolchain；
-生成ServerID；
-读取任意用户传入execution path；
-调用 API/EventHub；
-直接写 repository。

### R5.2 CatalinaBase assembly

- 从 CatalinaHome复制最小 conf模板；
- server.xml变更使用XML parser/template，不脆弱字符串replace；
- 设置HTTP/shutdown ports；
- Context配置指向 Kairo-owned exploded deployment；
- logs/temp/work/webapps创建；
- owner验证后才能覆盖；
- config原子写；
- 不修改共享 CatalinaHome；
- 不把用户项目直接作为 Tomcat工作目录。

### R5.3 Java/Tomcat兼容

- Tomcat 6.0.53；
- host JDK与目标项目build JDK可能不同；
- startup使用兼容的runtime JavaHome；
- Windows `.bat`不能假设能直接被 `exec.Command`当exe执行，明确使用 `cmd.exe /d /s /c`或直接 Java Bootstrap；
- Unix脚本权限和CRLF；
- `JAVA_HOME`/`JRE_HOME`/`CATALINA_HOME`/`CATALINA_BASE`明确；
- 环境allowlist/override，避免重复键。

优先直接构造 Java bootstrap命令，减少 shell quoting差异，但必须基于 Tomcat 6实际classpath验证。

### R5.4 Readiness

TCP端口开放不等于应用ready。至少：

1. process仍alive；
2. connector端口可连接；
3. HTTP响应来自本次Tomcat；
4. deadline可配置；
5. 失败返回最后日志摘要；
6. context取消立即停止startup；
7. readiness失败清理进程并持久化 failed。

### R5.5 Stop

- 优先 Tomcat shutdown protocol/script；
- 等待实际退出；
- deadline后force；
- force只针对验证过identity的进程树；
- stop结果区分 already stopped、graceful、forced、failed；
- 释放port lease；
- 不吞错误。

### R5 Gate

- captured command spec；
- Catalina config golden tests；
- invalid/missing CatalinaHome；
- path含空格/中文；
- startup timeout；
- process exits before ready；
- graceful stop；
- force stop；
- logs；
- Windows command contract；
- optional real Tomcat smoke。

---

## 11. Phase R6：ServerUseCase 状态机

### R6.1 构造依赖

```go
NewServerUseCase(
    lifecycleCtx,
    planResolver,
    providerRegistry,
    history,
    eventPublisher,
    idGenerator,
    operationLocks,
    config,
)
```

不能继续注入 `configDir` 后由 use case直接读 repository文件。

### R6.2 Start

```text
validate IDs
→ acquire per-project/server operation lock
→ reject/return existing running server according policy
→ resolve RuntimePlan
→ persist desired=running observed=preparing
→ provider.Prepare
→ persist starting
→ provider.Start + readiness
→ persist running with PID identity
→ publish state changes
→ release lock
```

失败时：

- 清理半启动process；
- release lease；
- persist failed；
-保留diagnostic；
- 不留下 activePlans纯内存真相。

### R6.3 Stop

- 先Get并校验 WorkspaceID ownership；
- per-server serialization；
- persist stopping；
- graceful→force policy；
- provider error不可吞；
- persist stopped/failed；
- cleanup只针对owner root；
- repeat stop幂等；
- stop期间Get/List反映stopping。

### R6.4 Restart

建议保持 logical ServerID：

```text
running generation N
→ restarting
→ stop process N
→ re-resolve/validate plan
→ generation N+1
→ start new process
→ running same ServerID, new PID/generation
```

要求：

- old PID必须退出；
- new PID不同或generation不同；
- old plan不作为不验证的mutable pointer复用；
- project/toolchain/runtime配置改变后重新resolve；
- stop失败不盲目启动第二个；
- start失败状态明确且可再次启动；
- event sequence稳定。

### R6.5 Get/List

- history是 durable source；
- current provider observation合并但不覆盖ownership；
- 不持全局锁调用provider I/O；
- stable order；
- deep copy；
- partial inspect error明确；
- WorkspaceID过滤可靠；
- 不接受caller WorkspaceID覆盖实际 instance ownership。

### R6.6 Reconcile

Agent启动：

1. list persisted nonterminal/running records；
2. validate IDs和owner；
3. inspect verified process identity；
4. alive+matching：恢复running observation；
5. dead：mark crashed/stopped according desired state；
6. PID alive但identity mismatch：mark orphaned，不kill；
7. corrupted record：返回明确错误；
8. 不扫描磁盘猜项目；
9. 不自动拉起所有server，除非未来产品策略明确；
10. publish reconciliation snapshot/event。

### R6.7 Lifecycle shutdown

- 新Start被拒绝；
- running servers是否保留或停止由Desktop policy配置；
- 默认桌面app退出停止所有owned Tomcat；
- bounded deadline；
- persistence完成；
- 返回未清理实例列表；
- 不在 context cancelled后用同一ctx持久化。

### R6 Gate

- 100 concurrent Start同project；
- Start/Stop race；
- Restart/Stop race；
- repeated Stop；
- persistence failure每个transition；
- provider failure每个phase；
- event failure；
- restart same logical ID/new generation；
- reconcile dead/alive/PID reuse；
- lifecycle shutdown；
- `go test -race -count=20`。

---

## 12. Phase R7：Logs与Events Core Contract

Mac不修改 Windows拥有的 EventHub/transport，但定义 app-level port：

```go
type ServerEventPublisher interface {
    PublishServerEvent(ctx context.Context, event ServerEvent) error
}
```

ServerUseCase不能直接依赖 concrete `transport/events.EventHub`。

Event字段：

- WorkspaceID；
- ProjectID；
- ServerID；
- generation；
- type；
- old/new state；
- message；
- time；
- recoverable；
- request/operation correlation ID。

Logs：

- provider向 log sink写结构化 line；
- stdout/stderr；
- timestamp；
- server/generation；
- bounded ring；
- optional disk rotation由后续任务；
- 不把所有log塞进 ServerInstance history；
- secret/环境变量redact。

Windows transport负责把这些映射到WebSocket，不在Mac分支实现。

---

## 13. Phase R8：Core Integration 与 Fault Injection

### R8.1 Fake provider闭环

```text
repositories
→ ResolveRuntime
→ ServerUseCase.Start
→ fake provider ready
→ history running
→ DeploymentTarget
→ safe deploy
→ Restart generation+1
→ Stop
→ history stopped
```

### R8.2 Process fixture

使用小型 Go helper process模拟：

- delayed readiness；
- HTTP ready；
- ignore graceful stop；
- child process；
- huge logs；
- crash exit code；
- partial line；
- startup timeout。

不要依赖系统shell语义来做核心单测。

### R8.3 Optional Tomcat smoke

如果本机存在合法 Tomcat6目录：

- 通过环境变量显式opt-in；
- 复制到测试CatalinaBase；
- 启动最小 webapp；
- HTTP断言；
- stop；
- 无孤儿；
- 无环境时明确 skip reason，核心fake integration仍必须pass。

不要把完整 Tomcat二进制提交仓库。

### R8.4 Fault matrix

| Fault | Expected |
|---|---|
| history disk full | state stays queryable, error observable |
| Catalina base owner mismatch | fail before write |
| port collision | retry/typed failure, no process leak |
| provider start error | failed persisted |
| readiness timeout | process cleaned |
| graceful stop ignored | force by verified identity |
| PID reused | do not kill unrelated process |
| Agent lifecycle cancel | bounded cleanup |
| corrupted history | explicit corruption error |
| event publisher down | state durable, event error observable |
| path symlink changes | write/start preflight rejects |

---

## 14. 与 Windows 的集成合同

Windows只需要这些 typed intentions：

```text
StartServer(workspaceId, projectId)
StopServer(workspaceId, serverId, force)
RestartServer(workspaceId, serverId)
GetServer(workspaceId, serverId)
ListServers(workspaceId)
GetServerLogs(workspaceId, serverId, cursor/limit)
```

响应不应泄漏：

- JavaHome；
- CatalinaHome；
- environment；
- shutdown token；
- secret；
-任意可编辑execution path。

可以返回给UI：

- IDs；
- display name；
- state；
- public local app URL；
- context path；
- started/stopped time；
- generation；
- user-facing error；
- bounded log cursor。

Mac完成后在 `MAC_RUNTIME_INTEGRATION_REQUESTS.md` 写：

1. constructor dependencies；
2. API DTO mapping；
3. event mapping；
4. bootstrap lifecycle start/shutdown；
5. config fields；
6. Windows real-machine tests；
7. breaking changes；
8.旧server_impl/API迁移步骤。

不要自己修改 Windows files完成接线。

---

## 15. 全局 Gate

每个Phase合并后：

```bash
git diff --check
git diff --name-only -z <phase-base> -- 'runtime-agent/**/*.go' | xargs -0 gofmt -l
cd runtime-agent
go vet ./...
go test -count=1 -timeout 300s ./...
go test -race -count=1 -timeout 420s ./...
go test -count=20 -timeout 900s \
  ./internal/app \
  ./internal/planning \
  ./internal/provider/runtime \
  ./internal/proc \
  ./internal/repository \
  ./internal/tomcat6 \
  ./test/runtime
```

Cross build六组合必须通过。

测试要求：

- 不允许因为 Windows/Mac差异直接skip lexical security；
- symlink capability不可用时可以skip filesystem-specific case，但必须有platform-independent unit；
- 不用 sleep作为唯一同步；
- timeout测试有宽容区间；
- 所有goroutine/process/timer清理；
- `t.TempDir()`；
- 不修改真实用户Tomcat/项目；
- failure时保留必要日志；
- 无真实Tomcat时不能阻止fake core gate。

---

## 16. Runtime Definition of Done

### Core封板

- [ ] Deploy root来自trusted capability
- [ ] preflight失败零写入
- [ ] terminal persistence错误不丢
- [ ] Build List无重复且正确limit/sort
- [ ] corruption不静默隐藏
- [ ] repository入口验证ID
- [ ] path grammar跨平台一致
- [ ] 多级不存在path的symlink ancestor安全
- [ ] Windows atomic replace合同修正
- [ ] Final Report/ADR日期、范围和示例准确
- [ ] Core分批提交并push feature branch

### Runtime Planning

- [ ] ServerID统一crypto generator
- [ ] ProjectID不转ServerID
- [ ] ResolveRuntime真实实现
- [ ] Toolchain/Runtime选择来自repository
- [ ] CatalinaBase为Kairo-owned
- [ ] owner metadata
- [ ] DeploymentTarget与server/project绑定
- [ ] context path安全
- [ ] port lease策略

### Process/Tomcat

- [ ] PID identity防复用误杀
- [ ] process tree graceful/force stop
- [ ] partial log正确
- [ ] bounded logs
- [ ] Tomcat Provider不猜路径/ID/toolchain
- [ ] CatalinaHome不被修改
- [ ] CatalinaBase配置正确
- [ ] readiness真实
- [ ] startup失败无泄漏
- [ ] Windows command contract

### ServerUseCase

- [ ] per-server/project operation serialization
- [ ] Start/Stop/Restart状态机
- [ ] Restart保持logical ID并增加generation
- [ ] persistence每步可观察
- [ ] provider/event failure处理
- [ ] Get/List ownership正确
- [ ] Reconcile不扫描猜测
- [ ] PID mismatch不kill
- [ ] lifecycle shutdown bounded
- [ ] 无activePlans第二真相

### Tests/Docs

- [ ] unit/race/count20
- [ ] fake process integration
- [ ] fake provider full chain
- [ ] six-target cross-build
- [ ] optional real Tomcat结果诚实
- [ ] ADR-0011
- [ ] Final Report
- [ ] Integration Requests
- [ ] 未修改Windows禁区

---

## 17. 最终报告

创建：

```text
docs/progress/MAC_RUNTIME_SERVER_FINAL_REPORT.md
```

必须包含：

1. Executive Summary；
2. Core封板前审计问题和修复映射；
3. 两个分支的起止commit；
4. 修改文件；
5. 禁区未修改证明；
6. Runtime domain/state diagram；
7. RuntimePlan示例；
8. CatalinaBase layout；
9. DeploymentTarget trust chain；
10. Server Start/Stop/Restart时序；
11. process identity策略；
12. reconciliation matrix；
13. persistence failure策略；
14. security threat/test table；
15. unit/race/count20结果；
16. cross-build结果；
17. optional real Tomcat结果；
18. Windows未实机验证项；
19. Integration Requests；
20. remaining risks；
21. 是否满足merge条件。

所有 verified结论必须有命令和退出码。没有执行的 Windows NTFS、antivirus、CTRL_BREAK、Tomcat batch行为必须标记 pending，不得由 cross-build代替。

---

## 18. 给 Mac DeepSeek 多 Agent 的直接指令

本任务必须先封板当前 Core，不能直接在未提交 main工作树上继续叠 Runtime代码。

执行顺序：

```text
创建 feature/mac-project-build-core
→ 修复审计 Critical/High
→ 更新 ADR/Final Report
→ 独立复验
→ 分批commit并push Core branch
→ 创建 feature/mac-runtime-server-core
→ R1 Domain
→ R2 RuntimePlanResolver
→ R3 ServerHistory
→ R4 Process
→ R5 Tomcat6Provider
→ R6 ServerUseCase
→ R7 Logs/Events port
→ R8 Integration/Fault
→ Final Gate和报告
```

Windows正在并行完成 Desktop Host、Runtime Client、Product UI、JDT LS和安装版E2E。Mac不得修改 Windows拥有路径。需要接 API/Bootstrap/EventHub时只写 Integration Requests。

最终成果不是“Tomcat代码更多”，而是一个可信、可持久化、可恢复、不会误杀进程、不会让调用方控制路径、能被 Windows Desktop安全接入的 Runtime/Server Core。
