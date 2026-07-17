# Kairo IDE — Security

> Threat model, sandbox, auth, and audit. This file is normative;
> security review rejects any change that conflicts with it.

## 1. Threat model

We design for the realistic attacker on the realistic deployment.

| Form | Attacker | Goal | Out of scope |
|------|----------|------|--------------|
| Desktop (Win/macOS) | A second user on the same OS | Read source, modify code, exfiltrate | Root of the box, kernel, network MITM |
| Localhost browser | Same as desktop | Read source | Browser extension that already has host access |
| Remote Linux server | Authenticated user from corporate intranet, **plus** an un-authenticated remote attacker probing the URL | Read another user's source, run code, escape workspace sandbox, DoS | Nation-state APT; physical access to data center |

We do **not** design for: stolen laptop with full-disk encryption
bypassed, kernel-level malware, supply-chain attacks on npm modules
beyond what npm + lockfile + `npm audit` give us.

## 2. Sandbox (the non-negotiable rule)

**The Runtime Agent never lets a request reach an absolute path that
has not been authorized.**

Every path-accepting endpoint goes through `security/canonicalize`:

```
canonicalize(input, workspaceRoots[]) -> (resolvedPath, error)
```

The rules:

1. `resolvedPath` must be the `realpath` (no symlink bypass).
2. `resolvedPath` must equal or be a descendant of one of the
   `workspaceRoots[]` for the authenticated session.
3. On Windows: drive letter case is normalized, `\\?\` long prefixes
   are stripped before comparison.
4. On macOS/Linux: case-sensitive, but matching accounts for
   case-insensitive filesystems (APFS default) by canonicalizing the
   **filesystem** not the request.

If any rule fails, the request is rejected with `error.path_forbidden`
and the attempt is **logged to the audit log**, including the
authenticated user, the raw input, and the resolved path.

The same rule applies to:

- File read/write
- File delete (extra rule: must be inside the workspace and not
  inside `bundled/`, not inside a read-only mount)
- Build command working directory
- Tomcat `CATALINA_BASE` and `CATALINA_HOME`
- Toolchain imports
- Plugin installation

## 3. Authentication (remote mode)

- Single-factor password is the v1 default. TOTP is a v1.1 feature
  (tracked in `MILESTONES.md`).
- Passwords stored with **Argon2id** (memory 64 MB, iterations 3,
  parallelism 2). Never stored in plaintext or with a fast KDF.
- Sessions are server-issued opaque tokens (32 random bytes,
  base64url), stored in an HTTP-only, `Secure`, `SameSite=Strict`
  cookie. Lifetime 8 hours of activity, max 30 days absolute.
- **CSRF**: state-changing requests require a custom header
  `X-Kairo-CSRF` whose value is a per-session token. The token is
  not readable by JS (set by the auth endpoint, refreshed on
  login).
- **WebSocket auth**: same token via `Sec-WebSocket-Protocol`
  subprotocol. We do not put tokens in query strings.
- **Login throttling**: 5 failures in 60 s → 60 s lockout; 10 in
  600 s → 600 s lockout, with a notification to the audit log.
- **Idle timeout**: 30 min of no HTTP request → session invalidated.
  WebSocket pings keep the session alive.

In **desktop mode** the agent binds to `127.0.0.1` only, and a
short-lived pairing token is shown to the user once on first start
to bind the in-process Theia to the agent. There is no remote
attacker surface.

## 4. Network

- Desktop agent: binds to `127.0.0.1` only. No exception.
- Server agent: binds to a configurable interface. Default
  `0.0.0.0` is **forbidden** in `production.yaml`; the deploy
  script requires an explicit `bindAddress` and warns if it is not
  `127.0.0.1` or a private RFC1918 address.
- All HTTP endpoints are TLS-only in server mode. The bundled
  `kairo-server` ships with a self-signed dev cert and instructions
  to replace it. There is no plaintext mode toggle in production.
- Tomcat is **never** started on a public interface. The agent
  starts Tomcat on `127.0.0.1` and (in server mode) reverse-proxies
  `/<contextPath>/` to it. Manager, AJP, JMX, and JDWP ports are
  bound to `127.0.0.1` and never proxied.

## 5. Process isolation

- Every Tomcat instance runs as the **same OS user as the agent**,
  but inside a per-instance `CATALINA_BASE` with a fresh `work/`,
  `temp/`, `conf/`, `logs/`.
- The agent refuses to start a Tomcat whose `CATALINA_BASE` is not
  inside the workspace.
- Toolchain JDK imports: imported JDK is copied to
  `bundled/jdk/<id>/` (read-only after import) and the original is
  never executed.
- Plugin processes: each plugin runs in its own subprocess with a
  reduced environment (no `PATH` from the parent, no shell, no
  network unless declared in the manifest). See ADR-0004.

## 6. Audit log

Every state-changing request is recorded:

```json
{
  "ts": "2026-07-18T01:50:12.123Z",
  "level": "info",
  "component": "audit",
  "workspaceId": "ws_abc",
  "userId": "u_42",
  "requestId": "req_xyz",
  "action": "file.write",
  "target": "src/main/java/Foo.java",
  "result": "ok",
  "fields": { "bytes": 1234 }
}
```

The audit log is append-only, on local disk, in
`.legacyflow/audit.log.ndjson`. It is **never** sent over the wire
unless the user clicks "Export diagnostic package" and explicitly
opts in. It is excluded from the default diagnostic tarball.

## 7. Secrets

- Passwords, JDWP tokens, DB connection strings, license keys:
  stored in the **user config** at
  `${userConfigDir}/kairo/secrets.json` (encrypted at rest with
  OS-provided DPAPI on Windows, Keychain on macOS, secret service
  on Linux). v1 falls back to a passphrase-derived key with a
  clearly-labelled "weak" warning when the OS service is
  unavailable.
- Secrets are **never** logged, not even masked partially.
- The "diagnostic package" explicitly excludes
  `secrets.json`, `.env`, `*.jks`, `*.p12`, `*.key`, `*.pem`.

## 8. Plugin permissions

A plugin manifest declares what it needs:

```yaml
apiVersion: legacyflow/v1
kind: RuntimePlugin
metadata:
  name: tomcat6
  version: 0.1.0
spec:
  permissions:
    - filesystem.read.workspace
    - filesystem.write.workspace
    - process.spawn.java
    - network.listen.loopback
```

The agent refuses to load a plugin whose declared permissions are
broader than what the user has granted. The user is shown the
diff and must accept.

## 9. Updates

- v1 supports **offline** upgrade packages only. The agent checks a
  version endpoint at most once per session if reachable, never
  silently. No auto-update.
- A plugin upgrade cannot replace the core. It is a separate
  artifact, with its own manifest, installed explicitly.

## 10. Reporting a vulnerability

`SECURITY.md` (separate) is the public-facing policy. Internal
triage: file an issue with the `security` label, mark as
confidential. Do not discuss specifics in public channels.

## 11. Acceptance criteria for v1

These are tested in `tests/e2e/security/`:

1. A request with `../` in a path is rejected.
2. A symlink inside the workspace pointing outside is rejected.
3. A request with a path under `bundled/` for write is rejected.
4. A second user cannot read another user's workspace root.
5. Disconnecting and reconnecting does not retain credentials in
   the URL.
6. A login attempt with a known-bad password hits the lockout
   after 5 attempts and is recorded in the audit log.
7. The diagnostic package does **not** contain secrets when
   exported.
