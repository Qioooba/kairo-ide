/**
 * Probe - check File Navigator detection
 */
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(15000);

  const navCheck = await page.evaluate(() => {
    const allSelectors = [
      '.p-TabBar-tab',
      '.theia-tab',
      '.p-TabBar-tabLabel',
      '.theia-tab-label',
      'h1', 'h2', 'h3',
      '.p-TreeNode-label',
      '[class*="TreeNode-label"]',
      '[class*="tab"]',
      '[class*="TabBar"][class*="tab"]'
    ];
    const found = {};
    for (const sel of allSelectors) {
      const els = document.querySelectorAll(sel);
      const texts = Array.from(els).map(el => (el.textContent || '').trim()).filter(t => t && t.length < 30);
      if (texts.length > 0) {
        found[sel] = texts.slice(0, 20);
      }
    }
    return found;
  });

  console.log('Elements matching common tab selectors:');
  for (const [sel, texts] of Object.entries(navCheck)) {
    console.log(`  ${sel}:`);
    for (const t of texts) console.log(`    "${t}"`);
  }

  // Check Explorer specifically
  const explorerCheck = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const explorers = allEls.filter(el => {
      const t = (el.textContent || '').trim();
      return t === 'Explorer' && el.children.length === 0;
    });
    return {
      count: explorers.length,
      samples: explorers.slice(0, 5).map(el => el.tagName + '.' + el.className),
    };
  });

  console.log('Explorer elements:', JSON.stringify(explorerCheck));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
