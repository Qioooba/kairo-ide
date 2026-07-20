#!/usr/bin/env bash
# scripts/qa-mac-stop.sh — stop whatever the M0-03 launch started.
# Reads the pid files written by qa-mac-m0-03.sh and kills the
# whole process group. Safe to call when nothing is running.

set -u

KAIRO_QA_ROOT="${KAIRO_QA_ROOT:-/tmp/kairo-mac-web-qa.l1GwLc}"

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

stop_pid "$KAIRO_QA_ROOT/agent.pid"
stop_pid "$KAIRO_QA_ROOT/browser.pid"

# Also kill anything bound to the QA ports if pid files are gone.
for port in 19090 3300; do
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "freeing port $port (pids: $pids)"
    for p in $pids; do
      kill -KILL "-$p" 2>/dev/null || kill -KILL "$p" 2>/dev/null || true
    done
  fi
done

echo "stopped"
