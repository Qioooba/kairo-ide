# P3-ADVDBG-01 高级调试增强

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P2-DBG-01, P2-WEB-01

## 目标
为 Java 调试提供 HotSwap 热替换、远程调试隧道和 JSP 调试断点增强功能。

## 用户价值
用户在调试遗留 Java Web 项目时，可热替换代码无需重启、远程调试生产环境、并在 JSP 文件中设置断点。

## 范围
- HotSwap 探测：检测 JVM 是否支持 HotSwap，自动启用热替换功能
- HotSwap 视图：显示热替换状态和最近替换记录
- JSP 调试断点：增强 JSP 文件断点支持，集成到调试流程
- 远程调试隧道：通过 SSH 隧道安全连接远程 JVM 调试端口
- 远程调试配置：管理远程调试连接配置（主机、端口、认证）

## 非范围
- 生产环境热替换的安全审批流程
- 多 JVM 同时调试
- 调试器插件扩展

## 实现摘要
在 `packages/java-extension` 中实现。HotSwap 探测通过 JDWP 协议检测 JVM 能力。HotSwap 视图展示替换状态。远程调试隧道通过 SSH 通道转发 JDWP 端口。远程调试配置管理多套连接参数。JSP 调试断点由 `packages/jsp-extension` 提供（同 P2-WEB-01）。

## 修改文件
- `packages/java-extension/src/browser/java-hotswap-probe.ts` — HotSwap 能力探测
- `packages/java-extension/src/browser/java-hotswap-widget.tsx` — HotSwap 状态视图
- `packages/java-extension/src/browser/java-remote-debug-tunnel.ts` — 远程调试 SSH 隧道
- `packages/java-extension/src/browser/java-remote-debug-config.ts` — 远程调试配置
- `packages/jsp-extension/src/browser/jsp-debug-breakpoint.ts` — JSP 断点（同 P2-WEB-01）

## 测试命令与结果
```bash
pnpm --filter @kairo/java-extension test  # PASS 55/56（1 项为预先存在的失败）
pnpm --filter @kairo/java-extension build # PASS
pnpm --filter @kairo/java-extension lint  # PASS
```

## 人工验收步骤与证据
1. 启动调试会话，修改 Java 方法体后保存，确认 HotSwap 视图显示替换成功
2. 配置远程调试连接（主机:端口），确认隧道建立并连接 JVM
3. 在 JSP 文件中设置断点，确认调试器在 JSP 执行时暂停
4. 修改 JSP 文件后热部署，确认修改生效

## 性能数据
55/56 测试通过，1 项为预先存在的失败。

## 风险与遗留问题
- 1 项预先存在的测试失败，已知问题
- HotSwap 受 JVM 限制（仅支持方法体修改，不支持新增/删除方法）
- 远程调试隧道依赖 SSH 客户端，生产环境可能需要额外认证
- JSP 热替换依赖 Tomcat 的 development 模式

## 审查结论
通过。新增调试功能测试全部通过，预先存在的失败已记录。

## 回滚方式
从 Git 历史中 revert 涉及 hotswap、remote-debug 和 jsp-debug-breakpoint 的提交。