const { chromium } = require('playwright');
const { probeUrl, screenshotPath } = require('./probe-config.cjs');
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
    await page.screenshot({ path: screenshotPath('theia-state.png'), fullPage: true });
    console.log('Screenshot saved');
    // Check if welcome page is visible
    const welcomeCount = await page.locator('.theia-welcome, .welcome-page, [class*="welcome"]').count();
    console.log('WELCOME_COUNT=' + welcomeCount);
    // Check the top-panel children
    const topPanelChildren = await page.evaluate(() => {
      const top = document.getElementById('theia-top-panel');
      if (!top) return 'NO_TOP_PANEL';
      return top.innerHTML.slice(0, 500);
    });
    console.log('TOP_PANEL=' + topPanelChildren);
    // Check what is rendered as a menu
    const menuLabels = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.p-MenuBar-item, [class*="MenuBar"]').forEach(el => {
        out.push({ tag: el.tagName, cls: el.className.toString(), text: el.textContent?.trim().slice(0, 50) });
      });
      return out;
    });
    console.log('MENU_LABELS=' + JSON.stringify(menuLabels.slice(0, 20)));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
