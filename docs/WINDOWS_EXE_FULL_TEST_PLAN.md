# Kairo IDE Windows EXE 版本全面测试计划

> **版本**: v0.1.0
> **测试平台**: Windows 10 x64 + JDK 6 + Tomcat 6
> **测试对象**: Kairo IDE Windows 安装包 (.exe NSIS安装程序 + .zip便携包)
> **测试方法**: 模拟人工点击 + UI自动化验证 (Playwright Electron) + 功能完整性验证
> **测试周期**: 全量测试约需 6-8 小时
> **编写日期**: 2026-07-26
> **代码分析深度**: 逐文件分析 55+ 个widget组件、100+ 个注册命令、38+ 个Kairo菜单、所有表单控件

---

## 目录

1. [测试环境准备](#1-测试环境准备)
2. [安装程序测试 (NSIS)](#2-安装程序测试-nsis)
3. [便携包测试 (ZIP)](#3-便携包测试-zip)
4. [启动与关闭测试](#4-启动与关闭测试)
5. [EXE进程与安全策略测试](#5-exe进程与安全策略测试)
6. [窗口基础功能测试](#6-窗口基础功能测试)
7. [活动栏(Activity Bar)图标测试](#7-活动栏activity-bar图标测试)
8. [菜单栏逐项测试](#8-菜单栏逐项测试)
9. [工具栏测试](#9-工具栏测试)
10. [状态栏逐项测试](#10-状态栏逐项测试)
11. [欢迎页面测试](#11-欢迎页面测试)
12. [项目导入向导测试 (3步)](#12-项目导入向导测试-3步)
13. [项目选择器测试](#13-项目选择器测试)
14. [文件资源管理器测试](#14-文件资源管理器测试)
15. [编辑器功能测试](#15-编辑器功能测试)
16. [编辑器查找替换测试 (Ctrl+F/H)](#16-编辑器查找替换测试-ctrlfh)
17. [编码功能测试](#17-编码功能测试)
18. [全局搜索面板测试 (Ctrl+Shift+F)](#18-全局搜索面板测试-ctrlshiftf)
19. [Search Everywhere 测试 (双击Shift)](#19-search-everywhere-测试-双击shift)
20. [构建视图测试](#20-构建视图测试)
21. [服务器视图测试](#21-服务器视图测试)
22. [部署视图测试](#22-部署视图测试)
23. [Tomcat日志查看器测试](#23-tomcat日志查看器测试)
24. [运行配置管理测试](#24-运行配置管理测试)
25. [调试功能测试](#25-调试功能测试)
26. [调试面板子组件测试](#26-调试面板子组件测试)
27. [断点高级功能测试 (条件/命中次数/日志点)](#27-断点高级功能测试-条件命中次数日志点)
28. [Maven视图测试](#28-maven视图测试)
29. [SQL控制台测试 (详细)](#29-sql控制台测试-详细)
30. [测试结果视图测试](#30-测试结果视图测试)
31. [TODO/FIXME视图测试](#31-todofixme视图测试)
32. [问题面板测试](#32-问题面板测试)
33. [输出面板测试](#33-输出面板测试)
34. [终端测试](#34-终端测试)
35. [Git集成测试](#35-git集成测试)
36. [SVN集成测试](#36-svn集成测试)
37. [本地历史测试](#37-本地历史测试)
38. [书签功能测试](#38-书签功能测试)
39. [快捷键速查表测试](#39-快捷键速查表测试)
40. [键盘映射配置测试 (Keymap)](#40-键盘映射配置测试-keymap)
41. [性能仪表板测试](#41-性能仪表板测试)
42. [远程开发面板测试 (详细)](#42-远程开发面板测试-详细)
43. [Java层次结构视图测试](#43-java层次结构视图测试)
44. [通知中心测试](#44-通知中心测试)
45. [设置与首选项测试](#45-设置与首选项测试)
46. [命令面板测试 (Ctrl+Shift+P)](#46-命令面板测试-ctrlshiftp)
47. [焦点导航命令测试](#47-焦点导航命令测试)
48. [对话框与确认框测试](#48-对话框与确认框测试)
49. [大文件处理测试](#49-大文件处理测试)
50. [无障碍访问测试](#50-无障碍访问测试)
51. [多实例与单实例锁测试](#51-多实例与单实例锁测试)
52. [文件关联与外部链接测试](#52-文件关联与外部链接测试)
53. [卸载程序测试](#53-卸载程序测试)
54. [控制台错误监控](#54-控制台错误监控)
55. [EXE日志文件检查](#55-exe日志文件检查)
56. [自动化测试脚本 (Playwright Electron)](#56-自动化测试脚本-playwright-electron)
57. [全量交互元素清单 (Checklist)](#57-全量交互元素清单-checklist)
58. [缺陷报告模板](#58-缺陷报告模板)

---

## 1. 测试环境准备

### 1.1 硬件要求
| 项目 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 双核 2.0GHz | 四核 3.0GHz+ |
| 内存 | 4GB | 8GB+ |
| 磁盘 | 2GB可用空间 | 5GB+可用空间 |
| 显示器 | 1280x768 | 1920x1080+ |

### 1.2 软件要求
- **操作系统**: Windows 10 专业版/企业版 x64 (版本 1903 或更高)
- **JDK**: JDK 1.6.0_45 (必须配置 JAVA_HOME)
- **Tomcat**: Apache Tomcat 6.0.53 (内置捆绑，无需单独安装)
- **测试项目**: legacy-sample 项目 (包含 build.xml、JSP、Servlet、GBK编码文件)
- **可选**: Git for Windows、SVN 命令行客户端

### 1.3 测试前置检查清单
- [ ] Windows 10 x64 已激活
- [ ] JDK 6 已安装，JAVA_HOME 环境变量已设置
- [ ] `java -version` 输出显示 1.6.0_xx
- [ ] 无其他 Kairo IDE 实例正在运行
- [ ] 防火墙允许 Kairo IDE 本地端口通信
- [ ] 测试项目 legacy-sample 已解压到本地磁盘
- [ ] 准备好测试用的中文路径目录 (用于编码测试)
- [ ] 屏幕缩放设置为 100% (避免DPI问题)

---

## 2. 安装程序测试 (NSIS)

> **安装包**: Kairo IDE-x.y.z-win-x64.exe
> **预计时间**: 10分钟

### 2.1 安装程序启动
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 安装程序图标验证 | 双击安装包 .exe 文件 | 显示 Kairo IDE 图标，安装程序正常启动 | P0 | |
| UAC 提示验证 | 启动安装程序 | 不弹出管理员权限请求 (requestedExecutionLevel=asInvoker) | P0 | |
| 欢迎界面 | 安装程序启动后 | 显示 "Welcome to Kairo IDE Setup" 欢迎界面 | P0 | |
| 许可协议页面 | 点击"下一步" | 显示 Apache 2.0 许可协议，有"我接受"/"我不接受"单选 | P0 | |
| 许可协议必须接受 | 选择"我不接受协议" | "下一步"按钮禁用 | P1 | |
| 安装目录选择 | 接受协议后点击"下一步" | 显示安装目录选择页面，默认为 `%LOCALAPPDATA%\Programs\Kairo IDE` | P0 | |
| 自定义安装目录 | 点击"浏览"选择其他目录 (如 `D:\Dev\KairoIDE`) | 可以成功更改安装路径 | P0 | |
| 中文路径安装 | 选择包含中文的安装路径 (如 `D:\开发工具\Kairo`) | 安装成功，无乱码 | P0 | |
| 空格路径安装 | 选择包含空格的路径 (如 `D:\Program Files\Kairo`) | 安装成功，运行正常 | P1 | |

### 2.2 组件选择
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 组件选择页面 | 进入组件选择步骤 | 显示核心组件 (必选)、JDT LS、Tomcat 6 等选项 | P1 | |
| 桌面快捷方式选项 | 查看选项 | 有"创建桌面快捷方式"复选框，默认勾选 | P0 | |
| 开始菜单快捷方式 | 查看选项 | 有"创建开始菜单文件夹"选项 | P0 | |

### 2.3 安装过程
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 安装进度条 | 点击"安装"开始安装 | 显示进度条，进度从 0% 到 100% | P0 | |
| 文件提取验证 | 安装过程中检查安装目录 | 所有文件正确提取，包含 kairo-runtime.exe、jdtls、tomcat6 | P0 | |
| 无错误对话框 | 等待安装完成 | 不出现任何错误对话框 | P0 | |
| 安装完成页面 | 安装结束 | 显示"Completing Kairo IDE Setup"页面 | P0 | |
| 运行Kairo选项 | 查看完成页面 | 有"Run Kairo IDE"复选框 | P1 | |

### 2.4 安装后验证
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 桌面快捷方式 | 检查桌面 | 存在 "Kairo IDE" 快捷方式，图标正确 | P0 | |
| 开始菜单项 | 打开开始菜单 | 存在 Kairo IDE 程序组，包含启动和卸载项 | P0 | |
| 可执行文件存在 | 浏览安装目录 | 存在 `Kairo IDE.exe` 可执行文件 | P0 | |
| 内置资源验证 | 检查安装目录 | `resources/bundled/` 下存在 jdtls、tomcat6 文件夹 | P0 | |
| Go Agent存在 | 检查 resources/bin/ | 存在 kairo-runtime.exe 二进制文件 | P0 | |
| 文件权限检查 | 右键exe→属性 | 文件无"被阻止"提示 (Windows安全警告) | P1 | |

---

## 3. 便携包测试 (ZIP)

> **便携包**: Kairo IDE-x.y.z-win-x64.zip
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| ZIP解压测试 | 解压zip文件到任意目录 | 解压成功，无CRC错误 | P0 | |
| 目录结构验证 | 查看解压后目录 | 包含 Kairo IDE.exe、resources/ 等完整结构 | P0 | |
| 便携运行测试 | 双击 Kairo IDE.exe | 程序正常启动，不写入系统目录 | P1 | |
| 移动目录测试 | 将整个目录移动到其他位置 | 移动后仍可正常运行 | P2 | |

---

## 4. 启动与关闭测试

> **预计时间**: 15分钟

### 4.1 启动测试
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 桌面快捷方式启动 | 双击桌面 Kairo IDE 快捷方式 | 程序启动，显示加载界面 | P0 | |
| 开始菜单启动 | 从开始菜单点击 Kairo IDE | 程序正常启动 | P0 | |
| exe直接启动 | 双击安装目录下的 Kairo IDE.exe | 程序正常启动 | P0 | |
| 启动画面/窗口 | 观察启动过程 | 主窗口显示，标题为 "Kairo IDE" | P0 | |
| 窗口初始尺寸 | 启动后检查窗口大小 | 窗口尺寸约为 1280x800 (或上次关闭时的尺寸) | P1 | |
| 窗口最小尺寸 | 尝试缩小窗口 | 最小尺寸限制为 960x600，无法更小 | P1 | |
| 背景色验证 | 检查窗口背景 | 深色主题背景色 #1e1f22 | P2 | |
| 启动无错误 | 观察启动过程 | 不弹出错误对话框 | P0 | |
| Agent健康检查 | 启动后等待5秒 | 状态栏 Agent 显示"已连接" | P0 | |
| 冷启动时间 | 从双击到主界面完全可用 | 冷启动时间 < 30秒 (SSD) | P1 | |

### 4.2 首次启动特殊流程
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 欢迎页面自动打开 | 首次启动 (无最近项目) | 自动显示 Welcome 欢迎标签页 | P0 | |
| 首次启动导入提示 | 首次启动无项目 | 显示"Welcome to Kairo IDE!"提示，0.5秒后自动打开导入向导 | P1 | |
| 导入向导自动弹出 | 等待自动弹出 | 弹出"Import Legacy Java Project"向导 | P1 | |

### 4.3 关闭测试
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 窗口关闭按钮 | 点击窗口右上角 X 按钮 | 程序开始关闭流程 | P0 | |
| 关闭时子进程清理 | 关闭过程中检查任务管理器 | kairo-runtime.exe 进程在5秒内终止 | P0 | |
| 优雅关闭验证 | 等待程序完全退出 | 不残留任何 Kairo 相关进程 | P0 | |
| 任务栏图标消失 | 程序关闭后 | 任务栏图标消失 | P0 | |
| 系统托盘无残留 | 检查系统托盘 | 无 Kairo IDE 托盘图标残留 | P1 | |
| Alt+F4 关闭 | 按 Alt+F4 快捷键 | 程序正常关闭 | P0 | |

### 4.4 多实例测试
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 单实例锁验证 | 已运行时再次双击快捷方式 | 不启动第二个实例，已有窗口被激活/恢复 | P0 | |
| 最小化后激活 | 最小化窗口后再次启动 | 窗口恢复并前置显示 | P1 | |

---

## 5. EXE进程与安全策略测试

> **预计时间**: 10分钟
> **说明**: 以下测试项针对Electron打包后的exe程序特有行为

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 进程树验证 | 启动后打开任务管理器 | 存在 Kairo IDE.exe (主进程)、多个子进程(node/kairo-runtime.exe) | P0 | |
| 子进程数量 | 启动稳定后 | 主进程 + kairo-runtime.exe (Go Agent) + Theia backend (node) | P0 | |
| Agent端口绑定 | 用netstat查看 | kairo-runtime.exe绑定127.0.0.1随机端口 | P0 | |
| 端口仅限本地 | 检查监听地址 | Agent和Theia均只监听127.0.0.1，不暴露到外部网络 | P0 | |
| 启动失败错误对话框 | 制造启动失败条件(如端口被占) | 弹出"Kairo IDE Error"对话框，显示错误信息 | P1 | |
| 错误对话框内容 | 查看错误对话框 | 包含"Failed to start Kairo IDE:"和具体错误原因 | P1 | |
| CSP策略验证 | DevTools中检查response headers | 生产版本无`unsafe-eval`，脚本只能从self加载 | P1 | |
| contextIsolation验证 | DevTools中检查 | contextIsolation=true，nodeIntegration=false，sandbox=true | P1 | |
| 外部链接行为 | 点击Open App按钮 | 链接在系统默认浏览器(Chrome/Edge)打开，不在IDE内打开 | P0 | |
| 非http协议拒绝 | 尝试通过程序打开file://等链接 | 拒绝打开非http/https协议链接 | P1 | |
| 窗口标题强制 | 检查窗口标题 | 无论页面如何设置，标题始终为"Kairo IDE" | P0 | |
| DevTools默认关闭 | 正常启动exe(非dev模式) | DevTools不自动打开 | P0 | |
| KAIRO_DEV=1打开DevTools | 设置KAIRO_DEV=1环境变量启动 | DevTools自动打开 | P2 | |
| 窗口背景色 | 启动加载过程中 | 窗口背景色为#1e1f22(深色主题) | P1 | |

---

## 6. 窗口基础功能测试

> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 窗口标题验证 | 查看窗口标题栏 | 始终显示 "Kairo IDE" (不被Eclipse Theia默认标题覆盖) | P0 | |
| 最大化/还原 | 点击最大化按钮 | 窗口最大化，再次点击还原 | P0 | |
| 最小化 | 点击最小化按钮 | 窗口最小化到任务栏 | P0 | |
| 窗口拖拽 | 按住标题栏拖动窗口 | 窗口可以自由拖动 | P0 | |
| 边框拖拽调整大小 | 拖动窗口边框 | 窗口可以调整大小 | P0 | |
| 菜单栏可见 | 检查窗口顶部 | 显示完整菜单栏 (File/Edit/Selection/View/Go/Run/Terminal/Kairo/Help) | P0 | |
| 活动栏可见 | 检查窗口最左侧 | 显示活动栏图标 (资源管理器/搜索/SCM/调试/扩展等) | P0 | |
| 侧边栏可见 | 检查活动栏右侧 | 侧边栏面板可见 (默认为资源管理器) | P0 | |
| 主编辑区 | 检查中间区域 | 主编辑区域可见 (欢迎页或空白) | P0 | |
| 底部面板 | 检查窗口底部 | 底部面板区域 (问题/输出/终端/调试控制台) | P0 | |
| 状态栏可见 | 检查窗口最底部 | 状态栏可见，显示各项状态信息 | P0 | |

---

## 7. 活动栏(Activity Bar)图标测试

> **位置**: 窗口最左侧垂直图标栏
> **预计时间**: 5分钟

| 图标 | 位置顺序 | 点击预期结果 | 快捷键 | 优先级 | 测试结果 |
|------|----------|--------------|--------|--------|----------|
| Explorer (文件资源管理器) | 第1个(最上) | 切换侧边栏到资源管理器 | Ctrl+Shift+E | P0 | |
| Search (搜索) | 第2个 | 切换侧边栏到全局搜索面板 | Ctrl+Shift+F | P0 | |
| SCM (源代码管理) | 第3个 | 切换到Git/SCM面板 | Ctrl+Shift+G | P1 | |
| Run and Debug (运行调试) | 第4个 | 切换到调试视图 | Ctrl+Shift+D | P0 | |
| Extensions (扩展) | 第5个 | 切换到扩展面板 | Ctrl+Shift+X | P2 | |
| Kairo Servers | Kairo区域 | 打开Servers服务器视图(左侧栏) | - | P0 | |
| Kairo Builds | Kairo区域 | 打开Builds构建视图(左侧栏) | - | P0 | |
| Kairo Deployments | Kairo区域 | 打开Deployments部署视图(左侧栏) | - | P0 | |
| Kairo Maven | Kairo区域 | 打开Maven视图(左侧栏) | - | P1 | |
| Kairo TODO | Kairo区域 | 打开TODO/FIXME视图(左侧栏) | - | P2 | |
| 图标tooltip | 鼠标悬停 | 显示视图名称和快捷键 | - | P2 | |
| 活动图标高亮 | 当前激活的视图 | 对应图标高亮显示(白色/边框) | - | P1 | |
| 视图Badge | 有问题/变更时 | SCM图标显示变更数Badge | - | P2 | |

---

## 8. 菜单栏逐项测试

> **预计时间**: 30分钟
> **重要提示**: 每个菜单项都必须点击验证，确保无"Command not found"错误

### 6.1 File 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| New File... | Ctrl+N | 弹出新建文件对话框/在当前目录创建untitled文件 | P0 | |
| New Folder... | - | 弹出新建文件夹输入框 | P1 | |
| Open File... | Ctrl+O | 显示文件打开对话框 | P0 | |
| Open Folder... | Ctrl+K Ctrl+O | 显示文件夹选择对话框 | P0 | |
| Open Workspace... | - | 显示工作区打开对话框 | P1 | |
| Open Recent → | - | 展开最近打开的文件/文件夹列表 | P1 | |
| Import Kairo Project... | - | 打开 Kairo 项目导入向导 (Step 1) | P0 | |
| Select Kairo Project... | - | 打开项目选择器 | P0 | |
| Run Configurations... | - | 打开运行配置管理面板 | P0 | |
| Save | Ctrl+S | 保存当前编辑器文件 | P0 | |
| Save As... | Ctrl+Shift+S | 弹出另存为对话框 | P1 | |
| Save All | Ctrl+K S | 保存所有已修改文件 | P0 | |
| Auto Save | - | 自动保存开关切换 (勾选/取消) | P1 | |
| Revert File | - | 还原文件到上次保存状态 | P2 | |
| Close Tab | Ctrl+W | 关闭当前标签页 | P1 | |
| Close Window | Ctrl+Shift+W | 关闭窗口 | P1 | |
| Exit | - | 退出程序 | P1 | |

### 6.2 Edit 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| Undo | Ctrl+Z | 撤销上一步编辑操作 | P0 | |
| Redo | Ctrl+Y / Ctrl+Shift+Z | 重做已撤销的操作 | P0 | |
| Cut | Ctrl+X | 剪切选中内容 | P0 | |
| Copy | Ctrl+C | 复制选中内容 | P0 | |
| Paste | Ctrl+V | 粘贴内容 | P0 | |
| Select All | Ctrl+A | 全选编辑器内容 | P1 | |
| Find | Ctrl+F | 打开编辑器内查找框 | P0 | |
| Replace | Ctrl+H | 打开查找替换框 | P0 | |
| Find in Files | Ctrl+Shift+F | 打开全局搜索面板 | P0 | |
| Replace in Files | Ctrl+Shift+H | 打开全局替换面板 | P0 | |
| Toggle Line Comment | Ctrl+/ | 切换行注释 | P1 | |
| Toggle Block Comment | Shift+Alt+A | 切换块注释 | P1 | |

### 6.3 Selection 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| Select All | Ctrl+A | 全选 | P1 | |
| Expand Selection | Shift+Alt+Right | 扩大选择范围 | P2 | |
| Shrink Selection | Shift+Alt+Left | 缩小选择范围 | P2 | |
| Add Cursor Above | Ctrl+Alt+Up | 向上添加光标 | P2 | |
| Add Cursor Below | Ctrl+Alt+Down | 向下添加光标 | P2 | |
| Go to Bracket | Ctrl+Shift+\ | 跳转到匹配括号 | P2 | |

### 6.4 View 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| Command Palette... | Ctrl+Shift+P | 打开命令面板 | P0 | |
| Explorer | Ctrl+Shift+E | 切换到资源管理器视图 | P0 | |
| Search | Ctrl+Shift+F | 切换到搜索视图 | P0 | |
| SCM (Git) | Ctrl+Shift+G | 切换到源代码管理视图 (如Git已启用) | P1 | |
| Debug | Ctrl+Shift+D | 切换到调试视图 | P0 | |
| Extensions | Ctrl+Shift+X | 切换到扩展视图 | P2 | |
| Problems | Ctrl+Shift+M | 打开问题面板 | P0 | |
| Output | Ctrl+Shift+U | 打开输出面板 | P1 | |
| Terminal | Ctrl+` | 切换终端面板 | P0 | |
| Debug Console | - | 切换调试控制台 | P1 | |
| Toggle Full Screen | F11 | 切换全屏模式 | P1 | |
| Zoom In | Ctrl+= | 放大界面 | P2 | |
| Zoom Out | Ctrl+- | 缩小界面 | P2 | |
| Reset Zoom | Ctrl+0 | 重置缩放 | P2 | |

### 6.5 Go 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| Go to File... | Ctrl+P | 打开快速文件打开框 | P0 | |
| Go to Symbol in Editor... | Ctrl+Shift+O | 转到编辑器符号 | P1 | |
| Go to Symbol in Workspace... | Ctrl+T | 转到工作区符号 | P1 | |
| Go to Line... | Ctrl+G | 打开跳转到行输入框 | P1 | |
| Go to Definition | F12 | 跳转到定义 (Java代码需要JDT LS就绪) | P1 | |
| Go to References | Shift+F12 | 查找所有引用 | P1 | |
| Go Back | Alt+Left | 返回上一位置 | P1 | |
| Go Forward | Alt+Right | 前进到下一位置 | P1 | |

### 6.6 Run 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| Start Debugging | F5 | 启动调试 | P0 | |
| Start Without Debugging | Ctrl+F5 | 不调试启动 | P0 | |
| Stop Debugging | Shift+F5 | 停止调试 | P0 | |
| Restart Debugging | Ctrl+Shift+F5 | 重启调试 | P1 | |
| Step Over | F10 | 单步跳过 | P1 | |
| Step Into | F11 | 单步进入 | P1 | |
| Step Out | Shift+F11 | 单步跳出 | P1 | |
| Continue | F5 | 继续执行 | P1 | |
| Toggle Breakpoint | F9 | 切换断点 | P0 | |
| New Breakpoint → | - | 新建断点子菜单 | P1 | |

### 6.7 Terminal 菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| New Terminal | Ctrl+Shift+` | 新建终端 | P0 | |
| Split Terminal | - | 拆分终端 | P2 | |
| Kill Terminal | - | 终止当前终端 | P1 | |

### 6.8 ★ Kairo 菜单 (核心特色菜单)
> **这是Kairo IDE的核心功能菜单，必须100%测试覆盖**

#### 6.8.1 项目操作
| 菜单项 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|----------------|--------|----------|
| Import Kairo Project... | 打开3步项目导入向导 | P0 | |
| Select Kairo Project... | 打开项目选择器对话框 | P0 | |
| Scan Workspace | 扫描当前工作区，显示"Scanned [path]"提示 | P0 | |
| Run Configurations... | 打开运行配置管理面板 | P0 | |

#### 6.8.2 Build & Run 子菜单
| 菜单项 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|----------------|--------|----------|
| → Build | 触发项目构建，构建面板显示进度，成功/失败通知 | P0 | |
| → Clean Build | 触发Clean构建，先清理再编译 | P0 | |
| → Build && Deploy | 构建并自动部署到Tomcat | P0 | |
| → Start Server | 启动Tomcat服务器，服务器状态变为running | P0 | |
| → Start Server (Debug) | 以调试模式启动Tomcat，开启JDWP端口 | P0 | |
| → Stop Server | 停止运行中的Tomcat服务器 | P0 | |
| → Restart Server | 重启Tomcat服务器 | P0 | |
| → Open Application | 在系统默认浏览器打开 http://127.0.0.1:xxxx | P0 | |
| → Check Java Debug Adapter | 检查调试适配器状态，显示可用/不可用信息 | P1 | |

#### 6.8.3 View 子菜单
| 菜单项 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|----------------|--------|----------|
| → Servers | 在左侧栏打开 Servers 服务器视图 | P0 | |
| → Builds | 在左侧栏打开 Builds 构建视图 | P0 | |
| → Deployments | 在左侧栏打开 Deployments 部署视图 | P0 | |
| → Tomcat Logs | 在主区域打开 Server Logs 日志面板 | P0 | |
| → Maven | 在左侧栏打开 Maven 视图 | P1 | |
| → TODO / FIXME | 在左侧栏打开 TODO/FIXME 视图 | P2 | |
| → Test Results | 在主区域打开测试结果视图 | P1 | |
| → SQL Console | 在主区域打开 SQL 控制台 | P1 | |
| → Remote Development | 在主区域打开远程开发面板 | P2 | |
| → Performance Dashboard | 在主区域打开性能仪表板 | P2 | |

#### 6.8.4 Debug 子菜单
| 菜单项 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|----------------|--------|----------|
| → Open Debug View | 打开/切换到调试视图 | P0 | |
| → Open Debug Console | 打开调试控制台 | P0 | |
| → Variables | 打开调试变量面板 | P1 | |
| → Call Stack | 打开调用栈面板 | P1 | |
| → Breakpoints | 打开断点列表面板 | P1 | |
| → Watch | 打开监视表达式面板 | P1 | |
| → Debug Toolbar | 显示调试工具栏 | P1 | |
| → Debug Diagnostics | 打开调试诊断面板 | P1 | |

#### 6.8.5 Window 子菜单
| 菜单项 | 快捷键 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|--------|----------------|--------|----------|
| → Toggle Terminal | Alt+F12 | 切换终端面板显示/隐藏 | P0 | |
| → Keyboard Shortcuts | - | 打开键盘快捷键配置面板 | P1 | |
| → Switch JDK | - | 打开项目选择器 (用于切换JDK) | P1 | |
| → Reconnect Runtime Agent | - | 断开并重连Runtime Agent，状态栏显示重连状态 | P1 | |

### 6.9 Help 菜单
| 菜单项 | 点击后预期结果 | 优先级 | 测试结果 |
|--------|----------------|--------|----------|
| About | 显示关于对话框，包含版本号 | P2 | |
| Documentation | 打开文档链接 (外部浏览器) | P2 | |
| Report Issues | 打开问题反馈链接 | P2 | |
| Debug Diagnostics | 打开调试诊断面板 | P1 | |
| Toggle Developer Tools | Ctrl+Shift+I | 打开Chrome开发者工具 (仅非打包时默认打开) | P1 | |

### 6.10 菜单测试通用验证
- [ ] 每个菜单项点击后不出现 JavaScript 错误
- [ ] 每个菜单项点击后不出现 "No command X exists" 错误提示
- [ ] 菜单项在不可用状态时正确置灰 (如无项目时Build按钮禁用)
- [ ] 复选菜单项的勾选状态正确同步
- [ ] 菜单项快捷键提示正确显示

---

## 9. 工具栏测试

> **位置**: 窗口顶部，标题栏下方
> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 工具栏可见 | 启动后观察窗口顶部 | Kairo工具栏可见 | P0 | |
| Project下拉框 | 查看第一个下拉框 | 显示"Project"标签和项目选择下拉框 | P0 | |
| 无项目时显示 | 未导入项目时 | 下拉框显示"No projects"，禁用状态 | P1 | |
| 项目选择切换 | 导入项目后点击下拉框 | 列出所有已导入项目，可以切换活动项目 | P0 | |
| Run Config下拉框 | 查看第二个下拉框 | 显示"Run Config"标签和运行配置选择 | P0 | |
| 无配置时显示 | 无运行配置时 | 显示"No configurations"，禁用状态 | P1 | |
| 运行配置切换 | 创建配置后点击下拉框 | 列出所有运行配置，可切换默认配置 | P0 | |
| ▶ Run按钮 | 点击Run按钮 | 触发启动服务器流程，按钮显示"Running..."状态 | P0 | |
| Run按钮禁用条件 | 服务器已运行/无配置时 | Run按钮正确禁用 | P1 | |
| ● Debug按钮 | 点击Debug按钮 | 以调试模式启动服务器 | P0 | |
| Debug按钮禁用条件 | 服务器运行中/配置模式非debug时 | Debug按钮正确禁用 | P1 | |
| ■ Stop按钮 | 服务器运行时点击Stop | 停止服务器，按钮显示"Stopping..." | P0 | |
| Stop按钮禁用条件 | 无运行中服务器时 | Stop按钮禁用 | P1 | |
| ⚙ Build按钮 | 点击Build按钮 | 触发项目构建 | P0 | |
| Build按钮忙碌状态 | 构建过程中 | 按钮显示"Building..."并禁用 | P1 | |
| 工具栏按钮快捷键提示 | 鼠标悬停在按钮上 | 显示tooltip，包含快捷键提示 | P2 | |

---

## 10. 状态栏逐项测试

> **位置**: 窗口最底部，从左到右共7个状态项
> **每个状态项都可点击，必须逐个点击验证**
> **预计时间**: 15分钟

| 状态项 | 位置 | 默认显示 | 点击预期结果 | 优先级 | 测试结果 |
|--------|------|----------|--------------|--------|----------|
| Project | 最左侧 | $(file-directory) Project: (no workspace) | 打开项目选择器 (Select Kairo Project) | P0 | |
| JDK | Project右侧 | $(code) JDK: - | 打开JDK切换/项目选择器 | P0 | |
| Encoding | JDK右侧 | $(text) Encoding: - | 弹出编码重新打开菜单 | P0 | |
| Build | Encoding右侧 | $(gear) Build: - | 打开Builds构建视图 | P0 | |
| Server | Build右侧 | $(server-process) Server: stopped | 打开Servers服务器视图 | P0 | |
| Debug | Server右侧 | 调试状态图标和文字 | 打开调试视图 | P0 | |
| Agent | Debug右侧 | $(pulse) Agent: 连接中/已连接/已断开 | 重新连接Runtime Agent | P0 | |

### 8.1 状态栏状态验证
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Agent连接状态 | 启动后等待 | Agent项显示"Agent: 已连接"，图标为puse | P0 | |
| Agent断开指示 | Agent断开连接时 | 显示"Agent: 已断开"，图标为error，红色提示 | P1 | |
| Agent重连点击 | 点击Agent状态项 | 触发重连，显示连接中动画 | P1 | |
| 项目状态更新 | 导入项目后 | Project项显示项目名称 | P0 | |
| JDK状态更新 | JDT LS启动后 | JDK项显示检测到的JDK版本 (如1.6) | P0 | |
| 编码状态更新 | 打开Java/JSP文件后 | Encoding项显示文件编码 (GBK/UTF-8) | P0 | |
| 编码星号标记 | 非UTF-8编码时 | 编码后显示 * 号表示覆盖 | P1 | |
| Build状态更新 | 执行构建后 | Build项显示构建结果 (succeeded/failed/running) | P0 | |
| Build运行动画 | 构建进行中 | 图标显示sync~spin旋转动画 | P1 | |
| Server状态更新 | 启动Tomcat后 | Server项显示"Server: running :xxxx" | P0 | |
| Server启动动画 | 服务器启动中 | 图标显示旋转动画 | P1 | |
| Server JDWP端口 | Debug模式启动时 | 显示"JDWP:xxxx"调试端口 | P0 | |
| Debug状态更新 | 调试连接后 | Debug项显示connected状态 | P0 | |
| 状态栏tooltip | 鼠标悬停每个状态项 | 显示详细的tooltip提示信息 | P1 | |
| 状态栏项可点击 | 点击每个状态项 | 正确触发对应命令，无错误 | P0 | |

---

## 11. 欢迎页面测试

> **预计时间**: 10分钟
> **触发条件**: 首次启动或关闭所有项目后显示

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 欢迎页面标题 | 查看Welcome标签 | 显示"Kairo IDE"大标题 | P0 | |
| 欢迎页面副标题 | 查看标题下方 | 显示"Import, build, deploy and run legacy Java Web projects..." | P1 | |
| New Project...按钮 | 点击主按钮"New Project..." | 打开项目导入向导 | P0 | |
| Open Project...按钮 | 点击"Open Project..." | 打开项目选择器 | P0 | |
| Open Workspace Folder...按钮 | 点击"Open Workspace Folder..." | 弹出文件夹选择对话框 | P0 | |
| 主按钮样式 | 查看"New Project..."按钮 | 为主按钮样式 (实心theia-button)，其他为secondary样式 | P2 | |
| Recent Projects区域 | 查看下方 | 如果有最近项目，显示"Recent Projects"列表 | P1 | |
| 最近项目点击 | 点击一个最近项目项 | 打开该项目的工作区 | P1 | |
| Quick Start Guide区域 | 查看快速开始 | 显示3步快速入门: Import → Configure → Build & Run | P1 | |
| 快速步骤1-Import按钮 | 点击步骤1的按钮 | 打开导入向导 | P1 | |
| 快速步骤2-Run Config按钮 | 点击步骤2的按钮 | 打开运行配置面板 | P1 | |
| 快速步骤3-Build&Run按钮 | 点击步骤3的按钮 | 触发构建并部署 | P1 | |
| 命令面板提示文字 | 查看底部提示 | 显示"All actions are also available in command palette (Ctrl+Shift+P)" | P2 | |
| 欢迎页标签关闭 | 导入项目后 | Welcome标签自动关闭 | P0 | |
| 手动关闭Welcome | 点击标签页X | Welcome标签可以手动关闭 | P1 | |

---

## 12. 项目导入向导测试 (3步)

> **触发**: Kairo菜单 → Import Kairo Project...
> **预计时间**: 20分钟
> **重要**: 这是用户使用的第一个核心功能，必须完整测试所有表单元素

### 10.1 Step 1: Select Directory
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 向导标题 | 打开导入向导 | 标题为"Import Legacy Java Project"，副标题"Auto-detect and configure your project" | P0 | |
| 步骤指示器 | 查看顶部步骤条 | 3个步骤: 1.Select Directory, 2.Confirm Settings, 3.Complete | P0 | |
| 当前步骤高亮 | Step 1激活时 | Step 1高亮显示，标记为active | P0 | |
| 欢迎提示 | 查看左侧/顶部提示 | 显示欢迎信息和自动检测特性列表 | P1 | |
| 路径输入框可见 | 查看页面 | 路径输入框存在，placeholder为"/absolute/path/to/project" | P0 | |
| 路径输入 | 在输入框中手动输入项目路径 (如legacy-sample路径) | 输入框接受文本输入 | P0 | |
| Browse...按钮 | 点击"Browse..."按钮 | 弹出文件夹选择对话框 | P0 | |
| 文件夹对话框选择 | 在对话框中选择legacy-sample目录 | 选择后路径填入输入框 | P0 | |
| Scan按钮 | 点击"Scan"按钮 | 按钮显示"Scanning..."禁用状态，开始扫描 | P0 | |
| Enter键触发扫描 | 输入路径后按Enter | 触发扫描，等同于点击Scan按钮 | P1 | |
| 扫描中状态 | 扫描过程中 | 显示加载/扫描中状态 | P0 | |
| 扫描成功 | 扫描legacy-sample项目 | 自动跳转到Step 2，填充检测到的配置 | P0 | |
| 扫描错误处理 | 输入不存在的路径后点击Scan | 显示红色错误提示信息，停留在Step 1 | P0 | |
| 空路径错误 | 不输入路径直接点击Scan | 显示"Please enter a project path"错误 | P1 | |
| Selected path显示 | 选择路径后 | 显示"Selected: [path]"已选路径 | P1 | |

### 10.2 Step 2: Confirm Settings
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 步骤2激活 | 扫描成功后进入Step 2 | Step 2变为active，Step 1保持已完成状态 | P0 | |
| 检测置信度显示 | 查看页面 | 显示"Detection confidence: XX%" | P0 | |
| 警告数量提示 | 如有检测警告 | 显示"(N warnings)"警告数量 | P1 | |
| Project Name输入框 | 查看表单 | 项目名称输入框，预填充为目录名 | P0 | |
| 项目名称修改 | 修改Project Name为自定义名称 | 可以修改输入内容 | P0 | |
| 空项目名验证 | 清空项目名称后点击Import | 显示"Project name cannot be empty"错误 | P1 | |
| Source Directories输入框 | 查看表单 | 源码目录输入框，预填充检测到的src目录 | P0 | |
| Web Root输入框 | 查看表单 | WebRoot目录输入框，预填充"WebRoot" | P0 | |
| Library Directories输入框 | 查看表单 | lib目录输入框，预填充"lib" | P0 | |
| Encoding下拉选择框 | 查看编码选择 | 下拉框包含UTF-8/GBK/GB18030/ISO-8859-1选项 | P0 | |
| Encoding默认值 | legacy-sample项目 | 默认选中GBK (根据检测结果) | P0 | |
| Encoding选择切换 | 切换Encoding为UTF-8 | 可以成功切换选项 | P1 | |
| JDK Version输入框 | 查看JDK版本框 | 预填充检测到的JDK版本 (1.6) | P0 | |
| Source Version下拉框 | 查看源码版本选择 | 下拉框包含1.5/1.6/1.7/1.8选项 | P0 | |
| Source Version默认 | legacy-sample | 默认选中1.6 | P0 | |
| Target Version下拉框 | 查看目标版本选择 | 下拉框包含1.5/1.6/1.7/1.8选项 | P0 | |
| Output Directory输入框 | 查看输出目录 | 预填充"build/classes" | P0 | |
| Build Tool下拉框 | 查看构建工具选择 | 下拉框包含Ant和javac (direct)两个选项 | P0 | |
| Build Tool默认 | 有build.xml时 | 默认选中Ant | P0 | |
| Build Script输入框 | 查看构建脚本 | 预填充"build.xml" | P0 | |
| Context Path输入框 | 查看上下文路径 | 预填充"/" | P0 | |
| 警告列表显示 | 检测有警告时 | 显示Warnings区域，列出每条警告 | P1 | |
| Back按钮 | 点击"Back"按钮 | 返回Step 1，已输入内容保留 | P0 | |
| Back后重新扫描 | 返回Step 1后选择其他目录扫描 | 可以重新扫描并进入Step 2 | P1 | |
| Import Project按钮 | 点击"Import Project" | 按钮显示"Importing..."并禁用 | P0 | |
| 导入错误处理 | 如有错误 (如无workspaceId) | 显示红色错误提示，停留在Step 2 | P0 | |
| 导入成功 | 导入成功后 | 自动跳转到Step 3 Complete | P0 | |

### 10.3 Step 3: Complete
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 完成页面标题 | 导入成功后 | 显示"Project [name] imported successfully" | P0 | |
| Location信息 | 查看信息列表 | 显示项目根目录路径 | P0 | |
| Encoding信息 | 查看信息列表 | 显示项目编码 (GBK) | P0 | |
| 配置文件提示 | 查看提示文字 | 说明配置保存在.kairo/project.json | P1 | |
| Open Project Folder按钮 | 点击"Open Project Folder"按钮 | 关闭向导，工作区显示项目文件 | P0 | |
| Close按钮 | 点击"Close"按钮 | 关闭导入向导窗口 | P0 | |
| 向导关闭后状态 | 导入完成后 | 状态栏Project项更新为新项目名称，欢迎页关闭 | P0 | |

### 10.4 向导无障碍测试
- [ ] 所有输入框有正确的aria-label
- [ ] 所有按钮有aria-label
- [ ] 步骤指示器有aria-current
- [ ] 错误提示有role="alert"
- [ ] 可以用Tab键在所有控件间导航
- [ ] 可以用键盘操作所有功能

---

## 13. 项目选择器测试

> **触发**: Kairo菜单 → Select Kairo Project... / 状态栏Project项点击
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 选择器打开 | 触发打开项目选择器 | 项目选择器面板在主区域打开 | P0 | |
| 已导入项目列表 | 查看列表 | 显示所有已导入的项目 | P0 | |
| 项目切换 | 点击一个项目项 | 切换到该项目为活动项目 | P0 | |
| 切换后状态栏 | 切换项目后 | 状态栏Project项更新为新项目名称 | P0 | |
| 切换后工具栏 | 切换项目后 | 工具栏Project下拉框更新为选中项目 | P0 | |

---

## 14. 文件资源管理器测试

> **触发**: 活动栏第一个图标 / Ctrl+Shift+E
> **预计时间**: 15分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 资源管理器打开 | 点击活动栏资源管理器图标 | 左侧栏显示EXPLORER面板 | P0 | |
| 项目根目录显示 | 打开工作区后 | 显示项目根目录名称 | P0 | |
| 目录展开 | 点击src目录前的箭头 | 展开目录显示子文件/子目录 | P0 | |
| 目录折叠 | 再次点击箭头 | 折叠目录 | P0 | |
| 文件单击 | 单击一个Java文件 | 文件在编辑器中打开 (预览模式，标签为斜体) | P0 | |
| 文件双击 | 双击一个Java文件 | 文件在编辑器中永久打开 (标签正常字体) | P0 | |
| 右键菜单-文件 | 右键点击一个文件 | 弹出上下文菜单 (Open/Cut/Copy/Paste/Delete/Rename等) | P0 | |
| 右键菜单-文件夹 | 右键点击一个目录 | 弹出上下文菜单 (New File/New Folder/等) | P0 | |
| New File | 右键目录→New File | 出现文件名输入框 | P1 | |
| New Folder | 右键目录→New Folder | 出现文件夹名输入框 | P1 | |
| Delete删除文件 | 右键文件→Delete | 弹出确认对话框，确认后文件被删除 | P1 | |
| Rename重命名 | 右键文件→Rename | 文件名变为可编辑状态 | P1 | |
| 刷新按钮 | 点击资源管理器顶部刷新按钮 | 刷新文件树 | P2 | |
| 折叠所有按钮 | 点击折叠所有按钮 | 所有目录折叠 | P2 | |
| 文件图标 | 查看不同文件类型 | .java/.jsp/.xml/.css/.js等文件有对应图标 | P2 | |
| GBK文件名显示 | 打开含中文文件名的目录 | 中文文件名正确显示，无乱码 | P0 | |

---

## 15. 编辑器功能测试

> **预计时间**: 25分钟
> **测试文件**: 使用legacy-sample项目中的Java/JSP/XML文件

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Java文件打开 | 双击打开一个.java文件 | 文件在编辑器中打开，语法高亮正确 | P0 | |
| JSP文件打开 | 双击打开.jsp文件 | JSP文件正确显示，支持HTML/Java语法高亮 | P0 | |
| XML文件打开 | 双击打开build.xml或web.xml | XML语法高亮正确 | P0 | |
| GBK文件编码 | 打开GBK编码的Java文件 | 中文注释正确显示，无乱码 | P0 | |
| UTF-8文件 | 打开UTF-8编码文件 | 内容正确显示 | P0 | |
| 编辑器标签页 | 打开多个文件 | 顶部显示多个标签页，文件名正确 | P0 | |
| 标签关闭 | 点击标签页X按钮 | 关闭该标签页 | P0 | |
| 标签切换 | 点击不同标签 | 切换到对应文件 | P0 | |
| 行号显示 | 查看编辑器左侧 | 显示行号 | P1 | |
| 代码输入 | 在编辑器中输入代码 | 可以正常输入，无卡顿 | P0 | |
| 光标定位 | 点击编辑器任意位置 | 光标正确定位到点击处 | P0 | |
| 文本选择 | 拖拽选择文本 | 文本正确选中，高亮显示 | P0 | |
| 撤销Ctrl+Z | 输入内容后按Ctrl+Z | 撤销输入 | P0 | |
| 重做Ctrl+Y | 撤销后按Ctrl+Y | 重做内容 | P0 | |
| 剪切Ctrl+X | 选中文本按Ctrl+X | 文本被剪切 | P0 | |
| 复制Ctrl+C | 选中文本按Ctrl+C | 文本被复制 | P0 | |
| 粘贴Ctrl+V | 按Ctrl+V | 文本粘贴到光标处 | P0 | |
| 查找Ctrl+F | 按Ctrl+F | 打开查找框 | P0 | |
| 查找输入 | 查找框输入关键词 | 匹配项高亮显示 | P0 | |
| 查找下一个 | 点击查找下一个按钮/Enter | 跳转到下一个匹配项 | P0 | |
| 查找上一个 | 点击查找上一个按钮/Shift+Enter | 跳转到上一个匹配项 | P0 | |
| 替换Ctrl+H | 按Ctrl+H | 打开查找替换框 | P0 | |
| 替换功能 | 输入替换内容点击替换 | 文本被替换 | P1 | |
| 替换全部 | 点击全部替换 | 所有匹配项被替换 | P1 | |
| 转到行Ctrl+G | 按Ctrl+G | 打开行号输入框 | P1 | |
| 跳转到指定行 | 输入行号按Enter | 跳转到对应行 | P1 | |
| 保存Ctrl+S | 修改文件后按Ctrl+S | 文件保存，修改标记消失 | P0 | |
| 脏标记 | 文件修改未保存时 | 标签页文件名前显示圆点标记 | P1 | |
| 自动保存 | 开启Auto Save后修改文件 | 文件自动保存，无需手动Ctrl+S | P1 | |
| Java代码补全 | 等待JDT LS就绪后输入代码 | 出现代码补全提示 | P1 | |
| 括号匹配 | 将光标放在括号旁 | 匹配的括号高亮显示 | P2 | |
| 代码折叠 | 点击方法/类前的折叠箭头 | 代码块可以折叠 | P2 | |
| 迷你地图 | 查看编辑器右侧 | 显示迷你地图 (如已开启) | P2 | |
| 编辑器右键菜单 | 右键点击编辑器内容 | 弹出包含复制/粘贴/格式化等的菜单 | P1 | |
| JSP中Java代码 | 在JSP的<% %>标签内 | Java代码有语法高亮 | P0 | |
| GBK中文输入 | 在GBK文件中输入中文 | 输入的中文保存后重新打开正确显示 | P0 | |

---

## 16. 编辑器查找替换测试 (Ctrl+F/H)

> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 查找框打开 | 编辑器中按Ctrl+F | 编辑器顶部出现查找输入框 | P0 | |
| 查找输入 | 查找框中输入关键词 | 当前文件中匹配项高亮显示 | P0 | |
| 查找下一个 | 点击下一个按钮/Enter | 光标跳转到下一个匹配项 | P0 | |
| 查找上一个 | 点击上一个按钮/Shift+Enter | 光标跳转到上一个匹配项 | P0 | |
| 匹配计数 | 查看查找框 | 显示"当前/总数"匹配计数 | P1 | |
| 区分大小写 | 点击"Match Case"按钮(ABc) | 搜索变为区分大小写 | P1 | |
| 全字匹配 | 点击"Match Whole Word"按钮 | 只匹配完整单词 | P1 | |
| 正则表达式 | 点击"Use Regular Expression"按钮(.*) | 支持正则搜索 | P1 | |
| 替换框打开 | 按Ctrl+H | 查找框展开显示替换输入框 | P0 | |
| 替换单个 | 输入替换文本后点击Replace | 当前匹配项被替换 | P1 | |
| 替换全部 | 点击Replace All | 所有匹配项被替换 | P1 | |
| 查找框关闭 | 按Esc | 查找框关闭 | P1 | |

---

## 17. 编码功能测试

> **预计时间**: 10分钟
> **重点**: GBK编码是核心功能，必须完整验证

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 状态栏编码显示 | 打开一个GBK Java文件 | 状态栏Encoding项显示"Encoding: GBK *" | P0 | |
| 编码切换菜单 | 点击状态栏Encoding项 | 弹出编码选择菜单/重新打开菜单 | P0 | |
| UTF-8重新打开 | 选择以UTF-8重新打开GBK文件 | 文件重新以UTF-8打开，中文显示乱码 (正常现象) | P0 | |
| GBK重新打开 | 重新选择以GBK打开 | 中文恢复正确显示 | P0 | |
| GBK保存 | 修改GBK文件后保存 | 保存成功，无编码错误提示 | P0 | |
| 无法编码字符提示 | 输入无法编码的字符后保存 | 显示编码错误提示，不静默替换为? | P0 | |
| 编辑器标签编码装饰 | 打开非UTF-8文件时 | 标签上显示编码后缀/装饰 | P1 | |
| GB18030支持 | 打开GB18030编码文件 | 文件正确显示 | P1 | |
| ISO-8859-1支持 | 打开ISO-8859-1文件 | 文件正确显示 (西文) | P2 | |
| 新建文件默认编码 | 创建新文件 | 默认编码为UTF-8 | P1 | |

---

## 18. 全局搜索面板测试 (Ctrl+Shift+F)

> **触发**: View菜单 → Search / Ctrl+Shift+F / Edit菜单 → Find in Files
> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 搜索面板打开 | Ctrl+Shift+F | 左侧栏显示Search面板 | P0 | |
| 搜索输入框 | 在搜索框输入"class" | 可以输入搜索关键词 | P0 | |
| 替换输入框 | 点击替换展开箭头 | 显示替换输入框 | P0 | |
| 文件包含过滤 | 在"files to include"输入*.java | 只搜索Java文件 | P1 | |
| 文件排除过滤 | 在"files to exclude"输入*.class | 排除class文件 | P1 | |
| 搜索执行 | 按Enter或点击搜索按钮 | 开始搜索，显示进度 | P0 | |
| 搜索结果树 | 搜索完成后 | 结果以文件树形式显示，按文件分组 | P0 | |
| 结果匹配展开 | 点击文件前的展开箭头 | 显示该文件中的匹配行 | P0 | |
| 匹配点击跳转 | 点击一条匹配结果 | 编辑器打开对应文件并跳转到匹配行，高亮匹配文本 | P0 | |
| GBK文件搜索 | 搜索GBK文件中的中文关键词 | 能正确搜索到GBK编码文件中的内容 | P0 | |
| 区分大小写 | 切换"Match Case"选项 | 搜索区分大小写 | P1 | |
| 全字匹配 | 切换"Match Whole Word"选项 | 只匹配完整单词 | P1 | |
| 正则表达式 | 切换"Use Regular Expression"选项 | 支持正则搜索 | P1 | |
| 替换功能 | 输入替换文本后点击替换 | 可以替换匹配内容 | P1 | |
| 全部替换 | 点击Replace All | 替换所有匹配项 | P1 | |
| 搜索结果清除 | 点击清除按钮/新搜索 | 清除当前搜索结果 | P2 | |

---

## 19. Search Everywhere 测试 (双击Shift)

> **触发**: 双击Shift键 / 命令面板搜索"Search Everywhere"
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 对话框打开 | 快速双击Shift键 | 弹出Search Everywhere模态对话框 | P1 | |
| 搜索框自动聚焦 | 对话框打开后 | 搜索输入框自动获得焦点 | P1 | |
| 输入搜索 | 输入类名/文件名 | 实时搜索，显示结果列表 | P1 | |
| All分类标签 | 查看分类标签 | 显示All/Files/Types/Symbols/Actions 5个分类按钮 | P1 | |
| Files分类 | 点击Files标签 | 只显示文件搜索结果 | P1 | |
| Types分类 | 点击Types标签 | 只显示类型(类/接口)搜索结果 | P1 | |
| Symbols分类 | 点击Symbols标签 | 只显示符号(方法/字段)搜索结果 | P1 | |
| Actions分类 | 点击Actions标签 | 只显示命令/操作结果 | P1 | |
| 分类切换Tab | 点击不同分类标签 | 当前选中标签高亮(is-active) | P1 | |
| 键盘上下选择 | 按↑↓键 | 在结果列表中上下移动选择 | P1 | |
| Enter打开结果 | 选中结果按Enter | 打开对应文件/执行对应命令 | P1 | |
| 鼠标悬停选择 | 鼠标悬停在结果项 | 该项被选中(高亮) | P2 | |
| 鼠标点击结果 | 点击一个结果项 | 打开对应文件/执行命令 | P1 | |
| Esc关闭 | 按Esc键 | 对话框关闭 | P1 | |
| 空结果提示 | 输入不存在的内容 | 显示"No matching items." | P2 | |
| Tab焦点陷阱 | 在对话框中按Tab | 焦点在对话框内循环，不跳出 | P2 | |
| 符号图标 | 搜索Java类/方法 | 不同符号类型有对应图标(📄📦🏗ƒ🔑等) | P2 | |
| 结果详情列 | 查看结果项 | 显示标签(label)和详情(detail，如文件路径) | P2 | |

---

## 20. 构建视图测试

> **触发**: Kairo菜单 → View → Builds / 左侧栏Builds图标
> **预计时间**: 15分钟
> **前置条件**: 已导入legacy-sample项目

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Build视图打开 | 通过菜单打开Builds | 左侧栏显示Build Status面板 | P0 | |
| 视图标题 | 查看面板顶部 | 标题为"Build Status" | P0 | |
| 初始状态 | 未执行过构建时 | 状态显示idle (空心圆) | P0 | |
| Build按钮 | 点击面板内Build按钮 | 触发构建，按钮禁用，状态变为running | P0 | |
| Clean Build按钮 | 点击Clean Build按钮 | 触发Clean构建 | P0 | |
| Cancel按钮 | 构建运行时点击Cancel | 尝试取消构建，按钮显示Cancelling… | P1 | |
| Cancel按钮禁用状态 | 无构建运行时 | Cancel按钮禁用 | P1 | |
| 构建运行状态 | 构建过程中 | 状态显示running图标 (半圆)，有动画 | P0 | |
| 构建成功状态 | 构建成功后 | 显示✓ succeeded，Build按钮恢复可用 | P0 | |
| 构建失败状态 | 代码有错误时构建 | 显示✗ failed | P0 | |
| 构建摘要 | 构建完成后 | 显示构建摘要信息 (如错误数、警告数) | P1 | |
| 诊断列表 | 构建有错误/警告时 | Diagnostics区域显示错误/警告列表 | P0 | |
| 错误图标 | error级别诊断 | 显示❌错误图标和红色样式 | P0 | |
| 警告图标 | warning级别诊断 | 显示⚠警告图标和黄色样式 | P0 | |
| 诊断位置格式 | 查看每条诊断 | 显示"文件名:行号:列号"格式 | P0 | |
| 诊断消息 | 查看每条诊断 | 显示编译器错误/警告消息文本 | P0 | |
| Build History区域 | 查看下方历史区 | 显示"Build History"标题 | P0 | |
| 空历史提示 | 无构建历史时 | 显示"No builds yet. Press Build to start one." | P0 | |
| 历史条目 | 执行多次构建后 | 历史列表显示每条构建记录 (id、时间、状态图标) | P0 | |
| 断开连接状态 | Agent断开时 | 显示"Disconnected"，所有按钮禁用 | P1 | |
| 加载状态 | 视图刚打开连接中 | 显示"Loading..." | P2 | |

---

## 21. 服务器视图测试

> **触发**: Kairo菜单 → View → Servers / 状态栏Server项点击
> **预计时间**: 20分钟
> **前置条件**: 已导入legacy-sample项目并成功构建

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Server视图打开 | 通过菜单打开Servers | 左侧栏显示Server面板 | P0 | |
| 视图标题 | 查看面板顶部 | 标题为"Server" | P0 | |
| 初始状态Stopped | 服务器未启动时 | 显示■ Stopped状态 | P0 | |
| Start按钮 | 点击Start按钮 | 服务器开始启动，按钮禁用，状态变为Starting... | P0 | |
| Start按钮禁用条件 | 服务器已运行/启动中 | Start按钮和Debug Server按钮禁用 | P0 | |
| Debug Server按钮 | 点击Debug Server按钮 | 以调试模式启动Tomcat，开启JDWP端口 | P0 | |
| Stop按钮 | 点击Stop按钮 | 停止服务器，按钮显示停止中状态 | P0 | |
| Stop按钮禁用条件 | 无运行中服务器时 | Stop按钮禁用 | P0 | |
| Restart按钮 | 服务器运行时点击Restart | 重启服务器 | P0 | |
| Restart按钮禁用条件 | 服务器停止/正在状态切换时 | Restart按钮禁用 | P0 | |
| Open App按钮 | 服务器运行后点击Open App | 在系统默认浏览器打开应用URL | P0 | |
| Open App按钮禁用条件 | 服务器未运行/无HTTP端口时 | Open App按钮禁用 | P0 | |
| 启动中状态Starting | 服务器启动过程中 | 显示▶ Starting...状态 | P0 | |
| 运行中状态Running | 服务器启动成功后 | 显示● Running状态 | P0 | |
| 停止中状态Stopping | 停止服务器过程中 | 显示◐ Stopping...状态 | P1 | |
| 错误状态Error | 启动失败时 | 显示✖ Error状态 | P0 | |
| Server URL显示 | 服务器运行后 | 显示"URL: http://127.0.0.1:xxxx"，链接可点击 | P0 | |
| URL链接点击 | 点击URL链接 | 在外部浏览器打开该地址 | P0 | |
| Server Info区域 | 服务器运行后 | 显示"Server Info"区域 | P0 | |
| Server ID显示 | 查看Server Info | 显示服务器ID | P0 | |
| HTTP Port显示 | 查看Server Info | 显示HTTP端口号 | P0 | |
| JDWP端口显示 | 调试模式启动后 | 显示JDWP 127.0.0.1:xxxx (ready) | P0 | |
| PID显示 | 查看Server Info | 显示Tomcat进程PID | P0 | |
| 启动时间显示 | 查看Server Info | 显示Started时间 | P1 | |
| Static Hot Reload区域 | 查看热重载区域 | 显示"Static Hot Reload (manual)"标题 | P0 | |
| 热重载状态指示灯 | 查看状态点 | 绿色(已同步)/黄色(编译中)/红色(需重启)指示灯 | P0 | |
| Publish Changed Files按钮 | 点击发布按钮 | 发布静态文件 (JSP/CSS/JS)，显示发布结果 | P0 | |
| Pause/Resume按钮 | 点击Pause按钮 | 热重载暂停，按钮变为Resume | P1 | |
| 发布状态消息 | 发布后 | 显示"X file(s), X bytes published"成功消息 | P0 | |
| All Servers列表 | 查看下方服务器列表 | 显示所有服务器实例 | P0 | |
| 空服务器提示 | 无服务器时 | 显示"No servers registered. Press Start to launch one." | P0 | |
| 服务器列表条目 | 有服务器时 | 列表显示每个服务器的id、端口、状态 | P0 | |

---

## 22. 部署视图测试

> **触发**: Kairo菜单 → View → Deployments
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Deployments视图打开 | 打开Deployments | 显示Kairo Deployments面板 | P0 | |
| 加载状态 | 初次打开 | 显示Loading...和加载动画 | P2 | |
| 空状态 | 无部署记录时 | 显示"No deployments yet." | P0 | |
| 部署记录列表 | 执行Build & Deploy后 | 表格显示部署记录，包含ID/State/Files/Trigger/Reload列 | P0 | |
| 部署成功状态 | 部署成功后 | 记录state列显示成功状态 | P0 | |

---

## 23. Tomcat日志查看器测试

> **触发**: Kairo菜单 → View → Tomcat Logs
> **预计时间**: 15分钟
> **前置条件**: 服务器已启动

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 日志查看器打开 | 打开Tomcat Logs | 在主编辑区打开Server Logs面板 | P0 | |
| 日志行数/字节数 | 查看工具栏 | 显示"Server Logs (N lines / N bytes)" | P0 | |
| 服务器选择下拉框 | 查看服务器选择 | 下拉框列出所有服务器，显示当前服务器及其状态 | P0 | |
| Pause/Resume按钮 | 点击Pause按钮 | 日志暂停滚动，按钮变为Resume | P0 | |
| Resume按钮 | 点击Resume | 恢复实时日志滚动 | P0 | |
| Clear view按钮 | 点击Clear view | 视图中的日志被清空 | P0 | |
| Save As...按钮 | 有日志时点击Save As | 触发日志文件下载/保存 | P0 | |
| Save As禁用状态 | 无日志时 | Save As按钮禁用 | P1 | |
| Auto-scroll复选框 | 查看自动滚动 | 有"Auto-scroll"复选框，默认勾选 | P0 | |
| 取消自动滚动 | 取消勾选Auto-scroll | 新日志到来时不自动滚动到底部 | P0 | |
| Filter输入框 | 查看过滤框 | 有Filter logs输入框，placeholder为"Filter logs" | P0 | |
| 日志过滤 | 在过滤框输入"ERROR" | 只显示包含ERROR的日志行 | P0 | |
| 清空过滤 | 删除过滤文本 | 恢复显示所有日志 | P0 | |
| 流选择下拉框 | 查看流选择 | 下拉框包含All streams/stdout/stderr/structured选项 | P0 | |
| 选择stdout | 选择stdout | 只显示标准输出流日志 | P1 | |
| 选择stderr | 选择stderr | 只显示标准错误流日志 | P1 | |
| 日志实时追加 | 访问应用页面产生日志 | 新日志实时追加到视图底部 | P0 | |
| 暂停时缓冲计数 | 暂停期间有新日志 | 显示"N+ updates buffered while paused" | P0 | |
| 日志时间戳 | 查看每条日志 | 每行显示时间戳 | P0 | |
| 流标签 | 查看每条日志 | 显示[stdout]/[stderr]标签 | P0 | |
| 错误日志着色 | stderr输出/错误日志 | 错误行有特殊颜色样式 | P1 | |
| 状态栏信息 | 查看底部状态栏 | 显示Runtime/Server/History/Refresh状态 | P0 | |
| 历史加载重试 | 历史加载失败时 | 显示"Retry history"按钮 | P1 | |
| 无匹配日志提示 | 过滤后无匹配日志 | 显示"No matching log output." | P0 | |

---

## 24. 运行配置管理测试

> **触发**: Kairo菜单 → Run Configurations...
> **预计时间**: 20分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 运行配置面板打开 | 打开Run Configurations | 在主区域打开Run Configurations面板 | P0 | |
| 面板标题 | 查看面板顶部 | 标题为"Run Configurations" | P0 | |
| 空配置提示 | 无配置时 | 显示"No run configurations. Create one to launch Tomcat consistently." | P0 | |
| New按钮 | 点击New按钮 | 打开配置编辑器 (新建模式) | P0 | |
| Refresh按钮 | 点击Refresh按钮 | 刷新配置列表 | P1 | |
| Run按钮 | 选中配置后点击Run | 启动运行该配置 | P0 | |
| Debug按钮 | 选中配置后点击Debug | 以调试模式运行该配置 | P0 | |
| 无配置时Run/Debug禁用 | 无选中配置时 | Run和Debug按钮禁用 | P1 | |

### 19.1 新建配置编辑器
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 编辑器标题-New | 新建配置时 | 标题为"New Run Configuration" | P0 | |
| General区域 | 查看表单 | 有General分组fieldset | P0 | |
| ID字段 | 查看ID输入框 | 自动生成ID (如tomcat-1)，新建时可编辑 | P0 | |
| Name字段 | 查看Name输入框 | 可以输入配置名称 | P0 | |
| Project ID字段 | 查看Project ID | 自动填充当前项目ID | P0 | |
| JDK reference字段 | 查看JDK ref | 有JDK引用输入框 | P1 | |
| Mode下拉框 | 查看Mode选择 | 下拉框有Run和Debug两个选项，默认Run | P0 | |
| 切换到Debug模式 | 选择Debug模式 | Suspend复选框变为可用 | P0 | |
| Suspend复选框 | Debug模式时 | "Suspend until debugger attaches"复选框可用 | P1 | |
| Server区域 | 查看Server分组 | 有Server区域，包含服务器ref、HTTP端口、Debug端口、Context path | P0 | |
| HTTP端口输入 | HTTP端口输入框 | 默认填充端口号 (如8080)，可以修改 | P0 | |
| Debug端口输入 | Debug端口输入框 | 默认填充JDWP端口 (如8000)，可以修改 | P0 | |
| Context path输入 | Context path输入框 | 默认填充"/"，可以修改 | P0 | |
| Build区域 | 查看Build分组 | 有Build区域，Build type下拉框(Ant/javac/Custom) | P0 | |
| Build type-Ant | 选择Ant | 显示Ant target输入框 (默认war) | P0 | |
| Build type-javac | 选择javac | Ant target输入框隐藏 | P0 | |
| Build type-Custom | 选择Custom | 显示Custom command输入框和提示文字 | P0 | |
| Clean before build复选框 | 查看复选框 | "Clean before build"复选框，默认未勾选 | P0 | |
| Deploy区域 | 查看Deploy分组 | 有Deploy区域，Deploy mode(Exploded/WAR)和Artifact输入 | P0 | |
| Advanced区域 | 展开Advanced | 有VM options和Environment多行文本框 | P0 | |
| VM options输入 | 在VM options输入内容 | 可以输入多行JVM参数 | P1 | |
| Environment输入 | 在Environment输入NAME=value | 可以输入环境变量 | P1 | |
| 环境变量敏感提示 | Environment输入框旁 | 提示敏感变量需使用${env:VAR}引用 | P1 | |
| Before Launch区域 | 查看Before Launch | 有Build和Deploy两个复选框，默认勾选Build | P0 | |
| Save按钮 | 点击Save按钮 | 保存配置，返回列表视图 | P0 | |
| Cancel按钮 | 点击Cancel按钮 | 放弃编辑，返回列表视图 | P0 | |

### 19.2 配置列表操作
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 配置保存后显示 | 保存配置后 | 列表中显示新配置项 | P0 | |
| 配置信息显示 | 查看配置项 | 显示名称、模式、项目、HTTP端口、JDWP端口 | P0 | |
| 默认配置标记 | 设为默认的配置 | 显示★ Default徽章 | P0 | |
| Edit按钮 | 点击配置项的Edit按钮 | 打开配置编辑器 (编辑模式) | P0 | |
| 编辑器标题-Edit | 编辑现有配置时 | 标题为"Edit Run Configuration"，ID字段只读 | P0 | |
| Copy按钮 | 点击Copy按钮 | 复制配置，创建一个副本 | P1 | |
| Set Default按钮 | 点击Set Default | 将该配置设为默认配置，显示★标记 | P0 | |
| Set Default禁用-当前默认 | 当前已是默认配置时 | Set Default按钮禁用 | P1 | |
| Run按钮-列表项 | 点击列表项Run按钮 | 直接运行该配置 | P0 | |
| Debug按钮-列表项 | 点击列表项Debug按钮 | 直接调试运行该配置 | P0 | |
| Delete按钮 | 点击Delete按钮 | 弹出确认对话框"Delete run configuration?" | P0 | |
| Delete确认 | 在确认框点击确定 | 配置被删除 | P0 | |
| Delete取消 | 在确认框点击取消 | 配置保留 | P1 | |
| Summary区域 | 选中配置后 | 显示配置摘要 (Mode/Server/Build/Deploy) | P0 | |
| 端口占用错误 | 配置端口被占用时 | 显示端口占用警告，有Modify Port按钮 | P0 | |
| Modify Port按钮 | 端口冲突时点击Modify Port | 自动进入编辑模式，HTTP端口+1 | P1 | |
| 启动进度显示 | 启动配置时 | 显示Launch progress区域，列出build→deploy→run步骤 | P1 | |
| 验证问题列表 | 配置有问题时 | 显示validation issues列表 | P1 | |
| 工具栏同步 | 配置保存后 | 工具栏Run Config下拉框更新，包含新配置 | P0 | |

---

## 25. 调试功能测试

> **触发**: Run菜单 → Start Debugging / Debug按钮 / Kairo菜单 → Debug子菜单
> **预计时间**: 25分钟
> **前置条件**: JDT LS就绪，Debug Server已启动并连接

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Debug视图打开 | 点击活动栏调试图标/Ctrl+Shift+D | 切换到调试视图 | P0 | |
| Variables面板 | Kairo→Debug→Variables | 打开调试变量面板 | P1 | |
| Call Stack面板 | Kairo→Debug→Call Stack | 打开调用栈面板 | P1 | |
| Breakpoints面板 | Kairo→Debug→Breakpoints | 打开断点列表面板 | P1 | |
| Watch面板 | Kairo→Debug→Watch | 打开监视表达式面板 | P1 | |
| Debug Toolbar | Kairo→Debug→Debug Toolbar | 显示调试工具栏 (继续/单步/停止等) | P1 | |
| Debug Console | Kairo→Debug→Debug Console | 打开调试控制台 | P0 | |
| Debug Diagnostics | Kairo→Debug→Debug Diagnostics | 打开调试诊断面板 | P1 | |
| 断点设置 | 在编辑器行号旁单击 | 设置断点，显示红色圆点 | P0 | |
| 断点切换 | 再次单击断点红点 | 取消断点 | P0 | |
| 条件断点 | 右键断点→Edit Condition | 可以设置条件断点 | P1 | |
| 命中断点 | 以Debug模式启动后访问触发断点的代码 | 程序暂停在断点处，高亮当前行 | P0 | |
| Continue继续 | 点击Continue/F5 | 程序继续执行到下一个断点或结束 | P0 | |
| Step Over单步跳过 | 点击Step Over/F10 | 执行当前行，停在下一行 | P0 | |
| Step Into单步进入 | 点击Step Into/F11 | 进入方法内部 | P0 | |
| Step Out单步跳出 | 点击Step Out/Shift+F11 | 执行完当前方法返回 | P0 | |
| Stop停止 | 点击Stop/Shift+F5 | 终止调试会话 | P0 | |
| Restart重启 | 点击Restart | 重启调试会话 | P1 | |
| 变量查看-作用域 | 暂停在断点时Variables面板 | 显示当前作用域的变量及其值 | P0 | |
| 变量展开 | 点击对象变量前的展开箭头 | 展开对象的字段 | P1 | |
| 监视表达式 | 在Watch面板添加表达式 | 显示表达式的当前值 | P1 | |
| 调用栈查看 | Call Stack面板 | 显示当前线程的调用栈帧 | P0 | |
| 栈帧切换 | 点击调用栈中的不同帧 | 编辑器跳转到对应代码位置 | P1 | |
| 断点列表 | Breakpoints面板 | 列出所有设置的断点 | P0 | |
| 断点启用/禁用 | 取消断点前的复选框 | 断点被禁用 (空心圆)，不触发 | P1 | |
| 删除所有断点 | Breakpoints面板的删除按钮 | 清除所有断点 | P1 | |
| 调试控制台输入 | 在Debug Console输入表达式 | 可以求值并显示结果 | P1 | |
| 调试状态同步状态栏 | 调试连接后 | 状态栏Debug项显示connected状态 | P0 | |
| 热重载状态 | Debug模式下修改Java文件 | HotSwap状态更新 | P1 | |
| 断点模块选择 | Debug Module Selector | 可以选择调试模块 (多模块项目) | P2 | |

---

## 26. 调试面板子组件详细测试

> **预计时间**: 15分钟
> **组件位置**: 调试时左侧边栏Run and Debug视图 + 底部Debug Console面板

### 26.1 调试工具栏按钮(调试悬浮工具栏)
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Continue按钮(F5) | 命中断点后点击Continue/按F5 | 程序继续执行到下一个断点 | P0 | |
| Step Over按钮(F10) | 点击Step Over | 执行当前行，不进入方法 | P0 | |
| Step Into按钮(F11) | 点击Step Into | 进入当前行调用的方法内部 | P0 | |
| Step Out按钮(Shift+F11) | 点击Step Out | 执行完当前方法并返回调用处 | P0 | |
| Restart按钮(Ctrl+Shift+F5) | 点击Restart | 重新启动调试会话 | P0 | |
| Stop按钮(Shift+F5) | 点击Stop | 终止调试会话，断开JDWP连接 | P0 | |
| 暂停按钮 | 点击Pause | 暂停当前执行线程 | P1 | |

### 26.2 Variables面板
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 变量自动显示 | 命中断点后 | Variables面板显示当前作用域的变量 | P0 | |
| 基本类型变量 | 查看int/String等变量 | 正确显示变量名和值 | P0 | |
| 对象变量展开 | 点击对象前的▶箭头 | 展开对象显示字段列表 | P0 | |
| 变量值修改 | 右键变量→Set Value | 可以修改变量的运行时值 | P2 | |
| 复制变量值 | 右键变量→Copy Value | 复制变量值到剪贴板 | P2 | |
| this变量 | 查看this | 显示当前对象实例 | P0 | |
| 静态变量 | 查看静态字段 | 显示静态变量值 | P1 | |

### 26.3 Watch面板
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 添加监视表达式 | 点击+按钮/双击 | 添加新的监视表达式输入框 | P0 | |
| 表达式求值 | 输入表达式按Enter | 对表达式求值并显示结果 | P0 | |
| 编辑表达式 | 双击已有表达式 | 可以编辑表达式 | P1 | |
| 删除表达式 | 右键→Remove/点击X | 删除监视表达式 | P1 | |
| 表达式实时更新 | 单步执行后 | 监视表达式值实时更新 | P1 | |
| 表达式错误 | 输入无效表达式 | 显示错误标识，不崩溃 | P1 | |

### 26.4 Call Stack面板
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 线程列表 | 调试Java Web应用 | 显示多个线程(main/http-nio等) | P1 | |
| 线程展开 | 点击线程前的▶ | 展开显示该线程的调用栈 | P1 | |
| 栈帧显示 | 查看栈帧 | 每个栈帧显示方法名+行号 | P0 | |
| 栈帧双击跳转 | 双击一个栈帧 | 编辑器跳转到对应代码行，该行高亮 | P0 | |
| 当前栈帧标记 | 当前执行位置 | 顶部栈帧高亮标记 | P1 | |
| Pause/Continue线程 | 右键线程→Pause/Resume | 可以暂停/恢复单个线程 | P2 | |

### 26.5 Breakpoints面板
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 断点列表显示 | 设置多个断点 | 面板中列出所有断点，带文件名和行号 | P0 | |
| 断点复选框 | 取消勾选断点复选框 | 断点被禁用(空心圆) | P0 | |
| 断点点击跳转 | 双击断点项 | 编辑器跳转到断点所在行 | P0 | |
| 全部断点复选框 | 取消勾选"All Breakpoints" | 所有断点同时禁用 | P1 | |
| 删除单个断点 | 右键→Remove/悬停显示X | 删除单个断点 | P1 | |
| Remove All Breakpoints | 点击面板中的删除全部按钮 | 清除所有断点 | P1 | |
| 异常断点 | 启用异常断点 | 抛出异常时暂停 | P2 | |

### 26.6 Debug Console面板
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 控制台打开 | 调试时切换到Debug Console标签 | 显示调试输出和求值输入框 | P0 | |
| 表达式求值输入 | 在底部输入框输入表达式按Enter | 求值并显示结果 | P0 | |
| 控制台输出 | 程序System.out输出 | 输出显示在控制台中 | P1 | |
| 历史命令 | 按↑↓键 | 遍历之前输入的表达式历史 | P2 | |
| 清屏按钮 | 点击清屏图标 | 清空控制台内容 | P2 | |

---

## 27. 断点高级功能测试

> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 行断点设置 | 点击编辑器行号旁的gutter | 出现红色圆点标记断点 | P0 | |
| 条件断点设置 | 右键断点→Edit Breakpoint→输入条件 | 设置条件断点(红色圆点带问号?) | P1 | |
| 条件断点触发 | 条件为true时命中断点 | 只有满足条件时才暂停 | P1 | |
| 条件不命中 | 条件为false | 断点不触发，程序继续执行 | P1 | |
| Hit Count断点 | 设置Hit Count次数 | 第N次命中时才暂停 | P1 | |
| Logpoint设置 | 右键→Add Logpoint | 设置日志点(菱形)，不暂停只输出日志 | P1 | |
| Logpoint消息 | 设置Logpoint消息模板 | 命中断点时输出消息到控制台 | P1 | |
| Logpoint变量表达式 | 消息中使用{variable} | 输出变量的值 | P1 | |
| 断点禁用 | 右键→Disable Breakpoint | 断点变为空心灰色圆，不触发 | P1 | |
| 断点启用 | 再次点击已禁用断点 | 断点恢复为红色实心圆 | P1 | |
| 断点删除 | 将断点圆点拖出gutter/右键删除 | 断点被移除 | P0 | |
| 多断点并发 | 在多个文件设断点 | 所有断点都正确列在Breakpoints面板 | P0 | |
| 热重载后断点 | HotSwap后 | 断点保持有效(如果方法签名不变) | P1 | |

---

## 28. Maven视图测试

> **触发**: Kairo菜单 → View → Maven
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Maven视图打开 | 打开Maven视图 | 左侧栏显示Maven面板 | P1 | |
| 视图加载 | 打开后 | Maven相关功能加载 (如检测到pom.xml) | P1 | |

---

## 29. SQL控制台测试

> **触发**: Kairo菜单 → View → SQL Console / 命令面板"Open SQL Console"
> **预计时间**: 15分钟
> **组件**: 顶部工具栏 + 连接表单 + SQL编辑器 + 结果标签页 + 历史标签页

### 29.1 顶部工具栏按钮
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 新建连接 | 点击"+"按钮 | 弹出"新建数据库连接"对话框 | P1 | |
| 刷新连接 | 点击刷新按钮 | 重新连接数据库 | P1 | |
| 断开连接 | 点击断开按钮 | 断开当前数据库连接 | P1 | |
| 保存SQL | 点击保存图标 | 保存当前SQL语句 | P2 | |
| 执行SQL | 点击"Execute"按钮(▶️) | 执行SQL编辑器中的语句 | P0 | |
| 执行选择SQL | 选中部分SQL后执行 | 只执行选中的SQL语句 | P1 | |
| 格式化SQL | 点击格式化按钮 | 格式化SQL语句 | P2 | |

### 29.2 连接表单控件
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 连接名称输入 | 在"Connection Name"输入框输入名称 | 可以输入自定义连接名称 | P1 | |
| 数据库类型下拉 | 点击Database Type下拉框 | 显示Oracle/MySQL/PostgreSQL/SQL Server等选项 | P0 | |
| 主机输入 | 在Host输入框输入 | 可以输入数据库主机地址(默认localhost) | P0 | |
| 端口输入 | 在Port输入框输入 | 可以输入端口号(不同数据库有默认端口) | P0 | |
| 数据库名/SID | 在Database/SID输入框 | 可以输入数据库名或Oracle SID | P0 | |
| 用户名输入 | 在Username输入框输入 | 可以输入数据库用户名 | P0 | |
| 密码输入 | 在Password输入框输入密码 | 密码以掩码(●)形式显示 | P0 | |
| 保存密码勾选 | 勾选"Save Password"复选框 | 密码被保存 | P1 | |
| 测试连接 | 点击"Test Connection"按钮 | 尝试连接并显示成功/失败 | P0 | |
| 确认连接 | 点击"Connect/OK"按钮 | 建立连接，工具栏显示连接状态 | P0 | |
| 取消连接对话框 | 点击"Cancel"按钮 | 关闭新建连接对话框 | P1 | |

### 29.3 SQL编辑器和结果区
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| SQL编辑器输入 | 在SQL编辑器中输入SELECT语句 | 支持SQL语法高亮 | P1 | |
| 表名补全 | 输入表名前缀 | 出现表名/列名自动补全 | P2 | |
| 执行结果表格 | 执行SELECT查询 | Results标签页显示查询结果表格 | P1 | |
| 结果排序 | 点击结果表格列头 | 按该列排序 | P2 | |
| 空结果提示 | 查询无数据时 | 显示"No data returned"或空表格 | P2 | |
| 错误信息显示 | 执行错误SQL | 显示SQL错误信息 | P1 | |
| 执行时间显示 | 执行查询后 | 显示查询执行时间 | P2 | |
| 历史标签页 | 切换到History标签页 | 显示SQL执行历史记录 | P2 | |
| 历史记录点击 | 点击历史中的SQL | SQL加载到编辑器中 | P2 | |

---

## 30. 测试结果视图测试

> **触发**: Kairo菜单 → View → Test Results
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 测试结果视图打开 | 打开Test Results | 在主区域打开测试结果面板 | P1 | |
| JUnit测试集成 | 运行JUnit测试后 | 测试结果显示通过/失败数量 | P1 | |

---

## 31. TODO/FIXME视图测试

> **触发**: Kairo菜单 → View → TODO / FIXME
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| TODO视图打开 | 打开TODO/FIXME视图 | 左侧栏显示TODO面板 | P2 | |
| TODO注释扫描 | 打开Java文件后 | 自动扫描代码中的TODO/FIXME注释 | P2 | |
| TODO列表显示 | 列表显示 | 显示所有TODO项及位置 | P2 | |

---

## 32. 问题面板测试

> **触发**: View菜单 → Problems / Ctrl+Shift+M
> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 问题面板打开 | 打开Problems | 底部面板显示Problems问题列表 | P0 | |
| 问题类型图标 | Error/Warning/Info | 不同级别问题有对应图标 | P0 | |
| 问题位置列 | 查看每条问题 | 显示文件、行号、列号 | P0 | |
| 问题消息列 | 查看每条问题 | 显示问题描述文本 | P0 | |
| 双击问题跳转 | 双击一条问题 | 编辑器跳转到对应文件和行 | P0 | |
| 过滤按钮 | 点击过滤按钮 | 可以按类型过滤问题 | P1 | |

---

## 33. 输出面板测试 (Output)

> **触发**: View菜单 → Output / 底部面板切换到Output标签
> **预计时间**: 5分钟
> **通道**: Build/Agent/Tomcat/LSP/Log(Extension Host)等

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 输出面板打开 | View→Output | 底部面板显示Output标签页 | P0 | |
| 输出通道选择 | 点击右上角通道下拉框 | 列出多个输出通道(Build/Server/Agent等) | P0 | |
| Build输出通道 | 切换到Build通道 | 执行Build后显示构建输出日志 | P0 | |
| Tomcat日志通道 | 切换到Tomcat通道 | 启动服务器后显示Tomcat catalina日志 | P0 | |
| Agent通道 | 切换到Agent通道 | 显示Go Runtime Agent的通信日志 | P1 | |
| LSP通道 | 切换到Language Server通道 | 显示Java LSP初始化/通信日志 | P1 | |
| 日志自动滚动 | 新日志输出时 | 自动滚动到最新内容(Tail模式) | P1 | |
| 锁定滚动 | 点击锁定/解锁滚动按钮 | 可以锁定不自动滚动或解锁 | P2 | |
| 日志复制 | 选中日志文本Ctrl+C | 可以复制日志到剪贴板 | P1 | |
| 清空输出 | 点击Clear Output按钮(垃圾桶图标) | 清空当前通道的输出内容 | P1 | |
| 日志级别过滤 | 如有级别过滤按钮 | 可以按Error/Warning/Info过滤 | P2 | |
| 时间戳显示 | 查看日志行 | 每行日志带时间戳(如配置) | P2 | |
| 中文日志显示 | 输出含中文的构建日志 | 中文不乱码，正确显示GBK/UTF-8编码 | P0 | |
| 多通道独立清空 | 切换通道清空 | 只清空当前通道，不影响其他通道 | P2 | |

---

## 34. 终端测试

> **触发**: Terminal菜单 → New Terminal / Ctrl+Shift+` / Kairo菜单→Window→Toggle Terminal (Alt+F12)
> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 新建终端 | Ctrl+Shift+` | 底部面板打开新终端，显示命令提示符 | P0 | |
| 终端切换 | Kairo菜单Toggle Terminal (Alt+F12) | 终端面板显示/隐藏切换 | P0 | |
| 命令输入 | 在终端输入`dir`并回车 | 执行dir命令，显示当前目录文件列表 | P0 | |
| 中文目录支持 | 切换到含中文的目录执行dir | 中文文件名/目录名正确显示，无乱码 | P0 | |
| 多个终端 | 多次新建终端 | 可以创建多个终端，有标签切换 | P1 | |
| 终端切换标签 | 点击不同终端标签 | 切换到对应终端会话 | P1 | |
| Kill Terminal | 点击终端的删除按钮/Terminal→Kill Terminal | 当前终端被关闭 | P1 | |
| 终端输出复制 | 选中终端输出右键复制 | 文本可以复制 | P1 | |
| cmd.exe验证 | 在终端输入`echo %COMSPEC%` | 确认使用的是Windows cmd.exe | P0 | |
| JDK版本命令 | 在终端输入`java -version` | 显示JDK版本信息 (1.6.x) | P0 | |

---

## 35. Git集成测试

> **触发**: View菜单 → SCM / Ctrl+Shift+G (如果Git可用)
> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| SCM视图打开 | 打开Git工作区后按Ctrl+Shift+G | 显示源代码管理面板 | P1 | |
| 更改文件列表 | 修改文件后 | 更改列表显示修改的文件 | P1 | |
| 文件暂存 | 点击文件旁的+号 | 文件被暂存 | P1 | |
| 提交输入 | 输入提交消息 | 可以输入提交信息 | P2 | |
| 提交按钮 | 点击提交按钮 (如有Git环境) | 可以提交更改 | P2 | |

---

## 36. SVN集成测试

> **触发**: 如有SVN工作副本
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| SVN功能可用 | 打开SVN工作副本 | SVN相关功能可用 (如已安装SVN客户端) | P2 | |

---

## 37. 本地历史测试

> **触发**: 文件右键→Local History 或命令面板
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 本地历史功能 | 修改文件保存多次后 | 本地历史记录文件快照 | P2 | |
| 历史查看 | 查看本地历史 | 显示文件的历史版本列表 | P2 | |
| 版本对比 | 选择两个历史版本对比 | 显示差异对比 | P2 | |
| 恢复版本 | 恢复到某个历史版本 | 文件内容恢复 | P2 | |

---

## 38. 书签功能测试

> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 添加书签 | 使用书签命令切换书签 | 在当前行添加/移除书签 | P2 | |
| 书签列表面板 | 打开Bookmarks视图 | 显示所有书签列表 | P2 | |
| 书签跳转 | 点击书签名 | 跳转到对应位置 | P2 | |

---

## 39. 快捷键速查表测试

> **触发**: 命令面板搜索"Shortcut"或相关命令
> **预计时间**: 3分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 快捷键速查表打开 | 打开快捷键速查表 | 显示所有快捷键的概览面板 | P2 | |
| 快捷键搜索 | 在速查表中搜索 | 可以按关键词过滤快捷键 | P2 | |

---

## 40. 键盘映射配置测试 (Keymaps)

> **触发**: Kairo菜单→Window→Keyboard Shortcuts / 命令面板"Open Keyboard Shortcuts"
> **预计时间**: 10分钟
> **组件**: 搜索栏 + 工具栏 + Keymap卡片列表

### 40.1 搜索与工具栏
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 面板打开 | 打开Keyboard Shortcuts | 主区域打开Keymaps面板，显示预设方案列表 | P1 | |
| 搜索框输入 | 搜索框输入"build" | 实时过滤显示匹配的快捷键项 | P1 | |
| 搜索框placeholder | 查看搜索框 | 显示"Search keymaps..."提示文字 | P2 | |
| Reset按钮 | 点击Reset按钮 | 重置快捷键到默认设置 | P1 | |
| Import按钮 | 点击Import按钮 | 弹出文件选择器导入快捷键配置 | P2 | |
| Export按钮 | 点击Export按钮 | 导出当前快捷键配置到文件 | P2 | |

### 40.2 预设Keymap卡片
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 预设卡片显示 | 查看列表 | 显示Eclipse/IDEA/VS Code/Default预设卡片 | P1 | |
| Eclipse卡片选中 | 点击Eclipse卡片 | 卡片高亮选中，快捷键切换为Eclipse风格 | P1 | |
| IDEA卡片选中 | 点击IntelliJ IDEA卡片 | 切换为IDEA风格快捷键 | P1 | |
| VS Code卡片选中 | 点击VS Code卡片 | 切换为VS Code风格快捷键 | P1 | |
| Default卡片 | 点击Default卡片 | 切换回默认快捷键方案 | P1 | |
| 卡片激活标识 | 已激活的卡片 | 显示is-active样式/勾选标记 | P1 | |
| 快捷键列表 | 展开某个keymap | 显示该方案下所有快捷键 | P1 | |
| 快捷键修改 | 双击某个快捷键绑定 | 进入编辑模式，可以输入新按键组合 | P2 | |
| 清除绑定 | 右键删除快捷键 | 可以清除某个命令的快捷键绑定 | P2 | |

---

## 41. 性能仪表板测试

> **触发**: Kairo菜单 → View → Performance Dashboard
> **预计时间**: 5分钟
> **组件**: 概览卡片 + LSP详情 + Agent状态 + 语言服务器列表 + 刷新按钮

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 面板打开 | 打开Performance Dashboard | 在主区域打开性能仪表板 | P2 | |
| 启动时间指标 | 查看Startup Time | 显示IDE启动耗时(秒)，如"X.XXs" | P2 | |
| 内存使用指标 | 查看Memory Usage | 显示当前内存使用量(MB) | P2 | |
| 响应时间指标 | 查看Response Time | 显示UI响应延迟(ms) | P2 | |
| LSP响应时间 | 查看LSP Response | 显示Java语言服务器响应时间 | P2 | |
| Agent连接状态 | 查看Agent Status | 显示已连接/未连接状态 | P1 | |
| 语言服务器列表 | 查看Language Servers区域 | 列出各语言服务器(Java等)的状态 | P2 | |
| LSP就绪显示 | Java LS就绪后 | 显示Java语言服务器为Ready状态 | P2 | |
| Refresh按钮 | 点击Refresh按钮 | 刷新所有性能指标数据 | P2 | |
| 警告提示 | 启动早期查看 | 如果LSP未就绪，显示黄色警告 | P2 | |

---

## 42. 远程开发面板测试 (Remote Development)

> **触发**: Kairo菜单 → View → Remote Development
> **预计时间**: 10分钟
> **组件**: 连接表单 + 测试连接按钮 + 已保存连接列表 + Refresh按钮

### 42.1 SSH连接表单
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 面板打开 | 打开Remote Development | 在主区域打开远程开发面板 | P2 | |
| Host输入框 | 在Host输入框输入IP/主机名 | 可以输入远程服务器地址 | P2 | |
| Host placeholder | 查看Host输入框 | 显示"Remote host"提示文字 | P2 | |
| Port输入框 | 在Port输入框输入端口(默认22) | 可以输入SSH端口号 | P2 | |
| Username输入框 | 在Username输入框输入用户名 | 可以输入SSH登录用户名 | P2 | |
| Password输入框 | 在Password输入框输入密码 | 密码以掩码(●)显示 | P2 | |
| 私钥文件选择 | 点击Private Key浏览 | 弹出文件选择器选择私钥文件 | P2 | |
| 认证方式切换 | 选择Password/Private Key | 可以在密码认证和密钥认证之间切换 | P2 | |
| Remote Path输入 | 在Remote Path输入路径 | 可以输入远程项目路径 | P2 | |
| Connect按钮 | 配置完成后点击Connect | 尝试建立SSH连接 | P2 | |
| Test Connection按钮 | 点击Test Connection | 测试SSH连接是否成功 | P2 | |
| 连接状态显示 | 连接中/成功/失败 | 显示对应的连接状态和消息 | P2 | |
| 连接错误提示 | 连接失败时 | 显示红色错误信息 | P2 | |
| Save按钮 | 点击Save按钮 | 保存连接配置到已保存列表 | P2 | |

### 42.2 已保存连接
| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 已保存连接列表 | 查看Saved Connections | 显示已保存的远程连接列表 | P2 | |
| 连接项点击 | 点击一个已保存连接 | 加载该连接配置到表单 | P2 | |
| Refresh按钮 | 点击Refresh | 刷新已保存连接列表 | P2 | |
| 删除连接 | 删除一个已保存连接 | 从列表中移除 | P2 | |

---

## 43. Java类型层次结构测试 (Type Hierarchy)

> **触发**: 右键Java类名→Open Type Hierarchy / 命令面板→"Type Hierarchy"
> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 层次结构视图打开 | 在Java类名上右键→Type Hierarchy | 打开Type Hierarchy视图 | P2 | |
| 类层次树 | 查看层次视图 | 显示类的继承树(父类→子类) | P2 | |
| 超类展开 | 查看父类链 | 显示完整的继承链路 | P2 | |
| 子类展开 | 展开子类节点 | 显示所有子类 | P2 | |
| 点击跳转 | 双击类名 | 跳转到对应的类文件 | P2 | |
| 刷新按钮 | 点击刷新 | 重新计算层次结构 | P2 | |

---

## 44. 通知中心测试

> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 通知弹出 | 执行Build/Deploy等操作 | 右下角弹出通知toast | P0 | |
| Info通知 | 普通操作成功 | 显示Info样式通知 (蓝色) | P0 | |
| Warning通知 | Agent断开等 | 显示Warning样式通知 (黄色) | P0 | |
| Error通知 | 构建失败等 | 显示Error样式通知 (红色) | P0 | |
| 通知自动消失 | 等待 | Info/Warning通知在超时后自动消失 | P1 | |
| 通知铃铛图标 | 查看状态栏 | 通知中心铃铛图标 (如有) | P1 | |
| 未读计数徽章 | 有未读通知时 | 铃铛图标显示未读数量徽章 | P1 | |
| 通知中心打开 | 点击铃铛图标 | 展开通知中心，显示最近50条通知 | P1 | |
| 清除通知 | 点击清除按钮 | 清除所有通知 | P2 | |

---

## 45. 设置与首选项测试

> **触发**: File菜单 → Preferences / 命令面板→Preferences: Open Settings
> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 设置面板打开 | 打开Preferences/Settings | 显示设置面板 | P1 | |
| 设置搜索 | 在设置搜索框输入"save" | 过滤显示相关设置 | P1 | |
| Auto Save设置 | 找到Auto Save设置 | 可以切换自动保存选项 | P1 | |
| Editor字体大小 | 修改字体大小设置 | 编辑器字体大小变化 | P2 | |
| Theme设置 | 查看主题设置 | 可以切换颜色主题 | P2 | |
| Kairo设置分类 | 设置中有Kairo分类 | 包含General/Appearance/Build/Server等Kairo专属设置 | P1 | |
| 设置保存 | 修改设置后 | 设置自动保存 | P1 | |
| 项目级设置 | 在项目.kairo/settings.json配置 | 项目级设置覆盖用户设置 | P2 | |

---

## 46. 命令面板测试 (Ctrl+Shift+P)

> **触发**: View菜单 → Command Palette / Ctrl+Shift+P
> **预计时间**: 15分钟
> **重要**: 所有Kairo命令必须在命令面板中可用

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 命令面板打开 | 按Ctrl+Shift+P | 顶部打开命令面板输入框 | P0 | |
| 输入Kairo过滤 | 输入"Kairo" | 列出所有Kairo:* 命令 | P0 | |
| 命令数量验证 | 数Kairo:开头的命令 | 至少包含38+条Kairo命令 | P0 | |
| 执行命令-Import Project | 选择Kairo: Import Project | 打开导入向导 | P0 | |
| 执行命令-Build | 选择Kairo: Build | 触发构建 | P0 | |
| 执行命令-Start Server | 选择Kairo: Start Server | 启动服务器 | P0 | |
| 执行命令-Stop Server | 选择Kairo: Stop Server | 停止服务器 | P0 | |
| 执行命令-Toggle Terminal | 选择Kairo: Toggle Terminal (Alt+F12) | 切换终端 | P0 | |
| 执行命令-Reconnect Agent | 选择Kairo: Reconnect Agent | 重连Agent | P0 | |
| 执行命令-Open Keyboard Shortcuts | 选择Kairo: Open Keyboard Shortcuts | 打开快捷键面板 | P1 | |
| >前缀显示所有命令 | 输入>前缀 | 显示所有可用命令 | P0 | |
| 模糊搜索匹配 | 输入"bld" (部分匹配) | 能匹配到"Kairo: Build"等命令 | P1 | |
| 最近使用命令 | 重复打开命令面板 | 最近使用的命令排在前面 | P2 | |
| 键盘导航 | 用↑↓键选择命令 | 可以用键盘方向键选择命令 | P0 | |
| Enter执行 | 选中命令按Enter | 执行该命令 | P0 | |
| Esc关闭 | 按Esc | 命令面板关闭 | P0 | |
| 无"Command not found" | 执行列表中每个Kairo命令 | 所有命令都能执行，不报错 | P0 | |

---

## 47. 焦点导航命令测试 (Focus Navigation)

> **预计时间**: 5分钟
> **说明**: 测试Kairo菜单→Window子菜单中的焦点导航命令

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Focus Editor | Kairo→Window→Focus Editor | 焦点切换到编辑器区域 | P2 | |
| Focus Terminal | Kairo→Window→Focus Terminal | 焦点切换到终端 | P2 | |
| Focus Explorer | Kairo→Window→Focus Explorer | 焦点切换到文件资源管理器 | P2 | |
| Toggle Maximized | 切换面板最大化/还原 | 当前面板最大化或还原 | P2 | |

---

## 48. 对话框与确认框测试

> **预计时间**: 10分钟
> **说明**: 测试所有模态对话框、确认框的按钮和交互行为

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 文件未保存确认 | 修改文件后直接关闭标签 | 弹出"是否保存"确认框(Save/Don't Save/Cancel) | P0 | |
| 保存按钮点击 | 确认框中点击Save | 保存文件并关闭标签 | P0 | |
| 不保存按钮点击 | 点击Don't Save | 不保存直接关闭标签 | P0 | |
| Cancel按钮点击 | 点击Cancel | 取消关闭操作，文件保持打开 | P0 | |
| Delete文件确认 | 删除文件时 | 弹出确认删除对话框 | P1 | |
| Overwrite确认 | 导出/保存到已存在文件 | 弹出是否覆盖确认 | P1 | |
| 重新加载确认 | 修改文件后外部变更 | 弹出文件变更提示，是否重新加载 | P1 | |
| 退出确认 | 关闭主窗口时如有未保存文件 | 弹出确认是否保存后退出 | P0 | |
| 错误对话框OK按钮 | 出现错误对话框时 | 点击OK关闭对话框 | P0 | |
| 对话框Esc关闭 | 对话框打开时按Esc | 关闭对话框(Cancel操作) | P1 | |
| 对话框Enter确认 | 对话框打开时按Enter | 触发默认按钮(通常是OK/确认) | P1 | |
| 对话框Tab焦点 | 在对话框中Tab | 焦点在按钮之间循环 | P2 | |
| 模态遮罩 | 对话框打开时 | 背景有遮罩，不可操作其他区域 | P0 | |
| 关闭窗口X按钮 | 点击对话框右上角X | 等同Cancel操作关闭对话框 | P1 | |

---

## 49. 大文件处理测试

> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 大文件打开 (10MB+) | 尝试打开一个较大的日志/文本文件 | 文件可以打开，不崩溃 | P2 | |
| 大文件性能 | 在大文件中滚动 | 滚动流畅，无明显卡顿 | P2 | |
| 大文件模式提示 | 打开超过阈值的文件 | 显示大文件模式提示/启用优化 | P2 | |

---

## 50. 无障碍访问测试

> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| Tab键导航 | 在对话框中按Tab | 可以按Tab顺序遍历所有可交互元素 | P1 | |
| 焦点可见 | Tab到一个按钮 | 按钮有明显的焦点边框/高亮 | P1 | |
| ARIA标签 | 使用屏幕阅读器检查 | 按钮、输入框有正确的aria-label | P1 | |
| role属性 | 重要区域 | 有正确的role属性 (toolbar/dialog/alert等) | P1 | |
| 键盘快捷键Alt+F12 | 按Alt+F12 | 切换终端 (Kairo自定义快捷键) | P0 | |
| Enter键触发默认按钮 | 对话框中按Enter | 触发主按钮 (如Import/Save) | P1 | |
| Esc键取消/关闭 | 对话框中按Esc | 关闭对话框或取消操作 | P1 | |

---

## 51. 多实例与单实例锁测试

> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 启动第一个实例 | 正常启动Kairo IDE | 程序正常启动 | P0 | |
| 启动第二个实例 | 再次双击exe/快捷方式 | 不启动新进程，已有窗口被激活/前置 | P0 | |
| 最小化后二次启动 | 最小化窗口后再次启动 | 窗口恢复并前置 | P1 | |

---

## 52. 文件关联与外部链接测试

> **预计时间**: 5分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 外部URL打开 | 服务器视图中点击应用链接/欢迎页链接 | URL在系统默认浏览器打开，不是在IDE内 | P0 | |
| 非http链接拒绝 | 尝试打开file://等非http链接 | 外部协议链接被拒绝或提示安全警告 | P1 | |
| 新窗口安全策略 | 点击外部链接 | 使用shell.openExternal打开，不创建新BrowserWindow | P1 | |

---

## 53. 卸载程序测试

> **预计时间**: 10分钟

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 卸载程序启动 | 开始菜单→Kairo IDE→Uninstall / 控制面板卸载 | 卸载程序正常启动 | P0 | |
| 卸载确认 | 确认卸载 | 开始卸载流程 | P0 | |
| 文件删除验证 | 卸载完成后检查安装目录 | 程序文件被删除 | P0 | |
| 用户数据删除提示 | 卸载过程中 | 提示是否删除用户数据 (AppData) | P1 | |
| 桌面快捷方式清理 | 卸载后检查桌面 | Kairo IDE快捷方式被删除 | P0 | |
| 开始菜单清理 | 卸载后检查开始菜单 | Kairo IDE程序组被移除 | P0 | |
| 卸载完成提示 | 卸载结束 | 显示卸载完成提示 | P0 | |

---

## 54. 控制台错误监控

> **贯穿所有测试过程**
> **预计时间**: 全程监控

### 54.1 监控方法
1. 通过Help→Toggle Developer Tools打开DevTools（exe版本需设置KAIRO_DEV=1环境变量）
2. 切换到Console标签
3. 在执行所有测试操作时观察控制台输出
4. 同时关注Network标签检查是否有失败的API请求

### 54.2 必须记录的错误类型
| 错误级别 | 是否允许 | 处理方式 |
|----------|----------|----------|
| Uncaught Exception/Error | ❌ 不允许 | 记录并报告Bug |
| Unhandled Promise Rejection | ❌ 不允许 | 记录并报告Bug |
| [kairo] 前缀的error日志 | ⚠️ 需要关注 | 记录具体错误 |
| 404/500网络请求 | ❌ 不允许 (本地Agent请求) | 检查API调用 |
| WebSocket连接错误 | ⚠️ 需分析原因 | 记录重连行为 |
| Deprecation Warning | ⚠️ 可接受但需记录 | 记录警告内容 |
| Theia/Monaco内部警告 | ⚠️ 评估影响 | 确认不影响功能 |
| CSP违规报告 | ❌ 不允许 | 检查是否有内联脚本/外部资源 |
| Source Map加载失败 | ⚠️ 可接受 | 仅在开发模式需要关注 |

### 54.3 检查点 (每个主要功能测试后检查)
- [ ] 启动过程控制台无错误
- [ ] 导入项目过程无错误
- [ ] 构建过程无前端错误 (后端编译错误除外)
- [ ] 启动/停止服务器无控制台错误
- [ ] 打开所有面板/视图无错误
- [ ] 所有菜单点击无"Command not found"错误
- [ ] 调试会话无控制台错误
- [ ] 所有对话框按钮点击无错误
- [ ] 所有表单控件输入无错误
- [ ] SQL控制台连接/查询无错误
- [ ] Search Everywhere搜索无错误
- [ ] 关闭程序时无崩溃错误

---

## 55. EXE日志文件检查

> **预计时间**: 5分钟
> **说明**: 检查Windows exe版本在用户目录下生成的日志文件

| 测试项 | 操作步骤 | 预期结果 | 优先级 | 测试结果 |
|--------|----------|----------|--------|----------|
| 日志目录存在 | 打开%APPDATA%\Kairo IDE\logs | 日志目录存在 | P1 | |
| 主日志文件 | 查看最新日志文件 | 有main.log或类似命名的日志文件 | P1 | |
| 启动日志 | 查看日志开头 | 记录了启动时间、版本号、端口分配信息 | P1 | |
| Agent日志 | 日志中查找agent相关 | 记录了kairo-runtime.exe启动和端口信息 | P1 | |
| 无ERROR级别 | 搜索"ERROR"关键字 | 不应有未处理的ERROR级日志 | P0 | |
| 无FATAL级别 | 搜索"FATAL"关键字 | 不应有FATAL级日志 | P0 | |
| 崩溃日志 | 如有crash日志 | 检查是否存在.dmp崩溃转储文件(正常使用不应有) | P0 | |
| 日志轮转 | 多次启动后 | 日志文件按日期/大小轮转，不会无限增长 | P2 | |

---

## 56. 自动化测试脚本 (Playwright for Electron)

> 可使用Playwright自动化模拟点击测试，以下是完整测试选择器和脚本框架
> 所有Kairo交互元素都有data-testid属性

### 56.1 完整data-testid选择器列表
```typescript
// === 欢迎页面 ===
'welcome-import'              // New Project...按钮
'welcome-select'              // Open Project...按钮
'welcome-open-workspace'      // Open Workspace Folder...按钮
'welcome-recent'              // 最近项目区域
'welcome-recent-item'         // 最近项目条目
'welcome-quick-start'         // 快速开始区域
'welcome-version'             // 版本号显示
'welcome-open-app'            // Open App链接
'welcome-hot-swap'            // Hot Swap Status指示器

// === 导入向导 ===
'import-wizard'               // 向导根容器
'wizard-title'                // 向导标题
'wizard-step-indicator'       // 步骤指示器
'step-1', 'step-2', 'step-3'  // 步骤1/2/3圆点
'wizard-back'                 // Back按钮
'wizard-next'                 // Next按钮
'wizard-cancel'               // Cancel按钮
'path-input'                  // 项目路径输入框
'browse-btn'                  // Browse...按钮
'scan-btn'                    // Scan按钮
'project-list'                // 项目列表
'input-project-name'          // 项目名称输入框
'select-encoding'             // 编码下拉选择(UTF-8/GBK/GB18030)
'select-webapp'               // Webapp目录下拉选择
'select-build-tool'           // 构建工具下拉(Ant/Maven)
'select-jdk'                  // JDK路径选择
'test-jdk-btn'                // Test JDK按钮
'import-project-btn'          // Import Project按钮
'open-project-btn'            // Open Project Folder按钮
'ready-status'                // 就绪状态显示
'ready-close-btn'             // Close按钮

// === 构建视图 ===
'build-view'                  // 构建视图根容器
'build-button'                // Build按钮
'clean-build-button'          // Clean Build按钮
'cancel-build-button'         // Cancel按钮
'build-state'                 // 构建状态显示
'build-diagnostics'           // 诊断问题区域
'build-history'               // 构建历史区域
'build-history-item'          // 历史构建条目
'build-progress'              // 构建进度条

// === 服务器视图 ===
'server-view'                 // 服务器视图根容器
'server-start-button'         // Start按钮
'server-debug-button'         // Debug Server按钮
'server-stop-button'          // Stop按钮
'server-restart-button'       // Restart按钮
'server-open-button'          // Open App按钮
'server-url-link'             // 服务器URL链接
'server-status'               // 服务器状态显示
'server-hotswap-indicator'    // HotSwap状态指示器

// === 部署视图 ===
'deploy-view'                 // 部署视图根容器
'deploy-button'               // 部署按钮
'redeploy-button'             // 重新部署按钮
'undeploy-button'             // 取消部署按钮

// === 日志查看器 ===
'log-viewer'                  // 日志查看器根容器
'log-tab-catalina'            // catalina日志标签
'log-tab-localhost'           // localhost日志标签
'log-tab-manager'             // manager日志标签
'log-tab-host-manager'        // host-manager日志标签
'log-pause-btn'               // 暂停/恢复按钮
'log-auto-scroll'             // 自动滚动按钮
'log-clear-btn'               // 清空日志按钮
'log-filter-input'            // 日志过滤输入框
'log-content'                 // 日志内容区域
'log-encoding-select'         // 日志编码选择

// === 运行配置 ===
'runconfig-view'              // 运行配置根容器
'runconfig-summary'           // 配置摘要区域
'runconfig-new-btn'           // 新建配置按钮
'runconfig-save-btn'          // 保存配置按钮
'runconfig-delete-btn'        // 删除配置按钮
'runconfig-name-input'        // 配置名称输入
'runconfig-server-port'       // 服务器端口输入
'runconfig-jdk-path'          // JDK路径
'runconfig-vm-args'           // VM参数输入
'runconfig-env-vars'          // 环境变量区域
'runconfig-env-add-btn'       // 添加环境变量按钮
'runconfig-build-auto'        // 自动构建复选框
'runconfig-debug-port'        // 调试端口输入
'runconfig-start-btn'         // 启动按钮(运行配置中)
'runconfig-debug-btn'         // 调试按钮(运行配置中)

// === SQL控制台 ===
'sql-console'                 // SQL控制台根容器
'sql-new-connection'          // 新建连接按钮
'sql-refresh'                 // 刷新按钮
'sql-disconnect'              // 断开连接按钮
'sql-execute'                 // 执行SQL按钮
'sql-format'                  // 格式化按钮
'sql-save'                    // 保存按钮
'sql-conn-name'               // 连接名称输入
'sql-conn-type'               // 数据库类型下拉
'sql-conn-host'               // 主机输入
'sql-conn-port'               // 端口输入
'sql-conn-database'           // 数据库名输入
'sql-conn-username'           // 用户名输入
'sql-conn-password'           // 密码输入
'sql-conn-save-password'      // 保存密码复选框
'sql-test-connection'         // 测试连接按钮
'sql-connect-btn'             // 连接按钮
'sql-cancel-btn'              // 取消按钮
'sql-editor'                  // SQL编辑器
'sql-results-tab'             // 结果标签页
'sql-history-tab'             // 历史标签页

// === Search Everywhere ===
'search-everywhere'           // Search Everywhere对话框
'search-everywhere-input'     // 搜索输入框
'se-tab-all'                  // All分类标签
'se-tab-files'                // Files分类标签
'se-tab-types'                // Types分类标签
'se-tab-symbols'              // Symbols分类标签
'se-tab-actions'              // Actions分类标签
'se-results-list'             // 结果列表
'se-empty-message'            // 空结果提示

// === 工具栏按钮 ===
'toolbar-build'               // 构建工具栏按钮
'toolbar-start'               // 启动服务器按钮
'toolbar-debug'               // 调试服务器按钮
'toolbar-stop'                // 停止服务器按钮
'toolbar-restart'             // 重启服务器按钮
'toolbar-save'                // 保存按钮
'toolbar-import'              // 导入项目按钮
'toolbar-select-project'      // 选择项目按钮
'toolbar-new-file'            // 新建文件按钮

// === 状态栏项 ===
'statusbar-project'           // Project状态项
'statusbar-encoding'          // Encoding状态项
'statusbar-build'             // Build状态项
'statusbar-server'            // Server状态项
'statusbar-debug'             // Debug状态项
'statusbar-memory'            // Memory状态项
'statusbar-lsp'               // LSP状态项
'statusbar-hotswap'           // HotSwap状态项
'statusbar-line-col'          // 行列号状态项
'statusbar-indentation'       // 缩进状态项
'statusbar-eol'               // 行尾符状态项
'statusbar-language'          // 语言模式状态项
'statusbar-bell'              // 通知铃铛

// === 远程开发 ===
'remote-view'                 // 远程开发根容器
'remote-host-input'           // 主机输入
'remote-port-input'           // 端口输入
'remote-username-input'       // 用户名输入
'remote-password-input'       // 密码输入
'remote-key-file'             // 私钥文件选择
'remote-path-input'           // 远程路径输入
'remote-connect-btn'          // Connect按钮
'remote-test-btn'             // Test Connection按钮
'remote-save-btn'             // Save按钮
'remote-refresh-btn'          // Refresh按钮
'remote-saved-list'           // 已保存连接列表

// === 键盘映射 ===
'keymap-view'                 // Keymap面板根容器
'keymap-search'               // 搜索框
'keymap-reset'                // Reset按钮
'keymap-import'               // Import按钮
'keymap-export'               // Export按钮
'keymap-card-eclipse'         // Eclipse方案卡片
'keymap-card-idea'            // IDEA方案卡片
'keymap-card-vscode'          // VS Code方案卡片
'keymap-card-default'         // Default方案卡片

// === 性能仪表板 ===
'perf-dashboard'              // 性能仪表板根容器
'perf-startup-time'           // 启动时间指标
'perf-memory'                 // 内存使用指标
'perf-response-time'          // 响应时间指标
'perf-lsp-response'           // LSP响应时间
'perf-agent-status'           // Agent状态
'perf-ls-list'                // 语言服务器列表
'perf-refresh'                // Refresh按钮

// === 视图面板 ===
'view-problems'               // Problems面板
'view-output'                 // Output面板
'view-terminal'               // Terminal面板
'view-debug-console'          // Debug Console面板
'output-channel-select'       // Output通道选择器
'output-clear'                // Output清空按钮

// === 对话框通用 ===
'dialog-root'                 // 对话框根容器
'dialog-title'                // 对话框标题
'dialog-ok'                   // OK按钮
'dialog-cancel'               // Cancel按钮
'dialog-yes'                  // Yes按钮
'dialog-no'                   // No按钮
'dialog-save'                 // Save按钮
'dialog-dont-save'            // Don't Save按钮
'dialog-close-x'              // 关闭X按钮

// === Maven视图 ===
'maven-view'                  // Maven视图根容器

// === TODO视图 ===
'todo-view'                   // TODO视图根容器

// === 调试面板 ===
'debug-continue-btn'          // Continue按钮
'debug-step-over-btn'         // Step Over按钮
'debug-step-into-btn'         // Step Into按钮
'debug-step-out-btn'          // Step Out按钮
'debug-restart-btn'           // Restart按钮
'debug-stop-btn'              // Stop按钮
'debug-variables-panel'       // Variables面板
'debug-watch-panel'           // Watch面板
'debug-watch-add'             // 添加监视表达式按钮
'debug-callstack-panel'       // Call Stack面板
'debug-breakpoints-panel'     // Breakpoints面板
'debug-breakpoints-remove-all'// 删除所有断点按钮
'debug-module-selector'       // 调试模块选择器
```

### 56.2 Playwright Electron自动化测试脚本框架
```javascript
const { _electron: electron } = require('@playwright/test');
const path = require('path');

/**
 * Kairo IDE Windows EXE 自动化测试脚本
 * 使用方法: npx playwright test kairo-exe.spec.js
 */

describe('Kairo IDE Windows EXE Full Test', () => {
  let electronApp;
  let window;

  beforeAll(async () => {
    // 启动Kairo IDE exe
    electronApp = await electron.launch({
      executablePath: 'C:\\Program Files\\Kairo IDE\\Kairo IDE.exe',
      args: ['--no-sandbox'],
      timeout: 60000,
    });
    window = await electronApp.firstWindow();
    
    // 等待应用加载完成（欢迎页面出现）
    await window.waitForSelector('[data-testid="welcome-import"]', { timeout: 60000 });
  });

  afterAll(async () => {
    await electronApp.close();
  });

  test('P0: 欢迎页面加载完成', async () => {
    await expect(window.locator('[data-testid="welcome-import"]')).toBeVisible();
    await expect(window.locator('[data-testid="welcome-select"]')).toBeVisible();
    await window.screenshot({ path: 'screenshots/01-welcome.png' });
  });

  test('P0: 点击New Project打开导入向导', async () => {
    await window.click('[data-testid="welcome-import"]');
    await window.waitForSelector('[data-testid="import-wizard"]');
    await expect(window.locator('[data-testid="wizard-title"]')).toContainText('Import');
    await window.screenshot({ path: 'screenshots/02-import-step1.png' });
  });

  test('P0: 导入向导Step1 - Browse和Scan', async () => {
    await expect(window.locator('[data-testid="path-input"]')).toBeVisible();
    await expect(window.locator('[data-testid="browse-btn"]')).toBeVisible();
    await expect(window.locator('[data-testid="scan-btn"]')).toBeVisible();
    await window.click('[data-testid="wizard-cancel"]');
  });

  test('P0: 无控制台错误', async () => {
    const errors = [];
    window.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    window.on('pageerror', err => errors.push(err.message));
    // 等待一段时间收集错误
    await window.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});
```

### 56.3 模拟点击测试建议方法
1. **Playwright Electron模式**（推荐）: 使用`_electron.launch`直接启动exe，支持所有UI交互
2. **Windows UI Automation**: 使用Windows自带的UIAutomation框架通过Accessibility API操作
3. **AutoHotkey**: 对于简单的冒烟测试，可以编写AHK脚本模拟鼠标点击和键盘输入
4. **手动验证+截图记录**: 按本测试文档逐项点击验证，每项截图留证
5. **键盘导航测试**: 所有功能必须可以仅通过键盘完成（Tab/Enter/Esc/方向键）

---

## 57. 全量交互元素覆盖清单

> **说明**: 以下清单基于代码库逐行分析生成，确保覆盖所有可交互UI元素
> 测试人员在执行测试时需逐项勾选确认已测试

### 57.1 顶级菜单 (7大类)
- [ ] **File菜单** (16项): New File / New Folder / Open File / Open Folder / Open Workspace / Open Recent / Save / Save As / Save All / Auto Save / Revert File / Close Editor / Close Window / Preferences / Exit
- [ ] **Edit菜单** (16项): Undo / Redo / Cut / Copy / Paste / Find / Replace / Find in Files / Replace in Files / Find Next / Find Previous / Select All / Toggle Line Comment / Toggle Block Comment / Format Document / Format Selection
- [ ] **Selection菜单** (8项): Select All / Expand Selection / Shrink Selection / Copy Line Up / Copy Line Down / Move Line Up / Move Line Down / Add Cursor Above/Below
- [ ] **View菜单** (18项): Command Palette / Explorer / Search / SCM / Run / Extensions / Problems / Output / Terminal / Debug Console / Toggle Sidebar / Toggle Panel / Toggle Status Bar / Toggle Menu Bar / Zoom In / Zoom Out / Reset Zoom / Full Screen
- [ ] **Go菜单** (10项): Back / Forward / Go to File / Go to Symbol in Editor / Go to Symbol in Workspace / Go to Line / Go to Bracket / Go to Definition / Go to References / Next/Previous Problem
- [ ] **Terminal菜单** (6项): New Terminal / Split Terminal / Kill Terminal / Hide Terminal / Clear Terminal / Configure Terminal Settings
- [ ] **Help菜单** (6项): About / Toggle Developer Tools / Report Issue / View License / Check for Updates / Welcome
- [ ] **Kairo菜单** (38+项): Import Kairo Project / Select Kairo Project / Build / Clean Build / Cancel Build / Start Server / Stop Server / Restart Server / Debug Server / Deploy / Redeploy / Open App / Open SQL Console / Open Test Results / Open Maven / Open TODOs / Open Performance Dashboard / Open Remote Development / Open Run Configurations / Tomcat Logs (Catalina/Localhost/Manager/Host-Manager) / View (Builds/Servers/Deployments/Maven/TODOs) / Window (Toggle Terminal/Focus Editor/Focus Terminal/Focus Explorer/Keyboard Shortcuts) / Reconnect Agent

### 57.2 工具栏按钮 (10+个)
- [ ] New File / Save / Import Project / Select Project / Build / Clean Build / Start Server / Debug Server / Stop Server / Restart Server / Undo / Redo

### 57.3 状态栏可点击项 (12+个)
- [ ] 远程指示器 / Project / Encoding / Build / Server / Debug / Memory / LSP / HotSwap / Line/Column / Indentation / EOL / Language Mode / Notification Bell

### 57.4 活动栏图标 (10+个)
- [ ] Explorer / Search / SCM / Run and Debug / Extensions / Kairo Servers / Kairo Builds / Kairo Deployments / Kairo Maven / Kairo TODO

### 57.5 对话框按钮
- [ ] OK / Cancel / Yes / No / Save / Don't Save / Browse / Back / Next / Close(X)

### 57.6 表单控件类型
- [ ] 文本输入框 (Text Input): 路径/名称/主机/用户名/SQL语句等 (30+处)
- [ ] 密码输入框 (Password Input): 密码/数据库密码等 (3+处)
- [ ] 数字输入框 (Number Input): 端口/调试端口等 (5+处)
- [ ] 下拉选择框 (Select/Combobox): 编码/JDK/构建工具/数据库类型/Output通道等 (10+处)
- [ ] 复选框 (Checkbox): 自动构建/保存密码/断点启用等 (8+处)
- [ ] 单选按钮 (Radio Button): 认证方式等
- [ ] 文件选择器 (File Dialog): Browse按钮触发 (5+处)
- [ ] 文本域 (Textarea): VM参数/环境变量值/SQL编辑器 (5+处)
- [ ] 按钮 (Button): 所有可点击按钮 (80+个)
- [ ] 标签页 (Tab): 底部面板标签/日志标签/结果标签 (15+个)
- [ ] 链接 (Link/Anchor): Open App URL等 (3+处)
- [ ] 折叠/展开箭头 (Tree Arrow): 资源管理器/变量/调用栈树 (多处)
- [ ] 右键菜单项 (Context Menu): 编辑器/文件树/面板右键菜单 (30+项)

### 57.7 底部面板标签 (5个)
- [ ] Problems / Output / Terminal / Debug Console / (Tomcat Logs独立)

### 57.8 快捷键绑定验证
- [ ] Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+W / Ctrl+Z / Ctrl+Y / Ctrl+F / Ctrl+H / Ctrl+Shift+F / Ctrl+Shift+H / Ctrl+Shift+P / Ctrl+` / F5 / F10 / F11 / Shift+F5 / Ctrl+Shift+E / Ctrl+Shift+G / Ctrl+Shift+D / Ctrl+Shift+X / Alt+F12 / 双击Shift

---

## 58. 缺陷报告模板

发现缺陷时请使用以下模板记录：

```
### 缺陷ID: KAIRO-BUG-YYYYMMDD-NNN
**严重程度**: P0(阻塞)/P1(严重)/P2(一般)/P3(轻微)
**测试阶段**: [如：菜单测试/构建测试/调试测试/SQL控制台测试/导入向导测试]
**测试环境**: Windows 10/11 x64, JDK 1.6.0_45, Tomcat 6.0.x, Kairo IDE vX.Y.Z
**exe版本类型**: NSIS安装版 / ZIP便携版
**重现步骤**:
1. 
2. 
3. 

**预期结果**:

**实际结果**:

**控制台错误**: (如有，请粘贴DevTools Console完整错误栈)

**截图/录屏**: (如可能，请附上截图或GIF录屏)

**复现概率**: 100% / 50% / 偶发(N次中M次)

**workaround**: (如有临时解决方案)

**附加说明**:
```

---

## 附录A: 测试优先级定义

| 优先级 | 定义 | 发布标准 |
|--------|------|----------|
| P0 | 阻塞性缺陷 - 核心功能完全不可用，崩溃，数据丢失，exe无法启动/安装/卸载 | 必须全部修复(0个P0 Bug) |
| P1 | 严重缺陷 - 重要功能异常，有明确workaround但影响正常使用 | 必须全部修复(0个P1 Bug) |
| P2 | 一般缺陷 - 次要功能问题，UI显示问题，不影响核心使用 | 尽量修复(≤5个P2可接受) |
| P3 | 轻微缺陷 - 文案、样式、建议优化、边缘场景 | 可延后修复 |

## 附录B: P0测试项清单 (发布必须通过)

共 **180+** 个P0测试项，必须100%通过才能发布：

**安装与启动 (23项)**
- NSIS安装程序P0项 (11项)
- 启动/关闭P0项 (12项)

**EXE安全与进程 (8项)**
- EXE进程树/端口绑定/外部链接/窗口标题/DevTools默认关闭

**窗口与布局 (9项)**
- 窗口基础功能P0项 (9项)

**菜单栏 (40+项)**
- File菜单P0项 (11项)
- Edit菜单核心P0项 (8项)
- View菜单核心P0项 (6项)
- Kairo菜单核心P0项 (所有Build/Server/Debug/Import/Open App)
- Terminal菜单P0项 (3项)
- Help菜单About P0项 (1项)

**工具栏 (8项)**
- 工具栏所有P0按钮 (Build/Start/Stop/Debug/Save/Import等)

**状态栏 (8项)**
- 状态栏核心P0项 (Project/Encoding/Build/Server/Debug/LSP)

**活动栏 (5项)**
- Explorer/Search/Run and Debug / Kairo Servers/Builds/Deployments

**核心功能面板 (100+项)**
- 欢迎页面P0项 (9项): New Project/Open Project/Open App
- 导入向导P0项 (25+项): 所有步骤的Browse/Scan/输入/Next/Back/Import/Cancel
- 资源管理器P0项 (10项)
- 编辑器P0项 (15项): 编辑/保存/查找替换/语法高亮
- 编码功能P0项 (6项): GBK显示/切换/重新打开
- 构建视图P0项 (12项): Build/Clean/Cancel/状态/诊断
- 服务器视图P0项 (18项): Start/Stop/Debug/Restart/Open App/状态/HotSwap
- 部署视图P0项 (4项)
- 日志查看器P0项 (10+项): 标签切换/暂停/清空/中文显示
- 运行配置P0项 (18+项): 新建/保存/端口/JDK/VM参数/启动/调试
- 调试功能P0项 (20+项): 断点/Continue/Step/Variables/Call Stack
- 终端P0项 (5项)
- 全局搜索P0项 (8项): Ctrl+Shift+F/结果跳转/GBK搜索
- 通知中心P0项 (4项): Build/Server操作通知
- 命令面板P0项 (8项): Ctrl+Shift+P/命令执行/无Command not found
- 对话框P0项 (5项): Save/Don't Save/Cancel/OK/Esc关闭
- SQL控制台P0项 (5项): 连接/执行/结果
- 输出面板P0项 (4项): 打开/通道切换/Build日志/Tomcat日志

**附录C: 测试执行时间估算**

| 测试阶段 | 预计时间 | 累计时间 |
|----------|----------|----------|
| 环境准备+安装测试 | 30分钟 | 0.5小时 |
| 启动关闭+窗口基础+EXE安全 | 20分钟 | 0.8小时 |
| 菜单全量测试(7大类) | 40分钟 | 1.5小时 |
| 工具栏+状态栏+活动栏 | 20分钟 | 1.8小时 |
| 欢迎页面+导入向导 | 30分钟 | 2.3小时 |
| 资源管理器+编辑器+查找替换+编码 | 30分钟 | 2.8小时 |
| 构建视图+服务器视图 | 30分钟 | 3.3小时 |
| 部署+日志查看器+运行配置 | 30分钟 | 3.8小时 |
| 调试功能+断点高级+子面板 | 40分钟 | 4.5小时 |
| SQL控制台+Maven+Test+TODO | 20分钟 | 4.8小时 |
| Problems+Output+Terminal | 20分钟 | 5.2小时 |
| 全局搜索+Search Everywhere | 15分钟 | 5.4小时 |
| SCM(Git/SVN)+本地历史+书签 | 15分钟 | 5.7小时 |
| 快捷键速查+Keymaps+性能仪表板 | 15分钟 | 5.9小时 |
| 远程开发+通知中心+设置 | 20分钟 | 6.3小时 |
| 命令面板+大文件+焦点导航+对话框 | 20分钟 | 6.6小时 |
| 无障碍+多实例+文件关联+卸载 | 20分钟 | 6.9小时 |
| EXE日志检查+控制台错误全程监控 | 10分钟 | 7.1小时 |
| 全量交互元素复核 | 20分钟 | 7.4小时 |
| **总计** | **约7-8小时** | |

---

**文档结束**

> 本测试文档基于对 Kairo IDE 代码库的全面深度逐行分析编写，
> 覆盖了Electron主进程/preload脚本、所有菜单贡献(38+Kairo菜单项)、
> 所有命令注册(100+commands)、所有widget组件(55+个)、
> 所有表单控件(输入框/下拉/复选框/按钮共200+个交互元素)、
> 所有对话框、快捷键、状态栏项、活动栏图标、底部面板标签等。
> 测试时请按章节顺序逐项点击验证，不要遗漏任何P0和P1项。
> exe版本测试需特别关注进程管理、单实例锁、CSP安全策略、外部链接处理、
> GBK编码中文显示、Windows路径兼容性、安装/卸载完整性等exe特有问题。
