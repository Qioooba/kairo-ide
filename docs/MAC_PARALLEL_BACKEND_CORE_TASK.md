# Kairo IDE Mac 并行长任务：可信 Project Core 与 Build/Deploy Engine

> 执行机器：Mac 开发机  
> 执行方式：AI 多 Agent 并行开发  
> 建议分支：`feature/mac-project-build-core`  
> 起始基线：`b22ac39`  
> 任务类型：架构收敛、核心后端开发、安全加固、深度测试  
> 与 Windows 工作流关系：严格隔离，Windows 负责 Desktop/连接/打包/Windows E2E，本任务负责纯 Go Project/Repository/Planning/Build/Deploy Core

---

## 0. 任务目标

Mac 工作流负责完成一条不依赖 HTTP、Theia、Electron 和 Windows UI 的可信后端核心链：

```text
WorkspaceRepository
  → ProjectRepository
  → stable WorkspaceID / ProjectID
  → canonical project root
  → validated .kairo/project.yaml
  → PlanResolver
  → BuildPlan / DeployPlan
  → AntProvider / JavacProvider
  → async BuildUseCase
  → BuildHistory + BuildEvents
  → safe DeployEngine
```

最终成果必须能够证明：

1. `WorkspaceID` 和 `ProjectID` 是不含路径语义的 opaque ID。
2. 项目根目录只能由 repository 解析，不能通过 `string(projectID)` 获得。
3. 相对路径只能以受信任的 project root 为基准解析。
4. Build/Deploy 执行计划只能由 PlanResolver 创建。
5. Ant/Javac provider 不自行猜测项目路径。
6. Build 真正异步、可取消、线程安全、可持久化。
7. Deploy target 无法通过 `..`、absolute path 或 symlink 逃逸 deployment root。
8. 所有核心行为通过 unit、race、integration、security 和 Windows cross-build Gate。

本任务完成后暂时不接 HTTP API；Windows 工作流结束并合并后，再由 Integration Lead 把这些 use case 接入 composition root。

---

## 1. 两台机器的文件所有权

### 1.1 Mac 可以修改

Mac 工作流拥有以下路径：

```text
runtime-agent/internal/domain/**
runtime-agent/internal/repository/**
runtime-agent/internal/provider/build/**
runtime-agent/internal/app/build.go
runtime-agent/internal/app/build_impl.go
runtime-agent/internal/app/deploy*.go
runtime-agent/internal/app/plan*.go              # 可新增
runtime-agent/internal/build/**
runtime-agent/internal/deploy/**
runtime-agent/internal/security/**               # 只允许通用 sandbox/path 能力
runtime-agent/test/core/**                       # 可新增纯后端 integration
runtime-agent/test/fixtures/**                   # 可新增
docs/adr/0010-project-identity-and-planning.md   # 可新增
docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md   # 可新增
```

如果需要新的纯 Go 内部包，可以新增：

```text
runtime-agent/internal/pathpolicy/**
runtime-agent/internal/planning/**
runtime-agent/internal/testrunner/**
```

但优先保持简单，不要为了“分层”产生只有一个函数的包。

### 1.2 Mac 严禁修改

为了避免与 Windows 机器冲突，Mac 工作流不得修改：

```text
apps/**
packages/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.github/**
scripts/**
runtime-agent/cmd/**
runtime-agent/internal/api/**
runtime-agent/internal/bootstrap/**
runtime-agent/internal/config/**
runtime-agent/internal/services/**
runtime-agent/internal/transport/**
runtime-agent/internal/proc/**
runtime-agent/internal/tomcat6/**
runtime-agent/internal/provider/runtime/**
docs/MILESTONES.md
docs/archive/**
docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md
```

特别禁止：

- 修改 TypeScript `EndpointMap`；
- 修改 local secret 协议；
- 修改 Restart API；
- 修改 Desktop package；
- 修改 Windows PowerShell；
- 把新 use case 提前接入 `bootstrap.Container`；
- 为了测试修改旧 `services.go`。

如果发现必须修改禁区文件才能继续：停止该子任务，把需求记录到最终报告的 `Integration Requests`，不要自行越界。

---

## 2. 当前代码审计结论

现有代码已经有不少骨架，但不可直接视为可用实现。

### 2.1 Project/Repository 问题

1. `FileProjectRepo.Get()` 仍然调用 `LoadProjectConfig(string(projectID))`，ProjectID 实际仍是路径。
2. `FileProjectRepo.List()` 把 `workspaceID` 当 workspace root。
3. `FileProjectRepo.Save()` 把 `project.ID` 当项目根目录。
4. Project domain 没有受信任的 workspace-relative root mapping。
5. `.kairo/project.yaml` 的名称仍是 YAML，但当前新实现使用 Versioned JSON 读取和写入，格式语义混乱。
6. repository load/save 的并发一致性、lost update 和跨进程行为没有统一策略。
7. `TouchWorkspace()` 是 load-modify-save，多个 goroutine 可能互相覆盖。
8. ID 校验、重复项目、同一 root 重复导入、移动/删除 root 的行为未定义。
9. schema version 只有“等于 1”，没有明确 migration registry 和损坏恢复策略。

### 2.2 PlanResolver 问题

1. domain 已定义 `PlanResolver`，仓库中没有实现。
2. BuildPlan 缺少明确的 canonical project root/build file/Ant targets。
3. Toolchain resolution 没有进入 BuildPlan。
4. classpath、library dirs、resource roots 缺少统一解析。
5. DeployPlan 没有正式 builder，WEB-INF 映射仍靠注释表达。
6. selected-files intent 没有验证 selected file 属于 source roots。

### 2.3 BuildUseCase 问题

1. `runningBuild.run` 在 goroutine 中写、Get/List 中读，没有同一把锁保护，`go test -race` 新测试后会暴露竞争。
2. `eventSink()` 用 `buildID` 冒充 `WorkspaceID` 发布 progress event。
3. provider 为 nil 时可能 panic。
4. Validate 收到空 Toolchain，不是 resolver 解析的真实 toolchain。
5. HTTP request context 与后台 build context 的关系没有明确 lifecycle root；当前直接 `context.Background()`，Agent shutdown 无法统一 cancel。
6. Cancel 后 terminal state 不一定是 cancelled，可能被写成 failed。
7. cancelled/failed/completed event 类型不准确。
8. diagnostics 没有从 BuildOutput 写回 BuildRun。
9. history save error被静默丢弃。
10. build 从 running map 删除后，若 history 保存失败，Get 永久找不到。
11. List 的排序和 limit 逻辑不可靠。
12. fallback timestamp ID 没有必要，crypto/rand 失败应明确报错或使用可注入 ID generator。

### 2.4 Ant/Javac Provider 问题

1. AntProvider 把第一个 source root 当 project root，导致查找 `src/main/java/build.xml`。
2. Windows Ant binary 应是 `ant.bat`；现有实现只查 `bin/ant`。
3. provider 直接读全局 `ANT_HOME`，不可测试，也不能表达 Kairo 配置。
4. Ant target 固定为 `compile`，遗留项目可能使用 `war`、`build` 或自定义 target。
5. `JAVA_HOME` 只来自 provider 构造字段，与 Toolchain plan 分离。
6. CombinedOutput 无法流式发布 progress/log，取消前也没有可观察输出。
7. Javac working directory使用第一个 source root，不是 project root。
8. javac argfile 只处理空格，没有完整处理引号、反斜杠、`@`、换行。
9. source file遍历未排序，测试和日志不稳定。
10. diagnostic parser 对 Windows drive letter、中文 javac 输出、多行错误上下文覆盖不足。

### 2.5 DeployEngine 问题

1. `filepath.Join(deploymentRoot, entry.Target)` 没有先拒绝 absolute target 和 `..`。
2. sandbox 只检查 deploymentRoot，不检查 canonical absTarget 是否仍在 root 内。
3. target 若经过 symlink 指向外部，copy/delete 可能逃逸。
4. delete 使用 `os.RemoveAll(absTarget)`，目标验证不足时破坏性很高。
5. mirror keepSet 只记录 entry 顶层，目录递归文件可能被错误判断。
6. mirror 遇到未知目录直接 SkipDir，实际不会实现完整 mirror 语义。
7. `fsyncDir` 在不同平台语义不同，当前 `syscall.Flock` 占位没有设计价值。
8. Windows rename 覆盖现有文件和杀毒软件短暂占用未被抽象。
9. 部分部署失败没有 structured partial result。
10. DeployPlan entry 既能是文件又能是目录，使 action/statistics/mirror 语义复杂。

---

## 3. 目标设计

### 3.1 Identity 与路径模型

原则：

```text
ID != path
config relative path != resolved absolute path
client intent != execution plan
```

建议 domain：

```go
type Workspace struct {
    ID         WorkspaceID
    Name       string
    Root       string      // repository 保存的 canonical absolute root
    LastOpened time.Time
}

type Project struct {
    ID          ProjectID
    WorkspaceID WorkspaceID
    Name        string
    Root        string      // workspace-relative path，"." 表示 workspace 本身

    SourceRoots   []string
    ResourceRoots []string
    LibraryDirs   []string
    WebappDir     string
    OutputDir     string
    BuildFile     string
    BuildTargets  []string

    SourceLevel string
    TargetLevel string
    Encoding    string
    BuildTool   BuildToolID
    ContextPath string
    ToolchainID string
    RuntimeID   string
}
```

Project.Root 和所有配置路径必须是 clean relative path：

- 允许 `.`；
- 不允许 absolute；
- 不允许 volume name；
- 不允许解析后逃逸；
- 不允许 NUL；
- 不把 `/` 和 `\` 的差异留给调用方处理。

ProjectID 建议格式：

```text
prj_<base32 random 128-bit>
```

WorkspaceID：

```text
ws_<base32 random 128-bit>
```

要求提供 `ValidateWorkspaceID`、`ValidateProjectID`，ID 中不得出现路径分隔符。

### 3.2 Project catalog

`.kairo/project.yaml` 是项目自身配置；DataDir repository 另外保存 Kairo identity catalog：

```text
<dataDir>/catalog/workspaces.json
<dataDir>/catalog/projects.json
<dataDir>/history/builds/<workspaceID>/<projectID>.json
```

Project catalog record 至少包含：

```go
type ProjectRecord struct {
    WorkspaceID WorkspaceID `json:"workspaceId"`
    ProjectID   ProjectID   `json:"projectId"`
    Root        string      `json:"root"` // workspace-relative
    CreatedAt   time.Time   `json:"createdAt"`
    UpdatedAt   time.Time   `json:"updatedAt"`
}
```

Repository Get 流程：

1. 通过 workspace repository 找 workspace record；
2. 通过 project catalog 找 project record；
3. `Join(workspace.Root, projectRecord.Root)`；
4. canonicalize 并验证在 workspace root 内；
5. 读取该 root 下 `.kairo/project.yaml`；
6. 组合为 domain.Project；
7. 不允许从 ID 推导路径。

### 3.3 配置格式决策

文件名是 `project.yaml`，因此必须写真正 YAML，不要将 Versioned JSON 写进 `.yaml`。

建议格式：

```yaml
schemaVersion: 1
name: legacy-sample
sourceRoots:
  - src
resourceRoots:
  - src/main/resources
libraryDirs:
  - lib
webappDir: WebRoot
outputDir: build/classes
buildTool: ant
buildFile: build.xml
buildTargets:
  - compile
sourceLevel: "8"
targetLevel: "8"
encoding: GBK
contextPath: /kairo
toolchainId: tc_example
runtimeId: tomcat6
```

JSON catalog 使用 VersionedDocument；YAML project config 自身包含 schemaVersion，不再外套 JSON envelope。

### 3.4 ResolvedProject 与 BuildPlan

```go
type ResolvedProject struct {
    Project       Project
    Root          string
    SourceRoots   []string
    ResourceRoots []string
    LibraryDirs   []string
    WebappDir     string
    OutputDir     string
    BuildFile     string
    Classpath     []string
}

type BuildPlan struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    ProjectRoot string
    BuildTool   BuildToolID
    BuildFile   string
    Targets     []string
    SourceRoots []string
    OutputDir   string
    Classpath   []string
    JavaHome    string
    SourceLevel string
    TargetLevel string
    Encoding    string
    Clean       bool
    SelectedFiles []string
}
```

PlanResolver 依赖：

```go
type DefaultPlanResolver struct {
    workspaces WorkspaceRepository
    projects   ProjectRepository
    toolchains ToolchainRepository
    sandbox    PathAuthorizer
}
```

PlanResolver 不读取环境变量，不执行进程，不写文件。

### 3.5 DeployPlan

DeployPlan target 永远是 deployment root 内的 slash-separated relative path：

```text
webapp files   → ./...
classes        → WEB-INF/classes/...
resources      → WEB-INF/classes/...
libraries      → WEB-INF/lib/...
```

Plan entry建议只表示文件，不表示整个目录：

```go
type DeployEntry struct {
    Source string
    Target string
    Action DeployAction
    Size   int64
    Mode   fs.FileMode
}
```

目录遍历在 plan builder 阶段完成，这样：

- target 可逐项验证；
- mirror keepSet 完整；
- progress/statistics 准确；
- 执行层更简单；
- 测试无需猜测目录递归副作用。

---

## 4. Multi-Agent 分工

Mac 可使用 4 个 Agent，但必须由一个 Integration Agent 统一合并。

### Agent M1：Domain + Identity + Path Policy

负责：

- domain 类型整理；
- opaque ID generator/validator；
- relative path validator；
- canonical containment helper；
- ResolvedProject/BuildPlan/DeployPlan 结构；
- ADR 初稿。

测试：

- Unix path；
- Windows drive/UNC lexical cases；
- `..`、absolute、mixed slash；
- duplicate ID；
- Chinese/space project directory；
- symlink escape（macOS 可真实创建）。

### Agent M2：Repositories + Migration

负责：

- WorkspaceRepository；
- Project catalog；
- ProjectRepository；
- Toolchain repository consistency；
- BuildHistory ordering；
- YAML config codec/default/validation；
- `.legacyflow` → `.kairo` migration；
- atomic store concurrency。

不得自行改 domain；需要类型变化时通知 M1/Integration Agent。

### Agent M3：PlanResolver + BuildUseCase + Providers

负责：

- DefaultPlanResolver；
- BuildUseCase race/cancel/state machine；
- AntProvider；
- JavacProvider；
- provider command abstraction；
- diagnostic parsing；
- build integration tests。

### Agent M4：Deploy Planner + Safe DeployEngine + Security Tests

负责：

- DeployPlan builder；
- file-only entries；
- classes/resources/webapp/lib mapping；
- target containment；
- symlink/no-follow policy；
- atomic replacement abstraction；
- mirror semantics；
- partial failure report；
- deployment security/fault tests。

### Integration Agent

负责：

- 接受/拒绝各 Agent 提交；
- 防止跨文件边界；
- 解决 domain 统一；
- 跑全量 Go/race/cross-build；
- 更新 ADR；
- 写最终报告；
- 不接入 bootstrap/API。

---

## 5. Phase A：Domain、ID 与 Path Policy

### A1. 清理 domain

1. 为 BuildTool、DeployAction、DeployMode 使用 typed string enum。
2. 删除同义状态，如 queued/pending 二选一；建议：

```text
queued → running → succeeded|failed|cancelled
```

3. BuildRun 加：

```go
QueuedAt   time.Time
StartedAt  *time.Time
FinishedAt *time.Time
ExitCode   *int
LogPath    string
```

4. 时间字段使用 UTC 写入。
5. domain 不 import repository/api/transport。
6. Event port 应定义成 domain/application-owned interface，避免 app 强依赖 transport event struct；但本轮不得修改 transport。可以在 app 内定义最小 publisher interface 和 app event DTO。

### A2. ID

要求：

- crypto/rand；
- 128 bit；
- base32 lowercase，无 padding；
- 可注入 generator 以测试；
- rand 失败返回 error，不使用时间戳 fallback；
- validator 测试路径字符。

### A3. Path policy

提供两类函数：

```go
ValidateRelativeConfigPath(value string) error
ResolveWithin(root, relative string) (string, error)
```

必须防御：

- empty（按字段策略决定）；
- absolute；
- Windows volume/UNC；
- `..` segment；
- mixed separator；
- symlink ancestor；
- destination 最后一段尚不存在；
- case-insensitive Windows 路径的概念差异。

不要只依赖字符串前缀。

### Phase A Gate

```bash
go test -count=1 ./internal/domain/... ./internal/security/...
go test -count=1 -race ./internal/domain/... ./internal/security/...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c ./internal/security
```

---

## 6. Phase B：Repository 与配置迁移

### B1. YAML codec

1. `.kairo/project.yaml` 使用 `yaml.v3`。
2. 严格解析 known fields；拼写错误不能静默忽略。
3. defaulting 与 validation 分开：
   - Decode；
   - Migrate；
   - ApplyDefaults；
   - Validate。
4. Validate 不应在调用方不知情时修改对象。
5. 保存顺序稳定，便于 code review。
6. 保存原子化，保留原权限。

### B2. Catalog repository

1. repository 构造函数必须接收 dataDir/workspaceRepo/path policy。
2. 所有公开方法接受 context 并在耗时操作前检查取消。
3. 同一进程并发写使用 repository mutex。
4. mutation 使用锁内 read-modify-atomic-write，避免 lost update。
5. 返回值复制，调用方不能修改 repository 内部 slice/map。
6. list 排序稳定：workspace name/ID，project name/ID。

### B3. Corruption policy

损坏 JSON/YAML：

- 返回 typed corruption error；
- 不自动覆盖为空文件；
- 原文件保留；
- 可生成 `.corrupt.<timestamp>` 备份的 repair helper，但不自动执行。

### B4. Migration

1. 读取 `.legacyflow/project.yaml`；
2. 转换字段；
3. 写 `.kairo/project.yaml`；
4. 重新读取验证；
5. 不删除 legacy 文件；
6. 重复执行幂等；
7. 新 config 已存在时不覆盖，除非显式 migration option。

### B5. Atomic write

1. JSON/YAML 共用 atomic byte primitive。
2. temp 与 target 同目录。
3. write → chmod → fsync file → close → replace → sync dir。
4. 将 replace 行为抽象成小函数，为 Windows 后续实机验证留入口。
5. macOS/Linux 真实测试 permission 和 crash-like truncated source。
6. 不引入第三方数据库或 file-lock dependency。

### Phase B Gate

- 50 次并发 Save/Touch 无数据丢失；
- corrupted document 不被覆盖；
- YAML round-trip；
- migration 幂等；
- project ID 不作为 path；
- workspace root移动/缺失给出明确错误；
- `go test -race ./internal/repository/...` 通过。

---

## 7. Phase C：DefaultPlanResolver

### C1. ResolveProject

内部步骤固定：

1. validate workspaceID/projectID；
2. repository Get workspace/project；
3. canonicalize workspace root；
4. resolve project relative root；
5. resolve config paths；
6. authorize read/write；
7. glob/sort libraries；
8. 返回 immutable-by-convention ResolvedProject copy。

### C2. ResolveBuild

校验：

- build tool supported；
- source roots存在且在项目内；
- output dir在项目内或明确 Kairo-owned build dir；
- build.xml存在并在项目内；
- Ant targets 非空、无 shell injection 语义；
- toolchain 存在、javaHome canonical；
- source/target level 非空且组合合法；
- encoding supported；
- classpath jar存在、去重、排序；
- selected files在 source roots 内且 `.java`。

Plan 不包含客户端未验证路径。

### C3. ResolveDeploy

构造 file entries：

1. webapp directory递归文件 → root-relative target；
2. output classes → `WEB-INF/classes`；
3. resources → `WEB-INF/classes`；
4. library jars → `WEB-INF/lib`；
5. target collision detection：不同 source 映射到同 target 时 fail；
6. 排序稳定；
7. symlink policy：默认拒绝 source symlink，除非明确且仍在 root 内；
8. 每个 entry记录 size/mode。

### C4. ResolveRuntime

本任务只实现纯 plan 数据的 project/toolchain 部分，不查找 Tomcat、不分配 port、不创建 CatalinaBase，因为这些属于 Windows/Runtime 工作流。

允许返回一个明确的 partial/runtime input，或暂时返回 typed `ErrRuntimeIntegrationRequired`。不得修改 RuntimeProvider/API 来伪装完成。

### Phase C Gate

- sample Maven-style layout；
- `legacy-sample` 实际 layout；
- WebRoot 风格；
- project root含中文和空格；
- classpath重复；
- target collision；
- selected file escape；
- output dir escape；
- symlink source escape；
- deterministic plan snapshot。

---

## 8. Phase D：BuildUseCase 状态机与并发

### D1. Lifecycle

NewBuildUseCase 增加 application lifecycle context：

```go
NewBuildUseCase(
    lifecycle context.Context,
    ids IDGenerator,
    history BuildHistoryRepository,
    projects ProjectRepository,
    resolver PlanResolver,
    events BuildEventPublisher,
    providers BuildProviderRegistry,
)
```

后台 build context 从 lifecycle 派生，不从短命 HTTP request context 派生，也不直接用 `context.Background()`。

### D2. Thread safety

1. running state用 pointer + per-build mutex，或所有访问统一 manager mutex。
2. Get/List 返回 value copy。
3. 所有 state transition 经一个函数验证。
4. `go test -race` 启动并发 Get/List/Cancel 时无竞争。

### D3. State transition

合法转换：

```text
queued → running
queued → cancelled
running → succeeded
running → failed
running → cancelled
```

非法转换返回 error并测试。

### D4. Persistence ordering

1. queued 创建后先 Save，再返回；
2. running transition Save；
3. terminal transition Save；
4. terminal Save 成功后从 running map删除；
5. persistence失败要保留可查询状态并暴露 error，不能静默丢 build。

### D5. Cancel

1. cancel provider process context；
2. 等待 done遵守调用方 ctx/deadline，不硬编码不可配置 10s；
3. terminal state必须 cancelled；
4. terminal event只发一次；
5. 重复 cancel定义为 idempotent 或 conflict，写清楚并测试。

### D6. Events

本任务定义 app-level event：

```go
type BuildEvent struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    BuildID     BuildID
    Type        BuildEventType
    State       BuildState
    Message     string
    Time        time.Time
}
```

不能再用 BuildID 充当 WorkspaceID。

### D7. Provider registry

避免两个 nullable 字段：

```go
type BuildProviderRegistry interface {
    Get(id BuildToolID) (BuildProvider, bool)
}
```

unknown tool返回 typed unsupported error，不 panic。

### Phase D Gate

- fake slow provider cancel；
- provider ignore cancel timeout；
- validate failure；
- build failure with diagnostics；
- success；
- history failure；
- event publisher failure策略；
- lifecycle shutdown cancels all；
- 100 并发 builds/Get/List/Cancel race test。

---

## 9. Phase E：Ant 与 Javac Provider

### E1. Command abstraction

不要在测试里真正依赖全局 ANT_HOME。提供最小 runner：

```go
type CommandSpec struct {
    Executable string
    Args       []string
    Dir        string
    Env        []string
}

type CommandRunner interface {
    Run(ctx context.Context, spec CommandSpec, onLine func(Stream, string)) (CommandResult, error)
}
```

production runner使用 `exec.CommandContext`；unit test捕获 spec。

### E2. AntProvider

1. Ant executable从配置/plan解析，不直接读环境。
2. platform helper选择：
   - Windows `ant.bat`；
   - Unix `ant`。
3. working dir = ProjectRoot。
4. `-f BuildFile`。
5. clean target和 build targets顺序明确。
6. `-D` properties在 target前传入。
7. JavaHome来自 BuildPlan。
8. 按行读取 stdout/stderr并发 progress/log。
9. 保留完整 log到 caller-provided writer/path，避免无限 RawLog 内存。
10. exit code 与 context cancelled分类。

### E3. JavacProvider

1. executable使用 JavaHome/bin/javac(.exe)。
2. working dir = ProjectRoot。
3. sources deterministic sort。
4. argfile UTF-8，正确 quote。
5. compiler options和 source file argfile可一起进入 argfile，减少 Windows command length。
6. selected files时只编译计划内文件。
7. classpath使用 platform list separator。
8. output创建前验证仍在 authorized root。
9. context cancel映射 cancelled。
10. 无 source文件是否成功必须由产品语义决定并测试。

### E4. Diagnostics

覆盖：

- Unix absolute path；
- `C:\work\Foo.java:12`；
- path含空格/中文；
- error/warning/中文“错误/警告/注意”；
- column/caret next line；
- multiline message；
- Ant `[javac]` prefix。

### Phase E Gate

- captured CommandSpec符合 snapshot；
- real local javac fixture build；
- cancelled javac process消失；
- 500+ source paths使用 argfile；
- Windows cross compile；
- provider tests不要求安装 Ant。

---

## 10. Phase F：Safe DeployEngine

### F1. Preflight

DeployEngine执行任何写入前完整验证 plan：

1. deploymentRoot canonical 且是 Kairo-owned/authorized root；
2. entry target是 slash-relative；
3. target不为空、不 absolute、无 volume、无 `..`；
4. resolved target在 root 内；
5. target ancestor symlink policy通过；
6. source存在、regular file、authorized；
7. duplicate target fail；
8. action合法；
9. mirror keepSet完整。

preflight失败必须 0 写入。

### F2. Execution

1. mkdir parent；
2. temp file同目录；
3. copy + chmod + fsync + close；
4. atomic replace；
5. 记录 summary；
6. delete只允许 file和已验证 empty dir策略；禁止未经验证 RemoveAll；
7. context cancel每 N 个文件检查；
8. partial failure返回 `DeployResult{Partial:true,...}` 与 error。

### F3. Mirror

1. 先建立 plan targets完整集合；
2. walk deployment root；
3. 不跟随 symlink；
4. Kairo protected files/dirs allowlist；
5. stale file按深度排序删除；
6. 空目录最后删除；
7. mirror只能用于 Kairo-owned deployment root。

### F4. Atomic replace platform boundary

创建小型内部 abstraction，Unix 在 Mac 真测。Windows 实机结果留给 Windows 工作流，但必须：

- Windows cross compile；
- API可以处理 sharing violation并返回 actionable error；
- 不用 build-breaking syscall 占位；
- 不通过 `Remove(dst); Rename(tmp,dst)` 制造非原子窗口，除非有明确 fallback/backup策略。

### Phase F Security Gate

必须覆盖：

- `../outside`；
- absolute target；
- `C:\outside` lexical input；
- UNC target；
- deployment root内 symlink → outside；
- target parent symlink → outside；
- source symlink → outside；
- delete root itself；
- empty target；
- duplicate target；
- collision file vs directory；
- cancel mid-deploy；
- read failure mid-deploy；
- mirror protected path。

测试结束后 outside sentinel 文件必须字节不变。

---

## 11. Phase G：纯后端 Integration

新增 `runtime-agent/test/core/`，不启动 HTTP、Theia、Electron、Tomcat。

### G1. Repository → Plan → Javac → Deploy

使用复制到 `t.TempDir()` 的小型 fixture：

1. 创建 workspace repository；
2. 生成 opaque workspace/project ID；
3. 保存 project catalog；
4. 保存 `.kairo/project.yaml`；
5. resolver产生 BuildPlan；
6. JavacProvider真实编译；
7. BuildUseCase记录 success；
8. resolver产生 DeployPlan；
9. DeployEngine复制到临时 deployment root；
10. 断言 class在 `WEB-INF/classes`，resources正确，webapp正确。

### G2. Ant plan integration

不要求本机安装 Ant：使用 fake command runner验证完整 Ant command spec。

如果本机有 Ant，可增加 opt-in non-gating真实 fixture，但不能让默认 test skip核心 plan验证。

### G3. Cancellation integration

fake executable或 shell-free helper process：

- provider启动；
- Cancel；
- process退出；
- state cancelled；
- history可查；
- terminal event一次。

### G4. Corruption/recovery

- truncated catalog；
- unsupported schema；
- invalid YAML；
- missing workspace；
- moved project root；
- missing toolchain；
- history损坏。

不得自动覆盖损坏数据。

---

## 12. 测试与质量 Gate

Integration Agent 最终执行：

```bash
cd runtime-agent

gofmt -w internal/domain internal/repository internal/provider/build internal/app internal/build internal/deploy internal/security test/core

go vet ./internal/domain/... ./internal/repository/... ./internal/provider/build/... ./internal/app/... ./internal/build/... ./internal/deploy/... ./internal/security/... ./test/core/...

go test -count=1 \
  ./internal/domain/... \
  ./internal/repository/... \
  ./internal/provider/build/... \
  ./internal/app/... \
  ./internal/build/... \
  ./internal/deploy/... \
  ./internal/security/... \
  ./test/core/...

go test -count=1 -race \
  ./internal/domain/... \
  ./internal/repository/... \
  ./internal/provider/build/... \
  ./internal/app/... \
  ./internal/build/... \
  ./internal/deploy/... \
  ./internal/security/... \
  ./test/core/...

go test -count=20 ./internal/repository/... ./internal/app/... ./internal/deploy/...

GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ./...
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./...
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./...
```

最后再跑：

```bash
go test -count=1 -race ./...
```

如果全仓测试失败来自 Windows 分支正在修复的禁区文件，记录准确失败证据，不越界修复。

### 覆盖率要求

不追求全仓虚假百分比，但以下核心包目标：

| 包 | 行覆盖率目标 |
|---|---:|
| repository | ≥ 85% |
| planning/plan resolver | ≥ 90% |
| app build use case | ≥ 85% |
| provider/build | ≥ 80% |
| deploy | ≥ 90% |
| path policy/security新增部分 | ≥ 90% |

安全分支和错误路径必须覆盖，不能只覆盖 happy path。

---

## 13. 禁止事项

1. 不引入 SQLite。
2. 不引入 ORM。
3. 不新增 remote/auth 功能。
4. 不修改 API/TypeScript protocol。
5. 不接入 bootstrap。
6. 不修改 Desktop/Windows scripts。
7. 不实现 Tomcat lifecycle。
8. 不实现 naive timestamp incremental compilation。
9. 不让 ProjectID 继续兼容 path；应彻底移除该语义。
10. 不使用 `strings.HasPrefix` 单独判断 containment。
11. 不吞 repository/Walk/Save/fsync 错误。
12. 不用 `os.RemoveAll` 处理未严格验证的 caller-derived target。
13. 不复制生产逻辑到测试。
14. 不用 `t.Skip` 跳过核心测试。
15. 不因 macOS 通过就声称 Windows runtime 已验证，只能声称 Windows cross-build通过。
16. 不修改 `docs/MILESTONES.md`，避免两台机器冲突。

---

## 14. Git 与两机合并策略

### 14.1 开始

Mac：

```bash
git fetch origin
git switch -c feature/mac-project-build-core b22ac39
```

Windows 建议使用：

```text
feature/windows-readiness
```

两台机器不得直接在 main 上开发。

### 14.2 提交粒度

Mac 建议提交：

```text
refactor(domain): separate project identity from paths
feat(repository): add workspace and project catalog repositories
feat(planning): implement trusted project and build plan resolver
refactor(build): make build use case race-safe and cancellable
refactor(build): harden ant and javac providers
refactor(deploy): enforce contained file-only deployment plans
test(core): add repository-build-deploy integration and fault tests
docs(adr): record project identity and execution planning decision
```

每个提交都必须独立编译和测试。

### 14.3 合并顺序

推荐：

1. Windows readiness 分支先完成并合并 main；
2. Mac 分支 fetch 新 main；
3. Mac 分支 rebase main；
4. 因文件边界隔离，理论上只应有极少冲突；
5. 创建 integration branch；
6. Integration Lead 接 use case 到 bootstrap/API，这是下一任务，不在 Mac 分支完成；
7. 全量 Windows + Mac CI 后再合并。

### 14.4 冲突规则

若 rebase 出现禁区文件冲突：

- Mac 不应选择 ours 覆盖 Windows；
- 保留 Windows 版本；
- 将需要的 integration变化单独列入报告；
- 不在 rebase 中顺手重构外部文件。

---

## 15. Definition of Done

本 Mac 长任务只有满足全部条件才完成：

- [ ] ProjectID/WorkspaceID 不含路径语义
- [ ] 全仓 owned scope 中无 `string(projectID)` 作为文件路径
- [ ] Project catalog 将 ID 映射到 workspace-relative root
- [ ] `.kairo/project.yaml` 是真正 YAML
- [ ] config strict decode/default/validate/migrate 完整
- [ ] repository 并发更新无 lost update
- [ ] corruption 不被静默覆盖
- [ ] DefaultPlanResolver 有真实实现
- [ ] BuildPlan 含 project root、toolchain、classpath、targets
- [ ] selected files containment验证
- [ ] DeployPlan classes/resources/webapp/libs映射正确
- [ ] BuildUseCase `go test -race` 无竞争
- [ ] Cancel 真正终止 provider并记录 cancelled
- [ ] progress event使用正确 WorkspaceID
- [ ] diagnostics进入 BuildRun/history
- [ ] AntProvider不再把 source root当 project root
- [ ] Ant Windows executable策略存在并可 cross-build
- [ ] Javac argfile、排序、Windows path覆盖
- [ ] Deploy preflight失败时 0 写入
- [ ] target/symlink无法逃逸 deployment root
- [ ] mirror语义有完整测试
- [ ] pure core integration通过
- [ ] `go test -race` owned scope通过
- [ ] Windows/Linux/macOS cross-build通过
- [ ] 未修改任何禁区文件
- [ ] ADR和最终报告完成

---

## 16. 最终报告格式

创建：

```text
docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md
```

必须包含：

1. Executive summary。
2. 起始 commit和最终 commit。
3. 实际修改文件清单。
4. 未修改禁区证明：`git diff --name-only b22ac39...HEAD`。
5. 旧模型 → 新模型迁移说明。
6. Repository 文件格式示例。
7. Build/Deploy plan 示例。
8. 状态机说明。
9. 安全威胁与对应测试表。
10. 所有测试命令、退出码、用时、覆盖率。
11. cross-build结果。
12. 未完成项。
13. `Integration Requests`：后续接 bootstrap/API 时需要 Windows/主线处理的事项。
14. 已知 Windows 实机待验证项，不能写成已完成。

---

## 17. 给 Mac AI 的最终执行指令

请严格按 Phase A → B → C → D → E → F → G 顺序推进。允许 Agent 在同一 Phase 内并行，但 domain contract未冻结前不要并行实现 resolver/provider。

本任务的核心不是新增更多文件，而是把当前已有 skeleton 变成：

- 语义正确；
- 路径安全；
- 可测试；
- 可取消；
- 可持久化；
- 跨平台可编译；
- 后续能被 composition root可靠接入的后端核心。

遇到 Windows 工作流正在修改的文件时停止越界；把 integration需求写入最终报告。不要为了提前“跑通 UI”破坏两台机器的并行边界。

