# Kairo IDE — Wave 5 Desktop 产品化文档

> 文档用途：Java & Desktop Agent (Agent D) 的开发任务书（Desktop 部分）  
> 负责 Agent：Agent D — Java & Desktop  
> 预计工作量：5-8 天  
> 前置条件：Wave 4 Gate 全部通过（Java 语言智能已完成）  
> 后置 Gate：Desktop 自包含可启动、可安装、可退出

---

## 0. 目标

将 Desktop 从"依赖外部 dev server 的调试壳"变为"自包含的 Electron/Theia 可安装产品"。包含动态端口、preload 安全注入、进程全生命周期管理、打包。

---

## 1. 任务清单

### 1.1 Desktop host 启动 Theia backend

**修改文件**：`apps/desktop/src/main.ts`

**当前问题**：N-021：Desktop 不启动 Theia，只假设外部 `localhost:3000` 已运行。

**目标实现**（推荐方案 A：使用 `@theia/electron` 标准启动模型）：

```ts
// 使用 @theia/electron 的 ElectronMainApplication
// 不假设外部 dev server 已运行
// Theia backend 与 Agent 都由 desktop lifecycle 管理
```

**实现要求**：
1. 安装包离线启动（不需要用户先运行 `pnpm`）
2. Theia backend 与 Agent 都由 desktop lifecycle 管理
3. fixed 3000/18099 不出现在 production path
4. 如果无法使用 `@theia/electron` 标准模型，则由 Desktop main 启动本地 Theia backend，动态选择 Theia port，等待 health 后再建窗口

### 1.2 动态端口与 secret 生成

**修改文件**：`apps/desktop/src/main.ts`

**当前问题**：N-018：Desktop 注入 `window.__KAIRO_CONFIG__`，runtime 读取 `__KAIRO_DEFAULT_RUNTIME_URL__`，名称不一致。

**目标实现**：
```ts
// 每次运行选择动态 Agent port
const agentPort = await findFreePort();
// 生成 256-bit secret
const secret = crypto.randomBytes(32).toString('hex');
// 启动 Agent binary
const agentProc = spawn(agentBinary, [
    '--port', String(agentPort),
    '--secret', secret,
    '--data-dir', dataDir,
]);
// 健康检查
await waitForHealth(`http://127.0.0.1:${agentPort}/api/v1/health`);
```

**实现要求**：
1. 动态选择 Agent port（不固定 18099）
2. 生成 256-bit random secret
3. Agent binary 路径区分 dev/package，并验证存在、权限和版本
4. 健康检查失败要收集 stdout/stderr、停止 child、显示用户可理解的启动错误

### 1.3 preload/contextBridge 配置注入

**修改文件**：`apps/desktop/src/preload.ts`（新增）

**当前问题**：N-020：用 `did-finish-load + executeJavaScript` 拼接 secret，时机太晚且不安全。

**目标实现**：
```ts
// preload.ts
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__kairo', {
    agentBaseUrl: process.env.KAIRO_AGENT_URL,
    getSecret: () => process.env.KAIRO_SECRET,  // session-local
    productVersion: '0.1.0',
});
```

**实现要求**：
1. 创建最小 preload，暴露只读：`agentBaseUrl`、session-local credential accessor、product version
2. 不用 `executeJavaScript` 拼接 secret
3. `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false` 保持
4. runtime config 在 DI container 创建时读取
5. secret 只存在内存，不写 localStorage、URL、日志、截图

### 1.4 HTTP/WS secret 鉴权

**修改文件**：
- `runtime-agent/internal/api/server.go`（middleware）
- `packages/runtime-extension/src/browser/runtime-connection-service.ts`

**当前问题**：N-019：Agent 要求 `X-Kairo-Secret`，前端无 secret 配置，除 health 外所有请求 401。

**目标实现**：

**Go 侧**：
```go
func secretAuthMiddleware(secret string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if r.URL.Path == "/api/v1/health" {
                next.ServeHTTP(w, r)
                return
            }
            provided := r.Header.Get("X-Kairo-Secret")
            if !constantTimeCompare(provided, secret) {
                writeError(w, 401, "unauthenticated")
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

**前端侧**：
```ts
// HTTP 自动添加 X-Kairo-Secret header
// WebSocket 使用受控 subprotocol handshake
// secret 不进入 URL query、日志、localStorage
```

**实现要求**：
1. Agent middleware 用 constant-time compare
2. 除 health 外全部要求 secret
3. WebSocket handshake 同样认证（subprotocol 或 header）
4. secret 不记录到任何日志、URL、存储

### 1.5 进程生命周期管理

**修改文件**：`apps/desktop/src/main.ts`

**实现要求**：
1. Electron 退出时等待 Agent 和其子进程退出
2. 超时后 kill process tree（Windows 用 `taskkill /T /PID`）
3. 删除 Go 内部 `HostSupervisor`（桌面宿主属于 Electron）
4. 启动第二个 Kairo 实例不冲突：端口、data dir、server process ownership 明确

### 1.6 Desktop 打包

**修改文件**：`apps/desktop/package.json`、`apps/desktop/electron-builder.yml`

**实现要求**：
1. electron-builder 包含 Theia frontend/backend、Agent 对应平台二进制和必要 runtime assets
2. macOS/Windows 至少生成可启动 artifact
3. Windows portable/NSIS 在普通用户、无管理员权限环境验证
4. 安装目录含空格、用户名含中文时验证路径
5. 启动第二个 Kairo 实例不冲突

---

## 2. Wave 5 Gate Checklist

- [ ] 断开所有 dev server 后双击 Desktop artifact 能启动
- [ ] UI 能完成 import/build/deploy/start/restart/stop 全链路
- [ ] 抓取请求确认有 `X-Kairo-Secret` header
- [ ] 错误 secret 返回 401
- [ ] 退出后 Agent/Tomcat/JDT 无残留进程
- [ ] Windows 与 macOS 各至少一份日志/截图/进程证据
- [ ] production 无固定 3000/18099 端口
- [ ] preload/contextBridge 注入配置（非 executeJavaScript）
- [ ] secret 不进入 URL/日志/storage
- [ ] 启动第二个实例不冲突

---

## 3. 具体文件变更清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `apps/desktop/src/main.ts` | 重写 | 自包含 Theia + Agent，动态端口 |
| `apps/desktop/src/preload.ts` | **新增** | contextBridge 安全注入 |
| `apps/desktop/package.json` | 修正 | electron-builder 配置 |
| `apps/desktop/electron-builder.yml` | **新增/修正** | 打包配置 |
| `runtime-agent/internal/api/server.go` | 修正 | secret middleware、constant-time compare |
| `runtime-agent/internal/transport/events/websocket.go` | 修正 | WebSocket secret 鉴权 |
| `packages/runtime-extension/src/browser/runtime-connection-service.ts` | 修正 | 从 preload 读取配置 |
| `packages/theia-product/src/main/product-bindings.ts` | 修正 | 从 preload 读取 runtime config |
| `runtime-agent/internal/platform/hostsupervisor.go` | **删除** | 死代码，桌面宿主属于 Electron |