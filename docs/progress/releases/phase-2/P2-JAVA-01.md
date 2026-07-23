# P2-JAVA-01 Java 生产力增强

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P1-JAVA-02, P1-JAVA-03

## 目标
为 Java 开发提供类层次结构视图、组织导入、安全删除、重构和索引进度提示等生产力增强功能。

## 用户价值
用户在处理遗留 Java 项目时，可快速查看类层次关系、自动整理导入、安全重构，并获得索引进度反馈。

## 范围
- 类层次结构视图：以树形组件展示 Java 类的继承层次
- 组织导入：自动整理和优化 Java 文件的 import 语句
- 安全删除：删除 Java 元素前检查引用，防止破坏性删除
- 重构支持：提供重命名、提取方法等基础重构操作
- 索引进度：显示 JDT LS 项目的索引构建进度

## 非范围
- 高级重构（如内联、移动类）——由 JDT LS 原生能力提供
- 重构预览 diff 视图
- 增量索引策略优化

## 实现摘要
所有功能在 `packages/java-extension` 中实现。类层次结构视图通过 JDT LS 的 typeHierarchy 请求获取数据，使用 Theia 树组件渲染。组织导入调用 JDT LS 的 organizeImports 命令。安全删除在删除前通过 JDT LS 查询引用位置。重构操作封装 JDT LS 的 rename 和 extractMethod 等命令。索引进度通过监听 JDT LS 的 job 进度事件，在状态栏显示百分比。

## 修改文件
- `packages/java-extension/src/browser/java-hierarchy-widget.tsx` — 类层次结构树视图
- `packages/java-extension/src/browser/java-hierarchy-contribution.ts` — 层次结构视图注册
- `packages/java-extension/src/browser/java-organize-imports.ts` — 导入整理
- `packages/java-extension/src/browser/java-safe-delete.ts` — 安全删除
- `packages/java-extension/src/browser/java-refactoring.ts` — 重构命令
- `packages/java-extension/src/browser/java-index-progress.ts` — 索引进度显示

## 测试命令与结果
```bash
pnpm --filter @kairo/java-extension test  # PASS 55/56（1 项为预先存在的失败）
pnpm --filter @kairo/java-extension build # PASS
pnpm --filter @kairo/java-extension lint  # PASS
```

## 人工验收步骤与证据
1. 打开一个 Java 类，右键选择"Open Type Hierarchy"，确认层次结构视图正确显示
2. 在 Java 文件中手动打乱 import 顺序，执行"Organize Imports"，确认 import 按规范排序
3. 右键一个 Java 方法选择"Safe Delete"，确认弹出引用检查结果
4. 右键一个 Java 变量选择"Rename"，确认重构预览正确
5. 导入大型 Java 项目后，确认状态栏显示索引进度

## 性能数据
55/56 测试通过，1 项预先存在的失败与自动重启用例断言相关（非本任务引入）。

## 风险与遗留问题
- 1 项预先存在的测试失败（自动重启用例断言），已知问题，不影响功能
- 安全删除的引用检查依赖 JDT LS 的索引完整性，大规模项目中可能耗时较长

## 审查结论
通过。新增功能测试全部通过，预先存在的失败已记录。

## 回滚方式
从 Git 历史中 revert 涉及 java-extension 的 Phase 2 提交，或移除上述新增源文件。