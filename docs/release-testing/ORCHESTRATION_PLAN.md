# Kairo IDE Windows Desktop Release Gate — 总协调计划

> 本文件是 root 总协调 Agent（Mavis）在 2026-07-20 18:15 写下的协调 README。
> 后续 sub-agent 启动时必须先读本文件，再开始自己的工作。
> 父任务文档：`docs/release-testing/WINDOWS_DESKTOP_MINIMAX_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md`（360 行）
> 父任务分支：`agent/release-qa-two-machine`，commit `f498740`

---

## 1. 固定不变的环境基线

| 项 | 值 |
|---|---|
| TESTED_COMMIT | `b936dda1e622087f19c40281fb6740a004c5fccf` (main HEAD) |
| QA 分支 | `qa/windows-desktop-2026-07-20-b936dda` |
| Worktree 路径 | `G:\spaces\kairo-ide-qa\` |
| KAIRO_QA_ROOT | `C:\Users\Qi\AppData\Local\Temp\kairo-win-qa-b963e2f85c304a6abc1e962c84d50be7\` |
| Windows | Microsoft Windows 11 专业版, build=26200, 64-bit |
| 显示器 | 2560×1440 |
| Node | v20.18.0 |
| pnpm | 9.15.9 |
| Go | 1.23.4 windows/amd64 |
| Java/Javac | 17.0.19 |
| **winapp CLI** | **0.4.0（已装，list-windows 已验证可用）** 路径 `C:\Users\Qi\AppData\Local\Microsoft\WindowsApps\winapp.exe` |
| Playwright | 安装中（后台）日志 `G:\spaces\kairo-ide\artifacts\playwright-install.log` |
| 能力探针 | PASS（sentinel `KAIRO-RC-WIN-PROBE-181553` 已送入 Notepad 验证） |
| Baseline 文件 | `KAIRO_QA_ROOT\baseline.txt` |
| 探针证据 | `KAIRO_QA_ROOT\probe\` |

## 2. 子 Agent 角色（按文档第 4 节，6 个角色 + 总协调）

| 角色 | 负责 Wave | 必交付物 | 估计超时 | 状态 |
|---|---|---|---|---|
| **W0** 构建/安装/生命周期 | Wave 0 | 干净 build + Runtime + NSIS/ZIP + 安装矩阵 + artifact hash | 25 min | 🟡 启动中 |
| **W1** Windows UI 自动化 | Wave 1 | `ui-inventory.json` + WinApp CLI harness + Theia 控件截图 | 30 min | ⏸ 待启 |
| **W2** 产品主链 | Wave 3 | 完整 UI 闭环（导入→GBK→构建→部署→Tomcat→浏览器→日志） | 45 min | ⏸ 待启 |
| **W3** 视觉/a11y/DPI | Wave 2 视觉部分 | DPI/对比度/键盘/Narrator 报告 | 30 min | ⏸ 待启 |
| **W4** 稳定性/安全/性能 | Wave 4 | fault/perf/security 证据 + 30 min idle | 40 min | ⏸ 待启 |
| **W5** 独立回归审阅 | 复跑 | 独立签字 + 遗漏清单 | 30 min | ⏸ 待启 |

**约束（文档强制）**：
- 每个源码文件同一时间只有一个 owner
- 所有 sub-agent 使用本 worktree（`G:\spaces\kairo-ide-qa\`），但各自基于 `qa/windows-desktop-2026-07-20-b936dda` 派生 feature 分支
- 缺陷状态机：`OPEN → FIXING → FIXED_PENDING_RETEST → VERIFIED`，不得跳步
- 测试途中禁止 `pull/rebase` 偷换基线

## 3. 共享工件目录布局

```
KAIRO_QA_ROOT/
  baseline.txt
  probe/01-before.png 02-windows.txt 03-after-input.png probe.log
  artifacts/<TESTED_COMMIT前12位>/
    manifest.json
    defects.jsonl
    release-verdict.json
    windows-desktop/
      environment.txt
      artifact-hashes.txt
      install-manifest.txt
      commands/<case-id>.log
      winapp-actions.log
      ui-inventory.json
      results.json
      uia-trees/
      screenshots/<resolution>/<scale>/<theme>/
      videos/
      playwright-traces/
      logs/{installer,electron,theia,runtime,jdt,tomcat}/
      process-snapshots/
      perf/
      defects/
  w0/, w1/, w2/, w3/, w4/, w5/   # 各 sub-agent 工作区
```

## 4. 缺陷 ID 命名

- `KAIRO-RC-WIN-NNN` — Windows 专项
- `KAIRO-RC-WEB-NNN` — Web 共享
- `KAIRO-RC-SHARED-NNN` — 共享/协议层

## 5. 启动顺序

1. **W0** 先跑（构建是其他所有 wave 的前提）
2. W0 PASS 后，**W1 / W3 / W4 并行**（他们只读代码 + 跑 UI，互不干扰）
3. W1 出 UI inventory 后，**W2** 才开始完整闭环
4. 全部 P0/P1/P2 修复后，**W5** 独立回归
5. 最后 root 写 `WINDOWS_DESKTOP_FINAL_REPORT.md`，判 Gate

## 6. 监督

- Root 设 `mavis cron self` 每 10 分钟 tick
- Sub-agent 完成/卡死时主动通知 root
- 不允许同一时间多个 sub-agent 改同一文件
- 任何 sub-agent 看到 P0 缺陷立即暂停 Wave 推进，先把缺陷登记到 `defects.jsonl`

## 7. 联系方式

- Root: Mavis (mvs_62ea7bfde695456b8f8146b1057c7bff)
- 所有 sub-agent 完成时把结果写到 `KAIRO_QA_ROOT/wN/done.json`（一个文件即可）
- 卡死时写 `KAIRO_QA_ROOT/wN/stuck.json` 并停止工作
