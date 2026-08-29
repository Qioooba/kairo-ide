#!/usr/bin/env bash
# Isolated test lane manager for Kairo IDE browser testing.
# Each lane = runtime-agent + Theia browser + private workspace + data dir.
#
# Usage:
#   lane.sh start <lane>       # start agent + theia for lane A|B|C|D|E
#   lane.sh stop <lane>
#   lane.sh status [lane]
#   lane.sh reset <lane>       # stop, wipe data dir, recreate workspace from legacy-sample
#
# Env overrides: KAIRO_REPO (default repo root), FORCE_REBUILD=1 to go-rebuild agent binary.

set -euo pipefail

REPO="${KAIRO_REPO:-$(cd "$(dirname "$0")/../../.." && pwd)}"
AGENT_BIN="$REPO/runtime-agent/bin/kairo-runtime"
LANES_DIR="$REPO/.test-lanes"

lane_ports() {
  case "$1" in
    A) echo "18400 18401 18402 18403" ;;
    B) echo "18410 18411 18412 18413" ;;
    C) echo "18420 18421 18422 18423" ;;
    D) echo "18430 18431 18432 18433" ;;
    E) echo "18440 18441 18442 18443" ;;
    *) echo "unknown lane: $1 (use A B C D E)" >&2; exit 1 ;;
  esac
}

lane_env() {
  local lane="$1"
  read -r AGENT_PORT THEIA_PORT TOMCAT_PORT JDWP_PORT <<< "$(lane_ports "$lane")"
  export LANE_DIR="$LANES_DIR/$lane"
  export AGENT_PORT THEIA_PORT TOMCAT_PORT JDWP_PORT
}

ensure_agent_bin() {
  if [[ "${FORCE_REBUILD:-0}" == "1" || ! -x "$AGENT_BIN" ]]; then
    echo "[lane] building runtime-agent..."
    (cd "$REPO/runtime-agent" && GOTOOLCHAIN=local go build -o bin/kairo-runtime ./cmd/kairo-runtime)
  fi
}

write_config() {
  cat > "$LANE_DIR/agent.yaml" <<EOF
version: 0.1.0

bindAddress: 127.0.0.1
port: $AGENT_PORT

tlsCert: ""
tlsKey: ""

dataDir: $LANE_DIR/data
bundledDir: $REPO/bundled

logLevel: info

requireAuth: false
rateLimit: 0

tomcatStartTimeout: 60s
tomcatShutdownTimeout: 15s
buildFileTimeout: 30s

workspaceScanMaxDepth: 8
workspaceScanMaxFiles: 50000

logBufferLines: 5000

tomcatDefaultPort: $TOMCAT_PORT
jdwpDefaultPort: $JDWP_PORT
EOF
}

start() {
  local lane="$1"
  lane_env "$lane"
  mkdir -p "$LANE_DIR" "$LANE_DIR/data" "$LANE_DIR/workspace" "$LANE_DIR/logs"
  write_config
  ensure_agent_bin

  if ! is_running "$lane"; then
    # copy legacy-sample into lane workspace on first start only
    if [[ ! -d "$LANE_DIR/workspace/legacy-sample" ]]; then
      rm -rf "$LANE_DIR/workspace"
      mkdir -p "$LANE_DIR/workspace"
      cp -R "$REPO/legacy-sample" "$LANE_DIR/workspace/legacy-sample"
    fi
    nohup "$AGENT_BIN" --config "$LANE_DIR/agent.yaml" > "$LANE_DIR/logs/agent.log" 2>&1 < /dev/null &
    echo $! > "$LANE_DIR/agent.pid"
    for i in $(seq 1 60); do
      curl -fsS "http://127.0.0.1:$AGENT_PORT/api/v1/health" >/dev/null 2>&1 && break
      sleep 0.25
    done
    if ! curl -fsS "http://127.0.0.1:$AGENT_PORT/api/v1/health" >/dev/null 2>&1; then
      echo "[lane $lane] agent FAILED to start; log tail:" >&2
      tail -20 "$LANE_DIR/logs/agent.log" >&2
      return 1
    fi
  fi

  if ! curl -fsS -o /dev/null "http://127.0.0.1:$THEIA_PORT" 2>/dev/null; then
    (cd "$REPO/apps/browser" && \
      KAIRO_RUNTIME_URL="http://127.0.0.1:$AGENT_PORT" THEIA_CONFIG_DIR="$LANE_DIR/theia-config" \
      nohup node lib/backend/main.js "$LANE_DIR/workspace" --hostname=127.0.0.1 --port="$THEIA_PORT" < /dev/null \
      > "$LANE_DIR/logs/theia.log" 2>&1 & echo $! > "$LANE_DIR/theia.pid")
    for i in $(seq 1 120); do
      curl -fsS -o /dev/null "http://127.0.0.1:$THEIA_PORT" 2>/dev/null && break
      sleep 0.5
    done
    if ! curl -fsS -o /dev/null "http://127.0.0.1:$THEIA_PORT" 2>/dev/null; then
      echo "[lane $lane] theia FAILED to start; log tail:" >&2
      tail -20 "$LANE_DIR/logs/theia.log" >&2
      return 1
    fi
  fi
  echo "[lane $lane] READY  theia=http://127.0.0.1:$THEIA_PORT  agent=http://127.0.0.1:$AGENT_PORT  ws=$LANE_DIR/workspace"
}

is_running() {
  local lane="$1"; lane_env "$lane"
  curl -fsS "http://127.0.0.1:$AGENT_PORT/api/v1/health" >/dev/null 2>&1
}

stop() {
  local lane="$1"; lane_env "$lane"
  for name in theia agent; do
    if [[ -f "$LANE_DIR/$name.pid" ]]; then
      local pid; pid=$(cat "$LANE_DIR/$name.pid")
      kill "$pid" >/dev/null 2>&1 || true
      sleep 0.5
      kill -9 "$pid" >/dev/null 2>&1 || true
      rm -f "$LANE_DIR/$name.pid"
    fi
  done
  # kill any process still bound to lane ports
  for port in $AGENT_PORT $THEIA_PORT; do
    local pids; pids=$(lsof -tnP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [[ -n "${pids// /}" ]] && kill -9 $pids 2>/dev/null || true
  done
  pkill -9 -f "kairo-runtime --config $LANE_DIR/agent.yaml" 2>/dev/null || true
  echo "[lane $lane] stopped"
}

status() {
  if [[ $# -gt 0 ]]; then
    local lanes=("$@")
  else
    local lanes=(A B C D E)
  fi
  for lane in "${lanes[@]}"; do
    lane_env "$lane"
    local a="DOWN" t="DOWN"
    curl -fsS -m 1 "http://127.0.0.1:$AGENT_PORT/api/v1/health" >/dev/null 2>&1 && a="UP"
    curl -fsS -m 1 -o /dev/null "http://127.0.0.1:$THEIA_PORT" 2>/dev/null && t="UP"
    printf "lane %s: agent(%s)=%s theia(%s)=%s ws=%s\n" "$lane" "$AGENT_PORT" "$a" "$THEIA_PORT" "$t" "$LANE_DIR/workspace"
  done
}

reset() {
  local lane="$1"; lane_env "$lane"
  stop "$lane"
  rm -rf "$LANE_DIR/data" "$LANE_DIR/theia-config" "$LANE_DIR/workspace"
  start "$lane"
}

cmd="${1:-status}"
shift || true
case "$cmd" in
  start) start "$@" ;;
  stop) stop "$@" ;;
  status) status "$@" ;;
  reset) reset "$@" ;;
  *) echo "usage: lane.sh {start|stop|status|reset} [lane]" >&2; exit 1 ;;
esac
