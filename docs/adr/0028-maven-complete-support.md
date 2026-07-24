# ADR-0028 — Maven 完整支持

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 6)

## Context

Kairo IDE 需要为 Java 遗留项目提供完整的 Maven 构建工具支持。与仅提供基础构建命令执行的方案不同，本项目需要深度集成 Maven 项目模型，包括 POM 解析、传递依赖解析、多模块项目管理和生命周期感知。

Wave 12 的核心目标是实现从 POM 解析到构建执行的完整 Maven 工具链，使开发者无需离开 IDE 即可完成全流程 Java 项目管理。

## Decision

### 1. 整体架构

Maven 支持模块位于 `runtime-agent/internal/maven/maven.go`，采用纯 Go 实现，不依赖外部 Maven 库。核心设计原则：

- **静态解析优先**：通过 XML 解析 POM 文件实现项目模型理解，仅在构建执行时调用 `mvn` CLI
- **离线模式支持**：通过扫描本地 `~/.m2/repository` 解析传递依赖
- **mvnw 优先**：自动检测 Maven Wrapper，优先使用项目绑定的 Maven 版本

### 2. EffectivePOM 解析

**决策：实现完整的 EffectivePOM 生成，包括父 POM 继承和属性解析**

`EffectivePOM` 结构包含：
- 基础坐标：`groupId`、`artifactId`、`version`、`packaging`
- 继承链：`Parent` 引用（`ParentRef`），属性回退继承
- 项目属性：`Properties` 键值对映射
- 模块声明：`Modules` 列表（多模块项目）
- 依赖列表：`Dependencies`（含 scope、optional、type）
- 插件列表：`Plugins`（groupId、artifactId、version）
- 仓库列表：`Repositories`（id、url、name）

解析逻辑：
- 当子模块未定义 `groupId`/`version` 时，从 `parent` 继承
- 默认 `packaging` 为 `jar`，根模块默认为 `pom`
- 默认 `scope` 为 `compile`，默认 `type` 为 `jar`

### 3. 传递依赖解析

**决策：三层解析策略，在线优先，离线回退**

1. **在线模式**：执行 `mvn dependency:tree -DoutputType=text -q` 获取完整依赖树，解析含缩进层级的文本输出
2. **离线模式**：扫描 `~/.m2/repository` 中每个直接依赖的 POM 文件，递归构建二层级子依赖树
3. **静态模式**：仅解析当前 POM 中声明的直接依赖，形成平面列表

依赖树结构 `DependencyTreeNode` 支持递归子节点，保留 scope、optional、type 属性。

**冲突检测**：`DetectConflicts()` 通过 `groupId:artifactId` 键分组，检测同一依赖的多版本声明，记录冲突版本列表。

### 4. 生命周期管理

**决策：支持 3 个标准生命周期中 7 个最常用阶段**

Maven 标准定义了 3 个生命周期（clean、default、site），共 22 个阶段。Kairo IDE 当前支持：

| 阶段 | 生命周期 | 描述 |
|------|----------|------|
| `clean` | clean | 删除 target/ 目录 |
| `validate` | default | 验证项目结构 |
| `compile` | default | 编译 Java 源码 |
| `test` | default | 运行单元测试 |
| `package` | default | 打包为 JAR/WAR |
| `verify` | default | 运行集成测试 |
| `install` | default | 安装到本地仓库 |

每个阶段对应一个 `LifecycleTask`，包含 ID、标签、描述和阶段名。

构建执行 `RunTask()`：
- 调用 `findMaven()` 定位可执行文件
- 支持 `-o`（离线模式）和 `-B`（批处理模式）参数
- 捕获退出码和完整输出
- 使用 mvnw 时在输出中标记 `[mvnw wrapper]`

### 5. mvnw 自动检测

**决策：优先检测 mvnw/mvnw.cmd，回退到系统 PATH 中的 mvn**

`findMaven()` 检测顺序：
1. `<rootPath>/mvnw`（Unix/Mac）
2. `<rootPath>/mvnw.cmd`（Windows）
3. 系统 PATH 中的 `mvn`

检测逻辑：`isExecutable()` 仅验证文件存在且非目录（不检查 Unix 执行位，跨平台兼容）。

### 6. 多模块 Reactor 构建

**决策：基于 Kahn 拓扑排序的 Reactor 构建顺序**

`ResolveMultiModule()` 实现：
- 递归扫描根 POM 中的 `<modules>` 声明
- 解析每个子模块的 POM 获取完整元数据
- 构建 `MultiModuleProject`：包含 `Root`、`Modules` 列表、`BuildOrder` 列表

`ResolveReactorBuildOrder()` 实现：
- 构建模块间依赖图（基于 `groupId:artifactId` 匹配）
- 使用 Kahn 算法进行拓扑排序，无依赖模块优先
- 队列排序保证确定性输出
- 循环依赖检测：无法完整排序时回退至原始顺序

**跨模块类路径解析**：
- `ResolveCrossModuleClasspath()` 计算每个模块的编译类路径
- 包含直接依赖的兄弟模块 `target/classes` 目录
- 通过递归解析传递依赖模块的类路径，形成完整类路径

**模块依赖分类**：
- `GetModuleDependencies()` 区分内部依赖（同 Reactor 内模块）和外部依赖（第三方库）

### 7. 数据流

```
pom.xml (XML 文件)
    │
    ▼
Detect() / GenerateEffectivePOM()
    │
    ├── Project 元数据 (GAV, packaging, buildDir, outputDir)
    ├── Dependencies[] (直接依赖列表)
    ├── DependencyTreeNode[] (依赖树)
    ├── DependencyConflict[] (版本冲突)
    └── LifecycleTask[] (可执行阶段)
    │
    ▼
RunTask() → mvn/mvnw CLI → RunResult (exitCode, output)
```

## Alternatives Considered

### 替代方案 A：使用 Maven Invoker API
Maven Invoker 提供编程式 API 调用 Maven，但需要 Java 运行时和完整的 Maven 库依赖。对于 Go 语言 Agent，引入 Java 进程管理复杂且增加部署体积。

### 替代方案 B：调用 `mvn help:effective-pom` 获取 EffectivePOM
依赖外部 Maven 可获取 100% 准确的 EffectivePOM，但需要完整的 Maven 安装和网络访问。纯 Go 实现提供离线能力和更快的解析速度。

### 替代方案 C：使用 Maven Daemon (mvnd)
mvnd 通过守护进程加速 Maven 构建，但增加了部署依赖且与标准 Maven 行为存在差异。当前选择标准 mvn + mvnw 方案，后续可扩展支持。

### 替代方案 D：仅支持直接依赖，不解析传递依赖
降低实现复杂度，但无法提供依赖冲突检测和完整的依赖树视图，限制了 IDE 的代码智能能力。

## Consequences

### 正面影响
- 纯 Go 实现无需外部 Java 运行时即可解析 POM
- EffectivePOM 提供完整的项目模型视图
- 传递依赖解析支持依赖冲突检测
- mvnw 自动检测确保使用项目指定的 Maven 版本
- 拓扑排序确保多模块项目按正确顺序构建
- 离线模式支持无网络环境下的依赖解析

### 负面影响
- EffectivePOM 解析不完整：不支持 `<dependencyManagement>`、`<pluginManagement>`、profile 激活、属性占位符 `${...}` 替换
- 传递依赖仅解析到二级（离线模式），不保证完整传递闭包
- SAML 响应解析仅支持基本属性，不支持加密断言
- 不支持 Gradle 项目（仅 Maven）
- 依赖树解析依赖 `mvn dependency:tree` 的输出格式，不同 Maven 版本可能输出差异

### 后续工作
- 实现 `<dependencyManagement>` 和 `<pluginManagement>` 解析
- 支持 Maven 属性占位符替换（`${project.version}` 等）
- 扩展传递依赖解析深度
- 支持 profile 激活
- 添加 Gradle 支持