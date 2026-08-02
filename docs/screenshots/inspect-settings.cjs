const { chromium } = require('playwright');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://127.0.0.1:18301', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  try {
    const trust = page.locator('button:has-text("Yes, I trust")').first();
    await trust.waitFor({ state: 'visible', timeout: 3000 });
    await trust.click();
    await sleep(500);
  } catch {}

  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await sleep(600);
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill('>Preferences: Open Settings (UI)');
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(1500);

  const search = page.locator('input[placeholder*="Search"], .settings-search-input input').first();
  await search.fill('kairo.language');
  await sleep(1500);

  const select = page.locator('#kairo\\.language-editor .theia-select-component').first();
  await select.click();
  await sleep(800);

  const container = page.locator('#select-component-container');
  console.log('Dropdown container HTML:');
  console.log(await container.innerHTML());

  await browser.close();
})();
