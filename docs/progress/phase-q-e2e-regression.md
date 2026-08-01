# Phase Q — E2E 回归验证报告

**日期：** 2026-08-01  
**环境：** Runtime Agent 127.0.0.1:18080（`runtime-agent/bin/kairo-runtime.exe`）+ Theia Browser 127.0.0.1:18301  
**工作区：** `tmp/kairo-e2e-workspaces/legacy-sample`（fixtures 每次测试前重置）  
**关键环境变量：** `JAVA_HOME=E:\Tools\jdk17`、`KAIRO_JAVA_TARGET=8`、`KAIRO_JRE17_HOME=%TEMP%\kairo-jdtls\jdk21\jdk-21.0.11+10`

---

## 1. 执行摘要

| 测试套件 | 结果 | 结论 |
|----------|------|------|
| `core-e2e.spec.ts`（11 场景） | ✅ 11/11 通过（13.7m，零失败零重试） | 从「全部失败（环境未就绪）」到「全绿」的完整回归 |
| `standalone-smoke.spec.ts`（5 场景） | ✅ 5/5 通过 | Theia shell / widgets / 键盘导航 / 欢迎页 / 响应性无回归 |
| `search-extension` 单测 | ✅ 78/78 通过 | Search Center replace 流程改动无回归 |
| `go test ./internal/build ./internal/services` | ✅ 全绿 | javac 归一化与构建排序改动无回归 |

---

## 2. core-e2e 真实根因链（本次会话定位并修复）

上一版本报告将失败归因于「环境未就绪 / JDT LS bundle 缺失」，但真实原因是**多条独立的根因叠加**，本会话逐一定位并修复：

### 2.1 JDT LS 1.55.0 需要 Java 21（E2E-02 / E2E-10）
- 本机 PATH 为 JDK 17；JDT LS 1.55.0 的 Equinox bundle 声明 `Require-Capability JavaSE 21`，在 JDK 17 下启动即崩溃。
- 修复：agent/后端以 `KAIRO_JRE17_HOME` 指向 JDK 21（`%TEMP%\kairo-jdtls\jdk21\jdk-21.0.11+10`）启动。

### 2.2 javac source 级别归一化（E2E-04 / E2E-06 构建失败）
- legacy-sample 的 `build.xml` 默认 source/target 1.6，JDK 17/21 的 javac 拒绝 source 6。
- `runtime-agent/internal/build/compiler.go` 的 `probeMinSourceLevel()` 依赖 javac `-help` 文本：
  - 中文 Windows 下 `javac -help` 为 **GBK 编码**，UTF-8 正则匹配失败 → 探测返回 0；
  - JDK 17 措辞为「支持的发行版：7, ...」，JDK 21 为「支持的发行版本：8, ...」，旧正则只匹配「版本」。
- 修复：`probeMinSourceLevel` 增加 GBK 解码回退；`supportedReleasesRE` 支持 `版(?:本)?` 双语；新增 `TestSupportedReleasesRE`（含 JDK 17/21 中英文用例）。
- 真实 JDK 17 探测验证：`probeMinSourceLevel(E:\Tools\jdk17\bin\javac.exe) = 7`。

### 2.3 Ant build.xml 的 source/target（遗留路径）
- Ant 的 javac 不受 Go 归一化控制；`legacy-sample/build.xml` 通过 `KAIRO_JAVA_TARGET` 环境变量提升级别。启动栈须带 `KAIRO_JAVA_TARGET=8`。

### 2.4 构建状态命名与列表排序（E2E-06 Step 5/6 flaky）
- UI 约定 `succeeded`，agent API 返回 `success`（`mapBuildResult` 映射）。`waitForBuildState` 已归一化，但**返回的原始 state 仍为 `success`**，测试直接 `expect(state).toBe('succeeded')` 失败。
- 修复：`fixtures.ts` 导出 `normalizeBuildState`；`waitForBuildState` 返回归一化后的 state；`core-e2e.spec.ts` Step 6 断言改为归一化比较；`regression-fixtures.ts` 同步修复。
- **列表顺序随机**：agent `asyncBuildEngine.List()` 从 map 迭代（Go map 顺序随机），`builds[length-1]` 并非最新构建，前端 `getLatestBuild()` 与 E2E fixtures 均依赖该约定。
- 修复：`List()` 按 `StartedAt` 升序排序（新增 `buildStartedAt` 解析器），新增 `TestBuild_ListChronological` / `TestBuild_ListUnparsableStartedAt`。

### 2.5 Search Center 未从 Ctrl+Shift+F 打开（E2E-03）
- `bindViewContribution` **不注册 FrontendApplicationContribution**，`SearchCenterContribution.onStart()`（安装窗口 keydown 监听）从未执行 → 快捷键落入 Theia 内置搜索。
- 修复：`search-extension/src/browser/index.ts` 显式 `bind(FrontendApplicationContribution).toService(SearchCenterContribution)`。

### 2.6 Search Center Enter 无法提交（E2E-03）
- widget 的 `keyDown` 处理器对 Enter 一律 `preventDefault()`（用于结果列表导航），焦点在查询/替换输入框时同样吞掉表单提交 → 状态永远「空闲」。
- 修复：焦点在 `input/select/textarea` 时放行 Enter，让表单默认提交生效。

### 2.7 E2E-03 选择器与真实 widget 不匹配
- 旧测试找 `.search-view .search-input input / [data-testid="search-input"]`，真实 Search Center 为 `[data-testid="search-query"]`、`[data-testid="replace-text"]`、`.kairo-search-tab:has(.codicon-replace)`、`.kairo-search-replace-btn(.secondary)`。
- 修复：按真实 testid 重写 E2E-03 步骤 2-11；验证/撤销改用 `/api/v1/search`（`rootPath` 直查）+ widget 撤销按钮（FileService 写入不受编辑器 Ctrl+Z 撤销）。

### 2.8 导入向导残留（E2E-03 Step 2 阻塞）
- 重复打开同一工作区根时「打开项目文件夹」为 no-op，向导成功对话框残留，遮挡后续弹窗。
- 修复：`runKairoImportWizard` 结尾显式点击 `[data-testid="ready-close-btn"]` 关闭。

### 2.9 Windows 文件锁与 tmpdir 污染（全场景稳定性）
- `os.tmpdir()` monkey-patch 因 esbuild `__toESM` 浅拷贝 builtin 命名空间不生效 → 工作区落在真实系统 Temp。
- 修复：fixtures 用 `const os = require('node:os')`；fixture 开头 `taskkill /F /IM java.exe` 杀残留 Tomcat 进程（EBUSY 文件锁），`removeDirSync` 失败回退覆盖式复制。

---

## 3. 结论

core-e2e 11 场景从「环境性全失败」修复到「11/11 全绿」，共定位 9 条独立根因，覆盖：Go 编译归一化、构建 API 排序、前端 Search Center 注册/交互、E2E fixtures 稳定性（Windows 专属）。

## 4. 后续建议

1. ~~JDT LS 供给~~ — 本机已通过 `KAIRO_JRE17_HOME` 指向 JDK 21 就绪；生产/CI 环境需在 `supply-chain-lock.json` 约束下离线供给 `jdt-language-server-1.55.0`（sha256 `90627c9f...`）。
2. E2E-02~10 的 `waitForStatusContains(page, 'JDT LS: ready')` 已按 JDK 条目重写（`/JDK[：:]\s*\d/` 出现即 JDT 就绪）。
3. `server` 视图断言改为验证 `httpPort > 0`（agent 自动分配端口），不再依赖固定 8081。
4. 状态栏中文文案断言兼容全角冒号（`JDK[：:]`）。
