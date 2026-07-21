// One-off probe: drive File menu -> Open... -> Theia FileDialog -> legacy-sample,
// then dump URL, workspace root nodes, panel state, tree contents.
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog, sleep,
  waitForStatusBarContains,
} = require('./qa-helpers.cjs');
const { ensurePort18080, selectFolderInTheiaFileDialog } = require('./m2-common.cjs');

(async () => {
  ensurePort18080();
  const stack = await startStack({ skipBuild: true, port: 18080 });
  const webUrl = `http://127.0.0.1:${stack.env.KAIRO_QA_WEB_PORT}/`;
  let browser = null;
  try {
    browser = await launchBrowser({ slowMo: 0 });
    const page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Runtime: connected', 60000);
    console.log('BEFORE url=', page.url());

    await page.locator('.lm-MenuBar-item', { hasText: 'File' }).first().click();
    await sleep(600);
    const menu = page.locator('.lm-Menu').first();
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    const items = await menu.locator('.lm-Menu-itemLabel').allTextContents();
    console.log('FILE MENU ITEMS:', JSON.stringify(items));
    await menu.getByText('Open...', { exact: true }).first().click();
    await selectFolderInTheiaFileDialog(page, 'legacy-sample', { upCount: 1 });
    console.log('dialog confirmed');
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
    await sleep(9000);
    console.log('AFTER url=', page.url());

    const state = await page.evaluate(() => {
      const left = document.getElementById('theia-left-content-panel');
      return {
        collapsed: left ? left.className.includes('theia-mod-collapsed') : null,
        filesTreeNodes: [...document.querySelectorAll('#files .theia-TreeNode')].map(n => n.textContent?.slice(0, 60)).slice(0, 10),
        statusBar: (document.getElementById('theia-statusBar')?.textContent || '').slice(0, 200),
      };
    });
    console.log('STATE:', JSON.stringify(state, null, 2));

    // expand explorer
    await page.locator('[aria-label="Explorer"]').first().click().catch(() => {});
    await sleep(2500);
    const state2 = await page.evaluate(() => ({
      width: document.getElementById('theia-left-content-panel')?.getBoundingClientRect().width,
      filesTreeNodes: [...document.querySelectorAll('#files .theia-TreeNode')].map(n => n.textContent?.slice(0, 60)).slice(0, 15),
    }));
    console.log('AFTER EXPLORER CLICK:', JSON.stringify(state2, null, 2));
    await page.screenshot({ path: '/tmp/probe-open-ws.png' });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopStack(stack.dataDir);
  }
})().catch(e => { console.error(e); process.exit(1); });
