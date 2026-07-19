# Kairo IDE — Wave 3 前端状态流与真实项目导入文档

> 文档用途：Protocol & Frontend Agent (Agent C) 的开发任务书  
> 负责 Agent：Agent C — Protocol & Frontend  
> 预计工作量：5-7 天  
> 前置条件：Wave 2 Gate 全部通过（API contract 已冻结）  
> 后置 Gate：前端单例连接、Import Wizard 真保存、Store 替换旧 UI、Theme 收敛

---

## 0. 目标

将前端从"多个重复连接 + 假 Widget + 吞错"重构为"唯一 RuntimeConnection + Store/ReactWidget + 真实状态流"。前端和旧 UI 的"双套并存"问题必须解决。

---

## 1. 任务清单

### 1.1 唯一 RuntimeConnectionService

**修改文件**：`packages/runtime-extension/src/browser/runtime-connection-service.ts`（重写）

**当前问题**：
- N-023：又创建一套固定 18099 的实现，与 `KairoRuntimeImpl` 重复
- 多个 widget 各自 `openEvents()`，创建多个 WebSocket
- 5 秒轮询与事件流并存

**目标实现**：

```ts
@injectable()
export class RuntimeConnectionService {
    // 唯一 HTTP client + 一个业务 event socket
    private httpClient: KairoRuntimeClient;
    private eventSocket: WebSocket | null;
    private sequence: number = 0;

    constructor(
        @inject(RuntimeConfig) private config: RuntimeConfig
    ) {
        this.httpClient = new KairoRuntimeClient(config.baseUrl, config.secret);
    }

    // HTTP 自动添加 X-Kairo-Secret header
    get client(): KairoRuntimeClient { return this.httpClient; }

    // 一个 workspace 只维持一个业务 EventStream
    connectEvents(workspaceId: string): EventStream {
        // 如果已有 socket 且 workspaceId 相同，复用
        // 如果 workspaceId 不同，关闭旧 socket 并创建新
    }

    // reconnect 使用 exponential backoff + full jitter + sequence replay
    private reconnect() { ... }
}
```

**实现要求**：
1. 删除固定 `18099` 的重复实现
2. `KairoRuntimeImpl`、EventStream、WorkspaceContext 合并为一个 DI-managed singleton 组合
3. 配置必须在 Frontend contributions 启动前注入（baseUrl + localSecret）
4. HTTP 自动添加 `X-Kairo-Secret`，但日志、错误、telemetry 永不输出值
5. 一个 workspace 只维持一个业务 EventStream，由 stores 订阅；视图不得各自创建 socket
6. reconnect 使用 exponential backoff + full jitter + sequence replay
7. disconnected 与 empty state 分开建模

### 1.2 WorkspaceContext 与 ActiveProject

**修改文件**：
- `packages/runtime-extension/src/browser/workspace-context-service.ts`
- `packages/project-extension/src/browser/active-project-service.ts`

**目标实现**：

```ts
@injectable()
export class WorkspaceContextService {
    currentWorkspaceId: string | null;

    // 监听 Theia WorkspaceService 的 root change
    onWorkspaceRootChange(roots: FileStat[]): void {
        // 首次打开 root 时调用 Agent 创建/获取 Kairo workspace
        // 设置 runtime workspace header
    }
}

@injectable()
export class ActiveProjectService {
    activeProject: Project | null;

    // 加载 projects：
    //   0 个 → 打开 Import Wizard
    //   1 个 → 自动选中
    //   多个 → QuickPick，并持久化上次选择
    async loadProjects(workspaceId: string): Promise<void> { ... }

    // 使用 Theia StorageService 保存 {workspaceId → projectId}
    async selectProject(projectId: string): Promise<void> { ... }

    // 所有 Build/Deploy/Server/Encoding command 依赖此方法
    async requireProject(): Promise<Project> {
        if (!this.activeProject) throw new Error('No project selected');
        return this.activeProject;
    }
}
```

**实现要求**：
1. 监听 Theia WorkspaceService 的 root change
2. 项目删除/切换 workspace 时清理旧选择
3. `requireProject()` 错误信息一致
4. 多项目选择持久化到 Theia StorageService

### 1.3 Import Wizard 真正保存

**修改文件**：`packages/project-extension/src/browser/import-wizard-widget.tsx`

**当前问题**：N-027："Save Configuration" 只执行 `setStep(4)`，用户填写的配置从未保存。

**目标步骤**：

```tsx
// Step 1: 选择或使用当前 workspace root
// Step 2: Agent scan → 显示 Ant/build.xml、source roots、web root、encoding、web.xml、JDK/Tomcat 探测
// Step 3: 用户编辑配置
// Step 4: 调用 Project save/import API
// Step 5: 重新 GET project 校验落盘值
// Step 6: 设置 ActiveProject
// Step 7: 关闭 wizard，刷新 views（无需整页 reload）
```

**实现要求**：
1. 保存失败停留在配置页并显示具体错误
2. 不吞异常
3. 项目路径显示但执行路径不从表单提交
4. 表单有 label、keyboard、ARIA、`data-testid`
5. 添加已有 `.legacyflow` migration 场景
6. 完成动作不再 `window.location.reload()`

### 1.4 Store + ReactWidget 替换旧 UI

**修改文件**：
- `packages/build-extension/src/browser/build-store.ts`
- `packages/build-extension/src/browser/build-view-widget.tsx`
- `packages/tomcat-extension/src/browser/server-store.ts`
- `packages/tomcat-extension/src/browser/server-view-widget.tsx`

**当前问题**：N-029：新 Widget 和 Store 多数只绑定 self，没有 WidgetFactory/ViewContribution，且旧 Kairo widgets 仍在实际产品中，形成两套 UI。

**目标实现步骤**：

1. **BuildStore/ServerStore** 在连接后先 GET snapshot，再 apply sequence events
2. **reducer 对重复/乱序事件幂等**
3. **新 widgets 注册** WidgetFactory、ViewContribution、command、toolbar
4. **删除旧 widgets**：`KairoBuildsWidget`、`KairoServersWidget` 等（或迁移其 ID）
5. **Log viewer 消费真实 log events**：
   - 内存上限 1000-2000 条
   - 50-100ms batch 刷新
   - 仅渲染最近/可见记录
   - pause/autoscroll/clear
   - 丢事件后提示并 snapshot/reload
6. **所有 action** 体现 busy/disabled/error，不允许用户连续启动重复任务

### 1.5 修复 Restart UI

**修改文件**：`packages/theia-product/src/main/browser/kairo-views-contribution.ts`

**当前问题**：N-030：Restart 命令仍逐个调用 Stop，并没有 Restart/Start。

**目标**：
```ts
// 旧（错误）
async restartServer() {
    await this.stopServer();
    await this.startServer();
}

// 新（正确）
async restartServer() {
    const project = await this.activeProject.requireProject();
    await this.client.post(`/api/v1/servers/${serverId}/restart`, { projectId: project.id });
}
```

### 1.6 修复错误处理

**修改文件**：`packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts`

**当前问题**：N-031：server 状态错误通过 rejection handler 转为空数组，断线被伪装成"无服务器"。

**目标**：
- `.catch(() => [])` 全部替换为显式错误处理
- 区分三种状态：loading、disconnected、empty
- 状态栏显示 "Disconnected" 而非 "0 servers"
- 错误信息显示在状态栏而非静默吞掉

### 1.7 修复 product bindings

**修改文件**：`packages/theia-product/src/main/product-bindings.ts`

**当前问题**：N-035：Runtime、Workspace、ActiveProject、Theme 在多个模块重复 bind/rebind，缺少唯一 composition root。

**目标**：
- 所有 service 在新 KairoProductFrontendModule 中**唯一绑定**
- 删除重复的 `WidgetManager` 绑定
- 确保 `KairoRuntimeModule` 被 load
- 使用 `bind(KairoProduct).toSelf().inSingletonScope()` 而非重复 bind

### 1.8 Theme 收敛

**修改文件**：
- `packages/ui-kit/src/browser/tokens.ts`
- `packages/ui-kit/src/browser/kairo-theme-contribution.ts`
- `packages/ui-kit/src/browser/kairo-theme.css`
- `packages/ui-kit/src/browser/kairo-ui-contribution.ts`

**当前问题**：N-034：`tokens.ts`、`KAIRO_DARK_VARS`、CSS 三份主题来源并存；MutationObserver 强制暗色。

**目标**：
1. 选择 `tokens.ts` 为**唯一品牌 token 源**，生成 CSS variables
2. 删除 `KAIRO_DARK_VARS` 和 CSS 的重复硬编码
3. Theme contribution 正常 register/activate，CSS 确实被加载
4. v1 默认 Kairo Dark，但不使用 MutationObserver，不阻止用户切换 Theia 其他主题
5. 删除 1876 行全局 `!important` 覆盖

---

## 2. Wave 3 Gate Checklist

- [ ] 使用真实 Theia container 的 integration test 证明 services/contributions/widget factories 只有一个实例
- [ ] Import Wizard 保存后无需 reload 即可 Build
- [ ] 多项目选择持久化到 StorageService
- [ ] Runtime 断开时显示 disconnected，不显示 "0 servers"
- [ ] Restart command 调用 `/restart` endpoint 并验证新 PID
- [ ] event socket 数量可观测且每 workspace 为 1
- [ ] 旧 KairoBuildsWidget/KairoServersWidget 已删除或迁移
- [ ] Log viewer 显示真实日志（非演示数据）
- [ ] 所有 `.catch(() => [])` 已替换
- [ ] Theme 从唯一 token 源加载，CSS 确实被加载

---

## 3. 具体文件变更清单

| 文件 | 动作 | 说明 |
|------|------|------|
| `packages/runtime-extension/src/browser/runtime-connection-service.ts` | 重写 | 唯一 singleton 连接 |
| `packages/runtime-extension/src/browser/runtime.ts` | 重写 | 删除重复 EventStream，合并入 connection service |
| `packages/runtime-extension/src/browser/workspace-context-service.ts` | 重写 | 对接 Kairo workspace |
| `packages/project-extension/src/browser/active-project-service.ts` | 重写 | 真初始化、持久化、自动选择 |
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 重写 | 真保存，不吞异常，不 reload |
| `packages/build-extension/src/browser/build-store.ts` | 重写 | snapshot + event reducer |
| `packages/build-extension/src/browser/build-view-widget.tsx` | 重写 | ReactWidget，注册 ViewContribution |
| `packages/tomcat-extension/src/browser/server-store.ts` | 重写 | snapshot + event reducer |
| `packages/tomcat-extension/src/browser/server-view-widget.tsx` | 重写 | ReactWidget，注册 ViewContribution |
| `packages/tomcat-extension/src/browser/log-viewer-widget.tsx` | 重写 | 真实日志，窗口化渲染 |
| `packages/theia-product/src/main/browser/kairo-views-contribution.ts` | 修正 | Restart 调 restart endpoint，删除旧 widgets |
| `packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts` | 修正 | 区分 connected/disconnected/empty |
| `packages/theia-product/src/main/product-bindings.ts` | 修正 | 唯一 composition root |
| `packages/ui-kit/src/browser/tokens.ts` | 修正 | 唯一品牌 token 源 |
| `packages/ui-kit/src/browser/kairo-theme-contribution.ts` | 修正 | 正常 Theia Theme 注册 |
| `packages/ui-kit/src/browser/kairo-ui-contribution.ts` | 重写 | 删除 MutationObserver 和 1876 行强制 CSS |
| `packages/ui-kit/src/browser/kairo-theme.css` | 精简 | 只保留品牌色 CSS variables |