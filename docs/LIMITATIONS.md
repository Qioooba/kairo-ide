# Kairo IDE 限制列表

## 设计限制

- 仅支持 JDK 6 / Tomcat 6 遗留 Java Web 项目
- 不支持 Spring Boot、Maven/Gradle 项目（Phase 3 Maven 实验性支持）
- 不支持 Java 8+ 语言特性
- 不支持多模块 Maven 项目
- 不支持 Git LFS、复杂 rebase UI
- 不支持远程开发（Phase 3 仅设计文档）

## 功能限制

- **Refactoring**: 仅支持 Organize Imports、Safe Delete、Extract Method
- **Debug**: HotSwap 仅方法体修改，JSP 断点实验性
- **SQL**: 仅 Oracle 11g，仅 SELECT 查询，只读模式默认开启
- **Git**: 不支持 submodule、stash、cherry-pick UI
- **JSP**: EL 表达式补全仅限隐式对象，不支持自定义 Bean 属性分析

## 性能限制

- 目标硬件: 2 vCPU / 4 GB RAM
- 项目规模: 建议 < 10k 文件
- 并发调试会话: 最多 3 个
- 搜索结果: 最多 10k 条
- 诊断包: 最大 50MB

## 安全限制

- Agent 仅监听 localhost，不支持远程连接
- 密钥存储使用 localStorage（非硬件安全模块）
- 审计日志存储在本地，未加密