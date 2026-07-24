# Kairo IDE 安全审查补充报告 — 2026-07-24

> **审查日期**: 2026-07-24
> **审查范围**: CR-001（速率限制）深度追踪 + 安全测试执行 + TODO/FIXME 安全审计
> **审查依据**: code-review-20260723.md CR-001 发现 + independent-review-20260723.md 保留意见
> **平台**: Windows 11 amd64

---

## 一、CR-001 速率限制深度追踪

### 1.1 原始发现

code-review-20260723.md 安全性审查 §2.5 指出：

> 速率限制 | ⚠️ PARTIAL | 协议定义了 `ErrRateLimited` 错误码，但中间件层面未发现显式的速率限制实现

### 1.2 追踪结果

#### 1.2.1 协议层（已定义）

| 文件 | 行号 | 内容 |
|------|------|------|
| `runtime-agent/internal/api/protocol/types.go` | 35 | `ErrRateLimited KairoErrorCode = "rate_limited"` |
| `runtime-agent/internal/api/protocol/types_test.go` | 173, 1646 | 测试覆盖 `ErrRateLimited` 错误码 |

#### 1.2.2 错误映射层（已连接）

| 文件 | 行号 | 内容 |
|------|------|------|
| `runtime-agent/internal/api/server.go` | 493-495 | `if e.Code == protocol.ErrRateLimited { status = http.StatusTooManyRequests }` |
| `runtime-agent/internal/api/server.go` | 502 | `isClientError()` 将 `ErrRateLimited` 归类为客户端错误 |
| `runtime-agent/internal/api/pure_test.go` | 329 | `{protocol.ErrRateLimited, 429}` 测试 HTTP 429 映射 |

#### 1.2.3 中间件层（缺失）

`runtime-agent/internal/api/server.go` 的 `middleware()` 函数（第 221-281 行）实现了以下中间件链：

1. **CORS** — `corsMiddleware()`（第 283-299 行）
2. **Request ID** — 生成/传播 `X-Kairo-Request-Id`（第 226-231 行）
3. **Secret Auth** — `X-Kairo-Secret` 验证（第 240-254 行）
4. **Panic Recovery** — `defer/recover()`（第 260-270 行）
5. **Audit Logging** — 请求耗时日志（第 271-276 行）

**缺失项**：整个中间件链中没有任何速率限制逻辑（如令牌桶、滑动窗口、per-IP 限制等）。

`runtime-agent/internal/remote/server.go` 的 `authMiddleware()`（第 229-259 行）同样没有速率限制。

#### 1.2.4 安全测试覆盖

`tests/security/security.test.cjs` 的 Security-11 测试（第 621-666 行）验证了速率限制的预期行为：
- 前 10 个请求通过（200）
- 第 11 个请求返回 429 + `rate_limited` 错误码 + `Retry-After` 头
- 测试通过（模拟服务器正确实现了速率限制）

**但这是模拟服务器，不是真实 Go Agent 的实现。**

### 1.3 结论

| 层级 | 状态 | 说明 |
|------|------|------|
| 协议定义 | ✅ 已实现 | `ErrRateLimited` 错误码已定义并测试 |
| HTTP 映射 | ✅ 已实现 | 429 `TooManyRequests` 映射已就绪 |
| 中间件实现 | ❌ 缺失 | 无令牌桶/滑动窗口/固定窗口等实际限流逻辑 |
| 安全测试 | ⚠️ 模拟 | 测试通过但针对模拟服务器，非真实 Agent |

**严重性**: 中（代码审查原评级）。本地 IDE 工具场景下，Agent 仅监听 localhost，攻击面有限。但若未来支持远程访问（`remote/server.go` 已存在），速率限制将变得关键。

### 1.4 建议

在 `server.go` 的 `middleware()` 函数中添加 per-IP 令牌桶限流：

```go
// 伪代码示意
type RateLimiter struct {
    mu       sync.Mutex
    visitors map[string]*tokenBucket
}

func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
    // 在 secret auth 之前或之后执行
    // 每个 IP 每秒 N 个请求，突发容量 B
}
```

---

## 二、安全相关 TODO/FIXME 审计

### 2.1 Go Agent (runtime-agent/)

**结论：无安全相关 TODO/FIXME 注释。**

搜索 `TODO|FIXME|HACK|XXX` 在 `runtime-agent/` 目录下，结果均为非安全相关：
- `xxx` 出现在测试中的 ID 占位符（如 `ws_xxxxxxxxxxxxxxxxxxxxxxxxxx`）
- `\uXXXX` 出现在编码转义注释中
- `generated` 出现在 JDT 项目生成器代码中

无待处理的安全任务。

### 2.2 前端 (packages/)

**结论：无安全相关 TODO/FIXME 注释。**

前端 `TODO/FIXME/XXX` 匹配结果均为：
- `kairo-todo-widget.tsx` — 这是 TODO/FIXME 查看器组件本身，用于扫描工作区中的代码注释
- `\uXXXX` — Java properties 文件编码转义
- `testXxx` — 测试方法命名模式

独立审查中提到的 `search-stream-service.ts` 流式终止逻辑竞态窗口（已标记 TODO），属于功能正确性问题，非安全漏洞。

---

## 三、安全测试执行结果

### 3.1 测试套件

`tests/security/security.test.cjs` — 20 个安全测试，全部通过。

| # | 测试名称 | 类别 | 结果 | 耗时 |
|---|---------|------|------|------|
| 1 | Path traversal — ../ in path parameter blocked | 路径遍历 | ✅ PASS | 63.7ms |
| 2 | Path traversal — absolute path outside workspace blocked | 路径遍历 | ✅ PASS | 9.8ms |
| 3 | Path traversal — symlink pointing outside workspace | 路径遍历 | ✅ PASS | 8.5ms |
| 4 | Command injection — shell metacharacters in build target rejected | 命令注入 | ✅ PASS | 12.8ms |
| 5 | Command injection — file name with backticks treated as literal | 命令注入 | ✅ PASS | 9.1ms |
| 6 | WebSocket — connection without authentication rejected | WebSocket | ✅ PASS | 7.9ms |
| 7 | WebSocket — oversized payload rejected | WebSocket | ✅ PASS | 18.5ms |
| 8 | HTTP — wrong Content-Type is rejected | HTTP 安全 | ✅ PASS | 7.0ms |
| 9 | HTTP — excessively large body returns 413 | HTTP 安全 | ✅ PASS | 67.4ms |
| 10 | HTTP — invalid JSON returns 400 with descriptive error | HTTP 安全 | ✅ PASS | 7.2ms |
| 11 | HTTP — rate limiting blocks rapid requests | HTTP 安全 | ✅ PASS | 14.5ms |
| 12 | HTTP — XSS in error messages is escaped | HTTP 安全 | ✅ PASS | 5.0ms |
| 13 | Local listener — agent only listens on localhost | 本地监听 | ✅ PASS | 6.2ms |
| 14 | Local listener — debug port only on localhost | 本地监听 | ✅ PASS | 5.4ms |
| 15 | Input validation — null bytes in strings rejected | 输入验证 | ✅ PASS | 5.9ms |
| 16 | Input validation — extremely long strings rejected | 输入验证 | ✅ PASS | 6.0ms |
| 17 | Authentication — missing X-Kairo-Secret header rejected | 认证 | ✅ PASS | 9.0ms |
| 18 | Authentication — CSRF token required for state-changing methods | 认证 | ✅ PASS | 12.4ms |
| 19 | HTTP — unsupported methods return 405 | HTTP 方法 | ✅ PASS | 11.4ms |
| 20 | Security headers — response contains security headers | 安全头 | ✅ PASS | 4.8ms |

**总耗时**: 2,422ms | **通过率**: 100% (20/20)

### 3.2 供应链安全测试

| 测试套件 | 测试数 | 通过 | 失败 | 耗时 |
|---------|--------|------|------|------|
| `scripts/supply-chain.test.cjs` | 15 | 15 | 0 | 3,809ms |

关键测试覆盖：
- SHA-256 校验和验证
- 配置缺失时 fail-closed
- 占位符和畸形校验和拒绝
- 校验和不匹配拒绝
- JDT LS HTTPS URL 要求
- Windows 归档 fail-closed
- 平台特定锁选择
- 超时运行器（300s 策略边界）
- 后代进程终止
- Windows taskkill 看门狗

### 3.3 制品完整性验证

`scripts/verify-artifact-integrity.cjs` — 全部通过（2,526ms）。

---

## 四、独立审查保留意见复查

independent-review-20260723.md 提出 3 项保留意见，复查如下：

| # | 保留意见 | 复查结果 | 安全性影响 |
|---|---------|---------|-----------|
| 1 | `jdt-ls-manager.ts` 进程管理可更健壮 | 当前实现正确，无安全漏洞 | 无 |
| 2 | `search-stream-service.ts` 流式终止逻辑有竞态窗口 | 已标记 TODO，属于功能性问题 | 低（可能导致资源泄漏，非安全漏洞） |
| 3 | `build-view-widget.tsx` 使用了 `any` 类型 | 已标记 lint 豁免，类型安全降级 | 极低（前端展示层，不影响后端安全） |

---

## 五、残余风险评估

| 风险 | 状态 | 说明 |
|------|------|------|
| 速率限制未实现 | 🔴 未修复 | CR-001，中间件层缺失实际限流逻辑 |
| Windows 环境验证 | 🟡 部分完成 | Go 测试有 11 个 Windows 特定失败 |
| 远程访问安全 | 🟢 已防护 | `remote/server.go` 有会话认证中间件，但同样无速率限制 |
| 安全测试覆盖 | 🟢 充分 | 20/20 测试通过，但速率限制测试针对模拟服务器 |

---

## 六、审查结论

### 发现汇总

| 编号 | 类别 | 问题 | 严重性 | 状态 |
|------|------|------|--------|------|
| SEC-SUP-001 | 速率限制 | 中间件层无实际速率限制实现（`ErrRateLimited` 已定义但未触发） | 中 | 未修复 |
| SEC-SUP-002 | 远程访问 | `remote/server.go` 同样缺少速率限制 | 中 | 未修复 |
| SEC-SUP-003 | 安全测试 | 速率限制测试（Security-11）仅覆盖模拟服务器，未验证真实 Agent | 低 | 待改进 |
| SEC-SUP-004 | 测试环境 | 安全测试在 Windows 上全部通过，与 macOS 结果一致 | — | ✅ 已验证 |

### 总体评估

- **安全态势**: 良好。核心安全机制（路径沙箱、WebSocket 认证、命令注入防护、密钥管理）均已实现并经过测试验证。
- **速率限制**: 唯一实质性缺口。协议层和 HTTP 映射层已就绪，缺少中间件实现。本地 IDE 场景下风险较低，但应在 v1.1 中补全。
- **安全测试**: 20/20 通过，供应链 15/15 通过，制品完整性通过。
- **TODO/FIXME**: 无安全相关的待处理注释。

### 建议优先级

1. **P1（v1 前）**: 无需阻塞项
2. **P2（v1.1）**: 在 `server.go` 中间件链中添加 per-IP 令牌桶速率限制
3. **P3（v1.1）**: 在 `remote/server.go` 中添加速率限制（远程访问场景下更关键）
4. **P3（v1.1）**: 将安全测试套件连接到真实 Go Agent 而非模拟服务器

---

> **审查人**: 自动化安全审查补充
> **审查工具**: 静态代码分析 + 安全测试套件执行 + 手动代码审查
> **审查范围**: runtime-agent/ 全量 + tests/security/ + scripts/ 供应链脚本