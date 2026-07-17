#!/usr/bin/env bash
# Cross-compile the Go Runtime Agent for all supported platforms.
set -euo pipefail
cd "$(dirname "$0")/../runtime-agent"

OUT="$PWD/bin"
mkdir -p "$OUT"

build() {
  local goos="$1"
  local goarch="$2"
  local ext="$3"
  echo "  building $goos/$goarch"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' \
    -o "$OUT/kairo-runtime-$goos-$goarch$ext" ./cmd/kairo-runtime
}

build darwin  arm64 ""
build darwin  amd64 ""
build windows amd64 ".exe"
build windows arm64 ".exe"
build linux   amd64 ""
build linux   arm64 ""

echo "Built binaries:"
ls -lh "$OUT"
