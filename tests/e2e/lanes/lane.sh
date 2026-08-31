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
# Windows (Git Bash/MSYS) needs the .exe suffix; keep plain name elsewhere.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXE_SUFFIX=".exe" ;;
  *) EXE_SUFFIX="" ;;
esac
AGENT_BIN="$REPO/runtime-agent/bin/kairo-runtime$EXE_SUFFIX"
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
    (cd "$REPO/runtime-agent" && GOTOOLCHAIN=local go build -o "bin/kairo-runtime$EXE_SUFFIX" ./cmd/kairo-runtime)
  fi
}

write_config() {
  # The Go agent runs as a native Windows binary: MSYS-style paths
  # (/g/spaces/...) would be read as drive-root-relative (G:\g\spaces\...),
  # silently relocating dataDir OUTSIDE the lane (state resets then miss).
  # cygpath -m converts to the unambiguous G:/spaces/... form.
  to_native_path() {
    if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
  }
  local data_dir bundled_dir
  data_dir=$(to_native_path "$LANE_DIR/data")
  bundled_dir=$(to_native_path "$REPO/bundled")
  cat > "$LANE_DIR/agent.yaml" <<EOF
version: 0.1.0

bindAddress: 127.0.0.1
port: $AGENT_PORT

tlsCert: ""
tlsKey: ""

dataDir: $data_dir
bundledDir: $bundled_dir

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

resolve_winpid() {
  # Only meaningful on Windows (Git Bash): bash $! for native executables is
  # an MSYS pid that plain kill cannot signal. Overwrite the pid file with the
  # real Windows pid resolved from the listening port (netstat -ano).
  local port="$1" pidfile="$2"
  [[ "$(uname -s)" =~ ^(MINGW|MSYS|CYGWIN) ]] || return 0
  local wpid=""
  for i in $(seq 1 40); do
    wpid=$(netstat -ano 2>/dev/null | awk -v p=":$port\$" '$2 ~ p && $4 == "LISTENING" {print $5}' | head -1)
    [[ -n "$wpid" ]] && break
    sleep 0.5
  done
  if [[ -n "$wpid" ]]; then
    echo "$wpid" > "$pidfile"
  fi
}

kill_tree() {
  # Kill a process and its children. On Windows, bash `kill` cannot signal
  # native executables (MSYS pid space differs) — use taskkill /T /F.
  local pid="$1"
  if [[ "$(uname -s)" =~ ^(MINGW|MSYS|CYGWIN) ]] && command -v taskkill >/dev/null 2>&1; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  else
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.5
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
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
    resolve_winpid "$AGENT_PORT" "$LANE_DIR/agent.pid"
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
    resolve_winpid "$THEIA_PORT" "$LANE_DIR/theia.pid"
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
      kill_tree "$pid"
      rm -f "$LANE_DIR/$name.pid"
    fi
  done
  # kill any process still bound to lane ports
  for port in $AGENT_PORT $THEIA_PORT; do
    local pids
    if command -v lsof >/dev/null 2>&1; then
      pids=$(lsof -tnP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    else
      # Windows netstat: TCP  <local>  <remote>  LISTENING  <pid>
      # Do not use `sort -u` here: on Windows Git Bash it can resolve to the
      # native sort.exe, which treats -u as an input filename and emits a
      # misleading "system cannot find the file" message.  awk provides the
      # required de-duplication without depending on a platform-specific sort.
      pids=$(netstat -ano 2>/dev/null | awk -v p=":$port\$" '$2 ~ p && $4 == "LISTENING" && !seen[$5]++ {print $5}')
    fi
    for p in $pids; do
      kill_tree "$p"
    done
  done
  if command -v pkill >/dev/null 2>&1; then
    pkill -9 -f "kairo-runtime --config $LANE_DIR/agent.yaml" 2>/dev/null || true
  fi
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
