# Mac Wave2 Runtime Server - Integration Requests

**Status**: Ready for Windows/Integration Lead wiring
**Phase**: R8 Complete
**Date**: 2026-07-19

---

## 1. Constructor Dependencies

`NewServerUseCase` requires the following parameters in order:

```go
func NewServerUseCase(
    ctx context.Context,
    resolver domain.PlanResolver,
    registry domain.RuntimeProviderRegistry,
    history domain.ServerHistoryRepository,
    eventPub domain.ServerEventPublisher,
    idGen pathpolicy.ServerIDGenerator,
    cfg ServerUseCaseConfig,
) ServerUseCase
```

### Dependencies to wire:

| Parameter | Implementation | Notes |
|-----------|----------------|-------|
| `ctx` | Application root context | Cancel on shutdown triggers bounded cleanup |
| `resolver` | `*runtimeplan.Resolver` | Requires workspace/project/toolchain repos |
| `registry` | Runtime provider registry | Must register Tomcat6 provider (`tomcat6.NewProvider()`) |
| `history` | `*repository.FileServerHistoryRepo` | Use data root from config |
| `eventPub` | `*transport/events.EventHub` | Or WebSocket bridge implementation |
| `idGen` | `pathpolicy.NewCryptoIDGenerator()` | Secure server ID generation |
| `cfg` | `app.ServerUseCaseConfig` | See config fields below |

### ServerUseCaseConfig fields:

```go
type ServerUseCaseConfig struct {
    StartTimeout      time.Duration  // Recommended: 30s
    StopTimeout       time.Duration  // Recommended: 15s
    ShutdownTimeout   time.Duration  // Recommended: 10s
    InspectTimeout    time.Duration  // Recommended: 5s
    LogBufferSize     int            // Recommended: 10000 lines
    StopServersOnExit bool           // Recommended: true for desktop app
}
```

---

## 2. API DTO Mapping

### Request/Response mappings for transport layer:

#### StartServer

**Request DTO** (JSON):
```json
{
  "workspaceId": "ws_xxx",
  "projectId": "prj_xxx",
  "serverId": "srv_xxx"  // optional, for restart scenarios
}
```
Maps to `domain.StartServerCommand`.

**Response DTO**: `domain.ServerRecord` - serialize all fields. Important fields:
- `id`: ServerID (persistent across restarts)
- `observedState`: Current state ("stopped"|"preparing"|"starting"|"running"|"stopping"|"restarting"|"failed"|"crashed")
- `generation`: Increments on each restart
- `pid`: OS process ID (when running)
- `httpPort`/`shutdownPort`: From RuntimePlan
- `startedAt`/`stoppedAt`: Timestamps
- `lastError`: Error message if failed/crashed

#### StopServer

**Request DTO**:
```json
{
  "workspaceId": "ws_xxx",
  "projectId": "prj_xxx",
  "serverId": "srv_xxx",
  "force": false  // optional, force kill immediately
}
```
Maps to `domain.StopServerCommand`.

**Response**: `domain.ServerRecord` (should show state="stopped")

#### RestartServer

**Request DTO**:
```json
{
  "workspaceId": "ws_xxx",
  "projectId": "prj_xxx",
  "serverId": "srv_xxx"
}
```
Maps to `domain.RestartServerCommand`.

**Response**: `domain.ServerRecord` (generation+1, state="running")

#### GetServer

**Request**: Path params `{workspaceId}/{serverId}`
Maps to direct call `uc.Get(ctx, ws, srv)`.

**Response**: `domain.ServerRecord`

#### ListServers

**Request**: Path param `{workspaceId}`
Maps to `uc.List(ctx, ws)`.

**Response**: `[]*domain.ServerRecord`

#### GetServerLogs

**Query params**: `?cursor=0&limit=100`
Maps to `uc.GetLogs(ctx, ws, srv, cursor, limit)`.

**Response**:
```json
{
  "lines": [
    {"stream": 0, "time": "...", "text": "...", "generation": 1}
  ],
  "nextCursor": 100
}
```
stream: 0=stdout, 1=stderr

---

## 3. Event Mapping

`domain.ServerEvent` must be bridged to WebSocket/transport events:

```go
type ServerEvent struct {
    WorkspaceID   WorkspaceID
    ProjectID     ProjectID
    ServerID      ServerID
    Generation    uint64
    Type          ServerEventType  // "state-changed"|"started"|"stopped"|"failed"|"crashed"|"restarting"|"log"|"reconciled"
    OldState      *ServerState     // for state-changed
    NewState      *ServerState     // for state-changed
    Message       string
    Time          time.Time
    Recoverable   bool
    CorrelationID string
}
```

### Event types to subscribe:

| EventType | WebSocket topic | UI action |
|-----------|-----------------|-----------|
| `state-changed` | `/runtime/server/state` | Update server status indicator |
| `started` | `/runtime/server/started` | Show server ready notification |
| `stopped` | `/runtime/server/stopped` | Update UI to stopped state |
| `failed` | `/runtime/server/failed` | Show error dialog with lastError |
| `crashed` | `/runtime/server/crashed` | Show crash notification, offer restart |
| `restarting` | `/runtime/server/restarting` | Show restart spinner |
| `log` | `/runtime/server/log` | Append to log viewer |
| `reconciled` | `/runtime/server/reconciled` | Silent state sync |

**Implementation**: Create an adapter that implements `domain.ServerEventPublisher` and forwards to the existing event hub.

---

## 4. Bootstrap Lifecycle

### Application startup:

```go
// After constructing use case:
if err := uc.Reconcile(ctx); err != nil {
    log.Errorf("runtime reconciliation failed: %v", err)
    // Don't fail startup - servers in crashed/failed state are acceptable
}
```

Reconcile will:
- Scan history for non-terminal servers
- Inspect OS processes using ProcessIdentity
- Mark crashed servers if processes no longer exist
- Mark failed servers if ProcessIdentity mismatch detected (orphaned PID)

### Application shutdown:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
defer cancel()

unclean, err := uc.Shutdown(shutdownCtx)
if err != nil {
    log.Errorf("runtime shutdown error: %v", err)
}
if len(unclean) > 0 {
    log.Warnf("%d servers did not stop cleanly", len(unclean))
    // These will be reconciled on next startup
}
```

If `StopServersOnExit=false`, Shutdown returns running servers as "unclean" without stopping them.

---

## 5. Config Fields

Add these to the application config file (dev.yaml/production.yaml):

```yaml
runtime:
  dataRoot: "${userConfigDir}/kairo/runtime"  # Server history and catalina bases
  startTimeout: 30s
  stopTimeout: 15s
  shutdownTimeout: 10s
  inspectTimeout: 5s
  logBufferSize: 10000
  stopServersOnExit: true
  ports:
    httpRange: [18080, 18180]      # HTTP port allocation range
    shutdownRange: [18005, 18105]  # Shutdown port range
    debugRange: [18000, 18080]     # JDWP debug port range
  runtimes:
    tomcat6:
      enabled: true
      catalinaHome: "${bundledResources}/tomcat6"
```

### Important paths:
- Data root is used for:
  - `catalog/runtime-servers/{wsId}/{srvId}.json` - history records
  - `runtime/servers/{srvId}/` - catalina base directories
- Port ranges must not conflict with other services

---

## 6. Windows Real-Machine Tests Needed

The following tests require Windows environment with real Java/Tomcat:

| Test | Scenario | Verification |
|------|----------|-------------|
| Tomcat6 real start | With JDK6 and valid Tomcat6 installation | Server reaches "running" state, HTTP port responds |
| Port collision detection | Two servers same port range | Typed `ErrPortInUse` returned, no process leak |
| Catalina base owner mismatch | File owned by different user | Prepare fails before writing |
| Symlink path attacks | Symlink in catalina base path | Preflight validation rejects |
| Graceful stop on Windows | Tomcat shutdown hook works vs requires force | Proper signal handling on Windows |
| Process cleanup after crash | Taskkill verification | No orphan java.exe processes |
| Service restart | Machine reboot + Reconcile | Crashed servers detected correctly |
| Deep directory paths | Windows MAX_PATH limitations | Long path support enabled |
| Anti-virus interference | AV locking log files | Graceful degradation, readable errors |

### Manual QA checklist:
1. Start server → verify browser access to http://localhost:{port}
2. Deploy sample app → verify it loads
3. Restart server → generation increments, same server ID
4. Stop server → port released, no java process in Task Manager
5. Kill java.exe externally → Reconcile marks as crashed
6. Start after crash → succeeds with new PID
7. Multiple servers (different projects) → port conflict or different ports

---

## 7. Breaking Changes (vs old server_impl)

| Change | Impact | Migration |
|--------|--------|-----------|
| ServerID generation moved to use case | Old IDs were sequential numbers | New IDs are crypto base32; old records incompatible |
| Generation counter per-server | No generation tracking before | Add generation field to UI display |
| ProcessIdentity verification | No PID verification before | Old code could kill wrong process; now safe |
| DesiredState vs ObservedState split | Single state field before | UI should show both desired (intent) and observed (actual) |
| Reconcile() required on startup | No reconciliation before | Must call during bootstrap |
| Shutdown() bounded cleanup | No cleanup on exit before | Must call during shutdown |
| EventPublisher as dependency | Events were optional | Must wire event hub; events fail gracefully |
| PortLease with release callback | Ports always leaked | Registry must provide port allocator with Release() |
| DeploymentTarget ownership token | No ownership check | New deploy flow must use DeploymentTargetResolver |
| ServerUseCaseConfig struct | Hardcoded timeouts before | All timeouts/buffers configurable |

---

## 8. Old server_impl/API Migration Steps

### Step 1: Remove old server code
Delete files (check Windows team isn't using them):
- `internal/api/server.go` - old HTTP handlers
- Any old ServerUseCase in internal/app if it exists

### Step 2: Register Tomcat6 provider
In bootstrap/container.go:
```go
tomcatProv := tomcat6.NewProvider(/* deps */)
runtimeReg.Add(tomcatProv)
```

### Step 3: Wire FileServerHistoryRepo
```go
serverHistory := repository.NewFileServerHistoryRepo(cfg.Runtime.DataRoot)
```

### Step 4: Create event publisher adapter
Implement `domain.ServerEventPublisher` that publishes to WebSocket hub.

### Step 5: Update API handlers
Map new DTOs to use case methods. Use `internal/api/protocol/types.go` for JSON tags.

### Step 6: Add startup reconciliation
Call `uc.Reconcile(ctx)` in bootstrap after container initialization.

### Step 7: Add shutdown hook
Call `uc.Shutdown(ctx)` when app is quitting.

### Step 8: Update UI state model
Support new states: preparing, restarting, crashed, failed.
Show generation number for debugging.
Show lastError message on failure.

### Step 9: Test port allocation
Implement `runtimeplan.PortAllocator` or use the existing port manager.

### Step 10: E2E verification
Run all manual tests from Section 6 before merging.

---

## File Inventory (Runtime Domain)

Core files created/modified in R1-R7:

| File | Purpose |
|------|---------|
| `internal/app/server.go` | ServerUseCase interface + config |
| `internal/app/server_impl.go` | Full lifecycle implementation |
| `internal/domain/project.go` | All domain types (commands, records, events) |
| `internal/domain/errors.go` | Typed errors including ErrPortInUse, ErrProcessIdentityMismatch |
| `internal/runtimeplan/resolver.go` | Plan resolution with validation |
| `internal/runtimeplan/registry.go` | Runtime provider registry |
| `internal/runtimeplan/ports.go` | Port allocation |
| `internal/runtimeplan/fakes.go` | Test fakes |
| `internal/proc/proc.go` | Process management interface |
| `internal/proc/fake.go` | Fake process for testing |
| `internal/proc/proc_unix.go` | Unix process implementation |
| `internal/proc/proc_windows.go` | Windows process stub (needs completion) |
| `internal/catalinabase/` | Catalina base preparation |
| `internal/repository/server_history_repo.go` | File-based history persistence |
| `internal/provider/runtime/tomcat6_provider.go` | Tomcat6 runtime provider |
| `test/runtime/integration_test.go` | R8 integration tests (21 test cases) |

---

## Open Questions for Integration Lead

1. **Windows process implementation**: `proc_windows.go` has stub implementations; need to use Windows Job Objects and taskkill
2. **Port allocation**: Existing port manager in transport/ should be adapted to `PortAllocator` interface
3. **WebSocket event format**: Confirm event schema matches IDE expectations
4. **Data root path**: Confirm where Kairo stores user data on Windows vs Mac
5. **Old history migration**: Is migration from old server state needed, or clean break acceptable?
6. **Debug port**: JDWP debug port is in RuntimePlan but no StartServer flag to enable it yet

---

**Contact**: M5 (QA/Integration Agent) for clarifications on test scenarios or fault injection behavior.
