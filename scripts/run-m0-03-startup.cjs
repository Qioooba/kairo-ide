// M0-03 — real startup verification (release gate, KAIRO-RC-WEB-003 retest).
//
// Verifies, on a real headed Chromium against a real stack:
//   1. Agent + web listen on 127.0.0.1 only (no 0.0.0.0 exposure).
//   2. /api/v1/health is healthy; shell becomes interactive;
//      Runtime status goes connecting -> connected (no infinite loading).
//   3. Status bar shows "Project: (no workspace)" (retest of the
//      WEB-FLOW-01 failure KAIRO-RC-WEB-003).
//   4. Page reload recovers to connected.
//   5. Killing the agent flips the UI to disconnected with the shell
//      still interactive; restarting the agent auto-reconnects.
//   6. No pageerror / console error noise (whitelist must be justified).
//
// Usage: KAIRO_QA_ROOT=/tmp/... node scripts/run-m0-03-startup.cjs
// Exit 0 only when every check passes.

'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  REPO_ROOT, startStack, stopStack, agentGet, launchBrowser, openPage,
  dismissTrustDialog, screenshot, getStatusBarText, waitForStatusBarContains,
  writeResult, writeLogs, ensureDir, nowIso, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'm0-03'));
const SHOTS = ensureDir(path.join(OUT, 'screenshots'));
const HARD_CAP_MS = 8 * 60 * 1000;

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail: detail || '', time: nowIso() });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
  if (!ok) {
    const err = new Error(`${id}: ${detail || 'check failed'}`);
    err.checkId = id;
    throw err;
  }
}

function listenAddrs(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN || true`, { encoding: 'utf8' });
    return out.split('\n').filter(l => l.includes('LISTEN')).map(l => l.trim());
  } catch (_e) {
    return [];
  }
}

async function main() {
  const t0 = Date.now();
  // 1. Start the stack with the agent pinned to the dev-default port
  //    (the browser frontend defaults to 127.0.0.1:18080 — KAIRO-RC-WEB-015).
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'm0-03-stack'), port: 18080 });
  const env = stack.env;
  const agentPort = env.KAIRO_QA_AGENT_PORT;
  const webPort = env.KAIRO_QA_WEB_PORT;
  const webUrl = `http://127.0.0.1:${webPort}/`;
  record('M0-03.start', true, `agent=${agentPort} web=${webPort} dataDir=${stack.dataDir}`);

  // 2. Loopback-only listeners
  for (const [name, port] of [['agent', agentPort], ['web', webPort]]) {
    const lines = listenAddrs(port);
    const bad = lines.filter(l => !l.includes('127.0.0.1:'));
    record(`M0-03.loopback.${name}`, lines.length > 0 && bad.length === 0,
      bad.length ? `non-loopback listener: ${bad.join(' | ')}` : `only 127.0.0.1:${port}`);
  }

  // 3. Health endpoint
  const health = await agentGet(env, '/api/v1/health');
  record('M0-03.health', health.ok, `status=${health.status}`);

  // 4. Headed Chromium: shell interactive + connecting -> connected
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  const sb = await waitForStatusBarContains(page, 'Runtime: connected', 90000);
  record('M0-03.connected', true, 'status bar reached "Runtime: connected"');
  record('M0-03.project-empty', sb.includes('Project: (no workspace)'),
    'status bar must show "Project: (no workspace)" on cold start (KAIRO-RC-WEB-003)');
  await screenshot(page, path.join(SHOTS, '01-shell-connected.png'));

  // 5. Reload recovery
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);
  record('M0-03.reload-recovers', true, 'reconnected after reload');
  await screenshot(page, path.join(SHOTS, '02-after-reload.png'));

  // 6. Kill agent -> disconnected, shell stays interactive
  const agentPid = Number(env.KAIRO_QA_AGENT_PID);
  try { process.kill(agentPid, 'SIGKILL'); } catch (_e) { /* already dead */ }
  await waitForStatusBarContains(page, 'Runtime: disconnected', 60000);
  const shellAlive = await page.evaluate(() => {
    const shell = document.getElementById('theia-app-shell');
    const sb2 = document.getElementById('theia-statusBar');
    return Boolean(shell && sb2 && (sb2.textContent || '').length > 0);
  });
  record('M0-03.disconnected-state', shellAlive, 'status bar shows disconnected; shell still rendered (no infinite loading)');
  await screenshot(page, path.join(SHOTS, '03-disconnected.png'));

  // 7. Restart agent -> auto-reconnect
  const agentLog = path.join(OUT, 'agent-restart.log');
  const logFd = fs.openSync(agentLog, 'a');
  const agentBin = path.join(REPO_ROOT, 'runtime-agent', 'bin', 'kairo-runtime');
  const agentProc = spawn(agentBin, ['--config', env.KAIRO_QA_AGENT_CONFIG], { stdio: ['ignore', logFd, logFd] });
  agentProc.unref();
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);
  record('M0-03.reconnect', true, `agent restarted (pid ${agentProc.pid}), UI auto-reconnected`);
  await screenshot(page, path.join(SHOTS, '04-reconnected.png'));

  // 8. Console / pageerror gate
  const logs = page._kairoLogs || [];
  writeLogs(OUT, logs);
  // Justified whitelist (narrow, case-specific):
  //  - WS ERR_CONNECTION_REFUSED to the agent during the DELIBERATE
  //    agent-kill window of this test (steps 6-7); reconnect noise is
  //    the expected product behavior, not a defect.
  //  Everything else (pageerror, error, requestfailed, http>=400) fails.
  const agentDownNoise = l =>
    l.type === 'error' &&
    l.text.includes('WebSocket') &&
    l.text.includes('127.0.0.1:18080') &&
    l.text.includes('ERR_CONNECTION_REFUSED');
  const errors = logs.filter(l =>
    (l.type === 'pageerror' || l.type === 'error' || l.type === 'requestfailed' || /^http/.test(l.type)) &&
    !agentDownNoise(l));
  record('M0-03.console-clean', errors.length === 0,
    errors.length ? `${errors.length} console/page errors, first: ${JSON.stringify(errors[0]).slice(0, 300)}` : 'no console/page errors (WS noise during deliberate agent kill whitelisted)');

  await browser.close();
  await stopStack(stack.dataDir);
  record('M0-03.teardown', true, `stack stopped, elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const hardCap = setTimeout(() => {
  console.error('M0-03 HARD CAP exceeded — aborting');
  process.exit(2);
}, HARD_CAP_MS);

main()
  .then(() => {
    clearTimeout(hardCap);
    writeResult(OUT, { case: 'M0-03', status: 'PASS', checks, commit: execSync('git rev-parse HEAD').toString().trim() });
    process.exit(0);
  })
  .catch(err => {
    clearTimeout(hardCap);
    console.error(err);
    writeResult(OUT, { case: 'M0-03', status: 'FAIL', error: String(err), checks });
    process.exit(1);
  });
