// Probe: GBK save-dead (flow-03 P1) — open GBK file, reopen-as-GBK, type Chinese, Meta+S, watch console + bytes.
'use strict';
const fs = require('fs');
const path = require('path');
const iconv = (() => { try { return require('iconv-lite'); } catch { return null; } })();
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa.SOUdxO';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-gbk-save'));
const PROJ = path.join(QA_ROOT, 'gbk-save-fixture');

function writeGbk(file, text) {
  if (iconv) { fs.writeFileSync(file, iconv.encode(text, 'gbk')); }
  else { fs.writeFileSync(file, Buffer.from(text, 'utf8')); } // fallback (test env has iconv via theia)
}

async function main() {
  fs.mkdirSync(path.join(PROJ, 'WebRoot'), { recursive: true });
  const gbkFile = path.join(PROJ, 'WebRoot', 'hello.jsp');
  writeGbk(gbkFile, '<%-- 注释 --%>\n<html><body>你好世界</body></html>\n');
  const shaBefore = require('crypto').createHash('sha256').update(fs.readFileSync(gbkFile)).digest('hex');

  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-gbk-save-stack'), port: 19090, webPort: 13900, skipBuild: true });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;
  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  const consoleLines = [];
  page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleLines.push(`[pageerror] ${e.message}`));
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // create workspace pointing at fixture via agent
  const agent = 'http://127.0.0.1:19090';
  await fetch(`${agent}/api/v1/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'gbk-ws', root: PROJ }) });

  // open workspace root in theia: use "File > Open Folder"? simpler: the QA stack already opens a workspace dir.
  // Fall back: open the file through the explorer of the default workspace if fixture is not it.
  const wsDir = env.KAIRO_QA_WORKSPACE_DIR;
  console.log('stack workspace dir:', wsDir);
  // copy fixture into the stack workspace for explorer visibility
  const target = path.join(wsDir, 'hello.jsp');
  fs.copyFileSync(gbkFile, target);

  // open file via quick open (Cmd+P)
  await page.keyboard.down('Meta'); await page.keyboard.press('p'); await page.keyboard.up('Meta');
  await sleep(1200);
  await page.keyboard.type('hello.jsp', { delay: 20 });
  await sleep(1200);
  await page.keyboard.press('Enter');
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, '01-opened.png') });

  // reopen with encoding GBK via command palette
  const input = page.locator('input[aria-label="Type to narrow down results."]').first();
  await page.keyboard.press('F1');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.pressSequentially('Reopen with Encoding', { delay: 20 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(1200);
  // encoding pick list
  await page.keyboard.type('gbk', { delay: 20 });
  await sleep(1000);
  await page.keyboard.press('Enter');
  await sleep(2500);
  const statusBar = await page.locator('#theia-statusBar').innerText().catch(() => '');
  console.log('status bar after reopen:', statusBar.replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: path.join(OUT, '02-reopened-gbk.png') });

  // click into editor, go to end, type Chinese comment
  const dialogText = await page.locator('#theia-dialog-shell .dialogContent').innerText().catch(() => null);
  console.log('dialog present before typing:', JSON.stringify(dialogText));
  await page.locator('.monaco-editor .view-lines').first().click();
  await sleep(400);
  const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, cls: (document.activeElement?.className || '').toString().slice(0, 60) }));
  console.log('activeElement after editor click:', JSON.stringify(active));
  await page.keyboard.down('Meta'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Meta');
  await page.keyboard.press('Enter');
  // ASCII first — isolates CJK-input issues from general insertion issues
  await page.keyboard.type('TEST123', { delay: 20 });
  await sleep(500);
  const asciiLanded = (await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '')).includes('TEST123');
  console.log('ASCII landed:', asciiLanded);
  const COMMENT = '<%-- 新增中文注释 --%>';
  // insertText is reliable for Monaco + CJK; keyboard.type's synthetic
  // key events intermittently fail to insert here.
  await page.keyboard.insertText(COMMENT);
  await sleep(800);
  // verify the typed text actually landed in the editor model
  const editorText = await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '');
  console.log('editor contains typed comment:', editorText.includes('新增中文注释'));
  const dirtyBefore = await page.locator('.theia-tab-dirty, .p-TabBar-tab.dirty, .lm-mod-dirty, [class*="dirty"]').count();
  console.log('dirty markers after typing:', dirtyBefore);

  // Meta+S
  await page.keyboard.down('Meta'); await page.keyboard.press('s'); await page.keyboard.up('Meta');
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, '03-after-save.png') });
  const shaAfterMetaS = require('crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  const dirtyAfter = await page.locator('.theia-tab-dirty, .p-TabBar-tab.dirty, .lm-mod-dirty').count();
  console.log('shaBefore=', shaBefore.slice(0, 12), 'shaAfterMetaS=', shaAfterMetaS.slice(0, 12), 'changed=', shaBefore !== shaAfterMetaS, 'dirtyAfter=', dirtyAfter);

  // decode saved bytes to verify content
  if (shaBefore !== shaAfterMetaS && iconv) {
    const decoded = iconv.decode(fs.readFileSync(target), 'gbk');
    console.log('decoded contains typed comment:', decoded.includes('新增中文注释'));
  }
  const interesting = consoleLines.filter(l => /error|Error|save|encod|Unrepresentable/i.test(l)).slice(0, 30);
  console.log('--- console (interesting) ---');
  for (const l of interesting) console.log(l);

  await browser.close();
  await stopStack(stack.dataDir);
  process.exit(shaBefore !== shaAfterMetaS ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
