# Kairo IDE Windows Desktop Release Gate — Final Report

> **Gate 判定：`WINDOWS_DESKTOP_GATE=FAIL`**
> 测试 commit：`b936dda1e622087f19c40281fb6740a004c5fccf`
> 分支：`qa/windows-desktop-2026-07-20-b936dda`
> 执行日期：2026-07-20 (18:14 → 18:40, 25.6 min)
> 执行机器：Windows 11 Pro build 26200, 2560×1440
> 根因：当前 main 分支代码 build/test/lint **全红**，不可能进入 NSIS 打包与真机安装阶段。

---

## 0. 结论（先看这里）

**`WINDOWS_DESKTOP_GATE=FAIL`**。W0 在 25 min 硬性时限内只完成了 11/13 个静态/构建 gate，**全部 11 项 exit≠0**。NSIS 安装包未生成、真实安装/升级/卸载矩阵 0/7 执行。P0 缺陷 13 个。

**根因集中在 3 个具体可修点上**（见 §3），不是设计性问题，是历史 merge 残留 + 模块路径配置错误。**修复后预计 1–2 小时可重启全流程**。

---

## 1. 总协调执行摘要

| 阶段 | 状态 | 备注 |
|---|---|---|
| 文档定位 | ✅ | `agent/release-qa-two-machine` 分支 `f498740` 上的 `docs/release-testing/WINDOWS_DESKTOP_MINIMAX_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md`（360 行）已读 |
| 环境探针 | ✅ | node v20.18 / pnpm 9.15.9 / go 1.23.4 / jdk 17.0.19 / winapp CLI 0.4.0 / winget 1.29.280 |
| 独立 worktree | ✅ | `G:\spaces\kairo-ide-qa\` on `qa/windows-desktop-2026-07-20-b936dda`（不动主仓库 `G:\spaces\kairo-ide\`） |
| Baseline | ✅ | `KAIRO_QA_ROOT\baseline.txt` |
| 2 分钟能力探针 | ✅ | sentinel `KAIRO-RC-WIN-PROBE-181553` 真送进 Notepad 验证，3 张前后截图保存 |
| 总协调 README | ✅ | `G:\spaces\kairo-ide-qa\docs\release-testing\ORCHESTRATION_PLAN.md` |
| W0 sub-agent | 🟡→STOP | 25.6 min 强制 task_stop，所有 gate red |
| W1/W2/W3/W4 | ❌ 取消 | 前提（build+NSIS）不成立，无意义调度 |
| W5 独立回归 | ❌ 取消 | 同上 |

---

## 2. WIN-BASE-01/02 全部 gate 实测结果

| # | Gate | Exit | 证据 |
|---|---|---|---|
| 01 | `pnpm install --frozen-lockfile` | 0 | `w0\logs\01-install.log` (23 KB) |
| 02 | `pnpm build` | **2** | `w0\logs\02-build.log` |
| 03 | `go vet ./...` | **1** | `w0\logs\03-go-vet.log` |
| 04 | `go test -count=1 -timeout 300s ./...` | **1** | `w0\logs\04-go-test.log` |
| 05 | `pnpm lint` | **1** | `w0\logs\05-lint.log` |
| 06 | `node --test tests/contract/contract.test.cjs` | **1** | `w0\logs\06-contract.log` |
| 07 | `node --test tests/contract/eventstream.test.cjs` | **1** | `w0\logs\07-eventstream.log` |
| 08 | `node --test tests/fault/fault-injection.test.cjs` | **1** | `w0\logs\08-fault.log` |
| 09 | `node --test tests/perf/perf-baseline.test.cjs` | **1** | `w0\logs\09-perf.log` |
| 10 | `pnpm test` | **1** | `w0\logs\10-pkg-test.log` (40 KB) |
| 11 | `go build -trimpath -o bin\kairo-runtime.exe` | **1** | `w0\logs\11-go-build.log` |
| 12 | `node --test packages/tomcat-extension/...` | 未完成 | `w0\logs\12-tomcat.log` (W0 被强停时正在跑) |
| 13 | 编码/搜索 package test | 未启动 | — |

**结论：0/13 全绿。W0 不是卡死，是 build 根本不能过，他只能在每个 gate 跑完拿到 exit code 后才往下推。**

---

## 3. 三大根因（开发者可直接照着修）

### 3.1 [KAIRO-RC-WIN-001/004/011] 严重：Git merge 冲突标记未解决

**文件**：`packages/theia-product/src/main/browser/kairo-product-frontend-module.ts`，第 98/123/128 行

**问题**：
```ts
<<<<<<< HEAD
  // KairoFileCommandsContribution is a defensive re-registration ...
  bind(KairoFileCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoFileCommandsContribution);
=======
  bind(KairoLargeFileContribution).toSelf().inSingletonScope();
  ...
>>>>>>> origin/main
```

**为何 fatal**：
- `tsc -p tsconfig.json` → `error TS1185: Merge conflict marker encountered` (line 98, 123, 128) → exit 2
- `pnpm lint` → `Parsing error: Merge conflict marker encountered` (98:0) → exit 1
- 这两个错误让 `pnpm build` 和 `pnpm lint` 全挂

**为何出现**：
- 文档第 3 节警告："前一远程基线 `98ba2a3` 曾在正式 frontend module 中提交未解决的 Git 冲突标记；当前审计基线 `8add5b8` 已移除该标记"
- 8add5b8 确实移除了，但**最新一次 merge (b936dda)** 又把它带回来了
- 推测是有人把 98ba2a3 之前的分支 rebase 进了 main

**修复（5 分钟）**：
1. 决定保留哪一侧（看注释，HEAD 侧的 `KairoFileCommandsContribution` 是有意义的"防御性重新注册 file.*/workspace:*/core.* 命令"，**建议保留 HEAD 侧**）
2. 删除 `<<<<<<< HEAD` / `=======` / `>>>>>>> origin/main` 三行
3. `git add` + `git commit --fixup` 或 `git commit -m "fix(theia-product): resolve merge conflict in kairo-product-frontend-module"`
4. 重新跑 `pnpm build && pnpm lint` 验证

### 3.2 [KAIRO-RC-WIN-002/003/010] 严重：Go module 路径引用不存在的 GitHub repo

**文件**：`runtime-agent/go.mod` 第 1 行

**问题**：
```
module github.com/kairo-ide/runtime-agent
```

**实际错误**：
```
internal/api/services.go:9:2: cannot find module providing package
github.com/kairo-ide/runtime-agent/internal/build:
git ls-remote -q origin in ...\vcs\b845e796...: exit status 128:
  remote: Repository not found.
  fatal: repository 'https://github.com/kairo-ide/runtime-agent/' not found
```

**为何 fatal**：
- `github.com/kairo-ide/` 这个 GitHub organization 根本不存在（kairo-ide 仓库在 `Qioooba/kairo-ide`）
- Go 1.22+ 在 build 时会尝试拉所有内部包，**所有** Go 命令（vet/test/build）全挂
- 文档第 3 节警告："CI 中存在旧路径、占位 checksum"

**为何出现**：
- `runtime-agent` 本来是 kairo-ide 仓库的子目录，go.mod 不应该用自引用 module path
- 早期开发时可能想拆成独立 repo，go.mod 写了占位 module 路径

**修复（10 分钟）**：
方案 A（推荐，保留 monorepo）：
```diff
- module github.com/kairo-ide/runtime-agent
+ module github.com/Qioooba/kairo-ide/runtime-agent
```
然后 `cd runtime-agent && go mod tidy`，再把所有 import 里的 `github.com/kairo-ide/runtime-agent/...` 替换为 `github.com/Qioooba/kairo-ide/runtime-agent/...`。

方案 B（拆成独立 repo）：先在 GitHub 创建 `kairo-ide/runtime-agent` organization（需要组织所有者权限），再 push 子目录。

**注意**：方案 A 改完 module 路径后，**所有 Go 代码的 import 路径都要同步改**（services.go、domain 等），估计要 `go mod tidy` 一次性解决。

### 3.3 [KAIRO-RC-WIN-005~010/12/13] 中等：测试 glob / 依赖问题

**症状**：
- `packages/jsp-extension` 跑 test 时报：`Could not find 'G:\spaces\kairo-ide-qa\packages\jsp-extension\src\browser\*.test.cjs'`
  - `*.test.cjs` glob 在 PowerShell 子进程 / Node `--test` 不同 shell 下展开行为不同
- `packages/runtime-extension` test 全过（14/14）但有 agentSecret header 相关
- 其他 package 也有 lint warning（unused vars，但 max-warnings=0 让它 exit=1）

**修复**：
- 把 `*.test.cjs` 改成显式列文件，或者用 `find` / `Get-ChildItem` 在 pnpm test 脚本里预处理
- 删 unused var 或加 `_` 前缀
- 这些都是小修，**不算阻断**，但要让 max-warnings=0 通过

---

## 4. 缺陷清单（13 P0）

完整定义见 `KAIRO_QA_ROOT\artifacts\b936dda\defects.jsonl`。

| ID | Gate | Title | Level |
|---|---|---|---|
| KAIRO-RC-WIN-001 | 02-pnpm-build | pnpm build 失败（exit=2） | P0 |
| KAIRO-RC-WIN-002 | 03-go-vet | go vet 失败（exit=1） | P0 |
| KAIRO-RC-WIN-003 | 04-go-test | go test 失败（exit=1） | P0 |
| KAIRO-RC-WIN-004 | 05-pnpm-lint | pnpm lint 失败（exit=1） | P0 |
| KAIRO-RC-WIN-005 | 06-contract | contract.test.cjs 失败 | P0 |
| KAIRO-RC-WIN-006 | 07-eventstream | eventstream.test.cjs 失败 | P0 |
| KAIRO-RC-WIN-007 | 08-fault | fault-injection.test.cjs 失败 | P0 |
| KAIRO-RC-WIN-008 | 09-perf | perf-baseline.test.cjs 失败 | P0 |
| KAIRO-RC-WIN-009 | 10-pkg-test | pnpm test 失败（exit=1） | P0 |
| KAIRO-RC-WIN-010 | 11-go-build | go build 失败（exit=1） | P0 |
| KAIRO-RC-WIN-011 | tsc-pnpm-exec | tsc --noEmit pnpm exec 失败 | P0 |
| KAIRO-RC-WIN-012 | WIN-BASE-02 | build:win NSIS+ZIP 未生成 | P0 |
| KAIRO-RC-WIN-013 | WIN-BASE-03 | 安装/升级/卸载矩阵 0/7 执行 | P0 |

**注意：1, 4, 11 三个 ID 都由根因 3.1（merge 冲突）造成；2, 3, 10 三个 ID 由根因 3.2（go.mod 路径）造成。** 修好两个根因，9 个 P0 自动消失。其余 4 个（005/006/007/008/009）需要单独看 log，但应该都被 3.1/3.2 间接影响。

---

## 5. 修复后下一步（重启全流程）

修复完 3.1 + 3.2 后：

1. 在 main 上 commit 修复，广播新 SHA 给 Mac 同步
2. 在 worktree `qa/windows-desktop-2026-07-20-b936dda` 上 `git pull main`（保持 worktree 不动 main HEAD），或新建 `qa/windows-desktop-<date>-<newsha>` worktree
3. **重派 W0 sub-agent**（25 min 上限，相同 prompt），目标：`done.json: status=PASS`
4. W0 PASS → 派 W1（UI inventory + WinApp harness，30 min）+ W3（视觉/a11y，30 min）+ W4（故障/安全/性能，40 min）并行
5. W1 出 `ui-inventory.json` → 派 W2（产品主链闭环，45 min）
6. 全部 PASS → 派 W5（独立回归审阅，30 min）
7. root 写新 FINAL_REPORT，判 `WINDOWS_DESKTOP_GATE=PASS`

---

## 6. 证据索引

| 类型 | 路径 |
|---|---|
| 总协调 README | `G:\spaces\kairo-ide-qa\docs\release-testing\ORCHESTRATION_PLAN.md` |
| 本报告 | `G:\spaces\kairo-ide-qa\docs\release-testing\reports\b936dda\WINDOWS_DESKTOP_FINAL_REPORT.md` |
| W0 全部日志 | `C:\Users\Qi\AppData\Local\Temp\kairo-win-qa-b963e2f85c304a6abc1e962c84d50be7\w0\logs\` |
| 缺陷 JSONL | `KAIRO_QA_ROOT\artifacts\b936dda\defects.jsonl`（13 entries） |
| 释放判定 | `KAIRO_QA_ROOT\artifacts\b936dda\release-verdict.json` |
| Baseline | `KAIRO_QA_ROOT\baseline.txt` |
| 能力探针 | `KAIRO_QA_ROOT\probe\probe.log` + 3 张截图 |
| W0 阻塞原因 | `KAIRO_QA_ROOT\w0\stuck.json` |
| Worktree | `G:\spaces\kairo-ide-qa\` |
| 主仓库（未动） | `G:\spaces\kairo-ide\`（main 上 M 标记的本地修改保留） |

---

## 7. 双签字

- [ ] Root 总协调 Agent (Mavis, mvs_62ea7bfde695456b8f8146b1057c7bff)：✅ FAIL 已签发，证据完整
- [ ] 独立回归 Agent (W5)：❌ 未执行（前提不成立，跳过）

**Gate 决议**：`WINDOWS_DESKTOP_GATE=FAIL`
**修复负责**：产品负责人 / 代码 owner
**重启条件**：3.1 + 3.2 修复并 push 新 SHA 后，重派 W0。
