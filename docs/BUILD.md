# Build and Develop — Kairo IDE

Reproducible commands. All commands are run from the repository
root unless otherwise noted.

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 20.10+ | Theia + pnpm |
| pnpm | 9.x | workspace + scripts |
| Go | 1.22+ | Runtime Agent |
| Java | 17+ | Theia build, modern JDT LS runtime |
| Git | 2.30+ | hooks + worktrees |

JDK 6 is **not** required to build. It is required to *run*
Java 6 compilation in the IDE. See `docs/security.md` §2 and
`BLOCKERS.md`.

## Bootstrap

```bash
pnpm install            # installs all TS deps
cd runtime-agent && go mod download && cd -
```

## Develop the IDE (browser form)

```bash
pnpm dev:browser
# → http://localhost:3000
```

This starts the Theia app in dev mode with hot reload. The
Runtime Agent runs in-process; endpoints at `http://localhost:3000/api/v1/`.

## Develop the Runtime Agent standalone

```bash
pnpm agent:run
# → http://127.0.0.1:18080  (default in dev config)
```

Useful for debugging the agent without a browser attached.

## Develop the desktop form

```bash
pnpm --filter @kairo/theia-product build
pnpm --filter @kairo/desktop start
```

## Build everything

```bash
pnpm build              # all TS packages
pnpm build:agent        # Go binary
```

## Test

```bash
pnpm test               # TS unit + component
pnpm test:agent         # Go unit (-race)
pnpm test:agent:integration  # requires JDK 17+
pnpm test:e2e           # Playwright, requires built product
```

## Lint / format

```bash
pnpm lint
pnpm prettier --write .
```

## Release artifacts

### One-click build + package (Windows)

```powershell
# 完整构建 + 打包 + 分卷压缩 (每卷 ≤70MB)
.\scripts\build-and-package.ps1

# 自定义分卷大小
.\scripts\build-and-package.ps1 -VolumeSize 50

# 跳过构建 (仅重新打包)
.\scripts\build-and-package.ps1 -SkipBuild
```

See `docs/DEPLOY-GUIDE.md` for detailed deployment instructions.

### Manual cross-compile

```bash
# Go cross-compile
cd runtime-agent
GOOS=darwin  GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime-darwin-arm64 ./cmd/kairo-runtime
GOOS=darwin  GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime-darwin-amd64 ./cmd/kairo-runtime
GOOS=windows  GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime-windows-amd64.exe ./cmd/kairo-runtime
GOOS=windows  GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime-windows-arm64.exe ./cmd/kairo-runtime
GOOS=linux    GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime-linux-amd64 ./cmd/kairo-runtime
GOOS=linux    GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime-linux-arm64 ./cmd/kairo-runtime

# Electron desktop bundles
pnpm --filter @kairo/desktop dist:mac
pnpm --filter @kairo/desktop dist:win
pnpm --filter @kairo/desktop dist:linux
```

The desktop bundle must contain the Runtime Agent binary for
the matching platform. The build script copies it.

## Common troubleshooting

- `pnpm install` fails with "EACCES: permission denied" on the
  pnpm store → set `pnpm config set store-dir ~/.local/share/pnpm/store`.
- Theia dev server is silent on `http://localhost:3000` →
  check the first lines of output. If the first line is
  "Theia app listening on 0.0.0.0:3000" but the page is
  blank, you have a CSP issue from a browser extension.
  Disable extensions and retry.
- Agent says "port 18080 in use" → change `agent.port` in
  `runtime-agent/configs/dev.yaml`.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `KAIRO_RUNTIME_PORT` | 18080 | Agent HTTP port (dev) |
| `KAIRO_RUNTIME_BIND` | 127.0.0.1 | Agent bind address |
| `KAIRO_LOG_LEVEL` | info | debug / info / warn / error |
| `KAIRO_BUNDLED_DIR` | ./bundled | Where JDT LS, Tomcat live |
| `KAIRO_USER_CONFIG_DIR` | $XDG_CONFIG_HOME/kairo | User config and secrets |
| `KAIRO_JDK6_HOME` | unset | If set, integration tests use this Java 6 |

`KAIRO_USER_CONFIG_DIR` is the **only** writable path outside
the workspace. The agent refuses to write to anything else
unless the user explicitly opts in.
