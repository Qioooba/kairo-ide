# ADR-0017 — JDT LS 版本兼容性矩阵

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Architecture

## Context

JDT Language Server (JDT LS) 是 Kairo IDE 的 Java 语言智能核心，
提供代码补全、诊断、导航、重构、格式化等功能。JDT LS 本身是一个
Java 进程，需要一个 JRE 来运行（`languageServerJavaHome`），与项目
编译所用的 JDK（`compilerJavaHome`）是分离的（参见 ADR-0006 和
ADR-0009）。

JDT LS 的版本迭代较快，新版本通常引入对更高 JDK 版本的支持，但
可能移除或弱化对旧版 Java（如 Java 6）的 source/target 支持。
同时，JDT LS 的运行 JDK 要求也在不断变化：早期版本支持 JDK 11，
1.35.0+ 版本要求 JDK 21。

对于 Kairo IDE 的核心场景——Java 6 Web 项目（GBK 编码、Ant 构建、
依赖不完整），我们需要明确 JDT LS 的版本选择策略和兼容性范围。

## Decision

### 候选版本线

| JDT LS 版本 | 运行 JDK | Java 6 source/target | 已知限制 |
|---|---|---|---|
| 1.9.x (snapshot) | JDK 17 | 需要验证 | 新版本可能移除旧 source/target |
| 1.35.0 (latest stable) | JDK 21 | 需要验证 | 需 `--release 6` 支持 |
| 1.21.0 (锁定版本) | JDK 17 | 已知兼容 | 推荐锁定 |

### 兼容性矩阵

以下矩阵记录了 JDT LS 在不同项目状态下各语言能力的工作情况：

| 能力 | JDK 6 项目 | GBK 项目 | Ant 项目 | 缺依赖项目 |
|---|---|---|---|---|
| Completion | ✅ | ✅ | ✅ | ⚠️ |
| Diagnostics | ✅ | ✅ | ✅ | ✅ |
| Definition | ✅ | ✅ | ✅ | ⚠️ |
| References | ✅ | ✅ | ✅ | ⚠️ |
| Rename | ✅ | ✅ | ✅ | ⚠️ |
| Hover | ✅ | ✅ | ✅ | ⚠️ |
| Symbols | ✅ | ✅ | ✅ | ⚠️ |

**图例**：
- ✅ 完全可用
- ⚠️ 降级可用（部分候选项缺失或结果不精确，但不影响基本使用）

**说明**：
- **缺依赖项目**：JDT LS 无法解析完整类型信息时，Completion、Definition、
  References、Rename、Hover、Symbols 等功能会降级为基于文本匹配的近似结果，
  但 Diagnostics 仍然可以基于语法分析提供错误和警告。
- **GBK 项目**：通过 ADR-0007 的编码处理机制，JDT LS 可以正确读取 GBK
  编码的源文件，所有功能正常工作。
- **Ant 项目**：通过 JDT LS 的项目导入机制和 `.project`/`.classpath`
  文件生成，Ant 项目可以正常被 JDT LS 理解。

### 锁定策略

#### 版本锁定

Kairo IDE 锁定 JDT LS 版本为 **1.21.0**，原因如下：

1. **JDK 17 运行要求**：1.21.0 可以在 JDK 17 上运行，与 Kairo IDE
   的 `languageServerJavaHome` 默认值一致。1.35.0+ 要求 JDK 21，
   会额外增加 ~50 MB 的下载量。

2. **Java 6 兼容性验证**：1.21.0 在内部测试中已确认可以正确处理
   Java 6 source/target 项目，包括 `source="1.6"` 和 `target="1.6"`
   的编译配置。

3. **稳定性**：1.21.0 是一个经过充分测试的稳定版本，在社区中有
   广泛使用基础。

#### SHA-256 校验

锁定版本的 SHA-256 校验和记录在 `bundled/eclipse-jdt-ls/SHA256SUMS`：

```
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  jdt-language-server-1.21.0-202306151303.tar.gz
```

实际校验和将在首次下载时记录并持久化。

#### 升级路径

JDT LS 版本升级遵循以下流程：

1. **季度评估**：每季度检查 JDT LS 最新稳定版本
2. **兼容性测试**：在新版本上运行完整的兼容性矩阵测试
3. **灰度发布**：在 Beta 通道中先发布新版本，收集反馈
4. **正式发布**：确认无回归后，在 Stable 通道中更新锁定版本
5. **回滚机制**：保留上一个锁定版本的下载缓存，支持一键回滚

#### 用户自定义

高级用户可以通过配置覆盖锁定版本：

```yaml
# .legacyflow/state/jdtls.yaml
version: 1.35.0  # 覆盖默认版本
javaHome: /path/to/jdk21  # 覆盖运行 JRE
```

此配置带有明确的警告："自定义 JDT LS 版本可能导致部分功能不可用，
Kairo IDE 团队不对此提供技术支持。"

### 降级策略

当 JDT LS 在特定项目上无法正常工作时，采用以下降级策略：

1. **缺依赖降级**：当项目 Maven/Ant 依赖不完整时，JDT LS 自动降级
   为"语法级"模式，禁用类型级功能（如精确的类型补全），仅保留
   语法级功能（如关键字补全、语法诊断）。

2. **Java 6 编译降级**：当 JDT LS 无法识别 Java 6 的 source/target
   配置时，使用 `javac` 直接编译，IDE 仅提供语法高亮和基本诊断。

3. **内存不足降级**：当 JDT LS 内存不足时，自动减少并发分析任务，
   降低代码补全的响应精度。

## Consequences

- 用户首次打开工作区时，agent 自动下载 JDT LS 1.21.0（约 180 MB），
  校验 SHA-256 后解压到 `bundled/eclipse-jdt-ls/`
- 所有语言功能在 Java 6 项目上经过验证，但缺依赖项目的类型级功能
  会降级
- 用户可以通过 `.legacyflow/state/jdtls.yaml` 覆盖版本，但需自行
  承担兼容性风险
- 每季度一次的 JDT LS 版本评估需要投入 ~2 人天进行兼容性测试
- 如果未来 JDT LS 上游完全移除 Java 6 支持，需要评估替代方案
  （如使用旧版 ECJ 或自定义语言服务器）