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

# SHA-256 of the official archive. Apache publishes the hash
# alongside the binary at $URL.sha256 for modern releases; for
# 6.0.53 (2017) only .md5/.asc were published, so we can't rely
# on a downloadable .sha256. Instead the operator must supply
# the verified value via KAIRO_TOMCAT6_SHA256 (verified against
# the Apache KEYS file out-of-band).
#
# The previous hard-coded value was 65 hex chars — invalid as a
# SHA-256 (must be exactly 64) and clearly a placeholder.
# Refuse to run until a real hash is supplied.
EXPECTED_SHA256="${KAIRO_TOMCAT6_SHA256:-}"

if [ -z "$EXPECTED_SHA256" ]; then
  echo "ERROR: KAIRO_TOMCAT6_SHA256 is not set." >&2
  echo "Apache Tomcat 6.0.53 was released before .sha256 files" >&2
  echo "were published alongside binaries. Verify the archive" >&2
  echo "against the Apache KEYS file and set KAIRO_TOMCAT6_SHA256" >&2
  echo "in your environment (or scripts/.env) before running this script." >&2
  echo "  Example: KAIRO_TOMCAT6_SHA256=<64-hex-chars> $0" >&2
  exit 1
fi

# Defense in depth: reject malformed hashes early rather than
# letting `shasum` produce a confusing mismatch message.
if ! echo "$EXPECTED_SHA256" | grep -qE '^[0-9a-fA-F]{64}$'; then
  echo "ERROR: KAIRO_TOMCAT6_SHA256 must be exactly 64 hex chars (got ${#EXPECTED_SHA256})." >&2
  exit 1
fi

if [ ! -f "$TARGET" ]; then
  echo "Downloading $URL"
  curl -fL --retry 3 -o "$TARGET" "$URL"
fi

ACTUAL=$(shasum -a 256 "$TARGET" | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED_SHA256" ]; then
  echo "ERROR: SHA-256 mismatch."
  echo "  expected: $EXPECTED_SHA256"
  echo "  actual:   $ACTUAL"
  echo "Refusing to use a tampered archive. Re-verify the expected"
  echo "value against the Apache KEYS file."
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
