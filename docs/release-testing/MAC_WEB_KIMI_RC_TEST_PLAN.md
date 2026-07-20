# Kairo IDE — macOS Web 版发布候选全量测试方案（Kimi Code 执行版）

> - 执行机器：macOS 真机（Apple M1 Pro / macOS 26.4 / Retina DPR 2）
> - 被测产品：Kairo IDE Localhost Browser/Web 版（Theia 1.73.1 + Go runtime-agent）
> - 执行者：Kimi Code 总协调 Agent + 多个子 Agent
> - 任务性质：发布阻断（Release Gate）
> - 上游依据：`MAC_WEB_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md`（GPT-5.6 方案，下称"上游文档"）+ 2026-07-20 对当前代码的独立静态审查
> - 基线：`TESTED_COMMIT_BASE = 65210d5dd2e947a71e0276fb475be3e51465702d`（main，与 origin/main 一致；另一 Kimi 进程的修改已合并推送）
> - QA 分支：`qa/kimi-mac-web-20260720-65210d5`，每 Wave 合入 main 后广播新 SHA
> - 结论规则：本文件全部必测项通过前，禁止宣布可交付、禁止上线

## 0. 与上游文档的差异说明

1. **基线不同**：上游文档写于 f498740，但本地 main 已领先 42 提交且全部 qa/* 波次（m0–m4）已合入。本方案以 65210d5 为基线，不回退。
2. **单端执行**：本任务只有 macOS 一端。上游"双机统一 TESTED_COMMIT / SHARED 缺陷双机复验"条款改为：所有修复落在共享前端包（`packages/*`、`apps/browser`），桌面（Windows/Electron）复用同一前端而自动受益；protocol/runtime 级改动记入 `SHARED` 缺陷清单移交 Windows 机复验。最终报告如实标注此限制。
3. **新增"代码审查与重构线"**：静态审查已实锤一批缺陷（见 §3 预录缺陷），本方案将其纳入正式缺陷跟踪与修复，而不是测试时才"发现"。
4. **防卡死设计**：见 §6，上游文档未覆盖长任务编排细节。

## 1. 环境矩阵（实测记录见 `$KAIRO_QA_ROOT/environment.txt`）

| 项 | 值 | 备注 |
|---|---|---|
| 硬件/系统 | MacBook Pro M1 Pro, macOS 26.4, arm64 | 内建 Liquid Retina XDR 3456×2234, DPR 2 |
| Node | v23.11.0 | ⚠ 上游要求 20.x；engines 为 ≥20.10。以本机实际为准并记录，不冒充 |
| pnpm | 9.15.9 | 与 packageManager 一致 |
| Go | 1.26.4 | go.mod 要求 1.22，工具链向下兼容 |
| Java | OpenJDK 21.0.7 | 无 JDK 6（已知阻断 B-001，`--release 6` 模拟） |
| 浏览器 | Playwright chromium-1228（headed 主门禁）、webkit-2311（兼容）、系统 Chrome 150、Safari 26.4 | |
| 视口 | 1440×900（主）、1280×720、1920×1080 | 缩放 100%/125%/200% |
| 主题 | Kairo Dark（唯一产品主题） | 若发现 Light/HC 入口但不可用记缺陷 |
| Agent 配置 | `runtime-agent/configs/qa-mac-web.yaml`（127.0.0.1:19090，state → `$KAIRO_QA_ROOT`） | |

已知外部阻断（沿用上游判定，可带阻断发布）：B-001 无 Oracle JDK 6；B-002 Tomcat 6 首次使用下载（`bundled/tomcat6`，SHA-256 校验）；B-003 JDT LS 对 Java 6 best-effort。

## 2. 测试真实性规则（不可违反）

1. 核心用例结果只有 PASS / FAIL / BLOCKED，禁止 SKIP、gated、`continue-on-error`、`|| true`、吞异常后 exit 0。
2. 每个可交互控件覆盖：可见、可达、点击/输入、结果、禁用、错误、键盘路径。"按钮存在"≠"按钮有效"。
3. 截图只证明外观；业务成功必须有 UI 状态 + 文件/进程/HTTP 的独立交叉验证。
4. 浏览器 console error、page error、failed request、未处理 Promise rejection 默认使测试失败；白名单需逐条解释。
5. 修复必须先有最小复现（failing test），修复后跑最小复现 → 所属 Wave → 全量回归。
6. 测试只操作 `$KAIRO_QA_ROOT` 内的临时 fixture；结束 `git status --short` 必须与基线一致。
7. 证据脱敏：不上传 secret、用户目录隐私、完整环境变量。

## 3. 预录缺陷清单（静态审查实锤，进入 defects.jsonl 跟踪）

| ID | 级别 | 缺陷 | 位置 |
|---|---|---|---|
| KAIRO-RC-WEB-001 | P0 | 双重绑定：`bindKairoFrontend(bind)` 未传 isBound/rebind，`bindKairoProduct` 又无条件重复绑定同四个服务 → inversify ambiguous，bundle 疑似启动即炸 | `packages/theia-product/src/main/product-frontend.ts:52`, `product-bindings.ts:49-54` |
| KAIRO-RC-WEB-002 | P1 | JSP Monarch 语法 `registerJspLanguage()` 零调用方 → JSP 无语法高亮 | `packages/jsp-extension/src/browser/jsp-grammar.ts:75-88` |
| KAIRO-RC-WEB-003 | P1 | WEB-FLOW-01 最近一次实测 FAIL：状态栏 60s 未出现 "Project: (no workspace)" | `artifacts`（已 seize），复现脚本 `scripts/run-web-flow-01.cjs` |
| KAIRO-RC-WEB-004 | P2 | `KairoDarkTheme.editorTheme='kairo-dark'` 但从未 defineTheme → Monaco 回退默认主题，编辑器与 UI 主题漂移 | `packages/ui-kit/src/browser/kairo-theme.ts:399` |
| KAIRO-RC-WEB-005 | P2 | accent 紫色双份 `#7C3AED`(css) vs `#7c5cbf`(ts) | `kairo-theme.css:3` vs `kairo-theme.ts` |
| KAIRO-RC-WEB-006 | P2 | 6 个状态栏项全部无 command（视觉暗示可点但不可点）；`kairo.java` 永远 `Java: -` | `kairo-status-bar-contribution.ts` |
| KAIRO-RC-WEB-007 | P2 | Build 视图 "Clean Build" 按钮实际执行 `kairo.buildAndDeploy`，标签/语义不符 | `build-view-widget.tsx:51` |
| KAIRO-RC-WEB-008 | P2 | 生成入口残留 `applicationName: Eclipse Theia`、`<title>Eclipse Theia</title>` | `apps/browser/src-gen/frontend/index.js:9-27`, `index.html` |
| KAIRO-RC-WEB-009 | P2 | Server 视图 4 按钮在窄侧栏/200% zoom 拥挤换行 | `kairo-theme.css:396-408` |
| KAIRO-RC-WEB-010 | P3 | Project Selector 以不可关闭的主区 tab 打开，UX 别扭 | `project-selector-widget.tsx:16-17` |
| KAIRO-RC-WEB-011 | P3 | 死/冲突 CSS：`.kairo-server-url`、`.kairo-log-viewer` 双定义，`.kairo-build-status` 等无引用 | `kairo-theme.css` |
| KAIRO-RC-WEB-012 | P2 | 测试基建：`api-smoke.cjs`/`full-chain.cjs` GATED 仍 exit 0；axe 版 a11y 脚本未接入 package.json；`docs/testing.md` 引用不存在的 `pnpm test:e2e`；ci.yml checksum 格式非法/clean 先于 install/theia-java-e2e 缺 KAIRO_RUNTIME_URL | `tests/e2e/*`, `package.json`, `docs/testing.md`, `.github/workflows/ci.yml` |
| KAIRO-RC-WEB-013 | P3 | 死代码：`apps/browser/src/index.ts`、runtime-extension `KairoRuntimeModule` 重复绑定层、`runtime-agent/internal/api/http_server.go`、`internal/app/` 2244 行、jsp `tld-parser.ts` | 各处 |
| KAIRO-RC-SHARED-001 | P2 | 状态栏 Project Selector/Import Wizard 可达性、主题与 composition 修复均为共享前端，需 Windows 机复验 | 移交清单 |

正面事实：前端无任何 CDN/外部字体/脚本依赖，Monarch/worker 全本地，满足纯内网部署要求。

## 4. Wave 0 — 可信基线与基建修复（总协调串行）

超时：单命令 ≤300s；Go race ≤600s（后台）。

1. 干净安装与静态门禁：
   `corepack prepare pnpm@9.15.9 --activate && pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint && pnpm -r --filter "./packages/*" exec tsc --noEmit && git diff --check`
   `runtime-agent`: `gofmt -l`（无输出）、`go vet ./...`、`go test -count=1 -timeout 300s ./...`、`go test -race -count=1 -timeout 420s ./...`、`go build -trimpath -o bin/kairo-runtime ./cmd/kairo-runtime`
2. **W0-FIX-001（P0 双重绑定）**：新增 composition smoke 测试（加载 frontend ContainerModule，断言无 ambiguous/missing binding）→ 复现失败 → 统一绑定来源 → 转绿。
3. **W0-FIX-012（基建真实性）**：移除 api-smoke/full-chain 的 GATED-exit-0；`package.json` 接入 axe 版 `scripts/run-a11y-scan.cjs`；修 `docs/testing.md`；修 ci.yml（checksum 格式、clean/install 顺序、`KAIRO_RUNTIME_URL`）。
4. 真实启动验证：仅 127.0.0.1 监听（`lsof` 核实无 0.0.0.0）；`/api/v1/health` 200；前端 connecting→connected；刷新/重开恢复；杀掉 agent 后 UI 明确 disconnected 且不无限 Loading、按钮错误反馈合理。
5. `pnpm test:agent:integration`、`node --test tests/contract/*.test.cjs`、`tests/fault`、`tests/perf` 逐条 exit 0。

## 5. Wave 1 — UI 全量盘点与逐控件操作（M1）

1. 动态生成 `ui-inventory.json`：遍历菜单栏、命令面板（F1/Cmd+Shift+P，全部 `Kairo:` 命令）、活动栏、文件树、编辑区、各视图、对话框、通知、状态栏；字段含 id/surface/control/selector/role/states/expected/evidence。与 DOM 可交互元素（button/a[href]/input/select/[role]/tab/状态栏项/Monaco 控件）计数对账；新增控件自动进失败清单。
2. 必测产品面（上游 §6.2 全表）：Workbench shell、标准菜单（每项真实触发一次，不得出现 "No command exists"）、命令面板、Import Wizard（4 步全状态）、Project Selector、Build View（9 状态）、Server View（8 状态）、Deployments View（50 行上限/长 ID/滚动）、Server Logs（自动滚动/上滚暂停/500 可见 1000 保存/级别色彩）、Status bar、Encoding commands、Editor、Java/JSP、Large file、Theme。
3. 每控件九宫格模板（上游 §6.3）：默认截图+accessible name/role/bbox → hover → Tab focus（焦点环/顺序）→ Enter/Space 与鼠标各执行一次（防 double submit，busy 阻止重复）→ 成功与失败结果 → disabled 条件 → 1280×720/200% zoom/长中英文不截断不重叠 → console/network/日志无新增错误。
4. 本 Wave 修复（各配回归测试）：WEB-006 状态栏 command 绑定或非交互化；WEB-007 按钮标签语义；WEB-008 应用名/标题；WEB-009 工具栏拥挤；WEB-010 Project Selector UX。

## 6. Wave 2 — 视觉/主题/可访问性（M3，与 Wave 3 并行）

1. 截图矩阵：`<commit>/<browser>/<viewport>/<theme>/<case-id>-<state>.png`，覆盖 空/加载/正常/hover/focus/disabled/busy/成功/错误/断连/长内容 × 3 视口 × 100%/125%/200%。动画稳定后截图；动态区最小 mask。
2. 视觉人工审查清单（上游 §7.2 全条：8px 节奏、密度、层级、文案一致、状态不只靠红绿、图标、滚动、z-index、resize 1920→1280→恢复）。
3. axe-core（`scripts/run-a11y-scan.cjs`）+ 人工键盘：WCAG AA 正文 ≥4.5:1、大文字/控件边界/焦点 ≥3:1；accessible name 非空；无重复 ID；label 关联；`role=alert`/live region；全键盘主链无 trap；视图刷新/日志追加不丢焦点；200% zoom 无信息丢失；Reduced Motion。
4. 主题修复：WEB-004 Monaco `defineTheme('kairo-dark')`；WEB-005 accent 统一；WEB-011 死 CSS 清理；通知对比度。

## 7. Wave 3 — 完整业务流程（M2，可见浏览器）

主体只允许 UI 操作；API 仅用于启动前 health 与完成后交叉验证。

- **WEB-FLOW-01 首次导入**：冷启动无 workspace → Import Wizard → 真实 macOS 文件选择框选临时 `legacy-sample` → 扫描/检测分支 → 空名/超长名/中文名/各 Source Level/Encoding/Build Tool → 保存后 wizard 关闭、状态栏与 selector 更新、磁盘配置存在 → 断线保存错误可见且表单不丢、恢复后只创建一个项目。
- **WEB-FLOW-02 文件与编辑器**：树展开/折叠；打开 Java/JSP/properties/CSS/JS；File/Edit 菜单与快捷键逐项；新建/重命名/复制/删除（临时 fixture）；dirty/关闭确认/刷新恢复；Java completion 与 F12 真实结果；1MB/10MB 大文件模式、滚动、搜索、恢复。
- **WEB-FLOW-03 编码安全**：GBK fixture 原始 SHA-256 → GBK 重开中文正确、状态栏一致 → GBK 可表示修改保存后 bytes/HTTP 正确 → 不可表示字符必须阻断且说明具体字符、SHA-256 不变 → UTF-8↔GBK 往返 BOM/换行/未改区域不破坏。
- **WEB-FLOW-04 构建**：Build idle→running→succeeded、busy 正确；summary/history/生成物磁盘确认；制造编译错误 → failed + 真实 diagnostic、点击定位文件/行；修复后再构建成功、历史不丢；Clean & Build / Build and Deploy 语义与标签一致。
- **WEB-FLOW-05 部署与 Tomcat**：Build and Deploy → Deployments 真实记录；Start → running，记录 Server ID/PID/port/startedAt；Open App HTTP 200 内容正确；改 JSP→保存→重部署→页面新内容；Restart 后 logical ID 不变 PID 变；Logs 历史+live tail、Clear 语义、级别分类；Stop 后端口释放进程回收、可再 Start；端口占用/缺 Java/缺 Tomcat/超时均有可执行恢复建议。
- **WEB-FLOW-06 断线/刷新/并发**：杀 agent → 所有视图规定时间 disconnected、按钮错误只出现一次；重启 agent → 自动重连、snapshot 恢复、WS 不重复订阅；build/run 中刷新页面状态与后端一致；双标签同 workspace 行为正确或明确阻止。
- 本 Wave 接线 **WEB-002 JSP 高亮**（Monarch 注册进 composition，验证 scriptlet/EL/JSTL 着色）。

## 8. Wave 4 — 兼容性/性能/安全/稳定性（后台长任务）

- 兼容：WebKit headed 主链全跑；文件名空格/中文/`#`/`&`/括号/长路径，无双重编码；权限拒绝/只读/端口占用反馈；Cmd 快捷键文案（不出现 Ctrl 文案）。
- 性能（每项 ≥5 次，median/p95）：冷启动到可交互 ≤8s；打开 1000 行 Java ≤1s；1000 条日志单次长任务 ≤100ms；断线重连恢复 ≤3s；10000 文件搜索首结果 ≤3s/p95 ≤5s。记录 Browser/Theia/Runtime/JDT/Tomcat CPU/RSS，超 `testdata/perf-baseline.json` 15% 需解释批准。
- 安全：非 loopback 绑定 fail closed；secret 缺失/错误不可访问受保护 API/WS；URL/console/DOM/localStorage/截图不泄漏 secret；workspace 沙箱拒绝 `..`/symlink escape；Deployment/Logs 中 `<script>` 按文本显示；Open App noopener。
- 稳定性：空闲 30 分钟无 CPU 异常、无 WS/定时器线性增长；连续启动/退出 20 次无孤儿 Runtime/JDT/Tomcat/Theia 进程。（后台执行）

## 9. 代码审查与重构线（贯穿，小步可回退）

1. 每步先确认无引用（rg 全仓 + go list），再单独 commit 删除，删除后全量回归。
2. 清单：`apps/browser/src/index.ts`（死文件）、runtime-extension `KairoRuntimeModule` 重复绑定层（并入 WEB-001 统一）、`runtime-agent/internal/api/http_server.go`（无调用方）、`internal/app/` 2244 行死层、jsp `tld-parser.ts`（接线或删）。
3. 顺带修正过时注释（如 `packages/theia-product/src/main/index.ts` "pin to Theia 1.51.x"、`kairo-views-contribution.ts:15-18` 描述不存在的工具条）。

## 10. 防卡死 / 长任务编排

- 每条 shell 命令显式 timeout：静态检查 ≤300s；Go race ≤600s（后台）；UI 用例步进默认 60s；Build/Deploy/Tomcat 步进 ≤300s。
- 子 Agent 固定 30 分钟上限；超时 resume 同一 agent 续跑，不重启。
- 长任务（30 分钟稳定性、20 次进程循环、全量回归、Go race）一律后台执行，完成通知驱动下一步；主线程并行推进其他 Wave。
- 总协调维护 TodoList + `defects.jsonl`；缺陷状态机 `OPEN → FIXING → FIXED_PENDING_RETEST → VERIFIED`，无复测证据不得 VERIFIED。
- 文件所有权：同一时间一个源码文件仅一个 owner；Wave 间由总协调合并并广播新 SHA，子 Agent 切换后再回归。

## 11. 多 Agent 编排

| 角色 | 执行方式 | 分支 | 可修改范围 |
|---|---|---|---|
| 总协调 | 主线：Phase 0、Wave 0、合并、终审 | qa/kimi-mac-web-* | 全部（独占期） |
| M1 UI 盘点修复 | 前台子 Agent（可 resume） | qa/kimi-m1-ui | ui-kit、视图组件、状态栏 |
| M2 业务流 | 前台子 Agent（可 resume） | qa/kimi-m2-flow | feature packages（按缺陷认领） |
| M3 视觉/a11y | 子 Agent，与 M2 并行（文件不重叠） | qa/kimi-m3-a11y | CSS、测试与小范围 a11y |
| M4 独立审阅 | 子 Agent，默认只读 | — | 经协调后修测试 |

## 12. 证据与最终报告

```
artifacts/acceptance-<sha12>/mac-web/
  environment.txt
  commands/<case-id>.{log,json}
  ui-inventory.json
  results.json            # 仅 PASS/FAIL/BLOCKED
  defects.jsonl
  screenshots/<browser>/<viewport>/<theme>/...
  logs/{browser,theia,runtime,jdt,tomcat}/
  perf/
release-verdict.json
manifest.json             # SHA-256 索引全部证据
```

大体积二进制不进 git（`artifacts/acceptance-*` 已 gitignore）；Git 只提交脱敏报告与 manifest 摘要：
`docs/release-testing/reports/<TESTED_COMMIT>/MAC_WEB_FINAL_REPORT.md`，含：被测 commit/环境/命令/起止时间、inventory 总数与操作对账、截图索引、缺陷与修复 SHA、性能原始数据与统计、console/network/page errors、`git status` 干净证明、总协调 + M4 双签字。

## 13. MAC_WEB_GATE（全部为真才 PASS）

- [ ] 基线冻结且全程未偷换；最终回归在最终 SHA 上完成
- [ ] 干净安装、build、unit、Go test/race/vet、lint 全绿且无假绿
- [ ] UI inventory 100% 覆盖，所有按钮/菜单/输入/链接真实操作
- [ ] Chromium headed 全量 + WebKit headed 主链通过
- [ ] 全页面关键状态截图 + 视觉人工复核
- [ ] WCAG AA 对比度、键盘、焦点、200% zoom 通过
- [ ] 导入→编辑→编码→构建→部署→启动→访问→日志→重启→停止闭环通过
- [ ] 成功/失败/loading/empty/disabled/disconnected/reconnect 全状态通过
- [ ] GBK 不可表示字符不破坏原文件（SHA-256 验证）
- [ ] 性能、安全、30 分钟稳定性、20 次进程清理通过
- [ ] P0–P3 缺陷清零并完成全量回归（或书面接受的例外）
- [ ] 无 FAIL、无 BLOCKED、无 SKIP、无 gated
- [ ] 最终报告可由独立 Agent 从零复现
- [ ] SHARED 缺陷清单已移交 Windows 端复验（单端限制如实标注）

任一项未满足 → `MAC_WEB_GATE=FAIL`，继续修复回归，不得提前结束。
