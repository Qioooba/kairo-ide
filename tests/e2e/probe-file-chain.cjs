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
    // Find File element details
    const fileInfo = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const out = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.trim() === 'File') {
          let parent = node.parentElement;
          let chain = [];
          for (let i = 0; i < 5 && parent; i++) {
            chain.push({ tag: parent.tagName, cls: parent.className.toString().slice(0, 100), id: parent.id, text: parent.textContent?.trim().slice(0, 30) });
            parent = parent.parentElement;
          }
          out.push(chain);
        }
      }
      return out;
    });
    console.log('FILE_CHAIN=' + JSON.stringify(fileInfo, null, 2));
    // Check if there's a Kairo menu
    const kairoInfo = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const out = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.trim() === 'Kairo') {
          let parent = node.parentElement;
          let chain = [];
          for (let i = 0; i < 5 && parent; i++) {
            chain.push({ tag: parent.tagName, cls: parent.className.toString().slice(0, 100), id: parent.id, text: parent.textContent?.trim().slice(0, 30) });
            parent = parent.parentElement;
          }
          out.push(chain);
        }
      }
      return out;
    });
    console.log('KAIRO_CHAIN=' + JSON.stringify(kairoInfo, null, 2));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
