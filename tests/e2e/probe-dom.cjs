const { chromium } = require('playwright');
const { probeUrl } = require('./probe-config.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    // dismiss trust dialog
    const yesBtn = page.locator('button.theia-button.main', { hasText: /trust/i }).first();
    if (await yesBtn.count() > 0 && await yesBtn.isVisible().catch(() => false)) {
      await yesBtn.click();
      await page.waitForTimeout(2000);
    }
    // dump body HTML
    const bodyHtml = await page.evaluate(() => document.body.innerHTML.slice(0, 3000));
    console.log('BODY_HTML=' + bodyHtml);
    // dump root element classes
    const rootInfo = await page.evaluate(() => {
      const out = [];
      const top = document.querySelectorAll('div');
      for (let i = 0; i < Math.min(top.length, 20); i++) {
        const el = top[i];
        if (el.id || el.className) {
          out.push({ id: el.id, cls: el.className.toString().slice(0, 100), tag: el.tagName });
        }
      }
      return out;
    });
    console.log('TOP_DIVS=' + JSON.stringify(rootInfo, null, 2));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
