# ADR-0001 — Theia as the IDE platform

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

We need a desktop + browser IDE for legacy Java Web projects on
low-spec Windows 10 cloud desktops. We can:

1. Build our own editor in a webview.
2. Fork VS Code (Microsoft, Apache-2.0, but very large).
3. Fork Zed (GPL/AGPL/commercial — license incompatible).
4. Adopt Eclipse Theia (EPL-2.0, smaller surface, designed for this).
5. Adopt Eclipse Theia Blueprint or a similar packaged Theia app.

The functional requirements include: Monaco editor, LSP/DAP,
workspace, terminal, file tree, multi-root, command palette,
extensions, theming, multi-platform packaging, and the ability to
ship a browser form factor.

## Decision

We adopt **Eclipse Theia as the IDE platform**, layered with our
own product package `@kairo/theia-product`. We do not fork Theia.
We consume it as a set of npm packages and compose our product
on top.

We reject option 1 because writing an editor from scratch on the
budget we have is not credible.

We reject option 2 because the VS Code repo is large, has a
heavy telemetry surface, and the Marketplace licensing does not
let us re-skin or restrict it cleanly.

We reject option 3 because the Zed license is incompatible with
our distribution model (closed-source IDE sold to enterprises).

We accept option 4 because:

- Theia ships Monaco, LSP/DAP, the workbench shell, terminal, and
  the extension system out of the box.
- Theia is EPL-2.0, compatible with our Apache-2.0 product.
- Theia already supports Electron (desktop) and browser (server)
  forms from a single codebase — exactly our use case.
- Theia is built on inversify, the same DI used by VS Code, so
  the extension API is close enough to VS Code that we can claim
  "compatible with VS Code extensions" for the common subset.

## Consequences

### Positive

- We do not own the editor, LSP wiring, terminal, or file tree.
  We own the product, the workspace model, the runtime bridge,
  and the tooling.
- We can ship a desktop and a browser form factor from the same
  frontend without code duplication.
- Theia extensions and (a subset of) VS Code extensions are
  available immediately.

### Negative

- Theia is a moving target. We pin to a known minor version
  (`1.51.x` as of this writing) and update quarterly.
- Theia is large: ~1.2 GB of node_modules with the full IDE.
  We mitigate by trimming extensions, splitting chunks, and
  lazy-loading the JDT LS.
- Theia does not own the JDT Language Server. We have to integrate
  it. See ADR-0002.
- Theia does not own Tomcat. We have to integrate it. See ADR-0005.

## Follow-ups

- Track Theia releases; plan upgrades.
- Maintain a minimal set of Theia extensions (no marketing, no
  telemetry, no AI features) so that node_modules stays
  predictable.
