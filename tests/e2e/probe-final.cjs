const { chromium } = require('playwright');
const { probeUrl, screenshotPath } = require('./probe-config.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(15000);
    // dismiss trust dialog
    const yesBtn = page.locator('button.theia-button.main', { hasText: /trust/i }).first();
    if (await yesBtn.count() > 0 && await yesBtn.isVisible().catch(() => false)) {
      await yesBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(3000);
    // Count many things
    const counts = await page.evaluate(() => {
      return {
        lmMenuBar: document.querySelectorAll('.lm-MenuBar').length,
        lmMenuBarItem: document.querySelectorAll('.lm-MenuBar-item').length,
        lmMenuBarItemLabel: document.querySelectorAll('.lm-MenuBar-itemLabel').length,
        pMenuBar: document.querySelectorAll('.p-MenuBar').length,
        pMenuBarItem: document.querySelectorAll('.p-MenuBar-item').length,
        topPanel: document.getElementById('theia-top-panel')?.innerHTML.length || 0,
        topPanelChildren: document.getElementById('theia-top-panel')?.children.length || 0,
        bodyText: document.body.textContent?.length || 0,
        allClasses: Array.from(new Set(Array.from(document.querySelectorAll('*')).map(el => el.className?.toString().split(/\s+/).filter(Boolean).join(' ')).filter(c => c && (c.toLowerCase().includes('menu') || c.toLowerCase().includes('topbar'))).slice(0, 20)))
      };
    });
    console.log('COUNTS=' + JSON.stringify(counts, null, 2));
    // Take screenshot
    await page.screenshot({ path: screenshotPath('theia-state2.png'), fullPage: true });
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
