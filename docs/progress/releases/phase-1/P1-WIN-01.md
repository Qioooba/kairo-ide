# P1-WIN-01 Windows 无管理员启动与路径矩阵

- 状态：`in_progress`
- 本切片：runtime-agent Windows 原子写入与进程树回收基础修复
- 负责人：windows_portability Agent
- 更新时间：2026-07-22

## 本切片范围

本次只处理 `runtime-agent` 中可在非 Windows 主机上通过静态审计、跨平台测试和 Windows 交叉编译证明的缺口。安装器、Desktop/Browser 启动器、升级保护及真实 Windows 10 普通用户验收不在本切片中。

## 已完成

1. 修正 Windows Job Object 的 `JOBOBJECT_BASIC_LIMIT_INFORMATION` ABI 布局。旧实现把 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 写到错误偏移，不能可靠保证 Agent 退出时清理托管进程树。
2. 按 Win32 返回值判断 `SetInformationJobObject` 是否成功，不再把成功调用后未定义的 stale last-error 误判为失败。
3. 增加 Windows build-tag ABI 测试，锁定 `LimitFlags` 偏移、基础结构体大小和扩展结构体大小，防止后续重构再次破坏 native 调用。
4. 将父目录持久化同步拆分为平台实现。Unix 保留目录 `fsync`；Windows 在文件 `Sync` 与 `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` 后不再调用不可移植的目录 `File.Sync`。
5. 增加原子替换在中文、空格、多级目录和中文内容下的跨平台回归测试。

## 审计结论

| 项目 | 当前结论 | 证据边界 |
|---|---|---|
| Windows/amd64 编译 | 通过 | 全部 Go package 完成交叉编译，共生成 26 个测试 PE 文件 |
| MoveFileExW | 已修复并完成编译验证 | UTF-16 路径转换、覆盖替换、write-through 和共享冲突重试已在代码中；真实杀毒软件/文件占用干扰仍需真机注入 |
| 中文与空格路径 | 自动化测试通过 | macOS 执行跨平台原子写入测试；Windows 测试二进制编译通过，仍需 Windows 10 实跑 |
| 进程树回收 | ABI 缺口已修复 | Job Object 布局由 Windows build-tag 测试锁定；关闭 Agent 后无残留 Tomcat 必须真机验证 |
| 端口 | 现有 loopback 分配与占用测试通过 | 未发现本切片可证明的新缺口；PID/进程名诊断属于 P1-WIN-02，尚未实现 |
| 无管理员运行 | 未验证 | 代码使用 per-process Job Object 和 loopback 端口，不代表安装、启动和数据目录已通过普通用户验收 |

## 本切片验证

| 命令 | 超时 | 结果 |
|---|---:|---|
| `go test -count=1 ./internal/atomicfile ./internal/proc ./internal/tomcat6 ./internal/runtimeplan ./internal/provider/runtime` | 180 秒以内 | PASS |
| `go test -count=1 -timeout 120s ./...` | 120 秒 | PASS |
| 对 `go list ./...` 的每个 package 执行 `GOOS=windows GOARCH=amd64 go test -c` | 180 秒以内 | PASS，26 个 Windows/amd64 测试 PE |
| `git diff --check -- runtime-agent/internal/atomicfile runtime-agent/internal/proc` | 180 秒以内 | PASS |

交叉编译只证明 Windows 代码可编译及 ABI 断言可编译，不等价于 Windows 运行测试。

## 未完成 / 下一切片

1. 在 Windows 10、普通用户、2 vCPU / 4 GB RAM 环境运行全部 Windows 测试二进制。
2. 分别从英文、中文、空格和长路径启动 Desktop 与 localhost Browser；保存启动日志、耗时、进程树和退出后进程快照。
3. 验证 zip 解压即用或 per-user 安装，不写 `Program Files`、系统注册表受限位置或其他需提权目录。
4. 验证首次启动数据目录创建、已有 workspace/运行配置保留及覆盖升级不丢配置。
5. 注入 Tomcat 子进程、Agent 崩溃、文件共享锁、杀毒软件延迟和端口占用；确认关闭后无残留 Kairo/Agent/Tomcat。
6. 补齐 Desktop/Browser 启动器统一预检与可理解的恢复建议。

在以上 Windows 真机证据齐备前，P1-WIN-01 保持 `in_progress`，不得标记为 `verified`。
