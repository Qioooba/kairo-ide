const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  
  await page.goto('http://127.0.0.1:3002?kairoAgent=http://127.0.0.1:18081', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  // Wait longer for full load
  await page.waitForTimeout(8000);
  
  // Take screenshot
  await page.screenshot({ path: '/Users/qi/Documents/spaces/kairo-ide/tests/e2e/test-results/deep-check.png', fullPage: true });
  
  // Check trust dialog
  const trustDialog = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('.dialogBlock, .theia-dialog, [class*="dialog"], [class*="trust"]');
    return Array.from(dialogs).map(d => ({
      class: d.className,
      visible: d.offsetParent !== null,
      text: d.textContent?.substring(0, 200)
    }));
  });
  
  // Deep inspection of theia-top-panel and split panel
  const deepStructure = await page.evaluate(() => {
    const result = {};
    
    // Top panel deep structure
    const topPanel = document.querySelector('#theia-top-panel');
    if (topPanel) {
      result.topPanel = {
        innerHTML: topPanel.innerHTML.substring(0, 2000),
        display: getComputedStyle(topPanel).display,
        visibility: getComputedStyle(topPanel).visibility,
        height: getComputedStyle(topPanel).height,
        childElementCount: topPanel.childElementCount
      };
    }
    
    // Split panel children
    const splitPanel = document.querySelector('#theia-left-right-split-panel');
    if (splitPanel) {
      result.splitPanelChildren = Array.from(splitPanel.children).map((child, i) => ({
        index: i,
        tag: child.tagName,
        className: child.className,
        id: child.id,
        childCount: child.children.length,
        innerHTML: child.innerHTML.substring(0, 500)
      }));
    }
    
    // Check for any activity bar / sidebar elements anywhere
    result.activityBarSearch = {
      '[class*="activity"]': document.querySelectorAll('[class*="activity"]').length,
      '[class*="sidebar"]': document.querySelectorAll('[class*="sidebar"]').length,
      '[class*="leftContent"]': document.querySelectorAll('[class*="leftContent"]').length,
      '[data-mode-id]': document.querySelectorAll('[data-mode-id]').length,
      '.lm-TabBar': document.querySelectorAll('.lm-TabBar').length,
      '[class*="tabbar"]': document.querySelectorAll('[class*="tabbar"], [class*="tab-bar"]').length,
    };
    
    // Check all lm-Widget elements
    result.lmWidgets = Array.from(document.querySelectorAll('.lm-Widget')).map(w => ({
      tag: w.tagName,
      className: w.className.substring(0, 150),
      id: w.id,
      visible: w.offsetParent !== null,
      rect: w.getBoundingClientRect().toJSON()
    })).filter(w => w.visible && w.rect.height > 10);
    
    return result;
  });
  
  console.log('=== Trust Dialogs ===');
  console.log(JSON.stringify(trustDialog, null, 2));
  console.log('\n=== Deep Structure ===');
  console.log(JSON.stringify(deepStructure, null, 2));
  console.log('\n=== Console Errors ===');
  consoleErrors.forEach(e => console.log('  ERROR:', e.substring(0, 200)));
  console.log('\n=== Page Errors ===');
  pageErrors.forEach(e => console.log('  ERROR:', e.substring(0, 200)));
  
  await browser.close();
})();
