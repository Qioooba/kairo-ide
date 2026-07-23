# Kairo IDE 版本清单 (Version Manifest)

**生成日期：** 2026-07-23
**项目：** Kairo IDE v0.1.0

本文档记录了 Kairo IDE 所有锁定依赖的版本、SHA-256 校验和及许可证信息。

---

## 核心依赖版本

| 依赖 | 锁定版本 | 来源 | 许可证 | SHA-256 | 备注 |
|------|----------|------|--------|---------|------|
| Eclipse JDT LS | **1.21.0** | ADR-0017 | EPL-2.0 | 通过环境变量 `KAIRO_JDTLS_SHA256` 引用 | Java 6 兼容性已验证，JDK 17 运行 |
| Apache Tomcat 6 | **6.0.53** | ADR-0006 | Apache-2.0 | 通过环境变量 `KAIRO_TOMCAT6_SHA256` 引用 | 最终版本，EOL |
| Theia Platform | **1.73.1** | `packages/theia-product/package.json` | EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0 | — | 精确版本锁定 |
| Monaco Editor | **1.108.201** | `@theia/monaco-editor-core` | MIT | — | Theia 捆绑版本 |
| Go | **1.22** | `runtime-agent/go.mod` | BSD-3-Clause | — | 运行时 Agent 编译 |
| Node.js | **≥20.10.0** | `package.json` engines | MIT | — | 运行时环境 |
| pnpm | **9.15.9** | `package.json` packageManager | MIT | — | Corepack 锁定 |

---

## JDT LS 版本详情

- **锁定版本：** 1.21.0
- **运行 JDK 要求：** JDK 17
- **Java 6 source/target 兼容性：** ✅ 已验证
- **锁定原因：**
  1. JDK 17 运行要求，与 Kairo IDE 默认 `languageServerJavaHome` 一致
  2. 1.35.0+ 要求 JDK 21，额外增加 ~50 MB 下载量
  3. 内部测试确认可正确处理 Java 6 source/target 项目
  4. 社区广泛使用的稳定版本
- **升级策略：** 季度评估 → 兼容性测试 → 灰度发布 → 正式发布 → 保留回滚
- **参考：** [ADR-0017 — JDT LS 版本兼容性矩阵](../docs/adr/0017-jdt-ls-compatibility-matrix.md)

---

## Tomcat 6 版本详情

- **锁定版本：** 6.0.53
- **状态：** EOL（End of Life）
- **锁定原因：** Kairo IDE 目标项目使用 Tomcat 6，捆绑此版本确保离线可用
- **参考：** [ADR-0006 — JDK6/Tomcat6 EOL 策略](../docs/adr/0006-jdk6-tomcat6-eol-strategy.md)

---

## Theia 版本详情

| 包 | 版本 |
|----|------|
| `@theia/core` | 1.73.1 |
| `@theia/debug` | 1.73.1 |
| `@theia/editor` | 1.73.1 |
| `@theia/filesystem` | 1.73.1 |
| `@theia/markers` | 1.73.1 |
| `@theia/messages` | 1.73.1 |
| `@theia/monaco` | 1.73.1 |
| `@theia/monaco-editor-core` | 1.108.201 |
| `@theia/navigator` | 1.73.1 |
| `@theia/outline-view` | 1.73.1 |
| `@theia/preferences` | 1.73.1 |
| `@theia/search-in-workspace` | 1.73.1 |
| `@theia/terminal` | 1.73.1 |
| `@theia/variable-resolver` | 1.73.1 |
| `@theia/workspace` | 1.73.1 |

---

## Go 运行时 Agent 依赖

| 包 | 版本 | 许可证 |
|----|------|--------|
| `github.com/gorilla/websocket` | v1.5.1 | BSD-2-Clause |
| `golang.org/x/text` | v0.18.0 | BSD-3-Clause |
| `gopkg.in/yaml.v3` | v3.0.1 | MIT |
| `golang.org/x/net` | v0.17.0 | BSD-3-Clause |

---

## 开发工具链

| 工具 | 锁定版本 | 用途 |
|------|----------|------|
| TypeScript | 5.5.4 | 编译器 |
| Prettier | 3.3.3 | 代码格式化 |
| ESLint | ^10.7.0 | 代码检查 |
| Playwright | ^1.61.1 | E2E 测试 |
| rimraf | 5.0.10 | 清理工具 |
| @types/node | 20.14.10 | Node.js 类型定义 |

---

## 版本锁定策略

1. **精确版本锁定**：所有关键依赖使用精确版本（不含 `^` 或 `~`）
2. **SHA-256 校验**：二进制依赖通过 SHA-256 校验和验证完整性
3. **供应链锁文件**：`scripts/supply-chain-lock.json` 记录所有外部二进制依赖
4. **Corepack 锁定**：通过 `packageManager` 字段锁定 pnpm 版本
5. **Go toolchain 锁定**：`go.mod` 中指定 `toolchain go1.22.0`

---

*本文档由 `scripts/verify-version-lock.cjs` 验证，手动维护。*