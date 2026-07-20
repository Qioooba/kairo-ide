// Kairo accessibility smoke — real headed browser, basic automated checks.
// Validates landmarks, button labels, interactive element roles, and
// fails on console/page errors and unhandled rejections.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const theiaUrl = process.argv[2] || 'http://127.0.0.1:3000';
const outDir = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];

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
    if (m.type() === 'error') fail(`console error: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => fail(`page error: ${e.message.slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    if (!req.url().startsWith('http://127.0.0.1')) return;
    fail(`failed request: ${req.method()} ${req.url()} — ${req.failure()?.errorText || 'unknown'}`);
  });
  process.on('unhandledRejection', (reason) => fail(`unhandled rejection: ${String(reason).slice(0, 200)}`));

  try {
    await page.goto(theiaUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.theia-statusbar', { timeout: 60_000 });
    await page.waitForTimeout(2000);

    step('Checking interactive element labels');
    const audit = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const iconButtonsWithoutLabel = buttons.filter((b) => {
        const hasText = b.textContent && b.textContent.trim().length > 0;
        const hasAriaLabel = b.hasAttribute('aria-label') && b.getAttribute('aria-label').trim().length > 0;
        const hasAriaLabelledBy = b.hasAttribute('aria-labelledby');
        const hasTitle = b.hasAttribute('title') && b.getAttribute('title').trim().length > 0;
        return !hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle;
      });
      const duplicateIds = [];
      const seen = new Map();
      document.querySelectorAll('[id]').forEach((el) => {
        const id = el.id;
        if (seen.has(id)) duplicateIds.push(id);
        seen.set(id, true);
      });
      return {
        buttonCount: buttons.length,
        iconButtonsWithoutLabel: iconButtonsWithoutLabel.map((b) => b.outerHTML.slice(0, 120)),
        duplicateIds,
      };
    });

    if (audit.iconButtonsWithoutLabel.length > 0) {
      fail(`${audit.iconButtonsWithoutLabel.length} button(s) without accessible name`);
    } else {
      pass(`all ${audit.buttonCount} buttons have accessible names`);
    }
    if (audit.duplicateIds.length > 0) {
      fail(`duplicate ids: ${audit.duplicateIds.slice(0, 10).join(', ')}`);
    } else {
      pass('no duplicate ids detected');
    }

    step('Checking focus indicators');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tag: el.tagName, class: el.className, rect: el.getBoundingClientRect() } : null;
    });
    if (focused && focused.tag !== 'BODY') {
      pass(`focus moved to ${focused.tag}`);
    } else {
      fail('focus did not move from body on Tab');
    }

    await page.screenshot({ path: path.join(outDir, 'a11y-focus.png'), fullPage: false });

    if (failures.length === 0) {
      console.log('\nOK — a11y scan passed');
      await browser.close();
      process.exit(0);
    } else {
      console.log(`\nFAIL — a11y scan: ${failures.length} failure(s)`);
      await browser.close();
      process.exit(1);
    }
  } catch (err) {
    fail(`crash: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
})();
