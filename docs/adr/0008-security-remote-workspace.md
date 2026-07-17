# ADR-0008 — Remote workspace security model

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

The remote form of Kairo IDE is a long-running service on an
internal Linux box. Multiple authenticated developers open
workspaces. The server executes builds and starts Tomcat
processes. The server has access to source code, credentials,
and (in some cases) production-like databases.

We are not building a multi-tenant SaaS. We are building a
trusted-team tool, but "trusted" is not "no attacker". The
threat model is documented in `security.md` §1. This ADR
specifies the implementation.

## Decision

### Per-user workspaces

- Each user has a home directory under
  `workspaces/<username>/<workspace-id>/`. The path is
  computed by the server, not chosen by the client.
- The user cannot pass an absolute path. All path-accepting
  endpoints take a *logical* path (relative to the
  authenticated workspace root) and the server canonicalizes
  it.
- `security/canonicalize` (see `security.md` §2) is the
  single chokepoint.

### Process isolation

- A user's Tomcat process is spawned with `setpgid`, in a new
  process group, with a `CATALINA_BASE` inside the user's
  workspace, owned by the user (server-side `chown` after
  creation).
- The server does not allow a user to view another user's
  workspace, even by a path-traversal trick.
- CPU and RSS per workspace are bounded by `cgroups v2` on
  Linux. We do not pretend a JVM is small.

### Auth

- Argon2id password storage. See `security.md` §3.
- Sessions are signed (HMAC-SHA256), 8 h sliding, 30 d
  absolute.
- WebSocket auth: `Sec-WebSocket-Protocol` carries the
  session token as a subprotocol. The server validates it
  before upgrading.
- CSRF: a per-session token, sent in a custom header on
  state-changing requests. The login response sets both the
  session cookie and the CSRF token in the response body
  (the cookie is `HttpOnly`; the CSRF is *not*, so JS can
  read it; but it's single-use per session).

### Audit

- Every state-changing request logs to
  `workspaces/<username>/.legacyflow/audit.log.ndjson`.
- The audit log is signed (HMAC chain) so that tampering is
  detectable. A nightly job verifies the chain.
- The log is read-only to the workspace owner; only the
  admin role can read across workspaces.

### Network

- The service listens on the bind address configured at
  deploy time. Default in dev: `127.0.0.1`. Production:
  private RFC1918. The deploy script refuses `0.0.0.0` in
  production unless an explicit `--allow-public-bind` flag
  is passed (and logs a `WARN` when it is).
- TLS is required. The bundled `kairo-server` includes a
  self-signed dev cert and instructions to swap it.

### Plugin permissions in remote mode

- Plugins declared with `network.listen.public` are
  rejected at load in remote mode. The agent's plugin
  loader enforces this.
- Plugins declared with `filesystem.read.workspace` are
  narrowed to **the current user's workspace**; they cannot
  reach other users.

### Operations

- The service has a `/api/v1/health` endpoint that returns
  the version, the bind address, the uptime, and the number
  of active sessions. No PII.
- A separate `kairo-admin` CLI (Go) can rotate the signing
  key, list users, and lock out an account. It is
  intentionally **not** an HTTP endpoint.

## Rejected alternatives

- **Trust-the-OS.** The server runs on a shared box; the OS
  user model is not enough. Multiple developers in one home
  directory is the failure mode we are guarding against.
- **Container per workspace.** Tempting, but each container
  is a process tree, a network namespace, a disk quota —
  and the dev box is 4 GB RAM. We would run out of memory
  with five users. We **may** add per-user containerization
  in v2 if the box grows.
- **JWTs for sessions.** We considered them; we reject
  because revocation is awkward and the same-origin
  assumption of cookies plus a CSRF token is well understood.

## Consequences

- The agent's `security` package is the most-reviewed code
  in the project. It is also the most-tested.
- A misconfiguration that exposes workspaces to the public
  internet is a CVE-class event. The deploy scripts are
  written defensively to make this hard.
- The audit log is **append-only by design**; there is no
  `DELETE` endpoint for it.

## Follow-ups

- v1.1: add TOTP and hardware-key support.
- v1.1: per-user cgroup enforcement.
- v1.2: signed audit log export, with chain verification
  before download.
