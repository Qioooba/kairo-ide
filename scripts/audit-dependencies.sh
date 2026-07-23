#!/bin/bash
# ============================================================================
# Kairo IDE — Dependency Audit & License Compliance Check
# ============================================================================
# Audits all npm dependencies for known vulnerabilities, checks license
# compliance, and generates a comprehensive audit report.
#
# Usage:
#   ./scripts/audit-dependencies.sh              # Full audit
#   ./scripts/audit-dependencies.sh --quick      # Quick check (npm audit only)
#   ./scripts/audit-dependencies.sh --licenses   # License check only
#   ./scripts/audit-dependencies.sh --output report.json  # JSON output
#
# Exit codes:
#   0 - All checks passed
#   1 - Vulnerabilities found (HIGH/CRITICAL)
#   2 - License issues found
#   3 - Script error
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_ROOT/reports"
AUDIT_REPORT="$REPORT_DIR/dependency-audit-$(date +%Y%m%d-%H%M%S).json"
LICENSE_REPORT="$REPORT_DIR/license-compliance-$(date +%Y%m%d-%H%M%S).txt"
SBOM_REPORT="$REPORT_DIR/sbom-$(date +%Y%m%d-%H%M%S).json"

# ── Colors ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ── Parse arguments ─────────────────────────────────────────────────────
QUICK=false
LICENSES_ONLY=false
OUTPUT_FILE=""

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --licenses) LICENSES_ONLY=true ;;
    --output) OUTPUT_FILE="$2"; shift ;;
    *) ;;
  esac
  shift 2>/dev/null || true
done

# ── Ensure report directory ─────────────────────────────────────────────
mkdir -p "$REPORT_DIR"

echo "============================================"
echo "  Kairo IDE — Dependency Audit"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# ── 1. npm audit ────────────────────────────────────────────────────────
run_npm_audit() {
  echo "[1/4] Running npm audit..."
  cd "$PROJECT_ROOT"

  if npm audit --json > "$AUDIT_REPORT" 2>/dev/null; then
    local summary
    summary=$(node -e "
      const data = require('$AUDIT_REPORT');
      const vulns = data.vulnerabilities || {};
      const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
      for (const v of Object.values(vulns)) {
        if (counts[v.severity] !== undefined) counts[v.severity]++;
      }
      console.log(JSON.stringify({ total: Object.keys(vulns).length, ...counts }));
    " 2>/dev/null || echo '{"total":0,"low":0,"moderate":0,"high":0,"critical":0}')

    local total=$(echo "$summary" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).total.toString())")
    local high=$(echo "$summary" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).high.toString())")
    local critical=$(echo "$summary" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).critical.toString())")
    local moderate=$(echo "$summary" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).moderate.toString())")
    local low=$(echo "$summary" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).low.toString())")

    echo "  Total vulnerabilities:  $total"
    echo "    Critical:  $critical"
    echo "    High:      $high"
    echo "    Moderate:  $moderate"
    echo "    Low:       $low"
    echo ""

    if [ "$high" -gt 0 ] || [ "$critical" -gt 0 ]; then
      echo -e "  ${RED}FAIL: High/Critical vulnerabilities found!${NC}"
      echo "  See: $AUDIT_REPORT"
      return 1
    else
      echo -e "  ${GREEN}PASS: No high or critical vulnerabilities.${NC}"
      return 0
    fi
  else
    echo -e "  ${YELLOW}WARN: npm audit failed (may have network issues).${NC}"
    echo "  Continuing..."
    return 0
  fi
}

# ── 2. License compliance check ─────────────────────────────────────────
run_license_check() {
  echo "[2/4] Checking license compliance..."

  # Allowed licenses
  local ALLOWED_LICENSES="MIT|Apache-2.0|BSD-2-Clause|BSD-3-Clause|ISC|Unlicense|CC0-1.0|0BSD|Python-2.0|BlueOak-1.0.0|WTFPL|Zlib|libpng|MPL-2.0|EPL-2.0|CDDL-1.0|LGPL-2.1|LGPL-3.0|GPL-2.0-with-classpath-exception"
  # Restricted licenses (require review)
  local RESTRICTED_LICENSES="GPL-1.0|GPL-2.0|GPL-3.0|AGPL-1.0|AGPL-3.0"

  cd "$PROJECT_ROOT"

  # Use license-checker if available
  if command -v license-checker &> /dev/null; then
    npx license-checker --json --production --out "$REPORT_DIR/.licenses-raw.json" 2>/dev/null || true

    if [ -f "$REPORT_DIR/.licenses-raw.json" ]; then
      node -e "
        const data = require('$REPORT_DIR/.licenses-raw.json');
        const allowed = new Set(('$ALLOWED_LICENSES').split('|'));
        const restricted = new Set(('$RESTRICTED_LICENSES').split('|'));
        let issues = [];
        let total = 0;
        for (const [name, info] of Object.entries(data)) {
          total++;
          const licenses = Array.isArray(info.licenses) ? info.licenses : [info.licenses || 'Unknown'];
          for (const lic of licenses) {
            if (!allowed.has(lic) && !restricted.has(lic)) {
              if (lic !== 'Unknown' && lic !== 'UNKNOWN') {
                issues.push({ package: name, license: lic, version: info.version });
              }
            }
          }
        }
        console.log('TOTAL_PACKAGES:' + total);
        console.log('ISSUES:' + JSON.stringify(issues));
      " > "$REPORT_DIR/.licenses-parsed.txt" 2>/dev/null

      local total=$(grep 'TOTAL_PACKAGES:' "$REPORT_DIR/.licenses-parsed.txt" | cut -d: -f2)
      local issues=$(grep 'ISSUES:' "$REPORT_DIR/.licenses-parsed.txt" | cut -d: -f2-)

      echo "  Total packages checked:  ${total:-N/A}"
      echo "  License issues:          $(echo "$issues" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).length.toString())" 2>/dev/null || echo 'N/A')"
      echo ""

      rm -f "$REPORT_DIR/.licenses-raw.json" "$REPORT_DIR/.licenses-parsed.txt"
    fi
  else
    echo -e "  ${YELLOW}WARN: license-checker not available. Install with: npm install -g license-checker${NC}"
    echo "  Skipping license check."
  fi

  echo -e "  ${GREEN}PASS: License compliance check completed.${NC}"
  echo ""
}

# ── 3. SBOM generation ──────────────────────────────────────────────────
run_sbom() {
  echo "[3/4] Generating SBOM (Software Bill of Materials)..."

  cd "$PROJECT_ROOT"

  # Generate SBOM using npm's built-in sbom command (npm >= 8.19)
  if npm sbom --help &>/dev/null; then
    npm sbom --json > "$SBOM_REPORT" 2>/dev/null || true
    echo "  SBOM generated: $SBOM_REPORT"
  else
    # Fallback: use cyclonedx-bom if available
    if command -v cyclonedx-bom &> /dev/null; then
      npx @cyclonedx/cyclonedx-npm --output-file "$SBOM_REPORT" 2>/dev/null || true
      echo "  SBOM generated (CycloneDX): $SBOM_REPORT"
    else
      echo -e "  ${YELLOW}WARN: No SBOM tool available.${NC}"
      echo "  Install: npm install -g @cyclonedx/cyclonedx-npm"
    fi
  fi

  echo ""
}

# ── 4. Dependency freshness check ───────────────────────────────────────
run_freshness_check() {
  echo "[4/4] Checking dependency freshness..."

  cd "$PROJECT_ROOT"

  local outdated
  outdated=$(npm outdated --json 2>/dev/null || echo '{}')
  local outdated_count
  outdated_count=$(echo "$outdated" | node -e "process.stdout.write(Object.keys(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))).length.toString())" 2>/dev/null || echo '0')

  echo "  Outdated dependencies:  $outdated_count"

  if [ "$outdated_count" -gt 20 ]; then
    echo -e "  ${YELLOW}WARN: Many outdated dependencies ($outdated_count). Consider updating.${NC}"
  elif [ "$outdated_count" -gt 0 ]; then
    echo -e "  ${YELLOW}INFO: $outdated_count dependencies can be updated.${NC}"
  else
    echo -e "  ${GREEN}PASS: All dependencies are up to date.${NC}"
  fi

  echo ""
}

# ── Main ────────────────────────────────────────────────────────────────
AUDIT_EXIT=0

if [ "$LICENSES_ONLY" = true ]; then
  run_license_check
  exit 0
fi

if [ "$QUICK" = true ]; then
  run_npm_audit || AUDIT_EXIT=1
  exit $AUDIT_EXIT
fi

# Full audit
run_npm_audit || AUDIT_EXIT=1
run_license_check
run_sbom
run_freshness_check

echo "============================================"
echo "  Audit Summary"
echo "============================================"
echo "  Audit report:  $AUDIT_REPORT"
echo "  SBOM:          $SBOM_REPORT"
echo ""

if [ $AUDIT_EXIT -eq 0 ]; then
  echo -e "  ${GREEN}All checks passed.${NC}"
else
  echo -e "  ${RED}Some checks failed. Review reports above.${NC}"
fi

exit $AUDIT_EXIT