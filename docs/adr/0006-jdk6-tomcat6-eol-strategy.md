# ADR-0006 — JDK 6 / Tomcat 6 EOL strategy

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

JDK 6 is end-of-life. Oracle JDK 6 is no longer publicly
downloadable for new users. The last public releases of
Tomcat 6 are EOL and not patched for CVEs. The user **must**
be able to:

- Run code that **targets** Java 6 source / class file format
  (so the resulting `.class` runs on a Java 6 JVM).
- Use a real Java 6 compiler (or one that produces Java 6
  bytecode reliably) to compile the project.
- Optionally run a real Java 6 JVM to execute the application
  and to attach a debugger.

We are not in the business of distributing Oracle JDK 6
binaries. We are not in the business of pretending a Java 21
`javac --release 6` is "the same" as Java 6 in every respect
(it is not, for annotation processing, for `sun.misc.Unsafe`
access, and for some compiler-bug edge cases).

## Decision

### JDK toolchain

We separate **three** toolchain slots, never one:

1. **languageServerJavaHome** — the JRE that runs JDT LS.
   - Default: a modern LTS JRE (17 or 21), auto-downloaded.
2. **compilerJavaHome** — the JDK used to compile project
   sources.
   - Default: a Java 6 JDK that the user imports.
   - Fallback (with a clear warning): any JDK with
     `--release 6` support, e.g. JDK 17.
3. **tomcatJavaHome** — the JDK/JRE that runs Tomcat.
   - Default: matches `compilerJavaHome`.
   - Some legacy JVMs cannot be used to run a modern IDE
     feature; that is a project decision, not ours.

The IDE **never** picks the toolchain for the user. It shows
what was chosen, with provenance, and a button to change.

### Toolchain import wizard

- The user picks a folder (or a `.tar.gz` / `.zip`).
- We run `bin/java -version` and `bin/javac -version` to
  detect.
- We compute a SHA-256 of the binary; that becomes the
  toolchain's `id`.
- We record the detection in the audit log.
- We do **not** copy the JDK into the repo. We record a
  reference path in `.legacyflow/state/toolchains.yaml` and
  the user config; the project config holds a *fingerprint*
  (`alg:sha256`).

### Compiler downgrade

When the user's toolchain is not Java 6 but produces Java 6
bytecode, we mark the project with `compiler.compatibility:
emulated-v6`. The status bar shows a yellow icon and the
hover says "bytecode target is v6, but compilation is done
by a newer compiler". A user can disable this in project
config and force a real Java 6 compiler, with a clear error
if not found.

### Tomcat 6 bundling

- We **do not** vendor a Tomcat 6.0.53 binary in git.
- The first time a workspace is opened with a `serverRuntime:
  type: tomcat6` project, the agent downloads
  `apache-tomcat-6.0.53.tar.gz` from the official Apache
  archive mirror, checks its SHA-256 against a known-good
  list in `bundled/tomcat6/SHA256SUMS`, and unpacks it to
  `bundled/tomcat6/apache-tomcat-6.0.53/`.
- The first run shows a clear notice: "Tomcat 6 is end-of-life.
  This is a development convenience. Do not expose this
  server to untrusted networks." The user must accept once
  per workspace.
- The agent never starts Tomcat 6 with its Manager, AJP, or
  JMX ports bound to a non-loopback address. Default bindings
  are 127.0.0.1.

### Tomcat 6 plugin

- All Tomcat-6 specific code lives in
  `bundled/plugins/org.kairo.tomcat6/`.
- The core does not import `catalina.sh` or any `catalina.*`
  Java package.
- The plugin implements `ServerRuntimeProvider`,
  `BuildProvider`, `DeploymentProvider`,
  `DebugAdapterProvider` (using the JDWP port attached to the
  spawned JVM).

## Rejected alternatives

- **Ship an OpenJDK 6 build in `bundled/`.** Rejected because
  Adoptium / Temurin do not publish Java 6 builds, and
  shipping a third-party build we did not build ourselves
  creates a supply-chain risk.
- **Use `javac --release 6` only.** Rejected because
  annotation processors and a handful of class-library
  edge cases differ. We can fall back to it, but it is not
  the default.
- **Tell users to install JDK 6 themselves and point at it.**
  We do, but we also need a way for users to *not* have JDK 6
  installed and still develop. Hence the emulated mode with
  warnings.

## Consequences

- Toolchain management is a first-class feature in the UI.
- The plugin is the unit of work. We can add Tomcat 7/8/9,
  Jetty, WebSphere, Spring Boot embedded, all without
  touching the core.
- A diagnostic package never includes the JDK or Tomcat
  binaries, only the fingerprints.

## Follow-ups

- The fingerprint format is `sha256:<hex>`. The agent refuses
  to use an imported toolchain whose fingerprint is empty.
- The plugin template `@kairo/plugin-scaffold` includes a
  `ServerRuntimeProvider` example.
