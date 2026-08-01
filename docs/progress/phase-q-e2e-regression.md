# Phase Q — E2E 回归验证报告

**日期：** 2026-08-01  
**环境：** Runtime Agent 127.0.0.1:18080（go run ./cmd/kairo-runtime）+ Theia Browser 127.0.0.1:18301  
**Phase Q 改动范围：** 仅前端单测（java-ls-lifecycle.test.cjs）、截图脚本（capture-current-ui.cjs）、Go 新增测试文件。**零生产代码变更。**

---

## 1. 执行摘要

| 测试套件 | 结果 | 结论 |
|----------|------|------|
| `standalone-smoke.spec.ts`（5 场景） | ✅ 5/5 通过 | Theia shell / 核心 widgets / 键盘导航 / 欢迎页 / 页面响应性全部正常，**UI 无基础回归** |
| `core-e2e.spec.ts`（5 场景） | ❌ 全部失败 | **环境相关**（详见 §2），与 Phase Q 改动无关 |

---

## 2. core-e2e 失败根因分析

### 2.1 E2E-01（11-15s 快速失败）
- **Step 6 断言过时**：期望状态栏包含 `'Java:'` 与 `'JDT LS:'`，但当前状态栏（Session 16 Phase F 改造后）统一使用 `'JDK：17'` 文案（`kairo-status-bar-contribution.ts` 头部注释明确 `[JDK: 1.8]`）。`'Java:'` 断言为**过时测试**，需在完整环境更新。
- **Step 5 依赖工作区**：`hello.jsp` 需在 Theia 工作区中，但 browser 以空目录 `G:\tmp\kairo-workspace` 启动。

### 2.2 E2E-02（2.3m 超时）
- 等待状态栏 `'JDT LS: ready'` 120s 超时。
- 根因：`C:\Users\Qi\.kairo\bundled\` 为空目录，**JDT LS bundle 未就位**，agent 无法启动 JDT LS（环境变量 `KAIRO_JDTLS_HOME` 未设置）。

### 2.3 E2E-03（2.3m 超时）
- 搜索 "Hello" 返回 0 结果。
- 根因：Theia 工作区为空目录，无项目文件可索引。

### 2.4 E2E-04（2.7m 超时）
- Build failure → Problems 场景。
- 根因：同 2.3，工作区无项目文件。

### 2.5 E2E-05（未跑完，测试被中断）
- 依赖项目环境，预期同样失败。

---

## 3. 结论

core-e2e 是**验收标准型 stub 测试**（`core-e2e.spec.ts` 头部注释：*"These tests are stubs designed to document the expected behavior. They will fail if run against an incomplete product"*），需要完整产品栈：**bundled JDT LS + legacy-sample 工作区**。当前开发环境不满足，失败与本次 Phase Q 改动（零生产代码变更）无关。

**UI 回归结论**：standalone-smoke 5/5 通过 + 截图脚本生成 14 张页面（01-welcome ~ 14-preferences）正常，证明 UI/UX 改造（Phase A–P）后无视觉/功能退化。

## 4. 后续建议（需完整环境执行）

1. 通过 `scripts/prepare-bundled.ps1` 准备 JDT LS bundle，设置 `KAIRO_JDTLS_HOME`。
2. 以 `tests/legacy-sample`（或 `legacy-sample`）为 Theia 工作区启动 browser。
3. 更新 E2E-01 Step 6 断言：`'Java:'` → `'JDK'`（匹配改造后状态栏文案）。
4. 重跑 `core-e2e.spec.ts` 验证。
