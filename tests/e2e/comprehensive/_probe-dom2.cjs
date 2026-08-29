const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--headless=new'] });
  const page = await browser.newPage();
  await page.goto(process.env.THEIA_URL || 'http://127.0.0.1:18401', { waitUntil: 'domcontentloaded' });
  try {
    await page.locator('button:has-text("Trust"), button:has-text("信任")').first().click({ timeout: 8000 });
  } catch {}
  await page.waitForSelector('#theia-app-shell', { timeout: 120000 });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.theia-tabBar-tab')].map((t) => ({
      text: t.textContent?.trim(),
      cls: t.className,
      id: t.id,
    }));
    const widgets = [...document.querySelectorAll('[data-widget-id]')].map((w) => w.getAttribute('data-widget-id'));
    const kairoWidgets = [...document.querySelectorAll('.p-Widget')].map((w) => w.id).filter((id) => id.includes('kairo'));
    return { tabs: tabs.slice(0, 12), widgetIds: widgets.slice(0, 20), kairoWidgets };
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})();
