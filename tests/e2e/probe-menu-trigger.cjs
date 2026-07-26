const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto('http://127.0.0.1:3070', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    // dismiss trust dialog
    const yesBtn = page.locator('button.theia-button.main', { hasText: /trust/i }).first();
    if (await yesBtn.count() > 0 && await yesBtn.isVisible().catch(() => false)) {
      await yesBtn.click();
      await page.waitForTimeout(2000);
    }
    // Try F10 to show menu
    await page.keyboard.press('F10');
    await page.waitForTimeout(1500);
    const labels1 = await page.locator('.lm-MenuBar-itemLabel').count();
    console.log('AFTER_F10_LABELS=' + labels1);
    const topPanelAfter = await page.evaluate(() => {
      const top = document.getElementById('theia-top-panel');
      return top ? top.innerHTML.slice(0, 500) : 'NO_TOP';
    });
    console.log('TOP_PANEL_AFTER_F10=' + topPanelAfter);
    // try Alt+F
    await page.keyboard.press('Alt+F');
    await page.waitForTimeout(1500);
    const labels2 = await page.locator('.lm-MenuBar-itemLabel').count();
    console.log('AFTER_ALT_F_LABELS=' + labels2);
    // try clicking the application shell to focus
    await page.locator('#theia-app-shell').click();
    await page.waitForTimeout(500);
    await page.keyboard.press('F10');
    await page.waitForTimeout(1500);
    const labels3 = await page.locator('.lm-MenuBar-itemLabel').count();
    console.log('AFTER_CLICK_F10_LABELS=' + labels3);
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
