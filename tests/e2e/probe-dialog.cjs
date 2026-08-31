const { chromium } = require('playwright');
const { probeUrl } = require('./probe-config.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(10000);
    // Check for trust dialog
    const dialog = await page.evaluate(() => {
      const d = document.querySelector('.workspace-trust-dialog, .theia-trust-dialog, [class*="trust"]');
      if (!d) return 'NO_DIALOG';
      return {
        outerHTML: d.outerHTML.slice(0, 1000),
        className: d.className,
        visible: window.getComputedStyle(d).display !== 'none' && d.offsetWidth > 0
      };
    });
    console.log('DIALOG=' + JSON.stringify(dialog));
    // List all visible buttons
    const buttons = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button').forEach(b => {
        if (b.offsetWidth > 0) {
          out.push({ text: b.textContent?.trim().slice(0, 50), cls: b.className.toString() });
        }
      });
      return out;
    });
    console.log('BUTTONS=' + JSON.stringify(buttons.slice(0, 20), null, 2));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
