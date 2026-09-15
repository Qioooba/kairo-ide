// Kairo visual capture smoke — real headed browser, real product.
//
// UI-08 classification: CAPTURE SMOKE (not a visual gate).
// This script opens the running Theia IDE, saves full-window screenshots,
// DOM geometry and console logs under artifacts/ui-audit/<run-id>/, and
// fails only on browser console errors / page errors / failed requests.
// Saving a PNG is evidence collection — it is NEVER a visual approval.
// Human-approved baselines and pixel gates live in visual-gate.spec.ts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const theiaUrl = process.argv[2] || process.env.THEIA_URL || 'http://127.0.0.1:3000';
const runId = process.env.UI_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const buildSha = process.env.BUILD_SHA || process.env.GIT_SHA || 'unverified';
const artifactsRoot = path.resolve(__dirname, '..', '..', 'artifacts', 'ui-audit', runId);
fs.mkdirSync(artifactsRoot, { recursive: true });

const failures = [];
const consoleEntries = [];

function step(name) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${name}`);
}
function fail(msg) {
  console.log(`  FAIL  ${msg}`);
  failures.push(msg);
}
function pass(msg) {
  console.log(`  PASS  ${msg}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(caseDir, name, data) {
  fs.writeFileSync(path.join(caseDir, name), JSON.stringify(data, null, 2));
}

async function captureCase(page, browser, caseId, setup) {
  const caseDir = path.join(artifactsRoot, buildSha, 'capture-smoke', caseId);
  fs.mkdirSync(caseDir, { recursive: true });
  if (setup) await setup();
  await page.waitForTimeout(600);
  const fullPath = path.join(caseDir, 'full.png');
  await page.screenshot({ path: fullPath, fullPage: false });
  const geometry = await page.evaluate(() => {
    const el = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio,
      shell: el('#theia-app-shell') || el('#theia-statusBar') ? el('#theia-statusBar') : null,
      statusBar: el('#theia-statusBar'),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  writeJson(caseDir, 'geometry.json', geometry);
  writeJson(caseDir, 'browser-log.json', consoleEntries);
  writeJson(caseDir, 'metadata.json', {
    caseId,
    runId,
    sourceSha: buildSha,
    appBuildVerified: false,
    theiaUrl,
    browser: 'chromium',
    browserVersion: browser.version(),
    viewport: { width: 1440, height: 900 },
    devicePixelRatio: geometry.dpr,
    theme: 'dark',
    locale: 'zh-CN',
    screenshotSha256: sha256(fullPath),
    review: { status: 'unreviewed', note: 'capture smoke only; requires human review against an approved baseline (UI-08)' },
  });
  pass(`${caseId} -> ${path.relative(artifactsRoot, fullPath)}`);
}

(async () => {
  step(`Navigating to ${theiaUrl} (headless chromium)`);
  // UI-08: no personal browser paths. Playwright's bundled chromium is the
  // default; CHROMIUM_PATH / channel remain as explicit local overrides.
  const launchOptions = { headless: true };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
  else if (process.env.CHROMIUM_CHANNEL) launchOptions.channel = process.env.CHROMIUM_CHANNEL;
  const browser = await chromium.launch(launchOptions);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    const entry = { type: m.type(), text: m.text().slice(0, 500) };
    consoleEntries.push(entry);
    if (m.type() === 'error') fail(`console error: ${entry.text.slice(0, 200)}`);
  });
  page.on('pageerror', (e) => fail(`page error: ${String(e.message).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) return;
    fail(`failed request: ${req.method()} ${url} — ${req.failure()?.errorText || 'unknown'}`);
  });
  process.on('unhandledRejection', (reason) => fail(`unhandled rejection: ${String(reason).slice(0, 200)}`));

  try {
    await page.goto(theiaUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('#theia-statusBar', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    pass('Theia shell rendered');

    await captureCase(page, browser, 'shell', null);

    await captureCase(page, browser, 'command-palette', async () => {
      await page.keyboard.press('F1');
      await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
      await page.waitForTimeout(500);
    });
    await page.keyboard.press('Escape').catch(() => undefined);

    const sbText = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
    if (!sbText.includes('Agent:')) fail('status bar missing: Agent:');
    else pass('status bar shows Runtime entry');

    if (failures.length === 0) {
      console.log(`\nOK — capture smoke passed. Evidence: ${artifactsRoot}`);
      console.log('NOTE: PNGs are unreviewed captures, not visual approvals. Run test:visual:gate for the baseline gate.');
      await browser.close();
      process.exit(0);
    } else {
      console.log(`\nFAIL — capture smoke: ${failures.length} failure(s)`);
      await browser.close();
      process.exit(1);
    }
  } catch (err) {
    fail(`crash: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
})();
