# P1-SRCH-02A 全文 Search Center UI 基础（P1-SRCH-03 首切片）

- 状态：implemented
- 负责人/模型：Codex Search Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交
- 依赖任务：P1-SRCH-01、现有 `KairoSearchSessionModel`

## 目标

交付一个真实可打开和操作的底部全文 Search Center，用现有 Kairo 搜索会话模型展示完整查询状态、过滤条件和按文件分组的结果，并支持纯键盘选择及打开源码位置。本任务是 P1-SRCH-03 全文搜索 UI 的首个切片，不代表 P1-SRCH-02 Search Everywhere 已完成。

## 用户价值

- 全文搜索结果不再挤在狭窄侧栏，而是在底部工具窗口获得足够横向预览空间。
- 用户可以看到 loading、empty、error、cancelled 和结果计数，不再面对无反馈空白。
- 结果按文件分组；方向键移动，Enter 打开并定位到具体行列。
- 可直接设置大小写、全词、正则及 include/exclude glob。

## 范围

- 新增 React `SearchCenterWidget` 和可独立测试的 `SearchCenterComponent`。
- 注册 Theia WidgetFactory、底部 ViewContribution、命令 `kairo.search.center.toggle`。
- 提供命令面板入口 `Kairo Search Center`；不重复注册 Theia 已占用的 `Ctrl/Cmd+Shift+F`。
- 接入 `KairoSearchSessionModel`，支持搜索、取消和完整终态。
- 使用 `WorkspaceContextService` 获得 workspaceId/root，使用 Theia `EditorManager` 打开结果。
- 打开结果前拒绝绝对路径、URI scheme、盘符和 `..` 越界路径，并校验解析结果属于工作区。
- loading 期间允许提交新查询，由会话模型取消旧请求并防止结果倒灌。
- 按文件分组、结果计数、截断提示和匹配高亮。
- ArrowUp/ArrowDown 循环选择，Enter 打开选中结果。
- 新增轻量 CSS，使用 Theia 主题变量，不引入 UI 框架或运行时依赖。

## 非范围

- Search Everywhere 的 Files、Types、Symbols、Actions 混合检索。
- 双击 Shift、最近使用和模糊路径权重；这些仍属于未完成的 P1-SRCH-02。
- 结果虚拟滚动、目录分组切换、搜索历史和固定查询。
- 替换计划、逐条勾选、事务应用及撤销。
- 流式首批结果和继续加载；当前协议仍为单次响应。

## 实现摘要

组件与 Theia 外壳解耦：React 组件通过 props 接收状态与动作，Widget 负责连接会话模型、工作区上下文和编辑器。搜索仍只由 `KairoSearchSessionModel` 管理并发、取消和错误，视图没有复制请求状态机。结果先按原响应顺序建立文件组，同时保留扁平索引用于键盘导航。

## 修改文件

- `packages/search-extension/src/browser/search-center-widget.tsx`
- `packages/search-extension/src/browser/search-center-contribution.ts`
- `packages/search-extension/src/browser/search-center.css`
- `packages/search-extension/src/browser/style-types.ts`
- `packages/search-extension/src/browser/search-center-widget.test.cjs`
- `packages/search-extension/src/browser/index.ts`
- `packages/search-extension/package.json`
- `packages/search-extension/tsconfig.json`
- `docs/progress/releases/phase-1/P1-SRCH-02.md`

## 接口/数据结构变化

新增公开前端类型和入口：

- `SearchCenterWidget`
- `SearchCenterContribution`
- `SearchCenterComponent`
- `SearchCenterQuery`
- `SearchCenterProps`
- `SearchResultGroup`
- `groupMatchesByFile()`
- `parseGlobInput()`
- `resolveWorkspaceMatchUri()`

协议无变化。

## 测试命令与结果

所有命令必须通过 `node scripts/run-with-timeout.cjs <秒数> ...` 执行：

- `pnpm --filter @kairo/search-extension build`
- `pnpm --filter @kairo/search-extension lint`
- `pnpm --filter @kairo/search-extension test`
- `pnpm --filter @kairo/theia-product build`
- `pnpm --filter @kairo/browser build`
- `pnpm exec eslint 'packages/search-extension/src/**/*.{ts,tsx}' --max-warnings 0`

结果：全部通过。搜索扩展测试 21/21 通过，其中 Search Center 新增 7 项组件/工具测试；Theia Product TypeScript 组合构建通过；Browser production build 前端和 Node 端均为 0 errors；目标目录 ESLint 为 0 warnings、0 errors。组件测试覆盖状态、取消、分组、计数、键盘打开、过滤条件、loading 中新查询和不可信路径拒绝。

## 人工验收步骤与证据

1. 启动 Browser 产品并打开工作区。
2. 从命令面板执行 `Kairo Search Center`，确认工具窗出现在底部而非左侧窄栏。
3. 输入查询并切换 Case/Word/Regex、include/exclude，确认 loading 后出现文件分组与总数。
4. 输入不存在内容，确认显示 No matches；搜索中取消，确认显示 Search cancelled。
5. 停止 Runtime Agent 后查询，确认显示明确错误。
6. 聚焦结果区，以上下方向键切换高亮，按 Enter，确认编辑器定位到对应文件、行、列。

自动化组件证据位于 `search-center-widget.test.cjs`。真实浏览器截图和真实项目性能留待集成验收。

## 性能数据

- 结果分组为 O(n) 单次遍历。
- 状态更新未复制匹配正文；React 仅在会话状态变化时重绘。
- 首个切片尚未虚拟化，结果数量大的场景依赖后端 `maxResults`；虚拟滚动是下一 UI 性能任务。

## 风险与遗留问题

- 当前一次性 SearchResponse 无法达到流式首屏目标。
- 未虚拟化前，大结果集可能造成 DOM 和布局压力，应在 10k 文件性能验收前补齐。
- `Ctrl/Cmd+Shift+F` 仍由 Theia 原生全文搜索占用；本切片主动不重复绑定。后续集成任务需决定移除原生入口或将该快捷键确定性路由到 Kairo Search Center。
- 打开结果以第一工作区上下文为准；多根工作区需要协议返回 root 标识后扩展。
- 后端取消及时性、根目录错误传播仍由 P1-SRCH-01 后端后续切片处理。

## 审查结论

代码与组件测试完成后进入独立审查；只有真实 Browser 集成及人工验收通过后升级为 `verified`。

## 回滚方式

移除 Search Center 的 Widget、Contribution、样式和测试；从 `browser/index.ts` 删除 WidgetFactory/ViewContribution 绑定；保留 P1-SRCH-01 的会话模型，不涉及协议或数据迁移。
