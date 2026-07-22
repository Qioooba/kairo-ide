// Probe: does the backend file watcher deliver external changes? (WEB-208 root-cause)
'use strict';

const path = require('path');
const fs = require('fs');
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog,
  waitForStatusBarContains, ensureDir, sleep,
} = require('./qa-helpers.cjs');

const QA_ROOT = process.env.KAIRO_QA_ROOT || '/tmp/kairo-mac-web-qa';
const OUT = ensureDir(path.join(QA_ROOT, 'results', 'probe-watcher'));

async function main() {
  const stack = await startStack({ dataDir: path.join(QA_ROOT, 'probe-watch-stack'), port: 19090 });
  const env = stack.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT}/?kairoAgent=${encodeURIComponent('http://127.0.0.1:19090')}`;
  const wsDir = env.KAIRO_QA_WORKSPACE_DIR;

  const browser = await launchBrowser();
  const page = await openPage(browser, webUrl);
  await dismissTrustDialog(page);
  await waitForStatusBarContains(page, 'Runtime: connected', 90000);

  // Expand Explorer
  await page.locator('[aria-label="Explorer"], .codicon-files').first().click().catch(() => {});
  await sleep(1500);

  // External change: create a file behind the UI's back
  fs.writeFileSync(path.join(wsDir, 'external-seed.txt'), 'external change\n');
  await sleep(4000);
  const visible = await page.locator('.theia-TreeNode:has-text("external-seed.txt")').first().isVisible().catch(() => false);
  console.log(`${visible ? 'PASS' : 'FAIL'} watcher.external-create — externally created file appears in navigator without refresh`);

  await browser.close();
  await stopStack(stack.dataDir);
  process.exit(visible ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
