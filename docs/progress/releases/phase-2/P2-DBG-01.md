# P2-DBG-01 高级调试

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P1-DBG-01, P1-DBG-02A, P1-JAVA-02

## 目标
为 Java 调试提供高级断点管理、异常断点、JVM 列表、线程辅助、源映射和兼容性检查等功能。

## 用户价值
用户在调试遗留 Java Web 项目时，可获得断点分组管理、异常自动断点、远程 JVM 发现和源码不匹配提示等高级调试体验。

## 范围
- 断点管理：统一管理 Java 断点，支持分组、启用/禁用
- 异常断点：捕获和未捕获异常自动断点，支持按异常类型过滤
- JVM 列表：扫描本地运行中的 JVM 进程，支持 attach 调试
- 线程辅助：调试时显示线程列表，支持线程切换和挂起/恢复
- 调试验收：调试器连接验收，确保调试环境就绪
- 源码不匹配：检测编译类与源码不一致时给出提示
- 兼容性检查：检查 JDK 版本与调试器兼容性

## 非范围
- HotSwap/热替换（由 P3-ADVDBG-01 后续实现）
- 远程调试隧道（由 P3-ADVDBG-01 后续实现）
- 调试器性能分析

## 实现摘要
在 `packages/java-extension` 和 `packages/theia-product` 中实现。断点管理器通过 JDT LS 调试协议管理断点生命周期。异常断点利用 JDT LS 的 exception breakpoints 能力。JVM 列表器通过扫描本地进程发现可调试的 JVM。线程辅助器封装调试线程控制。源码不匹配检测通过比对类文件时间戳和源码文件。兼容性检查验证 JDK 版本与调试器版本。

## 修改文件
- `packages/java-extension/src/browser/kairo-java-debug-breakpoint-contribution.ts` — 断点 UI 贡献
- `packages/java-extension/src/browser/java-debug-exception-breakpoints.ts` — 异常断点
- `packages/java-extension/src/browser/java-debug-jvm-lister.ts` — JVM 进程列表
- `packages/java-extension/src/browser/java-debug-breakpoint-manager.ts` — 断点管理器
- `packages/java-extension/src/browser/java-debug-thread-helper.ts` — 线程辅助
- `packages/java-extension/src/browser/java-debug-acceptance.ts` — 调试验收
- `packages/java-extension/src/browser/java-debug-source-mismatch.ts` — 源码不匹配检测
- `packages/java-extension/src/browser/java-debug-compat-check.ts` — JDK 兼容性检查

## 测试命令与结果
```bash
pnpm --filter @kairo/java-extension test  # PASS 55/56（1 项为预先存在的失败）
pnpm --filter @kairo/java-extension build # PASS
pnpm --filter @kairo/java-extension lint  # PASS
```

## 人工验收步骤与证据
1. 启动调试会话，在 Java 文件中设置多个断点，确认断点管理器显示所有断点
2. 在异常断点面板中勾选"捕获的 NullPointerException"，确认断点触发
3. 打开 JVM 列表视图，确认显示本地运行中的 Java 进程
4. 调试暂停时，确认线程视图显示所有线程及当前线程
5. 修改源码后重新调试，确认源码不匹配警告出现
6. 使用不兼容的 JDK 版本启动调试，确认兼容性检查提示

## 性能数据
55/56 测试通过，1 项为预先存在的失败。

## 风险与遗留问题
- 1 项预先存在的测试失败（自动重启用例），已知问题
- JVM 列表依赖平台特定进程扫描，Windows 和 macOS 实现可能不同
- 源码不匹配检测基于时间戳，增量编译场景可能误报

## 审查结论
通过。新增调试功能测试全部通过，预先存在的失败已记录。

## 回滚方式
从 Git 历史中 revert 涉及 java-extension 的调试相关提交，或移除上述新增源文件。