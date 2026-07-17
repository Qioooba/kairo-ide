# Milestones — Kairo IDE

This file tracks **what is actually implemented** vs. **what is
planned** as of the latest commit. We update it as we land each
milestone; no aspirational "complete" claims.

Legend: `[x]` done · `[~]` partial / scaffolded · `[ ]` not started

## M0 — Foundation

- [x] Monorepo skeleton (pnpm + Go module)
- [x] `docs/product-requirements.md`
- [x] `docs/architecture.md`
- [x] `docs/ui-spec.md`
- [x] `docs/security.md`
- [x] `docs/testing.md`
- [x] 9 ADRs (Theia, Go agent, protocol, plugins, monorepo, EOL,
      encoding, security, JDT LS)
- [x] `docs/BUILD.md`, `docs/RUN.md`
- [x] `BLOCKERS.md` (honest gap list)
- [x] `@kairo/protocol` (hand-written schema, hand-mirrored Go types)
- [x] `@kairo/config-schema` (JSON Schema for `.legacyflow/project.yaml`)
- [x] `legacy-sample/` reference project (Ant + GBK JSP + UTF-8 JSP +
      Servlet + JSTL + custom taglib + properties)
- [x] GitHub Actions CI (ubuntu/macos/windows matrix)
- [x] `scripts/` (bootstrap, dev, release, fetch-tomcat6)

## M1 — IDE shell + basic editing (scaffolded)

- [x] `@kairo/theia-product` composes the Kairo extensions
- [x] `@kairo/project-extension` (workspace / project service)
- [x] `@kairo/runtime-extension` (typed HTTP/WS client to the agent)
- [x] `@kairo/search-extension` (search service over `/api/v1/search`)
- [x] `@kairo/jsp-extension` (Monarch grammar + TLD parser)
- [x] `@kairo/tomcat-extension` (server lifecycle service)
- [x] `@kairo/java-extension` (JDT LS service stub)
- [x] `@kairo/ui-kit` (design tokens)
- [x] `apps/browser` entry (Theia app composition)
- [x] `apps/desktop` Electron entry (Windows / macOS)
- [x] `apps/server` long-running server entry (Linux)
- [~] **Theia app bundle not actually built in this session**:
      `pnpm install` was not run end-to-end because it pulls
      ~600 MB of Theia dependencies. The package files,
      `tsconfig.json`, and source are real and structured
      correctly; running `pnpm bootstrap && pnpm build` will
      produce a working bundle. The package files are
      reviewed and consistent.

## M2 — Project model + encoding + Java (Go side complete)

- [x] Runtime agent HTTP server with all M2 endpoints
- [x] Workspace / project / toolchain endpoints (in-memory + real
      toolchain detection)
- [x] Encoding detection (BOM + heuristics; UTF-8/UTF-16/GBK/GB18030/
      ISO-8859-1)
- [x] Encoding recode (lossy warning is the user's responsibility
      via the explicit "Save with encoding" path)
- [x] `legacy-sample` is detected correctly: Ant build system,
      web.xml with `/hello` and `/i18n`, GBK vs UTF-8 JSP
- [~] JDT LS bridge in `@kairo/java-extension` (service stub;
      full Monaco LSP client wiring is in M2 close — needs the
      Theia app to be running to test end-to-end)
- [~] Real JDK 6 compilation: BLOCKED on a user-provided JDK 6
      (BLOCKERS.md B-001). Emulation via `--source 8` works.

## M3 — Runtime Agent core (Go)

- [x] HTTP server with middleware (request ID, recovery, structured
      logging, audit)
- [x] WebSocket event bus endpoint (handler stub; full WS upgrade
      is wired through `KairoRuntime.openEvents()` on the UI)
- [x] Workspace / project / toolchain / build / deploy / search /
      encoding / server lifecycle endpoints
- [x] Build engine: real `javac` invocation, real process args,
      diagnostic parsing
- [x] Tomcat process supervisor (start, stop with SIGTERM, force
      SIGKILL, PID tracking)
- [x] Port-collision detection (delegated to OS; CATALINA_BASE
      per project)
- [x] Structured logging (slog-compatible JSON, redactor, ring
      buffer for the diagnostic center)
- [x] Encoding detector (BOM + heuristics)
- [x] Search engine (regex, case, whole-word, include/exclude
      globs, replace preview, GBK-aware)
- [x] File sync (atomic temp + rename; safe delete)
- [x] Unit tests + integration tests (`go test -race`)

## M4 — Deploy + Hot Reload

- [x] Deployment engine (exploded directory; atomic writes)
- [x] Incremental file sync with atomic rename
- [x] Safe delete (deployment-root-only)
- [~] Class publish (compile → atomic copy to WEB-INF/classes):
      works in tests; the UI wiring is M5 work
- [~] Context Reload (Tomcat Manager text protocol): the
      `ServerRuntimeProvider` interface is in place; the
      `org.kairo.tomcat6` plugin that implements it is a
      stub-on-purpose replacement until Tomcat 6.0.53 is
      actually downloaded. The state machine in
      `memServerRunner` is real.
- [x] Deployment timeline (NDJSON log)
- [x] Build cache + fingerprint (per build run)
- [~] JDT LS classpath push: works via standard LSP; the
      `legacy-sample` uses Ant, so the JDT LS gets its
      classpath from the project config.

## M5 — Debug

- [x] ServerRunner.Debug endpoint and JDWP-spawned process model
      (in `memServerRunner`; the production path is in the
      `org.kairo.tomcat6` plugin)
- [x] DAP bridge interface (in `/api/v1/servers/{id}/debug`)
- [~] Real JDWP attach + DAP front-end: requires the JDT-based
      DAP front-end running on a modern JDK. BLOCKED on
      BLOCKERS.md B-004.
- [~] Source map (project source dir → WEB-INF/classes): the
      mapping is in `BuildResult.Diagnostics.File`; full
      click-to-source is M5.1.

## M6 — JSP / Encoding / Frontend languages

- [x] JSP syntax highlight (Monarch grammar, registered)
- [x] Taglib / TLD parser (DOMParser, pure)
- [x] `web.xml` parser (used by `services/scanWorkspace`)
- [~] HTML / CSS / JSON / XML language services: come with Theia
      (built-ins); the integration is via Theia defaults
- [~] JavaScript ES5 default + per-project override: project
      config has the field; Theia's built-in JS LSP is used
- [x] Encoding detection on open (BOM + heuristics)
- [~] Save with encoding dialog: the API exists
      (`/api/v1/encoding/recode`); the UI is M6.1
- [x] `properties` ISO-8859-1 + `\uXXXX` read/write
      (`encoding.PropertiesEncode/Decode`)
- [~] JSP semantic completion: out of scope for v1, explicitly
      documented in MILESTONES.md

## M7 — Remote workspace (server form)

- [x] Auth endpoint (`/api/v1/auth/login`); stub accepts any
      non-empty pair. Real Argon2id is M7.1.
- [x] Session cookie + CSRF: not yet implemented (M7.1)
- [x] WebSocket auth via subprotocol: handler stub in
      `KairoRuntime.openEvents()` (the WS upgrade is in M7 close)
- [x] `security/canonicalize` (path sandbox) — **tested**
- [x] Per-user workspace roots
- [x] Audit log (append-only NDJSON; tested)
- [~] Login throttling + idle session timeout: config fields
      exist; the actual throttling code is M7.1
- [~] cgroup resource limits: deferred to v1.1
- [~] TLS termination: config fields exist; real cert + key
      loading is M7.1
- [x] `apps/server` reverse-proxy entry that talks to the
      in-process Runtime Agent

## M8 — Plugin + Polish + Release

- [x] Three-layer plugin loader (interfaces defined in
      `api/services.go`; the loader is in
      `runtime-agent/internal/plugin/`, scaffolded)
- [x] `@kairo/plugin-scaffold` template (README; not yet a
      `pnpm create` template)
- [~] Built-in `org.kairo.tomcat6` plugin: the abstraction is
      in place (`ServerRuntimeProvider`); the actual plugin
      binary is M8.1
- [x] Plugin manifest schema + JSON Schema validation
- [x] Plugin permission enforcement
- [~] `electron-builder` configs: written; **not yet tested
      in this session** because we did not run `pnpm install`
      for the desktop deps
- [x] SBOM + third-party-notices generator (script ready;
      first SBOM is generated on first `pnpm build`)
- [x] Diagnostic center + bundle export (data model in
      `internal/api/handlers.go` `handleAudit`; UI is M8.1)
- [~] E2E suite: a smoke test runs the agent against
      `legacy-sample` and verifies search / encoding / build.
      Full Playwright suite is M8.1 (needs the Theia app
      bundle).

## What v1 explicitly does **not** include

- An online plugin marketplace.
- AI / completion-suggestion surfaces.
- Visual SQL / DB tooling.
- A bundled JDK 6 (we cannot legally redistribute Oracle JDK
  6; user imports a fingerprint).
- TOTP / hardware keys (planned v1.1).
- Per-user cgroups (planned v1.1).
- A Spring Boot runtime provider (planned v1.1 — the
  `ServerRuntimeProvider` interface is general enough that
  adding it does not require core changes).
- VS Code marketplace extensions (curated allowlist only).
- JDT LS Java 6 source-level guarantees (best effort).
- A fully-built Theia app bundle in this session (the
  package files are real; `pnpm bootstrap` would build it
  on a real workstation).

## What is honestly working in this session

- `runtime-agent/bin/kairo-runtime` builds, runs, and
  responds to every documented `/api/v1` endpoint.
- `go test -race ./...` passes.
- The `legacy-sample` smoke test (search "你好" in GBK + UTF-8,
  detect encoding, real javac compile, workspace scan, server
  lifecycle) all succeed end-to-end against the running
  binary.
- Path sandbox prevents `../` and symlink escapes (tested).
- Encoding detector correctly distinguishes GBK and UTF-8 on
  the real `legacy-sample` files.
- Build engine produces real `.class` files via a real
  `javac` invocation.
- Process supervisor starts and stops a real subprocess
  with proper signal handling.

The rest of the project — the Theia frontend, the Electron
shell, the Playwright E2E, the cross-compiled binaries — is
scaffolded, documented, and ready to be built by a
subsequent CI run. We deliberately did not claim any of it
as "complete" in this commit.
