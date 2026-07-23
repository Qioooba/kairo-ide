# P2-WEB-01 JSP/XML/EL 跨语言能力

- 状态：verified
- 负责人/模型：AI Development Agent
- 开始时间：2026-07-23
- 完成时间：2026-07-23
- 基线提交：main
- 最终提交：main
- 依赖任务：P1-BASE-01

## 目标
为 JSP、XML 和 EL 表达式提供语法高亮、代码补全、导航、结构视图和调试断点等 IDE 级语言能力。

## 用户价值
用户在编辑遗留 JSP/XML 文件和 EL 表达式时，可获得与现代 IDE 一致的智能提示、跳转和调试体验。

## 范围
- XML DTD 校验与补全：基于 DTD 声明验证 XML 文档结构，提供标签和属性补全
- EL 表达式支持：EL 表达式语法高亮、补全和符号导航
- XML 结构视图：以树形结构展示 XML 文档层级
- JSP-Java 跨语言导航：在 JSP 和 Java 代码间跳转
- web.xml 解析与导航：解析 web.xml 并提供 servlet/filter 定义间导航
- JSP 导航：JSP 文件内符号导航
- JSP 调试断点：JSP 文件内设置断点

## 非范围
- 完整的 JSP 编译器或运行时
- JSP 调试变量面板（由 P3-ADVDBG-01 后续扩展）
- 自定义标签库的完整语义分析

## 实现摘要
所有功能在 `packages/jsp-extension` 中实现。XML DTD 校验器解析 DTD 声明并比对文档结构，补全器根据 DTD 提供标签和属性候选。EL 表达式提供器基于语法解析提供代码补全和导航。XML 结构视图使用 Theia 树组件展示文档层级。JSP-Java 导航通过分析 JSP 中的 Java 代码段实现跨语言跳转。JSP 调试断点利用 Monaco 编辑器断点 API 适配 JSP 文件。

## 修改文件
- `packages/jsp-extension/src/browser/xml-dtd-validator.ts` — XML DTD 校验
- `packages/jsp-extension/src/browser/xml-dtd-completion.ts` — XML DTD 补全
- `packages/jsp-extension/src/browser/el-expression-provider.ts` — EL 表达式补全与高亮
- `packages/jsp-extension/src/browser/el-navigation.ts` — EL 表达式符号导航
- `packages/jsp-extension/src/browser/xml-structure-view.ts` — XML 树形结构视图
- `packages/jsp-extension/src/browser/jsp-java-nav.ts` — JSP-Java 跨语言导航
- `packages/jsp-extension/src/browser/webxml-parser.ts` — web.xml 解析器
- `packages/jsp-extension/src/browser/webxml-navigation.ts` — web.xml 导航
- `packages/jsp-extension/src/browser/jsp-navigation.ts` — JSP 文件内导航
- `packages/jsp-extension/src/browser/jsp-debug-breakpoint.ts` — JSP 断点支持

## 测试命令与结果
```bash
pnpm --filter @kairo/jsp-extension test  # PASS 12/12
pnpm --filter @kairo/jsp-extension build # PASS
pnpm --filter @kairo/jsp-extension lint  # PASS
```

## 人工验收步骤与证据
1. 打开一个 JSP 文件，确认语法高亮正常
2. 在 JSP 文件中的 EL 表达式 `${}` 内输入，确认出现补全提示
3. 打开 web.xml，确认 servlet-mapping 等元素可导航到对应类
4. 在 XML 编辑器中打开结构视图，确认树形层级正确
5. 在 JSP 文件中设置断点，确认断点标记正确显示

## 性能数据
jsp-extension 构建时间 < 5 秒，12 项测试全部通过。

## 风险与遗留问题
- JSP 调试断点仅支持标记设置，实际调试执行需依赖后端 JVM 调试器（P2-DBG-01/P3-ADVDBG-01）
- 自定义 TLD 的语义分析精度有限，仅支持基本标签属性补全

## 审查结论
通过。所有测试通过，构建无误。

## 回滚方式
从 Git 历史中 revert 涉及 jsp-extension 的提交，或移除 `packages/jsp-extension` 目录。