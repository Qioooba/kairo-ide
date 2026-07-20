# W2 sub-agent prompt — 产品主链完整闭环

> 父任务文档：`docs/release-testing/WINDOWS_DESKTOP_MINIMAX_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md` 第 9 节（Wave 3）
> 角色：W2（产品主链 owner）
> 估计超时：45 min
> 调度前置：W0 + W1 都 PASS（NSIS 已装 + UI inventory 已知）

## 必读

1. 父任务文档第 9 节
2. W1 的 `ui-inventory.json`（已知控件清单）
3. 总协调 README

## 固定环境

| 项 | 值 |
|---|---|
| NSIS_EXE | 从 W0 done.json 取 |
| 已安装路径 | `%LOCALAPPDATA%\Programs\Kairo IDE\Kairo IDE.exe` |
| 你的工作区 | `KAIRO_QA_ROOT\w2\` |
| 测路径 | 中文空格 fixture: `C:\Users\Public\Kairo 测试\IDE\workspace\legacy-sample` |
| GBK fixture | `apps/desktop` 自带或 `bundled/sample-gbk` |

## 必须完成（按文档第 9 节 WIN-FLOW-01 到 05）

### WIN-FLOW-01 冷启动 + 首次导入
1. 启动已装 EXE，计时到 shell 可交互
2. 验证 Electron main 自启 Runtime + Theia（无外部 dev server 依赖）
3. 真实打开 Windows Folder Picker → 选 `legacy-sample`（中文路径）
4. 完成 Import Wizard 4 步（detected/not detected、select、中文项目名、保存失败重试）
5. 验证 Project selector/status bar、磁盘配置、重启后恢复

### WIN-FLOW-02 文件 + Java/JSP + 编码
1. 文件树和所有 File/Edit/View 菜单真实操作
2. 新建/保存/另存/重命名/复制/删除/撤销/重做
3. Java completion、F12/definition、diagnostics、JDT 状态、JDT 崩溃恢复
4. JSP/CSS/JS 高亮编辑、大文件模式
5. GBK fixture 打开/保存/重开/构建/HTTP（中文路径）
6. 不可表示字符阻止保存 + 换编码 BOM/CRLF 正确

### WIN-FLOW-03 Build/Deploy/Server/Logs
1. UI 点 Build，状态 idle→pending/running→succeeded，磁盘产物
2. 制造编译失败，Build View 出现真实 diagnostic，点击定位
3. Build and Deploy，Deployments View 真实状态
4. Start Server，验证 PID/port/startedAt + 进程树含 Java/Tomcat
5. Open App → 默认浏览器 → HTTP 200
6. JSP 修改→保存→部署→浏览器刷新
7. Restart: server ID 不变, PID/startedAt 更新
8. Clear Logs/selector/scroll/auto-scroll
9. Stop: 端口释放，Java/Tomcat 树清理

### WIN-FLOW-04 Desktop 生命周期
在 idle/build 中/server running/JDT running 时各测：
- File→Exit、标题栏 X、Alt+F4 (5-8s 内回收)
- taskkill 各子进程有真实错误 + 恢复
- 连续启动/退出 20 次（不残留 lock/data corruption）
- 第二实例：单实例/多实例策略
- Windows 注销/关机安全清理

### WIN-FLOW-05 升级回归
- 装上一候选版本 → 创建 workspace/project/build/server history
- 跑当前 NSIS 升级 → 数据迁移、快捷方式、runtime 资源无残留
- 升级后完整业务闭环再跑一次

## 证据

`KAIRO_QA_ROOT\w2\`
- 每个 WIN-FLOW 单独的 `<flow>.log` + `<flow>.json` (命令/状态/exitCode)
- 关键截图 `screenshots/<flow>-<step>.png`
- 录屏（可选）`videos/`
- `defects.jsonl` 追加
- `done.json` 完成报告

## done.json 必填

```json
{
  "status": "PASS|FAIL|BLOCKED",
  "elapsed_sec": 2700,
  "flows_passed": ["FLOW-01", "FLOW-02", "FLOW-03", "FLOW-04", "FLOW-05"],
  "flows_failed": [],
  "p0_defects": 0,
  "p1_defects": 0,
  "tested_commit": "<SHA>",
  "screenshots_count": 50
}
```

## 禁止

- 用 mock 文件/mock HTTP 假绿
- 跳过任何 UI 闭环
- 不重打包装验证就报告 PASS
