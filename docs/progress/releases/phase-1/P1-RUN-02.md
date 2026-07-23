# P1-RUN-02 运行配置安全持久化 CRUD（第一切片）

- 状态：`implemented`
- 负责人/模型：Codex release_baseline Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交（共享工作区）
- 依赖任务：P1-RUN-01

## 目标

在 Runtime Agent 中安全读写工作区级 `.legacyflow/run-configurations.json`，提供与现有 `/api/v1` 风格一致的 CRUD；本切片仅管理配置数据，不执行构建命令、Tomcat 或 Debug。

## 用户价值

运行配置可以跨 IDE 重启保存和恢复。并发保存不会丢失其他配置，磁盘损坏、工作区逃逸或无效配置会返回明确错误，而不是静默重置用户数据。

## 范围

- Go 协议镜像和严格配置验证。
- 基于 workspace ID 的 REST CRUD。
- 由已登记 workspace root 推导固定配置路径。
- 2 MiB 序列化文件上限、原子写入、0600 权限和进程内并发事务。
- 缺失、损坏、冲突、非法输入及路径逃逸错误映射。
- TS EndpointMap 补充。

## 非范围

- Search、运行配置编辑器、工具栏或 Debug UI。
- 执行 Ant/Javac/custom command、部署、Tomcat 或 DAP。
- `${env:HOST_NAME}` 的解析和注入。
- 多进程同时写同一 workspace；当前产品运行单个 Runtime Agent，仓库提供单进程并发安全。

## 实现摘要

1. 新增 Go `domain.RunConfigurationDocument`/`TomcatRunConfiguration` 镜像，并严格验证 required 字段、未知字段、版本、ID、选择项、端口、路径、环境变量、构建/部署和启动前任务。
2. TS 与 Go 统一 artifact 规则：只允许相对配置所属 project root 的 `/` 路径；持久层拒绝绝对路径、反斜杠、冒号和任意 `..` 段，执行层在验证 project/workspace 归属后解析。
3. TS 与 Go 使用相同的敏感环境变量检测范围；已知敏感名必须使用 `${env:HOST_NAME}`，不能持久化明文。
4. `RunConfigurationRepository` 复用 `pathpolicy.ResolveWithin` 与 `atomicfile.WriteFile`：
   - 文件路径固定为 `.legacyflow/run-configurations.json`；
   - 调用方不能提供磁盘路径；
   - symlink 逃逸失败关闭；
   - 写入采用同目录临时文件、fsync、原子替换和目录同步；
   - 文件权限为 0600；
   - mutex 覆盖完整读—改—写事务。
5. 单个文本字段的长度上限按 Unicode 字符数计算；完整文档的 2 MiB 上限按最终 UTF-8 JSON（含结尾换行）的字节数计算。
6. 损坏或超过 2 MiB 的现有文件返回 `conflict`，Create/Update/Delete 不覆盖损坏内容；PUT 整体文档是唯一显式修复入口。Replace/Create/Update 的待写文档若超过 2 MiB，会在原子写入前失败并完整保留原文件。
7. 删除当前选中配置后，选择第一个剩余配置；删除最后一个后 `selectedConfigurationId` 明确为 `null`。
8. custom build command 只作为数据保存，端点测试使用文件 marker 证明没有执行。

## API

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/v1/workspaces/{workspaceId}/run-configurations` | 无 | 完整文档 |
| POST | 同上 | `TomcatRunConfiguration` | 更新后文档 |
| PUT | 同上 | `RunConfigurationDocument` | 替换后文档 |
| GET | `/api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}` | 无 | 单个配置 |
| PUT | 同上 | `TomcatRunConfiguration` | 更新后文档 |
| DELETE | 同上 | 无 | 删除后文档 |

错误语义：缺失/不存在为 404，非法请求为 400，损坏/重复冲突为 409，路径越界为 403，其他 I/O 为 500 `io_error`。

## 修改文件

- `runtime-agent/internal/domain/run_configuration.go`
- `runtime-agent/internal/domain/run_configuration_test.go`
- `runtime-agent/internal/repository/run_configuration_repo.go`
- `runtime-agent/internal/repository/run_configuration_repo_test.go`
- `runtime-agent/internal/api/protocol/types.go`
- `runtime-agent/internal/api/services.go`
- `runtime-agent/internal/api/server.go`
- `runtime-agent/internal/api/run_configurations.go`
- `runtime-agent/internal/api/run_configurations_test.go`
- `runtime-agent/internal/services/run_configuration.go`
- `runtime-agent/internal/services/config.go`
- `packages/protocol/src/index.ts`
- `packages/config-schema/src/run-configuration.ts`
- `packages/config-schema/src/run-configuration.test.ts`

## 测试命令与结果

全部通过 `scripts/run-with-timeout.cjs`，单命令不超过 300 秒：

- Go domain/repository/api/services 定向测试：PASS。
- 同四包 `go test -race`：PASS，无数据竞争。
- TS protocol build/lint/test：PASS，17/17。
- config-schema lint/test：PASS，23/23。
- `go vet ./...`：PASS。
- 全量 `go test -count=1 -timeout 285s ./...`：PASS。

覆盖场景包括：CRUD、默认选择、删除选择项、缺失文件、损坏保留、超大文件读取、Replace/Create/Update 超限写入且不覆盖原文件、未知/缺失字段、路径镜像 fixture、symlink 越界、40 goroutine 并发创建、custom command 不执行及 HTTP 状态映射。

## 性能数据

- 配置数硬上限 100。
- 文件读取与 UTF-8 JSON 序列化写入硬上限均为 2 MiB。
- 定向普通测试约 2.5 秒；race 测试约 4 秒。
- 所有磁盘操作在 Agent 后端执行，不阻塞浏览器 UI 主线程。

## 风险与遗留问题

- 当前 mutex 是单 Agent 进程内锁；若未来允许两个 Agent 打开同一 workspace，需要文件锁或 revision/ETag CAS。
- PUT 整体替换当前采用 last-write-wins；UI 接入前应增加 revision 以提示跨窗口冲突。
- Runtime 执行层仍不得直接执行持久化的 custom command；后续需要独立安全审批、参数化执行和审计。
- 用户本地 override 与项目 Git 配置的合并策略仍待 ADR。

## 审查结论

第一切片代码与自动化测试已完成，等待独立审查；尚未接 UI 或真实 Run/Debug 执行，因此状态为 `implemented`。

## 回滚方式

移除新增 API 路由、store wiring、repository/domain 模块与 EndpointMap 项即可。文件格式沿用 P1-RUN-01 v1，未执行迁移或删除用户数据。
