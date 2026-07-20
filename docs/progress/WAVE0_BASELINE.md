# Wave 0 Baseline Report

> Date: 2026-07-19
> Executed by: Integration Lead
> Purpose: Establish verified CI baseline before Wave 1 development

## 1. Go Tests

```bash
$ cd runtime-agent && go clean -testcache && go test -count=1 ./...
ok  	github.com/kairo-ide/runtime-agent/internal/api	0.561s
ok  	github.com/kairo-ide/runtime-agent/internal/atomicfile	0.179s
ok  	github.com/kairo-ide/runtime-agent/internal/audit	0.014s
ok  	github.com/kairo-ide/runtime-agent/internal/build	0.404s
ok  	github.com/kairo-ide/runtime-agent/internal/catalinabase	0.215s
ok  	github.com/kairo-ide/runtime-agent/internal/config	0.021s
ok  	github.com/kairo-ide/runtime-agent/internal/deploy	1.139s
ok  	github.com/kairo-ide/runtime-agent/internal/domain	0.012s
ok  	github.com/kairo-ide/runtime-agent/internal/encoding	0.008s
ok  	github.com/kairo-ide/runtime-agent/internal/jdtls	0.697s
ok  	github.com/kairo-ide/runtime-agent/internal/jdtproject	1.104s
ok  	github.com/kairo-ide/runtime-agent/internal/log	0.008s
ok  	github.com/kairo-ide/runtime-agent/internal/pathpolicy	0.092s
ok  	github.com/kairo-ide/runtime-agent/internal/proc	0.964s
ok  	github.com/kairo-ide/runtime-agent/internal/provider/runtime	3.590s
ok  	github.com/kairo-ide/runtime-agent/internal/repository	2.439s
ok  	github.com/kairo-ide/runtime-agent/internal/runtimeplan	0.691s
ok  	github.com/kairo-ide/runtime-agent/internal/search	0.129s
ok  	github.com/kairo-ide/runtime-agent/internal/security	0.154s
ok  	github.com/kairo-ide/runtime-agent/internal/services	0.012s
ok  	github.com/kairo-ide/runtime-agent/internal/tomcat6	0.750s
ok  	github.com/kairo-ide/runtime-agent/internal/toolchain	0.266s
ok  	github.com/kairo-ide/runtime-agent/internal/transport/events	0.111s
ok  	github.com/kairo-ide/runtime-agent/test/integration	0.009s

Result: 26 packages, 0 failures, exit 0
```

## 2. Go Race Detection

```bash
$ cd runtime-agent && go test -count=1 -race ./...
Result: 26 packages, 0 data races, exit 0
```

## 3. Go Vet

```bash
$ cd runtime-agent && go vet ./...
Result: 0 warnings, exit 0
```

## 4. TypeScript Build

```bash
$ pnpm clean && pnpm build
Result: 13 packages + 2 apps built, exit 0
```

### Fixes applied to pass build:

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| TS6305 in runtime-extension | `pnpm clean` did not remove `tsconfig.tsbuildinfo` files; stale build info caused `tsc` to skip emission | Added tsbuildinfo cleanup to root `package.json` clean script |
| theia-product lib/ missing after build | `tsc -p` with 10 project references does not emit when tsbuildinfo is stale | Changed build to `tsc -b --force` in `packages/theia-product/package.json` |
| Browser bind security | `start:browser` used `--hostname=0.0.0.0` | Changed to `--hostname=127.0.0.1` |

## 5. Frontend Tests

```bash
$ pnpm -r --filter './packages/*' test
```

| Package | Tests | Pass | Fail |
|---------|-------|------|------|
| runtime-extension | 14 | 14 | 0 |
| encoding-extension | 10 | 10 | 0 |
| jsp-extension | 2 | 2 | 0 |
| java-extension | 1 | 1 | 0 |
| theia-product | 6 | 6 | 0 |
| protocol | 0 | — | — |
| ui-kit | 0 | — | — |
| config-schema | 0 | — | — |
| project-extension | 0 | — | — |
| search-extension | 0 | — | — |
| tomcat-extension | 0 | — | — |
| build-extension | 0 | — | — |
| **Total** | **33** | **33** | **0** |

## 6. CI Integration

- `KAIRO_LEGACY_SAMPLE` is set in the `go-integration` job (line 139 of `.github/workflows/ci.yml`)
- Contract tests are real (start agent, hit API, assert)
- No `gated` or `skip` in core integration paths

## 7. Browser Bind

- `apps/browser/package.json` start: `--hostname=127.0.0.1`
- `apps/browser/package.json` dev: `--hostname=127.0.0.1`
- `packages/theia-product/package.json` start:browser: `--hostname=127.0.0.1`

## 8. Server Mode

- `apps/server/` directory does not exist in the repository
- No action needed

## 9. Known Items for Subsequent Waves

| Item | Wave | Notes |
|------|------|-------|
| JSON-RawMessage in service layer | Wave 1 | Composition root convergence |
| Duplicate runtime connection implementations | Wave 3 | Frontend state flow |
| Import wizard save doesn't persist | Wave 3 | Frontend state flow |
| Build/Server stores missing event wiring | Wave 3 | Frontend state flow |
| Log viewer shows fake data | Wave 3 | Frontend state flow |
| JDT LS not real LS | Wave 4 | Java language intelligence |
| Desktop packaging not started | Wave 5 | Desktop productization |
| E2E tests need expansion | Wave 6 | Testing & quality |

## 10. Files Changed in Wave 0

| File | Change |
|------|--------|
| `package.json` | Clean script: add tsbuildinfo cleanup |
| `packages/theia-product/package.json` | Build: `tsc -b --force`; Clean: rm tsbuildinfo; start:browser: 127.0.0.1 |
| `docs/MILESTONES.md` | Updated Wave 0 Gate results and TS build status |
| `docs/progress/WAVE0_BASELINE.md` | This file (new) |