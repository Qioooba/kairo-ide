# ADR-0030 — 企业合规性套件架构

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 6)

## Context

Kairo IDE 面向企业级 Java 遗留项目开发场景，需要满足企业 IT 治理的合规性要求。这包括基于角色的访问控制（RBAC）、单点登录（SSO）集成、数据保留策略和可审计的操作日志。

Wave 14 的核心目标是构建完整的合规性基础设施，使 Kairo IDE 能够部署在受监管的企业环境中，满足 SOC 2、ISO 27001 等合规框架的基本要求。

## Decision

### 1. 整体架构

合规性套件分布于两个包：

```
runtime-agent/internal/
├── security/
│   ├── rbac.go       # 基于角色的访问控制
│   ├── sso.go        # OIDC + SAML 单点登录
│   └── retention.go  # 数据保留策略
└── audit/
    └── audit.go      # 审计日志（NDJSON + CEF + HMAC 签名）
```

前端 UI 位于 `packages/theia-product/src/main/browser/kairo-compliance-widget.tsx`。

### 2. RBAC：4 角色层次模型

**决策：Admin > Auditor > Developer > Viewer 四级层次模型**

角色定义：

| 角色 | 权限 | 适用场景 |
|------|------|----------|
| `admin` | read, write, execute, admin, audit_read | 系统管理员，全部权限 |
| `auditor` | read, audit_read | 合规审计员，只读+审计日志访问 |
| `developer` | read, write, execute | 开发者，读写执行 |
| `viewer` | read | 只读观察者 |

权限粒度：
- `read`：读取项目文件、构建日志
- `write`：修改文件、配置
- `execute`：运行构建、调试、部署
- `admin`：管理用户、配置系统
- `audit_read`：访问审计日志和合规报告

`RBACManager` 实现：
- `CheckPermission(role, permission)`：检查角色是否拥有权限
- `HasRole(userRoles, requiredRole)`：精确匹配检查
- `IsHigherOrEqual(userRole, requiredRole)`：层次比较（Admin ≥ Auditor ≥ Developer ≥ Viewer）
- `GetRolePermissions(role)`：获取角色权限列表
- 线程安全：所有方法使用 `sync.RWMutex`

### 3. SSO：OIDC + SAML 双协议

**决策：OIDC 为主，SAML 2.0 为辅，支持企业常用 IdP**

#### OIDC 集成

`SSOManager` 实现标准 Authorization Code Flow：
- `GetAuthorizationURL(state)`：构建授权 URL，含 CSRF state 参数
- `ExchangeCode(code)`：用授权码交换 Token（access_token、id_token、refresh_token）
- `GetUserInfo(accessToken)`：获取用户信息（sub、name、email、groups）
- `ValidateIDToken(rawToken)`：验证 JWT ID Token（检查三部分结构、Base64 解码、exp 过期、iss 签发者匹配）
  - 注意：不验证签名，生产环境需集成 JWT 库

配置项：
- `Issuer`：OIDC 提供商 URL
- `ClientID` / `ClientSecret`：OAuth 2.0 客户端凭证
- `RedirectURI`：回调地址
- `Scopes`：默认 `openid profile email`

#### SAML 2.0 集成

`SAMLManager` 实现：
- `GenerateAuthnRequest()`：生成 Base64 编码的 SAML 认证请求，含随机 RelayState
- `ValidateSAMLResponse(encodedResponse)`：解析 SAML 响应，提取 NameID 和属性
- 属性映射：`AttributeMapping` 将 SAML 属性映射到标准字段

SAML 响应解析支持：
- Subject NameID
- Conditions（NotBefore / NotOnOrAfter）
- AttributeStatement（名称-值对）

#### 辅助功能

- `BuildSAMLResponseXML()`：构建测试用 SAML 响应
- `BuildJWTToken()`：构建测试用 JWT（含假签名）
- CSRF 保护：随机生成 RelayState 和 SAML Request ID

### 4. 数据保留策略

**决策：4 类预定义策略，支持年龄和大小双重限制**

`RetentionManager` 预定义策略：

| 策略名称 | 资源类型 | 最大年龄 | 最大大小 | 自动清理 | 删除前归档 |
|---------|---------|---------|---------|---------|-----------|
| logs-retention | logs | 30 天 | 500 MB | 是 | 否 |
| artifacts-retention | artifacts | 90 天 | 2 GB | 是 | 是 |
| backups-retention | backups | 60 天 | 5 GB | 否 | 是 |
| sessions-retention | sessions | 7 天 | 100 MB | 是 | 否 |

策略实现：
- `ShouldRetain(resourceType, age, size)`：判断资源是否应保留
- `ApplyRetention(targetDir)`：扫描目录，按策略删除/归档过期文件
- `ApplyRetentionByType(targetDir, resourceType)`：按特定资源类型执行保留策略
- 资源类型分类：基于文件扩展名（`.log` → logs、`.war`/`.jar` → artifacts、`.gz`/`.tar` → backups、`.session` → sessions）
- 归档功能：删除前将文件复制到 `archive/` 子目录，带时间戳命名

### 5. 审计日志：HMAC 签名 + CEF 格式

**决策：NDJSON 为主存储格式，支持 HMAC-SHA256 签名、CEF 格式导出和合规报告**

`audit.Log` 实现：

#### 日志格式

- **主格式**：NDJSON（每行一个 JSON 对象），文件权限 `0600`
- **事件结构**：含 `ts`、`level`、`category`、`component`、`userId`、`sourceIp`、`action`、`target`、`result`、`signature`、`fields`
- **事件分类**：10 种类别（create、read、update、delete、authentication、configuration、deployment、build、debug、system、security、network）

#### HMAC 签名

- 签名算法：HMAC-SHA256，Base64 编码
- 签名载荷：`ts|category|component|userId|action|target|result`（确定性拼接）
- 签名验证：`VerifySignature()` 使用 `hmac.Equal` 常时比较防时序攻击
- 配置方式：`WithSigningKey(key)` 选项

#### 日志轮转

- 基于大小触发：`WithRotation(maxSize, maxBackups)`
- 轮转策略：关闭当前文件 → 重命名为 `path.<timestamp>` → 创建新文件
- 备份清理：`cleanupBackups()` 按名称排序，删除最旧备份
- 归档：`ArchiveTo(archiveDir)` 将轮转文件移至归档目录

#### CEF 格式

- `ToCEF()`：将事件转换为 Common Event Format，兼容 ArcSight、Splunk 等 SIEM 系统
- 格式：`CEF:0|Kairo|KairoIDE|0.1.0|<signatureID>|<name>|<severity>|<extension>`
- 严重级别映射：error/critical→9、warn→5、info→1、其他→0
- 扩展字段：类别、源 IP、用户、组件、请求 ID、结果、工作区 ID、项目 ID、目标

#### 合规报告

`GenerateComplianceReport()` 生成 `ComplianceReport`：
- 按类别统计（`ByCategory`）
- 按结果统计（`ByResult`：ok/denied/error）
- 按级别统计（`ByLevel`）
- 按组件统计（`ByComponent`）
- 拒绝事件列表（`DeniedEvents`）
- 错误事件列表（`ErrorEvents`）
- 完整性验证（`Integrity`）：签名验证通过/失败/未签名事件计数

### 6. 前端 UI

`KairoComplianceWidget`（`kairo-compliance-widget.tsx`）提供 4 个标签页：

- **RBAC Roles**：展示 4 个角色及其权限矩阵（Admin/Auditor/Developer/Viewer）
- **Audit Log**：审计事件列表，支持搜索、按操作类型和结果过滤，显示结果徽章（ok/denied/error）
- **Retention**：保留策略列表，显示资源类型、最大年龄、最大大小、自动清理状态
- **SSO**：SSO 配置状态，显示启用状态、提供者类型（OIDC/SAML）、签发者、配置状态

## Alternatives Considered

### 替代方案 A：使用 Open Policy Agent (OPA) 进行授权
OPA 提供更灵活的 Rego 策略语言，但需要额外的 OPA 服务部署和维护。对于 Kairo IDE 的 RBAC 需求，内置 4 角色模型已足够，引入 OPA 过于复杂。

### 替代方案 B：仅支持 OIDC，不支持 SAML
OIDC 是现代标准，但许多大型企业（特别是金融、政府）仍使用 SAML 2.0。双协议支持确保最大化企业兼容性。

### 替代方案 C：使用外部审计系统（如 Elasticsearch + Filebeat）
外部审计系统提供更强大的搜索和分析能力，但增加部署复杂度。当前基于文件的 NDJSON 审计日志可作为后续集成外部系统的基础。

### 替代方案 D：使用 syslog 协议进行审计日志传输
syslog 是标准的企业日志协议，但 NDJSON 格式更易于程序化处理和 JSON 生态集成。CEF 格式支持弥补了 SIEM 集成需求。

## Consequences

### 正面影响
- 4 角色 RBAC 覆盖企业常见权限模型，满足最小权限原则
- OIDC + SAML 双协议覆盖主流企业 IdP（Okta、Azure AD、Keycloak、ADFS）
- 预定义保留策略满足 SOC 2 和 ISO 27001 的数据生命周期管理要求
- HMAC 签名确保审计日志不可篡改，支持合规审查
- CEF 格式支持与 SIEM 系统（Splunk、ArcSight）集成
- 合规报告提供完整的审计概览，满足内部和外部审计需求
- 前端 UI 提供直观的合规状态可视化

### 负面影响
- RBAC 不支持动态角色和权限继承（仅 4 固定角色，无法自定义）
- OIDC ID Token 签名验证未实现（当前仅验证 exp 和 iss），生产环境需集成 JWT 库
- SAML 不支持加密断言和签名验证
- 保留策略基于文件修改时间，无法处理逻辑删除时间
- 审计日志签名密钥管理未提供（密钥轮转、安全存储等）
- 保留策略中的预定义大小限制（500MB/2GB/5GB）可能不适合所有企业场景

### 后续工作
- 实现自定义角色和权限定义（支持用户自定义 RBAC 矩阵）
- 集成 JWT 库进行完整的 ID Token 签名验证
- 实现 SAML 断言的 XML 签名验证
- 添加审计日志签名密钥管理（密钥轮转、KMS 集成）
- 支持保留策略的运行时配置（通过 API 或配置文件）
- 添加审计日志到外部 SIEM 的实时转发
- 实现合规报告的计划生成和邮件通知