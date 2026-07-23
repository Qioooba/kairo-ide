# P3-MAVEN-01 遗留 Maven 支持

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P1-BLD-01A

## 目标
为 Kairo IDE 提供 Maven 项目识别和依赖管理视图，支持遗留 Java Web 项目中的 Maven 构建配置。

## 用户价值
用户在 IDE 中可直接查看 Maven 项目结构和依赖树，无需在命令行中运行 `mvn dependency:tree`。

## 范围
- Maven 项目解析：Go 后端解析 pom.xml 文件，提取项目坐标、依赖和模块信息
- Maven 视图：前端树形组件展示 Maven 项目结构、依赖列表和模块层级

## 非范围
- Maven 构建执行（由 P1-BLD-01A 的构建系统覆盖）
- Maven 依赖冲突解决
- Maven 仓库管理
- Gradle 支持

## 实现摘要
`runtime-agent/internal/maven/maven.go` 实现 pom.xml 解析逻辑，提取 groupId、artifactId、version、dependencies 和 modules 信息。`packages/theia-product/src/main/browser/maven-view-widget.tsx` 实现前端 Maven 视图，展示项目结构和依赖树。

## 修改文件
- `runtime-agent/internal/maven/maven.go` — Maven pom.xml 解析
- `packages/theia-product/src/main/browser/maven-view-widget.tsx` — Maven 项目视图

## 测试命令与结果
```bash
go build ./internal/maven/  # PASS
go test ./internal/maven/   # PASS
pnpm --filter @kairo/theia-product build # PASS
```

## 人工验收步骤与证据
1. 打开一个 Maven 项目，确认 Maven 视图显示项目坐标和模块列表
2. 展开依赖树，确认依赖列表正确显示 groupId:artifactId:version
3. 在多模块项目中，确认父模块和子模块层级关系正确

## 性能数据
Go 构建 < 1 秒，Maven 解析测试通过。

## 风险与遗留问题
- pom.xml 解析仅支持基本元素，对复杂的 Maven profile、属性占位符和继承链支持有限
- 不处理 Maven 依赖传递和冲突解析
- 后续需集成依赖安全扫描

## 审查结论
通过。Go 构建和测试通过，前端视图构建通过。

## 回滚方式
从 Git 历史中 revert 涉及 maven.go 和 maven-view-widget.tsx 的提交。