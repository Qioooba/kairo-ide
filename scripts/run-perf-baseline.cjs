#!/usr/bin/env node
/**
 * run-perf-baseline.cjs
 * Performance baseline measurements for Kairo IDE Web.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.KAIRO_URL || 'http://127.0.0.1:3000';
const OUT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa-m3';
const SCREENSHOTS = path.join(OUT, 'm3', 'screenshots', 'perf');
const COMMANDS = path.join(OUT, 'm3', 'commands');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDirs() {
  for (const d of [SCREENSHOTS, COMMANDS]) fs.mkdirSync(d, { recursive: true });
}

function writeMeta(name, start, end, exitCode, notes = {}) {
  const meta = { command: 'scripts/run-perf-baseline.cjs', case: name, url: URL, start, end, elapsedMs: end - start, exitCode, notes };
  fs.writeFileSync(path.join(COMMANDS, `${name}.json`), JSON.stringify(meta, null, 2));
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p95 = sorted[Math.ceil(n * 0.95) - 1];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  return { n, min, max, mean: Math.round(mean), median, p95 };
}

async function measureColdStart(browserType, contextOptions) {
  const results = [];
  for (let i = 0; i < 5; i++) {
    const browser = await browserType.launch({ headless: true });
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const start = performance.now();
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
    const end = performance.now();
    results.push(end - start);
    await browser.close();
  }
  return { name: 'cold-start-to-shell', unit: 'ms', values: results, stats: stats(results) };
}

async function measureLargeFileOpen(browserType, contextOptions) {
  // Create a 1000-line Java file in workspace
  const ws = process.env.KAIRO_WORKSPACE || '/tmp/kairo-mac-web-qa-m3/workspace';
  fs.mkdirSync(ws, { recursive: true });
  const src = path.join(ws, 'Large1000.java');
  const lines = ['public class Large1000 {'];
  for (let i = 0; i < 998; i++) lines.push(`    private int field${i} = ${i};`);
  lines.push('}');
  fs.writeFileSync(src, lines.join('\n'));

  const results = [];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
  await sleep(2000);

  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('F1');
    await sleep(500);
    await page.keyboard.type('File: Open File');
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(500);
    // Type absolute path
    await page.keyboard.type(src);
    await sleep(300);
    await page.keyboard.press('Enter');
    const start = performance.now();
    // Wait for editor tab with filename
    await page.locator('.p-TabBar-tabLabel').getByText('Large1000.java').first().waitFor({ state: 'visible', timeout: 10000 });
    const end = performance.now();
    results.push(end - start);
  }
  await browser.close();
  return { name: 'open-1000-line-java', unit: 'ms', values: results, stats: stats(results) };
}

async function measureLongTasks(browserType, contextOptions) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });

  // Inject 1000 log-like DOM nodes quickly and measure long tasks via PerformanceObserver
  const maxTask = await page.evaluate(() => new Promise((resolve) => {
    let max = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > max) max = entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const div = document.createElement('div');
      div.textContent = `Log line ${i}: Lorem ipsum dolor sit amet`;
      container.appendChild(div);
    }
    // Force layout
    void container.offsetHeight;
    setTimeout(() => resolve(max), 500);
  }));
  await browser.close();
  return { name: '1000-log-dom-longtask', unit: 'ms', value: maxTask };
}

async function run() {
  const start = Date.now();
  await ensureDirs();
  const contextOptions = { viewport: { width: 1440, height: 900 } };
  const report = { url: URL, testedAt: new Date().toISOString(), measurements: [] };

  report.measurements.push(await measureColdStart(chromium, contextOptions));
  report.measurements.push(await measureLargeFileOpen(chromium, contextOptions));
  report.measurements.push(await measureLongTasks(chromium, contextOptions));

  const end = Date.now();
  report.elapsedMs = end - start;

  // Gate evaluation
  const gates = [
    { name: 'cold-start-to-shell', maxMedian: 8000 },
    { name: 'open-1000-line-java', maxMedian: 1000 },
    { name: '1000-log-dom-longtask', max: 100 },
  ];
  let exitCode = 0;
  for (const g of gates) {
    const m = report.measurements.find((x) => x.name === g.name);
    if (!m) continue;
    if (g.maxMedian && m.stats.median > g.maxMedian) exitCode = 1;
    if (g.max && m.value > g.max) exitCode = 1;
  }
  report.exitCode = exitCode;

  const jsonPath = path.join(OUT, 'm3', 'perf-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    '# Kairo IDE macOS Web M3 Performance Baseline Report',
    `- **URL:** ${URL}`,
    `- **Tested at:** ${report.testedAt}`,
    `- **Elapsed:** ${report.elapsedMs}ms`,
    `- **Exit code:** ${exitCode}`,
    '',
    '## Measurements',
    ...report.measurements.map((m) => {
      if (m.stats) {
        return `- **${m.name}**: median=${m.stats.median}ms p95=${m.stats.p95}ms min=${m.stats.min}ms max=${m.stats.max}ms`;
      }
      return `- **${m.name}**: ${m.value}${m.unit}`;
    }),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'm3', 'perf-report.md'), md);
  writeMeta('perf-baseline', start, end, exitCode, { measurements: report.measurements.map((m) => ({ name: m.name, stats: m.stats || { value: m.value } })) });

  console.log(`Perf baseline complete: ${jsonPath}`);
  console.log(report.measurements.map((m) => `${m.name}: ${m.stats ? `median=${m.stats.median}` : `value=${m.value}`}`).join(', '));
  process.exit(exitCode);
}

run().catch((err) => { console.error(err); process.exit(2); });
