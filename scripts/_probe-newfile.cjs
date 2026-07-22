// Probe: reproduce flow-02 FILE_OPS "New File" failure with full pageerror stacks.
const fs = require('fs');
const path = require('path');
const {
  startStack, stopStack, launchBrowser, openPage,
  dismissTrustDialog, waitForStatusBarContains, agentGet, sleep,
} = require('./qa-helpers.cjs');
const { ensurePort18080 } = require('./m2-common.cjs');
const { importProjectViaWizard, openProjectAsWorkspace, ensureExplorerExpanded } = require('./m2-bootstrap.cjs');

async function treeNode(page, caption) {
  const re = caption instanceof RegExp ? caption : new RegExp(caption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const nodes = page.locator('.theia-TreeNode').filter({ hasText: re });
  const count = await nodes.count();
  if (count === 0) throw new Error(`tree node not found: ${caption}`);
  return nodes.nth(count - 1);
}

async function main() {
  ensurePort18080();
  const stackInfo = await startStack({ skipBuild: true, port: 18080 });
  const env = stackInfo.env;
  const webUrl = `http://127.0.0.1:${env.KAIRO_QA_WEB_PORT || 3000}/`;
  const legacyDst = env.KAIRO_QA_LEGACY_DST;
  let browser = null;
  try {
    const health = await agentGet(env, '/api/v1/health', 10000);
    if (!health.ok) throw new Error('agent health failed');
    browser = await launchBrowser({ slowMo: 40 });
    let page = await openPage(browser, webUrl);
    page.on('pageerror', err => {
      console.log('PAGEERROR:', err.message);
      console.log('STACK:', err.stack || '(no stack)');
    });
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Project: (no workspace)', 60000);
    await importProjectViaWizard(page, legacyDst, { name: 'probe-newfile' });
    page = await openProjectAsWorkspace(page);
    page.on('pageerror', err => {
      console.log('PAGEERROR(ws):', err.message);
      console.log('STACK:', err.stack || '(no stack)');
    });
    await ensureExplorerExpanded(page);
    await page.locator('.theia-TreeNode').first().waitFor({ state: 'visible', timeout: 30000 });

    const srcNode = await treeNode(page, /^src$/i);
    await srcNode.click({ button: 'right' });
    const nfCtx = page.locator('.lm-Menu, .p-Menu').first();
    await nfCtx.waitFor({ state: 'visible', timeout: 10000 });
    await nfCtx.getByText('New File...', { exact: true }).first().click();
    const createDialog = page.locator('#theia-dialog-shell .dialogBlock');
    await createDialog.waitFor({ state: 'visible', timeout: 15000 });
    // dump dialog DOM for inspection
    console.log('DIALOG_HTML:', (await createDialog.innerHTML()).slice(0, 2000));
    const nameInput = createDialog.locator('input.theia-input').last();
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.fill('qa-temp.txt');
    await sleep(300);
    console.log('INPUT_VALUE:', await nameInput.inputValue());
    await createDialog.locator('button', { hasText: /^(OK|Create)/i }).first().click();
    await createDialog.waitFor({ state: 'hidden', timeout: 15000 });
    await sleep(2000);
    const target = path.join(legacyDst, 'src', 'qa-temp.txt');
    console.log('ON_DISK:', fs.existsSync(target));
    // also list src dir
    console.log('SRC_LISTING:', fs.readdirSync(path.join(legacyDst, 'src')).join(','));
    await page.screenshot({ path: '/tmp/probe-newfile.png' });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopStack(stackInfo.dataDir).catch(() => {});
  }
}

main().catch(e => { console.error('PROBE FAILED:', e); process.exit(1); });
