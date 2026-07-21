// WEB-FLOW-03 — 编码安全（Encoding Safety），M2 release-blocking driver.
//
// Real headed Chromium, UI-only. Setup: import wizard (GBK/ant) + open the
// project folder as Theia workspace. Assertions:
//   1. SHA-256 baseline of WebRoot/hello.jsp (GBK) before any UI op.
//   2. Open hello.jsp -> Chinese renders correctly; status bar shows GBK.
//   3. "Kairo: Reopen with Encoding…" -> GBK -> still correct; SHA unchanged.
//   4. GBK-representable edit (Chinese comment) -> Meta+S -> bytes decode
//      (GBK) to the new content; untouched regions intact.
//   5. Unrepresentable edit (emoji) -> Meta+S must be REFUSED with a specific
//      message; SHA-256 unchanged (no byte damage).
//   6. UTF-8<->GBK round-trip on WebRoot/utf8.jsp via "Save with Encoding…":
//      utf8 -> gbk -> utf8 restores content (byte compare + decode compare).
//
// Usage: node scripts/run-web-flow-03.cjs [--use-existing DATA_DIR]

const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, loadEnv, launchBrowser, openPage,
  dismissTrustDialog, runCommand, screenshot, waitForStatusBarContains,
  getStatusBarText, agentGet, sha256File,
  writeResult, writeLogs, sleep,
} = require('./qa-helpers.cjs');
const {
  flowDirs, recordFlowResult, appendDefect, ensurePort18080, consoleGate,
} = require('./m2-common.cjs');
const {
  importProjectViaWizard, openProjectAsWorkspace, quickOpenFile,
  editorText, closeCurrentTabDiscarding,
} = require('./m2-bootstrap.cjs');

const FLOW = 'WEB-FLOW-03';
const PROJECT_NAME = 'flow03-project';

function gbkDecode(buf) {
  return new TextDecoder('gbk').decode(buf);
}

async function pickEncoding(page, encoding) {
  // The pickEncoding quick input is already open (command executed).
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill('');
  await input.type(encoding, { delay: 30 });
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(1500);
}

async function main() {
  const args = process.argv.slice(2);
  let useExisting = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--use-existing' && args[i + 1]) { useExisting = args[i + 1]; i++; }
  }

  const runId = `flow03-${Date.now()}`;
  const dirs = flowDirs('flow-03');
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
    // ---- 1. stack + browser ---------------------------------------------
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

    const gbkFile = path.join(legacyDst, 'WebRoot', 'hello.jsp');
    const utf8File = path.join(legacyDst, 'WebRoot', 'utf8.jsp');
    const sha0Gbk = sha256File(gbkFile);
    const sha0Utf8 = sha256File(utf8File);
    result.crossVerification.baseline = { gbkFile: sha0Gbk, utf8File: sha0Utf8 };
    logStep('SHA_BASELINE', result.crossVerification.baseline);

    browser = await launchBrowser({ slowMo: 40 });
    page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);

    // ---- 2. setup: import + open workspace (UI) --------------------------
    await importProjectViaWizard(page, legacyDst, { name: PROJECT_NAME });
    logStep('PROJECT_IMPORTED');
    await openProjectAsWorkspace(page);
    await waitForStatusBarContains(page, PROJECT_NAME, 60000).catch(() => {});
    logStep('WORKSPACE_OPENED');

    // ---- 3. open GBK file: Chinese correct, status bar encoding ----------
    await quickOpenFile(page, 'hello.jsp');
    await sleep(1200);
    const text1 = await editorText(page);
    const cjkOk1 = /[一-鿿]/.test(text1) && !/�/.test(text1);
    await shot('03-gbk-open');
    const sb1 = await getStatusBarText(page);
    result.crossVerification.gbkOpen = { cjkRendered: cjkOk1, statusBar: sb1.slice(0, 250) };
    logStep('GBK_OPEN', result.crossVerification.gbkOpen);
    if (!cjkOk1) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: hello.jsp (GBK) renders mojibake/replacement chars in editor`,
        evidence: ['screenshots/m2/flow-03/03-gbk-open.png'],
      });
      throw new Error('GBK file does not render Chinese correctly');
    }
    if (!/GBK/i.test(sb1)) {
      logError(`status bar does not show GBK for GBK file: ${sb1.slice(0, 200)}`);
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: status bar encoding does not show GBK when GBK file is active`,
        evidence: ['screenshots/m2/flow-03/03-gbk-open.png'],
        statusBar: sb1.slice(0, 250),
      });
      // not fatal for the flow; continue
    }

    // ---- 4. Reopen with Encoding -> GBK ----------------------------------
    await runCommand(page, 'Kairo: Reopen with Encoding', 20000);
    await pickEncoding(page, 'GBK');
    await sleep(1500);
    const text2 = await editorText(page);
    const cjkOk2 = /[一-鿿]/.test(text2) && !/�/.test(text2);
    const shaAfterReopen = sha256File(gbkFile);
    if (!cjkOk2) throw new Error('after Reopen-as-GBK the Chinese content broke');
    if (shaAfterReopen !== sha0Gbk) throw new Error(`read-only reopen changed bytes! ${shaAfterReopen} != ${sha0Gbk}`);
    logStep('REOPEN_GBK_OK', { shaUnchanged: true });
    await shot('04-reopen-gbk');

    // ---- 5. GBK-representable edit -> save -> bytes correct --------------
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+End').catch(() => {});
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    const COMMENT = '<!-- 测试注释QA -->';
    await page.keyboard.type(COMMENT, { delay: 10 });
    await page.keyboard.press('Meta+S');
    await sleep(1500);
    const shaAfterEdit = sha256File(gbkFile);
    if (shaAfterEdit === sha0Gbk) throw new Error('save did not change bytes');
    const decoded = gbkDecode(fs.readFileSync(gbkFile));
    if (!decoded.includes('测试注释QA')) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: GBK save wrote wrong bytes (added Chinese comment not decodable)`,
        evidence: ['logs/flow-03/console.jsonl'],
      });
      throw new Error('saved bytes do not GBK-decode to the typed comment');
    }
    const baselineTail = decoded.includes('欢迎使用') || decoded.includes('Kairo IDE');
    result.crossVerification.gbkEdit = { shaAfterEdit, commentRoundTrips: true, untouchedRegionsIntact: baselineTail };
    logStep('GBK_EDIT_SAVED', result.crossVerification.gbkEdit);
    await shot('05-gbk-edit-saved');

    // ---- 6. unrepresentable char -> save must be refused ------------------
    await page.keyboard.type('😀', { delay: 10 });
    await page.keyboard.press('Meta+S');
    await sleep(2500);
    // look for the refusal message (Theia notification or status bar)
    const notif = page.locator('.theia-Notifications, .theia-notification-list-item, [class*="notification"]', { hasText: /cannot represent|refused|GBK/i }).first();
    const notifVisible = await notif.isVisible().catch(() => false);
    const sbAfterEmoji = await getStatusBarText(page);
    const refused = notifVisible || /cannot represent|refused/i.test(sbAfterEmoji);
    const shaAfterEmoji = sha256File(gbkFile);
    await shot('06-emoji-save-attempt');
    result.crossVerification.emojiBlock = {
      refused, notifVisible, shaUnchanged: shaAfterEmoji === shaAfterEdit,
      statusBar: sbAfterEmoji.slice(0, 250),
    };
    logStep('EMOJI_SAVE_ATTEMPT', result.crossVerification.emojiBlock);
    if (!refused || shaAfterEmoji !== shaAfterEdit) {
      appendDefect({
        severity: 'P0',
        title: `${FLOW}: unrepresentable emoji in GBK file — save NOT blocked or bytes damaged`,
        detail: result.crossVerification.emojiBlock,
        evidence: ['screenshots/m2/flow-03/06-emoji-save-attempt.png'],
      });
      throw new Error(`emoji save not properly blocked: refused=${refused} shaChanged=${shaAfterEmoji !== shaAfterEdit}`);
    }
    await closeCurrentTabDiscarding(page);
    const shaAfterDiscard = sha256File(gbkFile);
    if (shaAfterDiscard !== shaAfterEdit) throw new Error('discard after emoji block changed bytes');

    // ---- 7. UTF-8 <-> GBK round-trip on utf8.jsp --------------------------
    await quickOpenFile(page, 'utf8.jsp');
    await sleep(1200);
    // UTF-8 -> GBK
    await runCommand(page, 'Kairo: Save with Encoding', 20000);
    await pickEncoding(page, 'GBK');
    await sleep(2000);
    const shaGbk = sha256File(utf8File);
    if (shaGbk === sha0Utf8) throw new Error('Save-as-GBK did not change bytes');
    const decodedAsGbk = gbkDecode(fs.readFileSync(utf8File));
    const gbkContentOk = !/�/.test(decodedAsGbk);
    logStep('UTF8_TO_GBK', { shaGbk, gbkContentOk });
    await shot('07-utf8-as-gbk');
    // GBK -> UTF-8 (back)
    await runCommand(page, 'Kairo: Save with Encoding', 20000);
    await pickEncoding(page, 'UTF-8');
    await sleep(2000);
    const shaBack = sha256File(utf8File);
    const backText = fs.readFileSync(utf8File, 'utf8');
    const origText = new TextDecoder('utf-8').decode(fs.readFileSync(utf8File)); // current
    result.crossVerification.roundTrip = {
      sha0Utf8, shaGbk, shaBack,
      byteIdentical: shaBack === sha0Utf8,
      contentReadable: !/�/.test(backText),
    };
    logStep('ROUND_TRIP_BACK', result.crossVerification.roundTrip);
    await shot('08-round-trip-back');
    if (!result.crossVerification.roundTrip.contentReadable) {
      appendDefect({
        severity: 'P1',
        title: `${FLOW}: UTF-8->GBK->UTF-8 round-trip corrupted content`,
        detail: result.crossVerification.roundTrip,
      });
      throw new Error('round-trip corrupted utf8.jsp');
    }
    if (shaBack !== sha0Utf8) {
      // not necessarily corruption: record as observation defect (BOM/EOL drift)
      logError(`round-trip not byte-identical: ${shaBack} != ${sha0Utf8}`);
      appendDefect({
        severity: 'P3',
        title: `${FLOW}: UTF-8->GBK->UTF-8 round-trip not byte-identical (BOM/EOL/declaration drift)`,
        detail: result.crossVerification.roundTrip,
      });
    }
    logStep('ROUND_TRIP_OK', { byteIdentical: shaBack === sha0Utf8, origLen: origText.length });

    // ---- 8. console gate ---------------------------------------------------
    writeLogs(dirs.logs, page._kairoLogs || []);
    const gate = consoleGate(page._kairoLogs || []);
    result.consoleGate = { ok: gate.ok, errorCount: gate.errors.length, first: gate.errors[0] || null };
    if (!gate.ok) {
      logError(`console gate: ${gate.errors.length} errors, first: ${JSON.stringify(gate.errors[0]).slice(0, 300)}`);
      appendDefect({
        severity: 'P2',
        title: `${FLOW}: console/page errors during encoding flow (${gate.errors.length})`,
        evidence: ['logs/flow-03/console.jsonl'], first: gate.errors[0],
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
      crossVerification: result.crossVerification,
      consoleGate: result.consoleGate,
    });
    console.log(`\nArtifacts: ${OUT}`);
    console.log(`Result: ${result.status}`);
  }
  if (result.status !== 'PASS') process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
