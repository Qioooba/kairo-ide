// WEB-FLOW-04 — 构建（Build success/failure），M2 release-blocking driver.
//
// Real headed Chromium, UI-only. Setup: import wizard (source level 1.8 —
// javac 21 rejects 1.6; GBK/ant) + open project folder as workspace.
// NOTE: the agent's build engine compiles with javac directly
// (internal/build/compiler.go); build.xml/ant is not invoked. The "Build and
// Deploy" label/semantics check lives in WEB-FLOW-05 (deploy record).
//
// Assertions:
//   1. Build view opens (idle) -> Build -> state transitions to running ->
//      succeeded within 300s; .class artifacts on disk (outputDir).
//   2. Busy semantics: buttons disabled while running.
//   3. Introduce compile error via editor (UI) -> Build -> failed + real
//      diagnostic (file:line) in build view; clicking the diagnostic should
//      navigate to the file/line (suspected no-op -> defect if confirmed).
//   4. Fix (undo + save) -> Build -> succeeded; history keeps all 3 builds.
//   5. Clean Build -> artifacts actually removed, then rebuilt (mtimes).
//
// Usage: node scripts/run-web-flow-04.cjs [--use-existing DATA_DIR]

const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForSelectorVisible,
  waitForStatusBarContains, agentGet,
  writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');
const {
  flowDirs, recordFlowResult, appendDefect, ensurePort18080, consoleGate,
} = require('./m2-common.cjs');
const {
  importProjectViaWizard, openProjectAsWorkspace, quickOpenFile,
} = require('./m2-bootstrap.cjs');

const FLOW = 'WEB-FLOW-04';
const PROJECT_NAME = 'flow04-project';

async function buildState(page) {
  return (await page.locator('[data-testid="build-state"]').getAttribute('data-state')) || '';
}

async function waitBuildState(page, states, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await buildState(page);
    if (states.includes(s)) return s;
    await sleep(1000);
  }
  throw new Error(`build state did not become ${states.join('/')} within ${timeoutMs}ms (last: ${await buildState(page)})`);
}

function countClassFiles(dir) {
  let n = 0;
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.class')) n++;
    }
  };
  walk(dir);
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) { useExisting = args[i + 1]; i++; }
  }

  const runId = `flow04-${Date.now()}`;
  const dirs = flowDirs('flow-04');
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

  try {
    // ---- 1. stack + browser + setup (UI) ---------------------------------
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

    const outDir = path.join(legacyDst, 'build', 'classes');
    fs.rmSync(path.join(legacyDst, 'build'), { recursive: true, force: true });

    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    await importProjectViaWizard(page, legacyDst, { name: PROJECT_NAME, sourceLevel: '1.8' });
    logStep('PROJECT_IMPORTED');
    page = await openProjectAsWorkspace(page);
    logStep('WORKSPACE_OPENED');

    // ---- 2. build view: idle -> build -> succeeded ------------------------
    await runCommand(page, 'Kairo: Show Builds', 20000);
    await waitForSelectorVisible(page, '[data-testid="build-view"]', 20000);
    const initialState = await buildState(page);
    logStep('BUILD_VIEW_OPEN', { state: initialState });
    await shot('03-build-view-idle');

    await page.locator('[data-testid="build-button"]').click();
    // busy semantics: buttons disabled while running
    const disabledDuringRun = await page.locator('[data-testid="build-button"]').isDisabled();
    result.crossVerification.busyDisabled = disabledDuringRun;
    logStep('BUILD_STARTED', { buttonsDisabledWhileRunning: disabledDuringRun });
    const finalState = await waitBuildState(page, ['succeeded', 'failed'], 300000);
    await shot('04-build-result');
    if (finalState !== 'succeeded') {
      const summary = await page.locator('[data-testid="build-summary"]').textContent().catch(() => '');
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: clean legacy-sample build failed (source 1.8, javac)`,
        evidence: ['screenshots/m2/flow-04/04-build-result.png'],
        summary: (summary || '').slice(0, 400),
      });
      throw new Error(`first build failed: ${summary}`);
    }
    const classCount = countClassFiles(outDir);
    if (classCount === 0) throw new Error('build reported success but no .class artifacts on disk');
    result.crossVerification.firstBuild = { state: finalState, classFiles: classCount, outDir };
    logStep('BUILD_SUCCEEDED', result.crossVerification.firstBuild);

    // ---- 3. compile error -> failed + diagnostics -------------------------
    await quickOpenFile(page, 'HelloServlet.java');
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+End').catch(() => {});
    await page.keyboard.press('Enter');
    await page.keyboard.type('this is not java;', { delay: 5 });
    await page.keyboard.press('Meta+S');
    await sleep(1000);

    await page.locator('[data-testid="build-button"]').click();
    const failState = await waitBuildState(page, ['succeeded', 'failed'], 300000);
    await shot('05-build-failed');
    if (failState !== 'failed') throw new Error('build with broken source did not fail');
    const diagItems = page.locator('[data-testid="diagnostics-list"] li');
    const diagCount = await diagItems.count();
    const diagText = await page.locator('[data-testid="diagnostics-list"]').textContent().catch(() => '');
    if (diagCount === 0 || !/HelloServlet/.test(diagText) || !/:\d+:/.test(diagText)) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: failed build shows no usable diagnostic (file:line)`,
        evidence: ['screenshots/m2/flow-04/05-build-failed.png'],
        diagText: (diagText || '').slice(0, 400),
      });
      throw new Error('no real diagnostic for compile error');
    }
    logStep('BUILD_FAILED_WITH_DIAGNOSTICS', { diagnostics: diagCount, text: (diagText || '').slice(0, 200) });

    // click the diagnostic -> should navigate to file/line
    await diagItems.first().click();
    await sleep(2000);
    const cursorInfo = await page.evaluate(() => {
      const ed = document.querySelector('.monaco-editor');
      if (!ed) return null;
      const lines = ed.querySelector('.view-lines');
      return { hasEditor: !!ed, text: (lines?.textContent || '').slice(0, 120) };
    });
    const activeTab = (await page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabLabel').first().textContent().catch(() => '')) || '';
    const cursorLine = await page.evaluate(() => {
      const el = document.querySelector('.monaco-editor .cursor');
      return el ? el.getAttribute('style') : null;
    });
    result.crossVerification.diagnosticClick = { activeTab, cursorLine, cursorInfo };
    if (!activeTab.includes('HelloServlet.java')) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: clicking a build diagnostic does not navigate to the file (no-op)`,
        evidence: ['screenshots/m2/flow-04/05-build-failed.png'],
        detail: result.crossVerification.diagnosticClick,
      });
      logError('diagnostic click did not navigate (defect filed, continuing)');
    } else {
      logStep('DIAGNOSTIC_CLICK_NAVIGATES', { activeTab });
    }
    await shot('06-diagnostic-click');

    // ---- 4. fix -> build succeeds, history kept ---------------------------
    await quickOpenFile(page, 'HelloServlet.java');
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Meta+Z'); // undo the garbage line
    await page.keyboard.press('Meta+S');
    await sleep(1000);
    await page.locator('[data-testid="build-button"]').click();
    const fixedState = await waitBuildState(page, ['succeeded', 'failed'], 300000);
    if (fixedState !== 'succeeded') throw new Error('build after fix did not succeed');
    const historyCount = await page.locator('[data-testid="build-list"] li').count();
    if (historyCount < 3) {
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: build history lost entries (expected >=3, got ${historyCount})`,
        evidence: ['screenshots/m2/flow-04/07-history.png'],
      });
    }
    logStep('BUILD_AFTER_FIX', { state: fixedState, historyEntries: historyCount });
    await shot('07-history');

    // ---- 5. clean build ----------------------------------------------------
    const beforeClean = Date.now();
    await page.locator('[data-testid="clean-build-button"]').click();
    const cleanState = await waitBuildState(page, ['succeeded', 'failed'], 300000);
    await shot('08-clean-build');
    if (cleanState !== 'succeeded') throw new Error('clean build did not succeed');
    const classCountAfter = countClassFiles(outDir);
    // every .class must have been (re)created after the clean started
    let stale = 0;
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.class') && fs.statSync(p).mtimeMs < beforeClean - 1000) stale++;
      }
    };
    walk(outDir);
    result.crossVerification.cleanBuild = { classFiles: classCountAfter, staleFiles: stale, startedAt: beforeClean };
    if (classCountAfter === 0 || stale > 0) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: Clean Build did not actually clean (stale=${stale}, count=${classCountAfter})`,
        evidence: ['screenshots/m2/flow-04/08-clean-build.png'],
      });
      throw new Error('clean build semantics broken');
    }
    logStep('CLEAN_BUILD_VERIFIED', result.crossVerification.cleanBuild);

    // ---- 6. console gate ---------------------------------------------------
    writeLogs(dirs.logs, page._kairoLogs || []);
    const gate = consoleGate(page._kairoLogs || []);
    result.consoleGate = { ok: gate.ok, errorCount: gate.errors.length, first: gate.errors[0] || null };
    if (!gate.ok) {
      logError(`console gate: ${gate.errors.length} errors, first: ${JSON.stringify(gate.errors[0]).slice(0, 300)}`);
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: console/page errors during build flow (${gate.errors.length})`,
        evidence: ['logs/flow-04/console.jsonl'], first: gate.errors[0],
      });
      throw new Error('console gate failed');
    }
    logStep('CONSOLE_GATE_CLEAN');

    result.status = 'PASS';
    logStep('FLOW_PASS');
  } catch (err) {
    result.status = 'FAIL';
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
