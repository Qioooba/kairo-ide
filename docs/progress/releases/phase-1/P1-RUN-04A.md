# P1-RUN-04A 运行配置安全执行垂直切片

- 状态：implemented
- 负责人/模型：Codex Run UI Agent
- 完成时间：2026-07-23
- 依赖：P1-RUN-01、P1-RUN-02、P1-RUN-03、P1-DBG-02A
- 后续：P1-RUN-04B before-launch/build/deploy 编排

## 安全边界

新增 `POST /api/v1/workspaces/{ws}/run-configurations/{configurationId}/launch`。请求 payload 只允许 `{ "mode": "run" | "debug" }`；未知字段、第二个顶层 JSON 值和 mode 不匹配均失败。前端不发送 ports、env、JDK home、VM options、artifact 或 custom command。

Runtime 每次执行都重新 Get 并 Validate 持久配置，随后：

1. 校验 configuration 的 project 确实属于 URL workspace。
2. 将 project root 约束在已登记 workspace root 内，并跟随/检查 symlink。
3. 把 `deploy.artifact` 作为 project-root-relative 路径安全解析；第一切片仅接受实际存在的 exploded 目录。
4. 按 `jdkRef` 从已登记 ToolchainRepo 解析 JavaHome；缺失、空值或目录不可用均失败关闭。
5. 服务端解析 `${env:HOST_NAME}`；缺失或畸形引用失败。响应和错误不返回解析值，HTTP 日志不记录请求 payload。
6. 把真实配置的 HTTP/JDWP port、context path、debug suspend、VM options、解析后 env、artifact 和 JavaHome 映射到受信 `ServerRunner.Start` plan。
7. 返回已有安全 `ServerResponse`，其中不包含 JavaHome、artifact 路径、环境变量或 CatalinaBase。

`StartServerRequest.Env` 是 `json:"-"` 的受信字段，只能由服务端 launch 规划器设置；Tomcat runner 将其传入现有 `tomcat6.Spec.Env`，没有新增 shell。

## 可执行子集与 409 规则

P1-RUN-04A 只有同时满足以下条件才启动：

- `beforeLaunchTasks` 为空；
- `build.type` 不是 `custom`；
- `deploy.mode` 为 `exploded`；
- artifact、project、workspace、toolchain 和所有 env 引用有效。

before-launch 非空、custom build 或 WAR 返回明确 409，绝不静默跳过构建/部署。浏览器使用同一静态子集判定：可执行项启用 Run/Debug；不可执行项禁用并展示具体原因。后端仍是最终授权边界。

## Debug 生命周期

浏览器 Debug 顺序固定为：

1. 先探测已批准 Java Debug Adapter；不可用则不启动 Tomcat。
2. 调用 configurationId launch，等待 Runtime 返回 ServerResponse 中真实 JDWP port。
3. 使用现有 `KairoJavaDebugService.attach` 接入原生 Theia Debug UI。
4. attach 或 JDWP 端口校验失败时停止刚启动的 Tomcat，保留原始 attach 错误。

Run/Debug 写请求均设置 `noRetry: true`，避免网络重试重复启动进程；浏览器状态锁阻止双击提交。

## P1-RUN-03 审查修复

既有配置编辑时 ID 现在为 readonly/disabled，service 同时拒绝 path ID 与 body ID 不一致；本期不实现 rename，避免 PUT 必然 400 或产生隐式复制。

## 自动化证据

- Go：安全 Debug plan 完整映射、ServerResponse 不泄露 env/JavaHome。
- Go：mode mismatch、未知 payload 字段、trailing JSON、before-launch、custom、WAR 全部拒绝且 Runner 未调用。
- Go：缺失/畸形 env 引用、project workspace 逃逸和 artifact symlink 逃逸失败关闭。
- Browser：可执行子集判断、请求只含 mode、configurationId path、noRetry、真实 JDWP attach，以及 attach 失败停止 Tomcat。
- Browser：launch 同步加锁，异步 project/Adapter preflight 期间二次点击不会产生第二个请求；成功实例立即由 `KairoServerService.adopt` 写入 ServerStore。
- Browser：编辑 ID 双层只读契约。

## 测试与已知基线

- `pnpm --filter @kairo/theia-product build`：PASS。
- `pnpm --filter @kairo/theia-product lint`：PASS。
- `go test ./internal/api -run 'RunConfiguration|DecodeRun|ResolveRun'`：PASS。
- `pnpm --filter @kairo/theia-product test`：PASS；基础/Run/Debug/Command 契约 50/50，Composition 6/6。
- `pnpm --filter @kairo/tomcat-extension test`：PASS，22/22。
- `pnpm --filter @kairo/protocol test`：PASS，17/17；`pnpm --filter @kairo/config-schema test`：PASS，23/23。
- 全量 `go test ./internal/api` 仍有既有 macOS `/var` 与 `/private/var` 临时目录字符串比较失败 `TestBuildStart_HydratesFromProject`，与本切片无关。
- 当前 `go test ./internal/services` 被并行 build-engine 改动阻塞：`build.go` 缺少 `utf8` import，且 `normalizeBuildDiagnostics` 测试签名未同步；按任务边界未修改 build engine。

## 未完成

- before-launch build/deploy、WAR 发布、custom command 的审批/沙箱执行属于 P1-RUN-04B。
- 尚未使用真实 Tomcat 6/JDK 6/Adapter 做端到端 Debug，维持 implemented，不能标记 verified。

## 回滚

移除 launch endpoint/handler、受信 Env 映射、浏览器 launch 方法和子集按钮接线；保留 P1-RUN-01～03 的 schema、CRUD 与编辑 UI。
