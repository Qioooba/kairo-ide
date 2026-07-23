# P1-SUPPLY-01 版本锁、Checksum 与许可证清单

- 状态：`blocked`
- 本切片：供应链失败关闭门禁
- 更新时间：2026-07-22

## 已完成

1. 新增 `scripts/supply-chain-lock.json`，首批锁定：
   - Apache Tomcat 6.0.53，Apache-2.0，要求 `LICENSE`、`NOTICE`；
   - Eclipse JDT Language Server 1.43.0，EPL-2.0，要求 `LICENSE`。
2. 删除 CI 中 `PLACEHOLDER_UPDATE_BEFORE_RELEASE` checksum。真实值不得猜测或提交占位符。
3. 新增 `scripts/fetch-verified-archive.cjs`：仅允许 HTTPS；连接最长 10 秒、单次网络最长 30 秒；先下载到临时文件，SHA-256 匹配后原子发布；缺失/占位/非 64 位十六进制/哈希不匹配全部失败。
4. Tomcat 下载脚本复用统一验证器；已有缓存也必须重新校验。
5. JDT LS 归档 URL 与 SHA-256 必须通过 GitHub Repository Variables 显式配置，避免继续使用未经证明的文件名。
6. 新增 `scripts/verify-bundled-dependencies.cjs`，检查离线包关键运行文件、锁定版本和许可证；`prepare-bundled.sh --strict` 在打包时执行该门禁。
7. 新增 11 个供应链/超时门禁单测，并接入 CI；包含平台 lock/config 选择、PowerShell Strict 契约、孙进程清理和 Windows taskkill watchdog 探针。
8. `prepare-bundled.ps1` 统一写入 `bundled/jdtls`；`-Strict` 必须先验证 Windows 两个归档配置，再验证 `config_win`、版本、关键文件和许可证。
9. Tomcat 统一写入 `bundled/tomcat6/apache-tomcat-6.0.53`；Windows Strict 构建始终下载并解压 URL/SHA 已通过锁文件校验的构建期归档，不接受未经完整性证明的本地安装树。
10. `build:win` 与 Windows CI 在复制产物前执行同一 Strict 门禁；正式 staging 隔离在 `apps/desktop/bundled`，仅接收 `tomcat6`、`jdtls` 白名单目录。
11. Windows 打包先生产构建 Browser，再 strict-copy frontend/backend；缺失/空输入失败关闭，目标目录先清理，避免陈旧 UI 混入安装包。
9. 离线结构验证器按运行平台选择 `config_linux`、`config_mac` 或 `config_win`，并强制要求对应的 `*-linux`、`*-macos` 或 `*-windows` lock id。

## 发布所需仓库变量

| 变量 | 要求 |
|---|---|
| `KAIRO_TOMCAT6_SHA256` | 经 Apache 签名/KEYS 链路线下核验后的 64 位 SHA-256 |
| `KAIRO_JDTLS_ARCHIVE_URL` | 已批准的 JDT LS 1.43.0 官方 HTTPS 归档地址 |
| `KAIRO_JDTLS_SHA256` | 对上述精确字节归档线下核验后的 64 位 SHA-256 |
| `KAIRO_TOMCAT6_WINDOWS_ARCHIVE_URL` | 已批准的 Windows Tomcat 6.0.53 官方 HTTPS 归档地址 |
| `KAIRO_TOMCAT6_WINDOWS_SHA256` | 对 Windows Tomcat 精确归档核验后的 64 位 SHA-256 |
| `KAIRO_JDTLS_WINDOWS_ARCHIVE_URL` | 已批准的 Windows JDT LS 1.43.0 官方 HTTPS 归档地址 |
| `KAIRO_JDTLS_WINDOWS_SHA256` | 对 Windows JDT LS 精确归档核验后的 64 位 SHA-256 |

## 当前审计结果

| 对象 | 结果 |
|---|---|
| `bundled/tomcat6/apache-tomcat-6.0.53` | 结构及 LICENSE/NOTICE 门禁通过 |
| `bundled/jdtls` | 门禁失败：检测版本 1.55.0，与锁定 1.43.0 不符；缺少 LICENSE |
| CI 占位 checksum | 已移除，缺少真实配置时明确失败 |

## 阻塞与完成条件

- 负责人必须从官方发布物和签名链路核验 Linux/macOS 共用的三个仓库变量，当前不得由 AI 推测。
- Windows `-Strict` 还要求上述四个 Windows 专用变量；真实值缺失时门禁按设计失败关闭。
- 重新制作 JDT LS 离线目录，使版本、归档 SHA-256 与 EPL-2.0 许可证证据一致。
- Windows 归档（如与 Linux 字节不同）需新增独立 lock id 与独立 checksum。
- 后续仍需生成完整 SBOM、第三方 Notice 和签名产物。

在以上证据齐全前，本任务不得标记为 Done，发布包门禁保持失败关闭。
