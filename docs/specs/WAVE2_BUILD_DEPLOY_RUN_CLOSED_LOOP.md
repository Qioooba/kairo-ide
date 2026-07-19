# Kairo IDE — Wave 2 Build/Deploy/Run 真闭环文档

> 文档用途：Backend Core Agent (Agent A) + Runtime Providers Agent (Agent B) 的开发任务书  
> 负责 Agent：Agent A — Backend Core（use case 层）、Agent B — Runtime Providers（provider 层）  
> 预计工作量：7-10 天  
> 前置条件：Wave 1 Gate 全部通过  
> 后置 Gate：主链闭环 → import → build → deploy → run → restart → stop 全通

---

## 0. 目标

实现 Build → Deploy → Run → Restart → Stop 的真实产品闭环。客户端只提交 `projectId` 和意图，所有执行路径由 Agent 从 trust 的 project/toolchain repository 解析。

---

## 1. Agent A 任务（use case 层 + API 契约）

### 1.1 冻结 API contract

**文件**：`packages/protocol/src/index.ts` + `runtime-agent/internal/api/dto.go`

**最终 API**：

```text
GET    /api/v1/workspaces
POST   /api/v1/workspaces
POST   /api/v1/workspaces/{workspaceId}/scan

GET    /api/v1/projects?workspaceId=
GET    /api/v1/projects/{projectId}
PUT    /api/v1/projects/{projectId}

GET    /api/v1/builds?projectId=&limit=
POST   /api/v1/builds
GET    /api/v1/builds/{buildId}
DELETE /api/v1/builds/{buildId}          # cancel

GET    /api/v1/deployments?projectId=
POST   /api/v1/deployments
GET    /api/v1/deployments/{deploymentId}

GET    /api/v1/servers?projectId=
POST   /api/v1/servers
GET    /api/v1/servers/{serverId}
POST   /api/v1/servers/{serverId}/restart
DELETE /api/v1/servers/{serverId}
GET    /api/v1/servers/{serverId}/logs

GET    /api/v1/events?workspaceId={ws}&after={sequence}

GET    /api/v1/health
GET    /api/v1/health/ready
```

**意图请求只包含**：

```ts
type StartBuildRequest = {
  projectId: string;
  clean?: boolean;
  intent?: 'full' | 'selected-files';
  selectedFiles?: string[];
};

type StartDeploymentRequest = {
  projectId: string;
  buildId: string;
  scope: 'all' | 'classes' | 'webapp' | 'resources';
};

type StartServerRequest = {
  projectId: string;
};
```

**不得出现**：`projectRoot`、`outputDir`、`source`、`target`、`javaHome`、`webappDir` 等执行路径。

### 1.2 实现 BuildUseCase 完整逻辑

**文件**：`runtime-agent/internal/app/build_usecase.go`

**状态机**：
```go
type BuildState string
const (
    BuildQueued    BuildState = "queued"
    BuildRunning   BuildState = "running"
    BuildSucceeded BuildState = "succeeded"
    BuildFailed    BuildState = "failed"
    BuildCancelled BuildState = "cancelled"
)
// 只允许合法转移: queued→running→succeeded|failed|cancelled
```

**实现要求**：
1. `Start` 立即创建 pending/running BuildRun 并**异步执行**
2. 为每个 build 保存 cancel function；`Cancel` 必须终止真实 Ant/javac 子进程
3. BuildRun 状态机只允许合法转移，非法转移返回 error
4. build output/diagnostics 持久化到 `BuildHistoryRepo`
5. `List` 稳定按开始时间倒序，支持 limit
6. 事件发布：`build.queued` → `build.started` → `build.progress` → `build.completed|failed|cancelled`

### 1.3 实现 DeployUseCase 正确映射

**文件**：`runtime-agent/internal/app/deploy_usecase.go`

**部署映射**：
```go
// Scope → Source → Target 映射
// "webapp":    webappDir → isolated deployed webapp root
// "classes":   build output → WEB-INF/classes
// "resources": resource roots → WEB-INF/classes
// "libs":      configured libs → WEB-INF/lib
// "all":       all of the above
```

**实现要求**：
1. target 是 Kairo 创建的 isolated CatalinaBase/deployment root，不允许任意客户端目标
2. 默认 merge；mirror/delete 必须显式内部策略并限制在 Kairo-owned root
3. 使用现有 `internal/deploy/sync.go` sync primitive，添加 dry plan、数量/字节统计
4. deployment 失败不得留下 "success" 记录；部分写入要报告 partial details
5. JSP/static sync 诚实命名为 "Static Sync"，不声称 class HotSwap

### 1.4 实现 ServerUseCase 原子 Restart

**文件**：`runtime-agent/internal/app/server_usecase.go`

**实现要求**：
1. `RuntimePlan` 从 Project、Toolchain、Tomcat distribution、PortAllocator 解析
2. CatalinaBase 使用随机 ServerID（如 UUID），不使用原始 ProjectID 路径
3. start timeout、stop timeout 从 config 注入（不硬编码）
4. `Restart` 是后端原子 use case：保存 plan → graceful stop → 必要时 force → start → 返回新状态
5. UI 只调用 `/restart`，不得自己循环 Stop/Start
6. Agent 启动时 reconcile 已保存 server record 与真实 PID，陈旧记录标记 `stopped`/`crashed`
7. Agent shutdown 必须停止自己启动的子进程（Windows/macOS/Linux 分别测试）

---

## 2. Agent B 任务（Provider 层 + EventHub）

### 2.1 AntProvider 完整实现

**文件**：`runtime-agent/internal/provider/build/ant.go`

**目标接口**：
```go
type BuildProvider interface {
    ID() string
    Validate(ctx context.Context, project Project, toolchain Toolchain) error
    Build(ctx context.Context, plan BuildPlan, sink BuildEventSink) (BuildOutput, error)
}
```

**实现要求**：
1. 使用项目 `build.xml`（从 BuildPlan.AntFile 或默认项目根目录）
2. target 可配置，默认按探测结果选择
3. JavaHome 来自 ToolchainID（从 ToolchainRepository 解析）
4. properties 以命令行参数方式传入（不放进环境变量）
5. 保留 exit code、完整日志位置和摘要输出
6. 通过 `BuildEventSink` 发布进度事件
7. 支持 context 取消 → 杀子进程

### 2.2 JavacProvider 完整实现

**文件**：`runtime-agent/internal/provider/build/javac.go`

**实现要求**：
1. 复用现有 `internal/build/compiler.go` 的 javac executor 和 diagnostic parser
2. 所有路径基于 resolved BuildPlan（不自己找项目）
3. Windows 使用 argfile（`@/tmp/kairo-javac-args.txt`）避免命令长度限制
4. Walk 错误不吞掉，返回明确错误
5. output 目录不存在时自动创建
6. 不实现基于时间戳的增量编译（v1 全量编译）

### 2.3 Tomcat6Provider 完整实现

**文件**：`runtime-agent/internal/provider/runtime/tomcat6_provider.go`

**目标接口**：
```go
type RuntimeProvider interface {
    ID() string
    Prepare(ctx context.Context, project Project) (RuntimePlan, error)
    Start(ctx context.Context, plan RuntimePlan) (ServerInstance, error)
    Stop(ctx context.Context, id ServerID, force bool) error
    Inspect(ctx context.Context, id ServerID) (ServerInstance, error)
}
```

**实现要求**：
1. v1 只有内置 `tomcat6`，不包装成 `.lfrpkg`
2. Agent 启动时不下载 Tomcat（首次 Prepare/Start 时才按用户动作下载）
3. start/stop timeout 通过 config 注入
4. 启动后状态通过 EventHub 发布事件
5. `Stop` 支持 force 模式（先 graceful，超时后 kill）
6. `Inspect` 返回真实 PID、启动时间、端口、状态

### 2.4 Deploy 引擎完善

**文件**：`runtime-agent/internal/deploy/sync.go`

**实现要求**：
1. 由 DeployPlan 驱动，不直接接受客户端路径
2. 所有 source/target 在复制前通过 sandbox 校验
3. 单文件替换使用 temp + fsync + atomic rename
4. 返回 add/modify/delete 列表摘要（不只是数字）
5. mirror 操作必须显式内部策略并限制在 Kairo-owned root

### 2.5 EventHub 完整实现

**文件**：`runtime-agent/internal/transport/events/eventhub.go`

**当前问题**：
- subscribers 只有一个，新订阅覆盖旧订阅
- 满队列静默丢事件
- 无 sequence/replay/gap 语义

**目标实现**：

```go
type EventHub struct {
    mu          sync.RWMutex
    subscribers map[string]map[string]chan Event  // workspaceID → subscriberID → channel
    sequence    int64
    history     []Event       // ring buffer, max 1000
    maxHistory  int
    maxSubBuffer int
}

func (h *EventHub) Subscribe(workspaceID, subscriberID string, afterSequence int64) (<-chan Event, func()) {
    // 1. 创建 subscriber channel
    // 2. replay history 中 afterSequence 之后的事件
    // 3. 如果 history 不足，发送 snapshot.required 事件
    // 4. 返回 channel 和 unsubscribe 函数
}
```

**实现要求**：
1. 多 subscriber 不覆盖（workspaceID → subscriberID → channel）
2. 全局 monotonic sequence
3. WebSocket 连接参数：`?workspaceId=xxx&afterSequence=123`
4. 重连先 replay history；history 不足时发送 `snapshot.required`/gap 事件
5. 慢消费者：channel 满时发送 gap 事件并断开，不静默丢弃
6. 实现 ping/pong（30s interval）、read/write deadline（5min）
7. 最大消息大小 64KB

### 2.6 WebSocket adapter

**文件**：`runtime-agent/internal/transport/events/websocket.go`

**实现要求**：
1. upgrade 前鉴权（secret header 或 subprotocol）
2. 不收 URL query 中的 secret
3. 连接参数包含 `workspaceId` 和 `afterSequence`
4. clean unsubscribe 时移除 subscriber
5. 连接关闭时自动清理 subscriber

---

## 3. 必须通过的真实 E2E

使用复制到临时目录的 `legacy-sample`，按顺序执行：

```text
1. import legacy-sample
2. select/import JDK
3. Ant or javac build success
4. GET /api/v1/builds → 看到 succeeded
5. deploy all
6. start Tomcat 6
7. HTTP GET /hello → 200
8. 修改 JSP → deploy webapp
9. HTTP GET → 看到修改
10. restart → PID/启动时间变化，HTTP 恢复
11. stop → 进程确认消失
12. 重启 Agent → history 仍可查询，无 orphan process
```

**任何一步不得 skip/gated。**

---

## 4. Wave 2 Gate Checklist

- [ ] Ant build 真成功（使用 legacy-sample 的 build.xml）
- [ ] Build cancel 真终止子进程
- [ ] Deploy 映射到 WEB-INF 正确目录
- [ ] Tomcat start 真成功
- [ ] Restart 真停止并重新启动
- [ ] Stop 后无残留进程
- [ ] JSP/static sync 真可见
- [ ] EventHub 生产注入
- [ ] 多 subscriber 不覆盖
- [ ] sequence/replay/gap 可恢复
- [ ] 所有 API endpoint 的 GET/POST/DELETE 按契约实现
- [ ] `go test -count=1 ./...` 全绿
- [ ] 核心 E2E 全链路通过（无 skip/gated）

---

## 5. Agent A 与 Agent B 的并行边界

| 层 | Agent A | Agent B |
|----|---------|---------|
| API contract | 冻结 TypeScript + Go DTO | 只读，不修改 |
| Use cases | 实现 BuildUseCase/DeployUseCase/ServerUseCase | 不修改 |
| Plan resolver | 实现 BuildPlan/DeployPlan/RuntimePlan | 不修改 |
| Provider | 定义 BuildProvider/RuntimeProvider 接口 | 实现 AntProvider/JavacProvider/Tomcat6Provider |
| EventHub | 定义 EventHub 接口 | 实现 EventHub + WebSocket adapter |
| HTTP handlers | 实现 typed handlers | 不修改 |

**协作规则**：
- Agent A 先定义接口并冻结，Agent B 根据接口实现
- 接口变更需双方确认
- 合并前由 Integration Lead 做 contract test