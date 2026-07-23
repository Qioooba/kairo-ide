# Kairo IDE 快速参考卡

> 一页速查 | 打印友好 | 版本 v0.1.0

---

## 最常用快捷键（Top 20）

| 操作 | Windows/Linux | macOS |
|------|--------------|-------|
| 命令面板 | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| 快速打开文件 | `Ctrl+P` | `Cmd+P` |
| Search Everywhere | `双击 Shift` | `双击 Shift` |
| 查找文件 | `Ctrl+Shift+N` | `Cmd+Shift+O` |
| 查找类 | `Ctrl+N` | `Cmd+O` |
| 查找操作 | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| 全文搜索 | `Ctrl+Shift+F` | `Cmd+Shift+F` |
| 编辑器内查找 | `Ctrl+F` | `Cmd+F` |
| 保存 | `Ctrl+S` | `Cmd+S` |
| 撤销 | `Ctrl+Z` | `Cmd+Z` |
| 跳转到定义 | `F12` | `F12` |
| 查找引用 | `Shift+F12` | `Shift+F12` |
| 重命名 | `F2` | `F2` |
| 代码补全 | `Ctrl+Space` | `Cmd+Space` |
| 快速修复 | `Ctrl+.` | `Cmd+.` |
| 切换断点 | `F9` | `F9` |
| 开始/继续调试 | `F5` | `F5` |
| 单步跳过 | `F10` | `F10` |
| 单步进入 | `F11` | `F11` |
| 切换终端 | `Ctrl+\`` | `Cmd+\`` |

---

## 常用命令

| 命令 ID | 说明 |
|---------|------|
| `Kairo: Import Project` | 导入遗留项目 |
| `Kairo: Build` | 增量编译 |
| `Kairo: Clean Build` | 清理后编译 |
| `Kairo: Build and Deploy` | 编译并部署到 Tomcat |
| `Kairo: Start Server` | 启动 Tomcat |
| `Kairo: Start Server (Debug)` | 调试模式启动 |
| `Kairo: Stop Server` | 停止 Tomcat |
| `Kairo: Restart Server` | 重启 Tomcat |
| `Kairo: Open Application` | 在浏览器中打开应用 |
| `Kairo: Switch JDK` | 切换 JDK |
| `Kairo: Open Keyboard Shortcuts` | 快捷键管理 |
| `Kairo: Manage Run Configurations` | 运行配置 |

---

## 调试快捷键

| 操作 | 快捷键 |
|------|--------|
| 切换断点 | `F9` |
| 开始调试 | `F5` |
| 继续 | `F5` |
| 单步跳过 | `F10` |
| 单步进入 | `F11` |
| 单步跳出 | `Shift+F11` |
| 停止调试 | `Shift+F5` |
| 重启调试 | `Ctrl+Shift+F5` |

---

## 导航快捷键

| 操作 | 快捷键 |
|------|--------|
| 跳转到定义 | `F12` |
| 预览定义 | `Alt+F12` |
| 查找引用 | `Shift+F12` |
| 跳转到实现 | `Ctrl+F12` |
| 下一个问题 | `F8` |
| 上一个问题 | `Shift+F8` |
| 调用层次 | `Shift+Alt+H` |
| 类型层次 | `Shift+Alt+T` |

---

## Java 重构快捷键

| 操作 | 快捷键 |
|------|--------|
| 整理 Import | `Shift+Alt+O` |
| 提取方法 | `Ctrl+Shift+Alt+M` |
| 安全删除 | `Alt+Delete` |

---

## 快速故障排查

| 问题 | 解决方案 |
|------|---------|
| 文件打开乱码 | 右键标签页 → `Change Encoding...` → 选择正确编码（如 GBK） |
| 项目构建失败 | 1. 检查 **Problems** 面板（`F8` 导航） 2. 确认 JDK 配置正确 3. 尝试 `Clean Build` |
| 服务器启动失败 | 1. 检查端口是否被占用 2. 修改 `Kairo: Manage Run Configurations` 中的端口 |
| Agent 断开连接 | 执行 `Kairo: Reconnect Agent` |
| 代码补全不工作 | 1. 等待 JDT LS 索引完成（状态栏显示进度） 2. 确认 JDK 17+ 已安装 |
| 找不到类或方法 | 1. 执行 `Kairo: Scan Project` 2. 确认 classpath 配置正确 |
| IDE 卡顿 | 1. 关闭不需要的标签页 2. 关闭终端面板 3. 减少同时打开的文件数量 |
| 热重载不生效 | 1. Java 文件修改后需要重新构建 2. JSP/CSS/JS 修改后保存即生效 |

---

## 关键路径

```
导入项目 → 配置 JDK/Tomcat → 编辑代码 → 构建 → 启动服务器 → 打开浏览器 → 调试
```

### 典型工作流程

1. **打开项目**：`Kairo: Import Project` → 选择项目目录 → 确认配置
2. **编辑代码**：`Ctrl+N` 查找类 → 编辑 → `Ctrl+S` 保存
3. **搜索**：`Ctrl+Shift+F` 全文搜索 → `F12` 跳转定义 → `Shift+F12` 查找引用
4. **构建部署**：`Kairo: Build and Deploy` → 等待编译完成
5. **启动运行**：`Kairo: Start Server` → `Kairo: Open Application`
6. **调试**：`F9` 设置断点 → `Kairo: Start Server (Debug)` → `F5` 继续 → `F10/F11` 单步
7. **停止**：`Shift+F5` 停止调试 → `Kairo: Stop Server`

---

## 关键文档

| 文档 | 路径 |
|------|------|
| 用户手册 | `docs/user-manual.md` |
| 快捷键参考 | `docs/keyboard-shortcuts.md` |
| 构建指南 | `docs/BUILD.md` |
| 运行指南 | `docs/RUN.md` |
| 架构说明 | `docs/architecture.md` |
| 产品需求 | `docs/product-requirements.md` |

---

## 系统要求

- **操作系统**：Windows 10（21H2+）/ macOS 12+
- **CPU**：2 vCPU
- **内存**：4 GB RAM
- **磁盘**：500 MB 可用空间
- **JDK**：JDK 6（目标项目编译）+ JDK 17+（JDT LS 运行）