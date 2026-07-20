#!/usr/bin/env bash
# scripts/qa-mac-m0-01.sh
#
# Wave 0 M0-01 baseline — clean install, build, test, lint.
# Mirrors the commands in
# docs/release-testing/MAC_WEB_RELEASE_CANDIDATE_TEST_AND_FIX_TASK.md §5.
#
# Usage:
#   TESTED_COMMIT=<sha> KAIRO_QA_ROOT=<dir> bash scripts/qa-mac-m0-01.sh
#
# All commands run with explicit timeouts so a single hung step
# cannot block the whole baseline. Each step logs to
# ${KAIRO_QA_ROOT}/logs/<step>.log and writes a JSON record to
# ${KAIRO_QA_ROOT}/commands/<step>.json.

set -u

# ---- configuration ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TESTED_COMMIT="${TESTED_COMMIT:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
KAIRO_QA_ROOT="${KAIRO_QA_ROOT:-/tmp/kairo-mac-web-qa.$$}"
mkdir -p "$KAIRO_QA_ROOT"/{logs,commands,artifacts,reports}

# Port choices: 19090 (Runtime), 3300 (Browser). The defaults 18080/3000
# may already be in use by other test processes on the same host.
QA_AGENT_PORT="${QA_AGENT_PORT:-19090}"
QA_BROWSER_PORT="${QA_BROWSER_PORT:-3300}"

export TESTED_COMMIT KAIRO_QA_ROOT
export QA_AGENT_PORT QA_BROWSER_PORT
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# step timeout in seconds; each command must finish within this
# window or the orchestrator kills it and records TIMEOUT.
STEP_TIMEOUT="${STEP_TIMEOUT:-900}"

log_step() {
  local id="$1"
  local name="$2"
  shift 2
  local log="$KAIRO_QA_ROOT/logs/${id}.log"
  local jsn="$KAIRO_QA_ROOT/commands/${id}.json"
  local start end elapsed rc
  echo "==> $id: $name"
  start=$(date +%s)
  # shellcheck disable=SC2086
  "$@" >"$log" 2>&1 &
  local pid=$!
  ( sleep "$STEP_TIMEOUT" && kill -9 "$pid" 2>/dev/null && echo "[timeout] $id killed after ${STEP_TIMEOUT}s" >>"$log" ) &
  local watchdog=$!
  if wait "$pid"; then rc=0; else rc=$?; fi
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  end=$(date +%s)
  elapsed=$((end - start))
  # Check for timeout marker in the log.
  if grep -q "^\[timeout\]" "$log"; then
    rc=124
  fi
  cat >"$jsn" <<EOF
{"id":"$id","name":"$name","start":$start,"end":$end,"elapsed":$elapsed,"exitCode":$rc,"commit":"$TESTED_COMMIT"}
EOF
  if [[ $rc -eq 0 ]]; then
    echo "    PASS ($elapsed s)"
  else
    echo "    FAIL exit=$rc ($elapsed s) — see $log"
  fi
  return $rc
}

# ---- start ----
cd "$REPO_ROOT"
git status --short > "$KAIRO_QA_ROOT/git-status.txt"
git rev-parse HEAD >> "$KAIRO_QA_ROOT/git-status.txt"
git rev-parse origin/main >> "$KAIRO_QA_ROOT/git-status.txt" 2>&1 || true

{
  echo "TESTED_COMMIT=$TESTED_COMMIT"
  echo "KAIRO_QA_ROOT=$KAIRO_QA_ROOT"
  echo "QA_AGENT_PORT=$QA_AGENT_PORT"
  echo "QA_BROWSER_PORT=$QA_BROWSER_PORT"
  sw_vers
  uname -a
  node --version
  pnpm --version
  go version
  java -version 2>&1
} > "$KAIRO_QA_ROOT/environment.txt"

echo "QA env recorded at $KAIRO_QA_ROOT/environment.txt"
echo "Logs in $KAIRO_QA_ROOT/logs/"
echo

# ---- 1. install (skip if node_modules present) ----
if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  log_step m0-01-install "pnpm install --frozen-lockfile" \
    pnpm install --frozen-lockfile
else
  echo "m0-01-install: SKIP (node_modules already present)"
  cat >"$KAIRO_QA_ROOT/commands/m0-01-install.json" <<EOF
{"id":"m0-01-install","name":"pnpm install --frozen-lockfile","skipped":"node_modules-present","commit":"$TESTED_COMMIT"}
EOF
fi

# ---- 2. TypeScript build ----
log_step m0-01-build "pnpm build" pnpm build

# ---- 3. TypeScript tests ----
log_step m0-01-test "pnpm test" pnpm test

# ---- 4. ESLint ----
log_step m0-01-lint "pnpm lint" pnpm lint

# ---- 5. TypeScript per-package tsc --noEmit ----
log_step m0-01-tsc "pnpm -r --filter ./packages/* exec tsc --noEmit" \
  pnpm -r --filter "./packages/*" exec tsc --noEmit

# ---- 6. gofmt check ----
log_step m0-01-gofmt "gofmt -l (runtime-agent)" \
  bash -c "cd runtime-agent && gofmt -l \$(rg --files -g '*.go')"

# ---- 7. go vet ----
log_step m0-01-govet "go vet ./... (runtime-agent)" \
  bash -c "cd runtime-agent && go vet ./..."

# ---- 8. go test (no race) ----
log_step m0-01-gotest "go test ./... (runtime-agent)" \
  bash -c "cd runtime-agent && go test -count=1 -timeout 300s ./..."

# ---- 9. go test (race) ----
log_step m0-01-gotest-race "go test -race ./... (runtime-agent)" \
  bash -c "cd runtime-agent && go test -race -count=1 -timeout 420s ./..."

# ---- 10. go build (agent) ----
log_step m0-01-agent-build "go build kairo-runtime" \
  bash -c "cd runtime-agent && go build -trimpath -o bin/kairo-runtime ./cmd/kairo-runtime"

# ---- 11. contract / fault / perf node tests (only if files exist) ----
if [[ -f "$REPO_ROOT/tests/contract/contract.test.cjs" ]]; then
  log_step m0-01-contract "node --test tests/contract/contract.test.cjs" \
    node --test tests/contract/contract.test.cjs
fi
if [[ -f "$REPO_ROOT/tests/contract/eventstream.test.cjs" ]]; then
  log_step m0-01-eventstream "node --test tests/contract/eventstream.test.cjs" \
    node --test tests/contract/eventstream.test.cjs
fi
if [[ -f "$REPO_ROOT/tests/fault/fault-injection.test.cjs" ]]; then
  log_step m0-01-fault "node --test tests/fault/fault-injection.test.cjs" \
    node --test tests/fault/fault-injection.test.cjs
fi
if [[ -f "$REPO_ROOT/tests/perf/perf-baseline.test.cjs" ]]; then
  log_step m0-01-perf "node --test tests/perf/perf-baseline.test.cjs" \
    node --test tests/perf/perf-baseline.test.cjs
fi

# ---- 12. integration test (Go, gated by KAIRO_JDK6_HOME) ----
if [[ -n "${KAIRO_JDK6_HOME:-}" ]] || [[ -f "$REPO_ROOT/runtime-agent/test/integration/smoke_test.go" ]]; then
  log_step m0-01-integration "go test -tags=integration ./test/..." \
    bash -c "cd runtime-agent && go test -timeout 240s -tags=integration ./test/... 2>&1" || true
fi

# ---- summary ----
echo
echo "================ M0-01 BASELINE SUMMARY ================"
ok=0
fail=0
for jsn in "$KAIRO_QA_ROOT"/commands/*.json; do
  [[ -f "$jsn" ]] || continue
  if grep -q '"exitCode":0' "$jsn"; then
    echo "PASS  $(basename "$jsn" .json)"
    ok=$((ok+1))
  elif grep -q '"skipped"' "$jsn"; then
    echo "SKIP  $(basename "$jsn" .json)"
  else
    echo "FAIL  $(basename "$jsn" .json)"
    fail=$((fail+1))
  fi
done
echo "========================================================="
echo "OK=$ok  FAIL=$fail"
echo "Detailed records: $KAIRO_QA_ROOT/commands/"
echo "Detailed logs:    $KAIRO_QA_ROOT/logs/"
exit $fail
