# P1-JAVA-03 Java 核心语义能力首个垂直切片

- 状态：implemented
- 负责人/模型：Codex java_semantics Agent
- 开始时间：2026-07-22
- 完成时间：2026-07-22
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交
- 依赖任务：P1-JAVA-01、P1-JAVA-02

## 目标

在现有 Monaco → 浏览器 Provider → Theia JSON-RPC → JDT LS 架构上，交付可真实调用语言服务器的核心语义能力，不用静态扫描或模拟 UI 冒充结果。

## 本切片已实现

1. Hover：展示 JDT LS 返回的 Markdown、纯文本和代码片段。
2. References：支持是否包含声明，并把跨文件位置交给 Monaco 引用结果 UI。
3. Signature Help：支持 `(`、`,` 触发和重触发，保留活动签名、活动参数及参数文档。
4. Document Symbols：支持 LSP 层级 `DocumentSymbol` 和扁平 `SymbolInformation` 两种返回形态，接入 Monaco 大纲/当前文件符号能力。
5. Rename：调用标准 `textDocument/rename`，把 `changes` 和 `TextDocumentEdit` 转为 Monaco 工作区文本编辑，由编辑器提供预览与应用流程。
6. 初始化能力声明补充 Rename；所有请求只在 JDT LS `ready` 后发出，失败返回空结果并记录日志。
7. 重命名若包含 create/rename/delete 文件操作会明确拒绝，而不是只应用部分文本修改。
8. Go to Implementation：贯通 Monaco → RPC → JDT LS 的 `textDocument/implementation`，支持接口/抽象声明跳转到实现位置。
9. Workspace Symbols：贯通 `workspace/symbol` 的后端能力，供下一波 Search Everywhere/Quick Access 统一入口消费；当前 Monaco 版本不提供全局符号注册 API，因此没有伪造错误的 Monaco provider。
10. Code Actions / Quick Fix 安全子集：向 JDT LS 发送当前范围、诊断和 action kind，只向 Monaco 暴露带纯文本 `WorkspaceEdit` 的 action；命令型 action、disabled action 和包含文件资源操作的 edit 不会被静默执行。

## 端到端路径

`JavaMonacoRegistrationContribution` 注册真实 Monaco Provider，调用 `JavaCompletionProvider` 的就绪态门禁，再由 `JavaLanguageClient` 优先通过 Theia JSON-RPC 代理调用后端 `JdtLsService`，最终由 `JdtLsManager` 发送标准 LSP 请求。RPC 不可用时沿用现有单进程后端回退机制。

## 修改文件

- `packages/java-extension/src/common/lsp-protocol.ts`
- `packages/java-extension/src/common/java-ls-protocol.ts`
- `packages/java-extension/src/node/jdt-ls-manager.ts`
- `packages/java-extension/src/node/jdt-ls-service.ts`
- `packages/java-extension/src/browser/java-language-client.ts`
- `packages/java-extension/src/browser/java-completion-provider.ts`
- `packages/java-extension/src/browser/java-monaco-registration.ts`
- `packages/java-extension/src/node/jdt-ls-semantic.test.cjs`
- `packages/java-extension/src/browser/java-semantic-provider.test.cjs`
- `packages/java-extension/package.json`

## 自动化验证

| 命令 | 超时 | 结果 |
|---|---:|---|
| `pnpm --filter @kairo/java-extension build` | 300 秒 | PASS |
| `pnpm --filter @kairo/java-extension test` | 300 秒 | PASS，56/56 |
| `pnpm lint` | 300 秒 | PASS，0 warning |
| `pnpm test` | 300 秒 | PASS，全仓包与应用测试退出码 0 |

新增测试验证五类语义请求的方法名、参数封装、0 基位置、ready 门禁和真实结果透传。Monaco 注册层由 TypeScript 类型检查覆盖；由于 Monaco 包在纯 Node 环境加载 CSS，不能用当前 Node test runner 直接实例化，浏览器级行为仍需 Playwright 验收。

## 未完成与风险

- Workspace Symbols 的 Quick Access 消费入口等待 P1-SRCH-02 整合；当前服务端查询链路已经可用。
- Rename 的服务端资源操作暂时安全拒绝；后续需接入 Theia 文件服务及撤销事务后再开放。
- 尚未用真实 Java 6 遗留工程验证 Hover、跨项目 References、符号索引和 Rename；本文件状态不能提升为 `verified`。
- P1-JAVA-01 尚未锁定兼容的 JDT LS / 运行 JDK 组合；当前代码能力不等于 Java 6 兼容认证通过。
- P1-JAVA-02 的崩溃限次重启、索引可见状态及工作区关闭资源释放仍待独立切片完成。

## 人工验收步骤

1. 用锁定版本的 JDT LS 打开真实 Java 6 工程，等待状态为 ready。
2. 在源码和依赖类上逐项验证 Hover、Shift+F12 References、参数提示、文件大纲和 Shift+F6 Rename。
3. Rename 预览必须列出所有受影响文件；取消不落盘，确认后所有文本修改可一次撤销。
4. 关闭并重新打开工程，确认符号索引结果稳定，JDT LS 进程和 workspace data 没有泄漏。
5. 保存截图、JDT LS 日志、耗时和工程信息后，才能由独立审查者标记为 `verified`。
