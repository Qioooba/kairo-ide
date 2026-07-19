# Kairo IDE — Delivery Status

> **Last updated:** 2026-07-19
> **Baseline:** Wave 0 of `docs/DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md`
> **Ground truth:** `docs/MILESTONES.md`

## Status Matrix

### 已完成

| Component | Evidence |
|-----------|----------|
| Go compilation | `go build ./...` passes (exit 0) |
| Go vet | `go vet ./...` passes (exit 0) |
| TS type check | `tsc --noEmit` passes (exit 0) |
| Encoding validation | API endpoint exists |
| Basic search | Verified |
| Remote fail-closed (security) | Non-loopback fails |
| Runtime Client tests | 38 tests (14 existing + 24 new dynamic route tests) |
| Encoding service tests | 9 tests |
| Kairo command registration tests | 2 tests |

### 部分完成

| Component | Notes |
|-----------|-------|
| LSP frame bridge | Content-Length framing, binary-safe WebSocket bridge |
| JDT project model generator | `.classpath` / `.project` / `.settings` writer |
| JDT LS distribution | Fixed version URL, installer exists; need real SHA verification (N-040) |
| Frontend state machine | `JavaServiceState` with honest state transitions |
| Project domain types | `internal/domain/project.go` exists, not wired |
| Project repository | `internal/repository/` exists, not used by main |
| Atomic file writes | `internal/repository/atomicfile.go` has unresolved issues (N-015) |
| Typed API handlers | Still uses RawMessage (N-010) |
| EventHub | `internal/transport/events/eventhub.go` exists, not injected (N-008) |
| Ant provider | `provider/build/ant.go` exists, not wired, no Validate (N-005) |
| Javac provider | `provider/build/javac.go` has path issues (N-006) |
| Build use case | `app/build_impl.go` exists, sync execution, no cancel (N-004) |
| Deploy engine | `app/deploy_impl.go` exists, wrong target dirs (N-007) |
| Tomcat provider | `provider/runtime/tomcat6_provider.go` has hardcoded timeout (N-017) |
| Server lifecycle | `app/server_impl.go` exists, no reconciliation (N-016) |
| Runtime connection | Multiple implementations exist, duplicate (N-023) |
| Workspace context | `workspace-context-service.ts` exists, not initialized (N-026) |
| Active project | `active-project-service.ts` exists, not persisted (N-026) |
| Import wizard | `import-wizard-widget.tsx` exists, save doesn't save (N-027) |
| Build store | `build-store.ts` exists, no snapshot/event wiring (N-032) |
| Server store | `server-store.ts` exists, no snapshot/event wiring (N-032) |
| Build view | React widget exists, not replacing old widget (N-029) |
| Server view | React widget exists, not replacing old widget (N-029) |
| Log viewer | `log-viewer-widget.tsx` exists, shows fake data (N-033) |
| Status bar | Exists, error → empty array (N-031) |
| Theme | Theme contribution exists, triple token source (N-034) |
| Theia backend LS | `java-language-server-contribution.ts`, not real LS (N-036) |
| Browser LanguageClient | `java-language-client-contribution.ts`, not real client (N-037) |
| Desktop main | `apps/desktop/main.ts` rewritten, config mismatch (N-018) |
| Process cleanup | Has shutdown logic, needs testing |
| Local secret auth | Middleware exists, frontend not sending (N-019) |
| Sandbox paths | WorkspaceRoots exists, test fixtures broken (N-011) |
| Atomic recode | temp+fsync+rename, some issues remaining |
| GBK round-trip | Frontend fixes done, need E2E test |
| Properties escape | Utility exists, not integrated |
| CI matrix | `.github/workflows/ci.yml` exists; most CI jobs are blocked |

### 未开始

| Component | Blocker |
|-----------|---------|
| Go unit tests | `internal/api` encoding tests fail with sandbox errors (N-011) |
| Go race tests | Depends on unit tests passing |
| Composition root | Still uses `NewMemoryServices` (N-001) |
| TS build | TS6305/TS2742 in theia-product (N-043) |
| TS tests | encoding-extension missing deps (N-044) |
| Server restart | UI still calls Stop/Start (N-030) |
| Completion (Java) | |
| Definition/F12 (Java) | |
| Diagnostics (Java) | |
| Theia backend start | Fixed port 3000, not starting Theia (N-021) |
| Secret injection | `executeJavaScript`, wrong timing (N-020) |
| Packaging (desktop) | |
| Go unit CI | Tests fail |
| TS build CI | Build fails |
| Integration CI | Tomcat not prepared (N-042) |
| E2E tests | Uses gated steps (N-047, N-048) |
| Contract tests | |
| Windows tests | |
| Context lines (search) | |
| Legacy streaming (search) | |
| DAP/JDWP Debug | |
| Java 6 source compliance | |
| Bundled Tomcat 6/JDK 6 | |

## Known Limitations (v0.4)

- **No real Java intelligence end-to-end**: JDT LS can be spawned but no Playwright proof of completion/definition/diagnostics in the IDE. The dev environment lacks JDK 17+.
- **No DAP/JDWP Debug**: The `/api/v1/servers/{id}/debug` endpoint starts Tomcat with JDWP args, but no breakpoint → hit proof exists.
- **No Java 6 bytecode compliance**: JDT LS runs on modern JRE; `sourceLevel=1.6` is passed but legacy bytecode generation requires external JDK 6 toolchain.
- **No bundled Tomcat 6/JDK 6**: CI fetches via pinned SHA-256 scripts, not vendored in repo.
- **Go tests blocked**: `internal/api` encoding sandbox tests fail with "path is outside any authorized workspace root".
- **TS build broken**: theia-product has TS6305/TS2742 errors.
- **Theia backend not starting**: Fixed port 3000 issue.

## What's Real

- `runtime-agent/`: Go backend with JDT LS distribution installer, LSP frame bridge, JDT project model generator, build/deploy/encoding/search APIs
- `packages/`: Theia extensions for Java, Tomcat, encoding, build, project, runtime, search, JSP, UI kit
- `tests/e2e/ui-full-chain.cjs`: Playwright UI test with gated steps
- `.github/workflows/ci.yml`: CI matrix (Go + TS + E2E)
- 129 Go test cases, 38 Runtime Client tests, 9 Encoding service tests, 2 Kairo command registration tests

## Verification

```bash
# Go
cd runtime-agent && go build ./... && go vet ./...

# TypeScript
pnpm -r --filter "./packages/*" exec tsc --noEmit

# Verify
pnpm verify
```