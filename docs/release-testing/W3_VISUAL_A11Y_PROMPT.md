# W3 sub-agent prompt — 视觉 / DPI / a11y

> 父任务文档：第 8 节（Wave 2 视觉部分）
> 角色：W3（视觉/a11y/DPI owner）
> 估计超时：30 min
> 调度前置：W0 PASS + 安装版能启动

## 必须完成

### 8.1 Windows 专项 UI
- 系统标题栏、Alt+F4、最小化/最大化/Win+方向键贴靠、多显示器
- Alt 菜单助记键、Ctrl 快捷键、Tab/Shift+Tab、Enter/Space、Escape
- 原生 Open Folder/Save As/确认 dialog（中文路径、面包屑、权限拒绝）
- taskbar/start menu/AppUserModelId/重复启动策略
- 100%/125%/150% DPI、1366×768 + 1920×1080
- Light/Dark + High Contrast + 系统字体缩放 125%/200%

### 8.2 视觉与颜色 Gate
- 普通文字 WCAG AA ≥4.5:1；大文字/焦点/边界 ≥3:1
- 状态不能只靠颜色（running/error/warning/success 同时有文字/图标）
- Dark 主题：菜单/输入/select/button/link/table/scrollbar/selection/tooltip/notification 清晰
- disabled 与正文仍有可读性
- Unicode 状态图标 Windows 字体下不变彩色 emoji
- 125%/150% DPI 无 1px 裂缝/文字糊/按钮高度不足/列溢出/状态栏遮挡
- 1024×768 窗口能完成核心流程
- 截图覆盖 empty/loading/disconnected/idle/running/success/failure/long content/dialog/notification/hover/focus/disabled

### 8.3 Accessibility Gate
- `winapp ui inspect` 无交互控件空名称
- 仅键盘可完成 install→import→edit→build→deploy→start→stop→exit→uninstall
- 无 keyboard trap
- High Contrast 文字/焦点/选中/错误可见
- Narrator 抽样（启动 narrator.exe 触发）
- 200% 文本缩放无内容丢失

## 工具栈

- `winapp ui screenshot --output` 多分辨率/多主题
- DPI 切换：PowerShell 改 registry `HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows\PerMonitorDpiSettings` + 重启应用
- 主题切换：Windows 设置 / 高对比度开关
- Narrator 启动：`Start-Process narrator.exe`

## 证据

`KAIRO_QA_ROOT\w3\`
- `screenshots/<resolution>/<scale>/<theme>/<case>.png`
- `dpi/<scale>/<case>.png`
- `a11y/<case>.json`（inspect + 键盘 tab 序列记录）
- `contrast/<pair>.json`（WCAG 计算结果）
- `done.json`

## done.json 必填

```json
{
  "status": "PASS|FAIL|BLOCKED",
  "elapsed_sec": 1800,
  "dpi_covered": [100, 125, 150],
  "themes_covered": ["light", "dark", "high_contrast"],
  "resolutions_covered": ["1366x768", "1920x1080"],
  "wcag_aa_pass_rate": 0.95,
  "keyboard_completion": true,
  "narrator_pass": true,
  "p0_a11y_defects": 0,
  "p0_visual_defects": 0
}
```
