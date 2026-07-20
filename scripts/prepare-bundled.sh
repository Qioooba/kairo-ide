#!/usr/bin/env bash
# macOS/Linux equivalent of prepare-bundled.ps1.
# Ensures bundled/tomcat6/ and bundled/eclipse-jdt-ls/ exist.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLED="$REPO_ROOT/bundled"
mkdir -p "$BUNDLED"

STRICT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -Strict) STRICT=1; shift ;;
    -RepoRoot) REPO_ROOT="$2"; BUNDLED="$REPO_ROOT/bundled"; shift 2 ;;
    *) shift ;;
  esac
done

ensure_bundled_dir() {
  local name="$1"
  local target="$BUNDLED/$name"
  if [[ -d "$target" && -n "$(ls -A "$target" 2>/dev/null)" ]]; then
    echo "[bundled] $name already present at $target"
    return 0
  fi
  local resolved=""
  for src in "${@:2}"; do
    if [[ -d "$src" ]]; then
      resolved="$src"
      break
    fi
  done
  if [[ -z "$resolved" ]]; then
    echo "[bundled] WARN: $name missing — set env var or place it at one of: ${*:2}"
    return 1
  fi
  mkdir -p "$target"
  cp -R "$resolved"/. "$target/"
  echo "[bundled] OK: $name populated at $target"
  return 0
}

TOMCAT_OK=0
JDTLS_OK=0

ensure_bundled_dir "tomcat6" \
  "${KAIRO_TOMCAT6_HOME:-}" \
  "/Applications/Tomcat6/apache-tomcat-6.0.53" \
  "/opt/tomcat6/apache-tomcat-6.0.53" \
  "/usr/local/tomcat6/apache-tomcat-6.0.53" && TOMCAT_OK=1

ensure_bundled_dir "eclipse-jdt-ls" \
  "${KAIRO_JDTLS_HOME:-}" \
  "/Applications/eclipse-jdt-ls" \
  "/opt/eclipse-jdt-ls" \
  "/usr/local/eclipse-jdt-ls" && JDTLS_OK=1

if [[ $TOMCAT_OK -eq 0 || $JDTLS_OK -eq 0 ]]; then
  if [[ $STRICT -eq 1 ]]; then
    echo "[bundled] -Strict set: failing" >&2
    exit 2
  fi
  echo "[bundled] Continuing — runtime will attempt first-run download"
else
  echo "[bundled] All bundled dependencies present"
fi
exit 0
