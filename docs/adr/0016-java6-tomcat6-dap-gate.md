# ADR-0016 — Java 6 / Tomcat 6 / DAP 技术闸门

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Architecture

## Context

Phase 1 Debug 的目标是在 Kairo IDE 中提供完整的 Java 6 + Tomcat 6 调试体验。
但调试是一个多组件协同的场景：JDK 6 的 JDWP agent、Tomcat 6 的 debug 模式启动、
DAP (Debug Adapter Protocol) 适配器与 JDWP 的通信、以及 IDE 前端与 DAP 适配器的
交互。任何一个环节的兼容性问题都可能导致调试功能不可用。

在投入大量前端 UI 开发之前，必须先通过一个最小化的技术闸门探针来验证
Java 6 + Tomcat 6 + DAP 这条链路是可行的。如果闸门探针失败，我们将以
ADR 记录阻塞证据，Phase 1 将不带 Debug 功能发布。

## Decision

### 闸门探针（Gate Probe）

闸门探针是一个最小化的自动化验证流程，通过 Go agent 执行以下检查：

1. **JDK 6 JDWP 可用性**：以用户提供的 JDK 6 启动一个 Java 进程，配置
   `-Xdebug -Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=0`，
   验证 JDWP agent 是否成功启动并监听端口。

2. **Tomcat 6 Debug 模式启动**：使用用户提供的 JDK 6 和 Tomcat 6.0.53，
   以 debug 模式启动 Tomcat（`-agentlib:jdwp=` 参数），验证 JDWP 端口
   是否可连接。

3. **JDWP 握手验证**：连接到 JDWP 端口，发送 JDWP 握手字符串
   `JDWP-Handshake`，验证是否能收到正确的握手响应。

4. **DAP 适配器连通性**：验证 Microsoft Java Debug Server 或 Eclipse JDT
   Debug 能否连接到 JDWP 端口并读取断点信息。

5. **断点命中验证**：在一个 Java 6 编译的 `.class` 文件上设置行断点，
   通过 HTTP 请求触发，验证断点是否正确命中。

6. **变量可见性验证**：断点命中后验证局部变量和 request 参数是否可见。

7. **Step 操作验证**：验证 Step Over / Step Into / Step Out 是否正常执行。

8. **平台兼容性**：验证以上所有步骤在 Windows 10 和 macOS 上均通过。

### 探针矩阵

| 维度 | 组合 | 预期结果 |
|---|---|---|
| JDK | JDK 6 (user-provided) | JDWP agent starts with `-Xdebug -Xrunjdwp` |
| Tomcat | 6.0.53 | Tomcat starts in debug mode, JDWP listens on configured port |
| DAP Adapter | Microsoft Java Debug Server / Eclipse JDT Debug | Connects to JDWP, reads breakpoints |
| Breakpoint | Java 6 `.class` compiled with `javac 6` | Line breakpoint hits correctly |
| Variables | Local variables, request params | Variables visible in debug view |
| Step | Step Over / Into / Out | Step executes correctly |
| Platform | Windows 10 + macOS | Both platforms pass |

### 风险与降级策略

#### 风险 1: JDK 6 JDWP 协议局限性

JDK 6 的 JDWP 实现版本较旧，可能不支持部分 DAP 适配器需要的 JDWP 命令。
尤其是 JDK 6 update 45 之前的版本，JDWP 协议存在已知 bug。

**降级**：如果 JDK 6 JDWP 与 DAP 适配器不兼容，降级为使用 JDK 6 的 JDI
(Java Debug Interface) 通过自定义桥接层连接，或限制调试功能为仅支持
断点和变量查看，不支持条件断点和求值表达式。

#### 风险 2: DAP 适配器兼容性

Microsoft Java Debug Server 主要针对 JDK 8+ 开发和测试，对 JDK 6 的
JDWP 协议支持程度未知。Eclipse JDT Debug 对旧版 JDK 有更好的兼容性，
但可能缺少部分 DAP 功能。

**降级**：优先使用 Eclipse JDT Debug 作为 DAP 适配器，其对 JDK 6 的
兼容性更好。如果两个适配器都无法正常工作，实现基于 JDI 的轻量调试桥接。

#### 风险 3: 源码/类文件不匹配

Java 6 项目使用 `javac 6` 编译，`.class` 文件中的行号表可能与现代
debug 适配器期望的格式存在差异。源代码修改后未重新编译会导致断点
绑定到错误的行。

**降级**：在调试前自动检查源码/类文件时间戳一致性，提示用户重新编译。
如果问题持续存在，允许用户手动关联断点行号。

#### 风险 4: 平台差异

JDK 6 在 Windows 和 macOS 上的 JDWP 行为可能存在差异，尤其是在
进程信号处理和 socket 通信方面。

**降级**：如果某个平台无法通过闸门探针，Phase 1 仅支持通过探针的平台，
并在不支持平台上显示明确的"调试功能不可用"提示。

#### 闸门失败处理

如果闸门探针在任一维度失败，执行以下步骤：

1. 记录详细的失败证据（日志、错误码、版本信息）到 ADR 附录
2. 在 `MILESTONES.md` 中标记 Debug 为 Phase 2 功能
3. Phase 1 发布时，Debug 菜单项灰显，hover 提示"调试功能将在后续版本中支持"
4. 在项目路线图中明确 Debug 功能的依赖和阻塞项

### 验证命令

```bash
# 通过 Go agent 运行闸门探针
cd runtime-agent
go run ./cmd/gate-probe \
  --java-home /path/to/jdk6 \
  --tomcat-home /path/to/tomcat6 \
  --debug-port 5005 \
  --project-root /path/to/sample-servlet-project

# 预期输出（JSON）:
# {
#   "jdk6Jdwp": true,
#   "tomcat6Debug": true,
#   "jdwpHandshake": true,
#   "dapConnectivity": true,
#   "breakpointHit": true,
#   "variablesVisible": true,
#   "stepOperations": true,
#   "platform": "darwin",
#   "errors": [],
#   "durationMs": 15234
# }
```

## Consequences

- Debug 功能的开发和发布取决于闸门探针的通过情况
- 闸门探针代码（`runtime-agent/internal/debug/gate_probe.go`）作为
  持续集成的一部分，在每次 PR 中运行
- 如果闸门失败，Phase 1 将不带 Debug 功能发布，Debug 功能推迟到 Phase 2
- 前端调试兼容性检查（`java-debug-compat-check.ts`）在每次调试会话
  启动前执行快速检查，作为闸门探针的轻量替代
- 所有闸门探针检查均有 30 秒超时，避免阻塞 CI 流水线