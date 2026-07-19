# Windows Test Readiness Hotfix — 共享契约备忘

> 本文档是 `Windows Test Readiness Hotfix` 的权威契约，所有 worker 必须按本备忘录
> 落点落地，避免协议/路径/产物名漂移。任何对本文的修改需要统一发起方（orchestrator）确认。

## 1. 鉴权契约

### 1.1 HTTP 头

- **唯一来源**：`X-Kairo-Secret: <secret>`
- 前端 `runtime-connection-service.ts` 之前写 `Authorization: Bearer <secret>`，**必须**改为 `X-Kairo-Secret`。
- Agent `server.go` 保留 `X-Kairo-Secret` 解析，**删除**任何 `Authorization` 兼容代码（不留双轨）。
- 失败返回：`401 Unauthorized`，响应体保留 `{ "error": "unauthorized" }`。

### 1.2 WebSocket 子协议

- 在 `new WebSocket(url, ["kairo-secret-v1", secret])` 中以 subprotocol 形式携带 secret。
- Agent WS upgrade handler 用 `Sec-WebSocket-Protocol` 头解析，匹配 `kairo-secret-v1`。
- 失败返回 `401`，并立即关闭连接（不接受匿名连接）。

## 2. EventStream 动态端口

- 端口在 Agent 启动时确定（CLI `--port` 或默认 18099），通过 `GET /api/v1/endpoints` 返回：

  ```json
  {
    "http": "127.0.0.1:18099",
    "events": "127.0.0.1:18099"
  }
  ```

- 前端首次连接 `/api/v1/endpoints` 拿到 host:port 后，**所有** WS / EventStream URL 改用返回值，
  `runtime-connection-service.ts` 内不再硬编码 `18099`。
- 端口冲突时 Agent 退避到下一个端口，重新 `GET /api/v1/endpoints` 可拿到新值。

## 3. Restart endpoint

- 协议：`POST /api/v1/runtime/restart`，无 body，secret 鉴权，200 返回 `{ "status": "restarting" }`。
- Agent 收到后：先 `Shutdown(ctx, 3s)` 当前 services，再 `os.Executable()` 拉起新进程（带原 CLI 参数），
  当前进程返回 0。
- 前端 `RuntimeCommandService.restart` 直接调该 endpoint，**不再**走 Stop + 提示用户手动重启。

## 4. Agent 二进制路径（三处对齐）

| 角色        | 路径                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| 编译输出    | `runtime-agent/bin/kairo-runtime.exe`                                               |
| 打包目标    | `apps/desktop/resources/bin/kairo-runtime.exe`                                      |
| 运行时查找  | `apps/desktop/resources/bin/kairo-runtime.exe`                                      |

- `apps/desktop/package.json` 的 `extraResources` / `files` 规则**只能**指向
  `runtime-agent/bin/kairo-runtime.exe` → `resources/bin/kairo-runtime.exe`。
- Desktop 启动 Agent 时，从 `process.resourcesPath` 拼 `bin/kairo-runtime.exe`，
  不再从应用根目录猜。
- 删除 `apps/desktop` 中所有 `runtime-agent/kairo-runtime` 字样。

## 5. Theia frontend / backend 进入 Electron 包

`apps/desktop` 的 `files` 规则必须包含：

- `lib/backend/**/*` （electron 自身）
- `../browser/lib/frontend/**/*` （拷贝到 `lib/frontend`）
- `../browser/lib/backend/**/*` （拷贝到 `lib/backend`，Electron 启动时执行）

- `scripts/copy-browser-artifacts.js`（新建）负责在 `pnpm build:win` 之前把 Browser 产物拷贝到
  `apps/desktop/lib/{frontend,backend}`。
- `electron-main.js` 启动 Browser backend 时显式设置：
  - `process.env.ELECTRON_RUN_AS_NODE = '1'`
  - `process.env.THEIA_PORT = <from /api/v1/endpoints.http>`

## 6. container.go 收敛

- `internal/bootstrap/container.go` 的 `NewContainer()` 必须：
  1. 构造 `api.Services`（含 EventHub、ProjectService、RuntimeCommandService、HealthService）。
  2. 把 EventHub 注入 `NewMemoryServices`（不再内部自建）。
  3. 暴露 `Container.Services` 字段供 HTTP/WS handler 读取。
- 删除旧的 `NewMemoryServices` 内部 EventHub 构造分支（保留类型，外部注入）。

## 7. 根构建脚本 glob

`package.json` 的 scripts 改为（用引号包住 glob）：

```json
{
  "build": "pnpm -r --filter \"./packages/*\" build && pnpm -r --filter \"./apps/*\" build",
  "test":  "pnpm -r --filter \"./packages/*\" test  && pnpm -r --filter \"./apps/*\" test",
  "lint":  "pnpm -r --filter \"./packages/*\" lint  && pnpm -r --filter \"./apps/*\" lint"
}
```

任何使用 `*` 的 script 必须加双引号。

## 8. Node Runtime 测试 DOM 环境

- `packages/runtime-extension` 的 mocha 配置增加 `jsdom: 'jsdom-global'`。
- `runtime-agent/internal/...` 的 Node 单元测试如果迁到了 JS，统一用 `jsdom`。
- CI matrix `windows-test` job 必跑这部分。

## 9. Windows E2E 脚本

`scripts/verify-e2e.ps1` 同步到上述契约：

1. `pnpm -r --filter "./packages/*" build` + `pnpm -r --filter "./apps/*" build`
2. `go test -count=1 ./...` 在 `runtime-agent`
3. `go build` → 复制到 `apps/desktop/resources/bin/`
4. `pnpm --filter @kairo/desktop build:win` → NSIS / portable
5. 启动安装后的 `.exe` → `/api/v1/health` 200 → `/api/v1/endpoints` 200 →
   WS 鉴权往返成功 → `POST /api/v1/runtime/restart` 200 → 进程被替换。

## 10. 落地顺序（避免冲突）

1. worker 1（契约）先落 1~3 节
2. worker 2（打包）落 4~5 节
3. worker 3（容器）落 6 节
4. worker 4（脚本）落 7~9 节
5. worker 5（NSIS）落 10 节端到端验证
