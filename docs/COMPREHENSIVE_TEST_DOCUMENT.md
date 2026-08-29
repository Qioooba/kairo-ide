# Kairo IDE 全模块深度测试文档（Windows 桌面版 + 本地浏览器版）

> **版本**: v0.1.0
> **编写日期**: 2026-08-26
> **测试对象**: Kairo IDE 两种部署形态 —— ① Windows 桌面版（Electron 安装包/便携包）、② 本地浏览器版（Chrome 访问 `http://127.0.0.1:3000`）
> **代码分析深度**: 基于对全部源码的逐文件深度分析——apps/desktop（Electron 主进程）、apps/browser（Theia 组装与打包补丁）、packages/theia-product（107 个前端源文件、30+ 视图 Widget、100+ 注册命令、8 大菜单）、packages/{project,build,runtime,search,jsp,java,encoding,i18n,tomcat,git,svn,sql,test,plugin,remote,protocol}-extension、ui-kit 设计系统、runtime-agent（Go，67 个 /api/v1 端点 + 2 个 WebSocket 端点）
> **测试方法**: 模拟人工点击为主，辅以 Playwright 自动化验证
> **预计总工时**: 全量约 5 个工作日（桌面 3 天 + 浏览器 2 天）

---

## 目录

| 章节 | 内容 | 平台 |
|------|------|------|
| 第0章 | 文档使用说明与测试约定 | 通用 |
| 第1章 | 测试环境准备 | 通用 |
| 第2章 | 安装与卸载测试（NSIS/便携包） | 仅 Windows |
| 第3章 | 启动与退出生命周期测试 | 双平台 |
| 第4章 | 窗口、布局与主题基础测试 | 双平台 |
| 第5章 | 菜单栏逐项测试（File/Edit/Selection/View/Go/Terminal/Kairo/Help） | 双平台 |
| 第6章 | 工具栏测试 | 双平台 |
| 第7章 | 状态栏逐项测试 | 双平台 |
| 第8章 | 欢迎页（Welcome）测试 | 双平台 |
| 第9章 | 项目导入向导测试（3 步） | 双平台 |
| 第10章 | 项目选择器与项目结构对话框测试 | 双平台 |
| 第11章 | 文件资源管理器（Navigator）测试 | 双平台 |
| 第12章 | 编辑器核心功能测试 | 双平台 |
| 第13章 | Java 语言功能测试 | 双平台 |
| 第14章 | JSP 语言功能测试 | 双平台 |
| 第15章 | XML/DTD/web.xml/TLD 功能测试 | 双平台 |
| 第16章 | JSON 与 Properties 功能测试 | 双平台 |
| 第17章 | 编码功能测试（GBK 重点专项） | 双平台 |
| 第18章 | 搜索功能全家桶测试 | 双平台 |
| 第19章 | 构建系统测试（Build/Ant/javac/自定义构建） | 双平台 |
| 第20章 | Maven 视图测试 | 双平台 |
| 第21章 | Tomcat 服务器管理、部署与热更新测试 | 双平台 |
| 第22章 | 运行配置管理测试 | 双平台 |
| 第23章 | 调试功能测试（断点/变量/调用栈/HotSwap） | 双平台 |
| 第24章 | 问题面板（Problems）测试 | 双平台 |
| 第25章 | TODO/FIXME 视图测试 | 双平台 |
| 第26章 | 单元测试视图测试 | 双平台 |
| 第27章 | SQL 控制台测试 | 双平台 |
| 第28章 | 终端测试 | 双平台 |
| 第29章 | Git 集成测试 | 双平台 |
| 第30章 | SVN 集成测试 | 双平台 |
| 第31章 | 本地历史测试 | 双平台 |
| 第32章 | 书签功能测试 | 双平台 |
| 第33章 | 快捷键体系与速查表测试 | 双平台 |
| 第34章 | 性能仪表板与大文件处理测试 | 双平台 |
| 第35章 | 通知中心测试 | 双平台 |
| 第36章 | 设置与首选项测试 | 双平台 |
| 第37章 | 命令面板与焦点导航测试 | 双平台 |
| 第38章 | 扩展管理（VSIX）测试 | 双平台 |
| 第39章 | 远程开发面板测试 | 双平台 |
| 第40章 | 合规面板与遥测设置测试 | 双平台 |
| 第41章 | 升级检查测试 | 双平台 |
| 第42章 | 国际化（中英文切换）测试 | 双平台 |
| 第43章 | 无障碍访问测试 | 双平台 |
| 第44章 | 错误处理与容错测试 | 双平台 |
| 第45章 | 安全专项测试 | 双平台 |
| 第46章 | 日志与诊断检查 | 双平台 |
| 第47章 | 双形态一致性对照测试 | 对照 |
| 第48章 | 性能基准验收测试 | 双平台 |
| 附录A | 完整命令 ID 清单 | 参考 |
| 附录B | 快捷键全表（Win/macOS/浏览器差异） | 参考 |
| 附录C | Runtime Agent API 端点清单 | 参考 |
| 附录D | 缺陷报告模板 | 模板 |
| 附录E | 测试结果汇总表 | 模板 |

---

# 第0章 文档使用说明与测试约定

## 0.1 两种被测形态

| 形态 | 代号 | 说明 | 启动方式 |
|------|------|------|----------|
| Windows 桌面版 | **DESKTOP** | Electron 壳 + Theia 前端 + 内嵌 Go Runtime Agent，单进程组 | 双击 `Kairo.exe` 或开始菜单快捷方式 |
| 本地浏览器版 | **BROWSER** | Theia 浏览器版 + 同机 Go Runtime Agent，Chrome 访问 | `./scripts/dev.sh` 后浏览器打开 `http://127.0.0.1:3000` |

两种形态共享同一套编译产物（Monaco + Theia shell + Kairo 扩展）、同一工作区/项目模型、同一 `/api/v1` 线协议。**除特别标注"仅 DESKTOP"或"仅 BROWSER"的用例外，所有功能用例都必须在两种形态下分别执行一遍**。

## 0.2 用例格式

每个用例表格包含：

| 列 | 含义 |
|----|------|
| 编号 | `TC-<模块码>-<序号>`，缺陷单引用此编号 |
| 操作步骤 | 精确到点击哪个按钮/菜单项/快捷键 |
| 预期结果 | 可观察、可判定的验收标准（含 UI 文案、状态变化） |
| 优先级 | P0=阻塞发布必须通过；P1=核心流程；P2=重要；P3=边缘场景 |
| 结果 | ✅通过 / ❌失败(附缺陷链接) / ⛔阻断 / ⏭️跳过 |

结果列分两栏：`D` = Desktop，`B` = Browser。

## 0.3 关键术语

| 术语 | 含义 |
|------|------|
| Runtime Agent | Go 编写的本地服务进程 `kairo-runtime`，默认端口 18080（动态端口见 userData 下 agent-state.json），提供 `/api/v1` REST 与 WebSocket |
| Workspace | 已在 IDE 中打开的工作区文件夹，对应 agent 的 workspaceId |
| Project | 通过导入向导注册的项目（含编码、目录布局、JDK 版本等元数据），落盘于 `<root>/.kairo/project.yaml` 与 `.kairo/project.json` |
| Active Project | 当前激活的项目，驱动构建/运行/调试/热部署 |
| Run Configuration | Tomcat 启动配置，存于 `.legacyflow/run-configurations.json` |
| Hot Reload 模式 | staticSync（静态同步）/ compileOnly（仅编译）/ classHotSwap（类热替换）/ contextReload（Context 重载）四种 |
| JDWP | Java 调试线协议端口，默认 8000 |
| legacy-sample | 仓库自带测试样例工程（Servlet/JSP/Ant/GBK），路径 `<repo>/legacy-sample` |

## 0.4 通用前置动作（每轮回归开始前）

1. 关闭所有 Kairo IDE 实例；任务管理器确认无残留 `Kairo.exe`、`kairo-runtime(.exe)`、`java.exe`（Tomcat/JDT LS）。
2. 备份并清空数据目录：Windows 为 `%APPDATA%\Kairo IDE`（如需全新首次启动体验）；macOS 为 `~/Library/Application Support/Kairo IDE`。
3. 准备测试项目：将 `legacy-sample/` 复制到两个不同位置——①纯英文短路径（如 `C:\testdata\legacy-a`），②含中文与空格的长路径（如 `D:\测试 项目\遗留系统样例`）。
4. 准备 GBK 编码测试文件集：GBK 的 .java/.jsp/.properties 各至少 1 个、UTF-8 BOM 文件 1 个、混合乱码文件 1 个。
5. 打开日志监控终端：`Get-Content "$env:APPDATA\Kairo IDE\logs\desktop-main.log" -Wait`（桌面版主进程日志实时观察）。

---

# 第1章 测试环境准备

## 1.1 硬件要求

| 项目 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 双核 2.0GHz | 四核 3.0GHz+ |
| 内存 | 4GB（目标环境规格） | 8GB+ |
| 磁盘 | 2GB 可用 | 5GB+ 可用 |
| 显示器 | 1280×768 | 1920×1080+ |
| 缩放 | 100%（避免 DPI 干扰） | — |

## 1.2 软件矩阵

### 1.2.1 DESKTOP 环境

| 组件 | 要求 | 验证方法 |
|------|------|---------------|
| OS | Windows 10 x64 专业版/企业版 1903+（需覆盖无管理员权限场景） | `winver` |
| JDK（宿主） | JDK 17+ 必需（JDT LS 需要）；**JDK 21+ 时 Java 语言功能完整，仅 17 时受限** | `java -version` |
| JDK（项目工具链） | JDK 1.6.0_45（用于 javac -source 1.6 编译验证） | 工具链导入后查看 |
| Tomcat | 6.0.53（安装包内置捆绑于 resources/bundled/tomcat6；也可手动选择外部 Tomcat 6.0.30/6.0.53） | bin/bootstrap.jar 存在 |
| Git（可选） | Git for Windows 任一版本 | `git --version` |
| svn.exe（可选） | SlikSVN/TortoiseSVN 命令行 | `svn --version` |
| Oracle（可选，SQL 专项） | Oracle 11g 可达 + Instant Client | SQL 控制台 Test Connection |
| 网络 | **完全离线/内网**（产品为气隙设计，禁止联网下载） | 断网执行全量用例 |

### 1.2.2 BROWSER 环境

| 组件 | 要求 |
|------|------|
| 浏览器 | Chrome 最新稳定版（主测）；Edge（辅测）；Firefox（兼容性抽查） |
| Node.js | ≥ 20（运行 dev.sh / theia start） |
| Agent | 与桌面共用 `kairo-runtime` 二进制 |
| 访问地址 | `http://127.0.0.1:3000`（THEIA_PORT 默认 3000，仅绑定 loopback） |

## 1.3 测试数据清单

| 数据 | 路径/制作方法 | 用于章节 |
|------|---------------|----------|
| 标准样例工程 | `<repo>/legacy-sample`（含 build.xml、src、WebRoot、lib、GBK 文件、web.xml） | 第9/19/21章 |
| 中文路径副本 | 复制到 `D:\测试 项目\legacy-cn` | 第9/44章 |
| GBK Java 文件 | 记事本另存为 ANSI 制作含中文注释的 `.java` | 第17章 |
| UTF-8 BOM 文件 | 编辑器以 "UTF-8 with BOM" 保存 | 第17章 |
| 大文件 | 生成 ~6MB / ~55MB 文本各一个 | 第34章 |
| Git 仓库 | 在样例工程 `git init && git add && git commit`，再造第2次提交 | 第29章 |
| SVN 工作副本 | `svn checkout` 一个测试库（或 `svnadmin create` 本地库） | 第30章 |
| JUnit 工程 | 样例中添加 JUnit3/JUnit4 测试类各一 | 第26章 |
| pom.xml 工程 | 最小 Maven 工程（有依赖树） | 第20章 |

## 1.4 环境检查清单

- [ ] Windows 主机已激活、时间正确
- [ ] JAVA_HOME 指向 JDK 21（或 17）
- [ ] `java -version` 输出正常
- [ ] 无其他 Kairo IDE 实例运行
- [ ] 防火墙放行本机回环端口通信（18080/3000/随机高端口）
- [ ] legacy-sample 已复制到位（英文路径 + 中文路径两份）
- [ ] 屏幕缩放 100%
- [ ] Chrome 已就绪且可访问 localhost（代理不拦截 127.0.0.1）
- [ ] 日志监控终端已打开

---

# 第2章 安装与卸载测试（仅 DESKTOP）

> **对象**: `Kairo IDE-x.y.z-win-x64.exe`（NSIS）+ `.zip` 便携包
> **参考实现**: electron-builder.yml（appId=com.kairo.ide，productName="Kairo IDE"，executableName=Kairo，NSIS Unicode 支持，卸载不清 AppData）

## 2.1 NSIS 安装程序

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-INST-001 | 安装程序启动 | 双击 .exe 安装包 | 显示 Kairo 图标与欢迎界面；**不弹 UAC 提权请求**（asInvoker） | P0 | ☐ | — |
| TC-INST-002 | 许可协议 | 点击"下一步" | 显示 Apache 2.0 协议页；选"我不接受"时"下一步"禁用 | P1 | ☐ | — |
| TC-INST-003 | 默认安装目录 | 接受协议继续 | 默认 `%LOCALAPPDATA%\Programs\Kairo IDE` | P0 | ☐ | — |
| TC-INST-004 | 自定义目录 | 浏览改为 `D:\Dev\KairoIDE` | 安装成功，该目录生成完整文件 | P0 | ☐ | — |
| TC-INST-005 | 中文/空格路径安装 | 安装到 `D:\开发工具\Kairo IDE` | 安装与后续启动均正常无乱码（NSIS Unicode） | P0 | ☐ | — |
| TC-INST-006 | 安装组件完整性 | 安装完成后检查目录 | 存在：`Kairo.exe`、`resources\bin\kairo-runtime.exe`、`resources\bundled\tomcat6\apache-tomcat-6.0.53`（bin/bootstrap.jar 存在）、`resources\bundled\jdtls`（plugins 下有 equinox launcher jar）、`resources\bundled\kairo-jdi-bridge.jar`、`resources\app.asar.unpacked`（rg/watcher/keytar native） | P0 | ☐ | — |
| TC-INST-007 | Tomcat 精简校验 | 检查 bundled tomcat6 | 不含 docs/examples/manager 示例应用（已 prune 省体积） | P3 | ☐ | — |
| TC-INST-008 | 快捷方式 | 查看开始菜单与桌面 | 有 "Kairo IDE" 快捷方式，图标正常 | P1 | ☐ | — |
| TC-INST-009 | 完成后自动启动 | 保持"运行 Kairo IDE"勾选完成安装 | 应用自动拉起，进入第3章首启流程 | P1 | ☐ | — |
| TC-INST-010 | 升级覆盖安装 | 在已安装版本上再运行安装包 | 覆盖成功；用户数据（recent projects、设置）保留 | P1 | ☐ | — |
| TC-INST-011 | 安装中断恢复 | 安装中途取消 | 无残留半成品目录；再次安装可成功 | P2 | ☐ | — |

## 2.2 便携包（ZIP/7z）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-INST-101 | 解压即用 | 解压到任意目录，双击 Kairo.exe | 正常启动 | P0 | ☐ | — |
| TC-INST-102 | 移动磁盘运行 | 从 U 盘运行 | 可启动；数据仍写入 %APPDATA% 而非 U 盘 | P2 | ☐ | — |
| TC-INST-103 | 只读目录告警 | 只读共享中运行 | 给出 userData 不可写 startup warning（非致命）或明确报错 | P2 | ☐ | — |

## 2.3 卸载

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-INST-201 | 卸载流程 | 设置→应用→卸载 Kairo IDE | 向导完成；安装目录删除 | P0 | ☐ | — |
| TC-INST-202 | 卸载保留用户数据 | 卸载后检查 `%APPDATA%\Kairo IDE` | **保留**（设计如此），重装后 recent projects 还在 | P1 | ☐ | — |
| TC-INST-203 | 运行中卸载 | Kairo 运行中执行卸载 | 提示先关闭或自动终止进程 | P2 | ☐ | — |
| TC-INST-204 | 卸载残留检查 | 卸载完成后任务管理器 | 无 kairo-runtime.exe / java.exe（Tomcat）残留 | P0 | ☐ | — |

---

# 第3章 启动与退出生命周期测试

> **参考实现**: apps/desktop/src/main.ts。启动顺序：validateStartup → 并行检测 JDK/Tomcat → startAgent（`--port 0` 动态端口 + secret 注入 env 不进命令行）→ 轮询 agent-state.json 取真实端口 → 健康检查 /api/v1/health（15s）→ startTheiaBackend（ELECTRON_RUN_AS_NODE 子进程，45s 就绪超时，三级端口发现）→ createWindow 加载 Theia。agent 健康检查与开窗**并行**（不等 agent 就绪即开窗）。

## 3.1 首次启动（干净环境）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LAUNCH-001 | 冷启动总流程 | 干净环境双击 Kairo.exe | 依次出现：窗口（深色背景 #1e1f22）→ Theia 界面加载 → Welcome 页显示 "Kairo IDE" 标题 | P0 | ☐ | ☐ |
| TC-LAUNCH-002 | 冷启动时长 | 秒表从双击到 Welcome 可交互 | ≤ 8 秒（2vCPU/4GB 目标机）；性能仪表板 Cold Start History 有记录 | P1 | ☐ | ☐ |
| TC-LAUNCH-003 | 未检测到 JDK 对话框 | 清空 PATH/JAVA_HOME 且无 bundled jdk 启动 | 弹中文警告「未检测到主机 JDK」，detail 列出所有已搜索路径，三按钮【手动选择 JDK】【暂时跳过】【退出】 | P0 | ☐ | — |
| TC-LAUNCH-004 | JDK 手动选择取消循环 | 点【手动选择 JDK】→ 直接取消选择 | 回到第一步对话框（递归循环） | P1 | ☐ | — |
| TC-LAUNCH-005 | JDK 选择不合格 | 选择一个 JDK 8 的 java.exe | 错误框「选择的 Java 版本不符合要求」显示探测到的版本与要求；【重新选择】回到选择器 | P0 | ☐ | — |
| TC-LAUNCH-006 | JDK 跳过后果 | 选【暂时跳过】 | IDE 以受限 Java 功能启动（无补全/导航），其余功能可用 | P1 | ☐ | — |
| TC-LAUNCH-007 | JDK 退出选项 | 选【退出】 | 应用直接退出，无残留进程 | P1 | ☐ | — |
| TC-LAUNCH-008 | 未检测到 Tomcat 对话框 | 无 Tomcat 环境启动 | 弹「未检测到 Tomcat 6」对话框，说明需要 bin/catalina.* 或 bin/bootstrap.jar，三按钮同上 | P0 | ☐ | — |
| TC-LAUNCH-009 | Tomcat 无效目录 | 手动选普通文件夹 | 错误框「选择的目录不是有效的 Tomcat 安装」，detail 给缺失项与所路径 | P1 | ☐ | — |
| TC-LAUNCH-010 | 选择持久化 | 完成一次手动选择后重启 | 不再弹设置对话框；userData 出现 host-jdk.json / host-tomcat.json | P0 | ☐ | — |
| TC-LAUNCH-011 | 持久化失效检测 | 删除所选 JDK 目录后再启动 | 重新弹出检测对话框（持久化加载校验 bin/java 存在性） | P2 | ☐ | — |
| TC-LAUNCH-012 | 窗口显示行为 | 观察启动过程 | ready-to-show 才显示，无白屏闪烁；标题始终 "Kairo IDE"（page-title-updated 被锁定不改写） | P1 | ☐ | — |
| TC-LAUNCH-013 | 状态文件 | 查看 agent-state.json / theia-state.json | JSON 有效（port/pid/bindAddress/startedAt）；**不含 secret 字段** | P1 | ☐ | — |
| TC-LAUNCH-014 | secret 不泄露 | tasklist /v 或 Process Explorer 看 kairo-runtime 命令行 | 只有 --bind/--port/--data-dir 等，**无 secret 明文**（经 env KAIRO_LOCAL_SECRET 传递） | P0 | ☐ | — |
| TC-LAUNCH-015 | 启动警告呈现 | 构造 ia32 架构等告警场景 | 日志出现 `[kairo] startup warning: ...`，应用仍可继续 | P3 | ☐ | — |
| TC-LAUNCH-016 | 致命启动失败 | 设置 KAIRO_AGENT_PATH 指向不存在文件 | 弹原生错误框 “Failed to start Kairo IDE:\n\<msg\>\n\nPlease check the console for details.” 后清理退出 | P1 | ☐ | — |

## 3.2 再次启动（复用与常规）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LAUNCH-021 | 二次启动速度 | 正常关闭后再启动 | 数秒内进入可用状态；日志可见 tryReuseAgent 或全新 startAgent 分支 | P1 | ☐ | ☐ |
| TC-LAUNCH-022 | 残留旧 agent 接管 | 保留旧 kairo-runtime 进程（有效 agent-state.json）再启动新实例 | 复用旧 agent（health 无鉴权 200 + toolchains 带 secret 200 双探测通过）；若旧 agent JDK 环境不一致则杀旧起新 | P2 | ☐ | ☐ |
| TC-LAUNCH-023 | 陈旧状态文件 | 手动写坏 agent-state.json（乱内容）再启动 | 告警忽略损坏文件，走全新启动，最终正常可用 | P2 | ☐ | ☐ |
| TC-LAUNCH-024 | 单实例锁 | 运行中再双击 Kairo.exe | 第二实例弹错误框 “Another instance of Kairo IDE is already running...” 后退出；第一实例窗口激活还原 | P0 | ☐ | — |
| TC-LAUNCH-025 | second-instance 恢复 | 第一实例最小化后再双击 | 从最小化恢复并获得焦点 | P1 | ☐ | — |

## 3.3 Headless 模式（仅 DESKTOP）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LAUNCH-031 | headless 启动 | exe 改名 `kairo-server.exe` 或带 `--headless` 启动 | 不开窗；stdout 打印 ASCII 横幅："Kairo IDE — Headless (Browser) Mode"、Theia URL、Agent URL、"Open the Theia URL in any browser to use the IDE."、"Press Ctrl+C to stop all services." | P1 | ☐ | — |
| TC-LAUNCH-032 | headless 可用性 | Chrome 打开横幅中的 Theia URL | 浏览器版完整可用（等同 BROWSER 形态） | P1 | ☐ | — |
| TC-LAUNCH-033 | Ctrl+C 停止 | headless 控制台 Ctrl+C | 两子进程被清理，无残留 | P1 | ☐ | — |
| TC-LAUNCH-034 | 子进程崩溃自动退出 | 先后手杀 theia 与 agent | 两者皆亡后应用自动退出 | P2 | ☐ | — |

## 3.4 Agent 崩溃自动重生

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LAUNCH-041 | agent respawn | 运行中任务管理器杀 kairo-runtime.exe | 约 800ms 后同端口同 secret 自动重启；~10s 内健康恢复；状态栏短暂异常后复原 | P1 | ☐ | ☐ |
| TC-LAUNCH-042 | respawn 后功能恢复 | 恢复后执行一次搜索/构建 | WS 事件流重订阅、endpoints 缓存失效重建，功能正常 | P1 | ☐ | ☐ |
| TC-LAUNCH-043 | theia 后端死亡 | 杀 Theia 后端子进程 | 窗口连接丢失表现；日志记录 childExitCodes；重启可恢复 | P2 | ☐ | — |

## 3.5 退出生命周期

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LAUNCH-051 | 正常退出 | File→Exit / Cmd+Q | 窗口关闭；日志记录子进程 exit codes 与 ProcessManager 诊断快照；进程树全消失 | P0 | ☐ | — |
| TC-LAUNCH-052 | 关闭按钮 | 点窗口 × | **立即关闭**（beforeunload veto 被 destroy() 绕过，不得"点了没反应"）；无残留 java/kairo-runtime | P0 | ☐ | — |
| TC-LAUNCH-053 | Alt+F4 / Cmd+Q | 系统快捷关闭 | 同正常退出 | P1 | ☐ | — |
| TC-LAUNCH-054 | 有脏文件退出 | 编辑器留未保存修改后退出 | 出现保存确认（由用户显式决定，不被自动跳过）；选择后正常退出 | P1 | ☐ | — |
| TC-LAUNCH-055 | 退出硬超时 | 构造子进程不响应 TERM 时退出 | 5 秒硬超时后强制树杀并 exit(0)，不会卡死超过约 5 秒 | P1 | ☐ | — |
| TC-LAUNCH-056 | 退出停 Tomcat | 默认 kairo.server.autoStop=true 下退出 | Tomcat 进程停止 | P1 | ☐ | ☐ |
| TC-LAUNCH-057 | 崩溃恢复入口 | 强杀 Tomcat 后重启 IDE | Servers 视图有 recoverable/crashed 记录可 Recover | P2 | ☐ | ☐ |
| TC-LAUNCH-058 | KEEP_REUSED_AGENT 开关 | 设 KAIRO_KEEP_REUSED_AGENT=1 且复用 agent 场景退出 | 复用的 agent **不**被杀（豁免生效）；默认（不设）则复用 agent 也被停止 | P2 | ☐ | — |

## 3.6 BROWSER 启动专测

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LAUNCH-061 | dev.sh 启动 | `./scripts/dev.sh` | 监听 `127.0.0.1:3000` 可访问 | P0 | — | ☐ |
| TC-LAUNCH-062 | 标题与图标 | 打开后看标签页 | 标题 "Kairo IDE"；favicon.ico 加载无 404 | P1 | — | ☐ |
| TC-LAUNCH-063 | 多标签页 | 同一 Chrome 开 2 个标签 | 两标签独立会话均可操作 | P2 | — | ☐ |
| TC-LAUNCH-064 | 刷新恢复 | F5 刷新 | 布局/编辑器尽量恢复；agent 重连；不卡 splash | P1 | — | ☐ |
| TC-LAUNCH-065 | 端口占用失败呈现 | 占用 3000 后启动 | 终端报错清晰；浏览器访问连接拒绝（无假页面） | P2 | — | ☐ |
| TC-LAUNCH-066 | 与桌面共存 | 桌面版运行中再起浏览器版 | 共享同一 agent 均可工作 | P2 | ☐ | ☐ |

---

# 第4章 窗口、布局与主题基础测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-WIN-001 | 初始窗口尺寸 | 首启观察 | 工作区 85%（夹 1280×800~1600×1000），最小 960×600 | P2 | ☐ | — |
| TC-WIN-002 | 窗口标题 | 打开文件后看标题 | `<编辑器/视图> - <工作区> - Kairo IDE`，随切换跟随 | P1 | ☐ | ☐ |
| TC-WIN-003 | 默认主题 | 首启配色 | Kairo IDEA Dark（Darcula 风）：深灰三阶面 #1e1f22/#252629/#2b2c30/#37393d、品牌蓝 #4a9eff、Monaco Darcula 语法色 | P0 | ☐ | ☐ |
| TC-WIN-004 | 亮色主题 | Preferences→Color Theme→light | body.theia-light 全套亮色；状态栏对比度正常 | P1 | ☐ | ☐ |
| TC-WIN-005 | 主题竞态稳定 | 反复切换+重启 | 无颜色回渗（不得出现 Theia 默认 #007acc 状态栏） | P2 | ☐ | ☐ |
| TC-WIN-006 | 图标主题 | 观察文件树 | theia-file-icons 类型图标正常 | P2 | ☐ | ☐ |
| TC-WIN-007 | Activity Bar | 左侧活动栏 | Explorer/Search/SCM/Debug/Extensions 图标齐全可点切换 | P0 | ☐ | ☐ |
| TC-WIN-008 | Appearance 开关 | View→Appearance 逐项 | 底部面板/状态栏/菜单栏独立开关；最大化切换；恢复正常 | P1 | ☐ | ☐ |
| TC-WIN-009 | 分屏 | 拖 tab 到右侧 | 分屏成功，两侧独立滚动光标 | P1 | ☐ | ☐ |
| TC-WIN-010 | HiDPI | 缩放 150% 运行 | 状态栏不溢出（zoomFactor=1）；字体清晰 | P2 | ☐ | — |
| TC-WIN-011 | 最小尺寸限制 | 拖到极小 | ≥960×600，布局不错乱 | P3 | ☐ | — |
| TC-WIN-012 | 次窗口 | 拖出编辑器为新窗 | secondary-window 正常加载可用 | P3 | ☐ | ☐ |

---

# 第5章 菜单栏逐项测试

> 菜单来源：桌面版为 Electron 原生菜单（main.ts buildMenuTemplate()，点击经 menu-action IPC 转发 Theia 命令）；浏览器版由 Theia 顶栏渲染同等结构。**两版都必须逐项验证**。

## 5.1 File 菜单

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-001 | New File | File→New File | 资源管理器出现新建输入行 | P1 | ☐ | ☐ |
| TC-MENU-002 | Open File… | File→Open File | 文件选择器；选中后打开编辑器 | P1 | ☐ | ☐ |
| TC-MENU-003 | Open Folder… | File→Open Folder（Win 上用 openFolder） | 选择后工作区切换，Welcome 关闭 | P0 | ☐ | ☐ |
| TC-MENU-004 | Save | File→Save（Ctrl+S） | 保存成功脏标消失；触发保存钩子（本地历史快照、保存时格式化若开启） | P0 | ☐ | ☐ |
| TC-MENU-005 | Save As | File→Save As | 另存对话框；新文件生成并打开 | P1 | ☐ | ☐ |
| TC-MENU-006 | Save All | File→Save All | 所有脏文件保存 | P1 | ☐ | ☐ |
| TC-MENU-007 | Import Kairo Project | File 菜单 Import 项（order a1 插入 Open 区） | 打开导入向导 Tab | P0 | ☐ | ☐ |
| TC-MENU-008 | Select Kairo Project | File 菜单项目选择项 | 打开项目选择器 | P1 | ☐ | ☐ |
| TC-MENU-009 | Run Configurations | File→Run Configurations | 打开运行配置视图 | P1 | ☐ | ☐ |
| TC-MENU-010 | Preferences | File→Preferences→Settings | 打开 Settings 界面 | P1 | ☐ | ☐ |
| TC-MENU-011 | Close Editor | Cmd+W / Ctrl+F4 | 当前编辑器关闭 | P1 | ☐ | ☐ |
| TC-MENU-012 | Exit/Quit | File→Exit | 退出应用（见 TC-LAUNCH-051） | P0 | ☐ | — |
| TC-MENU-013 | File 菜单瘦身 | 检查菜单内容 | 不含 Upload/Download/Copy Download Link 项（已移除） | P3 | ☐ | ☐ |

## 5.2 Edit / Selection 菜单

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-021 | Undo/Redo | Edit→Undo/Redo | 撤销重做正常 | P1 | ☐ | ☐ |
| TC-MENU-022 | 剪贴板三项 | Cut/Copy/Paste | 正常 | P1 | ☐ | ☐ |
| TC-MENU-023 | Find | Edit→Find（Ctrl+F） | 编辑器内查找控件出现 | P1 | ☐ | ☐ |
| TC-MENU-024 | Replace 快捷键 | 按 Ctrl+R（**非 Ctrl+H**，IDEA 风格） | 打开替换；Ctrl+H 留给 Type Hierarchy | P1 | ☐ | ☐ |
| TC-MENU-025 | Select All | Selection→Select All（Ctrl+A） | 全选 | P1 | ☐ | ☐ |
| TC-MENU-026 | Expand/Shrink Selection | Ctrl+W / Ctrl+Shift+W | 扩大/缩小选区 | P2 | ☐ | ☐ |

## 5.3 View 菜单

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-031 | Explorer | View→Explorer | 资源管理器聚焦/显隐 | P1 | ☐ | ☐ |
| TC-MENU-032 | Search | View→Search | 搜索侧栏 | P1 | ☐ | ☐ |
| TC-MENU-033 | SCM | View→SCM | 源控管理侧栏 | P1 | ☐ | ☐ |
| TC-MENU-034 | Debug | View→Debug | 调试侧栏 | P1 | ☐ | ☐ |
| TC-MENU-035 | Terminal | View→Terminal | 底部终端 | P1 | ☐ | ☐ |
| TC-MENU-036 | Problems | View→Problems | Kairo 定制问题面板 | P1 | ☐ | ☐ |
| TC-MENU-037 | Kairo 视图入口组 | View 菜单中逐个点：Servers / Builds / Deployments / Tomcat Logs / Maven / TODO-FIXME / Test Results / SQL Console / Remote Development / Performance Dashboard | 每项打开对应视图（共 10 个入口） | P0 | ☐ | ☐ |
| TC-MENU-038 | Appearance 子菜单 | View→Appearance | 底部面板/状态栏/菜单栏/最大化四开关齐全 | P2 | ☐ | ☐ |

## 5.4 Go 菜单

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-041 | Back/Forward | Go→Back/Forward（Ctrl+Alt+←/→） | 导航历史后退前进 | P1 | ☐ | ☐ |
| TC-MENU-042 | Go to File | Go→Go to File（Win Ctrl+Shift+N / mac Cmd+Shift+O，**非 Ctrl+P**） | Find File 弹层 | P1 | ☐ | ☐ |
| TC-MENU-043 | Go to Line | Ctrl+G | 行号输入浮层跳转正确 | P1 | ☐ | ☐ |
| TC-MENU-044 | Go to Symbol | Ctrl+F12 | Quick Outline 符号列表 | P2 | ☐ | ☐ |

## 5.5 Terminal 菜单

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-051 | New Terminal | Terminal→New Terminal | 新终端 tab 创建可输入 | P1 | ☐ | ☐ |
| TC-MENU-052 | Toggle Terminal | Alt+F12 | 终端面板显隐切换 | P1 | ☐ | ☐ |

## 5.6 Kairo 顶级菜单

### 5.6.1 直属项（4 项）

| 编号 | 菜单项（图标） | 命令 ID | 预期 | P | D | B |
|------|----------------|---------|------|---|---|---|
| TC-MENU-061 | Import Project… (folder-opened) | kairo.project.import | 打开导入向导 | P0 | ☐ | ☐ |
| TC-MENU-062 | Select Project… (file-directory) | kairo.project.select | 打开项目选择器 | P1 | ☐ | ☐ |
| TC-MENU-063 | Scan Projects (search) | kairo.project.scan | 扫描工作区项目并绑定列出 | P1 | ☐ | ☐ |
| TC-MENU-064 | Manage Run Configurations (gear) | kairo.runConfigurations.manage | 打开运行配置视图 | P1 | ☐ | ☐ |

### 5.6.2 Build && Run 子菜单（12 项）

| 编号 | 菜单项（图标） | 命令 ID | 预期行为 | P | D | B |
|------|----------------|---------|----------|---|---|---|
| TC-MENU-071 | Build (play-circle) | kairo.build | 触发增量构建，Builds 视图新记录 | P0 | ☐ | ☐ |
| TC-MENU-072 | Clean Build (trash) | kairo.cleanBuild | 清理后全量构建 | P1 | ☐ | ☐ |
| TC-MENU-073 | Build and Deploy (rocket) | kairo.buildAndDeploy | 构建→部署到服务器目标目录 | P0 | ☐ | ☐ |
| TC-MENU-074 | Publish (cloud-upload) | kairo.publish | 发布静态变更 | P1 | ☐ | ☐ |
| TC-MENU-075 | Update Application (sync, Ctrl+F10) | kairo.server.update | IDEA 式整项目增量编译+同步 | P1 | ☐ | ☐ |
| TC-MENU-076 | Reload Context (refresh) | kairo.server.reloadContext | touch web.xml 触发 reload（有确认框） | P2 | ☐ | ☐ |
| TC-MENU-077 | Start Server (play, Shift+F10) | kairo.server.start | 启动 Tomcat | P0 | ☐ | ☐ |
| TC-MENU-078 | Start Server in Debug Mode (debug-alt, Shift+F9) | kairo.server.debug | JDWP 调试模式启动并 attach | P1 | ☐ | ☐ |
| TC-MENU-079 | Stop Server (primitive-square) | kairo.server.stop | 停止运行中的服务器 | P0 | ☐ | ☐ |
| TC-MENU-080 | Restart Server (refresh) | kairo.server.restart | 重启（端口占用自动换端口） | P1 | ☐ | ☐ |
| TC-MENU-081 | Open Application (globe) | kairo.app.open | 系统浏览器打开应用 URL | P1 | ☐ | ☐ |
| TC-MENU-082 | Check Java Debug Adapter (bug) | kairo.debug.checkAdapter | 显示调试适配器可用性检查结果 | P2 | ☐ | ☐ |

### 5.6.3 View 子菜单（10 项）

TC-MENU-09x：Servers(alt+2)/Deployments(alt+3)/Builds(alt+4)/Tomcat Logs/Maven(package)/TODO(checklist)/Tests(beaker)/SQL Console(database)/Remote(remote)/Performance(dashboard)。逐项点击打开对应视图，图标按括号内核对。（P1，双平台各勾一次）

### 5.6.4 Debug 子菜单（9 项）

| 编号 | 菜单项 | 预期 | P | D | B |
|------|--------|------|---|---|---|
| TC-MENU-101 | Debug View (bug) | 打开调试主视图 | P1 | ☐ | ☐ |
| TC-MENU-102 | Debug Console (terminal) | 打开调试控制台 | P1 | ☐ | ☐ |
| TC-MENU-103 | Variables (symbol-variable) | 变量面板 | P1 | ☐ | ☐ |
| TC-MENU-104 | Call Stack (callstack) | 调用栈面板 | P1 | ☐ | ☐ |
| TC-MENU-105 | Breakpoints (debug-breakpoint) | 断点面板 | P1 | ☐ | ☐ |
| TC-MENU-106 | Watch (watch) | Watch 表达式面板 | P1 | ☐ | ☐ |
| TC-MENU-107 | Show Class HotSwap History (debug-restart) | HotSwap 历史 widget | P2 | ☐ | ☐ |
| TC-MENU-108 | Debug Toolbar (debug-alt) | IDEA 式悬浮调试工具条 | P2 | ☐ | ☐ |
| TC-MENU-109 | Debug Diagnostics (tools) | 调试诊断面板 | P2 | ☐ | ☐ |

### 5.6.5 Window 子菜单（5 项）

| 编号 | 菜单项 | 预期 | P | D | B |
|------|--------|------|---|---|---|
| TC-MENU-111 | Toggle Terminal | 终端显隐 | P1 | ☐ | ☐ |
| TC-MENU-112 | Keyboard Shortcuts | 打开键位映射管理 widget（kairo-keymap） | P1 | ☐ | ☐ |
| TC-MENU-113 | Switch JDK… | **弹原生 JDK 选择对话框 → 校验 → 持久化 → 热重启 agent**（状态栏 JDK 更新） | P0 | ☐ | — |
| TC-MENU-114 | Configure Tomcat… | 弹原生 Tomcat 目录选择对话框 → bootstrap.jar 校验 → 持久化 → 重启 agent | P0 | ☐ | — |
| TC-MENU-115 | Reconnect Runtime Agent | 状态栏 Agent 恢复 connected；断连场景下点击恢复 | P0 | ☐ | ☐ |

## 5.7 Help 菜单

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-121 | Help: Welcome | Help→Welcome | 打开 Welcome 页（先关 Import Wizard） | P1 | ☐ | ☐ |
| TC-MENU-122 | Toggle Developer Tools | Help→DevTools | DevTools 开关（生产包默认关，KAIRO_DEV=1 可开） | P2 | ☐ | — |
| TC-MENU-123 | Debug Diagnostics | Help→Debug Diagnostics | 打开诊断 widget | P2 | ☐ | ☐ |
| TC-MENU-124 | About | Help→About | 版本 0.1.0 与产品信息 | P1 | ☐ | ☐ |

## 5.8 上下文菜单（右键）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MENU-131 | 编辑器导航组 | .java 内右键 | Go To 子菜单：Declaration/Implementation/Type Declaration/Super Method/Show Usages/Find Usages/Quick Definition | P1 | ☐ | ☐ |
| TC-MENU-132 | 编辑器修改组 | 右键 | completion 组 6 项（Complete Statement/Surround With/Unwrap/Organize Imports 等） | P1 | ☐ | ☐ |
| TC-MENU-133 | 保存动作开关 | 右键 0_more 区 | Format on Save / Organize Imports on Save 开关（勾选态正确持久化） | P1 | ☐ | ☐ |
| TC-MENU-134 | Run 组 | main 方法内右键 | Run/Debug 'XXX.main()'（kairojavarun 组） | P2 | ☐ | ☐ |
| TC-MENU-135 | 资源管理器右键 | 文件树右键 | New/Rename/Delete/Reveal 等 Theia 标准项 | P1 | ☐ | ☐ |
| TC-MENU-136 | SVN 右键菜单 | svn 工作副本文件右键 | 16 项按 order 排列：Show Changes/History/Update/Commit/Add/Revert/Cleanup/Annotate/Diff/Lock/Unlock/Browse Repo/Info/Switch/Resolve/Ignore | P1 | ☐ | ☐ |
| TC-MENU-137 | Git 右键 | git 仓库文件右键 | stage/unstage/diff/history 等操作 | P1 | ☐ | ☐ |

---

# 第6章 工具栏测试

> 顶部常驻工具栏（不可关闭），WidgetFactory id=kairo-toolbar。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-TB-001 | 元素齐全 | 观察 | [Project 下拉][Run Config 下拉][竖分隔线][Run▶][Debug][Stop⏹][Build]，标签随 i18n | P0 | ☐ | ☐ |
| TC-TB-002 | Project 下拉展开 | 点击 | 列出 agent 所有项目；当前高亮；空时 "No projects" | P0 | ☐ | ☐ |
| TC-TB-003 | 切换项目 | 下拉选另一项目 | ActiveProjectService.setProject 生效：状态栏、Java LS、Servers/Builds 联动刷新 | P0 | ☐ | ☐ |
| TC-TB-004 | Run Config 下拉 | 展开 | 选项 `{name} ({MODE})` 如 "Tomcat Local (RUN)"；空时 "No configurations" | P1 | ☐ | ☐ |
| TC-TB-005 | 选配置持久化 | 选另一配置 | selectDefault 写入 selectedConfigurationId | P1 | ☐ | ☐ |
| TC-TB-006 | Run 按钮 | 点 ▶ | 执行 start；文字变 "Running…"，根节点加 kairo-toolbar-busy，四按钮全禁；完成后恢复 | P0 | ☐ | ☐ |
| TC-TB-007 | Debug 按钮 gating | 所选配置 mode=run 时 | Debug **禁用**（仅 debug 配置可用） | P1 | ☐ | ☐ |
| TC-TB-008 | Stop 按钮 gating | 无 running/starting 服务器时禁用；有则启用点击变 "Stopping…" | 正确 | P1 | ☐ | ☐ |
| TC-TB-009 | Build 按钮 | 点击 | "Building…" + Builds 新记录 | P0 | ☐ | ☐ |
| TC-TB-010 | 忙锁防重复 | 快速双击 Run | 只触发一次（busy 单操作锁） | P0 | ☐ | ☐ |
| TC-TB-011 | i18n 刷新 | 语言切中文 | 工具栏标签随语言刷新 | P2 | ☐ | ☐ |

---

# 第7章 状态栏逐项测试

> 左侧 8 组条目 + 右侧 3 项；高度 22px；语义状态着色（success/active/warning/error/neutral class）。

## 7.1 左侧条目

| 编号 | 条目(priority) | 点击行为 | 验证要点 | P | D | B |
|------|----------------|----------|----------|---|---|---|
| TC-SB-001 | Project(p101) | 打开项目选择器 | 无项目灰显 "(no project)"；有项目显示名称 | P0 | ☐ | ☐ |
| TC-SB-002 | JDK(p100) | 触发 Switch JDK 流程 | 显示当前 JDK major；未配置 warning 色 | P1 | ☐ | ☐ |
| TC-SB-003 | Encoding(p99) | 打开 Reopen with Encoding QuickPick | 显示当前文件编码（如 GBK）；无编辑器 placeholder | P1 | ☐ | ☐ |
| TC-SB-004 | Build(p98) | —指示 | 构建中 active 色；成功 success 绿；失败 error 红 | P1 | ☐ | ☐ |
| TC-SB-005 | Server(p97) | —指示 | 显示 `:8080 · JDWP 8000` 类信息；running 绿/stopped neutral/failed 红 | P0 | ☐ | ☐ |
| TC-SB-006 | Debug(p96) | —指示 | 调试会话高亮；空闲 neutral | P1 | ☐ | ☐ |
| TC-SB-007 | Agent(p95) | 执行 reconnect | 连接时 "Runtime Agent: connected"；断开 error 色可点击重连 | P0 | ☐ | ☐ |
| TC-SB-008 | Hot Reload(p94) | —指示 | 仅项目打开时出现；compiling 黄/synced 绿/restart_required 橙 | P2 | ☐ | ☐ |

## 7.2 右侧条目

| 编号 | 条目 | 验证要点 | P | D | B |
|------|------|----------|---|---|---|
| TC-SB-011 | Large file 指示(p110) | >5M 字符显示 Large（>50M 显示 Huge）；普通文件不显示 | P2 | ☐ | ☐ |
| TC-SB-012 | Format on Save 指示(p109) | $(check)/(close) 反映开关状态 | P2 | ☐ | ☐ |
| TC-SB-013 | 通知铃铛(p50) | 未读数字徽标；点击打开通知中心 | P1 | ☐ | ☐ |

---

# 第8章 欢迎页（Welcome）测试

> Widget id=kairo-welcome；冷启动且无活动项目时自动打开；选中项目后自动关闭。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-WELC-001 | 自动打开条件 | 无项目冷启动 | Welcome 自动作为 tab 打开（图标 codicon-home） | P0 | ☐ | ☐ |
| TC-WELC-002 | 首启引导 toast | 最近项目为空的首次启动 | 约 5 秒 toast 引导导入（不覆盖 Welcome 内容） | P2 | ☐ | ☐ |
| TC-WELC-003 | 标题副标题 | 观察 | h1 "Kairo IDE" + tagline（随语言切换） | P1 | ☐ | ☐ |
| TC-WELC-004 | Get Started 三按钮 | 观察 | ①导入项目…（primary 蓝 folder-opened）②打开项目…③打开工作区文件夹…（走 workspace:openFolder） | P0 | ☐ | ☐ |
| TC-WELC-005 | 导入按钮 | 点「导入项目…」 | 打开导入向导 | P0 | ☐ | ☐ |
| TC-WELC-006 | 最近项目展示 | 有历史项目 | 双行条目（名称+根路径）；空态「暂无最近项目」 | P1 | ☐ | ☐ |
| TC-WELC-007 | 最近项目点击 | 点某项目 | workspace 打开、Welcome 自动关闭、文件树呈现 | P0 | ☐ | ☐ |
| TC-WELC-008 | Agent 离线横幅 | 停 agent 后打开 | role=alert 横幅（testid welcome-error），网络错误匹配时显示专用离线提示；可关闭 | P1 | ☐ | ☐ |
| TC-WELC-009 | Quick Start 三步卡 | 观察 | Step1 导入（CTA 复用不重复）/Step2 配置运行设置→按钮 / Step3 构建并运行→按钮；三列网格 ≤600px 折单列 | P1 | ☐ | ☐ |
| TC-WELC-010 | 键盘可达性 | Tab 遍历 | 聚焦首个可聚焦元素；顺序合理 | P3 | ☐ | ☐ |
| TC-WELC-011 | showWelcome 偏好 | 设 kairo.general.showWelcome=false 重启 | 不再自动打开 | P2 | ☐ | ☐ |

---

# 第9章 项目导入向导测试（3 步）

> Widget id=kairo-import-wizard；步骤条 data-testid step-1/2/3。核心约束：扫描阶段只调 POST /api/v1/projects/detect（不创建工作区）；openWorkspace 推迟到确认导入时。

## 9.1 Step 1 — 选择目录

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-IMP-001 | 向导打开 | Kairo→Import Project | 向导 tab 打开，Step1 高亮，欢迎提示区 + 4 条 tips | P0 | ☐ | ☐ |
| TC-IMP-002 | 文件夹选择器 | 点浏览按钮 | 选择器选定后路径回填输入框 | P0 | ☐ | ☐ |
| TC-IMP-003 | 手输路径扫描 | path-input 输入路径→Enter 或 Scan | scanning 态→detectProject→自动填表进 Step2 | P0 | ☐ | ☐ |
| TC-IMP-004 | 空路径校验 | 不输入直接 Scan | 提示先输入路径，不发请求 | P1 | ☐ | ☐ |
| TC-IMP-005 | 非法路径 | 输入不存在路径 Scan | scan-error 横幅（role=alert），留在 Step1 | P0 | ☐ | ☐ |
| TC-IMP-006 | 越权路径 | 输入 C:\Windows 或 ~/.ssh | agent 返回 path_forbidden；UI 显示禁止信息 | P0 | ☐ | ☐ |
| TC-IMP-007 | 反斜杠路径 | 输入 `C:\test\data` | normalizePathForApi 转正斜杠后识别成功 | P1 | ☐ | — |
| TC-IMP-008 | 中文空格路径 | 扫描 `D:\测试 项目\legacy-cn` | 检测成功；后续无乱码 | P0 | ☐ | ☐ |

## 9.2 Step 2 — 确认设置（表单字段全集验证）

字段全集（均有 aria-label 与 testid）：projectName / sourceDirs(逗号分隔) / webRoot / libDirs / defaultEncoding 下拉(utf-8/gbk/gb18030/iso-8859-1) / jdkVersion / sourceVersion+targetVersion 下拉(1.5/1.6/1.7/1.8) / outputDir / buildTool(ant/javac) / buildScript / contextPath。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-IMP-011 | 检测值自动填充 | 用 legacy-sample 进 Step2 | src/WebRoot/lib/build.xml/ant/gbk(样例为 GBK)/1.6/build/classes// 各就位 | P0 | ☐ | ☐ |
| TC-IMP-012 | 置信度与警告 | 观察 Step2 顶部 | `Math.round(confidence*100)`% 徽标 + warnings 数量与列表块 | P1 | ☐ | ☐ |
| TC-IMP-013 | 编码归一化 | 检测返回 utf8 别名 | 归一为 utf-8；缺省回退 gbk | P1 | ☐ | ☐ |
| TC-IMP-014 | 名称必填 | 清空 projectName 点导入 | 内联错误（trim 非空强校验），不发请求 | P0 | ☐ | ☐ |
| TC-IMP-015 | 逗号解析 | sourceDirs 填 `src, test ,` | split trim filter → ["src","test"] | P2 | ☐ | ☐ |
| TC-IMP-016 | 返回上一步 | 点 Back | 回 Step1 且保留已填内容 | P2 | ☐ | ☐ |

## 9.3 导入动作（严格顺序）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-IMP-021 | 正常导入 | 合法表单点 Import | 依序：openWorkspace→POST projects/import→setWorkspace→setProject（含 encoding 与 directoryEncodingOverrides）→Step3 | P0 | ☐ | ☐ |
| TC-IMP-022 | 失败呈现 | 停 agent 后导入 | import-error 内联横幅（errorPrefix），停 Step2；后端不留半成品工作区 | P1 | ☐ | ☐ |
| TC-IMP-023 | 重复导入冲突 | 同 root 二次导入 | 后端 conflict→findExistingProject 匹配既有绑定，不卡死 | P1 | ☐ | ☐ |

## 9.4 Step 3 — 完成

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-IMP-031 | 摘要正确 | 观察完成页 | name/root/encoding 三行摘要与所填一致 | P1 | ☐ | ☐ |
| TC-IMP-032 | 打开项目 | 点「打开项目文件夹」 | 以 **file:// URI** 打开 workspace；文件树呈现；Welcome 关闭 | P0 | ☐ | ☐ |
| TC-IMP-033 | 关闭 | 点「关闭」 | 向导 tab 关闭无副作用 | P1 | ☐ | ☐ |
| TC-IMP-034 | open 失败兜底 | 构造失败观察 | console.error 记录且向导 onClose（不悬挂） | P3 | ☐ | — |

---

# 第10章 项目选择器与项目结构对话框测试

## 10.1 项目选择器（id=kairo-project-selector）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-PROJ-001 | 列表展示 | 打开选择器 | header 标题+项目数；列表每项 button 含 name/path/active 徽标（aria-current） | P1 | ☐ | ☐ |
| TC-PROJ-002 | 切换激活 | 点非当前项目 | setProject 生效：状态栏/Java LS/各视图联动刷新 | P0 | ☐ | ☐ |
| TC-PROJ-003 | 错误横幅 | 断连打开 | role=alert banner；恢复有重试途径 | P1 | ☐ | ☐ |
| TC-PROJ-004 | 空态 | 无项目 | codicon-folder 空态引导 | P2 | ☐ | ☐ |
| TC-PROJ-005 | 记忆上次选择 | 选 A→重启同工作区 | 自动恢复（Storage key kairo.lastSelectedProjectId:<ws>） | P2 | ☐ | ☐ |
| TC-PROJ-006 | 单项目自动选中 | 仅 1 项目启动 | 自动激活 | P1 | ☐ | ☐ |
| TC-PROJ-007 | YAML 自动绑定 | 含 .kairo/project.yaml 的未注册项目 | tryAutoBindFromYaml 自动导入；409 冲突两级回退匹配 | P2 | ☐ | ☐ |

## 10.2 项目结构对话框（命令 kairo.project.structure，Ctrl+Alt+Shift+S）

四个 Tab：project(folder)/sdk(server-environment)/sources(source-control)/dependencies(library)。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-PROJ-011 | 无项目守卫 | 无项目执行命令 | warn "No active project..."；isEnabled=false | P1 | ☐ | ☐ |
| TC-PROJ-012 | toggle 行为 | 连续执行两次 | 一开一关 | P3 | ☐ | ☐ |
| TC-PROJ-013 | project Tab | 打开 | encoding.default、sourceLayout.src/testSrc 等 config 字段展示 | P1 | ☐ | ☐ |
| TC-PROJ-014 | sdk Tab | 切 SDK | radio auto-detect 或具体 toolchain（vendor/version/home）；Add JDK 走文件夹选择→POST toolchains/import | P1 | ☐ | ☐ |
| TC-PROJ-015 | sources Tab | 添加源目录 | 文件夹 picker 添加；isTest checkbox 可标测试源码 | P1 | ☐ | ☐ |
| TC-PROJ-016 | dependencies Tab | 观察 | classpath 条目带来源徽章 autodetect/MANUAL/ANT/YAML；Add Jar/Directory 标 manual；**仅 manual 可删** | P1 | ☐ | ☐ |
| TC-PROJ-017 | JDT classpath 合并 | JDT 在线打开 | jdtls/project(autoDetectClasspath:true) 返回 entries 与手工去重合并 | P2 | ☐ | ☐ |
| TC-PROJ-018 | 手填停用探测 | Add Jar 后 Save | 再发的请求带 autoDetectClasspath:false | P2 | ☐ | ☐ |
| TC-PROJ-019 | 保存成功 | 改 encoding=gbk→Save | PUT /projects/{id}→jdtls/project 同步 libraries→setProject 广播→info toast | P0 | ☐ | ☐ |
| TC-PROJ-020 | 保存失败 | 断连 Save | messageService.error + 对话框内 error 区；TypeError 类原始错误被友好化 | P1 | ☐ | ☐ |

---

# 第11章 文件资源管理器（Navigator）测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-NAV-001 | 树加载 | 打开工作区 | 完整呈现 legacy-sample 结构 | P0 | ☐ | ☐ |
| TC-NAV-002 | 新建文件/夹 | 右键 New | 创建即时出现；非法名校验 | P1 | ☐ | ☐ |
| TC-NAV-003 | 重命名/删除 | 右键操作 | 生效；删除受 confirmBeforeDelete 控制（默认弹确认） | P1 | ☐ | ☐ |
| TC-NAV-004 | 自动定位 | 打开某文件 | autoRevealInExplorer=true 时定位高亮 | P2 | ☐ | ☐ |
| TC-NAV-005 | VCS 装饰 | VCS 副本改文件 | 尾部圆点/角标着色（git M黄/A绿/D红；svn 同类） | P1 | ☐ | ☐ |
| TC-NAV-006 | GBK 双击打开 | 双击 GBK .jsp | Monaco 打开中文不乱码（项目编码 override 生效） | P0 | ☐ | ☐ |
| TC-NAV-007 | 外部变更感知 | IDE 外新建文件 | watcher 自动出现 | P2 | ☐ | ☐ |

---

# 第12章 编辑器核心功能测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-ED-001 | 打开/关闭 | 多文件操作 | 多 tab；Ctrl+F4/W 关闭 | P0 | ☐ | ☐ |
| TC-ED-002 | 保存与脏标 | 改→Ctrl+S | dirty 圆点消失；磁盘更新；本地历史新增快照 | P0 | ☐ | ☐ |
| TC-ED-003 | Undo/Redo 深度 | 20 步撤销再重做 | 正确回放 | P1 | ☐ | ☐ |
| TC-ED-004 | 多光标 | Ctrl+Alt+↑/↓ 加光标；Alt+J 下一个匹配；Ctrl+Alt+Shift+J 全选匹配 | 按 IDEA 行为生效（Monaco 层） | P1 | ☐ | ☐ |
| TC-ED-005 | 删行/复制行/移动行 | Ctrl+Y / Ctrl+D / Shift+Alt+↑↓ | 生效 | P1 | ☐ | ☐ |
| TC-ED-006 | 大小写切换 | Ctrl+Shift+U | 转换 | P3 | ☐ | ☐ |
| TC-ED-007 | 注释 | Ctrl+/ 、Ctrl+Shift+/ | 按 language configuration 正确注释（java/jsp/xml 各自符号） | P1 | ☐ | ☐ |
| TC-ED-008 | 文件内查找替换 | Ctrl+F / Ctrl+R / F3 / Shift+F3 | 高亮循环正则开关正常 | P1 | ☐ | ☐ |
| TC-ED-009 | 折叠 | Ctrl+-/= ；Ctrl+Shift+-/= | 单个/全部折叠生效；#region 可折叠 | P2 | ☐ | ☐ |
| TC-ED-010 | 括号匹配 | Ctrl+Shift+M | 跳到匹配括号 | P2 | ☐ | ☐ |
| TC-ED-011 | 自动闭合 | 输入 `{` `(` `[` `"` 及 `<% %>` `${ }` | 按 configuration 配对闭合 | P1 | ☐ | ☐ |
| TC-ED-012 | 缩进 | Tab/Shift+Tab；粘贴缩进 | insertSpaces=true、tabSize=4 默认 | P1 | ☐ | ☐ |
| TC-ED-013 | Breadcrumbs | 打开深层文件 | 默认开启面包屑 | P2 | ☐ | ☐ |
| TC-ED-014 | Minimap | 观察 | 默认关（IDEA 风）；可设置开启 | P3 | ☐ | ☐ |
| TC-ED-015 | 自动保存默认 | files.autoSave | 默认 off；改 editor.autoSave 后行为生效且与 Theia 偏好双向同步 | P1 | ☐ | ☐ |
| TC-ED-016 | 保存时格式化 | 开 formatOnSave 保存 .java | 自动格式化（edits 逆序应用防位移） | P1 | ☐ | ☐ |
| TC-ED-017 | 失焦全存 | onFrameDeactivation=true 且有 running server 时切出窗口 | core.saveAll 自动执行 | P2 | ☐ | ☐ |

---

# 第13章 Java 语言功能测试

> 前提：JDT LS 就绪（状态栏/Perf Dashboard 显示 ready）。链路：prepare→launch-descriptor→JdtLsManager spawn（宿主 JRE21+）→LSP initialize。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-JAVA-001 | LS 就绪与索引进度 | 打开 .java | 数秒 ready；$/progress 索引进度可见、可暂停、可强制重建 | P0 | ☐ | ☐ |
| TC-JAVA-002 | 语法高亮 | 观察 HelloWorld.java | 注解 @Override、UPPER_SNAKE 常量、大驼峰类型、javadoc、textblock 着色正确 | P1 | ☐ | ☐ |
| TC-JAVA-003 | 基础补全 | 输入 `System.` | JDT 补全（保存后首次≤1.5s 目标）；kind 图标正确 | P0 | ☐ | ☐ |
| TC-JAVA-004 | Smart Completion | Ctrl+Shift+Space | 3 档循环过滤（期望类型→方法字段→全部重排） | P2 | ☐ | ☐ |
| TC-JAVA-005 | LS 降级补全 | LS 不可用场景 | fallback 提供：关键字/常用类型/snippet/作用域变量/import 补全（上限100） | P1 | ☐ | ☐ |
| TC-JAVA-006 | Hippie 补全 | Alt+/ 连按 | 词法补全循环（java+jsp 都注册） | P2 | ☐ | ☐ |
| TC-JAVA-007 | Live Templates | main/sout 等缩写 Tab | 展开占位符跳转；postfix 如 expr.sout 可用 | P1 | ☐ | ☐ |
| TC-JAVA-008 | 用户自定义模板 | 模板管理添加 | StorageService 持久化重启仍在 | P3 | ☐ | ☐ |
| TC-JAVA-009 | 定义跳转 | Ctrl+B/F4/Ctrl+Click | 跳转准确；跨文件加入导航栈（Back 可回） | P0 | ☐ | ☐ |
| TC-JAVA-010 | Implementation | Ctrl+Alt+B | 列出实现 | P1 | ☐ | ☐ |
| TC-JAVA-011 | 类型层次 | Ctrl+H | Type Hierarchy supertypes/subtypes | P1 | ☐ | ☐ |
| TC-JAVA-012 | 调用层次 | Ctrl+Alt+H | incoming/outgoing 打开底部层次 widget | P2 | ☐ | ☐ |
| TC-JAVA-013 | Super Method | Ctrl+U | 跳父类方法 | P2 | ☐ | ☐ |
| TC-JAVA-014 | Find Usages | Alt+F7 | 底部引用面板列出引用 | P1 | ☐ | ☐ |
| TC-JAVA-015 | Show Usages 弹层 | Ctrl+Alt+F7 | QuickPick：文件分组、声明标记、方向键 live preview、单结果直跳 | P2 | ☐ | ☐ |
| TC-JAVA-016 | Hover | 悬停 API | Javadoc 渲染 | P1 | ☐ | ☐ |
| TC-JAVA-017 | 参数提示 | 括号内 Ctrl+P | 签名帮助；trigger ( , | P1 | ☐ | ☐ |
| TC-JAVA-018 | 快速修复 | 制造错误 Alt+Enter | quickfix 列表与应用 | P0 | ☐ | ☐ |
| TC-JAVA-019 | Organize Imports | Ctrl+Alt+O | 合并排序去星号 import；保存联动开关 | P1 | ☐ | ☐ |
| TC-JAVA-020 | 重命名 | Shift+F6 | 跨文件 refactor 正确应用（含未打开文件） | P1 | ☐ | ☐ |
| TC-JAVA-021 | 提取重构 | Ctrl+Alt+V/M/C/F；改签名 Ctrl+F6 | 各重构生成正确 | P1 | ☐ | ☐ |
| TC-JAVA-022 | Override/Implement | Ctrl+O / Ctrl+I | 方法生成骨架插入 | P2 | ☐ | ☐ |
| TC-JAVA-023 | Surround With | Ctrl+Alt+T | if/for/try-catch 包裹选区 | P2 | ☐ | ☐ |
| TC-JAVA-024 | Unwrap | Ctrl+Shift+Delete | 移除包裹 | P3 | ☐ | ☐ |
| TC-JAVA-025 | Complete Statement | Ctrl+Shift+Enter | 补分号括号换行 | P3 | ☐ | ☐ |
| TC-JAVA-026 | 诊断标记 | 制造编译错误 | 波浪线 + Problems 同步（owner kairo-java 双通道） | P0 | ☐ | ☐ |
| TC-JAVA-027 | 格式化 | Ctrl+Alt+L | document/range formatting 生效 | P1 | ☐ | ☐ |
| TC-JAVA-028 | Inlay Hints | 链式调用处 | 参数名 hints 渲染（若启用） | P3 | ☐ | ☐ |
| TC-JAVA-029 | CodeLens | 类/方法上方 | references lens + Run/Debug lens 可点 | P2 | ☐ | ☐ |
| TC-JAVA-030 | 类反编译 | Ctrl+Click 第三方 jar 类 | jdt:// 只读编辑器打开反编译/附加源码 | P2 | ☐ | ☐ |
| TC-JAVA-031 | 磁盘 .class | 双击 classes 下 .class | 反编译内容展示 | P3 | ☐ | ☐ |
| TC-JAVA-032 | 一键运行 main | Run CodeLens/右键 | OutputChannel 输出 stdout/stderr 与 exit code | P1 | ☐ | ☐ |
| TC-JAVA-033 | 文件结构 | Ctrl+F12 | DocumentSymbol 列表跳转 | P1 | ☐ | ☐ |
| TC-JAVA-034 | workspace symbols | Find Symbol 搜类名 | java.workspaceSymbols 返回按 kind 过滤 | P2 | ☐ | ☐ |
| TC-JAVA-035 | LS 崩溃熔断 | 连续制造崩溃 5 次 | 60s 内熔断拒绝再启；状态栏 Show Logs/Open Install Folder 可用 | P3 | ☐ | ☐ |
| TC-JAVA-036 | LS 自动重启 | 杀 jdt ls 进程 | 指数退避重启（1s→10s 封顶最多3次）；exit 13/OSGi 缺失视为致命不再重启 | P2 | ☐ | ☐ |
| TC-JAVA-037 | degraded 态 | source level 配为 9+ | 服务态 degraded 提示（v1 支持 1.5–1.8） | P3 | ☐ | ☐ |
| TC-JAVA-038 | didChange 同步 | 编辑后立即补全 | 100ms debounce 全文同步在补全前 flush（无陈旧建议） | P2 | ☐ | ☐ |

---

# 第14章 JSP 语言功能测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-JSP-001 | 语法高亮总览 | 打开含指令/scriptlet/EL/JSTL 的 index.jsp | `<%@ %>` 指令态、`<%! %>`/`<%= %>`/`<% %>` 嵌入 java、`${}`/`#{}` EL 态、c:/fmt:/fn: JSTL、自定义 taglib 分色正确 | P0 | ☐ | ☐ |
| TC-JSP-002 | 属性值内嵌 EL | `<a href="${ctx}/x">` | 属性值内 `${}` 再入 el 态着色 | P2 | ☐ | ☐ |
| TC-JSP-003 | scriptlet 背景装饰 | 观察 scriptlet 行 | 左边框/背景区分 scriptlet/expression/declaration 三类 | P2 | ☐ | ☐ |
| TC-JSP-004 | scriptlet Java 补全 | `<% request.` 触发 | 虚拟 CU（注入 request/response/out/session 等 9 隐式字段）→ JDT 补全置顶；无 textEdit 污染 | P0 | ☐ | ☐ |
| TC-JSP-005 | 语境 snippet | `<%!` 内 / `<%=` 内分别触发 | declaration→字段方法建议；expression→request.getParameter/session.getAttribute/out 建议（中文描述） | P1 | ☐ | ☐ |
| TC-JSP-006 | scriptlet 诊断映射 | `<% %>` 内写非法 Java | 500ms debounce 后诊断坐标**正确映射回 JSP 行列**（expression 减前缀偏移），owner=jsp-scriptlet-java | P0 | ☐ | ☐ |
| TC-JSP-007 | EL 补全 | `${` 后 Ctrl+Space | 根级 11 隐式对象（中文描述）+16 运算符；`.` 后属性；toString()/equals()/hashCode()/getClass() 片段 | P1 | ☐ | ☐ |
| TC-JSP-008 | EL hover | 悬停 ${sessionScope} | 类型 HttpSession 与说明；#{}} 标注延迟表达式 | P2 | ☐ | ☐ |
| TC-JSP-009 | EL 导航 | Ctrl+Click ${pageContext.request} | 解析隐式对象→Java 类型；${bean.prop} 找到 bean 类 | P2 | ☐ | ☐ |
| TC-JSP-010 | JSP→Servlet 导航 | Ctrl+Click form action="/login.do" | web.xml mapping 匹配（exact→prefix→extension→default）跳 Servlet | P1 | ☐ | ☐ |
| TC-JSP-011 | web.xml→Java | Ctrl+Click servlet-class FQN | 跳到 .java 源文件 | P1 | ☐ | ☐ |
| TC-JSP-012 | web.xml→JSP | Ctrl+Click jsp-file | 跳 JSP；servlet-name 智能解析到类或 JSP | P2 | ☐ | ☐ |
| TC-JSP-013 | Java→web.xml 反查 | Servlet 类内查找引用 | 扫描 5 种常见 web.xml 路径命中 | P2 | ☐ | ☐ |
| TC-JSP-014 | taglib uri 补全 | <%@ taglib uri=" 触发 | 工作区 .tld URI + 5 个 JSTL 内置 URI；prefix= 建议；已出现不再建议 | P1 | ☐ | ☐ |
| TC-JSP-015 | 自定义标签补全 | 输入 <my: | 标签补全（doc 含 Tag Class/Body Content/Attributes 表）；插入带占位 snippet；required 排前带 [required] | P1 | ☐ | ☐ |
| TC-JSP-016 | 标签属性补全 | 已知标签内空格 | 属性列表含 required/[EL] 信息；rtexprvalue 缺省 false；接受 yes/no | P2 | ☐ | ☐ |
| TC-JSP-017 | TLD 缓存失效 | 修改 .tld 或 WEB-INF/lib/*.jar | watcher invalidateCache 反映新定义（保留 WEB-INF/lib 扫描） | P2 | ☐ | ☐ |
| TC-JSP-018 | 结构视图 | Outline 打开 JSP | 四类符号：指令、scriptlet/decl/expr、白名单 JSTL 标签（c:if/c:forEach/c:choose/c:when/c:otherwise/c:set/c:out/c:url/c:param/c:import/c:redirect）、自定义标签 | P2 | ☐ | ☐ |
| TC-JSP-019 | live templates 门控 | HTML 区输入 sout | **不**展开（insideJavaBlock 门控）；java 块内展开 | P2 | ☐ | ☐ |
| TC-JSP-020 | JSP 查找用法 | 对类查找 JSP 引用 | import/useBean/scriptlet 引用 + web.xml 引用汇总（30s 超时保护） | P3 | ☐ | ☐ |
| TC-JSP-021 | JSP 断点实验特性 | 偏好 kairo.jsp.debugBreakpoints 开启 | 首次弹实验警告；CodeLens Toggle Breakpoint 出现；Jasper 行映射（// line N 或 SMAP） | P3 | ☐ | ☐ |

---

# 第15章 XML/DTD/web.xml/TLD 功能测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-XML-001 | 语法高亮 | 打开 web.xml | 声明/PI/CDATA/注释/DOCTYPE/实体着色 | P1 | ☐ | ☐ |
| TC-XML-002 | web.xml 元素补全 | `<` 触发 | 28 项元素（多数含子元素骨架 snippet，中文 doc） | P1 | ☐ | ☐ |
| TC-XML-003 | TLD 元素补全 | .tld 内 `<` | 14 项（taglib/tag/tag-class/body-content/attribute…） | P1 | ☐ | ☐ |
| TC-XML-004 | 通用属性补全 | 开标签内空格 | xmlns/xsi:schemaLocation/version/encoding/id 等 6 项 | P2 | ☐ | ☐ |
| TC-XML-005 | 多余闭合校验 | 制造 `</extra>` | Error marker（owner kairo-xml-dtd） | P1 | ☐ | ☐ |
| TC-XML-006 | 标签不匹配 | `<a></b>` | Error 中文消息含期望标签与行号 | P1 | ☐ | ☐ |
| TC-XML-007 | 未闭合标签 | 制造未闭合 | Error | P1 | ☐ | ☐ |
| TC-XML-008 | 本地 DTD/XSD 引用 | DOCTYPE 指向存在/缺失的本地文件 | 缺失 Warning；远程 http:/urn: 跳过 | P2 | ☐ | ☐ |
| TC-XML-009 | 编码声明提示 | 非 utf-8/gbk/gb2312/iso-8859-1 声明 | Info 提示 | P3 | ☐ | ☐ |
| TC-XML-010 | 性能护栏 | >1MB xml；构造慢校验 | 跳过并 Warning；5s deadline 到点落 TimeoutWarning（每64标签检查点） | P2 | ☐ | ☐ |
| TC-XML-011 | 注释偏移保真 | 注释后制造错误 | 注释等长空白掩码保证行列准确 | P2 | ☐ | ☐ |
| TC-XML-012 | 符号特判 | Outline 打开 web.xml/.tld | servlet→Class、servlet-mapping→Interface、filter/listener→Class、error-page→Event；detail 显示 name | P3 | ☐ | ☐ |

---

# 第16章 JSON 与 Properties 功能测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-JSON-001 | 高亮与注释 | .json 与 .jsonc | jsonc 允许 // 注释着色 | P2 | ☐ | ☐ |
| TC-JSON-002 | schema 键补全 | package.json/tsconfig.json/.eslintrc.json 内触发 | 分别建议 16/5/9 个常见键 | P2 | ☐ | ☐ |
| TC-JSON-003 | 值补全 | 冒号后触发 | {}[]"" true/false/null snippet | P3 | ☐ | ☐ |
| TC-JSON-004 | JSON 校验 | 制造语法错误 | parse 错误 position 映射行列 marker（owner kairo-json-validate）；>1MB 跳过 | P1 | ☐ | ☐ |
| TC-PROP-001 | properties 高亮 | 打开 .properties | # 和 ! 注释、三种分隔、`\` 续行多行值着色 | P1 | ☐ | ☐ |
| TC-PROP-002 | 键补全 | 行首触发 | datasource/logging/server/spring/app/mybatis 六类内置键；注释行不建议 | P2 | ☐ | ☐ |
| TC-PROP-003 | \uXXXX 反转义 | 含 \u4e2d\u6587 内容 | 显示层反转义中文（含代理对合成增补平面字符） | P2 | ☐ | ☐ |
| TC-PROP-004 | 保存编码 | 保存含中文 properties | ISO-8859-1+\uXXXX 由 agent 处理；BMP 外字符输出 UTF-16 代理对而非截断 | P1 | ☐ | ☐ |

---

# 第17章 编码功能测试（GBK 重点专项）

> 架构：字节级检测/转换在 Go agent（七级判定：BOM→XML声明→HTML meta/JSP charset→UTF-8合法性→GB18030 试解码→默认编码 canDecode→iso-8859-1 兜底）；前端负责 id 域转换与 UI。Safe Encoding Service 保证 encode 往返校验，**永不静默写 '?'**。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-ENC-001 | GBK 打开不乱码 | 项目编码 gbk 下打开 GBK .java | 中文正常显示；tab 标题追加灰色 ` [GBK]` 后缀，tooltip 显示编码 | P0 | ☐ | ☐ |
| TC-ENC-002 | 自动探测准确 | 打开 UTF-8 BOM / GB18030 / iso-8859-1 文件 | 检出正确（BOM 1.0 置信度；GB18030 密度判定）；utf-8-bom tab 显示 [UTF-8-BOM] | P0 | ☐ | ☐ |
| TC-ENC-003 | ASCII 回退 | 项目默认 gbk + 纯 ASCII | 返回 gbk 置信度 0.55（不谎报 utf-8） | P3 | ☐ | ☐ |
| TC-ENC-004 | Reopen with Encoding | reopen→QuickPick 选 GBK | 当前编码标注"当前"；原地重解码无二次乱码 | P0 | ☐ | ☐ |
| TC-ENC-005 | Reopen 脏文件拒绝 | 有未保存修改时 Reopen | **拒绝并回滚 override**（refused-dirty），绝不丢弃未保存编辑 | P0 | ☐ | ☐ |
| TC-ENC-006 | Save with Encoding | save→选 GBK | 先 setEncodingFor 再 write（顺序防假保存）；round-trip 校验先行；保存后 dirty 清除 | P0 | ☐ | ☐ |
| TC-ENC-007 | 不可表示字符拒绝 | GBK 文件输入 emoji 🙂 保存 | **报错阻止**（错误含字符/U+码点/行列/编码），文件不被静默写成 '?'；dirty 点不消失 | P0 | ☐ | ☐ |
| TC-ENC-008 | Convert Encoding | convert：gbk→utf-8 | ConfirmDialog→recode（真实 fsPath）原子写回→reload；字节正确转换 | P0 | ☐ | ☐ |
| TC-ENC-009 | Show Encoding | show 命令 | 通知显示缓存编码 | P2 | ☐ | ☐ |
| TC-ENC-010 | 目录级覆盖 | overrides 配置 `src/`: utf-8 | src 下文件按 utf-8 打开（最深路径优先） | P1 | ☐ | ☐ |
| TC-ENC-011 | 三级优先 | per-file 与目录冲突 | per-file > 最深文件夹 > 扩展名 | P2 | ☐ | ☐ |
| TC-ENC-012 | EOL 转换 | recode 带 eol=crlf | 行尾归一化 | P3 | ☐ | ☐ |
| TC-ENC-013 | 外部修改失效 | 外部改文件 | 编码缓存失效重新探测 | P2 | ☐ | ☐ |
| TC-ENC-014 | GBK 全文搜索 | 搜 GBK 文件中的中文 | agent 按检出编码逐行扫描命中 | P0 | ☐ | ☐ |
| TC-ENC-015 | YAML 双解 | .kairo/project.yaml 为 GBK | UTF-8 坏字符多时尝试 GBK 取更优 | P3 | ☐ | ☐ |
| TC-ENC-016 | 编码下拉全集 | 查看设置 kairo.encoding.defaultProjectEncoding | 八种：utf-8/utf-8-bom/utf-16le/utf-16be/gbk/gb18030/iso-8859-1/us-ascii | P2 | ☐ | ☐ |

---

# 第18章 搜索功能全家桶测试

## 18.1 Search Center（IDEA Find in Path，Ctrl+Shift+F）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SRCH-001 | 打开方式 | Ctrl+Shift+F | body overlay 弹层（backdrop+modal，testid search-center-modal）；Theia SIW 同名键已注销 | P0 | ☐ | ☐ |
| TC-SRCH-002 | 全局捕获 | Monaco 聚焦时按 Ctrl+Shift+F | capture 拦截仍打开；modal 内按键放行 | P1 | ☐ | ☐ |
| TC-SRCH-003 | 三开关 | 依次点 Aa / .* / W | caseSensitive/isRegex/wholeWord 随请求发送 | P1 | ☐ | ☐ |
| TC-SRCH-004 | 流式结果 | 搜常见词 | WS search/stream 每 50 条一批增量合并；total/done 统计完成；60s idle 看门狗兜底 | P1 | ☐ | ☐ |
| TC-SRCH-005 | 结果分组 | 观察 VirtualList | by-directory/by-file/flat 分组；←/→ 折叠展开 | P1 | ☐ | ☐ |
| TC-SRCH-006 | 键盘导航 | ↑↓/Home/End/Enter/Shift+Enter/Ctrl+Enter | ↑↓移动跳过 header；Enter 打开；Shift+Enter 打开并关弹层；Ctrl+Enter preserveFocus 保弹层 | P1 | ☐ | ☐ |
| TC-SRCH-007 | Esc 关闭 | Esc | capture 关闭；docked Find 结果保留 | P2 | ☐ | ☐ |
| TC-SRCH-008 | 文件掩码 | 掩码输入 `java, !Test` | 裸词→*.java；! 前缀排除；include 收窄正确（规避 OR 陷阱） | P2 | ☐ | ☐ |
| TC-SRCH-009 | 范围下拉 | 切 scope=Current File/Directory/Module/Selection | resolveScope 转 include:[相对路径] 或 base/**/mask | P2 | ☐ | ☐ |
| TC-SRCH-010 | 高级排除 | 展开 Advanced exclude 行 | exclude globs 生效 | P3 | ☐ | ☐ |
| TC-SRCH-011 | 历史与固定 | 多次搜索后下拉 | history 上限 50 去重；pinned 上限 10 | P3 | ☐ | ☐ |
| TC-SRCH-012 | 取消语义 | 连续输入新查询 | 旧 AbortController abort→CancelledError 不当错误展示；requestId stale 保护 | P1 | ☐ | ☐ |

## 18.2 Replace in Path（Ctrl+Shift+R）— 事务化替换

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SRCH-021 | 替换预览 | replace tab 输入替换文本 | preview 后像列即时生成；replacement 展示 | P1 | ☐ | ☐ |
| TC-SRCH-022 | Replace All | 执行 | 两阶段事务：preflight 全量指纹比对（FNV-1a）任一漂移零写入→phase2 条件写（encoding+mtime+etag） | P0 | ☐ | ☐ |
| TC-SRCH-023 | Undo | 点 Undo（仅 applied 且无 failed 可用） | 先验 post-image 再逆序写回 original；undo 中途失败把已 undo 回滚到 applied 态（不留半撤销） | P0 | ☐ | ☐ |
| TC-SRCH-024 | 二进制/超大防护 | 对含 \0 或 >5MB 文件替换 | 该文件被拒绝 | P1 | ☐ | ☐ |
| TC-SRCH-025 | 内容漂移拒绝 | 替换前手工改文件 | preflight 检出漂移零写入 | P1 | ☐ | ☐ |

## 18.3 Search Everywhere（双击 Shift）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SRCH-031 | 双击 Shift 唤起 | 400ms 内双击 Shift | 弹层出现；输入框内双击忽略 | P1 | ☐ | ☐ |
| TC-SRCH-032 | 分类 tabs | 切 all/files/types/symbols/actions | files/types/symbols/actions 并发 allSettled；**部分失败降级，全败才报错** | P1 | ☐ | ☐ |
| TC-SRCH-033 | fuzzy 排序 | 搜 "HeloWor" | 精确子串 10000-pos*10-len差；子序列/词边界加权排序合理 | P3 | ☐ | ☐ |

## 18.4 Find File / Class / Symbol / Action

| 编号 | 弹层 | 入口键 | 验证要点 | P | D | B |
|------|------|--------|----------|---|---|---|
| TC-SRCH-041 | Find File | Ctrl+N（浏览器 remap 见附录B） | 文件索引 maxFiles 50000 TTL15s；fuzzy 双路（名称 vs 路径-500）；pathWeight(src+3/lib+2/test+1)；150ms debounce；空查询 recent 20；agent 不可用回退 BFS ≤10000 访问 | P1 | ☐ | ☐ |
| TC-SRCH-042 | Find Class | Ctrl+Shift+N | 两段式：索引 Foo.java(+40)+包名剥离启发式；JDT ready 后 workspaceSymbols{Class/Enum/Interface/Struct}，源文件 +50 bonus；3s 缓存**不缓存空结果** | P1 | ☐ | ☐ |
| TC-SRCH-043 | Find Symbol | Ctrl+Shift+Alt+N | {Method/Property/Field/Constructor/Function/Variable/Constant} 过滤 | P2 | ☐ | ☐ |
| TC-SRCH-044 | Find Action | Ctrl+Shift+A | 有 label 非 _ 开头 isVisible 的命令；detail 显示格式化快捷键 | P2 | ☐ | ☐ |
| TC-SRCH-045 | 路径安全 | 结果含 ../ 或绝对路径尝试 | 拒绝 scheme/绝对/..逃逸（含 decodeURIComponent 后） | P2 | ☐ | ☐ |

## 18.5 docked Find 结果窗

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SRCH-051 | 底部 Find 窗 | kairo.search.results.open 或搜索后 | bottom rank150；与弹层共享 session model，弹层关后结果留存 | P2 | ☐ | ☐ |
| TC-SRCH-052 | 默认排除 glob | 搜 node_modules 内词汇 | 默认排除 node_modules/.git/WEB-INF/lib/*.class 生效 | P2 | ☐ | ☐ |

---

# 第19章 构建系统测试

## 19.1 Builds 视图（id=kairo-build-view）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-BUILD-001 | 触发构建 | 工具栏 Build 或 Ctrl+F9 | 记录 pending→running(spinner)→succeeded✓/failed✗；徽章 aria-live | P0 | ☐ | ☐ |
| TC-BUILD-002 | Clean Build | Clean Build 按钮 | clean 后全量构建 | P1 | ☐ | ☐ |
| TC-BUILD-003 | Cancel | running 中点 Cancel | DELETE /builds/{id}→cancelled；重复点 Cancel 不重复请求（in-flight 去重） | P1 | ☐ | ☐ |
| TC-BUILD-004 | 诊断列表 | 制造编译错误后构建 | Diagnostics 区逐条 file:line:col severity code message；hint→info 映射；summary "N errors, M warnings" | P0 | ☐ | ☐ |
| TC-BUILD-005 | Marker 联动 | 失败后打开出错文件 | monaco marker（owner kairo-build）；Problems 点击跳转；下次成功构建清除所有旧 marker | P0 | ☐ | ☐ |
| TC-BUILD-006 | History | 观察历史列表 | 上限200条；bootstrap 快照恢复；终态事件 refetch 补全 diagnostics（外部启动的构建也出现） | P2 | ☐ | ☐ |
| TC-BUILD-007 | null 容错 | 未跑编译器的构建 | summary/diagnostics 为 null 不崩 | P2 | ☐ | ☐ |
| TC-BUILD-008 | workspace 切换 | 切换工作区 | re-bootstrap（generation 防旧覆盖新）；断连 disconnected 态 + Reconnect 按钮 | P1 | ☐ | ☐ |
| TC-BUILD-009 | javac 参数 | 检查 agent 日志/输出 | -source/-target 与配置一致且低于最小级别自动抬升（JDK21+ min 8）；-encoding 一致；-g -Xlint:all,-options | P1 | ☐ | ☐ |
| TC-BUILD-010 | Windows argfile | >50 个源文件（Win） | 使用 .kairo-javac-*.args 构建成功 | P1 | ☐ | — |
| TC-BUILD-011 | 中文 javac 输出 | 中文 Windows 错误输出 | 「错误/警告」严重级正确映射；javac -help GBK 双解码探测 | P1 | ☐ | ☐ |
| TC-BUILD-012 | 输出脱敏 | 构建参数含密码类值 | 路径→\<workspace\>/\<jdk\>；password/token/secret/api_key 打码 | P2 | ☐ | ☐ |
| TC-BUILD-013 | 幂等重放 | 同 requestId 重发 POST /builds | 返回缓存结果 + X-Kairo-Idempotent-Replay:1（5min TTL） | P3 | ☐ | ☐ |
| TC-BUILD-014 | 构建超时 | 长编译 | 默认 5 分钟超时取消；cancel 等待 10s 杀树 | P2 | ☐ | ☐ |

## 19.2 Ant 构建

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-BUILD-021 | ant war | build.type=ant target=war 启动服务器 | ant -buildfile build.xml war [-D...] 执行；产物部署成功 | P0 | ☐ | ☐ |
| TC-BUILD-022 | 非法 target | 配置不存在 target | ValidateTargets 预检提前报错 | P2 | ☐ | ☐ |
| TC-BUILD-023 | classpath 分析 | analyze 端点/依赖视图 | 返回 buildFile/classpath[]/sourceRoots/outputDir/properties/warnings | P2 | ☐ | ☐ |
| TC-BUILD-024 | Ant 取消 | 构建中 cancel | ForceStop 杀整棵进程树（5s） | P2 | ☐ | ☐ |

## 19.3 自定义构建（id=kairo-custom-build）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-BUILD-031 | 执行命令 | 输入 `dir`（Win）/`ls -la` 点 Run | POST /build/custom→1s 轮询至终态；exitCode banner 绿/红；日志自动滚底 | P1 | ☐ | ☐ |
| TC-BUILD-032 | 空命令 | 不输入点 Run | MessageService.error 提示需要命令 | P2 | ☐ | ☐ |
| TC-BUILD-033 | Stop | 运行中点 Stop | cancel→cancelled exitCode=-1 | P2 | ☐ | ☐ |
| TC-BUILD-034 | 30 分钟上限 | 长命令挂起 | deadline 到 exitCode=-1；agent 侧 30min ctx | P3 | ☐ | ☐ |
| TC-BUILD-035 | 沙箱拒绝 | command 中 cd 到项目外 | root/workingDir 沙箱校验拒绝 | P1 | ☐ | ☐ |

---

# 第20章 Maven 视图测试

> 注意：maven-extension 为空壳包，实际 UI 为 theia-product 的 maven-view-widget（Detect/Refresh Dependencies/Lifecycle/Dependencies/Output），能力全在 agent 端点。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-MAVEN-001 | 自动 Detect | 打开含 pom.xml 工作区 | 挂载即 detect；头部显示 groupId:artifactId:version（testid maven-coords） | P1 | ☐ | ☐ |
| TC-MAVEN-002 | 无 pom 空态 | 无 pom 工作区 | "No pom.xml found in workspace root."；Refresh 禁用 | P1 | ☐ | ☐ |
| TC-MAVEN-003 | Lifecycle 任务 | 逐个 validate/compile/test/package/install | offline:true 执行；按钮禁用+Running...；toast completed / failed(exit N) | P1 | ☐ | ☐ |
| TC-MAVEN-004 | task 白名单 | 直发非法 task | agent IsAllowedTask 拒绝 invalid_request | P3 | ☐ | ☐ |
| TC-MAVEN-005 | 依赖树 | Refresh Dependencies | 递归树：depth×16px 缩进、▼/▶（depth<2 默认展开）、scope 徽章、optional 小徽章 | P2 | ☐ | ☐ |
| TC-MAVEN-006 | 冲突检测 | 构造同 G:A 多版本 | Conflicts 区列出冲突 | P3 | ☐ | ☐ |
| TC-MAVEN-007 | Output 区 | 运行 goal 后 | pre 块显示成功输出/错误信息 | P2 | ☐ | ☐ |
| TC-MAVEN-008 | 多模块工程 | aggregator pom | modules 信息展示 | P3 | ☐ | ☐ |

---

# 第21章 Tomcat 服务器管理、部署与热更新测试

## 21.1 Servers 视图（id=kairo-server-view）

六态状态机：stopped→starting→{running,stopped,error,crashed}；running→stopping→…；error/crashed 用户可见折叠为 failed。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SRV-001 | 启动服务器 | Start（Shift+F10） | stopped→starting(play)→running(circle-filled)；URL 区出现 http://127.0.0.1:8080/；info 列表 id/port/pid/startTime；**start 请求绝不自动重试**（防重复 Tomcat 抢端口） | P0 | ☐ | ☐ |
| TC-SRV-002 | 就绪探测 | 观察 starting 时长 | agent TCP+HTTP 探测 60s 超时；失败错误带回 Tomcat 最后 40 行输出 | P1 | ☐ | ☐ |
| TC-SRV-003 | catalina-base 定制 | 检查生成目录 | server.xml：HTTP Connector 绑 **127.0.0.1**、autoDeploy=false unpackWARs=false、Context docBase=webappDir 且 **Reloadable=false** | P2 | ☐ | ☐ |
| TC-SRV-004 | Java9+ add-opens | 查看启动命令行 | --add-opens 四项存在 | P1 | ☐ | ☐ |
| TC-SRV-005 | 停止 | Stop | GracefulStop（CTRL_BREAK/SIGTERM）→超时 ForceStop(taskkill /T)；stopping(sync-spin)→stopped | P0 | ☐ | ☐ |
| TC-SRV-006 | Restart | Restart | 旧端口 bind 失败特征识别→自动换端口一次 | P1 | ☐ | ☐ |
| TC-SRV-007 | Open Application | Open App | 系统浏览器打开 URL（target=_blank rel=noopener） | P1 | ☐ | ☐ |
| TC-SRV-008 | Debug 启动 | Debug 按钮 | JDWP 随机空闲端口；suspend=y 只等 JDWP 口；info 区 **JDWP ready** 徽章；UI 保留 debugPort 不误显示为 Run | P1 | ☐ | ☐ |
| TC-SRV-009 | 非法转移容错 | 外部 kill Tomcat | running→stopped 表外转移被拒后**快照 reconcile 重取**（面板不卡死）；显示 crashed/failed | P1 | ☐ | ☐ |
| TC-SRV-010 | 多服务器列表 | 第二台不同 context/port | 列表逐台 state/port/JDWP 徽章；截断保留最近16台 | P2 | ☐ | ☐ |
| TC-SRV-011 | active 选择 | 历史 stopped+新 running 并存 | 优先 running/starting/stopping 而非数组首元素 | P2 | ☐ | ☐ |
| TC-SRV-012 | 断连空态 | 停 agent 打开视图 | disconnected 空态 + Reconnect 按钮 | P1 | ☐ | ☐ |
| TC-SRV-013 | bootstrap 时机 | 冷启动直接开视图 | context 出现即 bootstrap；已有 context 立即加载（不空白） | P1 | ☐ | ☐ |
| TC-SRV-014 | recoverable | agent 异常退出留下的记录 | 启动标 crashed(WasRunning)；Recover 重新拉起 | P2 | ☐ | ☐ |
| TC-SRV-015 | 六态图标核对 | 逐状态观察 | stopped=primitive-square/starting=play/running=circle-filled/stopping=sync-spin/error·crashed=error/disconnected=warning | P2 | ☐ | ☐ |

## 21.2 部署（Deployments 视图，id=kairo-deployments）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-DEP-001 | Build and Deploy | Ctrl+Shift+F9 | 构建→POST /deployments 到 webapps/<ctx>→DeploymentResult{filesTouched,bytes,added/modified/deleted}入列表 | P0 | ☐ | ☐ |
| TC-DEP-002 | Publish | kairo.publish | intent=publish-static-changes 自动解析 target；静态直推 | P1 | ☐ | ☐ |
| TC-DEP-003 | exploded/war | 两种 deploy.mode 分别启动部署 | exploded 直指 docBase；war 按 artifact 相对路径部署 | P1 | ☐ | ☐ |
| TC-DEP-004 | 进度事件 | 部署中观察 | WS deployment.progress 驱动进度展示 | P2 | ☐ | ☐ |
| TC-DEP-005 | 失败呈现 | 制造不可写 target | deploy_failed →视图错误横幅 | P1 | ☐ | ☐ |

## 21.3 热更新（Hot Deploy / Hot Reload Section）

四种模式 staticSync / compileOnly / classHotSwap / contextReload。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-HOT-001 | 静态保存即生效 | running 时改 JSP/CSS/JS/图片并保存 | direct docBase 模式浏览器刷新即见，**无需 Context Reload**；hotreload.status→synced 绿 | P0 | ☐ | ☐ |
| TC-HOT-002 | Java 保存自动编译同步 | 改 .java 保存（autoSyncOnSave=true） | pendingJavaFiles 合并 debounce 500ms→compile-incremental→waitForBuildTerminal(120s,500ms 轮询)→success→synced | P0 | ☐ | ☐ |
| TC-HOT-003 | Go 词表兼容 | 观察 waitForBuildTerminal | queued|running|success|failure|cancelled 正确终态判定 | P2 | ☐ | ☐ |
| TC-HOT-004 | 编译失败→restart_required | 写坏 .java 保存 | failure→restart_required 橙色 + i18n 警告通知 | P1 | ☐ | ☐ |
| TC-HOT-005 | Update Application | Ctrl+F10 | 整项目增量编译→success info "applicationUpdated(N)" | P1 | ☐ | ☐ |
| TC-HOT-006 | Reload Context | 点 Reload Context（window.confirm 确认） | POST /servers/{id}/reload touch web.xml→reloaded；页面生效 | P1 | ☐ | ☐ |
| TC-HOT-007 | autoSyncOnSave 复选框 | 切换 checkbox | 与 HotDeployService 共享偏好键；await 命令 Promise 后才报成败 | P2 | ☐ | ☐ |
| TC-HOT-008 | 构建完成联动 | 手动构建 succeeded | onBuildCompleted 自动增量编译+同步到 running server | P2 | ☐ | ☐ |
| TC-HOT-009 | debounce 边界 | 500ms 内连存 3 次 | 只触发一次批量 compile | P2 | ☐ | ☐ |
| TC-HOT-010 | classHotSwap | 调试会话中改方法体保存 | JDWP RedefineClasses 热替换；HotSwap History widget 记录；无 JDWP 时 501 unsupported 优雅提示 | P2 | ☐ | ☐ |
| TC-HOT-011 | 状态横幅 | 观察 HotReloadSection 卡片 | synced 绿/compiling 黄/restart_required 橙 + aria-live 状态条 | P2 | ☐ | ☐ |

## 21.4 Tomcat 日志查看器（id=kairo-log-viewer）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LOG-001 | 历史加载 | 打开 Logs | tail=1000 快照（loadGeneration 防陈旧）；[stdout]/[stderr] 流还原 | P1 | ☐ | ☐ |
| TC-LOG-002 | 实时追加 | 启动观察 | WS log 事件 80ms batch flush + 2000ms 轮询兜底 | P0 | ☐ | ☐ |
| TC-LOG-003 | 过滤 | 输入 Exception | 大小写不敏感过滤；stdout/stderr/structured 流筛选 | P1 | ☐ | ☐ |
| TC-LOG-004 | Pause/Resume | 点 Pause | 暂停轮询计数 buffered；Resume 冲刷 | P2 | ☐ | ☐ |
| TC-LOG-005 | Clear | 清屏 | 不影响日志文件 | P2 | ☐ | ☐ |
| TC-LOG-006 | Save As | 点保存 | Blob 下载 kairo-tomcat-<净化id>.log | P2 | ☐ | ☐ |
| TC-LOG-007 | autoScroll 智能 | 上滚离底>5px | autoScroll 自动关；触底重开 | P2 | ☐ | ☐ |
| TC-LOG-008 | 虚拟滚动与后台暂停 | 万行日志；切走 tab | VirtualList rowHeight24 流畅；不可见时暂停轮询 | P1 | ☐ | ☐ |
| TC-LOG-009 | 级别着色 | 观察 | stderr 或 error|exception|fatal|severe|fail→error 色；warn→warning 色 | P2 | ☐ | ☐ |
| TC-LOG-010 | 轮转去重 | 日志轮转 ordinal 回退 | seen 缓存重建不丢行不重复 | P3 | ☐ | ☐ |
| TC-LOG-011 | 状态 chips | 底部 | runtime 连接态/server 态/轮询间隔/live-buffered | P3 | ☐ | ☐ |

---

# 第22章 运行配置管理测试

> Widget id=kairo-run-configurations；文件 .legacyflow/run-configurations.json；draft2020-12 schema + 语义双层校验。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-RUN-001 | 打开视图 | Kairo→Manage Run Configurations | 列表 + New Configuration(add) + Refresh(refresh)；头部 "{count} configuration(s)" | P0 | ☐ | ☐ |
| TC-RUN-002 | 新建默认模板 | 点 New | 自动 ID tomcat-{n}；type=tomcat6 mode=run JDWP 8000 context '/' ant war exploded beforeLaunch[build,deploy] | P1 | ☐ | ☐ |
| TC-RUN-003 | 表单六组字段 | 逐组填写 General(ID/Name/Project/JDK ref/Mode/Suspend)/Server(ref/http/debug/context)/Build(type 切换重置结构;Ant target;custom command;clean)/Deploy(exploded/war+artifact)/Advanced(vmOptions 多行+env 多行)/Before Launch(build/deploy) | 字段齐全；Suspend 仅 debug 可勾（run 强制 false）；env 有敏感名引用提示文案 | P0 | ☐ | ☐ |
| TC-RUN-004 | 名称唯一校验 | 两条同名（大小写不同） | semanticIssues 拒绝并列出 "path: message" | P1 | ☐ | ☐ |
| TC-RUN-005 | 端口相同校验 | httpPort=debugPort | 拒绝 | P1 | ☐ | ☐ |
| TC-RUN-006 | artifact 路径安全 | 填 `..\evil` 或 `C:\x` | schema/语义双重拒绝（禁盘符/反斜杠/../段逃逸） | P1 | ☐ | ☐ |
| TC-RUN-007 | env 敏感名强制 | PASSWORD=明文 | 错误提示必须 ${env:...} 引用形式，明文拒存 | P0 | ☐ | ☐ |
| TC-RUN-008 | env 行格式错 | 行无 = 或重复变量 | "must use NAME=value" / "duplicated" | P2 | ☐ | ☐ |
| TC-RUN-009 | beforeLaunch 顺序 | 只勾 Deploy | UI 勾选排序保证 build 在前 | P2 | ☐ | ☐ |
| TC-RUN-010 | ID 不可改 | 编辑改 ID | "Configuration ID cannot be changed while editing" | P2 | ☐ | ☐ |
| TC-RUN-011 | Delete 确认 | 点垃圾桶 | ConfirmDialog "Delete run configuration \"{name}\"?"→删除 | P1 | ☐ | ☐ |
| TC-RUN-012 | Run 列表按钮 | 条目 ▶ | saveAll→项目匹配校验→launch(45s)→before-launch 步骤进度（旋转 Build/Deploy/Run） | P0 | ☐ | ☐ |
| TC-RUN-013 | Debug 一键 | 条目 🐞（Shift+F9） | saveAll→适配器探测→launch(debug,suspend true,60s)→等 JDWP→attach→adopt；attach 失败回滚 stop+forget | P1 | ☐ | ☐ |
| TC-RUN-014 | 端口占用横幅 | 占用 8080 启动 | "Port {port} is occupied"+Process/PID+suggestion+"Modify Port"按钮→port+1 打开编辑器 | P1 | ☐ | ☐ |
| TC-RUN-015 | 互斥锁 | launch 中再点 Run | "A run configuration operation is already in progress" | P1 | ☐ | ☐ |
| TC-RUN-016 | 项目不匹配 | 他项目配置启动 | "Select project {id} before launching this configuration" | P2 | ☐ | ☐ |
| TC-RUN-017 | 摘要面板 | 选中非 launch 态 | Mode 徽章/HTTP·JDWP/Build/Deploy 摘要 | P3 | ☐ | ☐ |
| TC-RUN-018 | Default 徽标 | selectDefault 后 | ★ Default 迁移；selectedConfigurationId 持久化 | P2 | ☐ | ☐ |
| TC-RUN-019 | canonical 序列化 | 保存后看 JSON | env 键排序、2 空格缩进、尾换行 | P3 | ☐ | ☐ |

---

# 第23章 调试功能测试

> 前提：Debug 模式启动 Tomcat（JDWP suspend=y/n）。type=kairo-java 适配器 + JDI Bridge。

## 23.1 断点与会话控制

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-DBG-001 | 断点命中 | Ctrl+F8 打断点→HTTP 请求 | 行红点；线程挂起编辑器跳转断点行；悬浮调试工具条出现 | P0 | ☐ | ☐ |
| TC-DBG-002 | 单步四件套 | F8/F7/Shift+F8/F9 | StepOver/Into/Out/Continue 正确（inDebugMode when 生效） | P0 | ☐ | ☐ |
| TC-DBG-003 | Run to Cursor | Alt+F9 | 运行到光标暂停 | P2 | ☐ | ☐ |
| TC-DBG-004 | Stop | Ctrl+F2 | 会话结束 | P1 | ☐ | ☐ |
| TC-DBG-005 | Debug Restart | Ctrl+F5（mac cmd+r） | 重启调试会话 | P2 | ☐ | ☐ |
| TC-DBG-006 | 条件断点 | Ctrl+Shift+F8 编辑条件 | 条件满足才停 | P1 | ☐ | ☐ |
| TC-DBG-007 | Hit Count | hitCount=N | 第 N 次命中才停 | P2 | ☐ | ☐ |
| TC-DBG-008 | Logpoint | toggleLogpoint | 仅记消息不打断 | P2 | ☐ | ☐ |
| TC-DBG-009 | 异常断点 | 勾选异常过滤器 | 指定异常抛出处暂停 | P3 | ☐ | ☐ |
| TC-DBG-010 | 断点管理 | 分组/mute/持久化 | 折叠、静音、重启后仍在 | P2 | ☐ | ☐ |

## 23.2 调试视图八件套

| 编号 | 视图 | 验证要点 | P | D | B |
|------|------|----------|---|---|---|
| TC-DBG-021 | Variables | 局部/字段分类着色、对象展开、修改变量值 | P1 | ☐ | ☐ |
| TC-DBG-022 | Call Stack | 帧列表点击切换、线程切换 | P1 | ☐ | ☐ |
| TC-DBG-023 | Watch | 添加/编辑/删除表达式求值 | P1 | ☐ | ☐ |
| TC-DBG-024 | Debug Console | evaluateExpression（Alt+F8）求值输出 | P1 | ☐ | ☐ |
| TC-DBG-025 | IDEA 工具窗 | frames/variables/watches IDEA 式集成 tabs | P2 | ☐ | ☐ |
| TC-DBG-026 | Debug Toolbar | 悬浮条按钮齐备可点 | P2 | ☐ | ☐ |
| TC-DBG-027 | Inline Values | 行内变量值渲染 | P3 | ☐ | ☐ |
| TC-DBG-028 | Hover 求值 | 悬停表达式弹值 | P3 | ☐ | ☐ |
| TC-DBG-029 | Diagnostics | adapter/jvm 状态诊断面板 | P3 | ☐ | ☐ |

## 23.3 兼容检查与 JVM attach

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-DBG-041 | Compat Check | Check Java Debug Adapter | 四检查：JDK 版本/JDWP 可用性/端口可达/DAP adapter；warning 可继续 error 可覆盖；中文报告 | P1 | ☐ | ☐ |
| TC-DBG-042 | Attach 已运行 JVM | JVM 进程列举 attach | 列出本机 JVM；手动 host:port attach 成功 | P2 | ☐ | ☐ |
| TC-DBG-043 | 源码不匹配检测 | 改代码不重编译命中旧断点 | mismatch 提示 | P3 | ☐ | ☐ |
| TC-DBG-044 | 验收状态机 | 观察调试各阶段 | 状态流转 + recovery suggestions | P3 | ☐ | ☐ |

---

# 第24章 问题面板（Problems）测试

> id=kairo-problems；过滤器 localStorage kairo.problems.filterState 跨会话记忆。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-PROB-001 | 汇聚显示 | 制造 Java/XML/JSP/Build 问题 | 列头 ！/File/Line/Message/Type；severity 着色 | P0 | ☐ | ☐ |
| TC-PROB-002 | 严重级过滤 | 勾 Errors/Warnings/Infos | 三复选框计数准确（计数为全量统计）；过滤即时生效 | P1 | ☐ | ☐ |
| TC-PROB-003 | 文件过滤补全 | 输入文件名 | 补全下拉 ≤10 条；mousedown 选中；失焦延迟 200ms 防误关 | P2 | ☐ | ☐ |
| TC-PROB-004 | 类型下拉 | Type=Java/Ant/XML/JSP/Encoding | 按扩展名与来源推断归类 | P2 | ☐ | ☐ |
| TC-PROB-005 | Current file only | 勾选 | 仅当前编辑器文件问题 | P2 | ☐ | ☐ |
| TC-PROB-006 | F8 导航 | 面板内 F8/Shift+F8 | 循环滚动并在编辑器定位；**焦点不在面板时不抢占**调试快捷键 | P1 | ☐ | ☐ |
| TC-PROB-007 | Previous/Next 按钮 | ↑/↓ 按钮 | tooltip 显示快捷键；行为同 F8 | P2 | ☐ | ☐ |
| TC-PROB-008 | 行点击跳转 | 点某行 | 打开文件定位行列；title "file:line:col — message" | P1 | ☐ | ☐ |
| TC-PROB-009 | 三种空态 | 无问题/被过滤/无编辑器 | 各自文案与样式正确 | P2 | ☐ | ☐ |
| TC-PROB-010 | 错误重试 | 读 markers 异常 | ⚠ 错误盒 + Retry 可用 | P3 | ☐ | ☐ |
| TC-PROB-011 | 冷启动不闪中文 | 重启瞬间 | 标题 postConstruct 才赋值 | P3 | ☐ | ☐ |
| TC-PROB-012 | 过滤器记忆 | 设过滤重启 | filterState 从 localStorage 恢复 | P2 | ☐ | ☐ |

---

# 第25章 TODO/FIXME 视图测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-TODO-001 | 三类标记 | 造 TODO/FIXME/XXX 各一 | 彩色徽章三类；每行只计首个命中（TODO→FIXME→XXX 顺序） | P1 | ☐ | ☐ |
| TC-TODO-002 | 分组树 | 多文件命中 | 手风琴按文件名字典序分组、组内行号升序；▼/▶ 折叠 | P2 | ☐ | ☐ |
| TC-TODO-003 | 点击跳转 | 点条目 | 打开文件定位该行行首 | P1 | ☐ | ☐ |
| TC-TODO-004 | Refresh/Scanning | 点刷新 | 旋转 loading+"Scanning..."禁用；完成恢复 | P2 | ☐ | ☐ |
| TC-TODO-005 | 自动扫描 | 切到该视图 | onAfterShow 自动扫描 | P3 | ☐ | ☐ |
| TC-TODO-006 | 文件范围 | .md/.yaml 中造 TODO | 白名单 22 种扩展内才扫 | P3 | ☐ | ☐ |
| TC-TODO-007 | 500 上限 | 造 600 条 | 截断 500 | P3 | ☐ | ☐ |
| TC-TODO-008 | 30s 超时 | 大仓库慢扫 | "Search timed out." | P3 | ☐ | ☐ |
| TC-TODO-009 | 空态 | 无标记 | checklist 空态文案 | P3 | ☐ | ☐ |

---

# 第26章 单元测试视图测试

> id=kairo-test-tree（bottom rank200）+ kairo-test-output。发现 GET /tests；运行 POST /tests/run；取消 DELETE /tests/runs/{id}。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-TEST-001 | 发现 | 打开 JUnit3/4 工程 | package→class→method 三层树；@Test 识别 JUnit4；extends TestCase/public void testXxx 识别 JUnit3；带行号 | P1 | ☐ | ☐ |
| TC-TEST-002 | Run All | Run All(scope=all) | POST run→loading "Running tests..."→结果回填 | P0 | ☐ | ☐ |
| TC-TEST-003 | 分层运行 | package/class/method 节点点 Run | scope 传参正确仅跑该范围 | P1 | ☐ | ☐ |
| TC-TEST-004 | Cancel | 运行中取消 | DELETE 生效 | P2 | ☐ | ☐ |
| TC-TEST-005 | 结果树 | 观察 Test Results | 类分组头（四色统计徽章默认展开）→方法行（状态图标、方法名、耗时 <1ms/x ms/x.xx s）；失败行默认展开显示 Failure 消息块(role=alert)与 Stack Trace pre 块；键盘 Enter/Space 折叠 | P0 | ☐ | ☐ |
| TC-TEST-006 | 摘要徽章 | 观察头部 | Passed/Failed/Skipped/Error 各色徽章（>0 显示）+ "{count} tests total"；运行状态徽章 Running 旋转/Succeeded/Failed | P1 | ☐ | ☐ |
| TC-TEST-007 | 过滤 | Filter 下拉 All/Passed/Failed/Skipped/Errors | 计数正确过滤生效；无匹配紧凑空态 | P2 | ☐ | ☐ |
| TC-TEST-008 | Rerun Failed | 有失败时点 Rerun Failed (N) | 按类收集逐方法重跑；重跑中旋转+"Rerunning..." | P1 | ☐ | ☐ |
| TC-TEST-009 | 历史运行 | 多次运行后下拉 | 最多 20 次；选项 "{startTime} — x passed / y failed / z skipped / e errors"；切换视图更新 | P2 | ☐ | ☐ |
| TC-TEST-010 | Raw Output | 展开 details | 原始 stdout 展示 | P3 | ☐ | ☐ |
| TC-TEST-011 | Marker 联动 | 失败后打开源文件 | owner kairo-test marker 定位堆栈行；severity failed/error→Error | P1 | ☐ | ☐ |
| TC-TEST-012 | javac/java 命令 | 检查运行命令 | JUnit4 用 org.junit.runner.JUnitCore+junit-4.jar+hamcrest-core.jar；JUnit3 用 junit.textui.TestRunner；Win cp 用分号 | P2 | ☐ | ☐ |
| TC-TEST-013 | 空态/错误态 | 未跑过/运行出错 | beaker 空态引导；错误横幅标题 "Error running tests"+Dismiss | P2 | ☐ | ☐ |

---

# 第27章 SQL 控制台测试

> Widget id=kairo-sql-console；连接配置存 StorageService（密码经 Electron safeStorage 加密为 {v:1,enc:b64} blob，绝不落盘明文）。Oracle 实验性功能。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SQL-001 | 连接表单 | 打开 SQL Console | Host(localhost)/Port(1521)/Service 类型下拉(SID/Svc Name)/SID(ORCL)/Username/Password(password 型) 字段齐全 | P1 | ☐ | ☐ |
| TC-SQL-002 | Test Connection | 填正确连接点测试 | Testing…→显示后端 message；10s 超时 | P1 | ☐ | ☐ |
| TC-SQL-003 | Connect/Disconnect | 点连接 | Connecting…→绿点 Connected + connectionId host:port/{sid}；按钮变 Disconnect | P1 | ☐ | ☐ |
| TC-SQL-004 | 密码加密存储 | 连接后查 storage | 密码以 {v:1,enc:<b64>} 加密 blob 存储；safeStorage 不可用时仅内存缓存并清除磁盘残留 | P0 | ☐ | ☐(降级) |
| TC-SQL-005 | 导入不含密码 | 导出再导入 | exportConnections 不含密码；导入空密码跳过除非显式允许 | P2 | ☐ | ☐ |
| TC-SQL-006 | 编辑器执行 | Monaco 中写 SELECT 后 Ctrl+Enter | 自定义 Monarch SQL 高亮（约50关键字）；执行中 Executing…；未连接禁用 Execute | P0 | ☐ | ☐ |
| TC-SQL-007 | 结果表格 | 查询多行 | "{count} rows returned in {time}ms"；NULL 以斜体 em 渲染；列头来自 columns | P1 | ☐ | ☐ |
| TC-SQL-008 | 历史 | 多次查询后点 History | localStorage kairo.sql.history 最多 20 条去重置顶；点击回填聚焦；超长截断 77 字符+"..." | P2 | ☐ | ☐ |
| TC-SQL-009 | 危险语句拦截 | 执行无 WHERE 的 DELETE | isDangerousStatement 判定→二次确认对话框 | P1 | ☐ | ☐ |
| TC-SQL-010 | 多语句防护 | `DROP TABLE a; DROP TABLE b` | 服务端 validateSql 拒绝："Query rejected: Multi-statement query with dangerous SQL keywords..." | P0 | ☐ | ☐ |
| TC-SQL-011 | CSV 注入防护 | 导出含 =SUM() 的单元格 | exportToCsv 对 =+-@ 开头前置单引号（Excel 公式注入防护） | P2 | ☐ | ☐ |
| TC-SQL-012 | Oracle 错误格式 | 制造 ORA- 错误 | "ORA-<code>: msg (position: n)" 格式展示；红色 role=alert 块 | P2 | ☐ | ☐ |
| TC-SQL-013 | 超时与截断 | 大结果查询 | execute 30s 超时中断；maxRows 默认 10000 截断提示 totalRows/truncated | P2 | ☐ | ☐ |
| TC-SQL-014 | Instant Client 缺失 | 无 OCI 环境执行 | agent 返回 unsupported(501)，UI 明确提示环境缺失 | P2 | ☐ | ☐ |

---

# 第28章 终端测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-TERM-001 | 创建终端 | Terminal→New Terminal | shell 启动可交互（Windows conpty prebuild 存在性在打包校验） | P1 | ☐ | ☐ |
| TC-TERM-002 | 命令执行 | 运行 dir/ls、java -version | 输出正常颜色与换行 | P1 | ☐ | ☐ |
| TC-TERM-003 | 多终端 tab | 新建多个 | tab 切换独立会话 | P2 | ☐ | ☐ |
| TC-TERM-004 | Toggle | Alt+F12 | 显隐切换保持会话 | P1 | ☐ | ☐ |
| TC-TERM-005 | 中文输出 | type 含中文文件名的 dir | 不乱码 | P2 | ☐ | — |
| TC-TERM-006 | 终端关闭回收 | exit 后 | 进程回收无残留 | P2 | ☐ | ☐ |

---

# 第29章 Git 集成测试

> git-extension 纯 browser 端 execFile('git') 实现；强制 LANG=C 保证解析；状态栏+装饰器+五个视图。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-GIT-001 | Changes 视图 | 改文件后打开 SCM/Git Changes | staged/unstaged 两节；checkbox 多选；M/A/D/R/C/? codicon 徽章；分支徽章+刷新/全部暂存/取消暂存按钮 | P1 | ☐ | ☐ |
| TC-GIT-002 | stage/unstage/commit | 全流程提交一次 | add/reset HEAD/commit 成功；toast 显示短哈希与变更文件数 | P0 | ☐ | ☐ |
| TC-GIT-003 | 中文文件名 | 改名一个中文文件 | decodeGitQuotedPath 八进制转义正确解码不乱码；NUL 分隔 porcelain 解析 R/C 双段正确 | P1 | ☐ | ☐ |
| TC-GIT-004 | Diff 视图 | 点击变更文件 | onDiffRequest 打开 diff；parseDiff hunk 行号正确（No newline 不推进）；add/remove/context/meta 分类渲染 | P1 | ☐ | ☐ |
| TC-GIT-005 | History 视图 | Git: Show History | 最近 50 条 %H/an/ae/aI/s 解析；右侧详情 subject/body/hash/author/date | P1 | ☐ | ☐ |
| TC-GIT-006 | History 搜索 | author:/path:/after:/before: 前缀和裸 SHA | 过滤下推给 git log；SHA 前缀内存过滤；命中高亮 mark；10s 超时可取消（SIGTERM） | P2 | ☐ | ☐ |
| TC-GIT-007 | Cherry-Pick | History 条目点 Cherry-Pick | pick 进行中；continue/abort 仅进行中可见；冲突进入 conflict 态而非报错；状态栏 $(git-merge) Cherry-picking... (N remaining)；冲突时 $(warning) 且点击绑 abort | P2 | ☐ | ☐ |
| TC-GIT-008 | Stash 视图 | push/pop/apply/drop/show/clear | --staged/--include-untracked/--index 参数正确；drop/clear 原生 confirm 二次确认；show 双输出 stat/diff | P2 | ☐ | ☐ |
| TC-GIT-009 | Blame | 开启 blame 装饰 | 行内 "作者, 日期"；glyph hover 完整时间；60s TTL 缓存；>500 行只装饰前 500；编辑即失效 | P2 | ☐ | ☐ |
| TC-GIT-010 | Tab/Explorer 装饰 | 改文件观察 | tab 彩色圆点（M黄/A绿/D红/R/C蓝/?灰）；explorer 尾部 circle 图标 | P1 | ☐ | ☐ |
| TC-GIT-011 | 状态栏 | 观察左下 | $(git-branch) branch ↑ahead ↓behind +changedCount；tooltip 按 M/A/D/? 分类统计；3 秒轮询刷新（防重入） | P1 | ☐ | ☐ |
| TC-GIT-012 | 预提交检查 | Commit 视图勾选 build/test/lint 后提交 | npm run build/npm test/javac -Xlint 各 120s/30s；进度 spinner；通过/失败摘要折叠着色；"跳过检查"/"强制提交"次级按钮可用 | P2 | ☐ | ☐ |
| TC-GIT-013 | 提交模板 | 模板下拉选择 | 7 内置模板；{module}(从分支推断)/{branch}/{type}/{description} 占位替换；正文 >72 字符告警；最近 20 条建议下拉 | P2 | ☐ | ☐ |
| TC-GIT-014 | amend 保护 | amend 且 ahead==0 | 提示可能改写已推送提交 | P3 | ☐ | ☐ |
| TC-GIT-015 | Ctrl+Enter 提交 | commit textarea 内 Ctrl/Cmd+Enter | 提交触发 | P2 | ☐ | ☐ |

---

# 第30章 SVN 集成测试

> svn-extension 经 Node 后端 JSON-RPC（/services/svn-backend）；每 WC 公平队列（读并发≤3，写独占）；统一注入 --non-interactive --trust-server-cert。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SVN-001 | 客户端探测 | 无 svn 环境观察状态栏 | 显示"未安装 SVN"形态；装 svn 后 PATH/TortoiseSVN 注册表/scoop 均能发现 | P1 | ☐ | ☐ |
| TC-SVN-002 | Show Changes | 改文件后 Show Changes（alt+9） | 八类状态桶 modified/added/deleted/unversioned/conflicted/ignored/missing/locked/replaced + changelists 分组 | P1 | ☐ | ☐ |
| TC-SVN-003 | Update | Ctrl+T（svnActive）或 Update 菜单 | UpdateDialog 选 revision/depth；更新数统计（At revision N 与 ADUGRC 计数，LANG 兼容） | P1 | ☐ | ☐ |
| TC-SVN-004 | Commit | Ctrl+K | CommitDialog 双栏（文件树+diff 预览）、changelist 分组、M/A/D/C/R/?/! 徽章、keepLocks、subject>72 变黄告警、Ctrl+Enter 提交；有 conflicted 文件时拒绝提交 | P0 | ☐ | ☐ |
| TC-SVN-005 | 自动 add | 勾选 unversioned 文件提交 | commitSelected 自动先 add | P2 | ☐ | ☐ |
| TC-SVN-006 | 全选抑制 | 手动取消全选后再操作 | suppressAutoSelect 生效不再自动勾选 | P3 | ☐ | ☐ |
| TC-SVN-007 | Add/Revert/Cleanup | 逐项操作 | 命令成功 toast/输出反馈 | P1 | ☐ | ☐ |
| TC-SVN-008 | Annotate | svn annotate | blame 行内容补齐渲染 | P2 | ☐ | ☐ |
| TC-SVN-009 | Diff | Ctrl+D（editorTextFocus） | 内嵌 Monaco diff 编辑器主区打开 | P1 | ☐ | ☐ |
| TC-SVN-010 | Lock/Unlock | 对文件加锁解锁 | 状态徽章 locked 出现/消失 | P2 | ☐ | ☐ |
| TC-SVN-011 | Repo Browser | Browse Repository | QuickPick 递归浏览仓库目录 | P2 | ☐ | ☐ |
| TC-SVN-012 | Info | Show Info | wc info 对话框展示 | P3 | ☐ | ☐ |
| TC-SVN-013 | Branch/Tag | Branch-Tag 对话框 | branches/tags Segmented、copy 预览 from/to URL、默认 message 自动生成 | P2 | ☐ | ☐ |
| TC-SVN-014 | Switch | Switch 对话框 | trunk/branches/tags 建议 chips、revision、force | P2 | ☐ | ☐ |
| TC-SVN-015 | Merge | Merge 对话框 | merge/dry-run/record-only 三模式 | P2 | ☐ | ☐ |
| TC-SVN-016 | Checkout/Import/Export | 对应对话框 | url/path/revision/user/password + 预览卡 | P2 | ☐ | ☐ |
| TC-SVN-017 | Conflict Resolve | 制造冲突后 Resolve | mine/theirs/working 决策对话框 | P1 | ☐ | ☐ |
| TC-SVN-018 | Ignore | Ignore 文件 | 按父目录分组 propset 合并 svn:ignore | P2 | ☐ | ☐ |
| TC-SVN-019 | Revert to Revision | 历史条目操作 | merge -r HEAD:REV 执行 | P3 | ☐ | ☐ |
| TC-SVN-020 | 装饰器 | 改文件观察 | tab 装饰/explorer 树装饰/gutter glyph+hover/annotate 行内标注 | P1 | ☐ | ☐ |
| TC-SVN-021 | 状态栏 | 观察右下 | 未装 SVN/有 WC（$(git-branch) branch \| r<rev> \| N changes \| N conflicts）/点击 Quick Actions（Update/Commit/History/Merge/Branch-Tag/Switch/Resolve/Refresh/Checkout/Browse） | P1 | ☐ | ☐ |
| TC-SVN-022 | 快捷键上下文 | svnActive 键验证 | ctrlcmd+t/k、alt+9、ctrlcmd+d(h)、ctrlcmd+alt+h（资源树，排除 Java 编辑器让位 Call Hierarchy） | P2 | ☐ | ☐ |
| TC-SVN-023 | 取消命令 | 长命令 $cancel | pending 移除或 kill 运行进程；SVN_CANCELLED 错误优雅呈现 | P3 | ☐ | ☐ |
| TC-SVN-024 | Preferences | Settings 搜 svn | svn.enabled/path/defaultCheckoutPath/autoRefresh(autoRefreshInterval)/decorations 系列/gutter/annotate/commit.useAmend/autoCloseAfterCommit/update.onOpen/ignoreWhitespace/showOutput/maxHistoryEntries(100)/trustServerCert/auth.cache 全出现 | P2 | ☐ | ☐ |

---

# 第31章 本地历史测试

> 保存前把磁盘旧内容快照到 `<workspaceRoot>/.kairo/local-history/snapshot-{timestamp}-{sanitizedPath}`；每文件上限 50 个超出删最旧。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LH-001 | 快照创建 | 修改已存在文件并保存 | .kairo/local-history 下新增快照文件（时间戳+净化路径） | P0 | ☐ | ☐ |
| TC-LH-002 | 时间线视图 | Show Local History | 表三列 Timestamp/Size(B|KB|MB)/Actions(Diff、Restore)；跟随当前编辑器切换；保存事件触发自动刷新 | P1 | ☐ | ☐ |
| TC-LH-003 | Diff | 点 Diff | 并行读快照与当前内容逐行对比；旧行 - 红/新行 + 绿底色；无差异显示 "No differences found."；对话框标题 "Diff: {snapshotId}" | P1 | ☐ | ☐ |
| TC-LH-004 | Restore | 点 Restore→确认 | 确认文案含 "Current unsaved changes will be lost."；确认后写回、toast、重新打开文件激活 | P0 | ☐ | ☐ |
| TC-LH-005 | 50 上限滚动 | 同文件保存 55 次 | 仅保留最近 50 个 | P2 | ☐ | ☐ |
| TC-LH-006 | 新文件跳过 | 新建文件直接保存 | 磁盘尚不存在→不产生快照 | P3 | ☐ | ☐ |
| TC-LH-007 | 路径匹配精确性 | Foo.java 与 FooBar.java 同时有历史 | 精确后缀匹配互不误伤 | P2 | ☐ | ☐ |
| TC-LH-008 | 空态两种 | 无编辑器/无快照 | 各自引导文案正确 | P3 | ☐ | ☐ |

---

# 第32章 书签功能测试

> 内存 Map<uri, Map<line, number?>>；glyph SVG 蓝色 #4fc3f7/编号琥珀 #ffc107；overview ruler 同色。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-BM-001 | F11 切换 | 光标处按 F11 | glyph margin 出现蓝色书签图标 + overview ruler 标记；再按移除 | P0 | ☐ | ☐ |
| TC-BM-002 | 编号书签设置 | Ctrl+Shift+1..9 | 琥珀色编号书签；同号互斥（设 N 移除旧行的 N） | P1 | ☐ | ☐ |
| TC-BM-003 | 编号跳转 | Ctrl+0..9（注：Ctrl+1..9 为工具窗时核对实际绑定） | 打开文件 activate+定位行首 revealLineInCenter+focus；未设置 info "No bookmark {num} set." | P1 | ☐ | ☐ |
| TC-BM-004 | Show Bookmarks 列表 | Shift+F11 或命令 | 按文件分组列表：编号徽章/行号/×移除按钮（stopPropagation）；点击跳转；计数 "{count} items" | P1 | ☐ | ☐ |
| TC-BM-005 | Clear All | 点 Clear All（0 时禁用） | 全部清除 | P2 | ☐ | ☐ |
| TC-BM-006 | 编辑器切换恢复 | 切走再切回编辑器 | restoreDecorationsForEditor 恢复装饰 | P2 | ☐ | ☐ |
| TC-BM-007 | 无编辑器守卫 | 无编辑器执行命令 | isEnabled=false 或 warn 提示 | P3 | ☐ | ☐ |

---

# 第33章 快捷键体系与速查表测试

> 四套 IDEA 键位图（Windows/macOS × Theia 层/Monaco 层）+ 浏览器键盘守卫。完整键表见附录B。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-KEY-001 | 编辑组抽查 | undo/redo/注释/格式化/删行/复制行/扩选 | Ctrl+Z/Shift+Z、Ctrl+/、Ctrl+Alt+L、Ctrl+Y、Ctrl+D、Ctrl+W 生效 | P0 | ☐ | ☐(remap) |
| TC-KEY-002 | 导航组抽查 | Ctrl+N/Ctrl+Shift+N/Ctrl+G/Ctrl+B/Ctrl+E/Ctrl+Alt+←→ | 查类/查文件/跳行/定义/最近文件/后退前进全部打开正确弹层或动作 | P0 | ☐ | ☐(remap) |
| TC-KEY-003 | 构建运行调试组 | Ctrl+F9/Ctrl+Shift+F9/Ctrl+F10/Shift+F10/Shift+F9/Ctrl+F2/F8/F7 | build/buildDeploy/update/run/debug/stop/stepOver/stepInto 正确触发 | P0 | ☐ | ☐ |
| TC-KEY-004 | Monaco 冲突置空 | Ctrl+Enter、Alt+Enter、Ctrl+P 等 7 条被置空的默认键 | 不再触发 Monaco 原行为（IDEA 语义接管） | P1 | ☐ | ☐ |
| TC-KEY-005 | 书签键 | F11/Ctrl+F11/Shift+F11 | toggle/mnemonic/show 三命令 | P1 | ☐ | ☐ |
| TC-KEY-006 | 工具窗键 | Alt+1..7,9（mac Cmd+N 系列） | Project/Servers/Deployments/Builds/Debug/Problems/TODO/SCM 依次聚焦 | P1 | ☐ | ☐ |
| TC-KEY-007 | 浏览器键盘守卫 | 浏览器版按 Ctrl+N/T/W/F5/Ctrl+R 等 Chrome 保留键 | preventDefault 被 IDE 接管不触发浏览器行为；搜索模态框输入除外 | P1 | — | ☐ |
| TC-KEY-008 | 速查表 | Ctrl+Shift+K | 弹出速查表：Mac 表 10 分类（Editing30/Navigation21/SearchReplace6/BuildRunDebug12/Refactoring11/General8/ToolWindows8/Bookmarks3/CodeFolding4/MultipleCursors4）+ Win 中文对照表；搜索过滤高亮；Esc 关闭 | P1 | ☐ | ☐ |
| TC-KEY-009 | 键位管理 widget | Kairo→Keyboard Shortcuts | 搜索框过滤 command/label/keybinding；冲突检测区列出 "{keybinding} is bound to: A, B"；五列表格 Command/Keybinding/Source(Default/User/Workspace+custom)/When/Actions；Reset User/Workspace 两按钮；DEFAULT 无 Reset；修改引导 JSON 编辑器提示 | P1 | ☐ | ☐ |
| TC-KEY-010 | 只读快捷键参考 widget | shortcuts-widget | 自动分类 10 类（general/editor/search/navigate/debug/git/java/kairo/terminal/view）带数量标题；只收录有键位的命令；ctrlcmd 按 Mac/Win 显示 Cmd/Ctrl | P2 | ☐ | ☐ |
| TC-KEY-011 | mac 键位抽查 | macOS 上 Cmd+O/Cmd+Shift+O/Cmd+F9/Ctrl+Shift+R 等 | 按 macOS IDEA 键表生效 | P1 | (mac)☐ | ☐ |

---

# 第34章 性能仪表板与大文件处理测试

## 34.1 性能仪表板（id=kairo-perf-dashboard）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-PERF-001 | 冷启动历史 | 启动后打开 | 最近 5 次倒序表格 Total Duration/Layout Ready/First Completion（≤0 显示 "—"）；Clear History 按钮（testid perf-clear-history） | P2 | ☐ | ☐ |
| TC-PERF-002 | 实时指标 | 观察 Current Metrics | 六卡：JS Heap/Total/Peak Memory(MB 一位小数，不可用 N/A)/Average Search Time(ms)/JDT LS Status（ready 绿/starting·initializing 黄/crashed 红）/Search Count；每 2 秒轮询刷新 | P2 | ☐ | ☐ |
| TC-PERF-003 | Benchmark | Run Performance Test（testid perf-run-benchmark） | 运行中旋转+"Running..."；完成 toast+内联 "Benchmark complete: {elapsed}ms ({iterations} iterations)" | P3 | ☐ | ☐ |
| TC-PERF-004 | 错误横幅 | performance.memory 不支持（Firefox） | "Memory information unavailable..."；LS crashed 时 "JDT Language Server not connected..." | P3 | ☐ | ☐ |

## 34.2 大文件处理

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LARGE-001 | Large 阈值 | 打开 ~6M 字符文件 | 正常打开可编辑；状态栏右下 Large 指示 | P1 | ☐ | ☐ |
| TC-LARGE-002 | Huge 降级 | 打开 ~55M 字符文件 | huge 档：非代码语言降级 plaintext 但**永不降级代码语法**；Huge 指示 | P1 | ☐ | ☐ |
| TC-LARGE-003 | 渐进 tokenization | 打开 ≥4000 行 java/jsp/xml | requestIdleCallback 分片渲染不卡死输入 | P2 | ☐ | ☐ |
| TC-LARGE-004 | tokenization 行长上限 | 单行超长 JSP | editor.maxTokenizationLineLength=200000 默认；stopRenderingLineAfter=-1 | P3 | ☐ | ☐ |
| TC-LARGE-005 | 偏好调节 | kairo.largeFiles.* 各阈值改小后重启 | 阈值生效 | P3 | ☐ | ☐ |

---

# 第35章 通知中心测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-NOTIF-001 | 通知产生 | 触发一条 warning/info 通知 | 右下 toast 出现；铃铛徽标计数增加 | P1 | ☐ | ☐ |
| TC-NOTIF-002 | 中心视图 | 点铃铛 | kairo-notification-center 列出历史通知；可逐条/全部清除 | P1 | ☐ | ☐ |
| TC-NOTIF-003 | 深色强制 | light 主题下查看通知 | 通知保持深色样式（CSS 强制） | P3 | ☐ | ☐ |
| TC-NOTIF-004 | 动作按钮 | 带动作的通知（如 Reconnect） | 点击执行对应命令并关闭通知 | P2 | ☐ | ☐ |

---

# 第36章 设置与首选项测试

## 36.1 Kairo IDE 常规设置（Settings 搜索 "Kairo"）

| 编号 | 设置项 | 类型/默认值 | 验证方法 | P | D | B |
|------|--------|-------------|----------|---|---|---|
| TC-SET-001 | kairo.general.showWelcome | boolean/true | false 后重启不开 Welcome | P2 | ☐ | ☐ |
| TC-SET-002 | kairo.general.confirmBeforeDelete | boolean/true | false 后删除不再确认 | P2 | ☐ | ☐ |
| TC-SET-003 | kairo.general.autoRevealInExplorer | boolean/true | 关闭后不自动定位 | P3 | ☐ | ☐ |
| TC-SET-004 | kairo.appearance.fontSize | number 14 (8–32) | 改 18 编辑器字号变化 | P1 | ☐ | ☐ |
| TC-SET-005 | kairo.appearance.fontFamily | string 'monospace' | 改 Consolas 生效 | P2 | ☐ | ☐ |
| TC-SET-006 | kairo.appearance.lineHeight/tabSize/insertSpaces | 1.5/4/true | 生效 | P2 | ☐ | ☐ |
| TC-SET-007 | kairo.build.autoClean | false | 开启后构建前 clean | P2 | ☐ | ☐ |
| TC-SET-008 | kairo.build.showVerboseLogs / maxBuildHistory(50) | 开启详细输出；历史上限调整生效 | P3 | ☐ | ☐ |
| TC-SET-009 | kairo.server.autoStart | false | 开启后项目加载自动启动 Tomcat | P2 | ☐ | ☐ |
| TC-SET-010 | kairo.server.autoStop | true | 见 TC-LAUNCH-056 | P1 | ☐ | ☐ |
| TC-SET-011 | kairo.server.defaultHttpPort/defaultDebugPort | 8080/8000 (1024–65535) | 新建配置默认端口跟随 | P2 | ☐ | ☐ |
| TC-SET-012 | kairo.server.logMaxLines | 10000 (100–100000) | 日志视图容量跟随 | P3 | ☐ | ☐ |
| TC-SET-013 | kairo.encoding.defaultProjectEncoding/autoDetect | utf-8/true | 八种编码枚举；autoDetect 关闭后不自动探测 | P1 | ☐ | ☐ |
| TC-SET-014 | kairo.hotReload.autoSyncOnSave/onFrameDeactivation/autoCompileJava/debounceMs | true/true/true/500(200–3000) | 分别开关验证第21章行为变化 | P1 | ☐ | ☐ |
| TC-SET-015 | kairo.search.excludePatterns/maxResults | 默认排除 glob/10000 | 搜索行为跟随 | P2 | ☐ | ☐ |
| TC-SET-016 | kairo.language | enum en/zh-CN | 第42章专项 | P0 | ☐ | ☐ |

## 36.2 Editor 与其他偏好

| 编号 | 设置项 | 验证要点 | P | D | B |
|------|--------|----------|---|---|---|
| TC-SET-021 | editor.autoSave=afterDelay/onFocusChange | 双向同步 files.autoSave；delay 1000 生效 | P1 | ☐ | ☐ |
| TC-SET-022 | editor.bracketPairColorization.enabled=false | 默认关闭彩虹括号 | P3 | ☐ | ☐ |
| TC-SET-023 | editor.maxTokenizationLineLength/stopRenderingLineAfter | 200000/-1 默认 | P3 | ☐ | ☐ |
| TC-SET-024 | breadcrumbs.enabled=true | 默认开启面包屑 | P3 | ☐ | ☐ |

## 36.3 项目级设置叠加（kairo-settings-service）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SET-031 | 项目覆盖 | `.kairo/settings.json` 写 `"kairo.build.autoClean": true` | get() 项目覆盖优先；显式 null 视为"使用默认值" | P2 | ☐ | ☐ |
| TC-SET-032 | 目录自动创建 | 无 .kairo 时写项目设置 | createFolder 自动创建；2 空格缩进+尾换行 | P3 | ☐ | ☐ |
| TC-SET-033 | 工作区切换重载 | 切换 workspace | 缓存清空重新加载项目设置 | P2 | ☐ | ☐ |
| TC-SET-034 | 解析容错 | settings.json 写坏内容 | console.warn 并重置空对象不抛错 | P3 | ☐ | ☐ |

---

# 第37章 命令面板与焦点导航测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-CMD-001 | 命令面板 | F1 / Ctrl+Shift+P | 所有 kairo.* 命令可搜可执行（含中英文标签随 i18n） | P0 | ☐ | ☐ |
| TC-CMD-002 | Find Action | Ctrl+Shift+A | 过滤有 label 的命令并显示快捷键 detail | P1 | ☐ | ☐(remap) |
| TC-CMD-003 | Escape 焦点返回 | 非编辑器焦点按 Esc | focus.editor 回到编辑器 | P2 | ☐ | ☐ |
| TC-CMD-004 | F6 面板轮巡 | 连按 F6 | 焦点在下一个面板循环 | P2 | ☐ | ☐ |
| TC-CMD-005 | Hide panel | Shift+Escape | 当前面板隐藏 | P3 | ☐ | ☐ |

---

# 第38章 扩展管理（VSIX）测试

> plugin-extension：策展式 allowlist 门禁（无签名 PKI 下唯一信任根）。目录 ~/.kairo/extensions + extensions.json + allowlist.json。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-EXT-001 | 打开扩展视图 | Ctrl+Shift+x | 列表+详情双栏；过滤器 all/enabled/disabled；空态引导 | P1 | ☐ | ☐ |
| TC-EXT-002 | 内置 allowlist | 查看 allowlist.json | 9 条预置（redhat.java/vscode-java-debug/vscode-maven/sonarlint/editorconfig/markdownlint/markdown-all-in-one/spell-checker/mermaid） | P2 | ☐ | ☐ |
| TC-EXT-003 | 安装白名单 VSIX | Install from VSIX 输入白名单扩展路径 | 九步流水线通过安装成功：引擎校验 semver 1.73.1→allowlist→版本范围→SHA256（可选）→查重→Zip Slip 安全解压（拒绝对绝对路径/盘符/UNC/null字节/越界/symlink 条目）→manifest 更新 | P1 | ☐ | ☐ |
| TC-EXT-004 | 安装非白名单 | 安装 allowlist 外扩展 | NOT_ALLOWLISTED 拒绝 | P0 | ☐ | ☐ |
| TC-EXT-005 | 引擎不符 | 安装 engine 要求更高版本的 vsix | ENGINE_NOT_SUPPORTED 拒绝 | P1 | ☐ | ☐ |
| TC-EXT-006 | Zip Slip 攻击 | 构造 ../ 逃逸条目 vsix | 拒绝并 rm 回滚已解压内容 | P0 | ☐ | ☐ |
| TC-EXT-007 | 兼容性报告 | 选中扩展看详情 | 分数与建议：Themes/Snippets 0.95…基线均值；引擎不符 −0.2；内置功能冲突 −0.15（redhat.java vs kairo-java-ls 等4对）；activationEvents `*` 提示启动开销；≥0.8 compatible ≥0.5 partial 其余 incompatible | P2 | ☐ | ☐ |
| TC-EXT-008 | enable/disable/uninstall | 详情页操作 | QuickPick 选择执行；目录 `<publisher>.<name>-<version>` 管理；reload 命令 500ms 后刷新窗口 | P2 | ☐ | ☐ |
| TC-EXT-009 | allowlist 不可变 | 打包版无 KAIRO_ALLOWLIST_MUTABLE 尝试改写 | 一切增删改拒绝（信任根保护） | P1 | ☐ | ☐ |
| TC-EXT-010 | view_menu 入口 | View 菜单尾部 | "Extensions"（order z9）出现 | P3 | ☐ | ☐ |

---

# 第39章 远程开发面板测试

> P3 实验性特性。remote-extension 两服务 + theia-product 的 remote-widget。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-REMOTE-001 | 面板结构 | Kairo→Remote Development | 状态圆点（connected 绿/connecting 黄/error·disconnected 红）+状态文字+地址 | P2 | ☐ | ☐ |
| TC-REMOTE-002 | 连接表单校验 | host/token 留空点 Connect | warn "Host and token are required." | P2 | ☐ | ☐ |
| TC-REMOTE-003 | 连接流程 | 填 host/port/TLS/workspace path/token 点 Connect | Connecting…→info "Connected to {host}:{port}"；表单禁用；信息块显示 Remote workspace；Disconnect 可断开（info 提示） | P2 | ☐ | ☐ |
| TC-REMOTE-004 | 失败呈现 | 错误 token 连接 | error "Failed to connect to {host}:{port}"；异常分类提示 | P2 | ☐ | ☐ |
| TC-REMOTE-005 | Recent Connections | 连过几次后观察 | localStorage kairo-remote-recent-connections 上限10去重；Clear 清空；点击回填表单 | P3 | ☐ | ☐ |
| TC-REMOTE-006 | 断线重连 | 连接中断网 | 指数退避 1s×2^n 封顶 30s，5 次后 error 并提示手动重连；30s 心跳 ping | P3 | ☐ | ☐ |
| TC-REMOTE-007 | 沙箱路径检查 | （API 级）validateOperation 对 /etc/passwd、~/.ssh、*.pem | forbiddenPatterns 拒绝；`..` 段拒绝但 foo..bar 放行；必须落在 workspaceRoot | P2 | ☐ | ☐ |

---

# 第40章 合规面板与遥测设置测试

## 40.1 合规面板（id=kairo-compliance）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-COMP-001 | 四 Tab 结构 | 打开 Compliance | RBAC Roles/Audit Log/Retention/SSO 四 tab；role=tablist 支持 ←/→/Enter/Space 切换；title 含 hint | P2 | ☐ | ☐ |
| TC-COMP-002 | RBAC Roles | 观察 | 角色卡片权限 chips；hover 有说明；空态文案 | P3 | ☐ | ☐ |
| TC-COMP-003 | Audit Log | Refresh/搜索/Action 分类/Result 下拉 | 事件行 ok/denied/error 徽章+action+target+"{ts} · {userId}"；两种空态区分 | P2 | ☐ | ☐ |
| TC-COMP-004 | Retention | 观察 | Audit Log Retention 与 Local Storage Retention 两策略卡片（Enabled/Disabled 圆点） | P3 | ☐ | ☐ |
| TC-COMP-005 | SSO | 观察 | Status Disabled/Provider none/Configured No 固定展示 | P3 | ☐ | ☐ |
| TC-COMP-006 | 加载与错误 | 加载中/断连 | spinner+skeleton 三条；错误四分类横幅（timeout/permission/config/generic）各配图标+Retry | P2 | ☐ | ☐ |

## 40.2 遥测设置（Telemetry Settings）

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-TEL-001 | 默认关闭 | 全新环境观察 | 遥测默认 disabled；无网络传输（离线优先） | P0 | ☐ | ☐ |
| TC-TEL-002 | 隐私公告门控 | 未接受隐私声明尝试开启 | Enable 复选框禁用+提示 "Please accept the privacy notice first"；点同意按钮后才可开启；开启前弹披露（收集/不收集清单） | P0 | ☐ | ☐ |
| TC-TEL-003 | 统计与事件列表 | 使用一段时间后查看 | Total/Oldest/Newest 统计；按类型计数表；最近 50 条倒序事件列表 | P2 | ☐ | ☐ |
| TC-TEL-004 | Export | 点导出 | saveDialog(JSON filter)→toast 提示保存路径；剪贴板兜底复制 toast | P2 | ☐ | ☐ |
| TC-TEL-005 | Clear | 点清空 | 数据清空 toast；按钮态恢复 | P2 | ☐ | ☐ |
| TC-TEL-006 | 企业端点门控 | 设 endpoint 但未开 KAIRO_ALLOW_TELEMETRY | 网络传输不启用（需 env+endpoint+用户同意三条件同时满足） | P1 | ☐ | ☐ |

---

# 第41章 升级检查测试

> 离线/气隙模式默认 no-op 存根：progress.state='disabled'，消息 "Kairo IDE runs in offline/air-gapped mode. Automatic update checks are disabled."。启用需 KAIRO_ALLOW_UPGRADE_CHECK=1 + KAIRO_UPGRADE_ENDPOINT。

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-UPG-001 | 离线默认 | 执行 Check for Updates | disabled 提示文案准确 | P1 | ☐ | ☐ |
| TC-UPG-002 | experimental 警告 | showExperimentalWarning | 离线显示 offlineInfo 长说明；内网模式显示实验警告（备份/SHA/回滚/关项目注意） | P2 | ☐ | ☐ |
| TC-UPG-003 | 发现新版 | mock endpoint 返回更高 version | 进度提示+info 弹窗（新/当前版本、Release notes、"Use \"Kairo: Check for Updates\" to install."）；同版本只通知一次 | P2 | ☐ | ☐ |
| TC-UPG-004 | SHA 校验失败 | mock sha256 不匹配 | "SHA-256 mismatch. Expected... Got..." 拒绝安装 | P1 | ☐ | ☐ |
| TC-UPG-005 | 回滚 | rollback | 无备份报错；有备份回滚成功提示重启 | P2 | ☐ | ☐ |
| TC-UPG-006 | 启动自检 | checkOnStartup 开启 | 启动 5 秒后自动检查一次 | P3 | ☐ | ☐ |
| TC-UPG-007 | 配置持久化 | StorageService kairo.upgrade.config | checkOnStartup/endpoint/currentVersion/updateNotified/backupPath 持久 | P3 | ☐ | ☐ |

---

# 第42章 国际化（中英文切换）测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-I18N-001 | 语言枚举 | Settings 搜 language | 仅 en/zh-CN 两项（English/简体中文），默认 en | P1 | ☐ | ☐ |
| TC-I18N-002 | 切换即时生效 | en→zh-CN | 菜单栏（DOM 重刷 refreshMenuLabels）、Welcome、Toolbar、Problems、TODO、SQL Console、Run Configurations、Servers、Local History、Compliance、Telemetry、命令标签等**全部**即时切换 | P0 | ☐ | ☐ |
| TC-I18N-003 | fallback | zh 缺失键 | 回退英文再回退 key 本身；加载失败也回退英文并发语言事件 | P2 | ☐ | ☐ |
| TC-I18N-004 | 占位插值 | 带 {name}/{count} 文案 | 参数正确替换；未知参数原样保留 | P2 | ☐ | ☐ |
| TC-I18N-005 | 持久化 | 切中文后重启 | 偏好 kairo.language 记忆 | P1 | ☐ | ☐ |
| TC-I18N-006 | React hook 联动 | useI18n 组件（Welcome 等） | 语言变化自动 re-render | P2 | ☐ | ☐ |
| TC-I18N-007 | 类型安全抽检 | 抽 20 个界面文案 | 中英语义一致、无生硬直译、无截断溢出 | P2 | ☐ | ☐ |

---

# 第43章 无障碍访问测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-A11Y-001 | axe 扫描 | Playwright axe-core 全页面扫描 | 无 critical violation（对比既有 a11y-scan.cjs 基线） | P2 | ☐ | ☐ |
| TC-A11Y-002 | 键盘全导航 | 纯键盘完成：打开向导→导入→构建→启动服务器 | 全程可达可操作 | P1 | ☐ | ☐ |
| TC-A11Y-003 | role=alert 横幅 | 触发各类错误横幅 | scan-error/import-error/welcome-error/build cancel/maven/test failure 等均有 role=alert | P2 | ☐ | ☐ |
| TC-A11Y-004 | aria-live | Servers 状态徽章/热部署状态/日志级别 | polite/assertive 区域播报 | P3 | ☐ | ☐ |
| TC-A11Y-005 | VirtualList 键盘 | ↑↓/PageUp/PageDown/Home/End | 列表键盘导航完整；aria-activedescendant 跟随 | P2 | ☐ | ☐ |
| TC-A11Y-006 | prefers-reduced-motion | OS 减少动效开关 | CSS 动画降级 | P3 | ☐ | ☐ |
| TC-A11Y-007 | 焦点环 | Tab 遍历 | focus-ring 样式可见 | P2 | ☐ | ☐ |
| TC-A11Y-008 | 屏幕阅读器基础 | VoiceOver/NVDA 读 Welcome/状态栏 | 标题/按钮可朗读 | P3 | ☐ | ☐ |

---

# 第44章 错误处理与容错测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-ERR-001 | Agent 断连全局表现 | 杀 agent 后操作任意功能 | 状态栏 error 色+Reconnect；受影响视图显示 disconnected 态+Reconnect 按钮；错误码体系（20 个 KairoErrorCode）映射合理 | P0 | ☐ | ☐ |
| TC-ERR-002 | 瞬时错误重试 | 制造瞬时网络抖动 | timeout/io_error/process_spawn_failed/5xx 自动指数退避重试 ≤2 次（noRetry 端点除外：start/stop/import/recode 等）；unsupported/501 永不重试 | P1 | ☐ | ☐ |
| TC-ERR-003 | 错误格式统一 | 抽查 10 个错误场景 | `[code] message (HTTP n)` 格式；组件内 kairo-error-banner（role=alert）风格一致 | P1 | ☐ | ☐ |
| TC-ERR-004 | WS 重连 | 断网 10s 再恢复 | EventStream 250ms 起 full jitter 退避封顶 15s；since=<seq> 序列号重放不丢事件；旧流迟到 disconnected 不覆盖新流状态 | P1 | ☐ | ☐ |
| TC-ERR-005 | workspace 未开守卫 | 无工作区调用需上下文功能 | "No workspace is open" 类明确提示 | P1 | ☐ | ☐ |
| TC-ERR-006 | 大请求体 | >16MB body 发给 agent | agent 拒绝（io.LimitReader） | P3 | ☐ | ☐ |
| TC-ERR-007 | 渲染层异常上报 | DevTools 手动抛未捕获异常 | desktop-main.log 记录 renderer-error | P2 | ☐ | — |
| TC-ERR-008 | 端口占用诊断 | 占用 Tomcat 端口启动 | diagnostics/port 返回 occupied/pid/processName/suggestion →运行配置横幅展示（见 TC-RUN-014） | P1 | ☐ | ☐ |
| TC-ERR-009 | 中文路径全链路 | 中文路径项目做 构建/部署/搜索/日志 | 全链路无乱码无失败 | P0 | ☐ | ☐ |
| TC-ERR-010 | rate limit | 高频请求打满桶 | 429+Retry-After:60；loopback 忽略 X-Forwarded-For | P3 | ☐ | ☐ |

---

# 第45章 安全专项测试

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-SEC-001 | 仅 loopback 绑定 | netstat 查 agent/theia 监听 | 全部 127.0.0.1；外部机器无法访问 | P0 | ☐ | ☐ |
| TC-SEC-002 | secret 鉴权 | 无 X-Kairo-Secret curl 业务端点 | 401 unauthenticated（health/endpoints/login 白名单除外） | P0 | ☐ | ☐ |
| TC-SEC-003 | WS 子协议鉴权 | 不带 kairo-secret-v1 subprotocol 连 WS | 握手拒绝 | P0 | ☐ | ☐ |
| TC-SEC-004 | Origin 校验 | 非本机 origin 的 WS/HTTP | IsSafeOrigin/IsSafeWebSocketOrigin 拒绝（拒 localhost.evil.com 类 prefix 混淆） | P0 | ☐ | ☐ |
| TC-SEC-005 | 路径沙箱 | curl 读 ~/.ssh、C:\Windows | path_forbidden；symlink 逃逸（ErrSymlinkEscape）拒绝 | P0 | ☐ | ☐ |
| TC-SEC-006 | 相对路径词法 | 传 `..\`、盘符、UNC 路径 | ErrOutsideRoot/ErrPathTraversal/ErrAbsolutePath 拒绝 | P0 | ☐ | ☐ |
| TC-SEC-007 | Electron 导航封锁 | window.open('http://evil.com')；点击外链 | 默认拒绝（KAIRO_ALLOW_EXTERNAL_LINKS=1 才放 shell.openExternal）；will-navigate/will-redirect/will-frame-navigate 三层拦截；agent 端口 URL 显式拒绝 | P0 | ☐ | — |
| TC-SEC-008 | CSP | 检查响应头 | default-src 'self'; script-src 'self' 'unsafe-eval'（Theia ajv 需要，**无 unsafe-inline**）; connect-src 限 self/data:/127.0.0.1:* | P0 | ☐ | — |
| TC-SEC-009 | contextIsolation | DevTools 检查 window | nodeIntegration=false sandbox=true；window.kairoConfig **不含 secret**；secret 仅 __kairo.getSecret() | P0 | ☐ | — |
| TC-SEC-010 | 敏感 DTO | GET /servers 响应 | 不含 JavaHome/CatalinaBase/WebappDir/Env/JVMOptions/MarkerToken 字段 | P1 | ☐ | ☐ |
| TC-SEC-011 | 幂等缓存 | 重放攻击 POST /servers 同 requestId | 返回缓存结果不重复启动（5min TTL） | P1 | ☐ | ☐ |
| TC-SEC-012 | PID 复用防护 | （代码审查+日志核验）kill 前身份核验 | exe 路径/starttime±2s/KAIRO_PROCESS_MARKER 多重比对；Windows QueryFullProcessImageNameW+创建时间 | P1 | ☐ | — |
| TC-SEC-013 | SQL 密码存储 | 检查 storage | safeStorage 加密 blob；明文残留自动迁移加密 | P0 | ☐ | ☐ |
| TC-SEC-014 | env 敏感变量 | run-config 明文 PASSWORD | schema+语义双重拒绝（见 TC-RUN-007） | P0 | ☐ | ☐ |
| TC-SEC-015 | Job Object | Windows 强杀 agent | 所有托管子进程（Tomcat/jdtls）被 OS 级连带回收（KILL_ON_JOB_CLOSE） | P0 | ☐ | — |
| TC-SEC-016 | 审计日志 | 查看 <DataDir>/audit.log.ndjson | NDJSON 记录；GET /api/v1/audit 可读；0600 权限 | P2 | ☐ | ☐ |

---

# 第46章 日志与诊断检查

| 编号 | 测试点 | 操作步骤 | 预期结果 | P | D | B |
|------|--------|----------|----------|---|---|---|
| TC-LOGF-001 | 主进程日志位置 | 打包版查看 %APPDATA%\Kairo IDE\logs\desktop-main.log | 存在且持续追加（console 双写镜像）；可用 KAIRO_DESKTOP_LOG_FILE 覆盖 | P0 | ☐ | — |
| TC-LOGF-002 | 子进程转发 | 观察 [agent]/[theia] 前缀行 | 子进程 stdout/stderr 实时进主日志 | P1 | ☐ | — |
| TC-LOGF-003 | 渲染层镜像 | 触发前端 console.error | 主日志出现 DEBUG/LOG/WARN/ERROR 级别映射行 | P1 | ☐ | — |
| TC-LOGF-004 | 页面事件 | 触发 did-fail-load 等 | 导航/加载事件均入日志 | P2 | ☐ | — |
| TC-LOGF-005 | 退出诊断 | 正常退出后看日志末尾 | childExitCodes + ProcessManager 诊断快照（pid/status/uptime/termCount/ZOMBIE 标记） | P1 | ☐ | — |
| TC-LOGF-006 | agent 自身日志 | --log-level debug 启动 agent | 详细日志输出；JDT LS logRing 500 条可通过 Show Logs 查看 | P2 | ☐ | ☐ |
| TC-LOGF-007 | Debug Diagnostics 面板 | Help→Debug Diagnostics | 汇聚 runtime/JDT/debug 状态诊断信息 | P3 | ☐ | ☐ |

---

# 第47章 双形态一致性对照测试

> 同一操作序列在 DESKTOP 与 BROWSER 各执行一遍，结果必须一致（数据、状态、文案）。差异仅允许出现在：原生菜单 vs Web 菜单、Electron 专属对话框（JDK/Tomcat 设置、safeStorage）、键盘守卫 remap。

| 编号 | 对照场景 | 一致性要求 | P | D | B |
|------|----------|-----------|---|---|---|
| TC-CONS-001 | 导入同一项目 | 检测字段/置信度/编码/Step3 摘要完全一致；.kairo/project.yaml 内容一致 | P0 | ☐ | ☐ |
| TC-CONS-002 | 构建同一项目 | BuildResult diagnostics/summary 一致；marker 位置一致 | P0 | ☐ | ☐ |
| TC-CONS-003 | 启停 Tomcat | 状态机流转/URL/日志内容一致 | P0 | ☐ | ☐ |
| TC-CONS-004 | 全文搜索同词 | 命中数/文件列表/上下文一致 | P0 | ☐ | ☐ |
| TC-CONS-005 | 编码四命令 | reopen/save/show/convert 行为一致 | P0 | ☐ | ☐ |
| TC-CONS-006 | recent projects 共享 | 桌面打开的项目在浏览器 Welcome 最近列表可见（共享 agent 数据目录） | P1 | ☐ | ☐ |
| TC-CONS-007 | 设置隔离 | 浏览器偏好不污染桌面（THEIA_CONFIG_DIR 隔离，QA 多 profile 不串台） | P2 | ☐ | ☐ |
| TC-CONS-008 | i18n/主题/快捷键速查表 | 渲染一致 | P2 | ☐ | ☐ |
| TC-CONS-009 | 键盘差异确认 | 浏览器版 Ctrl+N→alt+shift+n、Ctrl+Shift+N→alt+shift+f 等 remap 生效且文档化 | P1 | — | ☐ |

---

# 第48章 性能基准验收测试

> 目标值来自 product-requirements §6。测量方法：冷启动秒表；补全从按键到建议出现（DevTools Performance）；增量编译看 Builds 视图 elapsed；搜索看结果统计。

| 编号 | 指标 | 目标 | 环境 | P | D | B |
|------|------|------|------|---|---|---|
| TC-BENCH-001 | 冷启动到 workspace 打开 | ≤ 8s | 2vCPU/4GB Windows 云桌面 | P0 | ☐ | ☐ |
| TC-BENCH-002 | Java 文件保存后首次补全 | ≤ 1.5s | JDT LS ready | P0 | ☐ | ☐ |
| TC-BENCH-003 | 单文件增量编译 | ≤ 2s | 改一个 .java 后 Update Application | P0 | ☐ | ☐ |
| TC-BENCH-004 | 10k 文件全文搜索 | ≤ 3s | legacy-sample ×N 复制到万级 | P0 | ☐ | ☐ |
| TC-BENCH-005 | 大日志虚拟滚动流畅度 | 万行滚动无明显掉帧 | 日志查看器 | P2 | ☐ | ☐ |
| TC-BENCH-006 | 内存占用 | 4GB 机器可同时跑 IDE+JDT LS+Tomcat | 任务管理器观察峰值 | P0 | ☐ | ☐ |

---

# 附录A 完整命令 ID 清单（抽查用）

## A.1 产品核心（theia-product）
```
kairo.project.import / kairo.project.select / kairo.project.scan
kairo.runConfigurations.manage
kairo.build / kairo.cleanBuild / kairo.buildAndDeploy / kairo.publish
kairo.server.update / kairo.server.reloadContext
kairo.server.start / kairo.server.debug / kairo.server.stop / kairo.server.restart
kairo.app.open / kairo.debug.checkAdapter
kairo.view.servers / builds / deployments / logs / maven / todo / tests / sqlConsole / remote / perf
kairo.debug.openView / openConsole / view.variables / view.callstack / view.breakpoints / view.watch
kairo.java.hotswap.showHistory / kairo.debug.view.toolbar / kairo:open-debug-diagnostics
kairo.terminal.toggle / kairo.keymap.open / kairo.jdk.switch / kairo.agent.reconnect
kairo.welcome.show / kairo.devtools.toggle
kairo.project.structure (ctrl+alt+shift+s)
kairo.toggleFormatOnSave / kairo.toggleOrganizeImportsOnSave / kairo.organizeImports
kairo.localHistory.show / restore / compare
kairo.bookmark.* (toggle/show/clear/goto.N/set.N)
kairo.shortcuts.cheatsheet (ctrl+shift+k)
kairo.navigation.goToLine (ctrl+g) / quickOutline (ctrl+f12) / back / forward / recentFiles (ctrl+e)
kairo.find.class / file / symbol / action
kairo.search.center.toggle / kairo.search.replace / kairo.search.results.open / kairo.search.everywhere
kairo.extensions.open / installFromVsix / enable / disable / uninstall / reload
kairo.encoding.reopen / save / show / convert
```

## A.2 Java 扩展
```
kairo.java.smartCompletion / completeStatement / surroundWith / unwrap
kairo.java.liveTemplates.add / manage ; hippieCompletion(Backward)
kairo.java.extractMethod/Variable/Constant/Field / changeSignature
kairo.java.overrideMethod / implementMethods / generator.generate
kairo.java.goToTypeDefinition / goToSuperMethod / findUsages / showUsages / navigation.fileStructure
kairo.java.callHierarchy.showIncoming/showOutgoing ; typeHierarchy.showSupertypes/showSubtypes
kairo.java.debug.editBreakpoint* / evaluateExpression / toggleLogpoint
run/debug main & test（Run/Debug lens 与右键组）
```

---

# 附录B 快捷键全表（重点差异）

## B.1 Windows/Linux IDEA 键位（桌面默认）
| 组 | 快捷键 → 动作 |
|----|----------------|
| 编辑 | Ctrl+Z/Shift+Z undo redo；Ctrl+X/C/V；Ctrl+/ 行注释；Ctrl+Shift+/ 块注释；Ctrl+Alt+L 格式化；Ctrl+Alt+O 整理导入；Shift+F6 重命名；Ctrl+Y 删行；Ctrl+D 复制行；Ctrl+W/Ctrl+Shift+W 扩缩选；Shift+Enter 下方插行；Ctrl+Alt+Enter 上方插行；Ctrl+Shift+Enter 补全语句；Alt+Enter 快速修复；Ctrl+Space 基本/智能补全；Ctrl+P 参数；Ctrl+Q 文档；F2/Shift+F2 下/上错误；Ctrl+-/= 折叠展开；Alt+J 选下一个匹配；Alt+Shift+Insert 列选择 |
| 导航 | Ctrl+N 查类；Ctrl+Shift+N 查文件；Ctrl+Shift+Alt+N 符号；Ctrl+Shift+A Find Action；Ctrl+G 跳行；Ctrl+B/F4 定义；Ctrl+Shift+i peek；Ctrl+Alt+B 实现；Ctrl+H 类型层次；Ctrl+U 父方法；Alt+F7 用法；Ctrl+Alt+F7 show usages；Ctrl+Alt+←/→ 后退前进；Ctrl+E 最近文件；Ctrl+Shift+M 括号；Ctrl+F12 文件结构 |
| 查替 | Ctrl+Shift+F 全局查；Ctrl+Shift+R 全局替；Ctrl+F/R/F3/Shift+F3 文件内 |
| 构建/调试 | Ctrl+F9 build；Ctrl+Shift+F9 build&deploy；Ctrl+F10 update；Shift+F10 run；Shift+F9 debug；Ctrl+F2 stop；Ctrl+F8 断点；Ctrl+Shift+F8 条件断点；F8/F7/Shift+F8/F9/Alt+F9 步进 |
| 通用 | Ctrl+S 保存；Alt+F12 终端；Ctrl+Shift+K 速查表；Ctrl+F4 关编辑器；Ctrl+Shift+F12 全屏；Ctrl+Alt+S 设置；Alt+←/→ 切换编辑器；Ctrl+Shift+F4 关其他；Shift+Escape 隐藏面板 |
| 工具窗 | Alt+1..7,9 Project/Servers/Deployments/Builds/Debug/Problems/TODO/SCM |
| 书签 | F11 toggle；Ctrl+F11 mnemonic；Shift+F11 show；Ctrl+数字跳转/设置 |

## B.2 macOS 对应（摘要）
⌘O 查类、⇧⌘O 查文件、⌘L 跳行、⌘B 定义、⌘[ ⌘] 后退前进、⌘E 最近文件、⌘F9 构建、⌃⇧R Run、⌃⇧D Debug、⌘F2 Stop、⌘F8 断点、F8/F7/⇧F8 步进、⌘⌥R Continue、⌘S 保存、⌥F12 终端、⇧⌘K 速查表、⌘W 关闭、⌃⌘F 全屏、⌘, 设置、⌘1..7,9 工具窗。

## B.3 浏览器版重映射（Keyboard Guard + remap）
| 功能 | 桌面 Win | 浏览器 Chrome |
|------|----------|----------------|
| 查类 | Ctrl+N | **Alt+Shift+N** |
| 查文件 | Ctrl+Shift+N | **Alt+Shift+F** |
| 扩选 | Ctrl+W / Ctrl+Shift+W | Alt+Shift+W / Ctrl+Alt+Shift+W |
| 新建/关闭标签等 Chrome 保留键 | — | capture preventDefault 接管（Ctrl+N/T/W/Tab/F5/Ctrl+R/P 及 IDEA chords） |

## B.4 Theia 层产品级补充
Ctrl+F10 update；调试中 Ctrl+F5(mac Cmd+R) restart、Ctrl+F2 stop、Alt+F8 evaluate。

---

# 附录C Runtime Agent API 端点清单（契约抽查用）

| 分组 | 端点 |
|------|------|
| 系统 | GET /health；GET /endpoints；POST /runtime/restart；GET /diagnostics/port?port=N；GET /audit |
| Workspace | GET/POST /workspaces；GET/DELETE /workspaces/{id}；POST /workspaces/{id}/scan；POST /workspaces/{id}/projects/import |
| Project | GET /projects?workspaceId=；GET/PUT/DELETE /projects/{id}；POST /projects/detect；POST /projects/import；GET /projects/recent |
| Run Config | GET/POST/PUT /workspaces/{ws}/run-configurations；GET/PUT/DELETE .../{cid}；POST .../{cid}/launch |
| Toolchain | GET /toolchains；POST /toolchains/import |
| Build | GET/POST /builds；GET/DELETE /builds/{id}；POST /build/custom；GET /build/custom/{id}；POST /build/custom/{id}/cancel；GET/POST /ant/classpath/analyze |
| Maven | POST /maven/detect；GET /maven/dependencies；POST /maven/run |
| Deploy | GET/POST /deployments；GET /deployments/{id} |
| Server | GET/POST /servers；GET/DELETE /servers/{id}；POST /servers/{id}/{debug|restart|recover|reload}；GET /servers/{id}/logs?tail=；GET /servers/recoverable |
| Search | POST /search；POST /search/files；WS /search/stream |
| Encoding | POST /encoding/detect；POST /encoding/recode；POST /encoding/validate |
| Java/JDT | POST /workspaces/{ws}/java/prepare；GET .../java/launch-descriptor；GET/POST /jdtls；GET /jdtls/distribution；GET/POST /jdtls/project；POST /java/run；POST /java/detect；POST /jvm/compile-incremental；POST /jvm/compile；POST /jvm/redefine |
| Debug | GET /debug/adapter/status；POST /debug/jdk/download |
| SQL | POST /sql/execute；POST /sql/test-connection |
| Auth | POST /auth/login；POST /auth/logout |
| Events | WS /events（子协议 kairo-secret-v1；?workspaceId=&afterSequence=） |

错误码 20 个：unauthenticated/forbidden/not_found/conflict/rate_limited/invalid_request/path_forbidden/toolchain_missing/runtime_missing/unsupported_jdk_target/internal/io_error/process_spawn_failed/compile_failed/deploy_failed/debug_attach_failed/cancelled/timeout/plugin_crashed/unsupported。

---

# 附录D 缺陷报告模板

```
缺陷编号: BUG-[日期]-[序号]
关联用例: TC-XXX-NNN
形态/版本: DESKTOP / BROWSER（构建号）
环境: OS 版本 / JDK / Tomcat / 浏览器版本
优先级: P0-P3
前置条件:
复现步骤:
  1.
  2.
实际结果:
预期结果:
复现率: 必现/概率(__/10)
证据: 截图/录屏/日志片段（desktop-main.log 时间点）
初步定位: （可选：前端 widget / runtime-extension / Go handler / Electron main）
```

# 附录E 测试结果汇总表

| 章节 | 用例数 | 通过 | 失败 | 阻断 | 跳过 | 备注 |
|------|--------|------|------|------|------|------|
| 第2章 安装卸载 | | | | | | |
| 第3章 启动退出 | | | | | | |
| 第4章 窗口布局 | | | | | | |
| 第5章 菜单栏 | | | | | | |
| 第6章 工具栏 | | | | | | |
| 第7章 状态栏 | | | | | | |
| 第8章 欢迎页 | | | | | | |
| 第9章 导入向导 | | | | | | |
| 第10章 项目管理 | | | | | | |
| 第11章 资源管理器 | | | | | | |
| 第12章 编辑器 | | | | | | |
| 第13章 Java | | | | | | |
| 第14章 JSP | | | | | | |
| 第15章 XML | | | | | | |
| 第16章 JSON/Properties | | | | | | |
| 第17章 编码专项 | | | | | | |
| 第18章 搜索 | | | | | | |
| 第19章 构建 | | | | | | |
| 第20章 Maven | | | | | | |
| 第21章 服务器/部署/热更新 | | | | | | |
| 第22章 运行配置 | | | | | | |
| 第23章 调试 | | | | | | |
| 第24章 问题面板 | | | | | | |
| 第25章 TODO | | | | | | |
| 第26章 单元测试 | | | | | | |
| 第27章 SQL 控制台 | | | | | | |
| 第28章 终端 | | | | | | |
| 第29章 Git | | | | | | |
| 第30章 SVN | | | | | | |
| 第31章 本地历史 | | | | | | |
| 第32章 书签 | | | | | | |
| 第33章 快捷键 | | | | | | |
| 第34章 性能/大文件 | | | | | | |
| 第35章 通知中心 | | | | | | |
| 第36章 设置 | | | | | | |
| 第37章 命令面板 | | | | | | |
| 第38章 扩展管理 | | | | | | |
| 第39章 远程面板 | | | | | | |
| 第40章 合规/遥测 | | | | | | |
| 第41章 升级检查 | | | | | | |
| 第42章 国际化 | | | | | | |
| 第43章 无障碍 | | | | | | |
| 第44章 错误容错 | | | | | | |
| 第45章 安全 | | | | | | |
| 第46章 日志诊断 | | | | | | |
| 第47章 双形态一致性 | | | | | | |
| 第48章 性能基准 | | | | | | |
| **合计** | | | | | | |

---

## 执行顺序建议（供测试排期参考）

1. **第 1 轮（环境与冒烟，0.5 天）**：第1/2/3/4 章 → 确认安装、首启对话框、退出清理全部 P0 通过。
2. **第 2 轮（项目主线，1 天）**：第8/9/10/11 章 → 导入向导全流程 + 项目结构。
3. **第 3 轮（编码与编辑，1 天）**：第12/13/14/15/16/17 章 → GBK 专项务必在中文 Windows 上执行。
4. **第 4 轮（构建运行部署，1 天）**：第18~23 章 → 搜索、构建、Tomcat、热更新、运行配置、调试。
5. **第 5 轮（周边与横切，1 天）**：第24~46 章。
6. **第 6 轮（收尾，0.5 天）**：第47/48 章 + 附录E 汇总 + 回归所有失败项。

> 本文档基于 v0.1.0 代码库逐文件深度分析编写。若后续代码变更（新增菜单/视图/端点），请同步更新对应章节的用例表。
