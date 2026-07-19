# Kairo IDE — Wave 6 测试与质量文档

> 文档用途：QA & Evidence Agent (Agent E) 的开发任务书  
> 负责 Agent：Agent E — QA & Evidence  
> 预计工作量：4-6 天  
> 前置条件：Wave 5 Gate 全部通过（Desktop 可启动）  
> 后置 Gate：所有核心 Gate 通过，E2E 无 gated，故障注入 8+ 场景通过

---

## 0. 目标

建立真实可信的测试金字塔：unit → contract → integration → E2E → fault injection → performance。删除所有假测试、gated、skip 和 `.catch(() => [])`。

---

## 1. 测试金字塔

```
        ┌──────────┐
        │   E2E    │  真实 Playwright 操作 UI
        ├──────────┤
        │  Fault   │  故障注入：Agent 退出、端口占用、EventStream gap
        ├──────────┤
        │Contract  │  Go/TS endpoint parity，每 endpoint golden fixture
        ├──────────┤
        │ Theia    │  service/contribution/widget factory 实例数测试
        ├──────────┤
        │Provider  │  real javac/Ant/Tomcat with temp workspace
        ├──────────┤
        │  Unit    │  path value object, config validation, encoding bytes
        └──────────┘
```

---

## 2. 任务清单

### 2.1 修复假测试

**问题文件**：
- `packages/encoding-extension/src/browser/encoding-service.test.ts` — 测试复制生产逻辑而非 import
- `packages/theia-product/src/main/browser/kairo-commands.test.cjs` — 用正则查源码而非实例化 container
- `packages/runtime-extension/src/browser/runtime.test.cjs` — 引用不存在的 `KairoRuntimeImpl`

**任务**：
1. `encoding-service.test.ts` 重写为 import 生产代码，测试真实 round-trip
2. `kairo-commands.test.cjs` 重写为实例化最小 Theia container，验证命令注册和执行
3. `runtime.test.cjs` 修复 import 路径，测试真实 HTTP client 行为

**禁止**：
- 不得复制生产逻辑到测试文件
- 不得用正则搜索源码字符串证明命令已实现
- 不得只断言 HTTP 200，不验证业务 state

### 2.2 Contract tests

**新文件**：`tests/contract/`

**对 EndpointMap 中每个 endpoint**：
- method/path
- request envelope
- success response
- error response（invalid、unauthenticated、forbidden、not found）
- Go/TS fixture parity
- list/item state shape
- unsupported method 返回 405

**特别断言**：
- `GET /api/v1/builds|deployments|servers` 真实返回 200
- `POST /api/v1/servers/{id}/restart` 真实改变 PID
- protocol 不再包含后端不支持的 JDT DELETE
- secret header 缺失/错误/正确三种情况
- WebSocket secret/replay/gap

**实现方式**：
- Go 测试与 TypeScript 测试使用同一组 `testdata/contracts/*.json` golden fixtures
- 新增 executable parity test（不是注释说"未来加脚本"）

### 2.3 真实 Playwright E2E

**重写文件**：`tests/e2e/ui-full-chain.cjs`

**当前问题**：N-047/048：注释声称 UI-only，实际直接调用 Agent API；core step 允许 GATED 后退出 0。

**目标**：

```ts
// 测试主体只操作 UI
test('full chain: import → build → deploy → start → restart → stop', async ({ page }) => {
    // 1. Import Wizard
    await page.click('[data-testid="import-project-btn"]');
    await page.fill('[data-testid="project-name-input"]', 'legacy-sample');
    await page.click('[data-testid="save-config-btn"]');

    // 2. Wait for build
    await page.click('[data-testid="build-btn"]');
    await page.waitForSelector('[data-testid="build-status"]:has-text("succeeded")');

    // 3. Deploy
    await page.click('[data-testid="deploy-btn"]');
    await page.waitForSelector('[data-testid="deploy-status"]:has-text("deployed")');

    // 4. Start server
    await page.click('[data-testid="start-server-btn"]');
    await page.waitForSelector('[data-testid="server-status"]:has-text("running")');

    // 5. HTTP verify
    const response = await page.request.get('http://127.0.0.1:{port}/hello');
    expect(response.status()).toBe(200);

    // 6. Edit JSP and redeploy
    // ...

    // 7. Restart
    await page.click('[data-testid="restart-server-btn"]');
    // 验证 PID 变化

    // 8. Stop
    await page.click('[data-testid="stop-server-btn"]');
    await page.waitForSelector('[data-testid="server-status"]:has-text("stopped")');
});
```

**实现要求**：
1. 测试主体只操作 UI（允许 direct API 仅做启动前 health 和最终独立交叉验证）
2. 用 `data-testid`/`role`，不使用脆弱文本正则和 `window.theia.commands` 后门
3. Build 必须等待 Build View 显示 `succeeded`
4. Deploy 必须等待 Deployment View 显示 `deployed` 和文件统计
5. Server 必须等待 Server View `running`，再从真实 HTTP 访问
6. Restart 必须观测 PID/startedAt 变化
7. Java completion/F12 必须真实执行
8. GBK JSP：记录修改前 bytes → UI 编辑保存 → Agent/文件 bytes 验证仍为 GBK → deploy → HTTP 看见新内容
9. core step 失败必须 exit 1；禁止 gated
10. 截图只作证据，断言必须基于状态/行为

### 2.4 故障注入测试

**新文件**：`tests/fault/`

**至少覆盖**：
1. Agent 启动端口瞬时竞争
2. Agent 在 build 中退出
3. Ant/javac timeout/cancel
4. Tomcat 端口占用
5. Tomcat stop 超时后 force
6. EventStream 断开重连和 history gap
7. repository JSON/YAML 截断
8. JDT checksum mismatch/crash loop
9. GBK 不可表示字符拒绝保存且原文件不变
10. deploy 中途读权限失败，报告 partial/error
11. Desktop 退出时三个子进程同时存在

**每个场景**：
- 触发方式（如何注入故障）
- 预期行为（系统应如何响应）
- 恢复验证（系统能否恢复正常）

### 2.5 性能基线

**目标环境**：2 vCPU / 4 GB（或等效限制）

| 指标 | 目标 |
|------|-----:|
| Desktop 到编辑器可交互 | ≤ 8s |
| Agent idle RSS | 记录基线，回归 ≤ 15% |
| 打开 1000 行 Java 文件 | ≤ 1s（不含首次 JDT 索引） |
| 1000 条日志连续到达时 UI 长任务 | 单次 ≤ 100ms |
| Event reconnect + snapshot 恢复 | ≤ 3s |
| Agent 退出后子进程清理 | ≤ 8s |

**测量方法**：
- 在 `windows-2022` 2-core runner 上测量（或等效 Linux cgroup 限制）
- 使用 `scripts/perf-collect.ps1` 或等效脚本
- 结果写入 `docs/perf-reports/`

### 2.6 CI 最终结构

**CI jobs**：
1. `go-unit-linux`：unit + race + vet
2. `go-cross-build`：Windows/Linux/macOS amd64
3. `ts-clean-build`：全新 install、clean、build、lint、unit
4. `contract`：Go/TS endpoint parity + secret/event tests
5. `integration-core`：sample import/search/encoding/build（不需要 Tomcat）
6. `integration-tomcat-linux`：下载固定 Tomcat、完整闭环（不允许 skip）
7. `theia-java-e2e`：Theia + JDT completion/definition
8. `desktop-smoke-windows`：artifact 启动、主链最小 smoke、进程清理
9. `desktop-smoke-macos`：artifact 启动和进程清理

**规则**：
- 所有 release jobs 必须 required
- 不允许核心 job 使用 `continue-on-error`
- 没有依赖时明确 fail，不要 gate
- Tomcat/JDT 版本和 checksum 固定
- failure 上传 Agent/Theia/Tomcat/JDT logs 和截图
- cache 不能成为正确性前提（cache miss 与 hit 都可运行）

---

## 3. Wave 6 Gate Checklist

- [ ] Go unit/race/vet 全绿
- [ ] TS clean build/test/lint 全绿
- [ ] contract tests 全绿（所有 endpoint 覆盖）
- [ ] Tomcat integration 无 skip
- [ ] UI E2E 无 core gated
- [ ] Java E2E 真 completion/F12
- [ ] encoding tests 调生产代码
- [ ] 8+ 故障注入场景通过
- [ ] 性能指标在目标范围内
- [ ] CI 所有 required jobs 通过
- [ ] MILESTONES 与实际一致
- [ ] `docs/progress/NEXT_ITERATION_FINAL_REPORT.md` 有可复现证据

---

## 4. 禁止的测试模式

- 核心能力不得 `t.Skip` 或 `gate` 后仍算绿色
- 不得只搜索源码字符串证明命令已实现
- 不得 `.catch(() => [])` 后断言空列表
- 不得用 mock 后端证明真实协议兼容
- 不得只断言 HTTP 200，不验证业务 state 和磁盘/进程副作用
- 不得在 release report 手工粘贴旧测试数字作为当前证据
- 不得为了达标静默关闭 Java intelligence 或跳过核心组件