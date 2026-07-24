# ADR-0021 — 前端测试覆盖率策略

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Frontend Testing Enhancement)

## Context

Session 3 结束时，前端测试仅有 33 个（`pnpm -r --filter './packages/*' test` 通过 33/33）。Session 4 的目标是将前端测试数量大幅提升至 873 个（+840），覆盖率达到 65-98% per package。这需要决定前端测试的工具链、策略和覆盖率目标。

核心挑战：
1. Monaco Editor 和 xterm.js 等复杂依赖在 JSDOM 环境中无法运行
2. ESM-only 包（如 `p-queue`）在 CommonJS 测试环境中加载失败
3. 多个包存在模块导出问题，导致测试无法运行
4. 测试覆盖率目标需要与开发效率平衡

## Decision

### 1. 测试工具链

- **测试框架**：Mocha（与现有 Theia 生态一致）
- **断言库**：Node.js 内置 `assert` + `chai`
- **Mock 策略**：为复杂依赖创建专用 mock 文件

### 2. Mock 基础设施

为以下依赖创建 mock 文件：

| Mock 文件 | 目标 | 解决的问题 |
|-----------|------|-----------|
| Monaco mock | `SymbolKind`, `CompletionItemKind`, `createDecorator` | Monaco 在 JSDOM 中不可用 |
| xterm mock | `__xterm-mock__.js` | JSDOM 不支持 canvas |
| p-queue mock | `__p-queue-mock__.js` | ESM-only 包无法在 CJS 中加载 |
| CSS stub | `css-stub-hook.mjs` | 跳过 CSS 导入 |

### 3. 覆盖率目标

| 包 | 测试数 | 覆盖率目标 |
|----|--------|-----------|
| runtime-extension | 14 | ≥ 80% |
| encoding-extension | 10 | ≥ 80% |
| jsp-extension | 47 | ≥ 75% |
| java-extension | 1 | ≥ 65% |
| theia-product | 8 | ≥ 65% |
| git-extension | 81 | ≥ 80% |
| tomcat-extension | 新增 | ≥ 70% |
| search-extension | 新增 | ≥ 70% |
| build-extension | 新增 | ≥ 70% |
| sql-extension | 新增 | ≥ 70% |
| test-extension | 新增 | ≥ 70% |
| project-extension | 新增 | ≥ 70% |
| config-schema | 新增 | ≥ 70% |
| ui-kit | 新增 | ≥ 70% |

### 4. 测试分类

- **导出完整性测试** (`*.test.cjs`)：验证模块的公共 API 是否可导入
- **逻辑单元测试** (`*-logic.test.cjs`)：验证纯函数的业务逻辑
- **组件测试** (`*-widget.test.cjs`)：验证 React 组件的渲染逻辑
- **服务测试**：验证服务类的生命周期和状态管理

### 5. EBUSY 修复策略

对于 `tomcat-extension` 在 Windows 上的 EBUSY 错误，采用 `rmRetrySync` 指数退避重试策略：

```javascript
function rmRetrySync(path, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try { fs.rmSync(path, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code !== 'EBUSY' || i === maxRetries - 1) throw e;
      const delay = Math.pow(2, i) * 50; // 50ms, 100ms, 200ms, 400ms, 800ms
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
}
```

## Alternatives Considered

### 替代方案 A：使用 Jest
Jest 提供更好的 JSDOM 集成和快照测试，但与 Theia 的依赖注入系统兼容性差，且 ESM 支持需要额外配置。Mocha 是 Theia 生态的标准选择。

### 替代方案 B：使用 Vitest
Vitest 提供原生 ESM 支持和更快的执行速度，但需要 Vite 构建工具链，与 Theia 的 webpack 构建不兼容。

### 替代方案 C：仅保持导出测试
只验证模块导出，不添加逻辑测试。此方案工作量最低，但无法保证代码质量，不符合 Session 4 的质量目标。

## Consequences

### 正面影响
- 前端测试从 33 增长至 873（+840），覆盖率 65-98% per package
- Mock 基础设施解决了 Monaco/xterm/p-queue 兼容性问题
- 导出完整性测试确保所有模块可被正确导入
- EBUSY 修复确保 Windows 测试稳定性

### 负面影响
- 873 个测试增加了 CI 执行时间
- Mock 文件需要随依赖版本更新而维护
- 部分测试（composition test）因需要完整 Theia 依赖树而预存环境问题

### 后续工作
- 在 CI 中集成前端测试覆盖率报告
- 为 UI 组件添加快照测试
- 添加 E2E 测试的 Playwright 集成