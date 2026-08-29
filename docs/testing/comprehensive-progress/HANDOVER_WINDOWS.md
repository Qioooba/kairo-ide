# Kairo IDE 全模块测试 · Windows 接力交接文档

> **给 Windows 机器**：macOS 已完成 14 章 Browser 列，剩余 32 章待你完成。Windows 上需同时覆盖 Browser + Desktop 双列（`docs/COMPREHENSIVE_TEST_DOCUMENT.md` 表格 D/B 两栏），其中桌面列含 Electron 原生对话框、NSIS 安装、快捷方式等仅 Windows 可测项。
> **交接时间**：2026-08-28
> **仓库**：`kairo-ide`（当前分支含全部已修复代码，未 `git commit` 的改动也在工作区——先 `git status` 确认）

---

## 一、已完成（macOS Browser 列，14 章 244 用例，Windows 上建议抽样复验）

| 章 | 内容 | 结果 | 缺陷修复 | 详情 |
|---|---|---|---|---|
| 5 菜单栏 | 66(57✅/9⏭️) | 12项修复（P0工具栏不挂载、P0 lane隔离、P0文件保存禁用等） | `docs/testing/comprehensive-progress/ch05.md` |
| 6 工具栏 | 11✅ | 同上 | `ch06.md` |
| 7 状态栏 | 11✅ | 同上 | `ch07.md` |
| 8 欢迎页 | 11✅ | BUG-200 showWelcome 失效 | `ch08.md` |
| 9 导入向导 | 18✅(+2 N/A) | — | `ch09.md` |
| 10 项目选择/结构 | 17✅ | BUG-201/202/203 编码与绝对路径 | `ch10.md` |
| 11 资源管理器 | 7✅ | BUG-300/301 | `ch11.md` |
| 12 编辑器 | 17✅ | BUG-307/308/310 键位冲突 | `ch12.md` |
| 14 JSP | 21✅ | BUG-600/601 补全 range | `ch14.md` |
| 15 XML | 12✅ | 同上 | `ch15.md` |
| 16 JSON/Props | 8✅ | 603观察(properties 转义) | `ch16.md` |
| 17 编码GBK | 16✅ | BUG-800 Tab后缀 | `ch17.md` |
| 18 搜索 | 24✅(23+1部分) | BUG-500~506 | `ch18.md` |
| 37 命令面板 | 5✅ | BUG-309 | `ch37.md` |

**smoke**：`tests/e2e/comprehensive/smoke.spec.ts` 在 `http://127.0.0.1:18401` 3/3 绿（title、favicon、Welcome tab `getByRole('tab', {name:/Welcome/i})`）。

**全局修复**（已在当前构建中，Windows 无需重修）：
- `BUG-001` `packages/java-extension/src/browser/java-debug-acceptance.ts:80` i18n key 类型收窄
- `BUG-002` `packages/plugin-extension/src/browser/kairo-extensions-frontend-module.ts:17` / `src/common/kairo-extension-protocol.ts` 前端误从 `../node/` 引入 `adm-zip` 致 `process is not defined` 白屏
- `BUG-602` 合并冲突残留 `<<<<<<<` 致 `apps/browser` 构建失败
- 及上表 W1-A/C/E/B 修复的 30+ 项

---

## 二、待完成（32 章 402 B列用例；Windows 上为双列约 700+）

> **优先级**按文档第0章建议执行顺序；`P0` 先行。

| 优先级 | 章节 | B列用例 | 备注 |
|---|---|---|---|
| **P0 烟囱** | **第3章 启动退出** | 12 (9待测，smoke已过3) | 含单实例锁、agent重生、headless、退出清理 |
|  | **第13章 Java** | 38 | JDT LS 就绪、补全≤1.5s、跳转/重构/诊断双通道 |
|  | **第21章 Tomcat/部署/热更** | 30 | 启动/停止/Reload、热同步4模式、日志viewer |
| P0 | 第4章 窗口布局主题 | 9 | 深色 #1e1f22、亮色、主题竞态 |
| P1 主线 | 第19章 构建 | 19 | Build/Clean/Ant/custom、取消、超时 |
|  | 第20章 Maven | 8 | pom detect、依赖树、goal白名单 |
|  | 第22章 运行配置 | 19 | 表单6组、端口/artifact/env校验 |
|  | 第23章 调试 | 23 | 断点命中、单步4件套、HotSwap |
|  | 第24章 问题面板 | 12 | 过滤、F8导航 |
|  | 第26章 单元测试 | 13 | JUnit3/4、Rerun Failed |
|  | 第27章 SQL | 14 | 需 Oracle(可选)；无则标N/A并记观察 |
| P1 | 第29章 Git | 15 | 需本机 git |
|  | 第33章 快捷键 | 11 | 附录B全表，浏览器 remap 见B.3 |
|  | 第36章 设置 | 20 | 含项目级 `.kairo/settings.json` 覆盖 |
| P2 周边 | 第25章 TODO | 9 |  |
|  | 第28章 终端 | 6 | 需 conpty prebuild 存在性 |
|  | 第30章 SVN | 24 | 需 svn 客户端，无则整章 ⏭️ |
|  | 第31章 本地历史 | 8 |  |
|  | 第32章 书签 | 7 |  |
|  | 第34章 性能/大文件 | 9 |  |
|  | 第35章 通知 | 4 |  |
|  | 第38章 扩展VSIX | 10 | allowlist门禁、Zip Slip |
|  | 第39章 远程 | 7 | P3实验性 |
|  | 第40章 合规/遥测 | 12 |  |
|  | 第41章 升级 | 7 | 离线默认 disabled |
|  | 第42章 i18n | 7 | en/zh-CN 切换 |
|  | 第43章 a11y | 8 | axe扫描 |
| P0 横切 | **第44章 容错** | 10 | agent断连、WS重连、中文路径全链路 |
|  | **第45章 安全** | 12(B列) | loopback/secret/Origin/沙箱/CSP(桌面)/JobObject(桌面) |
|  | 第46章 日志诊断 | 4(B列) | 桌面 `desktop-main.log` 在Windows可测 |
|  | 第47章 一致性 | 9(B列) | 桌面 vs 浏览器对照（仅Windows可做） |
|  | 第48章 性能基准 | 6(B列) | 冷启动≤8s、补全≤1.5s 等 |

第2章安装卸载（NSIS/便携/卸载）**仅桌面**且 Windows 必测，见 `docs/COMPREHENSIVE_TEST_DOCUMENT.md:185`。

---

## 三、Windows 环境准备

### 3.1 前置
```powershell
node --version   # >=20
pnpm --version   # 9.15.9
go version       # 1.26+
java -version    # JDK 17+ 必需，21+ 功能完整（JDT LS 需要）
git --version    # 可选，29章需要
svn --version    # 可选，30章需要；无则跳过
```

### 3.2 拉代码与安装
```powershell
cd kairo-ide
git status                          # 确认含 macOS 已修复的未提交改动
pnpm install --prefer-offline
```

### 3.3 重建（macOS 已修复的 P0 阻塞构建问题当前构建已包含，但改动后仍需重建）
```powershell
# 1) Go agent
cd runtime-agent; go build -o bin/kairo-runtime.exe ./cmd/kairo-runtime; cd ..

# 2) 全部 packages
pnpm -r --filter "./packages/*" --if-present run build

# 3) Browser 前端（生产包，含 theia build + postbuild 补丁）
cd apps/browser; pnpm build; cd ../..
#  若只改了某个 package，可只 pnpm --filter @kairo/<pkg> build 后再 cd apps/browser && pnpm build
```

### 3.4 启动
**Browser 版**（与文档第3.6章一致）：
```powershell
# 方式A：脚本（Agent 18099 + Theia 3000）
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
# 浏览器打开 http://127.0.0.1:3000

# 方式B：隔离通道（推荐用于并行测试，仿 macOS lane.sh）
# 需自行写 PowerShell 版 lane：每个通道独立 AgentPort/TheiaPort/DataDir/Workspace（从 legacy-sample 复制）
# 示例端口组：F:18100/18101/18102/18103  G:18200/18201/18202/18203
#   $env:KAIRO_RUNTIME_URL="http://127.0.0.1:18100"
#   .\runtime-agent\bin\kairo-runtime.exe --config .test-lanes/F/agent.yaml
#   node apps/browser/lib/backend/main.js .test-lanes/F/workspace --hostname=127.0.0.1 --port=18101
```

**Desktop 版**（第3章/第6章覆盖）：
```powershell
pnpm package:win        # 或 package:win:skip-build（已构建时）
# 产物在 dist/xxx.exe 与 .zip 便携包
# 启动后行为见第3章：JDK/Tomcat 检测对话框、agent 健康检查 /api/v1/health（15s）、Theia 后端三级端口发现（45s）
```

---

## 四、跑测试

### 4.1 Playwright 基础设施（已就绪）
- 配置：`tests/e2e/comprehensive.config.ts`（testDir=`comprehensive`，`baseURL` 取 `THEIA_URL`）
- Helpers：`tests/e2e/comprehensive/helpers.ts`（`openIde(page)`, `api()`, `attachDiagnostics`）
- Smoke：`tests/e2e/comprehensive/smoke.spec.ts`（3条，必先过）
- 章节 specs：`tests/e2e/comprehensive/ch*.spec.ts`（已完成的 14 章可作范例）

### 4.2 单通道冒烟
```powershell
$env:THEIA_URL="http://127.0.0.1:3000"; $env:AGENT_PORT="18099"
npx --prefix tests/e2e playwright test --config comprehensive.config.ts comprehensive/smoke.spec.ts
# 预期：3 passed
```

### 4.3 章节测试
```powershell
# 例：第19章 构建（Browser 列）
$env:THEIA_URL="http://127.0.0.1:18101"; $env:AGENT_PORT="18100"
npx --prefix tests/e2e playwright test --config comprehensive.config.ts comprehensive/ch19-build.spec.ts

# 例：第13章 Java（需 JDT LS，首次索引 60s+，timeout 已设 300s）
npx --prefix tests/e2e playwright test --config comprehensive.config.ts comprehensive/ch13-java.spec.ts
```

### 4.4 结果判定
每条 `test('TC-XXX-YYY ...')` 对应文档一行；Browser 列标 `—` 或 `仅 DESKTOP` 的在 Windows 上仍需测桌面列，不可跳过。

---

## 五、进度文档（务必持续更新）

- **主表**：`docs/testing/comprehensive-progress/MASTER.md`（含环境表、已修复台账、章节总览）
- **章节明细**：`docs/testing/comprehensive-progress/chNN.md`（表头 `| 编号 | 结果 | 证据 | 缺陷/备注 |`，证据写测试名或截图路径 `tests/e2e/test-results/...`）
- 新缺陷编号：从 `BUG-20260828-900` 起递增，`docs/testing/comprehensive-progress/MASTER.md` 追加一行
- 每章完成后更新 `MASTER.md` 的章节行与“最后更新”时间戳

已完成章节的 `chNN.md` 与 `chNN.spec.ts` 为后续编写范例（尤其 `ch09-import.spec.ts` 的 workspace 隔离与 `ch17-encoding.spec.ts` 的 GBK 探测）。

---

## 六、已知坑位（别踩）

1. **Trust 弹窗**：`packages/theia-product` 启用 `security.workspace.trust.enabled`，首次打开会弹 `Yes, I trust the authors / No, I don't trust`。**必须点 Yes**。`helpers.ts:openIde` 已精确匹配 `getByRole('button', {name:/Yes, I trust/i})`，不要用宽泛 `has-text("Trust")`（会误点 No 致白屏）。`tests/e2e/comprehensive/helpers.ts:42`
2. **通道隔离**：`KAIRO_RUNTIME_URL`（前端读） vs `KAIRO_AGENT_URL`（旧名后端读）。`lane.sh` 统一导出 `KAIRO_RUNTIME_URL`；Windows 自建通道务必同名，否则静默连到 :18099 产生串扰（已修 BUG-105）。
3. **前端 bundle 缓存**：改 `packages/*` 后必须 `pnpm --filter @kairo/<pkg> build && cd apps/browser && pnpm build` 再重启通道，否则页面仍读旧 bundle（`apps/browser/lib/frontend/bundle.js` 实测 `grep -c adm-zip` 应为 0）。
4. **构建阻塞**：`packages/search-extension` 曾残留 `<<<<<<<` 合并冲突致 `apps/browser` 构建失败（BUG-602），已清；后续注意 `git status` 无冲突标记再构建。
5. **JDT LS**：`tests/e2e/comprehensive/ch13-java.spec.ts` 首条 `TC-JAVA-001` 需等待 `$/progress` 索引完成；`runtime-agent/internal/jdtls` 依赖 `bundled/jdtls` 与 JDK。
6. **并发限流**：macOS 上并行 >2 个 Playwright 子代理会触发 AI 上游 Rate limit，建议 Windows 上**串行**跑章节（一个通道一次一章），`npx playwright` 本身用 `--workers=1`。

---

## 七、建议执行顺序（Windows 可并行桌面+浏览器两条线）

**Day1 烟囱**：第3章(启动退出双列) → 第13章Java → 第21章Tomcat/部署/热更（P0）
**Day2 主线**：第4章窗口 → 第19章构建 → 第20章Maven → 第22章运行配置 → 第23章调试
**Day3 周边**：第24-28章（问题/TODO/测试/SQL/终端） → 第29章Git → 第31/32章历史/书签
**Day4 横切**：第33章快捷键 → 第36章设置 → 第42章i18n → 第38章扩展 → 第39-41章
**Day5 收尾**：第30章SVN(如有) → 第43章a11y(axe) → 第44-46章容错/安全/日志 → **第47章双形态一致性对照**（同操作在桌面 exe 与浏览器各跑一遍对比）→ 第48章性能基准 → `附录E` 汇总 + 回归所有 ❌

---

## 八、当前通道状态（macOS，供参考；Windows 上自行 `lane.sh status`）

```
lane A: agent(18400)=UP theia(18401)=UP  # 第5/6/7/18 章
lane B: agent(18410)=UP theia(18411)=UP  # 第8/9/10/17 章
lane C: agent(18420)=UP theia(18421)=UP  # 第11/12/37 章
lane D: agent(18430)=UP theia(18431)=UP  # 待 Ch13
lane E: agent(18440)=UP theia(18441)=UP  # 第14/15/16 章
官方 : agent(18080)=UP theia(3000)=UP    # 新构建 smoke 3/3 绿
```

---

## 九、交接 checklist（Windows 接手后先做）

- [ ] `git status` / `git diff --stat` 确认拿到全部已修复改动；如有未提交先 `git stash` 备份
- [ ] `pnpm install && pnpm -r --filter "./packages/*" run build && cd apps/browser && pnpm build && cd runtime-agent && go build -o bin/kairo-runtime.exe ./cmd/kairo-runtime`
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/dev.ps1` 启动，`http://127.0.0.1:3000` 打开确认标题 `Kairo IDE`、Welcome `h1` 出现、`bundle.js` 无 `adm-zip` 报错（DevTools Console 0 error）
- [ ] `npx --prefix tests/e2e playwright test --config comprehensive.config.ts comprehensive/smoke.spec.ts` 3/3 绿
- [ ] 抽样复验已完成章：`ch05-menu` 或 `ch17-encoding` 各跑 1 条，确认环境一致
- [ ] 按第七节顺序从第3章开始，按第八节所述更新 `MASTER.md` 与 `chNN.md`

---
*交接人：macOS 主机（Muse Spark）· 2026-08-28 · 进度以 `docs/testing/comprehensive-progress/MASTER.md` 为准*
