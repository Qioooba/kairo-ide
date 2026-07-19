# Kairo IDE — 目标架构设计文档

> 文档用途：所有 Agent 的统一架构参考基线  
> 创建日期：2026-07-19  
> 前置阅读：`docs/architecture.md`、`docs/adr/0014-desktop-localhost-v1.md`

---

## 1. 目标架构总览

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Theia Browser UI                              │
│         Commands + ReactWidget + Stores                         │
│         (packages/theia-product, *-extension)                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP + WebSocket (secret auth)
┌─────────────────────────▼───────────────────────────────────────┐
│              RuntimeConnectionService                            │
│         (packages/runtime-extension)                             │
│         - 唯一 HTTP client + 一个业务 event socket               │
│         - 自动 X-Kairo-Secret header                             │
│         - sequence replay / reconnect / jitter                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│              Transport Layer (runtime-agent/internal/transport)  │
│         - HTTP handlers: decode → validate → use case → encode  │
│         - WebSocket adapter: EventHub → browser                 │
│         - JSON ONLY at boundary, RawMessage forbidden            │
│         - Middleware: secret auth, request ID, panic recovery    │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│              Application Layer (runtime-agent/internal/app)     │
│         - Typed Use Cases: Project / Build / Deploy / Server     │
│         - Plan Resolver: BuildPlan / DeployPlan / RuntimePlan    │
│         - Command/Query DTO, no RawMessage                       │
│         - ID is opaque; path comes from repository               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│              Domain Layer (runtime-agent/internal/domain)        │
│         - Project, BuildRun, ServerInstance, WorkspacePath       │
│         - ID types: ProjectID, WorkspaceID, BuildID, ServerID   │
│         - Value objects: no import of api/json/http              │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Repository  │ │   Provider   │ │   EventHub   │
│  (internal/  │ │  (internal/  │ │  (internal/  │
│  repository) │ │  provider)   │ │  transport/  │
│              │ │              │ │  events)     │
│ - Workspace  │ │ - Ant        │ │ - sequence   │
│ - Project    │ │ - Javac      │ │ - replay     │
│ - Toolchain  │ │ - Tomcat6    │ │ - gap detect │
│ - History    │ │ - Deploy     │ │ - per WS sub │
│ - Atomic IO  │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 2. 依赖方向规则（唯一允许）

```text
transport → app → domain
                  ↑
repository/provider 实现 app/domain 定义的 port
```

**禁止：**
- domain import api/json/http
- app 把 ID 转成路径
- provider 自己寻找任意项目
- handler 直接操作文件和进程
- browser widget 直接 fetch
- 同一种状态同时存在旧 widget cache、新 store 和 status polling 三套真相

---

## 3. 目标目录结构

```text
runtime-agent/
  cmd/kairo-runtime/           # 唯一入口，只做参数解析和启动
  internal/
    bootstrap/                 # 唯一 composition root
      container.go             # 创建所有依赖，注入到 HTTP layer
    app/                       # use cases（业务编排层）
      workspace/               # ImportWorkspace, GetWorkspace
      project/                 # ImportProject, GetProject, ListProjects
      build/                   # StartBuild, CancelBuild, GetBuild, ListBuilds
      deploy/                  # StartDeploy, GetDeploy, ListDeployments
      server/                  # StartServer, StopServer, RestartServer, GetServer
      encoding/                # ValidateEncoding, RecodeFile
    domain/                    # 小而稳定的实体和值对象
      project.go               # Project, ProjectID, ProjectConfig
      build.go                 # BuildRun, BuildID, BuildState, BuildOutput
      server.go                # ServerInstance, ServerID, RuntimeState
      path.go                  # WorkspacePath, CanonicalPath
      errors.go                # DomainError, ValidationError
    repository/                # 持久化（versioned, atomic）
      workspace_file.go        # WorkspaceRepository
      project_yaml.go          # ProjectRepository (.kairo/project.yaml)
      toolchain_file.go        # ToolchainRepository
      build_history_repo.go    # BuildHistoryRepository
      server_history_repo.go   # ServerHistoryRepository
      atomicfile.go            # AtomicWriteJSON, AtomicWrite
    provider/                  # 编译期静态 Provider
      build/
        ant.go                 # AntBuildProvider
        javac.go               # JavacBuildProvider
      runtime/
        tomcat6_provider.go    # Tomcat6RuntimeProvider
    platform/                  # 平台抽象
      proc/                    # Process management (Windows + Unix)
      filesystem/              # Atomic rename, symlink check
    transport/
      http/
        dto/                   # Wire DTO (与 packages/protocol 对应)
        handlers/              # 每资源一个 handler 文件
        middleware/             # secret auth, request ID, recovery
        server.go              # HTTP server setup
      events/
        eventhub.go            # EventHub: multi-subscriber, sequence, replay
        websocket.go           # WebSocket adapter
    security/                  # 安全
      sandbox.go               # WorkspaceRoots, path validation
      localauth.go             # Secret-based auth middleware
    toolchain/                 # JDK/Ant 工具链管理
    encoding/                  # 编码检测/转换（x/text）
    search/                    # 文件搜索（后续换 ripgrep）
    catalinabase/              # Tomcat CATALINA_BASE 布局生成
    jdtproject/                # JDT .project/.classpath 生成
    jdtls/                     # JDT LS 发行物准备（仅 asset preparation）
    config/                    # 配置加载
    audit/                     # 审计日志（dev 诊断用途）
    log/                       # 日志

packages/
  protocol/                    # wire DTO + EndpointMap + fixtures
  runtime-extension/           # 唯一 HTTP/event connection singleton
  project-extension/           # import wizard + active project
  build-extension/             # build/problems UI
  tomcat-extension/            # server/deploy/log UI
  encoding-extension/          # 编码检测/保存
  java-extension/              # JDT LS integration
    src/browser/               # Language Client contribution
    src/node/                  # JDT LS child process + stdio
  jsp-extension/               # JSP grammar
  search-extension/            # search UI
  ui-kit/                      # theme + small reusable React components
  theia-product/               # 只做 composition root（不包含业务逻辑）
  config-schema/               # Theia 配置 schema
  drivelist-stub/              # 平台模拟

apps/
  browser/                     # localhost browser host
  desktop/                     # self-contained Electron/Theia
  server/                      # experimental（标记为不发布）
```

---

## 4. 关键设计决策

### 4.1 ProjectID 与路径分离

```go
// ❌ 当前错误做法
func (s *buildService) Start(projectID string) {
    root := projectID  // 把 ID 当路径用
}

// ✅ 目标做法
type ProjectID string  // opaque identifier

func (uc *BuildUseCase) Start(ctx context.Context, cmd StartBuildCommand) (BuildRun, error) {
    project, err := uc.projectRepo.Get(ctx, cmd.WorkspaceID, cmd.ProjectID)
    plan, err := uc.planResolver.ResolveBuild(ctx, project)
    // plan 中所有路径都从 canonical root 解析，经过 sandbox 校验
}
```

### 4.2 强类型 HTTP Boundary

```go
// ❌ 当前
func (h *handler) handleBuilds(w http.ResponseWriter, r *http.Request) {
    var raw json.RawMessage
    json.NewDecoder(r.Body).Decode(&raw)
    h.services.BuildService.Start(r.Context(), raw) // RawMessage 进 service
}

// ✅ 目标
func (h *buildHandler) handleStartBuild(w http.ResponseWriter, r *http.Request) {
    var req StartBuildRequest  // typed DTO
    decodeEnvelope(r, &req)
    result, err := h.buildUC.Start(r.Context(), StartBuildCommand{
        WorkspaceID: req.WorkspaceID,
        ProjectID:   req.ProjectID,
        Clean:       req.Clean,
    })
    writeEnvelope(w, toBuildResponse(result))
}
```

### 4.3 Canonical 配置分离

```text
<workspace>/.kairo/project.yaml       # 可共享、可进 Git 的项目定义
<dataDir>/workspaces.json             # 本机最近工作区
<dataDir>/user-state.json             # active project、UI 偏好
<dataDir>/toolchains.json             # 本机 JDK/Ant 引用和 fingerprint
<dataDir>/history/builds/*.json       # bounded history
<dataDir>/history/deployments/*.json
<dataDir>/runtime/<server-id>/        # CATALINA_BASE、日志、pid identity
```

### 4.4 JDT LS 所有权

```text
Monaco / Theia Language Client
              │ Theia 原生消息通道
Theia backend KairoJavaLanguageServerContribution
              │ stdio (Content-Length framing)
         JDT LS child process

Go Agent:
  - 解析 ProjectConfig / toolchain
  - 准备或验证固定版本 JDT LS 发行物
  - 返回 LaunchDescriptor
  - 不代理 LSP frame，不发送 initialize
```

### 4.5 部署映射

| Scope | Source | Target |
|-------|--------|--------|
| webapp | resolved webappDir | isolated deployed webapp root |
| classes | build output | `WEB-INF/classes` |
| resources | resource roots | `WEB-INF/classes` |
| libs | configured libs | `WEB-INF/lib` |

---

## 5. 事件体系设计

```go
type EventHub struct {
    // subscribers: workspaceID → subscriberID → channel
    subscribers map[string]map[string]chan Event
    sequence    int64  // global monotonic sequence
    history     []Event // bounded ring buffer
    maxHistory  int
}

type Event struct {
    Sequence    int64
    WorkspaceID string
    Type        string  // "build.started", "server.stopped", etc.
    Payload     json.RawMessage
    Timestamp   time.Time
}

// WebSocket 连接参数: ?workspaceId=xxx&afterSequence=123
// 重连时先 replay history 中 afterSequence 之后的事件
// history 不足时发送 snapshot.required 事件，前端重新 GET snapshot
```

---

## 6. 不引入的依赖

- **SQLite** — 当前数据规模小，原子文件存储优先
- **react-virtuoso** — 日志窗口化用 Theia/React 现有依赖即可
- **OpenAPI 代码生成** — v1 手写 DTO，契约稳定后再评估
- **动态插件协议** — v1 只有编译期静态 Provider
- **状态管理框架（Redux/MobX）** — 用 React useState + useReducer + store class
- **新数据库驱动** — 不需要