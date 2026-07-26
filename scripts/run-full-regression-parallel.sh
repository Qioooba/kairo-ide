#!/bin/bash
# =============================================================================
# Kairo IDE Full Regression — Parallel Multi-Agent Test Runner
# =============================================================================
# 启动 3 组并行测试，每组使用独立的 Runtime Agent + Theia 实例
# 每组测试不同的 Shard 范围，最大化并行度
#
# 用法:
#   chmod +x scripts/run-full-regression-parallel.sh
#   ./scripts/run-full-regression-parallel.sh
# =============================================================================

set -e

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$BASE_DIR/tests/e2e/playwright.config.ts"
RESULT_DIR="$BASE_DIR/test-results/parallel-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULT_DIR"

echo "=============================================="
echo " Kairo IDE Full Regression — Parallel Runner"
echo " Result dir: $RESULT_DIR"
echo " Started at: $(date)"
echo "=============================================="

# ── Group A: Shard 01-05 (Shell + Project + Java + MultiLang + Build) ──
run_group_a() {
  echo "[Group A] Starting Shard 01-05..."
  export AGENT_PORT=18182
  export THEIA_PORT=18301
  cd "$BASE_DIR"
  npx playwright test \
    --config "$CONFIG" \
    --grep "SHARD-0[1-5]" \
    --reporter=html,json,list \
    2>&1 | tee "$RESULT_DIR/group-a-shard01-05.log"
  echo "[Group A] Done. Exit code: ${PIPESTATUS[0]}"
}

# ── Group B: Shard 06-10 (Debug + Search + UI + Menu + ContextMenu) ──
run_group_b() {
  echo "[Group B] Starting Shard 06-10..."
  export AGENT_PORT=18183
  export THEIA_PORT=18302
  cd "$BASE_DIR"
  npx playwright test \
    --config "$CONFIG" \
    --grep "SHARD-0[6-9]|SHARD-10" \
    --reporter=html,json,list \
    2>&1 | tee "$RESULT_DIR/group-b-shard06-10.log"
  echo "[Group B] Done. Exit code: ${PIPESTATUS[0]}"
}

# ── Group C: Shard 11-16 (Dialog + View + RealEdit + Console + UI + Perf) ──
run_group_c() {
  echo "[Group C] Starting Shard 11-16..."
  export AGENT_PORT=18184
  export THEIA_PORT=18303
  cd "$BASE_DIR"
  npx playwright test \
    --config "$CONFIG" \
    --grep "SHARD-1[1-6]" \
    --reporter=html,json,list \
    2>&1 | tee "$RESULT_DIR/group-c-shard11-16.log"
  echo "[Group C] Done. Exit code: ${PIPESTATUS[0]}"
}

# ── Launch all groups in parallel ──
run_group_a &
PID_A=$!

run_group_b &
PID_B=$!

run_group_c &
PID_C=$!

echo "PIDs: Group A=$PID_A, Group B=$PID_B, Group C=$PID_C"

# ── Wait for all ──
FAILED=0
wait $PID_A || FAILED=1
wait $PID_B || FAILED=2
wait $PID_C || FAILED=3

# ── Summary ──
echo ""
echo "=============================================="
echo " All groups completed at $(date)"
echo "=============================================="

if [ "$FAILED" -ne 0 ]; then
  echo "ERROR: One or more groups had test failures."
  echo "Check logs in: $RESULT_DIR"
  exit 1
else
  echo "SUCCESS: All test groups passed!"
  exit 0
fi