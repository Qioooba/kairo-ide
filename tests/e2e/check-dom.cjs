const { chromium } = require('@playwright/test');
const { probeUrl } = require('./probe-config.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Check what elements exist
  const elements = await page.evaluate(() => {
    const checks = [
      '#theia-app-shell',
      '.theia-shell',
      '#theia-shell',
      '.lm-MenuBar',
      '.lm-Widget',
      '.theia-header',
      '.theia-app-sidebar-container',
      '.theia-sidepanel',
      '.theia-statusbar',
      '.theia-status-bar',
      '#theia-bottom-panel',
      '#theia-leftContent',
      '[class*="menu"]',
      '[class*="status"]',
      '[class*="sidebar"]',
      '[class*="panel"]',
    ];
    const result = {};
    for (const sel of checks) {
      const els = document.querySelectorAll(sel);
      result[sel] = els.length;
    }
    return result;
  });
  
  console.log('DOM elements found:', JSON.stringify(elements, null, 2));
  
  // Get top-level structure
  const structure = await page.evaluate(() => {
    const shell = document.querySelector('#theia-app-shell') || document.querySelector('.theia-shell');
    if (!shell) return 'No shell found';
    return shell.innerHTML.substring(0, 2000);
  });
  console.log('\nShell structure (first 2000 chars):', structure);
  
  await browser.close();
})();
