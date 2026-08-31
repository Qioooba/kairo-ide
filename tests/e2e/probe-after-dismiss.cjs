const { chromium } = require('playwright');
const { probeUrl, screenshotPath } = require('./probe-config.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(10000);
    // dismiss trust dialog (same as fixtures.ts)
    const dialogShell = page.locator('.workspace-trust-dialog, .theia-trust-dialog, #theia-dialog-shell.workspace-trust-dialog');
    try {
      await dialogShell.first().waitFor({ state: 'visible', timeout: 10000 });
      console.log('DIALOG_VISIBLE=true');
      const yesBtn = page.locator('button.theia-button.main', { hasText: /yes,?\s*i\s*trust/i }).first();
      await yesBtn.waitFor({ state: 'visible', timeout: 3000 });
      await yesBtn.click({ timeout: 3000 });
      console.log('CLICKED_YES');
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('DIALOG_ERROR=' + e.message);
    }
    // Now check counts
    const counts = await page.evaluate(() => {
      return {
        lmMenuBar: document.querySelectorAll('.lm-MenuBar').length,
        lmMenuBarItem: document.querySelectorAll('.lm-MenuBar-item').length,
        lmMenuBarItemLabel: document.querySelectorAll('.lm-MenuBar-itemLabel').length,
        topPanelChildren: document.getElementById('theia-top-panel')?.children.length || 0,
        topPanelHTML: document.getElementById('theia-top-panel')?.innerHTML.slice(0, 200) || '',
        bodyText: document.body.textContent?.length || 0
      };
    });
    console.log('COUNTS=' + JSON.stringify(counts, null, 2));
    await page.screenshot({ path: screenshotPath('theia-final.png'), fullPage: true });
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
