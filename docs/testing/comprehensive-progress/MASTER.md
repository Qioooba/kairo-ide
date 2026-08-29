# Kairo IDE 全模块浏览器版测试 · 主进度文档

> **测试依据**: [docs/COMPREHENSIVE_TEST_DOCUMENT.md](../../COMPREHENSIVE_TEST_DOCUMENT.md)（v0.1.0，738 用例）
> **形态**: 仅 BROWSER（macOS 环境，DESKTOP 列一律 N/A；第 2 章整章跳过）
> **构建**:增量构建（2026-08-28 02:00 `@kairo/jsp-extension` + `apps/browser` 修复 BUG-600/601；2026-08-27 18:26 `@kairo/encoding-extension` + `apps/browser` 修复 BUG-800），Go agent 保持 2026-08-26 编译。
> **开始时间**: 2026-08-26 03:40 (本地)
> **状态图例**: ✅通过 ❌失败 ⛔阻断 ⏭️跳过 🔄进行中 ⬜未开始 N/A=仅桌面用例

---

## 一、环境（隔离测试通道）

| 通道 | Theia URL | Agent API | 工作区 | 分配 |
|------|-----------|-----------|--------|------|
| 官方 | http://127.0.0.1:3000 | http://127.0.0.1:18080 | legacy-sample | 冒烟/演示 |
| A | http://127.0.0.1:18401 | http://127.0.0.1:18400 | .test-lanes/A/workspace | Wave1: 菜单/工具栏/状态栏 |
| B | http://127.0.0.1:18411 | http://127.0.0.1:18410 | .test-lanes/B/workspace | Wave1: Welcome/导入向导/项目选择器 |
| C | http://127.0.0.1:18421 | http://127.0.0.1:18420 | .test-lanes/C/workspace | Wave1: Navigator/编辑器核心/命令面板 |
| D/E | 备用 | 备用 | — | 后续波次 |

**通道管理**: `tests/e2e/lanes/lane.sh {start|stop|status|reset} <A..E>`
**启动（必须完全脱离会话）**: `( sleep 1; ./tests/e2e/lanes/lane.sh start X; ) < /dev/null > /tmp/laneX.log 2>&1 & disown`
**跑测试**: `cd tests/e2e && THEIA_URL=http://127.0.0.1:184XX AGENT_PORT=184YY npx playwright test --config comprehensive.config.ts comprehensive/<spec>.spec.ts`

## 二、已修复缺陷台账

| 缺陷号 | 等级 | 文件 | 问题 | 修复 |
|--------|------|------|------|------|
| BUG-20260826-001 | P0(阻塞启动) | java-debug-acceptance.ts | i18n key 类型宽泛导致全包编译失败 | `ERROR_RECOVERY_PATHS` 改为 `Partial<Record<State, KairoI18nKey>>` |
| BUG-20260826-002 | P0(阻塞启动) | plugin-extension frontend-module.ts | 浏览器模块从 `../node/` 导入常量，把 adm-zip 等 Node 库打进前端 bundle → `process is not defined` → **IDE 白屏无法启动** | `KAIRO_EXTENSION_SERVICE_PATH` 移入 common 协议文件，双端引用 |

**W1-A 修复（详见 ch05/06/07.md）**: BUG-100 工具栏不挂载(P0)、BUG-101 File菜单缺项、BUG-102 View菜单缺11项、BUG-103 Save As 全局禁用、BUG-104 键盘保护 pageerror、BUG-105 **lane 隔离失效：后端只读 KAIRO_AGENT_URL**(P0)、BUG-106 Maven标题raw key、BUG-107 Remote视图构造崩溃、BUG-109 右键Run组永不渲染、BUG-110 Ctrl+R替换键、BUG-111 Large指示不出现；未修:BUG-108(React key P3)、BUG-112(GoTo子菜单缺Java项→ch13跟进)

**W1-C 修复（详见 ch11/12/37.md，2026-08-26）**:
- BUG-20260826-300 Git集成从未接入浏览器构建(P1) — git协议+后端服务+前端代理
- BUG-20260826-301 子目录 .kairo/project.yaml 不识别→GBK 乱码(P1)
- BUG-20260826-302 键盘守卫致全部受保护快捷键失效(P0)（W1-C 复验通过）
- BUG-20260826-303 Escape 吞事件/Shift+Escape 空命令(P1)
- **BUG-20260826-307 折叠与 XML 块注释快捷键死键(P1)** — Monaco级注册
- **BUG-20260826-308 Output面板抢占⌘⇧U(P1)** — 注册表级 reclaim kairo.editor.toggleCase
- **BUG-20260826-309 Find Action 浮层不聚焦查询框(P2)** — 显式 focus
- **BUG-20260826-310 键盘守卫过度拦截→编辑chord双发/丢发(P1)** — 守卫在编辑器内只拦Chrome保留键；keymap 删除纯Monaco action id；删行/移行/大小写改注册表级命令；补 Windows Ctrl+D/Ctrl+Shift+M

**W1-B 修复（详见 ch08/09/10.md，2026-08-27，通道 B 3.8m+6.2m+7.5m 回归）**:
- BUG-20260826-200 (P1) Welcome showWelcome 失效 — 三处叠加（PreferenceService ready、onDidInitializeLayout、showWelcomeGuard）
- BUG-20260826-201 (P1) Project Structure 编码回显始终 UTF-8 — 前端仅处理 ProjectConfig 对象形态，未兼容 domain.Project 字符串形态（`packages/project-extension/src/browser/project-structure-dialog.tsx:173`）
- BUG-20260826-202 (P0) PUT /projects/{id} 对 protocol 对象编码解码失败 — 后端仅接受 domain 字符串，前端发送对象（`runtime-agent/internal/api/handlers.go:233` + 前端 save 兼容）
- BUG-20260826-203 (P1) JDT 合并的绝对路径未相对化导致保存校验 `path is absolute`（同一文件 219 行）
- BUG-20260826-204 (P2) 测试基建 `purgeCatalog` / `GET /projects` 在 workspace-scoped 模型下返回空（`helpers-ch810.ts:215`）

**W2 修复（详见 ch14/15/16.md，2026-08-28，通道 E 1.5m+3.6m+50.9s 回归）**:
- BUG-20260828-600 (P2) JSON/XML/WebXml 补全占位 range 导致建议被过滤 — `json-language.ts:103,119` / `xml-dtd-completion.ts:25` / `webxml-completion.ts:32,51` 硬编码 `range:{1,1,1,1}`，Monaco 过滤非光标 range 的建议；改为 `model.getWordUntilPosition` 的 `word` range 注入
- BUG-20260828-601 (P1) XML 属性补全分支永不可达 — `xml-dtd-completion.ts:134` 的 `isInsideOpenTag` 元素分支恒先命中，属性分支重叠；改为先判 `afterLt` 含空格则属性，否则元素
- BUG-20260828-602 (P0-阻塞构建) `search-extension` 合并冲突残留 `<<<<<<<` 导致 `apps/browser` 生产构建失败 — `find-action-model.ts:88` / `find-action-widget.tsx:26` / `kairo-product-frontend-module.ts:807` 清理冲突标记
- BUG-20260828-603 (观察) Properties 保存未做 `\uXXXX` 转义 — `testKey=你好` 落盘为 UTF-8 裸字节 `���` 而非 `\u4f60\u597d`，未静默写 `?` 但不符合 `ISO-8859-1+\uXXXX` 规格（已记录未修复）

**W2-B 修复（详见 ch17.md，2026-08-27，通道 B 1.3m 回归）**:
- BUG-800 (P2) Tab 编码后缀未渲染 — `encoding-tab-decorator.ts:50` 仅 `Navigatable.is` 强校验且仅 `onCreated/onDidChangeEncoding`，已加 `duck-typing` 回退与 `onCurrentEditorChanged` + 可选 `ActiveProjectService.onDidChangeProject` 监听，`pnpm --filter @kairo/encoding-extension build && cd apps/browser && pnpm build` 后重启 lane B 回归 16/16
- BUG-801 (观察 P3) ASCII 回退 `utf-8 0.9` 误判 — `memEncoder.Detect` 硬编码 `UTF8` 未取项目 `encoding`，`__kairo_ascii.txt` 的 API 误报 `utf-8 0.9` 而状态栏正确 `gbk *`（前端文件夹覆盖）；不阻断
- BUG-802 (观察 P3) `directoryEncodingOverrides` 未持久化 — `ProjectToConfig` 丢失该字段，`src/:utf-8` 内存注入重启丢失；测试经 per-file `Reopen` 演示最深优先

## 三、章节进度总览

| 章节 | 内容 | 用例数(B列) | 通过 | 失败 | 阻断 | 跳过/N-A | 状态 | 详情 |
|------|------|------------|------|------|------|----------|------|------|
| 第2章 | 安装卸载 | — | — | — | — | 全部N/A | ⏭️ | 仅Windows桌面 |
| 第3章 | 启动退出(B列) | 12 | 3 | 0 | 0 | 9待测 | 🔄 | smoke已过3条(LAUNCH-061/062/064部分) |
| 第4章 | 窗口布局主题 | 9 | 0 | 0 | 0 | 9 | ⬜ | |
| 第5章 | 菜单栏 | 33 | 57 | 0 | 0 | 9 | ✅ | W1A完成：57✅/9⏭️/0❌（66条含子菜单） |
| 第6章 | 工具栏 | 11 | 11 | 0 | 0 | 0 | ✅ | W1A完成：修复P0工具栏不挂载 |
| 第7章 | 状态栏 | 11 | 11 | 0 | 0 | 0 | ✅ | W1A完成 |
| 第8章 | 欢迎页 | 11 | 11 | 0 | 0 | 0 | ✅ | W1-B 完成：9✅/0❌ (3.8m)，BUG-200 修复后双向验证通过 |
| 第9章 | 导入向导 | 18 | 18 | 0 | 0 | 0 (+2 N/A) | ✅ | W1-B 完成：18✅/2⏭️(007/034 N/A) (6.2m)，测试基建修正 1 项 |
| 第10章 | 项目选择器/结构 | 17 | 17 | 0 | 0 | 0 | ✅ | W1-B 完成：14✅ (7.5m)，产品缺陷 3 项 + 基建 1 项已修复 |
| 第11章 | 资源管理器 | 7 | 7 | 0 | 0 | 0 | ✅ | W1-C完成：BUG-300/301 修复后 7/7，两轮回归通过 |
| 第12章 | 编辑器核心 | 17 | 17 | 0 | 0 | 0 | ✅ | W1-C完成：BUG-307/308/310 修复后 17/17 |
| 第13章 | Java语言 | 38 | 0 | 0 | 0 | 38 | ⬜ | Wave2 |
| 第14章 | JSP语言 | 21 | 21 | 0 | 0 | 0 | ✅ | W2 完成：21✅/0❌ (1.5m)，BUG-600 修复后 4 项环境回退 |
| 第15章 | XML/DTD | 12 | 12 | 0 | 0 | 0 | ✅ | W2 完成：12✅/0❌ (3.6m)，BUG-600/601 修复后 |
| 第16章 | JSON/Properties | 8 | 8 | 0 | 0 | 0 | ✅ | W2 完成：8✅/0❌ (50.9s)，BUG-600 修复后，603 观察 |
| 第17章 | 编码GBK专项 | 16 | 16 | 0 | 0 | 0 | ✅ | B 通道 16✅ (1.3m)，修复 BUG-800 并回归，801/802 观察 |
| 第18章 | 搜索全家桶 | 24 | 24 | 0 | 0 | 0 | ✅ | W2E完成23✅+011部分(P3缺history下拉UI)；修BUG-500~506 |
| 第19章 | 构建系统 | 19 | 0 | 0 | 0 | 19 | ⬜ | Wave3 |
| 第20章 | Maven视图 | 8 | 0 | 0 | 0 | 8 | ⬜ | Wave3 |
| 第21章 | Tomcat/部署/热更 | 30 | 0 | 0 | 0 | 30 | ⬜ | Wave3 |
| 第22章 | 运行配置 | 19 | 0 | 0 | 0 | 19 | ⬜ | Wave3 |
| 第23章 | 调试 | 23 | 0 | 0 | 0 | 23 | ⬜ | Wave3 |
| 第24章 | 问题面板 | 12 | 0 | 0 | 0 | 12 | ⬜ | Wave4 |
| 第25章 | TODO/FIXME | 9 | 0 | 0 | 0 | 9 | ⬜ | Wave4 |
| 第26章 | 单元测试视图 | 13 | 0 | 0 | 0 | 13 | ⬜ | Wave4 |
| 第27章 | SQL控制台 | 14 | 0 | 0 | 0 | 14 | ⬜ | Wave4 |
| 第28章 | 终端 | 6 | 0 | 0 | 0 | 6 | ⬜ | Wave4 |
| 第29章 | Git集成 | 15 | 0 | 0 | 0 | 15 | ⬜ | Wave4 |
| 第30章 | SVN集成 | 24 | 0 | 0 | 0 | 24 | ⬜ | Wave5(需svn) |
| 第31章 | 本地历史 | 8 | 0 | 0 | 0 | 8 | ⬜ | Wave4 |
| 第32章 | 书签 | 7 | 0 | 0 | 0 | 7 | ⬜ | Wave4 |
| 第33章 | 快捷键体系 | 11 | 0 | 0 | 0 | 11 | ⬜ | Wave5 |
| 第34章 | 性能/大文件 | 9 | 0 | 0 | 0 | 9 | ⬜ | Wave5 |
| 第35章 | 通知中心 | 4 | 0 | 0 | 0 | 4 | ⬜ | Wave5 |
| 第36章 | 设置首选项 | 20 | 0 | 0 | 0 | 20 | ⬜ | Wave5 |
| 第37章 | 命令面板焦点 | 5 | 5 | 0 | 0 | 0 | ✅ | W1-C完成：BUG-309 修复 + Escape capture 化，5/5 |
| 第38章 | 扩展管理VSIX | 10 | 0 | 0 | 0 | 10 | ⬜ | Wave5 |
| 第39章 | 远程开发面板 | 7 | 0 | 0 | 0 | 7 | ⬜ | Wave5 |
| 第40章 | 合规/遥测 | 12 | 0 | 0 | 0 | 12 | ⬜ | Wave5 |
| 第41章 | 升级检查 | 7 | 0 | 0 | 0 | 7 | ⬜ | Wave5 |
| 第42章 | 国际化 | 7 | 0 | 0 | 0 | 7 | ⬜ | Wave5 |
| 第43章 | 无障碍 | 8 | 0 | 0 | 0 | 8 | ⬜ | Wave5 |
| 第44章 | 错误容错 | 10 | 0 | 0 | 0 | 10 | ⬜ | Wave5 |
| 第45章 | 安全专项(B列) | 12 | 0 | 0 | 0 | 12 | ⬜ | Wave6 |
| 第46章 | 日志诊断(B列) | 4 | 0 | 0 | 0 | 4 | ⬜ | Wave6 |
| 第47章 | 一致性(B列) | 9 | 0 | 0 | 0 | 9 | ⬜ | Wave6 |
| 第48章 | 性能基准(B列) | 6 | 0 | 0 | 0 | 6 | ⬜ | Wave6 |

## 四、恢复测试指南（给后续会话）

1. 读本文档第三节确定下一批章节。
2. 检查通道：`./tests/e2e/lanes/lane.sh status`；挂了就按第一节命令重启。
3. 各章节明细在 `docs/testing/comprehensive-progress/chNN.md`，未完成用例继续写 spec 执行。
4. 发现缺陷 → 修复 → 重建受影响包 → `cd apps/browser && pnpm build` → 重启通道 → 回归。
5. 更新本表与章节文档。

---
*最后更新: 2026-08-27 18:27 Wave2-B ch17 完成（通道 B 16✅/0❌ 1.3m，缺陷 1 项已修复并回归 2 项观察）*
*历史: 2026-08-28 02:00 Wave2 ch14/15/16 完成（通道 E 21+12+8=41 用例，缺陷 3 项已修复+1 观察，合并冲突 1 项阻塞构建已清理）*
