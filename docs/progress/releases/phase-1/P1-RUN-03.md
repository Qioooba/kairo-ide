# P1-RUN-03 浏览器端运行配置 CRUD 与轻量 UI

- 状态：implemented
- 负责人/模型：Codex Run UI Agent
- 完成时间：2026-07-23
- 依赖任务：P1-RUN-01、P1-RUN-02
- 后续任务：P1-RUN-04A（安全子集已接入）、P1-RUN-04B（完整编排）

## 目标与边界

为 `.legacyflow/run-configurations.json` 提供可发现、键盘可达的浏览器端管理界面。浏览器只调用 Runtime Agent CRUD API，并在写入前复用 `@kairo/config-schema` 严格校验；不复制 schema、不直接读写文件、不在浏览器执行 custom command。

P1-RUN-04A 已补充“按 configurationId 执行”端点。UI 只对无 before-launch task、非 custom build、exploded artifact 的可安全子集启用 Run/Debug；其他配置显示阻塞原因，不会退化调用忽略配置的 generic command。

## 用户体验

- 命令面板和 File/Open 菜单提供 `Kairo: Manage Run Configurations`，在主编辑区打开独立 Widget，不挤占现有 Servers/Builds dashboard。
- 列表展示名称、ID、默认项、Run/Debug 模式、project、HTTP/JDWP 端口。
- 支持新建、编辑、复制、删除、设为默认和刷新；删除需要确认。
- 表单覆盖项目/JDK/模式/suspend、Server、端口、context path、构建、部署、环境变量、VM options 和 before-launch tasks。
- 加载、保存、错误和逐字段 schema issue 均可见；加载/提交期间全部变更按钮禁用，客户端拒绝重复提交。
- 使用原生 `form/input/select/textarea/button/fieldset`，可 Tab 导航、Enter 提交；状态使用 `aria-live`，错误使用 `role=alert`，忙碌状态使用 `aria-busy`。
- Custom command 字段明确提示“仅保存，本版本不执行”。

## 安全与一致性

- GET/POST/PUT/DELETE 使用 `@kairo/protocol` typed endpoints、编码后的 path params 和 15 秒请求超时。
- 非幂等写入设置 `noRetry: true`，避免网络抖动造成重复创建或删除。
- 创建/编辑/复制/设默认均先把候选项合并为完整文档，再调用 `validateRunConfigurationDocument`；Runtime 响应也二次校验，非法响应不会进入 UI 状态。
- 敏感变量名（PASSWORD、TOKEN、SECRET、API_KEY 等）只允许 `${env:HOST_NAME}` 引用；明文在发请求前被拒绝。UI 不显示宿主机引用解析值，也不把 env 值写入日志或错误摘要。
- 复制会生成大小写不冲突的唯一 name 与稳定 ID，并深复制所有可变字段。
- 缺少持久化文件视为正常空列表；损坏、冲突、断线等其他错误保持可见，不静默覆盖。

## CRUD API 映射

| 操作 | Endpoint |
|---|---|
| 列表 | `GET /api/v1/workspaces/{workspaceId}/run-configurations` |
| 新建/复制 | `POST /api/v1/workspaces/{workspaceId}/run-configurations` |
| 编辑 | `PUT /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}` |
| 删除 | `DELETE /api/v1/workspaces/{workspaceId}/run-configurations/{configurationId}` |
| 设为默认 | `PUT /api/v1/workspaces/{workspaceId}/run-configurations` |

## 自动化证据

- 环境文本解析保留 `${env:...}` 引用，拒绝缺少 `=` 和重复键。
- 复制生成唯一 ID/name，且不会共享 env/options/tasks 等可变对象。
- CRUD 测试验证 typed endpoint、workspace/configuration path 参数、写操作禁止重试及响应校验。
- plaintext sensitive env 在网络调用前失败；测试确认请求次数为零。
- pending operation 期间第二次提交明确失败。
- 404 missing 文档映射为空列表，其他异常保留错误。
- Command/Composition 契约验证管理命令、菜单入口和第七个 Widget factory。
- UI 契约验证 busy/error 可访问性、Custom command 警示、安全子集判定，且不存在 generic executeCommand 退化调用。

## 测试命令与结果

- `pnpm --filter @kairo/theia-product build`：PASS。
- `pnpm --filter @kairo/theia-product lint`：PASS。
- `pnpm --filter @kairo/theia-product test`：PASS；合并 P1-RUN-04A 后基础/Run/Debug/Command 契约 50/50，Composition 6/6。
- jsdom 仍输出仓库既有的 `window.open` / Canvas not implemented 诊断，但退出码为 0，全部断言通过。

## 投产限制与 P1-RUN-04B

P1-RUN-04A 的单一 Runtime 执行端点只接收 configurationId 路径参数和期望 mode；Runtime 从受控 workspace 重新读取配置、解析 env 引用、启动 Tomcat，并返回真实 Server/JDWP 状态。浏览器不提交解析后的 secret，也不自行执行 custom command。

before-launch、custom build 和 WAR 仍需 P1-RUN-04B 编排；对应按钮保持 disabled，阻止用户误以为这些步骤会被跳过。

## 回滚

移除 Run Configurations Widget、service、factory、管理命令与测试即可；P1-RUN-01 schema 和 P1-RUN-02 Runtime CRUD 不受影响。
