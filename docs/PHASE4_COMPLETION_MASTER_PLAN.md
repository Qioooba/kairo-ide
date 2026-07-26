# Kairo IDE Phase 4 — 交付就绪与持续开发总规划

> **文档版本**：v1.0  
> **日期**：2026-07-25  
> **文档性质**：产品 + 架构 + 工程 三位一体的执行蓝图  
> **目标读者**：产品经理、架构师、前端/后端/测试工程师、项目经理  
> **前置基线**：Phase 1-3 已完成（代码覆盖率 Go 72.5%、TS 65-98%、安全审计 A 级、性能门禁 10/10）

---

## 目录

1. [设计理念与产品原则](#一设计理念与产品原则)
2. [现状基线与差距分析](#二现状基线与差距分析)
3. [产品需求文档（PRD）](#三产品需求文档prd)
4. [技术架构方案](#四技术架构方案)
5. [前后端交互接口契约](#五前后端交互接口契约)
6. [分阶段执行计划（Wave 15-20）](#六分阶段执行计划wave-15-20)
7. [验收标准与质量门禁](#七验收标准与质量门禁)
8. [风险管理与应对](#八风险管理与应对)
9. [持续开发与迭代机制](#九持续开发与迭代机制)

---

## 一、设计理念与产品原则

### 1.1 核心理念：「老项目开箱即用」

Kairo IDE 不是另一个通用 IDE，而是**为维护 10 年以上遗留 Java Web 项目的工程师量身定制的专用工具**。所有设计决策围绕以下三个事实：

| 事实 | 设计含义 |
|------|---------|
| 开发机是 **2 vCPU / 4 GB 内存** 的 Windows 10 云桌面，无管理员权限 | 零配置启动、内存占用 ≤ 512MB 空闲、不依赖系统级安装 |
| 项目混合 **GBK 与 UTF-8**，Ant build.xml 而非 Maven，Tomcat 6 + JDK 1.6 | 自动探测而非要求用户配置，编码安全写回，兼容老旧标准 |
| 工程师从 IntelliJ IDEA 迁移过来，期望"按下 F5 就能调试" | 快捷键/布局对齐 IDEA 直觉，Debug 必须开箱即用，不要求手动装插件 |

### 1.2 产品三原则

1. **闭环优先于功能堆砌**  
   一个端到端可用的"导入→编辑→构建→部署→调试"闭环，胜过十个半成品菜单。GPT-5.6 提出的四个闭环（项目模型、Java语义、运行调试、跨语言导航）是 v1.0 的生死线。

2. **约定优于配置，自动优于手动**  
   如果能从目录结构（`src/`、`WebRoot/WEB-INF/lib/`）或 `build.xml` 中自动推断，绝不让用户在对话框中填写。YAML 配置是高级选项，不是入门门槛。

3. **失败必须可见、可恢复、可绕过**  
   Debug Adapter 不兼容 Java 6 时，要明确告诉用户"哪些功能受限"，而不是静默失败；JDT LS 崩溃后要有"重启语言服务"按钮；GBK 写回失败前必须备份。

### 1.3 反原则（明确不做的事）

- 不追求媲美 IDEA Ultimate 的功能广度
- 不做 AI 补全、插件市场、云同步（v1 明确排除）
- 不为了"现代化"而抛弃老项目支持（Spring Boot 支持留给竞品）

---

## 二、现状基线与差距分析

### 2.1 已交付资产盘点

| 领域 | 已完成 | 测试覆盖 |
|------|--------|---------|
| Theia 外壳 + 编辑器 + 文件树 | ✅ | 873+ 前端测试 |
| Go Runtime Agent（构建/部署/Tomcat/搜索） | ✅ | 33/33 Go 包通过 |
| JDT LS 进程管理 + 12 个 LSP Provider | ✅ | 222 LSP 测试 |
| JSP 专项增强（语法/EL/TLD/导航/Scriptlet） | ✅ | 105 JSP 测试 |
| 全套 Debug UI 面板 | ✅ | 59 Debug 测试 |
| Git 集成（Stash/Cherry-Pick/Blame/Diff） | ✅ | 109 Git 测试 |
| 全局搜索 + GBK 安全替换 | ✅ | ripgrep 优化 |
| SQL Console 轻量版 | ✅ | sql-extension |
| Maven 完整支持 | ✅ | Wave 12 |
| 多模块调试 | ✅ | Wave 13 |
| 远程 Linux Agent | ✅ | Wave 11 |
| 企业合规套件（RBAC/SSO） | ✅ | Wave 14 |

### 2.2 按 GPT-5.6 四闭环的真实差距

| 闭环 | 代码完成度 | 端到端可用度 | 核心缺口 |
|------|-----------|-------------|---------|
| ① 项目模型 | 85% | 70% | Ant build.xml classpath 未自动解析；模型变更监听缺失 |
| ② Java语义 | 95% | 80% | 缺真实 legacy-sample 全场景验证 |
| ③ 运行调试 | 75% | 40% | **DAP adapter 非开箱即用**；Java 6 JDWP 兼容性未验证；Custom command deferred |
| ④ 跨语言导航 | 90% | 80% | JSP 调试行号映射未验证 |

**关键结论**：不是缺代码，而是缺「开箱即用的 Debug 闭环」和「真实环境验证」。这是 v1.0 交付前必须跨越的最后一道坎。

---

## 三、产品需求文档（PRD）

### 3.1 版本目标

- **v1.0（本次交付）**：四个闭环全部打通，在 JDK 6 + Tomcat 6 + GBK 遗留项目上可替代 IDEA 完成 80% 日常开发任务
- **v1.1（4周后）**：体验完善（面包屑、书签、反编译、快捷键）
- **v1.2（8周后）**：高级功能（HTTP Client、代码检查规则）

### 3.2 P0 用户故事（v1.0 必须完成）

#### US-001：一键调试遗留 Web 项目
> **作为**一名维护 10 年历史 Java Web 项目的工程师，  
> **我想要**打开项目后按 Shift+F9 就能以 Debug 模式启动 Tomcat 并命中断点，  
> **以便**不需要手动配置 JDWP 端口、不需要额外下载 debug 插件。

**验收标准**：
- 导入项目后自动生成 Debug 配置，端口从 Tomcat 配置读取
- Debug Adapter 内置或首次启动自动下载（带 SHA-256 校验）
- 断点命中后 Variables 面板能正确显示 Java 6 类型的局部变量
- 不满足条件时（如无 JDK 6）显示明确诊断面板而非黑屏

#### US-002：Ant 项目无需手动配置类路径
> **作为**一名拿到陌生 Ant 项目的新员工，  
> **我想要**打开项目后 JDT LS 自动识别 build.xml 中的 classpath，  
> **以便**不需要手动在 YAML 中罗列几十个 jar 包才能获得补全。

**验收标准**：
- 自动解析 `<path id="...">` 和 `<pathelement location="..."/>`
- 解析 `<fileset dir="..." includes="**/*.jar"/>` 模式
- 解析结果与 javac 编译使用的 classpath 一致
- 解析失败时降级到 lib/ 自动扫描，并告知用户哪些 jar 可能缺失

#### US-003：构建-部署-运行一键完成
> **作为**一名修改了 Servlet 代码的开发者，  
> **我想要**点击工具栏的 Run 按钮自动完成增量编译→部署→Tomcat 重启→打开浏览器，  
> **以便**不需要在多个面板间切换操作。

**验收标准**：
- Ant/javac/custom 三种构建类型都能执行（custom 不再 deferred）
- 构建失败时 Problems 面板自动定位到错误行
- 部署后自动刷新 Tomcat 日志面板滚动到最新
- Debug 模式下自动 attach 并在断点处等待

#### US-004：Windows 10 云桌面稳定运行
> **作为**一名在公司云桌面工作的工程师，  
> **我想要**Kairo 在 4GB 内存 Windows 10 上连续工作 8 小时不崩溃不卡顿，  
> **以便**能放心作为主力开发工具。

**验收标准**：
- 冷启动 ≤ 8s，空闲内存 ≤ 512MB
- 大文件（≥ 5000 行 Java）编辑流畅度可接受
- 路径中含中文/空格不崩溃
- 文件监听不出现 EBUSY 错误

### 3.3 P1 用户故事（v1.1 体验增强）

| ID | 用户故事 | 优先级 |
|----|---------|--------|
| US-005 | 编辑器顶部面包屑显示当前类→方法层级，点击可跳转 | 高 |
| US-006 | F11 添加书签，Ctrl+数字键快速跳转 | 中 |
| US-007 | Alt+F12 Peek Definition 在弹窗内查看定义不离开当前位置 | 中 |
| US-008 | Ctrl+Shift+A Search Everywhere 支持查找 IDE 动作（如"重启 Tomcat"） | 高 |
| US-009 | 打开 .class 文件自动反编译显示源码（只读） | 中 |
| US-010 | Project Structure 对话框图形化配置 JDK/源码目录/依赖 jar | 中 |
| US-011 | IDEA 风格 keymap 预设（与 IDEA 默认快捷键一致率 ≥ 90%） | 高 |

### 3.4 P2 用户故事（v1.2+ 远期）

| ID | 用户故事 | 版本 |
|----|---------|------|
| US-012 | .http 文件内置 REST 客户端直接测试 Servlet 接口 | v1.2 |
| US-013 | Structural Search 按代码模板结构搜索（如找所有未关闭的 Connection） | v1.3 |
| US-014 | Language Injections：Java 字符串内 SQL/JSON/正则语法高亮与补全 | v1.3 |
| US-015 | JSP HotSwap 修改 JSP 无需重启 Tomcat | v1.2 |

---

## 四、技术架构方案

### 4.1 整体架构（保持现有分层）

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (Browser/Desktop)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  Editor  │ │  Views   │ │  Search  │ │  Debug   │ │  Git     │  │
│  │ (Monaco) │ │ (React)  │ │  Widgets │ │  Panel   │ │  Panel   │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       │            │            │            │            │        │
│  ┌────┴────────────┴────────────┴────────────┴────────────┴─────┐  │
│  │              Kairo Frontend Services (Inversify DI)          │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │  │
│  │  │ Run Config  │ │ Debug Svc   │ │ Project Svc │            │  │
│  │  │ Service     │ │ (DAP Client)│ │ Model Cache │            │  │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘            │  │
│  └─────────┼───────────────┼───────────────┼───────────────────┘  │
└────────────┼───────────────┼───────────────┼──────────────────────┘
             │ HTTP/WS       │ LSP/DAP       │ HTTP
┌────────────┼───────────────┼───────────────┼──────────────────────┐
│            ▼               ▼               ▼     Backend (Node.js) │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                 Theia Backend Contributions                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │  │
│  │  │ JDT LS       │  │ Kairo Java   │  │ File/Search  │       │  │
│  │  │ Contribution │  │ Debug Adapter│  │ Contributions│       │  │
│  │  │ (spawn+stdio)│  │ (built-in)   │  │              │       │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────┘       │  │
│  └─────────┼─────────────────┼─────────────────────────────────┘  │
│            │ stdio           │ JDWP over TCP                      │
│            ▼                 ▼                                    │
│     ┌───────────┐    ┌──────────────┐    ┌──────────────┐         │
│     │  JDT LS   │    │ Kairo JDI    │    │   Go Agent   │         │
│     │ (child)   │    │ Bridge (new) │    │ (HTTP/WS)    │         │
│     └───────────┘    └──────┬───────┘    └──────┬───────┘         │
│                             │ JDWP              │ HTTP/exec        │
│                             ▼                   ▼                  │
│                      ┌──────────┐       ┌──────────────┐          │
│                      │ Tomcat 6 │       │ OS Commands  │          │
│                      │ (JDWP)   │       │ (javac/ant)  │          │
│                      └──────────┘       └──────────────┘          │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 架构决策：内置 Java Debug Adapter

#### 问题现状
当前 [kairo-java-debug-adapter-contribution.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/theia-product/src/main/node/kairo-java-debug-adapter-contribution.ts) 要求通过环境变量 `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND` 配置外部 DAP adapter，这违背了「开箱即用」原则，且现代 adapter 兼容 Java 8+ 而非 Java 6。

#### 决策：实现轻量内置 JDI Bridge
采用微软 VS Code Java 扩展的成熟路径：
- **不重新实现完整 DAP server**，而是内置一个最小 JDI-to-DAP bridge
- 使用 JDK 17 的 JDI（`com.sun.jdi`）连接到 Tomcat 6 的 JDWP 端口
- JDI 运行在宿主 JDK 17 上，通过 JDWP 协议调试 JDK 6 目标 JVM
- 只实现 v1.0 必需的 DAP 能力：断点、单步、栈帧、变量、Evaluate

**理由**：
1. JDI 是 Java 标准调试接口，向后兼容 JDWP 协议（Java 6 JDWP 与 JDK 17 JDI 可互操作）
2. 可以精确控制哪些 DAP 消息发送，避免现代 adapter 发送 Java 6 不支持的命令
3. 作为 Node.js 子进程启动，跟随 Theia backend 生命周期

```
新增组件：bundled/kairo-jdi-bridge/
├── src/main/java/com/kairo/debug/
│   ├── KairoJdiBridge.java      // main class，DAP stdio server
│   ├── JdiConnector.java        // attach to JDWP，handshake
│   ├── DapDispatcher.java       // DAP request → JDI calls
│   ├── VariableResolver.java    // JDI Value → DAP VariablesReference
│   └── Java6Compatibility.java  // 过滤 Java 6 不支持的命令
├── pom.xml (or build.gradle)
└── 预编译为 kairo-jdi-bridge.jar（随 bundled/ 目录分发）
```

### 4.3 Ant Classpath 解析器

在 Go Agent 端新增 Ant build.xml 解析模块，不依赖外部 Ant 库：

```
runtime-agent/internal/antpath/
├── parser.go          // XML 解析：project/path/pathelement/fileset/patternset
├── resolver.go        // 解析 ${property} 引用、路径拼接、**/*.jar glob
├── resolver_test.go   // 覆盖常见 build.xml 模式
└── integration.go     // 集成到 jdtproject.Generator
```

**解析能力（v1 覆盖 90% 遗留项目）**：
- `<property name="..." value="..."/>` 和 `<property file="..."/>`
- `<path id="...">` 含 `<pathelement location/path="..."/>`
- `<fileset dir="..." includes="**/*.jar"/>` 含 `<include>/<exclude>`
- `<import file="..."/>` 引入的父 build.xml
- `${basedir}`、`${lib.dir}` 等属性展开
- 无法解析的表达式产生 warning 而非 error，降级到目录扫描

### 4.4 Run Configuration 执行引擎

补全 P1-RUN-04（custom command execution）：
- 新增 `CustomBuildExecutor`，支持执行任意 shell 命令（ant/maven/自定义脚本）
- 工作目录设为项目根目录
- 环境变量继承系统环境 + 运行配置中定义的 env
- stdout/stderr 实时流到 Build Output 面板
- 进程可取消，退出码判定成功/失败

---

## 五、前后端交互接口契约

### 5.1 新增/修改 API 列表

所有接口遵循 `/api/v1/` 前缀，JSON over HTTP，WebSocket 用于实时事件流。

#### 5.1.1 Ant Classpath 解析（新增）

**POST** `/api/v1/ant/classpath`

请求：
```json
{
  "projectRoot": "/path/to/project",
  "buildFile": "build.xml",
  "resolveDependencies": true
}
```

响应：
```json
{
  "success": true,
  "classpath": [
    "/path/to/lib/servlet-api.jar",
    "/path/to/WebRoot/WEB-INF/lib/jstl.jar",
    "/path/to/build/classes"
  ],
  "sourceRoots": [
    "/path/to/src/main/java"
  ],
  "warnings": [
    {
      "line": 42,
      "message": "无法解析 ${env.CATALINA_HOME}，使用默认值",
      "severity": "warning"
    }
  ],
  "properties": {
    "src.dir": "src",
    "build.dir": "build",
    "webroot": "WebRoot"
  }
}
```

#### 5.1.2 JDT Project 生成增强（修改）

**POST** `/api/v1/jdtls/project` 新增字段：

请求新增：
```json
{
  "workspaceId": "default",
  "projectId": "myproject",
  "rootPath": "/path/to/project",
  "intoProjectRoot": true,
  "autoDetectClasspath": true,    // 新增：从 build.xml 自动解析
  "buildFile": "build.xml"        // 新增：指定 build 文件路径
}
```

响应新增：
```json
{
  "classpathSource": "ant",       // 新增：ant | yaml | autodetect | manual
  "unresolvedPaths": [],          // 新增：无法解析的路径列表
  "...": "..."
}
```

#### 5.1.3 Debug Adapter 状态（新增）

**GET** `/api/v1/debug/adapter/status`

响应：
```json
{
  "available": true,
  "version": "1.0.0",
  "jdiBridgeJar": "/path/to/kairo-jdi-bridge.jar",
  "hostJdk": "/path/to/jdk17/bin/java",
  "supportedJavaTargets": ["1.6", "1.7", "1.8", "11", "17"],
  "limitations": [
    "Java 6: 不支持实例过滤器（InstanceFilter）",
    "Java 6: 不支持 Lambda 表达式步过（LambdaStep）"
  ]
}
```

#### 5.1.4 Debug Attach 增强（修改）

**WebSocket** `/ws/debug/session/{id}` 现有事件流不变，新增 attach 配置来源：

- 从 Run Configuration 读取 debugPort、hostName
- Attach 前先验证 JDWP 端口是否监听（TCP connect test）
- 超时 30s 后返回明确错误："无法连接到 127.0.0.1:8000，请确认 Tomcat 以 JPDA 模式启动"

#### 5.1.5 Custom Build 执行（新增）

**POST** `/api/v1/build/custom`

请求：
```json
{
  "projectRoot": "/path/to/project",
  "command": "mvn clean package -DskipTests",
  "env": {
    "JAVA_HOME": "/path/to/jdk6",
    "MAVEN_OPTS": "-Xmx512m"
  },
  "workingDir": "/path/to/project"
}
```

响应（启动后返回，通过 WS 推送日志）：
```json
{
  "buildId": "build-abc123",
  "pid": 12345,
  "status": "running"
}
```

WebSocket `/ws/build/{buildId}` 事件：
```json
// 日志行
{"type": "log", "stream": "stdout", "line": "BUILD SUCCESS", "ts": 1721900000000}
// 构建结束
{"type": "finish", "exitCode": 0, "durationMs": 15000}
// 错误
{"type": "error", "message": "javac: command not found", "code": "COMMAND_NOT_FOUND"}
```

### 5.2 前端服务接口契约

#### 5.2.1 KairoDebugService（增强）

```typescript
interface KairoDebugService {
  /**
   * 开箱即用 attach：从当前激活的 Run Configuration 读取配置，
   * 自动启动内置 JDI bridge，attach 到 Tomcat JDWP 端口。
   * 如果 adapter 不可用，返回 Diagnostic 而非抛出。
   */
  attachToTomcat(configId: string): Promise<DebugSessionResult>;

  /**
   * 检查 Debug 能力状态。启动时和 Debug 面板打开时调用。
   */
  getDebuggerStatus(): Promise<DebuggerStatus>;

  /**
   * 显示诊断面板：列出当前 Debug 环境问题和修复建议。
   */
  showDiagnostics(): void;
}
```

#### 5.2.2 AntClasspathService（新增）

```typescript
interface AntClasspathService {
  /**
   * 解析 build.xml classpath，结果合并到 ProjectConfig。
   * 不抛异常；有 warning 通过 onWarning 通知。
   */
  resolve(projectRoot: string, buildFile?: string): Promise<AntClasspathResult>;

  /**
   * 监听 build.xml 变化，自动重新解析并通知 JDT LS 刷新。
   */
  watchBuildFile(projectRoot: string): Disposable;
}
```

### 5.3 关键交互时序：一键 Debug 流程

```
用户点击 Shift+F9
      │
      ▼
Frontend: KairoRunConfigurationService.getActive()
      │ 返回 { projectId, jdkRef, server: { httpPort, debugPort }, mode: 'debug' }
      ▼
Frontend: KairoTomcatService.ensureRunning(config)
      │ POST /api/v1/tomcat/start (suspend=y 以等待 debug)
      │ WS 事件: tomcat-started (jdwp listening on port 8000)
      ▼
Frontend: KairoDebugService.attachToTomcat(configId)
      │ GET /api/v1/debug/adapter/status  → 确认 JDI bridge 可用
      │ POST /api/v1/debug/session (attach config)
      │ Theia Backend: 启动 kairo-jdi-bridge.jar 子进程
      │                bridge JDI attach 127.0.0.1:8000
      │                bridge 与 Theia 之间 DAP over stdio
      ▼
Frontend: Debug Session 建立
      │ 断点命中事件
      │ 变量/栈帧查询
      ▼
用户按 F8 继续 / F7 单步
```

---

## 六、分阶段执行计划（Wave 15-20）

每个 Wave 遵循"设计→实现→测试→Gate"节奏，2-3名工程师并行。

### Wave 15：Debug 开箱即用（P0，最高优先级）

**目标**：内置 JDI Bridge，Debug 不再依赖外部配置，Shift+F9 一键可用

**周期**：2 周

**任务清单**：

| # | 任务 | 负责人 | 交付物 |
|---|------|--------|--------|
| 15.1 | JDI Bridge 核心：DAP stdio server + JDI attach | 后端(Java) | kairo-jdi-bridge.jar |
| 15.2 | DAP 能力实现：initialize/launch/attach/setBreakpoints/stackTrace/variables/evaluate/next/stepIn/stepOut/continue/disconnect | 后端(Java) | DAP 消息处理 |
| 15.3 | Java 6 兼容性层：过滤不支持的 JDI 命令 | 后端(Java) | Java6Compatibility.java |
| 15.4 | 修改 kairo-java-debug-adapter-contribution.ts：内置 bridge 启动，移除环境变量依赖 | 前端(Node) | 内置 adapter |
| 15.5 | Debug 诊断面板：adapter 不可用时显示问题和修复建议 | 前端(React) | debug-diagnostics-widget |
| 15.6 | 运行配置中 Debug 模式自动设置 suspend=y + JDWP 端口 | 前端 | kairo-run-configuration-service |
| 15.7 | JDK 17 host JRE 检测与 bundled 分发 | 后端(Go) | bundled/jdk17/ |
| 15.8 | 单元测试：JDI Bridge 40+ 测试用例 | QA | bridge tests |
| 15.9 | Gate：legacy-sample 项目 F9 启动→命中断点→查看变量→单步通过 | QA | Gate 报告 |

**验收 Gate**：
- 不配置任何环境变量即可 Debug
- 在 Servlet doGet 第一行设断点，浏览器访问后能命中
- Variables 面板显示 request/response/session 等变量
- 单步跳过/步入/步出/继续全部可用
- 断开后自动清理子进程

---

### Wave 16：项目模型闭环（P0）

**目标**：Ant build.xml classpath 自动解析，custom build 可执行，构建-部署闭环

**周期**：1.5 周

**任务清单**：

| # | 任务 | 负责人 | 交付物 |
|---|------|--------|--------|
| 16.1 | Ant build.xml 解析器：property/path/pathelement/fileset/import | 后端(Go) | antpath/parser.go |
| 16.2 | 路径属性解析与 glob 展开（**/*.jar） | 后端(Go) | antpath/resolver.go |
| 16.3 | 集成到 jdtproject.Generator：build.xml→.classpath 自动生成 | 后端(Go) | generator.go 修改 |
| 16.4 | POST /api/v1/ant/classpath API | 后端(Go) | handlers.go |
| 16.5 | Custom Build Executor：执行任意命令并流式输出 | 后端(Go) | custom_build.go |
| 16.6 | 前端：CustomBuildExecutor 组件，替换 deferred 占位符 | 前端 | kairo-custom-build |
| 16.7 | build.xml 文件监听：保存后自动重新解析 classpath 并刷新 JDT LS | 前端+后端 | watcher + refresh |
| 16.8 | 前端：解析警告显示在 Problems 面板（type: Ant） | 前端 | problems widget |
| 16.9 | Gate：3 种不同结构的真实 Ant 项目自动获得正确 classpath 补全 | QA | Gate 报告 |

**验收 Gate**：
- 3 个真实遗留 Ant 项目（含 lib/*.jar、WEB-INF/lib/*.jar、父 build.xml import）无需手动配置即可获得补全
- Custom command 执行 mvn/ant/脚本均可工作，stdout 实时显示
- 修改 build.xml 保存后 5s 内 JDT LS 感知 classpath 变化

---

### Wave 17：Windows 稳定性与 E2E 验证（P0）

**目标**：Windows 10 上全流程通过，E2E 测试可自动化执行

**周期**：1.5 周

**任务清单**：

| # | 任务 | 负责人 | 交付物 |
|---|------|--------|--------|
| 17.1 | 修复 11 个 Windows 特定测试失败 | 全栈 | Win tests pass |
| 17.2 | Windows 路径含中文/空格全链路验证 | 测试 | encoding/path tests |
| 17.3 | 文件监听 EBUSY 重试机制增强 | 后端(Go) | rmRetrySync |
| 17.4 | Windows shell 兼容（cmd.exe vs PowerShell） | 后端(Go) | shell detection |
| 17.5 | Playwright E2E 测试编写：导入→编辑→构建→部署→Debug 全流程 | 测试(E2E) | e2e/legacy-sample.spec.ts |
| 17.6 | pnpm-lock.yaml 更新，依赖版本锁定 | 工程 | lockfile |
| 17.7 | 性能基线复测：Windows 10 2vCPU/4GB | 测试 | perf report |
| 17.8 | Gate：legacy-sample 在 Windows 10 云桌面完整 E2E 走通 | QA | Win Gate |

**验收 Gate**：
- 所有 Go/TS 测试在 Windows 上通过
- 10 个 E2E Playwright 测试全部绿色
- 冷启动 ≤ 8s，空闲内存 ≤ 512MB
- 连续 20 次构建/部署循环无文件锁错误

---

### Wave 18：v1.0 体验完善（P1）

**目标**：补面包屑、IDEA keymap、书签、Peek Definition 等高频体验

**周期**：2 周

| # | 任务 | 复杂度 |
|---|------|--------|
| 18.1 | Breadcrumbs 面包屑（基于 documentSymbol） | 中 |
| 18.2 | IDEA keymap 预设（对照 IDEA 默认快捷键映射表） | 中 |
| 18.3 | Bookmarks 书签（F11 切换，Ctrl+0..9 跳转） | 低 |
| 18.4 | Peek Definition（弹窗预览定义，Monaco 内置支持） | 低 |
| 18.5 | Search Everywhere 增加 Actions 搜索 | 中 |
| 18.6 | Welcome 页优化：最近项目列表 + 快速打开教程 | 低 |
| 18.7 | 状态栏 JDT LS 状态指示（starting/ready/indexing/error + 一键重启） | 中 |
| 18.8 | 快捷键速查面板（Ctrl+Shift+K 显示 IDEA→Kairo 快捷键对照） | 低 |

---

### Wave 19：v1.1 增强（P1-P2）

**目标**：反编译、Project Structure UI、JSP 调试增强

**周期**：2 周

| # | 任务 |
|---|------|
| 19.1 | Class 文件反编译：集成 CFR（轻量 BSD 协议）或 FernFlower |
| 19.2 | Project Structure 图形化对话框（JDK、源码目录、依赖管理） |
| 19.3 | JSP 调试：JSP 行号→Servlet 行号 source map（基于 Tomcat 生成的 SMAP） |
| 19.4 | JSP HotSwap：JSP 文件修改后通过 Tomcat reload 而非重启 |
| 19.5 | Local History UI：时间线浏览、对比、恢复 |

---

### Wave 20：v1.2 进阶（P2 及以后）

**周期**：按需规划

| # | 功能 |
|---|------|
| 20.1 | HTTP Client（.http 文件支持） |
| 20.2 | 代码检查规则配置面板（基于 JDT Diagnostics 严重度调整） |
| 20.3 | Database 完整工具（表结构树、SQL 补全增强） |
| 20.4 | Structural Search & Replace 基础版 |

---

## 七、验收标准与质量门禁

### 7.1 v1.0 发布门禁（Go/No-Go 决策点）

| 门禁 | 标准 | 测量方式 |
|------|------|---------|
| 功能完整性 | 四个闭环 P0 功能 100% 可用 | 手工测试 + E2E 自动化 |
| 测试覆盖率 | Go ≥ 70%，TS 每个包 ≥ 40% | `go test -cover` / nyc |
| 性能 | 冷启动 ≤ 8s，首补全 ≤ 1.5s，空闲内存 ≤ 512MB | 自动化性能脚本 |
| 安全 | 65/65 安全测试通过，无高危漏洞 | `go test ./security` + npm audit |
| Windows 兼容 | 所有测试在 windows-2022 通过 | CI |
| GBK 安全 | 100 个混合编码文件批量替换 0 损坏 | 自动化编码测试 |
| E2E | 10/10 Playwright 场景通过 | Playwright CI |
| 内存泄漏 | 连续 4 小时编辑/构建循环无内存增长 > 50MB | 手动 soak test |

### 7.2 每个 Wave 的 DoD（Definition of Done）

每个 Wave 结束必须满足：
1. 代码完成且 Code Review 通过（1 个 approve + 无 blocking comments）
2. 单元测试覆盖新增/修改代码行 ≥ 70%
3. 集成测试证明功能端到端工作
4. 文档更新（用户手册中相关页面）
5. 无 TypeScript 类型错误，无 Go vet 警告
6. 对应 Gate 场景测试通过并输出报告

---

## 八、风险管理与应对

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|---------|
| JDI Bridge 对 Java 6 JDWP 兼容性问题超出预期 | 高 | 严重 | 提前用真实 JDK 6 + Tomcat 6 做 spike；准备降级方案：集成 java-debug v0.42.0（最后支持 Java 6 的版本） |
| Ant build.xml 有极复杂自定义任务无法解析 | 中 | 中 | 降级到目录扫描；提供"解析报告"面板让用户手动补充缺失 jar |
| Windows 上文件锁/权限问题导致 E2E 不稳定 | 高 | 中 | 增加重试机制；CI 用 windows-2022 尽早发现；保留关闭文件监听的选项 |
| 4GB 内存上 JDT LS + JDI Bridge + Tomcat 同时运行 OOM | 中 | 严重 | JDT LS Xmx 严格限制 512MB；JDI Bridge 是独立 JVM 用完即退；监控内存使用并提供警告 |
| 团队对 JDI/DAP 协议不熟悉，开发延期 | 中 | 中 | Wave 15 开始前做 1 天技术 spike；参考 java-debug 开源实现；拆小任务 |
| 真实客户项目 build.xml 结构千奇百怪 | 高 | 中 | 提前收集 5-10 个真实 build.xml 作为测试 corpus；允许用户手动覆盖自动检测结果 |

---

## 九、持续开发与迭代机制

### 9.1 开发节奏

```
每周循环：
┌─────────────────────────────────────────────────┐
│  Mon       站会：上周回顾 + 本周计划 + 风险同步   │
│  Tue-Thu   开发 + Code Review + 持续集成         │
│  Fri       测试日：新功能验证 + 回归测试 + 演示   │
└─────────────────────────────────────────────────┘

每个 Wave（2周）：
- Wave 开始：Kickoff 30min（确认范围/拆分任务/识别风险）
- Wave 中：周三 mid-point check（进度同步/阻塞清理）
- Wave 结束：Demo Day（功能演示）+ Retrospective（流程改进）
- Gate 评审：Go/No-Go 决定是否进入下一个 Wave
```

### 9.2 分支策略

```
main ──────────────────────────────────────►  (保护分支，始终可发布)
       │              │              │
       ▼              ▼              ▼
  wave/15-debug  wave/16-ant   wave/17-win  (功能分支)
       │              │              │
       └── PR ────────┴── PR ────────┘    (每个 PR 必须 CI 绿色)
```

- 每个 Wave 一个 `wave/XX-name` 分支
- 每个任务完成提 PR，必须至少 1 个 approve + CI 全绿
- Wave 合并时执行 Gate 检查
- main 分支每晚自动构建 nightly 版本供测试

### 9.3 测试金字塔

```
        /---- E2E (Playwright) ----\      10-20 个场景，慢
       /--- Integration Tests -----\     每功能 2-5 个，中速
      /----- Unit Tests -------------\    每个函数/类，快速
```

- **单元测试**：Go `testing` + Jest/Vitest，mock 外部依赖，运行 < 5min
- **集成测试**：测试前后端交互，使用真实 JDT LS + 临时目录，运行 < 15min
- **E2E 测试**：Playwright 驱动真实浏览器，运行 legacy-sample 完整场景，< 30min
- PR 合并前必须通过单元+集成；E2E 在 nightly 和 Wave Gate 时运行

### 9.4 持续集成流水线

```
Push/PR → lint (tsc + go vet) → unit tests → integration tests → build
                                                      │
                                                      ▼
                                              Nightly → E2E tests → perf baseline → security scan → nightly build
```

### 9.5 反馈循环

1. **每日构建**：main 分支自动打包 Win/macOS/Linux 版本，测试团队次日验证
2. **每周 Dogfood**：开发团队自己使用本周 build 开发 Kairo IDE 本身（dogfooding）
3. **双周里程碑**：每个 Wave 结束产出可演示版本，产品经理验收
4. **Bug 处理优先级**：
   - P0（阻塞发布）：24 小时内修复
   - P1（功能受损）：当前 Wave 内修复
   - P2（体验问题）：记录到 Backlog，下个 Wave 规划
   - P3（优化建议）：收集到 Ideas 池

### 9.6 v1.0 后持续演进

```
v1.0 发布后：
├── v1.0.x 补丁分支：只修 bug，不加功能
├── v1.1 在 main 上继续开发（Wave 18-19 内容）
├── 收集真实用户反馈驱动 v1.2+ 优先级
└── 性能/内存持续监控，每个版本不退化
```

**关键指标持续跟踪**：
- 冷启动时间、内存占用、补全响应时间
- Crash rate（崩溃次数/小时）
- 用户反馈中的功能请求频率（用于排序 backlog）
- Windows 兼容性 bug 数量趋势

---

## 附录 A：优先级总表（Quick Reference）

| 优先级 | 功能 | Wave | 预估人天 |
|--------|------|------|---------|
| **P0** | 内置 JDI Debug Bridge，开箱即用调试 | 15 | 14 |
| **P0** | Ant build.xml classpath 自动解析 | 16 | 8 |
| **P0** | Custom Build 命令执行 | 16 | 3 |
| **P0** | Windows 10 稳定性 + E2E 自动化 | 17 | 10 |
| **P0** | pnpm-lock + 依赖治理 | 17 | 1 |
| **P0** | Debug 诊断面板 | 15 | 2 |
| **P1** | Breadcrumbs 面包屑 | 18 | 3 |
| **P1** | IDEA keymap 预设 | 18 | 3 |
| **P1** | Bookmarks 书签 | 18 | 2 |
| **P1** | Peek Definition | 18 | 1 |
| **P1** | Search Everywhere Actions | 18 | 3 |
| **P1** | 状态栏语言服务状态 | 18 | 2 |
| **P1** | Class 反编译 | 19 | 5 |
| **P1** | Project Structure 对话框 | 19 | 5 |
| **P1** | JSP 调试行号映射 | 19 | 5 |
| **P2** | JSP HotSwap | 19 | 5 |
| **P2** | HTTP Client | 20 | 8 |
| **P2** | 代码检查规则面板 | 20 | 5 |

**总计**：P0 = ~38 人天（约 5 周 / 2 人），P1 = ~29 人天（约 4 周 / 2 人）

---

## 附录 B：参考文档

- [BLOCKERS.md](file:///Users/qi/Documents/spaces/kairo-ide/docs/BLOCKERS.md) — 已知外部依赖阻塞
- [ADR-0016: Java 6/Tomcat 6 DAP Gate](file:///Users/qi/Documents/spaces/kairo-ide/docs/adr/0016-java6-tomcat6-dap-gate.md)
- [ADR-0017: JDT LS 兼容性矩阵](file:///Users/qi/Documents/spaces/kairo-ide/docs/adr/0017-jdt-ls-compatibility-matrix.md)
- [ADR-0019: Debug Session Service](file:///Users/qi/Documents/spaces/kairo-ide/docs/adr/0019-debug-session-service.md)
- [GPT-5.6 Thinking.md](file:///Users/qi/Documents/spaces/kairo-ide/docs/analysis/GPT-5.6%20Thinking.md) — 核心差距分析
- [product-requirements.md](file:///Users/qi/Documents/spaces/kairo-ide/docs/product-requirements.md) — 原始 PRD
- [Wave 4 Java Language Intelligence](file:///Users/qi/Documents/spaces/kairo-ide/docs/specs/WAVE4_JAVA_LANGUAGE_INTELLIGENCE.md) — Wave 先例文档格式
