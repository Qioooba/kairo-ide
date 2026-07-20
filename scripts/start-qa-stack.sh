#!/usr/bin/env bash
# Kairo IDE macOS Web QA — start Runtime Agent + Web product.
#
# Usage:
#   start-qa-stack.sh [--data-dir DIR] [--port PORT] [--web-port PORT] [--skip-build]
#
# Creates a temp directory under /tmp/kairo-mac-web-qa-m2-XXXXXX unless --data-dir
# is provided. Copies legacy-sample there for destructive testing. Builds and starts
# the Go Runtime Agent on 127.0.0.1 and the Theia browser app, then waits for both
# health endpoints before printing a summary.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Defaults
DATA_DIR=""
PORT="18080"
WEB_PORT="3000"
SKIP_BUILD="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir)
      DATA_DIR="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --web-port)
      WEB_PORT="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD="1"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--data-dir DIR] [--port PORT] [--web-port PORT] [--skip-build]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$DATA_DIR" ]]; then
  DATA_DIR="$(mktemp -d /tmp/kairo-mac-web-qa-m2-XXXXXX)"
fi
mkdir -p "$DATA_DIR"
DATA_DIR="$(cd "$DATA_DIR" && pwd)"

LEGACY_SRC="$REPO_ROOT/legacy-sample"
LEGACY_DST="$DATA_DIR/legacy-sample"
if [[ -d "$LEGACY_SRC" ]]; then
  rm -rf "$LEGACY_DST"
  cp -R "$LEGACY_SRC" "$LEGACY_DST"
else
  echo "[start-qa-stack] WARN: legacy-sample not found at $LEGACY_SRC" >&2
fi

AGENT_DATA_DIR="$DATA_DIR/agent-data"
AGENT_BUNDLED_DIR="$DATA_DIR/agent-bundled"
AGENT_CONFIG="$DATA_DIR/agent-config.yaml"
WORKSPACE_DIR="$DATA_DIR/workspace"
LOG_DIR="$DATA_DIR/logs"
PID_DIR="$DATA_DIR/pids"
mkdir -p "$AGENT_DATA_DIR" "$AGENT_BUNDLED_DIR" "$WORKSPACE_DIR" "$LOG_DIR" "$PID_DIR"

# Prepare bundled Tomcat 6 + JDT LS into the repo's bundled/ tree if available.
if [[ -x "$REPO_ROOT/scripts/prepare-bundled.sh" ]]; then
  "$REPO_ROOT/scripts/prepare-bundled.sh"
fi
if [[ -d "$REPO_ROOT/bundled" && -n "$(ls -A "$REPO_ROOT/bundled" 2>/dev/null)" ]]; then
  AGENT_BUNDLED_DIR="$REPO_ROOT/bundled"
fi

cat > "$AGENT_CONFIG" <<EOF
version: 0.1.0
bindAddress: 127.0.0.1
port: ${PORT}
tlsCert: ""
tlsKey: ""
dataDir: ${AGENT_DATA_DIR}
bundledDir: ${AGENT_BUNDLED_DIR}
logLevel: debug
requireAuth: false
tomcatStartTimeout: 60s
tomcatShutdownTimeout: 15s
buildFileTimeout: 30s
workspaceScanMaxDepth: 8
workspaceScanMaxFiles: 50000
logBufferLines: 5000
EOF

# Build agent
AGENT_BIN="$REPO_ROOT/runtime-agent/bin/kairo-runtime"
if [[ "$SKIP_BUILD" != "1" || ! -x "$AGENT_BIN" ]]; then
  echo "[start-qa-stack] Building Runtime Agent ..."
  (cd "$REPO_ROOT/runtime-agent" && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kairo-runtime ./cmd/kairo-runtime)
fi

# Build web product (packages + browser app). Skip only if explicitly requested.
if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "[start-qa-stack] Building web product ..."
  (cd "$REPO_ROOT" && pnpm -r --filter "./packages/project-extension" build)
  (cd "$REPO_ROOT" && pnpm -r --filter "./packages/theia-product" build)
  (cd "$REPO_ROOT" && pnpm -r --filter "./apps/browser" build)
fi

# Start Runtime Agent
AGENT_LOG="$LOG_DIR/agent.log"
AGENT_PID_FILE="$PID_DIR/agent.pid"
echo "[start-qa-stack] Starting Runtime Agent on 127.0.0.1:${PORT} ..."
nohup "$AGENT_BIN" --config "$AGENT_CONFIG" > "$AGENT_LOG" 2>&1 &
AGENT_PID=$!
echo "$AGENT_PID" > "$AGENT_PID_FILE"

wait_for_health() {
  local url="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

if ! wait_for_health "http://127.0.0.1:${PORT}/api/v1/health" 30; then
  echo "[start-qa-stack] ERROR: Runtime Agent health check failed (port ${PORT})" >&2
  echo "Agent log tail:" >&2
  tail -n 30 "$AGENT_LOG" >&2 || true
  exit 3
fi

echo "[start-qa-stack] Runtime Agent healthy (pid ${AGENT_PID})."

# Start Web product
WEB_LOG="$LOG_DIR/web.log"
WEB_PID_FILE="$PID_DIR/web.pid"
echo "[start-qa-stack] Starting Web product on 127.0.0.1:${WEB_PORT} ..."
# Use pnpm exec theia start; the backend runs in the foreground. The PID file
# captures the CLI leader. Stop-qa-stack.sh kills by PID and by port to ensure
# no orphans.
(
  cd "$REPO_ROOT"
  nohup pnpm --filter @kairo/browser exec theia start "$WORKSPACE_DIR" \
    --hostname=127.0.0.1 --port="$WEB_PORT" > "$WEB_LOG" 2>&1 &
  echo $! > "$WEB_PID_FILE"
)

if ! wait_for_health "http://127.0.0.1:${WEB_PORT}/" 60; then
  echo "[start-qa-stack] ERROR: Web product health check failed (port ${WEB_PORT})" >&2
  echo "Web log tail:" >&2
  tail -n 30 "$WEB_LOG" >&2 || true
  exit 4
fi

WEB_PID=$(cat "$WEB_PID_FILE")
echo "[start-qa-stack] Web product healthy (pid ${WEB_PID})."

# Environment file for downstream scripts and stop-qa-stack.sh
ENV_FILE="$DATA_DIR/stack.env"
cat > "$ENV_FILE" <<EOF
KAIRO_QA_DATA_DIR=${DATA_DIR}
KAIRO_QA_REPO_ROOT=${REPO_ROOT}
KAIRO_QA_AGENT_PID=${AGENT_PID}
KAIRO_QA_AGENT_PORT=${PORT}
KAIRO_QA_AGENT_CONFIG=${AGENT_CONFIG}
KAIRO_QA_AGENT_LOG=${AGENT_LOG}
KAIRO_QA_WEB_PID=${WEB_PID}
KAIRO_QA_WEB_PORT=${WEB_PORT}
KAIRO_QA_WEB_LOG=${WEB_LOG}
KAIRO_QA_LEGACY_DST=${LEGACY_DST}
KAIRO_QA_WORKSPACE_DIR=${WORKSPACE_DIR}
KAIRO_QA_AGENT_BUNDLED_DIR=${AGENT_BUNDLED_DIR}
EOF

echo ""
echo "=== Kairo QA stack ready ==="
echo "DATA_DIR:      $DATA_DIR"
echo "AGENT_PID:     $AGENT_PID"
echo "AGENT_LOG:     $AGENT_LOG"
echo "WEB_PID:       $WEB_PID"
echo "WEB_LOG:       $WEB_LOG"
echo "LEGACY_DST:    $LEGACY_DST"
echo "ENV_FILE:      $ENV_FILE"
echo "Web URL:       http://127.0.0.1:${WEB_PORT}/"
echo "Agent Health:  http://127.0.0.1:${PORT}/api/v1/health"
echo "=============================="
