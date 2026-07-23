# Kairo IDE 缺陷清单

## P0 — 阻塞投产

| # | 标题 | 模块 | 现象 | 状态 | 负责人 |
|---|---|---|---|---|---|
| P0-001 | Java 6 JDWP 兼容性未验证 | Debug | 需要在真实 JDK 6 环境验证 JDWP 握手 | blocked | 需 JDK 6 环境 |
| P0-002 | Windows 10 安装未验证 | Platform | Windows Desktop/Browser 包未在真实 Win10 测试 | blocked | 需 Win10 环境 |
| P0-003 | 真实遗留项目编码安全未验证 | Encoding | 需用真实 GBK/UTF-8 混合项目验证无编码破坏 | blocked | 需真实项目 |

## P1 — 影响体验

| # | 标题 | 模块 | 现象 | 状态 |
|---|---|---|---|---|
| P1-001 | 冷启动性能未实测 | Performance | 未在目标硬件(2vCPU/4GB)上测量启动时间 | open |
| P1-002 | E2E 场景未实际执行 | Testing | 10 个 E2E 场景代码已写，fixtures 已修复（Wave Q），待 Playwright 运行 | open |
| P1-003 | SHA-256 使用环境变量引用 | Supply Chain | 已修复：generate-checksums.cjs 使用硬编码 SHA-256 | resolved |
| P1-004 | UI 截图回归未覆盖 | UX | Wave Q 已创建 visual-regression.spec.ts (10 scenarios) + run-visual-regression.cjs | resolved |
| P1-005 | 测试覆盖率偏低 | Quality | Go 51.8% (目标 ≥60%) / TS 24.7%，持续提升中 | open |

## 已关闭

| # | 标题 | 关闭原因 |
|---|---|---|
| P1-003 | SHA-256 使用环境变量引用 | generate-checksums.cjs 已使用硬编码 SHA-256 |
| P1-004 | UI 截图回归未覆盖 | Wave Q 已创建 visual-regression.spec.ts + run-visual-regression.cjs |