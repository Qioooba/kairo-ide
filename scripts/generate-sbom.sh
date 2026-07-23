#!/bin/bash
# ============================================================================
# Kairo IDE — SBOM (Software Bill of Materials) Generator
# ============================================================================
# Generates a comprehensive SBOM for the Kairo IDE project, including:
#   - npm dependencies (CycloneDX format)
#   - Go dependencies (if Go agent is present)
#   - Build tool versions
#   - Environment information
#
# Usage:
#   ./scripts/generate-sbom.sh
#   ./scripts/generate-sbom.sh --format spdx   # SPDX format
#   ./scripts/generate-sbom.sh --output sbom.json
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$PROJECT_ROOT/reports"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SBOM_FILE="${REPORT_DIR}/sbom-${TIMESTAMP}.json"
FORMAT="cyclonedx"

# ── Parse arguments ─────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --format)
      FORMAT="$2"
      shift
      ;;
    --output)
      SBOM_FILE="$2"
      shift
      ;;
  esac
  shift 2>/dev/null || true
done

mkdir -p "$REPORT_DIR"

echo "============================================"
echo "  Kairo IDE — SBOM Generator"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# ── 1. Node.js dependencies ────────────────────────────────────────────
echo "[1/3] Generating npm dependencies SBOM..."

cd "$PROJECT_ROOT"

# Try CycloneDX tool first
if npx --yes @cyclonedx/cyclonedx-npm --help &>/dev/null 2>&1; then
  npx --yes @cyclonedx/cyclonedx-npm \
    --output-file "$SBOM_FILE" \
    --output-format json \
    --include-dev \
    2>/dev/null || echo "  CycloneDX generation had issues, trying fallback..."
elif command -v cyclonedx-npm &>/dev/null; then
  cyclonedx-npm \
    --output-file "$SBOM_FILE" \
    --output-format json \
    --include-dev \
    2>/dev/null || echo "  CycloneDX generation had issues, trying fallback..."
else
  # Fallback: manual SBOM from package.json
  echo "  Generating manual SBOM..."
  node -e "
    const fs = require('fs');
    const path = require('path');

    function readPackage(dir) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      } catch { return null; }
    }

    function collectDeps(dir, allDeps = new Map()) {
      const pkg = readPackage(dir);
      if (!pkg) return allDeps;

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, version] of Object.entries(deps)) {
        if (!allDeps.has(name)) {
          allDeps.set(name, { name, version, source: pkg.name || 'root' });
        }
      }

      // Recurse into workspace packages
      if (pkg.workspaces) {
        for (const ws of [].concat(pkg.workspaces)) {
          const wsDir = path.join(dir, ws.replace('/*', ''));
          if (fs.existsSync(wsDir)) {
            collectDeps(wsDir, allDeps);
          }
        }
      }

      return allDeps;
    }

    const allDeps = collectDeps('$PROJECT_ROOT');
    const sbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.4',
      serialNumber: 'urn:uuid:' + Date.now(),
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [{ name: 'kairo-sbom-generator', version: '1.0.0' }],
        component: {
          type: 'application',
          name: 'kairo-ide',
          version: readPackage('$PROJECT_ROOT')?.version || '0.1.0',
        },
      },
      components: Array.from(allDeps.values()).map(d => ({
        type: 'library',
        name: d.name,
        version: d.version || 'unknown',
      })),
    };

    fs.writeFileSync('$SBOM_FILE', JSON.stringify(sbom, null, 2));
    console.log('  Components: ' + sbom.components.length);
  "
fi

echo "  SBOM saved: $SBOM_FILE"
echo ""

# ── 2. Go dependencies (if Go agent exists) ────────────────────────────
if [ -f "$PROJECT_ROOT/go.mod" ]; then
  echo "[2/3] Generating Go dependencies SBOM..."

  GO_SBOM="${REPORT_DIR}/sbom-go-${TIMESTAMP}.json"

  cd "$PROJECT_ROOT"

  if command -v go &>/dev/null; then
    # Generate Go dependency list
    go list -m -json all > "$REPORT_DIR/.go-deps.json" 2>/dev/null || true

    if [ -s "$REPORT_DIR/.go-deps.json" ]; then
      node -e "
        const fs = require('fs');
        const content = fs.readFileSync('$REPORT_DIR/.go-deps.json', 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        const modules = [];
        let current = {};
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.Path) {
              modules.push({
                type: 'library',
                name: obj.Path,
                version: obj.Version || 'unknown',
                purl: 'pkg:golang/' + obj.Path + (obj.Version ? '@' + obj.Version : ''),
              });
            }
          } catch {}
        }

        const sbom = {
          bomFormat: 'CycloneDX',
          specVersion: '1.4',
          serialNumber: 'urn:uuid:' + Date.now(),
          version: 1,
          metadata: {
            timestamp: new Date().toISOString(),
            component: { type: 'application', name: 'kairo-go-agent', version: '1.0.0' },
          },
          components: modules,
        };

        fs.writeFileSync('$GO_SBOM', JSON.stringify(sbom, null, 2));
        console.log('  Go modules: ' + modules.length);
      "
    fi

    rm -f "$REPORT_DIR/.go-deps.json"
  fi

  echo "  Go SBOM saved: $GO_SBOM"
  echo ""
fi

# ── 3. Environment info ────────────────────────────────────────────────
echo "[3/3] Recording build environment..."

ENV_FILE="${REPORT_DIR}/build-environment-${TIMESTAMP}.json"

node -e "
  const fs = require('fs');
  const os = require('os');
  const info = {
    timestamp: new Date().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1) + ' GB',
    user: os.userInfo().username,
  };
  fs.writeFileSync('$ENV_FILE', JSON.stringify(info, null, 2));
  console.log('  Environment info saved: $ENV_FILE');
"

echo ""

# ── Summary ────────────────────────────────────────────────────────────
echo "============================================"
echo "  SBOM Generation Complete"
echo "============================================"
echo "  npm SBOM:     $SBOM_FILE"
if [ -f "$PROJECT_ROOT/go.mod" ]; then
  echo "  Go SBOM:      ${REPORT_DIR}/sbom-go-${TIMESTAMP}.json"
fi
echo "  Environment:  $ENV_FILE"
echo ""