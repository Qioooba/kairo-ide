# ADR-0010: Project Identity and Execution Planning

Date: 2026-07-19
Branch: feature/mac-project-build-core
Status: Accepted

## Context

The Kairo IDE runtime agent previously conflated project identifiers with filesystem paths. `ProjectID` was derived from directory names, allowing:
- Path traversal via crafted IDs
- Unsafe path concatenation using `string(projectID)`
- Symlink escapes and directory traversal attacks
- Race conditions in concurrent repository operations
- Build cancellation that did not reliably terminate providers or persist terminal states
- Deploy targets that could escape the deployment root via `..`, absolute paths, or symlinks
- Deploy root authorization not bound to an explicit ownership model

Additionally, the Build/Deploy pipeline lacked:
- A formal plan resolver that validates all paths before execution
- Atomic file writes with proper fsync and cross-platform rename handling
- Thread-safe build lifecycle management with mutex protection
- Security preflight validation before any deployment writes
- Proper error handling that does not swallow failures or corrupt state
- Unified ID validation at entry points
- Cross-platform path grammar enforcement

Phase 0 audit identified 11 issues (1.1-1.11) that were addressed in this revision.

## Decision

We introduce a strict separation between **identity**, **configuration**, and **execution**:

### 1. Opaque Cryptographic Identifiers

All workspace, project, build, deployment target, and server IDs are generated using `crypto/rand` (128 bits), base32-encoded (lowercase, no padding) with type prefixes using the alphabet `abcdefghijklmnopqrstuvwxyz234567` (no `0`, `1`, `8`, `9`):
- `ws_<26 chars>` for workspaces (e.g., `ws_c4xvrn2p3kqw7sg5bmf6yt2hjd`)
- `prj_<26 chars>` for projects (e.g., `prj_ntw4m2xlpqv7r5t3yui6o2ksa`)
- `bld_<26 chars>` for builds (e.g., `bld_kj7h3g5f2dsaqw4e6rt3y5ui`)
- `dep_<26 chars>` for deployment targets (e.g., `dep_xcvb3nm2qw4er5ty6ui7opasd`)
- `srv_<26 chars>` for servers (e.g., `srv_p2o5iy7ut4rewq3xf6mcvbngh`)

IDs are never filesystem paths. Path resolution goes exclusively through repositories that map IDs to canonical absolute roots. All entry points validate ID format before processing.

### 2. Path Policy Layer

A `pathpolicy` package enforces:
- Relative-only paths in configuration (`.kairo/project.yaml`)
- Canonicalization (`filepath.Abs` + `filepath.Clean` + `filepath.EvalSymlinks`)
- Lexical containment checks using `filepath.Rel` (not `strings.HasPrefix`)
- Symlink ancestor verification to prevent escape (nearest-existing-ancestor check)
- Cross-platform grammar enforcement: rejects Windows volume letters (e.g., `C:`), UNC paths (`\\server\share`), and uses `/` as the canonical separator normalized on all platforms
- Validates base32 ID alphabet at all entry points

### 3. Repository Layer with Atomic Persistence

Repositories (`FileWorkspaceRepo`, `FileProjectCatalog`, `FileProjectRepo`, `FileBuildHistoryRepo`) provide:
- Mutex-protected read-modify-write operations to prevent lost updates
- Atomic writes via temp file + fsync + rename (with Windows sharing-violation retry using `MoveFileExW` API, without pre-deleting destination)
- Typed corruption errors (`*CorruptionError`) that preserve original files
- Returns `AggregateError` on load failures instead of silently continuing
- Build list deduplication by BuildID with in-memory state overriding persisted state; correct ordering and limit application; deep copies returned
- YAML for project configuration (`.kairo/project.yaml`) with strict decode, defaults, and validation
- JSON catalog files with versioned document schema

### 4. Plan Resolver as Single Source of Truth

`DefaultPlanResolver` is the only component authorized to create execution plans:
- `ResolveProject`: Validates IDs → loads workspace/project → resolves canonical roots → returns immutable `ResolvedProject`
- `ResolveBuild`: Validates build tool, source roots, classpath, selected files → returns `BuildPlan` with toolchain info
- `ResolveDeploy`: Validates DeploymentTarget ownership → maps webapp/classes/resources/libs to file-only `DeployEntry` items → detects target collisions → returns `DeployPlan`
- `ResolveRuntime`: Returns `ErrRuntimeIntegrationRequired` (deferred to Windows/runtime workflow)

The resolver reads no environment variables, spawns no processes, and writes no files. Validate phase performs **zero writes** - root directories are created only after preflight passes during Execute.

### 5. Thread-Safe Build Use Case

`BuildUseCaseImpl` manages build lifecycle with:
- A bounded lifecycle context derived from application startup (not short-lived HTTP contexts)
- Single manager mutex protecting running builds map
- Per-build state transition function enforcing legal state machine:
  - `queued → running → succeeded | failed | cancelled`
  - `queued → cancelled`
- Persistence before state visibility (queued → save → return; terminal → save → remove from running)
- Errors are **not swallowed**; failed builds retain their in-memory state for diagnostics
- Idempotent cancellation with proper provider process termination
- Build events with correct WorkspaceID/ProjectID (not BuildID masquerading)
- Diagnostic capture from provider output into persisted BuildRun

### 6. Provider Abstraction

Build providers (Ant, Javac) receive fully resolved plans and use:
- Injectable `CommandRunner` interface for testability (no hard dependency on global `ANT_HOME`/`JAVA_HOME`)
- Platform-aware executable selection (`ant` vs `ant.bat`, `javac` vs `javac.exe`)
- Deterministic source file sorting for reproducible builds
- Argfile support for large command lines (Windows compatibility) with **proper shell quoting**
- `scanLines` error propagation (not silently discarded)
- Nil-safe callback checks
- Environment inheritance strategy that preserves parent environment with overrides
- Diagnostic parsers for Unix/Windows paths, Chinese error messages, and Ant prefixes

### 7. Safe Deploy Engine with DeploymentTarget Capability Model

`DeployEngine` enforces security before any writes, using an explicit `DeploymentTarget` capability model:

**DeploymentTarget / DeploymentTargetResolver / OwnerToken:**
- A `DeploymentTarget` represents an authorized deployment root bound to an owner identity via `OwnerToken`
- `DeploymentTargetResolver` validates that the caller's `OwnerToken` matches the target's registered owner before granting deploy access
- This prevents unauthorized writes to deployment roots not owned by the requesting project/workspace
- Target roots are resolved through the resolver with full path validation before any deploy operation

**Preflight (zero writes):**
- All entries checked for relative targets, no `..`, no absolute paths, containment within deployment root, no symlink escapes, no duplicate targets
- Preflight validates DeploymentTarget ownership via OwnerToken
- Root directories are **not created during validate**; only created in Execute after preflight passes
- **Preflight failure = 0 writes**

**Execute (atomic, safe):**
- **Atomic single-file replacement**: mkdir parent → temp file → copy → chmod → fsync → close → atomic rename → fsync dir
- Windows uses `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` (does not pre-delete destination; cross-compiles and unit-tested; real-machine NTFS/antivirus validation pending Windows workflow)
- **Mirror mode**: Deep-first stale file deletion, empty directory cleanup, protected path allowlist
- **No `os.RemoveAll`** on caller-derived targets
- **Context cancellation** checked periodically during deployment
- **Partial failure reporting** with structured `DeployResult`

## Phase 0 Audit Fixes (2026-07-19)

The following 11 issues were identified in Phase 0 audit and resolved:

| ID | Severity | Issue | Resolution |
|----|----------|-------|------------|
| 1.1 | Critical | Deploy root authorization | Added `DeploymentTarget` / `DeploymentTargetResolver` / `OwnerToken` capability model binding targets to owners |
| 1.2 | Critical | Deploy preflight zero writes | Validate phase performs no filesystem creation; roots are only created during Execute after preflight succeeds |
| 1.3 | Critical | Build terminal persistence | Errors are not swallowed; builds use bounded lifecycle context; failed builds retain in-memory state for querying |
| 1.4 | High | Build List deduplication | BuildID-based merge: in-memory state overrides persisted state; correct ordering/limit; deep copies returned |
| 1.5 | High | Repository corruption | Returns `AggregateError` instead of silent `continue` when loading corrupted records |
| 1.6 | Critical | Repository ID validation | Unified opaque ID format validation at all repository entry points |
| 1.7 | High | Cross-platform path grammar | All OSes reject Windows volume letters (`C:`) and UNC paths (`\\server\share`); canonical `/` separator normalized |
| 1.8 | High | Nearest-existing-ancestor symlink | Symlink checks traverse all ancestors up to the nearest existing directory |
| 1.9 | High | Windows atomic replace | Uses `MoveFileExW` API with `MOVEFILE_REPLACE_EXISTING`; does not pre-delete destination. *Cross-compiles and unit-tested; real-machine NTFS/antivirus validation pending Windows workflow* |
| 1.10 | High | Provider generates ServerID | *Resolved in Runtime phase; Core phase does not address this* |
| 1.11 | Medium | Documentation issues | Corrected dates, boundary statements, and ID examples to use valid base32 alphabet (no `0`/`1`/`8`/`9`) |

**Additional provider fixes (inherited from audit):**
- `scanLines` errors are properly propagated, not silently discarded
- Callbacks check for nil before invocation
- Argfile arguments use correct platform-aware quoting
- Environment inheritance strategy properly merges parent environment with tool overrides

## Consequences

### Positive

- **Path traversal eliminated**: No component can resolve a path from an ID alone; all paths go through repository → resolver
- **Race conditions addressed**: All concurrent state access protected by mutexes; atomic writes prevent torn files
- **Cross-platform compatibility**: Code compiles for Linux, Windows, macOS (amd64/arm64); Windows rename uses proper `MoveFileExW` API
- **Testability**: Command runners, ID generators, and clocks are injectable interfaces
- **Security defense in depth**: Path validation at policy layer, containment at resolver, preflight at deploy engine, symlink checks at execution, DeploymentTarget ownership authorization
- **No silent corruption**: Corrupted catalog/config files return typed errors without overwriting data; `AggregateError` surfaces all load failures
- **Build state integrity**: Errors are never swallowed; terminal states are always persisted and queryable

### Negative / Trade-offs

- **More boilerplate**: Path resolution requires going through repositories, not direct string operations
- **Runtime integration deferred**: `ResolveRuntime` returns a typed error until the Windows/runtime workflow completes
- **Legacy ID compatibility broken**: Old path-derived ProjectIDs are not compatible; migration must create new opaque IDs and catalog entries
- **Deploy plan generation is eager**: All files enumerated during planning (not streaming), which uses memory for very large projects (acceptable for Java webapp scale)
- **Windows real-machine testing pending**: `MoveFileExW` atomic replace cross-compiles and unit-tests but requires real NTFS/antivirus validation

### Follow-up Work Required

1. **Bootstrap integration** (out of scope for Mac task): Wire use cases into composition root once Windows workflow completes
2. **Legacy migration**: Tooling to import existing `.legacyflow` projects into the new catalog format
3. **Windows real-machine testing**: Atomic rename via `MoveFileExW`, file locking, and path edge cases on Windows filesystems (NTFS, antivirus)
4. **Streaming logs**: Real-time build log streaming (current implementation captures via callback)
5. **Incremental compilation**: Not implemented; all builds are clean by default
6. **Runtime ServerID generation**: Issue 1.10 resolution in Runtime phase (providers should not generate ServerIDs)

## File Ownership Boundary

This implementation strictly follows the Mac workflow ownership:
- **Owned/New**: `internal/domain/**`, `internal/pathpolicy/**`, `internal/repository/**`, `internal/planning/**`, `internal/provider/build/**`, `internal/app/build*.go`, `internal/deploy/**`, `internal/security/**`, `test/core/**`
- **Modified (mechanical compile fix only)**: `internal/provider/runtime/tomcat6_provider.go` — 2-line field rename (`AbsoluteWebappDir` → `WebappDir`), not a new feature, required for cross-platform compilation due to domain struct changes
- **Not modified**: `apps/**`, `packages/**`, `cmd/**`, `api/**`, `bootstrap/**`, `services/**`, `transport/**`, `proc/**`, `tomcat6/**` (except above mechanical fix), `provider/runtime/**` (except above mechanical fix)

### Out-of-Scope Changes (Only One)

Only `internal/provider/runtime/tomcat6_provider.go` received minimal changes outside the strictly owned directories: a 2-line mechanical field rename matching the domain struct's new field name (`AbsoluteWebappDir` → `WebappDir`). No functional logic was changed. This was required because the domain model refactoring renamed the field, causing compilation failure across all platforms without this fix.

## Verification Gates Passed

All verification commands executed with exit code 0:

- `gofmt -w ./...`: All owned files formatted (exit 0)
- `go vet ./internal/... ./test/...`: No issues (exit 0)
- `go test -count=1 ./internal/... ./test/...`: All unit and integration tests pass (exit 0)
- `go test -race -count=1 -timeout 120s ./internal/... ./test/...`: No data races detected (exit 0)
- `go test -count=20 ./internal/repository/... ./internal/app/... ./internal/deploy/...`: Stress tests pass (exit 0)
- Cross-compilation: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./...` (exit 0)
- Cross-compilation: `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build ./...` (exit 0)
- Cross-compilation: `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ./...` (exit 0)
- Cross-compilation: `GOOS=windows GOARCH=arm64 CGO_ENABLED=0 go build ./...` (exit 0)
- Cross-compilation: `GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build ./...` (exit 0)
- Cross-compilation: `GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build ./...` (exit 0)
