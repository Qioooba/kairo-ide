/**
 * Probe - find the actual Explorer element
 */
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(15000);

  const explorerInfo = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const explorerTexts = allEls.filter(el => {
      const t = (el.textContent || '').trim();
      return t === 'Explorer' && el.children.length <= 1;
    });
    return explorerTexts.slice(0, 5).map(el => ({
      tag: el.tagName,
      className: el.className,
      parentClass: el.parentElement?.className,
    }));
  });

  console.log('Explorer text elements:');
  for (const e of explorerInfo) console.log(' ', JSON.stringify(e));

  // Check exact TabBar class
  const tabBarClass = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const matches = all.filter(el => /Explorer/.test(el.textContent || '') && el.children.length === 0);
    if (matches.length === 0) return null;
    // Walk up to find the tab container
    let el = matches[0];
    const ancestry = [];
    for (let i = 0; i < 5 && el; i++) {
      ancestry.push({ tag: el.tagName, className: el.className });
      el = el.parentElement;
    }
    return ancestry;
  });

  console.log('\nAncestry of Explorer element:');
  for (const a of (tabBarClass || [])) console.log(' ', JSON.stringify(a));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
