#!/usr/bin/env bash
# Kairo IDE Performance Baseline Measurement Script
# ==================================================
# Measures:
#   1. Go Agent cold start time (binary start → /api/v1/health 200)
#   2. API response latency for key endpoints (health, search, build)
#   3. Search performance (100 files, 1000 files)
#   4. Memory usage (RSS after startup, search, build)
#   5. ripgrep availability and search speed
#
# Output: perf-gate.json in the project root
#
# Usage: ./scripts/perf/perf-baseline.sh [--skip-build] [--port PORT]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT="${ROOT}/perf-gate.json"
AGENT_DIR="${ROOT}/runtime-agent"
AGENT_BIN="${AGENT_DIR}/bin/kairo-runtime"
CONFIG_FILE="${AGENT_DIR}/configs/dev.yaml"

# ─── Defaults ─────────────────────────────────────────────────────
SKIP_BUILD=false
PORT=${KAIRO_PORT:-18888}
TIMEOUT_SEC=30
AGENT_URL="http://127.0.0.1:${PORT}"

# ─── Parse args ───────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true ;;
    --port) PORT="$2"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

AGENT_URL="http://127.0.0.1:${PORT}"

# ─── Helpers ──────────────────────────────────────────────────────

log() { echo "[perf-baseline] $(date '+%H:%M:%S') $*" >&2; }

millis() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  elif command -v python3 &>/dev/null; then
    python3 -c 'import time; print(int(time.time() * 1000))'
  else
    date +%s000
  fi
}

http_get() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000"
}

http_get_time() {
  local url="$1"
  # Returns total time in milliseconds
  curl -s -o /dev/null -w '%{time_total}' --max-time 10 "$url" 2>/dev/null || echo "0"
}

http_get_time_ms() {
  local t
  t=$(http_get_time "$1")
  python3 -c "print(int(float('$t') * 1000))" 2>/dev/null || echo "0"
}

get_rss_mb() {
  local pid="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' | awk '{printf "%.1f", $1/1024}'
  else
    ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ' | awk '{printf "%.1f", $1/1024}'
  fi
}

# ─── Check prerequisites ──────────────────────────────────────────

check_prereqs() {
  local missing=()
  command -v curl &>/dev/null || missing+=("curl")
  command -v python3 &>/dev/null || missing+=("python3")
  if [[ ${#missing[@]} -gt 0 ]]; then
    log "ERROR: missing required tools: ${missing[*]}"
    exit 1
  fi
}

# ─── Build Go agent ───────────────────────────────────────────────

build_agent() {
  if [[ "$SKIP_BUILD" == "true" ]]; then
    log "Skipping build (--skip-build)"
    if [[ ! -x "$AGENT_BIN" ]]; then
      log "ERROR: agent binary not found at $AGENT_BIN and --skip-build is set"
      exit 1
    fi
    return
  fi

  log "Building Go agent..."
  cd "$AGENT_DIR"
  local build_start
  build_start=$(millis)
  CGO_ENABLED=0 go build -o bin/kairo-runtime ./cmd/kairo-runtime 2>&1 | while IFS= read -r line; do
    log "  build: $line"
  done
  local build_end
  build_end=$(millis)
  local build_ms=$((build_end - build_start))
  log "Go agent built in ${build_ms}ms"

  if [[ ! -x "$AGENT_BIN" ]]; then
    log "ERROR: build failed — binary not found at $AGENT_BIN"
    exit 1
  fi
}

# ─── Start agent ──────────────────────────────────────────────────

start_agent() {
  log "Starting agent on port $PORT..."
  # Use a temp config based on dev.yaml
  local temp_config
  temp_config=$(mktemp /tmp/kairo-perf-config-XXXXXX.yaml)
  cp "$CONFIG_FILE" "$temp_config"

  # Start agent in background
  "$AGENT_BIN" --config "$temp_config" --port "$PORT" --log-level error &
  AGENT_PID=$!
  log "Agent PID: $AGENT_PID"

  # Wait for health endpoint
  local start_time
  start_time=$(millis)
  local elapsed=0
  local health_ok=false

  while [[ $elapsed -lt $((TIMEOUT_SEC * 1000)) ]]; do
    local code
    code=$(http_get "${AGENT_URL}/api/v1/health")
    if [[ "$code" == "200" ]]; then
      health_ok=true
      break
    fi
    sleep 0.1
    local now
    now=$(millis)
    elapsed=$((now - start_time))
  done

  local cold_start_ms=$elapsed

  if [[ "$health_ok" != "true" ]]; then
    log "ERROR: Agent did not become healthy within ${TIMEOUT_SEC}s"
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
    rm -f "$temp_config"
    echo "SKIPPED"
    return 1
  fi

  log "Agent healthy after ${cold_start_ms}ms"
  echo "$cold_start_ms"
  return 0
}

# ─── Stop agent ───────────────────────────────────────────────────

stop_agent() {
  if [[ -n "${AGENT_PID:-}" ]]; then
    log "Stopping agent (PID: $AGENT_PID)..."
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
    log "Agent stopped"
  fi
  # Cleanup temp config
  rm -f /tmp/kairo-perf-config-*.yaml 2>/dev/null || true
}

# ─── Measure API latency ──────────────────────────────────────────

measure_api_latency() {
  local endpoint="$1"
  local label="$2"
  local times=()
  local total_ms=0

  for i in $(seq 1 5); do
    local t
    t=$(http_get_time_ms "${AGENT_URL}${endpoint}")
    times+=("$t")
    total_ms=$((total_ms + t))
  done

  local avg_ms=$((total_ms / 5))
  log "  ${label}: avg=${avg_ms}ms (${times[*]})"
  echo "$avg_ms"
}

# ─── Measure search performance ───────────────────────────────────

measure_search() {
  local num_files="$1"
  local search_dir="$2"

  if [[ ! -d "$search_dir" ]]; then
    log "  Search dir not found: $search_dir"
    echo "0"
    return
  fi

  local file_count
  file_count=$(find "$search_dir" -type f 2>/dev/null | head -n "$num_files" | wc -l | tr -d ' ')

  log "  Searching ${file_count} files in ${search_dir}..."

  local start
  start=$(millis)
  find "$search_dir" -type f 2>/dev/null | head -n "$num_files" | xargs grep -l "package" 2>/dev/null | wc -l > /dev/null
  local end
  end=$(millis)
  local elapsed=$((end - start))

  log "  Search ${file_count} files: ${elapsed}ms"
  echo "$elapsed"
}

# ─── Measure ripgrep ──────────────────────────────────────────────

measure_ripgrep() {
  local search_dir="$1"

  if ! command -v rg &>/dev/null; then
    log "  ripgrep not available"
    echo "0"
    return
  fi

  log "  ripgrep available: $(rg --version | head -1)"

  if [[ ! -d "$search_dir" ]]; then
    log "  Search dir not found: $search_dir"
    echo "0"
    return
  fi

  local start
  start=$(millis)
  rg -l "package" "$search_dir" --max-depth 3 2>/dev/null | wc -l > /dev/null
  local end
  end=$(millis)
  local elapsed=$((end - start))

  log "  ripgrep search: ${elapsed}ms"
  echo "$elapsed"
}

# ─── Main ─────────────────────────────────────────────────────────

main() {
  log "=== Kairo IDE Performance Baseline ==="
  log "Project root: $ROOT"
  log "Platform: $(uname -s) $(uname -m)"
  log "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  check_prereqs

  # ── Results variables (bash 3.2 compatible) ──
  RES_cold_start_ms="0"
  RES_health_latency_ms="0"
  RES_search_latency_ms="0"
  RES_build_latency_ms="0"
  RES_search_100_files_ms="0"
  RES_search_1000_files_ms="0"
  RES_memory_after_startup_mb="0"
  RES_memory_after_search_mb="0"
  RES_memory_after_build_mb="0"
  RES_ripgrep_available="false"
  RES_ripgrep_speed_ms="0"
  RES_go_benchmark_results="{}"
  RES_agent_started="false"

  # ── Step 1: Build agent ──
  build_agent

  # ── Step 2: Start agent & measure cold start ──
  log ""
  log "--- Cold Start & API Latency ---"
  local cold_start
  cold_start=$(start_agent)
  if [[ "$cold_start" == "SKIPPED" ]]; then
    RES_agent_started="false"
    RES_cold_start_ms="0"
    RES_health_latency_ms="0"
    RES_search_latency_ms="0"
    RES_build_latency_ms="0"
    RES_memory_after_startup_mb="0"
    RES_memory_after_search_mb="0"
    RES_memory_after_build_mb="0"
  else
    RES_agent_started="true"
    RES_cold_start_ms="$cold_start"

    # ── Step 3: API latency ──
    log ""
    log "--- API Latency ---"
    RES_health_latency_ms=$(measure_api_latency "/api/v1/health" "health")
    RES_search_latency_ms=$(measure_api_latency "/api/v1/search?q=test" "search")
    RES_build_latency_ms=$(measure_api_latency "/api/v1/build" "build")

    # ── Step 4: Memory after startup ──
    if [[ -n "${AGENT_PID:-}" ]]; then
      RES_memory_after_startup_mb=$(get_rss_mb "$AGENT_PID")
      log "  Memory after startup: ${RES_memory_after_startup_mb} MB"
    fi

    # ── Step 5: Search performance ──
    log ""
    log "--- Search Performance ---"
    RES_search_100_files_ms=$(measure_search 100 "$ROOT/runtime-agent")
    RES_memory_after_search_mb=$(get_rss_mb "$AGENT_PID")
    log "  Memory after search: ${RES_memory_after_search_mb} MB"

    RES_search_1000_files_ms=$(measure_search 1000 "$ROOT")
    RES_memory_after_build_mb=$(get_rss_mb "$AGENT_PID")
    log "  Memory after build/search: ${RES_memory_after_build_mb} MB"

    # ── Step 6: Stop agent ──
    stop_agent
  fi

  # ── Step 7: ripgrep ──
  log ""
  log "--- ripgrep Check ---"
  if command -v rg >/dev/null 2>&1; then
    RES_ripgrep_available="true"
    RES_ripgrep_speed_ms=$(measure_ripgrep "$ROOT/runtime-agent")
  else
    RES_ripgrep_available="false"
    RES_ripgrep_speed_ms="0"
  fi

  # ── Step 8: Go benchmarks ──
  log ""
  log "--- Go Benchmarks ---"
  cd "$AGENT_DIR"
  if command -v go >/dev/null 2>&1; then
    local bench_output
    bench_output=$(go test -bench=. -benchtime=1s -count=3 ./... 2>&1 || true)
    log "  Go benchmarks completed"
    RES_go_benchmark_results=$(echo "$bench_output" | python3 -c "
import sys, json
lines = sys.stdin.read().strip().split('\n')
bench_lines = [l.strip() for l in lines if 'Benchmark' in l and 'ns/op' in l]
result = {
    'benchmark_count': len(bench_lines),
    'benchmarks': bench_lines,
    'full_output_truncated': len(lines) > 100
}
print(json.dumps(result))
" 2>/dev/null || echo '{"benchmark_count":0,"benchmarks":[],"error":"parse failed"}')
  else
    log "  Go not available — skipping benchmarks"
    RES_go_benchmark_results='{"benchmark_count":0,"benchmarks":[],"error":"go not available"}'
  fi

  # ── Step 9: Generate JSON output ──
  log ""
  log "--- Generating Performance Report ---"

  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  cat > "$OUTPUT" <<JSONEOF
{
  "timestamp": "${timestamp}",
  "session": "Session 9",
  "platform": {
    "os": "$(uname -s)",
    "release": "$(uname -r)",
    "arch": "$(uname -m)",
    "hostname": "$(hostname)",
    "go_version": "$(go version 2>/dev/null || echo 'unknown')"
  },
  "metrics": {
    "agent_started": ${RES_agent_started},
    "agent_cold_start_ms": ${RES_cold_start_ms},
    "api_health_latency_ms": ${RES_health_latency_ms},
    "api_search_latency_ms": ${RES_search_latency_ms},
    "api_build_latency_ms": ${RES_build_latency_ms},
    "search_100_files_ms": ${RES_search_100_files_ms},
    "search_1000_files_ms": ${RES_search_1000_files_ms},
    "memory_after_startup_mb": ${RES_memory_after_startup_mb},
    "memory_after_search_mb": ${RES_memory_after_search_mb},
    "memory_after_build_mb": ${RES_memory_after_build_mb},
    "ripgrep_available": ${RES_ripgrep_available},
    "ripgrep_speed_ms": ${RES_ripgrep_speed_ms},
    "go_benchmark_results": ${RES_go_benchmark_results}
  }
}
JSONEOF

  log "Performance report written to: $OUTPUT"
  log "=== Done ==="
}

main "$@"