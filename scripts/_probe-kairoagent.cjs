const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text().slice(0,160)}`));
  page.on('pageerror', e => logs.push(`pageerror: ${e.message.slice(0,160)}`));
  await page.goto('http://127.0.0.1:3001/?kairoAgent=' + encodeURIComponent('http://127.0.0.1:19090'), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  try { await page.locator('button', { hasText: 'Yes, I trust the authors' }).click({ timeout: 4000 }); } catch (_e) {}
  await page.waitForTimeout(5000);
  const sb = await page.evaluate(() => (document.getElementById('theia-statusBar') || {}).textContent || '');
  console.log('STATUS BAR:', sb.slice(0, 300));
  console.log('--- console (errors only) ---');
  logs.filter(l => /error/i.test(l)).slice(0, 10).forEach(l => console.log(l));
  await browser.close();
})().catch(e => { console.error('PROBE FAIL', e.message); process.exit(1); });
