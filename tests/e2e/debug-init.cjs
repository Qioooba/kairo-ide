const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--headless=new'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[pageerror] ${err.message}\n${err.stack || ''}`));
  page.on('response', r => {
    if (!r.ok()) logs.push(`[response] ${r.status()} ${r.url()}`);
  });

  const theiaUrl = process.env.THEIA_URL || 'http://127.0.0.1:18301';
  const agentUrl = process.env.AGENT_URL || 'http://127.0.0.1:18300';
  const url = `${theiaUrl}/?kairoAgent=${encodeURIComponent(agentUrl)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(8_000);

  const html = await page.content();
  const hasShell = await page.evaluate(() => !!document.querySelector('#theia-app-shell, #theia-shell, .theia-shell'));

  console.log('--- logs ---');
  for (const log of logs) console.log(log);
  console.log('--- html snippet ---');
  console.log(html.slice(0, 2000));
  console.log('--- hasShell ---', hasShell);

  const fs = require('fs');
  const path = require('path');
  const artifactDir = process.env.KAIRO_TEST_ARTIFACT_DIR || path.resolve(__dirname, 'test-results');
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, 'debug-init.png'), fullPage: true });
  await browser.close();
})();
