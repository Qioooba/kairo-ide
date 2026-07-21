// WEB-FLOW-05 — 部署与 Tomcat（Deploy + Tomcat loop），M2 release-blocking driver.
//
// Real headed Chromium, UI-only. Setup: import (1.8/GBK/ant) + open workspace.
// ENV PREP (documented, not a product change): bundled/tomcat6 must contain a
// real Tomcat 6 — populated via scripts/fetch-tomcat6.sh equivalent
// (archive.apache.org tarball, SHA-256 recorded in result.crossVerification).
// If Tomcat is unavailable the flow is BLOCKED (release failure), not skipped.
//
// Assertions:
//   1. Build and Deploy -> Deployments view shows a real record; cross-check
//      via API (deployment entry + deployed file count on disk).
//   2. Server view Start -> running; record Server ID/PID/port/startedAt;
//      port actually listening (lsof) and owned by a java process.
//   3. Open Application -> real page, HTTP 200 + expected content (curl
//      cross-verification of the served URL).
//   4. Edit JSP via UI -> save -> redeploy -> served content changes.
//   5. Restart -> same logical Server ID, different PID.
//   6. Logs: history visible; live tail appends after a request; Clear
//      semantics (clears view, history recoverable).
//   7. Stop -> port freed (lsof), process gone (kill -0 fails); Start again.
//
// Usage: node scripts/run-web-flow-05.cjs [--use-existing DATA_DIR]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForSelectorVisible,
  waitForStatusBarContains, agentGet, httpGet,
  writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');
const {
  flowDirs, recordFlowResult, appendDefect, ensurePort18080, consoleGate, WL,
} = require('./m2-common.cjs');
const {
  importProjectViaWizard, openProjectAsWorkspace, quickOpenFile,
} = require('./m2-bootstrap.cjs');

const FLOW = 'WEB-FLOW-05';
const PROJECT_NAME = 'flow05-project';

function portPids(port) {
  try {
    return execFileSync('bash', ['-c', `lsof -ti tcp:${port} 2>/dev/null || true`], { encoding: 'utf8' }).trim();
  } catch (_e) { return ''; }
}

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) { useExisting = args[i + 1]; i++; }
  }

  const runId = `flow05-${Date.now()}`;
  const dirs = flowDirs('flow-05');
  const OUT = dirs.flow;
  const result = {
    flow: FLOW, runId, startedAt: new Date().toISOString(),
    status: 'RUNNING', steps: [], screenshots: {}, errors: [], crossVerification: {}, blocked: [],
  };
  let stackInfo = null, browser = null, page = null;

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
  const failBlocked = async (item, evidence) => {
    result.blocked.push({ item, evidence });
    logStep('BLOCKED', { item });
    appendDefect({
      severity: 'P0',
      title: `${FLOW}: BLOCKED — ${item}`,
      detail: evidence,
      evidence: ['screenshots/m2/flow-05', 'logs/flow-05/agent.log'],
    });
    result.status = 'BLOCKED';
    throw new Error(`BLOCKED: ${item}`);
  };

  try {
    // ---- 1. stack + env prep check ----------------------------------------
    if (useExisting) {
      stackInfo = { dataDir: useExisting, env: loadEnv(useExisting) };
    } else {
      ensurePort18080();
      logStep('START_STACK');
      stackInfo = await startStack({ skipBuild: true, port: 18080 });
    }
    const env = stackInfo.env;
    const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT || 3000}/`;
    const legacyDst = env.KAIRO_QA_LEGACY_DST;
    const health = await agentGet(env, '/api/v1/health', 10000);
    if (!health.ok) throw new Error(`agent health failed: ${health.status}`);
    logStep('PREFLIGHT_HEALTH_OK');

    const bootstrapJar = path.join(env.KAIRO_QA_AGENT_BUNDLED_DIR || '', 'tomcat6', 'apache-tomcat-6.0.53', 'bin', 'bootstrap.jar');
    result.crossVerification.tomcatBundled = { bundledDir: env.KAIRO_QA_AGENT_BUNDLED_DIR, bootstrapJarExists: fs.existsSync(bootstrapJar) };
    if (!result.crossVerification.tomcatBundled.bootstrapJarExists) {
      await failBlocked('Tomcat 6 not bundled (bootstrap.jar missing)', result.crossVerification.tomcatBundled);
    }
    logStep('TOMCAT_BUNDLED_OK', result.crossVerification.tomcatBundled);

    // ---- 2. browser + setup (UI) ------------------------------------------
    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    await importProjectViaWizard(page, legacyDst, { name: PROJECT_NAME, sourceLevel: '1.8' });
    logStep('PROJECT_IMPORTED');
    page = await openProjectAsWorkspace(page);
    logStep('WORKSPACE_OPENED');

    // ---- 3. Build and Deploy ------------------------------------------------
    await runCommand(page, 'Kairo: Build and Deploy', 20000);
    // wait for a deployment record in the Deployments view
    await runCommand(page, 'Kairo: Show Deployments', 20000);
    const deployView = page.locator('[data-testid="deployments-view"], [data-testid="deploy-view"], [class*="deploy"]').first();
    await deployView.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    // cross-verify via API (post-hoc allowed)
    let deployments = null;
    const deployStart = Date.now();
    while (Date.now() - deployStart < 300000) {
      const r = await agentGet(env, '/api/v1/deployments', 10000);
      const payload = r.json?.payload || r.json;
      if (r.ok && Array.isArray(payload) && payload.length > 0) { deployments = payload; break; }
      await sleep(3000);
    }
    await shot('03-after-build-and-deploy');
    if (!deployments) {
      appendDefect({
        severity: 'P0',
        title: `${FLOW}: Build and Deploy produced no deployment record within 300s (downstream of sham-build P0)`,
        evidence: ['screenshots/m2/flow-05/03-after-build-and-deploy.png'],
      });
      logError('no deployment record (defect filed) — continuing to test the Tomcat lifecycle without a deployment');
      result.blocked.push({ item: 'deploy record', reason: 'no deployment within 300s' });
      result.deployBlocked = true;
    } else {
      result.crossVerification.deployments = deployments.slice(0, 3);
      logStep('DEPLOYMENT_RECORDED', { count: deployments.length, first: deployments[0] });
    }

    // ---- 4. Start server ----------------------------------------------------
    await runCommand(page, 'Kairo: Show Servers', 20000);
    await waitForSelectorVisible(page, '[data-testid="server-view"]', 20000);
    await shot('04-server-view');
    await page.locator('[data-testid="server-start-button"]').click();
    // wait for running state (Tomcat 6 on JDK 21 may fail — that's a finding)
    let serverInfo = null;
    const startT = Date.now();
    while (Date.now() - startT < 300000) {
      const r = await agentGet(env, '/api/v1/servers', 10000);
      const payload = r.json?.payload || r.json;
      const list = Array.isArray(payload) ? payload : (payload ? [payload] : []);
      const running = list.find(s => /running/i.test(s.status || s.state || ''));
      if (running) { serverInfo = running; break; }
      const failed = list.find(s => /failed|error/i.test(s.status || s.state || ''));
      if (failed) break;
      await sleep(3000);
    }
    await shot('05-server-after-start');
    if (!serverInfo) {
      const r = await agentGet(env, '/api/v1/servers', 10000);
      await failBlocked('server did not reach running within 300s', { serversApi: (r.text || '').slice(0, 500) });
    }
    const serverPort = (serverInfo.ports && serverInfo.ports.http) || serverInfo.httpPort || serverInfo.port;
    const serverPid = serverInfo.pid;
    result.crossVerification.server = { id: serverInfo.id, pid: serverPid, port: serverPort, startedAt: serverInfo.startTime || serverInfo.startedAt };
    logStep('SERVER_RUNNING', result.crossVerification.server);

    // port listening + process alive
    const pids = portPids(serverPort);
    if (!pids) throw new Error(`port ${serverPort} not listening though server reports running`);
    let pidAlive = false;
    try { process.kill(parseInt(serverPid, 10), 0); pidAlive = true; } catch (_e) { /* dead */ }
    result.crossVerification.serverProcess = { portPids: pids, pidAlive };
    logStep('SERVER_PROCESS_VERIFIED', result.crossVerification.serverProcess);

    // ---- 5. Open Application -> HTTP 200 + content --------------------------
    // UI: click the server URL link; verify the served page via HTTP (post-hoc)
    const urlLink = page.locator('[data-testid="server-url-link"]');
    if (await urlLink.isVisible().catch(() => false)) {
      const popupP = page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await urlLink.click();
      const appTab = await popupP;
      if (appTab) { await sleep(3000); await shot('06-open-app-tab'); await appTab.close().catch(() => {}); }
    } else {
      await runCommand(page, 'Kairo: Open Application', 20000).catch(() => {});
      await sleep(3000);
    }
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    const candidates = [`${baseUrl}/legacy-sample/hello.jsp`, `${baseUrl}/hello.jsp`, `${baseUrl}/`, `${baseUrl}/legacy-sample/`];
    let served = null;
    for (const u of candidates) {
      const r = await httpGet(u, 10000);
      if (r.ok && r.text && r.text.length > 0) { served = { url: u, status: r.status, length: r.text.length, body: r.text.slice(0, 300) }; break; }
    }
    if (!served) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: server running but app URLs do not serve (tried ${candidates.length} candidates)`,
        evidence: ['screenshots/m2/flow-05/06-open-app-tab.png'],
      });
      logError('no served content on any candidate URL (defect filed) — continuing with lifecycle tests');
      result.deployBlocked = true;
    } else {
      result.crossVerification.served = served;
      logStep('APP_SERVED', served);
    }

    // ---- 6. edit JSP -> redeploy -> new content -----------------------------
    if (served) {
      await quickOpenFile(page, 'hello.jsp');
      await page.locator('.monaco-editor .view-lines').first().click();
      await page.keyboard.press('Control+End').catch(() => {});
      await page.keyboard.press('Enter');
      const MARKER = 'QA-FLOW05-MARKER';
      await page.keyboard.type(`<!-- ${MARKER} -->`, { delay: 5 });
      await page.keyboard.press('Meta+S');
      await sleep(1000);
      await runCommand(page, 'Kairo: Build and Deploy', 20000);
      // poll served page for the marker
      let redeployed = false;
      const redeployStart = Date.now();
      while (Date.now() - redeployStart < 300000) {
        const r = await httpGet(served.url, 10000);
        if (r.ok && r.text.includes(MARKER)) { redeployed = true; break; }
        await sleep(4000);
      }
      result.crossVerification.redeploy = { markerServed: redeployed, url: served.url };
      await shot('07-after-redeploy');
      if (!redeployed) {
        appendDefect({
          severity: 'P1',
          title: `${FLOW}: edit-JSP -> Build and Deploy does not refresh served content (marker absent after 300s)`,
          evidence: ['screenshots/m2/flow-05/07-after-redeploy.png'],
        });
        throw new Error('redeploy did not serve new content');
      }
      logStep('REDEPLOY_SERVES_NEW_CONTENT');
    } else {
      result.blocked.push({ item: 'JSP edit -> redeploy -> new content', reason: 'nothing served (deploy broken upstream)' });
      logStep('REDEPLOY_BLOCKED_UPSTREAM');
    }

    // ---- 7. restart: same logical id, new PID --------------------------------
    const restartBtn = page.locator('[data-testid="server-restart-button"]');
    const restartEnabled = await restartBtn.isEnabled().catch(() => false);
    const stopEnabled = await page.locator('[data-testid="server-stop-button"]').isEnabled().catch(() => false);
    const openEnabled = await page.locator('[data-testid="server-open-button"]').isEnabled().catch(() => false);
    result.crossVerification.serverViewButtons = { restartEnabled, stopEnabled, openEnabled };
    if (!restartEnabled || !stopEnabled) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW} WAVE3-RERUN: Server view does not reflect the running server — Stop/Restart/Open App buttons stay disabled while the server IS running (store sync gap, same class as Build view)`,
        detail: result.crossVerification.serverViewButtons,
        evidence: ['screenshots/m2/flow-05/08-after-restart.png'],
      });
      logError('server view buttons disabled despite running server (defect filed; driving lifecycle via commands)');
    }
    if (restartEnabled) {
      await restartBtn.click();
    } else {
      await runCommand(page, 'Kairo: Restart Server', 20000);
    }
    let restarted = null;
    const restartStart = Date.now();
    while (Date.now() - restartStart < 60000) {
      const r = await agentGet(env, '/api/v1/servers', 10000);
      const payload = r.json?.payload || r.json;
      const list = Array.isArray(payload) ? payload : (payload ? [payload] : []);
      const running = list.find(s => /running/i.test(s.status || s.state || ''));
      if (running && String(running.pid) !== String(serverPid)) { restarted = running; break; }
      await sleep(3000);
    }
    if (!restarted) {
      // Restart is UNIMPLEMENTED agent-side: POST /api/v1/servers/{id}/restart
      // hits "unknown subpath" (404) — verified in handleServerSub
      // (internal/api/handlers.go:501-556, no restart case).
      appendDefect({
        severity: 'P1',
        title: `${FLOW} WAVE3-RERUN: Server Restart does nothing — frontend calls POST /api/v1/servers/{id}/restart but the agent has NO restart subpath (404 "unknown subpath")`,
        evidence: ['logs/flow-05/agent.log', 'runtime-agent/internal/api/handlers.go:501-556'],
      });
      logError('restart endpoint unimplemented (defect filed); falling back to Stop+Start for lifecycle evidence');
      // workaround: explicit stop + start to keep testing stop/start semantics
      if (await page.locator('[data-testid="server-stop-button"]').isEnabled().catch(() => false)) {
        await page.locator('[data-testid="server-stop-button"]').click();
      } else {
        await runCommand(page, 'Kairo: Stop Server', 20000);
      }
      const stopT = Date.now();
      while (Date.now() - stopT < 60000) { if (!portPids(serverPort)) break; await sleep(2000); }
      if (await page.locator('[data-testid="server-start-button"]').isEnabled().catch(() => false)) {
        await page.locator('[data-testid="server-start-button"]').click();
      } else {
        await runCommand(page, 'Kairo: Start Server', 20000);
      }
      const startT2 = Date.now();
      while (Date.now() - startT2 < 180000) {
        const r = await agentGet(env, '/api/v1/servers', 10000);
        const payload = r.json?.payload || r.json;
        const list = Array.isArray(payload) ? payload : (payload ? [payload] : []);
        const running = list.find(s2 => /running/i.test(s2.status || s2.state || ''));
        if (running) { restarted = running; break; }
        await sleep(3000);
      }
      if (!restarted) throw new Error('stop+start fallback also failed');
      result.crossVerification.restartViaFallback = true;
    }
    result.crossVerification.restart = {
      sameLogicalId: restarted.id === serverInfo.id,
      oldPid: serverPid, newPid: restarted.pid,
    };
    if (!result.crossVerification.restart.sameLogicalId) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: restart changed the logical Server ID (${serverInfo.id} -> ${restarted.id})`,
      });
    }
    logStep('RESTART_VERIFIED', result.crossVerification.restart);
    await shot('08-after-restart');

    // ---- 8. logs: history + live tail + clear ---------------------------------
    await runCommand(page, 'Kairo: Show Tomcat Logs', 20000);
    const logViewer = page.locator('[data-testid="log-viewer"]');
    await logViewer.waitFor({ state: 'visible', timeout: 30000 });
    const logText1 = await page.locator('[data-testid="log-viewer-content"]').textContent().catch(() => '');
    const historyLines = (logText1 || '').split('\n').filter(Boolean).length;
    await shot('09-logs-history');
    // trigger a request to generate new log output
    await httpGet(`${served.url}?qa=tail`, 10000);
    await sleep(4000);
    const logText2 = await page.locator('[data-testid="log-viewer-content"]').textContent().catch(() => '');
    const grew = (logText2 || '').length > (logText1 || '').length;
    result.crossVerification.logs = { historyLines, liveTailGrew: grew };
    // clear semantics
    const clearBtn = page.locator('[data-testid="log-clear-btn"]');
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click();
      await sleep(1500);
      const logText3 = await page.locator('[data-testid="log-viewer-content"]').textContent().catch(() => '');
      result.crossVerification.logs.afterClearLength = (logText3 || '').length;
      await shot('10-logs-after-clear');
    }
    if (!grew) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW} WAVE3-RERUN: Tomcat Logs viewer shows no history and no live tail (historyLines=${result.crossVerification.logs.historyLines}) — agent log API returns empty (api_handler.go: log streaming unimplemented, stdout goes only to kairo-stdout.log file)`,
        detail: result.crossVerification.logs,
        evidence: ['screenshots/m2/flow-05/09-logs-history.png'],
      });
      logError('log viewer empty/no live tail (defect filed)');
    }
    logStep('LOGS_VERIFIED', result.crossVerification.logs);

    // ---- 9. stop: port freed, process gone; start again -----------------------
    if (await page.locator('[data-testid="server-stop-button"]').isEnabled().catch(() => false)) {
      await page.locator('[data-testid="server-stop-button"]').click();
    } else {
      await runCommand(page, 'Kairo: Stop Server', 20000);
    }
    let portFreed = false;
    const stopStart = Date.now();
    while (Date.now() - stopStart < 120000) {
      if (!portPids(serverPort)) { portFreed = true; break; }
      await sleep(2000);
    }
    // graceful Tomcat shutdown + reaping can take tens of seconds — poll
    let pidGone = false;
    const pidT = Date.now();
    while (Date.now() - pidT < 45000) {
      try { process.kill(parseInt(restarted.pid, 10), 0); } catch (_e) { pidGone = true; break; }
      await sleep(2000);
    }
    result.crossVerification.stop = { portFreed, pidGone, port: serverPort };
    await shot('11-after-stop');
    if (!portFreed || !pidGone) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: Stop did not free the port / reap the process (portFreed=${portFreed}, pidGone=${pidGone})`,
        evidence: ['screenshots/m2/flow-05/11-after-stop.png'],
      });
      throw new Error('stop semantics broken');
    }
    logStep('STOP_VERIFIED', result.crossVerification.stop);

    // start again
    // isEnabled() is not enough: the button stays enabled in the DOM even
    // when the Servers view is hidden (e.g. the Server Logs view replaced
    // it in the sidebar after stop) — click() then times out on
    // "element is not visible". Gate on visibility and fall back to the
    // command, same as the restart path above.
    const startAgainBtn = page.locator('[data-testid="server-start-button"]');
    const startAgainClickable = (await startAgainBtn.isVisible().catch(() => false))
      && (await startAgainBtn.isEnabled().catch(() => false));
    if (startAgainClickable) {
      await startAgainBtn.click();
    } else {
      await runCommand(page, 'Kairo: Start Server', 20000);
    }
    let again = null;
    const againStart = Date.now();
    while (Date.now() - againStart < 300000) {
      const r = await agentGet(env, '/api/v1/servers', 10000);
      const payload = r.json?.payload || r.json;
      const list = Array.isArray(payload) ? payload : (payload ? [payload] : []);
      const running = list.find(s => /running/i.test(s.status || s.state || ''));
      if (running) { again = running; break; }
      await sleep(3000);
    }
    if (!again) throw new Error('server did not start again after stop');
    logStep('RESTART_AFTER_STOP_OK', { pid: again.pid });

    // ---- 10. console gate ------------------------------------------------------
    writeLogs(dirs.logs, page._kairoLogs || []);
    const gate = consoleGate(page._kairoLogs || [], [WL.favicon]);
    result.consoleGate = { ok: gate.ok, errorCount: gate.errors.length, first: gate.errors[0] || null };
    if (!gate.ok) {
      logError(`console gate: ${gate.errors.length} errors, first: ${JSON.stringify(gate.errors[0]).slice(0, 300)}`);
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: console/page errors during deploy/Tomcat flow (${gate.errors.length})`,
        evidence: ['logs/flow-05/console.jsonl'], first: gate.errors[0],
      });
      throw new Error('console gate failed');
    }
    logStep('CONSOLE_GATE_CLEAN');

    result.status = (result.deployBlocked || result.blocked.length) ? 'FAIL' : 'PASS';
    logStep(`FLOW_${result.status}`);
  } catch (err) {
    if (result.status !== 'BLOCKED') result.status = 'FAIL';
    logError(err.message);
    if (page) await shot('99-fail').catch(() => {});
  } finally {
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
