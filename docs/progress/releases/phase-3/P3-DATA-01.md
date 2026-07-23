# P3-DATA-01 轻量 SQL 工具

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P1-BASE-01

## 目标
为 Kairo IDE 提供轻量级 SQL 数据库连接、查询执行和结果展示功能，支持 Oracle 数据库。

## 用户价值
用户在开发遗留 Java Web 项目时，可直接在 IDE 内连接数据库、编写和执行 SQL 查询，无需切换外部工具。

## 范围
- 连接服务：管理数据库连接配置和连接池
- 连接视图：可视化配置和选择数据库连接
- 编辑器视图：SQL 编辑器，支持语法高亮和执行
- 执行服务：SQL 语句执行，支持 SELECT/INSERT/UPDATE/DELETE
- 结果视图：以表格形式展示查询结果，支持分页
- Oracle 驱动：Go 后端 Oracle 数据库连接和查询（oracle.go）
- SQL API 处理器：HTTP API 端点处理 SQL 查询请求（sql_handler.go）

## 非范围
- 非 Oracle 数据库（MySQL、PostgreSQL 等）
- 数据库 Schema 可视化
- SQL 查询计划和优化
- 数据导出/导入
- 事务管理 UI

## 实现摘要
`packages/sql-extension` 提供前端 SQL 工具，包括连接管理、编辑器、执行和结果展示。`runtime-agent/internal/sql/oracle.go` 实现 Go 后端 Oracle 数据库连接，`runtime-agent/internal/api/sql_handler.go` 提供 HTTP API 端点。前端通过 API 发送 SQL 查询，后端执行并返回结果。

## 修改文件
- `packages/sql-extension/src/browser/sql-connection-service.ts` — 数据库连接服务
- `packages/sql-extension/src/browser/sql-connection-widget.tsx` — 连接配置视图
- `packages/sql-extension/src/browser/sql-editor-widget.tsx` — SQL 编辑器
- `packages/sql-extension/src/browser/sql-execution-service.ts` — SQL 执行服务
- `packages/sql-extension/src/browser/sql-results-widget.tsx` — 查询结果视图
- `runtime-agent/internal/sql/oracle.go` — Oracle 数据库驱动
- `runtime-agent/internal/sql/oracle_test.go` — Oracle 驱动测试
- `runtime-agent/internal/api/sql_handler.go` — SQL API 处理器

## 测试命令与结果
```bash
go test ./internal/sql/     # PASS
go build ./internal/sql/    # PASS
go build ./internal/api/    # PASS
pnpm --filter @kairo/sql-extension build # PASS
pnpm --filter @kairo/sql-extension lint  # PASS
```

## 人工验收步骤与证据
1. 打开 SQL 连接视图，添加 Oracle 数据库连接配置
2. 连接到数据库，确认连接状态显示成功
3. 在 SQL 编辑器中输入 SELECT 查询，执行后确认结果表格正确显示
4. 执行 INSERT/UPDATE 语句，确认影响行数正确返回
5. 断开连接后重新连接，确认连接池正确恢复

## 性能数据
Go 测试通过，sql-extension 构建 < 3 秒。

## 风险与遗留问题
- 仅支持 Oracle 数据库，其他数据库需后续扩展
- Oracle 驱动依赖 Oracle Instant Client，需预先安装
- 不支持大结果集的分页和流式传输
- SQL 编辑器不提供语法检查和自动补全

## 审查结论
通过。Go 测试和构建通过，前端扩展构建通过。

## 回滚方式
从 Git 历史中 revert 涉及 sql-extension、oracle.go、oracle_test.go 和 sql_handler.go 的提交。