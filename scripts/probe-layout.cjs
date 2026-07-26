/**
 * Check the file navigator & layout
 */
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(12000);

  const layout = await page.evaluate(() => {
    // Find all tabs/labels
    const allTabs = Array.from(document.querySelectorAll(
      '.p-TabBar-tab, [class*="TabBar-tab"], .theia-tab'
    )).map(el => (el.textContent || '').trim()).filter(Boolean);

    // Find sidebar tabs (left side)
    const sideBarTabs = Array.from(document.querySelectorAll(
      '.theia-side-panel .p-TabBar-tab, [class*="side"] [class*="TabBar-tab"], .lm-DockPanel-tabBar .p-TabBar-tab'
    )).map(el => (el.textContent || '').trim()).filter(Boolean);

    // Find any visible tree nodes
    const treeNodes = Array.from(document.querySelectorAll(
      '.p-TreeNode-label, [class*="TreeNode-label"], .theia-TreeNode-label'
    )).map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 20);

    return { allTabs, sideBarTabs, treeNodes };
  });

  console.log('All tabs:', layout.allTabs);
  console.log('Sidebar tabs:', layout.sideBarTabs);
  console.log('Tree nodes:', layout.treeNodes);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
