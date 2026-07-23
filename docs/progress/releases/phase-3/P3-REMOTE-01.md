# P3-REMOTE-01 远程 Agent 连接协议实现

- 状态：`implemented`
- 本切片：远程 Agent 服务器（TLS 1.3 + Auth + WebSocket 重连）+ 前端连接服务 + 远程沙箱
- 更新时间：2026-07-23

## 实现摘要

### Go 远程服务器 (`runtime-agent/internal/remote/server.go`)

- TLS 1.3 强制，密码套件白名单：AES-256-GCM、AES-128-GCM、ChaCha20-Poly1305
- mTLS 客户端证书认证（可选）
- Token 会话认证（SHA-256 恒定时间比较）
- 会话 TTL 8 小时，重连窗口 5 分钟
- 并发会话限制
- 用户白名单
- 审计日志

### 前端远程连接服务 (`packages/remote-extension/`)

- `RemoteConnectionService`：WebSocket 连接管理、认证、重连
- `RemoteSandboxService`：路径隔离、文件大小限制、禁止模式
- 指数退避重连（最多 5 次，30s 上限）
- 30 秒 WebSocket ping 心跳
- Session 持久化（localStorage）

### 测试覆盖

- Go 远程包：65.9% coverage（18 个测试用例）
- 覆盖：TLS 配置、认证、会话管理、令牌提取、并发限制

## 修改文件

- `runtime-agent/internal/remote/server.go` (新增)
- `runtime-agent/internal/remote/server_test.go` (新增)
- `packages/remote-extension/package.json` (新增)
- `packages/remote-extension/tsconfig.json` (新增)
- `packages/remote-extension/src/browser/remote-connection-service.ts` (新增)
- `packages/remote-extension/src/browser/remote-sandbox-service.ts` (新增)
- `packages/remote-extension/src/browser/index.ts` (新增)

## 测试结果

```bash
cd runtime-agent && go test -race -count=1 ./internal/remote/...
ok  	github.com/Qioooba/kairo-ide/runtime-agent/internal/remote	1.220s
```

## 遗留风险

- WebSocket 升级和 API 代理尚未实现（标记为 501 Not Implemented）
- 需要真实 Linux 环境进行端到端验证
- 证书管理需要企业 CA 集成