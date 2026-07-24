# Kairo IDE 已知问题

> 最后更新: 2026-07-24 (Session 3 — 全面交付报告)

## 已解决问题 (RESOLVED)

- ✅ **CR-001 速率限制缺失** — 已实现 per-IP 令牌桶限流中间件 (`internal/api/rate_limiter.go`), 9 测试通过
- ✅ **CR-003 lint 问题** — 已修复
- ✅ **tomcat-extension EBUSY** — 已修复 (rmRetrySync 指数退避重试)
- ✅ **search-extension Monaco ESM** — 已修复 (Monaco mock 兼容)
- ✅ **Go 覆盖率 < 60%** — 已达 64.8%
- ✅ **Go 过期依赖 (golang.org/x/crypto, golang.org/x/net)** — 全部升级至最新版本
- ✅ **theia-product 测试失败** — 8/8 测试通过
- ✅ **前端 TypeScript 类型错误** — 0 错误
- ✅ **前端 Mock 缺失 (Monaco, xterm, p-queue)** — 全部已创建

## 预存测试失败（非本次引入）

- java-extension: `java-language-client-contribution.test.cjs` — 需要先执行 tsc 编译
- search-extension: `search-center-widget.test.cjs` — CSS 导入与 @theia/monaco-editor-core 兼容性
- theia-product: `kairo-commands.test.cjs` — 需要 tsc 编译
- runtime-agent: `TestEncoding_Detect_GBK_HelloJsp` — GBK 检测返回 UTF-8

## Windows 平台测试失败 (2026-07-24 新发现)

| # | 包 | 测试 | 原因 |
|---|-----|------|------|
| 1 | `internal/api` | `TestProjectPut_WritesKairoProjectYAML` | 路径/环境假设 |
| 2 | `internal/api` | `TestServerStart_ResolvesWebappDirFromProject` | 路径/环境假设 |
| 3 | `internal/api` | `TestDeployment_ResolvesSourceAndTargetFromProject` | 路径/环境假设 |
| 4 | `internal/atomicfile` | `TestWriteFile_PreservesPermissions` | Windows 文件权限模型不同 |
| 5 | `internal/atomicfile` | `TestWriteFile_ConcurrentWrites` | Windows 文件锁定行为 |
| 6 | `internal/atomicfile` | `TestWriteFile_ReadOnlyDir` | Windows 只读语义 |
| 7 | `internal/atomicfile` | `TestWriteFile_ReplaceWithDifferentPerms` | Windows 权限模型 |
| 8 | `internal/atomicfile` | `TestSyncDir_Nonexistent` | Windows 文件系统行为 |
| 9 | `internal/deploy` | `TestPreflight_AbsoluteTarget` | Windows 路径处理 |
| 10 | `internal/jdtls` | `TestManager_BuildLaunchDescriptor_NoInstall` | JDT LS 未安装 |
| 11 | `internal/jdtls` | `TestManager_BuildLaunchDescriptor_WithInstall` | JDT LS 未安装 |

> **状态**: 第二轮会话中修复了部分, 但部分测试仍需要 Windows 10 真实环境验证。macOS 上 31/31 全部通过。

## 代码质量问题 (2026-07-24 — 渐进式改进中)

- `internal/tomcat6/tomcat6.go:516` — `Logger` 字段使用 `interface{}` 而非类型化接口（High）— **已识别, 待重构**
- `internal/transport/events/eventhub.go:36` — `Event.Data` 使用 `interface{}`（Medium）— **已识别, 待重构**
- 119 处 `any` 类型使用分布在 44 个 TypeScript 文件中（Medium）— **已识别, 开始减少**
- 19 处 `interface{}` 使用在 Go 代码中（Medium）— **已识别, 开始减少**

## 性能门禁问题 (2026-07-24 — 部分解决)

- ~~空闲 CPU 门禁：目标 3% 但测量的是脚本运行期间 CPU 而非 IDE 空闲 CPU（误报）~~ — **已识别, 待调整目标**
- Windows 搜索首批结果比 macOS 慢 ~10x（`find` 命令性能差异）— **已识别, 建议 ripgrep 替代**
- 首次/后续 Java completion 门禁需要 Go agent 运行才能测量 — **待完整 IDE 环境**

## 供应链问题 (2026-07-24 — 已解决)

- ✅ ~~`golang.org/x/crypto` v0.14.0 → v0.54.0（严重过期）~~ — **已升级**
- ✅ ~~`golang.org/x/net` v0.17.0 → v0.57.0（严重过期）~~ — **已升级**
- ✅ ~~所有 `golang.org/x/*` 系列过期~~ — **已批量升级**
- ⚠️ `@axe-core/playwright` 和 `axe-core` 标记为 missing（未安装）— **待安装**
- ⚠️ TypeScript 5.5.4 → 7.0.2 存在破坏性变更风险 — **待评估**

## 实验性功能

- **Class HotSwap**: 标记为实验性，仅 JDK 6 HotSpot 支持方法体修改
- **JSP 断点**: 需要开启 `kairo.jsp.debugBreakpoints` flag
- **远程 JDWP 隧道**: 需要 SSH 配置
- **Oracle SQL**: 需要 Oracle Instant Client
- **遥测**: 默认禁用，需手动 opt-in
- **性能采样**: 仅显示在状态栏，无历史记录
- **升级检查**: 需要配置升级端点

## 平台限制

- Windows 10 环境下功能未验证（所有开发和测试在 macOS 上完成）
- JDK 6 + Tomcat 6 真实环境未验证
- 离线/代理环境未测试
- 杀毒软件实时扫描影响未评估

## 性能限制

- 大项目 (>10k 文件) 索引进度可能较慢
- 首次 JDT LS 启动可能需要 30-60s
- 大文件 (>1MB) 使用降级模式

## 本次会话新发现 (2026-07-24 Round 3)

- theia-product composition test 预存环境问题（需要完整 Theia 依赖树）
- jdtls 2 个测试需要 JRE 17+ 环境
- Wave 1-2 LSP 端到端验证需要 JDT LS 运行环境（代码已存在, 待验证）
- Wave 3.1 Debug 端到端需要 JDK 6 + Tomcat 6 + JDWP 环境（代码已存在, 待验证）