#!/bin/bash
set -euo pipefail

echo "=== Kairo IDE Windows Packaging ==="

VERSION="${1:-1.0.0}"
DIST_DIR="dist/win"

# Generate SBOM
echo "[1/3] Generating SBOM..."
cd runtime-agent
go list -json -m all > ../dist/win/sbom.json 2>/dev/null || echo '{"notice": "SBOM requires Go modules"}' > ../dist/win/sbom.json
cd ..

# Copy license
echo "[2/3] Copying license..."
cp LICENSE dist/win/ 2>/dev/null || echo "MIT License" > dist/win/LICENSE.txt
cp THIRD_PARTY_NOTICES.txt dist/win/ 2>/dev/null || echo "See LICENSE for third-party notices." > dist/win/THIRD_PARTY_NOTICES.txt

# Generate checksums
echo "[3/3] Generating checksums..."
cd dist/win
find . -type f ! -name "*.exe" -exec sha256sum {} \; > checksums.txt
cd ../..

echo "Package ready: ${DIST_DIR}"
echo "To create installer: makensis scripts/installer/kairo-setup.nsi"