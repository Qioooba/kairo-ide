const { chromium } = require('playwright');
const { probeUrl, screenshotPath } = require('./probe-config.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    // dismiss trust dialog
    const yesBtn = page.locator('button.theia-button.main', { hasText: /yes,?\s*i\s*trust/i }).first();
    if (await yesBtn.count() > 0 && await yesBtn.isVisible().catch(() => false)) {
      await yesBtn.click();
      console.log('CLICKED');
    }
    // Wait for things to load
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(2000);
      const bt = await page.evaluate(() => document.body.textContent?.length || 0);
      const menuBar = await page.locator('.lm-MenuBar-itemLabel').count();
      const stillDialog = await page.locator('.workspace-trust-dialog').count();
      console.log(`T+${(i+1)*2}s bodyText=${bt} menuLabels=${menuBar} stillDialog=${stillDialog}`);
      if (menuBar > 0) {
        console.log('MENU_APPEARED');
        break;
      }
    }
    await page.screenshot({ path: screenshotPath('theia-fully-loaded.png'), fullPage: true });
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
