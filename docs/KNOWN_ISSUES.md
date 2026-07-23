# Kairo IDE 已知问题

## 预存测试失败（非本次引入）

- java-extension: `java-language-client-contribution.test.cjs` — 需要先执行 tsc 编译
- search-extension: `search-center-widget.test.cjs` — CSS 导入与 @theia/monaco-editor-core 兼容性
- theia-product: `kairo-commands.test.cjs` — 需要 tsc 编译
- runtime-agent: `TestEncoding_Detect_GBK_HelloJsp` — GBK 检测返回 UTF-8

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