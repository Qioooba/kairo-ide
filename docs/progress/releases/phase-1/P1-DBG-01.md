# P1-DBG-01 Java Debug Adapter 最小真实垂直切片

- 状态：implemented（等待真实 Adapter / JDK 6 验证后才能 verified）
- 负责人/模型：Codex Debug Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：工作区当前未提交状态
- 最终提交：未提交
- 依赖任务：P1-DBG-00

## 目标与边界

把现有真实 JDWP listener 接入 Theia DAP 会话，但不下载未知二进制、不把端口就绪冒充为 Adapter attached。

本切片只支持 `attach` 到 `127.0.0.1`，Adapter 必须由运营者通过绝对路径显式配置，并通过 stdin/stdout 讲 DAP。未配置、路径无效、参数不是 JSON 字符串数组、端口非法或 Adapter 启动失败时均失败关闭。

## 实现摘要

- 新增 Theia backend `DebugAdapterContribution`，debug type 为 `kairo-java`。
- 使用 `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND` 指定已批准 Adapter 的绝对可执行文件路径。
- 可选 `KAIRO_JAVA_DEBUG_ADAPTER_ARGS` 必须是 JSON 字符串数组，避免 shell 拼接。
- Debug 命令先探测 Adapter；可用后才启动 Tomcat JDWP，再生成标准 attach 配置并启动 Theia Debug 会话。
- attach 失败会立即尝试停止本次启动的 Tomcat；若 Tomcat 自身停止失败，原始 attach 错误仍会明确展示。
- Stop Server 先终止 Kairo 拥有的 Debug 会话，再停止 Tomcat。
- 状态边界为 `unknown / unavailable / available / connecting / connected / terminated / error`；只有 Theia 的 `onDidStartDebugSession`（DAP initialize 与 attach 成功后）才能进入 connected，创建浏览器 Session 对象本身不算连接成功。
- 新增 `Kairo: Check Java Debug Adapter` 命令用于显式能力探测。

## 配置示例

```powershell
$env:KAIRO_JAVA_DEBUG_ADAPTER_COMMAND = 'C:\approved\java-debug-adapter.exe'
$env:KAIRO_JAVA_DEBUG_ADAPTER_ARGS = '["--stdio"]'
```

这只是接口示例，不代表仓库认可或分发某个 Adapter。Adapter 的来源、许可证、摘要及 Java 6 兼容性必须通过 P1-DBG-00 技术闸门。

## 自动化证据

- 能力探测拒绝缺失/相对路径、非文件路径和畸形参数。
- attach 配置固定 `127.0.0.1`，拒绝 launch、远程 host 和非法端口。
- Adapter 不可用时不会创建 Theia 会话。
- 会话测试覆盖 connecting → connected → terminated 以及启动失败 → error。
- 覆盖 Adapter attach 卡死的 30 秒硬超时，以及 attach 前 Session 被销毁的失败路径；两者都会终止已创建会话且绝不进入 connected。
- Command 测试验证 Debug 先获得真实 JDWP port，再调用 DAP attach。

## 测试命令与结果

- `pnpm --filter @kairo/theia-product build`：PASS。
- `pnpm --filter @kairo/theia-product lint`：PASS。
- `pnpm --filter @kairo/theia-product test`：PASS；Debug/Command/基础单测 30/30，Composition 6/6。
- jsdom 仍输出仓库既有的 `window.open`/Canvas not implemented 诊断，但退出码为 0，全部断言通过。

## 未完成与投产限制

- 当前环境没有已批准的 Java Debug Adapter，也没有合法 JDK 6，未执行真实 breakpoint → hit → variables → step。
- 因此本任务不能标记为 `verified`，产品也不能宣传 Java Debug 已完成。
- Adapter 退出后的更细错误分类、断点/变量/单步属于 P1-DBG-02/03。

## 回滚

移除 `kairo-java-debug-*` 新文件和 frontend/backend 绑定，并恢复 `KairoViewsContribution` 的 Debug 命令为仅启动 JDWP 的旧行为。
