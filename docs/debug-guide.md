# Kairo IDE — Debug 调试指南

> 适用版本：Kairo IDE v0.1.0+
> 最后更新：2026-07-23

本文档详细说明在 Kairo IDE 中调试 Java Web 应用程序的完整流程，包括断点设置、调试视图使用、单步执行、Servlet 调试和高级调试功能。

---

## 目录

1. [快速开始](#1-快速开始)
2. [断点类型](#2-断点类型)
3. [调试视图](#3-调试视图)
4. [单步执行](#4-单步执行)
5. [调试 Servlet](#5-调试-servlet)
6. [高级调试（实验性）](#6-高级调试实验性)
7. [调试故障排查](#7-调试故障排查)

---

## 1. 快速开始

### 1.1 基本调试流程

以下是 Kairo IDE 中调试 Java Web 应用的标准流程：

#### 第一步：设置断点

点击代码行号左侧的空白区域，出现红色圆点表示断点已设置。

```
 24│ public class LoginServlet extends HttpServlet {
 25│
 26●   protected void doPost(HttpServletRequest req, HttpServletResponse resp) {
 27│       String username = req.getParameter("username");
 28│       String password = req.getParameter("password");
 29│       // ...
 30│   }
```

#### 第二步：选择 Debug 运行配置

1. 在顶部工具栏中，从运行配置下拉菜单中选择 **Tomcat 6: Debug** 配置。
2. 如果还没有 Debug 配置，点击运行配置旁的 **编辑** 按钮创建：
   - **类型**：选择 `tomcat6`
   - **模式**：选择 `debug`
   - **JDK**：选择项目使用的 JDK 6
   - **调试端口**：默认 `8000`（可修改）

#### 第三步：启动 Debug

点击工具栏上的 **Debug** 按钮（虫子图标），或按快捷键：

| 平台 | 快捷键 |
|------|--------|
| Windows / Linux | `Shift+F9` 或 `F5` |
| macOS | `Ctrl+D` 或 `F5` |

IDE 会自动：
1. 构建项目（如需要）
2. 部署到 Tomcat
3. 以 JDWP 模式启动 Tomcat
4. 启动 Java Debug Adapter 并连接到 JDWP 端口

状态栏会依次显示：
- `Waiting` → `Connecting` → `Connected`
- 当连接成功时，状态栏显示 `Debug: connected`

#### 第四步：命中断点后的操作

当代码执行到断点处时：
1. 编辑器自动聚焦到断点行，该行高亮显示为蓝色
2. **Variables** 视图显示当前作用域内的所有变量
3. **Call Stack** 视图显示方法调用栈
4. **Debug Console** 可用，可以执行表达式

#### 第五步：停止调试

- 点击工具栏上的 **Stop** 按钮（红色方块）
- 或按快捷键 `Shift+F5`
- 或按 `F5`（Continue）让程序执行完毕

停止调试后：
- Debug Adapter 与 JDWP 的连接断开
- Tomcat 根据运行配置决定是否停止（默认不停止，方便下次调试）

### 1.2 调试快捷键速查

| 操作 | Windows / Linux | macOS | 说明 |
|------|----------------|-------|------|
| 启动 Debug | `F5` | `F5` | 以 Debug 模式启动 |
| 停止 Debug | `Shift+F5` | `Shift+F5` | 终止调试会话 |
| 切换断点 | `F9` | `F9` | 在当前行设置/取消断点 |
| Continue | `F8` | `F8` | 继续执行到下一个断点 |
| Step Over | `F10` | `F10` | 执行当前行，不进入方法 |
| Step Into | `F11` | `F11` | 进入方法内部 |
| Step Out | `Shift+F11` | `Shift+F11` | 跳出当前方法 |

---

## 2. 断点类型

### 2.1 行断点（Line Breakpoint）

**基本用法**：

1. 点击行号左侧的空白区域设置断点（红色实心圆点）
2. 再次点击移除断点
3. 右键点击断点标记可查看更多选项

**启用/禁用断点**：

- 右键点击断点 → 选择 **禁用断点**（断点变为灰色圆点）
- 再次右键 → 选择 **启用断点** 恢复
- 在 **Breakpoints** 视图中可以批量启用/禁用

**删除断点**：

- 点击红色断点圆点移除
- 或在 **Breakpoints** 视图中选择断点后按 `Delete`

### 2.2 条件断点（Conditional Breakpoint）

**适用场景**：只在特定条件下暂停执行，例如 `username.equals("admin")`。

**设置方法**：

1. 设置一个普通行断点
2. 右键点击断点标记 → 选择 **编辑条件**（Edit Condition）
3. 在弹出的输入框中输入 Java 表达式

**条件表达式示例**：

```java
// 仅当 username 为 "admin" 时暂停
username.equals("admin")

// 当计数器大于 100 时暂停
i > 100

// 当列表不为空时暂停
!list.isEmpty() && list.size() > 10

// 当请求参数包含特定值
req.getParameter("action") != null && req.getParameter("action").equals("delete")
```

**注意事项**：

- 条件表达式必须是有效的 Java 布尔表达式
- 表达式在当前作用域内求值，可以访问局部变量和字段
- 复杂的条件表达式可能影响调试性能
- 如果条件表达式抛出异常，断点将不会命中

### 2.3 命中次数断点（Hit Count Breakpoint）

**适用场景**：断点触发 N 次后才暂停，例如循环中的第 100 次迭代。

**设置方法**：

1. 设置一个普通行断点
2. 右键点击断点标记 → 选择 **编辑命中次数**（Edit Hit Count）
3. 输入一个正整数（如 `100`）

当代码执行到该断点第 100 次时才会暂停。之前的 99 次都会正常通过。

**适用场景**：

- 调试循环中特定迭代次数的问题
- 跳过前 N 次正常执行，捕获异常情况
- 调试高频调用的方法

### 2.4 日志断点（Logpoint）

**适用场景**：不暂停执行，仅输出日志消息。适合调试不能中断的关键流程。

**设置方法**：

1. 设置一个普通行断点
2. 右键点击断点标记 → 选择 **编辑日志消息**（Edit Log Message）
3. 输入日志消息，用 `{}` 引用变量

**日志消息示例**：

```java
// 输出变量的值
用户登录: username={username}, ip={req.getRemoteAddr()}

// 输出方法参数
处理订单: orderId={orderId}, amount={amount}

// 输出循环状态
处理第 {i} 条记录，共 {list.size()} 条
```

日志断点会输出到 **Debug Console**，不会中断程序执行。这在调试 Servlet 请求处理时特别有用，可以避免频繁暂停影响用户体验。

### 2.5 异常断点（Exception Breakpoint）

**适用场景**：在抛出异常时自动暂停，无论异常在哪里发生。

**设置方法**：

1. 打开 **Breakpoints** 视图
2. 点击工具栏中的 **+** 按钮 → 选择 **异常断点**（Exception Breakpoint）
3. 选择异常类型：
   - **捕获的异常**（Caught Exceptions）：在 try-catch 捕获的异常处暂停
   - **未捕获的异常**（Uncaught Exceptions）：在未被捕获的异常处暂停

**推荐配置**：

对于遗留 Java Web 项目调试，建议添加以下异常断点：

- `NullPointerException`：最常见的运行时异常
- `SQLException`：数据库操作异常
- `ServletException`：Servlet 执行异常
- `IOException`：I/O 操作异常

---

## 3. 调试视图

### 3.1 Variables 视图

**功能**：查看和修改变量值。

**查看变量**：

- 展开变量树可以查看对象的字段
- 点击变量值可以复制
- 右键变量 → **Copy Value** 复制值

**修改变量值**：

1. 在 Variables 视图中双击变量值
2. 输入新值
3. 按 `Enter` 确认

```
Variables
├── this: LoginServlet
│   ├── userDao: UserDao@1234
│   └── logger: Logger
├── req: HttpServletRequest
│   ├── method: "POST"
│   ├── parameters: {username=admin, password=***}
│   └── session: HttpSession
├── resp: HttpServletResponse
├── username: "admin"
└── password: "admin123"
```

**注意事项**：

- 修改 `final` 变量可能不会生效
- 修改基本类型变量（int, boolean, String 等）直接生效
- 修改对象引用可能受 JVM 限制

### 3.2 Call Stack 视图

**功能**：查看当前线程的方法调用栈。

**切换栈帧**：

- 点击调用栈中的任意方法，Variables 视图会切换到该栈帧的变量
- 编辑器会跳转到对应方法的代码位置

**示例调用栈**：

```
Thread [http-bio-8080-exec-1] (Suspended)
  LoginServlet.doPost(HttpServletRequest, HttpServletResponse) line: 26
  LoginServlet.service(HttpServletRequest, HttpServletResponse) line: 15
  HttpServlet.service(ServletRequest, ServletResponse) line: 764
  ApplicationFilterChain.internalDoFilter(...) line: 290
  ApplicationFilterChain.doFilter(...) line: 206
  StandardWrapperValve.invoke(...) line: 233
  StandardContextValve.invoke(...) line: 191
  ...
```

**适用场景**：

- 理解代码执行路径
- 定位问题发生的位置
- 查看不同层之间的数据传递

### 3.3 Watch 视图

**功能**：添加自定义监视表达式，实时查看求值结果。

**添加监视表达式**：

1. 在 **Watch** 视图中点击 **+** 按钮
2. 输入 Java 表达式
3. 表达式的值会实时更新

**常用监视表达式**：

```java
// 查看集合大小
list.size()

// 查看对象状态
user.isActive() && user.getRole().equals("admin")

// 计算表达式
order.getTotal() * taxRate

// 字符串操作
username != null ? username.toUpperCase() : "N/A"

// 查看请求参数
req.getParameter("action")
```

### 3.4 Breakpoints 视图

**功能**：集中管理所有断点。

**视图操作**：

| 操作 | 方法 |
|------|------|
| 启用/禁用所有断点 | 点击工具栏中的断点图标 |
| 删除所有断点 | 点击工具栏中的删除图标 |
| 按文件分组 | 选择分组方式 |
| 跳转到断点 | 双击断点条目 |
| 编辑断点属性 | 右键断点 → 编辑条件/命中次数/日志消息 |

**断点状态图标**：

| 图标 | 含义 |
|------|------|
| 实心红色圆点 | 已验证的有效断点 |
| 空心红色圆点 | 未验证的断点（代码未加载或位置无效） |
| 灰色圆点 | 已禁用的断点 |
| 红色圆点 + 等号 | 条件断点 |
| 红色圆点 + 数字 | 命中次数断点 |
| 红色菱形 | 日志断点 |

### 3.5 Threads 视图

**功能**：查看和切换调试线程。

**查看线程状态**：

- `Running`：线程正在执行
- `Suspended`：线程在断点处暂停
- `Waiting`：线程等待中
- `Blocked`：线程被阻塞

**切换线程**：

- 点击不同线程可以查看其调用栈和变量
- 当前活动的线程以高亮显示

**Tomcat 线程命名**：

Tomcat 工作线程通常命名为 `http-bio-8080-exec-N`，其中 `N` 是线程编号。在调试多线程并发问题时，识别不同请求的线程非常重要。

### 3.6 Debug Console

**功能**：执行 Java 表达式和查看日志断点输出。

**执行表达式**：

1. 在 Debug Console 底部输入框输入 Java 表达式
2. 按 `Enter` 执行
3. 结果会显示在控制台中

**表达式示例**：

```java
// 查看变量
username

// 调用方法
userDao.findById(1)

// 创建对象
new java.util.Date()

// 类型转换
((com.example.User) session.getAttribute("user")).getRole()
```

**注意事项**：

- 表达式在当前栈帧的上下文中求值
- 可以调用方法，但可能有副作用
- 复杂表达式可能超时

---

## 4. 单步执行

### 4.1 Step Over（F10）

**功能**：执行当前行，不进入方法内部。

**使用场景**：

- 当前行是对已知方法的调用，不需要跟踪进去
- 跳过库方法或框架代码
- 快速浏览代码流程

**示例**：

```java
 26●  String username = req.getParameter("username");  // F10: 执行此行
 27   String password = req.getParameter("password");  // 停在这一行
 28   User user = userDao.findByUsername(username);    // F10: 执行此行
 29   if (user == null) {                               // 停在这一行
```

按 `F10` 执行第 26 行，在第 27 行暂停。再按 `F10` 执行第 28 行（包括 `userDao.findByUsername()` 调用），在第 29 行暂停。

### 4.2 Step Into（F11）

**功能**：进入当前行调用的方法内部。

**使用场景**：

- 需要查看方法内部实现
- 调试自定义方法
- 追踪数据流转

**示例**：

```java
 28   User user = userDao.findByUsername(username);  // F11: 进入 findByUsername
```

按 `F11` 后，编辑器会跳转到 `UserDao.findByUsername()` 方法的内部：

```java
     public User findByUsername(String username) {
●        Connection conn = dataSource.getConnection();  // 现在停在这里
         PreparedStatement stmt = conn.prepareStatement(
             "SELECT * FROM users WHERE username = ?"
         );
         // ...
     }
```

### 4.3 Step Out（Shift+F11）

**功能**：执行完当前方法并返回到调用处。

**使用场景**：

- 不小心进入了不想调试的方法
- 当前方法剩余代码不需要逐步调试
- 快速返回到业务逻辑层

**示例**：

当前在 `UserDao.findByUsername()` 内部，按 `Shift+F11` 后，会执行完该方法并返回到调用处：

```java
 28   User user = userDao.findByUsername(username);  // 执行完成
 29●  if (user == null) {                               // 停在这里
 30       resp.sendError(401, "用户不存在");
```

### 4.4 Continue（F8）

**功能**：继续执行到下一个断点或程序结束。

**使用场景**：

- 当前断点处的代码已检查完毕
- 跳到下一个感兴趣的断点
- 让程序恢复正常运行

**注意**：如果后续没有断点，程序会正常运行直到结束（或下一个请求触发断点）。

---

## 5. 调试 Servlet

### 5.1 完整调试流程

以下是在 Kairo IDE 中调试 Servlet 的完整步骤：

#### 步骤 1：设置断点

在 Servlet 的 `doGet` 或 `doPost` 方法中设置断点：

```java
public class LoginServlet extends HttpServlet {
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {
●       String username = req.getParameter("username");  // 在这里设置断点
        String password = req.getParameter("password");

        User user = userDao.findByUsername(username);
        if (user == null) {
            resp.sendError(401, "用户不存在");
            return;
        }
        // ...
    }
}
```

#### 步骤 2：启动 Tomcat Debug 模式

1. 选择运行配置：**Tomcat 6: Debug**
2. 点击 **Debug** 按钮（`F5`）
3. 等待状态栏显示 `Debug: connected`

#### 步骤 3：浏览器访问 Servlet URL

在浏览器中访问对应的 Servlet URL：

```
http://localhost:8080/legacy/login
```

或通过 Kairo IDE 的 **Open Browser** 按钮打开。

#### 步骤 4：命中断点

当请求到达 Servlet 时，IDE 会自动：
1. 编辑器聚焦到断点行，高亮为蓝色
2. Variables 视图显示 `req`、`resp` 等变量
3. Call Stack 视图显示完整的调用链

#### 步骤 5：查看请求参数和会话属性

在 **Variables** 视图中展开 `req` 对象：

```
req: HttpServletRequest
├── method: "POST"
├── requestURI: "/legacy/login"
├── parameters:
│   ├── username: "admin"
│   └── password: "admin123"
├── session: HttpSession
│   ├── id: "A1B2C3D4E5F6"
│   └── attributes:
│       └── user: User@5678
└── headers:
    ├── User-Agent: "Mozilla/5.0..."
    └── Content-Type: "application/x-www-form-urlencoded"
```

#### 步骤 6：单步调试

使用 `F10`（Step Over）逐行执行，观察变量变化：

```java
●   String username = req.getParameter("username");  // username = "admin"
    String password = req.getParameter("password");  // password = "admin123"
    User user = userDao.findByUsername(username);     // 按 F11 进入查看 SQL 查询
    if (user == null) {                               // user = User@5678
        resp.sendError(401, "用户不存在");
        return;
    }
```

#### 步骤 7：停止调试

完成调试后，按 `Shift+F5` 停止调试会话。Tomcat 默认继续运行，方便下次调试。

### 5.2 查看请求参数

在 **Watch** 视图中添加以下表达式来查看请求详情：

```java
// 查看所有请求参数
req.getParameterMap()

// 查看特定参数
req.getParameter("username")

// 查看请求方法
req.getMethod()

// 查看请求 URL
req.getRequestURI()

// 查看 Session ID
req.getSession().getId()

// 查看 Session 属性
req.getSession().getAttribute("user")
```

### 5.3 调试 Filter 和 Listener

在 Filter 和 Listener 中设置断点的方法与 Servlet 相同：

```java
// Filter 调试
public class AuthFilter implements Filter {
    public void doFilter(ServletRequest req, ServletResponse resp,
                         FilterChain chain) {
●       HttpSession session = ((HttpServletRequest) req).getSession();  // 断点
        if (session.getAttribute("user") == null) {
            ((HttpServletResponse) resp).sendRedirect("/login.jsp");
            return;
        }
        chain.doFilter(req, resp);
    }
}
```

### 5.4 调试表单提交

调试表单提交时，注意以下要点：

1. **GET 请求**：参数在 URL 中，通过 `req.getParameter()` 获取
2. **POST 请求**：参数在请求体中，需要注意编码（尤其是 GBK 项目）
3. **文件上传**：使用 `multipart/form-data` 编码，需要特殊处理

**调试 POST 中文参数**：

```java
// 在 doPost 中设置断点后，在 Debug Console 中执行：
req.setCharacterEncoding("GBK");
// 然后查看参数
req.getParameter("username")
```

---

## 6. 高级调试（实验性）

### 6.1 HotSwap（热替换）

**功能**：修改代码后热替换到运行中的 JVM，无需重启 Tomcat。

**限制（v1 实验性）**：

- 仅支持方法体内部的修改
- 不支持添加/删除方法、字段、类
- 不支持修改方法签名
- Java 6 JVM 的 HotSwap 支持有限
- 不承诺无条件可用

**使用步骤**：

1. 在 Debug 模式下修改代码
2. 保存文件（`Ctrl+S` / `Cmd+S`）
3. IDE 会尝试将修改热替换到运行中的 JVM
4. 状态栏显示 HotSwap 结果：
   - 绿色：热替换成功
   - 黄色：需要重新部署
   - 红色：需要重启 Tomcat

**注意事项**：

- 如果 HotSwap 失败，需要重新构建和部署
- 界面上的 Hot Reload 状态指示器会显示当前变更的生效方式
- 对于 Java 6 目标 JVM，HotSwap 的可靠性低于 Java 8+

### 6.2 JSP 断点（实验性）

**功能**：在 JSP 文件中设置断点。

**前提条件**：

- 需要开启实验性 flag
- JSP 文件需要编译为 Servlet 后才能调试
- 生成的 Servlet 源码与 JSP 源码需要映射关系

**使用步骤**：

1. 在 JSP 文件中点击行号左侧设置断点（橙色圆点，表示实验性断点）
2. 以 Debug 模式启动 Tomcat
3. 浏览器访问 JSP 页面
4. 如果源映射正确，IDE 会在 JSP 源码中暂停
5. 如果源映射不正确，IDE 会在生成的 Servlet 源码中暂停

**已知限制**：

- JSP 断点功能在 v1 中标记为实验性
- Tomcat 6 生成的 Servlet 源映射可能不精确
- 建议在对应的 Java 逻辑代码中设置断点作为替代方案

### 6.3 远程调试（Remote Debug）

**功能**：连接到远程 Tomcat 实例的 JDWP 端口。

**适用场景**：

- 调试部署在远程服务器上的 Tomcat
- 调试无法在本地运行的生产环境问题（需要权限）

**前提条件**：

1. 远程 Tomcat 需要以 JDWP 模式启动：
   ```bash
   # 在远程 Tomcat 启动参数中添加
   export CATALINA_OPTS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000"
   ```
2. 确保网络连通，防火墙允许 JDWP 端口访问

**使用步骤**：

1. 在 IDE 中创建 **远程调试** 运行配置
2. 填写远程主机地址和 JDWP 端口
3. 点击 Debug 启动
4. IDE 会连接到远程 JDWP 端口

**安全警告**：

- JDWP 协议不加密，不要在公网暴露 JDWP 端口
- 远程调试应仅在受控网络环境中使用
- Kairo IDE v1 仅支持本地调试（`127.0.0.1`），远程调试需要额外配置

### 6.4 Attach 模式

**功能**：附加到已经运行的 Tomcat 实例。

**适用场景**：

- Tomcat 已经在运行，不想重启
- 调试生产环境中的问题（需要权限）

**使用步骤**：

1. 确保 Tomcat 已以 JDWP 模式启动（`suspend=n`）
2. 在 IDE 中创建 **Attach** 运行配置
3. 填写 JDWP 端口（默认 `8000`）
4. 点击 Debug 附加
5. IDE 连接到运行中的 Tomcat，无需重启

**配置示例**（`.kairo/run-configurations/attach.json`）：

```json
{
  "version": 1,
  "name": "Attach to Tomcat",
  "type": "tomcat6",
  "mode": "attach",
  "server": {
    "debugPort": 8000
  }
}
```

---

## 7. 调试故障排查

### 7.1 断点不命中 — 检查清单

当断点不命中时，按以下顺序排查：

| 序号 | 检查项 | 操作 |
|------|--------|------|
| 1 | JDWP 是否启用 | 确认运行配置中 `mode` 为 `debug`，状态栏显示 `Debug: connected` |
| 2 | 断点是否有效 | 检查 Breakpoints 视图，断点应为实心红色圆点 |
| 3 | 断点是否禁用 | 检查断点是否为灰色圆点 |
| 4 | 条件是否满足 | 检查条件断点的表达式是否正确 |
| 5 | 源码是否匹配 | 修改源码后是否重新编译和部署 |
| 6 | 请求是否到达 | 添加日志输出确认代码是否被执行 |
| 7 | 断点位置是否有效 | 确保断点不在空行、注释行或方法签名上 |
| 8 | 类是否被加载 | 在类加载时设置断点确认 |

### 7.2 源码/class 不匹配

**现象**：断点命中后，编辑器显示的行与代码实际执行位置不一致，或变量信息不准确。

**原因**：

- 修改了源码但未重新编译
- 部署的是旧版本的 class 文件
- 编译时未包含调试信息（`-g:none`）

**解决方案**：

1. **重新构建和部署**
   ```bash
   # 在 IDE 中执行
   构建 → 清理 → 构建 → 部署
   ```

2. **确认编译参数包含调试信息**

   在构建配置中确保使用 `-g` 参数：
   ```bash
   javac -g -source 1.6 -target 1.6 src/**/*.java
   ```

3. **检查部署目录**

   确认 `WEB-INF/classes/` 中的 class 文件是最新的：
   ```bash
   ls -la WEB-INF/classes/com/example/LoginServlet.class
   ```

4. **清除 Tomcat 工作目录**

   Tomcat 可能会缓存旧的 class 文件：
   ```bash
   rm -rf bundled/tomcat6/work/Catalina/localhost/*
   ```

### 7.3 调试端口冲突

**现象**：启动 Debug 时报 `Address already in use` 错误。

**原因**：JDWP 调试端口（默认 `8000`）已被占用。

**解决方案**：

1. **检查端口占用**
   ```bash
   # macOS / Linux
   lsof -i :8000

   # Windows
   netstat -ano | findstr :8000
   ```

2. **终止占用进程**
   ```bash
   kill -9 <PID>  # macOS / Linux
   taskkill /F /PID <PID>  # Windows
   ```

3. **修改调试端口**

   在运行配置中修改 `debugPort`：
   ```json
   {
     "server": {
       "debugPort": 8001
     }
   }
   ```

### 7.4 Debug Adapter 崩溃恢复

**现象**：调试会话意外终止，状态栏显示 `Debug: error`，错误信息为 "Java Debug Adapter session ended unexpectedly"。

**恢复步骤**：

1. **检查 Adapter 日志**

   在 Debug Console 中查看 Adapter 输出，了解崩溃原因。

2. **检查 Adapter 配置**

   确认 `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND` 环境变量正确：
   ```bash
   echo $KAIRO_JAVA_DEBUG_ADAPTER_COMMAND
   ```
   值必须是一个存在的可执行文件的绝对路径。

3. **重启调试会话**

   - 停止当前调试会话
   - 在 **服务器** 面板中重启 Tomcat
   - 重新启动 Debug

4. **检查 Java 6 兼容性**

   如果目标 JVM 是 Java 6，现代 Java Debug Adapter 的 JDWP 协议兼容性可能不完整。这是已知限制（详见 `docs/BLOCKERS.md` B-004）。

   如果遇到此问题，可以：
   - 使用兼容的 Debug Adapter 版本
   - 参考 ADR-0016 中的兼容性矩阵
   - 查看诊断包中的 errors.txt 了解具体错误

### 7.5 调试诊断

如果调试问题持续存在，使用以下方法收集诊断信息：

1. **生成诊断包**

   执行 **Kairo: 生成诊断包**，诊断包中包含：
   - Debug Adapter 错误日志
   - 端口占用情况
   - 进程信息
   - 环境变量（包括 Debug Adapter 配置）

2. **查看详细日志**

   设置日志级别为 debug 以获取更详细的调试信息：
   ```bash
   export KAIRO_LOG_LEVEL=debug
   ```

3. **检查 Debug Adapter 可用性**

   在 IDE 命令面板中执行 **Kairo: 检查 Debug Adapter 状态** 查看 Adapter 是否可用及其配置信息。

---

## 附录：调试状态说明

Kairo IDE 的 Debug 状态栏会显示以下状态：

| 状态 | 图标 | 含义 |
|------|------|------|
| `unknown` | `$(debug-alt-small)` | 调试状态未知，尚未检查 |
| `unavailable` | `$(debug-alt-small)` | Debug Adapter 未配置或不可用 |
| `available` | `$(pass)` | Debug Adapter 已配置且可用 |
| `connecting` | `$(sync~spin)` | 正在连接 JDWP 端口 |
| `connected` | `$(debug-alt)` | 已连接，等待断点命中 |
| `paused` | `$(debug-pause)` | 在断点处暂停 |
| `terminated` | `$(debug-alt-small)` | 调试会话已终止 |
| `error` | `$(error)` | 调试出错，查看错误信息 |

状态栏 tooltip 会显示详细信息，包括服务器 ID、会话 ID 和错误消息。点击状态栏可以打开 Debug 视图。