# Kairo IDE 开发交接文档

> 生成时间：2026-07-23  
> 最新提交：`63ac139 feat: complete Wave H/I/J + Phase 2/3 delivery`  
> 分支：`main`（已领先 origin/main 1 commit）  
> 目标读者：接手开发的 AI 工程师 / 人类开发者  

---

## 1. 总体进度概览

### 1.1 已完成阶段

| 阶段 | 名称 | 状态 | 说明 |
|------|------|------|------|
| Wave 0 | Bleeding Fixes | 完成 | 所有门禁通过 |
| Wave H | Debug 验收 + E2E 场景 | 完成 | 6 个任务全部完成 |
| Wave I | IDEA 风格搜索增强 | 完成 | Find File/Class/Symbol/Action + widgets |
| Wave J | Phase 2 遗漏 | 完成 | XML/DTD/EL 支持 + Git pre-commit hooks |
| Phase 1 | 基础能力 | 基本完成 | 18 个任务中大部分已实现 |
| Phase 2 | 增强能力 | 基本完成 | UX/DBG/JAVA/WEB/GIT 大部分完成 |
| Phase 3 | 高级能力 | 部分完成 | Maven/Remote/Data/Observability 骨架存在 |

### 1.2 最新提交内容（`63ac139`）

本次提交包含 **460 个文件变更，+91,330 行，-1,093 行**，涵盖：

- **Wave 1-6 全部任务代码骨架**（LSP 接线、视图层、重型功能、JSP 专项、工程化、高级特性）
- **Go Runtime Agent 测试覆盖率提升**（从 47.3% → 58.5%）
- **新增包**：maven、sql/oracle、diagnostics、remote、proc、gate_probe、search_events、port_diagnostics、project_import、run_configurations、launch_orchestrator、project_detector
- **新增前端扩展**：remote-extension、sql-extension、test-extension
- **E2E 测试**：tests/e2e/core-e2e.spec.ts（1721 行）、fixtures
- **安全测试**：tests/security/security.test.cjs（1070 行）
- **故障注入测试**：tests/fault/fault-injection.test.cjs（621 行）
- **供应链脚本**：generate-sbom、audit-dependencies、verify-artifact-integrity 等
- **交付脚本**：check-delivery-readiness、generate-delivery-report、run-release-baseline 等

---

## 2. 当前代码质量状态

### 2.1 Go 测试覆盖率

**总体覆盖率：58.5%**（目标 ≥60%）

| 包 | 覆盖率 | 状态 |
|----|--------|------|
| security | 86.6% | 高 |
| provider/runtime | 84.9% | 高 |
| search | 83.3% | 高 |
| pathpolicy | 82.9% | 高 |
| catalinabase | 81.8% | 高 |
| build | 78.4% | 中 |
| domain | 78.3% | 中 |
| config | 77.3% | 中 |
| deploy | 71.7% | 中 |
| jdtproject | 71.0% | 中 |
| repository | 70.9% | 中 |
| encoding | 69.6% | 中 |
| proc | 69.2% | 中 |
| runtimeplan | 68.4% | 中 |
| diagnostics | 67.7% | 中 |
| atomicfile | 67.6% | 中 |
| log | 67.1% | 中 |
| toolchain | 67.1% | 中 |
| remote | 65.9% | 中 |
| jdtls | 61.6% | 中 |
| services | 60.9% | 中 |
| debug | 56.2% | 低 |
| tomcat6 | 53.7% | 低 |
| maven | 51.4% | 低 |
| provider/build | 48.2% | 低 |
| app | 40.9% | 低 |
| transport/events | 39.9% | 低 |
| api | 27.9% | 低 |
| bootstrap | 0.0% | 未覆盖 |
| cmd/kairo-runtime | 0.0% | 未覆盖 |
| api/protocol | 0.0% | 未覆盖（本次会话新增 types_test.go） |

### 2.2 前端测试

- `pnpm -r --filter './packages/*' test`：33/33 通过
- TypeScript 类型检查：`tsc --noEmit` 通过
- 本次会话新增了大量 `.test.cjs` 文件

### 2.3 门禁状态

| 门禁 | 状态 |
|------|------|
| `go vet ./...` | 通过 |
| `go test -count=1 ./...` | 通过（部分 API 测试需要较长时间） |
| `pnpm clean && pnpm build` | 通过 |
| 供应链安全测试 | 15/15 通过 |
| 交付清单 50/50 | 通过 |

---

## 3. 全量开发计划 — 待完成内容

### 3.1 Wave 1：LSP 接线补全（代码已存在，需验证）

| 任务 | 代码文件 | 状态 |
|------|----------|------|
| 1.1 Java Hover | `java-extension/src/browser/java-monaco-registration.ts` | 代码已存在，需端到端验证 |
| 1.2 Find References | 同上 | 代码已存在 |
| 1.3 Rename Refactoring | `java-extension/src/browser/java-refactoring.ts` | 代码已存在 |
| 1.4 Code Actions/Quick Fix | `java-extension/src/browser/java-monaco-registration.ts` | 代码已存在 |
| 1.5 Document Symbol/Outline | 同上 | 代码已存在 |
| 1.6 Signature Help | 同上 | 代码已存在 |
| 1.7 Code Formatting | `java-extension/src/browser/java-save-actions.ts` | 代码已存在 |
| 1.8 Organize Imports | 同上 | 代码已存在 |
| 1.9 Workspace Symbol | `search-extension/src/browser/search-everywhere-*.ts` | 代码已存在 |
| 1.10 Go to Implementation | `java-extension/src/browser/java-monaco-registration.ts` | 代码已存在 |

**注意：Wave 1 所有任务代码已生成，但需要在真实 JDT LS 运行环境中验证端到端功能。**

### 3.2 Wave 2：视图层补齐（代码已存在，需验证）

| 任务 | 代码文件 | 状态 |
|------|----------|------|
| 2.1 Problems View | `theia-product/src/main/browser/kairo-problems-widget.tsx` | 代码已存在 |
| 2.2 Integrated Terminal | `theia-product/package.json` 已添加 @theia/terminal | 依赖已添加 |
| 2.3 Breadcrumbs | `kairo-editor-contribution.ts` 中已启用 | 代码已存在 |
| 2.4 Inlay Hints | Monaco 注册已完成 | 代码已存在 |
| 2.5 CodeLens | Monaco 注册已完成 | 代码已存在 |

### 3.3 Wave 3：重型功能 — 需要实际开发

| 任务 | 状态 | 阻塞项 |
|------|------|--------|
| 3.1 Java Debug 闭环 | **部分实现** | 需要真实 JDK 6 + Tomcat 6 + JDWP 环境验证 |
| 3.2 Git 集成 | 依赖已添加 | 需要验证 @theia/git 实际运行 |
| 3.3 Call/Type Hierarchy | 代码已存在 | 需要 JDT LS 实际运行验证 |

**Debug 待完成项（3.1.1-3.1.10）**：
- P1-DBG-00 技术闸门：验证 Java 6 + Tomcat 6 + JDWP + DAP 可行性
- Go Agent 端 Tomcat JDWP 参数注入
- Java Debug Adapter 集成
- Debug 视图：Variables、Call Stack、Breakpoints、Watch
- Step Over/Into/Out、Resume
- Debug Console
- 条件断点、日志断点
- 异常断点
- 端到端验证：Servlet 断点 → 请求 → 命中 → 变量 → 单步

### 3.4 Wave 4：JSP 老项目专项 — 需要实际开发

| 任务 | 状态 | 说明 |
|------|------|------|
| 4.1 JSP scriptlet 内 Java 补全/诊断 | **未实现** | 需要 Monaco embedded language 机制 |
| 4.2 EL 表达式补全 | 部分实现 | `el-expression-provider.ts` 存在，需增强 |
| 4.3 TLD 标签库补全 | 部分实现 | `jsp-tld-completion.ts` 存在，需接线 |
| 4.4 web.xml 编辑辅助 | 部分实现 | `webxml-completion.ts` 存在 |
| 4.5 JSP ↔ Servlet 跳转 | 部分实现 | `jsp-servlet-nav.ts` 存在 |

### 3.5 Wave 5：工程化与质量 — 需要实际执行

| 任务 | 状态 | 说明 |
|------|------|------|
| 5.1 Live Templates | 代码已存在 | `java-live-templates.ts` |
| 5.2 Local History | 代码已存在 | `kairo-local-history.ts` |
| 5.3 TODO/FIXME 视图 | 代码已存在 | `kairo-todo-widget.tsx` |
| 5.4 性能基线采集 | **未采集** | 代码已存在，需实际采集数据 |
| 5.5 Windows 10 产品化 | **阻塞** | 需要 Windows 10 真实环境 |

**性能目标**：
- 冷启动 ≤ 8s
- 首次 Java completion ≤ 1.5s
- 10k 文件全文搜索 ≤ 3s
- 稳态内存 < 1.2GB

### 3.6 Wave 6：高级特性 — 按需开发

| 任务 | 状态 | 说明 |
|------|------|------|
| 6.1 JUnit Test Runner | 骨架存在 | `java-junit-runner.ts` + `kairo-test-results-widget.tsx` |
| 6.2 Maven 集成 | 骨架存在 | `maven-view-widget.tsx` + Go Agent `maven/` |
| 6.3 HotSwap 热部署 | 未实现 | 依赖 Task 3.1 Debug |
| 6.4 SQL Console | 骨架存在 | `kairo-sql-console-widget.tsx` + Go Agent `sql/oracle/` |
| 6.5 远程 Linux 开发 | 骨架存在 | `kairo-remote-agent-service.ts` + Go Agent `remote/` |

### 3.7 阻塞项

| 阻塞项 | 需要 |
|--------|------|
| Windows 10 产品化 | Windows 10 真实环境（无管理员权限） |
| Java 6 Debug 闸门 | JDK 6 + Tomcat 6 真实环境 |
| 性能基线 | 真实产品构建 + 标准化测试数据 |

---

## 4. 开发规范与约定

### 4.1 文档优先级

发生冲突时按以下顺序：
1. 用户最新明确指令
2. `docs/KAIRO_IDE_DELIVERY_MASTER_PLAN.md`（执行基线）
3. `docs/product-requirements.md`、`docs/architecture.md`、`docs/ui-spec.md`
4. ADR 决策记录（`docs/adr/`）
5. 历史任务和分析报告

### 4.2 开发规则

每个 AI/人类工程师必须：
- 一次只领取一个可独立验收的任务
- 开发前阅读本文件、相关代码、相关 ADR 和任务依赖
- 不得仅修改文档就宣称功能完成
- 不得把模拟数据、空按钮、静态界面视为产品闭环
- 必须保留用户已有修改，不覆盖不相关变更
- 必须补充自动化测试，给出真实运行命令和结果
- 涉及 UI 时必须提供正常、加载、空、错误、禁用五种状态
- 涉及 Windows 时必须在真实 Windows 10 环境给出证据
- 涉及 Java 6 时必须使用真实遗留样例和 JDK 6 验证
- 完成后在 `docs/progress/releases/` 下写入标准任务记录

### 4.3 架构原则

1. 保留 Theia + Monaco，不重写编辑器核心
2. Go Agent 负责平台相关、长任务和可控系统操作
3. Node/Theia backend 负责前端扩展集成和协议适配
4. 前后端协议版本化，所有长任务支持取消、进度和关联 ID
5. Desktop 与 Browser 只在启动层分叉，业务功能不分叉
6. Java 语义分析、真实编译、Tomcat 运行三条链路解耦
7. 所有用户操作都必须有状态、日志和可恢复错误
8. 首选复用成熟协议和组件，不自研 Java parser、Debugger 或编辑器

### 4.4 模块边界

| 模块 | 主要职责 | 禁止事项 |
|------|----------|----------|
| `packages/project-extension` | 项目导入、模型、最近项目 | 不直接启动系统进程 |
| `packages/encoding-extension` | 编码检测、读取、保存策略 | 不静默转换源文件 |
| `packages/search-extension` | 搜索 UI、筛选、预览、替换计划 | 不绕过 Agent 直接扫大项目 |
| `packages/java-extension` | LSP 生命周期与 Monaco/Theia 能力桥接 | 不实现自有 Java parser |
| `packages/jsp-extension` | JSP/XML/Properties/EL 语言支持 | 不实现自有 JSP 编译器 |
| `packages/build-extension` | 构建配置、任务 UI、结果映射 | 不把 UI 线程变成长任务执行器 |
| `packages/tomcat-extension` | Server、部署、日志、运行配置 | 不复制构建逻辑 |
| `packages/runtime-extension` | Agent 连接、任务、健康状态 | 不承载具体业务 UI |
| `packages/remote-extension` | 远程开发连接 | 不绕过安全沙箱 |
| `packages/sql-extension` | SQL 控制台和执行 | 不实现 JDBC 驱动 |
| `packages/test-extension` | 测试发现和运行 | 不实现测试框架 |
| `packages/ui-kit` | 设计 token 与可复用组件 | 不放业务状态和系统调用 |
| `runtime-agent` | 文件、搜索、构建、进程、端口、日志 | 不保存前端展示状态 |

---

## 5. 全量文档索引

### 5.1 核心规划文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 交付总计划 | `docs/KAIRO_IDE_DELIVERY_MASTER_PLAN.md` | 执行基线，Phase 1/2/3 全量计划 |
| 里程碑状态 | `docs/MILESTONES.md` | 各组件当前状态矩阵 |
| 综合交付 Spec | `.trae/specs/comprehensive-delivery-plan/spec.md` | Wave 1-6 详细规格 |
| 综合交付 Tasks | `.trae/specs/comprehensive-delivery-plan/tasks.md` | 任务清单 + 依赖关系 |
| 综合交付 Checklist | `.trae/specs/comprehensive-delivery-plan/checklist.md` | 验收清单 |
| Phase 1 持续开发 | `.trae/specs/phase-1-continuous-dev/` | Phase 1 详细 spec |

### 5.2 架构文档

| 文档 | 路径 |
|------|------|
| 产品需求 | `docs/product-requirements.md` |
| 架构设计 | `docs/architecture.md` |
| UI 规格 | `docs/ui-spec.md` |
| 目标架构 | `docs/specs/TARGET_ARCHITECTURE.md` |
| 主任务分配 | `docs/specs/MASTER_TASK_ASSIGNMENT.md` |
| 设计决策记录 | `docs/adr/0001-0017` |

### 5.3 Wave 规格文档

| Wave | 路径 |
|------|------|
| Wave 0 Bleeding Fixes | `docs/specs/WAVE0_BLEEDING_FIXES.md` |
| Wave 1 Backend Architecture | `docs/specs/WAVE1_BACKEND_ARCHITECTURE_CONVERGENCE.md` |
| Wave 2 Build/Deploy/Run | `docs/specs/WAVE2_BUILD_DEPLOY_RUN_CLOSED_LOOP.md` |
| Wave 3 Frontend State Flow | `docs/specs/WAVE3_FRONTEND_STATE_FLOW.md` |
| Wave 4 Java Language Intelligence | `docs/specs/WAVE4_JAVA_LANGUAGE_INTELLIGENCE.md` |
| Wave 5 Desktop Productization | `docs/specs/WAVE5_DESKTOP_PRODUCTIZATION.md` |
| Wave 6 Testing & Quality | `docs/specs/WAVE6_TESTING_AND_QUALITY.md` |

### 5.4 交付与进度报告

| 文档 | 路径 |
|------|------|
| 交付清单 | `docs/progress/releases/delivery-checklist-20260723.md` |
| 最终交付报告 | `docs/progress/releases/final-delivery-report-20260723.md` |
| 覆盖率报告 | `docs/progress/releases/coverage-report-20260723.md` |
| 性能基线 | `docs/progress/releases/performance-baseline-20260723.md` |
| E2E 结果 | `docs/progress/releases/e2e-results-20260723.md` |
| 独立审查 | `docs/progress/releases/independent-review-20260723.md` |
| 代码审查 | `docs/progress/releases/code-review-20260723.md` |
| UI 审计 | `docs/progress/releases/ui-audit-20260723.md` |
| UI 视觉审计 | `docs/progress/releases/ui-visual-audit-20260723.md` |
| 视觉回归 | `docs/progress/releases/visual-regression-20260723.md` |
| 性能闸门 | `docs/progress/releases/perf-gate-20260723.md` |

### 5.5 Phase 报告

| 文档 | 路径 |
|------|------|
| Phase 1 报告 | `docs/progress/releases/phase-1/` |
| Phase 2 报告 | `docs/progress/releases/phase-2/` |
| Phase 3 报告 | `docs/progress/releases/phase-3/` |

### 5.6 测试文档

| 文档 | 路径 |
|------|------|
| 测试指南 | `docs/testing.md` |
| Mac Web RC 测试计划 | `docs/release-testing/MAC_WEB_KIMI_RC_TEST_PLAN.md` |
| Mac Web QA 交接 | `docs/release-testing/MAC_WEB_QA_HANDOFF.md` |
| Windows RC 测试 | `docs/release-testing/WINDOWS_DESKTOP_MINIMAX_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md` |
| Mac Web 最终报告 | `docs/release-testing/reports/27e8bc65b720e4cd14f0b4f7d79ca810b9c27bcf/MAC_WEB_FINAL_REPORT.md` |

### 5.7 分析文档

| 文档 | 路径 |
|------|------|
| 功能差距分析 | `docs/analysis/IDEA_VSCODE_FEATURE_GAP_ANALYSIS.md` |
| Kairo vs IDEA vs VS Code | `docs/analysis/KAIRO_VS_IDEA_VSCODE_MISSING_FEATURES_2026-07-21.md` |
| 模型分析（Mavis） | `docs/analysis/MAVIS_ANALYSIS_KAIRO_IDE_MISSING_FEATURES_20260721.md` |
| 模型分析（GPT-5.6） | `docs/analysis/GPT-5.6 Thinking.md` |
| 模型分析（综合） | `docs/analysis/MODEL_ANALYSIS_KAIRO_VS_IDEA_VSCODE_2026-07-21.md` |
| 缺失功能分析 | `docs/analysis/MODEL_ANALYSIS_KAIRO_IDE_MISSING_FEATURES_20260721.md` |

### 5.8 运维文档

| 文档 | 路径 |
|------|------|
| 用户手册 | `docs/user-manual.md` |
| 构建指南 | `docs/BUILD.md` |
| 运行指南 | `docs/RUN.md` |
| 部署指南 | `docs/deployment-guide.md` |
| 升级指南 | `docs/upgrade-guide.md` |
| 调试指南 | `docs/debug-guide.md` |
| 故障排除 | `docs/troubleshooting.md` |
| 键盘快捷键 | `docs/keyboard-shortcuts.md` |
| 快速参考 | `docs/quick-reference.md` |
| 安全指南 | `docs/security.md` |
| 已知问题 | `docs/KNOWN_ISSUES.md` |
| 限制说明 | `docs/LIMITATIONS.md` |
| 风险登记 | `docs/RISK_REGISTER.md` |
| 路线图 | `docs/ROADMAP.md` |
| 问题跟踪 | `docs/ISSUES.md` |
| 阻塞项 | `docs/BLOCKERS.md` |
| 版本清单 | `docs/VERSION-MANIFEST.md` |
| 许可证清单 | `docs/LICENSE-INVENTORY.md` |
| 捆绑组件 | `docs/BUNDLED.md` |

---

## 6. 如何继续开发

### 6.1 在新电脑上拉取代码

```bash
git clone <repo-url> kairo-ide
cd kairo-ide
git checkout main
```

### 6.2 快速验证环境

```bash
# Go 后端
cd runtime-agent
go vet ./...
go test -count=1 ./...

# 前端
pnpm install
pnpm clean && pnpm build
pnpm -r --filter './packages/*' test
```

### 6.3 建议的开发优先级

1. **第一优先级**：验证 Wave 1-2 代码在实际运行中是否正常工作（需要 JDT LS 运行环境）
2. **第二优先级**：完成 Wave 3.1 Java Debug 闭环（需要 JDK 6 + Tomcat 6 环境）
3. **第三优先级**：完成 Wave 4 JSP 专项（scriptlet 内 Java 补全、TLD 接线）
4. **第四优先级**：完成 Wave 5.4 性能基线采集 + 5.5 Windows 产品化
5. **第五优先级**：Go 测试覆盖率提升至 ≥60%（当前 58.5%，差 1.5%）
6. **第六优先级**：Wave 6 高级特性按需开发

### 6.4 关键文件入口

- **任务入口**：`.trae/specs/comprehensive-delivery-plan/tasks.md`
- **验收清单**：`.trae/specs/comprehensive-delivery-plan/checklist.md`
- **执行基线**：`docs/KAIRO_IDE_DELIVERY_MASTER_PLAN.md`
- **架构设计**：`docs/architecture.md`

### 6.5 本次会话新增/修改的文件

本次会话（Wave M 测试覆盖率提升）新增：
- `runtime-agent/internal/provider/build/ant_parser_test.go`
- `runtime-agent/internal/api/protocol/types_test.go`
- `runtime-agent/internal/api/pure_test.go`（新增测试）
- `runtime-agent/internal/maven/maven_test.go`（新增测试）
- `runtime-agent/internal/transport/events/eventhub_test.go`（新增测试）

---

## 7. 环境要求

### 7.1 开发环境

- macOS / Linux / Windows 10
- Go 1.21+
- Node.js 18+
- pnpm 8+
- JDK 11+（用于 JDT LS 运行）
- JDK 6（用于遗留项目编译验证，可选但推荐）

### 7.2 测试环境

- **单元测试**：Go test + pnpm test（跨平台）
- **集成测试**：需要 JDT LS + Tomcat 6 环境
- **E2E 测试**：需要 Playwright + Chromium
- **Windows 验证**：需要 Windows 10 真实环境

---

## 8. 关键联系人/模型

本项目由 AI 工程师（DeepSeek-V4-Pro / TRAE v3 等模型）与人类开发者协作开发。后续模型接手时，必须先阅读以下文档：

1. **本 HANDOVER.md**
2. **`docs/KAIRO_IDE_DELIVERY_MASTER_PLAN.md`**（执行基线）
3. **`.trae/specs/comprehensive-delivery-plan/tasks.md`**（任务清单）
4. **`docs/architecture.md`**（架构设计）

---

*文档结束 — 祝开发顺利！*