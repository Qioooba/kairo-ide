#!/usr/bin/env bash
# Run the agent and the Theia browser app together in dev.
# On Windows use scripts\dev.ps1 instead.
set -euo pipefail
cd "$(dirname "$0")/.."

KAIRO_DATA_DIR="${KAIRO_DATA_DIR:-$PWD/.runtime/data}"
export KAIRO_DATA_DIR
mkdir -p "$KAIRO_DATA_DIR"

# The Theia browser frontend reads this URL to find the agent.
# Without it, the runtime client's baseUrl stays '' and every
# /api/* request goes to the Theia origin (port 3000) and 404s.
export KAIRO_RUNTIME_URL="${KAIRO_RUNTIME_URL:-http://127.0.0.1:18080}"

# Start the agent in the background.
(cd runtime-agent && exec GOTOOLCHAIN=local go run ./cmd/kairo-runtime --config configs/dev.yaml) &
AGENT_PID=$!
cleanup() {
  # `exec` on the last line previously replaced this shell with
  # the Theia process, so the EXIT/INT/TERM traps never fired
  # and the agent was orphaned on Ctrl-C. We now run Theia in
  # the foreground (below) and clean up here when it exits.
  if kill -0 "$AGENT_PID" 2>/dev/null; then
    kill "$AGENT_PID" 2>/dev/null || true
    # Give the agent time to flush Tomcat/log buffers before
    # escalating. 0.2s was too tight and routinely left a
    # dangling listener on 18080 for the next dev run.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$AGENT_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$AGENT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Wait for the agent to come up.
for i in {1..50}; do
  if curl -fsS http://127.0.0.1:18080/api/v1/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

# Run Theia in the foreground so this shell stays alive to run
# the cleanup trap. Previously this was `exec pnpm ...`, which
# replaced the shell and disabled the trap.
pnpm --filter @kairo/theia-product start:browser &
THEIA_PID=$!
# Forward Ctrl-C / SIGTERM to Theia, then let the EXIT trap
# handle the agent.
trap 'kill -INT "$THEIA_PID" 2>/dev/null || true' INT TERM
wait "$THEIA_PID" || true
