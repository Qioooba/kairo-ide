# P1-SRCH-03B 全局替换安全预览切片

- 状态：implemented
- 负责人/模型：Codex Search Agent
- 完成时间：2026-07-23
- 依赖：P1-SRCH-01、P1-SRCH-02A

## 目标与实现

在 Search Center 结果下提供 Replace Preview。默认只生成逐文件计划，不写磁盘；用户可逐文件或逐匹配勾选后应用。计划记录原内容指纹、etag、mtime、编码和预览。应用分成全量预检与写入两阶段：任一目标漂移则零写；写入阶段失败则对已写文件按反向顺序执行补偿回滚并明确报告回滚成败。成功事务提供一次条件式 Undo，只有所有 post-image 仍完全匹配时才恢复 originals。

安全边界：

- 复用工作区安全路径解析，拒绝绝对路径、scheme、盘符和 `..`。
- `acceptTextOnly` 拒绝二进制，并额外拒绝 NUL。
- 单文件限制 5 MiB。
- 命中位置必须仍与 matchText 一致；拒绝重叠编辑。
- 保留原编码写入，使用最新 mtime/etag 触发 FileService dirty-write 防护。
- 每文件返回 applied/failed/skipped，不把部分失败伪装成全局成功。
- UI 在 Apply/Undo 期间锁定按钮，防止重复提交；提供一次 Undo。

## 测试与验证

全部命令通过 `scripts/run-with-timeout.cjs`，单步 ≤300 秒：

- search-extension build/lint/test：37/37 通过。
- 目标 ESLint。
- theia-product 组合构建。
- 单测覆盖多匹配选择、Unicode rune 列、内容漂移、重叠命中、全量预检失败零写、写失败反向回滚、write 已落盘后抛错的重读确认、Undo 成功、Undo 漂移拒绝和 Undo 失败反向补偿。

## 风险与未覆盖边界

- 这是补偿式事务，不是强原子事务。FileService 没有跨文件事务，进程在写入和补偿回滚之间崩溃仍可能留下部分修改。
- 补偿回滚也可能因外部漂移或文件锁失败，此时以 `rollback-failed` 明确报告，禁止宣称整体成功。
- write 抛错后会立即重读：确认 applied post-image 时纳入回滚；无法确认时以 `rollback-unknown` 报告。Undo 中途失败会把已恢复项反向补偿回 applied post-image，并报告 `undo-rolled-back` / `undo-rollback-failed`。
- 当前未实现临时文件 + rename 的物理原子替换，依赖 FileService provider 的单文件写入与 etag/mtime dirty-write 语义。
- 预览 UI 为轻量 before/after 行级展示，不是完整编辑器 unified diff。
- 尚缺真实 GBK、远程文件系统、Windows 文件锁和进程崩溃注入 E2E。
- 当前计划在内存中保留原文件内容，虽有 5 MiB 单文件上限，后续仍应增加全计划总量上限。

## 回滚

移除 `search-replace-service.ts`、测试、Search Center Replace Preview 区和 DI 绑定。无数据迁移。
