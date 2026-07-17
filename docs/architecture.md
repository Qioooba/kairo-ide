# Kairo IDE — Architecture

> Source of truth for **how** the system hangs together. Code must conform
> to this. Diverging from this file requires a new ADR.

## 1. Architectural goals

1. **One frontend, one backend protocol, three deployment forms.**
   No form-specific business code.
2. **UI never executes shell.** All process / filesystem / OS effects go
   through the Go Runtime Agent.
3. **Plugin-friendly core.** All `ServerRuntimeProvider`,
   `BuildProvider`, `DebugAdapterProvider`, `EncodingProvider`,
   `ProjectImporter` are interfaces with at least one real implementation.
4. **Replaceable transports.** v1 uses HTTP + WebSocket under
   `/api/v1`. The wire format is the contract; HTTP is replaceable.
5. **No JDT-6 vs. Tomcat-6 specifics in core.** They live in plugins
   (ADR-0004).

## 2. Layered architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                            PRESENTATION                              │
│  apps/desktop · apps/browser · apps/server · packages/ui-kit        │
│  Theia frontend (Monaco + Theia shells)                              │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ @kairo/protocol (TypeScript)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                             APPLICATION                              │
│  packages/theia-product  ←  composes all extensions                  │
│  packages/project-extension · runtime-extension · tomcat-extension    │
│  packages/java-extension · jsp-extension · search-extension           │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ @kairo/protocol over HTTP/WS /api/v1
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                              DOMAIN                                  │
│  runtime-agent/internal/domain                                        │
│  Workspace · Project · JavaToolchain · ServerRuntime · BuildProfile  │
│  Deployment · DebugSession · FileSync · Search · Encoding · Task     │
│  Terminal · LogStream · Plugin · UserSession                         │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           INFRASTRUCTURE                             │
│  runtime-agent/internal/{api,platform,security,audit,fs,proc,log}    │
│  HTTP router · process supervisor · sandbox · event bus · encoders   │
└──────────────────────────────────────────────────────────────────────┘
```

Dependency rule: **inner layers never import outer layers.** The
`domain` package has no `api/` imports; the `api` package depends on
`domain`; the UI never calls `infrastructure` directly.

## 3. Monorepo layout

```
kairo-ide/
├── apps/
│   ├── desktop/         # Electron + Theia entry
│   ├── browser/         # Browser entry (Theia Browser app)
│   └── server/          # Linux server entry (long-running daemon)
├── packages/
│   ├── theia-product/   # Composes extensions into a Theia application
│   ├── project-extension/
│   ├── runtime-extension/   # HTTP client to Go agent
│   ├── tomcat-extension/
│   ├── java-extension/      # JDT LS bridge + toolchain bridge
│   ├── jsp-extension/
│   ├── search-extension/    # ripgrep / native search bridge
│   ├── ui-kit/              # design tokens, layout primitives
│   ├── protocol/            # TypeScript types & wire format
│   └── config-schema/       # JSON Schema for .legacyflow/project.yaml
├── runtime-agent/           # Go service, single binary
│   ├── cmd/kairo-runtime/
│   ├── internal/{api,domain,platform,security,audit,fs,proc,log,plugin}
│   ├── test/
│   ├── configs/
│   └── go.mod
├── bundled/
│   ├── tomcat6/             # Apache Tomcat 6.0.53 archive + checksum
│   └── eclipse-jdt-ls/      # JDT Language Server (downloaded, not vendored)
├── legacy-sample/           # Reference legacy project (GBK, Ant, JSP, JSTL)
├── scripts/
├── tests/e2e/               # Playwright
├── packaging/
│   ├── electron/            # electron-builder config
│   └── linux/               # tarball + systemd unit
├── docs/
│   ├── product-requirements.md
│   ├── architecture.md      (this file)
│   ├── ui-spec.md
│   ├── security.md
│   ├── testing.md
│   ├── adr/
│   ├── BUILD.md
│   ├── RUN.md
│   ├── MILESTONES.md
│   └── BLOCKERS.md
└── .github/workflows/
```

## 4. The Process Model

There is exactly **one Runtime Agent process** per workspace session.
The Theia Backend runs in the same OS process for desktop mode, in
the same container for server mode. The agent is a sibling process;
it can be embedded in the desktop process and is mandatory in the
server process.

```
┌─────────────── Desktop process ─────────────────┐
│                                                  │
│  Theia Backend (Node)   ◄── in-proc IPC ──►  Go Runtime Agent │
│       │                                          │     ▲     │
│       ▼                                          │     │     │
│  BrowserView (Electron)                          │  HTTP+WS   │
│       │                                          │  /api/v1   │
│       ▼                                          │     │     │
│  Monaco + Theia frontend  ◄───── HTTP+WS ────────┘     │     │
│                                                         │     │
│  Tomcat (forked)  ◄── env, ports, CATALINA_BASE ────────┘     │
└─────────────────────────────────────────────────────────────┘
```

In server mode the layout is identical except Electron is replaced by
a headless Theia + browser over reverse proxy.

## 5. The Protocol (v1)

Wire format: **JSON over HTTP, NDJSON over WebSocket**. Versioned by
URL prefix `/api/v1`. Every request carries:

```ts
interface RequestEnvelope<T> {
  workspaceId: string;     // from auth, not user-supplied
  projectId?: string;      // optional, for project-scoped calls
  requestId: string;       // UUIDv4, client-generated
  correlationId?: string;  // propagated from upstream
  payload: T;              // request-specific
}
```

Response envelope:

```ts
interface ResponseEnvelope<T> {
  requestId: string;
  correlationId?: string;
  ok: true;
  payload: T;
}
// or, on error:
interface ErrorEnvelope {
  requestId: string;
  correlationId?: string;
  ok: false;
  error: {
    code: KairoErrorCode;
    message: string;
    details?: unknown;
    retryable?: boolean;
  };
}
```

Error codes are a closed enum. They live in
`packages/protocol/src/errors.ts` and are mirrored in
`runtime-agent/internal/api/errors.go`. CI fails if the two diverge.

### 5.1 Resource map (v1 endpoints)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/v1/health` | Liveness, version |
| `GET`  | `/api/v1/workspaces` | List workspaces |
| `POST` | `/api/v1/workspaces` | Open workspace |
| `DELETE` | `/api/v1/workspaces/{id}` | Close workspace |
| `POST` | `/api/v1/workspaces/{id}/scan` | Detect legacy layout |
| `GET`  | `/api/v1/projects` | List projects in workspace |
| `GET`  | `/api/v1/projects/{id}` | Read project config |
| `PUT`  | `/api/v1/projects/{id}` | Update project config |
| `GET`  | `/api/v1/toolchains` | Detect installed JDKs |
| `POST` | `/api/v1/toolchains/import` | Import a JDK and fingerprint it |
| `POST` | `/api/v1/builds` | Start a build |
| `GET`  | `/api/v1/builds/{id}` | Build status |
| `POST` | `/api/v1/deployments` | Publish artifacts |
| `GET`  | `/api/v1/deployments/{id}` | Deployment status |
| `POST` | `/api/v1/servers` | Start a server (Tomcat 6, 7, 9, Jetty, etc.) |
| `DELETE` | `/api/v1/servers/{id}` | Stop a server |
| `GET`  | `/api/v1/servers/{id}` | Server state + PIDs + ports |
| `POST` | `/api/v1/servers/{id}/debug` | Restart with JDWP |
| `GET`  | `/api/v1/servers/{id}/logs?follow=true` | NDJSON over WS |
| `POST` | `/api/v1/search` | Full-text search |
| `POST` | `/api/v1/encoding/detect` | Sniff BOM + heuristics |
| `POST` | `/api/v1/encoding/recode` | Read by encoding A, write by encoding B (lossy warning) |
| `WS`   | `/api/v1/events` | Subscribe to all long-lived streams |
| `POST` | `/api/v1/auth/login` | Session login |
| `POST` | `/api/v1/auth/logout` | |
| `GET`  | `/api/v1/audit` | Audit log (server mode only) |

The protocol package is the single source of truth for these shapes.
The Go agent imports a generated Go version; the Theia extension
imports the TypeScript version. Both are generated from the same
hand-written `protocol.schema.json`.

## 6. Workspace, project, runtime model

```
Workspace (root folder + settings)
  └── Project (one Servlet container deployable)
        ├── ProjectConfig (.legacyflow/project.yaml)
        │     - sourceLayout: { src, webRoot, lib, config, buildXml? }
        │     - encoding: { source, jvm, request, response }
        │     - java:
        │         languageServer: { javaHome, vmOptions }
        │         compiler:      { javaHome, sourceLevel, targetLevel, args }
        │         runtime:        { javaHome, vmOptions, permGen? }
        │     - serverRuntime:
        │         type: tomcat6  # resolves to a ServerRuntimeProvider
        │         config: { ports, contextPath, env, jmx, debug }
        │     - build: { mode: ant|javac|custom, antFile? }
        │     - deploy: { mode: copy|direct, target }
        │     - hotReload: { mode, debounceMs, fallbackToReload }
        └── Catalog (1+)
              ├── Servers (logical)
              │     └── ServerInstance (one running process, with PID)
              ├── Deployments (timeline of past publishes)
              └── DebugSessions
```

The model is **owned by the Runtime Agent** (domain layer). The
TypeScript side keeps a faithful, read-mostly mirror for UI.

## 7. Plugin architecture

See `adr/0004-plugin-architecture.md` for details. The summary:

- **Theia extensions** (TypeScript, in `packages/*-extension`): the
  default way to add UI, menus, views, commands, preferences.
- **VS Code compatible extensions** (TypeScript): language servers,
  themes, snippets.
- **LegacyFlow runtime plugins** (any language, dynamic load): server
  types, build providers, deployment providers, toolchain
  providers, encoding providers.

The first two are loaded by Theia's standard mechanism. The third is
discovered from `.legacyflow/plugins/<id>/plugin.yaml` and a binary
or script referenced by it. The plugin runs as a **sandboxed
subprocess** of the Runtime Agent; it talks to the agent over a
narrowed JSON-RPC channel on a localhost-only port. (See
`adr/0004`.)

## 8. Encoding discipline (this is important)

- **All files on disk are bytes.** Kairo never assumes UTF-8.
- Every `TextDocument` has a `DocumentEncoding` with
  `byteOrderMark | detected | explicit` provenance.
- Saving preserves encoding unless the user picks "Save with encoding".
- Workspace encoding is a *fallback*, not a *mandate*.
- See `adr/0007-encoding-handling.md`.

## 9. Logging

- The Runtime Agent emits **structured JSON** to stderr (12-factor).
- Every log line carries: `ts, level, component, workspaceId,
  projectId, requestId, correlationId, msg, fields...`.
- The Theia Backend mirrors the same shape; frontend logs add `form`
  (desktop|server).
- The UI "Diagnostic Center" produces a downloadable tarball of
  recent log lines + sanitized config. Source files are excluded.

## 10. Performance budget

| Operation | Target | Tooling |
|-----------|--------|---------|
| Cold start to editor visible | ≤ 4 s | Playwright + chrome devtools |
| Open 1 k-file project | ≤ 2 s | E2E |
| First JDT completion | ≤ 1.5 s | E2E |
| Incremental single-file compile (JDK 21 → JDK 6 source) | ≤ 2 s | E2E |
| Full-text search 10 k files | ≤ 3 s | Go bench + E2E |
| Idle RSS, empty workspace | ≤ 350 MB | Windows agent in CI |
| JDT LS heap (configurable) | 256 MB default, 1 GB max | JDT LS config |

We **measure** in CI. Numbers that miss are tracked as
`MILESTONES.md` debt.

## 11. Versioning and stability

- The protocol has a `v1` frozen contract. Breaking changes bump to
  `v2`. The agent supports v1 + v2 simultaneously in transition
  windows.
- The internal `domain` types version their YAML in
  `.legacyflow/project.yaml` with a top-level `schemaVersion: 1`.
  Old configs migrate on open.
- Plugin API version is independent of product version.

## 12. Where to read next

- `ui-spec.md` — how it looks.
- `security.md` — threat model and sandbox.
- `testing.md` — how we know it works.
- `adr/` — every decision that shaped this file.
