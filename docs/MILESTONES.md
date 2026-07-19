# Kairo IDE Milestones — Current State Matrix

> Last verified: 2026-07-19
> Baseline: Wave 1 (Architecture Convergence)
> Status: Each item must be one of: verified, partial, not_started, deferred

## Wave 0 Gate Results

All Wave 0 gates pass:

| Gate | Status | Notes |
|------|--------|-------|
| `go build ./...` | ✅ verified | Exit 0 |
| `go vet ./...` | ✅ verified | Exit 0 |
| `go test -count=1 ./...` | ✅ verified | All 26 packages pass |
| `tsc --noEmit` (packages/*) | ✅ verified | Exit 0 |

## Backend Core

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Go compilation | verified | `go build ./...` passes | |
| Go unit tests | verified | All 26 packages pass | |
| Go vet | verified | `go vet ./...` passes | |
| Project domain types | verified | `internal/domain/project.go` typed | DeploymentOwnerToken HMAC |
| Atomic file writes | verified | `internal/atomicfile/` shared package | Windows MoveFileExW, Unix fsync |
| Security (local) | verified | Loopback-only auth middleware | |
| Encoding validation | verified | API endpoint exists | |
| Basic search | verified | `internal/search/` | |
| Process identity | verified | `internal/proc/` Windows + Unix | PID reuse protection |
| Server lifecycle | verified | `internal/provider/runtime/` | State machine, reconciliation |
| Log cursor | verified | Monotonic cursor + gap detection | |

## Build & Deploy

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Ant provider | partial | `internal/provider/runtime/` | Ant build support |
| Javac provider | partial | `internal/build/` | Javac compilation |
| Build use case | partial | `internal/build/` | |
| Deploy engine | partial | `internal/deploy/` | Deployment target resolver |
| Tomcat provider | verified | `internal/tomcat6/`, `internal/provider/runtime/` | |
| Port allocator | verified | `internal/runtimeplan/ports.go` | Range-based allocation |

## Frontend Core

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| TS type check | verified | `tsc --noEmit` passes | |
| TS build | partial | TS6305/TS2742 in theia-product | N-043 |
| Runtime connection | partial | Multiple implementations | Duplicate (N-023) |
| Workspace context | partial | `workspace-context-service.ts` | Not initialized (N-026) |
| Import wizard | partial | `import-wizard-widget.tsx` | Save doesn't save (N-027) |
| Build store | partial | `build-store.ts` | No snapshot/event wiring (N-032) |
| Server store | partial | `server-store.ts` | No snapshot/event wiring (N-032) |
| Build view | partial | React widget exists | Not replacing old (N-029) |
| Server view | partial | React widget exists | Not replacing old (N-029) |
| Log viewer | partial | `log-viewer-widget.tsx` | Shows fake data (N-033) |
| Status bar | partial | Exists | Error → empty array (N-031) |
| Theme | partial | Theme contribution exists | Triple token source (N-034) |

## Java Language Intelligence

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| JDT LS distribution | partial | Fixed version URL | Need SHA verification (N-040) |
| Theia backend LS | partial | `java-language-server-contribution.ts` | Not real LS (N-036) |
| Browser LanguageClient | partial | `java-language-client-contribution.ts` | Not real client (N-037) |
| Completion | not_started | | |
| Definition/F12 | not_started | | |
| Diagnostics | not_started | | |

## Desktop

| Component | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| Desktop main | partial | `apps/desktop/main.ts` | Config mismatch (N-018) |
| Process cleanup | partial | Has shutdown logic | Needs testing |
| Packaging | not_started | | |

## Deferred (post-v1)

| Component | Reason | Tracking |
|-----------|--------|----------|
| DAP/JDWP Debug | `/api/v1/servers/{id}/debug` endpoint exists, no breakpoint proof | ADR-0014 |
| Remote Linux Server | Multi-user, auth, audit, container isolation | ADR-0014 |
| LegacyFlow runtime plugins | Dynamic loading, JSON-RPC, sandbox | ADR-0014 |
| Class HotSwap | JDWP agent integration | future roadmap |
| Dynamic plugins | Marketplace, online install | future roadmap |
| Remote audit log | `/api/v1/audit` endpoint deferred | ADR-0014 |

## Key Artifacts

- `runtime-agent/`: Go backend (26 test packages, all passing)
- `packages/`: Theia extensions (Java, Tomcat, encoding, build, project, runtime, search, JSP, UI kit)
- `tests/e2e/`: Playwright E2E tests
- `.github/workflows/ci.yml`: CI matrix
- 15 ADRs in `docs/adr/` (001-0015)