#!/usr/bin/env bash
# Kairo IDE macOS Web QA — stop Runtime Agent + Web product and verify cleanup.
#
# Usage:
#   stop-qa-stack.sh [--data-dir DIR]
#
# If --data-dir is omitted, reads KAIRO_QA_DATA_DIR from the environment.
# Stops processes recorded by start-qa-stack.sh, then falls back to port-based
# and pattern-based termination to eliminate orphans.

set -euo pipefail

DATA_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir)
      DATA_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--data-dir DIR]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$DATA_DIR" ]]; then
  DATA_DIR="${KAIRO_QA_DATA_DIR:-}"
fi
if [[ -z "$DATA_DIR" ]]; then
  echo "[stop-qa-stack] ERROR: --data-dir or KAIRO_QA_DATA_DIR required" >&2
  exit 2
fi

if [[ ! -d "$DATA_DIR" ]]; then
  echo "[stop-qa-stack] WARN: data dir does not exist: $DATA_DIR"
  exit 0
fi

AGENT_PID_FILE="$DATA_DIR/pids/agent.pid"
WEB_PID_FILE="$DATA_DIR/pids/web.pid"
ENV_FILE="$DATA_DIR/stack.env"

AGENT_PORT=""
WEB_PORT=""
if [[ -r "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  AGENT_PORT="${KAIRO_QA_AGENT_PORT:-}"
  WEB_PORT="${KAIRO_QA_WEB_PORT:-}"
fi

safe_kill() {
  local pid="$1"
  local label="$2"
  if [[ -z "$pid" || "$pid" == "0" ]]; then
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "[stop-qa-stack] Stopping $label (pid $pid) ..."
    kill -TERM "$pid" 2>/dev/null || true
    local waited=0
    while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 15 ]]; do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "[stop-qa-stack] $label did not exit gracefully; sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
}

kill_by_port() {
  local port="$1"
  local label="$2"
  if [[ -z "$port" ]]; then
    return 0
  fi
  local pids=""
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[stop-qa-stack] Stopping $label processes on port $port: $pids"
    for pid in $pids; do
      safe_kill "$pid" "$label"
    done
  fi
}

# Stop recorded leaders first.
if [[ -r "$AGENT_PID_FILE" ]]; then
  safe_kill "$(cat "$AGENT_PID_FILE")" "Runtime Agent"
fi
if [[ -r "$WEB_PID_FILE" ]]; then
  safe_kill "$(cat "$WEB_PID_FILE")" "Web product"
fi

# Port-based cleanup as a safety net.
kill_by_port "$AGENT_PORT" "Runtime Agent"
kill_by_port "$WEB_PORT" "Web product"

# Pattern-based cleanup: kill any remaining kairo-runtime or Theia start
# processes that were launched from this data directory.
for pid in $(pgrep -f "kairo-runtime --config ${DATA_DIR}/agent-config.yaml" 2>/dev/null || true); do
  safe_kill "$pid" "Runtime Agent (pattern)"
done
for pid in $(pgrep -f "theia start ${DATA_DIR}/workspace" 2>/dev/null || true); do
  safe_kill "$pid" "Web product (pattern)"
done

# Tomcat / JDT LS children spawned by the agent. Use the bundled dir path as a
# discriminator to avoid killing unrelated Java processes.
if [[ -n "${KAIRO_QA_AGENT_BUNDLED_DIR:-}" ]]; then
  for pid in $(pgrep -f "${KAIRO_QA_AGENT_BUNDLED_DIR}" 2>/dev/null || true); do
    safe_kill "$pid" "Agent child (bundled pattern)"
  done
fi

# Final verification: nothing should be listening on the QA ports.
sleep 1
ORPHAN_FOUND=0
if [[ -n "$AGENT_PORT" ]]; then
  if lsof -ti tcp:"$AGENT_PORT" >/dev/null 2>&1; then
    echo "[stop-qa-stack] WARN: process still listening on agent port $AGENT_PORT" >&2
    ORPHAN_FOUND=1
  fi
fi
if [[ -n "$WEB_PORT" ]]; then
  if lsof -ti tcp:"$WEB_PORT" >/dev/null 2>&1; then
    echo "[stop-qa-stack] WARN: process still listening on web port $WEB_PORT" >&2
    ORPHAN_FOUND=1
  fi
fi

if [[ "$ORPHAN_FOUND" == "1" ]]; then
  echo "[stop-qa-stack] WARN: orphan processes detected — see lsof output above" >&2
  exit 1
fi

echo "[stop-qa-stack] Stack stopped and ports released."
