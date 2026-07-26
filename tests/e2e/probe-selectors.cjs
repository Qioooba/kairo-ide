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
    // check menu bar selectors
    const selectors = ['.lm-MenuBar', '#theia\\:menubar', '.theia-menu-bar', '#theia-menu-bar', '.p-MenuBar', '[class*="MenuBar"]', '[class*="menubar"]', '[class*="menu-bar"]', '.lm-MenuBar-itemLabel'];
    for (const s of selectors) {
      const c = await page.locator(s).count();
      const v = c > 0 ? await page.locator(s).first().isVisible().catch(() => false) : false;
      console.log('SELECTOR=' + s + ' count=' + c + ' visible=' + v);
    }
    // check status bar selectors
    const sbSelectors = ['#theia-statusBar', '.theia-status-bar', '[class*="status-bar"]', '[class*="statusBar"]'];
    for (const s of sbSelectors) {
      const c = await page.locator(s).count();
      const v = c > 0 ? await page.locator(s).first().isVisible().catch(() => false) : false;
      console.log('STATUS=' + s + ' count=' + c + ' visible=' + v);
    }
    // check editor area
    const edSelectors = ['#theia-editor-area', '.theia-editor-area', '.monaco-editor', '[class*="editor-area"]'];
    for (const s of edSelectors) {
      const c = await page.locator(s).count();
      const v = c > 0 ? await page.locator(s).first().isVisible().catch(() => false) : false;
      console.log('EDITOR=' + s + ' count=' + c + ' visible=' + v);
    }
    // check left content
    const lcSelectors = ['#theia-leftContent', '.theia-activity-bar', '[class*="activity-bar"]'];
    for (const s of lcSelectors) {
      const c = await page.locator(s).count();
      const v = c > 0 ? await page.locator(s).first().isVisible().catch(() => false) : false;
      console.log('LEFT=' + s + ' count=' + c + ' visible=' + v);
    }
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
