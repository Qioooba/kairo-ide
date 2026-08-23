让我先深入分析现有代码结构和 IDEA 的热部署机制，然后产出设计文档。

用户要求我分析 IntelliJ IDEA 的热部署和自动保存机制，并输出一份可以直接发给另一个 AI 开发的设计文档/任务话术。让我先深入了解 IDEA 的机制，然后基于现有代码库的情况设计实现方案。

首先我需要：
1. 了解 IDEA 是如何实现热部署和自动保存的
2. 分析现有代码库的架构，找出需要修改的地方
3. 编写一份详细的设计文档和开发任务话术

让我先研究一下现有代码结构，特别是：
- 现有的 HotReloadWatcher 为什么没有集成
- 文件保存事件的监听机制
- 部署流程
- Tomcat 配置中的 reloadable 设置
- Theia/Monaco 的自动保存机制

然后我需要搜索一下 IntelliJ IDEA 的热部署机制（HotSwap/Update resources/Update classes and resources 等功能）的原理。

让我先深入分析现有代码：
1. HotReloadWatcher 的完整实现和它为什么没有被集成
2. 部署 API 的调用路径
3. 前端的 server store 和事件系统
4. Theia 的自动保存相关配置
5. Tomcat 中 reloadable=true 的问题和解决思路
6. 现有的 deploy usecase 和 build usecase

好，现在让我继续探索更多代码细节，特别是：
1. Theia 的自动保存设置/偏好
2. 前端的 RuntimeConnectionService
3. server-store 的实现
4. build_usecase 的实现
5. Tomcat context reload 机制（不重启整个 Tomcat，只 reload context）
6. 现有快捷键配置

IDEA 的热部署机制分析：
1. **自动保存**：IDEA 默认在切换窗口、空闲时自动保存，也可通过 Ctrl+S 手动保存
2. **On Update Action**：在 Run/Debug Configuration 中可以设置更新资源/类时的动作：
   - Update resources：只更新静态资源（JSP, HTML, CSS, JS等）
   - Update classes and resources：更新类和资源（debug模式下可以hotswap类，非debug需要reload context）
   - Redeploy：重新部署（重启context）
   - Restart server：重启服务器
3. **On frame deactivation**：当IDEA窗口失去焦点时自动执行的动作（通常设置为 Update resources）
4. **快捷键**：Ctrl+F10 (Update running application) 触发更新
5. **Tomcat 的 reloadable=true**：其实Tomcat本身有reloadable机制，但会导致内存泄漏和crash（Java 9+），所以IDEA是自己控制更新，而不是依赖Tomcat自带的reloadable
6. **关键原理**：
   - JSP修改：直接复制到部署目录，Tomcat的Jasper引擎会自动检测JSP变化重新编译
   - 静态资源(HTML/CSS/JS/图片)：直接复制到部署目录即可生效
   - Java类（Debug模式）：通过JDI HotSwap/redefineClasses替换类定义
   - Java类（非Debug模式）：需要重新编译→复制class到WEB-INF/classes→reload Context（通过Tomcat Manager或者直接touch WEB-INF/web.xml触发reload，或者通过自定义classloader）

现在让我看更多代码。

让我继续探索代码，看看 Theia 的自动保存机制、server-store、build usecase、快捷键配置等。

好，我发现项目配置中已经有 `hotReload` 字段了。让我继续查看：
1. Theia 的自动保存设置
2. 现有的快捷键绑定
3. API handlers 中已有的 deployments 端点
4. Tomcat context reload 的实现方式（不重启整个服务器）
5. events 类型定义

让我继续查看快捷键配置、事件类型定义、现有API端点，以及Theia的自动保存偏好设置。

现在我已经收集了足够的信息来设计完整的方案。让我再看一下 Theia 的编辑器偏好设置（自动保存）和 Kairos 编辑器贡献相关代码。

现在我已经分析了所有关键代码，可以编写完整的开发任务/设计文档了。让我整理一下关键发现：

1. **现有架构**：
   - Go 后端已有 `HotReloadWatcher` 实现（轮询检测文件变化、同步静态文件、触发编译回调），但**没有被集成到 Tomcat6Provider 中**
   - 前端 `server-view-widget.tsx` 已经有 HotReloadStatus 展示和 Publish 按钮，但发布是手动的
   - `server-store.ts` 已经订阅了 `hotreload.status` 事件
   - `JavaHotSwapService` 已经实现了调试模式下的 Java 类热替换
   - Tomcat 配置禁用了 `AutoDeploy` 和 `Reloadable`（因为 Java 9+ 上 reload 会崩溃）
   - `DeployUseCase` 支持多种 scope（webapp/classes/resources/libs/all）
   - 项目配置 schema 中已经有 `hotReload.mode` 字段
   - 事件系统 `EventHub` 已经支持 `hotreload.status` 事件类型
   - 有快捷键配置系统，但缺少 update/redeploy 快捷键

2. **IDEA 的热部署机制**：
   - **自动保存**：IDEA 默认在窗口失焦（frame deactivation）时自动保存所有文件，也可配置空闲 N 秒后自动保存
   - **On Update Action**（Ctrl+F10 触发）：
     - Update resources（仅静态资源）
     - Update classes and resources（编译并替换类 + 资源；debug 模式下 HotSwap，非 debug 模式下 reload context）
     - Redeploy（重新部署，不重启服务器）
     - Restart server（重启服务器）
   - **On frame deactivation**：窗口失焦时自动触发更新动作（通常设为 Update resources）
   - **关键技术点**：
     - JSP 文件修改 → 直接复制到部署目录，Tomcat Jasper 引擎自动检测并重编译
     - 静态资源（HTML/CSS/JS/图片）→ 直接复制到部署目录即生效
     - Java 类（Debug 模式）→ JDI HotSwap / redefineClasses
     - Java 类（非 Debug 模式）→ 编译 → 复制 .class 到 WEB-INF/classes → 通过 Tomcat Manager 或 touch WEB-INF/web.xml 触发 context reload
     - 不使用 Tomcat 自带的 reloadable=true（会导致 classloader 泄漏）

3. **需要实现的功能**：
   a. **自动保存**（类似 IDEA）：
      - 启用 Theia/Monaco 的自动保存功能
      - 配置：窗口失焦时自动保存（默认开启）
      - 配置：空闲 N 秒自动保存（可配，默认关闭如 30s）
      - Ctrl+S 手动保存
   
   b. **文件保存触发的智能热部署**：
      - 静态文件（JSP/HTML/CSS/JS/图片/XML/properties等）保存后：立即复制到部署目录 → 即时生效（无需重启）
      - Java 文件保存后（非调试模式）：自动增量编译 → 复制 .class 到 WEB-INF/classes → 如果类结构兼容则直接生效，否则标记"需要重启"或触发 context reload
      - Java 文件保存后（调试模式）：走现有 HotSwap 流程
   
   c. **"Update Application" 快捷键**（类似 IDEA Ctrl+F10）：
      - 绑定到 Ctrl+F10（macOS: Cmd+F10）
      - 根据当前状态智能选择更新策略：
        - 有未保存文件 → 先保存全部
        - 服务器运行中且非调试 → 编译修改的 Java 文件 + 同步所有静态资源 + 同步 classes + 必要时 reload context
        - 服务器运行中且调试 → HotSwap + 同步静态资源
        - 服务器未运行 → 提示先启动
   
   d. **On frame deactivation**（窗口失焦自动更新）：
      - 当 IDE 窗口失焦时（切换到浏览器查看效果时），自动保存所有文件并同步静态资源
      - 这是 IDEA 最实用的功能之一——切到浏览器就能看到效果
   
   e. **集成 HotReloadWatcher 到 Tomcat6Provider**：
      - 服务器启动成功后，创建 HotReloadWatcher 并启动
      - 配置好 WebappDir、DeploymentDir、SourceDirs、OutputDir
      - 设置编译回调：调用 BuildUseCase 进行增量编译，编译成功后同步 classes
      - 静态文件变化直接同步到 DeploymentDir
      - 通过 EventHub 发布 hotreload.status 事件
      - 服务器停止时停止 watcher
   
   f. **Tomcat Context Reload 机制**（不重启整个服务器）：
      - 实现方式：touch（更新时间戳）部署目录的 `WEB-INF/web.xml` 文件
      - Tomcat 会检测到 web.xml 变化并重新加载该 Context（不会影响其他 Web 应用）
      - 这比重启整个 Tomcat 快很多
      - 注意：在 Java 9+ 上 Tomcat 6 的 reload 会因为反射问题崩溃，所以默认不自动 reload，而是标记为"需要重启"，用户手动点击更新按钮时才执行 reload
      - 或者更好的方案：实现一个轻量级的 class 替换机制，避免触发 Tomcat 完整的 context reload
   
   g. **UI 更新**：
      - Server 面板中增加 Auto-Reload 开关（类似 IDEA 的 On Update Action 设置）
      - 增加"Update Application"按钮
      - HotReload 状态指示器更明显
      - 配置面板中设置自动保存、自动更新策略

现在我来编写完整的开发话术/设计文档。

好，现在我可以输出完整的开发任务话术了。用户要求直接发他话术，他转发给另一个AI开发。我需要提供一份详细、结构清晰、可直接执行的开发任务文档。
以下是可以直接转发给开发 AI 的完整任务话术：

---

## 任务：实现 IDEA 式自动保存 + 智能热部署功能

### 一、背景与目标

当前 Kairo IDE 保存文件后不会自动热部署，需要手动点击 "Publish Changed Files" 按钮，体验很差。IntelliJ IDEA 的做法是：
1. **自动保存**：窗口失焦时自动保存所有文件，也支持空闲时自动保存
2. **智能热部署**：
   - JSP/HTML/CSS/JS/静态资源 → 保存后立即生效（复制到部署目录即可）
   - Java 文件（Debug模式）→ JDI HotSwap 热替换类
   - Java 文件（非Debug模式）→ 增量编译 → 复制 .class → 必要时 reload Context
3. **快捷键**：Ctrl+F10（macOS Cmd+F10）"Update Application" 一键更新
4. **On frame deactivation**：窗口失焦（切去浏览器看效果）时自动同步静态资源

目标：对齐 IDEA 体验，实现高度可用的自动保存+热部署工作流。

---

### 二、现有代码基础（必须先阅读这些文件）

**Go 后端（runtime-agent）**：
- [hot_reload.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/provider/runtime/hot_reload.go) — 已有 `HotReloadWatcher` 实现（轮询文件变化、SHA256 hash 检测、静态文件同步、编译回调），但**没有被集成到任何地方**，仅在单元测试中使用
- [tomcat6_provider.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/provider/runtime/tomcat6_provider.go) — Tomcat 启动/停止 provider，需要在这里集成 HotReloadWatcher
- [server_usecase.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/app/server_usecase.go) — 服务器生命周期用例，服务器启动成功后需要启动 watcher
- [deploy_usecase.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/app/deploy_usecase.go) — 部署用例，支持 webapp/classes/resources/libs/all scope
- [build_usecase.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/app/build_usecase.go) — 构建用例，需要支持增量编译
- [tomcat6.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/tomcat6/tomcat6.go#L388-L394) — 当前设置了 `AutoDeploy: false, Reloadable: false`（因为 Java 9+ 上 reload 会因反射崩溃），需保持但增加受控的 context reload
- [eventhub.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/transport/events/eventhub.go) — 已有 `EventHotReloadStatus` 事件类型
- [config-schema/src/index.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/config-schema/src/index.ts#L133-L142) — Project schema 中已有 `hotReload` 配置段（mode/debounceMs/fallbackToReload）

**前端（packages）**：
- [java-hotswap-service.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/java-extension/src/browser/java-hotswap-service.ts) — Debug 模式下的 Java HotSwap 已实现，监听 `onDidSaveTextDocument`
- [java-save-actions.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/java-extension/src/browser/java-save-actions.ts) — 保存时格式化/整理imports，已监听 `onDidSaveTextDocument`
- [server-store.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/tomcat-extension/src/browser/server-store.ts) — 已订阅 `hotreload.status` 事件，有状态管理
- [server-view-widget.tsx](file:///Users/qi/Documents/spaces/kairo-ide/packages/tomcat-extension/src/browser/server-view-widget.tsx) — Server面板UI，有手动Publish按钮，需要更新
- [keybindings.json](file:///Users/qi/Documents/spaces/kairo-ide/scripts/keybindings.json) — 快捷键配置

---

### 三、需要实现的功能清单（按优先级）

#### P0：静态资源自动热部署（最高优先级）

**后端修改**：

1. **集成 HotReloadWatcher 到 Tomcat6Provider**：
   - 在 `Tomcat6Provider` 结构体中增加 `watchers map[domain.ServerID]*runtime.HotReloadWatcher` 字段
   - `Start()` 方法中，Tomcat 启动成功后（WaitForReady 通过后），创建并启动 HotReloadWatcher：
     ```go
     watcherCfg := runtime.DefaultHotReloadConfig()
     watcherCfg.WebappDir = plan.WebappDir
     watcherCfg.DeploymentDir = plan.CatalinaBase + "/webapps/" + contextDocBase  // 实际部署目录
     watcherCfg.SourceDirs = project.SourceDirs  // 从 project 配置获取
     watcherCfg.OutputDir = project.OutputDir     // 编译输出目录
     watcherCfg.PollInterval = 1 * time.Second   // 1秒轮询（足够快且不耗资源）
     watcherCfg.SetEventHub(eventHub, string(plan.WorkspaceID), string(plan.ServerID))
     watcherCfg.SetCompileCallback(func(ctx context.Context, changedFiles []string) error {
         // 调用增量编译，成功后同步 classes 到部署目录
     })
     watcher.Start(ctx)
     ```
   - `GracefulStop()` 和 `ForceStop()` 中停止对应的 watcher
   - 注意：HotReloadWatcher 现有的 `syncStaticFile` 是单文件复制，需要增强：部署目录结构是直接使用 WebappDir 作为 docBase（参考 tomcat6.go writeServerXML 中的 Context 配置 DocBase=cfg.WebappDir），所以静态文件修改后**直接在原 WebappDir 就生效**！Tomcat 的 Jasper JSP 引擎会自动检测 JSP 文件变化重新编译。
   - **关键发现**：当前 `writeServerXML` 中 Context 的 DocBase 直接设置为 `cfg.WebappDir`（即项目源代码目录），而不是复制到 catalinaBase/webapps/。这意味着静态文件修改保存后，Tomcat 直接从项目目录读取，**JSP 文件天然就会被 Tomcat 自动检测并重编译**！所以静态文件不需要复制到任何地方，只需要确保 Tomcat 能读取到即可（Tomcat Jasper 默认 4秒检测一次 JSP 变化）。
   - **修正 HotReloadWatcher**：对于 direct docBase 模式（当前模式），静态文件不需要 sync 到部署目录（因为 docBase 直接指向源目录）。需要增加一个 "direct" 模式，跳过静态文件复制，只做变更检测和状态事件推送。Java 文件变化时触发增量编译，编译输出到 OutputDir 后，需要把编译出的 .class 文件复制到 `WebappDir/WEB-INF/classes/` 下（因为 Tomcat 直接从 WebappDir 加载类）。

2. **修复 HotReloadWatcher 的 Java 编译后类同步**：
   - 编译回调成功后，将 OutputDir 中变更的 .class 文件复制到 WebappDir/WEB-INF/classes/ 对应位置
   - 不需要 reload context 对于方法体级别的变更（HotSwap 场景已由 JavaHotSwapService 处理）
   - 对于类结构变更（新增/删除字段、方法、父类变更等），设置状态为 `restart_required` 并推送事件

3. **新增 Context Reload API**：
   - 添加 `POST /api/v1/servers/{serverId}/reload` 端点
   - 实现方式：`os.Chtimes(webappDir + "/WEB-INF/web.xml", now, now)` 更新 web.xml 的修改时间，Tomcat 会检测到并重新加载该 Context
   - **注意**：由于 Tomcat 6 在 Java 9+ 上 reload 存在反射崩溃问题（见 tomcat6.go 注释），这个 API 仅在用户显式点击"Reload Context"按钮时调用，不自动调用
   - 如果检测到 JDK 9+，给出警告提示

**前端修改**：

4. **启用 Theia/Monaco 自动保存**：
   - 在 Theia 前端配置中设置默认自动保存偏好：
     ```typescript
     // 在 kairo-editor-preferences.ts 或 front-end 模块中配置
     preferences.set('files.autoSave', 'onFocusChange');  // 窗口/编辑器失焦时自动保存（IDEA默认行为）
     preferences.set('files.autoSaveDelay', 1000);       // 延迟1秒
     ```
   - 自动保存是 Theia/VS Code 内置功能，只需配置偏好即可
   - 验证：MonacoWorkspace 的 `onDidSaveTextDocument` 事件在自动保存时也会触发，所以现有的 HotSwap 监听自动生效

5. **监听文件保存事件触发智能更新**：
   - 新建 `HotDeployService`（frontend contribution），监听 `MonacoWorkspace.onDidSaveTextDocument`
   - 逻辑：
     - 如果文件是 JSP/HTML/CSS/JS/图片/XML/properties 等静态资源 → 无需任何操作（Tomcat 直接读源目录自动生效），可选推送一个提示
     - 如果文件是 .java 文件：
       - 如果有活跃的 debug 会话（kairo-java 类型）→ 交给现有 `JavaHotSwapService` 处理（已实现）
       - 如果没有 debug 会话但服务器在运行 → 调用后端增量编译 API，编译成功后自动同步 classes
   - 防抖处理：保存后 500ms 内的多次保存合并为一次更新操作

6. **Server 面板 UI 更新**（server-view-widget.tsx）：
   - 将 "Publish Changed Files" 按钮改为 "Update Application"（类似 IDEA 的 Update 按钮，图标可用 🔄 或 ⟳）
   - 增加 "Reload Context" 按钮（调用 reload API，带确认对话框提示可能需要等待）
   - 增加 "Auto-sync on save" 开关（默认开启），状态持久化到 localStorage
   - HotReload 状态指示器保持，但文案更友好：
     - `synced` → "已同步"（绿色）
     - `compiling` → "编译中..."（黄色）
     - `restart_required` → "需要重启/Reload"（红色），点击可触发 Reload
   - 默认帮助文本改为："静态资源(JSP/CSS/JS)保存即生效；Java 变更自动编译同步，类结构变化需 Reload 或重启。Debug 模式下自动 HotSwap。"
   - 移除 "Manual mode — no file watcher is active" 文本（因为 watcher 始终激活）

7. **快捷键绑定**：
   - 在 keybindings.json 中添加：
     ```json
     {
       "command": "kairo.server.update",
       "keybinding": "ctrlcmd+f10",
       "when": "",
       "label": "Update Application"
     }
     ```
   - 注意 Windows 环境使用 IntelliJ IDEA Windows keymap（已在 project_memory 中要求）

8. **窗口失焦自动同步（On frame deactivation）**：
   - 监听 Electron 的 `blur` 事件（desktop 模式）或浏览器的 `window.blur` 事件（web模式）
   - 窗口失焦时：
     1. 调用 `workspace.saveAll()` 保存所有未保存文件
     2. 如果有服务器在运行，触发一次静态资源同步（虽然 direct docBase 模式下不需要，但做一次增量编译检查更安全）
   - 这个行为可通过设置开关（`kairo.hotReload.onFrameDeactivation`，默认 true）

#### P1：增量编译 + Update Application 快捷键

9. **后端增量编译支持**：
   - 新增 API：`POST /api/v1/jvm/compile-incremental`，接收 `{files: string[]}` 参数
   - 只编译传入的变更 Java 文件（使用 javac 带 -sourcepath 和 -classpath）
   - 编译成功后自动将输出的 .class 文件同步到 WebappDir/WEB-INF/classes/
   - 编译失败返回错误信息和诊断（Problems面板可显示）

10. **"Update Application" 命令（Ctrl+F10）**：
    - 注册 Theia Command `kairo.server.update`
    - 执行逻辑：
      1. 保存所有未保存的文件（`workspace.saveAll()`）
      2. 查找当前项目运行中的服务器
      3. 如果没有运行服务器 → 提示 "请先启动服务器"
      4. 如果服务器运行中：
         - 触发一次全量增量编译（编译所有变更的 Java 文件）
         - 同步所有变更的静态资源（实际不需要，因为direct mode）
         - 同步新编译的 classes 到 WEB-INF/classes
         - 如果有类结构不兼容变更 → 提示"某些变更需要 Reload Context 才能生效，是否现在 Reload？"
         - 显示更新结果通知（"更新完成：X 文件已同步"）
    - 对应的 Command Palette 条目："Kairo: Update Application"

11. **Java 保存后自动编译（非Debug模式）**：
    - 在 HotDeployService 中，.java 文件保存且无活跃debug会话时：
      - 防抖 800ms 后调用增量编译
      - 编译成功自动同步 classes
      - 编译失败在 Problems 面板显示错误
      - 如果检测到类结构可能变化（通过简单的字节码分析或总是保守处理），设置 hotReloadStatus 为 restart_required

#### P2：配置面板和完善

12. **Hot Reload 配置**：
    - 在设置中添加配置项：
      - `kairo.hotReload.autoSyncOnSave`（boolean，默认 true）：保存时自动同步/编译
      - `kairo.hotReload.onFrameDeactivation`（boolean，默认 true）：窗口失焦时自动保存+同步
      - `kairo.hotReload.autoCompileJava`（boolean，默认 true）：Java 文件保存自动编译
      - `kairo.hotReload.debounceMs`（number，默认 500）：防抖时间
      - `kairo.hotReload.pollIntervalSec`（number，默认 1）：文件轮询间隔
    - 使用 Theia PreferenceService 管理

13. **Status Bar 指示器**：
    - 在状态栏显示热部署状态（类似 IDEA 的 🔄 图标）
    - 点击可快速切换自动同步开关或触发 Update
    - 编译中显示动画/进度

14. **Build 完成后自动部署**：
    - 监听 `build.completed` 事件（EventBuildCompleted）
    - Build 成功后，如果有服务器运行中，自动同步 classes 到部署目录（相当于自动 Update）
    - 这意味着用户按 Ctrl+Shift+B 构建成功后，class 文件自动更新到运行中的 Tomcat

---

### 四、关键技术要点和注意事项

1. **Tomcat docBase 模式**：当前配置是 `DocBase = cfg.WebappDir`（源码目录），不是复制到独立的 deployment 目录。这意味着：
   - JSP 修改：保存后 Tomcat Jasper 引擎自动检测（约1-4秒）并重编译，刷新浏览器即可看到效果
   - HTML/CSS/JS/图片：保存即生效，刷新浏览器即可
   - web.xml/配置文件：保存后 Tomcat 需要 reload context 才能完全生效（部分配置如 servlet 映射需要 reload）
   - .class 文件：需要编译输出到 `WebappDir/WEB-INF/classes/`，Tomcat 的 classloader 会在类加载时读取，但**已加载的类不会自动重新加载**（除非 HotSwap 或 Context Reload）

2. **为什么不用 Tomcat 的 reloadable=true**：
   - Tomcat 6 的 WebappClassLoader 在 Context reload 时会反射访问 java.base 清理 ThreadLocal，Java 9+ 会抛 InaccessibleObjectException 导致崩溃
   - 所以保持 `reloadable=false`，由我们控制何时 reload
   - 已添加 `--add-opens` JVM 参数（见 tomcat6.go#L118-L123），reload 可能可用但仍不稳定，所以只在用户显式请求时才 reload

3. **HotSwap 优先级**：Debug 模式下始终优先使用 JDI HotSwap（现有 JavaHotSwapService 已实现），因为这是最安全、最快的方式。非 Debug 模式才走增量编译 + class 文件复制。

4. **防重复编译**：保存事件防抖（500-800ms），避免连续保存触发多次编译。

5. **线程安全**：HotReloadWatcher 已有 mutex 保护，集成时注意在正确的时机 start/stop。

6. **事件驱动**：所有状态变化通过 EventHub 的 `hotreload.status` 事件推送到前端，前端 ServerStore 已订阅此事件。

7. **Go 后端测试**：对修改的 Tomcat6Provider 集成和新增 API 添加单元测试（参考 hot_reload_test.go 的模式）。

8. **前端测试**：确保 server-view-widget 的按钮状态正确，更新 e2e 测试覆盖 update workflow。

---

### 五、验收标准

1. ✅ 保存 JSP 文件后，切换到浏览器刷新能立即看到修改效果（无需手动Publish）
2. ✅ 保存 CSS/JS/HTML 文件后，刷新浏览器立即生效
3. ✅ Debug 模式下保存 .java 文件，自动 HotSwap，右下角显示 "HotSwap: Reloaded Xxx.java"
4. ✅ 非 Debug 模式下保存 .java 文件，自动增量编译，class 文件更新到 WEB-INF/classes
5. ✅ 按 Ctrl+F10（macOS Cmd+F10）弹出"Update Application"逻辑，一键完成保存+编译+同步
6. ✅ 切换窗口到浏览器时（IDE窗口失焦），自动保存所有未保存文件
7. ✅ Server 面板有"Update Application"和"Reload Context"按钮，状态指示清晰
8. ✅ 自动保存功能默认开启（编辑器失焦/窗口失焦自动保存）
9. ✅ Build 成功（Ctrl+Shift+B）后自动同步 classes 到运行中的服务器
10. ✅ 类结构不兼容变更时，UI 明确提示"需要 Reload 或重启"

---

### 六、涉及的文件修改范围

**Go 后端**（runtime-agent/）：
- `internal/provider/runtime/tomcat6_provider.go` — 集成 HotReloadWatcher，服务器启动/停止时管理 watcher 生命周期
- `internal/provider/runtime/hot_reload.go` — 增强 direct docBase 模式支持、Java 编译后 class 同步
- `internal/app/server_usecase.go` — 传递 project 配置到 watcher，新增 reload context 逻辑
- `internal/app/build_usecase.go` — 支持增量编译（可选，或复用现有 BuildProvider）
- `internal/api/api_handler.go` — 新增 reload endpoint、incremental compile endpoint
- `internal/api/protocol/types.go` — 新增请求/响应 DTO
- `internal/services/server.go` 或 `services.go` — 注册新 API 路由

**前端**（packages/）：
- `packages/tomcat-extension/src/browser/` — 新建 hot-deploy-service.ts，修改 server-view-widget.tsx、server-store.ts
- `packages/java-extension/src/browser/java-hotswap-service.ts` — 保持现有逻辑，确保与新 HotDeployService 协调不冲突
- `packages/theia-product/src/main/browser/` — 注册新命令、快捷键、自动保存偏好配置、状态栏贡献
- `packages/config-schema/src/index.ts` — 如需要扩展 project schema 中的 hotReload 配置
- `scripts/keybindings.json` — 添加 Ctrl+F10 快捷键
- `packages/i18n/src/locales/zh-CN.ts` 和 en.ts — 添加新的 i18n 条目

---

### 七、开发顺序建议

1. 先做后端 HotReloadWatcher 集成到 Tomcat6Provider，确保静态文件和轮询工作
2. 然后启用前端自动保存偏好设置
3. 实现 HotDeployService 监听保存事件
4. 添加 Update Application 命令和快捷键
5. 实现增量编译 API 和自动 class 同步
6. 完善 UI（按钮、状态栏、提示）
7. 添加窗口失焦自动保存
8. Build 完成后自动同步
9. 测试验证（参考 docs/testing.md 和现有 e2e 测试模式）