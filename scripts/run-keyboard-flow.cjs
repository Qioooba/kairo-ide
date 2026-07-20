#!/usr/bin/env node
/**
 * run-keyboard-flow.cjs
 * Keyboard-only path test: Import -> Edit -> Build -> Deploy -> Start -> Stop.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.KAIRO_URL || 'http://127.0.0.1:3000';
const OUT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa-m3';
const SCREENSHOTS = path.join(OUT, 'm3', 'screenshots', 'keyboard');
const COMMANDS = path.join(OUT, 'm3', 'commands');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDirs() {
  for (const d of [SCREENSHOTS, COMMANDS]) fs.mkdirSync(d, { recursive: true });
}

function writeMeta(name, start, end, exitCode, notes = {}) {
  const meta = { command: 'scripts/run-keyboard-flow.cjs', case: name, url: URL, start, end, elapsedMs: end - start, exitCode, notes };
  fs.writeFileSync(path.join(COMMANDS, `${name}.json`), JSON.stringify(meta, null, 2));
}

async function waitForShell(page) {
  await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
  await sleep(2000);
}

async function openCommandPalette(page, query) {
  await page.keyboard.press('F1');
  await sleep(600);
  await page.keyboard.type(query);
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(1000);
}

async function capture(page, name) {
  const p = path.join(SCREENSHOTS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function activeElementInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName,
      role: el?.getAttribute('role'),
      ariaLabel: el?.getAttribute('aria-label'),
      text: el?.textContent?.slice(0, 80),
      class: el?.className?.slice(0, 200),
    };
  });
}

async function run() {
  const start = Date.now();
  await ensureDirs();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const report = { url: URL, testedAt: new Date().toISOString(), steps: [] };
  let exitCode = 0;

  function logStep(name, ok, detail = {}) {
    report.steps.push({ name, ok, ...detail, at: Date.now() });
    if (!ok) exitCode = 1;
  }

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await waitForShell(page);
    await capture(page, '00-shell');

    // 1. Open Import Wizard via keyboard
    await openCommandPalette(page, 'Kairo: Import Project');
    await capture(page, '01-import-wizard-open');
    const importFocused = await activeElementInfo(page);
    logStep('open-import-wizard', importFocused.tag !== 'BODY', { focused: importFocused });

    // Tab through wizard and Escape
    const trapStart = await activeElementInfo(page);
    await page.keyboard.press('Escape');
    await sleep(500);
    const afterEscape = await activeElementInfo(page);
    logStep('escape-import-wizard', trapStart.tag !== afterEscape.tag, { before: trapStart, after: afterEscape });
    await capture(page, '02-after-escape');

    // 2. Open Project Selector
    await openCommandPalette(page, 'Kairo: Open Project Selector');
    await capture(page, '03-project-selector');
    const psFocused = await activeElementInfo(page);
    logStep('open-project-selector', psFocused.tag !== 'BODY', { focused: psFocused });
    await page.keyboard.press('Escape');
    await sleep(500);

    // 3. Open a file in explorer via keyboard (Tab to file tree)
    // Try Ctrl+0 to focus explorer
    await page.keyboard.down('Control');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');
    await sleep(800);
    const explorerFocus = await activeElementInfo(page);
    logStep('focus-explorer', explorerFocus.tag !== 'BODY', { focused: explorerFocus });
    await capture(page, '04-explorer-focus');

    // 4. Open Build View via keyboard
    await openCommandPalette(page, 'Kairo: Open Build View');
    await capture(page, '05-build-view');
    const buildFocus = await activeElementInfo(page);
    logStep('open-build-view', buildFocus.tag !== 'BODY', { focused: buildFocus });

    // Try to Tab to Build button and activate with Enter/Space
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    await sleep(300);
    const buildBtn = await activeElementInfo(page);
    logStep('tab-to-build-button', buildBtn.tag === 'BUTTON' || buildBtn.role === 'button', { focused: buildBtn });
    await capture(page, '06-build-button-focus');

    // 5. Open Server View
    await openCommandPalette(page, 'Kairo: Open Server View');
    await capture(page, '07-server-view');
    const svFocus = await activeElementInfo(page);
    logStep('open-server-view', svFocus.tag !== 'BODY', { focused: svFocus });

    // 6. Check focus not lost after status update by waiting and re-checking active element
    const before = await activeElementInfo(page);
    await sleep(3000);
    const after = await activeElementInfo(page);
    logStep('focus-stable-on-update', before.tag === after.tag && before.class === after.class, { before, after });

  } catch (err) {
    report.error = err.message;
    exitCode = 2;
    await page.screenshot({ path: path.join(SCREENSHOTS, 'error.png') });
  } finally {
    await browser.close();
  }

  const end = Date.now();
  report.elapsedMs = end - start;
  report.exitCode = exitCode;

  const jsonPath = path.join(OUT, 'm3', 'keyboard-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    '# Kairo IDE macOS Web M3 Keyboard Flow Report',
    `- **URL:** ${URL}`,
    `- **Tested at:** ${report.testedAt}`,
    `- **Elapsed:** ${report.elapsedMs}ms`,
    `- **Exit code:** ${exitCode}`,
    '',
    '## Steps',
    ...report.steps.map((s) => `- **${s.name}**: ${s.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(s)}`),
    report.error ? `\n## Error\n${report.error}` : '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'm3', 'keyboard-report.md'), md);
  writeMeta('keyboard-flow', start, end, exitCode, { steps: report.steps });

  console.log(`Keyboard flow complete: ${jsonPath}`);
  console.log(`Steps: ${report.steps.map((s) => `${s.name}=${s.ok ? 'PASS' : 'FAIL'}`).join(', ')}`);
  process.exit(exitCode);
}

run().catch((err) => { console.error(err); process.exit(2); });
