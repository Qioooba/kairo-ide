# Kairo IDE

A lightweight, cross-platform IDE for legacy Java Web projects:
JDK 1.6 / Tomcat 6 / Servlet / JSP / GBK. Runs as a native
desktop app or a localhost browser app.

This is **not** IntelliJ IDEA. It is not VS Code. It is a focused
tool for a focused job: keep a 2008-vintage Servlet/JSP project
alive on a 4 GB Windows 10 cloud desktop, with the same workflow
in Chrome from a Mac laptop when the developer is travelling.

## Two forms, one codebase

| Form | Use case | What runs where |
|------|----------|-----------------|
| **Desktop** | day-to-day work on the same machine | Electron + Theia + Go agent, all in one process |
| **Localhost browser** | same as desktop, but in Chrome | Theia in browser, Go agent on the same box |

All forms share:
- The same compiled web frontend (Monaco + Theia shell + Kairo extensions).
- The same workspace, project, and toolchain model.
- The same `/api/v1` wire protocol.

Remote Linux Server is deferred to post-v1 (ADR-0014).

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
apps/{desktop,browser}               # entry points
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

Wave 1 (Architecture Convergence). All Wave 0 gates pass:
- `go build ./...` ✅
- `go vet ./...` ✅
- `go test -count=1 ./...` ✅ (26 packages)
- `tsc --noEmit` ✅

See `docs/MILESTONES.md` for the honest list of what is built and what is deferred.

## License

Apache-2.0. See `LICENSE`.