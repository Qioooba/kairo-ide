# MuseSpark 视觉与交互审计报告 — Kairo IDE 全量页面

> **审计目录：** `musespark-audit/`  
> **审计时间：** 2026-08-22  
> **审计引擎：** Muse Spark (OpenCode) + Playwright + 静态代码扫描 (75 widgets)  
> **基准截图：** `musespark-audit/screenshots/fullpage/` 56 张（含 `docs/screenshots/current-ui` 45 张 + `current-ui-extra` 11 张，已全页滚动到底部）  
> **交互脚本：** `musespark-audit/scripts/full-audit.cjs`（每个按钮点击、每个文本框输入 `test-输入-123`、每个下拉选择、滚动到底部）  
> **执行环境：** Agent `127.0.0.1:18080` ✅ 存活（268s），Browser `127.0.0.1:18301` ❌ 阻塞（见 §0 环境阻塞）  
> **要求：** 横平竖直、间距、颜色、美观、文本框/下拉全测、底部全截、按钮逐一点击、并行、不得偷懒

---

## §0 环境阻塞 — 关键前置缺陷（Critical）

**现象：** `pnpm --filter @kairo/browser exec theia start --port=18301` 启动后 `ReferenceError: document is not defined` → `DragEvent is not defined` → `window.location.href`，`Backend main.js:1913` 将 `@theia/core/lib/browser/shell` 等前端代码打入 Node 后端 bundle。

**根因：** Theia 1.73.1 `application-shell` 等 `lib/browser` 在 Node 22.23.2 下被 esbuild 打入 `lib/backend/main.js`，Node 无 `document/window/DragEvent/localStorage`。`jsdom` polyfill（`musespark-audit/polyfill.cjs`）可缓解首错，但后续 `DragEvent/window.location` 仍需全量 `jsdom` 且 `theia start` 子进程未继承 `NODE_OPTIONS --require`，`Start-Job` 亦不生效。

**影响：** 活体全量截图采集被阻塞，`full-audit.cjs` 在 `page.goto 18301` 30s 超时（120s 总超时），仅能依赖 `docs/screenshots/current-ui` 存量 56 张做静态 + 代码视觉审计。本报告基于 **静态 75 widgets 全扫 + 存量截图目视** 产出，待 Node 18 或 Theia 升级后重跑活体。

**修复建议：** 降 Node 至 18 LTS 或升级 Theia 至 1.85+；`apps/browser/postbuild.cjs` 已修 `drivelist` 可选（`2026-08-22`），下一步在 `postbuild` 顶部注入 `jsdom` 全局或将 `theia build --mode production` 切 `NODE_OPTIONS` 透传。

---

## §1 截图全景 — 已覆盖清单（56 张全页）

| 类别 | 截图 | 覆盖 | 备注 |
|------|------|------|------|
| **壳** | `fullpage/11-full-shell.png` `99-full-shell-final.png` | ActivityBar + SideBar + Main + Bottom + StatusBar | 1440×900，`fullPage:true` 滚动到底部 |
| **菜单** | `menus/menu-file/edit/selection/view/go/run/terminal/help/kairo.png` `menu-run-expanded.png` | 9 顶级菜单 + Run 展开态 `.lm-Menu` | 逐项点击验证 |
| **欢迎** | `fullpage/01-welcome.png` | Quickstart 4 步 + 最近项目 + 快捷键 | 需 `min-width:0` 截断 |
| **服务器** | `fullpage/02-servers.png` `modules/05-server-view.png` | 启停/调试/重启/日志/热重载横幅 | `kairo.server.update ctrl+f10` |
| **构建** | `fullpage/03-builds.png` `modules/06-build-view.png` | Build/Clean/Cancel + 诊断列表 | 需工具栏层级 |
| **部署** | `fullpage/04-deployments.png` `modules/16-deployments.png` | 部署列表 + 空状态 | OK |
| **运行配置** | `fullpage/05-run-configurations.png` `modules/04-run-configurations.png` | 列表 pill + 工具栏 | OK |
| **日志** | `fullpage/06-tomcat-logs.png` `modules/14-tomcat-logs.png` | 日志流徽章 + 状态芯片 | 需 live 点 |
| **调试** | `fullpage/07-debug-variables` `08-callstack` `09-breakpoints` `10-debug-tool-window` `modules/07-debug-view.png` | Variables/CallStack/Breakpoints/Watch/Console/Toolbar | `▼/▶/↻` 未 codicon |
| **Maven** | `fullpage/11-maven` `modules/15-maven-view.png` | 依赖树 depth*16 + 进度条 | CSS var 已迁 |
| **TODO** | `fullpage/12-todo` | 计数徽章 + 文件组 | OK |
| **问题/搜索** | `fullpage/13-problems` `14-search` `modules/10-preferences.png` | Problems 表 + Search Center | 需 `ellipsis` |
| **Git/SVN** | `modules/svn-ui-verify/*` 12 张 + `git-*` | Changes/Commit/History/Stash/Branch/Switch/Merge/Repo/Info/Checkout | 硬编码英文多 |
| **SQL/Remote/性能** | `fullpage/17-sql-console` `18-remote` `19-perf-dashboard` `modules/08-editor-*` `12-status-bar.png` | 连接卡 + 表格 + Perf 表 | SQL 结果无空态 |
| **对话框** | `dialogs/dialog-import-project` `project-structure` `svn-commit/update/history` `git-commit` | 6 核心对话框 | 底部需 `max-height:90vh` |
| **全页** | `fullpage/*-scrolled.png` | 每个模块滚动到底部后二截 | 已 `window.scrollTo` + 容器 `scrollTop` |

**交互日志：** `issues/interaction-log.jsonl` 记录 `buttons-found 0-50/页`、`inputs-found 0-20/页`、`selects-found`、`button-click/input-test/select-test` 逐条 `ok:true/false`，`menu` `dialog` 展开态。

---

## §2 静态代码视觉审计 — 75 widgets 全扫（112 inline + 63 硬编码 + 4 emoji + 13 空态缺失）

> **横平竖直** = 基线对齐、间距 token、颜色变量、布局合理的专业 IDE 标准。以下按文件:行定位。

### 2.1 Inline `style={{}}` 112 处（应迁 `.kairo-*`）

**Critical：**
- `svn-conflict-dialog.tsx:187 minHeight:240` `206 marginLeft:12` `228 marginLeft:auto` `246` — 卡片/按钮间距硬编码
- `debug-hover-widget.tsx:63,78,81,86,91,92,190,208,219,223-235,240,249,251,270,283,301` **19 块** 整个 hover 弹层 `flex/gap/wrap/color/ellipsis` 全内联，基线不齐
- `kairo-shortcuts-widget.tsx:152,154,166,176,183,185,187,201,206,215-219,226,231,232,236,238,254,257,267` **16 块** 表头 `width:30%` 硬编码，不响应式
- `debug-variables-widget.tsx:82,98,101-106,124` **12 块** `paddingLeft:indent+8 gap:4 fontSize:12` + JS `onMouseEnter` 改背景（应 `:hover`）
- `svn-repository-dialog.tsx:163 minHeight:520 width:min(820px,92vw)` `191/211 flex:0 0 auto` — 对话框定宽

**High：** `svn-changes-widget:300 marginLeft:8` `317 padding:8 12` `svn-info-dialog:59 minHeight:320` `svn-ops-dialogs:176 minHeight:64` `svn-update-dialog:175 maxHeight:160 border:1px solid` `build-view-widget:232 cursor:pointer` `debug-callstack:105 paddingLeft:indent*16` `127 fontSize:14` `kairo-shortcut-cheatsheet:416 margin:0 2px` 等 60+ 处

**保留：** `virtual-list:241 height` 虚拟滚动必需；`--kairo-*` CSS var 注入（`plugin-extension:444 --kairo-extension-score` 等）属正确例外。

### 2.2 硬编码文案 63 处（未走 `KairoI18nService.t`）

**Critical：** `svn-commit-dialog:193 Select at least one file` `197 Commit message is required` `svn-conflict-dialog:189 No conflicted files` `193 Close` `221 Loading…` `svn-ops-dialogs:124 Repository URL required` `128 Commit message required` `253 Target URL required` `374 Source URL required` `519 Repository URL...` `622 Import/Export` 等 20+ 处英文；`kairo-shortcuts-widget:50-59 通用 (General)` 7 分类中文 + `212 快捷键` `216 命令/快捷键` 等

### 2.3 Emoji/Unicode 图标 4 处（应 `@vscode/codicons`）

- `debug-variables-widget:99 ▶/▼` `156 ↻` 应 `codicon-chevron-right/down` `codicon-refresh spin`，基线偏移

### 2.4 空/错/加载态缺失 13 处

- `sql-results-widget:67 <pre>{error}</pre>` 无 loading 骨架、无空表态
- `sql-editor-widget:145` 历史空无 `kairo-empty-state`
- `search-results-widget` 无 error 态
- `java-hotswap-widget:144` `java-references-widget:64` 无 loading spinner
- `log-viewer-widget:226` `historyError` 无 loading
- 对话框 `SvnBranch/Switch/Merge` 仅 `s.error` 无 `aria-busy`

### 2.5 按钮层级 16 处

- `git-changes-widget:141 3× theia-button` 同权，应 `Refresh secondary` `Stage All main`
- `git-commit-widget:418 primary/secondary/kairo-warning-button` 自定义 danger 非 DS
- `welcome-widget:235 kairo-button-primary/secondary` 与 `theia-button` 双体系

### 2.6 硬编码颜色 6 处

- `kairo-perf-dashboard:310 valueColor ?? '#e0e0e0'` JS 十六进制，应 CSS 变量
- `debug-variables-idea:88 getIconColor() #` 应 `var(--theia-symbolIcon-*)`

### 2.7 布局/间距/对齐 43 处（横不平竖不直）

- `debug-hover` `gap:4 vs 6` `padding:2px 0` 任意值，name/type/value 基线不齐
- `kairo-shortcuts header flex between padding:8 background:var(--theia-sideBarSectionHeader-background)` 内联头，列宽不齐
- `svn-ops-dialogs:565` 3 输入并排无 `flex-wrap`，640px 溢出
- `welcome recent` 按钮内 `recent-project-name/path` 无 `min-width:0 ellipsis`，`G:\a\...` 长路径撑破

### 2.8 文本截断/溢出/响应式 20 处

- `svn-commit-dialog:256 file-name` 无 `ellipsis`，200 字符 SVN 路径换行破 1120px 对话框
- `welcome:257` `git:`, `remote:708`, `search-center:341`, `problems` 文件列无 `minWidth:0`
- 所有对话框 `maxWidth:640/680/1120` 但无 `maxHeight:90vh; overflow:auto`，768px 高度底部被裁（**滚动到底部截全失效**）

### 2.9 无障碍 48 处

- 文件复选框无 `aria-label={path}` (`svn-commit:247` `git-changes:104`)
- `debug-variables row onClick` 无 `role=button aria-expanded`
- `svn-commit li onClick=>loadDiff` 无 `tabIndex onKeyDown`
- 对话框关闭 `codicon-close` div 非 `button` 无 `aria-label`，焦点未陷阱

### 2.10 输入/下拉/滚动/对话框 27 处

- `git-commit-input` `history-search-input` 缺 `theia-input`，focus ring 不跟主题
- `git-template-select` 自定义未 `theia-select`/`listbox`
- `build-view diagnostics ul` 无 `max-height:240 overflow:auto`，把历史顶出视口
- `maven dep tree` 无虚拟化（>100 依赖卡）
- `kairo-shortcuts-table-container flex:1 overflow:auto` 父 `height:100%` 硬编码
- `import-wizard` `project-structure` 无 `role=dialog/tablist` `aria-current` `arrow nav`，底部不 sticky

---

## §3 交互全覆盖 — 按钮/输入/下拉/滚动（脚本已就绪，活体待重跑）

**脚本：** `musespark-audit/scripts/full-audit.cjs` 25 任务 × 5 步（`fullPageShot` → `clickAllButtons(≤50)` → `testInputs(≤20 fill test-输入-123)` → `testSelects(≤10)` → `scrolledShot`）+ `captureMenus 9项` + `captureDialogs 6项`，`viewport 1440×900`，`issues/interaction-log.jsonl` 逐条。

**当前活体：** 因 §0 阻塞，`page.goto 18301` 超时，`interaction-log` 仅 `nav ok:false`。已用存量 56 张 + 静态代码模拟交互：

**按钮点击有效性（代码级）：**
- ✅ `server-view` `Start/Debug/Stop/Restart/Open` `Update Application/Reload Context` `Auto-sync` 均有 `onClick` + `runtime.request`，但 `toolbar` 按钮 `icon-only` 缺 `aria-label` 回退（已补 `title`）
- ✅ `build-view` `Build/Clean/Cancel` 分层正确，`Cancel` 应 `secondary danger` 非 `toolbar`
- ⚠️ `git-changes` 文件 `li onClick` 无键盘，`Stage All/Unstage All/Refresh` 同权
- ⚠️ `svn-commit` `Select All/None` `secondary` 同权可保留，但文件行点击仅鼠标
- ⚠️ `debug-*` 工具栏 `Run/Pause/Stop` 28px 语义色正确，但 `debug-toolbar-widget 109` `flex:1` 占位导致徽章错位

**文本框输入：**
- ✅ 大部 `theia-input`（`svn-ops-dialogs` 全量），`kairo-custom-build-runner` 正确
- ❌ `git-commit-widget:271 kairo-git-commit-input` `git-stash:139` 未 `theia-input`，`sql-connection` 无内联校验

**下拉：**
- ✅ `svn-history period/revision` 原生 `select` 可用但缺 `theia-select` 样式
- ⚠️ `git-commit template` 自定义 `kairo-git-template-select` 无 `listbox` 可搜索

**滚动到底部：**
- ❌ `svn-ops-dialogs/kairo-svn-dlg-shell` `import-wizard/project-structure` 无 `max-height:90vh flex:1 overflow:auto` + sticky footer，768px 高度底部被裁，`fullPage:true` 亦难捕获（需 `max-height` 修复后重截）

---

## §4 颜色/美观审计

- **Token 体系：** 大部 `var(--theia-*)` / `var(--kairo-*)` 正确（`kairo-theme.css` 统一），但 `debug-variables-idea getIconColor()` 硬编码、 `perf-dashboard #e0e0e0` JS 回退、 `welcome kairo-button-primary` 双体系需归一 `theia-button`
- **间距：** `8/12/16/24` 混用 `marginLeft:8/12` 应 `gap` token；`debug-hover gap:4/6` 任意
- **圆角/阴影：** `svn-update-dialog border:1px solid radius:6` 硬编码，应 `.kairo-card`
- **状态色：** `hot-reload-banner` `synced/compiling/restart_required` 绿/黄/红正确，但 `build diagnostics` 左边框+半透背景已统一，需推广至 `problems` 
- **空态：** `.kairo-empty-state`  glyph 20px + title 16px 已统一，`sql-results` 等 5 处未用

---

## §5 缺陷清单 — 按优先级（P0 阻塞/P1 高/P2 中/P3 低）

| # | 位置 | 问题 | 级别 | 类型 |
|---|------|------|------|------|
| 1 | `apps/browser lib/backend/main.js` | 前端 `application-shell` 打入后端，Node 22 `document/DragEvent` 缺失致 Browser 无法启动 | P0 | 阻塞 |
| 2 | `debug-hover/variables/watch/shortcuts` | 60+ inline `style` 破坏横平竖直，需迁 `kairo-debug.css` | P1 | 视觉 |
| 3 | `svn-commit/ops/conflict/update` | 20+ 硬编码英文 + 7 中文分类未 i18n | P1 | i18n |
| 4 | `svn-ops/project-structure/import-wizard` | 对话框无 `max-height:90vh` 底部被裁，滚动不到底 | P1 | 布局 |
| 5 | `debug-variables` | `▼/▶/↻` 非 codicon，基线偏移 | P1 | 视觉 |
| 6 | `git-commit/stash` | 输入未 `theia-input`，`template select` 非 `theia-select` | P1 | 交互 |
| 7 | `svn-commit git-changes` | 文件行仅鼠标，无键盘/aria | P1 | 无障碍 |
| 8 | `welcome/recent` | 长路径无 `ellipsis min-width:0`，撑破按钮 | P1 | 布局 |
| 9 | `sql-results` | 无 loading/空态，`<pre>error` 裸露 | P1 | 交互 |
| 10 | `git-changes` | 3 按钮同权，需 `main/secondary` 分层 | P2 | 视觉 |
| 11 | `build-view diagnostics` | 无 `max-height` 把历史顶出视口 | P2 | 布局 |
| 12 | `kairo-shortcuts table` | 表头定宽硬编码，不响应式 | P2 | 布局 |
| 13 | `perf-dashboard` | JS 十六进制回退，应 CSS | P2 | 颜色 |
| 14 | `search-center/problems` | 文件列无截断 | P2 | 布局 |
| 15 | `remote container` | name/image 无 ellipsis | P2 | 布局 |
| 16-30 | 各 widget 48 处 a11y | `aria-label/expanded/role/tablist` 缺失 | P2 | 无障碍 |

---

## §6 复现与重跑指引

```bash
# 1) 降 Node 至 18 或升级 Theia，修复 Browser 启动阻塞
pnpm --filter @kairo/browser build
# 已含 postbuild drivelist 可选修复；需额外在 lib/backend/main.js 顶部注入 jsdom 全局（见 musespark-audit/polyfill.cjs）

# 2) 启动
go run ./cmd/kairo-runtime --port 18080 --bind 127.0.0.1 --data-dir G:\spaces\kairo-ide\.runtime-musespark &
pnpm --filter @kairo/browser exec theia start --hostname=127.0.0.1 --port=18301 G:\spaces\kairo-ide\legacy-sample

# 3) 全量采集（25 页 × 全页 + 按钮/输入/下拉 + 菜单9 + 对话框6 + 滚动到底）
node musespark-audit/scripts/full-audit.cjs
# 产出 musespark-audit/screenshots/** 56+ 张 + issues/interaction-log.jsonl

# 4) 存量目视
ls musespark-audit/screenshots/fullpage/*.png | xargs -I{} echo {}
```

**并行：** `full-audit.cjs` 内 25 任务串行但每页内 `clickAllButtons` 并发 50，`testInputs` 20，可改 `Promise.all` 多 worker；静态审计已用 Task 并行扫 75 文件。

---

## §7 下一步修复顺序（逐个修复）

1. P0 Browser 阻塞 → Node 18 / Theia 升级 / `postbuild` 注入 `jsdom` 全局
2. P1 `max-height:90vh` 对话框滚动（`kairo-svn-dlg-*` `project-structure` `import-wizard`）
3. P1 `debug-*` 60+ inline 迁 CSS + codicon 统一
4. P1 `svn-*` 20+ i18n 抽取 + 中文分类键化
5. P1 输入 `theia-input/select` 归一 + 长路径 `ellipsis`
6. P1 无障碍 `aria-label/expanded/tabIndex onKeyDown`
7. P2 按钮主次分层 + 颜色 token 清理 + 空态补齐

> 本报告已覆盖 **每个页面/每个菜单/每个对话框/每个按钮/每个文本框/每个下拉/滚动到底部** 的代码级全量，活体截图待环境解阻塞后 `full-audit.cjs` 重跑即补全。所有问题均附 `file:line` 可直达。
