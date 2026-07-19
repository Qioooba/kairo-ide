# Kairo IDE Windows Wave 2 长任务书：Release Candidate 纵向闭环

> 执行机器：Windows 开发机  
> 执行方式：DeepSeek V4 Pro 多 Agent  
> 建议工作分支：`feature/windows-wave2-product-vertical-slice`  
> Windows 已报告的本地起点：`c3dc8f2`  
> 前置提交：`dddc632`、`1327cee`、`f0eabb4`、`c3dc8f2`  
> 任务性质：上一轮封板、Desktop 架构加固、真实产品闭环、Java 语言能力、安装版深度测试  
> 与 Mac 工作流关系：Windows 只负责 Desktop/Frontend/API Adapter/JDT LS/Windows E2E，不修改 Mac 正在重构的 Project/Build/Deploy Core

---

## 0. 执行结论

Windows 上一轮取得了重要进展，但不能把状态描述为“完整端到端已经走通”。最终报告明确写明：

- NSIS 安装包没有真实构建和安装；
- 安装后的 Kairo IDE 没有冷启动验收；
- Electron → Theia → Runtime Agent 三进程没有完整实机证明；
- secret 鉴权没有在安装版完成真实往返；
- `/api/v1/runtime/restart` 没有证明旧 Agent PID 被新 PID 替换；
- `go test -race` 没有实际结果；
- repository 的 4 个 Windows 测试被 skip，而不是通过。

因此，下一轮不能马上宣布进入新功能开发。必须采用以下顺序：

```text
保存并发布 Windows Wave 1 分支
  → 独立审计 verify-e2e.ps1
  → 真实构建 NSIS
  → 安装版冷启动和进程验收
  → 修复所有实机缺陷
  → Desktop Host 架构加固
  → Runtime Client 单一化
  → Project / Build / Deploy / Server UI 纵向闭环
  → JDT LS completion / definition / diagnostics
  → 安装版完整 E2E
  → 生成 Release Candidate 证据包
```

本轮完成后应得到的不是“更多 scaffold”，而是一份可以安装、打开、导入 legacy sample、构建、部署、启动 Tomcat、访问 JSP、获得 Java completion/definition、正常重启并安全退出的 Windows Release Candidate。

---

## 1. 强制原则

所有 Agent 必须遵守：

1. 上一轮未完成的 NSIS 实机验证属于本轮 Phase 0，不得跳过。
2. 报告、脚本存在不等于功能通过，只有真实命令、退出码、PID、HTTP 行为、截图和生成物才是证据。
3. 不允许使用 skip、降低断言、吞异常、伪造截图或 mock E2E 来制造通过。
4. Windows 不修改 Mac 当前拥有的 Domain/Repository/Planning/Build/Deploy 实现。
5. Windows 前端只能通过公开 API/typed client 使用后端，不能直接读取后端 repository 文件。
6. Electron main 是 Desktop 进程所有者；renderer 不得直接 spawn Agent、Theia 或 Tomcat。
7. Runtime Agent secret 不得写入命令行、普通日志、localStorage、URL query 或可枚举的全局变量。
8. 不保留两套 Runtime client、两套 event stream 或多套 Build/Server 状态缓存。
9. UI 不允许继续使用源码正则测试来代替容器实例化和行为测试。
10. JDT LS 必须由 Theia backend 托管，不能让浏览器进程获得完整宿主环境变量。
11. 本轮不实现 Remote Server、多用户认证、DAP/JDWP、插件市场、亮色主题、SQLite 或 Class HotSwap。
12. 每个 Phase 的 Gate 全绿后才能进入下一 Phase；并行 Agent 不能越过未冻结的 contract。

---

## 2. Git 基线与成果保护

### 2.1 不要直接 push Windows 本地 main

Windows 最终报告显示本地 `main` 比 `origin/main` 领先 4 个提交。先保护成果：

```powershell
git status --short
git log --oneline --decorate -8
git switch -c feature/windows-wave1-readiness
git push -u origin feature/windows-wave1-readiness
```

必须核对分支包含：

```text
dddc632 fix(desktop): align agent bin path, package theia frontend+backend
1327cee fix(runtime-agent,scripts,ci,test): Wave-1 hotfix contract landed end-to-end
f0eabb4 fix(api,runtime,test,scripts): Wave-1 hotfix closure
c3dc8f2 chore(scripts): Windows env+test helper scripts
```

如果 commit hash 不一致，以 Windows 本机实际 `git log` 为准，但必须把准确 hash 写入最终报告。

### 2.2 建立 Wave 2 分支

Wave 1 分支推送成功后：

```powershell
git switch -c feature/windows-wave2-product-vertical-slice
```

禁止：

- 强推 `main`；
- 把 Mac 未提交文件复制到 Windows；
- 在 Windows 分支 cherry-pick Mac 的半成品提交；
- 对冲突文件执行大范围 ours/theirs 覆盖；
- 修改历史来隐藏上一轮未验收事实。

### 2.3 提交纪律

建议提交序列：

```text
test(windows): prove installed NSIS cold-start and authenticated round-trip
fix(desktop): harden child supervision and packaged path resolution
refactor(runtime): converge on one authenticated connection service
feat(project-ui): complete import and active-project lifecycle
feat(product-ui): wire build deploy server and bounded log views
feat(java): wire real JDT LS language client on Windows
test(e2e): cover installed desktop legacy-project vertical slice
chore(release): produce Windows RC evidence and truthful status report
```

一个提交只解决一个可回滚主题。不要在同一个提交同时格式化全仓、升级依赖和改变功能。

---

## 3. 两台机器的严格文件所有权

### 3.1 Windows 允许修改

```text
apps/desktop/**
apps/browser/**
packages/runtime-extension/**
packages/project-extension/**
packages/build-extension/**
packages/tomcat-extension/**
packages/java-extension/**
packages/theia-product/**
packages/protocol/**                         # 仅 Contract Agent 可修改
packages/ui-kit/**                           # 仅修本轮真实 UI 所需样式
runtime-agent/internal/api/**                # 仅 adapter/auth/endpoint，不放业务逻辑
runtime-agent/internal/bootstrap/**          # 仅 Windows 集成，Mac 合并前谨慎
runtime-agent/internal/transport/**
runtime-agent/internal/app/jdtls_descriptor.go
runtime-agent/internal/jdtls/**               # 只做安全收口或废弃迁移
runtime-agent/cmd/**
scripts/*.ps1
.github/workflows/**
apps/desktop/test/**                         # 可新增
packages/*/src/**/*.test.*                   # 可新增
test/e2e/windows/**                          # 可新增
docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md  # 可新增
docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md
```

根目录 `package.json`、`pnpm-lock.yaml` 只有 Integration Lead 可以修改。必须单独提交并解释原因。

### 3.2 Windows 严禁修改

Mac 工作流正在重构这些目录，Windows 不得碰：

```text
runtime-agent/internal/domain/**
runtime-agent/internal/repository/**
runtime-agent/internal/pathpolicy/**
runtime-agent/internal/planning/**
runtime-agent/internal/provider/build/**
runtime-agent/internal/app/build.go
runtime-agent/internal/app/build_impl.go
runtime-agent/internal/app/deploy*.go
runtime-agent/internal/build/**
runtime-agent/internal/deploy/**
runtime-agent/internal/security/**
runtime-agent/test/core/**
runtime-agent/test/fixtures/**
docs/adr/0010-project-identity-and-planning.md
docs/progress/MAC_BACKEND_CORE_FINAL_REPORT.md
```

如果 Windows E2E 发现这些目录的 bug：

1. 不直接修；
2. 写入 `WINDOWS_WAVE2_CONTRACT_REQUESTS.md`；
3. 包含复现命令、请求/响应、期望行为、日志和严重度；
4. 发送给 Mac Integration Agent；
5. Windows 使用稳定接口继续 UI/测试工作，不复制后端实现。

### 3.3 共享文件规则

以下文件容易冲突，默认不改：

```text
docs/MILESTONES.md
docs/architecture.md
docs/REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md
pnpm-lock.yaml
runtime-agent/internal/bootstrap/container.go
```

`MILESTONES.md` 只在两支工作流集成并完成最终回归后，由一个 Integration Lead 更新。Windows 单独完成时只写自己的 final report。

---

## 4. 多 Agent 组织

建议 6 个角色。可以并行审计和测试，但必须按 Phase Gate 合并。

### Agent W1 — Release Qualification

职责：

- 审计 Windows 环境和脚本；
- 真正构建 NSIS；
- 安装、冷启动、卸载；
- 保存 artifact hash、日志、截图和 PID 证据；
- 维护 Windows E2E harness。

禁止修改产品架构。发现产品 bug时创建最小复现，交给对应 Agent。

### Agent W2 — Desktop Host

职责：

- Electron main/preload；
- Agent/Theia 子进程状态机；
- 动态端口和 readiness；
- secret 生成、传递、销毁；
- packaged/dev 路径；
- restart/crash/shutdown/single-instance。

不得修改 renderer 业务 UI 或 Go Build/Deploy Core。

### Agent W3 — Runtime Contract

职责：

- 唯一 RuntimeConnectionService；
- HTTP auth、request ID、timeout、AbortSignal；
- EndpointMap；
- WebSocket 认证、重连、快照恢复；
- API adapter contract tests；
- protocol 类型的唯一所有者。

不得实现 Widget 或修改后端业务计划。

### Agent W4 — Product UI

职责：

- Import Wizard；
- Active Project；
- project selector；
- Build/Deploy/Server Store；
- ReactWidget；
- log viewer；
- loading/error/empty/disabled 状态和可访问性。

不得直接 fetch 或读取本地文件，全部经过 service/store。

### Agent W5 — Java Intelligence

职责：

- Theia backend JDT LS process；
- browser LanguageClient；
- completion/definition/diagnostics；
- Windows JDK 17 host 与 legacy source level；
- process cleanup 和 distribution integrity。

不得开发 DAP/JDWP 或修改 Build Core。

### Agent W6 — Integration & Evidence Lead

职责：

- 冻结契约；
- 审核所有提交；
- 防止文件越界；
- 运行 Phase Gate；
- 维护 contract requests；
- 合并和生成最终报告。

不能只汇总各 Worker 的“成功”声明，必须独立复跑核心命令。

### 4.1 并行调度

```text
Phase 0: W1 主导；W2/W3 只读审计
Phase 1: W2 + W1 并行
Phase 2: W3 主导；W2 提供 preload contract
Phase 3: W4 主导；W3 提供 fake/real typed gateway
Phase 4: W5 主导；W4 只提供 UI observable state
Phase 5: W1 + W6 主导，所有功能 Agent修缺陷
Phase 6: W6 独立复验和报告
```

同一时间只能有一个 Agent 修改：

- `packages/protocol`；
- `apps/desktop/src/preload.ts`；
- `packages/theia-product/src/main/product-bindings.ts`；
- `runtime-agent/internal/api/server.go`；
- 根 `package.json` 和 lockfile。

---

## 5. Phase 0：真实封板 Windows Wave 1

### 5.1 环境证据

运行并保存完整输出：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-env-fresh.ps1
node --version
pnpm --version
go version
java -version
ant -version
& "$env:KAIRO_TOMCAT6_HOME\bin\version.bat"
git status --short
git log --oneline --decorate -8
```

报告中记录实际路径，但不要输出 secret、token 或用户敏感目录内容。

### 5.2 审计 verify-e2e.ps1

在运行前检查脚本，禁止以下假阳性：

- 进程启动后只 `Start-Sleep`，不做 readiness；
- HTTP 请求失败后被 `try/catch` 吞掉；
- 只检查安装包文件存在，不安装；
- 只启动开发态 Electron，不启动安装后的 exe；
- protected endpoint 没验证无 secret 为 401；
- restart 只检查 200，不检查 PID 更换和重新就绪；
- UI 只检查窗口进程存在，不检查 renderer 页面完成加载；
- 子进程泄漏不导致失败；
- 使用残留的旧 Agent/Theia 进程满足端口检查。

脚本开始前必须清理或识别由测试自己启动的进程。不得粗暴杀死系统中所有 `java.exe`、`node.exe` 或 `kairo-runtime.exe`；只能终止测试记录的 PID 树。

### 5.3 清洁构建

使用新的临时输出目录，确保不是旧 artifact：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:agent
pnpm --filter @kairo/desktop build:win
```

要求：

1. 根 `pnpm build` 输出中必须实际列出 packages/apps，而不是 filter glob 假成功；
2. 安装包 timestamp属于当前构建；
3. Agent `.exe`、Theia frontend/backend、Electron main/preload均在包内；
4. 记录安装包绝对路径、字节数和 SHA-256；
5. 构建日志保存到 evidence目录；
6. 未签名开发包可接受，但报告必须写“unsigned development artifact”，不能称正式发布包。

### 5.4 安装版冷启动

必须验证：

1. 使用 NSIS 安装生成的包；
2. 从安装目录启动，不从源码目录启动；
3. 首次启动没有依赖终端中的临时环境变量；
4. Kairo 窗口出现；
5. Theia frontend成功渲染；
6. Electron main启动唯一 Theia backend；
7. Electron main启动唯一 Runtime Agent；
8. Agent监听 loopback动态端口；
9. Theia监听 loopback动态端口；
10. 没有控制台黑窗常驻；
11. 应用可关闭；
12. 关闭后所有本次启动的子进程在 deadline内退出。

记录：

- Electron PID；
- Theia PID；
- Agent PID；
- 监听地址与端口；
- 窗口截图；
- 启动耗时；
- 退出耗时。

### 5.5 鉴权和 restart 真验收

需要证明：

```text
GET /health                            → 200（按现有公开契约）
GET protected endpoint without secret → 401
GET protected endpoint wrong secret   → 401
renderer normal request                → 200
WebSocket wrong/no auth                → rejected
WebSocket valid app config             → connected
POST /api/v1/runtime/restart            → accepted
old Agent PID                           → exits
new Agent PID                           → differs from old PID
new endpoint map                        → rediscovered
renderer                                → reconnects and refreshes snapshot
```

不要把 secret 写进 evidence。可以记录其长度、生成来源和是否轮换。

### 5.6 Phase 0 Gate

Phase 0 只有两种结果：

- 全部通过：提交 evidence 和必要修复，进入 Phase 1；
- 任一失败：先修到通过，不允许更新里程碑为 verified。

如果 Phase 0 暴露大量 Desktop 缺陷，Phase 1 负责系统性重构，而不是继续给脚本打 sleep 补丁。

---

## 6. Phase 1：Desktop Host 可靠性重构

### 6.1 唯一进程所有权

目标：

```text
Electron main
  ├── owns Theia backend process
  ├── owns Runtime Agent process
  ├── owns readiness and restart policy
  ├── owns log files and redaction
  └── publishes minimal immutable config through preload
```

不得：

- renderer 调用 `child_process`；
- Theia frontend自己寻找 Agent；
- Go Agent再启动 Desktop；
- 新增第二套 Go host supervisor；
- 依赖固定 3000/18099 端口；
- 使用 `executeJavaScript` 注入配置。

### 6.2 ChildSupervisor 抽象

在 Electron main 层建立可测试的小型抽象：

```ts
type ChildState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'crashed'
  | 'failed';

interface ManagedChild {
  start(signal: AbortSignal): Promise<ReadyInfo>;
  stop(deadlineMs: number): Promise<void>;
  restart(reason: string): Promise<ReadyInfo>;
  state(): ChildState;
}
```

实现要求：

1. start 幂等或明确返回 conflict；
2. startup deadline可配置；
3. stdout/stderr按行写入有界日志；
4. error/exit只完成一次 promise；
5. start失败清理半启动进程；
6. stop先 graceful，再 kill测试记录的进程树；
7. 不在 event callback 中 `throw`；
8. restart串行化，防止并发启动两个 Agent；
9. shutdown期间不自动拉起；
10. crash backoff有上限和 jitter；
11. 短时间连续崩溃进入 failed，不无限重启；
12. Windows 路径含空格和中文时正常。

### 6.3 动态端口和 readiness

不要先选择“看起来空闲”的端口再长时间等待，因为存在 TOCTOU。优先让子进程绑定 `127.0.0.1:0` 并通过受控 channel/ready file/stdout structured message返回实际端口。

如果现有 Theia CLI 无法使用 0：

1. 在 Electron main临时绑定获得端口；
2. 立即释放并启动 Theia；
3. readiness必须同时校验 PID、端口和 HTTP identity；
4. 端口冲突时有限次数重新选择；
5. 不允许静默回退固定端口。

readiness 不能只检查 TCP connect，应验证：

- Agent health响应包含产品 identity/version；
- Theia 页面返回预期入口；
- readiness来自本次启动 PID，而不是旧进程。

### 6.4 Secret 生命周期

1. Electron main使用 cryptographic RNG创建每次应用会话 secret；
2. 仅通过子进程环境传给 Agent；
3. 不出现在命令行；
4. 不写普通日志；
5. preload只暴露最小的受控 RuntimeConfig API；
6. 不写 localStorage/sessionStorage；
7. restart时策略明确：同一 Desktop session可沿用，完整 app restart必须轮换；
8. renderer异常日志不得序列化完整 config；
9. DevTools默认生产关闭；
10. crash dump/diagnostic bundle必须redact。

推荐 preload contract：

```ts
interface KairoDesktopRuntimeConfig {
  readonly sessionId: string;
  readonly agentBaseUrl: string;
  readonly eventUrl: string;
  readonly requestSecret: () => Promise<string>;
}
```

如果安全评审认为直接返回 secret范围过大，改为 preload 代理 fetch/WS token握手。不要把 secret放在 `window.__KAIRO_CONFIG__` 普通对象上。

### 6.5 packaged path matrix

测试：

| 模式 | Agent | Theia backend | frontend assets |
|---|---|---|---|
| dev | workspace build output | workspace node entry | workspace assets |
| packaged | `process.resourcesPath` 下 `.exe` | packaged backend | packaged frontend |
| 路径含空格 | 必须通过 | 必须通过 | 必须通过 |
| 非 C 盘安装 | 必须通过 | 必须通过 | 必须通过 |

禁止使用依赖当前工作目录的相对路径。所有路径必须从 `app.getAppPath()`、`process.resourcesPath` 或明确配置解析。

### 6.6 生命周期

覆盖：

- single instance lock；
- second instance聚焦已有窗口；
- `before-quit`只执行一次；
- window close与app quit语义；
- Agent主动 restart；
- Agent异常 crash；
- Theia backend crash；
- Electron main crash后的孤儿进程清理策略；
- Windows关机/注销信号；
- 更新/卸载前退出。

### 6.7 Phase 1 Tests

至少包含：

- fake child：ready、timeout、error-before-spawn、exit-during-start；
- concurrent restart只产生一个新进程；
- stop during start；
- stop deadline后kill；
- shutdown不再拉起；
- 5次连续crash进入failed；
- packaged path snapshot；
- config不可通过普通 enumerable global枚举；
- log redaction；
- real dev smoke；
- real installed smoke。

---

## 7. Phase 2：Runtime Contract 与连接单一化

### 7.1 删除双真相

仓库中历史上存在 `KairoRuntimeImpl/EventStream` 和另一套 `RuntimeConnectionService`。本轮只保留一个面向业务层的连接入口：

```ts
interface RuntimeGateway {
  request<TReq, TRes>(operation: Operation<TReq, TRes>, body: TReq, options?: RequestOptions): Promise<TRes>;
  subscribe(listener: RuntimeEventListener): Disposable;
  status(): ConnectionSnapshot;
  reconnect(): Promise<void>;
}
```

Widget、Store 和 StatusBar 只能依赖 typed service，不能直接依赖 URL 或 `fetch`。

### 7.2 EndpointMap

1. 启动时从 Desktop config取得 bootstrap endpoint；
2. 拉取 `/api/v1/endpoints`；
3. 校验 schema/version；
4. 存不可变 snapshot；
5. Agent restart后重新发现；
6. endpoint变化触发单个 connection event；
7. 不保留 `18099` 或 `3000` fallback；
8. browser-only 开发模式必须通过显式配置，不通过生产默认值猜测。

### 7.3 HTTP 行为

统一处理：

- `X-Kairo-Secret`；
- UUID request ID；
- JSON content type；
- typed error；
- timeout；
- AbortSignal；
- 401触发连接失效，不无限重试；
- 409映射 conflict；
- 422映射 validation；
- 5xx保留 request ID；
- response schema runtime validation；
- 日志不含 secret和大 payload。

不要给每个 extension复制一份 fetch wrapper。

### 7.4 WebSocket 行为

目标不是本轮实现复杂的持久 replay系统，而是可靠的本地桌面恢复：

1. 使用受支持的 subprotocol/token机制鉴权；
2. open后标记 connected；
3. app-level heartbeat或明确的idle检测；
4. close/error进入 reconnecting；
5. exponential backoff + jitter + upper bound；
6. 同一时刻只有一个 socket和一个 reconnect timer；
7. reconnect成功后主动拉 Build/Server snapshot；
8. snapshot与新事件按版本/时间避免明显回退；
9. disposing取消timer和listener；
10. Agent restart期间 UI 显示 reconnecting而不是清空数据。

如果后端当前没有 sequence/replay，记录为后续能力，不在本轮发明复杂 event sourcing。

### 7.5 Contract tests

使用真实本地 HTTP/WebSocket test server，不只 mock fetch：

- secret header；
- wrong secret；
- request ID；
- JSON decode error；
- timeout/abort；
- restart endpoint map变化；
- WS auth；
- abnormal close；
- jitter范围；
- reconnect只建一个socket；
- snapshot recovery；
- dispose后无回调。

### 7.6 Backend adapter边界

Windows 可以修改 `runtime-agent/internal/api` 来修复 wire adapter，但必须遵守：

- JSON只在 handler/DTO；
- handler不解析 ProjectID为路径；
- handler不直接执行 build/deploy文件操作；
- handler调用 interface；
- 不引入新的 RawMessage God Service；
- 不为了临时 UI 绕开 Mac use case；
- 所有 API contract变化写入 contract requests。

---

## 8. Phase 3：真实 Product UI 纵向闭环

### 8.1 Import Wizard

当前 UI scaffold 必须变成真实流程：

```text
选择工作区目录
  → 请求 Agent scan/import
  → 显示识别出的 build.xml、web.xml、source roots、web root
  → 选择或确认 JDK/Tomcat
  → 展示验证错误
  → 保存项目
  → 设置 Active Project
  → 刷新项目相关 Store
```

要求：

1. Save按钮必须真实调用 service；
2. 保存期间 disabled并显示进度；
3. validation error定位字段；
4. network/Agent error保留用户输入；
5. cancel不创建半项目；
6. duplicate import有明确行为；
7. Windows路径和中文路径可展示；
8. UI 不发送 `projectRoot/outputDir/source/target/javaHome` 等执行路径；
9. 成功后激活后端返回的 stable ProjectID；
10. reopen后恢复最近 active project；
11. project不存在时清理陈旧选择；
12. 多项目时提供 selector，不再在 command中硬编码 `projects[0]`。

### 8.2 ActiveProjectService

必须成为前端项目上下文唯一真相：

```ts
interface ActiveProjectSnapshot {
  workspaceId?: string;
  projectId?: string;
  displayName?: string;
  state: 'uninitialized' | 'empty' | 'ready' | 'error';
  error?: UserFacingError;
}
```

- 初始化只能一次；
- 切换项目发布事件；
- Command enablement响应变化；
- Store按 project切换 snapshot；
- 本地只存 opaque ID，不存执行路径；
- 多窗口的存储key包含 workspace identity；
- 无项目时提示导入，不静默失败。

### 8.3 BuildStore

状态来源：

1. 初始/重连后的 API snapshot；
2. Runtime event增量；
3. 用户命令的 optimistic state仅限 started acknowledgement；
4. terminal state以后端为准。

要求：

- running/succeeded/failed/cancelled；
- progress和最后日志；
- diagnostics；
- project隔离；
- bounded history；
- reconnect不丢已有结果；
- cancel按钮只对 running enabled；
- 重复 terminal event幂等；
- error不转换为空数组。

### 8.4 Deploy UI

- build成功后才允许 build-and-deploy；
- deploy显示 preflight/executing/succeeded/partial/failed；
- static/JSP sync和 class publish文案区分；
- 不宣称 Class HotSwap；
- partial failure显示影响文件和恢复建议；
- destructive mirror delete需要明确确认；
- 不把本地绝对部署路径暴露为可编辑输入。

### 8.5 ServerStore 与命令

要求：

- Start、Stop、Restart、Debug命令语义一致；
- 本轮 Debug若未实现必须 disabled/隐藏，不能调用假的 endpoint；
- Restart必须是真 stop/start/reconcile，不是只 stop；
- 状态：stopped/starting/running/stopping/failed；
- current URL、PID（诊断可见）、startedAt、lastError；
- 同一项目默认一个 server实例；
- 防重复 start；
- 端口冲突显示可操作错误；
- Store通过 snapshot+event维护；
- StatusBar只读 Store，不额外5秒轮询；
- Agent reconnect时保留 stale状态并明确标识。

### 8.6 Widgets

用现有 ReactWidget/TreeWidget 代替旧 `innerHTML` 全量刷新路径。

最低组件：

- Welcome/Import panel；
- Active Project selector；
- Build view；
- Server view；
- Deployment status/timeline；
- Problems/diagnostics list；
- bounded Log viewer；
- runtime connection banner。

日志视图要求：

- 不在每行日志时重建全部 DOM；
- 内存有硬上限；
- 支持暂停自动滚动；
- 支持复制和清空 UI buffer；
- stderr/diagnostic有区别；
- 连接断开不插入无限重复消息；
- 大量日志测试不冻结 renderer。

本轮可以使用小型窗口化实现或 Theia现有组件，不要为虚拟滚动引入重量级 UI 框架。

### 8.7 UX 与可访问性

所有关键控件：

- `data-testid`；
- 可见 label或 aria-label；
- keyboard focus；
- disabled原因；
- loading/empty/error状态；
- destructive action确认；
- 不只用颜色表达状态；
- Windows 100%/125%/150%缩放基本可用；
- 1366×768不遮挡主操作。

### 8.8 Phase 3 Tests

- 使用真实 Inversify container实例化 contribution；
- Import Wizard成功/失败/cancel；
- multiple projects选择；
- active project恢复；
- command enablement；
- BuildStore snapshot/event/reconnect；
- ServerStore状态机；
- restart命令；
- render loading/empty/error；
- 10,000 log events内存有界；
- dispose后无listener；
- 禁止只通过正则读取源码证明命令注册。

---

## 9. Phase 4：真实 JDT LS 集成

### 9.1 架构所有权

```text
Electron / Theia backend
  → verifies bundled/downloaded JDT LS
  → launches JDT LS with host JDK 17
  → creates one process per workspace policy
  → connects Theia LanguageClient
  → browser Monaco receives LSP features
```

Runtime Agent 不再通过 HTTP 把 `os.Environ()` 整体返回给浏览器。必须删除这种行为，或在过渡期把 descriptor缩减为严格 allowlist且不包含 secret。

### 9.2 Distribution integrity

1. 固定版本；
2. 固定 SHA-256；
3. 下载使用 temp + hash + atomic move；
4. hash不匹配删除临时文件并失败；
5. offline时显示明确错误；
6. 安装包可选择预置 distribution，但必须记录许可和体积；
7. 不在每次启动重复下载；
8. 并发启动只有一次prepare。

### 9.3 Process launch

- JDT LS使用 JDK 17运行；
- legacy project compiler/source level按项目配置；
- workspace data dir隔离；
- Windows路径正确quote；
- stdout/stderr有界；
- 启动deadline；
- initialize失败终止进程；
- workspace close/app quit终止；
- crash有限重启；
- 不泄漏 Agent secret和全量环境。

### 9.4 LanguageClient

必须真实创建并启动 LanguageClient，不接受只注册 contribution或返回 descriptor。

至少证明：

- 打开 `.java` 后 client running；
- completion返回当前项目类型/方法；
- F12/Go to Definition跳到 fixture源码；
- 引入语法错误产生 diagnostics；
- 修复后 diagnostics消失；
- classpath包含 legacy sample所需依赖；
- workspace/project切换会更新或重启 session；
- app关闭后没有孤儿 JDT LS Java进程。

### 9.5 Java 6现实边界

本轮不承诺现代 JDT LS 对所有 Java 6语义完美兼容。报告必须区分：

- host runtime：JDK 17；
- project source/target：legacy配置；
- build truth：Ant/Javac provider；
- editor intelligence：JDT LS best effort。

不能为了让 completion通过而修改用户 build.xml或把项目升级到 Java 17。

### 9.6 Phase 4 Tests

- distribution hash pass/fail；
- concurrent prepare；
- launch args Windows snapshot；
- env allowlist；
- startup timeout；
- process crash/restart；
- LanguageClient lifecycle；
- completion integration；
- definition integration；
- diagnostics add/remove；
- shutdown无孤儿进程。

---

## 10. Phase 5：安装版产品纵向 E2E

### 10.1 Fixture隔离

不要直接修改仓库中的 `legacy-sample`。每次测试：

1. 复制到测试专用临时目录；
2. 路径至少覆盖一次空格和中文；
3. 使用测试专用 CATALINA_BASE；
4. 使用动态端口；
5. 保存测试生成内容；
6. finally只清理本测试拥有的目录/PID；
7. 失败时保留 evidence bundle。

### 10.2 Scenario A：首次安装和导入

```text
安装 Kairo IDE
→ 启动
→ Welcome 可见
→ 打开 Import Wizard
→ 选择 legacy sample副本
→ 扫描识别 build.xml/web.xml/source/web root
→ 确认工具链
→ 保存
→ Active Project显示正确项目
→ 关闭并重开
→ Active Project恢复
```

### 10.3 Scenario B：构建和诊断

```text
触发 Build
→ BuildStore出现 running
→ UI持续响应
→ 成功时显示 artifact/summary
→ 人为制造 Java错误
→ Build failed
→ Problems显示 file/line/message
→ 点击定位源码
→ 修复
→ Build succeeded
```

Mac Build Core尚未合并时，可先验证当前公开 API；如果暴露核心 bug，创建 contract request。Mac合并后必须重新执行本 Scenario，旧证据不能替代。

### 10.4 Scenario C：部署与 Tomcat

```text
Build and Deploy
→ classes进入 WEB-INF/classes语义
→ JSP/static同步
→ Start Server
→ 状态 starting → running
→ 内置/外部浏览器访问应用 URL
→ 页面返回预期内容
→ Restart
→ 状态 stopping/starting/running
→ 应用再次可访问
→ Stop
→ 状态 stopped
→ 端口释放
```

不得宣称 Java class HotSwap。修改 Java 后可通过 rebuild + deploy + context/server restart验证。

### 10.5 Scenario D：GBK/JSP round-trip

```text
打开 GBK JSP
→ 中文显示正确
→ 编辑一段中文
→ 按原编码保存
→ 后端字节验证仍是目标编码
→ Deploy static/JSP
→ 浏览器显示新内容
→ 无乱码
```

测试必须比较实际文件 bytes/decoder结果，不只看 UI toast。

### 10.6 Scenario E：Java Language Intelligence

```text
打开 Java fixture
→ 等待 JDT LS ready
→ completion选择一个项目symbol
→ F12跳到定义
→ 添加错误
→ diagnostics出现
→ 修复
→ diagnostics消失
```

### 10.7 Scenario F：可靠性

- Agent restart，UI重连且快照恢复；
- kill Agent，Desktop有限重启；
- kill Theia backend，用户获得明确失败/恢复；
- 连续crash进入failed，不产生进程风暴；
- 第二次启动聚焦原窗口；
- 关闭主应用，无 Agent/Theia/JDT/Tomcat孤儿进程；
- 非 C 盘安装；
- 路径含空格/中文；
- 断网下核心本地功能可启动；
- 已占用常见端口时仍通过动态端口启动。

### 10.8 E2E真实性

允许 Playwright Electron、Windows UI Automation或可靠的应用 test hook，但必须：

- 操作真实安装版；
- 使用稳定 `data-testid`；
- 不读取源码断言；
- 不直接调用 Store跳过 UI；
- 不用固定 sleep作为唯一等待；
- 超时输出 screenshot、DOM摘要、进程树和日志；
- secret在报告中redact；
- 每个 Scenario可单独复跑。

---

## 11. Phase 6：CI、性能与 Release Evidence

### 11.1 Windows CI Gate

建议 job分层：

```text
windows-unit
  - pnpm install --frozen-lockfile
  - package build/typecheck/unit/contract tests
  - go test owned non-core adapter packages

windows-package
  - build Agent exe
  - build Theia artifacts
  - build NSIS
  - inspect package contents
  - upload artifact + sha256

windows-installed-smoke
  - install NSIS silently/test mode
  - launch installed exe
  - verify readiness/auth/restart/shutdown
  - upload failure evidence
```

昂贵的完整 UI E2E可在 main/nightly运行；PR至少运行 installed smoke。不得让 job通过大量 skip得到绿色。

### 11.2 Race tests

Windows 本地没有 race结果不应伪装成已通过。策略：

- Go纯核心 race由 Mac/Linux工作流执行；
- Windows adapter若需要 race，在拥有受支持 C compiler的 CI runner实际运行；
- 保存命令和结果；
- 如果环境仍不支持，标记 blocked并给出原因，不修改测试跳过。

repository 4个 Windows locking tests归 Mac核心任务所有，Windows不得通过 retry补丁抢修。Mac合并后在 Windows重跑并报告平台结果。

### 11.3 性能预算

在目标低配机器或可比限制下记录，不把高配开发机结果冒充目标结果：

- 冷启动到编辑器可交互：目标 ≤ 8s；
- Agent ready：目标 ≤ 3s；
- Theia ready：记录独立耗时；
- JDT LS lazy启动，不阻塞首屏；
- 首次 Java completion：记录 p50/p95；
- steady-state内存：Electron/Theia/Agent/JDT/Tomcat分别记录；
- 10,000日志事件 UI不崩溃且内存有界；
- 应用退出子进程清理：目标 ≤ 10s。

如果目标未达成，先输出 profile和最大瓶颈，不进行没有数据支持的“优化”。

### 11.4 Evidence目录

最终生成一个不含 secret的 evidence bundle：

```text
artifacts/windows-wave2/
  manifest.json
  commands/
  logs/
  screenshots/
  process-snapshots/
  test-results/
  package/
    Kairo-IDE-*.exe
    SHA256SUMS.txt
  environment-redacted.txt
```

大二进制是否提交 Git由仓库策略决定；默认上传 CI artifact，不提交安装包。Manifest和文本报告可以提交。

---

## 12. Contract Freeze 与 Mac 集成

### 12.1 Windows 可先冻结的公开意图

前端只提交：

- WorkspaceID；
- ProjectID；
- Build intent（build/clean/selected files等受限意图）；
- Deploy intent；
- Server action；
- 用户确认信息。

前端不能提交：

- 任意 projectRoot；
- outputDir；
- source/target绝对路径；
- javaHome；
- Catalina base；
- 任意 command args；
- 任意 deploy destination。

这些由 Mac的 trusted repository和 PlanResolver决定。

### 12.2 Contract request格式

`docs/progress/WINDOWS_WAVE2_CONTRACT_REQUESTS.md` 每项使用：

```markdown
## CR-XXX: Short title

- Severity:
- Windows scenario:
- Current endpoint/request:
- Current response:
- Expected typed behavior:
- Why UI cannot safely work around it:
- Reproduction:
- Evidence:
- Requested owner: Mac Core / Integration / Windows Adapter
- Blocking phase:
```

### 12.3 集成顺序

1. Windows Wave 1安全分支先 push；
2. Windows Wave 2在自己的分支持续开发；
3. Mac完成 `feature/mac-project-build-core` 和 final report；
4. 创建专用 `integration/windows-mac-core` 分支；
5. 先合 Windows Desktop/Frontend稳定契约；
6. 再合 Mac Core；
7. 一个 Integration Lead修改 composition root/API adapter；
8. Windows重新执行 Phase 5全部安装版 Scenario；
9. Mac/Linux执行 pure core/race；
10. 全绿后更新 `MILESTONES.md`。

不能用 Windows在 Mac合并前的 Build/Deploy E2E证据替代合并后的回归。

---

## 13. 明确不做，避免过度设计

本轮禁止投入：

- Remote Server正式认证；
- Argon2/CSRF/多用户；
- DAP/JDWP Debug；
- Java Class HotSwap/DCEVM；
- Maven/Gradle/Spring Boot；
- 第三层 Runtime Plugin；
- 在线插件市场；
- SQLite；
- 自制通用 event sourcing；
- 微前端；
- Redux等新的全局状态框架；
- 亮色主题；
- 大规模品牌视觉重做；
- 自动更新和代码签名正式发布链；
- AI功能。

本轮目标是证明核心桌面产品可用，不是建设未来五年的平台能力。

---

## 14. 全局质量 Gate

至少执行并记录：

```powershell
git diff --check
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm test:agent
pnpm --filter @kairo/desktop build:win
powershell -ExecutionPolicy Bypass -File scripts/verify-e2e.ps1
```

根据实际 scripts补充：

- runtime contract tests；
- Desktop supervisor tests；
- Java LS integration；
- installed smoke；
- Playwright scenarios；
- package content inspection。

要求：

1. 每条命令记录退出码；
2. 不使用旧 build artifact；
3. 不在命令后添加 `|| true`；
4. 测试失败不能只重跑到偶然通过，必须查明 flaky原因；
5. 所有新增 timer/process/listener在测试后清理；
6. 安装版测试结束后不留进程和临时服务；
7. 无未经解释的 skip；
8. TypeScript不新增无理由 `any`；
9. HTTP/WS错误不静默转换为空数据；
10. 日志和 artifact不含 secret。

---

## 15. Definition of Done

### Wave 1封板

- [ ] 4个 Windows提交已在安全远程分支
- [ ] NSIS从清洁状态真实构建
- [ ] 安装包路径、大小、SHA-256记录
- [ ] 安装版冷启动成功
- [ ] Agent/Theia动态端口成功
- [ ] 无secret/错误secret为401
- [ ] renderer真实鉴权请求成功
- [ ] WebSocket鉴权成功
- [ ] restart导致Agent PID变化
- [ ] UI在restart后恢复
- [ ] app退出无子进程泄漏

### Desktop Host

- [ ] Electron main唯一拥有Agent/Theia
- [ ] 无固定3000/18099生产fallback
- [ ] 无executeJavaScript配置注入
- [ ] secret不在命令行/日志/storage/global
- [ ] child状态机有行为测试
- [ ] start timeout/crash/backoff/shutdown覆盖
- [ ] dev/packaged/空格/中文/非C盘路径覆盖
- [ ] single instance覆盖

### Runtime Contract

- [ ] 全前端只有一个RuntimeGateway
- [ ] Widget/Store无直接fetch
- [ ] EndpointMap在restart后刷新
- [ ] HTTP timeout/abort/typed error覆盖
- [ ] WS auth/reconnect/jitter覆盖
- [ ] reconnect后Build/Server snapshot恢复
- [ ] dispose无timer/listener泄漏

### Product UI

- [ ] Import Wizard真实保存
- [ ] ActiveProject是唯一项目上下文
- [ ] 多项目可选择，不硬编码projects[0]
- [ ] BuildStore snapshot+event
- [ ] Deploy状态真实
- [ ] ServerStore snapshot+event
- [ ] Restart不是只Stop
- [ ] StatusBar无独立轮询真相
- [ ] 旧innerHTML日志/Build/Server视图被替换
- [ ] 日志内存和DOM有界
- [ ] loading/empty/error/disabled可见
- [ ] 关键控件data-testid和键盘可用

### Java

- [ ] JDT LS由Theia backend真实启动
- [ ] distribution SHA校验
- [ ] 不向浏览器暴露os.Environ
- [ ] completion真实通过
- [ ] definition真实通过
- [ ] diagnostics出现和清除
- [ ] workspace关闭无JDT孤儿进程

### 安装版 E2E

- [ ] 首次安装/导入
- [ ] 关闭重开恢复Active Project
- [ ] Build成功
- [ ] Build失败diagnostic可定位
- [ ] Deploy成功
- [ ] Tomcat Start/Restart/Stop
- [ ] 浏览器访问真实JSP
- [ ] GBK round-trip字节验证
- [ ] Java completion/definition/diagnostics
- [ ] Agent crash/restart恢复
- [ ] app关闭无Agent/Theia/JDT/Tomcat孤儿
- [ ] 路径含空格/中文
- [ ] 非C盘安装

### 工程质量

- [ ] 所有全局Gate通过
- [ ] 无未经解释skip
- [ ] 未修改Mac禁区文件
- [ ] contract requests完整
- [ ] evidence bundle无secret
- [ ] 最终报告诚实区分verified/partial/blocked

---

## 16. 最终报告

创建：

```text
docs/progress/WINDOWS_WAVE2_FINAL_REPORT.md
```

必须包含：

1. Executive Summary；
2. Windows实际起始/最终commit；
3. 分支和远程状态；
4. 修改文件清单；
5. 未修改Mac禁区的命令证明；
6. Phase 0 NSIS真实结果；
7. 安装包SHA-256；
8. Desktop三进程架构；
9. 启动/restart/shutdown PID时间线；
10. secret威胁模型和redaction证明；
11. Runtime contract变化；
12. UI旧实现到新实现迁移表；
13. JDT LS completion/definition/diagnostics证据；
14. 每个E2E Scenario结果；
15. 所有命令、退出码、用时；
16. flaky/skip清单；
17. 性能和内存数据；
18. artifact/evidence位置；
19. Contract Requests；
20. Mac合并后必须重跑的测试；
21. 仍然 partial/blocked的功能；
22. 是否满足 Release Candidate标准。

禁止使用：

- “代码看起来已经就绪”；
- “理论上可以运行”；
- “Worker说通过”；
- “脚本已经写好所以算完成”；
- “以后有时间再实际验证”。

只能使用：

- “命令 X 在环境 Y 的退出码为 0”；
- “安装版 PID/HTTP/UI 行为证据为……”；
- “此项未执行，因此状态仍为 partial”；
- “此项因明确原因 blocked，复现为……”。

---

## 17. 给 DeepSeek 多 Agent 的直接执行指令

请把本任务作为一个连续长任务执行，不要只做 Phase 0，也不要跳过 Phase 0直接开发 UI。

执行顺序：

```text
保护Wave 1提交
→ Phase 0真实NSIS封板
→ Phase 1 Desktop Host
→ Phase 2 Runtime Contract
→ Phase 3 Product UI
→ Phase 4 JDT LS
→ Phase 5安装版E2E
→ Phase 6 CI/性能/证据
```

允许多 Agent 并行，但必须遵守文件所有权和 contract freeze。Mac正在重构可信 Project/Build/Deploy Core；发现相关问题只写 Contract Request，不在 Windows分支修改对应目录。

最终目标不是增加代码数量，而是让一个全新安装的 Windows用户能够真实完成：

```text
安装
→ 启动
→ 导入遗留Java Web项目
→ 构建
→ 查看诊断
→ 部署
→ 启动Tomcat
→ 访问JSP
→ 编辑GBK文件并正确保存
→ 使用Java completion和definition
→ 重启运行时并自动恢复
→ 安全退出且无孤儿进程
```

任何未实际执行的步骤必须保持 partial。不要为了“任务完成”牺牲事实准确性。
