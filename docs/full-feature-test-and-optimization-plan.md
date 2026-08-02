# Kairo IDE 全量功能测试与优化方案（供 AI 执行）

> 本文档是一份**可直接交给 AI 代理执行**的测试作战手册。目标：以最高效率对 Kairo IDE 的桌面版（Electron exe）与浏览器版做全量功能测试（模拟点击/输入）、业务逻辑与场景审查、UI/UX 专业度审查，发现问题即修复并持续回归，最终使产品在关键痛点上超越 IntelliJ IDEA 与 VS Code。
>
> 执行者注意：本文所有路径、命令、快捷键均已对照仓库源码核实（2026-08）。执行前请先读完第 1、2、3 章再动手。

---

## 1. 核心原则（必须遵守）

1. **一次构建，全员共用**：测试开始前统一构建一次桌面 exe 与浏览器 bundle，所有并行 agent 共用同一构建产物。禁止每个 agent 各自构建。
2. **测试列车（Test Train）模式**：每次启动应用后，在同一会话内连续执行整个模块组的全部用例（几十个测试点），直到该组结束或阻塞才关闭应用。**严禁"测一个功能点重启一次"**。
3. **阻塞才修，修完批量回归**：非阻塞性问题只记录不中断；阻塞性问题（后续用例无法继续）走修复通道，修复后优先用浏览器版增量构建验证（快），确认后再重打桌面包（慢）。
4. **截图用缩略图**：上行带宽有限。所有截图统一为 JPEG、质量 40、视口 1280×800、非 fullPage，单张控制在 100KB 以内（规范见 §4）。
5. **桌面 + 浏览器并行**：桌面 exe 与浏览器版同时开测；浏览器版多端口多实例并行（§3）。
6. **每个功能点都要测到**：以 §5 测试矩阵为准，逐项打勾，产出结构化报告（§9）。

---

## 2. 环境准备与统一构建

### 2.1 前置条件

- Windows，PowerShell；仓库根：`G:\spaces\kairo-ide`
- pnpm 已安装依赖（`pnpm install`）；Go 工具链可用
- 宿主 JDK：一般功能需 JDK 17+，JDT LS 需 **JDK 21+**（`apps/desktop/src/jdk-check.ts`）。检查 `JAVA_HOME` / `KAIRO_JDK_HOME`；若 JDT LS 不可用会阻塞全部 Java 语言功能测试，属 P0 环境问题。
- 测试夹具项目：`legacy-sample/`（遗留 Servlet/JSP/Ant 工程，GBK），测试时**复制副本**到临时目录使用，禁止直接改动原夹具。

### 2.2 统一构建（测试前执行一次）

```powershell
# 1) 单元测试基线（快速健康检查，约束修复不引入回归）
cd runtime-agent; go test -count=1 ./...; cd ..
pnpm -r --filter "./packages/*" test

# 2) Go agent
powershell -File scripts\go-build-agent.ps1   # 或 cd runtime-agent && go build -o bin/ ./cmd/kairo-runtime/

# 3) 浏览器 bundle（浏览器版测试直接用它）
pnpm --filter @kairo/theia-product build
pnpm --filter @kairo/browser build

# 4) 桌面 exe（win-unpacked 即可，不必做安装包/分卷）
pnpm --filter @kairo/desktop build:win
# 产物：apps\desktop\dist\win-unpacked\Kairo.exe
```

### 2.3 修复后的增量重建策略（速度关键）

| 改动范围 | 最快验证路径 | 命令 |
|---|---|---|
| 前端扩展 TS（packages/*） | 浏览器版增量重建 | `pnpm --filter @kairo/theia-product build && pnpm --filter @kairo/browser build`，重启对应端口的 Theia backend |
| Go agent | 只重编 agent，浏览器/桌面均可复用 | `powershell -File scripts\go-build-agent.ps1`，重启 agent |
| Electron 主进程（apps/desktop/src） | `pnpm --filter @kairo/desktop build`（仅 tsc）后直接 `pnpm --filter @kairo/desktop start` 验证 | 确认后再 `build:win` |
| 需要重打 exe 验证 | 完整 `build:win`（慢，约束为**批量修复后统一执行**，每轮测试周期最多 1–2 次） | `pnpm --filter @kairo/desktop build:win` |

> 原则：**浏览器版是快速验证通道，桌面版是最终确认通道**。前端逻辑两端同源（desktop 打包的就是 browser artifacts），浏览器版验证通过基本等价于桌面版前端已修复；桌面独有逻辑（窗口、单实例、jdk-check、进程管理）必须用 exe 验证。

---

## 3. 并行测试拓扑（多 agent 分工）

### 3.1 端口与数据目录分配（避免互相干扰）

| 实例 | 类型 | Theia 端口 | Agent 端口 | 数据/用户目录 |
|---|---|---|---|---|
| D1 | 桌面 exe | 自动 | 自动 | `--user-data-dir=artifacts\qa\d1\userdata` |
| D2 | 桌面 exe | 自动 | 自动 | `--user-data-dir=artifacts\qa\d2\userdata` |
| B1 | 浏览器 | 3001 | 18101 | `-DataDir artifacts\qa\b1\data` |
| B2 | 浏览器 | 3002 | 18102 | `-DataDir artifacts\qa\b2\data` |
| B3 | 浏览器 | 3003 | 18103 | `-DataDir artifacts\qa\b3\data` |
| B4 | 浏览器 | 3004 | 18104 | `-DataDir artifacts\qa\b4\data` |
| B5 | 浏览器 | 3005 | 18105 | `-DataDir artifacts\qa\b5\data` |
| B6 | 浏览器 | 3006 | 18106 | `-DataDir artifacts\qa\b6\data` |

要点（源码核实）：

- 桌面 exe 有 `app.requestSingleInstanceLock()` 单实例锁，但锁按 userData 目录隔离——**不同 `--user-data-dir` 可并行多开**。
- 浏览器版：`scripts\start-browser.ps1 -Port <p> -AgentPort <ap> -DataDir <dir> -Workspace <ws> -NoBrowser`。**必须给每个实例独立 `-DataDir`**，否则会通过 `agent-state.json` 复用同一个 agent，导致工作区/构建状态互相污染。
- 每个实例使用**独立的 legacy-sample 副本**作为工作区（JDT LS 工作区有锁，且构建/部署会写文件）。
- JDT LS 每实例常驻约 1–1.5GB 内存。按机器内存决定并行度：32GB 机器建议 2 桌面 + 4~6 浏览器；不足则砍浏览器实例，**优先保证桌面实例**。

启动示例：

```powershell
# 浏览器实例 B1
powershell -File scripts\start-browser.ps1 -Port 3001 -AgentPort 18101 `
  -DataDir "G:\spaces\kairo-ide\artifacts\qa\b1\data" `
  -Workspace "G:\spaces\kairo-ide\artifacts\qa\b1\workspace" -NoBrowser
```

桌面实例用 Playwright `_electron.launch`（模板见 §4.2），args 里带 `--user-data-dir`。

### 3.2 Agent 分工矩阵（并行执行，各自独立报告）

| Agent | 实例 | 负责模块组（对应 §5 编号） | 说明 |
|---|---|---|---|
| A1 | D1 | G1 壳层/欢迎页/项目导入 + G2 搜索全家桶 | 桌面独有：窗口标题、单实例、jdk-check 弹窗、DevTools 开关 |
| A2 | D2 | G5 调试 + G6 Run Config/Tomcat + G7 构建部署 | 桌面确认通道，含 HotSwap |
| A3 | B1 | G3 Java 语言服务（补全/导航/重构） | 浏览器快速通道 |
| A4 | B2 | G4 编辑器体验/JSP/编码 | 含 GBK 场景 |
| A5 | B3 | G6+G7（与 A2 双端对照） | 双端行为一致性 |
| A6 | B4 | G8 SVN/Git/本地历史/书签 | 需准备 SVN 测试仓库 |
| A7 | B5 | G9 设置/主题/i18n/插件/快捷键矩阵 | 含 keymap 冲突回归 |
| A8 | B6 | G2 搜索（与 A1 双端对照）+ G10 状态栏/通知/焦点 | |
| UX | 只读所有实例截图 | §6 UI/UX 审查 + §7 业务场景审查 | 不做点击测试，只做评审与出报告 |
| FIX | 独占修复通道 | 收集各 agent 的 BLOCKER，修复→增量构建→通知复测 | 全程唯一有写代码权限的 agent，避免冲突 |

> 若可用 agent 数量少于上表，按 A1→A2→A3→A7→A4→A5→A6→A8 的优先级合并任务；FIX 与 UX 角色不可省略。

### 3.3 修复流转协议

1. 各测试 agent 将问题写入 `artifacts/qa/ISSUES.md`（格式见 §9），阻塞项标 `BLOCKER` 并**跳过被阻塞用例继续测本组其余用例**，本组测完再停。
2. FIX agent 轮询 ISSUES.md，按 BLOCKER > P0 > P1 顺序修复；每次修复附最小验证脚本/步骤。
3. 修复合入后 FIX agent 执行 §2.3 对应的增量构建，在 ISSUES.md 中把状态改为 `FIXED-PENDING-RETEST` 并注明重建了哪端。
4. 原报告 agent 只回归被阻塞的用例链，通过后标 `VERIFIED`。
5. 每轮周期结束（所有组跑完一遍）做一次 exe 重打包 + 桌面端全量冒烟（§5 各组的 S 级用例），然后进入下一轮。

---

## 4. 截图与自动化脚本规范

### 4.1 截图规范（强制）

- 格式：JPEG，`quality: 40`；视口 `1280×800`；`fullPage: false`
- 命名：`<组号>-<用例号>-<简述>.jpg`，存 `artifacts/qa/<agent>/shots/`
- 只在**关键断言点**截图（每用例 1–2 张：结果态 + 异常态），不做步骤级截图
- 目标：单张 <100KB；UX 审查 agent 只看这些缩略图即可完成评审

```js
async function shot(page, name) {
  await page.screenshot({
    path: path.join(outDir, 'shots', `${name}.jpg`),
    type: 'jpeg', quality: 40, fullPage: false,
  }).catch(() => {});
}
```

### 4.2 测试会话骨架（桌面版，参考 `scripts/test/verify-search-everywhere.cjs` 的成熟写法）

```js
'use strict';
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs');

const EXE = 'G:/spaces/kairo-ide/apps/desktop/dist/win-unpacked/Kairo.exe';
const outDir = 'G:/spaces/kairo-ide/artifacts/qa/d1';

(async () => {
  const app = await electron.launch({
    executablePath: EXE,
    args: [
      `--user-data-dir=${path.join(outDir, 'userdata')}`,
      path.join(outDir, 'workspace'),            // 独立的 legacy-sample 副本
    ],
    env: { ...process.env, KAIRO_NO_DEVTOOLS: '1', KAIRO_AUTO_TRUST: '1' },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  // …… 在这里连续执行整组用例（测试列车），逐条 record(name, ok, detail)
  // 结束时写 report.json，然后 app.close()
})();
```

浏览器版用 `chromium.launch()` + `page.goto('http://127.0.0.1:300X')`，其余骨架相同。

### 4.3 通用工具函数（各 agent 复用，勿重复造轮子）

直接复用 `scripts/test/verify-search-everywhere.cjs` 里的成熟实现：

- `dismissTrust(page)` —— 关掉信任/保存对话框（`KAIRO_AUTO_TRUST=1` 后仍建议保留兜底）
- `runPalette(page, label)` —— `Ctrl+Shift+P` 命令面板执行任意命令（测未绑快捷键的命令用它）
- `statusBarText(page)` —— 读状态栏文本做断言
- `record(name, ok, detail)` + `results[]` → `report.json`

### 4.4 已知坑（执行前必读）

| 坑 | 处置 |
|---|---|
| 双击 Shift 触发 Search Everywhere | Playwright 需 `keyboard.press('Shift')` 两次、间隔 <300ms；不稳定则改用命令 `kairo.search.everywhere` |
| 首次打开 Java 文件 JDT LS 索引慢 | 等状态栏 JDK/language ready 标志，超时 120s 再判失败；Java 组用例把"打开首个 .java"放在列车最前面预热 |
| 工作区信任弹窗 | 启动带 `KAIRO_AUTO_TRUST=1` |
| `Ctrl+Alt+H` 快捷键冲突（SVN History vs Call Hierarchy） | 已知设计问题，测试时分别用命令面板触发，并在 G9 键位矩阵中记录为 P1 缺陷 |
| desktop spawn 的 Theia backend 不解析 `--port` | 桌面 headless 模式端口从日志 `listening on ...:NNNN` 发现；浏览器版走 `start-browser.ps1` 无此问题 |
| `Ctrl+N` 等与浏览器原生快捷键冲突（浏览器版） | Playwright `page.keyboard` 直发页面不受影响；但要专门验证真实浏览器下是否被预防（G2 有对应用例） |
| Escape 会关闭弹层 | 每条用例开始先 `Escape` 清场，结束后确认无残留 overlay |

---

## 5. 全量功能测试矩阵

> 标记：**[S]** = 冒烟级（每轮回归必测）；**[双端]** = 桌面+浏览器都要测；未标注默认双端。每条用例都要有明确断言（UI 出现/文本匹配/状态栏变化/文件系统结果），禁止"看起来没报错"式通过。

### G1 壳层 / 欢迎页 / 项目管理（A1，桌面为主）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 1.1 [S] | 冷启动 | 直接启动 exe | 窗口标题 `Kairo IDE`；启动无错误弹窗；记录启动耗时（对标 §6.4） |
| 1.2 [S] | 欢迎页 | 无工作区启动 / `kairo.welcome.show` | 出现 Import Project / Select Project / Recent Projects 三区 |
| 1.3 [S] | 项目导入向导 | `kairo.project.import`，导入 legacy-sample 副本 | 向导每一步可点、可回退；完成后 Explorer 自动展开（`kairo-ui-contribution.ts` 行为） |
| 1.4 | 项目选择器 | `kairo.project.select` + 状态栏 Project 段点击 | 列表含刚导入项目，切换生效 |
| 1.5 | 项目扫描 | `kairo.project.scan` | 扫描完成有通知/结果 |
| 1.6 | Project Structure | `Ctrl+Alt+Shift+S` | 对话框正常打开、各页可切换、保存生效 |
| 1.7 | 最近项目 | 重启后欢迎页 Recent | 上次项目在列，点击可打开 |
| 1.8 (桌面) | 单实例锁 | 同一 user-data-dir 再启动一次 exe | 第二进程退出并聚焦已有窗口 |
| 1.9 (桌面) | JDK 预检 | 临时清空 `JAVA_HOME`/`KAIRO_JDK_HOME` 启动 | 出现 JDK Setup 对话框，可继续但降级；恢复环境后正常 |
| 1.10 | 窗口标题跟随 | 打开文件 | 标题含文件名 + ` - Kairo IDE` |

### G2 搜索全家桶（A1 桌面 / A8 浏览器，双端对照）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 2.1 [S] | Search Everywhere | 双击 Shift | 弹层出现；输入类名如 `HelloWorld` 出现 java-symbols 结果；Tab 切换 All/Files/Symbols/Actions 各 tab 生效 |
| 2.2 [S] | Find Class | `Ctrl+N` | 输入部分类名命中；回车打开对应 .java 且光标定位 |
| 2.3 | Find File | `Ctrl+Shift+N` | 模糊匹配 `web.xml` 等命中 |
| 2.4 | Find Symbol | `Ctrl+Alt+Shift+N` | 方法/字段命中 |
| 2.5 [S] | Find Action | `Ctrl+Shift+A` | 输入 `build` 能找到 Kairo Build 等动作并可直接执行 |
| 2.6 [S] | Find in Path | `Ctrl+Shift+F` | Search Center 打开；关键字命中多文件；结果双击跳转正确行 |
| 2.7 | Replace in Path | `Ctrl+Shift+R` | 替换预览正确；执行后文件内容变化；再替换回来 |
| 2.8 | 大小写/正则/整词开关 | Search Center 三个 toggle | 各开关改变结果集（沿用 verify-search-everywhere 的断言方法） |
| 2.9 | 搜索 scope | Search Center scope 下拉 | 限定目录后结果收敛 |
| 2.10 | GBK 内容搜索 | 搜索中文关键字（GBK 文件内） | 能命中且预览不乱码（对标 VS Code 痛点） |
| 2.11 | 搜索性能 | 在 legacy-sample 全量搜索常见词 | 首屏结果 <1s（记录实测值） |

### G3 Java 语言服务（A3，浏览器快速通道；每轮末桌面抽测 [S] 项）

前置：打开 legacy-sample 副本中任一 .java，等 JDT LS ready（状态栏 JDK 段）。

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 3.1 [S] | 补全 | `Ctrl+Space` | 键入 `Sys` 出现 `System`；接受后正确插入 |
| 3.2 | Smart Completion | `Ctrl+Shift+Space` | 类型过滤的候选 |
| 3.3 [S] | 跳转定义 | `Ctrl+B` / `F4` | 跳到声明处 |
| 3.4 | 跳转实现/类型定义/父方法 | `Ctrl+Alt+B` / `Ctrl+Shift+B` / `Ctrl+U` | 各自正确 |
| 3.5 [S] | Find Usages / Show Usages | `Alt+F7` / `Ctrl+Alt+F7` | 引用列表正确、可跳转（参考 verify-show-usages-* 脚本断言） |
| 3.6 | Call/Type Hierarchy | 命令面板触发（避开 Ctrl+Alt+H 冲突）/ `Ctrl+H` | 层级树渲染正确 |
| 3.7 [S] | 重命名 | `Shift+F6` | 跨文件引用同步更新 |
| 3.8 | 提取方法/变量/常量/字段 | `Ctrl+Alt+M/V/C/F` | 生成代码正确、可编译 |
| 3.9 | Change Signature | `Ctrl+F6` | 调用点同步 |
| 3.10 [S] | 格式化 + Organize Imports | `Ctrl+Alt+L` / `Ctrl+Alt+O` | 格式变化符合预期；未用 import 被移除 |
| 3.11 | Quick Fix | `Alt+Enter` | 制造一个编译错误，修复建议可用 |
| 3.12 [S] | 诊断 | 故意写错代码 | Problems 面板出现红色诊断，修复后消失 |
| 3.13 | Generate / Override / Implement | `Alt+Insert` / `Ctrl+O` / `Ctrl+I` | 生成 getter/setter、覆写方法正确 |
| 3.14 | Surround With / Unwrap | `Ctrl+Alt+T` / `Ctrl+Shift+Delete` | try/catch 等包裹与解包 |
| 3.15 | Live Templates | `kairo.java.liveTemplates.manage` + 编辑器内展开 | `psvm`/`sout` 类模板可展开 |
| 3.16 | Hover / InlayHints / CodeLens | 悬停、观察参数提示与 Run lens | 均渲染 |
| 3.17 | JDK 6 目标编译 | 用 `--release 6` 语义的项目构建 | 老语法（无 diamond 等）不误报（核心卖点：老项目支持超越新版 IDEA） |

### G4 编辑器体验 / JSP / 编码（A4）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 4.1 [S] | JSP 语法高亮 | 打开 .jsp | scriptlet、taglib、EL 分色正确（Monarch 语法） |
| 4.2 | JSP scriptlet 补全 | scriptlet 内 `Ctrl+Space` | Java 补全可用（对标 VS Code JSP 完全没支持的痛点） |
| 4.3 | JSP 诊断 / web.xml 导航 | 制造 taglib 错误；点击 web.xml 引用 | 诊断出现；导航正确 |
| 4.4 [S] | GBK 打开/保存 | 打开 GBK 中文 .java/.jsp | 显示不乱码；状态栏 Encoding 段显示 GBK |
| 4.5 [S] | 编码转换 | `kairo.encoding.convert` GBK→UTF-8→GBK | 内容字节级往返一致（这是 encoding-extension 的安全编解码卖点） |
| 4.6 | Reopen with Encoding | 状态栏 Encoding 点击 → reopen | 按所选编码重新解释 |
| 4.7 | 自动保存 | 设置 `editor.autoSave` 后改文件 | 延时后落盘 |
| 4.8 | 多标签/分屏/最近文件 | 拖拽分屏；`Ctrl+E` | 布局正确；Recent Files 列表正确 |
| 4.9 | Go to Line / File Structure | `Ctrl+G` / `Ctrl+F12` | 定位正确 |
| 4.10 | 本地历史 | 改文件多次 → `kairo.localHistory.show` / compare / restore | 版本可比对可还原 |
| 4.11 | 书签全套 | `F11`/`Ctrl+F11`/`Shift+F11`/Ctrl+数字 | 打点、助记、列表、编号跳转 |

### G5 调试（A2，桌面为主）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 5.1 [S] | 断点 + 命中 | `Ctrl+F8` 打点 → Debug 启动 Tomcat (`Shift+F9`) → 触发请求 | 命中断点，编辑器高亮当前行 |
| 5.2 [S] | 步进三件套 | `F8`/`F7`/`Shift+F8`/`F9` | 行为符合 IDEA 语义 |
| 5.3 | Run to Cursor | `Alt+F9` | 跑到光标行 |
| 5.4 | 条件断点/HitCount/Logpoint | `Ctrl+Shift+F8` + `kairo.java.debug.*` | 条件生效 |
| 5.5 [S] | 变量/监视/求值 | Debug Tool Window（`kairo.debug.openToolWindow`） | Variables 树正确、Watch 可加、Evaluate 出值 |
| 5.6 | 调试控制台 | Console widget | 输出流正确 |
| 5.7 | HotSwap | 断点暂停时改方法体 → HotSwap | 状态 widget 显示成功，新逻辑生效 |
| 5.8 | JSP 断点 | `kairo.jsp.toggleBreakpoint` | JSP 行可断（差异化卖点） |
| 5.9 | Drop Frame / Mute / Inline Values | `kairo.debug.*` | 各自生效 |
| 5.10 | 调试适配器自检 | `kairo.debug.checkAdapter` | 报告健康 |

### G6 Run Config / Tomcat 服务器（A2 桌面 / A5 浏览器）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 6.1 [S] | Run Config CRUD | `kairo.runConfigurations.manage` | 新建/复制/改端口/删除全链路；Toolbar 下拉同步 |
| 6.2 [S] | 启动服务器 | `Shift+F10` / Toolbar Start | 状态栏 Server 段变 running；Servers 面板 (`Alt+2`) 状态一致 |
| 6.3 [S] | 打开应用 | `kairo.app.open` | 浏览器打开应用 URL，页面可访问 |
| 6.4 | 停止/重启 | `Ctrl+F2` / `kairo.server.restart` | 进程真正停掉/重启（校验端口释放） |
| 6.5 | Update Application / Reload Context | `Ctrl+F10` / `kairo.server.reloadContext` | 改 JSP 后无需重启即生效（热部署卖点） |
| 6.6 | 日志面板 | `kairo.view.*` Logs | Tomcat 日志滚动、无乱码（GBK 日志） |
| 6.7 | 端口冲突场景 | 占用 8080 再启动 | 有清晰错误提示与诊断建议，而非静默失败（UX 审查点） |

### G7 构建 / 部署（A2 / A5）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 7.1 [S] | Build | `Ctrl+F9` | Build 视图出现进度与结果；产物生成 |
| 7.2 | Clean Build | `kairo.cleanBuild` | 先清理后构建 |
| 7.3 [S] | Build and Deploy | `Ctrl+Shift+F9` | 构建后自动部署到 Tomcat |
| 7.4 | Publish | `kairo.publish` | 发布产物正确 |
| 7.5 | 构建失败场景 | 制造编译错误再 Build | 失败信息可点击跳转到出错行（UX 审查点） |
| 7.6 | Ant/Maven 视图 | `kairo.view.*` Maven | 目标/任务可执行 |

### G8 版本控制 / SVN / Git（A6）

前置：准备本地 SVN 仓库（`svnadmin create` + checkout 到工作区副本）与一个 git init 的副本。

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 8.1 [S] | SVN 状态/Changes | `svn.showChanges` | 修改文件列出 |
| 8.2 [S] | 提交 | `Ctrl+K` | IDEA 风格提交对话框；提交成功 |
| 8.3 | 更新 | `Ctrl+T` | 拉取无冲突 |
| 8.4 | Diff / Annotate / History | `Ctrl+D` / `svn.annotate` / `Ctrl+Alt+H`(记录冲突) | 视图正确 |
| 8.5 | 冲突制造与解决 | 两副本改同行 → update → `svn.resolve` | 三方合并流程可完成 |
| 8.6 | Revert / Add / Delete / Ignore / Changelist | 对应命令 | 各自生效 |
| 8.7 | Git History / Stash / Cherry-pick | `kairo-git-history:toggle` 等 | 视图与操作正确 |

### G9 设置 / 主题 / i18n / 插件 / 键位矩阵（A7）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 9.1 [S] | 设置页 | `Ctrl+Alt+S` | 打开；`kairo.*` 各偏好可改且即时生效（抽 fontSize、autoSave、language 三项验证） |
| 9.2 [S] | 主题切换 | 主题命令：kairo-dark / IDEA Darcula / 亮色 | 全 UI（含 Monaco、Activity Bar、状态栏）一致换肤，无漏染色区域（截图给 UX） |
| 9.3 | 语言切换 | `kairo.language` en ↔ zh-CN | 菜单/对话框/通知全部跟随，无缺翻译键（漏翻记 P1） |
| 9.4 [S] | 快捷键页 + 速查表 | `kairo.keymap.open` / `Ctrl+Shift+K` | 页面完整；速查表渲染 |
| 9.5 | **键位矩阵回归** | 遍历 `kairo-idea-windows-keymap.ts` 全部 ~120 绑定 | 逐条触发（可用命令面板校验 handler 是否注册作为快速通道，再抽 30 条真实按键验证）；输出"绑定→是否生效"CSV；重点记录 `Ctrl+Alt+H`、`Ctrl+Shift+C` 等已知疑点 |
| 9.6 | Extensions 视图 | `Ctrl+Shift+X` | 视图打开、已装列表正确 |
| 9.7 | VSIX 安装（白名单内） | `kairo.extensions.installFromVsix` 装 `EditorConfig.EditorConfig` 的 vsix | 安装成功、启用/禁用/卸载/Reload 全链路 |
| 9.8 | VSIX 白名单外拦截 | 装一个不在 `DEFAULT_ALLOWLIST` 的 vsix | 被拒绝且提示清晰 |
| 9.9 | 白名单冲突项 | 尝试装 `redhat.java` | 验证与内置 JDT LS 的冲突处理是否有提示（模型注释已标注风险，无提示记 P1） |

### G10 状态栏 / 通知 / 焦点 / 终端（A8）

| # | 用例 | 入口 | 断言 |
|---|---|---|---|
| 10.1 [S] | 状态栏全段点击 | Project/JDK/Encoding/Build/Server/Debug/Agent/HotReload 逐段点击 | 每段都触发对应命令，无死区 |
| 10.2 | 通知中心 | `kairo.notification.toggle` | 历史通知可查、可清空 |
| 10.3 [S] | 终端 | `Alt+F12` | 打开/聚焦/再按隐藏；能执行 `java -version` |
| 10.4 | 焦点管理 | `F6` / `Escape` / `kairo.focus.*` | 焦点按预期流转（键盘可达性） |
| 10.5 | Agent 断连恢复 | 手动 kill agent 进程 → 状态栏 Agent 段 → `kairo.agent.reconnect` | 断连有提示、重连成功恢复功能 |
| 10.6 | JDK 切换 | `kairo.jdk.switch` | 列表正确、切换后状态栏更新 |

---

## 6. UI / UX 专业度审查（UX agent）

> 输入：各测试 agent 的缩略图 + UX agent 自行在 B 实例上补充的定向截图。输出：`artifacts/qa/ux-review.md`，每条结论必须附截图引用与具体改进建议（可直接改哪个 CSS/组件文件）。

### 6.1 视觉审查清单（是否美观 / 高级 / 专业）

对照基准：`docs/ui-spec.md` 与 `packages/ui-kit/src/browser/kairo-theme.css`（主色 `#4a9eff`，暗底 `#1e1f22`）。

- **一致性**：所有面板/对话框/弹层是否统一使用主题 token；找出任何"白底原生感"的漏染区域（常见于自研 widget：Run Config、Project Structure、SVN 对话框、导入向导）
- **层次**：标题/正文/次要文本的字号字重梯度是否清晰；间距是否遵循 4/8px 栅格；图标风格是否统一（混用 codicon 与自绘图标要指出）
- **质感**：弹层阴影/圆角/边框是否精致；hover/active/focus 三态是否完备；滚动条是否主题化
- **品牌感**：欢迎页是否有产品气质（logo、排版、留白）；启动瞬间是否有白屏/闪烁（记录并给出 splash 建议）
- **暗/亮双主题**：两套主题下逐屏对比，亮色主题往往是自研产品的重灾区
- **中文排版**：zh-CN 下字体 fallback、标点挤压、按钮文案截断

### 6.2 交互习惯审查（是否符合用户习惯）

- **IDEA 用户心智**：快捷键语义是否与 IDEA 一致（不只是绑定存在，行为语义也要一致，如 `Ctrl+E` 的最近文件排序）；双 Shift 弹层的交互细节（方向键、Tab 切类别、Enter 打开、Esc 关闭）
- **对话框规范**：主按钮位置统一（右下）；Enter=确认 Esc=取消全局成立；破坏性操作有确认且默认焦点在安全项
- **反馈**：每个耗时操作（构建、部署、索引、SVN）都要有进度指示与可取消；操作完成有 toast；失败信息"人话 + 可行动建议 + 跳转链接"
- **空状态**：每个面板无数据时是否有引导文案而非空白（Servers、Tests、Bookmarks、Search Results 逐个检查）
- **键盘可达**：全流程仅键盘能否完成导入→编码→构建→调试

### 6.3 业务逻辑与场景审查（§7 联合）

按目标用户"维护遗留 Java Web 系统的开发者"走查端到端场景，评审每步是否顺、是否多余、是否缺失（见 §7）。

### 6.4 超越 IDEA / VS Code 的痛点对标表（必须量化）

| 痛点 | IDEA 表现 | VS Code 表现 | Kairo 目标 | 测法 |
|---|---|---|---|---|
| 冷启动到可编辑 | 大项目 30s+ | 快但 Java ready 慢 | < 10s | 1.1 计时 |
| 老项目支持（JDK 6/Tomcat 6/JSP） | 新版已放弃 JDK6 | 基本无 JSP 支持 | 开箱即用 | 3.17 / 4.1–4.3 / G6 |
| GBK 编码 | 尚可 | 长期痛点、易乱码写坏文件 | 字节级安全往返 | 4.4–4.6 |
| 索引/构建期间卡 UI | 常见 | — | 全程可交互 | G3 预热期间操作 UI |
| 内存占用 | 数 GB | 中 | 记录实测，出优化项 | 各实例任务管理器采样 |
| Search Everywhere 延迟 | 大项目卡 | 无同等功能 | 首屏 <300ms | 2.11 |
| 热部署/HotSwap | 需 JRebel 付费 | 无 | 内置免费 | 5.7 / 6.5 |
| 离线插件安装 | 麻烦 | 依赖商店 | VSIX 本地装 + 白名单安全 | 9.7–9.9 |

每项给出实测值，达不到目标的记 P1 优化项进 ISSUES.md。

---

## 7. 端到端业务场景剧本（每轮至少完整跑一遍，桌面版）

**剧本 A：接手遗留项目第一天**（约 15 分钟）
导入 legacy-sample 副本 → 扫描 → 确认编码 GBK 正常 → Search Everywhere 找核心 Servlet → 跳转/看层级理解调用链 → 打断点 → 构建部署启动 Tomcat → 浏览器触发请求命中断点 → 看变量 → 改代码 HotSwap → 验证 → SVN 提交。
**评审点**：全程卡点数、每步等待时长、有没有一步"不知道下一步该点哪"。

**剧本 B：日常修 bug**（约 10 分钟）
Find in Path 定位报错文案 → 打开 JSP 改 scriptlet → Reload Context → 验证 → 本地历史比对 → 提交。

**剧本 C：环境异常恢复**
kill agent → 观察提示与重连（10.5）→ 占用 Tomcat 端口再启动（6.7）→ 拔掉 JDK 再启动（1.9）。
**评审点**：所有异常路径必须"有提示、有建议、可恢复"，任何静默失败记 P0。

---

## 8. 执行时间线（目标：单轮全量 ≤ 4 小时）

| 阶段 | 内容 | 预计 |
|---|---|---|
| T0 | §2 统一构建 + 单测基线 + 工作区副本准备 | 40 min |
| T1 | 全部 agent 并行首轮（各自的测试列车） | 90 min |
| T2 | FIX 集中修复 BLOCKER/P0 + 增量构建 + 定向复测（并行：未阻塞 agent 继续 P1/P2 用例与 UX 审查） | 60 min |
| T3 | exe 重打包 + 桌面端全组 [S] 冒烟 + 剧本 A/B/C | 45 min |
| T4 | 汇总报告、更新痛点对标表、生成下一轮修复清单 | 15 min |

多轮迭代直到：所有 [S] 通过、无 OPEN 的 BLOCKER/P0、痛点对标表全部达标或有明确优化排期。

---

## 9. 报告与问题记录格式（强制统一）

### 9.1 每 agent 报告：`artifacts/qa/<agent>/report.json`

```json
{
  "agent": "A3", "instance": "B1", "round": 1,
  "startedAt": "...", "finishedAt": "...",
  "cases": [
    { "id": "3.1", "name": "Java completion", "status": "pass|fail|blocked|skip",
      "durationMs": 1234, "detail": "", "shots": ["3-1-completion.jpg"] }
  ],
  "metrics": { "coldStartMs": 8200, "searchFirstResultMs": 240, "memoryMB": 1900 }
}
```

### 9.2 集中问题单：`artifacts/qa/ISSUES.md`

```markdown
## KAIRO-QA-001 [BLOCKER] Search Everywhere 双 Shift 在浏览器版不触发
- 状态: OPEN | FIXING | FIXED-PENDING-RETEST | VERIFIED | WONTFIX
- 发现: A8 / B6 / 用例 2.1 / round 1
- 复现: 步骤…（必须可脚本化复现）
- 截图: artifacts/qa/a8/shots/2-1-fail.jpg
- 疑似位置: packages/search-extension/src/browser/search-everywhere-contribution.ts
- 修复: (FIX agent 填) commit/改动摘要 + 重建端(browser/desktop/agent)
- 分级: BLOCKER=后续用例无法继续; P0=核心功能错误/数据损坏/静默失败; P1=功能可用但体验差/UX 审查项; P2=打磨项
```

### 9.3 轮次总结：`artifacts/qa/round-<N>-summary.md`

各组通过率、新增/关闭问题数、痛点对标表实测值、下一轮重点。

---

## 10. 给执行 AI 的开场指令模板

> 你是 Kairo IDE 测试 agent {A1..A8|UX|FIX}。先完整阅读 `docs/full-feature-test-and-optimization-plan.md`。你的实例与模块组见 §3.2。规则：一次会话跑完整组用例（测试列车）；截图 JPEG q40 1280×800；阻塞项记 ISSUES.md 后跳过继续；只有 FIX agent 允许改代码；所有产出写入 `artifacts/qa/<你的编号>/`。复用 `scripts/test/verify-search-everywhere.cjs` 中的工具函数编写你的测试脚本，脚本存 `scripts/test/qa/`。完成后输出 report.json 与本组小结。
