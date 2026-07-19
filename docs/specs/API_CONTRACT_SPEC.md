# Kairo IDE — API 契约规范

> 文档用途：所有 Agent 的 API 契约参考基线  
> 负责 Agent：Agent A（后端实现）+ Agent C（前端协议）  
> 冻结时间：Wave 2 开始前

---

## 0. 总体原则

1. `packages/protocol` 只表达外部 wire DTO，不包含 Provider 内部配置
2. Go 在 `internal/transport/http/dto` 定义 wire DTO；application domain DTO 在 `internal/app`，二者显式映射
3. HTTP handler 不传 `json.RawMessage` 给 service
4. 所有 endpoint 都有 request/response contract test
5. v1 手写 TypeScript/Go DTO，不引入 OpenAPI 代码生成
6. 只接受 envelope 格式（`{ requestId, payload }`），不再兼容 bare payload

---

## 1. Envelope 格式

所有请求和响应使用统一的 envelope：

```ts
// 请求
type RequestEnvelope<T = unknown> = {
  requestId: string;  // UUID v4
  payload: T;
};

// 响应
type ResponseEnvelope<T = unknown> = {
  requestId: string;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};
```

**要求**：
- `requestId` 使用 `crypto.randomUUID()`（前端）或 Go `uuid.New()`
- 不兼容 bare payload（迁移期可保留一个版本，日志 WARN，随后删除）

---

## 2. 完整 API 列表

### 2.1 Workspace

```text
GET    /api/v1/workspaces
POST   /api/v1/workspaces
POST   /api/v1/workspaces/{workspaceId}/scan
```

```ts
// GET /api/v1/workspaces
type WorkspaceListResponse = {
  workspaces: Workspace[];
};

type Workspace = {
  id: string;
  name: string;
  root: string;
  lastOpened: string;  // ISO 8601
};

// POST /api/v1/workspaces
type ImportWorkspaceRequest = {
  root: string;
  name?: string;
};

// POST /api/v1/workspaces/{workspaceId}/scan
type ScanWorkspaceResponse = {
  antBuildFiles: string[];
  sourceRoots: string[];
  webRoot: string | null;
  webXml: string | null;
  encoding: string;
  jdkDetected: boolean;
  tomcatDetected: boolean;
};
```

### 2.2 Project

```text
GET    /api/v1/projects?workspaceId={ws}
GET    /api/v1/projects/{projectId}
PUT    /api/v1/projects/{projectId}
```

```ts
// GET /api/v1/projects
type ProjectListResponse = {
  projects: Project[];
};

type Project = {
  id: string;
  workspaceId: string;
  name: string;
  config: ProjectConfig;
  createdAt: string;
  updatedAt: string;
};

type ProjectConfig = {
  schemaVersion: number;
  name: string;
  sourceRoots: string[];
  resourceRoots: string[];
  webappDir: string;
  outputDir: string;
  sourceLevel: string;
  targetLevel: string;
  encoding: string;
  buildTool: 'ant' | 'javac';
  contextPath: string;
  toolchainId: string;
  runtimeId: string;
};

// PUT /api/v1/projects/{projectId}
type UpdateProjectRequest = {
  config: ProjectConfig;
};
```

### 2.3 Build

```text
GET    /api/v1/builds?projectId={pid}&limit={n}
POST   /api/v1/builds
GET    /api/v1/builds/{buildId}
DELETE /api/v1/builds/{buildId}
```

```ts
// GET /api/v1/builds
type BuildListResponse = {
  builds: BuildRun[];
};

type BuildRun = {
  id: string;
  projectId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  output: BuildOutput;
  diagnostics: BuildDiagnostic[];
};

type BuildOutput = {
  logPath: string;
  summary: string;
  filesCompiled: number;
  exitCode: number;
};

type BuildDiagnostic = {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
};

// POST /api/v1/builds
type StartBuildRequest = {
  projectId: string;
  clean?: boolean;
  intent?: 'full' | 'selected-files';
  selectedFiles?: string[];
};
```

### 2.4 Deploy

```text
GET    /api/v1/deployments?projectId={pid}
POST   /api/v1/deployments
GET    /api/v1/deployments/{deploymentId}
```

```ts
type DeploymentRun = {
  id: string;
  projectId: string;
  buildId: string;
  state: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  summary: DeploymentSummary;
};

type DeploymentSummary = {
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  totalBytes: number;
  changes: FileChange[];
};

type FileChange = {
  path: string;
  action: 'added' | 'modified' | 'deleted';
  bytes: number;
};

// POST /api/v1/deployments
type StartDeploymentRequest = {
  projectId: string;
  buildId: string;
  scope: 'all' | 'classes' | 'webapp' | 'resources';
};
```

### 2.5 Server

```text
GET    /api/v1/servers?projectId={pid}
POST   /api/v1/servers
GET    /api/v1/servers/{serverId}
POST   /api/v1/servers/{serverId}/restart
DELETE /api/v1/servers/{serverId}
GET    /api/v1/servers/{serverId}/logs
```

```ts
type ServerInstance = {
  id: string;
  projectId: string;
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed';
  port: number;
  contextPath: string;
  pid: number;
  startedAt: string;
  url: string;
};

// POST /api/v1/servers
type StartServerRequest = {
  projectId: string;
};

// GET /api/v1/servers/{serverId}/logs
type ServerLogsResponse = {
  logs: LogEntry[];
  cursor: string;
  hasMore: boolean;
};

type LogEntry = {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  message: string;
};
```

### 2.6 Events

```text
GET /api/v1/events?workspaceId={ws}&after={sequence}
```

```ts
// WebSocket connection
// ws://127.0.0.1:{port}/api/v1/events?workspaceId={ws}&after={sequence}
// Subprotocol: x-kairo-secret

type Event = {
  sequence: number;
  workspaceId: string;
  type: string;
  payload: unknown;
  timestamp: string;
};

// Event types
type BuildQueuedEvent = Event & { type: 'build.queued'; payload: { buildId: string } };
type BuildStartedEvent = Event & { type: 'build.started'; payload: { buildId: string } };
type BuildCompletedEvent = Event & { type: 'build.completed'; payload: { buildId: string; state: 'succeeded' | 'failed' } };
type BuildCancelledEvent = Event & { type: 'build.cancelled'; payload: { buildId: string } };
type ServerStartedEvent = Event & { type: 'server.started'; payload: { serverId: string; pid: number; port: number } };
type ServerStoppedEvent = Event & { type: 'server.stopped'; payload: { serverId: string } };
type ServerCrashedEvent = Event & { type: 'server.crashed'; payload: { serverId: string; error: string } };
type LogEntryEvent = Event & { type: 'log.entry'; payload: LogEntry };
type SnapshotRequiredEvent = Event & { type: 'snapshot.required'; payload: { resource: string } };
type GapEvent = Event & { type: 'event.gap'; payload: { from: number; to: number } };
```

### 2.7 Health

```text
GET /api/v1/health
GET /api/v1/health/ready
```

```ts
type HealthResponse = {
  status: 'ok';
  version: string;
  uptime: number;
};

type ReadyResponse = {
  status: 'ready' | 'not_ready';
  checks: {
    disk: 'ok' | 'error';
    tomcat: 'ok' | 'not_available';
    jdtls: 'ok' | 'not_available';
  };
};
```

### 2.8 JDT LS（仅在 Wave 4 后）

```text
GET /api/v1/projects/{projectId}/jdtls/launch-descriptor
```

```ts
type LaunchDescriptor = {
  command: string;
  args: string[];
  workingDir: string;
  envAllowlist: string[];
};
```

---

## 3. 错误码

| HTTP 状态 | code | 说明 |
|-----------|------|------|
| 400 | `invalid_input` | 请求参数校验失败 |
| 401 | `unauthenticated` | 缺少或错误的 secret |
| 403 | `forbidden` | 无权限访问该资源 |
| 404 | `not_found` | 资源不存在 |
| 409 | `conflict` | 资源状态冲突（如重复启动） |
| 500 | `internal_error` | 服务器内部错误 |

---

## 4. 协议同步策略

- v1 手写 TypeScript/Go DTO
- 新增 executable parity test：覆盖所有 endpoint method/path/request/response fixture
- Go 测试与 TypeScript 测试使用同一组 `testdata/contracts/*.json` golden fixtures
- 不写注释说"未来加脚本"，直接加测试

---

## 5. 已删除的旧 endpoint

以下 endpoint 在 v1 中不再支持：

- `DELETE /api/v1/jdtls` — JDT 生命周期由 Theia backend 管理
- `POST /api/v1/jdtls/lsp` — Go 不再代理 LSP frame
- 所有 bare payload 格式 — 只接受 envelope