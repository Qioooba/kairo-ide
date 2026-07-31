const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3001';
const OUT_DIR = path.join(__dirname, 'current-ui');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function dismissDialogs(page) {
  const trustBtn = page.locator('button:has-text("Yes, I trust")').first();
  try { await trustBtn.waitFor({ state: 'visible', timeout: 3000 }); await trustBtn.click(); await sleep(500); } catch {}
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { state: 'attached', timeout: 30000 });
  await sleep(3000);
  await dismissDialogs(page);

  const leftPanel = page.locator('#theia-left-content-panel, .theia-left-side-panel').first();
  await leftPanel.screenshot({ path: path.join(OUT_DIR, '17-activity-bar-default.png') });

  // Hover over a Kairo activity bar icon (e.g., second tab in the left Activity Bar)
  const tabs = page.locator('#theia-left-content-panel .p-TabBar-tab, #theia-left-content-panel [role="tab"]');
  const count = await tabs.count();
  for (let i = 0; i < Math.min(count, 4); i++) {
    await tabs.nth(i).hover();
    await sleep(300);
    await leftPanel.screenshot({ path: path.join(OUT_DIR, `17-activity-bar-hover-${i}.png`) });
  }

  console.log('Captured activity bar hover screenshots');
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
