# Kairo IDE API 参考文档

> 生成时间：2026-07-24
> 基于：`runtime-agent/internal/api/server.go` (routes) + `handlers.go` + `sql_handler.go` + `run_configurations.go` + `health.go`
> 协议版本：v1 (Kairo Protocol)

---

## 概述

Kairo IDE Runtime Agent 提供 RESTful HTTP API，所有端点位于 `/api/v1/` 下。Agent 仅监听 `127.0.0.1`（本地回环），不接受外部连接。

### 通用约定

- **请求格式**：`Content-Type: application/json`
- **信封格式**：所有请求体可选包含 `{ "requestId": "...", "correlationId": "...", "payload": {...} }`
- **响应格式**：成功返回 `{ "ok": true, "payload": {...} }`，失败返回 `{ "ok": false, "error": { "code": "...", "message": "..." } }`
- **认证**：通过 `X-Kairo-Secret` 请求头或 WebSocket 子协议认证
- **速率限制**：默认 100 req/min/IP，超出返回 429 + `Retry-After` 头

### 错误码

| 错误码 | 含义 |
|--------|------|
| `ERR_INVALID_REQUEST` | 请求格式错误 |
| `ERR_NOT_FOUND` | 资源不存在 |
| `ERR_INTERNAL` | 内部错误 |
| `ERR_FORBIDDEN` | 路径遍历拒绝 |
| `ERR_UNAUTHENTICATED` | 认证失败 |
| `ERR_IO_ERROR` | 文件/IO 错误 |
| `ERR_TIMEOUT` | 操作超时 |
| `ERR_CANCELLED` | 操作被取消 |
| `ERR_CONFLICT` | 资源冲突 |
| `ERR_COMPILE_FAILED` | 编译失败 |
| `ERR_DEPLOY_FAILED` | 部署失败 |
| `ERR_PROCESS_SPAWN_FAILED` | 进程启动失败 |
| `ERR_PATH_FORBIDDEN` | 路径越界 |
| `ERR_TOOLCHAIN_MISSING` | 工具链未注册 |
| `ERR_DEBUG_ATTACH_FAILED` | 调试附加失败 |

---

## 端点列表

### 1. 健康检查

#### `GET /api/v1/health`

返回 Agent 的存活状态和版本信息。

**响应示例**：
```json
{
  "ok": true,
  "payload": {
    "ok": true,
    "version": "1.0.0",
    "agentVersion": "1.0.0",
    "uptimeSec": 3600,
    "bindAddress": "127.0.0.1",
    "port": 18080,
    "activeSessions": 0,
    "platform": {
      "os": "windows",
      "arch": "amd64"
    }
  }
}
```

---

### 2. 端点发现

#### `GET /api/v1/endpoints`

返回动态的 host:port，供前端客户端发现 Agent 连接地址。

**响应示例**：
```json
{
  "ok": true,
  "payload": {
    "http": "127.0.0.1:18080",
    "events": "127.0.0.1:18080"
  }
}
```

---

### 3. Runtime 控制

#### `POST /api/v1/runtime/restart`

重启 Runtime Agent。立即返回 200，然后异步执行重启。

**请求体**：无（或空信封）

**响应示例**：
```json
{
  "ok": true,
  "payload": {
    "status": "restarting"
  }
}
```

---

### 4. 工作区 (Workspaces)

#### `GET /api/v1/workspaces`

列出所有工作区。

**响应**：`Workspace[]`

#### `POST /api/v1/workspaces`

打开/创建工作区。

**请求体**：
```json
{
  "rootPath": "/path/to/workspace",
  "name": "My Workspace"
}
```

**响应**：`Workspace`

#### `GET /api/v1/workspaces/{id}`

获取指定工作区。

**响应**：`Workspace`

#### `DELETE /api/v1/workspaces/{id}`

关闭工作区。

**响应**：`{ "ok": true }`

#### `POST /api/v1/workspaces/{id}/scan`

扫描工作区目录结构。

**请求体**：
```json
{
  "rootPath": "relative/path"
}
```

**响应**：`{ "detected": [...] }`

#### `POST /api/v1/workspaces/{id}/projects/import`

导入项目到工作区。

---

### 5. 项目 (Projects)

#### `GET /api/v1/projects`

列出所有项目。

**响应**：`Project[]`

#### `GET /api/v1/projects/{id}`

获取指定项目。

**响应**：`Project`

#### `PUT /api/v1/projects/{id}`

更新项目配置。同时持久化 `.kairo/project.yaml`。

**请求体**：`Project` 对象

**响应**：`Project`

#### `POST /api/v1/projects/detect`

检测 Java Web 项目结构。

**请求体**：
```json
{
  "rootPath": "/path/to/project"
}
```

**响应**：`ProjectDetection`（含 sourceDirs, webRoot, buildSystem, encoding, JDKVersion 等）

#### `POST /api/v1/projects/import`

导入项目（简化确认格式）。

**请求体**：
```json
{
  "workspaceId": "ws-xxx",
  "name": "My Project",
  "rootPath": "/path/to/project",
  "sourceDirs": ["src/main/java"],
  "webRoot": "WebRoot",
  "outputDir": "build/classes",
  "sourceVersion": "1.6",
  "targetVersion": "1.6",
  "defaultEncoding": "gbk",
  "buildTool": "ant",
  "buildScript": "build.xml",
  "contextPath": "/myapp",
  "libDirs": ["lib"]
}
```

**响应**：`Project`

#### `GET /api/v1/projects/recent`

获取最近打开的项目列表。

**响应**：`[{ "id": "...", "name": "...", "rootPath": "...", "lastOpenedAt": "..." }]`

---

### 6. 工具链 (Toolchains)

#### `GET /api/v1/toolchains`

列出所有已注册的工具链。

**响应**：`Toolchain[]`

#### `POST /api/v1/toolchains/import`

导入新工具链（JDK）。

**请求体**：
```json
{
  "path": "/path/to/jdk",
  "label": "JDK 6"
}
```

**响应**：`Toolchain`

---

### 7. 构建 (Builds)

#### `GET /api/v1/builds`

列出所有构建记录。

**响应**：`BuildResult[]`

#### `POST /api/v1/builds`

触发构建。

**请求体**：
```json
{
  "projectId": "project-xxx",
  "clean": true,
  "intent": "full"
}
```

**响应**：`BuildResult`

#### `GET /api/v1/builds/{id}`

获取构建状态。

**响应**：`BuildResult`

#### `DELETE /api/v1/builds/{id}`

取消构建。

**响应**：`BuildResult`

---

### 8. 部署 (Deployments)

#### `GET /api/v1/deployments`

列出所有部署记录。

**响应**：`DeploymentResult[]`

#### `POST /api/v1/deployments`

发布部署。

**请求体**：
```json
{
  "projectId": "project-xxx",
  "buildId": "build-xxx",
  "scope": "full",
  "intent": "publish-static-changes"
}
```

**响应**：`DeploymentResult`

#### `GET /api/v1/deployments/{id}`

获取部署状态。

**响应**：`DeploymentResult`

---

### 9. 服务器 (Servers)

#### `GET /api/v1/servers`

列出所有服务器实例。

**响应**：`ServerRecord[]`

#### `POST /api/v1/servers`

启动服务器。

**请求体**：
```json
{
  "projectId": "project-xxx",
  "debug": false
}
```

**响应**：`ServerRecord`

#### `GET /api/v1/servers/{id}`

获取服务器状态。

**响应**：`ServerRecord`

#### `DELETE /api/v1/servers/{id}`

停止服务器。

**请求体**（可选）：
```json
{
  "force": false
}
```

**响应**：`ServerRecord`

#### `POST /api/v1/servers/{id}/debug`

附加调试器到服务器。

**响应**：`ServerRecord`

#### `POST /api/v1/servers/{id}/restart`

重启服务器。

**响应**：`ServerRecord`

#### `GET /api/v1/servers/{id}/logs?tail=100`

获取服务器日志。

**响应头**：`X-Kairo-Server-State`, `X-Kairo-Server-Pid`

**响应**：`LogLine[]`

#### `POST /api/v1/servers/{id}/recover`

恢复服务器。

**响应**：`ServerRecord`

#### `GET /api/v1/servers/recoverable`

列出可恢复的服务器。

**响应**：`ServerRecord[]`

---

### 10. 搜索 (Search)

#### `POST /api/v1/search`

全文搜索。

**请求体**：
```json
{
  "query": "search text",
  "rootPath": "/path/to/search",
  "filePattern": "*.java"
}
```

**响应**：`SearchResult[]`

#### `POST /api/v1/search/stream`

流式搜索（通过 WebSocket 事件推送结果）。

---

### 11. 编码 (Encoding)

#### `POST /api/v1/encoding/detect`

检测文件编码。

**请求体**：
```json
{
  "filePath": "/path/to/file.java"
}
```

**响应**：`EncodingResult`

#### `POST /api/v1/encoding/recode`

转换文件编码。

**请求体**：
```json
{
  "filePath": "/path/to/file.java",
  "fromEncoding": "gbk",
  "toEncoding": "utf-8"
}
```

**响应**：`RecodeResult`

#### `POST /api/v1/encoding/validate`

验证编码转换。

**请求体**：
```json
{
  "filePath": "/path/to/file.java"
}
```

**响应**：`ValidationResult`

---

### 12. 认证 (Auth)

#### `POST /api/v1/auth/login`

登录认证。

**请求体**：
```json
{
  "username": "admin",
  "password": "***"
}
```

**响应**：`Session`

#### `POST /api/v1/auth/logout`

登出。

**响应**：`{ "ok": true }`

---

### 13. 审计 (Audit)

#### `GET /api/v1/audit`

获取审计日志。

**响应**：`AuditEvent[]`

---

### 14. WebSocket 事件

#### `GET /api/v1/events` (WebSocket Upgrade)

实时事件流。客户端通过 WebSocket 子协议认证：

```javascript
new WebSocket("ws://127.0.0.1:18080/api/v1/events", ["kairo-secret-v1", secret])
```

---

### 15. JDT Language Server

#### `GET /api/v1/jdtls`

获取 JDT LS 分发状态。

**响应**：`JDTLSStatus`

#### `POST /api/v1/jdtls`

准备（下载/安装）JDT LS 分发。

**响应**：`JDTLSPrepareResult`

#### `GET /api/v1/jdtls/project`

获取 JDT LS 项目模型状态。

**查询参数**：`?workspaceId=xxx`

**响应**：`JDTProjectStatus`

#### `POST /api/v1/jdtls/project`

生成 JDT LS 项目模型。

**请求体**：
```json
{
  "workspaceId": "xxx",
  "projectId": "xxx",
  "rootPath": "/path/to/project",
  "intoProjectRoot": true
}
```

**响应**：`JDTProjectResult`

#### `GET /api/v1/workspaces/{ws}/java/launch-descriptor?projectId={project}`

获取 JDT LS 启动描述符。

**响应**：`LaunchDescriptor`（含 command, args, env, workingDir）

#### `POST /api/v1/workspaces/{ws}/java/prepare`

为工作区准备 JDT LS。

**响应**：`JDTLSPrepareResult`

---

### 16. 运行配置 (Run Configurations)

#### `GET /api/v1/workspaces/{ws}/run-configurations`

获取所有运行配置。

**响应**：`RunConfigurationDocument`

#### `PUT /api/v1/workspaces/{ws}/run-configurations`

替换全部运行配置。

**请求体**：`RunConfigurationDocument`

**响应**：`RunConfigurationDocument`

#### `POST /api/v1/workspaces/{ws}/run-configurations`

创建新的运行配置。

**请求体**：`TomcatRunConfiguration`

**响应**：`RunConfigurationDocument`

#### `GET /api/v1/workspaces/{ws}/run-configurations/{configuration}`

获取指定运行配置。

**响应**：`TomcatRunConfiguration`

#### `PUT /api/v1/workspaces/{ws}/run-configurations/{configuration}`

更新运行配置。

**请求体**：`TomcatRunConfiguration`

**响应**：`RunConfigurationDocument`

#### `DELETE /api/v1/workspaces/{ws}/run-configurations/{configuration}`

删除运行配置。

**响应**：`RunConfigurationDocument`

#### `POST /api/v1/workspaces/{ws}/run-configurations/{configuration}/launch`

启动运行配置。

**请求体**：
```json
{
  "mode": "run"
}
```

**响应**：`ServerRecord`

---

### 17. Maven

#### `POST /api/v1/maven/detect`

检测 Maven 项目。

**请求体**：
```json
{
  "rootPath": "/path/to/project"
}
```

**响应**：`MavenDetection`

#### `GET /api/v1/maven/dependencies?rootPath=...&offline=true`

获取 Maven 依赖树。

**响应**：`MavenDependencyTree`

#### `POST /api/v1/maven/run`

运行 Maven 任务。

**请求体**：
```json
{
  "rootPath": "/path/to/project",
  "task": "compile"
}
```

**响应**：`MavenRunResult`

---

### 18. 端口诊断

#### `POST /api/v1/diagnostics/port`

检查端口占用情况。

**请求体**：
```json
{
  "port": 8080
}
```

**响应**：`PortDiagnostics`

---

### 19. SQL (实验性)

#### `POST /api/v1/sql/execute`

执行 SQL 查询（Oracle 11g）。

**请求体**：
```json
{
  "connectionId": "conn-xxx",
  "sql": "SELECT * FROM users",
  "maxRows": 100
}
```

**响应**：
```json
{
  "columns": [{ "name": "ID", "type": "NUMBER" }],
  "rows": [{ "ID": 1 }],
  "rowCount": 1,
  "executionTimeMs": 15,
  "truncated": false
}
```

#### `POST /api/v1/sql/test-connection`

测试数据库连接。

**请求体**：
```json
{
  "host": "localhost",
  "port": 1521,
  "sid": "ORCL",
  "username": "scott",
  "password": "tiger"
}
```

**响应**：
```json
{
  "success": true,
  "oracleVersion": "Oracle Database 11g",
  "instanceName": "ORCL"
}
```

---

## 端点汇总

| # | 方法 | 路径 | 说明 |
|---|------|------|------|
| 1 | GET | `/api/v1/health` | 健康检查 |
| 2 | GET | `/api/v1/endpoints` | 端点发现 |
| 3 | POST | `/api/v1/runtime/restart` | 重启 Agent |
| 4 | GET/POST | `/api/v1/workspaces` | 列出/创建工作区 |
| 5 | GET/DELETE | `/api/v1/workspaces/{id}` | 获取/关闭工作区 |
| 6 | POST | `/api/v1/workspaces/{id}/scan` | 扫描工作区 |
| 7 | POST | `/api/v1/workspaces/{id}/projects/import` | 导入项目 |
| 8 | GET | `/api/v1/projects` | 列出项目 |
| 9 | GET/PUT | `/api/v1/projects/{id}` | 获取/更新项目 |
| 10 | POST | `/api/v1/projects/detect` | 检测项目结构 |
| 11 | POST | `/api/v1/projects/import` | 导入项目 |
| 12 | GET | `/api/v1/projects/recent` | 最近项目 |
| 13 | GET | `/api/v1/toolchains` | 列出工具链 |
| 14 | POST | `/api/v1/toolchains/import` | 导入工具链 |
| 15 | GET/POST | `/api/v1/builds` | 列出/触发构建 |
| 16 | GET/DELETE | `/api/v1/builds/{id}` | 获取/取消构建 |
| 17 | GET/POST | `/api/v1/deployments` | 列出/发布部署 |
| 18 | GET | `/api/v1/deployments/{id}` | 获取部署 |
| 19 | GET/POST | `/api/v1/servers` | 列出/启动服务器 |
| 20 | GET/DELETE | `/api/v1/servers/{id}` | 获取/停止服务器 |
| 21 | POST | `/api/v1/servers/{id}/debug` | 附加调试 |
| 22 | POST | `/api/v1/servers/{id}/restart` | 重启服务器 |
| 23 | GET | `/api/v1/servers/{id}/logs` | 获取日志 |
| 24 | POST | `/api/v1/servers/{id}/recover` | 恢复服务器 |
| 25 | GET | `/api/v1/servers/recoverable` | 可恢复服务器 |
| 26 | POST | `/api/v1/search` | 全文搜索 |
| 27 | POST | `/api/v1/search/stream` | 流式搜索 |
| 28 | POST | `/api/v1/encoding/detect` | 编码检测 |
| 29 | POST | `/api/v1/encoding/recode` | 编码转换 |
| 30 | POST | `/api/v1/encoding/validate` | 编码验证 |
| 31 | POST | `/api/v1/auth/login` | 登录 |
| 32 | POST | `/api/v1/auth/logout` | 登出 |
| 33 | GET | `/api/v1/audit` | 审计日志 |
| 34 | WS | `/api/v1/events` | WebSocket 事件 |
| 35 | GET/POST | `/api/v1/jdtls` | JDT LS 状态/准备 |
| 36 | GET/POST | `/api/v1/jdtls/project` | JDT LS 项目模型 |
| 37 | GET | `/api/v1/workspaces/{ws}/java/launch-descriptor` | JDT LS 启动描述符 |
| 38 | POST | `/api/v1/workspaces/{ws}/java/prepare` | JDT LS 准备 |
| 39 | GET/PUT/POST | `/api/v1/workspaces/{ws}/run-configurations` | 运行配置 CRUD |
| 40 | GET/PUT/DELETE | `/api/v1/workspaces/{ws}/run-configurations/{id}` | 运行配置操作 |
| 41 | POST | `/api/v1/workspaces/{ws}/run-configurations/{id}/launch` | 启动运行配置 |
| 42 | POST | `/api/v1/maven/detect` | Maven 检测 |
| 43 | GET | `/api/v1/maven/dependencies` | Maven 依赖 |
| 44 | POST | `/api/v1/maven/run` | Maven 运行 |
| 45 | POST | `/api/v1/diagnostics/port` | 端口诊断 |
| 46 | POST | `/api/v1/sql/execute` | SQL 执行 |
| 47 | POST | `/api/v1/sql/test-connection` | SQL 连接测试 |

**总计：47 个端点操作（38 个唯一路径）**

---

*文档由 Kairo IDE 文档自动化流程生成*