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

async function runCommand(page, label) {
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await sleep(600);
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill('>' + label);
  await sleep(800);
  const firstRow = page.locator('.quick-input-widget .monaco-list-row').first();
  if (await firstRow.count() > 0) await firstRow.click();
  else await page.keyboard.press('Enter');
  await sleep(1500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { state: 'attached', timeout: 30000 });
  await sleep(3000);
  await dismissDialogs(page);

  // Open Settings UI and switch Kairo language to zh-CN
  await runCommand(page, 'Preferences: Open Settings (UI)');
  await sleep(1000);
  const search = page.locator('input[placeholder*="Search"], .settings-search-input input').first();
  await search.fill('kairo.language');
  await sleep(1200);

  const select = page.locator('#kairo\\.language-editor .theia-select-component').first();
  await select.click();
  await sleep(500);
  const zhOption = page.locator('#select-component-container .theia-select-component-option:has-text("zh-CN")').first();
  await zhOption.waitFor({ state: 'visible', timeout: 3000 });
  await zhOption.click();
  await sleep(2500);

  // Open Servers view to verify translated Kairo strings
  await runCommand(page, 'Kairo: Show Servers');
  await sleep(1000);

  await page.screenshot({ path: path.join(OUT_DIR, '15-kairo-language-zh.png') });
  console.log('Captured 15-kairo-language-zh.png');

  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
