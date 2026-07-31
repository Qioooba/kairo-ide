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
  const dontSave = page.locator('button:has-text("Don\'t Save")').first();
  try { await dontSave.waitFor({ state: 'visible', timeout: 2000 }); await dontSave.click(); await sleep(500); } catch {}
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
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { state: 'attached', timeout: 30000 });
  await sleep(3000);
  await dismissDialogs(page);

  // Switch language to Chinese (Simplified)
  await runCommand(page, 'Configure Display Language');
  await sleep(800);
  const zhRow = page.locator('.quick-input-widget .monaco-list-row:has-text("Chinese (Simplified)")').first();
  if (await zhRow.count() > 0) await zhRow.click();
  else {
    // fallback: type zh-CN
    const input = page.locator('.quick-input-widget .quick-input-box input');
    await input.fill('Chinese (Simplified)');
    await sleep(500);
    await page.keyboard.press('Enter');
  }
  await sleep(1000);

  // Accept reload if prompted
  const reloadBtn = page.locator('button:has-text("Restart"), button:has-text("Reload")').first();
  try { await reloadBtn.waitFor({ state: 'visible', timeout: 3000 }); await reloadBtn.click(); } catch {}

  // Wait for reload
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { state: 'attached', timeout: 30000 });
  await sleep(4000);
  await dismissDialogs(page);

  // Capture status bar / menu evidence
  await page.screenshot({ path: path.join(OUT_DIR, '15-language-zh.png') });
  console.log('Captured 15-language-zh.png');

  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
