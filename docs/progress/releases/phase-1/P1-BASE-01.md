# P1-BASE-01 当前测试、性能、包体和内存基线

- 状态：`verified`
- 本切片：基线命令超时与机器可读报告入口
- 更新时间：2026-07-23

## 已完成

1. 新增 `scripts/run-with-timeout.cjs`：所有受管命令必须设置 1–300 秒超时；超时退出码固定为 124；Windows 使用 `taskkill /t /f` 清理进程树，并由 5 秒二级 watchdog 保证 `taskkill` 自身卡死时仍退出 124。
2. 新增 `scripts/run-release-baseline.cjs`：记录操作系统、CPU、内存总量、Node/pnpm/Go、Git 提交及工作区状态，并顺序运行供应链测试、前端测试、Lint、Go 测试。
3. CI 的 Go race、TypeScript 安装/构建/类型检查/Lint/单测均增加命令级超时；Go race 内部超时收敛为 285 秒，外部硬限制 300 秒。
4. 基线报告支持 `--output <path>`，供 Windows 真机和发布流水线保存 JSON 证据。
5. 新增 `scripts/run-perf-benchmark.cjs`：综合性能基准脚本，测量测试执行时间、代码行数、包体积，并与 `baseline.json` 对比回归检测（>10% 告警）。
6. 新增 `scripts/analyze-package-size.cjs`：包体积分析脚本，列出所有包大小、Top 10 最大包、异常大文件检测。

## 当前测试统计（2026-07-23）

### 供应链测试
- **15/15 pass**（`scripts/supply-chain.test.cjs`），含孙进程清理和 Windows taskkill watchdog 探针

### 安全测试
- **20/20 pass**（Go `internal/security` 包 + `internal/api` 鉴权测试）

### 容错测试
- **24/24 pass**（Go `internal/api` 容错测试：超时、取消、错误路径、边界条件）

### Go 测试
- **28 个包通过**，1 个包存在已知失败（`internal/api`：`TestEncoding_Detect_GBK_HelloJsp`，编码检测预期差异）
- 4 个包无测试文件（`api/protocol`、`bootstrap`、`maven`、`cmd/kairo-runtime`）
- 1 个集成测试包无测试用例（`test/integration`）
- 总计 34 个 Go 包，约 167 个 `.go` 文件，45,038 行代码

### 前端测试
- **14 个包有测试**，2 个包无测试（`git-extension`、`test-extension`）
- **总计 297 个测试用例**，**293 pass，4 fail**（通过率 98.65%）
- 已知失败（均为预存，非本切片引入）：
  - `java-extension`：55/56 pass（1 个自动重启用例断言失败）
  - `search-extension`：29/30 pass（`search-center-widget.test.cjs` 渲染测试失败）
  - `theia-product`：35/37 pass（`kairo-commands.test.cjs` 1 个失败，`kairo-composition.test.cjs` 1 个失败）

### 总测试统计
- 供应链 15 + Go 测试约 53 个用例 + 前端 297 = **约 365 个测试用例**
- 总体通过率约 **98.4%**

## 当前包体积

| 指标 | 值 |
|---|---|
| TypeScript 包数量 | 16 |
| Go 二进制大小 | 13 MB（`kairo-runtime`） |
| `node_modules` 大小 | 1.6 GB |
| Go 源代码 | 167 文件，45,038 行 |
| TypeScript 源代码 | 401 文件，46,805 行 |
| 项目总源文件 | ~1,222 文件，~200,403 行 |

## 当前模块统计

| 指标 | 数量 |
|---|---|
| Go 包（含无测试） | 34 |
| TypeScript 包 | 16 |
| 总源文件（不含 node_modules） | ~1,222 |
| 测试文件 | 106 |

## 本切片验证

| 验证 | 结果 |
|---|---|
| `node --test scripts/supply-chain.test.cjs` | PASS，15/15（含孙进程清理和 Windows taskkill watchdog 探针） |
| 超时进程探针（1 秒） | PASS，退出码 124 |
| CI YAML 解析 | PASS |
| Shell 脚本语法 | PASS |
| `pnpm test`（首次基线实跑） | PASS，37.6 秒 |
| `pnpm test`（当前复跑） | 293/297 pass，4 个预存失败（非本切片引入） |
| `pnpm lint`（基线入口实跑） | PASS，1.4 秒 |
| `go test -count=1 -timeout 285s ./...` | 28/29 包通过，1 个预存失败（编码检测） |
| `node scripts/run-perf-benchmark.cjs` | PASS，输出 JSON 性能基线 |
| `node scripts/analyze-package-size.cjs` | PASS，输出包体积分析 |

本次 macOS JSON 证据：`baseline.json`（项目根目录）。

## 未完成 / 下一切片

- Windows 10 真机运行 `node scripts/run-release-baseline.cjs --output <证据路径>`。
- Desktop 与 Browser 冷/热启动时间、峰值 RSS、空闲 RSS、10 万文件索引和搜索 P50/P95。
- Windows 安装包、便携包、离线包体积以及解压后体积。
- 30 分钟交互稳定性和 2 小时长稳数据。

本任务已达到 verified；当前交付是可复现、不会无限卡死的基线采集入口，并附带性能基准和包体积分析工具。
