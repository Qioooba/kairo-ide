# Wave 0 实施与验证报告

- 日期：2026-07-22
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 工作区状态：未提交，保留用户原有未跟踪文件
- 结论：首批代码切片已实现并通过本机自动化门禁；仍不具备正式投产资格

## 本波次交付

### Java 语义与生命周期

- 贯通 Hover、References、Signature Help、Document Symbols、Rename 的 Monaco → RPC → JDT LS 链路。
- Rename 遇到未支持的文件 create/rename/delete 操作时安全拒绝，不应用半份修改。
- JDT LS 崩溃最多 3 次指数退避恢复，显式 stop/workspace close 不重启。
- stop/start 串行化，`stopping` 期间禁止新启动，避免旧进程和 workspace lock 泄漏。
- initialize 60 秒硬超时，普通语义请求 30 秒硬超时；hung 进程会终止并进入可恢复状态。
- Monaco CancellationToken 已接入本地 provider；跨 RPC `$ /cancelRequest` 留待协议切片。

### 搜索

- 新增搜索会话状态模型：idle/loading/results/empty/error/cancelled。
- requestId 防止旧结果倒灌，AbortSignal 可终止 HTTP 请求。
- HTTP request context 已贯通到 Go WalkDir 和文件扫描；取消、deadline、I/O 错误分别处理。
- 非 UTF 文件改为 64 KiB 分块读取并检查 context；根目录错误不再伪装为空结果。
- listener 异常逐个隔离，不影响其他 UI 订阅者和搜索最终状态。

### Debug 技术闸门基础

- `debug` 字段真实贯通 TypeScript 协议、Go API 和 Tomcat 启动链路。
- 普通 Run 不再分配或展示 Debug 端口。
- Debug 模式注入本地 `127.0.0.1` JDWP 参数，并在返回成功前探测端口确已监听。
- Server 页面和状态栏展示真实 JDWP ready 状态，但不冒充 Debug Adapter attached。
- DAP Adapter、断点、变量和单步仍未完成，P1-DBG-00 保持 `in_progress`。

### Windows 可移植性

- 修正 `JOBOBJECT_BASIC_LIMIT_INFORMATION` ABI 布局和 Win32 返回值判断。
- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 现在写入正确字段。
- Windows 原子替换不再调用不可移植的目录 `File.Sync`；Unix 继续执行目录 fsync。
- 增加中文、空格路径以及 Windows ABI 编译断言。
- Windows/amd64 全包交叉编译通过；真实 Windows 10 仍需执行。

### 基线与供应链

- 新增跨平台 1–300 秒命令超时器；POSIX 清理进程组，Windows 使用 taskkill 并有 5 秒二级 watchdog。
- 新增机器可读基线报告入口：`pnpm baseline:release -- --output <path>`。
- CI 删除占位 checksum，依赖 URL/SHA 缺失时失败关闭。
- Linux/macOS/Windows 分别锁定 Tomcat/JDT LS 供应链条目和平台目录。
- Windows PowerShell 打包统一使用 `bundled/jdtls`，Strict 模式检查 URL、SHA、版本、许可证和 `config_win`。
- Tomcat 在所有准备脚本中统一落到运行时约定的 `bundled/tomcat6/apache-tomcat-6.0.53`，不再产生错误的扁平目录。
- `build:win` 在编译/打包前强制执行 Strict 门禁、构建 Runtime Agent、复制 Browser 产物和已验证依赖；Windows CI 使用同一路径。
- 安装包 bundled 复制采用 `tomcat6`、`jdtls` 白名单，旧目录或其他未验证目录不会进入交付物。
- Windows 发布先重新构建 Browser，随后以 strict 模式清空并复制 frontend/backend；任一输入缺失或为空都会失败，禁止复用陈旧 UI。
- Strict 依赖准备使用隔离的 `apps/desktop/bundled` staging，并始终从已核验 URL/SHA-256 的归档生成，不信任本地安装目录或仓库中的同名目录；失败路径通过 `finally` 清理临时文件。

## 独立审查

第一轮独立审查发现 5 个 P1 和 1 个 P2：

1. Debug UI 虚假 JDWP 状态。
2. JDT LS stopping/start 竞态。
3. JDT LS 请求无超时。
4. Windows bundled 路径与严格校验不一致。
5. Windows taskkill 自身可能卡死。
6. 搜索 listener 异常破坏状态机。

以上问题已逐项修改并补测试。后续复审继续发现并关闭了 Windows Tomcat 扁平复制、`build:win` 未强制 Strict、陈旧 Browser 产物可进入安装包、Strict 误信本地依赖树、失败临时目录泄漏以及 CI 后续 prebuild 覆盖已验证 staging 等问题，并增加真实构建路径与 CI 契约测试。最终只读复审未发现残留 P0、P1 或 P2。

## 最终自动化门禁

| 门禁 | 结果 |
|---|---|
| `pnpm build` | PASS，Browser 与 Desktop 构建成功 |
| `pnpm test` | PASS；Java 56/56、Search 14/14、Tomcat 11/11，其他工作区测试全部通过 |
| `pnpm lint` | PASS，0 warning |
| `go test -race -count=1 -timeout 285s ./...` | PASS |
| `node --test scripts/supply-chain.test.cjs` | PASS，15/15 |
| Desktop TypeScript build | PASS；构建前仅暂存白名单中的 2 个 bundled 目录 |
| Browser production build + strict artifact copy | PASS；22 个当前产物重新复制，陈旧目标先清理 |
| CI YAML / Desktop package JSON 解析 | PASS |
| `git diff --check` | PASS |

`theia-product` 测试仍输出仓库既有 jsdom `window.open` 未实现提示，但测试退出码为 0，18/18 与 composition 6/6 均通过；该 stderr 不作为新回归。

## 未关闭的外部与产品门禁

- 缺少用户合法 JDK 6，尚未完成真实 Java 6 编译和 JDWP attach。
- Java Debug Adapter 尚未接入，不能宣称断点、变量和单步完成。
- JDT LS 兼容版本尚未通过真实 Java 6 工程矩阵锁定。
- 当前本地 `bundled/jdtls` 为 1.55.0，供应链锁的候选正式线与许可证材料仍未收敛。
- Tomcat/JDT LS 各平台正式 URL 与 SHA-256 需人工依据官方签名链核验。
- 缺少真实 Windows 10 普通用户、2 vCPU / 4 GB 环境证据。
- Search Center 可视结果面板、真正流式 taskId 协议和替换事务尚未实现。
- 当前未执行真实 Desktop/Browser 用户旅程 E2E 和长期稳定性测试。

## 下一波建议

1. P1-JAVA-01：真实遗留工程的 JDT LS / 运行 JDK 兼容矩阵。
2. P1-DBG-01：接入 Java Debug Adapter，完成 attach 和 breakpoint E2E。
3. P1-SRCH-02：Search Center 可视结果、预览、分页/流式协议。
4. P1-RUN-01：统一运行配置模型，替换零散命令参数。
5. P1-WIN-01：真实 Windows 10 普通用户安装、路径和进程残留测试。
