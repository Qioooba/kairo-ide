#!/usr/bin/env bash
# scripts/prepare-bundled.sh — ensure `bundled/tomcat6/` and
# `bundled/eclipse-jdt-ls/` exist before packaging.
#
# The Kairo IDE first-run flow expects the bundled/ directory
# to contain Tomcat 6.0.53 and Eclipse JDT Language Server.
# On a clean checkout these directories are empty; the runtime
# agent then tries to download them on first launch, which
# fails in offline / air-gapped environments. This script
# populates the directories from a known local location so
# that packaging and the resulting installer ship self-contained.
#
# Sources are taken, in order, from:
#   1. KAIRO_TOMCAT6_HOME / KAIRO_JDTLS_HOME env vars
#   2. /opt/kairo/tomcat6 (project default for macOS/Linux)
#   3. /usr/local/share/kairo/tomcat6
#
# Release packaging must use --strict. In that mode missing or structurally
# incomplete dependencies fail closed; offline installers must never silently
# fall back to a first-run network download.
#
# Usage:
#   bash scripts/prepare-bundled.sh
#   bash scripts/prepare-bundled.sh --strict
#
# Exit codes:
#   0 — both directories exist (either pre-existing or just populated)
#   1 — at least one directory could not be populated and --strict was set

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

TOMCAT_SRC="$(resolve_source_dir "${KAIRO_TOMCAT6_HOME:-}" \
  "/opt/kairo/tomcat6/apache-tomcat-6.0.53" \
  "/opt/kairo/tomcat6" \
  "/Applications/Tomcat6/apache-tomcat-6.0.53" \
  "/opt/tomcat6/apache-tomcat-6.0.53" \
  "/usr/local/tomcat6/apache-tomcat-6.0.53" \
  "/usr/local/share/kairo/tomcat6" \
  "/usr/share/tomcat6" \
  || true)"
TOMCAT_OK=true
ensure_bundled_dir "tomcat6/apache-tomcat-6.0.53" "$TOMCAT_SRC" "KAIRO_TOMCAT6_HOME or place it at /opt/kairo/tomcat6" || TOMCAT_OK=false

JDTLS_SRC="$(resolve_source_dir "${KAIRO_JDTLS_HOME:-}" \
  "/opt/kairo/eclipse-jdt-ls" \
  "/Applications/eclipse-jdt-ls" \
  "/opt/eclipse-jdt-ls" \
  "/usr/local/eclipse-jdt-ls" \
  "/usr/local/share/kairo/eclipse-jdt-ls" \
  "$HOME/.kairo/eclipse-jdt-ls" \
  || true)"
JDTLS_OK=true
ensure_bundled_dir "jdtls" "$JDTLS_SRC" "KAIRO_JDTLS_HOME or place it at /opt/kairo/eclipse-jdt-ls" || JDTLS_OK=false

if [ "$TOMCAT_OK" != true ] || [ "$JDTLS_OK" != true ]; then
  if [ "$STRICT" = true ]; then
    echo "[bundled] --strict set: failing" >&2
    exit 1
  fi
  echo "[bundled] Continuing — runtime will attempt first-run download" >&2
else
  echo "[bundled] All bundled dependencies present"
fi

if [ "$STRICT" = true ]; then
  node "$REPO_ROOT/scripts/run-with-timeout.cjs" 30 node \
    "$REPO_ROOT/scripts/verify-bundled-dependencies.cjs"
fi
exit 0
