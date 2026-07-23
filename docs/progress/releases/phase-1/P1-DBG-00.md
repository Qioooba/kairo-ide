# P1-DBG-00 Java 6 / Tomcat 6 / DAP 技术闸门

- 状态：in_progress
- 负责人/模型：Codex 主 Agent
- 开始时间：2026-07-22
- 完成时间：
- 基线提交：`6b2fb07`
- 最终提交：未提交
- 依赖任务：P1-BASE-01

## 目标

证明真实 Java 6 / Tomcat 6 可以通过 JDWP 被 DAP Adapter 连接，并完成断点、变量和单步闭环。

## 用户价值

避免把“Tomcat 开了 JDWP 端口”误报成“IDE 已经能够 Debug”。

## 范围

- 第一切片：保留并展示 Agent 返回的 JDWP 端口。
- 在 Server 页面提供明确的 `Debug Server` 入口。
- UI 文案明确区分 JDWP ready 与 Debug Adapter attached。
- 为协议到视图的映射补充自动化测试。

## 非范围

- 本切片不实现 DAP Adapter。
- 本切片不宣称断点、变量或单步已完成。

## 实现摘要

- `ServerStore` 现在保留 Agent 返回的 JDWP 端口。
- Server 页面新增 `Debug Server` 入口，并以 `JDWP 127.0.0.1:<port> (ready)` 展示调试就绪端口。
- 状态栏展示 JDWP 端口，tooltip 明确说明它是本地监听端口。
- 映射逻辑拆为无 DOM 的纯函数，避免测试依赖浏览器环境。
- 文案明确：JDWP ready 不代表 Debug Adapter attached。
- 独立审查发现并修复了原实现的虚假状态：`debug` 请求现在真实贯通前端协议与 Go `StartServerRequest`，普通 Run 不再分配或展示 Debug 端口。
- Debug 模式向 Tomcat JVM 注入仅监听 `127.0.0.1` 的 JDWP 参数，并在返回成功前探测端口确已绑定；`suspend=y` 时以 JDWP 就绪作为启动边界。
- Restart 保留原会话是否启用 Debug 的语义；端口分配租约在启动探针结束后释放，避免有限端口范围被永久耗尽。

## 测试命令与结果

- `pnpm --filter @kairo/tomcat-extension build`：PASS。
- `pnpm --filter @kairo/tomcat-extension test`：PASS，11/11。
- `pnpm --filter @kairo/theia-product build`：PASS。
- `go test -count=1 -race -timeout 120s ./internal/runtimeplan ./internal/tomcat6 ./internal/services ./internal/api`：PASS。
- `pnpm --filter @kairo/protocol build && pnpm --filter @kairo/protocol test`：PASS，16/16。
- 新增普通 Run 无 JDWP、Debug 命令参数、真实监听端口探测和 HTTP debug 字段贯通测试。
- 首次测试直接加载 Theia browser 模块，29 秒内以 `document is not defined` 失败；随后将纯映射逻辑拆出并复测通过。

## 人工验收步骤与证据

待获得用户提供的合法 JDK 6 和真实 Windows 10 环境后执行完整闸门。

## 风险与遗留问题

- 当前环境没有合法 JDK 6，不能完成真实 HotSpot 6 attach 证明。
- Java Debug Adapter 尚未接入；当前端口已经是真实 JDWP listener，但仍不等于调试器已连接。

## 回滚方式

回退本任务涉及的 ServerStore、Server 页面、状态栏映射和测试文件。
