# ADR-0004 — Plugin architecture (three layers)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

We will inevitably need to:

- Add new server runtimes (Tomcat 7/8/9, Jetty, WebSphere,
  WebLogic, Spring Boot embedded).
- Add new build providers (Maven, Gradle, custom shell scripts).
- Add new deployment strategies (rsync, FTP, Docker copy).
- Add new toolchains (Eclipse Java Compiler, ECJ, OpenJDK 6
  builds from Adoptium archive).
- Add new language providers for JSP taglibs, EL dialects, JSF.
- Add new encodings (EUC-JP for older Japanese projects, etc.).

If any of these changes the core, we lose. The core must remain
small.

## Decision

We adopt a **three-layer plugin model**.

### Layer 1 — Theia Extensions

- TypeScript, loaded by Theia at startup.
- Can contribute: views, menus, commands, preferences, keybindings,
  themes, language servers, debug adapters (wrapped DAP).
- Distribution: an npm package, or a folder in
  `bundled/extensions/<id>/`.
- Examples: `@kairo/project-extension`, `@kairo/runtime-extension`.

### Layer 2 — VS Code-compatible extensions

- Any extension that conforms to the public VS Code API surface
  that Theia implements can be installed.
- The IDE's Extensions view is the entry point.
- We support a curated allowlist in v1 (not a marketplace).

### Layer 3 — LegacyFlow runtime plugins

- A new concept, introduced by Kairo.
- A plugin is a directory with a `plugin.yaml` manifest and one
  of:
  - a binary,
  - a script with a known interpreter (node, python, jvm),
  - a container image (v1.1, see `MILESTONES.md`).
- The agent loads the plugin at startup (or on first use, with
  activation events).
- The plugin talks to the agent over a **narrowed JSON-RPC
  channel on a localhost-only port**. The agent opens the
  channel; the plugin connects to it.
- The agent enforces the permissions declared in the manifest.
  A plugin that tries to do something it did not declare is
  killed.

### Manifest shape (Layer 3, abbreviated)

```yaml
apiVersion: legacyflow/v1
kind: RuntimePlugin
metadata:
  id: org.kairo.tomcat6
  version: 0.1.0
  displayName: Apache Tomcat 6 Runtime
  description: Runs Apache Tomcat 6.0.x Servlet containers.
spec:
  type: native   # or 'script:<interpreter>' | 'container'
  entrypoint: ./bin/kairo-plugin-tomcat6
  activationEvents:
    - onServerRuntimeRequested: { type: tomcat6 }
  permissions:
    - filesystem.read.workspace
    - filesystem.write.workspace
    - process.spawn.java
    - network.listen.loopback
  contributes:
    - serverRuntime:
        id: tomcat6
        versionRange: '>=6.0.0 <7.0.0'
    - buildProvider:
        id: ant-classpath
        for: buildXml
    - deploymentProvider:
        id: tomcat-exploded
```

### Activation events

The agent does not load a plugin until an activation event fires.
Activation is sticky for the session; deactivated only on agent
restart or explicit user action. This keeps startup fast.

### Permissions

A plugin that declares a permission it does not have is rejected
at load. A plugin that does something without declaring it is
**killed** and a security event is written to the audit log.
Permissions are an enum; there are no `*` wildcards.

## Consequences

- The core (`@kairo/theia-product`, `@kairo/protocol`,
  `runtime-agent/internal/{api,domain,security}`) must compile
  and pass tests with **zero** plugins installed. This is a CI
  check.
- Plugin authors need to read this ADR before writing a plugin.
  We commit a `@kairo/plugin-scaffold` template they can copy.
- We will likely add a 4th layer (a sandboxed WebAssembly
  plugin) in v1.1; the manifest format reserves `type: wasm`.

## Rejected alternatives

- **OSGi.** We considered it because Eclipse runs on it. We
  reject because OSGi resolution is hard to debug and the
  ecosystem for new plugins is essentially dead outside of
  Eclipse.
- **Single-layer Theia extensions only.** We reject because
  we need server runtime providers, which are not a concept
  in the Theia API.
- **Lua / mRuby scripting inside the agent.** We reject because
  we want plugins to be testable in isolation with the same
  toolchain the agent itself uses.
