# Kairo IDE — 代码清理指南

> 文档用途：Code Cleanup Agent (Agent F) 的开发任务书  
> 负责 Agent：Agent F — Code Cleanup  
> 预计工作量：跨 Wave 执行（每个 Wave 合并后清理该 Wave 遗留的死代码）  
> 保守估计：6,000-8,000 行可删 + 8 个包可合并

---

## 0. 清理原则

1. **先确认无 caller，再删除。** 用 `grep -r "packageName"` 全仓搜索引用。
2. **删除后全量构建测试通过。** 删一个文件就跑一次 `go build ./...` 和 `pnpm build`。
3. **不在同一 PR 删代码又改功能。** 代码清理 PR 只做删除/重命名/合并，不修改业务逻辑。
4. **每个删除有明确理由。** 在 commit message 中说明：为什么删、确认无 caller、替代方案。

---

## 1. Go 后端死代码清理

### 1.1 `internal/app/*` 整层（~4,413 行）

**当前状态**：Wave 1 之前是死代码，Wave 1 之后应成为生产代码。

**清理策略**：
- 如果 Wave 1 已完成：确认 `internal/app/` 已接入 composition root → **保留**
- 如果 Wave 1 未完成且 `internal/app/` 仍未被调用 → **删除**（等 Wave 1 重新实现）
- Wave 1 完成后的旧 `services/` 中已替代部分 → **删除**

### 1.2 `internal/proc/*` 死代码（~1,629 行可删）

**删除内容**：
- `JobObject` 相关代码（Windows 特有，未被使用）
- `marker token` 相关代码

**保留内容**：
- `proc.go` 中的进程启动/停止核心逻辑
- `proc_unix.go` / `proc_windows.go` 中的平台差异

### 1.3 `internal/planning/` 整包（~553 行）

**状态**：被 `internal/runtimeplan/` 取代。

**操作**：**删除整个 `internal/planning/` 目录**。

**验证**：
```bash
grep -r "internal/planning" runtime-agent/ --include="*.go"
# 应该只有 planning 包自身引用
```

### 1.4 `internal/tomcat6` legacy stub（~529 行）

**状态**：`Start/Stop/ForceStop` 全 panic，已被 `internal/provider/runtime/tomcat6_provider.go` 取代。

**操作**：删除 `internal/tomcat6/` 中以 `panic("not supported")` 结尾的 stub 函数。

**保留**：`tomcat6.go` 中不 panic 的纯逻辑函数（如 `isAlive`、`parsePort` 等）。

### 1.5 `internal/runtimeplan/*` 死引用（~789 行）

**状态**：如果只被 dead `app` 和 `planning` 引用。

**操作**：确认 Wave 1 后 `app/` 已使用 `runtimeplan` → 保留；否则删除。

### 1.6 `internal/api/dto.go` + `dto_test.go`（~924 行）

**状态**：如果 Wave 1 后 handler 已改用 typed DTO。

**操作**：删除旧的 `RawMessage` 万能 DTO 定义。

### 1.7 `internal/audit/` 包（~119 行）

**状态**：写 NDJSON 但**无 caller 调 `Append`**（全仓搜索 `audit.Append` 为 0 命中）。

**操作**：保留包但不修复（Desktop v1 本地诊断用途，Wave 3 后再接入）。

### 1.8 `internal/platform/hostsupervisor.go`

**状态**：死代码，桌面宿主属于 Electron。

**操作**：**删除整个文件**。

---

## 2. TypeScript 前端死代码清理

### 2.1 8 个 `*-extension` 合并为 3 个（~5,415 行）

**当前**：
```
@kairo/build-extension
@kairo/tomcat-extension
@kairo/search-extension
@kairo/jsp-extension
@kairo/encoding-extension
@kairo/project-extension
@kairo/runtime-extension
@kairo/java-extension
```

**目标**：
```
@kairo/ide        ← build + tomcat + project + runtime（核心 IDE 功能）
@kairo/encoding   ← encoding（独立关注点）
@kairo/java-jsp   ← java + jsp（语言智能）
```

**合并规则**：
- 合并前确认每个包的 `package.json` 依赖
- 合并后更新 `pnpm-workspace.yaml`
- 合并后清理 `node_modules` 并重新 `pnpm install`

### 2.2 零调用方包（删除）

| 包 | 原因 |
|----|------|
| `@kairo/search-extension` | 0 调用方（search 功能尚未实现 UI） |
| `@kairo/config-schema` | 0 调用方 |
| `@kairo/drivelist-stub` | 0 调用方 |

**操作**：如果确认 0 调用方 → 删除整个包目录。如果后续 Wave 需要，重新创建。

### 2.3 `apps/server/` 整个 app 形态

**状态**：placeholder HTML，ADR-0014 砍掉。

**操作**：
- 保留源码但标记 experimental（不删除）
- 在 `apps/server/package.json` 添加 `"private": true` 和 `"description": "EXPERIMENTAL: Remote mode is not available in this release."`
- 非 loopback 绑定时直接 throw Error

### 2.4 `patches/inversify@6.2.2.patch`

**状态**：选错版本的标志。

**操作**：如果 Wave 0 已升级 inversify 到 6.3+ → 删除此 patch 文件。

---

## 3. 旧 UI 清理（Wave 3 完成后）

**删除文件**：
- `packages/theia-product/src/main/browser/kairo-views-contribution.ts` 中的旧 widget 类（`KairoBuildsWidget`、`KairoServersWidget` 等）
- 旧 innerHTML 实现

**验证**：新 ReactWidget 已注册 WidgetFactory/ViewContribution 并正常工作。

---

## 4. 清理检查清单

### Go 侧
- [ ] `grep -r "NewMemoryServices" runtime-agent/ --include="*.go"` — 不应出现在业务主干
- [ ] `grep -r "json.RawMessage" runtime-agent/internal/app/ --include="*.go"` — 0 命中
- [ ] `grep -r "panic(" runtime-agent/internal/ --include="*.go" | grep -v "_test.go"` — 只有 unrecoverable 场景
- [ ] `grep -r "audit.Append" runtime-agent/ --include="*.go"` — 记录调用方数量
- [ ] `go build ./...` 通过
- [ ] `go test -count=1 ./...` 通过

### TS 侧
- [ ] `grep -r "\.catch(() => \[\])" packages/ --include="*.ts" --include="*.tsx"` — 0 命中
- [ ] `grep -r "18099" packages/ --include="*.ts" --include="*.tsx"` — 0 命中（或只在注释中）
- [ ] `grep -r "3000" apps/desktop/ --include="*.ts"` — 0 命中（或只在注释中）
- [ ] `pnpm clean && pnpm build` 通过
- [ ] `pnpm -r test` 通过

### 文档侧
- [ ] `MILESTONES.md` 不再包含 "honestly working" 等矛盾描述
- [ ] `README.md` 不再声称 "三种形态已共享"
- [ ] `docs/archive/` 包含历史记录

---

## 5. 禁止事项

- 不得删除还有 caller 的代码
- 不得在代码清理 PR 中修改业务逻辑
- 不得删除 `legacy-sample/` 目录
- 不得删除 `bundled/` 目录
- 不得删除 `docs/` 下的任何 ADR