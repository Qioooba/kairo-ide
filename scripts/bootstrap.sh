#!/usr/bin/env bash
# Bootstrap: install all dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

# pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  npm install -g pnpm@9
fi

# Go deps
(cd runtime-agent && go mod download)

# TS deps (may take several minutes the first time)
pnpm install --frozen-lockfile=false
