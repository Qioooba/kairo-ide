# Kairo IDE — Wave 1 后端架构收敛文档

> 文档用途：Backend Core Agent (Agent A) 的开发任务书  
> 负责 Agent：Agent A — Backend Core  
> 预计工作量：5-7 天  
> 前置条件：Wave 0 Gate 全部通过  
> 后置 Gate：composition root 切换完成，Project 单一真相，typed boundary

---

## 0. 目标

将后端架构从"旧 God Service + RawMessage"收敛为"typed use cases + repository + plan resolver"的单一真相架构。新 `app/` 层成为生产唯一业务入口。

---

## 1. 任务清单

### 1.1 修正 domain model

**问题**：`ProjectID` 被当路径使用，ID 与路径语义混淆。

**修改文件**：`runtime-agent/internal/domain/project.go`

**目标接口**：

```go
// ProjectID 是 opaque identifier，不包含路径信息
type ProjectID string

// Project 是 domain entity
type Project struct {
    ID          ProjectID
    WorkspaceID WorkspaceID
    Name        string
    RootPath    string          // canonical absolute path（仅 repository 内部使用）
    Config      ProjectConfig   // 从 .kairo/project.yaml 加载
}

// ProjectConfig 是 .kairo/project.yaml 的内容
type ProjectConfig struct {
    SchemaVersion int      `yaml:"schemaVersion"`
    Name          string   `yaml:"name"`
    SourceRoots   []string `yaml:"sourceRoots"`    // 相对路径
    ResourceRoots []string `yaml:"resourceRoots"`  // 相对路径
    WebappDir     string   `yaml:"webappDir"`      // 相对路径
    OutputDir     string   `yaml:"outputDir"`      // 相对路径
    SourceLevel   string   `yaml:"sourceLevel"`
    TargetLevel   string   `yaml:"targetLevel"`
    Encoding      string   `yaml:"encoding"`
    BuildTool     string   `yaml:"buildTool"`      // "ant" | "javac"
    ContextPath   string   `yaml:"contextPath"`
    ToolchainID   string   `yaml:"toolchainId"`
    RuntimeID     string   `yaml:"runtimeId"`
}
```

**必须实现的测试**：
- `ProjectID` 不等于路径测试
- 相对路径解析测试（Windows drive path 覆盖）
- `..` 注入、绝对路径注入、symlink escape 拒绝测试

### 1.2 实现 `.kairo/project.yaml` schema + loader + validator

**新文件**：`runtime-agent/internal/repository/project_yaml.go`（修正现有文件）

**目标功能**：
1. `LoadProjectConfig(rootPath string) (ProjectConfig, error)` — 从 `.kairo/project.yaml` 加载
2. `SaveProjectConfig(rootPath string, config ProjectConfig) error` — **原子写入**：temp + fsync + rename
3. `ValidateProjectConfig(config ProjectConfig) error` — 关键字段缺失时返回明确 validation error
4. `MigrateFromLegacyFlow(rootPath string) (ProjectConfig, error)` — 从 `.legacyflow/project.yaml` 迁移

**迁移策略**：
- 首次打开时读取 `.legacyflow/project.yaml`，显示迁移预览
- 成功写入 `.kairo/project.yaml` 后保留原文件但不再双写
- 迁移失败时明确报错，不静默回退

**必须实现的测试**：
- 未知 schema version 返回 typed error
- 数据损坏/截断 JSON 返回明确错误
- 原子写入：进程崩溃不留下半文件
- 迁移：旧格式 → 新格式 round-trip

### 1.3 实现 PlanResolver

**新文件**：`runtime-agent/internal/app/plan_resolver.go`

**目标接口**：

```go
type PlanResolver interface {
    ResolveBuild(ctx context.Context, project Project, intent BuildIntent) (BuildPlan, error)
    ResolveDeploy(ctx context.Context, project Project, buildID BuildID) (DeployPlan, error)
    ResolveRuntime(ctx context.Context, project Project) (RuntimePlan, error)
}

type BuildPlan struct {
    ProjectRoot  string
    SourceRoots  []string
    OutputDir    string
    Classpath    []string
    Toolchain    Toolchain
    BuildTool    string
    AntTarget    string   // 可选
    AntFile      string   // 可选
}

type DeployPlan struct {
    ProjectRoot string
    WebappDir   string
    OutputDir   string
    ResourceRoots []string
    LibDirs     []string
    TargetDir   string   // isolated deployment root
    Scope       DeployScope
}

type RuntimePlan struct {
    JavaHome    string
    CatalinaBase string
    WebappDir   string
    ContextPath string
    Port        int
    ProjectRoot string
}
```

**关键规则**：
- Plan 中所有路径都从 `Project.RootPath` 解析，经过 sandbox 校验
- Plan 不由客户端构造，不由 handler 拼接
- 端口从 PortAllocator 分配，不硬编码

### 1.4 实现 typed use cases

**新文件**：
- `runtime-agent/internal/app/build_usecase.go`
- `runtime-agent/internal/app/deploy_usecase.go`
- `runtime-agent/internal/app/server_usecase.go`

**目标接口**：

```go
type BuildUseCase interface {
    Start(ctx context.Context, cmd StartBuildCommand) (BuildRun, error)
    Get(ctx context.Context, workspaceID WorkspaceID, buildID BuildID) (BuildRun, error)
    List(ctx context.Context, workspaceID WorkspaceID, projectID ProjectID, limit int) ([]BuildRun, error)
    Cancel(ctx context.Context, workspaceID WorkspaceID, buildID BuildID) error
}

type StartBuildCommand struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    Clean       bool
    Intent      BuildIntent  // "full" | "selected-files"
    Files       []string     // 相对路径
}
```

**实现要求**：
- 所有 use case 接收 typed command/query，不接受 `json.RawMessage`
- 内部调用：repository → plan resolver → provider → event hub
- Build history 持久化到 `repository.BuildHistoryRepo`
- 状态自动发布到 EventHub

### 1.5 修正 repository 原子写入

**修改文件**：`runtime-agent/internal/repository/atomicfile.go`

**当前问题**：
- `SaveProjectConfig` 注释声称 atomic 但实际用 `os.WriteFile`
- 没有先创建父目录
- fsync 错误被忽略
- Windows 覆盖 rename 行为未验证

**目标实现**：

```go
func AtomicWriteJSON[T any](path string, value T, perm fs.FileMode) error {
    // 1. 创建父目录
    // 2. 同目录创建 temp 文件
    // 3. json.NewEncoder + encoder.Close()
    // 4. File.Sync()
    // 5. File.Close()
    // 6. os.Rename(temp, path)  // Windows: MoveFileExW
    // 7. 可选：sync parent directory
}
```

**必须实现的测试**：
- 写入中断不留下半文件
- 目标目录不存在时自动创建
- Windows 覆盖已存在文件（MoveFileExW 行为）
- 并发写入安全性（同一文件同时只有一个 writer）

### 1.6 修正 HTTP handlers — 强类型 boundary

**修改文件**：`runtime-agent/internal/api/handlers.go`

**目标**：
- 每个 handler 只做：decode → validate → use case → error mapping → encode
- `json.RawMessage` 完全不出现在 app 层
- 使用统一 `decodeEnvelope[T]`、`writeEnvelope[T]`
- 定义 typed error → HTTP status/code 映射

**错误映射**：
```go
func mapError(err error) (int, string) {
    switch {
    case errors.Is(err, ErrInvalidInput):   return 400, "invalid_input"
    case errors.Is(err, ErrUnauthenticated): return 401, "unauthenticated"
    case errors.Is(err, ErrForbidden):      return 403, "forbidden"
    case errors.Is(err, ErrNotFound):       return 404, "not_found"
    case errors.Is(err, ErrConflict):       return 409, "conflict"
    default:                                return 500, "internal_error"
    }
}
```

### 1.7 修正 composition root

**修改文件**：`runtime-agent/internal/bootstrap/container.go`

**目标**：
- `main.go` 不再调用 `services.NewMemoryServices`
- `container.go` 创建所有 typed repositories、providers、use cases、EventHub
- 将完整 container 注入到 HTTP server

**依赖注入顺序**：
```go
func NewContainer(cfg Config) (*Container, error) {
    // 1. Sandbox (WorkspaceRoots)
    // 2. Repositories (workspace, project, toolchain, history)
    // 3. Providers (Ant, Javac, Tomcat6)
    // 4. PlanResolver
    // 5. EventHub
    // 6. Use Cases (Build, Deploy, Server)
    // 7. HTTP handlers
    // 8. Shutdown hooks
}
```

### 1.8 删除旧代码

**修改文件**：`runtime-agent/internal/services/services.go`

**删除策略**：
- 如果某个 service 方法已被新 use case 完全替代 → 删除
- 如果暂时保留 search/encoding adapter → 拆成小文件并实现 typed port
- 不保留 God Service 作为主入口
- 删除 `runtime-agent/internal/platform/hostsupervisor.go`（死代码，桌面宿主属于 Electron）

### 1.9 对接前端 WorkspaceContext

**修改文件**：`packages/runtime-extension/src/browser/workspace-context-service.ts`

**目标**：
- 监听 Theia WorkspaceService 的 root change
- 首次打开 root 时调用 `/api/v1/workspaces` 对应 Kairo workspace
- 设置 runtime workspace header

---

## 2. Wave 1 Gate Checklist

- [ ] `main.go` 不再调用 `NewMemoryServices` 作为业务主干
- [ ] `json.RawMessage` 不出现在 app 层（grep 验证）
- [ ] ProjectID 与路径完全分离（有测试证明）
- [ ] `.kairo/project.yaml` 是唯一配置真相
- [ ] 所有 JSON/YAML 写入原子化（有测试证明）
- [ ] 打开 sample → 导入 → 重启 IDE → 项目仍可解析
- [ ] Handler 的 DTO 全部强类型
- [ ] `go test -count=1 ./...` 全绿
- [ ] 搜索全仓，核心业务不得再从 handler 调旧 RawMessage service

---

## 3. 具体文件变更清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `internal/domain/project.go` | 重写 | ProjectID opaque, ProjectConfig struct |
| `internal/domain/build.go` | 新增/修正 | BuildRun, BuildState, BuildID |
| `internal/domain/server.go` | 新增/修正 | ServerInstance, ServerID, RuntimeState |
| `internal/domain/path.go` | 新增 | WorkspacePath, CanonicalPath |
| `internal/domain/errors.go` | 新增 | DomainError, ValidationError |
| `internal/repository/project_yaml.go` | 修正 | 原子写入、schema 校验、迁移 |
| `internal/repository/project_catalog.go` | 修正 | 新 typed project store |
| `internal/repository/build_history_repo.go` | 修正 | 原子写入 |
| `internal/repository/server_history_repo.go` | 修正 | 原子写入 |
| `internal/repository/atomicfile.go` | 修正 | 完整原子写入实现 |
| `internal/app/plan_resolver.go` | 新增 | BuildPlan/DeployPlan/RuntimePlan resolver |
| `internal/app/build_usecase.go` | 新增 | BuildUseCase 接口和实现 |
| `internal/app/deploy_usecase.go` | 新增 | DeployUseCase 接口和实现 |
| `internal/app/server_usecase.go` | 新增 | ServerUseCase 接口和实现 |
| `internal/bootstrap/container.go` | 重写 | 新 composition root |
| `internal/api/handlers.go` | 重写 | 强类型 boundary，每资源 handler |
| `internal/api/server.go` | 修正 | 注入新 container |
| `internal/api/dto.go` | 重写 | 与 protocol 对齐的 wire DTO |
| `internal/services/services.go` | 拆分/删除 | 被替代部分删除 |
| `internal/platform/hostsupervisor.go` | 删除 | 死代码 |
| `cmd/kairo-runtime/main.go` | 修正 | 使用新 container |
| `packages/runtime-extension/.../workspace-context-service.ts` | 修正 | 对接 Kairo workspace |

---

## 4. 禁止事项

- 不得创建只有一个 struct 的 package（拆分标准：独立生命周期、独立测试边界、独立依赖方向）
- 不得在 handler 中直接操作文件和进程
- 不得保留 `_ = os.WriteFile` 或 `data, _ := json.Marshal`
- 不得让旧 `services.go` 和新 `app/` 长期平行存在