#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.KAIRO_URL || 'http://127.0.0.1:3000';
const AGENT_URL = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18080';
const OUT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa-m3';
const COMMANDS = path.join(OUT, 'm3', 'commands');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDirs() {
  fs.mkdirSync(COMMANDS, { recursive: true });
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
  return { n, min: sorted[0], max: sorted[n - 1], mean: Math.round(mean), median, p95 };
}

async function createWorkspaceViaAgent(rootPath, name) {
  try {
    const res = await fetch(`${AGENT_URL}/api/v1/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, root: rootPath }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function importViaUI(page, rootPath) {
  await page.keyboard.press('F1');
  await sleep(600);
  await page.keyboard.type('Kairo: Import Project');
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(1000);
  // Wizard step 1: type path
  await page.keyboard.type(rootPath);
  await sleep(300);
  await page.keyboard.press('Tab'); // move to Continue
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(1500);
  // Try tab to final action and submit
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(2000);
}

async function run() {
  const start = Date.now();
  await ensureDirs();
  const contextOptions = { viewport: { width: 1440, height: 900 } };
  const report = { url: URL, testedAt: new Date().toISOString(), measurements: [] };

  // 1. Cold start
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const t0 = performance.now();
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
    cold.push(performance.now() - t0);
    await browser.close();
  }
  report.measurements.push({ name: 'cold-start-to-shell', unit: 'ms', values: cold, stats: stats(cold), gate: '≤8000ms' });

  // 2. Large file open (best effort: create workspace, import, then click file)
  const ws = process.env.KAIRO_WORKSPACE || path.join(OUT, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  const src = path.join(ws, 'Large1000.java');
  if (!fs.existsSync(src)) {
    const lines = ['public class Large1000 {'];
    for (let i = 0; i < 998; i++) lines.push(`    private int field${i} = ${i};`);
    lines.push('}');
    fs.writeFileSync(src, lines.join('\n'));
  }

  const openTimes = [];
  let fileOpenBlocked = true;
  try {
    await createWorkspaceViaAgent(ws, 'perf-workspace');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(contextOptions);
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
    await sleep(3000);
    await importViaUI(page, ws);

    // Try to click the file in explorer
    const t0 = performance.now();
    const fileNode = page.locator('#files .theia-TreeNode').getByText('Large1000.java').first();
    if (await fileNode.count() > 0) {
      await fileNode.click();
      await page.locator('.p-TabBar-tabLabel').getByText('Large1000.java').first().waitFor({ state: 'visible', timeout: 10000 });
      openTimes.push(performance.now() - t0);
      fileOpenBlocked = false;
    }
    await browser.close();
  } catch (e) {
    report.fileOpenError = e.message;
  }
  if (!fileOpenBlocked && openTimes.length > 0) {
    report.measurements.push({ name: 'open-1000-line-java', unit: 'ms', values: openTimes, stats: stats(openTimes), gate: '≤1000ms' });
  } else {
    report.measurements.push({ name: 'open-1000-line-java', unit: 'ms', status: 'BLOCKED', reason: 'workspace/project not loaded into UI; file tree not populated' });
  }

  // 3. Long task during DOM log injection
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(contextOptions);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#theia-app-shell', { state: 'visible', timeout: 30000 });
  const maxTask = await page.evaluate(() => new Promise((resolve) => {
    let max = 0;
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration > max) max = e.duration;
    });
    obs.observe({ entryTypes: ['longtask'] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    for (let i = 0; i < 1000; i++) {
      const d = document.createElement('div');
      d.textContent = `Log line ${i}: Lorem ipsum dolor sit amet`;
      container.appendChild(d);
    }
    void container.offsetHeight;
    setTimeout(() => resolve(max), 600);
  }));
  report.measurements.push({ name: '1000-log-dom-longtask', unit: 'ms', value: maxTask, gate: '≤100ms' });
  await browser.close();

  const end = Date.now();
  report.elapsedMs = end - start;

  const gates = [
    { name: 'cold-start-to-shell', maxMedian: 8000 },
    { name: 'open-1000-line-java', maxMedian: 1000 },
    { name: '1000-log-dom-longtask', max: 100 },
  ];
  let exitCode = 0;
  for (const g of gates) {
    const m = report.measurements.find((x) => x.name === g.name);
    if (!m || m.status === 'BLOCKED') { exitCode = 1; continue; }
    if (g.maxMedian && m.stats.median > g.maxMedian) exitCode = 1;
    if (g.max && m.value > g.max) exitCode = 1;
  }
  report.exitCode = exitCode;

  fs.writeFileSync(path.join(OUT, 'm3', 'perf-report.json'), JSON.stringify(report, null, 2));
  const md = [
    '# Kairo IDE macOS Web M3 Performance Baseline Report',
    `- **URL:** ${URL}`,
    `- **Tested at:** ${report.testedAt}`,
    `- **Elapsed:** ${report.elapsedMs}ms`,
    `- **Exit code:** ${exitCode}`,
    '',
    '## Measurements',
    ...report.measurements.map((m) => {
      if (m.status === 'BLOCKED') return `- **${m.name}**: BLOCKED — ${m.reason}`;
      if (m.stats) return `- **${m.name}**: median=${m.stats.median}ms p95=${m.stats.p95}ms min=${m.stats.min}ms max=${m.stats.max}ms (gate ${m.gate})`;
      return `- **${m.name}**: ${m.value}${m.unit} (gate ${m.gate})`;
    }),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'm3', 'perf-report.md'), md);
  writeMeta('perf-baseline', start, end, exitCode, { measurements: report.measurements.map((m) => ({ name: m.name, status: m.status, stats: m.stats || { value: m.value } })) });

  console.log(`Perf baseline complete`);
  console.log(report.measurements.map((m) => `${m.name}: ${m.status === 'BLOCKED' ? 'BLOCKED' : (m.stats ? `median=${m.stats.median}` : `value=${m.value}`)}`).join(', '));
  process.exit(exitCode);
}

run().catch((err) => { console.error(err); process.exit(2); });
