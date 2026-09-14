# Kairo IDE 全链路兼容性验收与发布规范

**文档版本：** 1.0.0  
**发布日期：** 2026-09-13  
**状态：** 现行生效 (Active)  
**基线 Commit：** `6f6792213a540fad678cde5ea1790c92b83d3bcd`  
**遵循标准：** 遵循《Kairo IDE 对照 Lithe-IDEA：源码审计与分阶段改造方案》第 14 节与第 16 节验收标准。

---

## 1. 架构原则与基线不变量 (Core Invariants)

Kairo IDE 在重构演进中坚决贯彻以下架构铁律，严禁任何违背行为：

1. **核心架构不摇摆：** 保持 Theia/Monaco 前端 + Go Runtime Agent 后端架构路线；收敛现有模块化单体与类型化协议，不盲目重写为 Tauri/Rust。
2. **遗留系统兼容不劣化：** 严禁以“工具链兼容”为名自动抬升业务工程的 `sourceLevel` / `targetLevel`；业务运行环境坚持支持 JDK 1.6、Tomcat 6、GBK 编码与 JSP/Servlet。
3. **IDE 内部工具与业务运行时严格隔离：** JDT LS 宿主运行所需的 JDK 21+ 与业务编译／运行所用的 JDK 1.6 工具链绝对隔离，绝不强迫老工程迁移 JDK。
4. **六大权威归属清晰 (Six Authoritative Owners)：**
   - **项目模型 (ProjectModel)：** 单一权威事实源，只读带 revision 快照，有序 classpath 与依赖冲突诊断。
   - **文件与编码 (File & Encoding)：** 文件宿主原生规范化路径，严格 GBK 范围检测，禁止静默截断覆盖。
   - **构建与产物 (Build & Artifacts)：** Go Build use case + JobManager 全生命周期管理，产出权威 SHA-256 产物清单。
   - **Tomcat 与服务器 (ServerRunner)：** 绑定 `RuntimeInstanceID` 与单调递增 `Generation` 代际生命周期，拒绝端口盲猜。
   - **JDT LS 进程：** Theia Backend 为唯一权威生命周期 owner，Go Agent 仅提供 LaunchDescriptor。
   - **调试与热替换 (DebugBroker)：** 明确会话绑定，单目标串行队列，DAP 错误精准分流，Attach 模式绝不误杀外部 Tomcat。

---

## 2. 全链路环境兼容性矩阵 (Compatibility Matrix)

| 维度 | 支持范围 | 验证状态 | 关键约束与处理策略 |
|---|---|---|---|
| **操作系统** | Windows 10 / 11 x64 (主目标)<br>Windows Server 2016+<br>macOS 12+ (Dev)<br>Linux Ubuntu 20.04+ (CI) | **通过 (Validated)** | 路径使用 `ResolveURIOrPath` 原生规范化，严格处理盘符斜杠、中文、空格、`#` 与 UNC 路径。 |
| **IDE 宿主环境** | Node.js v22.x<br>Go 1.23+<br>JDK 21+ (`KAIRO_JDT_LS_JRE`) | **通过 (Validated)** | 仅用于 Theia 后端与 JDT LS 1.55.0 运行；不污染业务环境变量。 |
| **业务项目 JDK** | **JDK 1.6 (major=50)**<br>JDK 1.7 (major=51)<br>JDK 1.8 (major=52)<br>JDK 11 / 17 / 21 | **通过 (Validated)** | 编译器若不支持 1.6 必须明确报错 `toolchain_incompatible`；编译产物进行 8 字节 major version 校验，超过目标立即拦截。 |
| **Servlet / Web 容器** | **Apache Tomcat 6.0.53** (内置/验证)<br>Apache Tomcat 7 / 8 / 9<br>IBM WebSphere (WAS) 8.5+ | **通过 (Validated)** | 启动由 ServerRunner 精准跟踪 PID 与端口；Attach 断开时传递 `terminateDebuggee: false`，容器进程持续存活。 |
| **源文件编码** | **GBK** (默认代码基)<br>GB2312 / GB18030<br>UTF-8<br>UTF-16LE / UTF-16BE | **通过 (Validated)** | GBK 遇到不可表示字符时抛出 `UnrepresentableEncodingError` 并弹窗拦截；UTF-16 解码后再判定 CRLF/LF。 |
| **JSP 页面引擎** | JSP 2.0 / 2.1<br>Servlet 2.5<br>标准 JSTL / 脚本块 / 表达式 | **通过 (Validated)** | 整页语义模型 `JspPageModelBuilder`，顺序注入全局 `_jspService`；SourceMap 精确处理中文 UTF-16 偏移；import 自动转指令。 |

---

## 3. 全量验收用例归档表 (T01 ~ T53)

| 阶段 | 用例范围 | 验收核心内容 | 自动化单测覆盖 | 状态 |
|---|---|---|---|---|
| **Phase A** | **T01 ~ T19** | 编译兼容门禁、路径安全规范化、调试目标精确绑定、构建产物清单、HotSwap 串行队列与生命周期 | `internal/build`, `internal/pathpolicy`, `internal/debug`, `java-hotswap-service.test.cjs` | **100% PASS** |
| **Phase B** | **T20 ~ T39** | JDWP 底层编解码与分流、JobManager 幂等缓存、流式搜索取消、Agent 重启代际交接、编码安全、JSP 虚拟文档管理 | `internal/debug/jdwp_robustness_test.go`, `internal/api/idempotency_test.go`, `internal/search`, `virtual-document-manager.test.cjs` | **100% PASS** |
| **Phase C** | **T40 ~ T50** | JSP 整页模型与双向 SourceMap、ProjectModel 单一真相源、断点单次迁移不变量、十万大数组分页、Attach 断开语义 | `jsp-page-model.test.cjs`, `project-model.test.cjs`, `java-debug-e2e-capabilities.test.cjs`, `startup-performance-tracker.test.cjs` | **100% PASS** |
| **Phase D** | **T51 ~ T53** | Agent 端点白名单与凭据隔离、工作区信任安全拦截、诊断日志全局脱敏、6 大架构单向依赖门禁 | `runtime-security.test.cjs`, `check-architecture-boundaries.test.cjs` | **100% PASS** |

---

## 4. 已知限制与优雅降级规范 (Known Limitations & Graceful Degradation)

1. **JDT LS 宿主隔离限制：**
   - 限制：JDT Language Server 1.55.0 必须运行在 JRE 21+ 宿主环境下。
   - 规范：该 JRE 由 `KAIRO_JDT_LS_JRE` 独立提供，与工程属性中的 `compilerJavaHome` / `tomcatJavaHome` 严格隔离。在未配置 JDK 21 宿主时，IDE 启动基础编辑与工程模型，语言服务处于降级诊断提示状态，不卡死 UI。
2. **调试目标歧义降级：**
   - 限制：同一工程启动多个调试实例或未配置调试配置时。
   - 规范：HotSwap 自动热替换机制立即处于安全禁用状态（`isEnabled = false`），明确向用户提示配置具体调试目标，严禁盲目连接首个服务器造成跨目标写入污染。
3. **大数组与海量变量调试降级：**
   - 限制：Java 堆中出现 10 万+ 元素大数组或巨型 Collection。
   - 规范：`VariablePagingManager` 强制将 DOM 节点拆解为 `[0..99]`, `[100..199]` 有界切片分页，按需懒加载；代际失效响应立即丢弃。
4. **陌生工作区脚本执行拦截：**
   - 限制：打开外部下载或不受信任的 Java 工程。
   - 规范：`WorkspaceTrustManager` 默认置为 `untrusted`。自动构建脚本、服务自启与本地进程派生操作全部拦截，直至用户明确确认信任。
5. **非回环 Agent 凭据保护：**
   - 限制：通过参数或配置将 Agent URL 导向非 `127.0.0.1` / `localhost` 端点。
   - 规范：`AgentEndpointValidator` 立即切断 `agentSecret` 与 `X-Kairo-Secret` 的附加，防止本地认证令牌被外发窃取。

---

## 5. 发布验证流水线 (Release Verification Pipeline)

在执行发布构建（`pnpm package:win`）之前，必须依次通过以下五重自动化门禁：

```bash
# 门禁 1: 架构单向依赖与废弃 API 隔离门禁
pnpm check:architecture

# 门禁 2: TypeScript 全工程类型检查与 Lint
pnpm typecheck
pnpm lint

# 门禁 3: 前端扩展全量单元测试 (包括 protocol, runtime, java, jsp, encoding, theia-product)
pnpm test:unit

# 门禁 4: Go Runtime Agent 全量单元与集成测试 (含 -race 竞态检测)
pnpm test:agent:race

# 门禁 5: 交付物就绪度与供应链合规扫描
node scripts/check-delivery-readiness.cjs
```

所有上述 5 项检查必须全部输出 `✓ PASSED`（退出码 0），方可打标发布产物。

---

## 6. 故障排查与紧急回滚指南 (Rollback & Disaster Recovery Runbook)

### 6.1 HotSwap 异常时的紧急回滚
- **现象：** 保存 Java 文件后编译异常、目标服务器出现 `unsupported_redefine` 或调试端口占用。
- **应急操作：**
  1. 在设置中将 `kairo.java.hotswap.enabled` 置为 `false`，禁用自动保存热替换。
  2. 终止调试会话（Attach 模式下业务 Tomcat 保持运行；Launch 模式下由 ServerRunner 安全清理）。
  3. 执行 `mvn clean compile` 或 Ant 构建，通过管理控制台或重启完成标准部署。

### 6.2 Agent 重启故障与端口冲突恢复
- **现象：** Agent 重启超时，提示端口占用或服务未响应。
- **应急操作：**
  1. 查看本地 `%APPDATA%\kairo-data\agent-state.json` 获取当前进程 PID 与 Generation。
  2. 使用 `scripts/cleanup-stage-orphans.ps1` 清理孤儿进程树。
  3. 通过桌面托盘或终端重新拉起 Agent；`ListenWithHandoff` 状态机会自动接管并刷新代际。

### 6.3 编码保存拦截恢复
- **现象：** 保存 GBK 文件时提示 `UnrepresentableEncodingError`。
- **应急操作：**
  1. 弹窗已主动阻止改写磁盘，原文件内容完好无损。
  2. 审查最近键入的生僻字符或特殊 Unicode 符号，移除或替换为标准 ASCII / GBK 转义字符后重新保存。
