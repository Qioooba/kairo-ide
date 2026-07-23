# Kairo IDE vs IntelliJ IDEA / VS Code — Java后端开发缺失核心功能深度分析

> **分析模型**: TRAE (v3)
> **分析日期**: 2026-07-21
> **分析基准**: 当前分支代码 + 本地最新代码
> **目标场景**: 遗留Java Web项目 (JDK 1.6 / Tomcat 6 / JSP / Servlet / GBK)
> **对比对象**: IntelliJ IDEA (旗舰版/社区版)、VS Code + Java Extension Pack

---

## 目录

1. [项目现状概览](#1-项目现状概览)
2. [已具备的功能清单](#2-已具备的功能清单)
3. [缺失功能按优先级分类](#3-缺失功能按优先级分类)
   - 3.1 [P0 — 必须立即开发（阻塞日常开发）](#31-p0--必须立即开发阻塞日常开发)
   - 3.2 [P1 — 高优先级（显著提升开发效率）](#32-p1--高优先级显著提升开发效率)
   - 3.3 [P2 — 中优先级（完善体验，IDEA相似性）](#33-p2--中优先级完善体验idea相似性)
   - 3.4 [P3 — 低优先级（锦上添花，可延后）](#34-p3--低优先级锦上添花可延后)
4. [功能详细说明（按优先级）](#4-功能详细说明按优先级)
5. [功能依赖关系图](#5-功能依赖关系图)
6. [建议开发路线图](#6-建议开发路线图)
7. [针对JSP老项目的特殊考虑](#7-针对jsp老项目的特殊考虑)

---

## 1. 项目现状概览

### 1.1 项目定位
Kairo IDE 是基于 Eclipse Theia 框架构建的跨平台IDE，专门面向**遗留Java Web项目维护场景**：
- 目标环境：Windows 10云桌面（2 vCPU / 4GB RAM / 无管理员权限）
- 技术栈：Theia + React + Monaco Editor + Go Runtime Agent + JDT LS
- 部署形态：桌面版 (Electron) + 浏览器版 (localhost)
- 内置组件：JDT LS 1.55.0、Tomcat 6.0.53

### 1.2 现有扩展包结构
| 扩展包 | 功能 |
|--------|------|
| `java-extension` | JDT LS集成、代码补全、定义跳转、诊断 |
| `jsp-extension` | JSP语法高亮、TLD解析 |
| `build-extension` | 编译视图、构建状态展示 |
| `tomcat-extension` | Tomcat服务器管理、日志查看 |
| `search-extension` | 全文搜索服务 |
| `project-extension` | 项目导入、选择向导 |
| `encoding-extension` | 编码检测/转换 (GBK/UTF-8) |
| `runtime-extension` | 运行时连接、WebSocket通信 |
| `ui-kit` | 主题、UI组件 |

### 1.3 当前关键问题（从代码分析得出）
1. **Debug功能仅有命令占位**：[kairo-views-contribution.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/theia-product/src/main/browser/kairo-views-contribution.ts#L65-L65) 中有 `DEBUG_SERVER` 命令，但实际只是启动服务器的debug模式（JDWP端口），**没有DAP客户端、没有断点UI、没有调试视图**
2. **JDT LS仅实现了最小LSP子集**：[lsp-protocol.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/java-extension/src/common/lsp-protocol.ts) 中仅定义了 `completion`、`definition`、`diagnostics`，缺少 `references`、`hover`、`rename`、`codeAction`、`documentSymbol` 等关键能力
3. **没有统一的Problems视图**：编译错误仅在Build视图中展示，LSP诊断未形成统一错误列表
4. **没有文件大纲/结构视图**：无法快速浏览当前Java文件的类/方法结构

---

## 2. 已具备的功能清单

| 功能分类 | 具体功能 | 实现状态 |
|----------|----------|----------|
| **工作空间** | 打开/导入项目、最近项目、多根工作区 | ✅ 完整 |
| **基础编辑** | 文件编辑、标签页、分屏、撤销/重做、多光标 | ✅ 完整（Theia原生） |
| **文件编码** | GBK/UTF-8检测、编码转换、安全重开 | ✅ 完整 |
| **全文搜索** | 文件内容搜索、正则、大小写敏感、替换预览 | ✅ 完整（Go后端） |
| **Java基础** | 代码补全（Ctrl+Space）、跳转到定义（F12）、错误诊断（红线） | ⚠️ 基础可用但体验不完整 |
| **JSP支持** | JSP语法高亮、TLD标签解析 | ⚠️ 基础可用（无Java代码智能） |
| **项目构建** | javac编译、Ant支持、增量编译、Clean Build | ✅ 完整 |
| **Tomcat运行** | 启动/停止/重启、部署、热重载、实时日志 | ✅ 完整 |
| **大文件处理** | 大文件策略、性能优化 | ✅ 完整 |
| **产品化** | 欢迎页、状态栏、主题、快捷键 | ⚠️ 基础可用 |

---

## 3. 缺失功能按优先级分类

### 优先级定义
- **P0 (Must Have)**: 没有就无法正常进行Java开发，日常使用严重受阻
- **P1 (Should Have)**: 显著提升开发效率，是专业Java IDE的标志性功能
- **P2 (Could Have)**: 完善用户体验，让界面和操作更接近IDEA
- **P3 (Won't Have for v1)**: 锦上添花，可在后续版本迭代

---

### 3.1 P0 — 必须立即开发（阻塞日常开发）

| 序号 | 功能名称 | 实现难度 | 预估周期 | 是否JDT LS支持 |
|------|----------|----------|----------|----------------|
| P0-01 | **Debug调试器（断点/单步/变量）** | 🔴 高 | 4-6周 | 需要DAP + JDWP |
| P0-02 | **查找引用（Find Usages / Alt+F7）** | 🟡 中 | 1-2周 | ✅ LSP `references` |
| P0-03 | **悬停提示（Hover / 鼠标悬停显示文档）** | 🟢 低 | 3-5天 | ✅ LSP `hover` |
| P0-04 | **问题/错误视图（Problems View）** | 🟡 中 | 1-2周 | ✅ LSP `publishDiagnostics` |
| P0-05 | **代码大纲/结构视图（Outline / Ctrl+F12）** | 🟡 中 | 1-2周 | ✅ LSP `documentSymbol` |
| P0-06 | **重命名重构（Rename / Shift+F6）** | 🟡 中 | 1-2周 | ✅ LSP `rename` |
| P0-07 | **自动导入与Import优化（Organize Imports）** | 🟡 中 | 2-3周 | ✅ LSP `codeAction` |

---

### 3.2 P1 — 高优先级（显著提升开发效率）

| 序号 | 功能名称 | 实现难度 | 预估周期 | 是否JDT LS支持 |
|------|----------|----------|----------|----------------|
| P1-01 | **快速修复/代码操作（Quick Fix / Alt+Enter）** | 🟡 中 | 2-3周 | ✅ LSP `codeAction` |
| P1-02 | **工作空间符号搜索（Go to Symbol / Ctrl+Shift+R）** | 🟡 中 | 1-2周 | ✅ LSP `workspaceSymbol` |
| P1-03 | **签名帮助（Parameter Info / Ctrl+P）** | 🟢 低 | 3-5天 | ✅ LSP `signatureHelp` |
| P1-04 | **内置终端（Integrated Terminal）** | 🟢 低 | 1周 | Theia已有terminal扩展 |
| P1-05 | **转到实现（Go to Implementation / Ctrl+Alt+B）** | 🟢 低 | 3-5天 | ✅ LSP `implementation` |
| P1-06 | **查找所有引用面板（Find Usages Panel）** | 🟡 中 | 1-2周 | 基于P0-02扩展UI |
| P1-07 | **代码格式化（Format Document / Ctrl+Alt+L）** | 🟢 低 | 3-5天 | ✅ LSP `formatting` |
| P1-08 | **Git版本控制集成（基础版）** | 🟡 中 | 2-3周 | Theia已有scm扩展 |

---

### 3.3 P2 — 中优先级（完善体验，IDEA相似性）

| 序号 | 功能名称 | 实现难度 | 预估周期 | 是否JDT LS支持 |
|------|----------|----------|----------|----------------|
| P2-01 | **类型层次结构（Type Hierarchy / Ctrl+H）** | 🟡 中 | 2-3周 | ✅ JDT LS扩展 |
| P2-02 | **调用层次结构（Call Hierarchy / Ctrl+Alt+H）** | 🟡 中 | 2-3周 | ✅ LSP `callHierarchy` |
| P2-03 | **代码生成（Getter/Setter/Constructor/toString）** | 🟡 中 | 2-3周 | ✅ LSP `codeAction` |
| P2-04 | **JSP中Java代码智能补全** | 🔴 高 | 3-4周 | 需要自定义 |
| P2-05 | **文件历史/本地历史（Local History）** | 🟡 中 | 2周 | 需自行实现 |
| P2-06 | **TODO/FIXME任务视图** | 🟢 低 | 3-5天 | 可基于搜索扩展 |
| P2-07 | **代码片段/实时模板（Live Templates / sout/psvm）** | 🟡 中 | 1-2周 | Monaco支持 |
| P2-08 | **面包屑导航（Breadcrumbs）** | 🟢 低 | 3-5天 | Theia/Monaco支持 |
| P2-09 | **IDEA风格深色主题（Darcula）** | 🟢 低 | 2-3天 | UI定制 |
| P2-10 | **项目结构视图（Project Structure 类IDEA）** | 🟡 中 | 2周 | UI重构 |

---

### 3.4 P3 — 低优先级（锦上添花，可延后）

| 序号 | 功能名称 | 实现难度 | 预估周期 | 备注 |
|------|----------|----------|----------|------|
| P3-01 | 条件断点/日志断点（Conditional Breakpoints） | 🟡 中 | 1-2周 | 依赖P0-01 |
| P3-02 | 数据库工具（Database Viewer / Oracle 11g） | 🔴 高 | 4-6周 | 项目PRD提到但非核心 |
| P3-03 | Maven/Gradle深度集成 | 🟡 中 | 2-3周 | 老项目多为Ant |
| P3-04 | JUnit单元测试运行器 | 🟡 中 | 2-3周 | JDT LS支持 |
| P3-05 | 代码重复检测 | 🔴 高 | 3-4周 | 需额外工具 |
| P3-06 | 性能分析/Profiler | 🔴 高 | 4-6周 | 老项目需求低 |
| P3-07 | AI代码补全 | 🟡 中 | 2-3周 | 项目PRD明确v1不做 |
| P3-08 | 插件市场 | 🔴 高 | 4-6周 | 项目PRD明确v1不做 |

---

## 4. 功能详细说明（按优先级）

---

### P0-01: Debug调试器（断点/单步/变量查看）

#### 功能描述
Java调试是后端开发**最核心的功能**，没有之一。通过设置断点，让程序在指定位置暂停，然后可以：
- 查看当前所有变量的值
- 单步执行代码（步入、步过、步出）
- 查看调用栈
- 计算表达式的值
- 修改变量值（高级功能）

#### 使用场景
1. **Bug定位**：程序出现异常时，在可疑代码行设置断点，逐步执行查看变量状态
2. **逻辑验证**：新写的代码不确定是否正确，通过断点逐行验证执行流程
3. **理解老代码**：面对10年以上的遗留项目，通过断点跟踪理解代码执行路径
4. **问题复现**：用户报告某个操作出错，在对应Controller/Service设置断点复现

#### 怎么用（IDEA操作参考）
1. 在编辑器行号左侧单击，设置/取消断点（红色圆点）
2. 点击工具栏的"Debug"按钮（虫子图标）启动Tomcat调试模式
3. 在浏览器中触发相应操作（如点击按钮、提交表单）
4. 程序运行到断点处自动暂停，IDE切换到Debug视图
5. 使用调试工具栏：
   - F8: Step Over（步过，执行下一行不进入方法）
   - F7: Step Into（步入，进入当前调用的方法内部）
   - Shift+F8: Step Out（步出，从当前方法返回）
   - F9: Resume Program（继续运行到下一个断点）
6. 在Variables面板查看变量值，在Console面板查看输出

#### 技术实现方案
```
技术栈: DAP (Debug Adapter Protocol) + JDWP (Java Debug Wire Protocol)

架构分层:
┌─────────────────────────────────────────────────────────┐
│  Monaco Editor (断点标记/断点UI)                         │
│  Theia Debug Frontend (调试视图/变量面板/调用栈)          │
└──────────────────────┬──────────────────────────────────┘
                       │ DAP (JSON-RPC)
┌──────────────────────▼──────────────────────────────────┐
│  Debug Adapter (Java Debug Server / 可复用已有开源实现)   │
│  - 处理断点设置/删除                                     │
│  - 处理单步/继续/暂停命令                                │
│  - 查询变量/调用栈/线程                                  │
└──────────────────────┬──────────────────────────────────┘
                       │ JDWP (二进制协议)
┌──────────────────────▼──────────────────────────────────┐
│  Tomcat JVM (以 -agentlib:jdwp=... 启动)                 │
│  - JDWP Agent监听在指定端口（如8000）                    │
│  - 提供断点事件、变量访问、单步控制能力                   │
└─────────────────────────────────────────────────────────┘

现有基础:
- 已有 DEBUG_SERVER 命令框架（kairo-views-contribution.ts）
- Tomcat启动时已支持debug参数（server-service.ts）
- Theia框架有完整的Debug扩展API

实现步骤:
1. 集成 @theia/debug 扩展（Theia已内置）
2. 开发 Java Debug Adapter 或复用 java-debug 开源实现
3. 实现断点UI（Monaco已有断点渲染能力）
4. 开发调试视图面板（变量、调用栈、断点、控制台）
5. 与Tomcat启动流程集成（自动设置JDWP端口）
6. 处理JDK 1.6的JDWP兼容性（老版本JVMTI）
```

#### 为什么是P0
根据对Java开发者的调查，**Debug能力是评价一个IDE是否"能用"的首要标准**。没有Debug，开发者只能靠System.out.println和日志猜问题，对于复杂的遗留系统效率极低。当前产品仅有"以debug模式启动服务器"（打开JDWP端口），但没有办法在IDE内设置断点、查看变量，等于Debug功能完全不可用。

---

### P0-02: 查找引用（Find Usages / Alt+F7）

#### 功能描述
查找一个类、方法、字段、变量在整个项目中**哪些地方被使用了**。这是理解代码影响范围、安全重构的基础。

#### 使用场景
1. **修改代码前评估影响**：我要改这个方法的参数，需要知道哪些地方调用了它
2. **删除代码前确认**：这个类/方法到底还有没有人用？能不能安全删除？
3. **理解代码**：这个Service被哪些Controller调用？这个常量在哪里被引用？
4. **排查Bug**：某个字段被意外修改，查找所有赋值的地方

#### 怎么用（IDEA操作参考）
1. 将光标放在类名/方法名/字段名上
2. 按 Alt+F7（或右键 → Find Usages）
3. 底部弹出Find面板，按使用类型分类显示：
   - 方法调用
   - 类型引用（new、implements、extends）
   - 字段读写
   - 注释中的引用（可选）
4. 点击引用条目直接跳转到对应位置
5. 可设置搜索范围（项目/模块/类/测试代码）

#### 技术实现方案
```
基于 LSP `textDocument/references` 协议，JDT LS已完整支持。

实现步骤:
1. 在 java-language-client.ts 中添加 references 方法
2. 在 Monaco 中注册 ReferenceProvider（lsp-protocol.ts已有类型定义但未实现）
3. 绑定 Alt+F7 / Shift+F12 快捷键
4. 实现引用结果展示面板（Theia已有树形组件可复用）
5. 添加引用类型分组（读/写/调用/继承/实现）
```

#### 为什么是P0
没有Find Usages，开发者在修改或删除代码时心里完全没底。对于10年以上的老项目，代码动辄几十万行，靠全文搜索（search-extension）会返回大量无关结果（注释、字符串、同名不同类），效率极低。LSP的references是语义级别的，能精确区分真实引用和文本匹配。

---

### P0-03: 悬停提示（Hover Documentation）

#### 功能描述
鼠标悬停在代码元素上时，弹出一个浮动窗口显示：
- 该元素的类型信息（方法返回值、参数类型）
- JavaDoc文档注释（如果有的话）
- 相关注解信息
- 错误/警告提示（如果有问题）

#### 使用场景
1. **查看方法签名**：不记得这个方法需要传什么参数，鼠标放上去看一眼
2. **查看JavaDoc**：这个方法是做什么的？有什么注意事项？
3. **查看变量类型**：这个变量声明是var或链式调用，实际类型是什么？
4. **查看错误详情**：红线上悬停显示具体错误信息（当前已有但不完整）

#### 怎么用（IDEA操作参考）
1. 鼠标悬停在任意类名/方法名/变量名上
2. 等待300ms自动弹出悬浮窗
3. 悬浮窗内可点击链接跳转到定义
4. 按F2可快速聚焦错误提示（当前可扩展）

#### 技术实现方案
```
基于 LSP `textDocument/hover` 协议，JDT LS完整支持。

实现步骤:
1. 在 java-language-client.ts 中添加 hover 方法
2. 在 Monaco 中注册 HoverProvider（Monaco原生支持）
3. 处理Markdown内容渲染（JavaDoc常包含Markdown/HTML标签）
4. 支持悬浮窗内的链接跳转（跳转到定义）
5. 调整悬浮样式与IDEA风格对齐
```

#### 为什么是P0
这是代码编辑中**使用频率最高**的功能之一，不需要任何快捷键，鼠标移过去就能看到信息。当前产品仅有错误信息的悬停，没有类型信息和JavaDoc，开发者只能反复跳转到定义处查看，效率很低。

---

### P0-04: 问题/错误视图（Problems View）

#### 功能描述
一个统一的面板，集中显示当前项目中**所有的Java编译错误、警告、语法问题**。按文件分组，显示错误位置、错误信息，点击可直接跳转到对应代码行。

#### 使用场景
1. **刚打开项目时**：快速了解项目有多少编译错误，哪些文件有问题
2. **重构后检查**：修改了很多文件，看看有没有引入新的错误
3. **定位错误**：编译失败，但错误信息很长，在Problems视图里看得更清楚
4. **清理警告**：项目中有很多deprecation警告，统一处理

#### 怎么用（IDEA操作参考）
1. 点击底部工具栏的"Problems"标签（或按 Alt+6）
2. 视图按严重程度分类：Errors（红色）、Warnings（黄色）、Infos（灰色）
3. 可按文件、按类型分组
4. 点击错误条目直接跳转到编辑器对应行
5. 工具栏有"显示下一个/上一个错误"按钮（F2 / Shift+F2）
6. 编辑器行号旁有错误图标，滚动条上有错误标记位置

#### 技术实现方案
```
基于 LSP `textDocument/publishDiagnostics` 已有事件，需要做状态聚合和UI。

当前现状:
- java-document-sync.ts 中已接收 diagnostics 事件
- build-view-widget.tsx 中显示构建错误
- 但两者没有统一，LSP诊断没有持久化和全局展示

实现步骤:
1. 创建 Problem/Marker 服务，订阅所有diagnostics事件
2. 维护全局问题列表（按uri缓存最新诊断）
3. 开发Problems视图面板（树形结构：文件 → 问题列表）
4. 实现问题过滤（按严重程度、按当前文件）
5. 绑定F2/Shift+F2快捷键跳转到下一个/上一个错误
6. 在编辑器滚动条上添加错误标记（Monaco支持）
7. 合并javac编译错误和JDT LS诊断（去重）
```

#### 为什么是P0
当前开发者需要：1）等编译完在Build视图看错误；2）或者在编辑器里滚动找红线。对于一个有几百个错误的老项目，没有集中的错误列表根本没法工作。IDEA和VS Code都把Problems视图作为默认打开的核心面板。

---

### P0-05: 代码大纲/结构视图（Outline / Structure）

#### 功能描述
显示当前打开的Java文件的**代码结构树**：包声明、imports、类、内部类、字段、方法、构造函数等。点击可快速跳转到对应位置。

#### 使用场景
1. **快速浏览文件**：打开一个陌生的Java文件，先看大纲了解这个类有哪些方法
2. **长文件导航**：一个Servlet几千行，想找doPost方法直接在大纲点一下
3. **代码审查**：快速看这个类的结构是否合理，方法是不是太多了
4. **快速定位**：记得方法名但不记得在第几行，直接在大纲搜索

#### 怎么用（IDEA操作参考）
1. 按 Ctrl+F12（或View → Tool Windows → Structure）
2. 弹出当前文件的结构弹窗，或左侧边栏固定显示Structure面板
3. 图标区分不同元素：
   - 🔵 类/接口
   - 🟢 公共方法
   - 🔴 私有方法
   - 🟡 字段
   - 挂锁图标表示static
4. 直接输入方法名可快速过滤
5. 点击条目跳转到对应代码行

#### 技术实现方案
```
基于 LSP `textDocument/documentSymbol` 协议，JDT LS完整支持。

实现步骤:
1. 在 java-language-client.ts 中添加 documentSymbol 方法
2. 开发Outline视图面板（Theia已有TreeWidget可复用）
3. 绑定Ctrl+F12快捷键弹出快速大纲（弹层式）
4. 支持大纲搜索过滤
5. 实现不同符号类型的图标（类、方法、字段等）
6. 跟随光标位置自动高亮当前所在方法
```

#### 为什么是P0
遗留Java Web项目的单个文件经常有几千行（Servlet一个类里写所有逻辑很常见），没有大纲只能靠滚动条或者全文搜索来找方法，效率极低。这是代码导航的基础功能。

---

### P0-06: 重命名重构（Rename Refactoring / Shift+F6）

#### 功能描述
安全地重命名一个类、方法、字段、变量，**自动更新所有引用这个元素的地方**。这是IDE相比普通文本编辑器最核心的优势之一——语义级别的修改，而不是文本查找替换。

#### 使用场景
1. **修正命名错误**：方法名拼写错了，比如把getUser写成getUesr
2. **统一命名风格**：变量名起得不好，想改成更清晰的名字
3. **重构类名**：这个类名字不合适，重命名后所有import、new语句都自动更新
4. **参数重命名**：方法参数名改了，所有调用处的参数名（如果是命名参数风格）也更新

#### 怎么用（IDEA操作参考）
1. 将光标放在要重命名的元素上
2. 按 Shift+F6（或右键 → Refactor → Rename）
3. 元素名变成可编辑状态，输入新名字
4. IDE自动查找所有引用并预览修改
5. 按Enter确认，所有引用自动更新；按Esc取消
6. 底部有Refactoring Preview面板，可确认哪些地方会被修改

#### 技术实现方案
```
基于 LSP `textDocument/rename` 和 `textDocument/prepareRename` 协议，JDT LS支持。

实现步骤:
1. 在 java-language-client.ts 中添加 rename / prepareRename 方法
2. 在 Monaco 中注册 RenameProvider（Monaco原生支持重命名UI）
3. 绑定Shift+F6快捷键
4. 实现重命名预览（可选，先做直接修改模式）
5. 处理跨文件重命名（类名重命名需要更新文件名，这部分需额外实现）
6. 添加Undo支持（Theia已有编辑历史）

注意事项:
- JDK 1.6项目中可能有反射调用（Class.forName），LSP无法识别这些字符串引用，需要提示用户
- XML/Spring配置中的引用（老项目可能有）无法自动更新，需注意
```

#### 为什么是P0
没有Rename，开发者只能靠"查找替换"来改名字，这非常危险：
- 会替换掉同名不同义的元素（别的类里有同名方法）
- 会替换注释和字符串里的内容
- 漏掉import语句、全限定名引用
- 跨文件替换容易出错

对于老项目维护来说，代码可读性差经常需要重命名来改善，Rename是刚需。

---

### P0-07: 自动导入与Import优化（Organize Imports）

#### 功能描述
1. **自动导入**：当你使用了一个没有import的类（比如List、String），IDE自动添加import语句
2. **Import优化**：自动删除未使用的import，按规则排序import，合并同一包的import
3. **导入冲突解决**：当有同名类时（如java.util.List和java.awt.List），让用户选择

#### 使用场景
1. **写代码时**：输入ArrayList list = new ... 一打完分号，import自动加上
2. **复制代码后**：从别的地方复制了一段代码，import都没带，一键Organize Imports自动补全
3. **清理代码**：删了很多代码，一堆import变成灰色未使用，一键清理
4. **解决冲突**：两个包都有同名类，弹出选择框让你选哪个

#### 怎么用（IDEA操作参考）
1. 启用"Add unambiguous imports on the fly"设置，写代码时自动导入
2. 对于有歧义的类，按 Alt+Enter 弹出导入建议列表
3. 按 Ctrl+Alt+O 优化所有import（删除未使用、排序、合并）
4. 粘贴代码时自动检测缺失的import并提示导入

#### 技术实现方案
```
基于 LSP `textDocument/codeAction` 协议，JDT LS提供自动import的code action。

实现步骤:
1. 实现CodeAction服务（P1-01的基础）
2. 订阅诊断变化，对"cannot be resolved"类型的错误触发自动import
3. 开发导入建议弹出框（类似completion的列表）
4. 实现Organize Imports命令（Ctrl+Alt+O）
5. 配置import排序规则（java/javax/org/com分组）
6. 实现粘贴代码时自动检测并添加import
```

#### 为什么是P0
手写import语句不仅浪费时间，还容易写错包名。老项目里类很多，记不住全限定名是常态。IDEA的自动导入是"写Java代码停不下来"的重要原因之一。

---

### P1-01: 快速修复/代码操作（Quick Fix / Alt+Enter）

#### 功能描述
当代码有错误或警告时，或者在某个代码元素上，按 Alt+Enter 弹出上下文相关的修复建议和代码操作，比如：
- 修复编译错误（添加try-catch、实现接口方法、类型转换）
- 生成代码（生成getter/setter、构造函数）
- 代码优化（用增强for循环替换普通for、字符串拼接改StringBuilder）
- 抑制警告（添加@SuppressWarnings注解）
- 其他上下文操作

#### 使用场景
1. **快速解决错误**：代码报错了，按Alt+Enter看IDE能不能自动修
2. **生成样板代码**：在类里按Alt+Enter选择生成getter/setter
3. **代码优化**：IDEA提示你这里可以优化，一键应用
4. **异常处理**：调用了抛出异常的方法，自动添加try-catch或throws声明

#### 为什么是P1
这是IDEA最"智能"的功能之一，但依赖于P0-07（自动导入也是一种Quick Fix）。在P0功能完成后实现这个能让开发体验上一个台阶。

---

### P1-02: 工作空间符号搜索（Go to Symbol / Ctrl+Shift+R）

#### 功能描述
在整个项目中**按名称搜索类、方法、字段**，不是文本搜索，是语义级别的符号搜索。输入类名/方法名的前缀就能快速定位。

#### 使用场景
1. **快速打开类**：记得类名叫UserService，按Ctrl+Shift+R输入US就能找到
2. **找方法**：不记得这个方法在哪个类里，只记得名字叫login
3. **大项目导航**：项目有上千个类，靠文件树找太慢了

#### 为什么是P1
当前有文件搜索（Ctrl+P）和全文搜索（Ctrl+Shift+F），但缺少专门的符号搜索。符号搜索是按语义索引的，速度更快，结果更精准。

---

### P1-03: 签名帮助（Parameter Info / Ctrl+P）

#### 功能描述
调用方法时，在括号内按 Ctrl+P 弹出一个提示框，显示这个方法有哪些重载形式，每个参数是什么类型，当前正在输入第几个参数。

#### 使用场景
1. **调用不熟悉的方法**：不记得这个方法要传什么参数、有几个重载
2. **重载方法选择**：这个方法有好几个版本，看哪个参数组合适合
3. **参数顺序确认**：参数类型相似（比如都是String），确认顺序对不对

#### 为什么是P1
和Hover配合使用，写方法调用时不需要停下来跳转到定义看参数。IDEA中这个功能是自动弹出的（输入左括号或逗号时自动显示），非常方便。

---

### P1-04: 内置终端（Integrated Terminal）

#### 功能描述
在IDE底部打开一个终端面板，可以直接执行命令，不需要切换到外部终端/命令提示符。

#### 使用场景
1. **执行Ant/Maven命令**：虽然IDE有Build按钮，但有时候需要手动执行特定Ant target
2. **Git命令**：虽然会做Git集成，但有些人还是习惯命令行
3. **执行脚本**：启动其他工具、数据库命令、文件操作等
4. **查看文件**：用cat/ls等命令快速查看

#### 技术实现
Theia已经有 `@theia/terminal` 扩展，只需要集成进来配置好即可，开发量很小。

#### 为什么是P1
开发者离不开终端，在IDE里内置终端避免频繁切换窗口。对于云桌面环境（全屏远程桌面），切换窗口很麻烦。

---

### P1-05: 转到实现（Go to Implementation / Ctrl+Alt+B）

#### 功能描述
光标在接口名/抽象方法上时，直接跳转到具体的实现类/实现方法。如果有多个实现，弹出列表让你选。

#### 使用场景
1. **接口+实现模式**：老项目里经常用DAO接口 → DAOImpl实现，看接口时直接跳到实现
2. **多态场景**：一个接口有多个实现类，看有哪些实现
3. **抽象类**：从抽象方法跳到具体实现

#### 为什么是P1
F12（Go to Definition）只能跳到接口声明，而开发者90%的情况是想看具体实现。JDT LS通过LSP `implementation` 协议支持。

---

### P1-07: 代码格式化（Format Document / Ctrl+Alt+L）

#### 功能描述
按照配置的代码风格规则，自动格式化Java代码：缩进、空格、换行、大括号位置、空行等。

#### 使用场景
1. **代码排版**：写完代码一键格式化，不用手动调整空格对齐
2. **统一风格**：团队代码风格不一致，格式化后统一
3. **粘贴后整理**：从别处复制的代码格式乱了，一键规范

#### 技术实现
JDT LS支持LSP `textDocument/formatting` 和 `textDocument/rangeFormatting`，Monaco也支持格式化快捷键。需要配置格式化规则（Eclipse代码格式化配置文件）。

---

### P1-08: Git版本控制集成（基础版）

#### 功能描述
在IDE内完成Git日常操作：
- 查看哪些文件改了（Diff视图）
- 暂存/提交
- 查看历史
- 分支切换
- 拉取/推送

#### 使用场景
1. **提交代码**：改完代码直接在IDE里看diff、写提交信息、提交
2. **查看修改**：改了一天，看看哪些文件改了，改了什么内容
3. **回滚修改**：某文件改乱了，一键还原到HEAD版本

#### 技术实现
Theia有 `@theia/scm` 和 `@theia/git` 扩展，基础功能可以直接用，不需要从零开发。

#### 为什么是P1
Git是现代开发的标配，虽然老项目可能用SVN或没有版本控制，但大多数团队还是用Git。基础版集成（看状态、diff、提交）的工作量不大。

---

## 5. 功能依赖关系图

```
P0-01 Debugger ─────────────────────────────────────────────── 独立，需DAP+JDWP
    │
    ├── P3-01 条件断点 (依赖P0-01)
    └── P3-04 JUnit测试 (依赖P0-01)

P0-02 References (Alt+F7) ──────────────────────────────────── LSP基础能力
    │
    └── P1-06 Find Usages Panel (UI扩展)

P0-03 Hover ────────────────────────────────────────────────── LSP基础能力
    │
    └── P1-03 SignatureHelp (体验互补)

P0-04 Problems View ────────────────────────────────────────── LSP事件聚合
    ├── 依赖: Java Document Sync (已具备)
    └── P2-06 TODO视图 (实现模式相同)

P0-05 Outline (Ctrl+F12) ───────────────────────────────────── LSP基础能力
    ├── P2-08 Breadcrumbs (基于Outline数据)
    └── 为类型层次/调用层次打基础

P0-06 Rename (Shift+F6) ────────────────────────────────────── LSP基础能力

P0-07 Organize Imports ─────────────────────────────────────── LSP CodeAction
    │
    └── P1-01 Quick Fix (扩展更多CodeAction)
         ├── P2-03 代码生成 (Getter/Setter等)
         └── P2-04 JSP智能 (更复杂)

P1-02 Workspace Symbol (Ctrl+Shift+R) ──────────────────────── LSP基础能力
P1-04 Terminal ─────────────────────────────────────────────── 集成Theia扩展
P1-05 Go to Implementation (Ctrl+Alt+B) ────────────────────── LSP基础能力
P1-07 Formatting (Ctrl+Alt+L) ──────────────────────────────── LSP基础能力
P1-08 Git集成 ──────────────────────────────────────────────── 集成Theia扩展

P2-01 Type Hierarchy (Ctrl+H) ──────────────────────────────── JDT LS扩展协议
P2-02 Call Hierarchy (Ctrl+Alt+H) ──────────────────────────── LSP 3.16+
```

---

## 6. 建议开发路线图

### 阶段一：P0核心功能（6-8周）— 达到"Java IDE可用"门槛

| 周次 | 任务 | 交付物 |
|------|------|--------|
| 第1周 | P0-03 Hover + P0-05 Outline | 悬停显示类型/文档；文件大纲视图 |
| 第2-3周 | P0-02 References + P0-06 Rename | 查找引用；重命名重构 |
| 第3-4周 | P0-04 Problems View + P0-07 Organize Imports | 错误视图；自动导入 |
| 第4-8周 | P0-01 Debugger (核心里程碑) | 断点、单步、变量、调用栈、调试视图 |

**阶段一验收标准**：
- 打开一个Java文件，能看到代码大纲
- 鼠标悬停能看到方法签名和JavaDoc
- 按Alt+F7能找到所有引用
- 按Shift+F6能安全重命名
- 底部有Problems视图显示所有错误
- 写未导入的类能自动import
- 能设置断点、Debug启动Tomcat、在断点处停下、看变量、单步执行

---

### 阶段二：P1效率功能（3-4周）— 达到"好用的Java IDE"水平

| 周次 | 任务 |
|------|------|
| 第9周 | P1-04 Terminal + P1-08 Git基础 + P1-05 Go to Implementation |
| 第10周 | P1-01 Quick Fix + P1-03 Signature Help |
| 第11周 | P1-02 Workspace Symbol + P1-07 Formatting + P1-06 Find Usages Panel |

**阶段二验收标准**：
- 有内置终端可用
- 能在IDE内看Git diff、提交代码
- 按Ctrl+Alt+B跳转到实现
- 按Alt+Enter有快速修复建议
- 调用方法时自动显示参数提示
- 按Ctrl+Shift+R快速搜索类/方法
- Ctrl+Alt+L格式化代码

---

### 阶段三：P2体验优化（4-6周）— 接近IDEA操作体验

| 任务 |
|------|
| P2-01 Type Hierarchy (类层次) |
| P2-02 Call Hierarchy (调用层次) |
| P2-03 代码生成 (Getter/Setter/toString/constructor) |
| P2-06 TODO/FIXME视图 |
| P2-07 Live Templates (sout/psvm等代码模板) |
| P2-08 Breadcrumbs面包屑导航 |
| P2-09 IDEA风格Darcula主题 |
| P2-10 类IDEA项目结构视图优化 |

---

## 7. 针对JSP老项目的特殊考虑

Kairo IDE的目标场景是**JDK 1.6 + Tomcat 6 + JSP/Servlet老项目**，这类项目有一些现代Spring Boot项目没有的特殊需求：

### 7.1 JSP支持增强（P2-04）
当前JSP仅有语法高亮，缺少：
- JSP中嵌入的Java代码（`<% ... %>`）的智能补全、错误检查
- JSP标签（自定义标签、JSTL）的补全和跳转
- JSP <-> Servlet之间的跳转（通过web.xml路径映射）
- EL表达式（`${...}`）的补全和验证
- 包含文件（`<%@ include %>`）的解析

### 7.2 web.xml支持
- web.xml中Servlet映射的识别（URL pattern → Servlet类跳转）
- Filter、Listener的导航
- 配置文件中的类名引用支持跳转到定义

### 7.3 Ant build.xml深度集成
- 识别build.xml中的target，在IDE中提供运行入口
- 解析classpath配置，确保JDT LS的classpath与实际编译一致
- Ant属性解析（${}变量替换）

### 7.4 混合编码支持
- 老项目经常一个项目里既有GBK又有UTF-8文件
- JSP页面中 `<%@ page pageEncoding="GBK" %>` 需要被识别
- Properties文件的native-to-ascii转换（`\uXXXX`格式）

### 7.5 Tomcat JDWP 1.6兼容性
- JDK 1.6的JDWP协议与新版本有差异，Debug Adapter需要兼容
- 老版本JVM不支持某些DAP功能（如热替换、表达式求值的某些特性）
- Tomcat 6启动时JDWP参数配置需要正确处理

### 7.6 老项目常见反模式支持
- 大量JSP页面中写Java代码（Scriptlet）
- 通过反射调用（Class.forName、Method.invoke）导致Rename/Find Usages不完整
- 大量System.out.println调试（Debug功能完善后会自然减少）
- 没有标准化的目录结构（src、WebRoot、classes随意放）
- lib目录下堆满jar包，没有Maven/Gradle依赖管理

---

## 附录：LSP能力当前覆盖矩阵

| LSP能力 | 协议方法 | 当前状态 | 优先级 |
|---------|----------|----------|--------|
| 代码补全 | `textDocument/completion` | ✅ 已实现 | - |
| 跳转到定义 | `textDocument/definition` | ✅ 已实现 | - |
| 诊断错误 | `textDocument/publishDiagnostics` | ⚠️ 有事件但无全局视图 | P0-04 |
| 悬停提示 | `textDocument/hover` | ❌ 未实现 | P0-03 |
| 查找引用 | `textDocument/references` | ❌ 未实现 | P0-02 |
| 重命名 | `textDocument/rename` | ❌ 未实现 | P0-06 |
| 代码操作 | `textDocument/codeAction` | ❌ 未实现 | P0-07/P1-01 |
| 文件符号 | `textDocument/documentSymbol` | ❌ 未实现 | P0-05 |
| 工作空间符号 | `workspace/symbol` | ❌ 未实现 | P1-02 |
| 签名帮助 | `textDocument/signatureHelp` | ❌ 未实现 | P1-03 |
| 转到实现 | `textDocument/implementation` | ❌ 未实现 | P1-05 |
| 格式化 | `textDocument/formatting` | ❌ 未实现 | P1-07 |
| 调用层次 | `textDocument/prepareCallHierarchy` | ❌ 未实现 | P2-02 |
| 类型定义 | `textDocument/typeDefinition` | ❌ 未实现 | P2 |
| 文档高亮 | `textDocument/documentHighlight` | ❌ 未实现 | P2 |
| 代码透镜 | `textDocument/codeLens` | ❌ 未实现 | P3 |
| 语义令牌 | `textDocument/semanticTokens` | ❌ 未实现 | P2 |

---

> **文档结束**
> 
> 分析模型: TRAE v3
> 建议后续结合其他模型分析结果综合评估，确定最终开发优先级。
