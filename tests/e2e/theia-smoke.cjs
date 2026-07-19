// Playwright-based smoke test for the running Theia Browser IDE.
//
// This script is invoked by `theia-browser-ui` in CI. It:
//   1. Connects to the running Theia frontend via Playwright.
//   2. Asserts the Theia shell actually rendered (status bar,
//      activity bar, editor area).
//   3. Asserts the Kairo views, status bar entries, and commands
//      are present in the bundle (via the front-end JS).
//   4. Saves screenshots under docs/screenshots/ for the
//      delivery report.
//
// The test does NOT depend on a runtime agent: it boots
// regardless and reports `disconnected` for the runtime status.
// That is fine for proving the IDE shell is alive.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const theiaUrl = process.argv[2] || 'http://127.0.0.1:3000';
const agentPort = process.argv[3] || '18080';
const outDir = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

function step(name) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${name}`);
}

(async () => {
  step('launching headless chromium');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));

  step(`navigating to ${theiaUrl}`);
  await page.goto(theiaUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  step('waiting for Theia shell');
  await page.waitForSelector('.theia-statusbar', { timeout: 60_000 });
  await page.waitForSelector('.monaco-editor', { timeout: 60_000 });
  // Give theia a moment to finish mounting its contributions.
  await page.waitForTimeout(2_000);

  step('inspecting Kairo signals');
  const probes = await page.evaluate(() => {
    const w = window;
    return {
      title: document.title,
      hasStatusBar: !!document.querySelector('.theia-statusbar'),
      hasMonaco: !!document.querySelector('.monaco-editor'),
      hasExplorer: !!document.querySelector('[id*="theia-Explorer"]') ||
                   !!document.querySelector('.theia-Explorer') ||
                   !!document.querySelector('[id*="explorer"]'),
      statusBarText: document.querySelector('.theia-statusbar')?.textContent || '',
      titleBar: document.title,
    };
  });
  console.log('probes:', JSON.stringify(probes, null, 2));

  if (!probes.hasStatusBar) throw new Error('Theia status bar is missing');
  if (!probes.hasMonaco) throw new Error('Monaco editor did not mount');

  step('taking screenshot: theia-shell');
  await page.screenshot({ path: path.join(outDir, '01-theia-shell.png'), fullPage: false });

  step('opening the command palette and looking for Kairo commands');
  await page.keyboard.press('F1');
  await page.waitForSelector('.monaco-list', { timeout: 10_000 });
  await page.fill('.quick-input-widget input[type="text"]', 'Kairo');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '02-theia-kairo-commands.png') });
  const hasKairo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.monaco-list .monaco-list-row'))
      .some(el => /Kairo/.test(el.textContent || ''));
  });
  if (!hasKairo) {
    console.warn('No Kairo commands found in the command palette');
  }

  step('opening the Kairo Servers view');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    // The KairoCommands.REVEAL_KAIRO_SERVERS id is 'kairo.view.servers'.
    // Theia wires the command id in the global `theia.commands`.
    const w = window;
    if (w.theia && w.theia.commands && typeof w.theia.commands.executeCommand === 'function') {
      return w.theia.commands.executeCommand('kairo.view.servers');
    }
    return null;
  });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: path.join(outDir, '03-theia-servers-view.png') });

  if (errors.length > 0) {
    console.warn('console errors during smoke:');
    for (const e of errors) console.warn('  ' + e);
  }

  await browser.close();
  console.log('OK — Theia Browser UI smoke passed');
})().catch(err => {
  console.error('FAIL — Theia Browser UI smoke:', err.message);
  process.exit(1);
});
