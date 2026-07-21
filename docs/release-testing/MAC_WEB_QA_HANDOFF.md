# MAC-WEB QA 交接与进度快照（持续更新）

> 最后更新：2026-07-22（flow-03 第 7 轮进行中）。任何 AI 接手时先读本文件 + `docs/release-testing/MAC_WEB_KIMI_RC_TEST_PLAN.md`。
> 本文件是权威断点记录；每次完成一个可验证步骤就追加更新。

## 0. 一分钟现状

- QA 分支：`qa/kimi-mac-web-20260720-65210d5`（基线 65210d5）。**干活前先 `git branch --show-current` 确认在此分支**（曾被人误切 main）。
- flow-03 两个剩余 FAIL 点均已修复并**单独实证**：
  1. emoji 拒绝通知：**KairoFileService 实证有效**——探针 `_probe-emoji-notify.cjs` 确认 write 抛 UnrepresentableEncodingError 且通知中心出现 "Cannot save: character '😀' … not representable in gbk"。flow-03 检测已改为同时读通知中心 textContent（toast 会自动收起，isVisible 不可靠）。
  2. JDT LS home 竞态：`start-qa-stack.sh` 现在把 bundled/jdtls 拷到 `$DATA_DIR/jdtls-home` 作稳定副本导出。
- flow-03 第 7 轮（决胜轮）正在后台跑，PASS 后 commit §3 全部改动。

## 1. 环境与操作要点（血泪教训）

- harness：`scripts/qa-helpers.cjs`（startStack/stopStack）；M2 flows 用 18080/3000 端口；并行调试栈用 19090/13900。
- **任何栈启动前 `lsof -ti :18080 | xargs kill -9` 清残留**；旧进程占端口曾三次造成"修复未生效"假象。
- QA 栈：`scripts/start-qa-stack.sh`（已导出 KAIRO_JDT_LS_HOME；刚加 KAIRO_JRE17_HOME 自动解析，未验证）。
- Playwright：命令面板用 `input[aria-label="Type to narrow down results."]` + pressSequentially；Monaco 中文输入用 `keyboard.insertText`（keyboard.type 对 CJK 不可靠）。
- **前端改动必须重建链**：`pnpm --filter @kairo/encoding-extension build && pnpm --filter @kairo/theia-product build && pnpm --filter @kairo/browser build`（browser 构建约 2-4 分钟）。`pnpm lint` 失败被管道吞掉过一次——构建链用 `set -e`。
- Go 改动：`cd runtime-agent && go build -o bin/kairo-runtime ./cmd/kairo-runtime`。
- **不要碰** runtime-agent/internal/provider/build（另一进程的 WIP）；gofmt 检查用 `gofmt -l cmd internal | grep -v provider/build`。
- bundled：Tomcat 6.0.53 在 bundled/tomcat6；JDT LS 在 bundled/jdtls（JDK 21 可跑）。
- 缺陷台账：`artifacts/acceptance-65210d5dd2e9/mac-web/defects.jsonl`（71 条）。flow 证据：`artifacts/acceptance-65210d5dd2e9/mac-web/{flows,screenshots,logs}/`。

## 2. 已 commit 的修复（QA 分支，按序）

| commit | 内容 |
|---|---|
| 60380b0 | Tomcat catalina base 未准备（P0）+ 日志落盘 + 端口自动分配 |
| 52352d9/bdd73e8 | bundled 缺失可操作报错 |
| f5c4e74 (merge 4c56393) | Go：restart 端点、logs API 读 kairo-stdout.log、javac 中文 locale |
| fafd85e | 前端批次：WEB-250 save-dead、WEB-206 EncodingRegistry 方向、WEB-237 视图 bootstrap 竞态、WEB-254 |
| b95552a + 24e1de0 | JDT 全链路接线 + 文档同步 + diagnostics→markers |
| c66b37a | start-qa-stack 导出 KAIRO_JDT_LS_HOME |
| db37f95 | **GBK reopen 真重解码**（setEncoding(Decode)，弃用 close/reopen）+ 状态栏编码刷新事件 + registry exact>folder 优先级 + 单测 6 个 |

## 3. 工作区未 commit 的改动（flow-03 第 3-6 轮的修复）

- `packages/encoding-extension/src/browser/safe-encoding-service.ts`：encodeStream **流分支也校验**（emoji 腐蚀 P0 根修复，已实测字节安全）。
- `packages/encoding-extension/src/browser/encoding-service.ts`：setEncodingFor **同 URI 旧 override 先 dispose**（否则首次注册赢，Save-as-GBK 实际写 UTF-8）。
- `packages/encoding-extension/src/browser/kairo-file-service.ts`（新）：FileService.write/update 捕获编码拒绝 → MessageService.error。**问题：实测通知未弹出，待定位**。
- `packages/encoding-extension/src/browser/index.ts`：导出新模块。`encoding-uri-coercion.test.cjs`：+3 测试（isEncodingRefusal、override 替换、emitter stub 修复）。
- `packages/theia-product/src/main/node/kairo-product-backend-module.ts`（新）+ package.json theiaExtensions.backend：**后端 EncodingService rebind** 为 KairoSafeEncodingService（增量保存路径在后端编码，emoji 腐蚀的另一条路，已堵）。
- `packages/theia-product/src/main/browser/kairo-saveable-service.ts`（新）+ frontend module rebind SaveableService + **FileService rebind**。
- `packages/java-extension/src/browser/java-ls-lifecycle.ts`：JDT prepare/descriptor 用 `project.workspaceId` 而非 workspace context（修了 404 错工作区）。
- `runtime-agent/internal/services/config.go`：**ProjectStore/ProjectRepo 共享同一 diskProjectStore 实例**（修 JDT 404 project not found 根因）+ `config_test.go` 回归测试（绿）。
- `runtime-agent/internal/api/handlers.go`：launch-descriptor **不再强制 ToolchainID**（wizard 从不设置；descriptor 实际用 KAIRO_JRE17_HOME）。
- `scripts/start-qa-stack.sh`：导出 KAIRO_JRE17_HOME（/usr/libexec/java_home 解析）。
- `scripts/run-web-flow-03.cjs`：UTF-8 文件在 GBK 项目中先 Reopen-as-UTF-8（产品语义：文件夹默认强制）；console gate 白名单加编码拒绝噪音；emoji 检测正则放宽。
- 台账 +4 条（WEB-256/257/258/259）。

### 3.1 emoji 通知未弹出——调试思路（下一轮做）
在 `KairoFileService.write/update` 入口加 `console.info('[kairo] KairoFileService.write', resource.toString())` 标记 → 重建 → 跑**靶向探针**（不要全 flow-03）：起 19090 栈，开 GBK 文件，insertText emoji，Meta+S，看控制台有没有标记 + `.theia-Notifications` DOM。若标记没出现 → rebind 未生效（查 FileService 绑定时机/token）；若出现但没 toast → MessageService/通知 UI 问题。**用完删掉标记**。

### 3.2 JDT LS home 竞态——修复方案（下一轮做）
start-qa-stack.sh：stack 启动时把 `$REPO_ROOT/bundled/jdtls` **拷到 `$DATA_DIR/jdtls-home`**，导出 `KAIRO_JDT_LS_HOME=$DATA_DIR/jdtls-home`（Theia 后端用稳定副本，agent 的 EnsureInstalled 折腾 bundled/jdtls 不影响）。

## 4. 剩余步骤（按序，标注预计耗时）

1. §3.1 + §3.2 实施 + 一次重建（~10 min）。
2. flow-03 第 7 轮（~7 min）→ PASS 后 commit 批次。
3. flow-02 JDT（run-web-flow-02.cjs，~10 min，JDT 首次启动 1-2 min）：断言 completion 有真实 JDT 结果 + diagnostics→markers + 不再 BLOCKED。
4. flow-05 server 生命周期（run-web-flow-05.cjs，~10 min）：deploy/start/HTTP200/**restart（活体首验）**/logs/stop。
5. 性能基线 `node scripts/run-perf-baseline.cjs`（机器空闲时单独跑）。
6. M4 回归 `TESTED_COMMIT=$(git rev-parse HEAD) node scripts/run-regression-suite.cjs`。
7. 全量门禁：`pnpm test`（exit 0）、`go vet ./...`、`go test -race ./internal/...`、`gofmt -l cmd internal | grep -v provider/build`。
8. 台账 OPEN_PENDING → FIXED_VERIFIED 批量翻转 + commit。
9. 最终报告 `docs/release-testing/reports/<SHA>/MAC_WEB_FINAL_REPORT.md` + MAC_WEB_GATE 结论（有 FAIL/BLOCKED 就如实写）。已知限制写报告：WEB-248（backend target[e] P3 未定位）、WEB-210（rename 刷新待 flow-02 复验）、JDT 无 hover/rename、SHARED-001 Windows 双机 TESTED_COMMIT mac 侧做不了。
10. **合并 qa 分支到 main + push origin**（用户已明确授权）。

## 5. 已验证全绿（不必重测）

Wave 0 门禁、M1、axe 六面、视觉矩阵 63 张、flow-01/06、WebKit+Chromium 4/4、键盘流 8/8、XSS 探针、30min soak + 20 次重启零孤儿、Tomcat 实机 HTTP 200、JDT LS 归档安装。

## 6. 为什么慢 / 省 token 约定（后续 AI 必须遵守）

- 慢的主因：每验证一个假设就走"全量 webpack 重建（2-4min）+ flow-03 全流程（7min）"，已 6 轮。后续：**先把所有能静态确定的修复攒一批再重建**；能用靶向探针（3min）就不用全流程。
- 不要在主上下文通读大文件；用 Grep 定位 + Read 片段。子任务（flow-02/05/perf/M4）用 Agent 子代理跑，它们有独立上下文，只回传结论。
- 截图只在 FAIL 时读；PASS 证据以日志/JSON 为准。
