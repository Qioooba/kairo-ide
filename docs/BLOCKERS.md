# BLOCKERS

A blocker is something we **cannot complete in this codebase**
without an external dependency we do not have. We list them
here so the work that *can* ship is not held hostage by the
work that cannot.

## B-001 — Oracle JDK 6 binary

- **What is blocked**: Real `javac` on Java 6 source with
  no `--release` emulation; integration test that compiles
  against a true Java 6 `rt.jar`; debug attach to a Java 6
  HotSpot.
- **Why**: Oracle JDK 6 is end-of-life. It is not available
  on the public Oracle download site for new users. We do
  not redistribute it.
- **What we do instead**:
  - The toolchain import wizard accepts a path to a JDK 6
    the user already has. We fingerprint it (SHA-256) and
    record provenance.
  - When no JDK 6 is available, the build engine falls back
    to a modern `javac --release 6` (Java 17 or 21), with a
    visible "emulated" badge in the status bar and a
    `compiler.compatibility: emulated-v6` field in the
    project config.
  - The integration test that requires a real Java 6 is
    gated by `KAIRO_JDK6_HOME`; without it, it is skipped,
    not failed.
- **Acceptable to ship without it?**: Yes, with the
  emulated-v6 fallback clearly labeled.

## B-002 — Apache Tomcat 6 binary in the repo

- **What is blocked**: An immediately-runnable bundled
  Tomcat 6.0.53 from a clean checkout, on a network that
  cannot reach the Apache archive.
- **Why**: Apache Tomcat 6.0.53 is ~10 MB; we download it
  on first use, after SHA-256 verification, into
  `bundled/tomcat6/`. The download is gated by user
  acceptance of the "Tomcat 6 is EOL" notice.
- **What we do instead**:
  - The download step is deterministic and reproducible.
    `scripts/fetch-tomcat6.sh` takes a mirror URL.
  - The agent refuses to start Tomcat 6 with Manager / AJP /
    JMX bound to a non-loopback address.
  - The first-run notice is mandatory.
- **Acceptable to ship without it?**: Yes, with the
  download step documented and the safety notice enforced.

## B-003 — Eclipse JDT Language Server for Java 6

- **What is blocked**: 100%-accurate JDT LS diagnostics and
  completion for Java 6 source (the way the upstream JDT LS
  handles `--release 6` and pre-Java-7 language features
  has known gaps).
- **Why**: JDT LS is a third-party binary; we do not fork
  it. Upstream Java 6 source-level compatibility is best
  effort.
- **What we do instead**:
  - Use the modern JRE (17 or 21) to run JDT LS.
  - Set `sourceLevel: 1.6` in the JDT LS init options.
  - Report JDT LS warnings explicitly; never silently
    downgrade to a higher source level.
  - The compile step still uses the user's Java 6 JDK (or
    the emulated fallback), independent of JDT LS.
- **Acceptable to ship without it?**: Yes, with the JDT LS
  version pinned, the gaps documented, and the
  `compiler.compatibility: emulated-v6` fallback clear.

## B-004 — JDWP debug adapter for Java 6 target JVMs

- **What is blocked**: Reliable debug attach to a Java 6
  HotSpot target via a modern DAP-compatible adapter.
- **Why**: Modern Java debug adapters (e.g.
  `vscode-java-debug`) target Java 8+ JDWP. Java 6 JDWP
  protocol differences (specifically, some reference type
  info commands) are not always honored.
- **What we do instead**:
  - The `DebugAdapterProvider` interface is pluggable.
  - v1 ships the `org.kairo.tomcat6` plugin's adapter, which
    uses the Eclipse JDT-based DAP front-end and a JDI
    backend running on a modern JDK that attaches to the
    Java 6 JDWP endpoint. This is the path Microsoft has
    used for years; it works for most code paths.
  - For Java 6 quirks we cannot resolve, we surface them
    as "adapter limitation" with a link to the workaround.
- **Acceptable to ship without it?**: Yes, with the
  workaround documented in the diagnostic center.

## B-005 — Real Windows 10 cloud desktop in CI

- **What is blocked**: True end-to-end performance numbers
  on a 2 vCPU / 4 GB Windows 10 box.
- **Why**: GitHub-hosted runners are Linux/macOS/Windows
  Server 2022, not Windows 10 cloud desktops. The closest
  is `windows-2022` with a 2-core runner; not the same.
- **What we do instead**:
  - We measure on `windows-2022` 2-core for relative
    comparison.
  - We provide a `scripts/perf-collect.ps1` that a user can
    run on their own box and post the results to
    `docs/perf-reports/`.
  - The numbers in `architecture.md` §10 are **goals**, not
    measured values, until a `perf-reports/` entry exists.
- **Acceptable to ship without it?**: Yes, with the
  measurement harness checked in.

## B-006 — Closed plugin marketplace

- **What is blocked**: Online install of third-party
  plugins.
- **Why**: We are not building one in v1.
- **What we do instead**:
  - Plugins are installed from a local directory or an
    `.lfrpkg` (LegacyFlow runtime plugin package) file
    dropped by the user.
  - The Extensions view lists what's installed; the user
    enables, disables, or removes.
- **Acceptable to ship without it?**: Yes. Tracked as
  v1.1 in `MILESTONES.md`.

## B-007 — Corporate identity / SSO

- **What is blocked**: SSO via corporate IdP (OIDC, SAML).
- **Why**: We don't have a target IdP. v1 ships local
  accounts only.
- **What we do instead**:
  - v1 supports local accounts with Argon2id passwords.
  - The auth interface is pluggable so a v1.1 OIDC bridge
    can be added without touching the core.
- **Acceptable to ship without it?**: Yes.

## How a blocker is closed

A blocker is closed when the dependency becomes available
*or* the workaround above is implemented and shipped. We
do not close a blocker by quietly ignoring it; we close it
by writing the workaround in code, pointing at it from
this file, and moving the relevant `MILESTONES.md` line
from `[/]` to `[x]`.
