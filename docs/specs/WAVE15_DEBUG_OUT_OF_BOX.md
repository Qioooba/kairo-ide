# Kairo IDE — Wave 15 详细设计文档：Debug 开箱即用

> **文档用途**：Wave 15 开发执行手册  
> **目标**：内置 JDI Bridge，Shift+F9 一键 Debug，无需外部配置  
> **周期**：2 周  
> **前置依赖**：Phase 1-3 完成，现有 Debug UI 面板已就绪  
> **Gate**：legacy-sample 项目 F9 启动→命中断点→变量查看→单步全流程通过

---

## 0. 核心思路

现有代码的问题：
- Debug UI（Variables/CallStack/Breakpoints/Watch/Console/Toolbar）**全部已实现**
- Theia Debug 框架已集成
- **但 DAP Adapter 是外部 plubbable 的**，需要 `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND` 环境变量指向外部 adapter

解决路径：内置一个轻量 JDI-to-DAP Bridge（`kairo-jdi-bridge.jar`），使用**宿主 JDK 17 的 JDI** 连接目标 JVM 的 JDWP 端口。这是 VS Code Java 扩展验证过的成熟方案。

---

## 1. 组件设计

### 1.1 组件架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    Theia Backend (Node.js)                       │
│                                                                  │
│  KairoJavaDebugAdapterContribution (修改)                        │
│  ├─ 自动定位 bundled/kairo-jdi-bridge.jar                        │
│  ├─ 自动定位宿主 JRE 17（bundled/jdk17/bin/java 或系统JRE）       │
│  ├─ 启动子进程: java -jar kairo-jdi-bridge.jar                   │
│  ├─ stdin/stdout 作为 DAP 通道                                   │
│  └─ 不再依赖环境变量配置                                          │
│                                                                  │
└──────────┬───────────────────────────────────────────────────────┘
           │ DAP over stdio (Content-Length framing)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Kairo JDI Bridge (Java 17 子进程)                   │
│                                                                  │
│  KairoJdiBridge.main(String[] args)                              │
│  ├─ 读取 stdin 解析 DAP 请求                                     │
│  ├─ VirtualMachineManager.attach() → JDWP handshake              │
│  ├─ DAP Request → JDI 调用                                      │
│  └─ JDI Event → DAP Event 写 stdout                             │
│                                                                  │
│  关键类：                                                        │
│  ├─ com.kairo.debug.JdiConnector     — JDWP attach              │
│  ├─ com.kairo.debug.DapDispatcher    — DAP 分发                 │
│  ├─ com.kairo.debug.VariableResolver — JDI Value → DAP 变量      │
│  ├─ com.kairo.debug.BreakpointManager — 断点映射                 │
│  ├─ com.kairo.debug.StackFrameManager — 栈帧管理                 │
│  └─ com.kairo.debug.Java6Compat      — Java 6 兼容过滤          │
└──────────┬───────────────────────────────────────────────────────┘
           │ JDWP over TCP (127.0.0.1:debugPort)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Tomcat 6 (目标 JVM, JDK 6)                       │
│  以 -Xdebug -Xrunjdwp:transport=dt_socket,server=y,... 启动      │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Bridge 最小依赖

- 仅使用 JDK 内置模块：`jdk.jdi`（com.sun.jdi.*）
- 无需额外 Maven/Gradle 依赖
- 编译目标：Java 17（运行在宿主 JDK 17 上，不是目标 JDK）
- 最终产物：单个可执行 jar（~50-100KB），无外部依赖

---

## 2. 详细任务拆分

### Task 15.1：JDI Bridge 骨架（后端 Java）

**文件位置**：`bundled/kairo-jdi-bridge/src/main/java/com/kairo/debug/`

**新建文件**：

#### KairoJdiBridge.java
```java
package com.kairo.debug;

import java.io.*;
import com.sun.jdi.*;
import com.sun.jdi.connect.*;

/**
 * 入口点：DAP over stdio server。
 *
 * 启动参数：
 *   args[0] = hostName (通常 127.0.0.1)
 *   args[1] = port (JDWP 端口)
 *
 * 退出码：
 *   0 — 正常断开
 *   1 — 无法连接 JDWP
 *   2 — DAP 协议错误
 */
public class KairoJdiBridge {
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: KairoJdiBridge <host> <port>");
            System.exit(2);
        }
        String host = args[0];
        int port = Integer.parseInt(args[1]);

        // 初始化 DAP 读写通道
        DapTransport dap = new DapTransport(System.in, System.out);

        try {
            // 1. 等待 initialize 请求
            // 2. attach 到目标 JVM
            // 3. 配置事件请求（ClassPrepare, Breakpoint, Step, Exception）
            // 4. 进入 DAP request loop
            // 5. 处理 disconnect 时清理
            VirtualMachine vm = JdiConnector.attach(host, port);
            DapDispatcher dispatcher = new DapDispatcher(vm, dap);
            dispatcher.run();
        } catch (Exception e) {
            dap.sendErrorOutput("Kairo JDI Bridge error: " + e.getMessage());
            System.exit(1);
        }
    }
}
```

#### DapTransport.java
- 实现 Content-Length 分帧（与 LSP 相同的协议格式）
- 输入：InputStream，输出：OutputStream
- 方法：`DapMessage readMessage()`、`void sendMessage(DapMessage msg)`、`void sendEvent(DapEvent event)`
- 线程安全的写操作

#### DapMessage.java
- 对应 DAP 协议的 JSON 消息结构：`seq`, `type` ("request"/"response"/"event"), `command`, `arguments`, `body`
- 使用 Jackson（或轻量 org.json）序列化/反序列化

**验收**：
- Bridge 能启动，等待 initialize 请求
- 收到 malformed 消息时不崩溃
- 单元测试覆盖分帧解析

---

### Task 15.2：DAP 核心能力实现

必须支持的 DAP 命令（v1.0 最小集）：

| DAP Command | 必须支持 | 说明 |
|------------|---------|------|
| `initialize` | ✅ | 返回 capabilities（断点类型、单步、变量等） |
| `launch` / `attach` | ✅ attach only | 连接到 JDWP |
| `setBreakpoints` | ✅ | 设置/清除行断点 |
| `setExceptionBreakpoints` | ✅ | 异常断点（uncaught） |
| `configurationDone` | ✅ | 配置完成，开始事件处理 |
| `continue` | ✅ | 继续执行 |
| `next` | ✅ | 步过（Step Over） |
| `stepIn` | ✅ | 步入（Step Into） |
| `stepOut` | ✅ | 步出（Step Out） |
| `pause` | ✅ | 暂停 |
| `stackTrace` | ✅ | 获取栈帧 |
| `scopes` | ✅ | 获取栈帧作用域 |
| `variables` | ✅ | 获取变量值 |
| `evaluate` | ✅ | Watch 表达式求值 |
| `threads` | ✅ | 获取线程列表 |
| `disconnect` | ✅ | 断开连接，退出 JVM |

#### DapDispatcher.java 核心流程：

```java
public class DapDispatcher {
    private final VirtualMachine vm;
    private final DapTransport dap;
    private final BreakpointManager breakpointManager;
    private final StackFrameManager stackFrameManager;
    private final VariableResolver variableResolver;
    private final Java6Compat java6Compat;

    // DAP request handlers
    private Response handleInitialize(Request req) { ... }
    private Response handleAttach(Request req) {
        // 从 args 读取 host/port（或已由命令行传入）
        // vm.resume() 让 JVM 运行
        // 发送 initialized 事件
    }
    private Response handleSetBreakpoints(Request req) {
        // 解析 source.path + breakpoints[].line
        // 查找对应 ReferenceType（可能需要等待类加载）
        // 清除旧断点，设置新断点
        // 返回实际设置的断点位置（行号可能偏移）
    }
    private Response handleStackTrace(Request req) { ... }
    private Response handleVariables(Request req) { ... }
    private Response handleEvaluate(Request req) { ... }

    // JDI Event → DAP Event
    private void eventLoop() {
        EventQueue queue = vm.eventQueue();
        while (connected) {
            EventSet eventSet = queue.remove();
            for (Event event : eventSet) {
                if (event instanceof BreakpointEvent) {
                    dap.sendEvent("stopped", Map.of(
                        "reason", "breakpoint",
                        "threadId", threadId,
                        "hitBreakpointIds", List.of(bpId)
                    ));
                    // 不要 resume，等待 DAP continue/step 命令
                } else if (event instanceof StepEvent) {
                    dap.sendEvent("stopped", Map.of("reason", "step", ...));
                } else if (event instanceof ExceptionEvent) {
                    dap.sendEvent("stopped", Map.of("reason", "exception", ...));
                }
            }
            vm.resume();  // 未请求停止的事件集需要 resume
        }
    }
}
```

#### VariableResolver.java 关键：

```java
public class VariableResolver {
    /** JDI Value → DAP Variable */
    public DapVariable resolve(Value value, String name, int variablesReference) {
        DapVariable var = new DapVariable();
        var.name = name;
        var.type = value != null ? value.type().name() : "null";
        var.value = formatValue(value);
        var.variablesReference = 0;  // 叶子节点

        if (value instanceof ObjectReference) {
            ObjectReference objRef = (ObjectReference) value;
            int childRef = nextVariablesReference();
            // 延迟加载：返回子节点引用，用户展开时再查询字段
            variableCache.put(childRef, objRef);
            var.variablesReference = childRef;
            var.namedVariables = countFields(objRef);
            var.indexedVariables = 0;
            if (value instanceof ArrayReference) {
                var.indexedVariables = ((ArrayReference)value).length();
            }
        }
        return var;
    }

    private String formatValue(Value v) {
        if (v == null) return "null";
        if (v instanceof StringReference) return "\"" + ((StringReference)v).value() + "\"";
        if (v instanceof PrimitiveValue) return v.toString();
        if (v instanceof ObjectReference) {
            Type type = v.type();
            return type.name() + "@" + Long.toHexString(((ObjectReference)v).uniqueID());
        }
        return v.toString();
    }
}
```

#### Java6Compat.java：过滤不支持的功能

```java
public class Java6Compat {
    private final String targetVersion;

    public Java6Compat(VirtualMachine vm) {
        this.targetVersion = vm.version();
    }

    public boolean supportsInstanceFilters() {
        // InstanceFilterRequest 是 Java 7+ 才有
        return compareVersion(targetVersion, "1.7") >= 0;
    }

    public boolean supportsLambdaStep() {
        // Lambda 表达式步过是 Java 8+
        return compareVersion(targetVersion, "1.8") >= 0;
    }

    public boolean supportsMethodExitOnReenter() {
        return compareVersion(targetVersion, "1.6") > 0; // Java 6 有限支持
    }

    // 当调用不支持的 JDI 方法时，降级处理
    public void safeAddInstanceFilter(BreakpointRequest req, ObjectReference instance) {
        if (supportsInstanceFilters()) {
            req.addInstanceFilter(instance);
        }
        // 否则静默跳过：功能降级，不崩溃
    }
}
```

---

### Task 15.3：Breakpoint 与 Source Path 映射

**挑战**：
- JDI 使用 JVM 内部类型名（`com/example/servlet/MyServlet`）和行号
- DAP 使用文件路径（`/path/to/src/com/example/servlet/MyServlet.java`）和行号
- 需要建立 Source Path → ReferenceType 映射
- 类可能未加载，需要 ClassPrepareEvent 后补设断点

#### BreakpointManager.java：

```java
public class BreakpointManager {
    // 待绑定断点：文件路径 → 行号列表（类未加载时）
    private final Map<String, List<Integer>> pendingBreakpoints = new ConcurrentHashMap<>();
    // 已绑定断点：JDI BreakpointRequest → (源文件, 行号)
    private final Map<BreakpointRequest, SourceBreakpoint> boundBreakpoints = new ConcurrentHashMap<>();

    public List<SetBreakpointResult> setBreakpoints(String sourcePath, List<Integer> lines) {
        // 1. 清除该文件的旧断点
        clearBreakpointsFor(sourcePath);

        List<SetBreakpointResult> results = new ArrayList<>();
        for (int line : lines) {
            // 2. 查找已加载的对应类型
            List<ReferenceType> types = findTypesBySourcePath(sourcePath);
            if (types.isEmpty()) {
                // 3. 类未加载，加入待绑定列表
                pendingBreakpoints.computeIfAbsent(sourcePath, k -> new ArrayList<>()).add(line);
                results.add(SetBreakpointResult.unbound(line));
                continue;
            }
            // 4. 在每个匹配的类型上设断点（内部类可能有多个）
            for (ReferenceType type : types) {
                BreakpointRequest bp = createBreakpoint(type, line);
                bp.enable();
                boundBreakpoints.put(bp, new SourceBreakpoint(sourcePath, line));
            }
            results.add(SetBreakpointResult.verified(line));
        }
        return results;
    }

    public void onClassPrepare(ClassPrepareEvent event) {
        ReferenceType type = event.referenceType();
        // 检查是否有待绑定的断点对应这个类的源文件
        String sourcePath = getSourcePath(type);
        if (pendingBreakpoints.containsKey(sourcePath)) {
            for (int line : pendingBreakpoints.get(sourcePath)) {
                BreakpointRequest bp = createBreakpoint(type, line);
                bp.enable();
                // 发送 breakpoint 事件通知前端断点已验证
            }
        }
    }
}
```

---

### Task 15.4：Node 端修改——内置 Bridge 启动

**修改文件**：[kairo-java-debug-adapter-contribution.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/theia-product/src/main/node/kairo-java-debug-adapter-contribution.ts)

**改造要点**：
1. 不再依赖环境变量指定 adapter 路径
2. 自动定位 bundled 目录下的 `kairo-jdi-bridge.jar`
3. 自动定位宿主 JRE：
   - 优先 `bundled/jdk17/bin/java`（随应用分发）
   - 次选 `KAIRO_JDT_LS_JRE`（因为 JDT LS 也需要 JDK 17）
   - 次选 `JAVA_HOME`
   - 次选 PATH 上的 `java`（验证版本 ≥ 17）
4. 不再是 "Kairo Java: Attach to local JDWP" 单一配置，增加 "Kairo Java: Debug Tomcat" 预配置
5. 启动 bridge 时传入 host/port 作为命令行参数
6. 如果宿主 JRE 版本 < 17 或 bridge jar 不存在，返回 capability 并在诊断面板说明

**provideDebugConfigurations 更新**：
```typescript
provideDebugConfigurations(): DebugConfiguration[] {
  const capability = probeKairoJavaDebugAdapter();
  if (!capability.available) return [];
  return [
    {
      type: this.type,
      name: 'Kairo Java: Attach to Tomcat (JDWP)',
      request: 'attach',
      hostName: '127.0.0.1',
      port: 8000,  // 默认端口，可由 Run Configuration 覆盖
    },
  ];
}
```

**provideDebugAdapterExecutable 更新**：
```typescript
provideDebugAdapterExecutable(config: DebugConfiguration): DebugAdapterExecutable {
  validateAttachConfiguration(config);
  const bridgeJar = resolveBridgJar();
  const javaBin = resolveHostJava(); // JDK 17
  return {
    command: javaBin,
    args: [
      '-jar', bridgeJar,
      config.hostName ?? '127.0.0.1',
      String(config.port),
    ],
    // 不再通过环境变量传递参数！
  };
}
```

---

### Task 15.5：Debug 诊断面板

**新建文件**：`packages/theia-product/src/main/browser/debug-diagnostics-widget.tsx`

**面板内容**：
- ✅/❌ 宿主 JDK 17 状态（版本、路径）
- ✅/❌ JDI Bridge jar 存在性
- ✅/❌ JDT LS 状态（running/crashed/starting）
- ⚠️ Java 6 兼容性限制列表
- 按钮："下载宿主 JDK 17"、"重启 Debug Adapter"、"打开日志"
- 当 Debug 面板首次打开且 capability.available=false 时自动弹出

**触发时机**：
- 用户按 Shift+F9 但 adapter 不可用时
- Debug 面板打开时后台检查
- 菜单：Help → Debug Diagnostics

---

### Task 15.6：Run Configuration 与 Debug 串联

**修改文件**：[kairo-run-configuration-service.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/theia-product/src/main/browser/kairo-run-configuration-service.ts)

**Run→Debug 自动串联流程**：
1. 用户点击 "Debug" 按钮
2. 保存所有未保存文件（auto-save）
3. 如果配置了构建（Ant/javac），执行增量构建
4. 构建成功 → 部署到 Tomcat（如果有修改）
5. 以 Debug 模式（`suspend=y`）启动 Tomcat
6. 等待 Tomcat JDWP 端口就绪（TCP connect 轮询，最多 30s）
7. 自动触发 Debug attach，使用 Run Configuration 中的 debugPort
8. attach 成功后切换到 Debug 透视图

**新增方法**：
```typescript
async debugConfiguration(configId: string): Promise<void> {
  const config = this.getConfiguration(configId);

  // 1. Auto-save
  await this.saveAll();

  // 2. Build
  if (config.build.type !== 'none') {
    const buildResult = await this.buildService.build(config);
    if (!buildResult.success) {
      this.problemsService.showBuildErrors(buildResult.errors);
      throw new Error('Build failed');
    }
  }

  // 3. Deploy
  await this.tomcatService.deploy(config);

  // 4. Start Tomcat in debug mode
  await this.tomcatService.start(config, { mode: 'debug', suspend: true });

  // 5. Wait for JDWP port
  const port = config.server.debugPort;
  await this.waitForPort('127.0.0.1', port, 30_000);

  // 6. Attach debugger
  await this.debugService.attachToTomcat(configId);

  // 7. Open debug perspective
  this.switchToDebugPerspective();
}
```

---

### Task 15.7：宿主 JDK 17 分发与检测

**Go Agent 新增**：`runtime-agent/internal/jdkmanager/`

**功能**：
- 检测系统是否有 JDK 17+
- 无则自动下载 Adoptium Temurin 17（~180MB）到 `bundled/jdk17/`
- SHA-256 校验下载文件
- 支持 macOS/Windows/Linux 三平台
- 下载前显示 EULA/确认对话框

**API**：
- `GET /api/v1/system/jdk/host` → 返回宿主 JDK 状态
- `POST /api/v1/system/jdk/download` → 触发下载（需要用户确认）

**前端集成**：Debug Diagnostics 面板中的"下载宿主 JDK 17"按钮

---

### Task 15.8：测试用例

#### Java Bridge 单元测试（JUnit 5）：
- DapTransport 分帧测试（Content-Length 解析、边界情况）
- VariableResolver 类型格式化测试（primitive/string/null/object/array）
- Java6Compat 版本比较测试
- BreakpointManager 待绑定/类准备事件测试
- 错误恢复测试：JDWP 断开时 bridge 优雅退出

#### 集成测试（需要真实 JVM）：
- 启动一个简单的 Java 6 测试程序（HelloWorld + 断点）
- Bridge attach 到 JDWP 端口
- 验证断点命中、变量读取、单步执行
- 用 JDK 6 和 JDK 8 目标各测一次

#### Node 端测试：
- probeKairoJavaDebugAdapter 在 bridge jar 存在/缺失时返回正确状态
- provideDebugAdapterExecutable 生成正确命令和参数
- resolveHostJava 在各种环境下找到正确 JDK

#### 前端测试：
- Debug Diagnostics 面板显示正确状态
- Run→Debug 串联流程各步骤正确调用
- Adapter 不可用时显示错误而非黑屏

---

### Task 15.9：构建与打包

- JDI Bridge 使用 Maven 或 Gradle 构建
- `scripts/build-jdi-bridge.sh` 脚本：编译 + 打包 jar 到 `bundled/kairo-jdi-bridge.jar`
- 主构建流程（`npm run build` 或 `make`）中自动执行 bridge 构建
- electron-builder 配置中将 `bundled/kairo-jdi-bridge.jar` 打包进应用
- CI 中验证 bridge jar 存在且非空

---

## 3. 文件变更清单

### 新增文件
```
bundled/kairo-jdi-bridge/pom.xml                              (新建 Maven 项目)
bundled/kairo-jdi-bridge/src/main/java/com/kairo/debug/
  ├─ KairoJdiBridge.java
  ├─ DapTransport.java
  ├─ DapMessage.java
  ├─ DapDispatcher.java
  ├─ JdiConnector.java
  ├─ VariableResolver.java
  ├─ BreakpointManager.java
  ├─ StackFrameManager.java
  └─ Java6Compat.java
bundled/kairo-jdi-bridge/src/test/java/com/kairo/debug/
  ├─ DapTransportTest.java
  ├─ VariableResolverTest.java
  ├─ BreakpointManagerTest.java
  └─ Java6CompatTest.java
runtime-agent/internal/jdkmanager/
  ├─ manager.go
  ├─ manager_test.go
  └─ download.go
packages/theia-product/src/main/browser/debug-diagnostics-widget.tsx
scripts/build-jdi-bridge.sh
```

### 修改文件
```
packages/theia-product/src/main/node/kairo-java-debug-adapter-contribution.ts   (重构)
packages/theia-product/src/main/browser/kairo-run-configuration-service.ts      (串联 Debug)
packages/theia-product/src/main/browser/kairo-java-debug-service.ts             (新增 attachToTomcat)
packages/theia-product/src/main/node/kairo-product-backend-module.ts            (注册新 contribution)
runtime-agent/internal/api/handlers.go                                          (新增 JDK status/download API)
runtime-agent/internal/api/services.go                                          (新增 JDK manager)
```

---

## 4. Wave 15 Gate 验收清单

| # | 验收项 | 验证方法 |
|---|--------|---------|
| 1 | 全新安装后不配置任何环境变量，Shift+F9 可用 | 手工测试 |
| 2 | Debug Diagnostics 正确显示各组件状态 | 手工 + 自动化 |
| 3 | Servlet doGet 断点命中，Variables 显示 request/response | 手工 + legacy-sample |
| 4 | 单步跳过(F8)/步入(F7)/步出(Shift+F8)/继续(F9) 可用 | 手工 |
| 5 | Watch 面板可求值表达式（如 request.getRequestURI()） | 手工 |
| 6 | 条件断点（条件为 false 时不暂停） | 手工 |
| 7 | 异常断点（抛出未捕获异常时暂停） | 手工 |
| 8 | Call Stack 显示完整调用链，点击可跳转源码 | 手工 |
| 9 | Debug 断开/重启 Tomcat 后再次 attach 成功 | 手工 |
| 10 | JDK 6 HotSpot 目标 VM：变量显示正确类型，无 "不支持的 JDI 命令" 错误 | 手工 + JDK 6 环境 |
| 11 | 宿主无 JDK 17 时显示下载提示而非报错 | 手工 |
| 12 | Bridge 进程断开时不残留僵尸进程 | 进程检查 |
| 13 | 连续 10 次 attach/detach 无内存泄漏 | soak test |
| 14 | Java Bridge 单元测试 ≥ 40 个，全部通过 | CI |
| 15 | 新增/修改代码行覆盖率 ≥ 70% | CI coverage |

---

## 5. Spike 前置任务（Wave 15 开始前 1-2 天）

在正式开发前，必须完成一个技术 spike：

1. **验证 JDI → JDK 6 JDWP 兼容性**
   - 下载 JDK 6 update 45（最后一个 JDK 6 公开版本）
   - 编写一个 20 行的 Java 程序（HelloWorld + 断点位置）
   - 用 JDK 17 编写 JDI 测试代码 attach 到 JDK 6 VM
   - 验证：setBreakpoint、resume、BreakpointEvent 触发、stackTrace、getValues
   - 记录哪些 JDI 方法在 Java 6 上抛 UnsupportedOperationException

2. **记录不兼容列表**
   - 列出所有在 Java 6 上不可用的 JDI 方法
   - 为每个方法设计降级策略（跳过/替代/提示用户）

3. **决策点**
   - 如果 JDI 对 Java 6 的兼容性问题超过 5 个核心场景，考虑 Plan B：
     - Plan B：集成 java-debug v0.42.0（微软的 java-debug 最后一个支持 Java 6 的版本）作为预装 plugin
