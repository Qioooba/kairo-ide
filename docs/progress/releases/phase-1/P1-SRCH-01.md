# P1-SRCH-01 搜索会话状态垂直切片

- 状态：implemented
- 负责人/模型：Codex Search Agent + Codex 主 Agent
- 开始时间：2026-07-22
- 完成时间：2026-07-22
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交
- 依赖任务：现有 `POST /api/v1/search` 与 `RuntimeConnectionService`

## 目标

在不重复建设 Theia 搜索 UI 的前提下，为后续全文搜索结果面板和 Search Center 提供一个可复用、可测试的前端搜索会话模型，完整表达加载、正常结果、空结果、错误和取消状态，并阻止旧请求结果倒灌。

## 用户价值

- 用户连续输入新查询时，旧查询不能覆盖最新结果。
- 搜索过程可明确展示加载、无结果、失败和已取消，而不是无反馈或错误 toast 混杂。
- include/exclude glob 在进入后端前去空、去重，减少无效或相互重复的筛选条件。
- 后续 UI 可订阅同一状态源，无需各自实现请求竞态和取消逻辑。

## 范围

- 新增 `KairoSearchSessionModel` 和不可变语义的状态快照。
- 支持 `idle`、`loading`、`results`、`empty`、`error`、`cancelled` 状态。
- 支持监听/退订、显式取消、重置、查询序号和过期响应保护。
- 隔离监听器异常；单个视图监听器失败不会阻断其他监听器、改变搜索结果或让搜索 Promise 异常。
- 规范化搜索默认开关与 include/exclude glob。
- 将状态模型注册到现有 Inversify 组合根并公开类型。
- 补齐状态与并发竞态单元测试。
- 将 HTTP request context 贯通到 Go 搜索引擎，确保取消请求会终止文件扫描。
- 不再忽略 `filepath.WalkDir` 的最终错误。
- 区分 `cancelled`、`timeout` 与 `io_error`，避免用户主动取消被显示为搜索故障。

## 非范围

- 不新建侧栏、结果树或 Search Everywhere 弹窗，避免与 Theia 自带搜索重复。
- 不修改 `packages/protocol` 或 Theia 内置搜索适配器。
- 不实现替换事务、结果虚拟化、搜索历史或固定查询。
- 不声称已实现真正的流式结果或服务端任务取消。

## 实现摘要

`KairoSearchSessionModel` 包装已有 `KairoSearchService`，每次查询分配递增 requestId。只有当前 requestId 的完成或异常可以改变状态，因此被新输入取代的旧响应不会倒灌。显式取消会立即发布 `cancelled` 状态并使在途请求失效。运行时错误被保存为 `error` 状态，供 UI 原位展示。

后端第二切片将 `http.Request.Context()` 依次传入 `api.Searcher`、`memSearcher` 和 `search.Options.Cancel`。目录遍历、UTF-8 逐行扫描以及非 UTF-8 文件读取前后都会检查取消状态；取消返回 `context.Canceled`，而不是继续占用磁盘和 CPU。WalkDir 的非取消错误现在返回调用方，不再被静默丢弃。

独立审查后又完成第二轮收口：非 UTF 文件改为 64 KiB 分块读取并在块间检查 context；根目录无法读取现在直接失败，子文件错误仍作为部分结果返回；协议增加 `cancelled` 错误码，deadline 映射为可重试的 `timeout`。

## 修改文件

- `packages/search-extension/src/browser/search-session-model.ts`
- `packages/search-extension/src/browser/search-session-model.test.cjs`
- `packages/search-extension/src/browser/index.ts`
- `packages/search-extension/src/browser/search-service.ts`
- `packages/search-extension/package.json`
- `runtime-agent/internal/api/handlers.go`
- `runtime-agent/internal/api/handlers_test.go`
- `runtime-agent/internal/api/services.go`
- `runtime-agent/internal/services/search.go`
- `runtime-agent/internal/search/search.go`
- `runtime-agent/internal/search/search_test.go`
- `runtime-agent/internal/api/protocol/types.go`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/envelope.test.ts`
- `docs/progress/releases/phase-1/P1-SRCH-01.md`

## 接口/数据结构变化

新增前端公开类型：

- `SearchSessionStatus`
- `SearchSessionState`
- `SearchSessionListener`
- `KairoSearchSessionModel`

请求/响应形状未变化。错误码集合新增向后兼容的 `cancelled`；当前仍通过 `POST /api/v1/search` 获取一次性 `SearchResponse`。

Go 内部 `Searcher` 接口增加 `context.Context` 参数；这是进程内接口变化，不影响 `/api/v1/search` 的线协议。

## 测试命令与结果

- `pnpm --filter @kairo/search-extension build`：通过。
- `pnpm --filter @kairo/search-extension lint`：通过。
- `pnpm --filter @kairo/search-extension test`：14/14 通过，其中新增 7 项状态模型测试，既有 7 项服务契约测试继续通过。
- 所有命令均使用 300 秒进程闹钟，未发生超时。
- `go test -count=1 -timeout 120s ./internal/search ./internal/services ./internal/api`：通过。
- `go test -count=1 -race -timeout 120s ./internal/search ./internal/services ./internal/api`：通过。
- 新增 HTTP context 契约测试，验证 request context 传入 Searcher，并分别映射 `cancelled` / `timeout`。
- `pnpm --filter @kairo/protocol build && pnpm --filter @kairo/protocol test`：通过，16/16。

## 人工验收步骤与证据

当前为无 UI 的状态垂直切片，人工集成验收留给结果面板任务：

1. 由结果面板订阅 `KairoSearchSessionModel`。
2. 输入可命中查询，确认依次显示 loading 与结果。
3. 输入无命中查询，确认显示 empty，而不是空白面板。
4. 断开 Runtime Agent 后查询，确认原位显示 error。
5. 搜索中点击取消，确认立即显示 cancelled。
6. 快速输入两个查询，故意延迟第一次响应，确认最终只显示第二次查询。

自动化证据由 `search-session-model.test.cjs` 覆盖。

## 性能数据

状态模型不复制匹配结果，仅替换响应数组引用；状态发布为同步监听。单元测试总耗时约 0.81 秒。真实 10k 文件搜索性能仍由后端和后续 UI 集成测试测量。

## 风险与遗留问题

- 当前协议没有计划中的 `taskId`、事件流、服务端 cancel endpoint 和分页/继续加载，因此无法满足“首批结果 ≤ 300ms”的流式验收；下一后端切片必须补协议与 Agent 契约。
- `SearchResponse` 没有逐条 encoding 字段，也没有明确 scope、symlink 和隐藏目录策略。
- 当前 `runtime-agent/internal/search` 实际使用 `filepath.WalkDir`，不是 ripgrep；取消和错误传播已经修复，但单次阻塞文件系统 Read 和正则执行无法被 Go context 强行抢占。10k 文件性能与网络盘行为仍必须实测，必要时再决定是否替换搜索引擎。
- 尚未接入可视组件，状态模型完成不等于用户已可使用 Kairo Search Center。

## 审查结论

代码和自动化测试完成，待独立审查以及后续 UI 集成后升级为 `verified`。

## 回滚方式

删除新增状态模型与测试文件；在 `browser/index.ts` 恢复只绑定 `KairoSearchService`；恢复原测试脚本。协议与后端未变化，无数据迁移。
