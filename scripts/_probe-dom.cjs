// One-off DOM probe: what does the left side bar contain in this product?
const {
  startStack, stopStack, launchBrowser, openPage, dismissTrustDialog, sleep,
} = require('./qa-helpers.cjs');
const { ensurePort18080 } = require('./m2-common.cjs');

(async () => {
  ensurePort18080();
  const stack = await startStack({ skipBuild: true, port: 18080 });
  const webUrl = `http://127.0.0.1:${stack.env.KAIRO_QA_WEB_PORT}/`;
  let browser = null;
  try {
    browser = await launchBrowser({ slowMo: 0 });
    const page = await openPage(browser, webUrl);
    await dismissTrustDialog(page);
    await sleep(3000);
    const info = await page.evaluate(() => {
      const out = {};
      const left = document.getElementById('theia-left-content-panel');
      out.leftPanelExists = !!left;
      out.leftPanelHTML = left ? left.outerHTML.slice(0, 800) : null;
      out.leftPanelClasses = left ? left.className : null;
      out.leftPanelVisible = left ? left.getBoundingClientRect().width : null;
      out.filesWidget = !!document.getElementById('files');
      out.explorerView = !!document.getElementById('explorer-view--files');
      const activityBar = document.querySelector('.p-TabBar, .lm-TabBar');
      out.activityItems = [...document.querySelectorAll('.p-TabBar-tab, .lm-TabBar-tab')].map(t => t.getAttribute('aria-label') || t.textContent?.trim()).slice(0, 10);
      out.allViewIds = [...document.querySelectorAll('[id]')].map(e => e.id).filter(id => /files|explorer|navigator|left|sidebar/i.test(id)).slice(0, 20);
      return out;
    });
    console.log(JSON.stringify(info, null, 2));
    // try clicking the files activity icon and re-probe
    await page.locator('.p-TabBar-tab, .lm-TabBar-tab').first().click().catch(() => {});
    await sleep(1500);
    const info2 = await page.evaluate(() => {
      const left = document.getElementById('theia-left-content-panel');
      return {
        width: left ? left.getBoundingClientRect().width : null,
        display: left ? getComputedStyle(left).display : null,
        childCount: left ? left.children.length : null,
        filesWidget: !!document.getElementById('files'),
        treeNodes: document.querySelectorAll('#files .theia-TreeNode').length,
      };
    });
    console.log('AFTER CLICK:', JSON.stringify(info2, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopStack(stack.dataDir);
  }
})().catch(e => { console.error(e); process.exit(1); });
