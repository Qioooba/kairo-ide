# ADR-0019 — DebugSessionService 架构决策

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Wave 3.1 Debug Enhancement)

## Context

Kairo IDE 的 Java 调试功能需要支持 Java 6 + Tomcat 6 + JDWP 的调试场景。在 Session 4 中，我们从基础的断点/变量/栈帧 Widget 扩展到完整的 DebugSessionService，需要决定调试会话管理的架构。

核心挑战：
1. 调试状态的跨组件共享（Variables、Call Stack、Breakpoints 三个 Widget 需要同步状态）
2. 批量变量获取的性能优化（减少 JDWP 往返次数）
3. 断点生命周期管理（启用/禁用/条件断点）
4. 调试会话的启动/停止/异常处理

## Decision

### 1. DebugSessionService 集中式会话管理

采用单一 `DebugSessionService` 作为调试会话的中央状态管理器：

```typescript
interface DebugSessionService {
  // 会话生命周期
  startSession(config: DebugConfig): Promise<DebugSession>
  stopSession(): Promise<void>
  getCurrentSession(): DebugSession | null

  // 断点管理
  setBreakpoint(file: string, line: number, condition?: string): Promise<Breakpoint>
  removeBreakpoint(id: string): Promise<void>
  toggleBreakpoint(id: string, enabled: boolean): Promise<void>
  getBreakpoints(): Breakpoint[]

  // 执行控制
  resume(): Promise<void>
  pause(): Promise<void>
  stepOver(): Promise<void>
  stepInto(): Promise<void>
  stepOut(): Promise<void>

  // 状态查询
  getVariables(frameId: number): Promise<Variable[]>
  getCallStack(): Promise<StackFrame[]>
  getThreads(): Promise<Thread[]>

  // 事件流
  onSessionEvent: Event<DebugSessionEvent>
}
```

### 2. 批量变量获取优化

Go Agent 端实现批量变量获取，减少 JDWP 往返次数：

- `variable.go`：JDWP 变量解析，支持批量获取
- `stackframe.go`：栈帧解析
- 批量变量获取 API：一次请求获取所有可见变量，而非逐个请求

### 3. 三层架构

```
┌─────────────────────────────────────────────────┐
│  Debug Widgets (Variables / Call Stack / BP)     │  ← 前端 React
├─────────────────────────────────────────────────┤
│  DebugSessionService (状态管理 + 事件分发)        │  ← 前端服务层
├─────────────────────────────────────────────────┤
│  Go Agent (JDWP 协议解析)                        │  ← 后端
│  internal/debug/variable.go, stackframe.go, ...  │
└─────────────────────────────────────────────────┘
```

### 4. 测试策略

- Go Agent 端：86 个测试，覆盖 JDWP 变量解析、栈帧解析、断点操作
- 前端：8 个测试，覆盖 Widget 渲染和状态管理
- DebugSessionService：7 个新测试，覆盖会话生命周期

## Alternatives Considered

### 替代方案 A：每个 Widget 独立管理状态
每个 Debug Widget 直接与 Go Agent 通信，各自维护状态。此方案实现简单，但会导致状态不一致、重复请求、难以协调调试会话生命周期。

### 替代方案 B：使用 Redux/MobX 全局状态管理
引入 Redux 或 MobX 进行全局状态管理。此方案过度设计——调试会话状态的作用域仅限于 Debug 视图，不需要全局状态管理。

### 替代方案 C：使用 VS Code Debug Adapter Protocol 直接集成
直接使用 DAP (Debug Adapter Protocol) 并集成 VS Code 的调试扩展。此方案依赖 VS Code 生态，且 Java 6 + JDWP 的 DAP 兼容性未验证（参见 ADR-0016 闸门探针）。

## Consequences

### 正面影响
- 单一状态源，三个 Widget 的调试状态始终一致
- 批量变量获取减少 JDWP 往返次数，提升调试响应速度
- 事件驱动架构，Widget 可订阅感兴趣的调试事件
- 清晰的职责分离，前端不直接处理 JDWP 协议

### 负面影响
- DebugSessionService 成为调试功能的单点，需要高可靠性
- 会话生命周期管理增加复杂度（启动/停止/异常恢复）
- 需要维护 Go Agent 和前端之间的协议一致性

### 后续工作
- 实现条件断点的完整表达式求值（需要 JDT LS 辅助）
- 实现日志断点（不暂停执行，仅打印表达式值）
- 实现异常断点（在特定异常类型抛出时暂停）
- 端到端验证：JDK 6 + Tomcat 6 + JDWP 真实环境