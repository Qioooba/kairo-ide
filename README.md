# Kairo IDE

A lightweight, cross-platform IDE for legacy Java Web projects:
JDK 1.6 / Tomcat 6 / Servlet / JSP / GBK. Runs as a native
desktop app, a localhost browser app, or a remote Linux server.

This is **not** IntelliJ IDEA. It is not VS Code. It is a focused
tool for a focused job: keep a 2008-vintage Servlet/JSP project
alive on a 4 GB Windows 10 cloud desktop, with the same workflow
in Chrome from a Mac laptop when the developer is travelling.

## Three forms, one codebase

| Form | Use case | What runs where |
|------|----------|-----------------|
| **Desktop** | day-to-day work on the same machine | Electron + Theia + Go agent, all in one process |
| **Localhost browser** | same as desktop, but in Chrome | Theia in browser, Go agent on the same box, served by `kairo-server` |
| **Remote Linux server** | central build / dev box on the intranet | Theia in browser, Go agent on a Linux box, accessed by Chrome |

All three share:
- The same compiled web frontend (Monaco + Theia shell + Kairo extensions).
- The same workspace, project, and toolchain model.
- The same `/api/v1` wire protocol.
- The same plugin system (Theia extensions, VS Code extensions, LegacyFlow runtime plugins).

## Quick start (developer)

```bash
# 1. Install deps (one time; takes a few minutes the first time).
./scripts/bootstrap.sh

# 2. Run the agent standalone (no UI, for debugging).
pnpm agent:run

# 3. Run the IDE in browser form.
./scripts/dev.sh
# → http://localhost:3000

# 4. Run the desktop form.
pnpm --filter @kairo/theia-product build
pnpm --filter @kairo/desktop start
```

## Build and release

```bash
# Build all TS packages and the Go binary.
pnpm verify

# Cross-compile the Go binary for all platforms.
./scripts/release.sh

# Build the Electron desktop bundle.
pnpm --filter @kairo/desktop dist:mac
pnpm --filter @kairo/desktop dist:win
pnpm --filter @kairo/desktop dist:linux
```

## Documentation

| Doc | Owns |
|-----|------|
| `docs/product-requirements.md` | What & why |
| `docs/architecture.md` | How it hangs together |
| `docs/ui-spec.md` | Look, layout, accessibility |
| `docs/security.md` | Threat model, sandbox, auth |
| `docs/testing.md` | Test plan, perf methodology |
| `docs/BUILD.md` | Reproducible build |
| `docs/RUN.md` | How to run each form |
| `docs/MILESTONES.md` | What's actually built |
| `docs/BLOCKERS.md` | What we **cannot** do and why |
| `docs/adr/` | Every architectural decision |

## Repository layout

```
apps/{desktop,browser,server}        # entry points
packages/{theia-product,...-ext}     # Theia extensions
runtime-agent/                       # Go service
legacy-sample/                       # test fixture (real Servlet/JSP/Ant)
bundled/                             # third-party downloads
scripts/                             # bootstrap, dev, release
packaging/                           # electron-builder configs
docs/                                # living documentation
tests/e2e/                           # Playwright
.github/workflows/                   # CI
```

## Status

This is the M0 + M1 deliverable. See `docs/MILESTONES.md` for the
honest list of what is built and what is scaffolded.

## License

Apache-2.0. See `LICENSE` (in the next commit; placeholder for now).
