# Kairo IDE Visual Regression Report

**生成时间：** 2026-07-23 05:31:35
**状态：** PARTIAL

## 截图场景

| # | ID | 场景 | 文件名 | 状态 |
|----|------|------|--------|------|
| 1 | V-01 | Welcome page | `welcome-page.png` | PASS |
| 2 | V-02 | Explorer with project | `explorer-with-project.png` | PASS |
| 3 | V-03 | Search Center | `search-center.png` | FAIL |
| 4 | V-04 | Search Everywhere | `search-everywhere.png` | SKIPPED |
| 5 | V-05 | Find File popup | `find-file-popup.png` | SKIPPED |
| 6 | V-06 | Problems panel | `problems-panel.png` | SKIPPED |
| 7 | V-07 | Git Changes view | `git-changes-view.png` | SKIPPED |
| 8 | V-08 | Settings UI | `settings-ui.png` | SKIPPED |
| 9 | V-09 | Status bar | `status-bar.png` | SKIPPED |
| 10 | V-10 | Dark theme | `dark-theme.png` | SKIPPED |

## 结果汇总

- **通过：** 2
- **失败：** 1
- **未运行：** 7
- **基线截图：** 2

## 备注

首次基线运行。部分测试需要 Theia 完整运行环境（如 Search Center、Settings UI 等）。确保 Theia Browser IDE 在 http://localhost:3000 上运行后重新执行。

## 运行命令

```bash
# 首次运行（生成基线）：
node scripts/run-visual-regression.cjs --update-snapshots

# 后续运行（对比基线）：
node scripts/run-visual-regression.cjs
```

---

*报告由 `scripts/run-visual-regression.cjs` 自动生成*