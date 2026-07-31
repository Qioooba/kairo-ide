# Kairo IDE 全局 UI/UX 改造计划

> 基于 `docs/screenshots/current-ui/` 约 20 张截图与代码审查制定。
> 目标：统一视觉语言、修复中英文混杂、提升空状态与状态栏可读性、让 Kairo 自有面板与 Theia 核心风格一致。

---

## 1. 问题摘要

| 区域 | 当前问题 | 根因/关键文件 |
|------|---------|--------------|
| 命令面板 / 状态栏 | UI 语言为中文时，命令面板与状态栏仍显示英文 | `packages/theia-product/src/main/browser/kairo-views-contribution.tsx` 中 `KairoCommands` 与菜单注册使用硬编码英文 label |
| 欢迎页 / 导入向导 | 小尺寸浅色卡片悬浮在深色背景中，视觉层级弱 | `kairo-welcome-widget.tsx` + `kairo-theme.css` 中 `.kairo-welcome-body` 样式 |
| 运行配置 | 主按钮为紫色 Theia 默认色；错误横幅刺眼；空状态简陋 | `kairo-run-configurations-widget.tsx` 使用 `.theia-button.main`，CSS 未覆盖 |
| 侧边栏 widgets | 工具栏按钮颜色不一致；空状态图标小、文字灰；间距拥挤 | `server-view-widget.tsx`、`build-view-widget.tsx`、`kairo-views-contribution.tsx`（Deployments）、`maven-view-widget.tsx` 等共用 `.kairo-widget-toolbar` 但 CSS 覆盖不足 |
| 状态栏 | 8+ 项挤在一起，占位状态（JDK: -、Build: 无记录）与真实状态视觉权重相同 | `kairo-status-bar-contribution.ts` 条目过多，分组与占位样式不足 |
| 调试视图 | Theia 原生与 Kairo 自定义样式混杂，调试工具栏偏小 | `debug-toolbar-idea.tsx`、`debug-tool-window-widget.tsx`、`debug-*.tsx` 系列 |

---

## 2. 设计原则

1. **一套 Token**：所有 Kairo 面板只使用 `packages/ui-kit/src/browser/kairo-theme.css` 与 `packages/ui-kit/src/tokens.ts` 中定义的颜色、间距、圆角。
2. **语言一致性**：所有用户可见字符串（命令、菜单、面板标题、空状态、状态栏）必须走 `KairoI18nService`，`zh-CN.ts` / `en.ts` 为唯一文案来源。
3. **状态分层**：真实/活动状态使用高对比品牌色；占位/未知/未就绪状态使用 `fgMuted` 并降低视觉权重。
4. **空状态统一**：所有空状态使用大号品牌图标、清晰标题、说明文案、单一主操作按钮。
5. **密度适中**：侧边栏工具栏按钮使用 8px 圆角、28–32px 高度、6px 间距；列表项 32px 行高。

---

## 3. 具体改动

### 3.1 语言一致性：命令与菜单

**目标**：命令面板、状态栏命令提示、Kairo 顶层菜单、File 菜单中的 Kairo 条目在 zh-CN 下全部显示中文。

**文件**：
- `packages/theia-product/src/main/browser/kairo-views-contribution.tsx`

**改动**：
1. 将 `KairoCommands` 命名空间中的命令常量改为只保留 `id` 与可选 `category`，移除硬编码 `label`。
2. 新增私有方法 `getCommandLabel(key: keyof KairoI18nMessages['command'])` 从 i18n 取文案。
3. 在 `registerCommands` 中注册命令时，通过 `registry.registerCommand({ id, label: this.getCommandLabel(...) })` 传入翻译后的 label。
4. 在 `registerMenus` 中，所有 `label: '...'` 替换为 `label: this.i18n.t('menu...')` 或复用 `command.*` 键。
5. 补充缺失的 i18n 键：
   - `command.openIdeaDebugToolWindow`
   - `command.debugRestart`、`command.debugDropFrame`、`command.debugMuteBreakpoints`、`command.debugEvaluateExpression`、`command.debugConsoleFocus`
   - `command.updateApplication`、`command.reloadContext`
   并在 `zh-CN.ts` / `en.ts` 中补充对应中文/英文。

**验收**：切换语言后，命令面板（Cmd/Ctrl+Shift+P）中所有 `Kairo:` / `Debug:` / `Help:` 条目随语言变化；Kairo 顶层菜单与 File 菜单条目同步变化。

---

### 3.2 欢迎页与导入向导

**目标**：欢迎页占满主区域、层级清晰、操作按钮突出；导入向导步骤指示器更醒目。

**文件**：
- `packages/theia-product/src/main/browser/kairo-welcome-widget.tsx`
- `packages/ui-kit/src/browser/kairo-theme.css`

**CSS 改动**：
1. `.kairo-welcome-body`：
   - `min-height: 100%` → `height: 100%`
   - 背景使用 `var(--kairo-bg)`，去除“卡片”感
   - 增加 `padding: 40px 48px`
   - 标题 `kairo-welcome-title`：字号 `28px`、字重 `700`、品牌蓝 `var(--kairo-primary-light)`
   - 副标题 `kairo-welcome-tagline`：字号 `15px`、颜色 `var(--kairo-text-secondary)`、`margin-bottom: 32px`
2. `.kairo-welcome-actions`：
   - 改为水平按钮组（`flex-direction: row; gap: 12px`）
   - 主按钮使用 `.kairo-button-primary` 样式（见 3.6）
3. `.kairo-welcome-recent`：
   - 最近项目卡片使用 `var(--kairo-surface)` 背景、`border-radius: 8px`、内边距 `16px`
   - 路径使用 `fgMuted`， hover 行高亮
4. `.kairo-quickstart-steps`：
   - 步骤项改为横向或卡片网格（`display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px`）
   - 图标使用 `40px` 圆形品牌背景
5. `.kairo-wizard-steps`（导入向导）：
   - 步骤数字 `28px` → `32px`
   - active 步骤数字背景使用品牌蓝
   - 步骤连线加粗至 `2px`

**验收**：重新截图 `01-welcome.png`、`02-new-project-dialog.png`，视觉上不再出现“小卡片浮在深色空洞中”。

---

### 3.3 运行配置面板

**目标**：主按钮使用 Kairo 品牌蓝；错误与验证信息更柔和；空状态与摘要卡片更现代。

**文件**：
- `packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx`
- `packages/ui-kit/src/browser/kairo-theme.css`

**改动**：
1. 工具栏与空状态 CTA 的 `.theia-button.main` 替换为 Kairo 主按钮类（或覆盖 CSS 使 `.kairo-widget .theia-button.main` 使用品牌蓝）。
2. `.kairo-error-banner`：
   - 背景改为 `color-mix(in srgb, var(--kairo-error) 8%, transparent)`
   - 文字颜色保持 `var(--kairo-error)`
   - 左侧加 `3px` 实线装饰条
   - 按钮使用 secondary 样式，移除 main
3. `.kairo-runconfig-summary`：
   - 改为卡片式：`background: var(--kairo-surface); border-radius: 8px; padding: 12px 16px`
   - 标签使用 `fgSecondary`，值使用 `fgPrimary`
   - mode badge 使用对应语义色（run = info，debug = warning）
4. `.kairo-runconfig-list-item`：
   - 增加 hover 背景、圆角、内边距
   - 操作按钮统一为 icon + text 的 toolbar 按钮
5. `.kairo-runconfig-launch-progress`：
   - 使用步骤条样式，当前步骤高亮，已完成步骤打勾

**验收**：截图 `04-run-configurations.png`、`05-run-configurations.png` 无紫色按钮，空状态与摘要卡片风格统一。

---

### 3.4 侧边栏 Widgets（Servers / Builds / Deployments / Maven / Perf / Tests）

**目标**：工具栏按钮颜色统一；空状态更突出；列表与信息区域间距舒适。

**文件**：
- `packages/tomcat-extension/src/browser/server-view-widget.tsx`
- `packages/build-extension/src/browser/build-view-widget.tsx`
- `packages/theia-product/src/main/browser/kairo-views-contribution.tsx`（Deployments）
- `packages/theia-product/src/main/browser/maven-view-widget.tsx`
- `packages/theia-product/src/main/browser/kairo-perf-dashboard-widget.tsx`
- `packages/theia-product/src/main/browser/kairo-test-results-widget.tsx`
- `packages/ui-kit/src/browser/kairo-theme.css`

**CSS 改动**：
1. 统一工具栏按钮：
   ```css
   .kairo-widget-toolbar .theia-button.main {
       background: var(--kairo-primary);
       border-color: var(--kairo-primary);
       color: #fff;
   }
   .kairo-widget-toolbar .theia-button.main:hover:not(:disabled) {
       background: var(--kairo-primary-hover);
   }
   .kairo-widget-toolbar .theia-button.secondary {
       background: transparent;
       border: 1px solid var(--kairo-border);
       color: var(--kairo-text);
   }
   .kairo-widget-toolbar .theia-button.toolbar {
       background: transparent;
       border: none;
       color: var(--kairo-text-secondary);
   }
   .kairo-widget-toolbar .theia-button.toolbar:hover:not(:disabled) {
       background: var(--kairo-hover-overlay);
       color: var(--kairo-text);
   }
   ```
2. 危险按钮统一：
   ```css
   .kairo-widget .theia-button.danger {
       background: var(--kairo-error);
       border-color: var(--kairo-error);
       color: #fff;
   }
   ```
3. 统一空状态：
   ```css
   .kairo-empty-state {
       flex: 1;
       display: flex;
       flex-direction: column;
       align-items: center;
       justify-content: center;
       text-align: center;
       padding: 32px 24px;
       gap: 12px;
   }
   .kairo-empty-state-glyph {
       font-size: 48px;
       color: var(--kairo-primary-light);
       opacity: 0.6;
   }
   .kairo-empty-state-title {
       font-size: 15px;
       font-weight: 600;
       color: var(--kairo-text);
       margin: 0;
   }
   .kairo-empty-state-reason {
       font-size: 13px;
       color: var(--kairo-text-secondary);
       max-width: 280px;
       margin: 0;
   }
   ```
4. Widget header 状态徽章：
   - `.kairo-server-state`、`.kairo-build-state`、`.kairo-deployment-state` 增加 `padding: 2px 8px`、`border-radius: 12px`、字号 `12px`
   - 各状态使用语义背景色（success/warning/error/info）
5. 列表项：
   - `.kairo-server-list`、`.kairo-build-list` 等行高 `32px`
   - hover 背景 `var(--kairo-hover-overlay)`
   - 圆角 `4px`

**TSX 微调**（同一组 widgets）：
- Server/Build/Deployments 空状态按钮统一使用主按钮样式。
- ServerView 的 Hot Reload 区域按钮统一。
- BuildView 的 diagnostics 列表增加 severity 颜色区分。

**验收**：截图 `02-servers.png`、`03-builds.png`、`04-deployments.png`、`15-maven-view.png`、`17-performance-dashboard.png`、`20-test-results.png` 工具栏无紫色按钮，空状态风格一致。

---

### 3.5 状态栏

**目标**：减少视觉拥挤；占位状态低对比；逻辑分组清晰。

**文件**：
- `packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts`
- `packages/ui-kit/src/browser/kairo-theme.css`

**改动**：
1. 将 8 个条目按逻辑分组，组间增加 `margin-left: 8px`：
   - 项目 / JDK / 编码
   - 构建 / 服务器
   - 调试 / 代理
   - 热重载
2. 占位状态统一使用 `kairo-statusbar-placeholder` 类并强化样式：
   ```css
   #theia-statusBar .element.kairo-statusbar-placeholder {
       color: var(--kairo-text-secondary);
       opacity: 0.7;
   }
   ```
3. 移除或合并低频条目：
   - 当无项目时，隐藏 `kairo.hotReload`（无意义）。
   - 调试状态在无会话时显示“调试：无”占位样式。
4. 所有状态条目文本使用 i18n 键，避免英文残留。

**验收**：截图 `12-status-bar.png` 显示分组间隔，占位状态（无项目、无 JDK、无构建）明显变淡。

---

### 3.6 调试视图

**目标**：调试工具栏尺寸与主工具栏一致；调试面板统一使用 Kairo 配色。

**文件**：
- `packages/theia-product/src/main/browser/debug-toolbar-idea.tsx`
- `packages/theia-product/src/main/browser/debug-tool-window-widget.tsx`
- `packages/theia-product/src/main/browser/debug-*.tsx` 系列
- `packages/ui-kit/src/browser/kairo-theme.css`

**改动**：
1. `.kairo-debug-toolbar` / `.theia-debug-toolbar`：
   - 按钮高度 `28px`
   - 主操作（继续、步过等）使用品牌蓝或语义色
   - 禁用状态使用 `disabled-fg`
2. `.kairo-debug-tool-window`：
   - 标签页使用 Kairo 标签样式
   - 空状态使用统一 `.kairo-empty-state`
3. 变量/调用栈/断点列表：
   - 行高 `28px`
   - hover 背景 `var(--kairo-hover-overlay)`
   - 选中背景 `var(--kairo-bg-active)`

**验收**：截图 `07-debug-view.png`、`10-debug-tool-window.png` 调试工具栏与主工具栏风格一致。

---

### 3.7 CSS Token 与全局工具类补充

**文件**：
- `packages/ui-kit/src/browser/kairo-theme.css`
- `packages/ui-kit/src/tokens.ts`

**补充**：
1. 新增按钮工具类：
   ```css
   .kairo-button-primary { ... }
   .kairo-button-secondary { ... }
   .kairo-button-danger { ... }
   .kairo-button-ghost { ... }
   ```
2. 新增卡片工具类：
   ```css
   .kairo-card { background: var(--kairo-surface); border-radius: 8px; padding: 16px; }
   ```
3. 在 `tokens.ts` 中补充 `button` 尺寸常量（可选，供 TypeScript 引用）。

---

## 4. 实施顺序

建议按以下顺序分阶段提交，便于回滚与截图对比：

1. **Phase A：语言一致性**（仅 TSX/i18n，无视觉变化）
   - 改动 `kairo-views-contribution.tsx`
   - 补充 `en.ts`、`zh-CN.ts` 缺失键
2. **Phase B：CSS 基础设施 + 按钮/空状态统一**
   - 改动 `kairo-theme.css`
3. **Phase C：欢迎页 + 导入向导**
   - 改动 `kairo-welcome-widget.tsx` + CSS
4. **Phase D：运行配置**
   - 改动 `kairo-run-configurations-widget.tsx` + CSS
5. **Phase E：侧边栏 widgets**
   - 改动 `server-view-widget.tsx`、`build-view-widget.tsx`、Deployments、Maven、Perf、Tests
6. **Phase F：状态栏**
   - 改动 `kairo-status-bar-contribution.ts` + CSS
7. **Phase G：调试视图**
   - 改动 debug 系列 + CSS

---

## 5. 验证计划

1. **构建**：`pnpm build`（browser 与 desktop 均通过）。
2. **类型检查**：`pnpm typecheck` 无新增错误。
3. **Lint**：`pnpm lint` 通过。
4. **截图**：使用 `docs/screenshots/capture-current-ui.cjs` 重新捕获当前 UI，保存到 `docs/screenshots/ui-optimization-after-sessionN/`。
5. **语言验证**：运行 `docs/screenshots/verify-kairo-language.cjs` 与 `verify-language-switch.cjs`。
6. **关键 e2e**：
   - `tests/e2e/regression/shard-01-shell.spec.ts`
   - `tests/e2e/regression/shard-05-build.spec.ts`
   - `tests/e2e/regression/shard-12-views.spec.ts`
7. **无障碍**：`scripts/test/run-a11y-scan.cjs` 无新增严重问题。

---

## 6. 风险与回滚

- **风险**：覆盖 `.theia-button.main` 可能影响 Theia 原生面板。 mitigation：所有覆盖限定在 `.kairo-widget` 或 `.kairo-*` 作用域内。
- **风险**：命令 label 改为动态后，快捷键绑定与菜单仍引用 `KairoCommands.XXX.id`，不受影响。
- **回滚**：每个 Phase 独立提交，可单独 revert。
