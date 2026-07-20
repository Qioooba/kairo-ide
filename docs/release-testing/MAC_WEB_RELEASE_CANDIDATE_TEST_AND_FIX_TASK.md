# Kairo IDE — macOS 网页版发布候选测试与修复长任务

> - 执行机器：macOS 真机
> - 被测产品：Kairo IDE Localhost Browser/Web 版
> - 执行者：一个总协调 AI Agent + 多个子 Agent
> - 任务性质：发布阻断（Release Gate），不是冒烟演示
> - 审计基线：2026-07-20，`origin/main@8add5b8`
> - 结论规则：本文件全部必测项通过、所有缺陷修复并完成全量回归之前，禁止宣布可交付、禁止上线

## 1. 给总协调 Agent 的唯一目标

你是本机测试与修复总协调 Agent。你必须在 macOS 真机上真实启动 Runtime Agent 和 Web 产品，使用可见浏览器完成点击、键盘、文件选择、滚动、拖拽、截图、视觉检查和完整业务闭环；同时修复发现的问题、补充自动化测试、反复回归，直到本任务所有 Gate 均为 PASS。

本任务不是“写测试计划”或“报告已知问题”。你必须实际执行。没有真实操作证据的项目一律不是 PASS。只请求接口、读取 DOM、搜索源码字符串或看单元测试，不能替代 UI 操作。

### 1.1 绝对规则

1. 两台测试机必须测试同一个提交。开始时记录 `TESTED_COMMIT`；提交修复后，两台机器都切换到新的同一提交并重跑受影响测试与最终回归。
2. 必须从干净工作树开始。若有本地改动，先保存到独立分支或 worktree，不得把未知改动混入测试结果。
3. 必须使用可见浏览器，主链路至少在 Chromium headed 模式完整跑一遍。WebKit/Safari 兼容测试不能只用无头模式。
4. 每个可交互控件都要覆盖可见、可达、点击/输入、结果、禁用、错误和键盘路径；“按钮存在”不等于“按钮有效”。
5. 核心项不得 `skip`、`gated`、`continue-on-error`、`|| true`、吞异常或失败后 `exit 0`。无法执行记为 BLOCKED，BLOCKED 等同发布失败。
6. 截图只能证明外观，不能单独证明业务成功；业务成功还需 UI 状态、文件、进程或 HTTP 结果的独立交叉验证。
7. 不得为了让测试通过而降低断言、删除失败测试、硬编码假数据、mock 整条核心链路或隐藏错误提示。
8. 修复必须有对应回归测试；修复后先跑最小复现，再跑所属 Wave，最后跑全量 Gate。
9. 不上传 secret、Token、用户目录隐私、系统账号、私有项目或完整环境变量。证据中出现敏感信息必须打码。
10. 只有总协调 Agent 能给最终 PASS；子 Agent 只能提供证据和候选结论。

## 2. 当前代码事实与第 0 风险

开始前先验证这些事实，不能盲信旧文档：

- Web 入口是 `apps/browser`，根命令当前包含 `pnpm dev:browser`，默认端口 3000。
- 前一远程基线 `98ba2a3` 曾在正式 frontend module 中提交未解决的冲突标记；当前审计基线 `8add5b8` 已移除该标记，但每个候选 SHA 仍必须执行冲突标记扫描，任何代码命中都按 P0 处理。
- Runtime Agent 正式入口是 `runtime-agent/cmd/kairo-runtime`；当前已有多份 dev config，不能假设某个临时端口配置属于发布版本。
- UI 核心实现分布在 `packages/project-extension`、`build-extension`、`tomcat-extension`、`encoding-extension`、`java-extension`、`theia-product` 和 `ui-kit`。
- 根 `package.json` 当前没有 `test:e2e`，但 `docs/testing.md` 声称有该命令；必须修正文档/脚本一致性。
- `tests/e2e/package.json` 在自身目录中再次引用 `tests/e2e/*.cjs`，通过 workspace filter 执行会得到错误路径；必须先修成真实可执行的命令。
- `tests/e2e/full-chain.cjs` 和 `tests/e2e/api-smoke.cjs` 仍允许 GATED 后退出 0；这些结果不能作为发布证据。
- `.github/workflows/ci.yml` 当前在错误的仓库根运行 Go 命令、引用不存在的 `./cmd/agent`、使用 pnpm 8，并包含 `pnpm lint || true`、占位 checksum 和容错式网络步骤；CI 绿色本身目前不足以证明可发布。
- `scripts/verify-e2e.sh` 直接改写 `legacy-sample/WebRoot/hello.jsp`；运行前必须复制 fixture 到临时目录，禁止污染仓库。
- 仓库已有多批临时截图、probe 和本地报告。它们是历史调查材料，不是本次 `TESTED_COMMIT` 的证据。
- 当前 workspace 审计还观察到以下高风险现象，执行 Agent 必须在固定 `TESTED_COMMIT` 上逐项确认或推翻：Import Wizard/Project Selector 可能未绑定到正式 composition root；顶栏产品工具条缺失；Kairo theme CSS 可能未被入口导入且 class 与实现漂移；通知出现近白底/白字；只强制 Dark 且 accent 与设计稿冲突；多数状态栏项无 command；Build/Server 按钮在实拍中拥挤换行。
- 旧 “139 PASS” 报告通过 `window.theia`/container 直接 execute command，Java completion/F12/GBK bytes 也未被严格验证；不得引用为发布证据。

以上任一事实变化时，以实际代码为准，更新本任务的最终报告。

## 3. 多 Agent 编排与文件所有权

总协调 Agent 创建下列子任务。若平台只允许较少并发数，按 Wave 依次执行；不得省略角色。

| 子 Agent                     | 职责                                                     | 可修改范围                                         | 必交付                             |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| M0 基线与测试基础设施        | 环境、干净构建、现有测试真实性、启动脚本、证据框架       | `package.json`、`tests/`、`scripts/`、CI（需独占） | 基线结果、修复后的统一测试入口     |
| M1 UI/视觉/响应式            | 全页面、全状态、颜色、对比度、布局、图标、字体、截图比较 | CSS、`ui-kit`、纯 UI 组件（需独占）                | UI inventory、截图集、视觉缺陷修复 |
| M2 交互与完整业务流          | 导入、编辑、编码、构建、部署、Server、日志、重连         | 对应 feature package（按缺陷认领）                 | 可重复的 UI E2E、业务证据          |
| M3 可访问性/键盘/兼容性/性能 | axe、Tab 顺序、焦点、缩放、Chromium/WebKit、长文件和日志 | 测试与小范围 a11y 修复                             | a11y/兼容/性能报告                 |
| M4 独立回归审阅              | 不参与首轮实现，审查修复、复跑高风险用例                 | 默认只读；经协调后修测试                           | 独立复核结果、遗漏清单             |

协作规则：

- 每个 Agent 使用独立分支或 git worktree，例如 `qa/mac-m1-ui`；同一时间一个源码文件只能有一个 owner。
- 先提交最小复现测试，再提交修复；commit message 写明用例 ID。
- 总协调 Agent 每轮合并后广播新的 commit SHA，其他 Agent 必须 rebase/切换到该 SHA 再回归。
- 缺陷状态只允许 `OPEN → FIXING → FIXED_PENDING_RETEST → VERIFIED`；没有复测证据不得写 VERIFIED。
- 出现产品定义不清时，以“用户是否能理解并成功完成任务”为裁决；不要用源码注释替用户解释 UI。

## 4. 测试目标冻结与环境记录

在报告开头保存下面输出：

```bash
git fetch origin --prune
git status --short
git rev-parse HEAD
git rev-parse origin/main
git log -1 --format='%H%n%cI%n%s'
rg -n '^(<<<<<<< |=======$|>>>>>>> )' --glob '!pnpm-lock.yaml' --glob '!bundled/tomcat6/**'
sw_vers
uname -m
node --version
pnpm --version
go version
java -version
```

应在全新 clone 中从固定 SHA 建 `qa/mac-web-<date>-<shortsha>` 分支；测试途中禁止 `pull/rebase` 偷换基线。产品修复、test harness、报告分开 commit，并开 Draft PR。合并/冲突解决后原证据失效，按受影响矩阵重跑；shared/core 改动两机全回归。

设置并记录：

```bash
export TESTED_COMMIT="$(git rev-parse HEAD)"
export KAIRO_QA_ROOT="$(mktemp -d /tmp/kairo-mac-web-qa.XXXXXX)"
```

不得把 `$HOME` 或仓库根目录作为清理目标。所有测试项目、数据目录和日志写入 `KAIRO_QA_ROOT`。复制 `legacy-sample` 后再做破坏性编码、删除和部署测试。

记录显示器型号、分辨率、缩放、DPR、浏览器版本、macOS 深/浅色、是否使用外接屏。至少覆盖：

- Chromium/Chrome 当前稳定版：1440×900 或接近的主显示器，DPR 2（主门禁）。
- Chromium：1280×720 与 1920×1080 viewport。
- WebKit/当前 Safari：主链最小闭环、菜单、文件选择、编辑、构建、Server、日志。
- 200% 浏览器缩放；至少一次 100% 和 125%。
- Kairo Dark；若产品暴露 Light/High Contrast，则全部覆盖。若入口存在但主题不可用，记缺陷。

## 5. Wave 0 — 可信基线与启动

### M0-01 干净安装与静态 Gate

按实际 `packageManager` 使用 Node 20.x、pnpm 9.15.9；Go 版本与 `runtime-agent/go.mod` 的 1.22 统一，不要擅自用 npm/yarn或把本机其他版本冒充目标环境：

```bash
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm -r --filter "./packages/*" exec tsc --noEmit
git diff --check
```

然后进入 `runtime-agent` 执行：

```bash
gofmt -l $(rg --files -g '*.go')
go vet ./...
go test -count=1 -timeout 300s ./...
go test -race -count=1 -timeout 420s ./...
go build -trimpath -o bin/kairo-runtime ./cmd/kairo-runtime
```

补跑真实 contract/fault/perf 与 integration Gate；若文件/命令在候选分支不存在，应先修测试基础设施而不是跳过：

```bash
pnpm test:agent:integration
node --test tests/contract/contract.test.cjs
node --test tests/contract/eventstream.test.cjs
node --test tests/fault/fault-injection.test.cjs
node --test tests/perf/perf-baseline.test.cjs
```

验收：每条命令 exit 0；`gofmt -l` 无输出；无隐藏 skip。若脚本和实际路径不一致，先修测试基础设施。不得把依赖下载失败、旧入口、checksum 占位符降级为 PASS。

### M0-02 现有测试真实性审计

逐一审计 `package.json`、`tests/e2e/package.json`、`tests/e2e/*.cjs`、`scripts/verify-e2e.*` 和 `.github/workflows/ci.yml`：

- 列出所有 skip/gated/soft pass/吞异常/源码正则测试/只调 API 的“UI 测试”。
- 核心测试失败必须非零退出；teardown 容错可以保留，但要与断言逻辑分开。
- 建立真实可运行的根命令，例如 `test:e2e:web`、`test:visual:web`、`test:a11y:web`；同步修复 `docs/testing.md`。
- 修复 workspace `@kairo/e2e` 的 cwd/脚本路径，并从仓库根真实执行一次；不能仅直接 `node tests/e2e/foo.cjs` 绕过坏 script。
- 测试必须从临时 fixture 运行；结束后确认 `git status --short` 与开始前一致。
- 浏览器 console error、page error、failed request、未处理 Promise rejection 默认使测试失败；明确允许的第三方噪音要精确白名单并解释。

### M0-03 真实启动

分别启动 Runtime Agent 和 Web 产品，保存完整日志，不要复用未知旧进程：

```bash
go -C runtime-agent build -trimpath -o bin/kairo-runtime ./cmd/kairo-runtime
pnpm agent:run
pnpm dev:browser
```

若实际配置/端口要求不同，修成仓库内可复现命令并记录。必须验证：

- 监听地址只在 `127.0.0.1`，没有意外暴露 `0.0.0.0`。
- `/api/v1/health` 健康；前端 shell 可交互；Runtime 状态由 connecting 变 connected。
- 刷新页面、关闭重开浏览器后可恢复；旧进程和端口都能回收。
- Runtime 未启动时 UI 明确显示 disconnected，按钮状态和错误反馈合理，页面不能无限 Loading。

## 6. Wave 1 — UI 全量盘点与逐控件点击

### 6.1 先生成 UI inventory

不要只依赖下表。运行产品后动态遍历所有菜单、命令面板、侧栏、标签页、对话框和状态栏，生成 `ui-inventory.json`，每项至少包含：

```json
{
  "id": "WEB-UI-0001",
  "surface": "Kairo Build View",
  "control": "Build",
  "selector": "[data-testid=build-button]",
  "role": "button",
  "states": ["default", "hover", "focus", "pressed", "disabled", "busy", "error"],
  "expected": "starts one build and exposes progress/result",
  "evidence": []
}
```

inventory 数量必须与运行时可交互元素数量对账。所有 `<button>`、`a[href]`、`input`、`select`、菜单项、命令、tab、状态栏可点击项和 Monaco 控件都必须有归属；新增控件必须自动进入失败清单，避免漏测。

### 6.2 当前代码中已知的必测产品面

| 区域                      | 必测控件/状态                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Workbench shell           | 标题 Kairo IDE、菜单栏、活动栏、文件树、编辑区、面板、通知、对话框、状态栏、窗口缩放                                                       |
| File/Edit/View 等标准菜单 | 每个可见菜单项至少真实触发一次；不可用项正确 disabled；不能出现 “No command exists”                                                        |
| 命令面板                  | F1/Cmd+Shift+P；所有 `Kairo:` 命令可发现、可执行、错误可理解                                                                               |
| Import Wizard             | 4 步进度；Open Workspace Folder、Continue/Create New、名称输入、Source Level、Encoding、Build Tool、Save Configuration、错误和 saving 状态 |
| Project Selector          | 打开/关闭、无项目、项目名/路径、点击外部关闭、键盘 Escape/Enter                                                                            |
| 首屏与产品工具条          | Import Wizard/Project Selector 必须从正式入口可达；设计要求的 Build/Deploy/Server 等顶栏入口若缺失或不可发现，记 P1                        |
| Build View                | loading/disconnected/idle/pending/running/succeeded/failed/cancelled；Build、Clean & Build、summary、diagnostics、history                  |
| Server View               | loading/disconnected/stopped/starting/running/stopping/error/crashed；Start、Stop、Restart、Open App、URL、PID、时间、server list          |
| Deployments View          | empty、50 行上限、列标题、长 ID、失败/成功状态、文件数/字节、trigger、reload 模式、滚动                                                    |
| Server Logs               | empty、单/多 server selector、Clear、自动滚动/用户上滚暂停、error/warning/info 色彩、500 可见/1000 保存上限                                |
| Status bar                | Project、Java、JDT LS、Encoding、Server、Runtime；connecting/open/disconnected/closed；tooltip 与实际一致                                  |
| Encoding commands         | Reopen with Encoding、Save with Encoding、Show File Encoding；UTF-8/GBK/GB18030/ISO-8859-1；不可表示字符拒绝且原 bytes 不变                |
| Editor                    | 新建/打开/保存/另存/撤销/重做/剪切/复制/粘贴/查找；Java/JSP/CSS/JS；dirty 标识和关闭确认                                                   |
| Java/JSP                  | completion、definition/F12、diagnostics、语法色、JDT 启动/崩溃/恢复；不能把 skeleton 文案当完成功能                                        |
| Large file                | 阈值提示、Toggle Full Editor Features、滚动、搜索、关闭，无明显卡死                                                                        |
| Theme                     | Kairo Dark 的菜单/编辑器/侧栏/按钮/状态标签/链接/输入/焦点/selection/scrollbar/notification                                                |

特别验证：正式 frontend module 是否真正绑定并显示 Import Wizard 与 Project Selector；主题 CSS 是否进入最终 bundle；所有状态栏项若视觉上暗示可点击就必须绑定真实 command，否则改成非交互样式；通知文字/背景必须达到对比度；Build 与 Server 工具栏在 1280×720 和 200% zoom 下不能换行遮挡。

### 6.3 每个按钮的统一验收模板

对 inventory 中每个按钮/菜单项重复以下步骤并保存用例 ID：

1. 截图默认状态，读取 accessible name、role、enabled、bounding box。
2. 鼠标 hover 截图；确认 hover 不是只靠轻微颜色变化且文字不抖动。
3. Tab 到控件并截图 focus；焦点环清晰、顺序符合视觉顺序。
4. 按 Enter/Space（按控件语义）执行一次，再用鼠标真实 click 执行一次。
5. 断言只触发一次，没有 double submit；busy 时阻止重复点击。
6. 验证成功结果和失败结果；通知/错误不能瞬间消失到不可读。
7. 验证 disabled 条件；disabled 仍可点击或没有原因提示均记录缺陷。
8. 窄 viewport、200% zoom、长中文/英文内容下不截断、不重叠；必须截断时提供 tooltip。
9. 检查 console、network、Runtime/Theia 日志无新增错误。

## 7. Wave 2 — 视觉、样式和可访问性门禁

### 7.1 截图矩阵

每个主要页面至少保存：空、加载、正常、hover、focus、disabled、busy、成功、错误、断连、长内容。命名：

`<commit>/<browser>/<viewport>/<theme>/<case-id>-<state>.png`

至少包括全窗口截图和目标组件裁剪图。动画/光标稳定后再截图，不能用随意 timeout 掩盖竞态。为稳定区域建立 visual diff；时间、PID、端口等动态区使用最小 mask，并在报告说明。

### 7.2 视觉人工审查清单

- 对齐：8px/4px 基础节奏一致；标题、表格列、按钮组、状态图标基线对齐。
- 密度：720p 下核心按钮仍可见；无水平滚动泄漏；面板 resize 后内容合理重排。
- 层级：主/次按钮、危险 Stop、链接、disabled、loading 有明确区别。
- 文案：同一概念大小写一致，例如 Server/Servers、Build & Deploy；中文系统环境不出现乱码或 tofu 字符。
- 颜色：状态不能只靠红/绿；同时使用文字/图标。错误、warning、success 在深色主题均可辨认。
- 图标：Codicon/Unicode 不裁切、不变成 emoji 风格导致尺寸跳动；Retina 下清晰。
- 滚动：日志、表格、文件树、编辑器各自滚动区域不抢滚轮；sticky/header 不遮内容。
- 对话框/通知：z-index 正确，不被编辑器覆盖；Escape 和关闭按钮都工作。
- 窗口 resize：从 1920×1080 缩至 1280×720，再恢复，无永久布局破坏。

### 7.3 对比度和无障碍

使用 axe（或等效工具）加人工键盘检查。最低要求：

- 普通文字 WCAG AA 对比度至少 4.5:1，大文字至少 3:1；控件边界和焦点指示至少 3:1。
- 所有交互控件有非空 accessible name；图标按钮有 `aria-label`；装饰图标不重复朗读。
- DOM 中无重复 ID；label 与 input/select 正确关联；错误区域有 `role=alert` 或合理 live region。
- 只用键盘可以完成导入→编辑→构建→部署→启动→停止主链；无 keyboard trap。
- Tab 顺序与布局一致；焦点不会在视图刷新、日志追加或状态更新时丢失。
- 200% zoom 下无信息丢失；系统 Reduced Motion 下无不必要持续动画。
- Monaco 编辑器、菜单、命令面板和树控件使用其原生键盘语义，不用坐标点击冒充可访问性。

## 8. Wave 3 — 完整 UI 业务流程

所有流程的主体只允许操作 UI。直接 API 只用于启动前 health 和完成后的独立交叉验证。

### WEB-FLOW-01 首次导入

1. 新数据目录冷启动，确认 Welcome/无 workspace 状态合理。
2. 打开 Import Wizard，真实使用 macOS 文件选择框选择临时复制的 `legacy-sample`。
3. 验证扫描 loading、检测结果或“未发现配置”分支。
4. 测试空名称、超长名称、中文名称、各 Source Level/Encoding/Build Tool 选项。
5. 保存配置；验证 wizard 关闭、Project 状态栏和 selector 更新、磁盘配置实际存在且可重开。
6. 故意让 Runtime 断开后保存，验证错误可见、表单值不丢；恢复后可重试且只创建一个项目。

### WEB-FLOW-02 文件与编辑器

1. 展开/折叠文件树，打开 Java、JSP、properties、CSS、JS。
2. 逐项验证 File/Edit 菜单和快捷键；新建、重命名、复制、删除均在临时 fixture 中执行。
3. 验证 dirty、auto save（若暴露）、关闭未保存确认、刷新页面后的恢复策略。
4. Java completion 与 F12 必须出现真实结果；JSP/Servlet 语法高亮和 diagnostics 可读。
5. 构造 1MB/10MB 文件验证大文件模式、滚动、搜索和恢复完整功能。

### WEB-FLOW-03 编码安全

1. 记录 GBK fixture 原始 SHA-256 和 bytes。
2. UI 以 GBK 重新打开，确认中文正确；Show File Encoding 与状态栏一致。
3. 修改为 GBK 可表示文字并保存；重开、bytes 解码和 HTTP 输出均正确。
4. 输入 GBK 不可表示字符；UI 必须阻止损坏性保存并说明具体字符/编码，文件 SHA-256 不变。
5. Save with Encoding 转 UTF-8，再转回 GBK；检查 BOM、换行和未修改区域不被破坏。

### WEB-FLOW-04 构建成功与失败

1. 在 UI 点击 Build，观察 idle→pending/running→succeeded；按钮 busy 状态正确。
2. 验证 summary、history、时间和生成物；从磁盘确认 class/artifact 存在。
3. 制造编译错误再 Build，必须显示 failed 和真实 diagnostic；点击 diagnostic 能定位正确文件/行。
4. 修复源码后再 Build 成功；历史不丢、错误清除逻辑合理。
5. 点击 Clean & Build/Build and Deploy，确认语义与标签一致，不能按钮写 clean 实际执行 deploy 而无说明。

### WEB-FLOW-05 部署与 Tomcat 闭环

1. UI 发起 Build and Deploy，Deployments View 出现真实记录、文件数和字节。
2. Start Server，观察 starting→running；记录 UI 中 Server ID/PID/port/startedAt。
3. Open App 必须打开实际应用；验证 servlet/JSP HTTP 200 和内容。
4. UI 修改 JSP、保存、重新部署，浏览器实际页面出现新内容。
5. Restart 后 logical Server ID 不变、PID/startedAt 改变；端口策略与产品定义一致。
6. Logs 显示真实历史和 live tail；Clear 只清 UI 或后端的语义要明确；错误/警告分类正确。
7. Stop 后状态 stopped、端口释放、进程树回收；再次 Start 仍成功。
8. Tomcat 端口占用、缺少 Java/Tomcat、启动超时都要有可执行的恢复建议，不能只弹“failed”。

### WEB-FLOW-06 断线、刷新和并发

1. 在 UI 可见时终止 Runtime Agent；状态栏和所有视图在规定时间进入 disconnected。
2. 点击各核心按钮，错误只出现一次且可理解；不能静默无响应。
3. 重启 Runtime；验证自动重连、snapshot 恢复、WebSocket 不重复订阅、列表不重复。
4. build/run 中刷新页面，重新加载后状态与后端真相一致。
5. 两个浏览器标签打开同一 workspace，验证事件、并发操作和关闭行为；若产品不支持，要明确阻止而不是数据竞争。

## 9. Wave 4 — 兼容性、性能、安全和稳定性

### 9.1 兼容性

- Chromium 与 WebKit/Safari 主链行为一致；不接受只有 Chromium 可用而文档未声明。
- 文件名/路径覆盖空格、中文、`#`、`&`、括号和长路径；不得出现 URL/path 双重编码。
- macOS 权限拒绝、只读文件、无执行权限、端口占用有清晰反馈。
- Cmd 快捷键遵循 macOS，不把 Windows Ctrl 文案直接显示给用户。

### 9.2 性能

在固定机器状态下每项至少运行 5 次，报告 median/p95：

| 指标                                   |                                         Gate |
| -------------------------------------- | -------------------------------------------: |
| 冷启动到 shell 可交互                  |                                         ≤ 8s |
| 打开 1000 行 Java（不含首次 JDT 下载） |                                         ≤ 1s |
| 1000 条日志持续进入时单次主线程长任务  |                                      ≤ 100ms |
| Runtime 断开后重连并恢复 snapshot      |                                         ≤ 3s |
| 10,000 文件搜索首个结果/p95            |                                  ≤ 3s / ≤ 5s |
| 空闲 30 分钟                           | 无持续 CPU 异常、无 WebSocket/定时器线性增长 |

同时记录 Browser、Theia、Runtime、JDT、Tomcat 的 CPU/RSS。超过历史基线 15% 视为回归，需解释并批准，不能静默更新 baseline。

### 9.3 安全

- Runtime 非 loopback 绑定必须 fail closed；secret 缺失/错误不能访问受保护 API/WS。
- 浏览器 URL、console、DOM、localStorage、截图、错误通知不能泄漏 secret。
- workspace sandbox 拒绝 `..`、symlink escape 和 workspace 外路径。
- HTML/文件名/日志含 `<script>` 等内容时按文本显示，不能在 Deployment/Logs 视图执行。
- Open App 使用安全新窗口行为；外链不获得 opener。
- 连续运行/退出 20 次，无孤儿 Runtime/JDT/Tomcat/Theia 进程。

## 10. 缺陷修复协议

双机统一 ID 使用 `KAIRO-RC-WEB-NNN`、`KAIRO-RC-WIN-NNN`、`KAIRO-RC-SHARED-NNN`；统一状态机为 `NEW → TRIAGED → IN_FIX → FIX_READY → VERIFY_ORIGIN → VERIFY_PEER → CLOSED`。`SHARED` 缺陷必须由另一台机器复验；protocol/runtime/theme/composition/desktop-host 等 shared/core 改动强制两机全量回归。

每个缺陷创建一条记录：

```text
ID: KAIRO-RC-WEB-001
TESTED_COMMIT:
环境/浏览器/viewport/theme:
严重级别: P0/P1/P2/P3
前置条件:
最小复现步骤:
实际结果:
期望结果:
证据: screenshot/video/trace/log
根因:
修复文件与 commit:
新增回归测试:
最小复测:
Wave 回归:
全量回归:
状态:
```

级别：P0 数据破坏/安全/无法启动；P1 核心闭环阻断、按钮无效、严重 UI 不可用；P2 明显错误但有可接受绕行；P3 轻微视觉/文案。P0/P1/P2 必须修复才能发布；P3 也应在本轮清零，若确需延期必须由产品负责人书面接受且不影响可用性/a11y。

修复时禁止跨 Agent 抢文件。总协调 Agent 先分配 owner。每个修复 commit 要小而可回退，不能夹带重构；若根因需要架构调整，先添加 failing test 再分阶段改。

## 11. 证据与最终报告

本机证据目录（默认不直接提交二进制大文件）：

```text
artifacts/acceptance-<TESTED_COMMIT前12位>/
  manifest.json
  defects.jsonl
  release-verdict.json
  mac-web/
    environment.txt
    commands/<case-id>.log
    commands/<case-id>.json
    ui-inventory.json
    results.json
    screenshots/<browser>/<viewport>/<theme>/...
    videos/
    traces/
    logs/{browser,theia,runtime,jdt,tomcat}/
    perf/
    defects/
```

每条命令的 JSON 记录 command/args/cwd/start/end/elapsed/exitCode/commit；`manifest.json` 用 SHA-256 索引全部 evidence。大体积截图/HAR/trace/安装产物保持在已被 `.gitignore` 排除的 acceptance 目录并上传到受控 PR/Actions artifact；Git 只提交脱敏报告和 manifest 摘要。

最终将精简报告提交到：

`docs/release-testing/reports/<TESTED_COMMIT>/MAC_WEB_FINAL_REPORT.md`

`results.json` 每个用例只能是 PASS/FAIL/BLOCKED，不允许 SKIP。报告必须包含：

- 被测 commit、环境、命令、开始/结束时间；
- inventory 总数、已操作数、PASS/FAIL/BLOCKED；
- 每个页面/状态的截图索引；
- 缺陷列表、修复 SHA、回归测试；
- 性能原始数据与统计；
- console/network/page errors；
- `git status --short` 证明测试未污染源码；
- 总协调和独立回归 Agent 的双重签字结论。

## 12. Mac/Web 发布 Gate

以下全部为真才可写 `MAC_WEB_GATE=PASS`：

- [ ] 两台机器最终测试的是同一个 commit SHA
- [ ] 干净安装、build、unit、Go test/race/vet、lint 全绿且无假绿
- [ ] UI inventory 100% 覆盖，所有按钮/菜单/输入/链接均真实操作
- [ ] Chromium 全量与 WebKit/Safari 主链通过
- [ ] 所有页面和关键状态有截图，视觉 diff 已人工复核
- [ ] WCAG AA 对比度、键盘、焦点、200% zoom 通过
- [ ] 导入→编辑→编码→构建→部署→启动→访问→日志→重启→停止完整闭环通过
- [ ] 成功、失败、loading、empty、disabled、disconnected、reconnect 均通过
- [ ] GBK 不可表示字符不会破坏原文件
- [ ] 性能、安全、30 分钟稳定性和 20 次进程清理通过
- [ ] P0/P1/P2/P3 缺陷均已修复并完成全量回归，或只有书面接受且不影响发布的例外
- [ ] 无 FAIL、无 BLOCKED、无 SKIP、无 gated
- [ ] 最终报告和证据可由另一位 Agent 从零复现

只要任一项未满足，最终结论必须是 `MAC_WEB_GATE=FAIL`，并继续修复和回归，不能提前结束任务。
