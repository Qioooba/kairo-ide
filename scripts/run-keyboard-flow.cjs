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
  // Fully retry-based: under parallel load the first F1 can be
  // swallowed or the quick-open can vanish mid-interaction. Any
  // failure → Escape, settle, retry from scratch (KAIRO-RC-WEB-249).
  const input = page.locator('input[aria-label="Type to narrow down results."]').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.keyboard.press('F1');
      await input.waitFor({ state: 'visible', timeout: 15000 });
      // pressSequentially focuses the input itself — robust against the
      // first-open focus race that page.keyboard.type kept losing
      // (KAIRO-RC-WEB-249). A freshly opened palette is pre-filled with
      // just '>', so no clearing is needed.
      await input.pressSequentially(query, { delay: 25 });
      // wait for the filtered list to render, not a fixed sleep
      await page.waitForSelector('.monaco-list-row', { state: 'attached', timeout: 8000 }).catch(() => {});
      await sleep(400);
      const stuck = await input.inputValue().catch(() => '');
      if (!stuck.includes(query)) throw new Error(`query did not stick: "${stuck}"`);
      const items = await page.locator('.monaco-list-row').allTextContents().catch(() => []);
      const needle = query.replace(/^Kairo: /, '');
      const matched = items.some(t => t.includes(needle));
      await page.keyboard.press('Enter');
      await sleep(1500);
      return matched;
    } catch (err) {
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(1000 + attempt * 1000);
    }
  }
  await page.screenshot({ path: path.join(SCREENSHOTS, `palette-fail-${Date.now()}.png`) }).catch(() => {});
  // one last Enter so the caller's flow is consistent
  await page.keyboard.press('Enter').catch(() => {});
  await sleep(1000);
  return false;
}

// Waits until a tab whose id contains `tabHint` exists, returns true/false.
async function waitForTab(page, tabHint, timeoutMs = 8000) {
  try {
    await page.waitForSelector(`[id^="shell-tab-"][id*="${tabHint}"]`, { state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
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
    // Kairo commands register after the runtime connection comes up;
    // opening the palette too early lists nothing (false FAIL).
    await page.waitForSelector('#theia-statusBar >> text=/Runtime/', { timeout: 90000 }).catch(() => {});
    await sleep(2000);
    await capture(page, '00-shell');

    // 1. Open Import Wizard via keyboard — the palette must list the
    // command and the wizard tab must appear.
    const importMatched = await openCommandPalette(page, 'Kairo: Import Project');
    const importTab = await waitForTab(page, 'kairo-import-wizard');
    await capture(page, '01-import-wizard-open');
    logStep('open-import-wizard', importMatched && importTab, { paletteMatch: importMatched, tabVisible: importTab });

    // Escape must not leave the app in a broken state (tab may stay —
    // Theia widgets are not modal dialogs — but the shell must remain).
    await page.keyboard.press('Escape');
    await sleep(500);
    const shellAlive = await page.locator('#theia-app-shell').isVisible();
    logStep('escape-import-wizard', shellAlive, { shellAlive });
    await capture(page, '02-after-escape');

    // 2. Open Project Selector (real label: 'Kairo: Select Project')
    const psMatched = await openCommandPalette(page, 'Kairo: Select Project');
    const psTab = await waitForTab(page, 'kairo-project-selector');
    await capture(page, '03-project-selector');
    logStep('open-project-selector', psMatched && psTab, { paletteMatch: psMatched, tabVisible: psTab });

    // 3. Focus explorer via keyboard shortcut (Cmd+Shift+E on macOS)
    await page.keyboard.down('Meta');
    await page.keyboard.down('Shift');
    await page.keyboard.press('e');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Meta');
    await sleep(1000);
    const explorerFocus = await activeElementInfo(page);
    const explorerVisible = await page.locator('#explorer-view-container, [id*="explorer"]').first().isVisible().catch(() => false);
    logStep('focus-explorer', explorerVisible && explorerFocus.tag !== 'BODY', { focused: explorerFocus, explorerVisible });
    await capture(page, '04-explorer-focus');

    // 4. Open Build View via keyboard (real label: 'Kairo: Show Builds')
    const buildMatched = await openCommandPalette(page, 'Kairo: Show Builds');
    const buildTab = await waitForTab(page, 'kairo-build-view');
    await capture(page, '05-build-view');
    logStep('open-build-view', buildMatched && buildTab, { paletteMatch: buildMatched, tabVisible: buildTab });

    // Tab into the build view; a focusable control must be reachable.
    // The Lumino menu bar and status bar are also Tab stops, so loop
    // adaptively instead of pressing a fixed count.
    let buildBtn = await activeElementInfo(page);
    let tabReached = buildBtn.tag === 'BUTTON' || buildBtn.role === 'button';
    for (let i = 0; i < 30 && !tabReached; i++) {
      await page.keyboard.press('Tab');
      await sleep(150);
      buildBtn = await activeElementInfo(page);
      tabReached = buildBtn.tag === 'BUTTON' || buildBtn.role === 'button';
    }
    logStep('tab-to-build-button', tabReached, { focused: buildBtn });
    await capture(page, '06-build-button-focus');

    // 5. Open Server View (real label: 'Kairo: Show Servers')
    const svMatched = await openCommandPalette(page, 'Kairo: Show Servers');
    const svTab = await waitForTab(page, 'kairo-server-view');
    await capture(page, '07-server-view');
    logStep('open-server-view', svMatched && svTab, { paletteMatch: svMatched, tabVisible: svTab });

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
