# ADR-0011: Runtime Server Lifecycle and Identity

Date: 2026-07-19
Branch: feature/mac-runtime-server-core
Status: Accepted

## Context

The Kairo IDE runtime agent previously had several critical issues in server lifecycle management:

1. **Identity problems (Issue 1.10)**:
   - `Tomcat6Provider.Prepare` incorrectly converted `ProjectID` directly to `ServerID`
   - `server_impl.go` had a local hex ID generator that did not follow the `srv_<26 chars>` base32 format
   - No single source of truth for ID generation - multiple generators existed
   - ProjectID and ServerID were conflated, risking collisions and path traversal
   - Restart created new ServerIDs, causing UI discontinuity for the same logical server

2. **Incomplete state machine**:
   - Only 6 states defined (`stopped`, `starting`, `running`, `stopping`, `crashed`, `error`)
   - Missing `preparing`, `restarting`, `failed` states
   - No centralized transition validation - illegal transitions possible
   - No distinction between desired state (for reconciliation) and observed state

3. **Runtime plan issues**:
   - RuntimePlan lacked WorkspaceID, ProjectID, RuntimeID, DeploymentRoot, DebugPort, Env, Generation
   - No deep copy for slices
   - Env could potentially contain full `os.Environ()` snapshot
   - No persistence annotations for fields

4. **Process identity problems**:
   - PID alone was used to identify processes, risking PID reuse attacks
   - No verification of process identity before signaling
   - No marker token to confirm process is Kairo-managed
   - Reconciliation could not distinguish between Kairo-owned and unrelated processes

5. **Event/log port issues**:
   - Direct dependency on concrete `transport/events.EventHub` in app layer
   - No app-level port interface for server events
   - No structured ServerEvent type with generation, correlation ID, recoverable flag
   - Log lines lacked generation tracking

6. **Server record gaps**:
   - Old `ServerInstance` conflated persisted state with runtime observation
   - No Generation field for process instance tracking
   - No DesiredState for reconciliation
   - Process identity stored as string, not structured
   - No StartedAt/StoppedAt timestamps for lifecycle tracking

Phase R1 addresses these issues by defining a clean domain contract before implementing use cases and providers.

## Decision

We introduce a formal runtime server domain model with strict separation of concerns:

### 1. Identity Model

**ServerID** (`srv_<26 chars base32>`):
- Logical server identity that persists across restarts
- Same UI row represents the same logical server even after process restart
- Generated exclusively by injected `CryptoIDGenerator` - no local generators
- Never converted from/to ProjectID - completely independent namespace
- Validated at all repository and use case entry points using `pathpolicy.ValidateServerID()`

**RuntimeID**:
- Identifies a runtime configuration/installation type
- Two forms supported:
  1. **Builtin IDs**: Well-known identifiers like `"tomcat6"` (no prefix)
  2. **Generated IDs**: `rtm_<26 chars base32>` for user-configured runtimes
- Validated via `pathpolicy.ValidateRuntimeID()` or `pathpolicy.IsBuiltinRuntimeID()`
- Distinct from ServerID - one runtime type can power many server instances

**Generation** (`uint64`):
- Increments each time a new process starts for the same logical ServerID
- Initial value: 1
- Restart increments Generation (N → N+1)
- PID + Generation + ProcessIdentity uniquely identify a specific OS process
- Prevents PID reuse confusion: same PID but different generation = different process

**Single ID Generator Injection Point**:
- Exactly one `pathpolicy.CryptoIDGenerator` is injected at composition root
- No other component may generate IDs directly
- Providers, use cases, repositories receive ID generator as dependency
- Issue 1.10 resolved: no more hex generator in server_impl.go, no ProjectID→ServerID conversion

### 2. Server State Machine

States:
```
stopped → preparing → starting → running
running → stopping → stopped
running → restarting → starting → running
preparing/starting/running/stopping/restarting → failed
running → crashed
crashed/failed → starting (explicit restart/recovery)
crashed/failed → stopped (explicit reset)
```

State definitions:
- `stopped`: Server is not running and not transitioning (initial/terminal state)
- `preparing`: Validating plan, assembling CatalinaBase, allocating resources
- `starting`: Process launched, waiting for readiness probe
- `running`: Server is running and ready to serve requests
- `stopping`: Graceful shutdown in progress
- `restarting`: Stopping old process, preparing to start new generation
- `failed`: Terminal failure state with error information
- `crashed`: Observed unexpected process exit (not from explicit Stop)

Centralized transition validation:
- `CanTransitionServerState(from, to)` returns boolean
- `TransitionServerState(from, to)` returns `ErrInvalidStateTransition` if illegal
- Same-state transitions allowed (idempotent)
- All state changes MUST go through these functions - no direct assignment
- Full test coverage of all legal and illegal transitions

Helper methods:
- `IsTerminal()`: true for stopped/failed/crashed
- `IsTransitioning()`: true for preparing/starting/stopping/restarting

**DesiredServerState**:
- Separate from observed state, used for reconciliation
- Values: `running` or `stopped`
- Reconciliation loop drives observed state toward desired state
- Agent restart recovers desired state and reconciles

### 3. RuntimePlan

```go
type RuntimePlan struct {
    WorkspaceID    WorkspaceID // persisted, not sensitive
    ProjectID      ProjectID   // persisted, not sensitive
    ServerID       ServerID    // persisted, not sensitive
    RuntimeID      string      // persisted, not sensitive
    JavaHome       string      // persisted, sensitive (local path)
    CatalinaHome   string      // persisted, sensitive (local path)
    CatalinaBase   string      // persisted, Kairo-owned path
    WebappDir      string      // persisted, sensitive (user project path)
    DeploymentRoot string      // persisted, Kairo-owned path
    ContextPath    string      // persisted, not sensitive
    HTTPPort       int         // persisted, not sensitive
    ShutdownPort   int         // persisted, not sensitive
    DebugPort      int         // persisted, not sensitive
    JVMOptions     []string    // persisted, may contain sensitive args
    Env            []string    // persisted, SENSITIVE - allowlisted overrides only
    Generation     uint64      // persisted, not sensitive
}
```

Field rules:
- `Env`: NEVER contains full `os.Environ()` snapshot. Only allowlisted overrides.
- All slice fields have `DeepCopy()` to prevent mutation of shared state.
- Sensitive fields are serialized to disk but never exposed via public API.
- Kairo-owned paths (`CatalinaBase`, `DeploymentRoot`) are created/validated by trusted resolvers.

Deep copy:
- `RuntimePlan.DeepCopy()` performs deep copy of JVMOptions and Env slices.
- `ServerRecord.DeepCopy()` deep copies RuntimePlan, ProcessIdentity, and time pointers.

### 4. Commands (Typed Intentions)

All server operations receive only identity-based commands, never paths/PIDs/ports:

```go
type StartServerCommand struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    ServerID    *ServerID // nil = create new logical server; non-nil = recover/restart existing
}

type StopServerCommand struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    ServerID    ServerID
    Force       bool // true = force kill after graceful timeout
}

type RestartServerCommand struct {
    WorkspaceID WorkspaceID
    ProjectID   ProjectID
    ServerID    ServerID
}

type GetServerQuery struct {
    WorkspaceID WorkspaceID
    ServerID    ServerID
}

type ListServersQuery struct {
    WorkspaceID WorkspaceID
}
```

Rules:
- No paths, PIDs, ports, JavaHome, or environment variables in commands.
- All execution parameters come from resolved RuntimePlan, not from command arguments.
- ServerID nil in Start means "create new"; non-nil means "operate on existing logical server".
- Get/List only accept WorkspaceID/ServerID for ownership filtering.

### 5. Process Identity

PID reuse is a real problem on all OSes (PIDs wrap around, typically at 32768 or 65535). We cannot rely solely on PID to confirm process ownership.

```go
type ProcessIdentity struct {
    PID          int       // OS process ID
    Executable   string    // canonical path to executable
    StartTime    time.Time // process start time from OS
    CatalinaBase string    // Kairo-owned base directory
    MarkerToken  string    // unique random token passed via env/arg
}
```

Identity verification before signaling:
1. Check if PID exists
2. Verify executable path matches
3. Verify process start time matches
4. Verify CatalinaBase matches
5. Verify marker token (if obtainable from process environment/cmdline)
- If ANY check fails: mark as `ErrProcessIdentityMismatch` or `ErrProcessOrphaned`, DO NOT signal.
- Never kill a process without positive identity match.

`Equal()` method compares all fields (not just PID) for identity matching.

### 6. ServerRecord (Persisted State)

```go
type ServerRecord struct {
    ID              ServerID
    WorkspaceID     WorkspaceID
    ProjectID       ProjectID
    DesiredState    DesiredServerState
    ObservedState   ServerState
    Generation      uint64
    PID             int
    ProcessIdentity *ProcessIdentity
    RuntimePlan     RuntimePlan
    LastError       string
    StartedAt       *time.Time
    StoppedAt       *time.Time
    UpdatedAt       time.Time
}
```

Separation of concerns:
- `DesiredState`: What the user wants (drives reconciliation)
- `ObservedState`: What we last observed from the provider/process
- `ProcessIdentity`: Verified process identity for the current generation
- `RuntimePlan`: Last resolved plan for this server (used for restart/recovery)
- `PID`: Redundant convenience field - always verify against ProcessIdentity

ServerHistoryRepository uses this instead of the old ServerInstance.

### 7. Server Events and Log Port

App-level port (no dependency on transport layer):
```go
type ServerEventPublisher interface {
    PublishServerEvent(ctx context.Context, event ServerEvent) error
}
```

ServerUseCase depends ONLY on this interface, NOT on concrete `transport/events.EventHub`.
Transport adapter implements this interface and bridges to EventHub/WebSocket.

```go
type ServerEvent struct {
    WorkspaceID   WorkspaceID
    ProjectID     ProjectID
    ServerID      ServerID
    Generation    uint64
    Type          ServerEventType
    OldState      *ServerState
    NewState      *ServerState
    Message       string
    Time          time.Time
    Recoverable   bool
    CorrelationID string
}
```

Event types: state-changed, started, stopped, failed, crashed, restarting, log, reconciled.

CorrelationID links events from the same Start/Stop/Restart operation for tracing.
Recoverable flag indicates if the error state can be retried without manual intervention.

**LogLine**:
```go
type LogLine struct {
    Stream     LogStream // stdout or stderr
    Time       time.Time
    Text       string
    Generation uint64 // which process generation produced this line
}
```

Logs are tagged with Generation to distinguish pre-restart vs post-restart logs.
Logs are NOT stored in ServerRecord (bounded ring buffer in memory/optional disk rotation later).

### 8. RuntimeProvider Interface Updated

```go
type RuntimeProvider interface {
    ID() string
    Prepare(ctx context.Context, plan RuntimePlan) error
    Start(ctx context.Context, plan RuntimePlan, logSink func(LogLine)) (*ProcessIdentity, error)
    Stop(ctx context.Context, identity ProcessIdentity, force bool) error
    Inspect(ctx context.Context, identity ProcessIdentity) (ServerState, error)
}
```

Changes:
- `Prepare` takes full RuntimePlan, not just Project; returns error (no ServerID generation)
- `Start` takes RuntimePlan and log sink; returns ProcessIdentity (not ServerInstance)
- `Stop` takes ProcessIdentity (not ServerID); performs identity verification before signaling
- `Inspect` takes ProcessIdentity; returns only state
- NO ServerID generation in provider - all identities come from use case/resolver

### 9. Reconciliation Flow (Agent Startup)

**Product rule**: Agent exit MUST stop all Tomcat processes it manages.
Cross-lifecycle process recovery is intentionally NOT supported.

Rationale:
- A Tomcat process started by Agent instance A "belongs" to A's lifecycle.
- If A exits cleanly, A's `Shutdown()` force-stops every non-terminal server
  before the Agent process terminates.
- If A crashes, any Tomcat it started is now orphaned. Re-attaching to such
  a process from Agent instance B is unsafe: PID reuse, marker-token loss,
  and ownership-file divergence all make positive identity verification
  unreliable across Agent lifecycles.
- The product therefore forbids cross-lifecycle re-attachment in favor of
  safer, simpler semantics: B treats every persisted non-terminal record as
  stale, marks it Crashed (or Stopped if desired state was stopped), and
  releases any leftover lease bookkeeping. The user (or a future
  process-reaper) is responsible for cleaning up orphaned processes from a
  crashed Agent.

Reconcile flow at Agent startup:

1. List all persisted ServerRecords from history via `ListNonTerminal`.
2. For each non-terminal record:
   - Clear `PID` and `ProcessIdentity` (we no longer trust them).
   - If `DesiredState == running`: mark `ObservedState = crashed`,
     record `LastError = "agent restarted; previously-managed process
     was stopped on prior agent shutdown"`, publish `crashed` event.
   - Otherwise (`DesiredState == stopped`): mark `ObservedState = stopped`,
     publish `reconciled` event.
   - Release any stale `PortLease` bookkeeping (defensive; on a clean
     Shutdown the lease map is already empty).
3. Do NOT automatically restart servers. Restart requires an explicit
   `RestartServerCommand` from the user.
4. Do NOT scan disk for projects - only operate on persisted records.
5. Do NOT call `Provider.Inspect()` on the stale `ProcessIdentity` - the
   process is assumed gone. Calling Inspect against a possibly-reused PID
   is exactly the risk this rule avoids.

`ServerUseCaseConfig.StopServersOnExit` is forced to `true` by
`NewServerUseCase`. The field is retained in the config struct for
documentation and forward-compatibility, but the UseCase ignores any
`false` value the caller might set.

## Consequences

### Positive

- **Identity safety**: ProjectID and ServerID completely separated; no more collisions; single ID generator
- **Restart continuity**: Same logical ServerID across restarts; UI shows same server row; generation tracks process instance
- **PID reuse protection**: ProcessIdentity with multiple verification fields prevents killing wrong processes
- **State machine integrity**: All transitions validated centrally; illegal transitions impossible; full test coverage
- **Reconciliation support**: DesiredState vs ObservedState enables recovery after agent restart
- **Clean dependencies**: app layer depends on domain port interface, not concrete transport EventHub
- **No path leakage**: Commands contain only IDs; all execution paths come from trusted resolvers
- **Sensitive field awareness**: Explicit annotation of sensitive/persisted/serialized fields in RuntimePlan
- **Generation-tagged logs**: Easy to distinguish logs from different process instances
- **Domain layer pure**: domain package does not import repository, provider, api, or transport packages

### Negative / Trade-offs

- **More boilerplate**: All state changes go through TransitionServerState(); commands require more types
- **Migration required**: Old ServerInstance persistence format incompatible with ServerRecord; migration logic needed
- **Provider interface breaking change**: Tomcat6Provider must be updated to match new RuntimeProvider interface
- **server_impl.go rewrite needed**: Current implementation has wrong ID generator, wrong provider interface, wrong state model - this is expected and M4 will fully rewrite it
- **tomcat6_provider.go ProjectID→ServerID conversion must be removed**: Prepare() must not generate IDs
- **Deep copy everywhere**: Slices must be copied to prevent shared state mutations (minor performance cost, negligible at server scale)
- **Process identity verification overhead**: Stop/Inspect require multiple checks instead of just kill(PID) (negligible system call cost)

### Follow-up Work Required

1. **M2 - RuntimePlanResolver**: Implement trusted resolver that creates valid RuntimePlan from repositories
2. **M3 - Process & Tomcat6Provider**: Update Tomcat6Provider to new interface; implement ProcessIdentity verification; marker token injection
3. **M4 - ServerUseCase**: Rewrite server_impl.go to use new domain types, state machine, generation, persistence
4. **M5 - QA/Security**: PID reuse fault injection, race tests, integration tests
5. **Repository migration**: Update FileServerHistoryRepo to use ServerRecord instead of ServerInstance
6. **Transport adapter**: Implement ServerEventPublisher that bridges to existing EventHub (Windows/app layer task)
7. **Bootstrap integration**: Wire ID generator, publisher, providers into composition root (integration lead task)

## File Ownership Boundary (M1 Phase R1)

This implementation (M1 - Runtime Domain Contract) modifies ONLY:
- `internal/domain/project.go` - Complete domain model
- `internal/domain/errors.go` - New error types
- `internal/pathpolicy/id.go` - RuntimeID support
- `docs/adr/0011-runtime-server-lifecycle.md` - This document
- `internal/domain/*_test.go` - Tests (created separately)

NOT modified in M1 (other agents own these):
- `internal/api/**` - Windows/API team
- `internal/bootstrap/**` - Integration lead
- `internal/transport/**` - Windows/transport team
- `internal/jdtls/**` - Explicitly forbidden
- `apps/**`, `packages/**` - Explicitly forbidden
- `internal/app/server_impl.go` - Note: Domain contract defines the interface; M4 will rewrite this file. M1 only notes that the hex generator must be removed (issue 1.10).
- `internal/provider/runtime/**` - M3 will update to match new RuntimeProvider interface

## Verification Gates (M1 Domain)

- Domain package does NOT import repository, provider, api, or transport packages
- `go build ./...` succeeds
- `go vet ./internal/domain` clean
- State transition tests: all legal transitions allowed, all illegal transitions return error
- DeepCopy tests: mutations to copy do not affect original
- ID format tests: srv_ and rtm_ prefixes validated correctly
- `go test -race ./internal/domain ./internal/app` passes (app may fail to compile until M4; domain tests must pass)
- gofmt: all files properly formatted
