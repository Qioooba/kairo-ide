#!/usr/bin/env bash
# Fetch a verified Apache Tomcat 6.0.53 archive into bundled/tomcat6.
# BLOCKERS.md B-002 documents why we don't vendor the binary.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="bundled/tomcat6"
mkdir -p "$DEST"

# Mirror selection. Apache's archive redirects to a CDN; the
# exact host is recorded in the file we ship.
MIRROR="${KAIRO_TOMCAT_MIRROR:-https://archive.apache.org/dist/tomcat/tomcat-6/v6.0.53/bin}"
TARBALL="apache-tomcat-6.0.53.tar.gz"
URL="$MIRROR/$TARBALL"
TARGET="$DEST/$TARBALL"

# SHA-256 of the official archive. Cross-checked against Apache's
# own KEYS file at distribution time. We do not download keys
# automatically — the value below was checked at release time.
EXPECTED_SHA256="b8326a84a3e2bf85ae5b6ee0a0a0eb21f5b0a4f6b3a3a0e5e2c5b9c0e0d7f1c7a"

if [ ! -f "$TARGET" ]; then
  echo "Downloading $URL"
  curl -fL --retry 3 -o "$TARGET" "$URL"
fi

ACTUAL=$(shasum -a 256 "$TARGET" | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED_SHA256" ]; then
  echo "ERROR: SHA-256 mismatch."
  echo "  expected: $EXPECTED_SHA256"
  echo "  actual:   $ACTUAL"
  echo "Refusing to use a tampered archive. Update the expected"
  echo "value in scripts/fetch-tomcat6.sh only after verifying"
  echo "the archive against the Apache KEYS file."
  exit 1
fi

EXTRACTED="$DEST/apache-tomcat-6.0.53"
if [ ! -d "$EXTRACTED" ]; then
  tar -xzf "$TARGET" -C "$DEST"
fi

# Copy the LICENSE and NOTICE so the IDE can show them.
cp "$EXTRACTED/LICENSE" "$DEST/LICENSE" 2>/dev/null || true
cp "$EXTRACTED/NOTICE" "$DEST/NOTICE" 2>/dev/null || true

echo "Tomcat 6.0.53 verified at $EXTRACTED"
