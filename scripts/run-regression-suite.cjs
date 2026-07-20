#!/usr/bin/env node
// Kairo IDE macOS Web 发布候选 — M4 独立回归套件
// Usage:
//   TESTED_COMMIT=7925d26761391bd52e014400238900884c70acb3 \
//   KAIRO_QA_ROOT=/tmp/kairo-mac-web-qa-m4-XXXXXX \
//   node scripts/run-regression-suite.cjs
//
// 所有步骤带独立超时，日志与 JSON 记录写入 $KAIRO_QA_ROOT/m4/commands/。
// 最终生成 $KAIRO_QA_ROOT/m4/regression-results.json。

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, '..');
const TESTED_COMMIT = process.env.TESTED_COMMIT || '7925d26761391bd52e014400238900884c70acb3';
const KAIRO_QA_ROOT = process.env.KAIRO_QA_ROOT || fs.mkdtempSync('/tmp/kairo-mac-web-qa-m4-');
const M4_DIR = path.join(KAIRO_QA_ROOT, 'm4');
const CMD_DIR = path.join(M4_DIR, 'commands');
const LOG_DIR = path.join(M4_DIR, 'logs');
const AGENT_PORT = parseInt(process.env.KAIRO_AGENT_PORT || '18080', 10);
const THEIA_PORT = parseInt(process.env.KAIRO_THEIA_PORT || '3000', 10);
const AGENT_DATA_DIR = path.join(KAIRO_QA_ROOT, 'runtime-data');
const TOMCAT_HOME = process.env.KAIRO_TOMCAT6_HOME || path.join(REPO_ROOT, 'bundled/tomcat6');

fs.mkdirSync(CMD_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const results = [];
const services = [];

function now() { return Math.floor(Date.now() / 1000); }

function record(rec) {
  results.push(rec);
  const file = path.join(CMD_DIR, `${rec.id}.json`);
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
}

function logPath(id) { return path.join(LOG_DIR, `${id}.log`); }

function runCommand(id, name, cmd, args, opts = {}) {
  const timeout = opts.timeout || 30000;
  const cwd = opts.cwd || REPO_ROOT;
  const env = { ...process.env, ...opts.env };
  const logFile = logPath(id);
  const out = fs.openSync(logFile, 'a');

  return new Promise((resolve) => {
    const start = now();
    let killed = false;
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, out] });
    let timer = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        killed = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
        try { child.kill('SIGKILL'); } catch (_) {}
      }, timeout);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      try { fs.closeSync(out); } catch (_) {}
      const end = now();
      resolve({ id, name, start, end, elapsed: end - start, exitCode: 1, error: err.message, log: logFile });
    });

    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      try { fs.closeSync(out); } catch (_) {}
      const end = now();
      const exitCode = killed ? 124 : (signal ? 128 + (signal === 'SIGTERM' ? 15 : 9) : code);
      resolve({ id, name, start, end, elapsed: end - start, exitCode, log: logFile });
    });
  });
}

async function shellStep(id, name, script, opts = {}) {
  const rec = await runCommand(id, name, 'bash', ['-c', script], { ...opts, timeout: opts.timeout || 60000 });
  record(rec);
  return rec;
}

async function pnpmStep(id, name, args, opts = {}) {
  const rec = await runCommand(id, name, 'pnpm', args, opts);
  record(rec);
  return rec;
}

async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function killTree(pid) {
  try { process.kill(-pid, 'SIGTERM'); } catch (_) {}
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch (_) {}
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }, 2000);
}

async function stopAll() {
  for (const s of services) killTree(s.pid);
  await new Promise(r => setTimeout(r, 2500));
  for (const port of [AGENT_PORT, THEIA_PORT, AGENT_PORT + 1]) {
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t']);
      const pids = stdout.trim().split(/\s+/).filter(Boolean);
      for (const p of pids) { try { process.kill(parseInt(p, 10), 'SIGKILL'); } catch (_) {} }
    } catch (_) {}
  }
}

function spawnService(id, name, cmd, args, opts = {}) {
  const cwd = opts.cwd || REPO_ROOT;
  const env = { ...process.env, ...opts.env };
  const logFile = logPath(id);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, out], detached: true });
  services.push(child);
  return child;
}

async function startAgent(id) {
  const bin = path.join(REPO_ROOT, 'runtime-agent', 'bin', 'kairo-runtime');
  const start = now();
  if (!fs.existsSync(bin)) {
    const rec = { id, name: 'start kairo-runtime', start, end: now(), elapsed: 0, exitCode: 1, note: 'BLOCKED: kairo-runtime binary missing (agent build failed)', log: logPath(id) };
    record(rec);
    return rec;
  }
  spawnService(id, 'start kairo-runtime', bin, [
    '--bind', '127.0.0.1',
    '--port', String(AGENT_PORT),
    '--data-dir', AGENT_DATA_DIR,
  ], { env: { KAIRO_DATA_DIR: AGENT_DATA_DIR } });
  const healthy = await waitForUrl(`http://127.0.0.1:${AGENT_PORT}/api/v1/health`, 30000);
  const end = now();
  const rec = { id, name: 'start kairo-runtime', start, end, elapsed: end - start, exitCode: healthy ? 0 : 1, note: healthy ? 'healthy' : 'not healthy', log: logPath(id) };
  record(rec);
  return rec;
}

async function startTheia(id) {
  const start = now();
  spawnService(id, 'start theia browser', 'pnpm', [
    '--filter', '@kairo/browser', 'exec', 'theia', 'start', '/tmp/kairo-workspace',
    '--hostname=127.0.0.1', '--port=' + THEIA_PORT, '--log-level=debug'
  ]);
  const ready = await waitForUrl(`http://127.0.0.1:${THEIA_PORT}/`, 60000);
  const end = now();
  const rec = { id, name: 'start theia browser', start, end, elapsed: end - start, exitCode: ready ? 0 : 1, note: ready ? 'http 200' : 'not ready', log: logPath(id) };
  record(rec);
  return rec;
}

async function apiCall(method, path_, body) {
  const url = `http://127.0.0.1:${AGENT_PORT}${path_}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ requestId: 'm4-' + Date.now(), payload: body }) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: text, json };
}

function writeSummary() {
  const summary = {
    testedCommit: TESTED_COMMIT,
    kairosQaRoot: KAIRO_QA_ROOT,
    generatedAt: new Date().toISOString(),
    total: results.length,
    pass: results.filter(r => r.exitCode === 0).length,
    fail: results.filter(r => r.exitCode !== 0 && (!r.note || !r.note.includes('BLOCKED'))).length,
    blocked: results.filter(r => r.note && r.note.includes('BLOCKED')).length,
    results,
  };
  fs.writeFileSync(path.join(M4_DIR, 'regression-results.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== M4 Regression Summary ===');
  console.log(`PASS=${summary.pass} FAIL=${summary.fail} BLOCKED=${summary.blocked} TOTAL=${summary.total}`);
  for (const r of results) {
    const status = r.exitCode === 0 ? 'PASS' : (r.note && r.note.includes('BLOCKED') ? 'BLOCKED' : 'FAIL');
    console.log(`  ${status}  ${r.id}  (${r.elapsed}s)${r.note ? ' — ' + r.note : ''}`);
  }
  console.log(`Results written to ${path.join(M4_DIR, 'regression-results.json')}`);
}

async function main() {
  console.log(`M4 regression suite`);
  console.log(`  TESTED_COMMIT=${TESTED_COMMIT}`);
  console.log(`  KAIRO_QA_ROOT=${KAIRO_QA_ROOT}`);
  console.log(`  logs in ${LOG_DIR}`);

  try {
    // ---- environment snapshot ----
    const envScript = [
      `echo TESTED_COMMIT=${TESTED_COMMIT}`,
      `echo KAIRO_QA_ROOT=${KAIRO_QA_ROOT}`,
      'sw_vers', 'uname -m', 'node --version', 'pnpm --version', 'go version', 'java -version 2>&1',
      `git -C ${REPO_ROOT} status --short`,
      `git -C ${REPO_ROOT} rev-parse HEAD`,
      `git -C ${REPO_ROOT} log -1 --format='%H %s'`,
      `rg -n '^(<<<<<<< |=======$|>>>>>>> )' --glob '!pnpm-lock.yaml' --glob '!bundled/tomcat6/**' ${REPO_ROOT} || true`,
    ].join(' && ');
    const envRec = await shellStep('M4-ENV', 'environment snapshot', envScript, { timeout: 30000 });
    fs.writeFileSync(path.join(M4_DIR, 'environment.txt'), fs.readFileSync(logPath('M4-ENV'), 'utf8'));

    // ---- clean install / build / static gates ----
    await pnpmStep('M4-INSTALL', 'pnpm install --frozen-lockfile', ['install', '--frozen-lockfile'], { timeout: 180000 });
    await pnpmStep('M4-BUILD', 'pnpm build', ['build'], { timeout: 300000 });
    await pnpmStep('M4-TEST', 'pnpm test', ['test'], { timeout: 300000 });
    await pnpmStep('M4-LINT', 'pnpm lint', ['lint'], { timeout: 120000 });
    await pnpmStep('M4-TSC', 'pnpm -r --filter ./packages/* exec tsc --noEmit', ['-r', '--filter', './packages/*', 'exec', 'tsc', '--noEmit'], { timeout: 120000 });

    // ---- Go gates ----
    await shellStep('M4-GOFMT', 'gofmt check', 'cd runtime-agent && test -z "$(gofmt -l $(rg --files -g \'*.go\'))"', { timeout: 30000 });
    await shellStep('M4-GOVET', 'go vet', 'cd runtime-agent && go vet ./...', { timeout: 60000 });
    await shellStep('M4-GOTEST', 'go test', 'cd runtime-agent && go test -count=1 -timeout 300s ./...', { timeout: 360000 });
    await shellStep('M4-GOTEST-RACE', 'go test -race', 'cd runtime-agent && go test -race -count=1 -timeout 420s ./...', { timeout: 480000 });
    const agentBuild = await shellStep('M4-AGENT-BUILD', 'build kairo-runtime binary', 'cd runtime-agent && go build -trimpath -o bin/kairo-runtime ./cmd/kairo-runtime', { timeout: 120000 });

    // ---- contract / fault / perf node tests ----
    for (const f of ['tests/contract/contract.test.cjs', 'tests/contract/eventstream.test.cjs', 'tests/fault/fault-injection.test.cjs', 'tests/perf/perf-baseline.test.cjs']) {
      if (fs.existsSync(path.join(REPO_ROOT, f))) {
        const id = 'M4-' + path.basename(f, '.cjs').toUpperCase().replace(/-/g, '-');
        const rec = await runCommand(id, 'node --test ' + f, 'node', ['--test', f], { timeout: 60000 });
        record(rec);
      }
    }

    // ---- runtime-agent API smoke (no browser) ----
    if (agentBuild.exitCode !== 0) {
      for (const id of ['M4-AGENT-START', 'M4-E2E-API', 'M4-GBK-UNREP', 'M4-BUILD-FAIL-CYCLE', 'M4-SERVER-LIFECYCLE', 'M4-VERIFY-E2E', 'M4-THEIA-START', 'M4-E2E-SMOKE', 'M4-E2E-WEB', 'M4-VISUAL-WEB', 'M4-A11Y-WEB', 'M4-RUNTIME-RECONNECT']) {
        record({ id, name: id, start: now(), end: now(), elapsed: 0, exitCode: 1, note: 'BLOCKED: Runtime Agent build failed' });
      }
      return;
    }

    const agentStart = await startAgent('M4-AGENT-START');
    if (agentStart.exitCode !== 0) {
      for (const id of ['M4-E2E-API', 'M4-GBK-UNREP', 'M4-BUILD-FAIL-CYCLE', 'M4-SERVER-LIFECYCLE', 'M4-VERIFY-E2E', 'M4-THEIA-START', 'M4-E2E-SMOKE', 'M4-E2E-WEB', 'M4-VISUAL-WEB', 'M4-A11Y-WEB', 'M4-RUNTIME-RECONNECT']) {
        record({ id, name: id, start: now(), end: now(), elapsed: 0, exitCode: 1, note: 'BLOCKED: Runtime Agent did not start' });
      }
      return;
    }

    await pnpmStep('M4-E2E-API', 'pnpm test:e2e:api', ['test:e2e:api'], { timeout: 120000 });

    // ---- encoding validate: GBK unrepresentable character must be rejected ----
    const encId = 'M4-GBK-UNREP';
    const encStart = now();
    try {
      const ok = await apiCall('POST', '/api/v1/encoding/validate', { text: '你好', encoding: 'gbk' });
      const bad = await apiCall('POST', '/api/v1/encoding/validate', { text: '你好 🔥', encoding: 'gbk' });
      const okValid = ok.status === 200 && ok.json && ok.json.payload && ok.json.payload.valid === true;
      const badInvalid = bad.status === 200 && bad.json && bad.json.payload && bad.json.payload.valid === false;
      fs.writeFileSync(logPath(encId), JSON.stringify({ ok, bad }, null, 2));
      record({ id: encId, name: 'GBK unrepresentable char protection', start: encStart, end: now(), elapsed: now() - encStart, exitCode: (okValid && badInvalid) ? 0 : 1, okValid, badInvalid, log: logPath(encId) });
    } catch (err) {
      record({ id: encId, name: 'GBK unrepresentable char protection', start: encStart, end: now(), elapsed: now() - encStart, exitCode: 1, error: err.message });
    }

    // ---- build success/failure closed loop via API ----
    const buildId = 'M4-BUILD-FAIL-CYCLE';
    const buildStart = now();
    const tmpLegacy = path.join(KAIRO_QA_ROOT, 'legacy-sample');
    try {
      fs.rmSync(tmpLegacy, { recursive: true, force: true });
      fs.cpSync(path.join(REPO_ROOT, 'legacy-sample'), tmpLegacy, { recursive: true });
      const ws = await apiCall('POST', '/api/v1/workspaces', { rootPath: tmpLegacy });
      const buildGood = await apiCall('POST', '/api/v1/builds', { projectId: 'legacy', projectRoot: tmpLegacy, outputDir: path.join(KAIRO_QA_ROOT, 'build-out'), classpath: [path.join(tmpLegacy, 'lib/javax.servlet-api-4.0.1.jar')] });
      let stateGood = 'unknown';
      for (let i = 0; i < 20 && buildGood.json && buildGood.json.payload && buildGood.json.payload.id; i++) {
        const st = await apiCall('GET', `/api/v1/builds/${buildGood.json.payload.id}`);
        stateGood = st.json && st.json.payload && st.json.payload.state;
        if (stateGood === 'success' || stateGood === 'failed') break;
        await new Promise(r => setTimeout(r, 500));
      }
      const srcFile = path.join(tmpLegacy, 'src/main/java/com/example/legacy/HelloServlet.java');
      const orig = fs.readFileSync(srcFile, 'utf8');
      fs.writeFileSync(srcFile, orig.replace('class HelloServlet', 'class BrokenHelloServlet X'), 'utf8');
      const buildBad = await apiCall('POST', '/api/v1/builds', { projectId: 'legacy-broken', projectRoot: tmpLegacy, outputDir: path.join(KAIRO_QA_ROOT, 'build-out-bad'), classpath: [path.join(tmpLegacy, 'lib/javax.servlet-api-4.0.1.jar')] });
      let stateBad = 'unknown';
      for (let i = 0; i < 20 && buildBad.json && buildBad.json.payload && buildBad.json.payload.id; i++) {
        const st = await apiCall('GET', `/api/v1/builds/${buildBad.json.payload.id}`);
        stateBad = st.json && st.json.payload && st.json.payload.state;
        if (stateBad === 'success' || stateBad === 'failed') break;
        await new Promise(r => setTimeout(r, 500));
      }
      fs.writeFileSync(logPath(buildId), JSON.stringify({ stateGood, stateBad }, null, 2));
      record({ id: buildId, name: 'build success/failure closed loop', start: buildStart, end: now(), elapsed: now() - buildStart, exitCode: (stateGood === 'success' && stateBad === 'failed') ? 0 : 1, stateGood, stateBad, log: logPath(buildId) });
    } catch (err) {
      record({ id: buildId, name: 'build success/failure closed loop', start: buildStart, end: now(), elapsed: now() - buildStart, exitCode: 1, error: err.message });
    }

    // ---- server start/stop/restart lifecycle (needs Tomcat 6 binary) ----
    const srvId = 'M4-SERVER-LIFECYCLE';
    const srvStart = now();
    try {
      if (!fs.existsSync(path.join(TOMCAT_HOME, 'bin/catalina.sh'))) {
        throw new Error('Tomcat 6 binary not found at ' + TOMCAT_HOME);
      }
      const depOut = path.join(KAIRO_QA_ROOT, 'webapp');
      const buildOut = path.join(KAIRO_QA_ROOT, 'build-out');
      fs.mkdirSync(depOut, { recursive: true });
      fs.cpSync(path.join(tmpLegacy, 'WebRoot'), depOut, { recursive: true, force: true });
      if (fs.existsSync(buildOut)) fs.cpSync(buildOut, path.join(depOut, 'WEB-INF/classes'), { recursive: true, force: true });
      const srv1 = await apiCall('POST', '/api/v1/servers', { projectId: 'legacy', webappDir: depOut, contextPath: '/kairo', tomcatHome: TOMCAT_HOME });
      const srv1Id = srv1.json && srv1.json.payload && srv1.json.payload.id;
      let running = false;
      for (let i = 0; i < 30 && srv1Id; i++) {
        const st = await apiCall('GET', `/api/v1/servers/${srv1Id}`);
        if (st.json && st.json.payload && st.json.payload.state === 'running') { running = true; break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!running) throw new Error('server did not reach running state');
      const restart = await apiCall('POST', `/api/v1/servers/${srv1Id}/restart`, {});
      const restartId = restart.json && restart.json.payload && restart.json.payload.id;
      let restarted = false;
      for (let i = 0; i < 30 && restartId; i++) {
        const st = await apiCall('GET', `/api/v1/servers/${restartId}`);
        if (st.json && st.json.payload && st.json.payload.state === 'running') { restarted = true; break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      await apiCall('DELETE', `/api/v1/servers/${restartId || srv1Id}`, {});
      record({ id: srvId, name: 'server start/stop/restart lifecycle', start: srvStart, end: now(), elapsed: now() - srvStart, exitCode: restarted ? 0 : 1, srv1Id, restartId, log: logPath(srvId) });
    } catch (err) {
      record({ id: srvId, name: 'server start/stop/restart lifecycle', start: srvStart, end: now(), elapsed: now() - srvStart, exitCode: 1, error: err.message, note: 'BLOCKED if Tomcat binary missing' });
    }

    // ---- verify-e2e.sh with temp fixture ----
    const veId = 'M4-VERIFY-E2E';
    const veStart = now();
    const port = AGENT_PORT + 1;
    const veEnv = { KAIRO_TOMCAT6_HOME: TOMCAT_HOME, KAIRO_DATA_DIR: path.join(KAIRO_QA_ROOT, 'verify-e2e-data') };
    const ve = await runCommand(veId, 'scripts/verify-e2e.sh', 'bash', ['scripts/verify-e2e.sh', String(port)], { cwd: REPO_ROOT, env: veEnv, timeout: 240000 });
    record({ ...ve, id: veId, name: 'scripts/verify-e2e.sh (temp fixture)', start: veStart, end: now(), elapsed: now() - veStart });

    // ---- Theia browser UI smoke (requires built browser app) ----
    const theiaStart = await startTheia('M4-THEIA-START');
    if (theiaStart.exitCode === 0) {
      await pnpmStep('M4-E2E-SMOKE', 'pnpm test:e2e:smoke', ['test:e2e:smoke'], { timeout: 120000 });
      await pnpmStep('M4-E2E-WEB', 'pnpm test:e2e:web', ['test:e2e:web'], { timeout: 180000 });
      await pnpmStep('M4-VISUAL-WEB', 'pnpm test:visual:web', ['test:visual:web'], { timeout: 120000 });
      await pnpmStep('M4-A11Y-WEB', 'pnpm test:a11y:web', ['test:a11y:web'], { timeout: 120000 });

      // ---- runtime reconnect: kill agent, restart, health back ----
      const rcId = 'M4-RUNTIME-RECONNECT';
      const rcStart = now();
      try {
        const agentChild = services.find(c => c.spawnfile && c.spawnfile.includes('kairo-runtime'));
        if (agentChild) killTree(agentChild.pid);
        await new Promise(r => setTimeout(r, 3000));
        const restartedAgent = await startAgent('M4-AGENT-RESTART');
        record({ id: rcId, name: 'runtime disconnect/reconnect', start: rcStart, end: now(), elapsed: now() - rcStart, exitCode: restartedAgent.exitCode === 0 ? 0 : 1, note: 'agent killed and restarted; browser WebSocket should reconnect' });
      } catch (err) {
        record({ id: rcId, name: 'runtime disconnect/reconnect', start: rcStart, end: now(), elapsed: now() - rcStart, exitCode: 1, error: err.message });
      }
    } else {
      for (const id of ['M4-E2E-SMOKE', 'M4-E2E-WEB', 'M4-VISUAL-WEB', 'M4-A11Y-WEB', 'M4-RUNTIME-RECONNECT']) {
        record({ id, name: id, start: now(), end: now(), elapsed: 0, exitCode: 1, note: 'BLOCKED: Theia browser did not start' });
      }
    }
  } finally {
    await stopAll();
    writeSummary();
  }
}

main().catch(async (err) => {
  console.error('M4 suite crashed:', err);
  await stopAll();
  process.exit(1);
});
