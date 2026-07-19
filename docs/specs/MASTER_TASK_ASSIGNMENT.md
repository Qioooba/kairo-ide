# Kairo IDE — 总任务分配与多 Agent 协调文档

> 文档用途：多 Agent 并行开发的唯一协调基线  
> 创建日期：2026-07-19  
> 目标读者：所有执行开发的 AI Agent  
> 前置阅读：`docs/product-requirements.md`、`docs/REARCHITECTURE_AND_IMPLEMENTATION_PLAN.md`、`docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md`

---

## 0. 强制指令（所有 Agent 必须遵守）

1. **先读本文档 + 自己负责的 Wave 文档，再动手。**
2. **先写/修会失败的验收测试，再改实现。** 红 → 绿，不是绿 → 更绿。
3. **不允许 `t.Skip`、`gated`、`.catch(() => [])`、`_ = err` 关闭核心验收。**
4. **修改文件前必须先 `Read` 确认当前内容。** 不要假设文件状态。
5. **每个 Agent 在自己的分支上工作**，完成后提交 PR，由 Integration Lead 合并。
6. **不得在同一 PR 同时更换 persistence、protocol、UI 和 JDT lifecycle。**
7. **涉及路径删除/覆盖时，先 resolve canonical target，再验证 authorized root，再执行。**
8. **核心业务不得在 handler 里直接操作文件和进程。**
9. **禁止保留 `_ = os.WriteFile`、`json.RawMessage` service contract、`.catch(() => [])`。**
10. **每个 PR 给出：变更范围、旧行为、目标行为、迁移方式、测试证据、已知未完成。**

---

## 1. Agent 角色分配

| 角色 | 负责 Wave | 主要职责 | 禁入区域 |
|------|-----------|----------|----------|
| **Integration Lead** | 全局协调 + Wave 0 Gate | 基线修复、架构决策、合并、Gate 验证、文档状态 | 不接受口头完成声明 |
| **Agent A — Backend Core** | Wave 1 + Wave 2 | domain/app/repository/plan resolver/composition root/API handlers | 不改前端 UI |
| **Agent B — Runtime Providers** | Wave 2 | Ant/Javac/Deploy/Tomcat/process/events | 不自行改变 wire protocol |
| **Agent C — Protocol & Frontend** | Wave 3 | protocol、runtime connection、active project、stores、widgets、Import Wizard | 不绕过 Agent 执行本地文件操作 |
| **Agent D — Java & Desktop** | Wave 4 + Wave 5 | Theia backend JDT、Desktop host、preload、安全配置、打包 | 不实现 Remote/DAP |
| **Agent E — QA & Evidence** | Wave 6 | unit/contract/integration/Playwright/Windows/docs evidence | 不复制生产逻辑造测试 |
| **Agent F — Code Cleanup** | 跨 Wave | 死代码删除、包合并、文件重组 | 不删还有 caller 的代码 |

---

## 2. 并行规则

```
Wave 0: Integration Lead + Agent E 完成（其他 Agent 只读审计）
  ↓ Gate 通过
Wave 1: Agent A 独立完成（protocol 冻结前 Agent C 不修改 EndpointMap）
  ↓ Gate 通过
Wave 2: Agent A + Agent B 并行（Agent A 负责 use case 层，Agent B 负责 provider 层）
  ↓ Gate 通过
Wave 3: Agent C 独立完成（基于 Wave 2 冻结的 API contract）
  ↓ Gate 通过
Wave 4: Agent D 独立完成（Java 部分）
  ↓ Gate 通过
Wave 5: Agent D 独立完成（Desktop 部分）
  ↓ Gate 通过
Wave 6: Agent E + Agent F 并行
  ↓ Gate 通过
→ v1 Release Candidate
```

**关键约束：**
- composition root 只能由 Agent A 修改，Integration Lead 审核
- protocol 只能由 Agent C 修改；后端 handler DTO 由 Agent A 根据冻结契约实现
- 每个 Wave 合并后全量 Gate；未通过不得进入下一 Wave

---

## 3. 各 Wave 文档索引

| Wave | 文档 | 负责 Agent | 预计工作量 |
|------|------|-----------|-----------|
| 0 | `docs/specs/WAVE0_BLEEDING_FIXES.md` | Integration Lead + Agent E | 2-3 天 |
| 1 | `docs/specs/WAVE1_BACKEND_ARCHITECTURE_CONVERGENCE.md` | Agent A | 5-7 天 |
| 2 | `docs/specs/WAVE2_BUILD_DEPLOY_RUN_CLOSED_LOOP.md` | Agent A + Agent B | 7-10 天 |
| 3 | `docs/specs/WAVE3_FRONTEND_STATE_FLOW.md` | Agent C | 5-7 天 |
| 4 | `docs/specs/WAVE4_JAVA_LANGUAGE_INTELLIGENCE.md` | Agent D | 5-8 天 |
| 5 | `docs/specs/WAVE5_DESKTOP_PRODUCTIZATION.md` | Agent D | 5-8 天 |
| 6 | `docs/specs/WAVE6_TESTING_AND_QUALITY.md` | Agent E | 4-6 天 |
| — | `docs/specs/CODE_CLEANUP_GUIDE.md` | Agent F | 跨 Wave |
| — | `docs/specs/TARGET_ARCHITECTURE.md` | 所有 Agent 参考 | — |
| — | `docs/specs/API_CONTRACT_SPEC.md` | Agent A + Agent C | — |
| — | `docs/specs/ENCODING_SAFETY_SPEC.md` | Agent A + Agent C | — |

---

## 4. 每个 Wave 的 Gate 条件

### Wave 0 Gate
- [ ] `go test -count=1 ./...` 全绿
- [ ] `go vet ./...` 全绿
- [ ] `pnpm clean && pnpm build && pnpm test && pnpm lint` 全绿
- [ ] MILESTONES 不再包含已知虚假声明
- [ ] 核心 integration 不 skip

### Wave 1 Gate
- [ ] `main.go` 不再调用 `NewMemoryServices` 作为业务主干
- [ ] `json.RawMessage` 不出现在 app 层
- [ ] ProjectID 与路径完全分离（有测试证明）
- [ ] `.kairo/project.yaml` 是唯一配置真相
- [ ] 打开 sample → 导入 → 重启 IDE → 项目仍可解析

### Wave 2 Gate
- [ ] import legacy-sample → Ant build success → deploy → Tomcat start → HTTP 200
- [ ] 修改 JSP → deploy webapp → HTTP 看到修改
- [ ] restart → PID 变化且 HTTP 恢复
- [ ] stop → 进程确认消失
- [ ] 重启 Agent → history 仍可查询

### Wave 3 Gate
- [ ] Import Wizard 保存后无需 reload 即可 Build
- [ ] 多项目选择持久化
- [ ] Runtime 断开时显示 disconnected，不显示 "0 servers"
- [ ] Restart command 调用 restart endpoint
- [ ] event socket 每 workspace 为 1

### Wave 4 Gate
- [ ] 打开 `HelloServlet.java` → 收到 diagnostics
- [ ] 输入触发 completion（含真实 Java/项目 symbol）
- [ ] F12/definition 跳转到项目内真实定义
- [ ] 关闭 workspace → JDT 进程退出
- [ ] 再打开可重新启动

### Wave 5 Gate
- [ ] 双击 Desktop artifact 可启动
- [ ] UI 完成 import/build/deploy/start/restart/stop
- [ ] 请求有 secret，错误 secret 得 401
- [ ] 退出后 Agent/Tomcat/JDT 无残留
- [ ] Windows + macOS 各至少一份证据

### Wave 6 Gate
- [ ] 所有核心 Gate 通过
- [ ] E2E core step 无 gated
- [ ] 8 个以上故障注入场景通过
- [ ] 性能指标在目标范围内
- [ ] 所有文档与代码一致

---

## 5. Definition of Done（每个功能验收标准）

每个功能必须同时满足：
1. typed contract（强类型接口和协议一致）
2. use-case test（use case 层有测试）
3. 错误/取消/重启路径有测试
4. sandbox/授权检查
5. UI 可观察反馈
6. 不吞错
7. 文档状态更新并链接证据
8. 至少一个真实 E2E 证明
9. Windows 路径/进程差异有覆盖（若功能涉及）
10. 无新增无限内存/history/DOM 增长

---

## 6. 禁止模式清单

- 核心能力不得 `t.Skip` 或 `gate` 后仍算绿色
- 不得只搜索源码字符串证明命令已实现
- 不得 `.catch(() => [])` 后断言空列表
- 不得用 mock 后端证明真实协议兼容
- 不得只断言 HTTP 200，不验证业务 state 和磁盘/进程副作用
- 不得在 release report 手工粘贴旧测试数字作为当前证据
- 不得新增动态插件、数据库、状态管理框架或虚拟列表依赖（除非有基准/真实第二用例）
- 不得用 placeholder/gated/skip 关闭核心验收
- 不得保留 `_ = os.WriteFile`、`json.RawMessage` service contract
- 不得新增 `internal/platform/hostsupervisor.go` 这类死代码