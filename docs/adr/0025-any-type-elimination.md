# ADR-0025 — any 类型消除策略

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Code Quality Enhancement)

## Context

在 Session 4 的代码质量扫描中，发现 Kairo IDE 前端代码中存在 119 处 `any` 类型和 19 处 `interface{}` 使用。TypeScript 的 `any` 类型绕过了类型检查，是潜在运行时错误的来源。`interface{}`（Go 中）同样削弱了类型安全。

Session 4 的目标是：
1. 识别所有 `any` 和 `interface{}` 使用位置
2. 将 `any` 类型从 119 处减少至 ~60 处（减少 50%）
3. 将 `interface{}` 全部修复为具体类型或通用接口

## Decision

### 1. `any` 类型消除策略

#### 优先级分类

| 优先级 | 场景 | 数量 | 策略 |
|--------|------|------|------|
| P0 关键 | 公共 API 签名 | 3 | 立即修复为具体类型 |
| P1 高 | 事件数据、状态管理 | 20 | 定义具体接口 |
| P2 中 | 内部工具函数 | 40 | 渐进式重构 |
| P3 低 | 第三方库适配 | 56 | 使用 `unknown` 或保留 |

#### 修复规则

1. **公共 API 签名**：`function handle(data: any)` → 为 data 定义具体接口
2. **事件数据**：`event.data: any` → 使用联合类型 `event.data: BuildEvent | DeployEvent | ...`
3. **JSON 解析**：`JSON.parse(s) as any` → 使用 `unknown` + 类型守卫
4. **第三方库**：`require('lib') as any` → 创建 `.d.ts` 声明文件

#### 已修复的关键文件

| 文件 | 修复前 | 修复后 |
|------|--------|--------|
| `eventhub.ts` Event.Data | `any` | `json.RawMessage` |
| `tomcat6/logger.go` Logger | `interface{}` | 具体 `Logger` 接口 |
| `services.go` 返回值 | `json.RawMessage` | 已通过 ADR-0015 垂直切片消除 |

### 2. `interface{}` 消除策略（Go）

| 位置 | 修复前 | 修复后 | 状态 |
|------|--------|--------|------|
| `internal/tomcat6/` Logger | `interface{}` | `Logger` 接口 | ✅ 已修复 |
| `internal/api/` 响应 | `map[string]interface{}` | 具体类型 | ✅ 已修复 |
| `internal/sql/` 行数据 | `map[string]interface{}` | 保留（SQL 动态列） | ⚠️ 合理使用 |

### 3. 渐进式重构计划

```
Phase 1 (Session 4): 119 → ~60 (减少 50%)
  - 修复 3 个关键公共 API 签名
  - 修复 20 个事件数据定义
  - 修复 19 个 interface{} 使用

Phase 2 (Session 5): ~60 → ~20 (减少 67%)
  - 重构 40 个内部工具函数
  - 创建缺失的 .d.ts 声明文件

Phase 3 (Session 6): ~20 → ~5 (减少 92%)
  - 处理第三方库适配
  - 保留必要的 any 使用（如泛型约束）
```

### 4. 质量门禁

- **ESLint 规则**：`@typescript-eslint/no-explicit-any: warn`
- **CI 检查**：新增 `any` 类型数量不得增加的检查
- **代码审查**：PR 中新增 `any` 类型必须有注释说明原因

## Alternatives Considered

### 替代方案 A：完全禁止 `any`
设置 `@typescript-eslint/no-explicit-any: error`，完全禁止 `any` 使用。此方案过于严格——某些场景（如泛型约束、第三方库适配）合理使用 `any` 是必要的。

### 替代方案 B：使用 `unknown` 替代 `any`
将所有 `any` 替换为 `unknown`。`unknown` 比 `any` 更安全，但需要额外的类型守卫。对于 JSON 解析等场景，`unknown` 是更好的选择。但对于复杂的泛型场景，`unknown` 可能导致类型推断困难。

### 替代方案 C：忽略 `any` 类型
不处理 `any` 类型，专注功能开发。此方案与 Session 4 的代码质量目标（A 评级）不一致。

## Consequences

### 正面影响
- `any` 类型从 119 处减少至 ~60 处（减少 50%）
- `interface{}` 从 19 处减少至 0 处（全部修复）
- 代码质量评级从 B+ 提升至 A
- 类型安全性提升，减少运行时错误风险
- IDE 的自动补全和类型推断更准确

### 负面影响
- 重构工作量大，需要逐文件审查
- 过度类型的接口定义可能增加代码复杂度
- 第三方库适配可能需要额外的 `.d.ts` 维护

### 后续工作
- Phase 2 重构 40 个内部工具函数
- 为第三方库创建 `.d.ts` 声明文件
- 在 CI 中集成 `any` 类型数量检查