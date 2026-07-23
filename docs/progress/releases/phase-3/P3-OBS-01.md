# P3-OBS-01 企业观测

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P2-UX-01

## 目标
为 Kairo IDE 提供遥测、诊断数据收集、性能采样和升级检查等企业级观测能力。

## 用户价值
企业管理员可监控 IDE 使用情况、收集诊断数据排查问题，用户可获知性能状况和升级提示。

## 范围
- 诊断数据打包：Go 后端收集诊断数据（日志、配置、性能指标）打包为 bundle
- 遥测服务：前端遥测数据采集和上报，支持匿名化处理
- 遥测设置：用户可配置遥测开关和数据收集范围
- 性能采样器：定期采集 IDE 性能指标（内存、CPU、响应时间）
- 升级检查：检查新版本可用性，提示用户升级
- 诊断命令：IDE 诊断数据收集命令（同 P2-UX-01 的 kairo-diagnostic-command.ts）

## 非范围
- 集中式遥测数据平台
- 实时性能告警
- 用户行为分析
- 自动升级

## 实现摘要
`runtime-agent/internal/diagnostics/bundle.go` 实现 Go 后端诊断数据打包，收集日志、配置、Go 运行时指标等。`packages/theia-product` 中实现前端遥测、性能采样和升级检查。遥测服务通过配置项控制数据收集范围。性能采样器定期采集前端性能指标。升级检查通过版本 API 检测新版本。

## 修改文件
- `runtime-agent/internal/diagnostics/bundle.go` — 诊断数据打包
- `runtime-agent/internal/diagnostics/bundle_test.go` — 诊断打包测试
- `packages/theia-product/src/main/browser/kairo-telemetry.ts` — 遥测服务
- `packages/theia-product/src/main/browser/kairo-telemetry-settings.ts` — 遥测设置
- `packages/theia-product/src/main/browser/kairo-perf-sampler.ts` — 性能采样器
- `packages/theia-product/src/main/browser/kairo-upgrade-check.ts` — 升级检查
- `packages/theia-product/src/main/browser/kairo-diagnostic-command.ts` — 诊断命令（同 P2-UX-01）

## 测试命令与结果
```bash
go test ./internal/diagnostics/    # PASS 11/11
go build ./internal/diagnostics/   # PASS
pnpm --filter @kairo/theia-product test  # PASS 35/36（1 项为预先存在的失败）
pnpm --filter @kairo/theia-product build # PASS
pnpm --filter @kairo/theia-product lint  # PASS
```

## 人工验收步骤与证据
1. 打开设置面板，确认遥测开关和数据收集范围可配置
2. 运行诊断收集命令，确认诊断 bundle 文件生成
3. 查看性能采样器输出，确认内存和 CPU 指标有数据
4. 触发升级检查，确认新版本可用时显示提示
5. 关闭遥测后，确认后续数据不再上报

## 性能数据
Go 诊断测试 11/11 通过，theia-product 35/36 通过。

## 风险与遗留问题
- 1 项预先存在的 theia-product 测试失败，已知问题
- 诊断数据打包可能包含敏感信息（文件路径、用户名），需脱敏处理
- 遥测数据本地存储未加密，安全要求高时需增加加密
- 升级检查依赖网络可达性，离线环境无法检测

## 审查结论
通过。Go 诊断测试全部通过，前端扩展构建和测试通过。

## 回滚方式
从 Git 历史中 revert 涉及 bundle.go、bundle_test.go、kairo-telemetry.ts、kairo-telemetry-settings.ts、kairo-perf-sampler.ts 和 kairo-upgrade-check.ts 的提交。