// Kairo accessibility scan — real axe-core engine in a real
// (headed) browser via @axe-core/playwright.
//
// What it does:
//   1. Boots the Theia shell and runs an axe scan
//      (wcag2a / wcag2aa / wcag21aa) over it.
//   2. Opens each Kairo view through the command palette
//      (Import Wizard, Project Selector, Build View, Server
//      View, Deployments View) and axe-scans each state.
//   3. Keeps the hand-rolled checks axe does not cover:
//      console/page errors, failed local requests, unhandled
//      rejections, and a Tab focus check.
//
// Exit codes:
//   0 = no failures, no critical/serious axe violations
//   1 = failures or critical/serious axe violations
//   2 = the scan itself crashed (stack unreachable, etc.)
//
// Run with:
//   node tests/e2e/a11y-scan.cjs [theiaUrl]
// Requires a running Theia stack (see docs/testing.md) and,
// because it is headed, a display (or Xvfb on Linux).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function axeScan(page, name) {
  const screenshotPath = path.join(outDir, `a11y-${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return { name, screenshotPath, results };
}

async function openViaPalette(page, commandLabel) {
  await page.keyboard.press('F1');
  await sleep(500);
  await page.keyboard.type(commandLabel);
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1000);
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

  const report = {
    url: theiaUrl,
    testedAt: new Date().toISOString(),
    viewport: '1440x900',
    engine: `axe-core via @axe-core/playwright (wcag2a, wcag2aa, wcag21aa)`,
    scans: [],
    summary: { violations: 0, critical: 0, serious: 0, moderate: 0, minor: 0 },
  };

  try {
    await page.goto(theiaUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(2000);

    step('axe scan: Theia shell');
    report.scans.push(await axeScan(page, '01-shell'));

    step('axe scan: Import Wizard');
    await openViaPalette(page, 'Kairo: Import Project');
    report.scans.push(await axeScan(page, '02-import-wizard'));
    await page.keyboard.press('Escape');
    await sleep(500);

    step('axe scan: Project Selector');
    await openViaPalette(page, 'Kairo: Select Project');
    report.scans.push(await axeScan(page, '03-project-selector'));
    await page.keyboard.press('Escape');
    await sleep(500);

    step('axe scan: Build View');
    await openViaPalette(page, 'Kairo: Show Builds');
    report.scans.push(await axeScan(page, '04-build-view'));

    step('axe scan: Server View');
    await openViaPalette(page, 'Kairo: Show Servers');
    report.scans.push(await axeScan(page, '05-server-view'));

    step('axe scan: Deployments View');
    await openViaPalette(page, 'Kairo: Show Deployments');
    report.scans.push(await axeScan(page, '06-deployments-view'));

    for (const scan of report.scans) {
      for (const v of scan.results.violations || []) {
        report.summary.violations += v.nodes.length;
        report.summary[v.impact] = (report.summary[v.impact] || 0) + v.nodes.length;
        if (v.impact === 'critical' || v.impact === 'serious') {
          fail(`axe [${v.impact}] ${scan.name}: ${v.id} — ${v.help} (${v.nodes.length} node(s))`);
        }
      }
      const count = (scan.results.violations || []).length;
      if (count === 0) pass(`${scan.name}: no axe violations`);
    }

    // Duplicate IDs are an axe rule too, but keep the explicit
    // check so the report names the offending ids.
    step('Checking duplicate ids');
    const dupIds = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
      const seen = new Set();
      const dups = new Set();
      for (const id of ids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
      return Array.from(dups);
    });
    report.duplicateIds = dupIds;
    if (dupIds.length > 0) {
      fail(`duplicate ids: ${dupIds.slice(0, 10).join(', ')}`);
    } else {
      pass('no duplicate ids detected');
    }

    step('Checking focus indicators');
    await page.keyboard.press('Escape');
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
  } catch (err) {
    report.error = err.message;
    fail(`crash: ${err.message}`);
    try {
      await page.screenshot({ path: path.join(outDir, 'a11y-error.png'), fullPage: false });
    } catch (_) { /* browser may already be gone */ }
  } finally {
    const jsonPath = path.join(outDir, 'a11y-report.json');
    const slim = {
      ...report,
      scans: report.scans.map((s) => ({
        name: s.name,
        violations: (s.results.violations || []).map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
          // Node-level targets so fixes don't need a second probe run.
          targets: v.nodes.slice(0, 8).map((n) => ({
            target: n.target,
            html: (n.html || '').slice(0, 200),
          })),
        })),
      })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(slim, null, 2));
    const md = [
      '# Kairo IDE accessibility report (axe-core)',
      `- **URL:** ${report.url}`,
      `- **Tested at:** ${report.testedAt}`,
      `- **Engine:** ${report.engine}`,
      '',
      '## Summary',
      '```json',
      JSON.stringify(report.summary, null, 2),
      '```',
      '',
      '## Violations',
      ...(slim.scans.flatMap((s) => s.violations.map((v) => `- [${v.impact}] ${s.name} / ${v.id}: ${v.help} (${v.nodes} nodes)`))),
      '',
      report.duplicateIds && report.duplicateIds.length ? `## Duplicate IDs: ${report.duplicateIds.join(', ')}` : '## Duplicate IDs: none',
      report.error ? `## Error: ${report.error}` : '',
    ].join('\n');
    fs.writeFileSync(path.join(outDir, 'a11y-report.md'), md);
    console.log(`report: ${jsonPath}`);
    await browser.close();
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`OK — a11y scan passed (${JSON.stringify(report.summary)})`);
    process.exit(0);
  } else {
    console.log(`FAIL — a11y scan: ${failures.length} failure(s)`);
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
})().catch((err) => {
  console.error('FAIL — a11y scan crashed:', err);
  process.exit(2);
});
