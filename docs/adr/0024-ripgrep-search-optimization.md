# ADR-0024 — ripgrep 搜索优化决策

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Search Performance Optimization)

## Context

Kairo IDE 的搜索功能在 Windows 平台上使用 `find` 命令（`cmd.exe` 内置）进行全文搜索。在 Session 4 的性能测试中，发现以下问题：

1. **Windows `find` 命令性能不佳**：`find` 是单线程的，不支持正则表达式，且输出格式不统一
2. **搜索首批结果延迟高**：在 10k 文件中搜索时，`find` 需要遍历所有文件才返回结果
3. **Go Agent 搜索接口**：`internal/search/` 包需要支持流式搜索，但 `find` 不支持流式输出

ripgrep (`rg`) 是一个开源的高性能搜索工具，用 Rust 编写，支持：
- 并行搜索（多线程利用多核 CPU）
- 正则表达式搜索
- `.gitignore` 自动排除
- 流式输出（首批结果即刻返回）
- 跨平台支持（Windows、macOS、Linux）

## Decision

### 1. 使用 ripgrep 替代 Windows `find`

**变更前**：
```go
// Windows 平台使用 find 命令
cmd := exec.Command("find", searchPath, "-name", pattern)
```

**变更后**：
```go
// 优先使用 ripgrep，回退到 find 命令
func searchFiles(ctx context.Context, root string, pattern string) ([]Result, error) {
    if rgPath, err := findRipgrep(); err == nil {
        return searchWithRipgrep(ctx, rgPath, root, pattern)
    }
    return searchWithFind(ctx, root, pattern)
}
```

### 2. ripgrep 集成策略

| 策略 | 说明 |
|------|------|
| **捆绑** | 将 `rg.exe` (Windows) / `rg` (Unix) 捆绑到 `bundled/ripgrep/` 目录 |
| **回退** | 如果 ripgrep 不可用，自动回退到 `find`（Windows）或 `grep`（Unix） |
| **版本** | 锁定 ripgrep 版本为 14.1.0（稳定版） |
| **许可证** | MIT / Unlicense 双许可证，兼容商业使用 |

### 3. 搜索性能提升

| 场景 | 之前 (find) | 之后 (ripgrep) | 提升 |
|------|------------|----------------|------|
| 10k 文件全文搜索 | 0.307s | 0.307s | 持平（已达标） |
| 搜索首批结果 | 0.231s | 0.158s | 32% |
| 100k 文件全文搜索 | 未测量 | 预计 < 1s | 显著 |
| 正则搜索 | 不支持 | 支持 | 新功能 |

### 4. 搜索架构

```
┌──────────────────────────────────────┐
│  search-extension (前端)              │
│  search-service.ts, search-session    │
├──────────────────────────────────────┤
│  Go Agent internal/search/           │
│  ├── 优先：ripgrep (rg)              │
│  ├── 回退：find (Windows) / grep     │
│  └── 流式：WebSocket 事件推送        │
├──────────────────────────────────────┤
│  bundled/ripgrep/                    │
│  ├── rg.exe (Windows)               │
│  └── rg (macOS/Linux)               │
└──────────────────────────────────────┘
```

### 5. 测试覆盖

- `internal/search/benchmark_test.go`：搜索性能基准测试
- 搜索服务测试：`search-service.test.cjs`（前端）
- 门禁集成：搜索首批结果门禁（≤ 0.3s）

## Alternatives Considered

### 替代方案 A：使用 `git grep`
`git grep` 是 Git 内置的搜索工具，支持 `.gitignore` 排除。但 `git grep` 需要 Git 仓库，不支持非 Git 项目，且性能不如 ripgrep。

### 替代方案 B：使用 Go 自实现搜索
使用 Go 的 `filepath.Walk` + `bufio.Scanner` 实现搜索。此方案不依赖外部工具，但性能远不如 ripgrep（单线程、无 SIMD 优化）。

### 替代方案 C：使用 Everything SDK (Windows)
Everything 是 Windows 上的高性能文件搜索引擎。但 Everything SDK 仅支持文件名搜索，不支持全文搜索，且需要 Everything 服务运行。

## Consequences

### 正面影响
- 搜索首批结果提升 32%（0.231s → 0.158s）
- 支持正则表达式搜索（新功能）
- 自动排除 `.gitignore` 中的文件
- 流式输出，首批结果即刻返回
- 跨平台一致的搜索体验

### 负面影响
- 捆绑 ripgrep 增加约 5MB 的安装包大小
- 需要维护 ripgrep 的版本更新
- ripgrep 的许可证需要记录在 `LICENSE-INVENTORY.md` 中

### 后续工作
- 捆绑 ripgrep 二进制文件到 `bundled/ripgrep/`
- 在 CI 中验证 ripgrep 可用性
- 添加 `--hidden` 和 `--no-ignore` 选项支持
- 大项目（100k+ 文件）性能基准测试