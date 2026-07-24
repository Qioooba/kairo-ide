# ADR-0027 — 远程 Linux Agent 架构

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 6)

## Context

Kairo IDE 需要支持远程开发场景，使开发者能够通过本地 IDE 连接远程 Linux 主机进行 Java 遗留项目的开发、构建与调试。远程能力是 Wave 11 的核心目标。

当前环境：
- 核心语言运行时 Agent（`runtime-agent/`）已具备本地代码感知能力
- 需要一套完整的远程通信、安全认证、文件同步、容器隔离和会话管理基础设施
- 远程连接需满足企业级安全要求，同时保持低延迟交互体验

## Decision

### 1. 整体架构

远程 Agent 采用 **TLS 1.3 + HTTP/WebSocket** 架构，复用现有 `/api/v1` 协议信封格式，与本地 Agent 并行运行而不产生架构干扰。

核心组件位于 `runtime-agent/internal/remote/`，包含 7 个模块：

```
remote/
├── server.go              # TLS 1.3 强制 HTTPS 服务器
├── auth.go                # mTLS + Token 双重认证
├── ssh_tunnel.go          # SSH 隧道与端口转发
├── agent_proxy.go         # 本地→远程 HTTP/WS 代理
├── file_sync.go           # SHA-256 文件同步
├── container_isolation.go # Docker/Podman 容器隔离
└── session_manager.go     # 多用户会话管理
```

### 2. 通信安全：TLS 1.3 + mTLS

**决策：强制 TLS 1.3，可选 mTLS 客户端证书认证**

- 最低 TLS 版本设为 `tls.VersionTLS13`，拒绝 TLS 1.2 及以下
- 白名单密码套件：`TLS_AES_256_GCM_SHA384`、`TLS_AES_128_GCM_SHA256`、`TLS_CHACHA20_POLY1305_SHA256`
- 当配置 `CACertFile` 时，启用 `tls.RequireAndVerifyClientCert`（mTLS 模式）
- 服务端绑定地址默认为 `:9443`

**认证机制：**

双重认证体系：
1. **Token-based 认证**：SHA-256 常时比较密码，使用 `KAIRO_REMOTE_SECRET` / `KAIRO_SECRET` 环境变量作为共享密钥，生成 32 字节随机 Token（64 位十六进制），有效期 8 小时
2. **mTLS 客户端证书**：CA 证书验证客户端身份，适用于高安全场景

认证端点：
- `POST /api/v1/remote/login`：登录获取 Session Token
- `GET /api/v1/remote/health`：健康检查（公开端点）
- 所有其他端点强制通过 `Authorization: Bearer <token>` 或 WebSocket 子协议认证

会话管理特性：
- 重连窗口：断开后 5 分钟内允许同 Token 重连
- 过期会话自动清理（每 5 分钟）
- 最大并发会话数限制
- 允许用户白名单控制

### 3. 文件同步：SHA-256 哈希对比

**决策：基于 SHA-256 哈希的增量同步，非实时文件监听**

`FileSyncService` 实现：
- 使用 `crypto/sha256` 计算文件哈希
- `ScanDirectory()` 遍历工作区建立哈希映射
- `CompareWithRemote(remoteHashes)` 产生 `SyncPlan`：包含 `ToUpload`、`ToDownload`、`Conflicts` 三部分
- 冲突检测：两地均存在且哈希不同时标记为冲突
- 冲突解决策略：支持 `local`（保留本地）、`remote`（采用远程）、`merge`（外部合并）
- 同步历史记录：最多保留 1000 条 `SyncRecord`，含时间戳、方向、大小、哈希

### 4. 容器隔离：Docker/Podman 双运行时

**决策：支持 Docker 和 Podman，自动检测可用运行时**

`ContainerIsolationManager` 实现：
- 通过 `DetectProvider()` 自动检测 Docker 或 Podman（优先 Docker）
- 容器生命周期：Create → Start → Stop → Remove
- 支持配置：镜像、工作目录、卷挂载（含只读）、端口映射、环境变量、网络模式、内存/CPU 限制
- 容器内命令执行：`ExecInContainer()`
- 文件拷贝：`CopyToContainer()` / `CopyFromContainer()`
- Dockerfile 构建：`BuildDockerfile()`
- 资源监控：实时获取内存和 CPU 使用量（通过 `docker stats` 解析）

### 5. SSH 隧道

**决策：基于 `golang.org/x/crypto/ssh` 的 SSH 客户端，支持端口转发和自动重连**

`SSHTunnel` 实现：
- 支持三种认证方式：密码、密钥文件、密钥数据
- 密钥类型：ED25519
- 本地→远程端口转发：将本地端口流量通过 SSH 隧道转发到远程 Agent 端口（默认 `localhost:9443`）
- 连接保活：每 30 秒发送 `keepalive@kairo` 请求
- 自动重连：指数退避（基础 1 秒，最大 30 秒），默认最多重试 5 次
- 状态回调：`OnStatusChange()` 注册连接状态变更通知
- 5 种状态机：`Disconnected → Connecting → Connected → Reconnecting → Error`

### 6. Agent 代理

**决策：HTTP 请求代理 + WebSocket 隧道 + SSH 文件传输**

`AgentProxy` 实现：
- HTTP 代理：`ProxyRequest()` 将本地请求转发至远程 Agent，支持 JSON 序列化/反序列化
- WebSocket 隧道：`ProxyWebSocket()` 实现双向 WebSocket 代理，支持 HTTP Hijack 升级
- 文件传输：`UploadFile()` 通过 SCP 上传，`DownloadFile()` 通过 SSH `cat` 下载
- 远程命令执行：`ExecRemote()` 通过 SSH Session 执行命令
- 远程文件列表：`ListRemoteFiles()` 通过 SSH `ls` 获取文件信息

### 7. 多用户会话管理

**决策：每用户最多 10 个会话，全局最多 100 个，TTL 8 小时**

`SessionManager` 实现：
- 会话生命周期：创建 → 验证 → 刷新 → 终止
- 双重索引：`sessions`（sessionID → session）和 `userSessions`（userID → sessionIDs）
- 过期自动清理：`CleanupExpiredSessions()`
- 会话限制强制执行：超限时终止最旧会话
- 基于权限的访问控制：`HasPermission()` 检查会话权限

### 8. 前端 UI

`RemotePanelWidget`（`remote-panel-widget.tsx`）提供 4 个标签页：
- **Connection**：主机、端口、TLS 版本、连接时间、延迟
- **File Sync**：同步状态、文件计数、进度条、冲突数
- **Containers**：容器列表、状态（running/stopped/paused）、端口映射、启动/停止/暂停操作
- **Sessions**：活跃会话列表、用户名、角色、活跃时间

## Alternatives Considered

### 替代方案 A：使用 WebSocket-only 通信
纯 WebSocket 可减少连接开销，但 HTTP REST API 更适合命令-响应模式的 API 调用（如登录、健康检查），且与现有 `/api/v1` 协议兼容。最终采用 HTTP + WebSocket 混合模式。

### 替代方案 B：使用 gRPC 替代 HTTP
gRPC 提供更好的流式传输和强类型契约，但需要完整的 protobuf 工具链，且与现有 JSON API 不兼容。对于 IDE 远程场景，HTTP/JSON 的调试便利性和浏览器兼容性更重要。

### 替代方案 C：仅支持 Docker，不支持 Podman
Podman 在 RHEL/企业 Linux 环境中更常见且无需 daemon。双运行时支持降低部署门槛。

### 替代方案 D：使用 WebRTC 进行 P2P 连接
可降低服务器负载，但需要 STUN/TURN 基础设施，且企业防火墙环境通常不友好。SSH 隧道方案更成熟可靠。

## Consequences

### 正面影响
- TLS 1.3 + mTLS 提供企业级通信安全
- SHA-256 文件同步确保数据完整性，避免传输已同步文件
- Docker/Podman 双运行时支持覆盖主流 Linux 发行版
- SSH 隧道自动重连保证连接稳定性
- 多用户会话管理支持团队协作场景
- 与现有 `/api/v1` 协议兼容，无需破坏性变更

### 负面影响
- TLS 1.3 强制要求可能不兼容老旧客户端
- mTLS 配置需要 CA 证书管理基础设施
- 容器隔离依赖外部 Docker/Podman CLI，增加部署依赖
- WebSocket 实现尚未完成（标记为 `NotImplemented`）
- SSH HostKeyCallback 当前使用 `InsecureIgnoreHostKey()`，生产环境需要实现主机密钥验证

### 后续工作
- 完成 WebSocket 升级和事件流实现
- 实现 API 代理（`handleProxiedAPI`）
- 添加 SSH 主机密钥验证
- SCP 文件传输完善（当前为基础实现）
- 性能优化：大文件分块传输、增量同步