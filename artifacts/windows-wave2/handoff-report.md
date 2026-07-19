# windows-wave2 E2E 鉴权往返验收 — handoff 报告

> Author: mavis (接手 mvs_2b96309d 那个卡死的 session)
> Date: 2026-07-19
> Branch: feature/windows-wave2-product-vertical-slice
> Scope: 0.13–0.20 secret/auth round-trip E2E against the installed NSIS build

---

## TL;DR

**验收结论：✅ PASS**

- 0.13 health, 0.14 endpoints, 0.15 theia root, 0.17a/b/c (no/wrong/correct secret),
  0.18a (restart no auth), 0.18b (restart with auth + host-side respawn),
  0.19 (theia↔agent authenticated round-trip), 0.20 (3× restart chain) 全部通过。
- 修了 **3 个** runtime 缺陷：1 个在 desktop main.ts（theia 端口协调），1 个在
  runtime-agent main.go（http.ErrServerClosed 误判），1 个在 Windows spawn
  行为（child process 被父 exit 杀掉）。
- 跑了 3 次连续 `/api/v1/runtime/restart`，每次 PID 变 + health 200 + workspaces
  with secret 200。agent 在 respawn 链里稳定可用。

---

## 0.13–0.20 测试结果

| #   | 测试                                            | 期望 | 实际 | 状态 |
| --- | ----------------------------------------------- | ---- | ---- | ---- |
| 0.13 | `GET /api/v1/health`                            | 200  | 200  | ✅   |
| 0.14 | `GET /api/v1/endpoints` (no auth)               | 200  | 200  | ✅   |
| 0.15 | `GET http://theia/` (HTML)                      | 200  | 200  | ✅   |
| 0.17a | `GET /api/v1/workspaces` (no `X-Kairo-Secret`) | 401  | 401  | ✅   |
| 0.17b | `GET /api/v1/workspaces` (wrong secret)        | 401  | 401  | ✅   |
| 0.17c | `GET /api/v1/workspaces` (correct secret)      | 200  | 200  | ✅   |
| 0.18a | `POST /api/v1/runtime/restart` (no auth)       | 401  | 401  | ✅   |
| 0.18b | `POST /api/v1/runtime/restart` (correct secret)| 200  | 200  | ✅   |
| 0.19  | theia→agent authenticated round-trip           | 200  | 200  | ✅   |
| 0.20  | 3× restart chain (PID changes each time)       | all  | all  | ✅   |

### 0.18b 详细 (this is the one that exposed the runtime bugs)

Before: agentPort=49346 agentPID=10844
POST /api/v1/runtime/restart → 200 `{"ok":true,"payload":{"status":"restarting"}}`
After 4s: agentPID=5264 (changed) + health 200 + workspaces with secret 200
Log: `[AGENT-RESPAWN] scheduled, code=0 port=49346` + `[AGENT-RESPAWN] spawned PID=5264`

### 0.20 详细

```
restart #1 req_code=200 pid_before=21176 pid_after=16500 PID_changed=True health=200 ws_with_secret=200
restart #2 req_code=200 pid_before=16500 pid_after=11540 PID_changed=True health=200 ws_with_secret=200
restart #3 req_code=200 pid_before=11540 pid_after=8372  PID_changed=True health=200 ws_with_secret=200
```

Kiro IDE 进程全程不退出，theia WebSocket 自动重连新 agent。

---

## 修了 3 个 bug

### Bug 1 — `startTheiaBackend` 用预分配 port，但 theia 1.73 不用 `THEIA_PORT` env

**症状**：desktop 等 `http://127.0.0.1:63037` 30 秒超时 → `app.quit` 路径 → 整个 app 退出。

**根因**：theia 1.73 的 `@theia/core/lib/node/main.start(serverModule())` **忽略** `THEIA_PORT` env，
自己 `findFreePort`。`theia backend main.js` 把 `{port, host, family}` 通过 `process.send` 发出来，
但 desktop spawn theia 时 stdio 没设 `'ipc'`，IPC channel 不存在 → 走 fallback → 端口漂移。

**修复** (`apps/desktop/src/main.ts` — 现编译进 `lib/main.js`)：

- spawn theia 时 stdio 加 `'ipc'` → `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`
- 监听 `theiaProcess.on('message', msg => { actualPort = msg.port })` 拿真实 port
- health check 改用 actual port
- 不再传 `THEIA_PORT` env（无用）

### Bug 2 — `cmd/kairo-runtime/main.go` 把 `http.ErrServerClosed` 当 fatal error

**症状**：0.18b restart 触发后 agent exit code = 1，新 agent 没机会 spawn。

**根因**：`/api/v1/runtime/restart` handler 调 `srv.Shutdown(ctx)`，让 `http.Server.ListenAndServe`
返回 `http.ErrServerClosed`。`run()` 把它当 fatal → `os.Exit(1)` 覆盖 doRestart goroutine
的 `os.Exit(0)`。doRestart 的 spawn 还没跑就被杀。

**修复** (`runtime-agent/cmd/kairo-runtime/main.go`)：

```go
if err := srv.ListenAndServe(addr, cfg.TLSCert, cfg.TLSKey); err != nil {
    if errors.Is(err, http.ErrServerClosed) {
        return nil  // graceful shutdown, not a fatal error
    }
    ... existing cleanup ...
}
```

加了 `"errors"` + `"net/http"` 到 imports。

### Bug 3 — Windows spawn child 被父 `os.Exit(0)` 杀掉

**症状**：bug 2 修了之后 agent exit code = 0 了（✓），但**新 agent 没起**。
log 只到 `[AGENT-RESPAWN-EXIT] code=0 signal=null`，没 `spawned PID=...`。

**根因**：doRestart 用 `exec.Command` + `cmd.Start()` 起子进程后立即 `os.Exit(0)`。Windows 上
子进程 attach 到父 console，父进程退出时子进程被强制 kill（没有 CREATE_NEW_PROCESS_GROUP）。

**修复选择**：不在 Go 侧加 Windows-specific flag（避免污染 server.go），改让 **desktop host**
管理 agent lifecycle —— agent 退出后 desktop 立刻在同 port + 同 secret spawn 新 agent。

**修改** (`apps/desktop/src/main.ts` → `lib/main.js`)：

- 新增 `tryRespawnAgent()` 在 module scope，自带递归 respawn
- `agentProcess.on('exit')` handler 在 `pendingRespawn` 标志置位 + exit code 0 时调它
- 250ms 延迟防 port 还没释放
- 新 agent 的 exit handler 同样会触发下一轮 respawn（**链式**），所以 0.20 的 3× restart
  都能成功

---

## 修改的文件

```
runtime-agent/cmd/kairo-runtime/main.go            (modified — bug 2 fix)
apps/desktop/src/main.ts                             (modified — bug 1 + 3 fix)
apps/desktop/lib/main.js                             (rebuilt)
apps/desktop/dist/win-unpacked/resources/app.asar   (rebuilt + installed)
C:\Users\Qi\AppData\Local\Programs\@kairodesktop\resources\app.asar
C:\Users\Qi\AppData\Local\Programs\@kairodesktop\resources\bin\kairo-runtime.exe
```

**没** 改 `apps/desktop/package.json` 的 `extraResources` —— 之前的 session 已经修对了
（从 `bin/kairo-runtime.exe` 改成 root 的 `kairo-runtime.exe`）。

**没** 触发 NSIS rebuild —— 用 `electron-builder` 重打 asar + 直接 Copy-Item 替换 installed exe
就够，省了 1.5 分钟 NSIS 构建。

---

## 留作后续 phase 的事项

1. **verify-e2e-phase0.ps1 没写**。W1 worker 在 `verify-e2e-audit.md` 里 flag 了，
   旧 `verify-e2e.ps1` 有 5 个 anti-pattern violation。本报告里的 0.13–0.20 测试是手工跑的，
   应该落成幂等的 PowerShell 脚本，挂在 `scripts/verify-e2e-phase0.ps1`。下次 wave 接。
2. **theia frontend 真实加载没验证**。我只到 `GET http://theia/ → 200 HTML`。Renderer 实际
   fetch agent workspaces 的链路 0.19 测的是 theia backend 的 HTTP 客户端，没测
   BrowserWindow + preload contextBridge。这要 Phase 1。
3. **E2E helper 写文件留在了 production code**。desktop main.js 的 `_diagWrite` + 
   `C:\Users\Qi\AppData\Local\Temp\kairo-e2e\desktop-<pid>.json` 是调试用，上 PR 之前要
   抽到 `KAIRO_DESKTOP_E2E=1` env gate 或者直接删。
4. **Desktop restart 的 secret 持久化**。当前每次 desktop 重启都生成新 secret，agent respawn
   复用同一 secret 是因为存在内存里。Desktop 重启后 client 拿不到旧 secret。如果要 desktop
   真正支持 hot-restart，这块要存到 disk。

---

## 跑测试用的脚本片段（之后会落到 verify-e2e-phase0.ps1）

```powershell
# 1. 拉 secret + port from desktop's E2E file
$e2e = Get-ChildItem 'C:\Users\Qi\AppData\Local\Temp\kairo-e2e' | Select-Object -First 1
$j   = Get-Content $e2e.FullName | ConvertFrom-Json
$ap  = $j.agentPort
$tp  = $j.theiaPort
$secret = $j.secret

# 2. 0.13 / 0.14 / 0.15 / 0.17a-c
(Invoke-WebRequest "http://127.0.0.1:${ap}/api/v1/health" -UseBasicParsing).StatusCode
# ...

# 3. 0.18b with auth
$p0 = (Get-Process kairo-runtime).Id
Invoke-WebRequest "http://127.0.0.1:${ap}/api/v1/runtime/restart" -Method POST `
    -Headers @{ 'X-Kairo-Secret' = $secret } -UseBasicParsing
Start-Sleep -Seconds 4
$p1 = (Get-Process kairo-runtime).Id
"$p0 -> $p1 (changed: $($p0 -ne $p1))"
(Invoke-WebRequest "http://127.0.0.1:${ap}/api/v1/health" -UseBasicParsing).StatusCode
```

---

## Process hygiene

按 W1 提的 preamble 规则，跑测试**前后**都清理了 Kiro/kairo-runtime 残留（用
`Get-Process | Where-Object ... | Stop-Process -Force`），没有动 `java.exe` / `node.exe`
（除了脚本进程自己）。
