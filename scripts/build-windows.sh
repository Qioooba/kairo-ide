#!/bin/bash
set -euo pipefail

echo "=== Kairo IDE Windows Build ==="
echo "Building for Windows 10 x64 target..."

# Build the frontend
echo "[1/4] Building frontend..."
pnpm --filter @kairo/app-desktop build

# Build the Go agent for Windows
echo "[2/4] Building Go agent for Windows..."
cd runtime-agent
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o ../dist/win/kairo-runtime.exe ./cmd/kairo-runtime/
cd ..

# Copy JRE
echo "[3/4] Preparing runtime..."
# Check for bundled JRE
if [ -d "jre/windows" ]; then
  cp -r jre/windows dist/win/jre/
fi

# Copy config files
cp config/default.yaml dist/win/

echo "[4/4] Build complete!"
echo "Output: dist/win/"
ls -la dist/win/