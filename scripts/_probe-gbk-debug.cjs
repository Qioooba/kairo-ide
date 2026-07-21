// Debug probe: why does "Kairo: Reopen with Encoding → GBK" not re-decode?
// Inspects monaco model text + override registration from inside the page.
'use strict';
const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-gbk-debug'));
const PROJ = path.join(QA_ROOT, 'gbk-debug-fixture');

async function main() {
  fs.mkdirSync(path.join(PROJ, 'WebRoot'), { recursive: true });
  const gbkFile = path.join(PROJ, 'WebRoot', 'hello.jsp');
  fs.writeFileSync(gbkFile, require('iconv-lite').encode('<%-- 注释 --%>\n<html><body>你好世界</body></html>\n', 'gbk'));

  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-gbk-debug-stack'), port: 19090, webPort: 13900, skipBuild: true });
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
  fs.copyFileSync(gbkFile, path.join(wsDir, 'hello.jsp'));

  // capabilities inside the page
  const caps = await page.evaluate(() => ({
    monaco: typeof window.monaco,
    theia: Object.keys(window).filter(k => /theia|kairo/i.test(k)).slice(0, 20),
  }));
  console.log('page caps:', JSON.stringify(caps));

  // quick open the file
  await page.keyboard.down('Meta'); await page.keyboard.press('p'); await page.keyboard.up('Meta');
  await sleep(1200);
  await page.keyboard.type('hello.jsp', { delay: 20 });
  await sleep(1200);
  await page.keyboard.press('Enter');
  await sleep(3000);
  const textBefore = await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '');
  console.log('BEFORE reopen, editor text:', JSON.stringify(textBefore.slice(0, 80)));

  // Kairo: Reopen with Encoding -> GBK (exact command id to avoid ambiguity)
  await page.evaluate(async () => {
    // use the command registry through the quick-command palette instead: F1
  });
  const input = page.locator('input[aria-label="Type to narrow down results."]').first();
  await page.keyboard.press('F1');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.pressSequentially('Kairo: Reopen with Encoding', { delay: 15 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(1500);
  // encoding pick
  const pick = page.locator('.quick-input-widget .quick-input-box input');
  await pick.waitFor({ state: 'visible', timeout: 15000 });
  await pick.pressSequentially('gbk', { delay: 20 });
  await sleep(1000);
  const rows = await page.locator('.quick-input-widget .monaco-list-row').allInnerTexts().catch(() => []);
  console.log('encoding pick rows:', JSON.stringify(rows.slice(0, 5)));
  await page.keyboard.press('Enter');
  await sleep(4000);
  await page.screenshot({ path: path.join(OUT, 'after-reopen.png') });

  const textAfter = await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '');
  console.log('AFTER reopen, editor text:', JSON.stringify(textAfter.slice(0, 80)));
  const sb = await page.locator('#theia-statusBar').innerText().catch(() => '');
  console.log('status bar:', sb.replace(/\s+/g, ' ').slice(0, 200));

  // monaco model inspection
  const modelInfo = await page.evaluate(() => {
    if (typeof window.monaco === 'undefined' || !window.monaco.editor) return { err: 'no monaco global' };
    return window.monaco.editor.getModels().map(m => ({
      uri: m.uri.toString(),
      lang: m.getLanguageId(),
      head: m.getValue().slice(0, 60),
      version: m.getVersionId(),
    }));
  }).catch(e => ({ err: String(e) }));
  console.log('monaco models:', JSON.stringify(modelInfo, null, 1));

  const interesting = consoleLines.filter(l => /error|Error|disposed|encod|gbk/i.test(l)).slice(0, 40);
  console.log('--- console (interesting) ---');
  for (const l of interesting) console.log(l);

  await browser.close();
  await stopStack(stack.dataDir);
}

main().catch(async e => { console.error(e); process.exit(1); });
