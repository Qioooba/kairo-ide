# Kairo IDE 用户手册

> 版本：v0.1.0 | 更新日期：2026-07-23  
> 适用平台：Windows 10 / macOS  
> 目标用户：遗留 Java Web 项目维护开发者

---

## 目录

1. [产品概述](#1-产品概述)
2. [快速入门](#2-快速入门)
3. [项目管理](#3-项目管理)
4. [编码安全](#4-编码安全)
5. [代码编辑](#5-代码编辑)
6. [搜索](#6-搜索)
7. [构建与运行](#7-构建与运行)
8. [Tomcat 部署](#8-tomcat-部署)
9. [调试](#9-调试)
10. [Git 版本控制](#10-git-版本控制)
11. [测试](#11-测试)
12. [Oracle SQL（实验性）](#12-oracle-sql实验性)
13. [设置与配置](#13-设置与配置)

---

## 1. 产品概述

### 1.1 什么是 Kairo IDE

Kairo IDE 是一个**轻量级、跨平台的专用 IDE**，专为维护 JDK 1.6 / Tomcat 6 / Servlet / JSP / GBK 等遗留 Java Web 项目的开发者设计。

Kairo IDE 不是通用 IDE，也不是 VS Code 的换皮版本。它的核心竞争力在于：**用更低的资源消耗和更短的路径，完成遗留项目的维护工作**。

### 1.2 目标用户

- **后端/运维工程师**，维护一个 10 年以上历史的内部 Java Web 产品
- 开发环境：**Windows 10 云桌面，2 vCPU / 4 GB RAM，无管理员权限**，企业内网
- 项目特点：非标准目录结构、自定义 `src/`、`WebRoot/`、`lib/`、Ant `build.xml`、**GBK 与 UTF-8 混合编码**
- 技术栈：Tomcat 6.0.30 / 6.0.53、JDK 1.6、Oracle 11g
- 同一开发者可能需要在 **macOS 笔记本**（出差时）和 **Windows 云桌面** 之间切换

### 1.3 核心功能

| 功能 | 描述 |
|------|------|
| **项目导入** | 一键扫描遗留项目结构，自动识别目录布局和编码 |
| **编码安全** | GBK/UTF-8 混合编码检测、编码标签页指示、保存即保持编码 |
| **Java 编辑** | 基于 Eclipse JDT LS 的代码补全、跳转、引用查找、悬停提示 |
| **JSP/XML 编辑** | JSP 语法高亮、EL 表达式导航、web.xml 和 TLD 校验 |
| **搜索** | 全文搜索、文件搜索、类搜索、符号搜索、操作搜索、Search Everywhere |
| **构建** | Ant 构建、javac 编译、增量编译、构建输出和问题面板 |
| **Tomcat 部署** | 一键启动/停止/重启、热重载（JSP/CSS/JS）、服务器日志查看 |
| **调试** | 断点调试、变量查看、调用堆栈、单步执行、条件断点、异常断点 |
| **Git** | 变更视图、Diff 视图、提交前检查、历史记录、Blame 注释 |
| **测试** | JUnit 3/4 测试发现、运行、结果树 |

### 1.4 系统要求

| 项目 | 最低配置 |
|------|---------|
| **操作系统** | Windows 10（21H2+）/ macOS 12+ |
| **CPU** | 2 vCPU |
| **内存** | 4 GB RAM（推荐关闭其他大型应用） |
| **磁盘** | 500 MB 可用空间（不含 JDK 和项目文件） |
| **网络** | 企业内网（无需公网访问） |
| **JDK** | JDK 6（用于编译目标项目）+ JDK 17+（用于运行 JDT LS） |

---

## 2. 快速入门

### 2.1 安装与启动

#### Windows 桌面版

1. 从企业内部分发渠道获取 `Kairo-Setup.exe`
2. 双击安装，无需管理员权限
3. 安装完成后，从开始菜单或桌面快捷方式启动 Kairo IDE
4. 也可以直接运行 `%LOCALAPPDATA%\Kairo\Kairo.exe`

#### macOS 桌面版

1. 获取 `Kairo.dmg` 安装包
2. 将 Kairo 拖入 Applications 文件夹
3. 运行：

```bash
open /Applications/Kairo.app
```

#### 浏览器版（localhost）

```bash
kairo-server --bind 127.0.0.1 --port 3000
```

然后在浏览器中打开 `http://localhost:3000`。

### 2.2 首次启动

首次启动 Kairo IDE 时，你会看到 **欢迎页**：

1. 欢迎页引导你完成项目导入
2. 如果是全新安装且没有历史项目，会自动弹出**项目导入向导**
3. 点击 **Open Folder** 选择你的项目根目录，或点击 **Import Kairo Project** 启动导入向导

### 2.3 项目导入向导

项目导入向导会引导你完成以下步骤：

1. **选择项目目录**：选择包含 Java Web 项目的文件夹
2. **自动扫描**：Kairo 会扫描项目结构，识别：
   - 源码目录（`src/`）
   - Web 目录（`WebRoot/`）
   - 库目录（`lib/`）
   - 构建文件（`build.xml`）
   - 编码检测结果
3. **确认配置**：检查扫描结果，根据需要进行调整
4. **选择 JDK**：选择或导入 JDK（通常为 JDK 6），也可以注册其他版本的 JDK
5. **选择 Tomcat**：Kairo 内置了 Tomcat 6.0.53，也可以导入自定义版本
6. **打开工作区**：点击 **Open Workspace** 完成

### 2.4 配置 JDK 和 Tomcat

#### 配置 JDK

1. 在导入向导中，点击 **Import JDK**
2. 选择 JDK 安装目录（例如 `C:\Program Files\Java\jdk1.6.0_45`）
3. Kairo 会自动检测 JDK 版本和指纹信息
4. 确认后，该 JDK 将被注册到工具链中

也可以通过命令面板（`Ctrl+Shift+P`）执行 **Kairo: Switch JDK** 来切换 JDK。

#### 配置 Tomcat

1. 默认使用内置的 Tomcat 6.0.53（位于 `bundled/tomcat6/`）
2. 如需使用自定义 Tomcat，在导入向导中指定 Tomcat 安装目录
3. 配置内容包括端口、Context Path、JVM 参数等

### 2.5 首次构建和运行

1. 打开项目后，点击工具栏上的 **Build** 按钮（或执行 `Ctrl+Shift+B`）
2. 构建结果会显示在底部的 **Build Output** 面板中
3. 构建成功（`BUILD SUCCESS`）后，点击 **Start Server** 按钮
4. 服务器启动后，点击 **Open Application** 在浏览器中打开应用
5. 修改 JSP/CSS/JS 文件后**保存即生效**（热重载），无需重启 Tomcat

---

## 3. 项目管理

### 3.1 导入已有项目

有两种方式导入项目：

- **方式一：欢迎页** — 首次启动时自动显示欢迎页，点击 **Import Kairo Project**
- **方式二：菜单** — `File → Import Kairo Project...`
- **方式三：命令面板** — `Ctrl+Shift+P` → 输入 `Kairo: Import Project`

导入向导是**只读扫描**，不会修改你的项目文件。

### 3.2 最近项目

Kairo 会记住你最近打开的项目：

- 启动时欢迎页会显示最近项目列表
- 通过 `File → Open Recent` 快速打开
- 项目配置保存在 `.kairo/project.yaml` 中

### 3.3 项目结构视图

导入项目后，左侧 **Explorer** 面板会显示项目结构：

```
workspace/
├── src/                  # Java 源码目录
│   └── main/java/
├── WebRoot/              # Web 资源目录
│   ├── WEB-INF/
│   │   ├── lib/          # 依赖库
│   │   └── web.xml       # Web 部署描述符
│   ├── *.jsp             # JSP 页面
│   └── *.html
├── lib/                  # 编译依赖
├── build.xml             # Ant 构建文件
└── .kairo/               # Kairo 项目配置
    └── project.yaml
```

### 3.4 工作区设置

项目配置存储在 `.kairo/project.yaml` 中，包含：

```yaml
schemaVersion: 1
sourceLayout:
  src: src/
  webRoot: WebRoot/
  lib: lib/
  config: ''
  buildXml: build.xml
encoding:
  source: GBK
  jvm: UTF-8
java:
  languageServer:
    javaHome: /path/to/jdk17
  compiler:
    javaHome: /path/to/jdk6
    sourceLevel: '1.6'
    targetLevel: '1.6'
  runtime:
    javaHome: /path/to/jdk6
serverRuntime:
  type: tomcat6
  config:
    ports:
      http: 8080
      debug: 8000
    contextPath: /
```

可通过 `Kairo: Manage Run Configurations` 打开配置管理界面。

---

## 4. 编码安全

### 4.1 核心原则

Kairo 的核心编码原则是：**磁盘上的所有文件都是字节，绝不假设文件编码**。

- 不强制所有文件使用 UTF-8
- 保存时保持原编码不变（除非用户明确选择「以指定编码保存」）
- 工作区编码仅为**回退默认值**，不是强制要求

### 4.2 GBK/UTF-8 混合编码检测

Kairo 在项目导入时会自动检测每个文件的编码：

1. 检查 BOM（Byte Order Mark）
2. 使用启发式算法检测中文编码（GBK/GB2312/GB18030）
3. 显示检测结果供用户确认

### 4.3 编码标签页指示

每个打开的文件标签页上会显示编码信息：

- 编码标识显示在标签页标题旁边
- 底部状态栏显示当前文件的编码
- 编码不一致时会显示警告图标

### 4.4 如何修改文件编码

- **方式一**：右键点击文件 → `Change Encoding...` → 选择目标编码
- **方式二**：命令面板 → `Kairo: Change File Encoding`
- **方式三**：使用 `Save with Encoding` 以指定编码保存

### 4.5 编码警告

在以下情况会触发编码警告：

- 保存文件时检测到编码不一致
- 文件包含无法用当前编码表示的字型
- 以有损方式（如 GBK → ASCII）保存时，会弹出确认对话框

---

## 5. 代码编辑

### 5.1 Java 编辑

Kairo 基于 Eclipse JDT Language Server（JDT LS）提供完整的 Java 编辑体验：

#### 代码补全（Ctrl+Space）

- 输入代码时自动弹出补全建议
- 支持类名、方法名、变量名、关键字补全
- 支持 import 自动添加
- 按 `Ctrl+Shift+Space` 触发参数提示

#### 跳转定义（F12）

- 将光标放在标识符上，按 `F12` 跳转到定义
- 按 `Alt+F12` 在弹窗中预览定义
- 支持跨文件跳转

#### 查找引用（Shift+F12）

- 将光标放在标识符上，按 `Shift+F12` 查找所有引用
- 结果按文件分组显示在底部面板

#### 重命名（F2）

- 将光标放在标识符上，按 `F2` 进行重命名
- 会自动重命名所有引用该标识符的地方

#### 悬停提示（Hover）

- 将鼠标悬停在标识符上，显示类型信息、文档注释
- 按 `Ctrl+K Ctrl+I` 手动触发悬停提示

#### 快速修复（Ctrl+.）

- 当代码有错误或警告时，光标位置会出现灯泡图标
- 按 `Ctrl+.` 查看可用的快速修复建议
- 常见修复：添加 import、添加 throws 声明、移除未使用的变量等

### 5.2 JSP 编辑

#### 语法高亮

- JSP 指令（`<%@ page %>`、`<%@ include %>`）
- JSP 表达式（`<%= %>`）
- JSP 声明（`<%! %>`）
- JSP 脚本（`<% %>`）
- JSTL 标签（`<c:forEach>`、`<fmt:formatDate>`）
- HTML/CSS/JavaScript 嵌入代码

#### Java 导航

- 在 JSP 中也可以使用 Java 代码导航
- 识别 `<% %>` 脚本中的 Java 代码
- 跳转到 Java 类定义

#### EL 表达式支持

- `${}` 表达式的语法高亮
- EL 表达式中的变量导航
- 对 JSTL 标签库的内置支持

#### Taglib 支持

- 自动解析 TLD 文件
- 标签补全和属性提示
- 标签库 URI 校验

### 5.3 XML 编辑

#### web.xml 支持

- 基于 DTD 的语法校验
- 元素和属性补全
- 结构视图（XML Structure View）

#### TLD 文件支持

- TLD 文件解析和校验
- 标签定义跳转

#### DTD 校验

- 自动关联 DTD 声明
- 实时校验 XML 结构
- 错误和警告提示

### 5.4 编辑器设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 自动保存 | 开启 | 焦点离开编辑器时自动保存 |
| 面包屑导航 | 开启 | 编辑器顶部显示文件的层级路径 |
| 只读模式 | 关闭 | 对只读文件自动开启 |
| 自动换行 | 关闭 | 按 `Alt+Z` 切换 |
| 字体大小 | 14px | 可通过 `Ctrl+=`/`Ctrl+-` 调整 |
| 缩进大小 | 4 空格 | 可用 Tab/Space 切换 |
| 迷你地图 | 开启 | 右侧代码缩略图 |

### 5.5 代码导航

#### Go to File（Ctrl+Shift+N / Cmd+Shift+O）

- 按文件名快速搜索并打开文件
- 支持模糊匹配
- 显示文件路径

#### Go to Class（Ctrl+N / Cmd+O）

- 按类名搜索 Java 类
- 支持驼峰命名匹配
- 横跨整个工作区

#### Go to Symbol（Ctrl+Alt+Shift+N）

- 按符号名搜索
- 包括类、方法、字段、接口
- 显示符号类型图标

#### Go to Action（Ctrl+Shift+A / Cmd+Shift+A）

- 按操作名搜索所有可用命令
- 显示对应的快捷键
- 支持模糊搜索

#### Search Everywhere（双击 Shift）

- 统一的搜索入口
- 在文件、类、符号、操作四个维度搜索
- 支持分类筛选（All / Files / Types / Symbols / Actions）

### 5.6 重构

#### Organize Imports（Shift+Alt+O）

- 自动整理 import 语句
- 移除未使用的 import
- 添加缺失的 import
- 按字母排序

#### Safe Delete（Alt+Delete）

- 删除前检查所有引用
- 如果存在引用，显示引用列表
- 确认后安全删除

#### Extract Method（Ctrl+Shift+Alt+M）

- 选中代码块，提取为独立方法
- 自动推断参数和返回值
- 更新所有调用点

### 5.7 调用层次和类型层次

#### Call Hierarchy（Shift+Alt+H）

- 显示方法的调用者和被调用者
- 树形展开调用链
- 支持递归展开

#### Type Hierarchy（Shift+Alt+T）

- 显示类的继承关系
- 父类和子类树
- 接口实现关系

---

## 6. 搜索

### 6.1 Search Everywhere（双击 Shift）

双击 Shift 键打开 Search Everywhere 面板，这是 Kairo 的统一搜索入口：

- 默认在 **All** 维度搜索（文件、类、符号、操作）
- 可通过 Tab 键切换分类：Files / Types / Symbols / Actions
- 结果实时显示，支持模糊匹配
- 按 Enter 打开选中项，按 Esc 关闭

### 6.2 Find File（Ctrl+Shift+N / Cmd+Shift+O）

- 输入文件名进行搜索
- 支持路径片段匹配
- 结果显示文件路径

### 6.3 Find Class（Ctrl+N / Cmd+O）

- 输入类名进行搜索
- 支持驼峰命名匹配（如 `HS` 匹配 `HelloServlet`）
- 跨项目搜索

### 6.4 Find Symbol（Ctrl+Alt+Shift+N）

- 搜索所有代码符号
- 包括类、方法、字段、接口、枚举
- 显示符号类型和所在位置

### 6.5 Find Action（Ctrl+Shift+A / Cmd+Shift+A）

- 搜索所有可执行命令
- 显示命令对应的快捷键
- 执行选中命令

### 6.6 全文搜索（Ctrl+Shift+F）

- 在工作区中搜索文本内容
- 支持正则表达式
- 支持大小写敏感/不敏感
- 支持全词匹配

#### 搜索范围

- 当前文件
- 当前工作区
- 自定义文件夹

#### 搜索结果分组

- 按文件分组显示
- 显示匹配行和上下文
- 点击结果跳转到对应位置

#### 替换（Ctrl+Shift+H）

- 在搜索结果中替换文本
- 支持预览替换结果
- 支持单个替换和全部替换
- 支持撤销替换操作

### 6.7 搜索历史

- 自动保存最近的搜索关键词
- 按 ↑↓ 键浏览搜索历史
- 清除搜索历史

---

## 7. 构建与运行

### 7.1 构建配置

Kairo 支持两种构建模式：

#### Ant 构建

如果项目包含 `build.xml`，Kairo 自动识别并配置为 Ant 构建：

```xml
<!-- build.xml -->
<project name="legacy-app" default="build">
  <target name="build">
    <javac srcdir="src" destdir="WebRoot/WEB-INF/classes"
           source="1.6" target="1.6" encoding="GBK">
      <classpath>
        <fileset dir="lib" includes="*.jar"/>
        <fileset dir="WebRoot/WEB-INF/lib" includes="*.jar"/>
      </classpath>
    </javac>
  </target>
</project>
```

#### javac 构建

对于没有 Ant 的项目，Kairo 使用 javac 直接编译：

- 自动识别源码目录和 classpath
- 支持 `-source` 和 `-target` 选项
- 编译输出到 `WebRoot/WEB-INF/classes/`

### 7.2 构建操作

| 操作 | 命令 | 说明 |
|------|------|------|
| **Build** | `Kairo: Build` | 增量编译（只编译修改过的文件） |
| **Clean Build** | `Kairo: Clean Build` | 清理后重新编译 |
| **Build and Deploy** | `Kairo: Build and Deploy` | 编译后自动部署到 Tomcat |

### 7.3 构建输出和 Problems 面板

- **Build Output**：显示编译过程和输出
- **Problems 面板**：列出所有编译错误和警告
- 点击错误可直接跳转到对应代码位置
- 按 `F8` / `Shift+F8` 在问题之间导航

### 7.4 端口诊断

如果启动服务器时端口被占用，Kairo 会：

1. 显示端口冲突警告
2. 建议修改端口或停止占用端口的进程
3. 可通过 `Kairo: Manage Run Configurations` 修改端口配置

---

## 8. Tomcat 部署

### 8.1 服务器生命周期

Kairo 在左侧面板提供 **Kairo Servers** 视图，管理 Tomcat 服务器的完整生命周期：

| 操作 | 命令 | 说明 |
|------|------|------|
| **Start Server** | `Kairo: Start Server` | 启动 Tomcat 服务器 |
| **Start Server (Debug)** | `Kairo: Start Server (Debug)` | 以调试模式启动 |
| **Stop Server** | `Kairo: Stop Server` | 停止服务器 |
| **Restart Server** | `Kairo: Restart Server` | 重启服务器 |
| **Open Application** | `Kairo: Open Application` | 在浏览器中打开应用 |

### 8.2 热重载（Hot Reload）

Kairo 支持以下文件的热重载，**保存即生效，无需重启 Tomcat**：

- **JSP 文件**（`.jsp`）：保存后立即生效，Tomcat 自动重新编译
- **CSS 文件**（`.css`）：保存后刷新浏览器即可看到变化
- **JavaScript 文件**（`.js`）：保存后刷新浏览器即可

**注意**：Java 源文件（`.java`）修改后需要重新构建和部署。

### 8.3 服务器日志

**Kairo Tomcat Logs** 视图显示服务器的实时日志：

- 日志流自动滚动到最新行
- 支持日志级别过滤
- 日志包含时间戳和来源信息

### 8.4 部署配置

部署配置在 `project.yaml` 中：

```yaml
serverRuntime:
  type: tomcat6
  config:
    ports:
      http: 8080       # HTTP 端口
      debug: 8000      # JDWP 调试端口
    contextPath: /     # 应用上下文路径
    env:               # 环境变量
      JAVA_OPTS: '-Xmx512m -XX:MaxPermSize=128m'
```

---

## 9. 调试

### 9.1 设置断点

- 在代码行号左侧点击设置断点（红色圆点）
- 按 `F9` 切换断点
- 断点信息显示在 **Breakpoints** 面板中

### 9.2 启动调试

1. 点击 **Start Server (Debug)** 按钮，或执行 `Kairo: Start Server (Debug)`
2. Tomcat 将以 JDWP 调试模式启动
3. Java Debug Adapter 自动连接到 JDWP 端口
4. 调试会话启动后，控制区域显示调试工具栏

### 9.3 调试控制

| 操作 | 快捷键 | 说明 |
|------|--------|------|
| **Continue** | `F5` | 继续执行直到下一个断点 |
| **Pause** | `F6` | 暂停执行 |
| **Step Over** | `F10` | 单步跳过（不进入方法） |
| **Step Into** | `F11` | 单步进入（进入方法内部） |
| **Step Out** | `Shift+F11` | 跳出当前方法 |
| **Stop** | `Shift+F5` | 停止调试 |
| **Restart** | `Ctrl+Shift+F5` | 重启调试会话 |

### 9.4 调试视图

#### Variables 面板

- 显示当前作用域内的所有变量
- 展开对象查看字段值
- 支持修改变量值（实验性）

#### Call Stack 面板

- 显示当前调用堆栈
- 点击堆栈帧跳转到对应代码位置
- 显示线程信息

#### Watch 面板

- 添加自定义表达式
- 实时计算表达式值
- 支持复杂表达式

### 9.5 高级断点

#### 条件断点

- 右键点击断点 → **Edit Breakpoint**
- 输入条件表达式（如 `i > 10`）
- 只有条件为 true 时才触发断点

#### 命中计数

- 设置断点触发次数
- 如「第 5 次命中时暂停」

#### 日志断点（Logpoint）

- 不暂停执行，只输出日志
- 支持表达式插值
- 日志输出到 Debug Console

### 9.6 异常断点

- 在 **Breakpoints** 面板中配置异常断点
- 支持捕获异常和未捕获异常
- 可指定异常类型

### 9.7 Debug Console

- 执行 `Kairo: Open Debug Console` 打开调试控制台
- 在断点暂停时，可以执行表达式求值
- 显示日志断点输出

### 9.8 HotSwap（实验性）

- 在调试会话中修改代码后，尝试热替换类
- 仅支持方法体修改
- 不支持添加/删除方法或字段
- 状态显示在 **HotSwap** 面板中

### 9.9 远程调试（实验性）

- 支持通过 JDWP 连接到远程 JVM
- 配置远程调试连接参数
- 使用 `Kairo: Start Server (Debug)` 配置

---

## 10. Git 版本控制

### 10.1 Changes 视图

- 左侧面板的 **Source Control** 视图
- 显示已修改（Modified）、已暂存（Staged）、未跟踪（Untracked）文件
- 点击文件查看差异对比

### 10.2 Diff 视图

- 并排或内联显示文件变更
- 绿色表示新增，红色表示删除
- 支持逐行回退

### 10.3 提交（Commit）

- 输入提交信息
- 提交前检查（Pre-commit Check）：
  - 编码安全检查
  - 编译错误检查
  - 空提交信息检查
- 支持选择性提交（Stage 部分文件）

### 10.4 历史记录和 Blame

#### Git History

- 查看文件的提交历史
- 按时间线排列
- 显示提交者、提交信息、变更摘要

#### Git Blame

- 在编辑器左侧显示每行的最后修改者
- 鼠标悬停显示详细提交信息
- 点击跳转到对应提交

### 10.5 本地历史

- 即使没有 Git，Kairo 也保存文件的本地修改历史
- 右键点击文件 → **Local History** → **Show History**
- 查看历史版本、恢复、对比

---

## 11. 测试

### 11.1 JUnit 3/4 测试发现

Kairo 自动扫描项目中的 JUnit 测试类：

- 识别 `junit.framework.TestCase`（JUnit 3）
- 识别 `@Test` 注解（JUnit 4）
- 测试类在编辑器中显示「Run Test」按钮

### 11.2 运行测试

- 点击测试方法旁的 **Run Test** 按钮
- 右键点击测试类 → **Run All Tests**
- 通过命令面板执行 `Kairo: Run Tests`

### 11.3 测试树视图

- 左侧面板的 **Test** 视图
- 树形显示测试类和测试方法
- 绿色 ✓ 表示通过，红色 ✗ 表示失败
- 点击测试方法跳转到对应代码

### 11.4 测试结果

- 测试结果面板显示每个测试的执行状态
- 通过的测试显示耗时
- 失败的测试显示错误信息和堆栈跟踪
- 支持重新运行失败的测试

---

## 12. Oracle SQL（实验性）

> ⚠️ 此功能为实验性功能，可能不稳定。

### 12.1 连接配置

1. 打开 **SQL** 视图
2. 点击 **New Connection**
3. 填写连接信息：
   - Host: Oracle 数据库地址
   - Port: 1521（默认）
   - SID: 数据库 SID
   - Username / Password

### 12.2 SQL 编辑器

- 打开 `.sql` 文件或新建 SQL 编辑器
- 语法高亮支持
- 基础关键字补全
- 快捷键执行查询

### 12.3 查询执行

- 选中 SQL 语句，按 `Ctrl+Enter` 执行
- 结果以表格形式展示
- 支持分页显示

### 12.4 结果导出

- 导出为 CSV 格式
- 导出为 JSON 格式
- 选择导出范围（当前页 / 全部结果）

---

## 13. 设置与配置

### 13.1 设置搜索

- 通过 `File → Preferences → Settings` 打开设置
- 支持搜索设置项名称
- 设置分为 User（用户级）和 Workspace（工作区级）

### 13.2 键盘映射管理

- 通过 `Kairo: Open Keyboard Shortcuts` 打开键盘快捷键管理
- 查看所有快捷键绑定
- 按快捷键组合或命令名搜索
- 检测快捷键冲突
- 重置到默认设置

### 13.3 通知中心

- 点击右侧状态栏的通知图标打开通知中心
- 查看历史通知
- 清除通知
- 通知包括：构建完成、服务器状态、错误提示等

### 13.4 诊断中心

- 通过 `Help → Diagnostic Center` 打开
- 生成诊断包（包含日志、配置、环境信息）
- **不包含源代码和敏感信息**
- 用于问题排查和技术支持

### 13.5 遥测设置

- 默认开启基础使用数据收集
- 可通过 `File → Preferences → Telemetry Settings` 关闭
- 收集的数据包括：功能使用频率、性能指标、错误报告
- **不收集任何源代码或项目文件内容**

---

## 附录

### A. 常见问题

**Q: 为什么打开文件出现乱码？**

A: 右键点击文件标签 → `Change Encoding...` → 选择正确的编码（如 GBK）。也可以在项目导入时确认编码设置。

**Q: 构建失败，提示找不到 JDK？**

A: 执行 `Kairo: Switch JDK`，确保已导入正确的 JDK 6 路径。JDK 17+ 用于运行 JDT LS，JDK 6 用于编译目标项目。

**Q: 服务器启动失败，端口被占用？**

A: 执行 `Kairo: Manage Run Configurations`，修改 HTTP 端口或停止占用端口的进程。

**Q: 如何查看 Tomcat 日志？**

A: 左侧面板切换到 **Kairo Tomcat Logs** 视图。

**Q: 修改 Java 文件后如何生效？**

A: 需要重新构建和部署。点击 **Build and Deploy** 按钮即可。

### B. 快捷键速查

参见 `docs/keyboard-shortcuts.md` 和 `docs/quick-reference.md`。

### C. 相关文档

| 文档 | 内容 |
|------|------|
| `docs/BUILD.md` | 构建和开发指南 |
| `docs/RUN.md` | 运行指南 |
| `docs/architecture.md` | 架构设计 |
| `docs/product-requirements.md` | 产品需求 |
| `docs/keyboard-shortcuts.md` | 快捷键参考 |
| `docs/quick-reference.md` | 快速参考卡 |
| `docs/security.md` | 安全说明 |
| `docs/testing.md` | 测试指南 |