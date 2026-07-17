# ADR-0005 — Monorepo structure

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

We have a frontend (TypeScript, Theia-based), a backend (Go), a
protocol definition, several extensions, a sample legacy project,
packaging scripts, and documentation. We need a layout that:

- Lets the IDE and the agent be developed in parallel.
- Makes it impossible to silently fork form-specific code.
- Keeps `node_modules` small (the persona's box is 4 GB RAM).
- Reproduces a build with a single command.

## Decision

We adopt a **pnpm workspace** monorepo with a hand-rolled
top-level orchestrator. We do **not** adopt Turborepo or Nx in
v1, because their caching adds complexity we do not need at
this size and increases the dependency surface on the dev box.

```
kairo-ide/
├── apps/{desktop,browser,server}/   # thin entry points
├── packages/                        # TypeScript, pnpm
│   ├── theia-product/               # composes extensions
│   ├── project-extension/
│   ├── runtime-extension/
│   ├── tomcat-extension/
│   ├── java-extension/
│   ├── jsp-extension/
│   ├── search-extension/
│   ├── ui-kit/
│   ├── protocol/
│   └── config-schema/
├── runtime-agent/                   # Go, separate go.mod
├── legacy-sample/                   # reference project
├── bundled/{tomcat6,eclipse-jdt-ls}/
├── scripts/
├── tests/e2e/
├── packaging/
└── docs/
```

### Workspace rules

- `apps/*` and `packages/*` share a single `tsconfig.base.json`.
- No cross-package imports of internals (`@kairo/foo/src/internal/...`).
  If you need to share, promote it to a public entry.
- `runtime-agent/` is a separate Go module. It imports the
  generated Go protocol types from `runtime-agent/internal/api/generated/`
  which is **generated** from `packages/protocol/src/protocol.schema.json`.
  Generation is wired in `pnpm protocol:gen` and a `go generate`.
- `legacy-sample/`, `bundled/`, `tests/` are not packages. They
  are directories the build and tests read from.

### Why pnpm

- Hard links save disk; the dev box is small.
- Workspace protocol is clean and standard.
- `pnpm.overrides` gives us a single place to pin transitive
  deps for security audits.

### Why no Turborepo / Nx

- The repo has 12 packages. The marginal value of remote cache
  is zero for a single-machine dev. We will re-evaluate at
  30+ packages.
- They bring a new config language and a new failure mode
  (cache poisoning). We prefer plain `pnpm -r`.

## Consequences

- `pnpm install` is the bootstrap. It must work offline if
  `pnpm-store/` is warm.
- A new package means editing `pnpm-workspace.yaml` and adding
  a `package.json`. No magic.
- Cross-package changes require a `@kairo/<pkg>` dependency in
  the consumer's `package.json`. We do not allow deep imports.

## Follow-ups

- Add a `pnpm doctor` script that asserts: every package has a
  `build` script, every TS package has a `tsconfig.json` extending
  the base, every Go package has tests.
- Add a `scripts/check-deps-size.ts` that flags any
  `node_modules/` over 1 GB.
