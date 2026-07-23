# Kairo IDE 第一期任务看板

> 只有 `verified` 状态计入阶段完成率。每次领取或完成任务后必须同步本表和对应任务文件。

| 任务 ID | 任务 | 状态 | 负责人 | 当前证据 |
|---|---|---|---|---|
| P1-BASE-01 | 测试、性能、包体与内存基线 | in_progress | release_baseline Agent | `P1-BASE-01.md` |
| P1-SUPPLY-01 | 版本锁、checksum 与供应链门禁 | blocked | release_baseline Agent | `P1-SUPPLY-01.md` |
| P1-JAVA-01 | Java 6 / JDT LS 兼容矩阵 | planned | 待领取 | — |
| P1-JAVA-02 | JDT LS 生命周期与限次恢复 | implemented | java_semantics Agent | `P1-JAVA-02.md` |
| P1-JAVA-03 | Java 核心语义能力首切片 | implemented | java_semantics Agent | `P1-JAVA-03.md` |
| P1-SRCH-01 | 搜索 API、状态与后端取消切片 | implemented | search_slice + 主 Agent | `P1-SRCH-01.md` |
| P1-SRCH-02A | 全文 Search Center UI 基础 | implemented | search_slice Agent | `P1-SRCH-02.md` |
| P1-SRCH-02B | Search Everywhere 统一入口 | implemented | search_slice Agent | `P1-SRCH-02B.md` |
| P1-SRCH-03B | 全局替换安全预览与逐文件应用 | implemented | search_slice Agent | `P1-SRCH-03B.md` |
| P1-RUN-01 | 统一运行配置模型与严格校验 | implemented | release_baseline + 主 Agent | `P1-RUN-01.md` |
| P1-RUN-02 | 运行配置安全持久化 CRUD | implemented | release_baseline Agent | `P1-RUN-02.md` |
| P1-RUN-03 | 浏览器端运行配置 CRUD 与轻量 UI | implemented | Codex Run UI Agent | `P1-RUN-03.md` |
| P1-RUN-04A | 运行配置安全执行垂直切片 | implemented | Codex Run UI Agent | `P1-RUN-04A.md` |
| P1-BLD-01A | 可信 javac 构建与可取消闭环 | implemented | release_baseline Agent | `P1-BLD-01A.md` |
| P1-DBG-00 | Java 6 / Tomcat 6 / DAP 技术闸门 | in_progress | Codex 主 Agent | `P1-DBG-00.md` |
| P1-DBG-01 | Java Debug Adapter 最小真实垂直切片 | implemented | Codex Debug Agent | `P1-DBG-01.md` |
| P1-DBG-02A | 原生 Debug 核心体验接线与异常恢复 | implemented | Codex Debug Agent | `P1-DBG-02A.md` |
| P1-TOM-01A | 轻量 Tomcat Logs 真实数据与有界视图 | implemented | Codex Tomcat Logs Agent | `P1-TOM-01A.md` |
| P1-WIN-01 | Windows 10 无管理员启动与路径矩阵 | in_progress | windows_portability Agent | `P1-WIN-01.md` |

## 当前波次退出条件

- 基线命令有统一超时和机器可读报告。
- 供应链缺少 checksum 时 fail closed，不允许 CI 假绿。
- Java LSP 和搜索至少形成一个真实可运行、带测试的垂直切片。
- JDWP 状态不再被 UI 丢失；完整 DAP 技术闸门仍需真实 JDK 6。
- 合并前执行全仓 TypeScript、Go、lint 和文档检查。
