# Next Iteration Baseline — Wave 0

> Date: 2026-07-19
> Status: Wave 0 executed

## Commands Executed

```bash
# Go
cd runtime-agent
go build ./...
go vet ./...
go test -count=1 ./... 2>&1

# TypeScript
cd ..
pnpm install --no-frozen-lockfile
pnpm -r --if-present run build
npx tsc --noEmit
```

## Results

| Command | Exit Code | Notes |
|---------|-----------|-------|
| go build | 0 | All packages compile cleanly |
| go vet | 0 | No issues found |
| go test | 1 | `internal/api` encoding tests fail: "path is outside any authorized workspace root" (sandbox issue, N-011). All other packages pass. |
| pnpm install | 0 | Lockfile was out of date; used `--no-frozen-lockfile` |
| tsc --noEmit | 0 | All type checks pass |
| pnpm build | 1 | `@kairo/theia-product` fails: TS6305 (output file not built from source) and TS2742 (inferred type referencing inversify). See N-043. All other 16 packages build successfully. |

## Open Issues

- N-001: Composition root uses `NewMemoryServices` instead of production wiring
- N-004: Build use case executes synchronously, no cancel support
- N-005: Ant provider not wired, no Validate
- N-006: Javac provider has path issues
- N-007: Deploy engine has wrong target directories
- N-008: EventHub not injected into services
- N-010: API handlers still use RawMessage
- N-011: Encoding test sandbox failures ("path is outside any authorized workspace root")
- N-015: Atomic file writes have unresolved issues
- N-016: Server lifecycle has no reconciliation
- N-017: Tomcat provider has hardcoded timeout
- N-018: Desktop main config mismatch
- N-019: Frontend not sending local secret auth
- N-020: Secret injection has wrong timing (`executeJavaScript`)
- N-021: Theia backend not starting (fixed port 3000)
- N-023: Duplicate runtime connection implementations
- N-026: Workspace context not initialized; active project not persisted
- N-027: Import wizard save doesn't save
- N-029: Build/Server React views not replacing old widgets
- N-030: UI still calls Stop/Start instead of Restart
- N-031: Status bar error → empty array
- N-032: Build/Server stores have no snapshot/event wiring
- N-033: Log viewer shows fake data
- N-034: Triple token source in theme
- N-036: Java LS contribution not real LS
- N-037: Browser LanguageClient not real client
- N-040: JDT LS distribution needs real SHA verification
- N-042: Integration CI skips or fails (Tomcat not prepared)
- N-043: theia-product TS build fails (TS6305/TS2742)
- N-044: encoding-extension TS tests missing deps
- N-047: E2E tests use gated steps
- N-048: E2E tests use gated steps