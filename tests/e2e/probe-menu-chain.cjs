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
    // Find File menu parent
    const fileInfo = await page.evaluate(() => {
      const labels = document.querySelectorAll('.lm-MenuBar-itemLabel');
      if (labels.length === 0) return 'NO_LABELS';
      const out = [];
      for (const label of labels) {
        let parent = label.parentElement;
        let chain = [];
        for (let i = 0; i < 5 && parent; i++) {
          chain.push({ tag: parent.tagName, cls: parent.className.toString().slice(0, 100), id: parent.id });
          parent = parent.parentElement;
        }
        out.push({ text: label.textContent, chain });
      }
      return out;
    });
    console.log('FILE_CHAIN=' + JSON.stringify(fileInfo, null, 2));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
