#!/usr/bin/env bash
# Real end-to-end test of the Kairo IDE runtime:
#   1. Build legacy-sample
#   2. Deploy the webapp
#   3. Start real Tomcat 6
#   4. Verify HTTP requests
#   5. Modify a file and verify the change
#   6. Stop Tomcat
#
# This is the smoke test the user demanded: real processes, real
# HTTP, no fake.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <port>" >&2
  exit 1
fi
PORT="$1"

# Tear down any previous agent + tomcat from this script.
pkill -f kairo-runtime 2>/dev/null || true
sleep 0.3
# Force-free the test port. `xargs -r` is GNU-only; macOS BSD
# xargs doesn't support it and would invoke `kill` with no args
# (which sends SIGTERM to the calling shell). Filter explicitly.
lsof -ti :"$PORT" 2>/dev/null | grep -E '^[0-9]+$' | xargs kill -9 2>/dev/null || true

# Fresh state.
ROOT="/tmp/kairo-e2e-${PORT}"
# Prefer mavis-trash if available (dev environment convenience),
# but fall back to rm -rf so this script runs on any machine.
if command -v mavis-trash >/dev/null 2>&1; then
  mavis-trash "$ROOT" 2>/dev/null || true
else
  rm -rf "$ROOT" 2>/dev/null || true
fi
mkdir -p "$ROOT"

# Resolve repo root from the script location so this runs on
# any developer's machine, not just the original author's.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/runtime-agent"

KAIRO_DATA_DIR="$ROOT/data" \
KAIRO_TOMCAT6_HOME="${KAIRO_TOMCAT6_HOME:-/tmp/tomcat6-home/apache-tomcat-6.0.53}" \
  ./bin/kairo-runtime --bind 127.0.0.1 --port "$PORT" > "$ROOT/agent.log" 2>&1 &
AGENT_PID=$!
trap 'kill $AGENT_PID 2>/dev/null || true' EXIT INT TERM
sleep 2

DEPLOY_OUT="$ROOT/webapp"
BUILD_OUT="$ROOT/build-out"
mkdir -p "$DEPLOY_OUT" "$BUILD_OUT"

# Copy the repo fixture to a temp directory so we never modify
# the source tree. All destructive operations happen under ROOT.
SRC_LEGACY="$REPO_ROOT/legacy-sample"
LEGACY="$ROOT/legacy-sample"
rm -rf "$LEGACY"
cp -R "$SRC_LEGACY" "$LEGACY"

echo "[1/6] build"
BUILD_RESP=$(curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/builds" -H "Content-Type: application/json" \
  -d "{\"requestId\":\"b1\",\"payload\":{\"projectRoot\":\"${LEGACY}\",\"sourceLevel\":\"8\",\"targetLevel\":\"8\",\"outputDir\":\"${BUILD_OUT}\",\"classpath\":[\"${LEGACY}/lib/javax.servlet-api-4.0.1.jar\"]}}")
BUILD_ID=$(echo "$BUILD_RESP" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin)['payload']['id'])")
echo "  build id: $BUILD_ID"
# Poll for completion
for i in 1 2 3 4 5 6 7 8 9 10; do
  STATE=$(curl -fsS "http://127.0.0.1:${PORT}/api/v1/builds/${BUILD_ID}" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin)['payload']['state'])")
  if [ "$STATE" = "success" ] || [ "$STATE" = "failed" ]; then
    break
  fi
  sleep 0.3
done
echo "  build: state=$STATE"
ls -la $BUILD_OUT/com/example/legacy/ 2>&1 | head -5

echo "[2/6] deploy"
deploy() {
  curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/deployments" -H "Content-Type: application/json" \
    -d "{\"requestId\":\"$1\",\"payload\":{\"projectId\":\"p1\",\"source\":\"$2\",\"target\":\"$3\"}}" \
    | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin)['payload']; print(f'  deploy: state={d[\"state\"]} added={d[\"filesAdded\"]} modified={d[\"filesModified\"]} bytes={d[\"bytes\"]}')"
}
deploy d1 "${LEGACY}/WebRoot" "${DEPLOY_OUT}"
deploy d2 "${BUILD_OUT}" "${DEPLOY_OUT}/WEB-INF/classes"
deploy d3 "${LEGACY}/src/main/resources" "${DEPLOY_OUT}/WEB-INF/classes"
deploy d4 "${LEGACY}/lib" "${DEPLOY_OUT}/WEB-INF/lib"

echo "[3/6] start Tomcat 6"
SRV=$(curl -fsS -X POST "http://127.0.0.1:${PORT}/api/v1/servers" -H "Content-Type: application/json" \
  -d "{\"requestId\":\"s1\",\"payload\":{\"projectId\":\"p1\",\"webappDir\":\"${DEPLOY_OUT}\",\"contextPath\":\"/kairo\"}}")
HTTP_PORT=$(echo "$SRV" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin)['payload']['ports']['http'])")
SRV_ID=$(echo "$SRV" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin)['payload']['id'])")
echo "  Tomcat on $HTTP_PORT (id=$SRV_ID)"

echo "[4/6] HTTP smoke test"
PASS=0
FAIL=0
for path in "/kairo/hello?name=Kairo" "/kairo/i18n" "/kairo/hello.jsp" "/kairo/utf8.jsp"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${HTTP_PORT}${path}")
  if [ "$STATUS" = "200" ]; then
    PASS=$((PASS+1))
    echo "  PASS  ${STATUS}  ${path}"
  else
    FAIL=$((FAIL+1))
    echo "  FAIL  ${STATUS}  ${path}"
  fi
done
echo "  summary: $PASS passed, $FAIL failed"

echo "[5/6] static sync (modify JSP)"
# Modify hello.jsp
/usr/bin/python3 -c "
old = open('${LEGACY}/WebRoot/hello.jsp','rb').read()
new = old.replace(b'<title>\xc4\xe3\xba\xc3\xa3\xacKairo</title>', b'<title>CHANGED!</title>')
open('${LEGACY}/WebRoot/hello.jsp','wb').write(new)
"
deploy d5 "${LEGACY}/WebRoot/hello.jsp" "${DEPLOY_OUT}/hello.jsp"
# Force Tomcat to re-read by touching web.xml
touch "${DEPLOY_OUT}/WEB-INF/web.xml"
sleep 1
RES=$(curl -s "http://127.0.0.1:${HTTP_PORT}/kairo/hello.jsp")
if echo "$RES" | grep -q "CHANGED"; then
  echo "  PASS  static sync: change visible in HTTP response"
else
  echo "  FAIL  static sync: change not visible"
  FAIL=$((FAIL+1))
fi

echo "[6/6] stop Tomcat"
curl -fsS -X DELETE "http://127.0.0.1:${PORT}/api/v1/servers/${SRV_ID}" -H "Content-Type: application/json" -d '{}' > /dev/null
echo "  stopped"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
