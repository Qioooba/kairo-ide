const { chromium } = require('playwright');
const { probeUrl } = require('./probe-config.cjs');
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
      await page.waitForTimeout(3000);
    }
    // Now check what's actually in the body
    const bodyStructure = await page.evaluate(() => {
      const out = [];
      // Get top-level children of body
      for (const child of document.body.children) {
        out.push({
          tag: child.tagName,
          id: child.id,
          cls: child.className.toString().slice(0, 100),
          childCount: child.children.length,
          text: child.textContent?.trim().slice(0, 100) || ''
        });
      }
      return out;
    });
    console.log('BODY_CHILDREN=' + JSON.stringify(bodyStructure, null, 2));
    const allIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[id]')).slice(0, 30).map(el => el.id);
    });
    console.log('ALL_IDS=' + JSON.stringify(allIds));
    // full body innerHTML length
    const htmlLen = await page.evaluate(() => document.body.innerHTML.length);
    console.log('HTML_LENGTH=' + htmlLen);
    const htmlSample = await page.evaluate(() => document.body.innerHTML.slice(0, 800));
    console.log('HTML_SAMPLE=' + htmlSample);
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
