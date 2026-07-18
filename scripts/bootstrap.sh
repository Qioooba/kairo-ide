#!/usr/bin/env bash
# Bootstrap: install all dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

# pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm@9
fi

# Go deps (use the local toolchain; never auto-download a newer Go)
(cd runtime-agent && GOTOOLCHAIN=local go mod download)

# TS deps (may take several minutes the first time)
pnpm install --frozen-lockfile=false
echo
echo "Bootstrap complete. Run \`./scripts/verify.sh\` to run the full test loop."
