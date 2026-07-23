# Kairo IDE 依赖许可证清单 (License Inventory)

**生成日期：** 2026-07-23
**项目：** Kairo IDE v0.1.0

本文档列出 Kairo IDE 所有捆绑依赖的许可证信息，确保企业合规使用。

---

## 一、核心二进制依赖

| 依赖 | 版本 | 许可证 | 类型 | 企业合规 |
|------|------|--------|------|----------|
| Eclipse JDT Language Server | 1.21.0 | [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/) | 弱 Copyleft | ✅ 合规 |
| Apache Tomcat 6 | 6.0.53 | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | 宽松 | ✅ 合规 |
| Theia Platform | 1.73.1 | [EPL-2.0](https://www.eclipse.org/legal/epl-2.0/) OR [GPL-2.0 WITH Classpath-exception-2.0](https://openjdk.org/legal/gplv2+ce.html) | 弱 Copyleft（Classpath 例外） | ✅ 合规 |
| Monaco Editor | 1.108.201 | [MIT](https://opensource.org/licenses/MIT) | 宽松 | ✅ 合规 |

### 许可证说明

- **EPL-2.0（Eclipse Public License 2.0）**：弱 Copyleft 许可证，允许商用、闭源分发、修改，要求修改后的源码在分发时需要公开，但可以与专有软件组合。
- **Apache-2.0**：宽松许可证，允许商用、修改、分发，需保留版权声明和免责声明。
- **GPL-2.0 WITH Classpath-exception-2.0**：GPL 的 Classpath 例外版本，允许与独立模块链接而不需要开源整个应用。
- **MIT**：最宽松的许可证，允许几乎任何用途，只需保留版权声明。

---

## 二、npm 依赖许可证分布

总计扫描 **950** 个 npm 包，分布如下：

| 许可证 | 数量 | 占比 | 企业合规 |
|--------|------|------|----------|
| MIT | 741 | 78% | ✅ 合规 |
| ISC | 95 | 10% | ✅ 合规 |
| BSD（2-Clause / 3-Clause） | 48 | 5% | ✅ 合规 |
| Apache-2.0 | 39 | 4% | ✅ 合规 |
| BlueOak-1.0.0 | 12 | 1% | ✅ 合规 |
| CC（Creative Commons） | 2 | <1% | ⚠️ 注意 |
| Python-2.0 | 1 | <1% | ✅ 合规 |
| MPL-2.0 | 1 | <1% | ✅ 合规 |
| Unlicense | 1 | <1% | ✅ 合规 |
| LGPL-2.1+ | 1 | <1% | ⚠️ 注意 |
| Public Domain | 1 | <1% | ✅ 合规 |
| WTFPL | 1 | <1% | ✅ 合规 |
| 未声明 | 7 | 1% | ⚠️ 需确认 |

---

## 三、许可证风险分析

### GPL/AGPL 检查

✅ **无 GPL-3.0 或 AGPL 依赖**，企业使用不受 GPL 传染性条款影响。

发现 **1 个 LGPL-2.1+ 包**：
- `jschardet@2.3.0` — LGPL-2.1+（字符编码检测库）
  - **风险：低** — LGPL 允许动态链接，不要求整个应用开源
  - **建议：** 可保留，或替换为纯 MIT 的编码检测库

### 其他注意事项

| 包 | 许可证 | 风险 | 建议 |
|----|--------|------|------|
| `axe-core@4.12.1` | MPL-2.0 | 低 | 仅用于开发测试，不随产品分发 |
| `argparse@2.0.1` | Python-2.0 | 低 | 宽松许可证 |

---

## 四、Go 运行时 Agent 依赖

| 包 | 版本 | 许可证 | 企业合规 |
|----|------|--------|----------|
| `github.com/gorilla/websocket` | v1.5.1 | BSD-2-Clause | ✅ 合规 |
| `golang.org/x/text` | v0.18.0 | BSD-3-Clause | ✅ 合规 |
| `gopkg.in/yaml.v3` | v3.0.1 | MIT | ✅ 合规 |
| `golang.org/x/net` | v0.17.0 | BSD-3-Clause | ✅ 合规 |

---

## 五、JDT LS 捆绑 JAR 许可证

JDT LS 1.21.0 捆绑以下 Eclipse 项目 JAR（均为 **EPL-2.0**）：

| 组件 | 说明 |
|------|------|
| `org.eclipse.jdt.ls.core` | JDT LS 核心 |
| `org.eclipse.jdt.core` | Java 开发工具核心 |
| `org.eclipse.lsp4j` | LSP 协议 Java 实现 |
| `org.eclipse.equinox` | OSGi 运行时 |
| `org.eclipse.m2e.*` | Maven 集成 |

Tomcat 6 捆绑的第三方库（均为 **Apache-2.0** 兼容）：
- `commons-codec`, `commons-lang3`, `guava`, `gson`, `slf4j`, `logback`, `jsoup`, `junit`, `hamcrest`, `asm`

---

## 六、许可证合规摘要

| 项目 | 状态 |
|------|------|
| GPL-3.0 依赖 | ✅ 无 |
| AGPL 依赖 | ✅ 无 |
| 企业闭源分发 | ✅ 兼容 |
| 商用许可 | ✅ 兼容 |
| 修改后分发 | ✅ 兼容（EPL-2.0 需公开修改部分） |
| 专利授权 | ✅ 主要许可证包含明示专利授权 |

---

## 七、建议

1. **7 个未声明许可证的包**需要人工确认，建议联系包维护者
2. **jschardet（LGPL-2.1+）** 可考虑替换为 MIT 替代方案（如 `chardet`）以降低 License 审核成本
3. **CC 许可证包**（2 个）建议确认具体版本（CC-BY / CC0 等），CC0 是公共领域，CC-BY-NC 则不可商用
4. 建议在 CI 中集成 `license-checker` 或 `fossa-cli` 自动检测许可证变更

---

*本文档由 `scripts/` 工具链生成，手动维护。*
*许可证信息来源于各包的 `package.json`、`LICENSE` 文件及官方文档。*