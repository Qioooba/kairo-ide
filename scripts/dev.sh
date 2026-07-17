#!/usr/bin/env bash
# Run the agent and the Theia browser app together in dev.
set -euo pipefail
cd "$(dirname "$0")/.."

KAIRO_DATA_DIR="${KAIRO_DATA_DIR:-$PWD/.runtime/data}"
export KAIRO_DATA_DIR
mkdir -p "$KAIRO_DATA_DIR"

# Start the agent in the background.
(cd runtime-agent && exec go run ./cmd/kairo-runtime --config configs/dev.yaml) &
AGENT_PID=$!
trap 'kill $AGENT_PID 2>/dev/null || true' EXIT INT TERM

# Wait for the agent to come up.
for i in {1..50}; do
  if curl -fsS http://127.0.0.1:18080/api/v1/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

# Start the Theia app.
exec pnpm --filter @kairo/theia-product start:browser
