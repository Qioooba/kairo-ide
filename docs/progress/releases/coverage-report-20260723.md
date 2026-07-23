# Kairo IDE 代码覆盖率报告 — 2026-07-23

**日期**: 2026-07-23
**版本**: 0.1.0
**报告类型**: 代码覆盖率（Go + TypeScript）

---

## 总体覆盖率

| 语言 | 覆盖率 | 方法 |
| --- | --- | --- |
| Go (runtime-agent) | 待运行 | go test -cover |
| TypeScript (packages + apps) | 待运行 | 测试/代码行数比估算 |
| **总体** | **待运行** | 算术平均 |

> 注：覆盖率数据需运行 `node scripts/run-coverage.cjs` 后获取实际值。

---

## Go 覆盖率

### 模块结构

`runtime-agent` 包含以下内部包：

| 包 | 功能 | 测试文件 |
| --- | --- | --- |
| `internal/api` | HTTP API 层（handlers, server, scanner） | `handlers_test.go`, `dto_test.go`, `encoding_test.go`, `scanner_test.go` |
| `internal/app` | 应用用例层（build, deploy, server） | `use_case_test.go` |
| `internal/atomicfile` | 原子文件操作 | `atomicfile_test.go` |
| `internal/audit` | 审计日志 | `audit_test.go` |
| `internal/catalinabase` | Tomcat Catalina 布局管理 | `planner_test.go`, `preparer_test.go` |
| `internal/config` | 配置管理 | `config_test.go` |
| `internal/debug` | 调试门控探测 | `gate_probe_test.go` |
| `internal/deploy` | 部署同步 | `sync_test.go` |
| `internal/diagnostics` | 诊断捆包 | `bundle_test.go` |
| `internal/domain` | 领域模型 | `run_configuration_test.go`, `runtime_test.go` |
| `internal/encoding` | 编码检测与转换 | `encoding_test.go` |
| `internal/jdtls` | JDT LS 分发与管理 | `distribution_test.go`, `jdtls_test.go` |
| `internal/jdtproject` | JDT 项目配置生成 | `generator_test.go` |
| `internal/log` | 日志系统 | `log_test.go` |
| `internal/pathpolicy` | 路径策略 | `id_test.go`, `path_test.go` |
| `internal/proc` | 进程管理（跨平台） | `proc_test.go`, `proc_windows_test.go` |
| `internal/repository` | 数据持久化 | 多个 `*_test.go` 文件 |
| `internal/runtimeplan` | 运行时计划 | `ports_test.go`, `resolver_test.go` |
| `internal/search` | 文件搜索 | `search_test.go` |
| `internal/security` | 安全沙箱 | `sandbox_test.go` |
| `internal/services` | 业务服务层 | `build_test.go`, `config_test.go`, `server_meta_response_test.go` |
| `internal/sql` | SQL 客户端 | `oracle_test.go` |
| `internal/tomcat6` | Tomcat 6 集成 | `tomcat6_test.go` |
| `internal/toolchain` | 工具链检测 | `toolchain_test.go` |
| `internal/transport/events` | 事件总线与 WebSocket | `eventhub_test.go` |

### 已知覆盖率缺口

1. **集成测试不包含在单元覆盖率中**: `test/integration/` 和 `test/e2e/` 的测试需要完整环境
2. **Windows 特有路径**: `proc_windows.go`, `atomic_rename_windows.go`, `sync_dir_windows.go` 在 macOS 上无法覆盖
3. **WebSocket 实时通信**: `transport/events/websocket.go` 需要长时间运行的连接测试
4. **launch_orchestrator**: 服务编排逻辑依赖外部进程启动，难以在单元测试中完全覆盖
5. **maven**: `internal/maven/maven.go` 缺少测试文件

---

## TypeScript 覆盖率

### 项目结构

Kairo IDE 的 TypeScript 代码分布在：

- **packages/**: 核心共享包（约 15+ 个包）
- **apps/**: 应用入口（browser, electron）
- **tests/**: E2E 测试和 smoke 测试

### 估算方法

由于项目未配置 `nyc` / `istanbul`，TypeScript 覆盖率通过以下方式估算：
1. 统计所有 `.ts` / `.tsx` 源文件的总行数
2. 统计所有 `.test.ts` / `.spec.ts` 测试文件的总行数
3. 计算测试/代码行数比，乘以 0.8 作为估算覆盖率

### 已知覆盖率缺口

1. **Theia 扩展**: 扩展代码依赖 Theia 框架 API，难以在单元测试中完全覆盖
2. **UI 组件**: React 组件需要 jsdom 或浏览器环境
3. **E2E 测试**: Playwright E2E 测试不计入单元测试覆盖率
4. **脚本文件**: `scripts/` 目录下的工具脚本未纳入统计

---

## 改进建议

### 短期（P2）
- 为 `internal/services` 和 `internal/transport/events` 增加单元测试
- 为关键路径（build、deploy、server）添加表驱动测试
- 配置 nyc 以获得准确的 TypeScript 覆盖率

### 中期（P3）
- 为核心 UI 组件添加 snapshot 测试
- 将 Playwright E2E 测试纳入 CI 流程
- 为 `internal/maven` 添加测试

### 长期
- 建立覆盖率门禁（coverage gate），阻止覆盖率下降
- 为关键业务流程添加集成测试
- 引入 mutation testing 评估测试质量

---

*报告由 `scripts/run-coverage.cjs` 自动生成*
*实际覆盖率数据请运行 `node scripts/run-coverage.cjs` 获取*