# ADR-0002 — Go Runtime Agent split

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

The IDE needs to execute things the browser/UI should not execute
directly: `javac`, `catalina.sh`, file system operations, port
binding, process supervision, log streaming, and on the server
form, multi-tenant isolation.

Options:

1. Do it all in the Theia backend (Node.js).
2. Fork-exec from the frontend via Tauri's Rust sidecar.
3. Write a Go service that the Theia backend calls over HTTP.
4. Write a Rust service.
5. Embed everything in Electron's main process with a Node API.

## Decision

We adopt **option 3: a Go service, the Kairo Runtime Agent**.

The agent is a single static binary. It is started by the Theia
backend in-process on desktop, and as a sidecar in the server
deployment. The agent owns the workspace, the build engine, the
process supervisor (Tomcat), the toolchain registry, the search
engine, the encoding detectors, and the audit log.

The UI never executes shell. The UI talks to the agent over
`/api/v1` (HTTP + WebSocket). The protocol package owns the
types; the agent and the extension both import the same shapes.

## Why Go

- We need a single static binary per platform. Go gives us that
  with `CGO_ENABLED=0`.
- We need precise control over processes (`syscall.Exec`,
  `Setpgid`, `Kill` groups) — Go gives us that with stdlib
  `os/exec` and a small shim.
- We need a fast, embedded HTTP/WS server — `net/http` + a small
  router is enough; we deliberately do not pull in a framework
  for v1.
- The team has Go experience. We get reviewer productivity for
  free.

## Why not Node

- We want a hard memory ceiling on the agent. Node's RSS is
  larger and less predictable for the same workload.
- We want race-detector-validated concurrency. Go's race detector
  catches data races Node simply cannot.
- We do not want to re-implement process group semantics in
  Node, where child-process `kill` is famously platform-fragile.

## Why not Rust

- Slower iteration speed for v1. We accept the trade.

## Why not embed in Electron

- Couples us to Electron's process model. The server form has
  no Electron; we would need to re-implement.

## Consequences

- We maintain **two** build pipelines: pnpm for the IDE,
  Go modules for the agent. The wire contract is the
  `@kairo/protocol` package.
- The agent is the security boundary (see ADR-0008). The Theia
  backend is *not*.
- Performance budgets in the agent are measured with `go test
  -bench` and the perf harness in `docs/testing.md`.

## Follow-ups

- The agent exposes `/api/v1` and `/api/v1/events` (WS).
- Later we may replace the HTTP transport with gRPC; the
  protocol shapes are transport-agnostic.
