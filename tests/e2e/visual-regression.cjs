// Kairo visual regression smoke — real headed browser, real product.
// Captures baseline screenshots of the Theia shell and key Kairo views,
// and fails on browser console errors, page errors, or unhandled rejections.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const theiaUrl = process.argv[2] || 'http://127.0.0.1:3000';
const outDir = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const consoleErrors = [];
const pageErrors = [];
const unhandledRejections = [];

function step(name) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${name}`);
}
function fail(msg) {
  console.log(`  FAIL  ${msg}`);
  failures.push(msg);
}
function pass(msg) {
  console.log(`  PASS  ${msg}`);
}

(async () => {
  step(`Navigating to ${theiaUrl} (headed)`);
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') {
      const text = m.text();
      consoleErrors.push(text);
      fail(`console error: ${text.slice(0, 200)}`);
    }
  });
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    fail(`page error: ${e.message.slice(0, 200)}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.startsWith('http://127.0.0.1')) return;
    fail(`failed request: ${req.method()} ${url} — ${req.failure()?.errorText || 'unknown'}`);
  });
  process.on('unhandledRejection', (reason) => {
    unhandledRejections.push(String(reason));
    fail(`unhandled rejection: ${String(reason).slice(0, 200)}`);
  });

  try {
    await page.goto(theiaUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('#theia-statusBar', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    pass('Theia shell rendered');
    await page.screenshot({ path: path.join(outDir, 'visual-shell.png'), fullPage: false });

    step('Capturing command palette');
    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, 'visual-command-palette.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    step('Checking Kairo status bar entries');
    const sbText = await page.evaluate(() => {
      const sb = document.querySelector('#theia-statusBar');
      return sb ? (sb.textContent || '') : '';
    });
    const required = ['Runtime:'];
    const missing = required.filter((r) => !sbText.includes(r));
    if (missing.length) {
      fail(`status bar missing: ${missing.join(', ')}`);
    } else {
      pass('status bar shows Runtime entry');
    }

    if (failures.length === 0) {
      console.log('\nOK — visual regression smoke passed');
      await browser.close();
      process.exit(0);
    } else {
      console.log(`\nFAIL — visual regression smoke: ${failures.length} failure(s)`);
      await browser.close();
      process.exit(1);
    }
  } catch (err) {
    fail(`crash: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
})();
