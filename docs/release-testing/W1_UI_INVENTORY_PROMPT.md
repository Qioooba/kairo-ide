# W1 sub-agent prompt — Windows UI inventory + WinApp CLI harness

> 父任务文档：`docs/release-testing/WINDOWS_DESKTOP_MINIMAX_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md` 第 7 节
> 角色：W1（Windows UI 自动化 owner）
> 估计超时：30 min
> 调度前置：W0 必须 PASS（NSIS+ZIP 已就位）

## 必读

1. **父任务文档**：`G:\spaces\kairo-ide-qa\docs\release-testing\WINDOWS_DESKTOP_MINIMAX_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md` 第 7 节
2. **总协调 README**：`G:\spaces\kairo-ide-qa\docs\release-testing\ORCHESTRATION_PLAN.md`
3. **TESTED_COMMIT**：W0 done.json 中的实际 SHA
4. **NSIS 安装包路径**：W0 done.json 中的 `nsis_exe` 字段

## 固定环境

| 项 | 值 |
|---|---|
| Worktree | `G:\spaces\kairo-ide-qa\` |
| KAIRO_QA_ROOT | `C:\Users\Qi\AppData\Local\Temp\kairo-win-qa-b963e2f85c304a6abc1e962c84d50be7\` |
| 你的工作区 | `KAIRO_QA_ROOT\w1\` |
| winapp CLI | 0.4.0 已装 |

## 必须完成（文档第 7 节 7.1-7.3）

### 7.1 启动并绑定真实窗口
- `Start-Process -FilePath <NSIS_EXE_OR_INSTALLED_EXE> -PassThru`
- `winapp ui list-windows -a $app.Id`
- `winapp ui wait-for "Kairo IDE" -a $app.Id --timeout 60000`
- `winapp ui inspect -a $app.Id --interactive --json | Out-File w1/kairo-uia.json`
- `winapp ui screenshot -a $app.Id --output w1/startup.png`

### 7.2 UI inventory（动态生成 ui-inventory.json）

覆盖（每项含 accessible name / control type / AutomationId / bounds / 状态 / 预期动作 / 截图 / 实际结果）：
- NSIS 页面（如装 W0 的 NSIS）
- 主窗口系统菜单、标题、最小化/最大化/还原/关闭、resize
- Theia 菜单栏、活动栏、文件树、编辑器、panel、通知、dialog、status bar
- Import Wizard、Project Selector、Build、Deployments、Server、Logs 全部控件
- 命令面板全部 `Kairo:` 命令
- 原生文件选择/保存/确认对话框
- Open App 后的外部默认浏览器页面

`ui-inventory.json` schema：每条记录包含 name, control_type, automation_id, enabled, focusable, offscreen, bounds, action, screenshot_path, result.

inventory 与 UIA tree、DOM interactive elements 三方对账。任何无 accessible name 的交互控件为 a11y 缺陷。

### 7.3 每个控件统一操作模板
1. 读 UIA/DOM 状态和 bounds + 截图
2. Tab/Shift+Tab 定位 + 焦点截图
3. Enter/Space 一次 + `winapp ui click` 一次
4. InvokePattern 用 `winapp ui invoke`
5. 输入用键盘 + set-value
6. 验证 hover/focus/pressed/disabled/busy/success/error
7. 断言结果 UI（不只截图）
8. 控件离屏必须真实滚动

## 工具栈

```powershell
# 已装
winapp --version  # 0.4.0
winapp ui list-windows
winapp ui wait-for --timeout 60000
winapp ui inspect --interactive --json
winapp ui screenshot --output
winapp ui click --control <name>     # 优先
winapp ui click --x 100 --y 200      # Canvas 兜底
winapp ui invoke
winapp ui search --pattern <text>
```

## 证据目录

`KAIRO_QA_ROOT\w1\`
- `kairo-uia.json` — 完整 UIA tree
- `ui-inventory.json` — 控件清单
- `screenshots/<case-id>.png` — 每个控件的截图
- `winapp-actions.log` — 所有 winapp ui 命令日志
- `done.json` — 完成报告

## done.json 必填字段

```json
{
  "status": "PASS|FAIL|BLOCKED",
  "elapsed_sec": 1800,
  "ui_inventory": "w1/ui-inventory.json",
  "controls_count": 120,
  "screenshots": 60,
  "p0_a11y_defects": 0,
  "p1_a11y_defects": 0,
  "tested_commit": "<SHA>"
}
```

## 禁止

- mock UI
- 跳过 a11y 缺陷检查
- 不写 inventory 就算 PASS
