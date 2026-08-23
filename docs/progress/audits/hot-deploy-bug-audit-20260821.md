我来帮你审核未提交的代码。首先查看未提交的变更内容。
用户要求审核未提交的代码，分析代码问题、功能问题、逻辑问题，但不进行改造，只输出全量问题。

首先我需要：
1. 查看未提交的代码变更（git status 和 git diff）
2. 阅读相关文件
3. 分析潜在问题
4. 整理问题列表

让我先看看git状态和变更。

让我先查看git状态，看看哪些文件被修改了。

好的，有很多变更文件。我需要先查看PLAN.md了解这次要实现的功能，然后逐个查看关键文件的diff。让我先更新todo状态，然后读取PLAN.md和关键文件的diff。

让我先读取PLAN.md了解本次功能，然后查看关键的变更文件。

现在让我查看关键变更文件的内容。首先查看新增的文件和主要修改：


好的，我了解了PLAN的内容。现在让我查看关键的变更文件的diff，以及新文件的内容。我需要重点关注：
1. 新创建的文件：hot-deploy-service.ts, hot_deploy_handlers.go, kairo-agent-config-contribution.ts
2. 主要修改的文件：tomcat6_provider.go, api相关文件, server-store.ts, server-view-widget.tsx, settings-preferences, status-bar等

让我先查看git diff的关键部分。

让我批量读取关键的新增和修改文件。

让我继续读取更多关键文件。

继续查看更多关键文件，特别是前端模块注册、后端API路由注册、server-view-widget、java-hotswap-service等。

让我继续查看更多关键文件：
1. kairo-product-frontend-module.ts - 看看命令是否注册
2. services.go / server.go - API路由是否注册
3. server-view-widget.tsx - UI更新
4. 检查是否有BuildEngine接口实现
5. java-hotswap-service.ts 是否有冲突
6. protocol/src/index.ts 看看导出
7. kairo-editor-preferences.ts 自动保存设置
8. kairo-product-backend-module.ts 后端模块注册

让我继续查看更多关键文件来确认问题：

我发现了一个重大问题！代码库中存在**两个不同的API服务器实现**：
1. 旧的 `Server` 结构体（在server.go中，有handleCompileIncremental和handleServerReload）
2. 新的 `APIHandler` 结构体（在api_handler.go中，有HandleCompileIncremental和HandleServerReload）

而且这两个实现逻辑不一致！让我继续查看server.go和路由注册来确认。

另外我注意到：
1. hot-deploy-service.ts 调用的是 `POST /api/v1/jvm/compile-incremental`，但api_handler.go中HandleCompileIncremental要求files参数不能为空（len(req.Files) == 0时返回错误），而updateApplication()调用时没有传files参数！
2. HotDeployService没有读取PreferenceService的配置，而是直接用localStorage和硬编码值
3. HotDeployService的onWindowBlur没有实际调用saveAll
4. STATIC_EXTENSIONS包含了.ts/.tsx，这些不是静态资源文件！
5. watcher的compile callback是空实现，什么也不做
6. 有两个重复的reload/compile-incremental handler实现
7. 旧的Server struct的handleCompileIncremental从body读projectId，但APIHandler从query读projectId
8. HotDeployService没有检查debug会话状态，与JavaHotSwapService可能冲突

让我继续查看server.go、路由注册以及更多文件。

我已经发现了很多问题。让我继续检查更多文件来确认，特别是：
1. kairo-views-contribution.ts - 看看命令是否注册
2. kairo-editor-preferences.ts - 自动保存设置
3. 检查kairo.server.update和kairo.server.reloadContext命令是否存在
4. java-hotswap-service.ts 看看是否有冲突
5. 旧的hot_deploy_handlers.go和api_handler.go中的HandleCompileIncremental是否是死代码
6. server_usecase.go看看ReloadContext是否实现

让我继续检查更多关键文件来确认问题。

我来继续完成代码审核工作。首先查看git状态和所有未提交的变更，然后进行全面分析。
用户要求审核未提交的代码，找出代码问题、功能问题、逻辑问题，只分析不改造，并且要把全量问题发给他。我需要先查看git状态，了解哪些文件被修改了，然后逐一阅读这些文件进行分析。

让我先查看git状态和diff，了解所有未提交的变更。

Let me check git status and diff to see all uncommitted changes.

好的，我看到有很多修改的文件和新增的文件。让我先获取git diff来查看具体的代码变更，然后逐一阅读关键文件。

让我先查看核心的热部署相关文件，然后逐个分析：


现在让我查看git diff来了解所有变更，然后重点阅读核心的热部署相关文件。我先看新增的核心文件和修改的关键文件。

让我继续阅读其他关键文件：


现在我需要继续阅读其他关键文件，包括server-store.ts、server-view-widget.tsx、kairo-status-bar-contribution.ts、kairo-settings-preferences.ts、server_usecase.go、server.go等文件，以及HotReloadWatcher的实现。

继续阅读其他关键文件，包括kairo-settings-preferences.ts、kairo-views-contribution.ts、server_usecase.go、HotReloadWatcher等文件。

让我查找HotReloadWatcher相关文件并继续阅读其他关键文件：

继续阅读其他关键文件。

让我继续阅读hot_reload.go和其他关键后端文件。

让我继续查看API路由注册和服务接口：

现在让我继续查看其他关键文件，包括API路由注册、services接口定义、JavaHotswapService以及后端服务相关文件，以便进行全面分析。

让我继续查看前端模块绑定和Java hotswap服务：

现在我需要查看前端模块绑定，确保HotDeployService被正确注入，以及查看其他相关文件来完成全面分析。让我继续查看几个关键文件。

让我检查前端模块绑定和handlers.go的路由处理：

现在让我查看前端模块绑定文件，以及检查handlers.go中如何处理servers子路径路由，因为新增了reload端点需要正确路由：

让我查看Go版本和handleServerSub的实现：

我需要查看handlers.go中的handleServerSub函数，确认/reload路由是否正确被处理，因为有两个路由可能冲突：
1. `/api/v1/servers/{serverId}/reload` - 新增的reload端点
2. `/api/v1/servers/` - handleServerSub处理器

Go的http.ServeMux使用最长前缀匹配，所以`/api/v1/servers/{serverId}/reload`应该优先匹配。但是我需要确认这一点，因为Go 1.22之前的ServeMux不支持`{serverId}`这种路径参数语法。让我检查一下。

让我查看go.mod确认Go版本，并查看handleServerSub的实现，看看路由是否会有冲突问题。

让我继续查看handleServerSub中reload case的完整代码：

好的，我看到了问题。Go 1.25确实支持路径参数语法`{serverId}`，但是我注意到一个问题：在routes()函数中同时注册了两个路由：
1. `/api/v1/servers/{serverId}/reload` -> handleServerReload (新注册的)
2. `/api/v1/servers/` -> handleServerSub (旧的)

让我继续看handleServerSub中是否已经有"reload"的处理，以及两个路由是否会冲突。让我继续读handleServerSub的"reload" case部分。

现在我已经阅读了足够多的关键代码。让我整理并输出全量问题列表：


发现了一个问题！在routes()中同时注册了两个reload处理：
1. `/api/v1/servers/{serverId}/reload` -> handleServerReload (新增的独立handler)
2. `/api/v1/servers/` -> handleServerSub，其中也有 `case "reload":` 的处理

这会导致路由冲突！Go 1.22+的ServeMux会根据最长前缀匹配，但这里有一个问题：`/api/v1/servers/{serverId}/reload` 使用了路径参数，而`/api/v1/servers/`是前缀匹配。让我确认一下这个问题。

等等，仔细看一下代码，发现handleServerSub里的case "reload"之前就存在了（看起来是之前就写了reload的处理），而hot_deploy_handlers.go中的handleServerReload是一个新写的重复handler。这会导致路由注册重复或者逻辑重复。

让我继续检查其他问题。现在我已经阅读了足够多的代码，让我开始整理所有发现的问题。

现在我已经完成了代码审查，让我整理所有发现的问题。基于我对代码的分析，我发现了以下问题：

**严重问题（高优先级）：**

1. **路由重复注册冲突**：在`server.go`的routes()中注册了`/api/v1/servers/{serverId}/reload` -> handleServerReload，同时`handlers.go`的handleServerSub中也有`case "reload":`的处理逻辑。Go 1.22+的ServeMux虽然支持路径参数，但两个路由会产生冲突或重复处理。

2. **ReloadContext缺少workspaceID校验**：在`server_usecase.go`的ReloadContext方法中，只接收了serverID参数，但没有校验workspaceID，可能导致跨workspace操作。而`handleServerReload`中从URL解析serverID时也没有关联workspace。

3. **serverID生成方式有碰撞风险**：`server_usecase.go`第122行使用`fmt.Sprintf("srv_%d", time.Now().UnixNano())`生成serverID，理论上在高并发或同一纳秒内启动多个服务器会产生ID碰撞。应该使用UUID。

4. **HotReloadWatcher与前端HotDeployService功能重复且冲突**：后端HotReloadWatcher在轮询文件变化并尝试同步静态文件，但前端注释说"direct docBase mode: no sync needed"，而后端watcher的SetCompileCallback是空实现（直接return nil），导致后端watcher实际上什么都不做但一直在消耗资源轮询。

5. **handleServerReload中ReloadContext调用签名不匹配**：在`hot_deploy_handlers.go`第116行调用`s.Services.ServerRunner.ReloadContext(serverID)`，但ServerRunner接口定义在`services.go`第239行是`ReloadContext(id string) error`，只接收一个string参数。但在`tomcat6_provider.go`第431行`ReloadContext`的签名是`func (p *Tomcat6Provider) ReloadContext(ctx context.Context, serverID domain.ServerID) error`，接收两个参数（ctx和serverID）。这说明ServerRunner接口和Tomcat6Provider实现之间可能存在签名不匹配。

等等，让我再仔细看一下。Tomcat6Provider的ReloadContext确实接收ctx和serverID，但ServerRunner接口的ReloadContext只接收id strin