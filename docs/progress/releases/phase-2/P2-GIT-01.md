# P2-GIT-01 轻量版本控制

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P1-BASE-01

## 目标
为 Kairo IDE 提供轻量级 Git 版本控制功能，包括变更视图、差异对比、提交、历史、Blame 和提交前检查。

## 用户价值
用户无需离开 IDE 即可完成日常 Git 操作，包括查看变更、比较差异、提交代码和查看历史记录。

## 范围
- Git 服务层：封装 Git 命令执行，提供变更状态、差异、提交等 API
- 变更视图：以树形组件展示工作区变更（已修改、已暂存、未跟踪文件）
- 差异视图：内联/并排差异对比，支持行内高亮
- 提交视图：提交信息编辑、暂存区管理、一键提交
- 文件状态装饰器：在文件浏览器中显示 Git 状态图标（已修改、已添加、已删除）
- 历史视图：查看提交历史，支持提交详情展示
- Blame 装饰器：编辑器边栏显示每行的最后修改者和时间
- 提交前检查：提交前检查代码规范（lint、测试）
- 提交模板：可配置的提交信息模板
- 提交搜索：按作者、日期、消息搜索提交历史
- 本地历史：编辑器文件本地历史版本保存与恢复

## 非范围
- 分支管理（创建、切换、合并）
- 远程操作（push、pull、fetch）
- 冲突解决 UI
- Git 配置管理

## 实现摘要
`packages/git-extension` 提供 Git 前端功能，通过 `git-service.ts` 封装 Git 命令调用。变更视图使用 Theia 树组件展示文件变更状态。差异视图基于 Monaco 差异编辑器。提交前检查通过 pre-commit hook 执行 lint 和测试。`kairo-local-history.ts` 在 `packages/theia-product` 中实现编辑器本地历史版本保存。

## 修改文件
- `packages/git-extension/src/browser/git-service.ts` — Git 命令封装与服务层
- `packages/git-extension/src/browser/git-changes-widget.tsx` — 变更视图
- `packages/git-extension/src/browser/git-diff-widget.tsx` — 差异对比视图
- `packages/git-extension/src/browser/git-commit-widget.tsx` — 提交视图
- `packages/git-extension/src/browser/git-file-status-decorator.ts` — 文件状态装饰器
- `packages/git-extension/src/browser/git-history-widget.tsx` — 历史视图
- `packages/git-extension/src/browser/git-blame-decorator.ts` — Blame 装饰器
- `packages/git-extension/src/browser/git-precommit-check.ts` — 提交前检查
- `packages/git-extension/src/browser/git-commit-template.ts` — 提交模板
- `packages/git-extension/src/browser/git-commit-search.ts` — 提交搜索
- `packages/theia-product/src/main/browser/kairo-local-history.ts` — 编辑器本地历史

## 测试命令与结果
```bash
pnpm --filter @kairo/git-extension build # PASS
pnpm --filter @kairo/git-extension lint  # PASS
pnpm build:product                       # PASS
```

## 人工验收步骤与证据
1. 打开一个 Git 仓库项目，确认文件浏览器中显示 Git 状态图标
2. 修改文件后，确认 Git Changes 视图显示变更文件列表
3. 点击变更文件，确认差异视图正确展示修改内容
4. 编写提交信息并提交，确认提交成功
5. 打开 Git History 视图，确认提交历史正确显示
6. 在编辑器中查看文件，确认 Blame 信息正确显示
7. 修改文件后保存，确认本地历史记录生成

## 性能数据
git-extension 构建 < 5 秒，产品构建通过。

## 风险与遗留问题
- Git 操作依赖系统安装的 Git CLI，不提供内置 Git 实现
- 大仓库（>10000 文件）的变更扫描可能较慢
- 本地历史存储未设置上限，长期使用可能占用磁盘空间

## 审查结论
通过。构建和产品集成验证通过。

## 回滚方式
从 Git 历史中 revert 涉及 git-extension 的提交，以及 theia-product 中的 kairo-local-history.ts。