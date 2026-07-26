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

  const url = 'http://127.0.0.1:18301/?kairoAgent=http://127.0.0.1:18300';
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
  fs.mkdirSync('/Users/qi/Documents/spaces/kairo-ide/test-results', { recursive: true });
  await page.screenshot({ path: '/Users/qi/Documents/spaces/kairo-ide/test-results/debug-init.png', fullPage: true });
  await browser.close();
})();
