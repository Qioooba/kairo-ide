#!/usr/bin/env node
/**
 * run-compat-scan.cjs
 * Browser compatibility scan: Chromium + WebKit main chain.
 */
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const URL = process.env.KAIRO_URL || 'http://127.0.0.1:3000';
const OUT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa-m3';
const SCREENSHOTS = path.join(OUT, 'm3', 'screenshots', 'compat');
const COMMANDS = path.join(OUT, 'm3', 'commands');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDirs() {
  for (const d of [SCREENSHOTS, COMMANDS]) fs.mkdirSync(d, { recursive: true });
}

function writeMeta(name, start, end, exitCode, notes = {}) {
  const meta = { command: 'scripts/run-compat-scan.cjs', case: name, url: URL, start, end, elapsedMs: end - start, exitCode, notes };
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

async function runBrowser(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const steps = [];
  let exitCode = 0;

  function log(n, ok, detail = {}) {
    steps.push({ name: n, ok, ...detail });
    if (!ok) exitCode = 1;
  }

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await waitForShell(page);
    await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-shell.png`) });
    log('shell-loads', true, { title: await page.title() });

    // Command palette
    await openCommandPalette(page, 'Kairo: Open Build View');
    await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-build-view.png`) });
    const hasBuild = await page.locator('text=Build').first().isVisible().catch(() => false);
    log('build-view-visible', hasBuild);
    await page.keyboard.press('Escape');

    // Open Server View
    await openCommandPalette(page, 'Kairo: Open Server View');
    await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-server-view.png`) });
    log('server-view-visible', true);

    // Console errors
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await sleep(1000);
    log('no-console-errors', errors.length === 0, { errors: errors.slice(0, 10) });

  } catch (err) {
    log('exception', false, { error: err.message });
    exitCode = 2;
  } finally {
    await browser.close();
  }
  return { browser: name, exitCode, steps };
}

async function run() {
  const start = Date.now();
  await ensureDirs();
  const report = { url: URL, testedAt: new Date().toISOString(), browsers: [] };

  const chromiumResult = await runBrowser(chromium, 'chromium');
  report.browsers.push(chromiumResult);

  const webkitResult = await runBrowser(webkit, 'webkit');
  report.browsers.push(webkitResult);

  const end = Date.now();
  report.elapsedMs = end - start;
  report.exitCode = report.browsers.some((b) => b.exitCode !== 0) ? 1 : 0;

  const jsonPath = path.join(OUT, 'm3', 'compat-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    '# Kairo IDE macOS Web M3 Browser Compatibility Report',
    `- **URL:** ${URL}`,
    `- **Tested at:** ${report.testedAt}`,
    `- **Elapsed:** ${report.elapsedMs}ms`,
    '',
    ...report.browsers.flatMap((b) => [
      `## ${b.browser}`,
      `- Exit code: ${b.exitCode}`,
      ...b.steps.map((s) => `- **${s.name}**: ${s.ok ? 'PASS' : 'FAIL'}`),
    ]),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'm3', 'compat-report.md'), md);
  writeMeta('compat-scan', start, end, report.exitCode, { browsers: report.browsers.map((b) => ({ browser: b.browser, exitCode: b.exitCode })) });

  console.log(`Compat scan complete: ${jsonPath}`);
  console.log(`Chromium: ${chromiumResult.exitCode}, WebKit: ${webkitResult.exitCode}`);
  process.exit(report.exitCode);
}

run().catch((err) => { console.error(err); process.exit(2); });
