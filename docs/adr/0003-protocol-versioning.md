# ADR-0003 — Protocol versioning and shape ownership

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

The Kairo UI and the Kairo Runtime Agent must agree on the wire
format. They are written in different languages (TypeScript and
Go) and evolve at different speeds. We need a single source of
truth for the wire format, and a versioning discipline that lets
us change the protocol without breaking clients.

## Decision

The **single source of truth** for the wire format is a
hand-written JSON Schema (`packages/protocol/src/protocol.schema.json`)
that defines:

- Every request envelope.
- Every response envelope.
- Every error code and shape.
- Every resource model (Workspace, Project, ServerRuntime, …).

From that schema we generate:

- TypeScript types in `packages/protocol/src/generated/`.
- Go types in `runtime-agent/internal/api/generated/`.

Generation runs as a build step (`pnpm protocol:gen` / `go
generate ./...`). CI fails if generated files are out of date
relative to the schema.

The protocol has a **major version in the URL** (`/api/v1`).
Breaking changes bump to `/api/v2`. The agent implements v1
and v2 simultaneously during migration windows; the UI picks
one and is built against it.

Every request and response carries an envelope:

```ts
interface RequestEnvelope<T> {
  workspaceId: string;     // assigned by auth, not trusted from client
  projectId?: string;
  requestId: string;       // UUIDv4, client-generated
  correlationId?: string;  // upstream propagation
  payload: T;
}

interface ResponseEnvelope<T> {
  requestId: string;
  correlationId?: string;
  ok: true;
  payload: T;
}

interface ErrorEnvelope {
  requestId: string;
  correlationId?: string;
  ok: false;
  error: { code: KairoErrorCode; message: string; details?: unknown; retryable?: boolean; };
}
```

## Why not gRPC from day one

- We want to be able to ship a simple curl-able API for
  integration tests and operators.
- gRPC adds a build step and a runtime dependency on both sides
  for what is, in v1, a fairly small surface.
- The shapes are designed so that we **can** add a gRPC
  transport later without changing the domain types. Only the
  envelope goes away.

## Why not Protobuf from day one

- Protobuf is excellent for high-throughput streaming. Our
  throughput target is human-speed (a developer pressing keys),
  not machine-speed. JSON is fine.
- JSON is more debuggable by the humans who operate the IDE
  in production.

## Consequences

- The protocol package is the **most-frequently-changed**
  package in the project. We commit generated files to the
  repo so that the build does not need a network for codegen
  to succeed.
- We have a `docs/protocol-changelog.md` that logs every
  breaking and additive change with a date.
- Any new endpoint requires an ADR entry or a PR link.

## Follow-ups

- Define the full list of v1 endpoints in `architecture.md` §5.1.
- Pin the codegen tool to a specific version; do not let
  `json-schema-to-typescript` silently update.
