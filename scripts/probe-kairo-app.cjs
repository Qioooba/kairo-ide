/**
 * Quick probe — check what's actually on the page after load
 */
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  page.on('pageerror', e => logs.push(`[err] ${e.message.slice(0, 200)}`));

  await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(12000);

  // Get a structural overview of the page
  const overview = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      shellPresent: !!document.querySelector('#theia-app-shell, .theia-app-shell, .p-Widget'),
      menuBarTexts: Array.from(document.querySelectorAll('.p-MenuBar-itemLabel, .theia-MenuBar-itemLabel, [class*="MenuBar"] [class*="Label"]')).map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 30),
      allHeadings: Array.from(document.querySelectorAll('h1, h2, h3, [class*="title"]')).map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 30),
      bodyText: (document.body.textContent || '').slice(0, 500),
      shellHTML: (document.querySelector('#theia-app-shell, .theia-app-shell')?.outerHTML || '').slice(0, 2000),
    };
  });

  console.log('=== Page Overview ===');
  console.log('URL:', overview.url);
  console.log('Title:', overview.title);
  console.log('Shell present:', overview.shellPresent);
  console.log('Menu labels:', overview.menuBarTexts);
  console.log('Headings:', overview.allHeadings);
  console.log('Body text (first 500):', overview.bodyText);
  console.log('');
  console.log('=== Console / errors (last 30) ===');
  for (const l of logs.slice(-30)) console.log(l);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
