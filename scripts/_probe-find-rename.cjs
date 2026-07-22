// Probe: Find widget + navigator rename-reflect (WEB-find / KAIRO-RC-WEB-208)
// Runs against a parallel stack on 19090 via ?kairoAgent=.
'use strict';

const path = require('path');
const fs = require('fs');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, screenshot, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-find-rename'));
const findings = [];
function note(id, ok, detail) {
  findings.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`);
}

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-find-stack'), port: 19090 });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;

  // Seed a file in the Theia workspace
  fs.writeFileSync(path.join(env.KAIRO_QA_WORKSPACE_DIR, 'probe.txt'), 'hello kairo probe\nsecond line\n');

  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // Open probe.txt via Quick Open
  await page.keyboard.press('Meta+P');
  const qi = page.locator('.quick-input-widget .quick-input-box input');
  await qi.waitFor({ state: 'visible', timeout: 15000 });
  await qi.fill('probe.txt');
  await sleep(1200);
  await page.locator('.quick-input-widget .monaco-list-row:has-text("probe.txt")').first().click();
  await sleep(2500);

  // Focus the editor, then Meta+F
  await page.locator('.monaco-editor').first().click();
  await sleep(500);
  await page.keyboard.press('Meta+F');
  await sleep(1200);
  const findVisible = await page.locator('.monaco-findInput, .find-widget, [class*="findWidget"]').first().isVisible().catch(() => false);
  note('find.meta-f', findVisible, 'Meta+F with editor focus opens find widget');
  await screenshot(page, path.join(OUT, 'find-metaf.png'));
  await page.keyboard.press('Escape');

  // Edit menu > Find
  await page.locator('.lm-MenuBar-itemLabel:has-text("Edit"), [class*="MenuBar"] >> text=Edit').first().click();
  await sleep(600);
  await screenshot(page, path.join(OUT, 'edit-menu.png'));
  const findItem = page.locator('.lm-Menu-itemLabel:has-text("Find"), [class*="Menu-itemLabel"]:has-text("Find")').first();
  const findItemVisible = await findItem.isVisible().catch(() => false);
  note('find.menu-item', findItemVisible, 'Edit menu has Find item');
  if (findItemVisible) {
    await findItem.click();
    await sleep(1200);
    const findVisible2 = await page.locator('.monaco-findInput, .find-widget, [class*="findWidget"]').first().isVisible().catch(() => false);
    note('find.menu-open', findVisible2, 'Edit>Find opens find widget');
    await page.keyboard.press('Escape');
  }

  // Rename via tree context menu, check navigator reflects it
  // Open Explorer if collapsed
  const explorer = page.locator('[aria-label="Explorer"], .codicon-files').first();
  await explorer.click().catch(() => {});
  await sleep(1500);
  const node = page.locator('.theia-TreeNode:has-text("probe.txt")').first();
  const nodeVisible = await node.isVisible().catch(() => false);
  note('rename.node-visible', nodeVisible, 'probe.txt visible in navigator');
  if (nodeVisible) {
    await node.click({ button: 'right' });
    await sleep(800);
    const renameItem = page.locator('.lm-Menu-itemLabel:has-text("Rename"), [class*="Menu-itemLabel"]:has-text("Rename")').first();
    await renameItem.click();
    await sleep(800);
    // Theia inline rename input inside the tree node, or the
    // WorkspaceInputDialog (visible inputs only — the search
    // view's hidden include-glob field also matches .theia-input).
    const input = page.locator('.theia-TreeNode input:visible, .dialogBlock input:visible').first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill('probe-renamed.txt');
    const okBtn = page.locator('.dialogBlock button:has-text("OK")').first();
    if (await okBtn.isVisible().catch(() => false)) {
      await okBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await sleep(2000);
    const renamedVisible = await page.locator('.theia-TreeNode:has-text("probe-renamed.txt")').first().isVisible().catch(() => false);
    const onDisk = fs.existsSync(path.join(env.KAIRO_QA_WORKSPACE_DIR, 'probe-renamed.txt'));
    note('rename.disk', onDisk, 'rename landed on disk');
    note('rename.navigator', renamedVisible, 'navigator shows new name without reload (KAIRO-RC-WEB-208)');
    await screenshot(page, path.join(OUT, 'after-rename.png'));
  }

  await browser.close();
  await stopStack(stack.dataDir);
  const failed = findings.filter(f => f.status === 'FAIL');
  if (failed.length) {
    console.error(`${failed.length} findings FAIL`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
