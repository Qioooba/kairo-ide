# P1-BLD-01A 可信 javac 构建与可取消闭环

- 状态：`implemented`
- 负责人/模型：Codex release_baseline Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交（共享工作区）
- 父任务：P1-BLD-01

## 本切片交付结果

形成一个可独立验收的真实 javac 垂直闭环：用户从 Build 面板启动或取消构建，Runtime Agent 只使用已登记项目派生的可信计划执行 javac；成功、失败、超时和取消都进入明确终态，取消会终止完整子进程树，不再把空工程或缺少 provider 当作成功。

本切片没有执行 run configuration 中的 custom command，也没有新增 shell 拼接执行。

## 审计结论

审计发现仓库存在两套构建路径：

1. 生产 `/api/v1/builds` 使用 `services.asyncBuildEngine -> build.Compiler -> proc.ManagedProcess`，当前只执行受控 javac。
2. `app.BuildUseCase` 与 `provider/build` 包含 Ant/javac provider，但尚未接入生产 HTTP 构建端点。Ant provider 仍使用 `exec.CommandContext`，只能保证直接进程取消，尚未达到跨平台子进程树验收要求。

切片前的关键问题：

- `DELETE /api/v1/builds/{id}` 实际执行 GET，没有取消。
- `Compiler` 把取消上下文传给 `ManagedProcess.Start` 后直接阻塞 `Wait`；受管进程为服务器生命周期设计，不会随 Start 上下文退出，因此 javac 取消和五分钟超时均可能失效。
- HTTP DTO 可静默接受 `projectRoot/outputDir/files/classpath/toolchainId`，调用方可覆盖受信执行路径。
- clean 在二次边界校验前删除 outputDir；空源码会返回成功。
- 服务端失败状态写作 `failed`，与协议 `failure` 不一致；traceId 未进入构建结果。
- stdout 虽受进程层 1 MiB 环形缓冲保护，但 BuildResult 没有更小的 API/持久化上限，也没有路径和常见秘密脱敏。
- structured javac diagnostics 已支持中英文解析，Build 面板也能显示；但尚未注册到 Theia Problems/MarkerManager，因此“Problems 面板与源码问题标记”仍未完成。

## 已实现

### 可信请求与安全路径

- POST 构建请求严格只接受 `projectId/clean/intent/selectedFiles`，未知字段和伪造的受信字段直接返回 400。
- root、outputDir、classpath、toolchain、源码级别和编码从已登记项目派生，而非信任浏览器。
- API 层和 BuildEngine 层双重执行工作区边界、symlink 逃逸、普通 `.java` 文件和“outputDir 不能等于项目根”校验。
- 所有 clean 删除均发生在二次边界校验之后；越界测试证明外部 marker 文件不受影响。
- selected-files 最多 10,000 项；full build 最多 100,000 个源码文件。
- full source walk 排除 `.git`、`.legacyflow`、`node_modules`、`target` 和当前 outputDir，避免误编译及无界扫描常见生成树。
- 参数通过 `exec` argv 传递，不经过 shell。Windows 超过 50 个源码或预计 argv 超过 24 KiB 时使用 0600 临时 javac argfile，并在结束后删除。

### 取消、超时与状态

- BuildEngine 新增带 context 的 `Cancel`，HTTP DELETE 调用真实取消。
- javac 默认构建超时为五分钟；取消或超时时调用 `proc.ManagedProcess.ForceStop`，POSIX 使用进程组，Windows 使用 Job Object/taskkill 进程树边界。
- 单次进程树停止等待最多五秒；DELETE 等待终态持久化最多十秒；所有等待都有上限。
- 取消幂等：重复取消已终态构建返回同一终态，不篡改成功/失败历史。
- 若 compiler 在 cancel 竞态中返回 nominal success，Engine 仍以 context 为准落盘 `cancelled`。
- 空源码在创建历史前失败，不再出现绿色“0 files”假构建。
- wire 失败状态统一为 `failure`；历史中的旧 `failed` 载入时规范化。

### trace、输出和诊断

- traceId 按 correlationId、requestId 顺序获取，进入 BuildResult、finished.json 和结构化 Agent 日志。
- Agent 日志只记录 buildId/projectId/traceId/state/exitCode，不记录 argv、源码内容或完整 stdout；日志层继续应用 Redactor。
- BuildResult output 上限 512 KiB；error 和单条 diagnostic message 上限 16 KiB，截断保持合法 UTF-8。
- output/error/diagnostic message 中的 workspace、JDK 路径替换为 `<workspace>/<jdk>`；路径替换大小写不敏感并覆盖 slash/backslash 形式。
- 常见 `password/passwd/token/secret/api-key=...` 赋值替换为 `[REDACTED]`。
- diagnostic file 规范化为 workspace-relative `/` 路径；越界路径清空，不向浏览器泄露绝对路径。

### Build UI

- Build 面板在 queued/running 状态显示真实 Cancel 按钮，调用 DELETE endpoint。
- 取消中按钮锁定并显示 `Cancelling…`；Store 对同一 build 的并发取消请求去重，快速双击只发送一次请求。
- cancelled 结果保留 finishedAt，失败时在面板显示可读错误，不产生未处理 Promise rejection。

## API 状态语义

| 操作 | 结果 |
|---|---|
| POST 严格 DTO/项目路径失败 | 400，不创建 queued 历史 |
| Engine/toolchain/空源码 preflight 失败 | `compile_failed`，不创建 queued 历史 |
| javac exit 0 | `success`，保存 exitCode/output/diagnostics |
| javac exit 非 0 | `failure`，保存真实 exitCode 和 diagnostics |
| 五分钟 compiler deadline | `failure` + `build timed out` |
| DELETE queued/running | 等待进程树退出并返回 `cancelled` |
| DELETE terminal | 幂等返回原 terminal result |
| DELETE 不存在 ID | 404 |
| 取消等待超过十秒 | timeout error，不伪造 cancelled |

## 修改文件

- `runtime-agent/internal/api/services.go`
- `runtime-agent/internal/api/handlers.go`
- `runtime-agent/internal/api/handlers_test.go`
- `runtime-agent/internal/build/compiler.go`
- `runtime-agent/internal/build/compiler_test.go`
- `runtime-agent/internal/services/build.go`
- `runtime-agent/internal/services/build_test.go`
- `packages/protocol/src/index.ts`
- `packages/build-extension/src/browser/build-store.ts`
- `packages/build-extension/src/browser/build-view-widget.tsx`
- `packages/build-extension/src/browser/build-store-map.test.cjs`

## 验证证据

全部命令通过 `scripts/run-with-timeout.cjs` 执行且不超过 300 秒：

- Go build/proc/services/api 普通测试：PASS。
- 同四包 `go test -race`：PASS。
- Runtime Agent 全量 `go test ./...`：PASS。
- `go vet ./...`：PASS。
- Windows amd64 build/proc/services 测试包交叉编译：PASS。
- protocol lint/test：PASS，17/17。
- build-extension lint/build/test：PASS，4/4。

测试覆盖：真实 POSIX 挂起 javac 超时与进程树停止、取消幂等、取消成功竞态、严格 DTO、selected traversal、symlink 逃逸、clean 越界不删除、空源码不假绿、扫描排除、诊断相对路径、输出 UTF-8 截断/路径与秘密脱敏、DELETE handler、UI 取消去重与 finishedAt。

## 未完成与下一切片

P1-BLD-01 尚不能标记 verified，后续 P1-BLD-01B 至少需要：

1. 将 Ant 纳入同一可信计划和 `proc.ManagedProcess` 进程树取消边界，严格验证 build.xml 与 target；在此之前生产端点不得宣称支持 Ant。
2. 将 structured diagnostics 注册到 Theia MarkerManager/Problems，并支持点击跳转源码；当前 Build 面板仅显示诊断列表。
3. 将 build progress/log 作为真实事件流推送到 UI，并补日志查看/复制/保存体验。
4. 用合法 JDK 6、真实 Ant 和 legacy-sample 在 Windows 10/macOS 完成成功、编译错误、超时、取消、中文路径/GBK 验收。
5. 建立 clean/full/incremental 性能报告；本切片未声称达到“增量编译 ≤ 2 秒”。

## 回滚方式

移除 BuildEngine.Cancel、HTTP DELETE 分支、严格计划派生、Compiler 取消 watcher 和 Build UI Cancel 接线即可。回滚不会删除用户源码；finished.json 保持向后兼容，新增 traceId 为可选字段。
