# Kairo IDE 架构重审、推倒重做与开发实施方案

> 文档状态：建议作为下一轮开发的唯一实施基线  
> 评审日期：2026-07-18  
> 适用仓库：`kairo-ide` 当前工作树  
> 目标读者：产品负责人、架构师、实现本方案的 AI / 工程师  

---

## 0. 执行摘要

Kairo IDE 的产品方向是成立的：面向 JDK 6、Tomcat 6、Servlet/JSP、GBK/GB18030 项目的轻量维护工具，有清晰用户和真实痛点。Theia 负责编辑器体验、Go Agent 负责遗留运行时操作，这个一级架构也不需要推翻。

当前不能继续按“补几个页面、换 SQLite、做虚拟滚动”的方式迭代。真正的问题是主业务链没有闭环，文档、协议、前端和后端各自实现了不同的系统：

```text
UI 只发送 projectId
        ↓
协议声称 Agent 会解析项目并执行 Build / Deploy / Run
        ↓
Agent 实际要求 UI 传绝对路径、JDK、classpath、输出目录、webapp、端口
        ↓
ProjectStore 又没有从扫描结果创建项目，也没有以 project.yaml 为唯一真相
        ↓
Build / Deploy / Run 从产品 UI 无法完成真实闭环
```

另外，当前工作树的 Go 主程序无法编译，事件流没有实现，远程模式没有认证，Desktop/Server 两个入口仍是壳，JDT LS 的进程生命周期存在会让进程启动后立刻被取消的错误。现有测试没有拦住这些问题。

### 最终建议

1. **保留 Theia + Go Agent。** 不重写编辑器、不把后端改成 Node-only、也不自研 IDE 内核。
2. **推倒重做业务编排层和 API 契约。** 客户端只提交 `workspaceId/projectId` 和用户意图；路径、工具链、构建方式、部署目标全部由 Agent 从强类型项目模型解析。
3. **v1 只承诺 Desktop + localhost Browser。** Remote Server 暂停发布并默认 fail-closed，等 Theia 和 Agent 两侧的统一认证、授权、隔离完成后再恢复。
4. **删除动态 LegacyFlow Runtime Plugin 设计。** 保留 Go 内部静态 Provider 接口，不建设第三方插件协议、权限沙箱、市场或子进程 JSON-RPC。
5. **不在当前阶段切 SQLite。** 先消除双数据源并实现原子、可恢复、带版本的文件存储；真正启动多用户 Server 后再用指标决定是否迁移 SQLite。
6. **不做“按时间戳只编译变更 Java 文件”。** 这对类型依赖和常量内联不安全。v1 优先正确实现 Ant Provider，raw javac 保持全量编译；后续用真实基准决定是否做依赖感知增量编译。
7. **JDT LS 改由 Theia backend 持有 LSP 会话。** 删除 Browser → Go WebSocket → stdio 的自定义 LSP 桥；Go 仅负责工具链/发行物准备和项目模型解析。
8. **先重建验收门禁，再扩展功能。** P0 主链 E2E 不允许 `skip`、`gated` 或 `.catch(() => [])`。

预计重构到“可真实使用的桌面 v1 基线”为 **30–45 工程日**。如果同时实现 Remote Server 多用户安全、完整 DAP 调试和 class HotSwap，需额外 **20–35 工程日**，不应混入同一里程碑。

---

## 1. 评审范围与证据

本评审交叉检查了：

- Go Agent 的 API、services、build、deploy、search、encoding、sandbox、Tomcat、JDT LS、toolchain、audit；
- Theia 产品组合、Runtime Client、Project/Java/Tomcat/Search/Encoding 扩展、UI Kit；
- Browser、Desktop、Server 三个入口；
- `packages/protocol` 和 Go 协议镜像；
- PRD、architecture、security、RUN、testing、MILESTONES、BLOCKERS、9 个 ADR；
- GitHub Actions、Go integration、API smoke、UI E2E 和前端单元测试；
- 当前工作树实际构建结果。

### 当前实测基线

| 检查 | 结果 | 结论 |
|---|---|---|
| `go test -count=1 ./...` | 失败 | `tomcat6.go` 与 `tomcat6_unix.go` 重复定义 `isAlive`，主程序和多个包不能构建 |
| `pnpm -r --filter './packages/*' build` | 通过 | TypeScript 静态构建可通过 |
| Runtime Client tests | 38/38 | 仅证明客户端拼 URL、封装 envelope、处理错误，不证明后端契约存在 |
| Encoding tests | 9/9 | 测试接受“GBK 支持依赖引擎”，没有识别浏览器 `TextEncoder` 永远只编码 UTF-8 的设计错误 |
| Command tests | 2/2 | 只检查命令常量和注册文本，不执行命令业务 |
| Go integration CI | 会跳过 | CI 未设置 `KAIRO_LEGACY_SAMPLE`，测试入口第一步 `t.Skip` |
| UI full-chain | 核心步骤可 gated | 没有项目时 Build/Start 仍可计为“命令已调用”，不能证明闭环 |

因此，仓库当前不能被描述为“核心功能已完成、只有优化项”。更准确的状态是：**底层能力已有不少可复用实现，但产品编排和可交付入口仍处于原型期。**

---

## 2. 对外部分析报告的逐项裁决

### 2.1 接受并提高优先级的结论

| 外部结论 | 裁决 | 调整后的处理 |
|---|---|---|
| `json.RawMessage` 导致服务层无类型安全 | 接受 | 升为 P0；HTTP 边界之外不得出现 `json.RawMessage` / `any` DTO |
| `RESTART_SERVER` 只 stop | 接受 | P0 Bug；但不能只补一行 start，需由后端实现原子 Restart 用例 |
| `canEncode` 逻辑错误 | 接受 | P0 数据安全 Bug；目标编码能力校验必须放到 Go 端或使用可靠 codec |
| `projects[0]` | 接受 | P0 产品模型缺失；引入 Active Project Context，不在每个命令里临时选第一项 |
| 假认证和 CSRF 文档矛盾 | 接受 | 严重程度提高：`RequireAuth` 当前根本没有接入 middleware，远程模式必须停发 |
| deploy 缺少 sandbox | 接受 | 严重程度提高：build clean、deploy mirror、server webapp 等多个路径入口均可越界 |
| 协议生成/一致性检查不存在 | 接受 | P1；先建立契约测试，不立刻引入复杂生成器 |
| 品牌 token 与 CSS 分裂、强制暗色 | 接受 | P2；重写为真实 Theia Theme + 小量组件 CSS |
| 文档与代码大量不一致 | 接受 | P0；MILESTONES/DELIVERY 不能再把 scaffold 写成 done |
| 欢迎页/导入向导缺失 | 接受 | P0；它同时承担创建 canonical project config 的职责 |
| DAP 和 Java 编辑器集成未完成 | 接受 | DAP 放 v1.1；Java LSP 是桌面 v1 必须完成 |

### 2.2 结论部分正确，但方案需要修正

#### “日志 innerHTML 必须换 react-virtuoso”

问题真实存在：每条日志重建最多 5000 行 DOM，低配机器会卡顿。问题不在所有 `innerHTML` 都不可用——Build/Deployment 最多 50 行，优先级较低。也不需要为此立即引入 `react-virtuoso`。

正确方案：Kairo 自定义视图统一改 `ReactWidget`；日志每 50–100 ms 批量刷新，只保留 1000–2000 条内存记录并仅渲染可见窗口/最近 300 行。先用 Theia/React 现有依赖，性能基准不通过时才引入新库。

#### “WebSocket 无心跳”

业务事件流确实没有实现，更谈不上心跳；但 JDT LSP bridge 已有 ping/pong。这里的根因不是给前端退避加 1 秒 jitter，而是 `EventBus` 从未注入、前端又重复创建多个 EventStream。应先实现单例连接和事件快照/序号。

#### “搜索 WalkDir 错误静默丢弃”

文件级错误已经写入 `erroredFiles`，所以原报告不完全准确。真实问题是最终 `WalkDir` 返回值被 `_ = err` 丢弃，导致取消或根目录级错误不能传播；`contextLines` 也从未实现，非 UTF-8 文件仍整文件读入内存。

#### “Tomcat 热替换不是热替换”

当前 `staticSync` 对 JSP/CSS/JS/静态资源有效，不能称为 class HotSwap。v1 应诚实命名为 Static Sync，不需要为营销名立刻实现 JDWP redefine。Java class 变更先采用 compile + context reload；真正 HotSwap 放 v1.1 实验项。

### 2.3 不建议照做的外部方案

#### 立即把所有 JSON 存储换成 SQLite

当前数据规模很小，Desktop/localhost 是单用户单进程。性能瓶颈不是查询，而是：

- 写入不原子、错误被丢弃；
- Project 同时存在 `.legacyflow/project.yaml` 概念和 `projects.json`，形成双真相；
- store、业务、transport 混在 1597 行 `services.go`；
- Remote 多用户尚未成立。

现在上 SQLite 会新增 schema/migration/driver，却不修复主链。v1 先采用原子 JSON/YAML repository。仅当 Remote Server 恢复且出现并发、多用户查询、事务需求时，再通过 repository 接口迁移 SQLite。

#### 用文件时间戳做增量 javac

只编译修改文件会漏掉：公共 API 变化、常量内联、注解处理器生成物、依赖类重编译、删除/移动类。遗留项目往往更依赖 Ant 自定义 task。正确优先级是实现 Ant build target 和稳定全量 javac，而不是先做不可靠的“快”。

#### 一次性支持亮色主题

v1 可以只支持 Kairo Dark，但必须通过正常的 Theia Theme 机制声明，并在产品文档中写清楚。不能用 MutationObserver 与用户主题系统对抗。亮色主题不进入主链里程碑。

---

## 3. 必须推倒重做的部分

## 3.1 Project Context 与业务编排层

### 当前问题

- `POST /api/v1/builds` 的协议和 UI 只传 `projectId`；`asyncBuildEngine.Start` 实际还需要 `projectRoot/outputDir/classpath/toolchain/sourceLevel`。
- `POST /api/v1/deployments` 的 UI 只传 `projectId/buildId/what`；后端要求 `source/target`。
- `POST /api/v1/servers` 的 UI 只传 `projectId/debug`；后端要求 `webappDir/javaHome/contextPath/ports`。
- 扫描接口只返回检测结果，不创建项目配置；`ProjectStore` 初始为空，欢迎/导入流程也不存在。
- `projects.json` 与文档里的 `.legacyflow/project.yaml` 是两个潜在真相。
- build/deploy/server 三个底层组件直接接受来自网络的绝对路径。

### 目标设计

建立强类型的 application/use-case 层：

```go
type ProjectService interface {
    Import(ctx context.Context, cmd ImportProjectCommand) (Project, error)
    Get(ctx context.Context, workspaceID, projectID string) (Project, error)
    List(ctx context.Context, workspaceID string) ([]Project, error)
}

type BuildUseCase interface {
    Start(ctx context.Context, cmd StartBuildCommand) (BuildRun, error)
    Get(ctx context.Context, workspaceID, buildID string) (BuildRun, error)
    List(ctx context.Context, workspaceID, projectID string, limit int) ([]BuildRun, error)
    Cancel(ctx context.Context, workspaceID, buildID string) error
}

type StartBuildCommand struct {
    WorkspaceID string
    ProjectID   string
    Clean       bool
    Intent      BuildIntent // full | selected-files
    Files       []WorkspacePath
}
```

`BuildUseCase` 内部按如下顺序解析：

1. session/user → workspace；
2. workspace → canonical root；
3. project ID → `.kairo/project.yaml`；
4. config → BuildPlan；
5. toolchain ref → 注册表中的绝对路径并重新校验 fingerprint；
6. BuildProvider 执行；
7. 发布状态事件并持久化 bounded history。

Deploy、Start、Restart 同理。**HTTP 请求不再携带绝对 source/target/webapp/JDK 路径。**

### Canonical 配置与状态分离

建议趁尚未正式发布，把 `.legacyflow` 品牌路径改为 `.kairo`：

```text
<workspace>/.kairo/project.yaml       # 可共享、可进 Git 的项目定义
<dataDir>/workspaces.json             # 本机最近工作区，仅保存 id/name/root/lastOpened
<dataDir>/user-state.json             # active project、UI 偏好
<dataDir>/toolchains.json             # 本机 JDK/Ant 引用和 fingerprint
<dataDir>/history/builds/*.json        # bounded history；可清理
<dataDir>/history/deployments/*.json
<dataDir>/runtime/<server-id>/         # CATALINA_BASE、日志、pid identity
```

兼容策略：首次打开时读取 `.legacyflow/project.yaml`，显示迁移预览，成功写入 `.kairo/project.yaml` 后保留原文件但不再双写。

### 需要删除/替换

- 删除 `diskProjectStore` 的 `projects.json` 作为项目真相；
- 将 `runtime-agent/internal/services/services.go` 拆分，不保留“万能服务文件”；
- Handler 只 decode/validate/map error，不解析业务路径；
- Project DTO 不再使用 `map[string]any` 或 `json.RawMessage`。

---

## 3.2 API 和协议契约

### 已验证的不一致

| 协议 / 前端认为存在 | 后端现状 |
|---|---|
| `GET /api/v1/builds` | handler 只允许 POST |
| `GET /api/v1/deployments` | handler 只允许 POST |
| `GET /api/v1/servers` | handler 只允许 POST |
| `BuildResult.state = failure` | 后端写 `failed` |
| `BuildResult.summary` | 后端没有 summary，字段散落在顶层 |
| `SearchResponse.query` | 后端结果没有 query |
| `contextLines` | 接收参数但返回空 context |
| `RequestEnvelope.requestId = UUIDv4` | 前端生成 `req_` + `Math.random()` |
| CI 有 protocol sync script | 脚本不存在 |

### 目标规则

1. `packages/protocol` 只表达外部 wire DTO，不包含 Provider 内部配置。
2. Go 在 `internal/transport/httpdto` 定义 wire DTO；application domain DTO 在 `internal/app`，二者显式映射。
3. HTTP handler 不传 `json.RawMessage` 给 service。
4. 所有 endpoint 都有 request/response contract test；TS EndpointMap 与 Go 测试使用同一组 `testdata/contracts/*.json` golden fixtures。
5. v1 不强制引入 OpenAPI 代码生成。等契约稳定后再评估生成，避免在重构期同时调试生成器。
6. 删除“兼容 bare payload”的长期容错；迁移期可保留一个版本，日志 WARN，随后只接受 envelope。

建议 v1 API：

```text
GET    /api/v1/workspaces
POST   /api/v1/workspaces/import
GET    /api/v1/workspaces/{ws}/projects
GET    /api/v1/workspaces/{ws}/projects/{project}
PUT    /api/v1/workspaces/{ws}/projects/{project}

GET    /api/v1/workspaces/{ws}/builds?projectId=&limit=
POST   /api/v1/workspaces/{ws}/builds
GET    /api/v1/workspaces/{ws}/builds/{build}
DELETE /api/v1/workspaces/{ws}/builds/{build}      # cancel

GET    /api/v1/workspaces/{ws}/deployments
POST   /api/v1/workspaces/{ws}/deployments

GET    /api/v1/workspaces/{ws}/servers
POST   /api/v1/workspaces/{ws}/servers
POST   /api/v1/workspaces/{ws}/servers/{id}/restart
DELETE /api/v1/workspaces/{ws}/servers/{id}
GET    /api/v1/workspaces/{ws}/servers/{id}/logs

GET    /api/v1/events?workspaceId={ws}&after={sequence}
```

路径中的 workspace 是授权边界，不能仅依赖一个可伪造 header。

---

## 3.3 Desktop / Browser / Server 产品入口

### 当前问题

- Desktop 只启动 Go Agent，然后加载固定 `http://127.0.0.1:3000`；注释明确要求用户另行启动 Theia，因此不是可分发桌面产品。
- Server 返回一页手写 HTML placeholder，没有托管 Theia；非 `/api` WebSocket upgrade 直接销毁。
- Browser `start/dev` 默认 `--hostname=0.0.0.0`，会把 Theia 的文件系统和终端能力暴露到局域网。
- README 声称“三种形态已共享同一前端和插件系统”，与实际不符。
- Remote 只给 Go Agent 传 `--require-auth`，但这个配置没有进入 API middleware；Theia 本身也没有统一身份边界。

### 目标决策

#### v1 正式支持

- **Desktop：** Electron/Theia backend + Theia frontend + Go Agent child process，自包含安装包。
- **Localhost Browser：** Theia backend + frontend + Go Agent，默认只绑定 `127.0.0.1`。

两者共享同一个 `KairoHostSupervisor`：动态选择空闲端口、创建 per-run auth secret、启动/健康检查/优雅停止子进程、写 PID/日志、处理端口冲突。

#### v1 不发布

- Remote Server：保留源码入口但标记 experimental；只允许 loopback。
- 非 loopback + 未完成认证时启动必须直接失败，不允许只打 warning。

### Desktop 完成条件

1. 安装包内包含正确平台的 Go Agent；
2. Electron 启动 Theia backend，不依赖外部 `pnpm start`；
3. Agent 端口不是固定 18099，并通过启动时 secret 防止同机其他网页调用；
4. Theia frontend 由 host 注入 runtime URL/secret；
5. 退出后 Theia backend、Agent、JDT LS、Tomcat 子树都被回收；
6. Windows portable/NSIS 在无管理员权限环境通过真实安装和卸载测试。

---

## 3.4 Remote 安全模型

### 当前严重问题

- `cfg.RequireAuth` 在 `main.go` 读取后没有传给 `api.Server`；
- middleware 注释写 auth/CORS/audit，但实现只有 request ID、日志和 panic recovery；
- login 接受任意非空用户名密码，token 不存储，logout 空实现；
- state-changing request 没有 CSRF 验证；
- audit log 创建了，但没有任何业务路径调用 `Append`；
- `/api/v1/audit` 未鉴权并返回全部事件；
- workspace 仍接受客户端绝对路径，不是 server-assigned per-user root；
- Theia terminal/filesystem 的身份和 Agent token 没有统一；
- build clean 可对客户端指定的 outputDir 执行 `RemoveAll`；deploy mirror 可删除客户端指定 target 下的内容。

### 近期安全策略：fail closed

在 Remote 完成前：

```text
if bind is non-loopback OR requireAuth == true:
    return startup error "remote mode is not available in this release"
```

这不是功能倒退，而是阻止“看起来有认证、实际上没有”的危险发布。

### Remote 恢复发布的必要条件

1. 统一 IdP/session，Theia 页面、backend RPC、terminal、filesystem、Agent API 使用同一身份；
2. Argon2id 只适用于自建用户名密码；如果企业已有 SSO，优先 OIDC，不同时维护两套；
3. HttpOnly、Secure、SameSite cookie；CSRF 使用 non-HttpOnly token + custom header，文档统一；
4. 每个 workspace 的 OS 路径由服务端从 user/workspace ID 映射；
5. 所有文件/进程/日志操作做 ownership check；
6. WebSocket 在 upgrade 前鉴权和 Origin 校验；
7. rate limit、登录失败锁定、session revoke；
8. audit 记录真实 actor/action/result，并有轮转/导出策略；HMAC chain 不是 v1 必需，可后置；
9. shell/terminal 风险单独 threat model；
10. 专门的远程安全 E2E 和越权测试。

不要只在 Go Agent 补 Argon2id 就宣布 Remote 安全完成。

---

## 3.5 JDT LS / Java 智能能力

### 当前结构性问题

- 前端没有实际 `LanguageClientContribution`；只有 HTTP 生命周期状态栏。
- `jdtls.Manager.Start` 用请求 timeout context 创建 `exec.CommandContext`；HTTP Start 返回后 `defer cancel()` 会结束 context，从而杀死 JDT LS。
- `watchExit` 调 `Process.Wait`，`Stop` 又调 `cmd.Wait`，存在重复 wait。
- `framesOut` 在 readLoop 结束时关闭，auto-restart 却复用同一个 channel。
- channel 满时直接丢 LSP frame；LSP request/response 不能被允许丢弃。
- Agent 自己发送 `initialize` 并消费第一条返回，未来 Theia LanguageClient 又应拥有 initialize，会造成双重会话所有权。
- 自定义 bridge 接受任意 Origin。
- 下载 URL 使用 `latest` snapshot，SHA-256 常量为空；注释却声称 fixed/pinned/verified。

### 目标设计：Theia backend 持有 LSP

```text
Monaco / Theia Language Client
              │ Theia 原生消息通道
Theia backend KairoJavaLanguageServerContribution
              │ stdio (Content-Length framing由标准库处理)
         JDT LS child process

Go Agent:
  - 解析 ProjectConfig / toolchain
  - 准备或验证固定版本 JDT LS 发行物
  - 返回 LaunchDescriptor
  - 不代理 LSP frame，不发送 initialize
```

新增 Theia backend extension entry，职责：

- 请求 Agent 的 `JavaToolingLaunchDescriptor`；
- 启动 JDT LS；
- 将 stdio 接给 Theia 的 Language Client；
- 由 Language Client 唯一拥有 initialize/initialized/shutdown/exit；
- backend 退出时回收进程；
- 每 workspace 一个实例，低内存模式可限制为当前 active workspace 一个实例；
- crash budget 和日志在 backend supervisor 内实现。

Go 侧可保留 distribution 与 jdtproject 中可复用的纯逻辑，但删除：

- `internal/jdtls/bridge.go`；
- LSP frame channels、`Initialize`、`MarkInitialized`；
- `/api/v1/jdtls/lsp`；
- “single manager multiplex multiple workspace”的设计。

发行物必须使用固定版本文件名、固定 URL、非空 SHA-256。禁止 `latest` 作为生产默认值。离线 archive override 保留，但也必须配置 checksum 或明确显示“unverified local artifact”并要求用户确认。

---

## 3.6 构建、部署、服务器生命周期

### Build 目标设计

建立编译期静态 Provider，不建立动态插件协议：

```go
type BuildProvider interface {
    ID() string
    Validate(ctx context.Context, p Project, tc Toolchain) error
    Build(ctx context.Context, plan BuildPlan, sink BuildEventSink) (BuildOutput, error)
}

// v1 内置
AntBuildProvider
JavacBuildProvider
```

优先级：

1. Ant 是目标用户最常见且项目 sample 已含 `build.xml`，必须成为 P0；
2. Javac Provider 用于无构建脚本的简单项目，v1 全量编译；
3. `customCommand` 暂时删除：它既没有实现，也扩大远程命令注入面；
4. Build output 有上限并落日志文件，API 返回 tail + log URI；
5. `FilesCompiled` 不从 javac 非标准文本猜测；计划值和实际诊断分别记录；
6. clean 只能清理 BuildPlan 解析出的、位于 workspace build roots 或 dataDir 下的目录。

### Deploy 目标设计

- UI 只发 `projectId/buildId/what`；
- Agent 生成 `DeployPlan`，每个 source/target 都是已授权 canonical path；
- 默认 merge；mirror 必须是 config 声明的 authoritative target，UI 显示删除预览并确认；
- copy 使用 temp + fsync + atomic rename；Windows 目标存在时使用平台安全替换；
- 返回 add/modify/delete 列表摘要，而不是只返回数字；
- `staticSync`、`contextReload`、`classHotSwap` 状态必须与真实行为一致。

### Server 目标设计

```go
type RuntimeProvider interface {
    ID() string // tomcat6
    Prepare(ctx context.Context, project Project) (RuntimePlan, error)
    Start(ctx context.Context, plan RuntimePlan) (ServerInstance, error)
    Stop(ctx context.Context, id ServerID, force bool) error
    Inspect(ctx context.Context, id ServerID) (ServerInstance, error)
}
```

- v1 只有内置 `tomcat6`；不包装成 `.lfrpkg`；
- `Restart` 是后端单独 use case，保存原 RuntimePlan，stop 成功后 start；失败返回阶段和可恢复状态；
- Agent 启动时不下载 Tomcat。首次 Prepare/Start 时才按用户动作下载；
- start/stop timeout 通过 config 注入，不硬编码 60/15/10 秒；
- Agent 重启后对历史 server 做 PID + executable + start-time 身份核验，不能把陈旧 PID 当成当前 Tomcat；
- server list、build list、deployment list 都实现真实 GET；
- Server events 从状态机发布，而不是 UI 轮询猜测。

---

## 3.7 Encoding 数据安全

### 当前问题

- Browser `TextEncoder` 只产生 UTF-8；用它验证 GBK/ISO-8859-1 是错误的。
- 注释声称 plain save 被拦截，但实际只注册了三个命令，没有自动 detect/open/save integration。
- `Recode` 用 `os.WriteFile` 原地覆盖；进程崩溃或磁盘满可能损坏文件。
- `eol` 参数在协议存在，后端不处理。
- `.properties` 有 Go helper，但编辑器读写链没有接入。

### 目标设计

1. 文件打开：按 BOM → project per-extension → project default → heuristic 解析；状态栏显示 provenance；
2. 普通保存：保留当前编码和 EOL，不做隐式转换；
3. Save with Encoding：把 UTF-8 model text 发给 Agent 的 `encoding/validate`，由 `x/text` 判断目标编码可表示性；通过后再写；
4. 批量/原地 recode：先写同目录临时文件、flush/sync、保留 mode，原子替换；可选 `.bak`；
5. `.properties` 明确两种模式：Java 6 escaped ISO-8859-1（默认）和显式 UTF-8；实现真实 editor round-trip test；
6. 所有测试比较磁盘字节，不只比较 JS string。

浏览器侧删除 `SUPPORTS_ENCODER` 和伪 `canEncode`；最多保留 UTF-8 的本地 fast path，其余由 Agent 验证。

---

## 3.8 前端状态管理和 UI

### 当前问题

- Theia frontend module 绑定 Views/StatusBar，却没有加载 `KairoRuntimeModule` 和各业务 service；`product-bindings.ts` 导入了 RuntimeModule 但 `bindKairoProduct` 未使用。
- `WidgetManager` 被再次 `bind(...).toSelf()`，不应覆盖/重复绑定 Theia 核心 singleton。
- 多个 contribution/widget 分别 `openEvents()`，会创建多个 WebSocket。
- 5 秒轮询与计划中的事件流并存。
- `.catch(() => [])` 把 400/500/断线伪装成“没有数据”。
- Build/Deploy widgets 假定 `summary` 等字段存在，但后端 shape 不匹配。
- Servers widget 仍显示“wire to a workspace”。
- UI CSS 1876 行，强制改 DOM class，design token 另有一套蓝色定义。

### 目标设计

新增前端单例：

```ts
RuntimeConnectionService       // 一个 HTTP client + 一个业务 event socket
WorkspaceContextService        // 当前 Theia workspace ↔ Kairo workspace
ActiveProjectService           // 当前项目；多项目时 quick pick；持久化选择
BuildStore / ServerStore       // snapshot + event reducer
NotificationPolicy             // 哪些错误 toast、哪些进入 Problems/Output
```

命令只调用 application client：

```ts
const project = await activeProject.require();
await buildClient.start({ workspaceId: project.workspaceId, projectId: project.id, clean: false });
```

不在每个命令里 `listProjects()[0]`，不吞错，不直接拼路径。

UI 实现顺序：

1. Welcome/Import Wizard；
2. Active Project selector；
3. Build/Problems；
4. Server status + Start/Stop/Restart/Open App；
5. Deploy timeline；
6. Log viewer；
7. Java/Encoding 状态。

视图用 `ReactWidget` 或 Theia `TreeWidget`。所有交互元素有可访问名称、键盘操作和稳定 `data-testid`。日志批量追加和窗口化；不要为了 50 行表格引入复杂虚拟列表库。

主题重写：

- `tokens.ts` 选定唯一品牌色；建议保留当前实际紫色或由产品决定一次；
- 通过 Theia Theme contribution 注册 Kairo Dark；
- 组件 CSS 只使用 `--theia-*` / `--kairo-*`；
- 删除 MutationObserver、全局强制 `!important` 覆盖和两套 token；
- v1 明确“仅 Kairo Dark”，不伪装支持 light。

---

## 3.9 Persistence：优化而非立即 SQLite 化

### v1 Repository 规则

所有文件存储使用统一 helper：

```go
type VersionedDocument[T any] struct {
    SchemaVersion int       `json:"schemaVersion"`
    UpdatedAt     time.Time `json:"updatedAt"`
    Data          T         `json:"data"`
}

func AtomicWriteJSON[T any](path string, value T, perm fs.FileMode) error
```

实现要求：同目录 temp、encode error 返回、`File.Sync`、close、atomic replace、必要时 sync parent、保留 `.bak`、启动时损坏文件报明确错误。不得再有 `_ = os.WriteFile` 或 `data, _ := json.Marshal`。

读路径不应写盘。`Workspace.Get` 不更新 `lastOpenedAt`；由显式 `Touch/Open` 更新。锁只保护内存状态，不在持锁时进行慢 I/O：复制 snapshot → unlock → atomic write；写冲突用 repository version/单 writer queue 解决。

### 何时再上 SQLite

满足任一条件再立 ADR：

- Remote 多用户正式恢复；
- 需要跨 workspace 事务；
- history 超过文件模型可控规模；
- 实测 file lock/写放大成为瓶颈；
- 需要复杂过滤、分页、审计查询。

Repository 接口保证未来迁移不影响 use case 和 handler。

---

## 3.10 插件与扩展性去过度设计

### 删除

- LegacyFlow runtime plugin package/loader/marketplace；
- localhost plugin JSON-RPC、自定义 permission manifest、每插件子进程；
- v1.1 的插件市场承诺；
- ADR 中不存在实现却标记 accepted/done 的部分。

### 保留

- Theia extension：产品内部 UI 扩展机制；
- VS Code extension compatibility：只使用 Theia 已有兼容层和 allowlist，不自建市场；
- Go 内部 compile-time Provider：`AntBuildProvider`、`JavacBuildProvider`、`Tomcat6RuntimeProvider`。

Provider 是代码组织边界，不是第三方 ABI。等至少出现第二个真实外部 runtime、稳定 API、明确第三方作者后，再评估动态插件。

---

## 4. 建议的目标目录结构

```text
runtime-agent/
  cmd/kairo-runtime/
  internal/
    app/                         # use cases / orchestration
      workspace/
      project/
      build/
      deploy/
      server/
      encoding/
    domain/                      # 小而稳定的实体和值对象；不做 DDD 仪式化
      project.go
      build.go
      server.go
      path.go
    repository/
      workspace_file.go
      project_yaml.go
      toolchain_file.go
      history_file.go
      atomicfile.go
    provider/
      build/ant.go
      build/javac.go
      runtime/tomcat6.go
    platform/
      process/
      filesystem/
      assets/                    # Tomcat/JDTLS fixed distribution preparation
    transport/http/
      dto/
      handlers/
      middleware/
      events/
    security/
      workspace_paths.go
      localauth.go

packages/
  protocol/                      # wire DTO + EndpointMap + fixtures
  runtime-extension/             # HTTP/event connection singleton
  project-extension/             # import + active project
  build-extension/               # build/problems UI（从 theia-product 拆出）
  tomcat-extension/              # server/deploy/log UI
  encoding-extension/
  java-extension/
    src/browser/                 # Language Client contribution
    src/node/                    # JDT LS child + stdio connection
  ui-kit/                        # theme + small reusable React components
  theia-product/                 # 只做 composition root

apps/
  browser/                       # localhost host
  desktop/                       # self-contained Electron/Theia
  server/                        # experimental until security gate passes
```

不要创建大量只有一个 struct 的 package。拆分标准是：独立生命周期、独立测试边界、独立依赖方向，而不是追求目录数量。

---

## 5. 分阶段开发实施方案

## Phase 0：冻结声明、建立真实基线（1–2 日）

### 工作项

1. 修复 `tomcat6.isAlive` 重复定义，使 `go test ./...` 能运行；
2. 更新 MILESTONES：把 Server、Desktop、EventBus、Auth、LSP UI、DAP、plugin 标为 partial/not started；
3. Browser 默认 bind 改 `127.0.0.1`；Remote 非 loopback fail closed；
4. CI integration 设置 `KAIRO_LEGACY_SAMPLE=$GITHUB_WORKSPACE/legacy-sample`；
5. 移除 P0 流程中的 `gated`，允许测试先红；
6. 为当前 contract mismatch 写 failing tests；
7. 统一 Go 版本（建议 go.mod/CI 均 1.22.x 或一次性升级并记录 ADR）；修正 Windows job shell。

### Gate

- `go test ./...` 至少可编译并准确暴露失败；
- CI 不允许核心集成测试 skip；
- 文档不再声称 placeholder 已完成。

## Phase 1：强类型 Project + Use Case 主干（5–7 日）

### 工作项

1. 定义 domain Project/Workspace/Toolchain/BuildPlan/RuntimePlan；
2. 实现 `.kairo/project.yaml` schema、loader、validator、migration；
3. 实现 ImportProject：scan → preview → confirm → persist；
4. 删除 ProjectStore RawMessage；
5. 引入 workspace/project scoped API；
6. Handler/service DTO 全部强类型；
7. 加 atomic file repository；
8. 前端 WorkspaceContext/ActiveProject 接入 Theia workspace lifecycle。

### Gate

- 打开 sample → 导入 → 重启 IDE → 项目仍可解析；
- UI/HTTP 不发送执行路径；
- 错误配置显示字段级错误，不能默默回退。

## Phase 2：Build → Deploy → Run 闭环（7–10 日）

### 工作项

1. Ant Provider + Javac Provider；
2. BuildUseCase/list/get/cancel/events；
3. DeployPlan + sandbox + merge/mirror preview；
4. Tomcat6 RuntimeProvider + lazy asset prepare；
5. 后端 Restart；
6. Build/Deployment/Server 返回统一 state enum；
7. Build/Server UI 改用 store + ReactWidget；
8. 实现 EventHub 和单例前端连接；删除轮询与吞错。

### 必须通过的真实 E2E

```text
import legacy-sample
→ select/import JDK
→ Ant or javac build success
→ classes/resources deployed
→ Tomcat starts
→ GET servlet returns expected text
→ edit JSP and save
→ static sync
→ browser sees changed JSP
→ restart server
→ same application returns 200
→ stop and verify process/ports released
```

任何一步不得 gated。

## Phase 3：Encoding 真实 round-trip（4–6 日）

### 工作项

1. Agent validate-encoding endpoint；
2. atomic recode + EOL；
3. editor open/detect/save integration；
4. `.properties` escape round-trip；
5. GBK JSP、GB18030、UTF-8 BOM、混合 EOL 字节级测试；
6. 批量转换预览和确认。

### Gate

- plain save 前后未修改字符对应的字节保持一致；
- 不可表示字符时保存失败且原文件字节不变；
- 进程中断/模拟磁盘错误不留下半文件。

## Phase 4：Java Language Intelligence（5–8 日）

### 工作项

1. 固定 JDT LS 发行物 URL + SHA；
2. 新增 Theia backend Java contribution；
3. Agent 提供 launch descriptor/project model；
4. Theia Language Client 管理 stdio 和 initialize；
5. source roots/classpath/output/encoding/source level 接入；
6. completion/hover/definition/references/diagnostics/outline E2E；
7. 打开 Java 文件时懒启动，空闲/关闭 workspace 后释放；
8. 删除 Go LSP bridge 和重复状态机。

### Gate

- Java completion 和 F12 使用真实 sample 可重复通过；
- JDT LS crash 后可恢复且不会复用 closed channel/遗留进程；
- 低配基准下 heap cap 生效。

## Phase 5：Desktop 产品化与 UI 收口（5–7 日）

### 工作项

1. Desktop 自包含 Theia backend；
2. HostSupervisor 动态端口和启动 secret；
3. Welcome/Import Wizard；
4. Active project selector；
5. Theme 重写，删除 1876 行全局覆盖和 MutationObserver；
6. 日志窗口化、ARIA、data-testid；
7. Windows 无管理员安装、升级、卸载、进程回收测试；
8. 实测启动时间与 RSS。

### Gate

- 干净 Windows 10 2 vCPU/4 GB VM 从安装到运行 sample 全链成功；
- 无需 Node/pnpm/Go/管理员权限；
- 退出后无 orphan process；
- 冷启动与内存指标写入 testing 文档，指标以实测基线设定，不凭空承诺 4 秒。

## Phase 6：v1.1 可选项（不阻塞桌面 v1）

- Java DAP/JDWP 调试；
- context reload 改善与实验性 class HotSwap；
- search context lines、流式 legacy decode、Unicode whole word；
- light theme；
- Remote Server security；
- SQLite（仅在触发条件满足后）；
- 第二个 runtime/build provider；
- 协议代码生成。

---

## 6. 文件级迁移清单

| 当前文件/目录 | 动作 | 目标 |
|---|---|---|
| `runtime-agent/internal/services/services.go` | 推倒拆分 | app/repository/provider/transport，各自强类型 |
| `runtime-agent/internal/api/services.go` | 重写 | typed use-case interfaces；或 handler 直接依赖 app service |
| `runtime-agent/internal/api/handlers.go` | 拆分 | 每资源 handler 文件；只做 transport 工作 |
| `runtime-agent/internal/api/server.go` | 重写 middleware | local secret/auth、request ID、body limit、audit、error mapping |
| `runtime-agent/internal/api/scanner.go` 与 `internal/services/scanner.go` | 合并 | 唯一 project scanner |
| `runtime-agent/internal/build/compiler.go` | 保留并修正 | Javac Provider 的底层 executor；增加 Ant Provider |
| `runtime-agent/internal/deploy/sync.go` 与 services 内 `syncDir` | 合并 | 唯一 deploy engine，plan 驱动、sandbox、diff preview |
| `runtime-agent/internal/jdtls/bridge.go` | 删除 | 使用 Theia backend 标准 LSP 连接 |
| `runtime-agent/internal/jdtls/jdtls.go` | 大幅删除/替换 | 仅保留 asset preparation/launch descriptor 所需逻辑 |
| `runtime-agent/internal/jdtls/distribution.go` | 修正 | fixed release + non-empty SHA + offline override |
| `runtime-agent/internal/tomcat6/*` | 保留并封装 | RuntimeProvider；修 build、timeout、identity、lazy prepare |
| `runtime-agent/internal/search/search.go` | 保留优化 | 传播 cancel/root error，补 context，后续 legacy stream |
| `runtime-agent/internal/encoding/encoding.go` | 保留 | 成为唯一 codec truth；接 editor workflows |
| `packages/protocol/src/index.ts` | 拆 DTO/endpoint | 稳定 enum、fixtures、无内部 Provider 细节 |
| `packages/runtime-extension/.../runtime.ts` | 重构 | 单例 EventConnection、UUID、snapshot/reconnect、无重复 socket |
| `packages/project-extension/...` | 重写 | import wizard + workspace/active project context |
| `packages/theia-product/.../kairo-views-contribution.ts` | 拆分 | build/server/deploy/log 各 extension 的 ReactWidget |
| `packages/theia-product/.../kairo-status-bar-contribution.ts` | 简化 | store 订阅；不轮询；不保留 skeleton 文案 |
| `packages/encoding-extension/...` | 重写保存链 | 删除伪 canEncode，Agent validate，真实 open/save hook |
| `packages/java-extension/...` | 新增 backend | 标准 Language Client + JDT child lifecycle |
| `packages/ui-kit/.../kairo-ui-contribution.ts` | 推倒重写 | Theia Theme + 小量 component CSS |
| `apps/desktop/src/main.ts` | 重写 host | 自包含 Theia + Agent，动态端口，秘密注入，完整 shutdown |
| `apps/server/src/index.ts` | 暂停/标 experimental | 不再返回 placeholder 冒充产品 |
| `.github/workflows/ci.yml` | 重建 gates | 真 integration、真 UI、Windows shell、release smoke |

---

## 7. 测试与验收体系重建

### 7.1 测试金字塔

1. **Pure unit：** path value object、config validation、encoding bytes、deploy diff、diagnostic parser；
2. **Provider integration：** real javac/Ant/Tomcat with temp workspace；
3. **HTTP contract：** 每 endpoint golden request/response + auth/path errors；
4. **Theia service tests：** ActiveProject、event reducer、command error behavior；
5. **Full-chain：** 安装/启动的真实产品执行 sample；
6. **Security regression：** traversal、symlink escape、mirror delete、build clean、Origin、unauthorized workspace；
7. **Performance：** Windows 低配基准，不在普通单元 CI 里用不稳定时间断言。

### 7.2 禁止的测试模式

- 核心能力不得 `t.Skip` 或 `gate` 后仍算绿色；
- 不得只搜索源码字符串证明命令已实现；
- 不得 `.catch(() => [])` 后断言空列表；
- 不得用 mock 后端证明真实协议兼容；
- 不得只断言 HTTP 200，不验证业务 state 和磁盘/进程副作用；
- 不得在 release report 手工粘贴旧测试数字作为当前证据。

### 7.3 Definition of Done

每个功能必须同时满足：

- typed contract；
- use-case test；
- 错误/取消/重启路径；
- sandbox/授权检查；
- UI 可观察反馈；
- 不吞错；
- 文档状态更新；
- 至少一个真实 E2E 证明；
- Windows 路径/进程差异有覆盖（若功能涉及）；
- 无新增无限内存/history/DOM 增长。

---

## 8. 非功能设计指标

当前文档的 4 秒/8 秒承诺互相冲突，且没有稳定基线。建议先测后定：

| 指标 | v1 建议 gate | 说明 |
|---|---:|---|
| Desktop 到 shell 可交互 | P95 ≤ 8s | Windows 10 2 vCPU/4 GB，warm disk；首次下载不计 |
| 未打开 Java 文件时 RSS | ≤ 550 MB | Electron + Theia + Agent，不启动 JDT/Tomcat |
| 打开 Java + JDT ready RSS | ≤ 900 MB | JDT `-Xmx256m`，记录真实峰值 |
| 日志持续 30 分钟 | DOM 节点稳定 | 事件量增长不导致 DOM/监听器线性增长 |
| Search cancel | ≤ 500 ms 生效 | 返回 cancelled，不返回伪完整结果 |
| Agent 退出 | ≤ 5s | 所有托管子进程被回收 |
| 普通文件保存 | 不改变编码/EOL | 字节级 fixture 验证 |

这些是初始建议，第一轮基准后允许通过 ADR 调整，不能通过降低测试覆盖来“达标”。

---

## 9. 风险、取舍与明确不做

### 主要风险

1. **Theia backend Java integration学习成本：** 用最小 spike 先证明启动、completion、shutdown，不同时做完整 UI；
2. **JDK 6 与现代 JDT LS 差异：** language server JRE、compiler JDK、Tomcat JRE 三槽继续保留；
3. **Ant 项目高度自定义：** v1 允许用户选择 target 和 properties，但不执行任意未确认 shell；
4. **Windows 文件替换/进程树差异：** 必须在 Windows runner 和真实 VM 测；
5. **配置迁移：** 当前尚未正式发布，是更名/合并真相成本最低的窗口。

### v1 明确不做

- Remote 多用户发布；
- 动态 runtime plugin / plugin marketplace；
- Maven/Gradle/Spring Boot 泛化；
- 自研 Java parser/compiler；
- naive timestamp incremental javac；
- class HotSwap 的完成承诺；
- light theme；
- SQLite 迁移；
- cgroup、TOTP、硬件密钥、SSO 多方案并行；
- “三种形态功能完全相同”的市场声明。

---

## 10. 给实现 AI 的执行指令

另一个 AI 应按 Phase 顺序实现，不允许直接从 UI 美化或 SQLite 开始。每个 Phase 建议一个独立分支/PR，控制改动边界：

1. 开工先读取本文件和涉及的 ADR；
2. 先写/修会失败的验收测试，再改实现；
3. 不在同一 PR 同时更换 persistence、protocol、UI 和 JDT lifecycle；
4. 每个 PR 给出：变更范围、旧行为、目标行为、迁移方式、测试证据、已知未完成；
5. 不得保留 `_ = os.WriteFile`、`json.RawMessage` service contract、`.catch(() => [])`；
6. 不得用 placeholder/gated/skip 关闭核心验收；
7. 不得新增动态插件、数据库、状态管理框架或虚拟列表依赖，除非有基准/真实第二用例；
8. 涉及路径删除/覆盖时，先 resolve canonical target，再验证 authorized root，再执行；
9. 文档与 MILESTONES 和代码同 PR 更新；
10. Phase Gate 未通过，不进入下一阶段。

### 建议 PR 切分

```text
PR-01  baseline-compiles-and-honest-ci
PR-02  typed-project-config-and-import
PR-03  typed-api-and-contract-fixtures
PR-04  ant-javac-build-usecase
PR-05  deploy-runtime-restart-and-sandbox
PR-06  event-hub-and-frontend-stores
PR-07  encoding-byte-safe-roundtrip
PR-08  theia-native-jdt-language-client
PR-09  self-contained-desktop-host
PR-10  ui-theme-accessibility-and-performance
```

---

## 11. 最终优先级

### P0：不修不能继续开发功能

1. 恢复 Go 编译；
2. 停止非 loopback/Remote 发布；
3. 修复 CI 假绿；
4. 重建 Project Context + typed use cases；
5. 对齐 API contract 和 list/state shapes；
6. build/deploy/server 所有路径由后端计划解析并 sandbox；
7. 完成真实 Build → Deploy → Run → Restart → Stop 闭环；
8. 实现 EventHub；
9. 修复 encoding 数据安全；
10. 修复 frontend composition root。

### P1：桌面 v1 必须完成

1. Import Wizard + Active Project；
2. Ant Provider；
3. Theia backend JDT LS 集成；
4. 自包含 Desktop；
5. 原子文件 repository；
6. Build/Server/Deploy/Log 真实 UI；
7. Windows 低配实机验收；
8. 发行物 fixed version + checksum。

### P2：v1 收口优化

1. Theme 重写、品牌统一；
2. 日志窗口化和可访问性；
3. search cancel/context/legacy streaming；
4. audit rotation（Desktop 本地诊断用途）；
5. 文档/ADR 全面同步。

### P3：v1.1+

1. DAP/JDWP；
2. context reload / experimental HotSwap；
3. Remote security；
4. 第二 Provider；
5. light theme；
6. SQLite/协议生成（有触发条件时）。

---

## 12. 已验证问题索引（供实现 AI 定位）

以下行号对应评审时的当前工作树；实现后会移动，查找时应同时使用符号名。

| ID | 严重度 | 证据位置 | 已验证问题 | 归属 Phase |
|---|---|---|---|---|
| V-001 | Blocker | `runtime-agent/internal/tomcat6/tomcat6.go:44`、`tomcat6_unix.go:30` | `isAlive` 重复定义，Go 主程序不能编译 | 0 |
| V-002 | Critical | `runtime-agent/cmd/kairo-runtime/main.go:29-71` | `RequireAuth` 被读取但未传给 Server/middleware | 0 / Remote |
| V-003 | Critical | `runtime-agent/internal/api/server.go:114-149` | middleware 注释声称 auth/CORS/audit，实际均未实现 | 0 / Remote |
| V-004 | Critical | `runtime-agent/internal/services/services.go:1341-1377` | 任意非空用户名密码登录，token 不存储，logout 空实现 | Remote |
| V-005 | High | `runtime-agent/cmd/kairo-runtime/main.go:45-50`、全仓无 `audit.Append` 调用 | audit 文件创建但没有业务审计事件 | Remote / 5 |
| V-006 | Critical | `runtime-agent/internal/services/services.go:574-576` | 客户端指定 `outputDir` + clean 可触发 `RemoveAll`，未 sandbox | 1 / 2 |
| V-007 | Critical | `runtime-agent/internal/services/services.go:739-804` | deploy 接受任意 source/target；mirror 可删除目标内容 | 1 / 2 |
| V-008 | High | `runtime-agent/internal/services/services.go:1077-1128` | server 接受任意 JavaHome/WebappDir，未从 ProjectPlan 解析 | 1 / 2 |
| V-009 | High | `runtime-agent/internal/services/services.go:64-85` | toolchain registry 初始化错误被丢弃；Agent 启动时主动准备/下载 Tomcat | 0 / 2 |
| V-010 | High | `runtime-agent/internal/services/services.go:107-128` 等多个 store | load/save 错误静默丢弃，写入不原子 | 1 |
| V-011 | Medium | `runtime-agent/internal/services/services.go:176-186` | Workspace Get 是写操作并在锁内全量落盘 | 1 |
| V-012 | High | `runtime-agent/internal/api/services.go:26-116` | application service 广泛使用 RawMessage，重复解析且无编译期契约 | 1 |
| V-013 | Critical | `packages/protocol/src/index.ts:525` 对比 `services.go:527-621` | UI/协议 BuildRequest 只有 project intent，后端要求执行细节 | 1 / 2 |
| V-014 | Critical | `packages/protocol/src/index.ts:527` 对比 `services.go:739-804` | UI/协议 DeployRequest 与后端所需 source/target 不一致 | 1 / 2 |
| V-015 | Critical | `packages/protocol/src/index.ts:529-532` 对比 `services.go:1077-1128` | UI/协议 StartServer 与后端所需 runtime plan 不一致 | 1 / 2 |
| V-016 | High | `runtime-agent/internal/api/handlers.go:209-295` | 协议声明的 builds/deployments/servers 列表 GET 均被拒绝 | 1 / 2 |
| V-017 | High | `services.go:444-459` 对比 `protocol/index.ts:256-267` | Build state/summary/diagnostics shape 不一致 | 1 / 2 |
| V-018 | High | `runtime-agent/internal/api/handlers.go:483-488`、`NewMemoryServices` | EventBus 有接口和路由，但从未实现/注入 | 2 |
| V-019 | High | `packages/theia-product/src/main/product-bindings.ts:26-34` | composition root 没有加载导入的 `KairoRuntimeModule` | 0 / 1 |
| V-020 | High | `kairo-product-frontend-module.ts:36-77` | frontend 只绑 views/status，且重复绑定 Theia `WidgetManager` | 0 / 5 |
| V-021 | Critical | `kairo-views-contribution.ts:361-465` | Build/Deploy/Start/Debug 固定 `projects[0]`，Restart 只 stop | 1 / 2 |
| V-022 | High | `kairo-views-contribution.ts:440-470,522-536` | `.catch(() => [])` 把协议/服务器错误伪装为空状态 | 2 |
| V-023 | Medium | `kairo-views-contribution.ts:327`、Logs widget `attachStream`、StatusBar `onStart` | 一个页面创建多个业务 EventStream | 2 |
| V-024 | Medium | `kairo-status-bar-contribution.ts:111-114` | 事件流设计与 5 秒 polling 并存 | 2 |
| V-025 | High | `encoding-service.ts:266-278` | 用只支持 UTF-8 的 TextEncoder 验证 GBK 等编码 | 3 |
| V-026 | High | `encoding-service.ts` 与 `encoding-commands.ts` | 注释称拦截普通保存，实际只有手动命令，无自动 detect/save hook | 3 |
| V-027 | High | `runtime-agent/internal/services/services.go:406-419` | recode 原地 WriteFile，失败可能损坏原文件 | 3 |
| V-028 | Critical | `runtime-agent/internal/jdtls/jdtls.go:345`、`services.go:1525-1558` | request context 创建 JDT child，Start 返回时 cancel 会杀进程 | 4 |
| V-029 | Critical | `jdtls.go:401-475` | watchExit 与 Stop 对同一 cmd 重复 Wait | 4 |
| V-030 | Critical | `jdtls.go:514-537` | restart 复用 closed channel，且 channel 满时丢 LSP frames | 4 |
| V-031 | High | `jdtls.go:587-625` | Agent 抢占 initialize 所有权，未来与 Theia Language Client 冲突 | 4 |
| V-032 | High | `packages/java-extension/src/browser` | 没有真实 LanguageClient/Monaco 连接实现 | 4 |
| V-033 | Critical | `jdtls/distribution.go:70-99` | production URL 是 `latest` snapshot 且 SHA 常量为空 | 4 |
| V-034 | High | `apps/desktop/src/main.ts:69-106` | Desktop 不启动 Theia，只加载外部固定 3000 端口 | 5 |
| V-035 | High | `apps/server/src/index.ts:218-260` | Server 返回 placeholder HTML，未托管 Theia，非 API WS 被销毁 | Remote |
| V-036 | Critical | `apps/browser/package.json:13-14` | Browser 默认把带 filesystem/terminal 的 Theia 绑定到 0.0.0.0 | 0 |
| V-037 | Medium | `packages/runtime-extension/src/browser/runtime.ts:274-276` | request ID 不满足协议声明的 UUIDv4 | 1 |
| V-038 | Medium | `runtime.ts:365-369` | reconnect 无 jitter；更主要的是无 snapshot/sequence 恢复 | 2 |
| V-039 | Medium | `search/search.go:149` | 最终 WalkDir error（含 cancel）被丢弃 | 6 |
| V-040 | Medium | `search/search.go:319-339` | contextLines 接收但不实现 | 6 |
| V-041 | Medium | `search/search.go:250-269` | legacy encoding 文件整文件读取 | 6 |
| V-042 | High | `.github/workflows/ci.yml:66-82` 与 integration test:45-48 | CI 未设置 sample env，integration 整段 skip | 0 |
| V-043 | High | `tests/e2e/ui-full-chain.cjs` | 核心 Build/Run 可 gated，命令出现即被当成成功 | 0 / 2 |
| V-044 | Medium | `packages/protocol/src/index.ts:3-8` | 注释声称存在 protocol sync script，仓库不存在该脚本 | 1 |
| V-045 | Medium | `ui-kit/tokens.ts:43,110` 对比 `kairo-ui-contribution.ts:43` | 蓝/紫两套品牌源；token 不是实际 CSS 真相 | 5 |
| V-046 | Medium | `kairo-ui-contribution.ts:1749-1872` | 运行时注入超大 CSS 并用 MutationObserver 强制主题 | 5 |
| V-047 | Medium | `kairo-views-contribution.ts:195-281` | 每条日志 O(n) 移动数组并重建最多 5000 行 DOM | 5 |
| V-048 | High | 全仓 Ant 搜索结果仅 scanner/protocol | PRD/sample 声称 Ant 核心构建，但没有 Ant executor | 2 |

---

## 13. 结论

Kairo 不需要“全部重写”。可保留的资产包括 Theia 选型、Go Agent 选型、encoding codec、sandbox 基础、process/Tomcat 大部分底层能力、javac executor、search 基础、JDT project generator 和已有协议测试工具。

必须推倒的是位于这些能力之上的**错误组合方式**：万能 `services.go`、Raw JSON service contract、客户端传执行路径、Project 双真相、伪三形态、伪认证、无 EventBus、自定义且双重所有权的 LSP bridge、只检查“命令存在”的假闭环测试，以及尚未实现却写成已完成的文档体系。

最重要的产品取舍是：先交付一个真正可靠、低配 Windows 可用的 Desktop/localhost IDE，再谈 Remote、多租户、插件生态、HotSwap 和数据库。这个顺序既减少过度设计，也最大化 Kairo 对目标用户最核心的价值。
