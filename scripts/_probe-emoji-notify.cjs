// Targeted probe: emoji-in-GBK save refusal — is the user notified?
'use strict';
const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-emoji-notify'));
const PROJ = path.join(QA_ROOT, 'gbk-debug-fixture');

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-emoji-stack'), port: 19090, webPort: 13900, skipBuild: true });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  const consoleLines = [];
  page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleLines.push(`[pageerror] ${e.message}`));
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  const wsDir = env.KAIRO_QA_WORKSPACE_DIR;
  fs.copyFileSync(path.join(PROJ, 'WebRoot', 'hello.jsp'), path.join(wsDir, 'hello.jsp'));

  // reopen as GBK first (so the model decodes correctly)
  await page.keyboard.down('Meta'); await page.keyboard.press('p'); await page.keyboard.up('Meta');
  await sleep(1000);
  await page.keyboard.type('hello.jsp', { delay: 20 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(2500);
  const input = page.locator('input[aria-label="Type to narrow down results."]').first();
  await page.keyboard.press('F1');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.pressSequentially('Kairo: Reopen with Encoding', { delay: 15 });
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(1200);
  const pick = page.locator('.quick-input-widget .quick-input-box input');
  await pick.waitFor({ state: 'visible', timeout: 15000 });
  await pick.pressSequentially('gbk', { delay: 20 });
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(3000);
  const text0 = await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '');
  console.log('decoded OK:', text0.includes('你好世界'));

  // type emoji and save
  await page.locator('.monaco-editor .view-lines').first().click();
  await sleep(300);
  await page.keyboard.down('Meta'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Meta');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('😀');
  await sleep(500);
  await page.keyboard.down('Meta'); await page.keyboard.press('s'); await page.keyboard.up('Meta');
  await sleep(3500);
  await page.screenshot({ path: path.join(OUT, 'after-save.png') });

  // notification DOM dump
  const notifHtml = await page.locator('.theia-Notifications').innerHTML().catch(() => 'NO .theia-Notifications');
  console.log('notification container html (first 500):', notifHtml.slice(0, 500));
  const anyNotif = await page.locator('[class*="notification"]').evaluateAll(els => els.map(e => ({ cls: (e.className || '').toString().slice(0, 80), text: (e.textContent || '').slice(0, 120) })).filter(x => x.text.trim()).slice(0, 10)).catch(() => []);
  console.log('notification-ish elements:', JSON.stringify(anyNotif, null, 1));
  const dirty = await page.locator('.theia-tab-dirty, .p-TabBar-tab.dirty, .lm-mod-dirty, [class*="dirty"]').count();
  console.log('dirty markers:', dirty);

  console.log('--- console (kairo-debug / errors) ---');
  for (const l of consoleLines.filter(l => /kairo-debug|error|Error/i.test(l)).slice(0, 25)) console.log(l.slice(0, 260));

  await browser.close();
  await stopStack(stack.dataDir);
}

main().catch(e => { console.error(e); process.exit(1); });
