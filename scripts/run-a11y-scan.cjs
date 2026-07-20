#!/usr/bin/env node
/**
 * run-a11y-scan.cjs
 * Playwright + axe-core accessibility scan for Kairo IDE Web.
 * Exits non-zero on critical or serious violations.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const URL = process.env.KAIRO_URL || 'http://127.0.0.1:3000';
const OUT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa-m3';
const SCREENSHOTS = path.join(OUT, 'm3', 'screenshots', 'a11y');
const COMMANDS = path.join(OUT, 'm3', 'commands');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function now() { return new Date().toISOString(); }

async function ensureDirs() {
  for (const d of [SCREENSHOTS, COMMANDS]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function writeCommandMeta(name, start, end, exitCode, extra = {}) {
  const meta = {
    command: `scripts/run-a11y-scan.cjs`,
    case: name,
    url: URL,
    start,
    end,
    elapsedMs: end - start,
    exitCode,
    ...extra,
  };
  fs.writeFileSync(path.join(COMMANDS, `${name}.json`), JSON.stringify(meta, null, 2));
}

async function waitForShell(page) {
  // Wait for Theia shell to be rendered
  await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
  // Give dynamic contributions a moment
  await sleep(2000);
}

async function scanPage(page, name) {
  const screenshotPath = path.join(SCREENSHOTS, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return { screenshotPath, results };
}

async function run() {
  const start = Date.now();
  await ensureDirs();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const report = {
    url: URL,
    testedAt: now(),
    viewport: '1440x900',
    scans: [],
    summary: { violations: 0, critical: 0, serious: 0, moderate: 0, minor: 0 },
  };

  let exitCode = 0;

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await waitForShell(page);

    // Scan shell / workbench
    const shell = await scanPage(page, '01-shell');
    report.scans.push({ name: 'shell', ...shell.results });

    // Try to open Import Wizard via command palette
    await page.keyboard.press('F1');
    await sleep(500);
    await page.keyboard.type('Kairo: Import Project');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
    const importWizard = await scanPage(page, '02-import-wizard');
    report.scans.push({ name: 'import-wizard', ...importWizard.results });

    // Close wizard if possible
    await page.keyboard.press('Escape');
    await sleep(500);

    // Open Project Selector
    await page.keyboard.press('F1');
    await sleep(500);
    await page.keyboard.type('Kairo: Open Project Selector');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
    const projectSelector = await scanPage(page, '03-project-selector');
    report.scans.push({ name: 'project-selector', ...projectSelector.results });
    await page.keyboard.press('Escape');
    await sleep(500);

    // Open Build View
    await page.keyboard.press('F1');
    await sleep(500);
    await page.keyboard.type('Kairo: Open Build View');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
    const buildView = await scanPage(page, '04-build-view');
    report.scans.push({ name: 'build-view', ...buildView.results });

    // Open Server View
    await page.keyboard.press('F1');
    await sleep(500);
    await page.keyboard.type('Kairo: Open Server View');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
    const serverView = await scanPage(page, '05-server-view');
    report.scans.push({ name: 'server-view', ...serverView.results });

    // Open Deployments View
    await page.keyboard.press('F1');
    await sleep(500);
    await page.keyboard.type('Kairo: Open Deployments View');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(1000);
    const deploymentsView = await scanPage(page, '06-deployments-view');
    report.scans.push({ name: 'deployments-view', ...deploymentsView.results });

    // Compute summary
    for (const scan of report.scans) {
      for (const v of scan.violations || []) {
        report.summary.violations += v.nodes.length;
        report.summary[v.impact] = (report.summary[v.impact] || 0) + v.nodes.length;
        if (v.impact === 'critical' || v.impact === 'serious') exitCode = 1;
      }
    }

    // Simple duplicate ID check
    const dupIds = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
      const seen = new Set();
      const dups = new Set();
      for (const id of ids) { if (seen.has(id)) dups.add(id); else seen.add(id); }
      return Array.from(dups);
    });
    report.duplicateIds = dupIds;
    if (dupIds.length > 0) {
      report.summary.violations += dupIds.length;
      exitCode = 1;
    }

  } catch (err) {
    report.error = err.message;
    exitCode = 2;
    await page.screenshot({ path: path.join(SCREENSHOTS, 'error.png') });
  } finally {
    await browser.close();
  }

  const end = Date.now();
  report.elapsedMs = end - start;

  // Write JSON report
  const jsonPath = path.join(OUT, 'm3', 'a11y-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Write CSV summary
  const csvPath = path.join(OUT, 'm3', 'a11y-report.csv');
  const lines = ['scan,impact,rule,help,nodes'];
  for (const scan of report.scans) {
    for (const v of scan.violations || []) {
      lines.push(`${scan.name},${v.impact},"${v.id}","${(v.help || '').replace(/"/g, '""')}",${v.nodes.length}`);
    }
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  // Write Markdown report
  const md = [
    '# Kairo IDE macOS Web M3 Accessibility Report',
    `- **URL:** ${URL}`,
    `- **Tested at:** ${report.testedAt}`,
    `- **Viewport:** ${report.viewport}`,
    `- **Elapsed:** ${report.elapsedMs}ms`,
    '',
    '## Summary',
    JSON.stringify(report.summary, null, 2),
    '',
    '## Scans',
    ...report.scans.map((s) => `- **${s.name}**: ${(s.violations || []).length} violation types, ${(s.violations || []).reduce((a, v) => a + (v.nodes || []).length, 0)} impacted nodes`),
    '',
    '## Violations',
    ...report.scans.flatMap((s) => (s.violations || []).map((v) => `- [${v.impact}] ${s.name} / ${v.id}: ${v.help} (${v.nodes.length} nodes)`)),
    '',
    report.duplicateIds?.length ? `## Duplicate IDs: ${report.duplicateIds.join(', ')}` : '## Duplicate IDs: none',
    report.error ? `## Error: ${report.error}` : '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'm3', 'a11y-report.md'), md);

  writeCommandMeta('a11y-scan', start, end, exitCode, { summary: report.summary, duplicateIds: report.duplicateIds });

  console.log(`A11y scan complete: ${jsonPath}`);
  console.log(`Summary: ${JSON.stringify(report.summary)}`);
  process.exit(exitCode);
}

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
