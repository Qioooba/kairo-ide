# ADR-0009 — JDT Language Server integration

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

The IDE needs Java language intelligence: completion, navigation,
refactor, formatting, diagnostics, documentation. We are not
writing a Java parser.

Options:

1. Eclipse JDT Language Server (`eclipse-jdt-ls`). Industry
   standard, used by VS Code's Java extension. Requires a JRE
   to run.
2. JavaParser / WALA on the Theia side. Lower fidelity; not
   real-time; not a refactor engine.
3. Build our own using ECJ. Big investment; not credible for v1.

## Decision

We adopt **Eclipse JDT Language Server** as the Java language
provider. We do not bundle it in the repo; the agent downloads
the latest stable release on first use, verifies a SHA-256,
and unpacks it to `bundled/eclipse-jdt-ls/`.

### JDT LS does not speak Java 6

JDT LS is built on Eclipse JDT, which understands Java 6 source
syntax, but with caveats:

- The default JDT LS does not know `--release 6`. It is
  targeted at Java 8+. We pass `--enable-preview` only when
  the project's `sourceLevel` requires it.
- JDT LS requires **a JRE to run**, and that JRE is *separate*
  from the JDK the project compiles against. The
  `languageServerJavaHome` is set to a modern LTS JRE (17 or
  21) auto-downloaded by the agent. The `compilerJavaHome` is
  the user's imported Java 6 JDK (or a fallback, with a
  warning — see ADR-0006).

### How the bridge works

```
+----------+        LSP over stdio          +-------------------+
| Theia    |  <--------------------------->  |   JDT LS (JVM)    |
| frontend |                                 |                   |
+----+-----+                                 +---------+---------+
     |                                                 |
     |  XHR + WebSocket                                |
     v                                                 v
+-------------------+      HTTP/WS /api/v1         +--------------+
| @kairo/java-      |  <------------------------->  | Runtime      |
| extension         |  manage lifecycle, vm args,   | Agent (Go)   |
| (TypeScript)      |  classpath, env               |              |
+-------------------+                               +--------------+
```

- The `@kairo/java-extension` is a Theia extension that
  registers an LSP client.
- The runtime agent is the **process supervisor** for JDT LS:
  it spawns it, gives it the JVM args, and restarts it on
  crash with exponential backoff.
- The Theia extension **never** spawns JDT LS itself. This
  keeps process management in one place and lets us apply
  memory caps, cgroup limits, and the audit log.

### Crash recovery

- JDT LS crash → the agent restarts it (up to 3 times in 60 s
  before giving up).
- A 4th crash in 60 s shows a "Java intelligence unavailable"
  banner and disables the LSP client. The user can still edit
  and compile via the build engine; they just lose completion.

### Memory cap

- Default heap: 256 MB. Configurable in user preferences.
- The agent sets `-Xmx` and passes the same value to JDT LS
  via its `vmargs` config.

## Consequences

- A JDK 17+ JRE is downloaded on first use. ~50 MB. Acceptable.
- JDT LS upgrades independently of the IDE. We pin a known
  good version (`1.36.0` as of this writing) and bump
  quarterly.
- A user who cannot download JDT LS (locked-down intranet)
  can place the tarball in `bundled/eclipse-jdt-ls/` and the
  agent picks it up. SHA-256 is still required.

## Rejected alternatives

- **Use JDT LS via VS Code Java Extension Pack.** Rejected:
  brings in a UI we don't want, an updater we don't control,
  and an extension API that targets Marketplace, not
  workspaces.
- **Use `eclipse.jdt.ls` as a Java library, not a server.**
  Rejected: it is not a library; it's a fat-jar application.

## Follow-ups

- v1.1: support multiple JDT LS instances per workspace for
  monorepo-ish cases.
- v1.1: Java 6 source compatibility: file issues upstream;
  track in `MILESTONES.md`.
