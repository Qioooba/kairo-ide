// Debug: why doesn't text land in the Monaco editor after reopen-with-encoding?
'use strict';
const path = require('path');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-editor-focus'));

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-editor-focus-stack'), port: 19090, webPort: 13900, skipBuild: true });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  page.on('console', m => { const t = m.text(); if (/error|disposed|warn/i.test(t)) console.log('[console]', t.slice(0, 200)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 300)));
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // create a file in the workspace and open it
  const wsDir = env.KAIRO_QA_WORKSPACE_DIR;
  require('fs').writeFileSync(path.join(wsDir, 'demo.txt'), 'line1\nline2\n');
  await page.keyboard.down('Meta'); await page.keyboard.press('p'); await page.keyboard.up('Meta');
  await sleep(1500);
  await page.keyboard.type('demo.txt', { delay: 20 });
  await sleep(1500);
  await page.keyboard.press('Enter');
  await sleep(2500);

  const editors = await page.locator('.monaco-editor').count();
  console.log('monaco editor count:', editors);
  for (let i = 0; i < editors; i++) {
    const box = await page.locator('.monaco-editor').nth(i).boundingBox();
    console.log(`editor[${i}] box=`, JSON.stringify(box));
  }

  await page.locator('.monaco-editor .view-lines').first().click();
  await sleep(500);
  const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, cls: (document.activeElement?.className || '').toString().slice(0, 80), aria: document.activeElement?.getAttribute('aria-label') }));
  console.log('activeElement after click:', JSON.stringify(active));

  await page.keyboard.type('ABC', { delay: 30 });
  await sleep(500);
  const text1 = await page.locator('.monaco-editor .view-lines').first().innerText();
  console.log('editor text after type ABC:', JSON.stringify(text1.slice(0, 60)));

  await page.keyboard.insertText('XYZ');
  await sleep(500);
  const text2 = await page.locator('.monaco-editor .view-lines').first().innerText();
  console.log('editor text after insertText XYZ:', JSON.stringify(text2.slice(0, 60)));

  // --- now the reopen-with-encoding flow, then try typing again ---
  // undo the edits so reopen is clean, then reopen as GBK
  const input = page.locator('input[aria-label="Type to narrow down results."]').first();
  await page.keyboard.press('F1');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.pressSequentially('Reopen with Encoding', { delay: 20 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(1500);
  await page.keyboard.type('gbk', { delay: 20 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(3000);
  const editorsAfter = await page.locator('.monaco-editor').count();
  console.log('monaco editor count after reopen:', editorsAfter);
  // A modal dialog may appear after reopen (dirty-file confirm etc.) — log it
  const dialogText = await page.locator('#theia-dialog-shell .dialogContent').innerText().catch(() => null);
  console.log('dialog after reopen:', JSON.stringify(dialogText));
  if (dialogText) {
    await page.screenshot({ path: path.join(OUT, 'dialog.png') });
    // accept the default (save/discard) — press Escape to dismiss for the focus test
    await page.keyboard.press('Escape');
    await sleep(800);
  }
  await page.locator('.monaco-editor .view-lines').first().click();
  await sleep(500);
  const active2 = await page.evaluate(() => ({ tag: document.activeElement?.tagName, cls: (document.activeElement?.className || '').toString().slice(0, 80), aria: document.activeElement?.getAttribute('aria-label') }));
  console.log('activeElement after reopen+click:', JSON.stringify(active2));
  await page.keyboard.type('DEF', { delay: 30 });
  await sleep(500);
  const text3 = await page.locator('.monaco-editor .view-lines').first().innerText();
  console.log('editor text after reopen + type DEF:', JSON.stringify(text3.slice(0, 60)));

  await page.screenshot({ path: path.join(OUT, 'debug.png') });
  await browser.close();
  await stopStack(stack.dataDir);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
