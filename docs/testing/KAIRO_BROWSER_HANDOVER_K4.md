# KAIRO Browser 端全量回归测试 - 交接文档 (K4 端口组)

**生成时间**: 2026-07-26 12:10 (Asia/Shanghai)
**会话状态**: 进行中,需要换窗口继续
**测试端口组**: K4 (Frontend 18301 / Agent 18300 / Tomcat 18302)

---

## 一、当前进度 (按 SHARD 汇总)

| Shard | 范围 | 用例数 | 已完成 | 待完成 | 备注 |
|-------|------|--------|--------|--------|------|
| 01 | IDE 启动 + Shell + 状态栏 | 8 | 8/8 | — | 全部完成 |
| 02 | 项目导入 + 文件管理 + 多标签 | 8 | 8/8 | — | 全部完成 |
| 03 | Java 语言服务 | 13 | 11/13 | TEST-0312, TEST-0313 | 已跑通主流程,末两条未跑 |
| 04 | JSP/XML/Properties 多语言 | 9 | 9/9 | — | 全部完成 |
| 05 | 构建 + 部署 + Tomcat | 11 | 9/11 | **TEST-0505, TEST-0507** | 关键路径,需优先 |
| 06 | 调试功能 | 13 | 2/13 | **TEST-0603 ~ TEST-0613 (11 个)** | 整个 shard 几乎未跑 |
| 07 | 搜索 + Git/SVN + 编码 | 12 | 12/12 | — | 全部完成 |
| 08 | SQL/JUnit + UI/无障碍/视觉 | 15 | 15/15 | — | 全部完成 |
| **合计** | | **89** | **74** | **15** | 整体完成度 83% |

截图证据位于: `test-results/screenshots/shard-XX/TEST-XXXX/`

---

## 二、本会话关键修复 (已落地)

### 1. Tomcat 6 + Java 21 兼容性修复 (本次会话核心修复)

**问题**: Tomcat 6.0.53 在 Java 21 上启动后,webapp 第一次 reload 时崩溃 `InaccessibleObjectException: Unable to make field java.lang.ThreadLocal$ThreadLocalMap ... accessible: module java.base does not "opens java.lang" to unnamed module`。HTTP 端口仍 LISTEN,但所有后续请求挂起 (curl 拿到连接但 0 字节响应,5 秒超时)。

**修复**: `runtime-agent/internal/tomcat6/tomcat6.go` 在 `BuildCommand` 中自动注入 4 个 `--add-opens` JVM 参数 (对 Java 8 是 no-op,安全):
```go
addOpens := []string{
    "--add-opens=java.base/java.lang=ALL-UNNAMED",
    "--add-opens=java.base/java.util=ALL-UNNAMED",
    "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED",
    "--add-opens=java.base/sun.security.x509=ALL-UNNAMED",
}
```
代码位置: [tomcat6.go:118-131](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/tomcat6/tomcat6.go#L118-L131)

**验证状态**: 二进制已重新编译 (`.runtime-k4/bin/kairo-runtime` 在会话中被替换),runtime-agent 已用新二进制重启 (PID 34743)。**注意: Tomcat 还需要在干净的 catalina-base 上重新启动才能验证修复生效。**

### 2. 此前已修复的若干问题 (无需重复处理)
- ActiveProjectService DI 冲突 (product-bindings.ts 单点绑定)
- 工作区上下文运行时重连被覆盖 (WorkspaceContextService 加守卫)
- `runtime.setWorkspace` 冗余调用导致 EventStream 反复重连
- project.yaml / KairoJavaConfig.ini / build.xml 全部从 JDK 1.6 改为 1.8 (兼容现代 JDK 9+)
- fixtures.ts 的 `getTomcatBaseUrl` 改为优先通过 Runtime Agent API 检测 running server

---

## 三、当前环境状态

### 进程
| 进程 | PID | 端口 | 状态 |
|------|-----|------|------|
| runtime-agent (新二进制) | 34743 | 18300 | ✅ 运行中 |
| Theia browser | 43222 | 18301 | ✅ 运行中 |
| pnpm theia wrapper | 43220 | — | ✅ 运行中 |

### 残留 Tomcat 服务器 (需要清理)
API 报告以下服务器实例存在 (大部分是 K1/K2/K3 端口组的残留,**不是 K4 自己的 18302**):
```
srv_e76590fc  http:18082  state:running   ← 其它 AI 模型残留
srv_b6e01837  http:18091  state:running   ← 其它 AI 模型残留
srv_1c8a325b  http:18093  state:running   ← 其它 AI 模型残留
srv_14291f21  http:18302  state:running   ← K4 自己的 (本次修复待验证)
srv_ab2fc504  http:18087  state:running   ← 其它 AI 模型残留
srv_3f95a2df  http:18089  state:running   ← 其它 AI 模型残留
+ 3 个已 stopped 但未删除
```

### 端口与配置
- Theia 入口: `http://127.0.0.1:18301`
- Runtime Agent: `http://127.0.0.1:18300`
- K4 Tomcat 默认: 18302 (在 `runtime-agent/configs/browser-regression-k4.yaml` 中配置)
- Playwright config: `tests/e2e/playwright.config.ts` 端口 18301 已对齐
- 工作区目录: `/tmp/kairo-k4-workspace/projects/workspace-shard{01..08}`

---

## 四、下一步行动清单 (按优先级)

### 立即 (P0): 验证 Tomcat 修复并完成 SHARD-05

1. **清理 K4 残留 Tomcat**,只留一个干净的 18302 实例:
   ```bash
   # 删掉所有其它端口组残留 (K4 只用 18302)
   for sid in srv_e76590fc srv_b6e01837 srv_1c8a325b srv_ab2fc504 srv_3f95a2df srv_6402aa9e srv_b464b45c; do
     curl -s -X DELETE http://127.0.0.1:18300/api/v1/servers/$sid
   done
   # 杀进程
   pkill -f "java.*catalina" 2>/dev/null
   sleep 2
   # 清掉 catalina-base (让修复后的二进制生成新的)
   rm -rf /Users/qi/Documents/spaces/kairo-ide/.runtime-k4/data/runtime
   ```
2. **手动启动一个 Tomcat 验证修复**:
   ```bash
   # 通过 Theia UI 在 workspace-shard05 触发 Build & Deploy + Start Server
   # 或直接用 API:
   curl -X POST http://127.0.0.1:18300/api/v1/servers \
     -H "Content-Type: application/json" \
     -d '{"projectId":"project-workspace-shard05"}'
   sleep 15
   curl -sv http://127.0.0.1:18302/ --max-time 5
   # 期望: HTTP/1.1 200,不是 connection refused/timeout
   ```
3. **跑 TEST-0505** (`tests/e2e/regression/shard-05-build.spec.ts`):
   ```bash
   cd /Users/qi/Documents/spaces/kairo-ide
   npx playwright test --config tests/e2e/playwright.config.ts \
     tests/e2e/regression/shard-05-build.spec.ts \
     -g "TEST-0505" --workers=1
   ```
4. **跑 TEST-0507** (JSP 热重载):同样命令行,改 `-g "TEST-0507"`。
   注意: TEST-0507 会触发 webapp reload,这正是验证 `InaccessibleObjectException` 修复的关键测试。如果不再有 5 秒挂起,即修复成功。

### 短期 (P1): 完成 SHARD-06 (调试功能)
```bash
npx playwright test --config tests/e2e/playwright.config.ts \
  tests/e2e/regression/shard-06-debug.spec.ts --workers=1
```
调试测试**不依赖 Tomcat 修复**,理论上可以独立跑。预期需要 JDK 1.6 + Tomcat + jdwp 端口 18303 可用。当前 session 没有验证过 JDWP 端口是否被别的进程占用,跑前先 `lsof -i:18303`。

### 收尾 (P2): 完成 SHARD-03 末两条
```bash
npx playwright test --config tests/e2e/playwright.config.ts \
  tests/e2e/regression/shard-03-java.spec.ts \
  -g "TEST-0312|TEST-0313" --workers=1
```

### 收尾 (P3): 生成最终报告
把所有 8 个 shard 的 results.json 合并,统计 pass/fail/skip,写一份
`docs/testing/KAIRO_BROWSER_FULL_REGRESSION_TEST_REPORT.md`。

---

## 五、给新会话的话术 (直接复制给新 AI 窗口)

```
继续完成 KAIRO Browser 端全量回归测试 (K4 端口组 3080/18300/8086)。
会话上下文见 docs/testing/KAIRO_BROWSER_HANDOVER_K4.md。

环境已经就绪:
- runtime-agent PID 34743 (端口 18300)
- Theia PID 43222 (端口 18301)
- 工作区 /tmp/kairo-k4-workspace/projects/workspace-shard{01..08}
- 配置: runtime-agent/configs/browser-regression-k4.yaml
- 测试计划: docs/testing/KAIRO_BROWSER_FULL_REGRESSION_TEST_PLAN.md
- 关键修复已在 tomcat6.go 落地 (--add-opens for Java 9+)

剩 15 个用例:
- SHARD-03: TEST-0312, TEST-0313
- SHARD-05: TEST-0505, TEST-0507  ← 优先,Tomcat 修复验证
- SHARD-06: TEST-0603 ~ TEST-0613 (11 个调试用例)

执行步骤:
1. 读交接文档 docs/testing/KAIRO_BROWSER_HANDOVER_K4.md
2. 清理残留 Tomcat (见文档 §四.1)
3. 先单独跑 TEST-0505 / TEST-0507 验证 Tomcat 修复
4. 然后跑 SHARD-06 全部
5. 补完 SHARD-03 末两条
6. 汇总生成最终报告

注意:
- 跑前先 lsof -i:18302,18303 确认无残留进程
- 测试用 --workers=1 (避免端口/资源竞争)
- SHARD-05/06 每个 test 内部都会 import 项目,跑完全部要 30+ 分钟
- 不要修改已稳定的 fixtures.ts,只在 shard-XX.spec.ts 内做调整
```

---

## 六、关键文件速查

| 类别 | 路径 |
|------|------|
| 测试计划 | `docs/testing/KAIRO_BROWSER_FULL_REGRESSION_TEST_PLAN.md` |
| 修复位置 | `runtime-agent/internal/tomcat6/tomcat6.go` (第 110-123 行) |
| K4 端口配置 | `runtime-agent/configs/browser-regression-k4.yaml` |
| Playwright 配置 | `tests/e2e/playwright.config.ts` |
| 测试夹具 | `tests/e2e/fixtures.ts` (getTomcatBaseUrl, stopAllRunningServers) |
| 样本项目 | `legacy-sample/` |
| 工作区 | `/tmp/kairo-k4-workspace/projects/workspace-shard{01..08}` |
| Runtime Agent 数据 | `.runtime-k4/data/runtime/srv_*/` |
| 截图证据 | `test-results/screenshots/shard-{01..08}/TEST-XXXX/*.png` |
| Agent 日志 | `.runtime-k4/agent.log` |
| Theia 日志 | `.runtime-k4/theia.log` |

---

## 七、已知陷阱 (前人踩过)

1. **不要相信 `curl 127.0.0.1:PORT` 直接探活 Tomcat** —— 旧版 (修复前) Tomcat 即使死锁也会 ACCEPT 连接然后挂起响应,必须 `curl --max-time 5` 看是否有字节回包。
2. **macOS 默认 IPv6 优先** —— `lsof -i:PORT` 可能只看到 IPv6,但 `netstat -an -p tcp | grep PORT` 同时列 IPv4,后者更准。
3. **JDK 6 source/target 在 JDK 9+ 被移除** —— 测试环境的 modern JDK 不支持,所有项目 config 必须是 1.8。
4. **不要直接 `cd workspace && pnpm install`** —— 跑 Playwright 之前要确保 `pnpm-lock.yaml` 已更新,且 node_modules 在仓库根目录已存在。
5. **其它 AI 模型共用同一台机** —— 跑测试前先 `ps aux | grep -E "java.*catalina"` 看是否有别人残留的 Tomcat 进程,端口可能冲突。
6. **跑 Playwright 之前确保 JDT LS 已就绪** —— 第一次访问 Theia 后,等状态栏 "JDT LS: ready" 再开始测试,否则 Java 相关断言会假阳性。
7. **`pnpm dev:browser` 不要 kill** —— Theia 进程被 kill 后,playwright 的 `webServer` 配置会试图重启,但跟手动启动的 Theia 端口冲突。直接复用现有 Theia。

---

## 八、命令备查

```bash
# 启动 runtime-agent (后台,日志到 .runtime-k4/agent.log)
nohup ./runtime-agent/bin/kairo-runtime \
  --config runtime-agent/configs/browser-regression-k4.yaml \
  > .runtime-k4/agent.log 2>&1 & disown

# 启动 Theia (后台,日志到 .runtime-k4/theia.log)
cd /Users/qi/Documents/spaces/kairo-ide
nohup pnpm --filter @kairo/browser exec theia start \
  /tmp/kairo-k4-workspace \
  --hostname=127.0.0.1 --port=18301 \
  > .runtime-k4/theia.log 2>&1 & disown

# 重新编译 runtime-agent
cd runtime-agent && go build -o bin/kairo-runtime ./cmd/runtime

# 单独跑一个 shard
npx playwright test --config tests/e2e/playwright.config.ts \
  tests/e2e/regression/shard-05-build.spec.ts --workers=1

# 单独跑一个用例
npx playwright test --config tests/e2e/playwright.config.ts \
  -g "TEST-0505" --workers=1

# 清理所有 Tomcat
pkill -f "java.*catalina" 2>/dev/null
for sid in $(curl -s http://127.0.0.1:18300/api/v1/servers | jq -r '.payload[].id'); do
  curl -s -X DELETE http://127.0.0.1:18300/api/v1/servers/$sid > /dev/null
done
```

---

**交接完成。下一个窗口请先读本文档 §四,按优先级执行即可。**
