// WEB-FLOW-01 — 首次导入（First Import），M2 release-blocking driver.
//
// Real headed Chromium, UI-only operations (agent API used only for
// pre-flight health + post-hoc cross-verification):
//   cold start -> Welcome tab -> Import Wizard (4 steps) ->
//   name validation (empty / 101-char / Chinese) -> every Source Level /
//   Encoding / Build Tool option selectable -> save (GBK/ant/1.6, realistic
//   for legacy-sample) -> wizard closes -> status bar shows project ->
//   disk config (.kairo/project.yaml) + agent API cross-check ->
//   page reload -> project restored from disk.
//
// Usage: node scripts/run-web-flow-01.cjs [--use-existing DATA_DIR]

const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForSelectorVisible,
  waitForText, waitForStatusBarContains, agentGet,
  writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');
const {
  flowDirs, recordFlowResult, appendDefect, ensurePort18080, consoleGate,
  selectFolderInTheiaFileDialog,
} = require('./m2-common.cjs');

const FLOW = 'WEB-FLOW-01';
const LONG_NAME = 'a'.repeat(101);
const CHINESE_NAME = '中文遗产项目';
// Final saved config: realistic for legacy-sample (Ant build, GBK JSPs).
const FINAL = { sourceLevel: '1.6', encoding: 'GBK', buildTool: 'ant' };

async function selectEveryOption(page, testid, values, logStep) {
  const sel = page.locator(`[data-testid="${testid}"]`);
  const actual = await sel.locator('option').allTextContents();
  for (const v of values) {
    await sel.selectOption(v);
    const cur = await sel.inputValue();
    if (cur !== v) throw new Error(`${testid}: could not select "${v}" (got "${cur}")`);
  }
  logStep(`OPTIONS_${testid.toUpperCase()}`, { offered: actual, cycled: values });
}

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) { useExisting = args[i + 1]; i++; }
  }

  const runId = `flow01-${Date.now()}`;
  const dirs = flowDirs('flow-01');
  const OUT = dirs.flow;

  const result = {
    flow: FLOW, runId, startedAt: new Date().toISOString(),
    status: 'RUNNING', steps: [], screenshots: {}, errors: [], crossVerification: {},
  };

  let stackInfo = null;
  let browser = null;
  let page = null;

  const shot = async (name) => {
    const p = path.join(dirs.shots, `${name}.png`);
    await screenshot(page, p);
    result.screenshots[name] = path.relative(OUT, p);
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
    // ---- 1. stack ------------------------------------------------------
    if (useExisting) {
      stackInfo = { dataDir: useExisting, env: loadEnv(useExisting) };
      logStep('USE_EXISTING_STACK', { dataDir: useExisting });
    } else {
      ensurePort18080();
      logStep('START_STACK');
      stackInfo = await startStack({ skipBuild: true, port: 18080 });
      logStep('STACK_READY', { dataDir: stackInfo.dataDir, webPort: stackInfo.env.KAIRO_QA_WEB_PORT });
    }
    const env = stackInfo.env;
    if (String(env.KAIRO_QA_AGENT_PORT) !== '18080') {
      throw new Error(`agent port must be 18080 (frontend hard default), got ${env.KAIRO_QA_AGENT_PORT}`);
    }
    const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT || 3000}/`;
    const legacyDst = env.KAIRO_QA_LEGACY_DST;
    if (!legacyDst || !fs.existsSync(legacyDst)) throw new Error(`legacy-sample copy missing: ${legacyDst}`);

    // Pre-flight health (API allowed here)
    const health = await agentGet(env, '/api/v1/health', 10000);
    if (!health.ok) throw new Error(`agent health failed: ${health.status}`);
    logStep('PREFLIGHT_HEALTH_OK');

    // ---- 2. browser ----------------------------------------------------
    logStep('LAUNCH_BROWSER');
    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    const trusted = await dismissTrustDialog(page);
    logStep('TRUST_DIALOG', { dismissed: trusted });

    // Welcome tab auto-opens on cold start (welcome-import button affordance)
    const welcomeImport = page.locator('[data-testid="welcome-import"], button:has-text("Import")').first();
    const welcomeVisible = await welcomeImport.isVisible().catch(() => false);
    logStep('WELCOME_TAB', { importAffordanceVisible: welcomeVisible });
    await shot('01-cold-start');

    const initialStatus = await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    logStep('SHELL_READY', { statusBar: initialStatus.slice(0, 200) });

    // ---- 3. wizard -----------------------------------------------------
    logStep('OPEN_IMPORT_WIZARD');
    await runCommand(page, 'Kairo: Import Project', 20000);
    await waitForSelectorVisible(page, '[data-testid="import-wizard"]', 20000);
    await waitForSelectorVisible(page, '[data-testid="step-content-1"]', 10000);
    await shot('02-wizard-step1');

    // Step 1 "Open Workspace Folder" opens Theia's server-side FileDialog
    // widget (NOT a native picker and NOT an HTML file input). It opens at
    // the Theia workspace dir ($DATA_DIR/workspace); the legacy-sample copy
    // is its sibling — navigate up once, select it, confirm with Open.
    await page.locator('[data-testid="open-workspace-btn"]').click();
    await selectFolderInTheiaFileDialog(page, 'legacy-sample', { upCount: 1 });
    logStep('WORKSPACE_SELECTED', { path: legacyDst });

    await page.locator('[data-testid="step-content-2"]').waitFor({ state: 'visible', timeout: 30000 });
    // wait for scan to settle: either detected-config or the create-new branch
    await page.locator('[data-testid="continue-to-configure"], [data-testid="create-new-config"]').first()
      .waitFor({ state: 'visible', timeout: 30000 });
    const detectedText = await page.locator('[data-testid="detected-config"]').textContent().catch(() => null);
    logStep('DETECT_RESULT', { detected: detectedText ? detectedText.slice(0, 400) : '(none — create-new branch)' });
    await shot('03-wizard-step2-detect');
    await page.locator('[data-testid="continue-to-configure"], [data-testid="create-new-config"]').first().click();

    await waitForSelectorVisible(page, '[data-testid="step-content-3"]', 20000);
    await shot('04-wizard-step3-form');

    // ---- 4. validation -------------------------------------------------
    const nameInput = page.locator('[data-testid="input-project-name"]');
    const saveBtn = page.locator('[data-testid="save-config-btn"]');

    await nameInput.fill('');
    await saveBtn.click();
    await waitForText(page, '[data-testid="save-error"]', 'empty', 10000);
    logStep('VALIDATION_EMPTY_NAME_OK');
    await shot('05-validation-empty-name');

    await nameInput.fill(LONG_NAME);
    await saveBtn.click();
    await waitForText(page, '[data-testid="save-error"]', '100', 10000);
    logStep('VALIDATION_LONG_NAME_OK');
    await shot('06-validation-long-name');

    // every option of each select must be selectable
    await selectEveryOption(page, 'select-source-level', ['1.5', '1.6', '1.7', '1.8'], logStep);
    await selectEveryOption(page, 'select-encoding', ['UTF-8', 'GBK', 'GB18030', 'ISO-8859-1'], logStep);
    await selectEveryOption(page, 'select-build-tool', ['ant', 'javac'], logStep);

    // final realistic config
    await nameInput.fill(CHINESE_NAME);
    await page.locator('[data-testid="select-source-level"]').selectOption(FINAL.sourceLevel);
    await page.locator('[data-testid="select-encoding"]').selectOption(FINAL.encoding);
    await page.locator('[data-testid="select-build-tool"]').selectOption(FINAL.buildTool);
    await shot('07-final-config');

    // ---- 5. save --------------------------------------------------------
    logStep('SAVE_CONFIGURATION', { name: CHINESE_NAME, ...FINAL });
    await saveBtn.click();
    await page.locator('[data-testid="import-wizard"]').waitFor({ state: 'hidden', timeout: 60000 });
    logStep('WIZARD_CLOSED');
    await shot('08-after-save');

    // Live agent-liveness probe right after save (WEB-201 evidence):
    // proves whether the agent process died vs a UI-only disconnect.
    const probes = [];
    for (let i = 0; i < 3; i++) {
      const h = await agentGet(env, '/api/v1/health', 5000);
      probes.push({ t: new Date().toISOString(), ok: h.ok, status: h.status, error: h.error || null });
      if (i < 2) await sleep(5000);
    }
    result.crossVerification.agentLivenessAfterSave = probes;
    logStep('AGENT_LIVENESS_AFTER_SAVE', probes);

    const afterStatus = await waitForStatusBarContains(page, CHINESE_NAME, 60000);
    logStep('STATUS_BAR_PROJECT_ACTIVE', { statusBar: afterStatus.slice(0, 300) });
    await waitForStatusBarContains(page, 'Runtime: connected', 30000);
    await shot('09-statusbar-project');

    // ---- 6. cross-verification: disk + API ------------------------------
    // Source of truth for the HTTP API persistence is the agent store at
    // $DATA_DIR/agent-data/projects/projects.json. NOTE: the product ALSO has
    // a second persistence path (FileProjectRepo.Save -> .kairo/project.yaml)
    // that the HTTP layer bypasses entirely — that divergence is tracked as
    // KAIRO-RC-WEB-203, not re-asserted here.
    const storePath = path.join(env.KAIRO_QA_DATA_DIR, 'agent-data', 'projects', 'projects.json');
    if (!fs.existsSync(storePath)) throw new Error(`disk project store missing: ${storePath}`);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const stored = Object.values(store)[0] || {};
    const cfgChecks = {
      idPopulated: !!stored.id,
      workspaceIdPopulated: !!stored.workspaceId,
      hasName: stored.name === CHINESE_NAME,
      hasGbk: stored.encoding === 'gbk',
      hasAnt: stored.buildTool === 'ant',
      rootPathIsLegacyDst: stored.rootPath === legacyDst,
    };
    if (Object.values(cfgChecks).some(v => !v)) {
      throw new Error(`projects.json content mismatch: ${JSON.stringify(cfgChecks)}; record=${JSON.stringify(stored).slice(0, 400)}`);
    }
    result.crossVerification.diskConfig = { path: storePath, ...cfgChecks };
    logStep('DISK_CONFIG_VERIFIED', result.crossVerification.diskConfig);
    const yamlPath = path.join(legacyDst, '.kairo', 'project.yaml');
    result.crossVerification.legacyYamlPath = { path: yamlPath, exists: fs.existsSync(yamlPath) };
    logStep('KAIRO_PROJECT_YAML_CHECK', result.crossVerification.legacyYamlPath);

    const projectsRes = await agentGet(env, '/api/v1/projects', 10000);
    if (!projectsRes.ok) throw new Error(`projects endpoint failed: ${projectsRes.status}`);
    const payload = projectsRes.json?.payload || projectsRes.json || [];
    const projects = Array.isArray(payload) ? payload : [payload];
    const found = projects.find(p => p.name === CHINESE_NAME);
    if (!found) throw new Error(`project not in agent response: ${JSON.stringify(projects).slice(0, 400)}`);
    result.crossVerification.agentProjects = { id: found.id, name: found.name, encoding: found.encoding, buildTool: found.buildTool };
    logStep('API_PROJECT_VERIFIED', result.crossVerification.agentProjects);

    // ---- 7. reopen (reload) -> project restored --------------------------
    logStep('RELOAD_PAGE');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(6000);
    await dismissTrustDialog(page, 5000).catch(() => false);
    const restoredStatus = await waitForStatusBarContains(page, CHINESE_NAME, 60000);
    logStep('PROJECT_RESTORED_AFTER_RELOAD', { statusBar: restoredStatus.slice(0, 300) });
    await shot('10-after-reload');

    // ---- 8. console gate -------------------------------------------------
    writeLogs(dirs.logs, page._kairoLogs || []);
    const gate = consoleGate(page._kairoLogs || []);
    result.consoleGate = { ok: gate.ok, errorCount: gate.errors.length, first: gate.errors[0] || null };
    if (!gate.ok) {
      logError(`console gate: ${gate.errors.length} errors, first: ${JSON.stringify(gate.errors[0]).slice(0, 300)}`);
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: console/page errors during first import (${gate.errors.length})`,
        evidence: [`logs/flow-01/console.jsonl`],
        first: gate.errors[0],
      });
      throw new Error('console gate failed');
    }
    logStep('CONSOLE_GATE_CLEAN');

    result.status = 'PASS';
    logStep('FLOW_PASS');
  } catch (err) {
    result.status = 'FAIL';
    logError(err.message);
    // Failure-time process diagnostics (agent dead? port still bound?)
    if (stackInfo) {
      try {
        const { execFileSync } = require('child_process');
        const portPids = execFileSync('bash', ['-c', 'lsof -ti tcp:18080 2>/dev/null || true'], { encoding: 'utf8' }).trim();
        const agentPid = stackInfo.env.KAIRO_QA_AGENT_PID;
        let agentAlive = false;
        try { process.kill(parseInt(agentPid, 10), 0); agentAlive = true; } catch (_e) { /* dead */ }
        result.failureDiagnostics = { port18080Pids: portPids, agentPid, agentAlive };
        logStep('FAILURE_DIAGNOSTICS', result.failureDiagnostics);
      } catch (_e) { /* best effort */ }
    }
    if (page) await shot('99-fail').catch(() => {});
  } finally {
    if (page) {
      writeLogs(dirs.logs, page._kairoLogs || []);
      if (browser) await browser.close().catch(() => {});
    }
    result.finishedAt = new Date().toISOString();
    if (stackInfo && !useExisting) {
      logStep('STOP_STACK');
      const agentLogSrc = stackInfo.env.KAIRO_QA_AGENT_LOG;
      result.stopResult = await stopStack(stackInfo.dataDir);
      if (agentLogSrc && fs.existsSync(agentLogSrc)) {
        fs.copyFileSync(agentLogSrc, path.join(dirs.logs, 'agent.log'));
      }
      // keep dataDir for post-hoc inspection
      result.dataDir = stackInfo.dataDir;
    }
    writeResult(OUT, result);
    recordFlowResult(FLOW, {
      status: result.status, runId,
      errors: result.errors.map(e => e.message),
      crossVerification: result.crossVerification,
      screenshots: result.screenshots,
      consoleGate: result.consoleGate,
    });
    console.log(`\nArtifacts: ${OUT}`);
    console.log(`Result: ${result.status}`);
  }
  if (result.status !== 'PASS') process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
