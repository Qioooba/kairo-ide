# Kairo IDE — Testing

> We test continuously. The test plan is part of the product, not a
> postmortem.

## 1. Test pyramid

```
                         ▲
                        ╱ ╲
                       ╱ E2E╲        Playwright (real browser, real agent)
                      ╱───────╲      ~30 scenarios per milestone
                     ╱         ╲
                    ╱Integration╲   Go: real processes, real filesystem
                   ╱ (race + tag) ╲  TS: extensions over a real Theia shell
                  ╱───────────────╲
                 ╱    Unit tests    ╲  Go: standard `testing`
                ╱   (deterministic)  ╲ TS: `mocha` + `chai`, fast
               ╱─────────────────────╲
```

## 2. Languages and frameworks

| Layer | Language | Framework | Where |
|-------|----------|-----------|-------|
| Go Runtime Agent unit | Go | `testing` | `runtime-agent/**/*_test.go` |
| Go Runtime Agent integration | Go | `testing` + `//go:build integration` | `runtime-agent/test/integration/` |
| Go Runtime Agent race | Go | `-race` | CI on every PR |
| TS extension unit | TypeScript | `mocha` + `chai` (provided by Theia) | `packages/*/src/**/*.test.ts` |
| TS component | TypeScript | `@testing-library/react` | `packages/ui-kit/test/` |
| E2E | TypeScript | Playwright | `tests/e2e/` |

## 3. Fixtures

- **`legacy-sample/`** — a real, runnable legacy project used by
  every E2E and most integration tests. It contains:
  - 1 Servlet at `src/main/java/com/example/legacy/HelloServlet.java`
  - 1 JSP at `WebRoot/hello.jsp` (GBK)
  - 1 JSP at `WebRoot/utf8.jsp` (UTF-8)
  - 1 properties file at `src/main/resources/messages.properties`
  - 1 JSTL taglib usage
  - 1 custom tag declaration in `WebRoot/WEB-INF/tags/hello.tag`
  - 1 Ant `build.xml`
  - 1 `web.xml`
  - A pre-prepared `curl` request that hits `/hello` and is used by
    the debug E2E.
- **`bundled/tomcat6/`** — a directory ready to receive a verified
  Tomcat 6.0.53 archive. The build script downloads + checksums it
  from Apache archives. The fixture test asserts checksum.

## 4. Test data discipline

- No production data, ever.
- Generated passwords, names, tokens: a per-test seed in a known
  fixed seed (`SeedForE2E = 0xC0FFEE`).
- All temp files in `t.TempDir()` or Playwright's `tmpdir`, never
  in the repo.

## 5. Performance methodology

Performance is in scope. We measure, we gate, we do not estimate.

### 5.1 Cold start to editor visible

- Windows 10 cloud desktop reference box: 2 vCPU, 4 GB RAM, no AV
  exclusion. (We do not have a real one in CI; the closest is
  `windows-2022` in GitHub Actions with 2-core runner; the
  difference is documented.)
- Measure: from process start to "first editor mounted" event.
- Tooling: Playwright + `performance.now()` markers emitted by the
  Theia app shell.
- Gate: ≤ 8 s on reference; if slower, file as a milestone debt
  with a target.

### 5.2 Search latency

- Generate 10 000 files of ~10 KB each, in `/tmp/bench-search/`.
- Single-threaded search for a known token.
- Report wall-clock, RSS before/after.
- Gate: ≤ 3 s for first hit, p95 ≤ 5 s.

### 5.3 Build latency

- Compile `legacy-sample/` (10 source files) on JDK 21 invoking
  `javac --release 6` for `target`.
- Report cold (no cache) and warm (everything cached, 1 file
  changed).
- Gate: cold ≤ 6 s, warm ≤ 2 s.

### 5.4 Memory

- `runtime-agent` idle RSS after workspace open with 0 projects.
- `JDT LS` heap (configurable, default 256 MB).
- Report in `docs/perf-reports/<date>.md` (CI uploads, not in
  source).

## 6. CI matrix

`windows-latest`, `macos-latest`, `ubuntu-latest`, with
cross-compiled Linux arm64 in release only.

```
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm bootstrap
      - run: pnpm build
      - run: pnpm test
      - run: pnpm test:agent
```

Release job additionally cross-compiles agent binaries and
electron-packager outputs.

## 7. Test commands (reproducible)

| Command | What it does |
|---------|--------------|
| `pnpm test` | All TS unit + component tests in packages and apps |
| `pnpm test:agent` | Go unit tests with `-race` |
| `pnpm test:agent:integration` | Go integration tests (needs JDK) |
| `pnpm test:e2e:api` | Runtime Agent HTTP smoke (no browser) |
| `pnpm test:e2e:smoke` | Playwright shell smoke (headless) |
| `pnpm test:e2e:web` | Playwright full-chain UI E2E (headless) |
| `pnpm test:visual:web` | Headed visual regression smoke |
| `pnpm test:a11y:web` | Headed accessibility smoke |
| `pnpm verify` | bootstrap + build + all of the above |

## 8. What is **not** in test

- We do not test against Oracle JDK 6 in CI (license + availability).
  The integration test that requires JDK 6 is **skipped** unless
  `KAIRO_JDK6_HOME` is set, in which case it runs.
- We do not run a real Tomcat 6 in CI. The wrapper is unit-tested;
  a smoke E2E with a stubbed `catalina.sh` is the v1 substitute,
  gated by a flag.
- We do not fuzz the LSP/DAP layer. JDT LS has its own fuzzers
  upstream; we trust it.

## 9. Coverage

- Go: ≥ 70% line coverage on `runtime-agent/internal/{api,domain,
  security,proc,encoding}`. Reported by `go test -cover`.
- TS: no fixed threshold. Critical paths (encoding, search replace,
  hot-reload state machine, debug bridge) are tagged and must have
  tests touching them. We do not game the percentage.

## 10. Failure discipline

- A red CI blocks merge. No exceptions.
- A flaky test is **deleted** within 48 hours or fixed. We do not
  keep `it.skip`s around as a tax.
- Test failures write a diagnostic bundle (logs, screenshots,
  network capture) to the CI artifact store. Locally,
  `pnpm test:e2e -- --reporter=line` keeps output small.
