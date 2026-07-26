/**
 * Probe — dump the menubar HTML structure
 */
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(12000);

  const menuBarInfo = await page.evaluate(() => {
    const menubar = document.querySelector('.p-MenuBar, [class*="MenuBar"]');
    if (!menubar) return { found: false };
    return {
      found: true,
      className: menubar.className,
      childCount: menubar.children.length,
      // List ALL items
      items: Array.from(menubar.querySelectorAll('.p-MenuBar-item, [class*="MenuBar-item"]')).map(el => ({
        text: (el.textContent || '').trim().slice(0, 50),
        className: el.className,
        ariaLabel: el.getAttribute('aria-label'),
      })),
    };
  });

  console.log(JSON.stringify(menuBarInfo, null, 2));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
