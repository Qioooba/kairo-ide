const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--headless=new'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 500)}`));
  page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`));
  await page.goto(process.env.THEIA_URL || 'http://127.0.0.1:18401', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const has = await page.evaluate(() => !!document.querySelector('#theia-app-shell'));
    if (has) {
      console.log('SHELL_MOUNTED at t=' + (i + 1) + 's');
      break;
    }
    if (i === 39) {
      console.log('BODY_HTML_START');
      const html = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
      console.log(html);
      console.log('BODY_HTML_END');
    }
  }
  console.log('--- console/pageerror/requestfailed ---');
  for (const l of logs.slice(-60)) console.log(l);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
