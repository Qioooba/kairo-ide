# P1-RUN-01 统一运行配置模型

- 状态：`implemented`
- 负责人/模型：Codex release_baseline Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：`6b2fb071abfa3ee46c718827535935615c328c0c`
- 最终提交：未提交（共享工作区）
- 依赖任务：P1-BASE-01

## 目标

建立与 UI、Go Agent、DAP 解耦的统一 Tomcat 6 Run/Debug 配置核心，替换后续功能继续传递零散启动参数的做法。

## 用户价值

用户可以保存多个具名运行配置，并稳定恢复当前选择。一个配置完整表达项目、JDK、Tomcat、构建、部署、环境变量、VM 参数、Run/Debug、suspend 和启动前任务，为后续工具栏选择器、一键运行与 Debug 共用同一事实来源。

## 范围

- 协议层运行配置类型与独立版本常量。
- `.legacyflow/run-configurations.json` 文档结构。
- Draft 2020-12 严格 JSON Schema。
- 结构校验和跨字段语义校验。
- JSON 导入、规范化序列化、往返恢复。
- Tomcat Run/Debug、suspend、项目/JDK/服务器、构建、部署、环境变量、VM 参数和启动前任务。

## 非范围

- Search、Debug 或运行配置编辑 UI。
- Go Agent 的运行配置 CRUD API。
- Tomcat 生命周期/DAP 的实际执行接线。
- 用户本地 override/合并策略；本切片只建立项目级规范文件。

## 实现摘要

1. `@kairo/protocol` 新增 `RunConfigurationDocument`、`TomcatRunConfiguration`、构建/部署/启动模式类型及 `RUN_CONFIGURATION_VERSION = 1`。
2. `@kairo/config-schema` 新增独立 `run-configuration.ts`，导出 schema、校验、解析、序列化和类型化错误。
3. 顶层、配置和所有嵌套对象均 `additionalProperties: false`；配置最多 100 个，环境变量和 VM 参数均有上限。
4. 语义校验拒绝：
   - Run 模式使用 suspend；
   - 重复 ID、忽略大小写的重复名称；
   - 默认选择不存在或空文档仍有默认选择；
   - HTTP/Debug 端口冲突；
   - deploy 排在 build 之前；
   - Windows 下大小写冲突的环境变量；
   - 绝对部署路径和非法环境变量名；
   - 敏感环境变量的明文值。
5. `PASSWORD`、`TOKEN`、`SECRET` 等敏感变量必须写为 `${env:HOST_NAME}` 引用，项目文件不保存密钥值。
6. 序列化固定字段顺序、环境变量键排序、两空格缩进和 LF 结尾，不修改调用方对象；无效内存对象拒绝落盘。

## 修改文件

- `packages/protocol/src/index.ts`
- `packages/protocol/src/envelope.test.ts`
- `packages/config-schema/src/run-configuration.ts`
- `packages/config-schema/src/run-configuration.test.ts`
- `packages/config-schema/src/index.ts`
- `packages/config-schema/package.json`
- `packages/config-schema/tsconfig.json`

## 接口/数据结构变化

持久化文件：`.legacyflow/run-configurations.json`。`deploy.artifact` 统一解释为相对于该配置 `projectId` 对应项目根目录的路径，而不是 workspace 根目录路径。

```json
{
  "version": 1,
  "configurations": [
    {
      "id": "tomcat6-legacy-run",
      "name": "Tomcat 6: legacy-sample",
      "type": "tomcat6",
      "projectId": "legacy-sample",
      "mode": "run",
      "suspend": false,
      "jdkRef": "jdk6-local",
      "build": { "type": "ant", "target": "war", "clean": false },
      "server": {
        "id": "tomcat6-local",
        "httpPort": 18080,
        "debugPort": 8000,
        "contextPath": "/legacy"
      },
      "deploy": { "mode": "exploded", "artifact": "dist/legacy" },
      "env": { "DB_PASSWORD": "${env:LEGACY_DB_PASSWORD}" },
      "vmOptions": ["-Dfile.encoding=GBK"],
      "beforeLaunchTasks": ["build", "deploy"]
    }
  ],
  "selectedConfigurationId": "tomcat6-legacy-run"
}
```

## 测试命令与结果

所有命令均通过 `scripts/run-with-timeout.cjs`，单命令上限 120 秒：

- `pnpm --filter @kairo/protocol build`：PASS。
- `pnpm --filter @kairo/config-schema lint`：PASS。
- `pnpm --filter @kairo/config-schema test`：PASS，23/23。
- `pnpm --filter @kairo/protocol test`：PASS，17/17。
- 构建产物 `require('./packages/config-schema')` Debug 配置序列化/解析 smoke：PASS。

## 人工验收步骤与证据

本任务为无 UI 核心层。可使用导出的 `parseRunConfigurationDocument` 导入示例，随后调用 `serializeRunConfigurationDocument`；两次序列化结果必须逐字节一致。UI 人工旅程由后续 P1-RUN UI/集成任务负责。

## 性能数据

单文档最多 100 个配置；校验和序列化均为有界内存操作。完整配置 schema 测试套件约 0.95 秒，规范化序列化往返用例约 9 毫秒；未引入文件监听或后台任务。

## 风险与遗留问题

- Runtime Agent 尚未消费该模型，当前不能宣称运行/调试闭环完成。
- `${env:HOST_NAME}` 的安全解析与缺失变量错误需要执行层实现，日志必须脱敏。
- 项目级配置与用户本地 override 的优先级、冲突提示仍需后续 ADR。
- Custom build command 由现有产品能力保留；执行层必须避免 shell 拼接并执行权限审查。

## 审查结论

代码和单元测试已实现，等待独立审查及后续运行服务接线，因此状态为 `implemented`，不是 `verified`。

## 回滚方式

删除新增运行配置模块与测试，移除协议类型/export 和 config-schema 的 protocol project reference；未修改现有项目配置版本，也未产生磁盘数据迁移。
