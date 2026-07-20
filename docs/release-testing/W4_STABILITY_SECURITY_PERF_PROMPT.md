# W4 sub-agent prompt — 故障/安全/性能

> 父任务文档：第 10 节（Wave 4）
> 角色：W4（稳定性/安全/性能 owner）
> 估计超时：40 min
> 调度前置：W0 PASS

## 必须完成

### 10.1 故障注入（12 项）
1. Runtime/Theia 端口瞬时占用 + 端口耗尽
2. Runtime 在 build 中退出
3. Ant/javac 缺失/超时/取消/中文路径
4. Tomcat HTTP/shutdown/debug 端口占用
5. Tomcat stop 超时后 force cleanup
6. WebSocket 断线/重连/history gap 恢复
7. config/history 文件截断/只读/磁盘满
8. JDT checksum mismatch/启动失败/crash loop
9. GBK 不可表示字符 + 文件锁定
10. Defender 扫描导致慢启动（不绕过）
11. 路径含空格/中文/接近 MAX_PATH
12. Electron 退出时 3+ 子进程

每项必须 "错误可见 + 无数据破坏 + 可恢复"。

### 10.2 安全
- Agent/Theia 只监听 loopback
- 动态 secret 不在命令行/URL/DOM/localStorage/日志/截图
- 用 CIM/Process Explorer 证明 argv/window.kairoConfig/global/DOM/storage/URL/evidence 不可读
- renderer `contextIsolation` 有效
- workspace traversal/symlink/junction escape 被拒
- 日志/文件名/Deployment 表格 HTML/脚本按文本显示（不执行 XSS）
- Open App 外链安全
- 安装/运行最小权限（不写 Program Files/HKLM 除非 per-machine）
- 卸载不删用户 workspace

### 10.3 性能 Gate（每项 5 次取 median/p95）

| 指标 | Gate |
|---|---|
| 安装版冷启动到编辑器可交互 | ≤ 8s |
| Warm start 到可交互 | ≤ 5s |
| 打开 1000 行 Java（不含首次 JDT 下载） | ≤ 1s |
| 1000 日志流下单次 UI 主线程长任务 | ≤ 100ms |
| Runtime 重连+snapshot 恢复 | ≤ 3s |
| Exit 后回收全部子进程 | ≤ 8s |
| 30 min idle | CPU/RSS/handle/WebSocket 无线性增长 |

工具：`Get-Process` + Performance Counter（CPU/WorkingSet/PrivateMemory/Handles）。相对基线回归 >15% 必须修复或书面批准。

## 证据

`KAIRO_QA_ROOT\w4\`
- `faults/<NN-name>.log` + 截图
- `security/<check>.json`（CIM/ProcessExplorer 输出）
- `perf/<metric>-<run>.json`（每 5 次）
- `perf/summary.json`（median + p95）
- `done.json`

## done.json 必填

```json
{
  "status": "PASS|FAIL|BLOCKED",
  "elapsed_sec": 2400,
  "faults_tested": 12,
  "faults_passed": 12,
  "security_checks_passed": 9,
  "perf_median": {
    "cold_start_s": 7.2,
    "warm_start_s": 4.1,
    "open_1000_java_s": 0.8,
    "ui_long_task_ms": 80,
    "runtime_reconnect_s": 2.4,
    "exit_recycle_s": 7.5
  },
  "perf_p95": {...},
  "regression_vs_baseline_pct": 5.2,
  "p0_defects": 0
}
```

## 禁止

- mock 故障（必须真触发）
- 跳过 Performance Counter 测量
- 用 `taskkill /F` 代替真实 fault 注入
