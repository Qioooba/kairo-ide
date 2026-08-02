const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (e) {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:18301', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Hide preload if present
  await page.evaluate(() => {
    const p = document.querySelector('.theia-preload');
    if (p) p.style.display = 'none';
  });

  // Open Kairo menu
  await page.click('.lm-MenuBar-item:has-text("Kairo")');
  await page.waitForTimeout(500);

  // Get all menu items
  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.lm-Menu-itemLabel')).map(el => el.textContent.trim());
  });
  console.log('Kairo menu items:', JSON.stringify(items, null, 2));

  // Hover View submenu
  const viewItem = items.find(i => i.toLowerCase().includes('view'));
  if (viewItem) {
    await page.hover(`.lm-Menu-itemLabel:has-text("${viewItem}")`);
    await page.waitForTimeout(800);
    const viewItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.lm-Menu-itemLabel')).map(el => el.textContent.trim());
    });
    console.log('View submenu items:', JSON.stringify(viewItems, null, 2));
  }

  // Hover Debug submenu
  const debugItem = items.find(i => i.toLowerCase().includes('debug'));
  if (debugItem) {
    await page.hover(`.lm-Menu-itemLabel:has-text("${debugItem}")`);
    await page.waitForTimeout(800);
    const debugItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.lm-Menu-itemLabel')).map(el => el.textContent.trim());
    });
    console.log('Debug submenu items:', JSON.stringify(debugItems, null, 2));
  }

  await browser.close();
})();
