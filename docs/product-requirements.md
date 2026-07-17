# Kairo IDE — Product Requirements

> Status: living document. Source of truth for **what** we build and **why**.
> Owned by: PM + Architecture. Any feature scope change updates this file *and* the relevant ADR.

## 1. Mission

Provide a **lightweight, cross-platform IDE** for developers maintaining legacy
Java Web projects in low-spec, restricted environments — typically a Windows 10
cloud desktop on a corporate intranet. The product must let a developer
**import, edit, build, run, debug, hot-swap, search, and redeploy** a
JDK 1.6 / Tomcat 6 / Servlet / JSP / GBK project without leaving the IDE,
across three deployment forms (native desktop, browser, remote Linux server)
from a single codebase.

## 2. Target users and environments

### 2.1 Persona

- **Backend / Ops engineer** maintaining a 10+ year-old internal Java Web
  product.
- The dev box is a **Windows 10 cloud desktop, 2 vCPU, 4 GB RAM, no admin
  rights**, behind an intranet.
- Project layout is non-standard: custom `src/`, `WebRoot/`, `lib/`, sometimes
  Ant `build.xml`, sometimes raw `javac`. Files are mixed **GBK and UTF-8**.
- Tomcat is **6.0.30 or 6.0.53**; the JVM is **JDK 1.6**; the database is
  **Oracle 11g**.
- The same developer also needs to work on a **macOS laptop** when travelling,
  and an **internal Linux server** when the project needs a real Linux build.

### 2.2 Anti-persona (explicitly out of scope for v1)

- New Spring Boot / Cloud / Quarkus projects → IntelliJ IDEA, VS Code + Java
  Pack, or Eclipse. We are **not** a competitor.
- Frontend-heavy React/Vue projects → VS Code / Cursor. We do not optimize
  for that.
- High-end developer hardware. We are optimized for 4 GB RAM, not 64 GB.

## 3. Three deployment forms, one product

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   ┌────────────┐   ┌────────────┐   ┌────────────────────────┐      │
│   │ Form A:    │   │ Form B:    │   │ Form C:                │      │
│   │ Desktop    │   │ Localhost  │   │ Linux server           │      │
│   │ (Win/macOS)│   │ browser    │   │ (browser, multi-user)  │      │
│   └─────┬──────┘   └─────┬──────┘   └─────────┬──────────────┘      │
│         │                │                    │                     │
│         │  Theia Desktop │  Theia Browser    │  Theia Browser      │
│         │  + Go Agent    │  + Go Agent       │  + Go Agent (Linux) │
│         │  (same box)    │  (same box)       │  (remote box)       │
│         ▼                ▼                    ▼                     │
│   ┌──────────────────────────────────────────────────────────┐      │
│   │   Same frontend · same workspace model · same protocol   │      │
│   │   /api/v1 over HTTP + WebSocket, regardless of form      │      │
│   └──────────────────────────────────────────────────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

- All three forms load **the same compiled web frontend** and **the same
  Go Runtime Agent binary** for the host platform.
- No business code forks per form. Platform differences live in
  `runtime-agent/internal/platform/`, nothing else.

## 4. Functional pillars (v1 scope, what we are committing to)

| Pillar | What it means | In scope for v1 |
|--------|---------------|-----------------|
| **Workspace** | Open / persist / recent / multi-root | yes |
| **Editing** | Files, folders, tabs, splits, undo, multi-cursor, encoding-aware | yes |
| **Search** | File / workspace / regex / replace with preview | yes |
| **Java** | JDT LS for code intel; separate toolchain for compiler | yes (see ADR-0006) |
| **JSP / HTML / CSS / JS** | Syntax, encoding, ES5 default | yes |
| **Build** | Real `javac` (any JDK), Ant-aware, incremental | yes |
| **Tomcat 6** | Run, stop, deploy, hot-swap, logs | yes |
| **Debug** | DAP, breakpoints, variables, JDWP transport | yes (compatibility caveats) |
| **Remote** | Auth, sandbox, audit, reconnect | yes |
| **Plugins** | Theia ext + VS Code ext + LegacyFlow runtime plugin | scaffold + 1 sample each |

## 5. Out of scope for v1 (recorded so we don't argue later)

- Marketplace / online plugin install.
- Visual database designer (Oracle 11g connect is via external SQL tool).
- Profiling / flame graphs.
- Cloud sync, account federation, OAuth.
- AI completion (separate roadmap, conflicts with low-spec target).
- Git LFS, Git LFS-based large media workflows.

## 6. Quality bars (v1 acceptance)

- Cold start to workspace open ≤ 8 s on a 2 vCPU / 4 GB box (measured,
  not estimated).
- First completion after Java file save ≤ 1.5 s.
- Incremental compile of a single changed file ≤ 2 s.
- Full-text search across a 10 k-file project ≤ 3 s.
- **All numbers are goals, with the methodology documented in
  `docs/testing.md` §5.**

## 7. Success criteria

The v1 ships when, on a Windows 10 cloud desktop without admin rights:

1. A user can import a GBK, JDK 1.6, Tomcat 6 project from a local folder.
2. The IDE opens the project, shows the file tree, and detects encoding
   correctly (no mojibake).
3. The user can edit a `.java` file with full JDT LS completion and
   navigation, using a real JDK 6 for compilation.
4. The user can run the project on a bundled Tomcat 6.0.53 with one click.
5. The user can save a JSP and see the change in a browser without a
   Context Reload.
6. The user can set a breakpoint, fire an HTTP request, hit the breakpoint,
   inspect a local variable, and step.
7. The same project, when copied to a Linux server, can be opened in
   Chrome from a Windows box and the same workflow runs.

If any one of these fails, v1 has not shipped.

## 8. Non-goals (do not even try)

- We will **not** try to make Theia look like JetBrains. We will use Theia
  design tokens, tuned.
- We will **not** write our own Java parser. JDT LS is mandatory.
- We will **not** ship JDK 6 binaries. Toolchain import + fingerprint only.
- We will **not** auto-upgrade a user's project to Spring Boot. We support
  what is there.

## 9. Document set

| File | Owns |
|------|------|
| `product-requirements.md` (this) | What & why |
| `architecture.md` | How it hangs together |
| `ui-spec.md` | Look, layout, accessibility |
| `security.md` | Threat model, sandbox, auth |
| `testing.md` | Test plan, perf methodology |
| `adr/*.md` | Decisions, with rationale |
| `BLOCKERS.md` | What we could not do and why |
| `MILESTONES.md` | M0–M8 status, real or aspirational |
| `BUILD.md` / `RUN.md` | Reproducible commands |
