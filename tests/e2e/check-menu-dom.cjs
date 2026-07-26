const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3002?kairoAgent=http://127.0.0.1:18081', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  // Wait for shell to load
  await page.waitForSelector('#theia-app-shell, .theia-shell', { timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Check menu-related elements in detail
  const menuElements = await page.evaluate(() => {
    const result = {
      menuBarClasses: [],
      topPanelElements: [],
      menuTextElements: [],
      allMenuRelated: []
    };
    
    // Find all elements with "menu" in class name
    const menuEls = document.querySelectorAll('[class*="menu"]');
    menuEls.forEach(el => {
      result.allMenuRelated.push({
        tag: el.tagName,
        className: el.className,
        id: el.id,
        text: el.textContent?.substring(0, 100)
      });
    });
    
    // Find top panel area
    const topPanel = document.querySelector('#theia-top-panel, .theia-top-panel');
    if (topPanel) {
      result.topPanelElements.push({
        tag: topPanel.tagName,
        className: topPanel.className,
        childCount: topPanel.children.length,
        innerHTML: topPanel.innerHTML.substring(0, 1000)
      });
    }
    
    // Find elements containing menu text like "File", "Edit", "View"
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      const text = el.textContent?.trim();
      if (text && (text === 'File' || text === 'Edit' || text === 'View' || text === 'Kairo')) {
        result.menuTextElements.push({
          tag: el.tagName,
          className: el.className,
          id: el.id,
          text: text,
          parentClass: el.parentElement?.className
        });
      }
    });
    
    // Check for Lumino/Theia specific menu classes
    const possibleMenuClasses = [
      '.lm-MenuBar', '.theia-MenuBar', '.menu-bar', '.menubar',
      '#theia-menu-bar', '.theia-menu-bar', '[role="menubar"]',
      '.p-MenuBar', '.dockpanel-MenuBar'
    ];
    
    for (const cls of possibleMenuClasses) {
      const els = document.querySelectorAll(cls);
      if (els.length > 0) {
        result.menuBarClasses.push({
          selector: cls,
          count: els.length,
          firstElement: {
            tag: els[0].tagName,
            className: els[0].className,
            visible: els[0].offsetParent !== null
          }
        });
      }
    }
    
    return result;
  });
  
  console.log('=== Menu Elements Analysis ===');
  console.log(JSON.stringify(menuElements, null, 2));
  
  await browser.close();
})();
