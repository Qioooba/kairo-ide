/**
 * Capture post-optimization UI screenshots for Session 31 review.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.CAPTURE_URL || 'http://127.0.0.1:18301';
const OUT = path.join(__dirname, 'ui-optimization-after-session31');
const fs = require('fs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCmd(page, label) {
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await sleep(700);
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill('>' + label);
  await sleep(800);
  const row = page.locator('.quick-input-widget .monaco-list-row').first();
  if ((await row.count()) > 0) await row.click();
  else await page.keyboard.press('Enter');
  await sleep(1500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  console.log('goto', BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', {
    state: 'attached',
    timeout: 60000,
  });
  await sleep(4000);

  try {
    await page.locator('button:has-text("Yes, I trust")').first().click({ timeout: 3000 });
    await sleep(500);
  } catch { /* no dialog */ }

  await page.screenshot({ path: path.join(OUT, '01-welcome.png') });
  console.log('01-welcome');

  // Prefer clicking the primary welcome CTA (opens import wizard)
  const importBtn = page.locator('[data-testid="welcome-import"]').first();
  if ((await importBtn.count()) > 0) {
    await importBtn.click();
  } else {
    await runCmd(page, 'Import Project');
  }
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, '02-import-wizard.png') });
  console.log('02-import-wizard');

  const kairo = page.locator('.lm-MenuBar-item').filter({ hasText: /Kairo/ }).first();
  if ((await kairo.count()) > 0) {
    await kairo.click();
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, '03-kairo-menu.png') });
    console.log('03-kairo-menu');
    await page.keyboard.press('Escape');
  }

  const file = page.locator('.lm-MenuBar-item').filter({ hasText: /^File$/ }).first();
  if ((await file.count()) > 0) {
    await file.click();
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, '04-file-menu.png') });
    console.log('04-file-menu');
    await page.keyboard.press('Escape');
  }

  await runCmd(page, 'Show Servers');
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '05-server-view.png') });
  console.log('05-server-view');

  await runCmd(page, 'Show Builds');
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '06-build-view.png') });
  console.log('06-build-view');

  await runCmd(page, 'Show Deployments');
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '07-deployments.png') });
  console.log('07-deployments');

  await runCmd(page, 'Show Tomcat Logs');
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '08-tomcat-logs.png') });
  console.log('08-tomcat-logs');

  const sb = page.locator('#theia-statusBar').first();
  if ((await sb.count()) > 0) {
    await sb.screenshot({ path: path.join(OUT, '09-status-bar.png') });
  } else {
    await page.screenshot({ path: path.join(OUT, '09-status-bar.png') });
  }
  console.log('09-status-bar');

  await browser.close();
  console.log('DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
