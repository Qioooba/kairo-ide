# Round 10 — 通宵全量回归与修复方案（AI 自主执行，不中断）

> 本文档是 `docs/full-feature-test-and-optimization-plan.md`（下称"主计划"）的 Round 10 执行令。
> 目标：**在官方 win-unpacked exe 上完成一次真正的全量矩阵（无 CASE_FILTER）回归**，补齐 Round 9 遗留的覆盖缺口与账面问题，边测边修，循环直到全绿或全部残留项都有 ISSUES 排期。
> 执行模式：**通宵无人值守**。任何用例失败都不允许停下来问人；按 §5 修复循环协议自主处理。

---

## 0. 为什么需要 Round 10（Round 9 的缺口清单）

Round 9 结论"ship-S 22/0 绿"成立，但存在以下缺口，Round 10 必须逐项关闭：

| # | 缺口 | 证据 | Round 10 动作 |
|---|------|------|---------------|
| GAP-1 | **KAIRO-QA-011 [BLOCKER] 仍为 OPEN**，与 final-closure.md"无 OPEN BLOCKER"矛盾 | `artifacts/qa/ISSUES.md` 末条 | 首先复测：其 detail 中 bar 已显示 `Project: workspace / Agent: connected`，疑似与 QA-010 同源的 harness 误报（importOk 断言）。复测通过则闭环为 VERIFIED (harness)，否则按 BLOCKER 修 |
| GAP-2 | **官方 exe 上从未跑过全量矩阵**：R9 的 a1 是 7 pass/14 skip、a2 是 9 pass/14 skip（都被 `KAIRO_QA_CASE_FILTER` 过滤成 [S] 冒烟）；全量绿是 R8 在旧构建/浏览器上的结果 | `artifacts/qa/a1/report.json`、`a2/report.json` | 本轮桌面列车 **unset KAIRO_QA_CASE_FILTER**，A1 全 21 例、A2 全 23 例在官方 exe 上跑满 |
| GAP-3 | G4（编辑器/JSP/编码）、G8（SVN/Git）、G9（设置/插件/键位矩阵）、G10（状态栏/通知）只有早期轮次浏览器绿，未在 R9 构建上回归 | round-9-summary.md 仅覆盖 A1/A2/G3 | 本轮 6 个浏览器列车全部重跑（无过滤） |
| GAP-4 | 剧本 A/B/C 是"从 [S] 用例映射"的纸面 PASS，不是独立端到端跑 | scenario-a/b/c.md 自述 "mapped [S] cases" | 本轮写独立剧本脚本真实跑通（§6），SVN 提交步骤真实执行 |
| GAP-5 | **性能痛点未量化**：冷启动 11.1s > 10s（OPT-001）；内存从未采样（OPT-003）；R9 部分用例耗时异常（2.2 Find Class 99s 含 jdtWait 56s、2.5 Find Action 95s、2.6 Find in Path 67s、7.5 244s） | ship-smoke/report.json durationMs | 本轮每列车输出 metrics（coldStartMs / searchFirstResultMs / jdtReadyMs / RSS 采样），写入痛点对标表实测值；能优化的当场修，不能的更新 OPT 排期与数据 |
| GAP-6 | 软断言：6.2 靠"debug 已把服务器带起来"PASS；5.1 PASS 但 bar 显示 `Server: disconnected`；5.2 只验证了键位 matched=4 | a2/report.json detail | 本轮硬化断言：6.2 必须经历 stop→start 全周期；5.1 必须断言命中行高亮 + Server running；5.2 断言步进后行号变化 |
| GAP-7 | 报告元数据错误：a1/a2 的 `"round": 1`（实际是 R9 跑的）；ship report exe 路径双转义 | report.json | harness 统一从 `KAIRO_QA_ROUND` 环境变量写 round；本轮=10 |

---

## 1. 硬性规则（沿用主计划 §1，另加通宵条款）

1. 主计划 §1 六条全部有效（一次构建全员共用 / 测试列车 / 阻塞才修 / 截图 q40 / 双端并行 / 每点必测）。
2. **不许停**：整晚执行期间禁止向用户提问、禁止等待人工确认。所有决策按本文档协议自主做出。
3. **不许死循环**：同一用例同一根因连续 3 轮修复仍失败 → 写入 ISSUES.md 标 `DEFERRED`（附 3 次尝试记录），跳过该用例继续，不再重试。
4. **看门狗**：单用例超时 90s（`KAIRO_QA_CASE_TIMEOUT_MS`）；单列车超时 45min，超时强杀进程记 blocked 并继续下一列车；任何 Playwright/Electron 进程悬挂用 `taskkill /F /IM Kairo.exe`（按 PID 精确杀，避免误杀并行实例）清理。
5. **每轮循环必须留痕**：`artifacts/qa/round-10/loop-<N>/` 下保留该次循环所有 report.json 与修复摘要，最后汇总可追溯。
6. 只有 FIX 角色改产品代码；测试脚本/harness 可随时修（harness 修复不算产品修复，报告里分开记）。

---

## 2. 阶段时间线（预算 ~10 小时，T0 起算）

| 阶段 | 内容 | 预算 | 产出 |
|------|------|------|------|
| P0 | 环境与构建：单测基线（go + packages）→ `build:win` 重打 exe（把 R9 源码修复烤进二进制，ship-summary 已提醒）→ browser bundle → 8 份 legacy-sample 副本 + SVN 仓库 | 60 min | `round-10/baseline/*.log`、新 exe |
| P1 | **修账**：复测 GAP-1（QA-011），更新 ISSUES.md；harness 修 GAP-6 断言硬化 + GAP-7 round 元数据 | 30 min | ISSUES.md 更新 |
| P2 | **循环 1（全量）**：桌面 A1/A2（无过滤，官方新 exe）+ 浏览器 A3–A8 六列车并行（无过滤）+ 每实例 RSS 采样 | 150 min | `loop-1/<agent>/report.json` |
| P3 | **修复循环 ×N**：按 §5 协议——聚合失败 → 分级 → 修复 → 增量构建 → 只重跑失败链 → 直到全绿或 DEFERRED | 240 min（弹性） | `loop-N/…`、ISSUES.md 状态流转 |
| P4 | **最终确认**：如 P3 改过前端/主进程则重打 exe → 全组 [S] 冒烟 + **真实剧本 A/B/C**（§6）+ 冷启动 3 次取中位数 + 内存采样表 | 90 min | `round-10/final/…` |
| P5 | 汇总：`round-10-summary.md`、痛点对标表实测值更新 `ux-review.md`、`final-closure.md` 追加 R10 章节 | 30 min | 三份文档 |

---

## 3. 拓扑与命令（可直接执行）

端口/目录分配沿用主计划 §3.1（D1/D2 + B1–B6）。所有输出根目录改为 `artifacts/qa/round-10/`。

```powershell
# P0 —— 基线与构建（依次执行，失败即为 P0 环境问题，先修再继续）
cd G:\spaces\kairo-ide
cd runtime-agent; go test -count=1 ./... 2>&1 | Tee-Object ..\artifacts\qa\round-10\baseline\go-test.log; cd ..
pnpm -r --filter "./packages/*" test 2>&1 | Tee-Object artifacts\qa\round-10\baseline\packages-test.log
powershell -File scripts\go-build-agent.ps1
pnpm --filter @kairo/theia-product build
pnpm --filter @kairo/browser build
pnpm --filter @kairo/desktop build:win     # 必须重打：R9 的 THEIA_CONFIG_DIR 默认值要进二进制

# P2 —— 桌面全量（注意：不设 KAIRO_QA_CASE_FILTER）
$env:KAIRO_QA_ROUND = '10'
Remove-Item Env:KAIRO_QA_CASE_FILTER -ErrorAction SilentlyContinue
node scripts\test\qa\a1-g1-g2-desktop.cjs      # 全 21 例
node scripts\test\qa\a2-g5-g6-g7-desktop.cjs   # 全 23 例
node scripts\test\qa\g3-desktop-s-spot.cjs     # G3 桌面抽测（保留）

# P2 —— 浏览器六列车（先起实例，再并行跑）
powershell -File scripts\test\qa\start-b1-b3.ps1
powershell -File scripts\test\qa\start-b2-b3.ps1   # 按脚本实际覆盖端口核对 B1–B6 齐全，缺的用 start-browser.ps1 手工补
node scripts\test\qa\a3-g3-java-ls-browser.cjs
node scripts\test\qa\a4-g4-editor-browser.cjs
node scripts\test\qa\a5-g6-g7-browser.cjs
node scripts\test\qa\a6-g8-vcs-browser.cjs
node scripts\test\qa\a7-g9-settings-browser.cjs
node scripts\test\qa\a8-g2-g10-browser.cjs
```

内存采样（GAP-5 / OPT-003，每列车跑到一半和结束各采一次）：

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'Kairo|java|kairo-runtime|node' } |
  Select-Object ProcessName, Id, @{n='RSS_MB';e={[math]::Round($_.WorkingSet64/1MB)}} |
  Tee-Object -Append artifacts\qa\round-10\metrics\memory-samples.txt
```

---

## 4. Round 10 用例范围

### 4.1 全量矩阵 = 主计划 §5 的 G1–G10 全部用例，另加本轮专项

| 专项 | 内容 | 断言 |
|------|------|------|
| R10.1 冷启动基准 | 官方新 exe，空 userdata，连续 3 次冷启动 | 记录 3 次 coldStartMs 与中位数；<10s 通过，≥10s 时**先做一次优化尝试**（见 R10.2），仍不达标则更新 OPT-001 附实测数据 |
| R10.2 冷启动优化尝试 | 分析启动瀑布（main.ts 计时点 / plugin host / JDT 预热），做 1–2 个低风险优化（如延迟非关键扩展激活、splash 提前）| 优化后重测 3 次；任何回归立即回滚 |
| R10.3 搜索性能实测 | Search Everywhere / Find Class / Find in Path 各测首屏出结果耗时（键入后到首条渲染，不含 JDT 冷等待；JDT 等待单独记 jdtReadyMs） | SE <300ms；Find in Path <1s；记录进对标表 |
| R10.4 QA-011 复测 | 官方新 exe 干净 userdata 走 1.3 导入 | importOk（含英文 `Project:` 断言）通过 → 闭环 QA-011 |
| R10.5 断言硬化回归 | 6.2 stop→start 全周期；5.1 命中行高亮 + `Server: running`；5.2 步进行号变化 | 见 GAP-6 |
| R10.6 单实例/JDK 预检 | 1.8 / 1.9 桌面独有用例（R9 被过滤跳过）| 必须真实执行 |

### 4.2 [S] 冒烟集（P4 最终确认用）

与 ship-s-smoke.cjs 现有集合一致：A1 (1.1–1.3, 2.1, 2.2, 2.5, 2.6) + A2 (5.1, 5.2, 5.5, 6.1–6.3, 7.1, 7.3, 7.5) + G3 spot (3.1, 3.3, 3.5, 3.7, 3.10, 3.12)。

---

## 5. 修复循环协议（P3 核心，无人值守版）

```
loop N = 1, 2, 3, ...
  1. 聚合本循环所有 report.json → failures[]（status=fail|blocked 的用例）
  2. 若 failures 为空 → 进入 P4，循环结束
  3. 对每个 failure 分类：
     a. harness 缺陷（断言错/时序竞态/选择器过期）→ 直接修脚本，无需重建产品
     b. 产品前端（packages/*）→ 修复 → pnpm theia-product build + browser build → 浏览器端复测
     c. Go agent → 修复 → go-build-agent.ps1 → 重启 agent 复测
     d. Electron 主进程 → 修复 → desktop build（tsc）→ pnpm start 验证 → 标记"待 P4 重打 exe 确认"
  4. 修复顺序：BLOCKER > P0 > P1 > P2；每个修复先写最小复现脚本再改代码
  5. 复测只跑失败用例所在的链（用 KAIRO_QA_CASE_FILTER 精确圈定失败用例±其前置依赖），不整列车重跑
  6. 同一用例第 3 次修复仍失败 → ISSUES.md 记 DEFERRED（根因分析 + 3 次尝试摘要 + 建议排期）→ 从 failures 移除
  7. 每循环结束把状态快照写 artifacts/qa/round-10/loop-N/loop-summary.md（哪些修了、哪些复测过、剩几个）
  8. goto loop N+1
```

补充规则：

- **修复不许破坏基线**：每次产品代码修复后，跑受影响包的单测（`pnpm --filter <pkg> test` 或 `go test ./internal/<pkg>/...`），红了先修单测回归再继续。
- **浏览器验证通过 ≠ 桌面闭环**：凡是改了 packages/* 且对应用例是桌面列车发现的，必须在 P4 重打 exe 后复测该用例。
- ISSUES.md 新问题一律用主计划 §9.2 模板，编号从 KAIRO-QA-012 起。

---

## 6. 剧本 A/B/C 真实执行（P4，替代 R9 的"映射"式 PASS）

写三个独立脚本存 `scripts/test/qa/scenario-{a,b,c}.cjs`，在官方新 exe 上**单会话连续**执行，产出各自 report + 逐步耗时：

- **剧本 A（接手遗留项目第一天）**：干净 userdata 冷启动 → 欢迎页 → 导入 legacy-sample 副本 → 等 JDT ready → Search Everywhere 找 Servlet → 跳转定义 → 打断点 → Build & Deploy → HTTP 请求命中断点 → 看变量 → resume → **SVN 真实提交一次**（用 A6 的本地 SVN 仓库）。断言每步有明确 UI 结果；记录总时长与最长等待步。
- **剧本 B（修 bug）**：Find in Path 定位 → 改 JSP scriptlet → Reload Context → HTTP 验证新输出 → 本地历史 diff → 提交。
- **剧本 C（异常恢复）**：kill agent → 断言状态栏提示 + reconnect 恢复 → 占用 Tomcat 端口再启动 → 断言人话错误提示 → 清空 JAVA_HOME 启动 exe → 断言 JDK Setup 对话框。**任何静默失败记 P0 并进 §5 循环**。

---

## 7. 退出标准（全部满足才允许写"完成"）

1. 官方 win-unpacked exe 上：A1/A2 全量（非冒烟）**0 fail / 0 blocked**（DEFERRED 除外，且 DEFERRED ≤ 3 个、均有根因与排期）。
2. 浏览器 A3–A8 六列车 **0 fail / 0 blocked**（同上 DEFERRED 规则）。
3. [S] 冒烟 + 剧本 A/B/C 在 P4 的最终 exe 上全绿。
4. ISSUES.md **无 OPEN 的 BLOCKER/P0**（含 QA-011 必须闭环）；所有 OPT-* 有当轮实测数据。
5. 单测基线（go + packages）与 P0 时一致或更好。
6. 痛点对标表（主计划 §6.4）每行都有 Round 10 实测值：coldStartMs（3 次中位数）、searchFirstResultMs、内存 RSS 采样表、GBK 往返、HotSwap、VSIX。
7. 产出齐全：`artifacts/qa/round-10/{baseline,loop-*,final,metrics}/`、`round-10-summary.md`、更新后的 `ux-review.md` / `final-closure.md` / `ship-summary.md`，且**各文档之间无相互矛盾的结论**（对照 GAP-1 的教训逐条自检）。

---

## 8. 给执行 AI 的开场指令（可直接粘贴启动通宵任务）

> 你是 Kairo IDE Round 10 通宵回归总控 agent。先完整阅读 `docs/full-feature-test-and-optimization-plan.md` 与 `docs/round-10-overnight-full-regression-plan.md`。然后严格按 Round 10 文档的 P0→P5 阶段执行：统一构建（必须重打 exe）→ 修账（QA-011 复测 + 断言硬化 + round 元数据）→ 全量矩阵（**不设 KAIRO_QA_CASE_FILTER**，桌面 A1/A2 + 浏览器 A3–A8）→ 按 §5 修复循环边测边修直到全绿或 DEFERRED → P4 最终 exe 冒烟 + 真实剧本 A/B/C + 性能/内存实测 → P5 汇总文档。硬性规则：整晚不许向用户提问、不许中途停止；同一用例 3 次修复失败转 DEFERRED 继续；单用例 90s / 单列车 45min 看门狗强杀；每个循环留痕到 `artifacts/qa/round-10/loop-N/`；退出标准见 §7，未全部满足不得宣布完成。现在开始执行 P0。
