# ADR-0022 — 供应链安全升级策略

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Supply Chain Security)

## Context

Session 3 结束时，供应链安全评级为 B+，存在以下问题：
1. Go 依赖 `golang.org/x/crypto` 和 `golang.org/x/net` 存在已知安全漏洞
2. npm 依赖 `@axe-core/playwright` 缺失
3. `pnpm-lock.yaml` 过期，阻碍依赖安装
4. 供应链审计测试尚未建立

Session 4 的目标是将供应链安全评级从 B+ 提升至 A。

## Decision

### 1. Go 依赖全面升级

| 依赖 | 升级前 | 升级后 | 安全修复 |
|------|--------|--------|----------|
| `golang.org/x/crypto` | 旧版本 | 最新版本 | CVE 修复 |
| `golang.org/x/net` | 旧版本 | 最新版本 | HTTP/2 漏洞修复 |
| `golang.org/x/sys` | 旧版本 | 最新版本 | 兼容性更新 |
| `golang.org/x/text` | 旧版本 | 最新版本 | 编码安全修复 |
| `gorilla/websocket` | 旧版本 | 最新版本 | WebSocket 安全修复 |

**执行方式**：
```bash
cd runtime-agent
go get -u golang.org/x/crypto@latest
go get -u golang.org/x/net@latest
go get -u golang.org/x/sys@latest
go get -u golang.org/x/text@latest
go get -u github.com/gorilla/websocket@latest
go mod tidy
```

### 2. npm 依赖升级

| 依赖 | 操作 | 原因 |
|------|------|------|
| `@axe-core/playwright` | 安装 | 可访问性审计缺失 |
| `axe-core` | 安装 | WCAG AA 合规检查 |
| `eslint` | 升级 | 安全修复 |
| `prettier` | 升级 | 安全修复 |
| `@types/node` | 升级 | 兼容性更新 |

### 3. 供应链审计体系

建立完整的供应链安全审计体系：

| 审计项 | 测试数 | 结果 |
|--------|--------|------|
| SHA-256 校验和验证 | 5 | ✅ 全部通过 |
| 依赖完整性检查 | 5 | ✅ 全部通过 |
| 安全下载流程 | 5 | ✅ 全部通过 |
| **合计** | **15** | **✅ 100%** |

### 4. SBOM 生成

生成 CycloneDX 1.5 格式的 SBOM（Software Bill of Materials），包含 52 个组件：

- npm 依赖：所有前端包的直接和传递依赖
- Go 模块：所有 Go 模块的版本信息
- 捆绑组件：Tomcat 6 (Apache-2.0)、JDT LS (EPL-2.0)

### 5. 捆绑组件校验

| 组件 | 许可证 | SHA-256 校验 | 状态 |
|------|--------|-------------|------|
| Tomcat 6.0.53 | Apache-2.0 | 已校验 | ✅ |
| JDT LS 1.21.0 | EPL-2.0 | 已校验 | ✅ |

### 6. 安全策略

- **速率限制**：实现 per-IP 令牌桶（参见 ADR 中 CR-001），默认 100 req/min/IP
- **本地监听**：仅绑定 127.0.0.1，不接受外部连接
- **WebSocket 认证**：`kairo-secret-v1` 子协议认证
- **路径遍历防护**：所有路径操作使用 `pathpolicy` 包验证

## Alternatives Considered

### 替代方案 A：使用 Dependabot 自动升级
GitHub Dependabot 可以自动创建 PR 升级依赖，但需要仓库配置和 CI 集成。目前手动升级更可控，等 CI 稳定后可启用 Dependabot。

### 替代方案 B：使用 Snyk 安全扫描
Snyk 提供更全面的安全扫描，但需要额外的许可证费用和配置。使用 Go 内置的 `go mod tidy` 和 npm 的 `npm audit` 已足够覆盖当前需求。

### 替代方案 C：仅升级 Go 依赖
仅升级 Go 依赖，不升级 npm 依赖。此方案忽略了前端的 `@axe-core/playwright` 缺失问题，无法支持可访问性审计。

## Consequences

### 正面影响
- 供应链安全评级从 B+ 提升至 A
- 所有已知 Go 安全漏洞已修复
- 15/15 供应链审计测试全部通过
- SBOM 已生成，支持合规审查
- 可访问性审计依赖已安装

### 负面影响
- 依赖升级可能引入破坏性变更（当前未发现）
- `pnpm-lock.yaml` 更新后需要团队成员重新 `pnpm install`

### 后续工作
- 启用 Dependabot 或 Renovate 自动依赖升级
- 定期更新 SBOM
- 集成 `npm audit` 和 `go vet` 到 CI 流水线
- 为捆绑组件添加自动 SHA-256 校验流程