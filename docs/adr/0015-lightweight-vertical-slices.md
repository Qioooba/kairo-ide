# ADR-0015: Lightweight Vertical Slices replacing God Service and unwired DDD scaffold

**Status**: Accepted
**Date**: 2026-07-19
**Supersedes**: ADR-0011 (runtime-server-lifecycle), ADR-0012 (safe-api-dto-boundary)

## Context

The codebase has two architectural problems that prevent shipping v1:

### Problem 1: God Service (`internal/services/services.go`)

The `services.go` file is approximately 1700 lines of `json.RawMessage`
dispatch. Every domain concern — workspace, project, build, deploy, server,
search, encoding, toolchain — funnels through a single `Services` struct
with methods like:

```go
func (s *Services) HandleWorkspaceOpen(ctx context.Context, raw json.RawMessage) (json.RawMessage, error)
func (s *Services) HandleProjectGet(ctx context.Context, raw json.RawMessage) (json.RawMessage, error)
```

This means:
- No type safety between the HTTP layer and the domain layer.
- Every `json.RawMessage` is a potential serialization bug.
- Business logic is interleaved with JSON marshaling/unmarshaling.
- Impossible to unit-test a single domain concern in isolation.
- Adding a new feature means touching the 1700-line monolith.

### Problem 2: Unwired DDD scaffold

A separate ~9000-line DDD framework was built with repositories, entities,
value objects, and domain events — but it was never wired to the actual
HTTP layer. It was deleted after the Wave 0 audit. The remaining code has:

- `internal/domain/project.go` — typed domain types exist
- `internal/repository/` — repository interfaces exist
- `internal/app/server_impl.go` — use case implementations exist
- But none of these are connected through a clean composition root.
  `main.go` still uses `NewMemoryServices`.

### Problem 3: ADR-0011 and ADR-0012 are too granular

ADR-0011 (runtime-server-lifecycle) defines a rich domain model for server
management with 9-domain-type state machines, `ProcessIdentity`,
`DeploymentOwnerToken`, and reconciliation. ADR-0012 (safe-api-dto-boundary)
defines the DTO boundary for the server API. Both are correct, but they are
**implementation details of the server vertical slice**, not standalone
architectural decisions. They should be folded into the vertical slice
architecture.

## Decision

We adopt **lightweight vertical slices** per business domain. Each slice is
a self-contained Go package with three layers:

```
internal/{domain}/
├── {domain}.go       # Service (business logic)
├── plan.go           # Plan (typed configuration)
└── repository.go     # Repository (persistence interface)
```

### Vertical slices

| Slice       | Package        | Service            | Plan              | Repository              |
|-------------|----------------|--------------------|-------------------|-------------------------|
| Workspace   | `workspace`    | `WorkspaceService`  | `WorkspacePlan`   | `WorkspaceRepository`   |
| Project     | `project`      | `ProjectService`    | `ProjectPlan`     | `ProjectRepository`     |
| Build       | `buildsvc`     | `BuildService`      | `BuildPlan`       | `BuildRepository`       |
| Deploy      | `deploysvc`    | `DeployService`     | `DeployPlan`      | `DeployRepository`      |
| Server      | `serversvc`    | `ServerService`     | `ServerPlan`      | `ServerRepository`      |
| Search      | `search`       | `SearchService`     | `SearchPlan`      | —                       |
| Encoding    | `encoding`     | `EncodingService`   | `EncodingPlan`    | —                       |
| Toolchain   | `toolchain`    | `ToolchainService`  | `ToolchainPlan`   | `ToolchainRepository`   |

### Design rules

1. **Typed Service**: each slice has a `Service` struct with typed method
   signatures. No `json.RawMessage`, no `interface{}`. E.g.:
   ```go
   type ServerService struct { ... }
   func (s *ServerService) Start(ctx context.Context, cmd StartServerCommand) (*ServerRecord, error)
   func (s *ServerService) Stop(ctx context.Context, cmd StopServerCommand) (*ServerRecord, error)
   ```

2. **Typed Plan**: each slice has a `Plan` struct that holds all
   configuration needed to execute the service. Plans are constructed by
   the composition root from repositories and providers.

3. **Typed Repository**: each slice has a `Repository` interface that
   defines persistence operations. The implementation is injected at
   composition root.

4. **HTTP layer only does DTO mapping**: the HTTP handler calls the typed
   service method, receives a typed domain object, and maps it to a typed
   API response DTO. No business logic in the HTTP layer.

5. **JSON only at HTTP/WS adapter and persistence codec boundaries**:
   JSON is a wire format and a persistence format, not a business logic
   format. The domain layer never sees `json.RawMessage`.

6. **No cross-slice imports**: each slice imports only `internal/domain`
   (shared types) and its own repository interface. Slices do not import
   each other. Cross-slice coordination happens at the composition root.

### Composition root

The composition root (`internal/bootstrap/` or `cmd/kairo-runtime/main.go`)
is responsible for:

1. Creating all repository implementations (file-based, memory-based).
2. Creating all provider implementations (Tomcat, Ant, Javac, etc.).
3. Creating all services with their dependencies injected.
4. Creating HTTP handlers that map DTOs to/from service calls.
5. Wiring the event bus, log sinks, and security middleware.

### What happens to ADR-0011 and ADR-0012

ADR-0011 (server lifecycle) and ADR-0012 (safe API DTO boundary) are
**superseded by ADR-0015**. Their designs are correct and will be
implemented as part of the `serversvc` vertical slice, but they are now
implementation details rather than standalone architectural decisions.

The key concepts from ADR-0011 (state machine, ProcessIdentity, Generation,
Reconciliation) and ADR-0012 (safe DTO boundary, excluded fields) are
preserved in the `serversvc` slice design.

## Consequences

### Positive

- **Testable**: each slice can be tested in isolation with mock repositories.
- **Discoverable**: a developer looking for server logic knows to open
  `internal/serversvc/server.go`.
- **No God Service**: the 1700-line `services.go` is replaced by 8 small
  focused services.
- **No `json.RawMessage` in domain**: the domain layer is pure Go types.
- **Clear boundaries**: each slice has a single responsibility.
- **Composable**: the composition root is the only place that knows about
  all slices and their dependencies.

### Negative

- **More files**: 8 slices × 3 files = 24 files vs. 1 `services.go`. But
  each file is small and focused.
- **Migration**: existing code in `internal/app/` and `internal/services/`
  must be migrated to the new slices. This is expected to be done
  incrementally.
- **No cross-slice transactions**: if two slices need to coordinate (e.g.,
  build then deploy), the composition root orchestrates them. This is
  intentional — distributed transactions are not needed for this use case.

### Migration plan

1. Extract `serversvc` from `internal/app/server_impl.go` and `internal/services/services.go`.
2. Extract `buildsvc` from `internal/app/build_impl.go`.
3. Extract `deploysvc` from `internal/app/deploy_impl.go`.
4. Extract remaining slices (`workspace`, `project`, `search`, `encoding`, `toolchain`).
5. Delete `internal/services/services.go`.
6. Rewrite HTTP handlers in `internal/api/` to call typed services.
7. Implement composition root in `internal/bootstrap/`.