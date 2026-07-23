# Kairo IDE — 故障排查指南

> 适用版本：Kairo IDE v0.1.0+
> 最后更新：2026-07-23

本文档覆盖 Kairo IDE 在使用过程中的常见问题及解决方案。如果问题仍未解决，请使用 **Kairo: 生成诊断包** 功能收集诊断信息并提交问题报告。

---

## 目录

1. [启动问题](#1-启动问题)
2. [项目导入问题](#2-项目导入问题)
3. [构建问题](#3-构建问题)
4. [搜索问题](#4-搜索问题)
5. [Tomcat 问题](#5-tomcat-问题)
6. [调试问题](#6-调试问题)
7. [编码问题](#7-编码问题)
8. [性能问题](#8-性能问题)
9. [诊断信息收集](#9-诊断信息收集)

---

## 1. 启动问题

### 1.1 IDE 无法启动

**现象**：双击图标无响应，或启动后立即退出。

**排查步骤**：

1. **检查 Node.js 版本**
   ```bash
   node --version
   ```
   Kairo IDE 要求 Node.js 20.10+。如果版本过低，请升级 Node.js。

2. **检查 pnpm 版本**
   ```bash
   pnpm --version
   ```
   要求 pnpm 9.x。如果未安装或版本不对：
   ```bash
   npm install -g pnpm@9
   ```

3. **检查端口占用**
   ```bash
   # macOS / Linux
   lsof -i :18080
   lsof -i :3000

   # Windows
   netstat -ano | findstr :18080
   netstat -ano | findstr :3000
   ```
   如果端口被占用，可以终止占用进程或修改端口配置。

4. **查看日志文件**

   日志文件位置：
   - macOS：`~/Library/Application Support/Kairo/logs/`
   - Windows：`%APPDATA%\Kairo\logs\`
   - Linux：`~/.config/kairo/logs/`

   查看最新日志：
   ```bash
   # macOS / Linux
   tail -100 ~/Library/Application\ Support/Kairo/logs/kairo.log

   # Windows
   type %APPDATA%\Kairo\logs\kairo.log
   ```

5. **清除缓存目录**

   如果日志中出现 `corrupted state` 或 `version mismatch` 错误，尝试清除缓存：
   ```bash
   # macOS
   rm -rf ~/Library/Application\ Support/Kairo/cache/

   # Windows
   rmdir /s /q %APPDATA%\Kairo\cache\

   # Linux
   rm -rf ~/.config/kairo/cache/
   ```

### 1.2 Agent 连接失败

**现象**：IDE 界面显示 "Agent 未连接" 或 "Runtime Agent 不可用"。

**排查步骤**：

1. **检查 Agent 进程是否运行**
   ```bash
   # macOS / Linux
   ps aux | grep kairo-runtime

   # Windows
   tasklist | findstr kairo-runtime
   ```

2. **检查 Agent 端口（默认 18080）**
   ```bash
   curl http://127.0.0.1:18080/api/v1/health
   ```
   正常响应应为 `{"status":"ok"}`。

3. **如果 Agent 进程不存在**，手动启动：
   ```bash
   # macOS
   /Applications/Kairo.app/Contents/Resources/bin/kairo-runtime --bind 127.0.0.1 --port 18080

   # Windows
   %LOCALAPPDATA%\Kairo\bin\kairo-runtime.exe --bind 127.0.0.1 --port 18080
   ```

4. **检查防火墙设置**

   确保防火墙未阻止本地回环地址 `127.0.0.1` 的通信。Agent 仅监听本地回环地址，不对外暴露。

5. **检查 KAIRO_RUNTIME_PORT 环境变量**

   如果设置了 `KAIRO_RUNTIME_PORT`，确保 IDE 中的连接配置与之匹配：
   ```bash
   echo $KAIRO_RUNTIME_PORT   # macOS / Linux
   echo %KAIRO_RUNTIME_PORT%  # Windows
   ```

### 1.3 JDT LS 启动失败

**现象**：Java 代码无补全、无错误提示，状态栏显示 "JDT LS 未就绪"。

**排查步骤**：

1. **检查 JDK 版本**

   JDT LS 需要 Java 17+ 运行：
   ```bash
   java -version
   ```
   如果版本低于 17，请安装 Java 17 或 21，并设置 `JAVA_HOME`。

2. **检查 JDT LS 缓存**
   ```bash
   # macOS
   ls -la ~/Library/Application\ Support/Kairo/bundled/jdtls/

   # Windows
   dir %APPDATA%\Kairo\bundled\jdtls\

   # Linux
   ls -la ~/.config/kairo/bundled/jdtls/
   ```

   如果缓存损坏，删除后重新下载：
   ```bash
   rm -rf ~/Library/Application\ Support/Kairo/bundled/jdtls/
   ```
   下次启动 IDE 时会自动重新下载。

3. **查看 JDT LS 日志**

   JDT LS 日志位置：
   - macOS：`~/Library/Application Support/Kairo/logs/jdtls.log`
   - Windows：`%APPDATA%\Kairo\logs\jdtls.log`
   - Linux：`~/.config/kairo/logs/jdtls.log`

   常见错误：
   - `UnsupportedClassVersionError`：JDK 版本不匹配，需要 Java 17+
   - `OutOfMemoryError`：JDT LS 堆内存不足，设置 `KAIRO_JDTLS_MAX_HEAP_MB=1024`
   - `Address already in use`：JDT LS 端口被占用

4. **手动设置 JDT LS 堆内存**
   ```bash
   export KAIRO_JDTLS_MAX_HEAP_MB=1024
   ```
   有效范围：256–4096 MB，默认 768 MB。

### 1.4 白屏 / 卡在加载界面

**现象**：IDE 窗口打开后显示白色或空白页面，无法进入主界面。

**排查步骤**：

1. **清除浏览器缓存（Browser 模式）**

   如果使用 localhost Browser 模式，清除浏览器缓存和站点数据。

2. **检查 WebView 版本（Desktop 模式）**

   确保系统 WebView 组件是最新版本：
   - macOS：系统自带，确保 macOS 更新到最新
   - Windows：确保 WebView2 Runtime 已安装

3. **禁用浏览器扩展**

   某些浏览器扩展（广告拦截器、脚本拦截器）可能阻止 Theia 前端加载。尝试以无扩展模式打开。

4. **检查控制台错误**

   - Desktop 模式：按 `Ctrl+Shift+I`（Windows）或 `Cmd+Option+I`（macOS）打开开发者工具
   - Browser 模式：按 `F12` 打开浏览器开发者工具

   查看 Console 面板中的错误信息。

5. **清除 Theia 前端缓存**
   ```bash
   # macOS
   rm -rf ~/Library/Application\ Support/Kairo/theia-cache/

   # Windows
   rmdir /s /q %APPDATA%\Kairo\theia-cache\

   # Linux
   rm -rf ~/.config/kairo/theia-cache/
   ```

---

## 2. 项目导入问题

### 2.1 编码检测错误

**现象**：项目导入后文件显示乱码，或编码指示器显示错误的编码。

**排查步骤**：

1. **手动指定编码**

   在项目导入向导中，展开 **高级设置**，为项目设置默认编码：
   - GBK 项目：选择 `GBK`（或 `GB18030`）
   - UTF-8 项目：选择 `UTF-8`

2. **查看编码指示器**

   打开文件后，查看状态栏右下角的编码指示器。如果编码不正确：
   - 点击编码指示器
   - 选择 **通过编码重新打开**
   - 选择正确的编码（如 `GBK`、`UTF-8`）

3. **为目录单独设置编码**

   如果项目包含混合编码（如 `src/` 是 GBK，`webapp/` 是 UTF-8），可以在 `.kairo/project.json` 中配置：
   ```json
   {
     "encoding": {
       "default": "GBK",
       "overrides": {
         "webapp/": "UTF-8",
         "src/main/resources/": "UTF-8"
       }
     }
   }
   ```

### 2.2 项目结构识别失败

**现象**：导入向导未能正确识别源码目录、Web 根目录或构建脚本。

**排查步骤**：

1. **检查 build.xml 是否存在**

   如果项目使用 Ant 构建，确保项目根目录中存在 `build.xml`。

2. **手动指定项目结构**

   在导入向导中，可以手动修改以下路径：
   - **源码目录**：通常为 `src/` 或 `src/main/java/`
   - **Web 根目录**：通常为 `WebRoot/`、`webapp/` 或 `src/main/webapp/`
   - **构建脚本**：`build.xml` 或自定义构建脚本
   - **输出目录**：`WEB-INF/classes/` 或 `build/classes/`

3. **检查 .kairo/project.json**

   确认项目配置保存在 `.kairo/project.json` 中：
   ```bash
   cat .kairo/project.json
   ```

### 2.3 JDK 配置问题

**现象**：项目导入后无法编译，提示"未配置 JDK"或"JDK 版本不匹配"。

**排查步骤**：

1. **设置 JAVA_HOME**

   确保系统环境变量 `JAVA_HOME` 指向正确的 JDK 目录：
   ```bash
   # macOS / Linux
   echo $JAVA_HOME
   export JAVA_HOME=/path/to/jdk6

   # Windows
   echo %JAVA_HOME%
   set JAVA_HOME=C:\path\to\jdk6
   ```

2. **在 IDE 中导入 JDK**

   在项目导入向导中，点击 **导入 JDK**，选择 JDK 6 的安装目录。Kairo IDE 会：
   - 验证 JDK 版本（需要 Java 6）
   - 记录 SHA-256 指纹
   - 将 JDK 复制到 `bundled/jdk/` 目录（只读）

3. **JDK 6 不可用时的回退**

   如果无法提供 JDK 6，Kairo IDE 会使用现代 JDK 的 `--release 6` 模式进行编译。状态栏会显示 **"模拟 v6"** 标记，项目配置中会增加 `compiler.compatibility: emulated-v6` 字段。

   注意：模拟模式与真实 JDK 6 编译结果可能存在差异，建议在正式环境使用真实 JDK 6。

### 2.4 大项目导入慢

**现象**：导入大型项目时耗时很长，或 IDE 长时间无响应。

**排查步骤**：

1. **查看索引进度**

   状态栏右侧会显示 JDT LS 索引进度。首次导入大型项目时，索引可能需要数分钟。

2. **排除不必要的目录**

   在 `.kairo/project.json` 中排除不需要索引的目录：
   ```json
   {
     "exclude": [
       "node_modules/",
       ".git/",
       "target/",
       "build/",
       "dist/"
     ]
   }
   ```

3. **暂停索引**

   在状态栏点击 JDT LS 状态，选择 **暂停索引**。需要时再恢复。

4. **跳过 node_modules**

   如果项目根目录包含 `node_modules`，确保已在排除列表中。该目录通常包含大量文件，会严重影响导入和索引速度。

---

## 3. 构建问题

### 3.1 Ant 构建失败

**现象**：Ant 构建报错，无法生成 war 包或编译产物。

**排查步骤**：

1. **检查 build.xml 语法**

   确保 `build.xml` 文件格式正确，不存在 XML 语法错误。在 IDE 中打开 `build.xml`，查看 Problems 面板中是否有 XML 错误。

2. **检查 Ant 版本**

   Kairo IDE 使用的 Ant 版本应与项目兼容。如果项目使用特定的 Ant 任务，可能需要导入额外的 Ant 库。

3. **检查 classpath 配置**

   确认 `build.xml` 中的 classpath 设置正确：
   - `WEB-INF/lib/` 中的 jar 文件是否存在
   - JDK 路径是否正确
   - 依赖的第三方库是否完整

4. **查看构建输出**

   在 **构建** 面板中查看完整输出，查找具体错误信息。

5. **手动执行构建排查**
   ```bash
   cd /path/to/project
   ant -f build.xml clean war
   ```

### 3.2 javac 编译错误

**现象**：`javac` 编译报错，无法生成 class 文件。

**排查步骤**：

1. **检查 JDK 版本**

   确认项目使用的 JDK 版本与源码兼容：
   ```bash
   java -version
   javac -version
   ```
   Java 6 项目应使用 JDK 6 的 `javac`。如果使用模拟模式，状态栏会显示 "模拟 v6"。

2. **检查编码设置**

   如果源码使用 GBK 编码，确保编译时指定了正确的编码：
   ```bash
   javac -encoding GBK -source 1.6 -target 1.6 src/**/*.java
   ```

3. **检查依赖 jar 包**

   确认 `WEB-INF/lib/` 中包含所有必要的依赖 jar 包。缺少的 jar 包会导致 `cannot find symbol` 错误。

4. **查看 Problems 面板**

   IDE 会将编译错误映射到 **Problems** 面板，点击错误可直接跳转到对应代码位置。

### 3.3 构建超时

**现象**：构建任务长时间未完成，最终超时。

**排查步骤**：

1. **增加超时时间**

   默认构建超时时间为 30 秒。如果项目较大，可以在运行配置中增加：

   在 `.kairo/run-configurations/*.json` 中：
   ```json
   {
     "build": {
       "type": "ant",
       "target": "war",
       "timeout": 120
     }
   }
   ```

2. **检查是否有死循环**

   查看构建输出，如果输出长时间没有变化，可能构建任务进入了死循环。可以取消构建任务。

3. **取消构建任务**

   在构建面板中点击 **取消** 按钮，或使用命令面板中的 **Kairo: 取消构建**。

### 3.4 端口占用

**现象**：构建或运行时报端口占用错误。

**排查步骤**：

1. **使用端口诊断工具**

   在 IDE 中执行 **Kairo: 生成诊断包**，诊断包中的 `ports.txt` 文件会列出所有端口占用情况。

2. **手动检查端口占用**
   ```bash
   # macOS / Linux
   lsof -i :18080
   lsof -i :8080
   lsof -i :8000
   lsof -i :5005

   # Windows
   netstat -ano | findstr :18080
   netstat -ano | findstr :8080
   netstat -ano | findstr :8000
   netstat -ano | findstr :5005
   ```

3. **终止占用端口的进程**
   ```bash
   # macOS / Linux
   kill -9 <PID>

   # Windows
   taskkill /F /PID <PID>
   ```

4. **修改端口配置**

   在运行配置中修改端口：
   ```json
   {
     "server": {
       "httpPort": 18080,
       "debugPort": 8000
     }
   }
   ```

   Kairo IDE 使用的默认端口：
   | 端口 | 用途 |
   |------|------|
   | 18080 | Agent HTTP 端口（开发模式） |
   | 8080 | Tomcat HTTP 端口 |
   | 8000 | JDWP 调试端口 |
   | 5005 | 备用调试端口 |

---

## 4. 搜索问题

### 4.1 搜索无结果

**现象**：搜索明明存在的文本，但结果显示 "No matches found"。

**排查步骤**：

1. **检查搜索范围**

   确认搜索范围是否正确：
   - 项目根目录
   - 指定目录
   - 当前模块
   - 当前文件
   - 选中范围

   在搜索面板中查看 **Scope** 下拉选项。

2. **检查文件编码**

   如果文件使用 GBK 编码但搜索时使用了 UTF-8 字符，可能无法匹配。确保搜索关键词的编码与文件编码一致。

3. **检查文件类型过滤**

   在搜索面板中查看 **包含/排除** 模式（include/exclude glob）：
   - `*.java`：仅搜索 Java 文件
   - `*.{java,jsp,xml}`：搜索 Java、JSP、XML 文件
   - 排除模式如 `node_modules/`, `.git/`, `target/`

4. **检查搜索选项**

   确认搜索选项设置正确：
   - **区分大小写**（Case Sensitive）：是否开启
   - **全词匹配**（Whole Word）：是否开启
   - **正则表达式**（Regex）：是否开启

### 4.2 搜索结果乱码

**现象**：搜索预览中显示乱码，但文件本身正确。

**排查步骤**：

1. **确认文件编码**

   在状态栏查看文件编码指示器。如果文件是 GBK 编码，但搜索结果以 UTF-8 显示，会出现乱码。

2. **重新指定编码搜索**

   在搜索面板中，如果文件是 GBK 编码，确保搜索条件中的文本也使用 GBK 编码输入。

3. **检查项目编码设置**

   在 `.kairo/project.json` 中确认项目编码设置：
   ```json
   {
     "encoding": {
       "default": "GBK"
     }
   }
   ```

### 4.3 搜索太慢

**现象**：搜索响应时间过长，或搜索结果延迟出现。

**排查步骤**：

1. **缩小搜索范围**

   将搜索范围从整个项目缩小到指定目录或模块。

2. **使用文件类型过滤**

   添加 `include` 模式限制搜索文件类型，减少需要扫描的文件数。

3. **检查项目大小**

   对于超过 10k 文件的项目，首次全文搜索可能需要 3 秒（冷缓存）。后续搜索应更快。

4. **查看搜索状态**

   搜索结果会流式分批返回，首批结果应在 300ms 内出现。如果超过此时间，检查是否有其他高负载任务在运行。

---

## 5. Tomcat 问题

### 5.1 Tomcat 启动失败

**现象**：点击启动后，Tomcat 状态显示 "error" 或启动后立即停止。

**排查步骤**：

1. **检查端口占用**
   ```bash
   # macOS / Linux
   lsof -i :8080

   # Windows
   netstat -ano | findstr :8080
   ```
   如果 Tomcat HTTP 端口被占用，终止占用进程或修改端口配置。

2. **检查 JDK 配置**

   Tomcat 6 需要 JDK 6 运行。确认 `JAVA_HOME` 指向正确的 JDK 6 目录。

3. **检查 catalina.bat / catalina.sh 权限**
   ```bash
   # macOS / Linux
   ls -la bundled/tomcat6/bin/catalina.sh
   chmod +x bundled/tomcat6/bin/*.sh

   # Windows
   # 确保 bundled/tomcat6/bin/ 目录可执行
   ```

4. **查看 Tomcat 日志**

   在 **日志查看器** 面板中查看 Tomcat 启动日志，或直接查看文件：
   ```bash
   # macOS / Linux
   tail -100 bundled/tomcat6/logs/catalina.out

   # Windows
   type bundled\tomcat6\logs\catalina.out
   ```

   常见错误：
   - `Address already in use`：端口被占用
   - `JAVA_HOME not set`：未设置 JAVA_HOME
   - `Unsupported major.minor version`：JDK 版本不兼容

5. **检查 Tomcat 6 二进制文件**

   Tomcat 6.0.53 在首次使用时自动下载到 `bundled/tomcat6/`。如果下载失败：
   ```bash
   # 手动下载（需要接受 EOL 通知）
   bash scripts/fetch-tomcat6.sh
   ```

### 5.2 部署失败

**现象**：构建成功但部署到 Tomcat 失败。

**排查步骤**：

1. **检查 war 包或目录结构**

   确认构建产物存在且结构正确：
   ```bash
   ls -la dist/legacy.war
   # 或
   ls -la dist/legacy/WEB-INF/
   ```

2. **检查 web.xml 格式**

   确认 `web.xml` 文件格式正确，符合 Servlet 2.4/2.5 规范。在编辑器中打开 `web.xml` 查看是否有 XML 语法错误。

3. **检查部署模式**

   在运行配置中确认部署模式：
   - `war`：部署 war 包
   - `exploded`：部署展开目录

4. **查看部署日志**

   在 **Tomcat 日志** 面板中查看部署相关日志。

### 5.3 应用无响应

**现象**：Tomcat 启动成功，但浏览器访问应用无响应。

**排查步骤**：

1. **检查 Tomcat 健康状态**

   在 **服务器** 面板中查看 Tomcat 状态。正常状态应为 "Running"。

2. **检查端口监听**
   ```bash
   # macOS / Linux
   curl http://127.0.0.1:8080/

   # Windows
   curl http://127.0.0.1:8080/
   ```

3. **检查防火墙**

   确保防火墙未阻止 Tomcat 端口的本地访问。Tomcat 仅监听 `127.0.0.1`，不对外暴露。

4. **查看应用日志**

   在 **Tomcat 日志** 面板中查看应用启动日志。

### 5.4 内存不足

**现象**：Tomcat 运行一段时间后崩溃，日志中出现 `OutOfMemoryError`。

**排查步骤**：

1. **调整 JVM 堆内存**

   在运行配置中增加 Tomcat JVM 参数：
   ```json
   {
     "server": {
       "jvmArgs": "-Xmx512m -Xms256m -XX:MaxPermSize=128m"
     }
   }
   ```

   对于 Java 6 项目，建议设置：
   - `-Xmx512m`：最大堆内存 512 MB
   - `-Xms256m`：初始堆内存 256 MB
   - `-XX:MaxPermSize=128m`：永久代最大 128 MB（Java 6/7）

2. **检查是否有内存泄漏**

   如果 Tomcat 在多次部署后内存持续增长，可能存在应用程序内存泄漏。检查 `ThreadLocal` 未清理、静态集合未释放等问题。

3. **减少部署频率**

   每次重新部署都会创建新的 ClassLoader，避免频繁热部署。

---

## 6. 调试问题

### 6.1 断点不命中

**现象**：设置了断点，但代码执行时未停在断点处。

**排查步骤**：

1. **确认 JDWP 已启用**

   在运行配置中确认 `debug` 模式已启用：
   ```json
   {
     "mode": "debug",
     "server": {
       "debugPort": 8000
     }
   }
   ```
   状态栏应显示 `Debug: connected`。

2. **检查断点状态**

   在 **Breakpoints** 视图中查看断点状态：
   - 实心红色圆点：已验证的有效断点
   - 空心红色圆点：未验证的断点（可能不在可执行代码上）
   - 灰色圆点：已禁用的断点

3. **确认源码与 class 匹配**

   如果修改了源码但未重新编译部署，运行的是旧 class 文件，断点位置可能不匹配。需要重新构建和部署。

4. **检查断点位置有效性**

   确保断点设置在可执行代码行上，而非：
   - 空行
   - 注释行
   - 类声明行
   - 方法签名行（不含可执行代码的部分）

5. **确认请求到达了目标代码**

   在浏览器中确认请求确实触发了相应代码。添加日志输出以验证代码是否被执行。

### 6.2 变量不可见

**现象**：调试时变量视图中部分变量显示 "Cannot evaluate" 或不可见。

**排查步骤**：

1. **检查编译优化**

   如果编译时开启了优化（`javac -O`），某些局部变量可能被优化掉。确保编译时未开启优化选项。

2. **检查调试信息**

   确认编译时包含调试信息：
   ```bash
   javac -g -source 1.6 -target 1.6 src/**/*.java
   ```
   `-g` 参数会生成所有调试信息（行号、局部变量、源文件）。

3. **检查变量作用域**

   确保查看的变量在当前栈帧的作用域内。切换 **Call Stack** 视图中的不同栈帧，查看对应作用域的变量。

### 6.3 连接超时

**现象**：调试启动后长时间显示 "connecting"，最终超时。

**排查步骤**：

1. **检查 JDWP 端口**
   ```bash
   # macOS / Linux
   lsof -i :8000

   # Windows
   netstat -ano | findstr :8000
   ```
   确认 Tomcat 已监听 JDWP 端口。

2. **检查防火墙**

   确保防火墙未阻止本地 JDWP 端口的连接。调试适配器仅连接 `127.0.0.1`。

3. **检查 Debug Adapter 配置**

   确认 `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND` 环境变量指向正确的 Debug Adapter 可执行文件：
   ```bash
   echo $KAIRO_JAVA_DEBUG_ADAPTER_COMMAND   # macOS / Linux
   echo %KAIRO_JAVA_DEBUG_ADAPTER_COMMAND%  # Windows
   ```

4. **增加超时时间**

   默认连接超时时间为 30 秒。如果 JDWP 连接建立较慢，可能需要等待更长时间。

### 6.4 Debug Adapter 崩溃

**现象**：调试会话意外终止，状态栏显示 "error"。

**排查步骤**：

1. **查看 Adapter 日志**

   在 Debug Console 中查看 Adapter 输出日志。

2. **重启调试会话**

   停止当前调试会话，重新启动 Tomcat 和调试。

3. **检查 Java 6 兼容性**

   已知问题：现代 Java Debug Adapter 主要针对 Java 8+ JDWP 协议。Java 6 JDWP 协议存在部分差异，可能导致 Adapter 异常。详见 `docs/BLOCKERS.md` B-004。

4. **查看已知限制**

   如果遇到 Java 6 特有的 JDWP 协议问题，参考 ADR-0016 中的兼容性矩阵和已知限制。

---

## 7. 编码问题

### 7.1 文件乱码

**现象**：打开文件后显示乱码。

**解决方案**：

1. **通过编码重新打开**

   点击状态栏右下角的编码指示器（如 "UTF-8"），选择 **通过编码重新打开**，然后选择正确的编码（如 GBK、GB18030、UTF-8）。

2. **设置项目默认编码**

   在 `.kairo/project.json` 中设置：
   ```json
   {
     "encoding": {
       "default": "GBK"
     }
   }
   ```

### 7.2 保存后编码变化

**现象**：编辑并保存文件后，文件的编码发生了变化。

**排查步骤**：

1. **检查自动编码检测设置**

   确保未启用自动编码检测。Kairo IDE 默认保持原有编码，不会自动转换。

2. **确认保存行为**

   打开文件后，状态栏会显示当前使用的编码。保存时，Kairo IDE 会：
   - 执行 round-trip 检查
   - 如果字符无法用当前编码表示，会抛出 `UnrepresentableEncodingError` 并拒绝保存
   - 弹出提示，要求用户选择正确的编码

3. **转换编码**

   如果需要转换文件编码：
   - 点击编码指示器
   - 选择 **通过编码保存**
   - 选择目标编码
   - 确认转换操作（需二次确认）

### 7.3 混合编码项目

**现象**：项目中不同目录使用不同编码。

**解决方案**：

在 `.kairo/project.json` 中配置目录级编码覆盖：
```json
{
  "encoding": {
    "default": "GBK",
    "overrides": {
      "webapp/": "UTF-8",
      "src/main/resources/": "UTF-8",
      "config/": "GBK"
    }
  }
}
```

每个文件的状态栏会显示其实际使用的编码。

---

## 8. 性能问题

### 8.1 IDE 运行缓慢

**现象**：编辑器响应慢、界面卡顿、操作延迟高。

**排查步骤**：

1. **检查内存使用**

   目标环境：2 vCPU / 4 GB RAM。Kairo IDE 稳态总内存应 < 1.2 GB（不含 Tomcat/JDK 6）。
   ```bash
   # macOS
   ps -o pid,rss,command | grep -i kairo

   # Windows
   tasklist /FI "IMAGENAME eq kairo*"
   ```

2. **检查项目大小**

   对于 10k+ 文件的项目，首次导入和索引可能需要较长时间。索引完成后性能会恢复正常。

3. **检查索引进度**

   状态栏会显示 JDT LS 索引进度。如果索引仍在进行中，Java 相关功能可能会有延迟。

4. **关闭不必要的面板**

   减少同时打开的工具窗口数量，每个面板都会消耗资源。

5. **大文件降级模式**

   当打开超大文件（2M 字符或 20k 行以上）时，编辑器会自动进入降级模式，关闭 minimap、folding、CodeLens、inlay hints 等特性。状态栏会显示 "Large" 或 "Huge" 模式。

   可以通过 **Large File: Toggle Full Editor Features** 暂时恢复完整功能。

### 8.2 内存泄漏

**现象**：长时间运行后 IDE 内存持续增长，最终导致系统变慢或崩溃。

**排查步骤**：

1. **监控内存使用**

   使用系统任务管理器或 Activity Monitor 监控 Kairo IDE 进程内存。

2. **重启 IDE**

   如果内存持续增长，建议每工作日结束时重启 IDE。Kairo IDE 设计为可快速重启，最近项目和配置会自动恢复。

3. **生成诊断包**

   使用 **Kairo: 生成诊断包** 收集内存使用数据，提交问题报告。

### 8.3 高 CPU 使用

**现象**：IDE 空闲时 CPU 使用率仍然很高。

**排查步骤**：

1. **检查后台任务**

   查看是否有后台任务在运行：
   - JDT LS 索引
   - 搜索任务
   - 构建任务
   - 文件监视器

2. **检查文件监视器**

   如果项目根目录下有大量文件变化（如日志文件持续写入），文件监视器可能持续高 CPU。在 `.kairo/project.json` 中排除不需要监视的目录：
   ```json
   {
     "exclude": [
       "logs/",
       "temp/",
       "work/",
       "target/",
       "build/"
     ]
   }
   ```

3. **暂停索引**

   在状态栏点击 JDT LS 状态，选择 **暂停索引**。

---

## 9. 诊断信息收集

### 9.1 如何生成诊断包

**操作步骤**：

1. 在 IDE 中，打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）
2. 搜索并执行 **Kairo: 生成诊断包**
3. 等待诊断信息收集完成（约 10–60 秒）
4. 在弹出的保存对话框中，选择保存位置
5. 诊断包会保存为 `kairo-diag-YYYYMMDD-HHMMSS.zip`

### 9.2 诊断包包含什么信息

诊断包（`kairo-diag-*.zip`）包含以下内容：

| 文件 | 内容 |
|------|------|
| `summary.json` | 版本信息、OS 信息、JDK 信息、JDT LS 信息、Tomcat 信息、磁盘使用情况 |
| `logs/agent.log` | Agent 最近 1000 行日志 |
| `logs/jdtls.log` | JDT LS 最近 1000 行日志 |
| `logs/tomcat.log` | Tomcat 最近 1000 行日志 |
| `processes.txt` | 当前运行的进程列表 |
| `ports.txt` | 端口占用情况 |
| `env.txt` | 环境变量（敏感信息已脱敏） |
| `errors.txt` | 最近 50 条错误信息 |

### 9.3 诊断包不包含什么

为保护用户隐私和安全，诊断包**明确排除**以下内容：

- 源代码文件
- `secrets.json`、`.env`、`*.jks`、`*.p12`、`*.key`、`*.pem`
- 密码、令牌、API 密钥（已在日志中脱敏）
- 数据库连接字符串（已在日志中脱敏）
- 审计日志（`.legacyflow/audit.log.ndjson`）

### 9.4 如何查看日志文件

日志文件位置（不通过诊断包直接查看）：

| 平台 | 日志目录 |
|------|----------|
| macOS | `~/Library/Application Support/Kairo/logs/` |
| Windows | `%APPDATA%\Kairo\logs\` |
| Linux | `~/.config/kairo/logs/` |

日志文件：
- `kairo.log`：Kairo IDE 主日志
- `jdtls.log`：JDT LS 日志
- `agent.log`：Runtime Agent 日志
- `tomcat.log`：Tomcat 运行日志

### 9.5 如何提交问题报告

提交问题报告时，请提供以下信息：

1. **诊断包**：使用 **Kairo: 生成诊断包** 功能生成并附上
2. **问题描述**：
   - 预期行为
   - 实际行为
   - 复现步骤
3. **环境信息**：
   - 操作系统版本
   - Kairo IDE 版本
   - JDK 版本
   - 项目规模和类型
4. **截图**：如果涉及 UI 问题，提供截图

---

## 附录：常用命令速查

### 端口检查
```bash
# macOS / Linux
lsof -i :18080  # Agent 端口
lsof -i :8080   # Tomcat 端口
lsof -i :3000   # Browser 模式端口
lsof -i :8000   # JDWP 调试端口

# Windows
netstat -ano | findstr :18080
netstat -ano | findstr :8080
netstat -ano | findstr :3000
netstat -ano | findstr :8000
```

### 进程管理
```bash
# macOS / Linux
ps aux | grep -i kairo
kill -9 <PID>

# Windows
tasklist | findstr kairo
taskkill /F /PID <PID>
```

### 缓存清除
```bash
# macOS
rm -rf ~/Library/Application\ Support/Kairo/cache/
rm -rf ~/Library/Application\ Support/Kairo/theia-cache/

# Windows
rmdir /s /q %APPDATA%\Kairo\cache\
rmdir /s /q %APPDATA%\Kairo\theia-cache\

# Linux
rm -rf ~/.config/kairo/cache/
rm -rf ~/.config/kairo/theia-cache/
```

### 健康检查
```bash
# Agent 健康检查
curl http://127.0.0.1:18080/api/v1/health

# Tomcat 健康检查
curl http://127.0.0.1:8080/
```

### 环境变量
```bash
# 设置 JDT LS 堆内存
export KAIRO_JDTLS_MAX_HEAP_MB=1024

# 设置 Agent 端口
export KAIRO_RUNTIME_PORT=18080

# 设置 Agent 绑定的地址
export KAIRO_RUNTIME_BIND=127.0.0.1

# 设置日志级别
export KAIRO_LOG_LEVEL=debug
```