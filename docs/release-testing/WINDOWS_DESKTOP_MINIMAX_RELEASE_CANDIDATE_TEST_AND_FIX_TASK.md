# Kairo IDE — Windows 桌面版 MiniMax Code 真机测试与修复长任务

> - 执行机器：Windows 10/11 x64 真机，必须有可见、已解锁的交互桌面
> - 被测产品：Kairo IDE Windows NSIS 安装版与 ZIP/portable 版
> - 执行者：MiniMax Code 总协调 Agent + 多个独立子 Agent/会话
> - 任务性质：发布阻断（Release Gate），不是接口冒烟或静态审查
> - 审计基线：2026-07-20，`origin/main@8add5b8`
> - 结论规则：真实安装、真实窗口、真实点击、视觉与完整闭环全部通过，缺陷修复并全量回归后才能上线

## 1. 给 MiniMax Code 总协调 Agent 的唯一目标

你必须在这台 Windows 真机上构建并安装 Kairo IDE，通过 Windows 可见桌面真实操作产品：启动 EXE、点击菜单和按钮、输入、键盘导航、操作原生文件选择框、调整窗口、截图/录像、检查颜色与布局、运行完整 Java/Tomcat 流程、退出和卸载。发现问题后必须修改代码、补回归测试、重新构建安装包并复测，直到本文全部 Gate 为 PASS。

只读代码、调用 HTTP API、无头 DOM 测试或生成测试建议都不算完成。若你不能访问 Windows 交互桌面或不能执行 UI Automation 命令，必须结论 `WINDOWS_DESKTOP_GATE=BLOCKED`，不得声称“从代码看应该通过”。

### 1.1 绝对规则

1. Mac 和 Windows 最终必须测试同一个 commit SHA。修复后的新 SHA 要广播给 Mac 机重新回归。
2. 从干净 clone/worktree 开始；不得把未知本地文件、旧 EXE、旧截图或旧日志当作当前版本。
3. 发布门禁必须测试真正生成的 NSIS 安装包；`pnpm start` 或直接跑 dev Electron 只能用于定位，不能替代安装版。
4. 所有可交互 UI 都要真实操作。控件存在、命令已注册、HTTP 200 都不等于用户流程成功。
5. 核心项不得 skip/gated/soft pass/吞异常/降级为 dev binary/失败后 exit 0。缺依赖、缺权限、缺工具均为 BLOCKED。
6. 原生对话框在最终 Gate 中不得 mock。可以在低层单元测试 mock，但文件选择、安装、卸载、确认和打开浏览器必须至少真机跑一次。
7. 每个缺陷先保留最小复现证据，再修复；不得删除失败测试、降低断言或硬编码假状态。
8. 每次修复后重新打包并安装新的 artifact；不能只在源码/dev 模式验证。
9. 证据必须绑定 commit、安装包 SHA-256、Windows build、DPI、分辨率和时间。
10. 禁止上传 secret、完整环境变量、Windows 用户名/私人路径、浏览器账号信息或非测试项目数据。

## 2. MiniMax Code 如何真实操作 Windows

### 2.1 首选方案：Microsoft WinApp CLI + Playwright Electron 双层驱动

这是本任务的强制首选组合，不需要 MiniMax Code 自带“看屏幕/鼠标”能力：让 Agent 通过 Shell 调用 Windows UI Automation CLI，CLI 再操作真实桌面。

1. **黑盒/原生层：Microsoft WinApp CLI**
   - 官方文档说明 `winapp ui` 可读取 live accessibility tree、查找元素、点击/invoke、输入、等待状态和截图，适用于 Electron 与 Windows 原生窗口。
   - 它能操作 NSIS、Windows 文件选择框、Kairo 窗口和外部浏览器，并用退出码形成真实断言。
   - `ui click` 在控件无 InvokePattern 时会使用真实鼠标模拟；最终抽样用例必须包含 click 而不只是 invoke。
2. **Electron 渲染层：Playwright `_electron` 或 CDP**
   - 用于稳定定位 Theia/React/Monaco 控件、读取 computed style、浏览器 console/network/page errors、生成 trace/video 和视觉 diff。
   - Playwright 官方 Electron 支持可启动真实 Electron executable、获得真实窗口、点击并截图；但原生 dialog 不由 Playwright 接管，所以必须由 WinApp CLI 完成。
3. **人工视觉复核**
   - AI 根据截图审查布局、颜色、截断、重叠和信息层级；最后由独立回归 Agent 复核高风险截图。

官方依据：

- Microsoft AI-assisted Windows UI testing：<https://learn.microsoft.com/windows/apps/develop/ai-assisted/testing>
- Microsoft WinApp CLI UI automation：<https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md>
- Playwright Electron：<https://playwright.dev/docs/api/class-electron>
- Microsoft UI Automation：<https://learn.microsoft.com/windows/win32/winauto/entry-uiautocore-overview>

安装并验证：

```powershell
winget install --id Microsoft.WinAppCLI --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
winapp --version
winapp ui list-windows
```

如果 `winget` 不可用，按 Microsoft WinApp CLI 官方仓库发布方式安装并记录版本/hash。不要从未知镜像下载二进制。

### 2.2 MiniMax Code 的运行前提

- 先做 2 分钟能力探针：全屏截图 → 启动 Notepad → 输入本轮随机 sentinel → 读取/截图确认 sentinel → 关闭并选择不保存。必须保存动作日志和前后截图；任何一步无法完成即 BLOCKED，证明 Agent 只有 Shell 不能算通过。
- Agent 必须运行在当前登录用户的交互会话中，桌面保持解锁；Session 0、Windows service、断开后冻结图形的 RDP 会话不合格。
- 屏幕测试期间关闭通知弹窗、聊天软件和自动锁屏；不得改变系统安全策略或关闭 Defender 来“解决”产品问题。
- MiniMax Code 需要 Shell/PowerShell 执行权限和仓库写权限；WinApp CLI 只绑定本机窗口，不开放远程监听。
- UI 脚本先用 `winapp ui inspect/search --json` 获取稳定 selector/HWND，再点击；只在无法暴露 accessibility element 的 Canvas/Monaco 点位使用坐标，并保存前后截图和窗口几何信息。
- Electron 若未暴露完整 UIA tree，开发调试启动可加 `--force-renderer-accessibility`；发布包仍需验证默认启动是否可访问。需要测试 flag 才能访问是产品 a11y 缺陷，不是通过。
- UAC secure desktop 不能被普通 UI Automation 绕过。当前 NSIS 配置是 per-user，正常安装不应要求 UAC；若出现 UAC，记录为安装缺陷。确需确认时由用户只点击系统 UAC，Agent 继续其余步骤，不得关闭 UAC。
- 测试必须使用专用 Windows OS 账户或可回滚 VM；不得删除普通用户真实 `%APPDATA%`/`%LOCALAPPDATA%` Kairo 数据。所有清理只针对本轮可证明属于 QA 的目录。
- GUI 同一时间只能有一个 UI lease owner；其他 Agent 可以并行审代码/修复，但不能并发移动鼠标、切焦点或关闭窗口。

### 2.3 首选工具不可用时的备选

按顺序使用：

1. Appium Windows Driver + Microsoft WinAppDriver，使用 UIA/AccessibilityId 驱动真实窗口。
2. Power Automate Desktop recorder，录制和回放真实 Windows UI 流程。
3. 远程桌面 Computer Use/视觉鼠标 Agent，但必须保留视频、截图、动作日志，并额外用 UIA/DOM 验证结果。

纯 AutoHotkey/坐标点击只能作为最后补充，不能成为全套测试的唯一依据。若以上均无法接入，让人类按 Agent 步骤手工操作属于“人工协作测试”，可以提供证据，但不得标为“MiniMax 全自动真机测试”。

## 3. 当前代码事实与必须先解决的风险

- Desktop 入口为 `apps/desktop/src/main.ts`，目标是 Electron 主进程管理 Theia backend 与 Go Runtime Agent。
- 前一远程基线 `98ba2a3` 曾在正式 frontend module 中提交未解决的 Git 冲突标记；当前审计基线 `8add5b8` 已移除该标记，但每个候选 SHA 仍必须扫描，任何代码命中都按 P0 处理。
- Windows 构建命令是 `pnpm --filter @kairo/desktop build:win`；配置声明 NSIS 与 ZIP target，并携带 `runtime-agent/bin/kairo-runtime.exe`。
- 仓库同时存在 `apps/desktop/package.json` 内嵌 build 配置和 `apps/desktop/electron-builder.yml`，两者可能漂移；必须验证实际生效配置和最终包内容。
- `build:win` 当前不会自动触发通用 `prebuild`，因此 build-agent/copy-browser-artifacts/copy-bundled 可能没有执行；copy 脚本又可能在输入缺失时仅 WARN。发布构建必须新增严格的 Windows prepare 前置或显式运行并检查这些步骤，禁止把陈旧/缺失 `lib` 打包成功。
- `electron-builder.yml` 当前 files 清单未包含 `bundled/**`，又与 `package.json#build` 重复；解包必须核对最终生效清单和 bundled Tomcat/JDT（若产品宣称内置）。
- `scripts/verify-e2e.ps1` 当前会跳过 53 个 Windows file-I/O 测试，打包失败时还会降级到 dev binary；这不能作为发布 Gate。
- `scripts/test-agent.js` 也会在 Windows 跳过同一批测试；发布前必须修复根因或建立等价真机覆盖，不能继续把 skip 当绿。
- 现有 `phase0-*` 脚本多处捕获错误后继续并最终 `exit 0`；只能作为调查辅助，不能作为最终 PASS。
- CI 中存在旧路径、占位 checksum、`pnpm lint || true` 和容错下载；Windows 真机结果必须独立于当前 CI 假绿。
- `apps/desktop/src/main.ts` 用日志正则发现 Theia 端口，并用 `taskkill /T /F` 清理进程；必须重点做端口、异常启动、退出与进程树回收测试。
- 当前源码把 session secret 作为 `--secret` argv 传给 Agent，preload 还暴露 `window.kairoConfig.agentSecret`；Go 已支持环境 secret。该问题按 P0 处理，修复后必须证明 secret 不在进程命令行、renderer global/DOM/storage、URL、日志或证据中。
- production CSP 路径与 Theia/AJV 的 eval 需求有冲突风险，且窗口创建未形成可靠的 await/异常链；安装版必须证明无 splash 卡死/白屏，加载失败有明确可恢复错误。
- 当前没有真实 Windows Desktop/Electron UI 自动化；旧“139 PASS”主要测试 localhost browser、直接 execute command 或无条件 pass，不能作为安装版证据。
- 已知 UI 错配必须定向回归：Project Selector 不能真实切多项目；Deployment 仍用 `innerHTML`；Clean Build 实际触发 Build and Deploy；Server UI 取首个 server 而 Stop/Restart 可能遍历全部；Import Wizard 显示 4 步但只有 1–3；F1 中 Kairo 命令可能不可发现；diagnostic 可能不可点击定位。
- 本地仓库已有旧 EXE、截图和报告时，必须按 SHA-256 和生成时间隔离，不能误测旧包。

## 4. 多 Agent 编排与文件所有权

总协调 Agent 至少组织下列独立角色。MiniMax Code 若无内置子 Agent，启动多个独立会话/worktree 依次完成；不得由同一上下文假装多角色签字。

| 子 Agent              | 职责                                                            | 可修改范围                       | 必交付                                |
| --------------------- | --------------------------------------------------------------- | -------------------------------- | ------------------------------------- |
| W0 构建/安装/生命周期 | 环境、clean build、NSIS/ZIP、升级/卸载、进程清理                | desktop build/scripts/CI（独占） | artifact hash、安装矩阵、生命周期修复 |
| W1 Windows UI 自动化  | WinApp CLI harness、native dialogs、全控件 inventory、截图/录像 | `tests/windows-ui/`、测试脚本    | 可重复 UIA 用例与证据                 |
| W2 产品主链           | 导入、编辑、编码、构建、部署、Server、日志                      | feature package（缺陷认领）      | 完整 UI 闭环与修复                    |
| W3 视觉/a11y/DPI      | 主题、对比度、缩放、键盘、高对比度、截图 diff                   | UI/CSS/a11y（独占）              | 视觉与 a11y 报告                      |
| W4 稳定性/安全/性能   | 崩溃、端口、权限、长路径、重启、资源、secret                    | runtime/desktop/test             | fault/perf/security 证据              |
| W5 独立回归审阅       | 不参与首轮实现，复跑安装包和关键主链                            | 默认只读                         | 独立签字和遗漏清单                    |

每个源码文件同一时间只有一个 owner。所有 Agent 使用独立 branch/worktree；总协调合并后提供新的 `TESTED_COMMIT`。缺陷状态为 `OPEN → FIXING → FIXED_PENDING_RETEST → VERIFIED`，不得跳步。

## 5. 测试目标冻结与环境记录

```powershell
git fetch origin --prune
git status --short
git rev-parse HEAD
git rev-parse origin/main
git log -1 --format='%H%n%cI%n%s'
rg -n '^(<<<<<<< |=======$|>>>>>>> )' --glob '!pnpm-lock.yaml' --glob '!bundled/tomcat6/**'
Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsArchitecture
Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution
node --version
pnpm --version
go version
java -version
winapp --version
```

应在全新 clone 中从固定 SHA 建 `qa/windows-desktop-<date>-<shortsha>` 分支；测试途中禁止 `pull/rebase` 偷换基线。产品修复、test harness、报告分开 commit，并开 Draft PR。合并/冲突解决后原证据失效，按受影响矩阵重跑；shared/core 改动两机全回归。

设置独立测试目录，不得删除用户目录或仓库根：

```powershell
$env:TESTED_COMMIT = (git rev-parse HEAD).Trim()
$env:KAIRO_QA_ROOT = Join-Path $env:TEMP ("kairo-win-qa-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $env:KAIRO_QA_ROOT | Out-Null
```

记录：Windows 版本/build、CPU/RAM/GPU、Defender 状态、系统语言/区域、用户名是否含中文、屏幕分辨率、缩放 100%/125%/150%、深/浅色与 High Contrast、RDP/本地控制台会话类型。

## 6. Wave 0 — 干净构建、打包和安装

### WIN-BASE-01 静态与单元 Gate

从 clean clone 执行，不使用任何 Skip 参数：

```powershell
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm -r --filter "./packages/*" exec tsc --noEmit
git diff --check
Push-Location runtime-agent
go vet ./...
go test -count=1 -timeout 300s ./...
Pop-Location
node --test tests/contract/contract.test.cjs
node --test tests/contract/eventstream.test.cjs
node --test tests/fault/fault-injection.test.cjs
node --test tests/perf/perf-baseline.test.cjs
```

`pnpm test:agent`/`scripts/test-agent.js` 可作为“现有 wrapper 行为审计”单独运行，但因其当前跳 53 项，不能成为 Gate。最终只认可上面的 Windows 原生 `go test ./...` 零 skip 结果。Windows amd64 能运行 race 时还要执行 `go test -race`；确有工具链限制必须给失败证据，且 Mac/Linux race Gate 仍须通过。遇到 TEMP `Access is denied` 必须修实际同步/关闭句柄/重试语义和测试隔离，不得保留 53 项 skip。

### WIN-BASE-02 构建 Runtime 与安装包

```powershell
Push-Location runtime-agent
go build -trimpath -ldflags='-s -w' -o bin\kairo-runtime.exe .\cmd\kairo-runtime
Pop-Location
pnpm --filter @kairo/desktop build:win
Get-ChildItem apps\desktop\dist -Recurse -File | Get-FileHash -Algorithm SHA256
Get-ChildItem apps\desktop\dist -Recurse -File -Filter *.exe | ForEach-Object { Get-AuthenticodeSignature $_.FullName | Select-Object Path,Status,StatusMessage,SignerCertificate }
```

在执行 builder 前，必须先把 `build:win` 修成严格调用当前 SHA 的 agent build、browser frontend/backend build/copy 和 bundled copy；任何输入缺失都应非零退出。仅手工复用已有 `apps/desktop/lib` 不合格。

验证：

- NSIS Setup 与 ZIP/portable 均生成，名称、version、arch 正确。
- 解包检查 `Kairo IDE.exe`、`resources/app.asar` 中的 frontend/backend、`resources/bin/kairo-runtime.exe` 和 bundled 资源；断言 backend `main.js`/frontend entry 存在且可运行，不携带源码、secret、旧日志或开发路径。
- PE 架构 x64；正式上线 artifact 的 Authenticode `Status` 必须是 `Valid`。未签名/Unknown Publisher/SmartScreen 绕过均为 BLOCKED，不能人工点过后算 PASS。
- 安装包从空白数据目录启动，不依赖 pnpm、Go、仓库、外部 dev server 或 `KAIRO_AGENT_PATH`。

### WIN-BASE-03 安装/升级/卸载矩阵

必须通过真实 NSIS UI：

1. 新装到默认路径。
2. 新装到包含空格和中文的自定义路径，例如 `C:\Users\Public\Kairo 测试\IDE`。
3. 从开始菜单、桌面快捷方式（若提供）和安装目录分别启动。
4. 同版本覆盖安装；上一候选版本升级到当前版本；用户 workspace/data 不丢。
5. 正常卸载；程序文件、快捷方式、注册项清理正确；用户数据保留/删除策略有明确提示。
6. ZIP 解压到含中文/空格路径直接运行，再移动目录运行。
7. SmartScreen/Defender/防火墙提示与产品文档一致；无静默提权。

每步保存安装器窗口截图、UIA tree、操作日志、安装目录清单和 artifact SHA。

当前源码未见 `electron-updater/autoUpdater`。这里的“升级”默认仅指人工运行新 NSIS 覆盖安装；如果本次上线对外承诺应用内自动更新，则必须先实现下载、签名校验、提示、失败回滚和重启安装并另行全测。若不承诺，最终报告明确写 `in-app auto-update: out of scope/not advertised`，不能声称更新功能已通过。

## 7. Wave 1 — 建立真实 Windows UI 驱动

### 7.1 启动并绑定真实窗口

示例流程（selector 必须由本机 inspect 结果替换）：

```powershell
$app = Start-Process -FilePath "$env:LOCALAPPDATA\Programs\Kairo IDE\Kairo IDE.exe" -PassThru
winapp ui list-windows -a $app.Id
winapp ui wait-for "Kairo IDE" -a $app.Id --timeout 60000
winapp ui inspect -a $app.Id --interactive --json | Out-File "$env:KAIRO_QA_ROOT\kairo-uia.json" -Encoding utf8
winapp ui screenshot -a $app.Id --output "$env:KAIRO_QA_ROOT\startup.png"
```

如果 Electron 子进程导致 PID 变化，先 `list-windows` 获取 HWND，后续用 `-w <HWND>` 稳定定位。窗口标题变化后 HWND 仍应可用。

### 7.2 UI inventory

动态生成 `ui-inventory.json`，覆盖：

- NSIS 页面、按钮、路径输入、进度、Finish、卸载确认；
- 主窗口系统菜单、标题、最小化/最大化/还原/关闭、resize；
- Theia 菜单栏、活动栏、文件树、编辑器、panel、通知、dialog、status bar；
- Import Wizard、Project Selector、Build、Deployments、Server、Logs 全部控件和所有状态；
- 命令面板全部 `Kairo:` 命令；
- 原生文件选择/保存/确认对话框；
- Open App 后的外部默认浏览器页面。

每项包含 accessible name、control type/role、AutomationId 或稳定 selector、enabled/focusable/offscreen 状态、bounds、预期动作、截图和实际结果。inventory 与 UIA tree、DOM interactive elements 三方对账；任何无 accessible name 的交互控件为 a11y 缺陷。

### 7.3 每个控件统一操作模板

1. 读取 UIA/DOM 状态和 bounds；截图默认状态。
2. 使用 Tab/Shift+Tab 定位，保存焦点截图；确认焦点顺序。
3. 使用 Enter/Space 执行一次；恢复初始状态后使用 `winapp ui click` 真实鼠标执行一次。
4. 对支持 InvokePattern 的控件再用 `invoke`，确保语义动作一致且不会 double fire。
5. 输入控件用真实键盘和 `set-value` 各验证一次；中文、空格、长文本、粘贴均覆盖。
6. 验证 hover/focus/pressed/disabled/busy/success/error；检查颜色、tooltip 和光标。
7. 断言结果 UI，并交叉检查文件、进程、HTTP 或日志；只截点击前后图不够。
8. 控件离屏时必须真实滚动到可见位置，不可直接 JS 调 handler。

## 8. Wave 2 — Windows UI、视觉、DPI 与可访问性

### 8.1 必测产品面

与 Mac/Web 文档相同的全部 Web workbench 面均需覆盖，另外增加 Windows 专项：

- 系统标题栏、Alt+F4、最小化/最大化/Win+方向键贴靠、多显示器移动。
- Alt 菜单助记键、Ctrl 系快捷键、Tab/Shift+Tab、Enter/Space、Escape。
- 原生 Open Folder/Save As/确认 dialog：键入路径、面包屑、中文、取消、权限拒绝。
- taskbar/start menu 图标、应用名称、AppUserModelId、多个窗口/重复启动策略。
- 100%/125%/150% DPI，1366×768 与 1920×1080；DPI 切换或跨屏后不模糊、不重叠。
- Windows Light/Dark 与 High Contrast；系统字体缩放 125%/200%。

### 8.2 视觉与颜色 Gate

- 普通文字 WCAG AA ≥4.5:1；大文字、焦点、控件边界 ≥3:1。
- 状态不能只靠颜色；running/error/warning/success 同时有文字/图标。
- Kairo Dark 中菜单、输入框、select、按钮、链接、table、scrollbar、selection、tooltip、notification 均清晰。
- disabled 与正文仍有足够可读性，同时明显不可操作。
- Unicode 状态图标在 Windows 字体下不能变成彩色 emoji 导致错位或裁切。
- 125%/150% DPI 不出现 1px 裂缝、文字糊、按钮高度不足、表格列溢出、底部状态栏遮挡。
- 窗口缩到 1024×768 时仍能完成核心流程；最小尺寸应合理限制。
- 截图必须覆盖 empty/loading/disconnected/idle/running/success/failure/long content/dialog/notification/hover/focus/disabled。

### 8.3 Accessibility Gate

- `winapp ui inspect` 无交互控件空名称；UIA control type/role 正确。
- 仅键盘可完成安装→导入→编辑→构建→部署→启动→停止→退出→卸载。
- 无 keyboard trap；dialog 打开时 focus trap 合理，关闭后焦点回到触发控件。
- High Contrast 下文字、焦点、选中和错误仍可见；系统颜色不被硬编码覆盖。
- Narrator 抽样朗读按钮、表单、状态和错误；动态状态不能疯狂重复播报。
- 200% 文本缩放无内容丢失。

## 9. Wave 3 — 安装版完整业务闭环

测试主体必须走 UI；API 只做健康检查和最终交叉验证。

### WIN-FLOW-01 冷启动与首次导入

1. 清除本次 QA 专用数据目录，启动已安装 EXE；计时到 shell 可交互。
2. 验证 Electron main 自己启动 Runtime 与 Theia，不存在外部 3000/dev server 依赖。
3. 真实打开 Windows Folder Picker，选择临时复制的 `legacy-sample`。
4. 完成 Import Wizard 4 步，覆盖 detected/not detected、各 select、中文项目名、保存失败重试。
5. 验证 Project selector/status bar、磁盘配置、重启后恢复。

### WIN-FLOW-02 文件、Java/JSP 与编码

1. 文件树和所有 File/Edit/View 菜单真实操作；不能出现 “No command exists”。
2. 新建、保存、另存、重命名、复制、删除、撤销/重做，使用空格/中文/长路径 fixture。
3. Java completion、F12/definition、diagnostics 与 JDT 状态真实工作；JDT 崩溃后可恢复。
4. JSP/CSS/JS 高亮和编辑；大文件模式与 Toggle Full Editor Features。
5. 记录 GBK 文件 SHA-256；GBK 打开、保存、重开、构建/HTTP 均正确。
6. 不可表示字符必须阻止保存且原 bytes/hash 不变；换编码时 BOM/CRLF 规则正确。

### WIN-FLOW-03 Build/Deploy/Server/Logs

1. UI 点击 Build，状态 idle→pending/running→succeeded，磁盘生成物存在。
2. 制造编译失败，Build View 出现真实 diagnostic；点击定位文件/行；修复后成功。
3. Build and Deploy，Deployments View 显示真实状态、files/bytes/trigger/reload。
4. Start Server，验证状态、PID、port、startedAt；进程树中出现真正 Java/Tomcat。
5. Open App 通过 Windows 默认浏览器打开真实页面，Servlet/JSP HTTP 200 且内容正确。
6. 修改 JSP→保存→部署→浏览器刷新看到修改。
7. Restart：Server ID 不变，PID/startedAt 更新，无孤儿旧 Java；Logs 连续合理。
8. Clear Logs、server selector、scroll/auto-scroll、500/1000 行边界。
9. Stop：端口释放、Java/Tomcat 树清理；再次 Start 成功。

### WIN-FLOW-04 Desktop 生命周期

分别在 idle、build 中、server running、JDT running 时测试：

- 正常 File→Exit、标题栏 X、Alt+F4；5–8 秒内回收 Electron/Theia/Runtime/JDT/Tomcat 全进程树。
- taskkill Electron renderer、Runtime、Theia backend、Tomcat；UI 有真实错误和恢复路径，无无限 loading。
- 连续启动/退出 20 次；动态端口不泄漏，不残留 lock/data corruption。
- 同时启动第二实例；遵循明确定义的单实例/多实例策略，不抢同一 data dir/port。
- Windows 注销/关机事件下尽力安全清理；下次启动能从中断状态恢复。

### WIN-FLOW-05 升级回归

安装上一候选版本，创建 workspace/project/build/server history，再运行当前 NSIS 升级：

- 数据 schema 能迁移，不能丢项目或静默重置。
- 快捷方式和 uninstall entry 指向新版本。
- 旧 Runtime/资源文件不残留造成版本混用。
- 升级后完整业务闭环再跑一次。

## 10. Wave 4 — Windows 故障、安全、性能和稳定性

### 10.1 故障注入

至少覆盖并验证“错误可见 + 无数据破坏 + 可恢复”：

1. Runtime/Theia 端口瞬时占用与端口耗尽。
2. Runtime 在 build 中退出；build 进入 terminal failure/cancel，不永远 running。
3. Ant/javac 缺失、超时、取消、路径含中文。
4. Tomcat HTTP/shutdown/debug 端口占用。
5. Tomcat stop 超时后进程树 force cleanup。
6. WebSocket 断线、重连、history gap/snapshot 恢复，不重复记录。
7. config/history 文件截断、只读、磁盘满模拟。
8. JDT checksum mismatch、启动失败、crash loop。
9. GBK 不可表示字符与文件被其他进程锁定。
10. Defender 扫描导致慢启动/文件锁；不能建议用户永久关闭防护。
11. 安装路径/data/workspace 含空格、中文和接近 MAX_PATH 的长路径。
12. Electron 退出时三个以上子进程同时存在。

### 10.2 安全

- Agent/Theia 只监听 loopback；动态 secret 不在命令行、URL、DOM、localStorage、日志和截图中。
- Agent secret 使用受限环境/安全 IPC 传递；用 CIM/Process Explorer、renderer DevTools/自动化和日志扫描证明 argv、`window.kairoConfig`、其他 global、DOM、storage、URL、evidence 全部不可读。
- renderer `contextIsolation` 有效；没有无必要 `nodeIntegration`、任意 shell/IPC 暴露。
- workspace traversal/symlink/junction escape 被拒绝；部署不能写 workspace/目标之外。
- 日志、文件名、Deployment 表格的 HTML/脚本按文本显示，不执行 XSS。
- Open App 外链安全；默认浏览器不能控制 Kairo opener。
- 安装/运行遵循最小权限，不写 Program Files/HKLM（除非明确 per-machine 方案）。
- 卸载不删除用户 workspace；清理目标必须精确且可恢复。

### 10.3 性能 Gate

每项至少 5 次，报告 median/p95：

| 指标                                   |                                Gate |
| -------------------------------------- | ----------------------------------: |
| 安装版冷启动到编辑器可交互             |                                ≤ 8s |
| Warm start 到可交互                    |                                ≤ 5s |
| 打开 1000 行 Java（不含首次 JDT 下载） |                                ≤ 1s |
| 1000 日志流下单次 UI 主线程长任务      |                             ≤ 100ms |
| Runtime 重连+snapshot 恢复             |                                ≤ 3s |
| Exit 后回收全部子进程                  |                                ≤ 8s |
| 30 分钟 idle                           | CPU/RSS/handle/WebSocket 无线性增长 |

用 `Get-Process`/Performance Counter 记录 Electron main/renderer、Theia、Runtime、JDT、Tomcat 的 CPU、WorkingSet、PrivateMemory、Handles。相对已批准基线回归 >15% 必须修复或书面批准，不能静默改 baseline。

## 11. 缺陷修复协议

双机统一 ID 使用 `KAIRO-RC-WEB-NNN`、`KAIRO-RC-WIN-NNN`、`KAIRO-RC-SHARED-NNN`；统一状态机为 `NEW → TRIAGED → IN_FIX → FIX_READY → VERIFY_ORIGIN → VERIFY_PEER → CLOSED`。`SHARED` 缺陷必须由另一台机器复验；protocol/runtime/theme/composition/desktop-host 等 shared/core 改动强制两机全量回归。

```text
ID: KAIRO-RC-WIN-001
TESTED_COMMIT:
INSTALLER_SHA256:
Windows build/DPI/resolution/theme:
严重级别: P0/P1/P2/P3
前置条件:
最小 UI 复现步骤:
实际结果:
期望结果:
证据: WinApp action log/UIA tree/screenshot/video/trace/process/network logs
根因:
owner 与修改文件:
修复 commit:
新增回归测试:
dev 复测:
重新打包安装复测:
Wave 回归:
全量回归:
Mac 同步回归状态:
状态:
```

P0：数据破坏、安全、安装/启动全阻断；P1：核心闭环或大面积 UI 阻断；P2：明显错误但有绕行；P3：轻微视觉/文案。P0/P1/P2 必须清零；P3 原则上本轮清零。每个修复必须在重新打包的安装版验证，不能只测 dev。

## 12. 证据与报告

```text
artifacts/acceptance-<TESTED_COMMIT前12位>/
  manifest.json
  defects.jsonl
  release-verdict.json
  windows-desktop/
    environment.txt
    artifact-hashes.txt
    install-manifest.txt
    commands/<case-id>.log
    commands/<case-id>.json
    winapp-actions.log
    ui-inventory.json
    results.json
    uia-trees/
    screenshots/<resolution>/<scale>/<theme>/
    videos/
    playwright-traces/
    logs/{installer,electron,theia,runtime,jdt,tomcat}/
    process-snapshots/
    perf/
    defects/
```

每条命令的 JSON 记录 command/args/cwd/start/end/elapsed/exitCode/commit；PowerShell 可用仓库现有 `scripts/run-and-capture.ps1 -CmdArgs` 采集，但要先验证它不会吞 exit code。`manifest.json` 用 SHA-256 索引全部 evidence。EXE、raw HAR/log 和私人截图保持在已被 `.gitignore` 排除的 acceptance 目录并上传到受控 PR/Actions artifact；Git 只提交脱敏摘要。

精简报告提交到：

`docs/release-testing/reports/<TESTED_COMMIT>/WINDOWS_DESKTOP_FINAL_REPORT.md`

每个用例只能 PASS/FAIL/BLOCKED，不允许 SKIP。最终报告必须写：commit、installer SHA、环境、所有操作命令、inventory 覆盖率、安装矩阵、截图索引、缺陷/修复 SHA、重新打包证据、性能数据、进程清理、console/network/error、Mac 同 SHA 回归状态，以及总协调/独立回归双签字。

## 13. Windows Desktop 发布 Gate

以下全部满足才可写 `WINDOWS_DESKTOP_GATE=PASS`：

- [ ] Mac/Windows 最终 `TESTED_COMMIT` 完全一致
- [ ] clean install/build/test/lint/vet/Go test 全绿，无 53 项 skip 和假绿
- [ ] NSIS 与 ZIP artifact 生成、hash 固定、内容正确
- [ ] 默认/中文空格路径安装、启动、升级、卸载通过
- [ ] MiniMax 通过 WinApp CLI/Playwright 真实操作全部 UI，inventory 100%
- [ ] 所有按钮、菜单、输入、链接、快捷键和原生对话框均验证
- [ ] 页面所有关键状态有截图并完成视觉复核
- [ ] 100%/125%/150% DPI、Light/Dark/High Contrast、键盘/Narrator 抽样通过
- [ ] 导入→编辑→GBK→构建→部署→Tomcat→浏览器→日志→重启→停止闭环通过
- [ ] 安装版退出在 8 秒内清理全部进程，连续 20 次无残留
- [ ] 故障注入、安全、性能、30 分钟稳定性通过
- [ ] 每次修复均重新打包安装并回归，Mac 已对同 SHA 同步回归
- [ ] P0/P1/P2/P3 均已修复验证，或只有产品负责人书面接受且不影响发布的例外
- [ ] 无 FAIL、无 BLOCKED、无 SKIP、无 gated、无 dev fallback
- [ ] 独立回归 Agent 能从零复现结果

只要任一项未满足，最终必须写 `WINDOWS_DESKTOP_GATE=FAIL` 或 `BLOCKED` 并继续工作。不得以“MiniMax 没有电脑控制能力”为理由跳过：先接入 WinApp CLI；只有交互桌面本身不可用时才允许 BLOCKED。
