# Kairo IDE Milestones — Current State Matrix

> Last verified: 2026-07-19
> Baseline: Wave 0 of [DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md](./DEEPSEEK_NEXT_ITERATION_MASTER_TASK.md)
> Status: Each item must be one of: verified, partial, not_started, blocked

## Backend Core

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Go compilation | verified | `go build ./...` passes (exit 0) | |
| Go unit tests | blocked | `go test ./...` has encoding sandbox failures | `internal/api` encoding tests fail with "path is outside any authorized workspace root"; see N-011 |
| Go race tests | blocked | depends on unit tests passing | |
| Go vet | verified | `go vet ./...` passes (exit 0) | |
| Project domain types | partial | `internal/domain/project.go` exists | Not wired to production |
| Project repository | partial | `internal/repository/` exists | Not used by main |
| Atomic file writes | partial | `internal/repository/atomicfile.go` exists | Has unresolved issues (N-015) |
| Composition root | blocked | Still uses `NewMemoryServices` | See N-001 |
| Typed API handlers | partial | Some handlers exist | Still uses RawMessage (N-010) |
| EventHub | partial | `internal/transport/events/eventhub.go` exists | Not injected (N-008) |

## Build & Deploy

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Ant provider | partial | `provider/build/ant.go` exists | Not wired, no Validate (N-005) |
| Javac provider | partial | `provider/build/javac.go` exists | Path issues (N-006) |
| Build use case | partial | `app/build_impl.go` exists | Sync execution, no cancel (N-004) |
| Deploy engine | partial | `app/deploy_impl.go` exists | Wrong target dirs (N-007) |
| Tomcat provider | partial | `provider/runtime/tomcat6_provider.go` | Hardcoded timeout (N-017) |
| Server lifecycle | partial | `app/server_impl.go` exists | No reconciliation (N-016) |
| Restart | not_started | | UI still calls Stop/Start (N-030) |

## Frontend Core

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| TS build | blocked | TS6305/TS2742 in theia-product | `pnpm build` fails on theia-product; see N-043 |
| TS type check | verified | `tsc --noEmit` passes (exit 0) | |
| TS tests | blocked | encoding-extension missing deps | See N-044 |
| Runtime connection | partial | Multiple implementations exist | Duplicate (N-023) |
| Workspace context | partial | `workspace-context-service.ts` exists | Not initialized (N-026) |
| Active project | partial | `active-project-service.ts` exists | Not persisted (N-026) |
| Import wizard | partial | `import-wizard-widget.tsx` exists | Save doesn't save (N-027) |
| Build store | partial | `build-store.ts` exists | No snapshot/event wiring (N-032) |
| Server store | partial | `server-store.ts` exists | No snapshot/event wiring (N-032) |
| Build view | partial | React widget exists | Not replacing old widget (N-029) |
| Server view | partial | React widget exists | Not replacing old widget (N-029) |
| Log viewer | partial | `log-viewer-widget.tsx` exists | Shows fake data (N-033) |
| Status bar | partial | Exists | Error → empty array (N-031) |
| Theme | partial | Theme contribution exists | Triple token source (N-034) |

## Java Language Intelligence

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| JDT LS distribution | partial | Fixed version URL | Need real SHA verification (N-040) |
| Theia backend LS | partial | `java-language-server-contribution.ts` | Not real LS (N-036) |
| Browser LanguageClient | partial | `java-language-client-contribution.ts` | Not real client (N-037) |
| Completion | not_started | | |
| Definition/F12 | not_started | | |
| Diagnostics | not_started | | |

## Desktop

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Desktop main | partial | `apps/desktop/main.ts` rewritten | Config mismatch (N-018) |
| Theia backend start | blocked | Fixed port 3000 | Not starting Theia (N-021) |
| Secret injection | blocked | `executeJavaScript` | Wrong timing (N-020) |
| Process cleanup | partial | Has shutdown logic | Needs testing |
| Packaging | not_started | | |

## Security

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Local secret auth | partial | Middleware exists | Frontend not sending (N-019) |
| Remote fail-closed | verified | Non-loopback fails | |
| Sandbox paths | partial | WorkspaceRoots exists | Test fixtures broken (N-011) |

## CI & Testing

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Go unit CI | blocked | Tests fail | |
| TS build CI | blocked | Build fails | |
| Integration CI | blocked | Tomcat not prepared | Skip or fail (N-042) |
| E2E tests | blocked | Uses gated steps | N-047, N-048 |
| Contract tests | not_started | | |
| Windows tests | not_started | | |

## Encoding

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Encoding validation | verified | API endpoint exists | |
| Atomic recode | partial | temp+fsync+rename | Some issues remaining |
| GBK round-trip | partial | Frontend fixes done | Need E2E test |
| Properties escape | partial | Utility exists | Not integrated |

## Search

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Basic search | verified | | |
| Context lines | not_started | | |
| Legacy streaming | not_started | | |