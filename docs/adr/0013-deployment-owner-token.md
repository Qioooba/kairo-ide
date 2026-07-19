# ADR-0013: Deployment Owner Token

**Status**: Accepted
**Date**: 2026-07-19

## Context

Deployment operations (publishing artifacts to a running server) are
destructive — they overwrite files in the server's webapp directory. Without
a guard, any code path that calls `Deploy()` could overwrite the wrong
server's webapp. The deployment target resolver (`DeploymentTargetResolver`)
is the only component that knows which directory corresponds to which
server, and it must prove to the deploy engine that the caller has been
authorized for that specific target.

The original implementation had two critical defects:

1. A **global `uint64` counter** used for token generation had a **data race**
   under concurrent minting.
2. The token was **trivially forgeable** — any code that called
   `NewDeploymentOwnerToken()` could produce a valid token for any target.

Both defects are fixed in the current implementation.

## Decision

**DeploymentOwnerToken** is an HMAC-based capability token that proves the
caller has been authorized to deploy to a specific deployment target.

### Design

```go
type DeploymentOwnerToken struct {
    nonce [32]byte
    tag   [32]byte // HMAC-SHA256 over (nonce|ws|proj|srv|root) using ownerSecret
}
```

- **Process-wide secret** (`ownerSecret`): generated at package init from
  `crypto/rand` (32 bytes). Never leaves the process. Never serialized to
  disk.
- **HMAC-SHA256 tag**: computed over the concatenation of `nonce`, workspace
  ID, project ID, server ID, and deployment root path. This binds the token
  to a specific deployment target.
- **Constant-time comparison**: `hmac.Equal` is used for verification,
  preventing timing side-channel attacks.
- **Concurrent minting**: protected by a `sync.Mutex` on the nonce
  generation path. The HMAC itself is stateless and safe for concurrent use.

### Usage

1. `DeploymentTargetResolver.ResolveDeploymentTarget(ctx, ws, proj, srv)`
   returns a `DeploymentTarget` containing a `DeploymentOwnerToken`.
2. The deploy engine receives the token alongside the deployment command.
3. Before performing any write, the deploy engine calls
   `token.Verify(ws, proj, srv, root)`.
4. If verification fails, the deployment is rejected with an error.

No plaintext token ever leaves the verifier. The token is opaque to the
HTTP layer — it is an internal domain capability, not an API concept.

### Test coverage

7 tests in `runtime-agent/internal/domain/deployment_owner_token_test.go`:

- `TestDeploymentOwnerToken_Verify_RejectsDifferentTarget` — verifies that
  a token minted for target A is rejected by target B.
- `TestDeploymentOwnerToken_ConcurrentMinting` — verifies no data races
  under concurrent minting.
- `TestDeploymentOwnerToken_TamperedTagFailsVerify` — verifies that a
  modified token is rejected.
- Plus 4 additional tests covering edge cases.

## Consequences

### Positive

- **Unforgeable**: only the component that holds the process-wide secret
  can mint a valid token. No other code path can fabricate one.
- **Target-bound**: a token minted for `(ws=A, proj=P, srv=S, root=R)` is
  useless for any other target.
- **Thread-safe**: concurrent minting is safe.
- **Timing-safe**: constant-time comparison prevents timing attacks.
- **No plaintext leakage**: the token is opaque outside the domain layer.

### Negative

- **Process-bound**: the token is only valid within the same process. If
  the Go agent restarts, all tokens are invalidated. This is acceptable
  because deployment operations are always synchronous with the current
  agent session.
- **Slight overhead**: HMAC-SHA256 computation per mint and verify, but
  this is negligible compared to the I/O cost of actual deployment.

## References

- Implementation: `runtime-agent/internal/domain/project.go`
- Tests: `runtime-agent/internal/domain/deployment_owner_token_test.go`