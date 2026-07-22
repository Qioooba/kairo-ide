// WEB-FLOW-06 — 断线/刷新/并发（Disconnect / Refresh / Concurrency），M2.
//
// Real headed Chromium, UI-only (agent API only for pre-flight + cross-checks).
//   A. Kill agent (SIGKILL) -> status bar + Build/Server views show
//      disconnected within 30s; one action (Kairo: Build via palette)
//      produces a SINGLE understandable error, not a storm.
//   B. Restart agent -> auto-reconnect within 90s; snapshot consistent
//      (project restored); no duplicate build-list entries (WS re-sub
//      sanity).
//   C. Reload page -> state matches backend (project active again).
//      NOTE: "reload mid-build" is vacuous in this build — builds complete
//      instantly as no-ops (sham-build P0, WEB-238); recorded as such.
//   D. Second tab on the same workspace: both tabs render; behavior recorded.
//
// Usage: node scripts/run-web-flow-06.cjs [--use-existing DATA_DIR]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  REPO_ROOT, startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForSelectorVisible,
  waitForStatusBarContains, waitForStatusBarNotContains, getStatusBarText,
  agentGet, writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');
const {
  flowDirs, recordFlowResult, appendDefect, ensurePort18080, consoleGate, WL,
} = require('./m2-common.cjs');
const { importProjectViaWizard } = require('./m2-bootstrap.cjs');

const FLOW = 'WEB-FLOW-06';
const PROJECT_NAME = 'flow06-project';

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) { useExisting = args[i + 1]; i++; }
  }

  const runId = `flow06-${Date.now()}`;
  const dirs = flowDirs('flow-06');
  const OUT = dirs.flow;
  const result = {
    flow: FLOW, runId, startedAt: new Date().toISOString(),
    status: 'RUNNING', steps: [], screenshots: {}, errors: [], crossVerification: {}, blocked: [],
  };
  let stackInfo = null, browser = null, page = null, agentProc = null;

  const shot = async (name) => {
    const p = path.join(dirs.shots, `${name}.png`);
    await screenshot(page, p);
    result.screenshots[name] = p;
  };
  const logStep = (name, detail) => {
    result.steps.push({ name, time: new Date().toISOString(), detail });
    console.log(`[${new Date().toISOString()}] ${name}`, detail ? JSON.stringify(detail).slice(0, 300) : '');
  };
  const logError = (msg) => {
    result.errors.push({ time: new Date().toISOString(), message: msg });
    console.error(`  ERROR  ${msg}`);
  };
  const countNotifications = async () =>
    page.locator('.theia-Notifications .theia-Notification, [class*="notification-list"] li, .theia-notification-list-item').count();

  try {
    // ---- 1. stack + import ----------------------------------------------
    if (useExisting) {
      stackInfo = { dataDir: useExisting, env: loadEnv(useExisting) };
    } else {
      ensurePort18080();
      logStep('START_STACK');
      stackInfo = await startStack({ skipBuild: true, port: 18080 });
    }
    const env = stackInfo.env;
    const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT || 3000}/`;
    const health = await agentGet(env, '/api/v1/health', 10000);
    if (!health.ok) throw new Error(`agent health failed: ${health.status}`);
    logStep('PREFLIGHT_HEALTH_OK');

    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    await importProjectViaWizard(page, stackInfo.env.KAIRO_QA_LEGACY_DST, { name: PROJECT_NAME });
    await waitForStatusBarContains(page, 'Runtime: connected', 30000);
    logStep('SETUP_CONNECTED');

    // ---- 2. A: kill agent ------------------------------------------------
    const agentPid = parseInt(env.KAIRO_QA_AGENT_PID, 10);
    logStep('KILL_AGENT', { pid: agentPid });
    const killAt = Date.now();
    process.kill(agentPid, 'SIGKILL');
    const tDiscStart = Date.now();
    await waitForStatusBarContains(page, 'Runtime: disconnected', 30000);
    const discMs = Date.now() - tDiscStart;
    logStep('DISCONNECTED_VISIBLE', { withinMs: discMs });
    await shot('03-disconnected');

    // Build + Server views must show disconnected states
    await runCommand(page, 'Kairo: Show Builds', 20000);
    const buildDisc = await page.locator('[data-testid="build-disconnected"]').isVisible().catch(() => false);
    await runCommand(page, 'Kairo: Show Servers', 20000);
    const serverDisc = await page.locator('[data-testid="server-disconnected"]').isVisible().catch(() => false);
    result.crossVerification.viewsDisconnected = { build: buildDisc, server: serverDisc, withinMs: discMs };
    await shot('04-views-disconnected');
    if (!buildDisc || !serverDisc) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: views do not show disconnected state after agent kill (build=${buildDisc}, server=${serverDisc})`,
        evidence: ['screenshots/m2/flow-06/04-views-disconnected.png'],
      });
      logError('views missing disconnected state (defect filed)');
    }
    logStep('VIEWS_DISCONNECTED', result.crossVerification.viewsDisconnected);

    // one action -> exactly one understandable error
    const notifBefore = await countNotifications();
    await runCommand(page, 'Kairo: Build', 20000).catch(() => {});
    await sleep(3000);
    const notifAfter = await countNotifications();
    const newNotifs = notifAfter - notifBefore;
    result.crossVerification.singleErrorPerAction = { before: notifBefore, after: notifAfter, newNotifications: newNotifs };
    await shot('05-error-on-action');
    if (newNotifs > 1) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: one action while disconnected produced ${newNotifs} notifications (error storm)`,
        evidence: ['screenshots/m2/flow-06/05-error-on-action.png'],
      });
      logError(`error storm: ${newNotifs} notifications (defect filed)`);
    } else {
      logStep('SINGLE_ERROR_OK', result.crossVerification.singleErrorPerAction);
    }

    // ---- 3. B: restart agent -> auto-reconnect ----------------------------
    logStep('RESTART_AGENT');
    const agentBin = path.join(REPO_ROOT, 'runtime-agent', 'bin', 'kairo-runtime');
    const agentLog = path.join(dirs.logs, 'agent-restart.log');
    const logFd = fs.openSync(agentLog, 'a');
    agentProc = spawn(agentBin, ['--config', env.KAIRO_QA_AGENT_CONFIG], { stdio: ['ignore', logFd, logFd] });
    agentProc.unref();
    const tReconnStart = Date.now();
    await waitForStatusBarContains(page, 'Runtime: connected', 90000);
    const reconnMs = Date.now() - tReconnStart;
    logStep('RECONNECTED', { withinMs: reconnMs, newPid: agentProc.pid });
    result.crossVerification.reconnectMs = reconnMs;

    // snapshot consistent: project restored without re-import
    const sbAfterReconnect = await getStatusBarText(page);
    const projectRestored = sbAfterReconnect.includes(PROJECT_NAME);
    result.crossVerification.snapshotAfterReconnect = { projectRestored, statusBar: sbAfterReconnect.slice(0, 250) };
    await shot('06-reconnected');
    if (!projectRestored) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: project not restored after agent restart (status bar: ${sbAfterReconnect.slice(0, 120)})`,
        evidence: ['screenshots/m2/flow-06/06-reconnected.png'],
      });
      logError('snapshot not restored (defect filed)');
    }

    // no duplicate build-list entries (WS re-sub sanity)
    await runCommand(page, 'Kairo: Show Builds', 20000);
    await sleep(2000);
    const buildIds1 = await page.locator('[data-testid="build-list"] li .kairo-build-id').allTextContents();
    await sleep(4000);
    const buildIds2 = await page.locator('[data-testid="build-list"] li .kairo-build-id').allTextContents();
    const dupes = buildIds2.filter((id, i) => buildIds2.indexOf(id) !== i);
    result.crossVerification.noDuplicateListEntries = { snapshot1: buildIds1, snapshot2: buildIds2, duplicates: dupes };
    if (dupes.length) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: duplicate build-list entries after reconnect (WS re-subscription duplication)`,
        detail: result.crossVerification.noDuplicateListEntries,
      });
      logError('duplicate list entries (defect filed)');
    } else {
      logStep('NO_DUPLICATES_OK', { entries: buildIds2.length });
    }

    // ---- 4. C: reload -> state matches backend ------------------------------
    logStep('RELOAD_MID_BUILD_NOTE', { note: 'reload-mid-build is vacuous: builds complete instantly as no-ops (sham build P0); testing reload at rest instead' });
    result.blocked.push({ item: 'reload mid-build', reason: 'sham build completes instantly (WEB-238); no running state to reload into' });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);
    await dismissTrustDialog(page, 5000).catch(() => false);
    await waitForStatusBarContains(page, 'Runtime: connected', 90000);
    const sbAfterReload = await getStatusBarText(page);
    const backendProjects = await agentGet(env, '/api/v1/projects', 10000);
    const backendHas = (backendProjects.text || '').includes(PROJECT_NAME);
    result.crossVerification.reloadConsistency = {
      uiShowsProject: sbAfterReload.includes(PROJECT_NAME),
      backendHasProject: backendHas,
    };
    await shot('07-after-reload');
    if (result.crossVerification.reloadConsistency.uiShowsProject !== backendHas) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: UI/backend state mismatch after reload`,
        detail: result.crossVerification.reloadConsistency,
      });
      logError('reload state mismatch (defect filed)');
    } else {
      logStep('RELOAD_CONSISTENT', result.crossVerification.reloadConsistency);
    }

    // ---- 5. D: second tab, same workspace ------------------------------------
    logStep('SECOND_TAB');
    const page2 = await browser.newPage();
    page2._kairoLogs = page._kairoLogs;
    await page2.goto(page.url(), { timeout: 60000, waitUntil: 'domcontentloaded' });
    await sleep(8000);
    await dismissTrustDialog(page2, 5000).catch(() => false);
    const sb2 = await page2.evaluate(() => (document.getElementById('theia-statusBar') || {}).textContent || '');
    const tab2Connected = sb2.includes('Runtime: connected');
    const tab2Project = sb2.includes(PROJECT_NAME);
    result.crossVerification.twoTabs = { tab2Connected, tab2Project, tab1StillConnected: (await getStatusBarText(page)).includes('Runtime: connected') };
    await screenshot(page2, path.join(dirs.shots, '08-second-tab.png'));
    logStep('TWO_TABS', result.crossVerification.twoTabs);
    if (!tab2Connected) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: second tab on same workspace does not connect (tab2Connected=${tab2Connected}, tab2Project=${tab2Project})`,
        evidence: ['screenshots/m2/flow-06/08-second-tab.png'],
      });
    }
    await page2.close().catch(() => {});

    // ---- 6. console gate ------------------------------------------------------
    writeLogs(dirs.logs, page._kairoLogs || []);
    // Whitelist (justified): WS/reconnect noise to the agent during the
    // DELIBERATE kill window of scenario A; everything else fails.
    const gate = consoleGate(page._kairoLogs || [], [WL.agentKillWs, WL.favicon,
      l => l.type === 'requestfailed' && /18080/.test(l.url || ''),
      l => /^http5\d\d/.test(l.type) && /18080/.test(l.url || ''),
      l => l.type === 'error' && /Failed to load resource/.test(l.text) && /18080/.test(l.url || ''),
    ]);
    result.consoleGate = { ok: gate.ok, errorCount: gate.errors.length, first: gate.errors[0] || null };
    if (!gate.ok) {
      logError(`console gate: ${gate.errors.length} errors, first: ${JSON.stringify(gate.errors[0]).slice(0, 300)}`);
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: console/page errors outside the deliberate kill window (${gate.errors.length})`,
        evidence: ['logs/flow-06/console.jsonl'], first: gate.errors[0],
      });
      throw new Error('console gate failed');
    }
    logStep('CONSOLE_GATE_CLEAN');

    result.status = result.errors.length ? 'FAIL' : 'PASS';
    logStep(`FLOW_${result.status}`);
  } catch (err) {
    result.status = 'FAIL';
    logError(err.message);
    if (page) await shot('99-fail').catch(() => {});
  } finally {
    if (agentProc) { try { process.kill(agentProc.pid, 'SIGKILL'); } catch (_e) { /* already dead */ } }
    if (page) writeLogs(dirs.logs, page._kairoLogs || []);
    if (browser) await browser.close().catch(() => {});
    result.finishedAt = new Date().toISOString();
    if (stackInfo && !useExisting) {
      logStep('STOP_STACK');
      const agentLogSrc = stackInfo.env.KAIRO_QA_AGENT_LOG;
      result.stopResult = await stopStack(stackInfo.dataDir);
      if (agentLogSrc && fs.existsSync(agentLogSrc)) fs.copyFileSync(agentLogSrc, path.join(dirs.logs, 'agent.log'));
      result.dataDir = stackInfo.dataDir;
    }
    writeResult(OUT, result);
    recordFlowResult(FLOW, {
      status: result.status, runId,
      errors: result.errors.map(e => e.message),
      blocked: result.blocked,
      crossVerification: result.crossVerification,
      consoleGate: result.consoleGate,
    });
    console.log(`\nArtifacts: ${OUT}`);
    console.log(`Result: ${result.status}`);
  }
  if (result.status !== 'PASS') process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
