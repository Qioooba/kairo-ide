# ADR-0029 — 多模块调试架构

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 6)

## Context

Kairo IDE 面向 Java 遗留项目，其中大量项目采用 Maven 多模块结构。每个模块可能运行在独立的 JVM 实例中，传统的单 VM 调试模式无法满足跨模块调试需求。

Wave 13 的核心目标是实现多 VM 调试会话编排，使开发者能够：
- 同时调试多个模块的 JVM 实例
- 设置跨模块断点
- 查看聚合的调试事件
- 按依赖顺序启动调试会话

## Decision

### 1. 整体架构

多模块调试架构位于 `runtime-agent/internal/debug/`，包含 3 个核心模块：

```
debug/
├── multi_vm_orchestrator.go    # 多 VM 会话编排器
├── multi_vm_events.go          # 事件聚合器
└── module_debug_dependency.go  # 模块依赖解析器
```

前端 UI 位于 `packages/java-extension/src/browser/debug-multimodule-widget.tsx`。

### 2. 多 VM 会话编排

**决策：中央编排器模式，统一管理所有模块的调试会话**

`MultiVMDebugOrchestrator` 实现：

- **会话注册**：`RegisterSession()` 注册调试会话，支持重复检测
- **会话注销**：`UnregisterSession()` 同时清理模块关联映射
- **模块关联**：`AssociateModule()` 建立模块 ID 到会话 ID 的映射
- **全局断点**：`SetGlobalBreakpoint()` 在所有 VM 上设置断点，`CrossModuleBreakpoint` 包含模块名、类名、行号、延迟解析标记
- **批量控制**：`SuspendAll()` / `ResumeAll()` / `TerminateAll()` 统一控制所有 VM
- **聚合查询**：`GetAllVariables()` / `GetAllCallStacks()` 返回所有暂停 VM 的变量和调用栈（按 sessionID 索引）

内部数据结构：
- `sessions`：sessionID → `*DebugSession` 映射
- `moduleSessions`：moduleID → sessionIDs 列表
- `globalBreakpoints`：breakpointID → `*CrossModuleBreakpoint` 映射

### 3. 事件聚合

**决策：基于监听器模式的统一事件流，支持按会话/模块/事件类型过滤**

`MultiVMEventAggregator` 实现：

- **事件记录**：`RecordEvent()` 接收任意 VM 的调试事件，补充 sessionID 和 moduleName 上下文
- **事件缓冲**：环形缓冲区，默认容量 1000 条，超出时丢弃最旧事件
- **监听器通知**：锁外回调避免死锁，支持多监听器
- **过滤查询**：
  - `GetEvents(sessionID)`：按会话过滤
  - `GetEventsByModule(moduleName)`：按模块过滤
  - `GetEventsByType(eventType)`：按事件类型过滤
  - `GetLatestEvent()`：获取最新事件
- **事件结构**：`AggregatedDebugEvent` 包含时间戳、会话 ID、模块名、事件类型、线程 ID、类名、行号、变量、堆栈跟踪

### 4. 拓扑排序端口分配

**决策：基于 Kahn 算法的依赖解析，自动分配调试端口**

`ModuleDebugDependencyResolver` 实现：

- **模块注册**：`AddModule()` 添加模块及其依赖关系（`DependsOn`、`RequiredBy`）
- **调试顺序**：`ResolveDebugOrder()` 拓扑排序，无依赖模块优先启动
- **循环检测**：排序结果数量不等于模块总数时报告循环依赖
- **端口分配**：`AssignDebugPorts(basePort)` 从基端口开始递增分配唯一端口
- **依赖验证**：`ValidateDependencies()` 检查自引用、缺失依赖、循环依赖
- **传递依赖**：`GetModuleDependencies()` 递归收集所有传递依赖

每个模块的 `ModuleDebugDependency` 包含：
- 模块名、依赖列表、被依赖列表
- 调试端口（JDWP）、调试顺序（0=最先）
- 源码路径、类输出目录

### 5. 前端 UI

`DebugMultiModuleWidget`（`debug-multimodule-widget.tsx`）提供 4 个标签页：

- **Sessions**：列出所有调试会话，显示模块名、状态（not_connected/connected/running/suspended/terminated）、主机:端口、启动时间
- **Dependencies**：模块依赖树视图，展示构建顺序和依赖关系
- **Breakpoints**：跨模块断点列表，支持启用/禁用切换，显示延迟解析标记、已解析类名
- **Events**：聚合调试事件流，显示事件类型、模块名、类名:行号、时间戳

### 6. 数据流

```
Maven 多模块项目
    │
    ▼
ModuleDebugDependencyResolver.ResolveDebugOrder()
    │ 拓扑排序 → 启动顺序
    ▼
MultiVMDebugOrchestrator.RegisterSession()
    │ 注册每个模块的调试会话
    ▼
MultiVMDebugOrchestrator.SetGlobalBreakpoint()
    │ 设置跨模块断点
    ▼
MultiVMEventAggregator.RecordEvent()
    │ 聚合来自各 VM 的调试事件
    ▼
前端 UI 展示
```

## Alternatives Considered

### 替代方案 A：使用单一大 JVM 调试所有模块
将所有模块类路径合并到一个 JVM 中调试，可避免多 VM 复杂性。但无法反映真实的多模块部署拓扑，且类路径冲突问题难以解决。

### 替代方案 B：使用 Java Debug Interface (JDI) 直接管理
JDI 提供更底层的调试控制，但需要运行在 JVM 中。Go Agent 通过 JDWP 协议与各 JVM 通信更灵活。

### 替代方案 C：每个模块独立调试，不聚合
降低实现复杂度，但开发者需要手动切换调试上下文，无法统一查看跨模块调用链。

### 替代方案 D：使用 DAP (Debug Adapter Protocol) 统一抽象
DAP 是 VS Code 的调试协议标准，但需要额外的适配层。当前直接在 Go 层实现编排逻辑，后续可考虑 DAP 兼容。

## Consequences

### 正面影响
- 多 VM 编排支持复杂多模块项目的全局调试视图
- 事件聚合器提供统一的调试事件流，无需切换上下文
- 拓扑排序自动确定正确的调试启动顺序，避免依赖缺失
- 自动端口分配避免手动配置端口冲突
- 全局断点管理简化跨模块断点设置
- 前端 UI 提供直观的多模块调试状态可视化

### 负面影响
- 多 VM 调试增加内存和 CPU 开销（每个模块一个 JVM 实例）
- 当前实现中 `SuspendAll()`/`ResumeAll()` 仅修改内存状态，未实际通过 JDWP 发送暂停/恢复命令
- `GetAllVariables()`/`GetAllCallStacks()` 返回空数据，实际变量/堆栈获取未实现
- 事件聚合器未与 JDWP 事件流集成（需要 JDWP 客户端实现）
- 循环依赖检测后未提供自动解决策略

### 后续工作
- 实现 JDWP 客户端以实际控制各 VM 的暂停/恢复
- 集成变量查看和堆栈跟踪获取
- 将事件聚合器与 JDWP 事件流连接
- 支持条件断点和断点命中计数
- 添加热代码替换（HotSwap）支持