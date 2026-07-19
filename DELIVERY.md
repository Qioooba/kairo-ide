# Kairo IDE — Delivery Status

> **Last updated:** 2026-07-19
> **Baseline:** Wave 1 (Architecture Convergence)
> **Ground truth:** `docs/MILESTONES.md`

## Wave 0 Gate Results

| Gate | Status |
|------|--------|
| `go build ./...` | ✅ PASS |
| `go vet ./...` | ✅ PASS |
| `go test -count=1 ./...` | ✅ PASS (26 packages) |
| `tsc --noEmit` (packages/*) | ✅ PASS |

## Verified

| Component | Evidence |
|-----------|----------|
| Go compilation | `go build ./...` exit 0 |
| Go vet | `go vet ./...` exit 0 |
| Go unit tests | 26 packages pass (api, atomicfile, audit, build, catalinabase, config, deploy, domain, encoding, jdtls, jdtproject, log, pathpolicy, proc, provider/runtime, repository, runtimeplan, search, security, services, tomcat6, toolchain, transport/events, test/integration) |
| TS type check | `tsc --noEmit` exit 0 |
| Encoding validation | API endpoint exists |
| Basic search | Verified |
| Remote fail-closed (security) | Non-loopback fails |
| Atomic file writes | Shared `internal/atomicfile/` package |
| Process identity | Windows + Unix full identity verification |
| Server lifecycle | State machine, reconciliation, Shutdown |
| DeploymentOwnerToken | HMAC-SHA256, constant-time comparison |
| Log cursor | Monotonic cursor + gap detection |
| Safe API DTO boundary | `api.ServerResponse` prevents field leakage |

## Partial

| Component | Notes |
|-----------|-------|
| JDT LS distribution | Fixed version URL, need SHA verification (N-040) |
| JDT project model generator | `.classpath` / `.project` / `.settings` writer |
| Ant provider | `internal/provider/runtime/` |
| Javac provider | `internal/build/` |
| Build use case | `internal/build/` |
| Deploy engine | `internal/deploy/` |
| TS build | TS6305/TS2742 in theia-product (N-043) |
| Runtime connection | Multiple implementations, duplicate (N-023) |
| Workspace context | `workspace-context-service.ts`, not initialized (N-026) |
| Import wizard | `import-wizard-widget.tsx`, save doesn't save (N-027) |
| Build store | `build-store.ts`, no snapshot/event wiring (N-032) |
| Server store | `server-store.ts`, no snapshot/event wiring (N-032) |
| Log viewer | `log-viewer-widget.tsx`, shows fake data (N-033) |
| Status bar | Exists, error → empty array (N-031) |
| Theme | Theme contribution exists, triple token source (N-034) |
| Desktop main | `apps/desktop/main.ts`, config mismatch (N-018) |

## Deferred (post-v1)

| Component | Reason |
|-----------|--------|
| DAP/JDWP Debug | `/api/v1/servers/{id}/debug` endpoint exists, no breakpoint proof |
| Remote Linux Server | Multi-user, auth, audit, container isolation (ADR-0014) |
| LegacyFlow runtime plugins | Dynamic loading, JSON-RPC, sandbox (ADR-0014) |
| Class HotSwap | JDWP agent integration |
| Dynamic plugins | Marketplace, online install |
| Remote audit log | `/api/v1/audit` deferred with remote mode |

## What's Real

- `runtime-agent/`: Go backend with typed domain model, JDT LS distribution installer, LSP frame bridge, JDT project model generator, build/deploy/encoding/search APIs, server lifecycle management, process identity verification, DeploymentOwnerToken, atomic file writes
- `packages/`: Theia extensions for Java, Tomcat, encoding, build, project, runtime, search, JSP, UI kit
- `tests/e2e/`: Playwright E2E tests
- `.github/workflows/ci.yml`: CI matrix (Go + TS + E2E)
- 15 ADRs in `docs/adr/` (001-0015)

## Verification

```bash
# Go
cd runtime-agent && go build ./... && go vet ./... && go test -count=1 ./...

# TypeScript
pnpm -r --filter "./packages/*" exec tsc --noEmit

# Verify
pnpm verify
```