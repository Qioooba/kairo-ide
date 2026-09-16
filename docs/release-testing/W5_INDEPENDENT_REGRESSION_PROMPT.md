# W5 sub-agent prompt — 独立回归审阅

> 父任务文档：第 4 节 + 第 12 节
> 角色：W5（独立回归审阅 owner）
> 估计超时：30 min
> 调度前置：W0+W1+W2+W3+W4 全部 PASS，且至少修复了所有 P0/P1

## 必须完成

**不参与首轮实现**。重新从零跑核心用例，找遗漏。

### 复跑核心
- WIN-BASE-01/02 重新跑（5 min）
- 7 项安装矩阵（25 min）
- 抽 5 项 UI 闭环（10 min）
- 抽 3 项性能 Gate（5 min）

### 找遗漏
- 读 W1 ui-inventory.json：抽 20 个控件独立复测
- 读 W4 perf：抽 3 个性能 Gate 独立复测
- 读 defects.jsonl：抽 3 个 P0 修过的 defect 重新触发

### 报告

`KAIRO_QA_ROOT\w5\`
- 复跑命令日志
- 复跑截图（每项至少 1 张）
- 遗漏清单 `omissions.jsonl`（W1-W4 漏掉的）
- `done.json`

## done.json 必填

```json
{
  "status": "PASS|FAIL",
  "elapsed_sec": 1800,
  "rerun_pass": true,
  "omissions_found": 0,
  "regression_defects": 0,
  "tested_commit": "<SHA>",
  "reviewer_signoff": "W5: <timestamp>"
}
```

## 禁止

- 不看 W0-W4 报告直接判 PASS
- 跳过任何 7 项安装矩阵
- 用 dev mode 代替安装版
