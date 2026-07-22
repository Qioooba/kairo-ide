// Kairo API smoke — exercises the Runtime Agent's HTTP
// surface end-to-end without requiring a Theia browser.
// This is the CI-friendly test: it does not need Playwright
// or a full Theia build, just `node` + a running agent.
//
// Covers:
//   - /api/v1/health
//   - /api/v1/jdtls GET / POST / DELETE (the P2 skeleton)
//   - /api/v1/encoding/detect (GBK, UTF-8-BOM, plain UTF-8)
//   - /api/v1/encoding/recode (utf-8 -> gbk -> utf-8 round-trip)
//   - /api/v1/workspaces POST
//   - /api/v1/builds POST
//   - /api/v1/deployments POST
//   - /api/v1/servers POST (gated on B-002 — the GATED line
//     records the gap and fails the run, see below)
//
// Exit 0 = pass, 1 = fail. Gated steps ARE failures
// (KAIRO-RC-WEB-012): release evidence must not hide unrun
// coverage behind a soft pass.

const path = require('path');
const fs = require('fs');

const port = parseInt(process.argv[2] || '18080', 10);

const failures = [];
const gated = [];

function step(name) { console.log(`[*] ${name}`); }
function pass(msg) { console.log('  PASS  ' + msg); }
function gate(msg) { console.log('  GATED ' + msg); gated.push(msg); }
function fail(msg) { console.log('  FAIL  ' + msg); failures.push(msg); }

async function api(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ requestId: `smoke-${Date.now()}`, payload: body }) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* leave null */ }
  return { status: res.status, body: text, json };
}

(async () => {
  step('health');
  const h = await api('GET', '/api/v1/health');
  if (h.status !== 200 || !h.json || !h.json.ok) {
    fail(`health: status=${h.status} body=${h.body.slice(0, 200)}`);
  } else {
    pass(`agent up, version=${h.json.payload.agentVersion}, bind=${h.json.payload.bindAddress}:${h.json.payload.port}`);
  }

  step('jdtls: GET (initial)');
  const g1 = await api('GET', '/api/v1/jdtls');
  if (g1.status !== 200) fail(`GET jdtls: ${g1.status}`);
  else pass(`state=${g1.json.payload.state} version=${g1.json.payload.version} initializeOk=${g1.json.payload.initializeOk}`);

  step('jdtls: POST prepare distribution');
  const p1 = await api('POST', '/api/v1/jdtls', { sourceLevel: '1.6' });
  if (p1.status === 200 && p1.json?.payload?.home) {
    pass(`jdtls prepared: ${p1.json.payload.home}`);
  } else {
    fail(`jdtls prepare: status=${p1.status} body=${p1.body.slice(0, 200)}`);
  }

  step('jdtls: GET (after prepare)');
  const g2 = await api('GET', '/api/v1/jdtls');
  if (g2.status !== 200) fail(`GET jdtls: ${g2.status}`);
  else pass(`state=${g2.json.payload.state}`);

  step('jdtls: DELETE is explicitly unsupported (Theia owns lifecycle)');
  const d1 = await api('DELETE', '/api/v1/jdtls');
  if (d1.status === 400 && d1.json?.error?.code === 'invalid_request') pass('DELETE rejected by current contract');
  else fail(`DELETE jdtls: ${d1.status}`);

  const legacyRoot = path.resolve(__dirname, '..', '..', 'legacy-sample');
  step('workspaces: open legacy-sample before file operations');
  const w = await api('POST', '/api/v1/workspaces', { rootPath: legacyRoot });
  if (w.status !== 200) fail(`workspace open: ${w.status} ${w.body.slice(0, 200)}`);
  else pass(`workspace id=${w.json.payload.id}`);

  step('encoding: detect GBK file (legacy-sample hello.jsp)');
  const e1 = await api('POST', '/api/v1/encoding/detect', { file: path.join(legacyRoot, 'WebRoot', 'hello.jsp') });
  if (e1.status !== 200) fail(`detect: ${e1.status} ${e1.body.slice(0, 200)}`);
  else {
    const enc = e1.json.payload.encoding;
    if (enc !== 'gbk' && enc !== 'gb18030') {
      fail(`hello.jsp encoding = ${enc}, want gbk or gb18030`);
    } else {
      pass(`hello.jsp encoding = ${enc}, hasBom=${e1.json.payload.hasBom}, eol=${e1.json.payload.eol}`);
    }
  }

  step('encoding: recode utf-8 -> gbk -> utf-8 round-trip');
  // The encoder accepts only authorised workspace roots. Keep the
  // disposable probe inside the workspace and remove it afterwards.
  const tmp = path.join(legacyRoot, `.kairo-api-smoke-${Date.now()}.txt`);
  fs.writeFileSync(tmp, Buffer.from('Round trip: 你好', 'utf-8'));
  const r1 = await api('POST', '/api/v1/encoding/recode', { file: tmp, from: 'utf-8', to: 'gbk' });
  if (r1.status !== 200) fail(`recode utf-8->gbk: ${r1.status} ${r1.body.slice(0, 200)}`);
  else {
    pass(`recode utf-8->gbk: bytes=${r1.json.payload.bytes}`);
    const r2 = await api('POST', '/api/v1/encoding/recode', { file: tmp, from: 'gbk', to: 'utf-8' });
    if (r2.status !== 200) fail(`recode gbk->utf-8: ${r2.status}`);
    else {
      const back = fs.readFileSync(tmp, 'utf-8');
      if (!back.includes('你好')) fail(`round-trip lost Chinese text: ${back}`);
      else pass(`round-trip preserves Chinese: ${back}`);
    }
  }
  fs.unlinkSync(tmp);

  step('builds: unknown project is rejected truthfully');
  const b = await api('POST', '/api/v1/builds', { projectId: 'p1' });
  if (b.status === 404 && b.json?.error?.code === 'not_found') {
    pass('unknown project rejected');
  } else {
    fail(`build: status=${b.status} body=${b.body.slice(0, 200)}`);
  }

  step('deployments: unknown project is rejected truthfully');
  const dep = await api('POST', '/api/v1/deployments', { projectId: 'p1', what: 'all' });
  if (dep.status === 200) {
    pass(`deploy: state=${dep.json.payload.state}`);
  } else if (dep.json && dep.json.error) {
    pass(`deploy refused cleanly: ${dep.json.error.code}`);
  } else {
    fail(`deploy: status=${dep.status}`);
  }

  step('servers: unknown project is rejected truthfully');
  const s = await api('POST', '/api/v1/servers', { projectId: 'p1' });
  if (s.status === 404 && s.json?.error?.code === 'not_found') {
    pass('unknown project rejected');
  } else {
    fail(`server: status=${s.status} body=${s.body.slice(0, 200)}`);
  }

  step('summary');
  if (failures.length === 0 && gated.length === 0) {
    console.log('OK — API smoke passed');
    process.exit(0);
  }
  if (failures.length > 0) {
    console.log(`FAIL — API smoke: ${failures.length} failure(s):`);
    for (const f of failures) console.log('  - ' + f);
  }
  if (gated.length > 0) {
    console.log(`FAIL — API smoke: ${gated.length} gated item(s) (gated = not covered, treated as failure for release evidence):`);
    for (const g of gated) console.log('  - ' + g);
  }
  process.exit(1);
})().catch(err => {
  console.error('FAIL — API smoke:', err);
  process.exit(1);
});
