# P1-SRCH-02B Search Everywhere 首个功能切片

- 状态：implemented
- 负责人/模型：Codex Search Agent
- 完成时间：2026-07-23
- 依赖：Java workspaceSymbols、WorkspaceContext、FileService、CommandRegistry

## 目标与用户价值

提供统一的 All、Files、Types、Symbols、Actions 搜索入口，支持模糊排序、最近使用、分类筛选、上下键与 Enter 操作；新查询取消旧查询并限制每类结果数量。

## 实现摘要

- `SearchEverywhereModel` 聚合可插拔 provider，使用 AbortController、generation 防倒灌、100 条默认上限和 O(n log n) 模糊排序。
- Files provider 在工作区内有界遍历，跳过生成目录；单目录不可读时隔离失败。
- Java provider 消费 `JavaLanguageClient.workspaceSymbols()`，按 LSP kind 区分 Types/Symbols。
- Actions provider从 CommandRegistry 获取可见命令，先模糊过滤排序再限量。
- 最近使用去重并保留 20 条。
- 明确命令 `kairo.search.everywhere`；双 Shift 使用 400ms 安全检测，不覆盖现有快捷键，拒绝 repeat、修饰键和输入/contenteditable 子树。
- 打开文件/符号/命令的 Promise 错误在 UI 内可见展示，不产生未处理拒绝。

## 修改文件

- `search-everywhere-model.ts`
- `search-everywhere-providers.ts`
- `search-everywhere-widget.tsx`
- `search-everywhere-contribution.ts`
- `search-everywhere-model.test.cjs`
- `search-center.css`、`index.ts`、`package.json`、`tsconfig.json`
- `pnpm-lock.yaml`

## 测试证据

所有命令通过 `scripts/run-with-timeout.cjs`，单步不超过 300 秒：

- search-extension build：通过。
- search-extension lint：通过。
- 目标 ESLint：0 warnings / 0 errors。
- search-extension test：29/29 通过。
- 覆盖模糊排序、分类/限量、取消防倒灌、最近使用、provider 全失败、双 Shift 边界、打开失败可见化。

## 风险与遗留

- 当前 UI 是居中的主区 Widget，不是最终覆盖编辑器的模态浮层；视觉与焦点恢复仍需 Browser E2E 后迭代。
- Files provider 采用 5000 项有界遍历而非持久索引；超大项目需接入文件索引服务。
- 最近使用当前为会话内存态，尚未持久化。
- Java provider 的取消只能忽略已返回结果，JDT LS workspace/symbol RPC 本身尚无协议级 cancel。
- 多根工作区、provider 分项错误提示和真实项目性能尚待集成验收。

## 回滚

移除上述 Search Everywhere 文件与绑定；保留全文 Search Center 和 P1-SRCH-01 会话模型。无数据迁移。
