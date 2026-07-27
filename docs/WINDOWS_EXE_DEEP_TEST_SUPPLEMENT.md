# Kairo IDE Windows EXE 深度功能测试 — 补充测试计划

> **版本**: v0.1.0
> **编写日期**: 2026-07-26
> **前置条件**: 第一轮自动化UI测试已全部通过（154/154，P0 129/129），本文档覆盖尚未进行深度端到端验证的功能模块
> **测试平台**: Windows 10/11 x64 + JDK 6 + Tomcat 6（内置）
> **测试对象**: `dist/win-unpacked\Kairo IDE.exe`（已修复asar包结构、bundled目录、命令注册等问题）
> **预计时间**: 4-6小时人工/自动化交互测试
> **测试项目**: 需要准备一个legacy Java Web项目（含build.xml、GBK编码Java文件、JSP页面、中文注释）

---

## 0. 已完成测试概览（无需重复）

第一轮自动化测试已验证通过的内容（154项）：
- ✅ asar包结构正确（root package.json、main入口、前端bundle、后端main.js、bundled目录）
- ✅ 应用启动正常，冷启动<45秒，窗口标题含"Kairo IDE"
- ✅ 窗口基础元素可见：菜单栏、活动栏、侧边栏、编辑区、底部面板、状态栏
- ✅ 活动栏6个默认图标可点击切换（Explorer/Search/SCM/Debug/Testing/SVN）
- ✅ 菜单栏35个命令全部在CommandRegistry中注册（含Welcome和Toggle Developer Tools）
- ✅ 状态栏7个状态项可见（Project/JDK/Encoding/Build/Server/Debug/Agent）
- ✅ 欢迎页面可从Help菜单打开，有Back/Import Project/New Project按钮
- ✅ 导入向导命令可访问，对话框可打开
- ✅ 项目选择器命令可访问
- ✅ Explorer/Files命令可访问
- ✅ 编辑器命令可用（含GBK编码相关命令）
- ✅ 查找替换命令可用，Ctrl+H能打开替换框
- ✅ 编码命令可访问（GBK支持验证）
- ✅ 全局搜索Ctrl+Shift+F可用
- ✅ Search Everywhere命令可访问
- ✅ Build/Clean Build命令可访问，Build视图有Build/Cancel按钮
- ✅ 服务器5个命令可访问（Start/Stop/Restart/StartDebug/OpenApp）
- ✅ 部署视图命令可访问
- ✅ Tomcat Logs命令可访问
- ✅ Run Configurations命令可访问
- ✅ 调试6个命令可访问（Toggle Breakpoint/Start/Continue/StepInto/StepOver/StepOut）
- ✅ Debug Panels命令可访问
- ✅ Breakpoints命令可访问
- ✅ Maven视图命令可访问
- ✅ SQL Console命令可访问
- ✅ Test Results命令可访问
- ✅ TODO视图命令可访问
- ✅ Problems面板可访问
- ✅ Output Channels命令可访问
- ✅ Terminal命令可访问，Ctrl+`能打开终端
- ✅ Git/SVN/Local History/Bookmarks命令可访问
- ✅ 16个快捷键验证通过（Ctrl+N/O/S/Z/Y/X/C/V/A/F/H/G/Shift+F/`,`/Shift+P/F1/`/F5/F9/F10/F11/Shift+F5/Alt+F4/Shift+F10）
- ✅ Keymaps/Performance Dashboard/Remote Development/Java Hierarchy命令可访问
- ✅ Toggle Notifications命令可访问
- ✅ Settings Ctrl+,可打开
- ✅ 命令面板Ctrl+Shift+P和F1均可打开
- ✅ Focus Editor命令可执行
- ✅ 对话框Esc可关闭
- ✅ Large File命令可访问
- ✅ 无障碍：应用有可访问名称，活动栏图标有aria-label
- ✅ 单实例锁API可访问
- ✅ 外部链接setWindowOpenHandler阻止非http URL
- ✅ 无自动卸载逻辑
- ✅ 控制台无关键错误（仅2个非关键错误）
- ✅ EXE日志文件存在且无ERROR/FATAL级别
- ✅ CommandRegistry中104个Kairo命令注册
- ✅ CSP策略、contextIsolation、nodeIntegration配置正确
- ✅ Welcome和Toggle Developer Tools命令已补全注册到Help菜单

---

## 1. NSIS安装程序深度测试（§2补充）

> 第一轮仅验证了安装包文件存在和数字签名，需实际执行安装流程

### 1.1 完整安装流程测试
| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 1.1.1 | 安装程序UI启动 | 双击 `dist\Kairo IDE Setup x.x.x.exe` | 显示NSIS安装向导界面，有Kairo图标和"Welcome to Kairo IDE Setup" | P0 |
| 1.1.2 | UAC提示验证 | 启动安装程序 | **不弹出**UAC管理员权限请求（requestedExecutionLevel=asInvoker） | P0 |
| 1.1.3 | 许可协议页面 | 点击Next | 显示Apache 2.0许可协议文本，有"I accept"/"I do not accept"单选框 | P0 |
| 1.1.4 | 协议拒绝阻止Next | 选择"I do not accept" | Next按钮禁用，无法继续 | P1 |
| 1.1.5 | 安装目录默认值 | 接受协议后Next | 默认安装目录为 `%LOCALAPPDATA%\Programs\Kairo IDE` | P0 |
| 1.1.6 | 自定义安装目录 | 点击Browse选择 `D:\Dev\KairoIDE` | 可以更改路径，路径显示正确 | P0 |
| 1.1.7 | 中文路径安装 | 选择含中文路径如 `D:\开发工具\Kairo` | 安装成功，无乱码，程序可正常启动 | P0 |
| 1.1.8 | 组件选择页面 | 进入组件选择步骤 | 显示核心组件（必选）、JDT LS、Tomcat 6等选项 | P1 |
| 1.1.9 | 桌面快捷方式选项 | 查看选项 | 有"Create Desktop Shortcut"复选框，默认勾选 | P0 |
| 1.1.10 | 开始菜单选项 | 查看选项 | 有"Create Start Menu folder"选项 | P0 |
| 1.1.11 | 安装进度条 | 点击Install | 进度条从0%到100%，无卡顿 | P0 |
| 1.1.12 | 文件提取验证 | 安装过程中检查目标目录 | 包含 Kairo IDE.exe、resources/app.asar、resources/bundled/jdtls/、resources/bundled/tomcat6/、resources/bin/kairo-runtime.exe | P0 |
| 1.1.13 | 无错误对话框 | 等待安装完成 | 不出现任何错误或警告对话框 | P0 |
| 1.1.14 | 完成页面 | 安装结束 | 显示"Completing Kairo IDE Setup"页面 | P0 |
| 1.1.15 | Run Kairo选项 | 查看完成页面 | 有"Run Kairo IDE"复选框 | P1 |
| 1.1.16 | 桌面快捷方式验证 | 检查桌面 | 存在"Kairo IDE"快捷方式，图标正确，双击可启动 | P0 |
| 1.1.17 | 开始菜单项验证 | 打开开始菜单 | 存在Kairo IDE程序组，含启动和卸载项 | P0 |
| 1.1.18 | 安装后启动验证 | 从安装目录启动 | 程序正常启动，窗口标题为"Kairo IDE" | P0 |

---

## 2. ZIP便携包测试（§3补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 2.1 | ZIP解压测试 | 解压 `dist\Kairo IDE-x.x.x-win-x64.zip` 到任意目录 | 解压成功，无CRC错误 | P0 |
| 2.2 | 目录结构验证 | 查看解压后目录 | 包含 Kairo IDE.exe、resources/ 完整结构 | P0 |
| 2.3 | 便携运行测试 | 双击解压后的 Kairo IDE.exe | 程序正常启动，不写入系统目录（用户数据在便携目录下） | P1 |
| 2.4 | 移动目录测试 | 将整个目录移动到其他位置（如从D:\移到E:\） | 移动后仍可正常运行 | P2 |

---

## 3. 窗口控制操作测试（§6补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 3.1 | 最大化/还原 | 点击窗口右上角最大化按钮 | 窗口最大化填满屏幕；再次点击还原到原大小 | P0 |
| 3.2 | 最小化 | 点击最小化按钮 | 窗口最小化到任务栏；点击任务栏图标恢复 | P0 |
| 3.3 | 窗口拖拽 | 按住标题栏拖动窗口 | 窗口可以自由拖动位置 | P0 |
| 3.4 | 边框拖拽调整大小 | 拖动窗口边框/角落 | 窗口可以调整大小，最小尺寸限制约为960x600 | P1 |
| 3.5 | 关闭按钮 | 点击X按钮 | 程序开始关闭流程，所有子进程在5秒内终止 | P0 |
| 3.6 | Alt+F4关闭 | 按Alt+F4 | 程序正常关闭 | P0 |

---

## 4. 导入向导完整流程测试（§12补充 — 核心P0流程）

> 这是用户使用的第一个核心功能，必须走完3步完整流程
> **前置条件**: 准备好legacy-sample项目路径（含build.xml和GBK编码文件）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 4.1 | 向导标题验证 | Kairo菜单→Import Kairo Project | 标题为"Import Legacy Java Project"，副标题"Auto-detect and configure your project" | P0 |
| 4.2 | 步骤指示器 | 查看顶部 | 3个步骤圆点：1.Select Directory、2.Confirm Settings、3.Complete；Step 1高亮 | P0 |
| 4.3 | 路径输入框 | 查看输入框 | 存在，placeholder为"/absolute/path/to/project"，可输入文本 | P0 |
| 4.4 | Browse按钮 | 点击Browse... | 弹出文件夹选择对话框 | P0 |
| 4.5 | 通过Browse选择项目 | 在对话框中选择legacy-sample目录，确认 | 路径填入输入框 | P0 |
| 4.6 | Scan按钮点击 | 点击Scan | 按钮变为"Scanning..."禁用状态，开始扫描 | P0 |
| 4.7 | 扫描成功 | 等待扫描完成 | 自动跳转到Step 2，Step 1标记为完成 | P0 |
| 4.8 | Step 2表单验证 | 查看Step 2 | 显示Detection confidence、Project Name、Source Directories、Web Root、Library Directories、Encoding、JDK Version、Source Version、Target Version、Output Directory、Build Tool、Build Script、Context Path等字段 | P0 |
| 4.9 | 编码默认值 | 查看Encoding下拉框 | 对于GBK项目应选中GBK | P0 |
| 4.10 | Build Tool默认 | 查看Build Tool | 有build.xml时默认选中Ant | P0 |
| 4.11 | Project Name可编辑 | 修改Project Name为自定义名称 | 可以修改 | P0 |
| 4.12 | Import Project按钮 | 点击Import Project | 按钮显示"Importing..."并禁用，开始导入 | P0 |
| 4.13 | 导入成功 | 等待导入完成 | 自动跳转到Step 3 Complete | P0 |
| 4.14 | 完成页面 | 查看Step 3 | 显示"Project [name] imported successfully"，显示Location/Encoding等信息 | P0 |
| 4.15 | Open Project Folder | 点击"Open Project Folder" | 向导关闭，文件资源管理器显示项目文件树，状态栏Project项更新 | P0 |
| 4.16 | 工具栏同步 | 查看工具栏Project下拉框 | 显示新导入的项目名称 | P0 |
| 4.17 | 扫描错误处理 | 输入不存在的路径点击Scan | 显示红色错误提示，停留在Step 1 | P0 |
| 4.18 | Back按钮 | 在Step 2点击Back | 返回Step 1，已输入内容保留 | P0 |

---

## 5. 文件资源管理器操作测试（§14补充）

> **前置条件**: 已成功导入legacy-sample项目

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 5.1 | 项目根目录显示 | 打开Explorer | 显示项目根目录名称 | P0 |
| 5.2 | 目录展开 | 点击src目录前的展开箭头 | 展开显示子文件/子目录 | P0 |
| 5.3 | 目录折叠 | 再次点击箭头 | 目录折叠 | P0 |
| 5.4 | 文件单击预览 | 单击一个.java文件 | 文件在编辑器中以预览模式打开（标签斜体） | P0 |
| 5.5 | 文件双击打开 | 双击一个.java文件 | 文件永久打开（标签正常字体） | P0 |
| 5.6 | 右键菜单-文件 | 右键点击一个文件 | 弹出上下文菜单（含Open/Cut/Copy/Paste/Delete/Rename等） | P0 |
| 5.7 | 右键菜单-文件夹 | 右键点击一个目录 | 弹出上下文菜单（含New File/New Folder等） | P0 |
| 5.8 | GBK文件名显示 | 如果项目含中文文件名 | 中文文件名正确显示，无乱码 | P0 |

---

## 6. 编辑器深度测试（§15补充 — 核心P0功能）

> **前置条件**: 已导入项目，打开一个GBK编码的Java文件

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 6.1 | Java语法高亮 | 打开.java文件 | 关键字（public/class/void等）、字符串、注释有不同颜色高亮 | P0 |
| 6.2 | JSP语法高亮 | 打开.jsp文件 | HTML标签、Java脚本块`<% %>`均有语法高亮 | P0 |
| 6.3 | XML语法高亮 | 打开build.xml/web.xml | XML标签、属性有语法高亮 | P0 |
| 6.4 | **GBK中文无乱码** | 查看含中文注释的Java文件 | 中文注释正确显示，无乱码方块 | P0 |
| 6.5 | 行号显示 | 查看编辑器左侧 | 显示行号 | P1 |
| 6.6 | 代码输入 | 在编辑器中输入代码（如`int test = 1;`） | 可以正常输入，无卡顿 | P0 |
| 6.7 | 光标定位 | 点击编辑器任意位置 | 光标正确定位到点击处 | P0 |
| 6.8 | 文本选择拖拽 | 拖拽选择一段文本 | 文本正确选中并高亮 | P0 |
| 6.9 | 撤销重做 | 输入内容后Ctrl+Z撤销，再Ctrl+Y重做 | 撤销和重做功能正常 | P0 |
| 6.10 | 剪切复制粘贴 | 选中文本→Ctrl+X剪切→Ctrl+V粘贴 | 操作正常 | P0 |
| 6.11 | 标签页切换 | 打开多个文件，点击不同标签 | 正确切换到对应文件 | P0 |
| 6.12 | 标签关闭 | 点击标签X按钮 | 标签关闭 | P0 |
| 6.13 | 保存Ctrl+S | 修改文件后按Ctrl+S | 文件保存，标签页的修改标记(圆点)消失 | P0 |
| 6.14 | 脏标记 | 文件修改未保存 | 标签页文件名前显示圆点标记 | P1 |
| 6.15 | **GBK中文输入保存** | 在GBK文件中输入中文注释，保存后关闭重开 | 中文正确保存和显示，无乱码 | P0 |

---

## 7. 查找替换深度测试（§16补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 7.1 | Ctrl+F打开查找 | 在编辑器中按Ctrl+F | 编辑器顶部出现查找输入框 | P0 |
| 7.2 | 查找高亮 | 输入文件中存在的关键词（如"class"） | 所有匹配项高亮显示 | P0 |
| 7.3 | 查找下一个 | 按Enter或点击下一个按钮 | 光标跳转到下一个匹配项 | P0 |
| 7.4 | 查找上一个 | 按Shift+Enter或点击上一个按钮 | 光标跳转到上一个匹配项 | P0 |
| 7.5 | 匹配计数 | 查看查找框 | 显示"当前/总数"匹配计数 | P1 |
| 7.6 | 区分大小写 | 点击"Match Case"按钮(ABc图标) | 搜索变为区分大小写 | P1 |
| 7.7 | 全字匹配 | 点击"Match Whole Word"按钮 | 只匹配完整单词 | P1 |
| 7.8 | 正则表达式搜索 | 点击正则按钮(.*)，输入如`p\w+c` | 匹配正则结果 | P1 |
| 7.9 | Ctrl+H替换 | 按Ctrl+H | 查找框展开，显示替换输入框 | P0 |
| 7.10 | 替换单个 | 输入替换文本，点击Replace | 当前匹配项被替换 | P1 |
| 7.11 | Esc关闭查找框 | 按Esc | 查找框关闭 | P1 |

---

## 8. 编码功能深度测试（§17补充 — 核心P0功能）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 8.1 | **状态栏GBK显示** | 打开GBK编码Java文件 | 状态栏Encoding项显示"Encoding: GBK"或"GBK *" | P0 |
| 8.2 | 编码切换菜单 | 点击状态栏Encoding项 | 弹出编码选择菜单/Reopen With Encoding菜单 | P0 |
| 8.3 | UTF-8重新打开 | 选择以UTF-8重新打开GBK文件 | 文件以UTF-8重新打开，中文显示乱码（正常现象） | P0 |
| 8.4 | **GBK恢复显示** | 重新选择Reopen with GBK | 中文恢复正确显示 | P0 |
| 8.5 | GBK保存 | 修改GBK文件后按Ctrl+S | 保存成功，无编码错误提示 | P0 |

---

## 9. 全局搜索深度测试（§18补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 9.1 | 搜索面板打开 | Ctrl+Shift+F | 左侧栏显示Search面板 | P0 |
| 9.2 | 搜索输入与执行 | 输入"class"，按Enter | 开始搜索，显示进度，完成后显示结果树 | P0 |
| 9.3 | 结果树展示 | 搜索完成后 | 结果按文件分组显示 | P0 |
| 9.4 | 结果展开 | 点击文件前的展开箭头 | 显示该文件中的匹配行 | P0 |
| 9.5 | **结果点击跳转** | 点击一条匹配结果 | 编辑器打开对应文件并跳转到匹配行，高亮匹配文本 | P0 |
| 9.6 | **GBK文件中文搜索** | 搜索GBK文件中的中文关键词（如"测试"或实际中文注释内容） | 能正确搜索到GBK文件中的中文内容，无乱码 | P0 |
| 9.7 | 文件包含过滤 | 在"files to include"输入`*.java` | 只搜索Java文件 | P1 |

---

## 10. 构建功能端到端测试（§20补充 — 核心P0流程）

> **前置条件**: 已成功导入legacy-sample项目

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 10.1 | Build视图打开 | 点击活动栏Builds图标或Kairo→View→Builds | 左侧栏显示Build Status面板，标题"Build Status"，初始idle状态 | P0 |
| 10.2 | 点击Build按钮 | 点击面板内Build按钮 | 按钮禁用，状态变为running（有动画） | P0 |
| 10.3 | 构建输出 | 等待构建完成 | Output面板Build通道显示Ant/javac编译输出 | P0 |
| 10.4 | **构建成功状态** | 构建完成 | 显示✓ succeeded，Build按钮恢复可用 | P0 |
| 10.5 | 诊断列表 | 查看Diagnostics区域 | 如有警告显示警告列表；错误显示错误；无错误则显示空或success | P0 |
| 10.6 | 构建历史 | 查看Build History区域 | 显示本次构建记录（id、时间、状态图标） | P0 |
| 10.7 | **状态栏Build更新** | 构建成功后查看状态栏 | Build项显示"succeeded" | P0 |
| 10.8 | Clean Build | 点击Clean Build按钮 | 先清理再构建，输出中显示clean过程 | P0 |
| 10.9 | 失败构建（如有错误代码） | 在有编译错误的代码上构建 | 显示✗ failed，Diagnostics显示具体错误 | P0 |

---

## 11. 服务器生命周期端到端测试（§21补充 — 核心P0流程）

> **前置条件**: 已成功导入并构建项目

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 11.1 | Server视图打开 | 点击活动栏Servers图标或Kairo→View→Servers | 左侧栏显示Server面板，初始■ Stopped状态 | P0 |
| 11.2 | 点击Start | 点击Start按钮 | 按钮禁用，状态变为▶ Starting... | P0 |
| 11.3 | **等待启动成功** | 等待Tomcat启动（可能需要10-30秒） | 状态变为● Running | P0 |
| 11.4 | Server URL显示 | 查看Server Info区域 | 显示"URL: http://127.0.0.1:xxxx"，端口号可见 | P0 |
| 11.5 | **状态栏Server更新** | 服务器运行后查看状态栏 | Server项显示"running :xxxx" | P0 |
| 11.6 | Open App按钮可用 | 服务器Running后 | Open App按钮变为可用 | P0 |
| 11.7 | **点击Open App** | 点击Open App按钮 | 系统默认浏览器打开 http://127.0.0.1:xxxx/contextPath | P0 |
| 11.8 | 浏览器验证 | 在打开的浏览器中查看 | 能看到应用页面（JSP页面渲染正常） | P0 |
| 11.9 | 热重载发布 | 修改一个JSP/CSS文件，点击Publish Changed Files | 显示发布结果消息，浏览器刷新可见更改 | P0 |
| 11.10 | Tomcat日志 | 打开Tomcat Logs视图 | 显示catalina日志，实时滚动 | P0 |
| 11.11 | 日志过滤 | 在Filter框输入"ERROR" | 只显示含ERROR的日志行 | P0 |
| 11.12 | 暂停/恢复日志 | 点击Pause再Resume | 日志暂停和恢复滚动 | P0 |
| 11.13 | **Stop按钮** | 点击Stop按钮 | 状态变为◐ Stopping...，后变为■ Stopped | P0 |
| 11.14 | 停止后Open App禁用 | 服务器停止后 | Open App按钮禁用 | P0 |
| 11.15 | Restart | 运行中点击Restart | 服务器重启 | P0 |

---

## 12. 运行配置管理测试（§24补充）

> **前置条件**: 已导入项目

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 12.1 | 面板打开 | Kairo→Run Configurations... | 主区域打开Run Configurations面板，标题"Run Configurations" | P0 |
| 12.2 | 空状态提示 | 无配置时 | 显示"No run configurations..."提示 | P0 |
| 12.3 | New按钮 | 点击New | 打开配置编辑器，标题"New Run Configuration" | P0 |
| 12.4 | 表单填写 | 填写Name="test-config"，确认HTTP Port(8080)、Debug Port(8000)、Context Path="/"、Build type=Ant、Ant target=war | 表单各字段可输入和选择 | P0 |
| 12.5 | Mode切换Debug | 选择Mode=Debug | Suspend复选框变为可用 | P0 |
| 12.6 | Save保存 | 点击Save | 返回列表视图，列表中显示新配置项 | P0 |
| 12.7 | 配置项显示 | 查看列表项 | 显示名称、模式(Run)、项目、HTTP端口、JDWP端口 | P0 |
| 12.8 | Set Default | 点击Set Default | 配置显示★ Default徽章 | P0 |
| 12.9 | **工具栏同步** | 查看工具栏Run Config下拉框 | 包含新创建的配置 | P0 |
| 12.10 | Edit编辑 | 点击Edit | 打开编辑器，标题"Edit Run Configuration"，ID只读 | P0 |
| 12.11 | Delete删除 | 点击Delete→确认 | 弹出确认对话框，确认后配置被删除 | P0 |
| 12.12 | 从列表Run | 选中配置点击Run | 触发服务器启动流程 | P0 |

---

## 13. 调试功能端到端测试（§25-27补充 — 核心P0流程）

> **前置条件**: 已创建Debug模式运行配置，服务器可Debug启动，有一个带断点的Servlet/JSP

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 13.1 | 设置断点 | 在Java文件行号旁单击gutter | 出现红色圆点断点标记 | P0 |
| 13.2 | Debug启动服务器 | 选中Debug配置点击Debug，或工具栏Debug按钮 | 以Debug模式启动Tomcat，JDWP端口监听 | P0 |
| 13.3 | **JDWP端口状态栏** | Debug模式启动后查看状态栏 | Server项显示"JDWP:xxxx"调试端口 | P0 |
| 13.4 | **触命中断点** | 在浏览器中访问触发断点代码的URL | 程序暂停在断点处，编辑器高亮当前行 | P0 |
| 13.5 | Variables面板 | 查看Variables面板 | 显示当前作用域的变量及其值 | P0 |
| 13.6 | 变量展开 | 点击对象变量前的展开箭头 | 展开对象字段列表 | P1 |
| 13.7 | Call Stack面板 | 查看Call Stack面板 | 显示当前线程调用栈帧 | P0 |
| 13.8 | **Continue (F5)** | 点击Continue或按F5 | 程序继续执行，直到下一个断点或结束 | P0 |
| 13.9 | Step Over (F10) | 命中断点后按F10 | 执行当前行，停在下一行 | P0 |
| 13.10 | Step Into (F11) | 按F11 | 进入方法内部 | P0 |
| 13.11 | Step Out (Shift+F11) | 按Shift+F11 | 执行完当前方法返回 | P0 |
| 13.12 | Stop调试 (Shift+F5) | 按Shift+F5或点击Stop | 终止调试会话，断开JDWP | P0 |
| 13.13 | Breakpoints面板 | 查看Breakpoints面板 | 列出所有设置的断点，带文件名和行号 | P0 |
| 13.14 | 断点禁用 | 取消断点复选框 | 断点变为空心灰色圆，不触发 | P1 |
| 13.15 | 条件断点 | 右键断点→Edit Condition，输入条件 | 设置条件断点（红点带问号） | P1 |
| 13.16 | 调试控制台 | 切换到Debug Console | 可以输入表达式求值 | P1 |

---

## 14. 工具栏功能测试（§9补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 14.1 | 工具栏可见 | 查看窗口顶部 | Kairo工具栏可见，含Project下拉、Run Config下拉、Run/Debug/Stop/Build按钮 | P0 |
| 14.2 | Project下拉切换 | 导入多个项目后点击Project下拉 | 列出所有已导入项目，可以切换 | P0 |
| 14.3 | Run Config下拉 | 点击Run Config下拉 | 列出所有运行配置，可切换默认配置 | P0 |
| 14.4 | ▶ Run按钮 | 选择配置后点击Run | 触发启动服务器 | P0 |
| 14.5 | ● Debug按钮 | 点击Debug | 以Debug模式启动服务器 | P0 |
| 14.6 | ■ Stop按钮 | 服务器运行时点击Stop | 停止服务器 | P0 |
| 14.7 | ⚙ Build按钮 | 点击Build | 触发项目构建，构建中按钮显示Building... | P0 |

---

## 15. 状态栏状态更新测试（§10补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 15.1 | Project项更新 | 导入项目后 | Project项显示项目名称 | P0 |
| 15.2 | JDK项更新 | JDT LS就绪后 | JDK项显示JDK版本（如1.6） | P0 |
| 15.3 | Encoding项更新 | 打开GBK Java文件 | Encoding项显示"GBK" | P0 |
| 15.4 | Build项更新 | 执行构建后 | Build项显示构建结果（succeeded/failed） | P0 |
| 15.5 | Server项更新 | 启动/停止服务器 | Server项状态正确切换（stopped→starting→running→stopping→stopped） | P0 |
| 15.6 | **点击Project状态项** | 点击状态栏Project项 | 打开项目选择器 | P0 |
| 15.7 | 点击Server状态项 | 点击Server项 | 打开Servers视图 | P0 |
| 15.8 | 点击Encoding项 | 点击Encoding项 | 弹出编码重新打开菜单 | P0 |
| 15.9 | 点击Build项 | 点击Build项 | 打开Builds视图 | P0 |

---

## 16. 输出面板多通道测试（§33补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 16.1 | 输出面板打开 | View→Output或点击底部面板Output标签 | 底部面板显示Output标签页 | P0 |
| 16.2 | 通道选择下拉 | 点击右上角通道下拉框 | 列出多个输出通道（Build/Server/Agent/LSP等） | P0 |
| 16.3 | Build通道 | 切换到Build通道，执行构建 | 显示构建输出日志（Ant/javac输出） | P0 |
| 16.4 | Server(Tomcat)通道 | 切换到Tomcat通道，启动服务器 | 显示Tomcat catalina日志 | P0 |
| 16.5 | Agent通道 | 切换到Agent通道 | 显示Go Runtime Agent通信日志 | P1 |
| 16.6 | LSP通道 | 切换到Language Server通道 | 显示Java LSP初始化/通信日志 | P1 |
| 16.7 | **中文日志不乱码** | 查看含中文的构建日志 | 中文正确显示，无乱码 | P0 |
| 16.8 | 清空输出 | 点击Clear Output按钮 | 当前通道输出被清空 | P1 |

---

## 17. 终端功能测试（§34补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 17.1 | 新建终端 | Ctrl+Shift+` | 底部面板打开新终端，显示Windows命令提示符 | P0 |
| 17.2 | 执行dir命令 | 输入`dir`回车 | 显示当前目录文件列表 | P0 |
| 17.3 | **中文目录支持** | `cd`到含中文路径的目录，执行`dir` | 中文文件名/目录名正确显示 | P0 |
| 17.4 | cmd.exe验证 | 输入`echo %COMSPEC%` | 确认使用cmd.exe | P0 |
| 17.5 | java -version | 输入`java -version` | 显示JDK版本信息（1.6.x） | P0 |
| 17.6 | Alt+F12切换 | 按Alt+F12 | 终端面板显示/隐藏切换 | P0 |

---

## 18. 问题面板测试（§32补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 18.1 | Problems面板 | Ctrl+Shift+M | 底部面板显示Problems问题列表 | P0 |
| 18.2 | 问题类型图标 | 有编译错误时 | Error/Warning/Info有不同级别图标 | P0 |
| 18.3 | 问题位置格式 | 查看问题条目 | 显示文件名、行号、列号 | P0 |
| 18.4 | **双击跳转** | 双击一条问题 | 编辑器跳转到对应文件和行 | P0 |

---

## 19. Search Everywhere测试（§19补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 19.1 | 双击Shift | 快速双击Shift键 | 弹出Search Everywhere模态对话框 | P1 |
| 19.2 | 搜索框聚焦 | 对话框打开后 | 搜索输入框自动获得焦点 | P1 |
| 19.3 | 输入搜索 | 输入文件名或类名 | 实时显示结果列表 | P1 |
| 19.4 | 分类标签 | 查看标签 | 显示All/Files/Types/Symbols/Actions分类按钮 | P1 |
| 19.5 | Files分类 | 点击Files标签 | 只显示文件搜索结果 | P1 |
| 19.6 | 键盘选择 | ↑↓键选择，Enter打开 | 可以键盘导航并打开结果 | P1 |
| 19.7 | Esc关闭 | 按Esc | 对话框关闭 | P1 |

---

## 20. SQL控制台测试（§29补充）

> 需要有可用的数据库（Oracle/MySQL/PostgreSQL等）才能进行完整测试

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 20.1 | SQL Console打开 | Kairo→View→SQL Console | 主区域打开SQL控制台面板 | P1 |
| 20.2 | 新建连接 | 点击+按钮 | 弹出"新建数据库连接"对话框 | P1 |
| 20.3 | 连接表单 | 填写Database Type、Host、Port、Database、Username、Password | 各输入框/下拉框可用，密码掩码显示 | P0 |
| 20.4 | Test Connection | 点击Test Connection | 显示连接成功/失败 | P0 |
| 20.5 | 确认连接 | 点击Connect | 建立连接，工具栏显示连接状态 | P0 |
| 20.6 | SQL输入 | 在编辑器输入SELECT语句 | 支持SQL语法高亮 | P1 |
| 20.7 | 执行SQL | 点击Execute▶按钮 | 执行SQL，Results标签显示结果表格 | P0 |
| 20.8 | 错误处理 | 执行错误SQL | 显示错误信息，不崩溃 | P1 |

---

## 21. 通知中心测试（§44补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 21.1 | 构建通知 | 执行Build操作 | 右下角弹出通知toast（Info样式蓝色） | P0 |
| 21.2 | 错误通知 | 构建失败 | 显示Error样式红色通知 | P0 |
| 21.3 | 通知自动消失 | 等待几秒 | Info/Warning通知超时后自动消失 | P1 |

---

## 22. 对话框确认测试（§48补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 22.1 | **未保存关闭确认** | 修改文件后点击标签X | 弹出"是否保存"确认框（Save/Don't Save/Cancel） | P0 |
| 22.2 | Save按钮 | 点击Save | 保存文件并关闭标签 | P0 |
| 22.3 | Don't Save | 点击Don't Save | 不保存直接关闭 | P0 |
| 22.4 | Cancel | 点击Cancel | 取消关闭，文件保持打开 | P0 |
| 22.5 | 模态遮罩 | 对话框打开时 | 背景有遮罩，不可操作其他区域 | P0 |

---

## 23. 欢迎页面细节测试（§11补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 23.1 | 欢迎页大标题 | Help→Welcome | 显示"Kairo IDE"大标题 | P0 |
| 23.2 | Open Project按钮 | 点击"Open Project..." | 打开项目选择器 | P0 |
| 23.3 | Open Workspace Folder | 点击"Open Workspace Folder..." | 弹出文件夹选择对话框 | P0 |
| 23.4 | Quick Start Guide | 查看快速开始区域 | 显示3步快速入门 | P1 |
| 23.5 | 关闭Welcome标签 | 点击标签X | Welcome标签关闭 | P1 |

---

## 24. 多实例与单实例锁（§51补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 24.1 | **二次启动验证** | 已运行Kairo IDE时再次双击exe | 不启动第二个实例，已有窗口被激活/前置 | P0 |
| 24.2 | 最小化后激活 | 最小化窗口后再次启动exe | 窗口恢复并前置显示 | P1 |

---

## 25. 卸载程序测试（§53补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 25.1 | 卸载程序启动 | 开始菜单→Kairo IDE→Uninstall 或 控制面板→卸载 | 卸载程序正常启动 | P0 |
| 25.2 | 确认卸载 | 确认卸载操作 | 开始卸载流程 | P0 |
| 25.3 | 文件删除 | 卸载完成后检查安装目录 | 程序文件被删除 | P0 |
| 25.4 | 快捷方式清理 | 检查桌面和开始菜单 | Kairo IDE快捷方式被移除 | P0 |

---

## 26. 进程安全与端口验证（§5补充）

| # | 测试项 | 操作步骤 | 预期结果 | 优先级 |
|---|--------|----------|----------|--------|
| 26.1 | **进程树验证** | 启动后打开任务管理器 | 存在Kairo IDE.exe（主进程）、kairo-runtime.exe（Go Agent）、node进程（Theia backend） | P0 |
| 26.2 | Agent端口绑定 | 用`netstat -ano`查看 | kairo-runtime.exe绑定127.0.0.1随机端口 | P0 |
| 26.3 | 端口仅限本地 | 检查监听地址 | Agent和Theia均只监听127.0.0.1，不暴露到外部网络 | P0 |
| 26.4 | 子进程清理 | 关闭Kairo IDE后检查任务管理器 | kairo-runtime.exe和node进程在5秒内终止 | P0 |
| 26.5 | DevTools默认关闭 | 正常启动exe（不设KAIRO_DEV=1） | DevTools不自动打开 | P0 |
| 26.6 | Toggle DevTools | Help→Toggle Developer Tools (Ctrl+Shift+I) | DevTools打开 | P1 |

---

## 27. 控制台全程错误监控（§54贯穿）

在执行上述所有测试操作时，需保持DevTools Console开启，检查以下操作后无Uncaught Exception/Error：

- [ ] 导入项目完整过程
- [ ] 构建过程（前端错误，后端编译错误除外）
- [ ] 启动/停止服务器
- [ ] 打开所有面板/视图
- [ ] 所有菜单点击
- [ ] 调试会话（命中断点、单步、停止）
- [ ] 所有对话框按钮点击
- [ ] SQL控制台连接/查询
- [ ] Search Everywhere搜索
- [ ] 关闭程序时

---

## 28. 测试优先级总览

### P0（Blocker，发布必须通过）— 约80项
- §1 安装流程核心步骤（1.1.1-1.1.18）
- §3 ZIP解压和便携运行
- §4 导入向导完整3步流程（4.1-4.18）
- §5 文件资源管理器基本操作
- §6 编辑器核心功能：GBK中文无乱码、语法高亮、编辑保存
- §7 查找替换基本操作
- §8 编码切换：GBK/UTF-8切换、中文恢复
- §9 全局搜索：结果跳转、GBK中文搜索
- §10 构建：Build/Clean、成功状态、历史记录
- §11 服务器生命周期：Start→Running→Open App→Stop
- §12 运行配置CRUD和运行
- §13 调试：设断点→Debug启动→命中→Continue/Step→Stop
- §14 工具栏按钮操作
- §15 状态栏状态更新
- §16 输出面板多通道、中文日志
- §17 终端基本命令
- §18 问题面板双击跳转
- §22 未保存关闭对话框
- §24 单实例锁二次启动验证
- §25 卸载核心流程
- §26 进程树、端口绑定、子进程清理

### P1（Critical）— 约40项
- §7 查找替换高级选项（区分大小写、正则）
- §13 调试面板操作（Variables/Call Stack/Breakpoints）
- §17 中文目录、java -version
- §19 Search Everywhere
- §20 SQL控制台（如有数据库环境）
- §21 通知中心
- §23 欢迎页细节
- 其他辅助功能验证

### P2（Normal）— 约15项
- 大文件测试、性能仪表板、远程开发、Java层次结构、Maven、书签等

---

## 29. 测试环境准备Checklist

在开始深度测试前，请确认：
- [ ] Windows 10/11 x64，屏幕缩放100%
- [ ] JDK 6已安装，JAVA_HOME已配置，`java -version`显示1.6.0_xx
- [ ] legacy-sample测试项目已解压到本地（含build.xml、GBK编码Java文件、JSP页面、中文注释）
- [ ] 无其他Kairo IDE实例运行
- [ ] `dist/win-unpacked\Kairo IDE.exe` 存在且已修复
- [ ] 防火墙允许本地端口通信
- [ ] DevTools可通过Help→Toggle Developer Tools打开（已修复）
- [ ] 日志目录 `%APPDATA%\Kairo IDE\logs` 可访问

---

## 30. 测试执行顺序建议

1. 先执行§26进程安全验证（确认基础环境正常）
2. §1 NSIS安装（全新环境）或直接用portable/已安装版本
3. §3 ZIP便携包测试
4. §24 单实例锁
5. §23 欢迎页面
6. **§4 导入向导完整流程**（核心）
7. §5+§6 资源管理器+编辑器（GBK中文验证优先）
8. §8 编码功能
9. §10 构建
10. **§11 服务器生命周期**（核心）
11. §16+§17 输出面板+终端
12. §12 运行配置
13. **§13 调试端到端**（核心）
14. §9+§7 全局搜索+查找替换
15. §14+§15 工具栏+状态栏
16. §18 问题面板
17. §19 Search Everywhere
18. §20 SQL控制台（如需要）
19. §21+§22 通知+对话框
20. §25 卸载程序
21. 全程§27控制台错误监控
