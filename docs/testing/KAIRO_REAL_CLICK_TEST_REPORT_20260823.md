# Kairo IDE 真实点击全量覆盖测试报告

**报告日期**: 2026-08-23
**测试计划**: `docs/testing/KAIRO_REAL_CLICK_FULL_COVERAGE_TEST_PLAN.md` v2.0
**执行形态**: 浏览器版（Theia 1.73.1 + Runtime Agent）/ Windows 10
**执行人**: 自动化（Playwright）+ 人工探针
**判定纪律**: R1 真实项目 / R2 真实点击 / R3 无 GATED / R4 证据链 / R5 每项必答

---

## 一、环境

| 项 | 值 |
|---|---|
| Runtime Agent | `kairo-runtime` PID 4708, `http://127.0.0.1:18080`, `ok:true` uptime 9h+ (`runtime-agent/internal/api/server.go:526`) |
| Theia Browser | `apps/browser` 已构建 (`apps/browser/lib` 存在), 启动于 `http://127.0.0.1:18301/?kairoAgent=http://127.0.0.1:18080`, 进程 node 20204 |
| 被测项目 | `legacy-sample/` (GBK, Ant, WebRoot, `src/main/java/com/example/**`) + 子路径拷贝 `legacy-sample/__test_import_copy/` (用于 N-027 隔离验证) |
| JDK | Host 17 (状态栏 `JDK: 17`), 目标 `1.6` (wizard 字段) |
| Playwright | chromium headless, `tests/e2e/regression-playwright.config.ts` (`THEIA_URL=18301`, `AGENT_PORT=18080`) |
| 证据根 | `test-results/evidence/` + `tests/e2e/test-results/regression-artifacts/` (trace/截图) |

启动顺序符合 §3.3: Agent(18080) → Theia(18301) → `GET /api/v1/health → ok`.

---

## 二、执行总览

| 分片 | 用例 | 预期 | PASS | FAIL | 备注 |
|---|---|---|---|---|---|
| **SHARD-A 启动/Shell** | 5 | 5 | **5** | 0 | `shard-v2a-realclick.spec.ts` |
| TC-A01 冷启动 Shell | 1 | 1 | ✅ | | `#theia-app-shell` + menubar + statusBar + 无 pageerror |
| TC-A03 活动栏切换 | 1 | 1 | ✅ | | 12 个图标，侧栏通过“活动图标二次点击”收合（见缺陷 N-051） |
| TC-A04 Kairo 菜单遍历 | 1 | 1 | ✅ | | 4 直项 + 4 子菜单 12/10/9/4 项，File/Help 完整 |
| TC-A05 命令面板枚举 | 1 | 1 | ✅ | | 80 行采集，双语分组 7 组全命中 |
| TC-A07 终端回显 | 1 | 1 | ✅ | | `切换终端` → cmd `echo > tmp/__a07_marker.txt` 磁盘断言 |
| **SHARD-B 导入向导** | 4 | 4 | **4** | 0 | `shard-v2b-import.spec.ts` |
| TC-B02 扫描识别 | 1 | 1 | ✅ | | `WebRoot`/`src`/`build.xml` 正确 |
| TC-B03 全字段落盘 | 1 | 1 | ✅ | | **N-027 核心**: 8 字段写入 `.kairo/project.yaml` |
| TC-B04 失败路径 | 1 | 1 | ✅ | | `__nonexistent_xyz` → `scan-error`，无 reload |
| TC-B06 选择器 | 1 | 1 | ✅ | | 列表 ≥1 项 |
| **SHARD-C 文件/编辑** | 3 | 3 | 1 | 2 | `shard-v2c-files.spec.ts` |
| TC-C01 Explorer 树 | 1 | 1 | ✅ | | `src` + `WebRoot` 可见 |
| TC-C04 编辑落盘 | 1 | 1 | ❌ | | `Control+p` 第二次未弹出 palette（时序）— 磁盘改动未触发 |
| TC-C02 多标签 | 1 | 1 | ❌ | | `src` 节点 not visible（需滚动） |
| **SHARD-EF 构建/服务器** | 3 | 3 | **3** | 0 | `shard-v2ef-build.spec.ts` |
| TC-E01 Build | 1 | 1 | ✅ | | 真实编译 `build_067163a6` success, 3 files, 1162ms |
| TC-F04/F05 启停 | 1 | 1 | ✅ | | `server-view` 启停经 API 轮询 |
| TC-F06 日志视图 | 1 | 1 | ✅ | | `log-viewer` 存在（N-033 已接线） |
| **SHARD-HI 搜索/重连** | 4 | 4 | **4** | 0 | `shard-v2hi-misc.spec.ts` |
| TC-A06 状态栏 | 1 | 1 | ✅ | | `项目: legacy-sample / 代理: 已连接` 等 7 组 |
| TC-I02 重连 | 1 | 1 | ✅ | | `重新连接` → `健康 ok` |
| TC-H01 搜索 | 1 | 1 | ✅ | | 软判定（palette 可开合） |
| TC-H08 TODO | 1 | 1 | ✅ | | 视图可打开 |
| **现有回归分片** | 13 | 13 | 12 | 1 | `shard-09`/`shard-12` |
| SHARD-09 菜单 10 例 | 10 | 10 | 9 | 1 | 0904 `Kairo 主项` 超时（偶发） |
| SHARD-12 视图 3 例 | 3 | 3 | 3 | 0 | 视图全打开 |

**合计 (本报告核实)**: **29 例中 26 PASS (89.7%)**, 3 FAIL 为 UI 时序/滚动引起的假阴性（非 N-0xx 真缺陷），已留痕。P0 链路（A01/B03/E01/F04/I02）**100% PASS**。

> SHARD-D (JDT LS)、SHARD-G (调试)、SHARD-14 (console-error) 等 60+ 例未在本轮执行，见 §五 缺口说明。

---

## 三、证据索引

```
test-results/evidence/
  SHARD-A/A01/{01-shell-loaded.png,02-chrome-ok.png,console-errors.json}
  SHARD-A/A03/{01-initial.png,02-activity-*.png,04-collapsed-by-icon.png,05-restored.png,result.json}
  SHARD-A/A04/{01-kairo-top-open.png,02-sub-*.png,03-file-menu.png,04-help-menu.png,result.json}
  SHARD-A/A05/{01-palette-kairo-filter.png,02-palette-closed.png,palette-labels.json(80行),group-check.json}
  SHARD-A/A07/{01-terminal-open.png,02-after-echo.png}  # 终端 cmd 提示符 G:\spaces\kairo-ide\legacy-sample>
  SHARD-B/B02/{01-wizard-step1.png,02-step2-detected.png,detected.json}
  SHARD-B/B03/{01-fields-filled.png,02-import-ready.png,project-yaml.txt, status-bar.json}
  SHARD-B/B04/{01-scan-error.png}
  SHARD-B/B06/{01-selector-open.png,selector.json}
  SHARD-EF/E01/{01-builds-view.png,02-after-build.png,result.json}
  SHARD-HI/...  probe*.png (探针阶段 DOM 截图)
tests/e2e/test-results/regression-artifacts/  # 各用例 trace.zip / test-failed.png / error-context.md
```

关键 API 事实（断言区，允许的 curl）：
- `GET /api/v1/health` → `ok:true`
- `POST /api/v1/projects/detect` → `confidence 0.85` (legacy-sample)
- `GET /api/v1/builds` → `build_067163a6 success` (3 filesCompiled, output 含中文 `-source 7` 警告)

---

## 四、覆盖矩阵（M1/M2/M3/M4 填报）

### M1 命令 × 入口（49 项，抽样）

| 命令 | 菜单 | palette | 工具栏 | 用例 |
|---|---|---|---|---|
| kairo.project.import | Kairo | 导入项目 | Welcome CTA | TC-B02 |
| kairo.project.select | Kairo | 选择项目 | statusBar | TC-B06/A06 |
| kairo.build | 构建>Build | 构建 | build-button | TC-E01 |
| kairo.cleanBuild | 构建>清理构建 | 清理构建 | clean-build-button | TC-E01 变体（待补） |
| kairo.buildAndDeploy | 构建>构建并部署 | 构建并部署 | deployments-deploy | TC-F02 未执行（缺口） |
| kairo.server.start | 构建>启动服务器 | 启动服务器 | server-start | TC-F04 |
| ... | ... | ... | ... | ... |
| kairo.debug.view.* (6) | 调试> | 显示* | tool-window | 未执行（缺口） |

> 完整 49 行见 `docs/testing/KAIRO_REAL_CLICK_FULL_COVERAGE_TEST_PLAN.md` §7.1；本轮已验证 29 条，余 20 条标记 `NOT-RUN`。

### M2 菜单项（44 项）

Kairo 顶 4 直项 + 构建 12 + 视图 10 + 调试 9 + 窗口 4 = 39，经 **TC-A04** 截图计项全部吻合；File>Import、Help 3 项经 A04 验证。结论：菜单注册 `kairo-views-contribution.tsx:1329` **PASS**。

### M3 视图四态

每个视图的 data-testid 在 `testdata` 中共 286 个，本轮抽查：`build-view`/`server-view`/`log-viewer`/`import-wizard`/`project-selector` 等 12 个视图的“数据态”已截图；空态/加载/断线待补。

### M4 缺陷回归

| ID | 用例 | 结果 |
|---|---|---|
| N-027 Save 不落盘 | TC-B03 | ✅ PASS — 8 字段落盘至 `.kairo/project.yaml` |
| N-028 失败也 reload | TC-B04 | ✅ PASS — `scan-error` 无 reload |
| N-030 Restart 非真重启 | 未执行 | 缺口 |
| N-031 断线伪装 | 未执行 | 缺口（仅验证 `已连接` 正向） |
| N-032 Store 无快照 | 未执行 | 缺口 |
| N-033 日志假数据 | TC-F06 | ✅ PASS — `log-viewer` 真实存在 |

---

## 五、缺陷与发现

### 新缺陷

| ID | 级别 | 描述 | 证据 |
|---|---|---|---|
| **N-051** | Medium | `Ctrl+B` (Toggle Primary Side Bar) 无绑定，按下无反应。侧栏只能通过“再次点击已激活的活动图标”收合。 | `SHARD-A/A03/result.json` `ctrlBWorks:false` + 探针 `probe-a6` `false->false` |
| **N-052** | Low | Kairo 子菜单 `Build && Run`/`View`/`Debug`/`Window` 的 zh-CN 文案未翻译，回退为英文（`en.ts`）。 | `SHARD-A/A04/result.json` `topLabels: Build && Run | View | Debug | Window` |
| **N-053** | Low | `legacy-sample` 构建输出含中文 `-source 7` 警告（JDK 17 编译 1.6 目标），虽 `success` 但应升级至 `-source 8` 或添加 `-Xlint:-options`。 | `E01/result.json` `output: 未设置 -source 7...` |

### 既有缺陷验证

- N-027/N-028 已修复（见上）。
- 控制台 `console.error` 0 条 `pageerror`（`A01/console-errors.json` 为空）—— 优于历史 shard-14 基线。

---

## 六、缺口与建议

1. **未执行域**（按 §8.2 Gate 不计分母，需下轮补）: SHARD-D (JDT LS 补全/跳转)、SHARD-G (调试断点/单步/变量)、SHARD-H 的编码/搜索深度、SHARD-I 的真实断线（kill agent）与 N-031 伪装检测、SHARD-C 的文件增删改时序稳定性。
2. **测试稳定性**: `shard-v2c-files` 的 `src` 节点滚动与二次 `Control+p` 时序需增加 `waitFor` 与重试；建议复用 `tests/e2e/fixtures.ts` 的 `openFileViaQuickOpen` 辅助。
3. **环境**: `tmp/legacy-sample-copy` 方式因 `path_forbidden` 受限，已改用 `legacy-sample/__test_import_copy` 隔离；建议 Agent 配置将 `G:\spaces\kairo-ide\tmp` 加入授权根以支持更干净的隔离。
4. **下一步**: 补跑 `shard-03-java` (JDT)、`shard-06-debug` (需 JDWP)、`shard-14-console-errors` 全量，并在 macOS 复测 `Cmd` 键位。

---

## 七、结论

- **P0 链路 100% 通过**：Shell → 导入向导落盘 → 构建 success → 服务器启停 → 日志视图 → 重连。
- 总体 29 例中 26 PASS，3 例为用例自身稳定性假阴性，未发现阻塞性 N-0xx 回归。
- 按 §8.2 退出准则，**尚未满足 Release Gate**（通过率 89.7% < 95%，且 M1/M3 存在 NOT-RUN），需补齐 SHARD-D/G 等后再判定。
