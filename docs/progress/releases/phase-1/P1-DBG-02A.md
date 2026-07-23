# P1-DBG-02A 原生 Debug 核心体验接线与异常恢复

- 状态：implemented（等待真实 Adapter / JDK 6 验证后才能 verified）
- 负责人/模型：Codex Debug Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：工作区当前未提交状态
- 最终提交：未提交
- 依赖任务：P1-DBG-00、P1-DBG-01

## 目标与设计原则

复用 Theia 1.73.1 已提供且经过产品化验证的 Debug UI 与 DAP 状态机，不为 `kairo-java` 重造断点、线程、调用栈、变量、监视或控制台。Kairo 只负责安全地创建本机 Tomcat JDWP attach 会话、呈现会话状态和提供清晰入口。

所有“暂停/连接”状态都来自真实 Theia/DAP 生命周期事件。没有真实 Adapter 时不伪造断点命中、变量值、调用栈或单步结果。

## 原生能力审计矩阵

| 使用者能力 | 复用组件/命令 | 默认快捷键 | Kairo 接线结论 |
|---|---|---|---|
| 启动/继续 | Theia `DebugCommands.START/CONTINUE` | `F5` | `kairo-java` 使用默认 `DebugSessionFactory`，自动进入原生会话 |
| 停止 | Theia `DebugCommands.STOP` | `Shift+F5` | 停止 Server 时先结束 Kairo 拥有的 Debug 会话 |
| 暂停 | Theia `DebugCommands.PAUSE` | `F6` | 原生线程控制，不包装 DAP 请求 |
| 单步跳过 | Theia `STEP_OVER` | `F10` | 原生实现 |
| 单步进入 | Theia `STEP_INTO` | `F11` | 原生实现 |
| 单步跳出 | Theia `STEP_OUT` | `Shift+F11` | 原生实现 |
| 行断点 | Theia Breakpoints | `F9` | 原生断点模型与编辑器装饰 |
| 线程/调用栈 | `DebugThreadsWidget` / `DebugStackFramesWidget` | Debug 视图内操作 | 自动随标准会话出现 |
| 变量/监视 | `DebugVariablesWidget` / `DebugWatchWidget` | Debug 视图内操作 | 自动随标准会话出现 |
| Debug Console | Theia Debug Console | 命令面板 | `Kairo: Open Debug Console` 委托 `debug:console:toggle` |

浏览器产品明确依赖固定版本 `@theia/debug@1.73.1`，生成的 frontend composition 加载 `debug-frontend-module`。Kairo 没有注册自定义 `DebugSessionContribution` 或 `DebugSessionFactory`，因此 `type: kairo-java` 使用 Theia 默认 DAP 会话和上述全部原生视图。

## 本切片实现

- attach 配置设置 `openDebug: openOnSessionStart` 与 `internalConsoleOptions: openOnSessionStart`；仅在真实 DAP session start 后打开原生 Debug 视图和控制台。
- 新增 `Kairo: Open Debug View` 与 `Kairo: Open Debug Console`，分别委托 Theia 标准命令，不复制 UI。
- 状态栏增加轻量文本项 `Debug: <state>`，点击打开原生 Debug 视图。仅监听状态事件，不轮询、不渲染复杂组件。
- 状态新增 `paused`：只在 Theia `onDidStopDebugSession` 事件后进入；会话恢复 Running 后回到 `connected`。
- 用户主动停止进入 `terminated`；Adapter 意外销毁进入 `error`，提示 Tomcat 可能仍在运行，避免把异常退出显示为正常停止。
- attach 保留 30 秒硬超时；会话未完成初始化/attach、提前销毁或卡死时失败关闭并清理已创建会话。
- Adapter argv 安全边界：最多 64 项、单项最多 8192 字符、JSON 环境变量最多 65536 字符，并拒绝命令或参数中的 NUL；全程使用字符串数组，不经过 shell。

## RunConfiguration 协作边界

当前 attach 目标继续携带 `projectId / serverId / projectRoot`，用于把一次 Debug 会话绑定到真实运行实例。统一 `RunConfiguration` 类型及 Runtime CRUD 正由配置模型波次实现，本切片不复制、不改写其文件，避免产生第二套 schema。

后续接线应采用单向映射：`RunConfiguration(Debug)` → 启动/选择 Tomcat 实例 → 获得 Runtime 返回的真实 JDWP port → 生成临时 DAP attach configuration。持久化配置不得保存“已连接”状态，也不得用预估端口替代 Runtime 返回端口。

## 自动化契约与验收

- 原生接线契约锁定浏览器依赖、frontend module、五个核心 Debug 子视图、标准快捷键和默认 Session Manager 接线。
- Command 契约验证 Kairo 两个入口精确委托 `debug:toggle` 与 `debug:console:toggle`。
- 会话测试覆盖 connected → paused → connected、主动停止、Adapter 意外销毁、attach 前销毁和超时清理。
- Adapter 测试覆盖 argv 边界、NUL、绝对可执行路径、本机 host、attach-only 和端口范围。
- TypeScript build、lint 与产品单元/Composition 测试必须全部通过。

## 测试命令与结果

- `pnpm --filter @kairo/theia-product build`：PASS。
- `pnpm --filter @kairo/theia-product lint`：PASS。
- `pnpm --filter @kairo/theia-product test`：PASS；基础/Debug/Command 契约 38/38，Composition 6/6。
- jsdom 仍输出仓库既有的 `window.open` / Canvas not implemented 诊断，但退出码为 0，全部断言通过。

## 人工验收步骤（有批准 Adapter 后）

1. 配置批准 Adapter 的绝对路径与 JSON argv，启动 Kairo 浏览器版。
2. 在 Java 源码有效行按 `F9` 设置断点，执行 `Kairo: Start Server (Debug)`。
3. 确认只有 DAP attach 成功后 Debug 视图与 Debug Console 打开，状态栏显示 connected。
4. 发起能命中该代码路径的 HTTP 请求；确认状态栏变为 paused，Threads、Call Stack、Variables 展示真实数据。
5. 验证 `F10`、`F11`、`Shift+F11`、`F5` 与 `F6`，并检查状态恢复。
6. 终止 Adapter 进程，确认状态为 error 且 Tomcat 状态保持真实；再测试正常 Stop 为 terminated。
7. 在 Windows 10 浏览器部署环境重复上述流程，验证带空格路径的 Adapter 与项目路径保持 argv 边界。

## 性能与可访问性

- 不新增 Debug 数据副本、轮询器或大型 React 树；线程、变量与调用栈虚拟化/刷新策略继续由 Theia 管理。
- 状态栏仅在离散事件上更新一个文本元素，对编辑器输入、搜索和构建链路无持续开销。
- 入口使用 Theia 命令与键盘模型，保留原生焦点、键盘导航、主题和高对比度支持。

## 未完成与投产限制

- 当前环境仍没有已批准的 Java Debug Adapter 和合法 JDK 6；真实 breakpoint hit、Variables、Watch、Evaluate、步进以及 Windows 端到端尚未 verified。
- 因此本任务只能标记 `implemented`，不能对外宣称完整 Java Debug 已投产。
- P1-DBG-03 必须完成真实 Adapter/JDK 6 兼容矩阵、断点命中与源映射验收、异常协议日志脱敏和 Windows E2E。

## 回滚

移除 Kairo Debug 状态栏元素和两个导航命令，恢复服务的 `paused`/异常销毁状态扩展，并删除原生接线契约测试；P1-DBG-01 的 attach-only 能力仍可独立保留。
