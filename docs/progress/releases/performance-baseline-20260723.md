# Kairo IDE Performance Baseline — 2026-07-23

## Overview

- **Date**: 2026-07-23
- **Platform**: macOS (darwin) arm64, 10 CPUs, 32GB RAM
- **Toolchain**: Node.js v23.11.0, pnpm 9.15.9, Go 1.26.4
- **Git Commit**: `6b2fb071abfa3ee46c718827535935615c328c0c` (main, dirty)

## Test Execution Summary

| Category | Total | Pass | Fail | Pass Rate | Duration |
|----------|-------|------|------|-----------|----------|
| Supply Chain | 15 | 15 | 0 | 100% | 3.5s |
| Go Unit Tests | 33 pkgs | 32 pkgs | 1 pkg | 97.0% | 19.7s |
| Frontend Tests | 173 | 172 | 1 | 99.4% | 32.5s |
| **Total** | **220** | **219** | **2** | **99.55%** | **43.6s** |

### Go Test Execution Times by Package

| Package | Status | Time (ms) |
|---------|--------|-----------|
| internal/provider/runtime | PASS | 5,096 |
| internal/repository | PASS | 3,453 |
| internal/deploy | PASS | 1,326 |
| internal/jdtproject | PASS | 1,260 |
| internal/transport/events | PASS | 1,113 |
| internal/tomcat6 | PASS | 1,066 |
| internal/proc | PASS | 1,033 |
| internal/api | **FAIL** | 759 |
| internal/jdtls | PASS | 758 |
| internal/build | PASS | 731 |
| internal/runtimeplan | PASS | 593 |
| internal/services | PASS | 480 |
| internal/toolchain | PASS | 362 |
| internal/app | PASS | 267 |
| internal/atomicfile | PASS | 266 |
| internal/provider/build | PASS | 257 |
| internal/catalinabase | PASS | 235 |
| internal/diagnostics | PASS | 212 |
| internal/search | PASS | 126 |
| internal/security | PASS | 124 |
| internal/debug | PASS | 63 |
| internal/pathpolicy | PASS | 43 |
| internal/audit | PASS | 28 |
| internal/config | PASS | 21 |
| internal/domain | PASS | 12 |
| test/integration | PASS | 10 |
| internal/encoding | PASS | 9 |
| internal/log | PASS | 7 |
| internal/sql | PASS | 7 |
| internal/cmd/kairo-runtime | PASS (no tests) | 0 |
| internal/api/protocol | PASS (no tests) | 0 |
| internal/bootstrap | PASS (no tests) | 0 |
| internal/maven | PASS (no tests) | 0 |

### Frontend Test Execution Times by Package

| Package | Tests | Pass | Fail | Time (ms) |
|---------|-------|------|------|-----------|
| tomcat-extension | 23 | 23 | 0 | 27,212 |
| runtime-extension | 22 | 22 | 0 | 2,132 |
| drivelist-stub | 6 | 6 | 0 | 1,048 |
| protocol | 17 | 17 | 0 | 957 |
| ui-kit | 6 | 6 | 0 | 955 |
| config-schema | 23 | 23 | 0 | 945 |
| java-extension | 56 | 55 | 1 | 806 |
| build-extension | 4 | 4 | 0 | 743 |
| jsp-extension | 12 | 12 | 0 | 352 |
| project-extension | 4 | 4 | 0 | 8 |
| sql-extension | 0 | 0 | 0 | 4 |

### Pre-existing Failures

1. **Go: internal/api** — `TestEncoding_Detect_GBK_HelloJsp` (known pre-existing failure)
2. **Frontend: java-extension** — 1 auto-restart assertion (known pre-existing failure)

## Package Sizes

| Package | Size |
|---------|------|
| java-extension | 1.6 MB |
| search-extension | 1.0 MB |
| theia-product | 966 KB |
| git-extension | 676 KB |
| jsp-extension | 632 KB |
| runtime-extension | 600 KB |
| encoding-extension | 552 KB |
| tomcat-extension | 548 KB |
| project-extension | 472 KB |
| ui-kit | 448 KB |
| test-extension | 444 KB |
| sql-extension | 396 KB |
| build-extension | 332 KB |
| config-schema | 192 KB |
| protocol | 180 KB |
| drivelist-stub | 28 KB |

## Code Line Counts

| Language | Files | Lines | % of Total |
|----------|-------|-------|------------|
| TypeScript | 394 | 46,805 | 51.0% |
| Go | 167 | 45,038 | 49.0% |
| **Total** | **561** | **91,843** | 100% |
| Test files | 100 | 22,295 | 24.3% of total |

## Memory Baseline

| Metric | Value |
|--------|-------|
| Baseline RSS | 39 MB |
| Peak Memory | 118 MB |
| Steady Memory | 118 MB |
| Idle Memory | 41 MB |
| Memory Samples | 7 |

## Performance Gates

| Gate | Target | Measured | Status |
|------|--------|----------|--------|
| Supply Chain Tests | 0 failures | 0 failures | ✅ PASS |
| Go Unit Tests | 0 failures | 1 failure | ❌ FAIL (pre-existing) |
| Frontend Tests | 0 failures | 1 failure | ❌ FAIL (pre-existing) |
| Cold Start | ≤ 8,000ms | N/A (requires running IDE) | ⚠️ NOT MEASURED |
| Search First | ≤ 3,000ms | 27ms | ✅ PASS |
| Search Subsequent | — | 13ms | ✅ PASS |
| Java Completion | ≤ 1,500ms | 1,371ms | ✅ PASS |
| Build Incremental | ≤ 2,000ms | N/A (requires running IDE) | ⚠️ NOT MEASURED |
| Memory Steady | ≤ 1,228MB | 118MB | ✅ PASS |

## Comparison with Previous Baseline

Previous baseline: `2026-07-23T01:35:00.000Z` (same day, earlier run)

| Metric | Previous | Current | Change |
|--------|----------|---------|--------|
| Go Lines of Code | 45,038 | 45,038 | 0% |
| TS Lines of Code | 46,805 | 46,805 | 0% |
| Total Lines of Code | 200,403 | 91,843 | — (different counting method) |
| node_modules Size | 1.6 GB | 1.55 GB | -3.1% |
| Go Binary Size | 13 MB | 13.5 MB | +3.8% |
| Supply Chain Test Time | 3,467ms | 3,500ms | +1.0% |
| Go Test Time | 7,200ms | 19,717ms | — (different measurement) |
| Frontend Test Time | 42,000ms | 32,463ms | -22.7% |

## Artifact Integrity

- **Checksums**: 881 files across 6 categories (agent, frontend, jdtls, tomcat6, scripts, docs)
- **Signature**: HMAC-SHA256 signed
- **Supply Chain Lock**: 6 dependencies tracked (tomcat6 x3, jdtls x3)
- **Bundled Licenses**: Tomcat 6 (Apache-2.0), JDT LS (EPL-2.0)

## Conclusion

- **Overall**: 99.55% test pass rate (219/220)
- **Pre-existing failures**: 2 known issues (Go internal/api, java-extension)
- **Performance**: Search and Java completion well within targets
- **Cold start and build**: Not measured in this run (requires running IDE)
- **Recommendation**: Fix pre-existing test failures before next release candidate