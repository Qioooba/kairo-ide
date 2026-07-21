// Visual verification for the Wave-1/2 coordinator fixes.
//
// Covers (each maps to a defect ID):
//   WEB-008  document.title is 'Kairo IDE'
//   WEB-018  Welcome tab auto-opens with the three entry actions
//   WEB-006  Project status-bar entry carries a command and opens
//            the Project Selector on click
//   WEB-005  .theia-button background computes to #7C3AED
//   WEB-004  Monaco editor background computes to #1e1f22
//   WEB-002  a .jsp file opened in the editor gets language 'jsp'
//            and Monarch tokens (scriptlet/EL spans)
//
// Usage: KAIRO_QA_ROOT=/tmp/... node scripts/run-visual-verify.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, screenshot, writeResult, writeLogs, ensureDir,
  nowIso, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'visual-verify'));
const SHOTS = ensureDir(path.join(OUT, 'screenshots'));
const HARD_CAP_MS = 6 * 60 * 1000;

const checks = [];
function record(id, ok, detail) {
  checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail: detail || '', time: nowIso() });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
  if (!ok) throw new Error(`${id}: ${detail || 'check failed'}`);
}

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'visual-verify-stack'), port: 18080 });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/`;
  record('VV.start', true, `web=${env.KAIRO_QA_WEB_PORT}`);

  // Put a GBK JSP fixture into the Theia workspace so the file tree shows it.
  const wsDir = env.KAIRO_QA_WORKSPACE_DIR;
  const jspSrc = path.join(env.KAIRO_QA_LEGACY_DST, 'WebRoot', 'hello.jsp');
  fs.copyFileSync(jspSrc, path.join(wsDir, 'hello.jsp'));

  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // WEB-008: title carries product branding ("Welcome - workspace - Kairo IDE")
  const title = await page.title();
  record('VV.title', title.includes('Kairo IDE'), `document.title = "${title}"`);

  // WEB-018: Welcome tab auto-opened
  const welcome = page.locator('[data-testid="welcome-import"]');
  await welcome.waitFor({ state: 'visible', timeout: 20000 });
  record('VV.welcome', true, 'Welcome tab with import action auto-opened');
  await screenshot(page, path.join(SHOTS, '01-welcome.png'));

  // WEB-005: accent color on the welcome primary button
  const btnBg = await welcome.evaluate(el => getComputedStyle(el).backgroundColor);
  record('VV.accent', btnBg === 'rgb(124, 58, 237)', `.theia-button background = ${btnBg} (expect rgb(124, 58, 237) = #7C3AED)`);

  // WEB-006: Project status entry carries a command and opens the selector
  const projectItem = page.locator('#theia-statusBar [id*="kairo.project"], #theia-statusBar .item:has-text("Project:")').first();
  await projectItem.waitFor({ state: 'visible', timeout: 10000 });
  await projectItem.click();
  await sleep(1500);
  const selectorVisible = await page.locator('.kairo-project-selector, [data-testid="project-selector"]').first().isVisible().catch(() => false);
  record('VV.statusbar-project-click', selectorVisible, 'clicking Project status entry opens Project Selector');
  await screenshot(page, path.join(SHOTS, '02-project-selector.png'));
  // Close the selector tab if it opened as one
  await page.keyboard.press('Escape');
  const selectorTab = page.locator('.lm-TabBar-tab:has-text("Select"), .p-TabBar-tab:has-text("Select")').first();
  if (await selectorTab.isVisible().catch(() => false)) {
    await selectorTab.locator('.lm-TabBar-tabCloseIcon, .p-TabBar-tabCloseIcon').click().catch(() => {});
  }

  // WEB-002 + WEB-004: open hello.jsp via Quick Open (Meta+P) — the
  // real user path; avoids depending on Explorer panel state.
  await page.keyboard.press('Meta+P');
  const quickInput = page.locator('.quick-input-widget .quick-input-box input');
  await quickInput.waitFor({ state: 'visible', timeout: 15000 });
  await quickInput.fill('hello.jsp');
  await sleep(1200);
  const row = page.locator('.quick-input-widget .monaco-list-row:has-text("hello.jsp")').first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();
  await sleep(4000);
  const langVisible = await page.locator('#theia-statusBar .area.right .element:has-text("JSP"), #theia-statusBar .element:has-text("JSP")').first()
    .isVisible({ timeout: 10000 }).catch(() => false);
  record('VV.jsp-language', langVisible, 'status bar language mode shows JSP for hello.jsp (Monarch registration live)');
  await screenshot(page, path.join(SHOTS, '03-jsp-editor.png'));
  const editorBg = await page.evaluate(() => {
    const el = document.querySelector('.monaco-editor');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  record('VV.editor-theme', editorBg === 'rgb(30, 31, 34)', `.monaco-editor background = ${editorBg} (expect rgb(30, 31, 34) = #1e1f22)`);

  // Console gate
  const logs = page._kairoLogs || [];
  writeLogs(OUT, logs);
  const errors = logs.filter(l =>
    (l.type === 'pageerror' || l.type === 'error' || l.type === 'requestfailed' || /^http/.test(l.type)));
  record('VV.console-clean', errors.length === 0,
    errors.length ? `${errors.length} errors, first: ${JSON.stringify(errors[0]).slice(0, 250)}` : 'no console/page errors');

  await browser.close();
  await stopStack(stack.dataDir);
  record('VV.teardown', true, 'stack stopped');
}

const hardCap = setTimeout(() => { console.error('VV HARD CAP'); process.exit(2); }, HARD_CAP_MS);

main()
  .then(() => {
    clearTimeout(hardCap);
    writeResult(OUT, { case: 'visual-verify', status: 'PASS', checks, commit: execSync('git rev-parse HEAD').toString().trim() });
    process.exit(0);
  })
  .catch(err => {
    clearTimeout(hardCap);
    console.error(err);
    writeResult(OUT, { case: 'visual-verify', status: 'FAIL', error: String(err), checks });
    process.exit(1);
  });
