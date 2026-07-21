const { startStack, stopStack, launchBrowser, openPage, dismissTrustDialog, sleep, waitForStatusBarContains } = require('./qa-helpers.cjs');
const { ensurePort18080 } = require('./m2-common.cjs');
const { openProjectAsWorkspace } = require('./m2-bootstrap.cjs');
(async () => {
  ensurePort18080();
  const stack = await startStack({ skipBuild: true, port: 18080 });
  let browser = null;
  try {
    browser = await launchBrowser({ slowMo: 0 });
    let page = await openPage(browser, `http://127.0.0.1:${stack.env.KAIRO_QA_WEB_PORT}/`);
    await dismissTrustDialog(page);
    await waitForStatusBarContains(page, 'Runtime: connected', 60000);
    page = await openProjectAsWorkspace(page);
    await page.locator('[aria-label="Explorer"]').first().click().catch(() => {});
    await sleep(3000);
    const dump = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.theia-TreeNode')];
      return {
        count: nodes.length,
        samples: nodes.slice(0, 6).map(n => ({ cls: n.className, text: (n.textContent||'').slice(0,50), parent: n.parentElement?.className })),
        filesHtml: (document.getElementById('files')?.outerHTML || 'NO #files').slice(0, 600),
      };
    });
    console.log(JSON.stringify(dump, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopStack(stack.dataDir);
  }
})().catch(e => { console.error(e); process.exit(1); });
