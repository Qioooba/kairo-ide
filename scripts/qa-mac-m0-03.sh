#!/usr/bin/env bash
# scripts/qa-mac-m0-03.sh
#
# Wave 0 M0-03 — real launch of Runtime Agent + Web product.
# Uses non-default ports (19090/3300) so we never collide with
# the default 18080/3000 dev runs that other processes may be
# holding on the same host. Each child process is started with
# `setsid` and tracked by pid file; teardown kills the entire
# process group so we never leak orphans.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KAIRO_QA_ROOT="${KAIRO_QA_ROOT:-/tmp/kairo-mac-web-qa.$$}"
TESTED_COMMIT="${TESTED_COMMIT:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
QA_AGENT_PORT="${QA_AGENT_PORT:-19090}"
QA_BROWSER_PORT="${QA_BROWSER_PORT:-3300}"

mkdir -p "$KAIRO_QA_ROOT"/{logs,commands,artifacts,artifacts/logs}

# Per-run runtime data dir (avoids touching the repo).
QA_RUNTIME_DATA="$KAIRO_QA_ROOT/runtime-data"
mkdir -p "$QA_RUNTIME_DATA/bundled"

AGENT_PID_FILE="$KAIRO_QA_ROOT/agent.pid"
AGENT_LOG="$KAIRO_QA_ROOT/artifacts/logs/runtime.log"
BROWSER_PID_FILE="$KAIRO_QA_ROOT/browser.pid"
BROWSER_LOG="$KAIRO_QA_ROOT/artifacts/logs/theia-browser.log"

cd "$REPO_ROOT"

stop_pid() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid; pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "stopping pid=$pid from $pidfile"
      kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        sleep 1
        kill -0 "$pid" 2>/dev/null || break
      done
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

stop_all() {
  echo "stopping all child processes"
  stop_pid "$AGENT_PID_FILE"
  stop_pid "$BROWSER_PID_FILE"
}
trap stop_all EXIT INT TERM

# ---- 1. Runtime Agent ----
echo "==> starting kairo-runtime on 127.0.0.1:$QA_AGENT_PORT"
QA_RUNTIME_DATA="$QA_RUNTIME_DATA" \
QA_AGENT_PORT="$QA_AGENT_PORT" \
  KAIRO_QA_ROOT="$KAIRO_QA_ROOT" \
  setsid env \
    KAIRO_RUNTIME_DATA="$QA_RUNTIME_DATA" \
    KAIRO_QA_ROOT="$KAIRO_QA_ROOT" \
    QA_AGENT_PORT="$QA_AGENT_PORT" \
    QA_BROWSER_PORT="$QA_BROWSER_PORT" \
    bash -c '
      cd '"$REPO_ROOT"'/runtime-agent
      exec ./bin/kairo-runtime \
        --config ../configs/qa-mac-web.yaml \
        --bind 127.0.0.1 \
        --port '"$QA_AGENT_PORT"'
    ' >"$AGENT_LOG" 2>&1 &
echo $! > "$AGENT_PID_FILE"

# ---- 2. wait for health ----
echo "==> waiting for /api/v1/health"
healthy=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$QA_AGENT_PORT/api/v1/health" >/dev/null 2>&1; then
    echo "    healthy after ${i}s"
    healthy=1
    break
  fi
  sleep 1
done
if [[ $healthy -eq 0 ]]; then
  echo "    TIMEOUT waiting for runtime health"
  echo "    last 80 log lines:"
  tail -n 80 "$AGENT_LOG" | sed 's/^/    /'
  exit 1
fi

# ---- 3. verify the bind address (must be loopback only) ----
bind_check=$(lsof -nP -a -iTCP -sTCP:LISTEN -p "$(cat "$AGENT_PID_FILE")" 2>/dev/null | awk 'NR==2 {print $9}')
echo "    bind=$bind_check"
if echo "$bind_check" | grep -qE "(\\*|0\\.0\\.0\\.0)[:.]"; then
  echo "    FAIL: runtime is bound to a non-loopback address ($bind_check)"
  exit 2
fi

# ---- 4. start Theia browser ----
echo "==> starting Theia browser on 127.0.0.1:$QA_BROWSER_PORT"
KAIRO_RUNTIME_URL="http://127.0.0.1:$QA_AGENT_PORT" \
  setsid env \
    KAIRO_QA_ROOT="$KAIRO_QA_ROOT" \
    QA_BROWSER_PORT="$QA_BROWSER_PORT" \
    QA_AGENT_PORT="$QA_AGENT_PORT" \
    KAIRO_RUNTIME_URL="http://127.0.0.1:$QA_AGENT_PORT" \
    bash -c '
      cd '"$REPO_ROOT"'/apps/browser
      exec ../../node_modules/.bin/theia start /tmp/kairo-workspace \
        --hostname=127.0.0.1 \
        --port='"$QA_BROWSER_PORT"' \
        --log-level=debug
    ' >"$BROWSER_LOG" 2>&1 &
echo $! > "$BROWSER_PID_FILE"

# ---- 5. wait for HTTP 200 on browser ----
echo "==> waiting for browser HTTP 200"
ready=0
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$QA_BROWSER_PORT/" 2>/dev/null || echo 000)
  if [[ "$code" == "200" ]]; then
    echo "    browser ready after ${i}s (HTTP $code)"
    ready=1
    break
  fi
  sleep 1
done
if [[ $ready -eq 0 ]]; then
  echo "    TIMEOUT waiting for browser (last code=$code)"
  echo "    last 80 log lines:"
  tail -n 80 "$BROWSER_LOG" | sed 's/^/    /'
  exit 3
fi

# ---- 6. write pid + manifest ----
cat >"$KAIRO_QA_ROOT/launch-manifest.json" <<EOF
{
  "commit": "$TESTED_COMMIT",
  "agent": {
    "pid": $(cat "$AGENT_PID_FILE"),
    "bind": "127.0.0.1:$QA_AGENT_PORT",
    "log": "$AGENT_LOG"
  },
  "browser": {
    "pid": $(cat "$BROWSER_PID_FILE"),
    "bind": "127.0.0.1:$QA_BROWSER_PORT",
    "log": "$BROWSER_LOG"
  }
}
EOF

echo
echo "Runtime  http://127.0.0.1:$QA_AGENT_PORT/api/v1/health"
echo "Browser  http://127.0.0.1:$QA_BROWSER_PORT/"
echo "Manifest $KAIRO_QA_ROOT/launch-manifest.json"
echo
echo "Press Ctrl-C to stop, or run scripts/qa-mac-stop.sh"

# ---- 7. foreground so the user / orchestrator can attach ----
if [[ "${QA_FG:-0}" == "1" ]]; then
  wait "$(cat "$AGENT_PID_FILE")" 2>/dev/null || true
fi
