# ADR-0012: Safe API DTO Boundary

**Status**: Superseded by ADR-0015
**Date**: 2026-07-19
**Supersedes**: Section 2 of `docs/progress/MAC_RUNTIME_INTEGRATION_REQUESTS.md`
(which instructed the Windows integration lead to "serialize all fields" of
`domain.ServerRecord`).

## Context

The Mac Wave2 Runtime Server introduces a rich domain model
(`domain.ServerRecord`, `domain.RuntimePlan`, `domain.ProcessIdentity`) that
holds everything the agent needs to manage a Tomcat 6 server process:

| Field                                | Why the agent needs it             | Why it must NOT leave the agent |
|--------------------------------------|------------------------------------|---------------------------------|
| `RuntimePlan.JavaHome`               | Spawn `java` binary                | Local filesystem path — leaks user layout, possible username |
| `RuntimePlan.CatalinaHome`           | Resolve bundled Tomcat            | Local filesystem path |
| `RuntimePlan.CatalinaBase`           | Per-server working dir            | Local filesystem path, can be cross-referenced to attack other servers |
| `RuntimePlan.WebappDir`              | Deploy user app                   | Local filesystem path into user's source tree |
| `RuntimePlan.DeploymentRoot`         | Mirror deploy target              | Local filesystem path |
| `RuntimePlan.JVMOptions`             | Spawn JVM with `-D` flags         | May carry secrets (`-Ddb.password=…`) |
| `RuntimePlan.Env`                    | Pass env to Tomcat                | May carry secrets (`DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`) |
| `RuntimePlan.ShutdownPort`           | Send SHUTDOWN packet on stop      | Internal; exposing it aids port-scanning / shutdown attacks |
| `ProcessIdentity.Executable`         | Verify PID not reused             | Local filesystem path |
| `ProcessIdentity.StartTime`          | Verify PID not reused             | Internal process material |
| `ProcessIdentity.CatalinaBase`       | Verify PID not reused             | Local filesystem path |
| `ProcessIdentity.MarkerToken`        | Verify PID not reused             | **Secret** — anyone holding it can impersonate the agent's process identity checks |

The original `MAC_RUNTIME_INTEGRATION_REQUESTS.md` told the Windows integration
lead to:

> **Response DTO**: `domain.ServerRecord` - serialize all fields.

That instruction would have exposed every field above through the HTTP API.
Even though the agent is loopback-only today, the IDE frontend, browser devtools,
process inspection tools, and any future remote mode can read HTTP responses.
Once a secret leaves the process, it is effectively impossible to recall.

## Decision

The agent enforces a **typed DTO boundary** between the domain layer and the
HTTP API layer:

1. **`api.ServerResponse` is the only shape** that may be returned by
   `/api/v1/servers*` endpoints. It is a small struct with a fixed set of
   safe fields (ID, WorkspaceID, ProjectID, RuntimeID, DesiredState,
   ObservedState, Generation, PID, HTTPPort, DebugPort, ContextPath,
   LastError, StartedAt, StoppedAt, UpdatedAt, URL).

2. **`api.ToServerResponse(domain.ServerRecord) ServerResponse`** is the
   single choke point that maps the domain record to the API response.
   Sensitive fields are not "stripped" — they are simply **not copied**.
   Adding a new sensitive field to `ServerRecord` / `RuntimePlan` /
   `ProcessIdentity` does NOT automatically surface in the API; it must be
   explicitly added to `ToServerResponse`.

3. **Domain objects (`ServerRecord`, `RuntimePlan`, `ProcessIdentity`) MUST
   NOT be serialized directly to JSON for HTTP responses.** They may be
   serialized for **local disk persistence** only (the agent reading its own
   `catalog/runtime-servers/*.json` files). The on-disk format is NOT an API
   contract.

4. **The legacy `realServerRunner`** (which uses `services.serverMeta`)
   applies the same boundary via `serverMetaResponse`, which strips
   `JavaHome`, `WebappDir`, `CatalinaBase`, `Shutdown`, and `AJP` from the
   HTTP response. The persisted `serverMeta` keeps those fields for restart.

5. **`ServerRunner` interface methods still return `json.RawMessage`** for
   backward compatibility, but the bytes inside are always the result of
   `json.Marshal(serverMetaResponse)` or `json.Marshal(api.ServerResponse)`.
   Future cleanup may tighten the interface to return typed DTOs.

## Excluded fields (definitive list)

The following `ServerRecord` / `RuntimePlan` / `ProcessIdentity` fields are
**never** exposed via the API:

- `ServerRecord.ProcessIdentity` (entire subobject)
- `RuntimePlan.JavaHome`
- `RuntimePlan.CatalinaHome`
- `RuntimePlan.CatalinaBase`
- `RuntimePlan.WebappDir`
- `RuntimePlan.DeploymentRoot`
- `RuntimePlan.ShutdownPort`
- `RuntimePlan.JVMOptions`
- `RuntimePlan.Env`

The legacy `serverMeta` also excludes:

- `serverMeta.JavaHome`
- `serverMeta.WebappDir`
- `serverMeta.CatalinaBase`
- `serverMeta.Ports.Shutdown`
- `serverMeta.Ports.AJP`

## Consequences

**Positive**:

- Secrets passed via `JVMOptions` or `Env` (e.g. `-Ddb.password`, `DB_PASSWORD`)
  cannot leak to the IDE frontend or browser devtools.
- Local filesystem paths (`JavaHome`, `CatalinaBase`, `WebappDir`) do not
  leak, so an attacker who compromises the frontend cannot trivially map the
  user's disk layout.
- `MarkerToken` — the secret used to verify process identity — stays inside
  the agent. Without it, an external process cannot impersonate the agent's
  Tomcat during `Reconcile`.
- `ShutdownPort` is not exposed, raising the bar for a remote shutdown
  packet attack.
- Adding new sensitive fields to the domain model is safe by default — they
  will not appear in API responses unless explicitly added to
  `ToServerResponse`.

**Negative**:

- The IDE frontend cannot display the local filesystem paths of the running
  server (e.g. "Catalina base: /Users/…/runtime/srv_abc"). If a future
  debugging UI needs this, it must be added as an explicit opt-in field on
  `ServerResponse` after a security review, and ideally gated behind a
  debug-only API endpoint.
- The frontend cannot directly reconstruct the JVM command line. If needed
  for a "show launch command" feature, the agent should expose a separate
  redacted form (`jvmOptions: ["-Xmx256m", "-D…=***"]`) rather than the raw
  values.

## Enforcement

- `internal/api/dto_test.go::TestToServerResponse_DoesNotLeakSensitiveFields`
  constructs a `ServerRecord` filled with sentinel strings for every
  sensitive field and asserts none appear in the marshaled JSON. Adding a
  new sensitive field to the domain model and forgetting to exclude it
  here will not be caught automatically; reviewers should extend this test
  whenever the domain grows.

- `internal/services/server_meta_response_test.go::TestServerMeta_toResponse_DoesNotLeakSensitiveFields`
  does the same for the legacy runner.

## Migration

The Windows integration lead should:

1. Stop using `domain.ServerRecord` directly as the HTTP response shape.
2. Use `api.ToServerResponse(rec)` (single) or `api.ToServerResponseList(records)` (list).
3. Treat the persisted `catalog/runtime-servers/*.json` files (which DO
   contain the full domain object) as agent-private — never expose them via
   a "raw record" API endpoint.
4. When wiring the new `ServerUseCase` into `/api/v1/servers*`, return
   `api.ServerResponse`, NOT `domain.ServerRecord`.

`MAC_RUNTIME_INTEGRATION_REQUESTS.md` Section 2 has been updated to reflect
this decision.
