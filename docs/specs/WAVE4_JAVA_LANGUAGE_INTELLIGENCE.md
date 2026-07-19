# Kairo IDE — Wave 4 Java 语言智能真集成文档

> 文档用途：Java & Desktop Agent (Agent D) 的开发任务书（Java 部分）  
> 负责 Agent：Agent D — Java & Desktop  
> 预计工作量：5-8 天  
> 前置条件：Wave 2 Gate 全部通过（后端 API contract 已冻结）  
> 后置 Gate：completion / F12 / diagnostics 真实通过

---

## 0. 目标

将 JDT LS 从"Go Agent 自定义 LSP bridge + 伪 LanguageClient scaffold"改为"Theia backend 拥有 JDT LS 进程 + 真实 LanguageClient 接 stdio"。完成 Java completion、F12/definition、diagnostics 的产品级验收。

---

## 1. 架构变更

```
旧架构（删除）：
  Browser → Go WebSocket LSP bridge → JDT LS stdio
  Go Agent 发送 initialize，双重所有权

新架构（目标）：
  Monaco / Theia Language Client
            │ Theia 原生消息通道
  Theia backend KairoJavaLanguageServerContribution
            │ stdio (Content-Length framing)
       JDT LS child process

  Go Agent 只负责：
    - 解析 ProjectConfig / toolchain
    - 准备或验证固定版本 JDT LS 发行物
    - 返回 LaunchDescriptor
    - 不代理 LSP frame，不发送 initialize
```

---

## 2. 任务清单

### 2.1 安全 launch descriptor

**修改文件**：`runtime-agent/internal/jdtls/jdtls.go`（大幅删除/替换）

**当前问题**：N-025：Agent 将 `os.Environ()` 整体作为 descriptor 经 HTTP 返回，可能把 token、代理凭据暴露给浏览器。

**目标实现**：

```go
type LaunchDescriptor struct {
    Command     string   `json:"command"`      // java 或 javaw
    Args        []string `json:"args"`          // 不包含环境变量
    WorkingDir  string   `json:"workingDir"`    // 从 repository 解析的 canonical project root
    EnvAllowlist []string `json:"envAllowlist"` // 只允许 PATH、JAVA_HOME 等最小集合
    // 不返回 os.Environ()
}
```

**实现要求**：
1. descriptor 只由 Theia backend 请求，不暴露给普通 browser API
2. 不返回 `os.Environ()`；只允许 PATH、JAVA_HOME 等最小 allowlist
3. workingDir 从 repository 解析的 canonical project root 得到
4. launcher jar、platform configuration、workspace data dir 来自 verified installation report
5. 每个 workspace/project 独立 data dir，避免 Eclipse metadata 冲突

### 2.2 删除 Go LSP bridge

**删除文件**：`runtime-agent/internal/jdtls/bridge.go`

**删除内容**：
- LSP frame channels
- `Initialize`、`MarkInitialized` 方法
- `/api/v1/jdtls/lsp` endpoint
- "single manager multiplex multiple workspace" 设计
- `framesOut` channel 相关逻辑

**保留内容**：
- `jdtls/distribution.go` 中的 asset preparation 逻辑
- `jdtproject/` 中的 `.project/.classpath` 生成逻辑

### 2.3 固定 JDT LS 发行物

**修改文件**：`runtime-agent/internal/jdtls/distribution.go`

**当前问题**：N-040：production URL 是 `latest` snapshot，SHA-256 常量为空。

**目标实现**：
```go
const (
    JDTLSVersion = "1.35.0"  // 固定版本
    JDTLSURL     = "https://download.eclipse.org/jdtls/milestones/1.35.0/jdt-language-server-1.35.0-202406271634.tar.gz"
    JDTLSSHA256  = "abc123..."  // 固定 SHA-256
)
```

**实现要求**：
1. 固定版本、固定下载 URL、固定 SHA-256
2. CI 使用受控 fixture/archive，不访问 latest snapshot
3. 校验 archive traversal、checksum mismatch、partial install rollback
4. platform config 覆盖 Linux/Windows/macOS
5. 离线 archive override 保留，但必须配置 checksum 或明确显示 "unverified local artifact"

### 2.4 Theia backend JDT LS contribution

**新文件**：`packages/java-extension/src/node/java-language-server-contribution.ts`（重写）

**当前问题**：N-037：能 spawn 进程，但没有把 stdin/stdout 接入 LanguageClient。

**目标实现**：

```ts
@injectable()
export class KairoJavaLanguageServerContribution extends BaseLanguageServerContribution {
    id = 'kairo-java';
    name = 'Kairo Java';

    // 从 Agent 获取 LaunchDescriptor
    async createLaunchDescriptor(): Promise<ProcessLaunchDescriptor> {
        const descriptor = await this.agentClient.getJavaLaunchDescriptor();
        return {
            command: descriptor.command,
            args: descriptor.args,
            options: {
                cwd: descriptor.workingDir,
                env: this.buildEnv(descriptor.envAllowlist),
            },
        };
    }
}
```

**实现要求**：
1. Node/backend contribution 启动 JDT LS 并返回 stdin/stdout connection
2. initialize 只由 LanguageClient 执行一次；Go Agent 不参与
3. workspace close、backend stop 时优雅 shutdown/exit，超时再 kill
4. crash circuit breaker：时间窗口内最多 N 次，之后显示 actionable error
5. 启动前检查本地已安装的 Theia 1.73.1 类型与示例，使用真实 API

### 2.5 Browser LanguageClient

**修改文件**：`packages/java-extension/src/browser/java-language-client-contribution.ts`（重写）

**当前问题**：N-036：只是包含 id/name/glob 的普通类，不是可运行的 Theia Language Client contribution。

**目标实现**：

```ts
@injectable()
export class KairoJavaLanguageClientContribution extends BaseLanguageClientContribution {
    id = 'kairo-java';
    name = 'Kairo Java';

    // 注册 java document selector
    protected get documentSelector(): DocumentSelector {
        return ['java'];
    }

    // 注册初始化选项
    protected get initializationOptions(): JavaInitializationOptions {
        return {
            sourceLevel: '1.6',
            // 从 project config 获取
        };
    }
}
```

**实现要求**：
1. 注册 `java` document selector
2. 设置 `sourceLevel: 1.6` 等 JDT LS 初始化选项
3. 创建 diagnostic collection
4. 注册 completion provider、definition provider、hover provider

### 2.6 生成正确的 JDT project model

**修改文件**：`runtime-agent/internal/jdtproject/generator.go`

**实现要求**：
1. `.project` / `.classpath` 生成与 source/output/classpath 一致
2. source roots、output dir、classpath 从 ProjectConfig 解析
3. JRE 17 运行 JDT LS，目标 project source/target 可为 Java 6

### 2.7 清理 protocol

**修改文件**：`packages/protocol/src/index.ts`

**当前问题**：N-039：仍声明 `DELETE /api/v1/jdtls` 和旧 `JdtStartRequest`，后端已不支持。

**任务**：
1. 删除旧 DELETE/start 状态契约
2. 改成 `GET /api/v1/jdtls/distribution` 和 `GET /api/v1/projects/{id}/launch-descriptor`
3. backend process status 通过 frontend contribution 暴露

---

## 3. Wave 4 Gate Checklist

在真实 `legacy-sample` 的 `HelloServlet.java` 文件中验证：

- [ ] 打开 `HelloServlet.java` → 收到 diagnostics（无网络连接错误）
- [ ] 输入 `.` 或 `Ctrl+Space` 触发 completion，至少包含真实 Java/项目 symbol
- [ ] F12/definition 跳转到项目内真实定义
- [ ] 关闭 workspace → JDT 进程退出（`ps` 确认无残留）
- [ ] 再打开 workspace → 可重新启动 JDT LS
- [ ] 全程没有第二个 initialize owner
- [ ] 没有 zombie JVM 进程
- [ ] JDT LS crash 后可恢复且不会复用 closed channel/遗留进程
- [ ] 低配基准下 heap cap 生效（JDT `-Xmx256m`）

**未完成 completion 和 definition，不得标记 Java integration 完成。**

---

## 4. 具体文件变更清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `runtime-agent/internal/jdtls/bridge.go` | **删除** | Go LSP bridge 全部删除 |
| `runtime-agent/internal/jdtls/jdtls.go` | 大幅删除 | 只保留 asset preparation/launch descriptor |
| `runtime-agent/internal/jdtls/distribution.go` | 修正 | 固定版本 + SHA-256 |
| `runtime-agent/internal/jdtproject/generator.go` | 修正 | 与 ProjectConfig 对齐 |
| `packages/java-extension/src/node/java-language-server-contribution.ts` | 重写 | 真实 Theia backend contribution |
| `packages/java-extension/src/browser/java-language-client-contribution.ts` | 重写 | 真实 LanguageClient |
| `packages/java-extension/src/browser/java-ls-lifecycle.ts` | 修正 | crash circuit breaker |
| `packages/protocol/src/index.ts` | 修正 | 删除旧 JDT DELETE/start 契约 |
| `runtime-agent/internal/api/handlers.go` | 修正 | 删除 `/api/v1/jdtls/lsp` endpoint |