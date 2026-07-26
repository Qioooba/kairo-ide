const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('http://127.0.0.1:3070', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#theia-shell', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(5000);
    // dismiss trust dialog
    const yesBtn = page.locator('button.theia-button.main', { hasText: /trust/i }).first();
    if (await yesBtn.count() > 0 && await yesBtn.isVisible().catch(() => false)) {
      await yesBtn.click();
      await page.waitForTimeout(1500);
    }
    // check menu bar selectors
    const selectors = ['.lm-MenuBar', '#theia\\:menubar', '.theia-menu-bar', '#theia-menu-bar', '.p-MenuBar', '[class*="MenuBar"]', '[class*="menubar"]', '[class*="menu-bar"]'];
    for (const s of selectors) {
      const c = await page.locator(s).count();
      const v = c > 0 ? await page.locator(s).first().isVisible().catch(() => false) : false;
      console.log('SELECTOR=' + s + ' count=' + c + ' visible=' + v);
    }
    // check all class names containing menu
    const allMenuClasses = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('*').forEach(el => {
        const cls = el.className && el.className.toString ? el.className.toString() : '';
        if (cls && cls.toLowerCase().includes('menu') && cls.length < 100) {
          out.push({ tag: el.tagName, cls: cls.toString() });
        }
      });
      return out.slice(0, 15);
    });
    console.log('MENU_CLASSES=' + JSON.stringify(allMenuClasses));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
