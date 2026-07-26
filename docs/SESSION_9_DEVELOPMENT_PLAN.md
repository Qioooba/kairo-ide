# Kairo IDE — Session 9 开发方案（1-2天持续开发计划）

> 生成时间：2026-07-24  
> 规划周期：24-48小时持续开发  
> 目标：在现有高质量基础上，完成可验证的产品闭环、修复阻塞问题、提升集成度、完善测试和审查，为真实环境验证做好全面准备  
> 适用环境：macOS（当前开发环境），Windows 兼容需保持  
> 开发模式：多 Agent 并行执行 + 独立审查 + 持续集成验证  

---

## 一、当前状态基线（Session 8 结束时）

### 1.1 已达成的质量指标

| 指标 | 当前值 | 目标 | 状态 |
|------|--------|------|------|
| Go 包测试通过 | 33/33 | 33/33 | ✅ |
| Go vet | 有 1 个编译问题（Windows 测试无 build tag） | 0 警告 | 🔧 需修复 |
| Go 覆盖率（最低） | 74.1% (remote) | ≥75% | 🔧 差 0.9pp |
| 前端测试 | 1,817/1,817 | 全部通过 | ✅ |
| TypeScript any 类型 | 0 | 0 | ✅ |
| 安全测试 | 65/65 | 0 失败 | ✅ |
| 供应链测试 | 15/15 | 0 失败 | ✅ |
| ADR 数量 | 30 篇 | — | ✅ |

### 1.2 识别出的待改进项

**P0 - 阻塞性问题（必须立即修复）：**
1. `atomicfile/coverage_boost_test.go` Windows 专用 syscall 缺少 build tag，导致 macOS/Linux 上 `go vet` 失败
2. 部分测试文件存在平台兼容性问题，需要系统性检查和修复

**P1 - 质量提升（高优先级）：**
3. remote 包覆盖率从 74.1% → 75%+（差 0.9pp，补齐即可达标）
4. 性能门禁数据需要重新采集（当前数据来自 Session 4）
5. Browser 模式真实启动流程验证（Go Agent + Theia 前端连通）
6. Desktop electron-builder 配置验证（macOS 上可验证配置正确性）
7. LSP 集成的 mock 端到端测试（不需要真实 JDT LS）
8. 核心用户旅程集成测试（导入→搜索→构建→运行）

**P2 - 功能完善（中优先级）：**
9. UI 组件五态完整性检查（正常/加载/空/错误/禁用）
10. 快捷键和 keymap 验证与补充
11. 错误处理和用户反馈增强（统一错误模型应用）
12. ui-kit/protocol/drivelist-stub 包测试补充
13. E2E 测试框架完善（mock 环境，为真实环境验证准备）

**P3 - 交付准备（收尾阶段）：**
14. 完整代码审查（独立 Agent）
15. 安全审查补充
16. 交付报告和文档全面更新
17. 最终质量门禁验证

---

## 二、开发战略与设计原则

### 2.1 核心战略

**"验证优先、闭环为王、分层测试、持续集成"**

1. **先修阻塞，再提质量**：首先解决编译/测试阻塞问题，确保基础门禁全绿
2. **从单元到集成**：在单元测试全绿基础上，构建集成测试环境
3. **Mock 先行，真实后证**：当前环境无法跑真实 JDK6/Tomcat6，先用完善的 mock 层验证架构正确性
4. **多 Agent 并行**：按模块边界拆分任务，支持 5-7 个 Agent 同时工作，互不干扰
5. **每阶段有验证**：每个 Wave 完成后立即运行门禁，不把问题留到最后
6. **可扩展性设计**：新代码遵循现有架构，便于后续接入真实环境

### 2.2 模块边界（严格遵守）

| 模块 | 职责 | 修改边界 |
|------|------|----------|
| `runtime-agent/internal/atomicfile/` | 原子文件操作 | 仅修复平台 build tag，不改变核心逻辑 |
| `runtime-agent/internal/remote/` | SSH/远程连接/文件同步 | 补充测试，提升覆盖率到 75%+ |
| `runtime-agent/internal/*_test.go` | Go 单元测试 | 修复平台兼容、补充边界测试 |
| `packages/theia-product/` | 产品壳层、UI 组件 | 五态完善、集成测试 |
| `packages/java-extension/` | LSP 桥接 | Mock LS 集成测试 |
| `packages/runtime-extension/` | Agent 连接 | WebSocket/HTTP 集成测试 |
| `tests/e2e/` | E2E 测试 | Mock 环境、测试框架完善 |
| `scripts/` | 构建/测试脚本 | 性能测试脚本、门禁脚本更新 |
| `docs/` | 文档 | 进度记录、交付报告 |

### 2.3 架构设计思路

#### 2.3.1 平台测试隔离策略

**问题**：Windows 专用测试代码在非 Windows 平台编译失败  
**解决方案**：采用标准 Go build tag 模式

```go
// coverage_boost_test_windows.go (新文件)
//go:build windows
// +build windows

package atomicfile

// Windows 专用测试放这里，使用 syscall.UTF16PtrFromString 等
```

```go
// coverage_boost_test_other.go (新文件)
//go:build !windows
// +build !windows

package atomicfile

// 非 Windows 平台只保留跨平台测试
```

**设计理由**：
- 符合 Go 标准实践（参考 `sync_dir_unix.go`/`sync_dir_windows.go` 模式）
- 不改变测试逻辑，只做平台隔离
- 便于未来新增平台专用测试

#### 2.3.2 集成测试 Mock 架构

**目标**：在没有真实 JDK6/Tomcat6/JDT LS 的环境下验证前后端集成  
**设计**：三层 Mock 架构

```
┌─────────────────────────────────────────────────────────────┐
│  E2E/Integration Tests                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Test Harness (启动真实 Go Agent + Mock 后端)        │   │
│  │  ┌──────────────┐  ┌──────────────┐                 │   │
│  │  │  Mock JDT LS │  │ Mock Tomcat  │                 │   │
│  │  │  (in-process)│  │ (in-process) │                 │   │
│  │  └──────────────┘  └──────────────┘                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │ HTTP/WS                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Real Go Runtime Agent (测试配置，端口隔离)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Frontend Test (JSDOM + Theia test container)       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**关键设计点**：
- Mock JDT LS：实现 LSP 协议子集，响应 completion/definition/diagnostics
- Mock Tomcat：实现 HTTP 端点，模拟启动/停止/部署状态
- 真实 Go Agent：使用测试配置，监听随机端口，不影响系统
- 前端测试：使用 JSDOM + Theia 测试容器，不需要真实浏览器

#### 2.3.3 性能测试基线刷新策略

**问题**：当前性能数据来自 Session 4，代码已有大量变更  
**方案**：在 macOS 上建立可复现的性能基线，Windows 数据后续补充

测量维度：
1. 冷启动时间（Go Agent 启动到 ready）
2. API 响应延迟（空项目/100文件/1000文件项目）
3. 搜索性能（ripgrep 冷/热缓存）
4. 内存占用（稳态/峰值）
5. 空闲 CPU（30秒平均）

---

## 三、Wave 划分与任务分配（适合 5-7 Agent 并行）

### Wave K：阻塞修复与基线确认（预计 1-2 小时）
**目标**：所有基础门禁变绿，为后续开发建立稳定基线

| 任务 ID | 任务描述 | 负责 Agent | 验收标准 | 依赖 |
|---------|----------|-----------|----------|------|
| K-01 | 修复 atomicfile Windows 测试 build tag 问题 | Agent 1 | `go vet ./...` 0 警告，跨平台编译通过 | 无 |
| K-02 | 系统性检查所有 _test.go 文件的平台兼容性 | Agent 1 | 所有测试在 macOS 上编译通过 | K-01 |
| K-03 | 运行全量 Go 测试，确认当前基线 | Agent 2 | `go test -count=1 ./...` 33/33 通过 | K-01 |
| K-04 | 运行全量前端测试，确认当前基线 | Agent 2 | `pnpm -r --filter './packages/*' test` 1,817+ 通过 | 无 |
| K-05 | 运行 TypeScript 类型检查 | Agent 2 | `tsc --noEmit` 0 错误 | 无 |
| K-06 | 创建 Wave K 进度记录 | Agent 1 | `docs/progress/releases/session9-wave-k.md` 完成 | K-03/K-04 |

**Wave K 完成标志**：
```bash
cd runtime-agent && go vet ./...  # 0 输出
cd runtime-agent && go test -count=1 ./...  # 33/33 PASS
pnpm -r --filter './packages/*' test  # 全部通过
tsc --noEmit  # 0 errors
```

---

### Wave L：覆盖率收尾与测试增强（预计 2-3 小时）
**目标**：所有 Go 包覆盖率 ≥ 75%，补充边界测试和故障测试

| 任务 ID | 任务描述 | 负责 Agent | 验收标准 | 依赖 |
|---------|----------|-----------|----------|------|
| L-01 | remote 包覆盖率从 74.1% → 75%+ | Agent 3 | 新增测试覆盖 SSH 隧道边界、文件同步冲突、会话超时 | Wave K |
| L-02 | ui-kit 包测试补充 | Agent 4 | 从 40 → 60+ 测试，覆盖 theme、virtual-list 边界 | Wave K |
| L-03 | protocol 包测试补充 | Agent 4 | 从 30 → 50+ 测试，覆盖 envelope、network 错误场景 | Wave K |
| L-04 | drivelist-stub 包测试补充 | Agent 4 | 维持 21 测试，补充错误路径 | Wave K |
| L-05 | 故障注入测试补充（端口占用、权限不足） | Agent 3 | tests/fault/ 测试从 24 → 40+ | Wave K |
| L-06 | 安全测试补充（路径遍历新场景） | Agent 5 | tests/security/ 维持 65+，新增边界测试 | Wave K |
| L-07 | 运行覆盖率检查，确认所有包 ≥75% | Agent 3 | 除 cmd/kairo-runtime 外所有包 ≥75% | L-01 |
| L-08 | 创建 Wave L 进度记录 | Agent 3 | `docs/progress/releases/session9-wave-l.md` 完成 | L-07 |

**L-01 详细设计（remote 包覆盖率提升）**：
- `ssh_tunnel_test.go`：补充 host key 验证失败场景、已知主机文件格式错误场景
- `file_sync_test.go`：补充大文件分片同步、校验和不匹配、权限拒绝场景
- `session_manager_test.go`：补充会话超时、并发会话创建/销毁、认证失败场景
- 目标：新增 ~15-20 个测试，覆盖率 +0.9pp 即可

---

### Wave M：Mock 集成测试环境搭建（预计 3-4 小时）
**目标**：建立不需要真实 JDK6/Tomcat6 的集成测试环境，验证前后端架构

| 任务 ID | 任务描述 | 负责 Agent | 验收标准 | 依赖 |
|---------|----------|-----------|----------|------|
| M-01 | 实现 Mock JDT LS Server（LSP 协议子集） | Agent 6 | 支持 initialize、textDocument/completion、textDocument/definition、textDocument/publishDiagnostics | Wave L |
| M-02 | 实现 Mock Tomcat Server（HTTP 管理端点） | Agent 6 | 支持 /start、/stop、/deploy、/status、logs 端点 | Wave L |
| M-03 | 编写 Go Agent 集成测试（使用 mock 后端） | Agent 6 | tests/integration/ 目录下创建，验证 API 完整流程 | M-01/M-02 |
| M-04 | 编写前端-后端 API 契约测试 | Agent 7 | tests/contract/ 新增 20+ 契约测试，覆盖核心 API | Wave L |
| M-05 | Browser 模式启动脚本测试（验证启动流程） | Agent 7 | 验证 Go Agent 能在测试端口启动，健康检查通过 | Wave L |
| M-06 | electron-builder 配置验证（macOS 打包配置检查） | Agent 7 | electron-builder --config 校验通过，配置无语法错误 | Wave L |
| M-07 | 创建 Wave M 进度记录 | Agent 6 | `docs/progress/releases/session9-wave-m.md` 完成 | M-03/M-04 |

**M-01 Mock JDT LS 详细设计**：
```go
// tests/mock/jdtls/server.go
package mockjdtls

type MockJDTServer struct {
    // 实现 LSP 协议必要方法
    Initialize(...) (...)
    Completion(...) (...)
    Definition(...) (...)
    PublishDiagnostics(...) // 主动推送
}

// 支持的场景：
// 1. 空项目（无诊断）
// 2. 有编译错误的项目（推送 diagnostics）
// 3. Completion 返回固定列表
// 4. Definition 返回位置
```

**M-03 Go Agent 集成测试场景**：
1. 启动 Go Agent（测试配置）
2. POST /api/v1/projects/import（导入 mock 项目）
3. GET /api/v1/health（健康检查）
4. POST /api/v1/search/query（搜索）
5. GET /api/v1/search/{taskId}/events（流式结果）
6. POST /api/v1/build（构建 - mock 成功/失败）
7. 验证所有响应符合 KairoTaskRef/KairoError 格式

---

### Wave N：UI 完善与前端集成测试（预计 3-4 小时）
**目标**：确保所有 UI 组件具备五态，快捷键正常，前端集成测试覆盖核心流程

| 任务 ID | 任务描述 | 负责 Agent | 验收标准 | 依赖 |
|---------|----------|-----------|----------|------|
| N-01 | UI 组件五态审计与修复（正常/加载/空/错误/禁用） | Agent 4 | 所有 widget 包含五态，新增测试验证 | Wave M |
| N-02 | 快捷键系统验证与补充 | Agent 4 | 所有 KAIRO_IDE_DELIVERY_MASTER_PLAN 中快捷键绑定正确，有 tooltip | Wave M |
| N-03 | 前端组件集成测试（Widget 间交互） | Agent 4 | theia-product 测试从 202 → 250+ | N-01/N-02 |
| N-04 | 统一错误模型前端应用 | Agent 7 | 所有 API 错误显示 userMessage，不显示原始堆栈 | Wave M |
| N-05 | Loading 状态和 Skeleton 完善 | Agent 4 | 长操作显示 loading，不阻塞 UI | N-01 |
| N-06 | Problems 视图集成测试 | Agent 4 | 验证 diagnostics 正确显示、点击跳转 | N-03 |
| N-07 | 创建 Wave N 进度记录 | Agent 4 | `docs/progress/releases/session9-wave-n.md` 完成 | N-06 |

**N-01 五态检查清单**：
| Widget | 正常 | 加载 | 空 | 错误 | 禁用 |
|--------|------|------|-----|------|------|
| 项目导入 | ✅ | ? | ? | ? | ? |
| 搜索结果 | ✅ | ? | ? | ? | ? |
| 构建视图 | ✅ | ? | ? | ? | ? |
| 服务器视图 | ✅ | ? | ? | ? | ? |
| 日志视图 | ✅ | ? | ? | ? | — |
| Debug 变量 | ✅ | ? | ? | ? | ? |
| 断点视图 | ✅ | — | ✅ | ? | ? |

（？表示需要检查和完善）

---

### Wave O：性能基线刷新与优化（预计 2-3 小时）
**目标**：重新采集性能数据，确保无性能回归

| 任务 ID | 任务描述 | 负责 Agent | 验收标准 | 依赖 |
|---------|----------|-----------|----------|------|
| O-01 | 编写 macOS 性能基线采集脚本 | Agent 3 | scripts/perf/ 目录下可复现脚本 | Wave L |
| O-02 | 采集 Go Agent 启动时间 | Agent 3 | 冷启动 ≤ 3s（仅 Agent，不含 Theia） | O-01 |
| O-03 | 采集 API 响应延迟（不同项目规模） | Agent 3 | 空项目 API P95 ≤ 50ms | O-01 |
| O-04 | 采集搜索性能（冷/热缓存） | Agent 3 | 1000 文件搜索 ≤ 1s（ripgrep） | O-01 |
| O-05 | 内存和 CPU 基线测量 | Agent 3 | 空闲 CPU < 5%，稳态内存 < 200MB（仅 Agent） | O-01 |
| O-06 | 如有性能退化，定位并修复 | Agent 3 | 性能不低于 Session 4 基线 | O-02~O-05 |
| O-07 | 更新性能门禁 JSON 和报告 | Agent 3 | `docs/progress/releases/perf-gate-20260724-s9.json` | O-06 |
| O-08 | 创建 Wave O 进度记录 | Agent 3 | `docs/progress/releases/session9-wave-o.md` 完成 | O-07 |

**性能测量方法**：
- 使用 Go testing.B 基准测试获得稳定数据
- 每个指标运行 10 次取 P50/P95
- 测试项目使用 tests/e2e/fixtures/ 下的 sample-project
- 生成可比较的 JSON 报告

---

### Wave P：独立审查与最终验收（预计 2-3 小时）
**目标**：独立代码审查、安全审查、全门禁验证、文档更新

| 任务 ID | 任务描述 | 负责 Agent | 验收标准 | 依赖 |
|---------|----------|-----------|----------|------|
| P-01 | 独立代码审查（所有 Wave K-O 变更） | Agent 8（独立审查） | `docs/progress/releases/code-review-20260724-s9.md` 无 critical/high 问题 | Wave K-O |
| P-02 | 安全审查（渗透测试思维） | Agent 5 | 无新安全漏洞，新增测试覆盖边界 | P-01 |
| P-03 | 全量门禁最终验证 | Agent 2 | 所有门禁全绿，0 失败 | P-01/P-02 |
| P-04 | 生成最终测试报告 | Agent 2 | `docs/progress/releases/test-report-20260724-s9.md` | P-03 |
| P-05 | 更新覆盖率报告 | Agent 3 | `docs/progress/releases/coverage-report-20260724-s9.md` | P-03 |
| P-06 | 更新 MILESTONES.md、ROADMAP.md、HANDOVER.md | Agent 1 | 所有文档反映 Session 9 状态 | P-03 |
| P-07 | 生成本次会话最终交付报告 | Agent 1 | `docs/progress/releases/final-delivery-report-20260724-s9.md` | P-04~P-06 |
| P-08 | 创建 Session 9 总结文档 | Agent 1 | `docs/SESSION_9_PROGRESS.md` 完成 | P-07 |

---

## 四、测试策略

### 4.1 测试金字塔（Session 9 重点）

```
      /\
     /  \     E2E/集成测试 (Mock 环境) — Wave M/N
    /----\
   /      \   契约测试/API 测试 — Wave M
  /--------\
 /          \ 单元测试（补齐覆盖率） — Wave L
/------------\
           基础门禁（先全绿）— Wave K
```

### 4.2 每轮必跑门禁（每个 Wave 结束后）

```bash
# 1. Go 静态检查
cd runtime-agent && go vet ./...

# 2. Go 单元测试（带竞态检测，每 2 小时跑一次）
cd runtime-agent && go test -race -count=1 -timeout 300s ./...

# 3. Go 覆盖率（关键节点检查）
cd runtime-agent && go test -coverprofile=coverage.out ./... && go tool cover -func=coverage.out

# 4. TypeScript 类型检查
tsc --noEmit

# 5. 前端测试
pnpm -r --filter './packages/*' test

# 6. 供应链测试（每天 2 次）
pnpm supply-chain:test

# 7. Lint
pnpm lint
```

### 4.3 测试数据和 Fixtures

- 使用 `tests/e2e/fixtures/sample-project/` 作为标准小项目
- 使用 `tests/e2e/fixtures/legacy-project/` 作为类遗留项目
- 所有测试使用临时目录，不污染工作区
- 测试端口使用动态分配（:0），避免端口冲突

---

## 五、代码审查 Checklist（P-01 必须逐项检查）

### 5.1 架构符合性
- [ ] 是否符合模块边界，没有跨模块越权修改？
- [ ] 是否有重复实现已有能力的代码？
- [ ] 前后端协议是否遵循 KairoTaskRef/KairoError 格式？
- [ ] 长操作是否支持取消、超时、进度？

### 5.2 平台兼容性
- [ ] Windows 专用代码是否有正确的 build tag？
- [ ] 路径处理是否使用 filepath 包，而非硬编码 `/` 或 `\`？
- [ ] 中文、空格、特殊字符路径是否处理正确？
- [ ] 进程树终止在 Windows/macOS/Linux 都考虑到了？

### 5.3 错误处理
- [ ] 所有错误是否都有 userMessage（用户可读）？
- [ ] 是否包含 traceId 便于排查？
- [ ] 是否区分 retryable 和非 retryable 错误？
- [ ] UI 是否显示友好错误，而非原始堆栈？

### 5.4 性能
- [ ] 是否有主线程/UI 线程阻塞操作？
- [ ] 大列表是否使用虚拟滚动？
- [ ] WebSocket 事件是否有批处理和帧率限制？
- [ ] 搜索/构建等长操作是否可取消？

### 5.5 安全
- [ ] 是否有路径遍历风险？
- [ ] 端口是否默认绑定 127.0.0.1？
- [ ] 用户输入是否正确转义/验证？
- [ ] 是否泄露敏感信息（密钥、token）到日志？

### 5.6 测试
- [ ] 新代码是否有对应单元测试？
- [ ] 是否覆盖正常路径、错误路径、边界路径？
- [ ] 测试是否稳定，不依赖时序？
- [ ] 是否有 flaky test 需要标记或修复？

### 5.7 UI/UX
- [ ] 是否具备正常/加载/空/错误/禁用五态？
- [ ] 是否有 ARIA 标签和键盘支持？
- [ ] 颜色对比度是否达标？
- [ ] Tooltip 是否显示快捷键？

---

## 六、风险与应对

| 风险 | 影响 | 概率 | 应对策略 |
|------|------|------|----------|
| 发现新的平台编译问题 | 中 | 中 | Wave K 专门系统性检查，提前发现 |
| 覆盖率提升遇到困难 | 低 | 低 | remote 包仅需 +0.9pp，容易达成；如遇困难降低目标到 74.5% 并记录 |
| Mock 集成测试复杂度超预期 | 中 | 中 | 简化 Mock 范围，先覆盖核心 API，不全量实现 LSP |
| 性能退化难以定位 | 中 | 低 | 先建立基线，有退化再用 pprof 定位，不做预优化 |
| 前端测试出现 flaky | 低 | 中 | 标记 flaky 测试，单独跟踪，不阻塞主流程 |
| 多 Agent 修改冲突 | 高 | 中 | 严格按模块边界分配任务，同一模块同一时间只有一个 Agent 修改 |

---

## 七、时间线建议（总 24-36 小时）

```
第 0-2 小时  ── Wave K：阻塞修复与基线确认
              └─ 所有门禁变绿，可以大规模开发

第 2-5 小时  ── Wave L：覆盖率收尾与测试增强
              └─ 所有包 ≥75%，测试库增强

第 5-6 小时  ── 休息/检查点：全量门禁验证，合并 Wave K-L

第 6-10 小时 ── Wave M：Mock 集成测试环境搭建
              └─ 集成测试框架可用

第 10-14小时 ── Wave N：UI 完善与前端集成测试
              └─ 前端集成测试覆盖核心流程

第 14-15小时 ── 休息/检查点：全量门禁验证，合并 Wave M-N

第 15-18小时 ── Wave O：性能基线刷新与优化
              └─ 新性能基线建立

第 18-19小时 ── 休息/检查点：全量门禁验证

第 19-22小时 ── Wave P：独立审查与问题修复
              └─ 独立审查发现问题并修复

第 22-24小时 ── Wave P：最终验收、文档更新、交付报告
              └─ Session 9 完成
```

---

## 八、成功标准（Session 9 结束时必须满足）

1. ✅ **基础门禁**：go vet、go test、pnpm test、tsc、lint 全绿，0 失败
2. ✅ **Go 覆盖率**：除 cmd/kairo-runtime 外所有包 ≥75%（remote 包不再是 74.1%）
3. ✅ **前端测试**：≥ 2,000 个测试，全部通过
4. ✅ **TypeScript**：any 类型保持 0
5. ✅ **平台兼容**：Windows 专用测试正确隔离，macOS/Linux 编译测试无问题
6. ✅ **集成测试**：核心 API 流程有集成测试覆盖（mock 环境）
7. ✅ **性能基线**：重新采集并记录，无退化
8. ✅ **代码审查**：独立审查完成，无 critical/high 问题
9. ✅ **安全**：安全测试通过，无新漏洞
10. ✅ **文档**：HANDOVER、MILESTONES、ROADMAP、SESSION_9_PROGRESS 全部更新
11. ✅ **交付报告**：最终交付报告生成，包含所有证据

---

## 九、后续 Session 准备（Session 10 预告）

Session 9 完成后，Session 10 将重点关注：
1. Windows 10 真实环境验证（需要 Windows 机器）
2. 真实 JDK6 + Tomcat6 环境下的 E2E 验证
3. 真实 JDT LS 连接和 Java 语义能力端到端验证
4. Java Debug 技术闸门验证（P1-DBG-00）
5. Desktop 打包实际构建和安装测试

Session 9 的 Mock 集成测试将为 Session 10 的真实环境验证提供架构信心和测试用例基础。

---

## 十、开始开发

**第一个 Action**：运行 Wave K，立即修复 atomicfile 的 build tag 问题，建立绿色基线。

```bash
# 开始前先确认当前状态
cd runtime-agent && go vet ./...  # 应该看到 atomicfile 的错误
# 修复后验证
```

*Wave K-L-M-N-O-P，我们开工！*
