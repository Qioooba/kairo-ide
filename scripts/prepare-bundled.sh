#!/usr/bin/env bash
# scripts/prepare-bundled.sh — ensure `bundled/tomcat6/` and
# `bundled/eclipse-jdt-ls/` exist before packaging.
#
# The Kairo IDE first-run flow expects the bundled/ directory
# to contain Tomcat 6.0.53 and Eclipse JDT Language Server.
# On a clean checkout these directories are empty; the runtime
# agent then tries to download them on first launch, which
# fails in offline / air-gapped environments. This script
# populates the directories so that packaging and the resulting
# installer ship self-contained.
#
# Sources are taken, in order, from:
#   1. KAIRO_TOMCAT6_HOME / KAIRO_JDTLS_HOME env vars
#   2. /opt/kairo/tomcat6 (project default for macOS/Linux)
#   3. /usr/local/share/kairo/tomcat6
#
# Release packaging must use --strict. In that mode the script pulls
# Tomcat 6.0.53 and Eclipse JDT LS from SHA-256 verified archives
# (configured via supply-chain-lock.json and fetched through
# fetch-verified-archive.cjs) and runs the structural verifier
# (verify-bundled-dependencies.cjs). Offline installers must never
# silently fall back to a first-run network download.
#
# Usage:
#   bash scripts/prepare-bundled.sh
#   bash scripts/prepare-bundled.sh --strict
#
# Exit codes:
#   0 — both directories exist (either pre-existing or just populated)
#   1 — pre-flight missing required tool or unsupported host
#   2 — at least one directory could not be populated and --strict was set

set -euo pipefail

STRICT=false
for arg in "$@"; do
  case "$arg" in
    --strict|-Strict|-strict) STRICT=true ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLED="$REPO_ROOT/bundled"
mkdir -p "$BUNDLED"

# Determine host platform and the corresponding supply-chain lock IDs
# (keys in scripts/supply-chain-lock.json). Only Linux and macOS are
# supported by this script; Windows uses prepare-bundled.ps1.
HOST_PLATFORM=""
TOMCAT_LOCK_ID=""
JDTLS_LOCK_ID=""
case "$(uname -s)" in
  Linux*)  HOST_PLATFORM="linux";  TOMCAT_LOCK_ID="tomcat6-linux";  JDTLS_LOCK_ID="jdtls-linux"  ;;
  Darwin*) HOST_PLATFORM="darwin"; TOMCAT_LOCK_ID="tomcat6-macos"; JDTLS_LOCK_ID="jdtls-macos" ;;
esac

# Temporary directory for verified archive downloads; cleaned up on exit.
# Populated only in --strict mode (mirrors $temporaryRoot in .ps1).
TEMPORARY_ROOT=""
cleanup_temporary_root() {
  if [ -n "$TEMPORARY_ROOT" ] && [ -d "$TEMPORARY_ROOT" ]; then
    rm -rf "$TEMPORARY_ROOT" 2>/dev/null || true
  fi
}
trap cleanup_temporary_root EXIT

resolve_source_dir() {
  local env_var="$1"
  shift
  if [ -n "${env_var:-}" ] && [ -d "$env_var" ]; then
    echo "$env_var"
    return 0
  fi
  for p in "$@"; do
    if [ -d "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

ensure_bundled_dir() {
  local name="$1"
  local resolved="$2"
  local fallback_desc="$3"
  local target="$BUNDLED/$name"
  if [ -d "$target" ] && [ "$(ls -A "$target" 2>/dev/null)" ]; then
    echo "[bundled] $name already present at $target"
    return 0
  fi
  if [ -z "$resolved" ]; then
    echo "[bundled] WARN: $name missing — set $fallback_desc" >&2
    return 1
  fi
  echo "[bundled] copying $name from $resolved -> $target"
  mkdir -p "$target"
  # Use cp -R for cross-platform directory copy; rsync would also work.
  cp -R "$resolved"/* "$target/"
  echo "[bundled] OK: $name populated at $target"
  return 0
}

# Identify the true root directory inside an extracted archive by looking
# for platform-specific marker files. Mirrors Resolve-ExtractedRoot in
# prepare-bundled.ps1: tomcat -> bin/catalina.sh, jdtls -> config_linux
# or config_mac directory containing config.ini.
resolve_extracted_root() {
  local extract_root="$1"
  local kind="$2"
  local marker
  if [ "$kind" = "tomcat" ]; then
    marker="$(find "$extract_root" -type f -name catalina.sh \
      -path "*/bin/catalina.sh" 2>/dev/null | head -n 1 || true)"
    if [ -n "$marker" ]; then
      # <root>/bin/catalina.sh -> <root>
      dirname "$(dirname "$marker")"
      return 0
    fi
  elif [ "$kind" = "jdtls" ]; then
    local config_dir=""
    case "$HOST_PLATFORM" in
      linux)  config_dir="config_linux" ;;
      darwin) config_dir="config_mac"   ;;
    esac
    if [ -n "$config_dir" ]; then
      marker="$(find "$extract_root" -type f -name config.ini \
        -path "*/$config_dir/config.ini" 2>/dev/null | head -n 1 || true)"
      if [ -n "$marker" ]; then
        # <root>/<config_dir>/config.ini -> <root>
        dirname "$(dirname "$marker")"
        return 0
      fi
    fi
  fi
  return 1
}

# Download a SHA-256 verified archive for the given lock ID, extract it,
# and echo the resolved root directory. Returns non-zero on failure.
# Mirrors Get-VerifiedArchiveSource in prepare-bundled.ps1.
get_verified_archive_source() {
  local lock_id="$1"
  local kind="$2"
  local archive="$TEMPORARY_ROOT/$lock_id.archive"
  local extract_root="$TEMPORARY_ROOT/$lock_id-extracted"
  mkdir -p "$extract_root"

  node "$REPO_ROOT/scripts/run-with-timeout.cjs" 45 node \
    "$REPO_ROOT/scripts/fetch-verified-archive.cjs" --id "$lock_id" --output "$archive"
  node "$REPO_ROOT/scripts/run-with-timeout.cjs" 60 tar -xf "$archive" -C "$extract_root"
  local resolved
  if ! resolved="$(resolve_extracted_root "$extract_root" "$kind")"; then
    echo "[bundled] FAIL: archive for $lock_id has no recognized $kind root" >&2
    return 1
  fi
  echo "$resolved"
}

# --strict pre-flight: ensure verified archive configuration exists for
# every required lock ID before we touch the bundled directory.
if [ "$STRICT" = true ]; then
  if [ -z "$HOST_PLATFORM" ]; then
    echo "[bundled] --strict unsupported on host: $(uname -s)" >&2
    exit 1
  fi
  for lock_id in "$TOMCAT_LOCK_ID" "$JDTLS_LOCK_ID"; do
    if ! node "$REPO_ROOT/scripts/run-with-timeout.cjs" 30 node \
        "$REPO_ROOT/scripts/fetch-verified-archive.cjs" --id "$lock_id" --check-config; then
      echo "[bundled] Missing verified archive configuration for $lock_id" >&2
      exit 2
    fi
  done
  TEMPORARY_ROOT="$(mktemp -d -t kairo-bundled.XXXXXX 2>/dev/null || mktemp -d 2>/dev/null)"
fi

TOMCAT_SRC="$(resolve_source_dir "${KAIRO_TOMCAT6_HOME:-}" \
  "/opt/kairo/tomcat6/apache-tomcat-6.0.53" \
  "/opt/kairo/tomcat6" \
  "/Applications/Tomcat6/apache-tomcat-6.0.53" \
  "/opt/tomcat6/apache-tomcat-6.0.53" \
  "/usr/local/tomcat6/apache-tomcat-6.0.53" \
  "/usr/local/share/kairo/tomcat6" \
  "/usr/share/tomcat6" \
  || true)"

if [ "$STRICT" = true ]; then
  if ! TOMCAT_SRC="$(get_verified_archive_source "$TOMCAT_LOCK_ID" "tomcat")"; then
    echo "[bundled] FAIL: could not prepare verified Tomcat source" >&2
    exit 2
  fi
  rm -rf "$BUNDLED/tomcat6" 2>/dev/null || true
fi

TOMCAT_OK=true
ensure_bundled_dir "tomcat6/apache-tomcat-6.0.53" "$TOMCAT_SRC" \
  "KAIRO_TOMCAT6_HOME or place it at /opt/kairo/tomcat6" || TOMCAT_OK=false

JDTLS_SRC="$(resolve_source_dir "${KAIRO_JDTLS_HOME:-}" \
  "/opt/kairo/eclipse-jdt-ls" \
  "/Applications/eclipse-jdt-ls" \
  "/opt/eclipse-jdt-ls" \
  "/usr/local/eclipse-jdt-ls" \
  "/usr/local/share/kairo/eclipse-jdt-ls" \
  "$HOME/.kairo/eclipse-jdt-ls" \
  || true)"

if [ "$STRICT" = true ]; then
  if ! JDTLS_SRC="$(get_verified_archive_source "$JDTLS_LOCK_ID" "jdtls")"; then
    echo "[bundled] FAIL: could not prepare verified JDT LS source" >&2
    exit 2
  fi
  rm -rf "$BUNDLED/jdtls" 2>/dev/null || true
fi

JDTLS_OK=true
ensure_bundled_dir "jdtls" "$JDTLS_SRC" \
  "KAIRO_JDTLS_HOME or place it at /opt/kairo/eclipse-jdt-ls" || JDTLS_OK=false

if [ "$TOMCAT_OK" != true ] || [ "$JDTLS_OK" != true ]; then
  if [ "$STRICT" = true ]; then
    echo "[bundled] --strict set: failing" >&2
    exit 2
  fi
  echo "[bundled] Continuing — runtime will attempt first-run download" >&2
else
  echo "[bundled] All bundled dependencies present"
fi

if [ "$STRICT" = true ]; then
  if ! node "$REPO_ROOT/scripts/run-with-timeout.cjs" 30 node \
      "$REPO_ROOT/scripts/verify-bundled-dependencies.cjs" \
      --platform "$HOST_PLATFORM" --bundled-root "$BUNDLED"; then
    echo "[bundled] $HOST_PLATFORM structure/version/license verification failed" >&2
    exit 2
  fi
fi
exit 0
