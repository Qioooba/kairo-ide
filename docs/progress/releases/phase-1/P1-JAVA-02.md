# P1-JAVA-02 JDT LS 生命周期第二切片

- 状态：implemented
- 负责人/模型：Codex java_semantics Agent
- 开始时间：2026-07-22
- 完成时间：2026-07-22
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交
- 依赖任务：P1-JAVA-01

## 目标

让一个工作区只拥有一个可管理的 JDT LS 会话，并在崩溃、项目切换、工作区关闭和前端销毁时形成不会无限重启、不会重复拉起进程的安全生命周期闭环。

## 本切片已实现

1. 生命周期订阅后端真实状态；`crashed` / `failed` 时自动恢复。
2. 自动恢复最多三次，采用 1 秒、2 秒、4 秒指数退避，上限 10 秒；到达上限后停止并要求人工重启。
3. 重启定时器和执行态分别防重入；同一次崩溃的重复状态事件只触发一次恢复。
4. 项目或工作区关闭会取消待执行重启、使在途 prepare/descriptor 请求逻辑失效，并调用后端 stop。
5. 前端生命周期 dispose 会退订全部监听、取消恢复并发出有界 stop，释放 JDT LS 进程和 Eclipse workspace-data 锁。
6. 切换到不同 root/data key 时先停止旧的 ready 会话，再启动新会话，避免后端单例把旧进程误报为新项目已启动。
7. 激活 token 阻止旧项目的异步 prepare/descriptor 响应在新项目或已关闭工作区中启动进程。
8. 后端 stop 在没有 child 的 crashed/failed 状态立即完成，不再空等三秒。
9. 正常停止先发 SIGTERM，三秒仍未退出则 SIGKILL，再有限等待一秒；`ChildProcess.killed` 不再被错误当作“进程已退出”。
10. 旧 child 的迟到 error/exit 事件使用实例身份隔离，不会清理替代进程的连接或把新会话标成 crashed。
11. 独立审查修复：所有 stop 调用共享同一个有界 Promise；Manager 明确拒绝在 `stopping` 或 stop Promise 未完成时 start。
12. 项目切换的 stop/start 临界区通过生命周期 Promise 链串行执行；三个项目交错切换时，旧切换完成 stop 后会因 activation token 失效而退出，只启动最新项目。
13. `initialize` 使用 60 秒硬超时；超时后记录日志、SIGKILL 子进程并进入可自动恢复的 `failed` 状态。
14. Completion、Definition、Hover、References、Signature Help、Document Symbols、Rename 和 class-file contents 统一使用 30 秒硬超时；超时会终止无响应进程并进入 `crashed`，触发现有限次恢复策略。
15. Monaco CancellationToken 已接入所有已注册 Java Provider：调用前取消则不发请求，调用中取消则丢弃迟到结果；后台请求仍受 30 秒硬超时约束。

## 修改文件

- `packages/java-extension/src/browser/java-ls-lifecycle.ts`
- `packages/java-extension/src/browser/java-ls-lifecycle.test.cjs`
- `packages/java-extension/src/browser/index.ts`
- `packages/java-extension/src/node/jdt-ls-manager.ts`
- `packages/java-extension/src/node/jdt-ls-manager.test.cjs`

## 自动化验证

| 命令 | 超时 | 结果 |
|---|---:|---|
| `pnpm --filter @kairo/java-extension build` | 300 秒 | PASS |
| `pnpm --filter @kairo/java-extension test` | 300 秒 | PASS，新增验证包含在 56 项测试中 |
| `pnpm lint` | 300 秒 | PASS，0 warning |

覆盖场景包括：崩溃只调度一次恢复、三次上限、显式关闭不恢复、工作区关闭取消在途启动、项目切换先停后启、三项目 stopping 交错、共享 stop Promise、stopping 禁止 start、dispose 停止进程、无 child 快速停止、SIGTERM 后强制升级 SIGKILL、hung initialize 和 hung semantic request。

## 明确边界与剩余风险

- 单元测试使用真实生命周期代码和伪造的进程/RPC 边界，没有启动真实 JDT LS；仍需在 Windows 和 macOS 上执行进程崩溃注入验收。
- 当前状态模型只有 `starting`、`initializing`、`ready` 等，没有独立的 `indexing` 状态或索引进度百分比。
- 自动恢复次数按一次项目激活会话累计，ready 后不会立即清零；这是防止“启动成功后立刻崩溃”形成无限循环的保守策略。
- 前端 dispose 接口不能 await；stop 由后端保证最多约四秒完成。浏览器进程被操作系统强杀时仍依赖后端连接/进程退出清理。
- 尚未给每次启动和崩溃生成 traceId，也未将重启次数展示到状态栏。
- workspace-data 目录不会删除，只释放进程持有的锁；缓存清理策略需在明确保留/删除规则后单独实现。
- Monaco 取消目前不能跨 Theia JSON-RPC 传播为 LSP `$/cancelRequest`；当前保证 UI 丢弃取消结果、后端请求有 30 秒硬上限。后续需为 RPC 协议增加 requestId/cancel 方法，才能立即释放服务端计算。

## 人工验收步骤

1. 打开真实遗留项目，确认只存在一个 JDT LS child process。
2. 连续强杀 child，确认日志显示 1/3、2/3、3/3 退避恢复，第四次不再自动拉起。
3. 在退避期间关闭项目或工作区，确认定时器取消且没有新 child。
4. 在 JDT LS ready 时切换到另一项目，确认旧 PID 退出后才出现新 PID，新进程使用新的 root/data 目录。
5. 关闭 IDE，确认四秒内 child 消失且 workspace-data 锁可重新获取。
6. 保存 PID 时间线、状态日志和进程退出证据，独立审查后才可把状态提升为 `verified`。
