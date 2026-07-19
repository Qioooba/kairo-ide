# Kairo IDE — Wave 0 止血修复文档

> 文档用途：恢复可信红线 Gate，让项目能编译、测试通过、CI 不造假  
> 负责 Agent：Integration Lead + Agent E  
> 预计工作量：2-3 天  
> 前置条件：无（这是第一个 Wave）  
> 后置 Gate：所有构建/测试全绿，MILESTONES 不再造假

---

## 0. 目标

修复所有 **Blocker** 级构建/测试失败，建立真实可信的 CI 红线，更新文档以反映真实状态。

**Wave 0 不改业务逻辑，只修构建、测试和文档。**

---

## 1. 任务清单

### 1.1 修复 Go 测试红灯

**当前状态**：`go test -count=1 ./...` 全部通过（26 包），但 `go test -race` 需要验证。

**任务**：
- 运行 `go test -count=1 -race ./...` 确认无 data race
- 如果 encoding API 测试被 sandbox 拒绝，修复测试 fixture 的 workspace 授权生命周期
- 确保所有测试在干净环境（无缓存）可复现

**验证命令**：
```bash
cd runtime-agent
go clean -testcache
go test -count=1 ./...
go test -count=1 -race ./...
```

### 1.2 修复 TypeScript 构建错误

**当前状态**：`@kairo/theia-product` 存在 TS6305 和 TS2742 错误。

**问题文件**：
- `packages/theia-product/src/main/product-bindings.ts` — `ContainerModule` 类型注解问题
- `packages/theia-product/src/main/product-frontend.ts` — 输出文件路径问题

**任务**：
1. 使用明确的 `ContainerModule` 类型注解
2. 统一 TypeScript project reference 输出
3. 从全新 checkout（无 build artifact）验证 `pnpm clean && pnpm build`
4. 确保所有 package 的 `main`/`types` 字段指向正确的输出文件

**验证命令**：
```bash
pnpm install --frozen-lockfile
pnpm clean
pnpm build
```

### 1.3 修复 encoding 测试引用

**当前状态**：`encoding-extension` 测试脚本引用不存在的 `ts-node/register`。

**问题文件**：`packages/encoding-extension/src/browser/encoding-service.test.ts`

**任务**：
1. 统一使用 Node 内置 test runner，或声明完整测试依赖
2. 确保 `pnpm test` 在 `packages/encoding-extension` 下可运行
3. `encoding-service.test.cjs` 中如果测试复制了生产逻辑而非 import 生产代码，标记为 `skip` 并添加注释说明将在 Wave 3 重写

**验证命令**：
```bash
pnpm -r --filter './packages/*' test
```

### 1.4 修复前端测试

**当前状态**：
- `runtime.test.cjs` 引用可能不存在的 `KairoRuntimeImpl`
- `kairo-commands.test.cjs` 用正则查源码而非实例化 container

**任务**：
1. 修复 `runtime.test.cjs` 的 import 路径
2. `kairo-commands.test.cjs` 若不修复则标记 skip 并添加 TODO（Wave 3 重写）
3. 确保所有测试至少能运行（不要求全部通过，但要求不 crash）

### 1.5 修复 CI 假绿

**当前状态**：
- CI 未设置 `KAIRO_LEGACY_SAMPLE`，integration 整段 skip
- contract-test 是 stub，永远退出 0
- E2E 核心步骤允许 GATED

**问题文件**：`.github/workflows/ci.yml`

**任务**：
1. 为 integration job 设置 `KAIRO_LEGACY_SAMPLE=$GITHUB_WORKSPACE/legacy-sample`
2. 将 integration 拆分为 `integration-no-runtime`（不需要 Tomcat）和 `integration-tomcat`（需要 Tomcat）
3. `integration-tomcat` job 若环境缺 Tomcat，明确 fail 而非 skip
4. 移除 P0 流程中的 `gated`，允许测试先红（为后续 Wave 提供真实基线）
5. 确保 `pnpm lint` 不是 `tsc --noEmit` 的别名（如暂未配置 ESLint，标记 TODO）

### 1.6 修复 Browser 默认绑定

**当前状态**：`apps/browser/package.json` 默认 `--hostname=0.0.0.0`，会把 Theia 文件系统暴露到局域网。

**问题文件**：`apps/browser/package.json`

**任务**：
1. 将默认 bind 改为 `127.0.0.1`
2. 添加启动脚本注释说明安全风险

### 1.7 修复 `apps/server` 形态

**当前状态**：Server 返回 placeholder HTML，非 API WebSocket 被销毁。

**任务**：
1. 在 `apps/server/src/index.ts` 顶部添加注释：`// EXPERIMENTAL: Remote mode is not available in this release.`
2. 非 loopback 绑定直接 `throw new Error('Remote mode is not available')`
3. 更新 `README.md` 移除 "三种形态已共享" 的说法

### 1.8 重写 MILESTONES.md

**当前状态**：文档同时声称"测试通过"和"前端未构建"，自相矛盾。

**任务**：
1. 将 `MILESTONES.md` 改为当前状态矩阵
2. 每项只允许：`verified`、`partial`、`not_started`、`deferred`
3. `verified` 必须链接到测试文件和 CI job
4. 历史记录移入 `docs/archive/`
5. 新增 `docs/progress/WAVE0_BASELINE.md`，记录 Wave 0 命令与结果

---

## 2. 禁止事项

- 不得修改业务逻辑来让测试通过
- 不得新增 `t.Skip` 来掩盖失败
- 不得删除失败的测试
- 不得修改 `go.mod` 版本号（除非与 CI 统一）

---

## 3. Wave 0 Gate Checklist

- [ ] `go test -count=1 ./...` 全绿（exit 0）
- [ ] `go test -count=1 -race ./...` 全绿（exit 0）
- [ ] `go vet ./...` 全绿（exit 0）
- [ ] `pnpm clean && pnpm build` 全绿（exit 0）
- [ ] `pnpm -r --filter './packages/*' test` 能运行（不 crash）
- [ ] CI integration job 不 skip 核心已声明范围
- [ ] Browser 默认 bind 127.0.0.1
- [ ] Server 标记 experimental
- [ ] `MILESTONES.md` 不再包含已知虚假声明
- [ ] `docs/progress/WAVE0_BASELINE.md` 已创建，包含实际命令和结果

---

## 4. 交付物

1. 修复后的代码（CI 绿）
2. `docs/progress/WAVE0_BASELINE.md` — 记录所有命令、退出码和关键输出
3. 更新后的 `MILESTONES.md`
4. 已知未修复项清单（供后续 Wave 处理）