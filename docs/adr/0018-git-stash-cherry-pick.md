# ADR-0018 — Git Stash & Cherry-Pick 实现决策

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Wave 8 Git Enhancement)

## Context

Kairo IDE 的 Git 扩展在 Phase 2 中已具备基础的 commit/push/pull 功能，但缺少两个关键的高级 Git 操作：Stash（暂存工作区变更）和 Cherry-Pick（挑选提交）。这两个操作对于 Java 6 遗留项目开发者尤为重要——他们经常需要在多个分支间切换测试不同版本的修复，或从旧分支中挑选特定补丁。

前端测试覆盖率和 Git 操作的完整性是 Session 4 的核心目标之一。在 Wave 8 中，我们需要决定如何实现这两个功能。

## Decision

### 1. Git Stash 完整实现

在 `packages/git-extension/src/browser/` 下实现完整的 Git Stash 功能：

**核心服务** (`git-stash-service.ts`)：
- `listStashes()` — 列出所有 stash 条目
- `pushStash(message?, includeUntracked?)` — 暂存当前工作区变更
- `popStash(index?)` — 恢复并删除 stash
- `applyStash(index?)` — 恢复但不删除 stash
- `dropStash(index?)` — 删除 stash
- `showStash(index?)` — 查看 stash 内容 diff
- `clearStash()` — 清除所有 stash

**UI 组件** (`git-stash-widget.tsx`)：
- 完整 UI，支持搜索/过滤 stash 条目
- 显示 stash 消息、时间、分支信息
- 提供 pop/apply/drop 操作按钮

**测试覆盖**：
- `git-stash-widget.test.cjs`：UI 组件单元测试
- `git-logic.test.cjs`：Git 逻辑单元测试
- `git-exports.test.cjs`：导出完整性测试

### 2. Git Cherry-Pick 完整实现

**核心服务** (`git-cherrypick-service.ts`)：
- `cherryPick(commitHash)` — 单个提交挑选
- `batchCherryPick(commitHashes[])` — 批量挑选
- `continueCherryPick()` — 解决冲突后继续
- `abortCherryPick()` — 中止挑选操作
- `getCherryPickStatus()` — 获取当前挑选状态

**UI 集成**：
- `git-history-widget.tsx`：每个 commit 行添加 Cherry-Pick 按钮
- `git-status-bar-contribution.ts`：状态栏显示 Cherry-Pick 进行中状态

**测试覆盖**：
- 81/81 测试全部通过（Stash + Cherry-Pick + 导出测试）

### 3. 架构设计

```
packages/git-extension/src/browser/
├── git-service.ts              # 基础 Git 服务
├── git-stash-service.ts        # Stash 操作服务
├── git-stash-contribution.ts   # Stash 菜单贡献
├── git-stash-widget.tsx        # Stash UI 组件
├── git-cherrypick-service.ts   # Cherry-Pick 操作服务
├── git-history-widget.tsx      # Git 历史视图（含 Cherry-Pick 按钮）
├── git-status-bar-contribution.ts  # 状态栏（含 Cherry-Pick 状态）
├── git-store.ts                # Git 状态存储
└── git-precommit-check.ts      # Pre-commit 检查
```

## Alternatives Considered

### 替代方案 A：使用 Theia 内置 Git 扩展
Theia 内置的 `@theia/git` 扩展提供了基本的 Git 操作，但 Stash 和 Cherry-Pick 的 UI 支持不完善，且无法针对 Java 6 遗留项目的特殊工作流进行定制。自定义实现可以提供更好的用户体验和中文界面支持。

### 替代方案 B：仅提供命令行操作
在终端中执行 `git stash` / `git cherry-pick` 命令，不在 IDE 中提供 UI。此方案工作量为零，但不符合 Kairo IDE 的目标——为遗留项目开发者提供低于 Idea 但高于 VSCode 的体验。

### 替代方案 C：使用 Git Graph 扩展
引入第三方 Git Graph 扩展来提供可视化操作。此方案依赖外部维护，且可能引入不必要的功能复杂度。

## Consequences

### 正面影响
- Git 操作完整性从基础级别提升至高级级别
- Stash 功能支持多分支间的快速切换工作流
- Cherry-Pick 功能支持从旧分支中挑选特定补丁
- 81 个测试确保代码质量，全部通过
- UI 组件提供搜索/过滤功能，提升用户体验

### 负面影响
- 增加了 `packages/git-extension` 的代码量（约 1500+ 行）
- Cherry-Pick 冲突解决需要用户手动处理，UI 仅提供状态提示
- 批量 Cherry-Pick 的性能取决于提交数量和项目大小

### 后续工作
- 添加 Stash 的 diff 预览功能
- 添加 Cherry-Pick 的冲突可视化解决
- 添加 Stash 分支创建功能 (`git stash branch`)