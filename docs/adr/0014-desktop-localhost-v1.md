# ADR-0014: Desktop + localhost Browser as v1; Remote Linux Server deferred

**Status**: Accepted
**Date**: 2026-07-19
**Supersedes**: ADR-0004 (Layer 3 — LegacyFlow runtime plugins, deferred)

## Context

The original architecture (ADR-0004, `architecture.md` §2, `product-requirements.md` §3)
described three deployment forms:

- **Form A**: Desktop (Electron + Theia + Go agent, same process)
- **Form B**: Localhost browser (Theia in browser, Go agent on same box)
- **Form C**: Remote Linux server (Theia in browser, Go agent on remote Linux box, multi-user)

The project also planned a three-layer plugin architecture (ADR-0004):

1. Theia extensions (TypeScript)
2. VS Code-compatible extensions
3. LegacyFlow runtime plugins (dynamic load, sandboxed subprocess, JSON-RPC)

After the Wave 0 audit and the deletion of `apps/server/`, the reality is:

- The `apps/server/` directory existed only as a placeholder with an HTML
  stub and a comment "Real impl: serve the built bundle from apps/browser/lib."
- The LegacyFlow runtime plugin system (Layer 3) was designed but never
  implemented — no plugin loader, no JSON-RPC bridge, no sandboxed
  subprocess manager, no manifest parser, no permission enforcer.
- None of the "server runtime provides" or "build providers" were ever
  implemented as external plugins — they are all Go-typed interfaces in
  `internal/provider/`.

## Decision

### v1 scope: Two forms only

1. **Desktop (Electron)**: The primary form. Electron + Theia + Go agent
   in the same OS process. Target: Windows 10 cloud desktop, macOS laptop.
2. **Localhost browser**: Theia served from localhost, Go agent on the
   same machine. Target: quick iteration, demo, macOS development.

**Remote Linux Server is deferred to post-v1.** It requires:
- Multi-user session management
- Remote authentication and authorization
- Audit logging
- Reverse proxy configuration
- Container/sandbox isolation
- These are not v1 scope for a product whose primary persona is a single
  developer on a Windows 10 cloud desktop.

### v1 plugin architecture: Two layers only

1. **Theia extensions** (TypeScript, in `packages/*-extension`): the
   default way to add UI, menus, views, commands, preferences.
2. **Go internal adapters** (in `internal/provider/`): typed Go interfaces
   (`ServerRuntimeProvider`, `BuildProvider`, `EncodingProvider`, etc.)
   implemented directly in the Go agent binary. No dynamic loading. No
   JSON-RPC. No sandboxed subprocess.

**LegacyFlow runtime plugins (Layer 3) are deferred to post-v1.** ADR-0004
remains the design reference for the plugin vision, but v1 will not ship
any Layer 3 capability.

## Consequences

### Positive

- **Focus**: two forms are simpler to develop, test, and ship than three.
- **No placeholder code**: `apps/server/` has been deleted. No more
  "TODO: implement" comments masquerading as product features.
- **Simpler security model**: no remote access means no remote auth, no
  audit, no multi-user isolation in v1.
- **Simpler plugin model**: no dynamic loading, no sandbox, no JSON-RPC
  bridge. All providers are compile-time Go interfaces.
- **Faster time to v1**: fewer features to build and test.

### Negative

- **Remote Linux Server is a real use case** (central build/dev box on
  intranet). Deferring it means some users will not have their preferred
  workflow in v1.
- **Plugin ecosystem is delayed**: third-party server runtime providers
  (Tomcat 7/8/9, Jetty, WebLogic) must be built into the Go binary until
  Layer 3 ships.
- **ADR-0004 must be updated** to note that Layer 3 is deferred.

### Future roadmap

- Remote Linux Server is planned for v1.1 or v2.0, depending on user
  demand.
- LegacyFlow runtime plugins (Layer 3) are planned for v1.1.
- The ADR-0004 design remains the reference for the plugin vision.