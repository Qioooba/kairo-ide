const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const theiaUrl = process.env.THEIA_URL || 'http://127.0.0.1:3002';
  const agentUrl = process.env.AGENT_URL || 'http://127.0.0.1:18081';
  await page.goto(`${theiaUrl}/?kairoAgent=${encodeURIComponent(agentUrl)}`, {
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  // Wait for shell to load
  await page.waitForSelector('#theia-app-shell, .theia-shell', { timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Take screenshot
  const artifactDir = process.env.KAIRO_TEST_ARTIFACT_DIR || path.resolve(__dirname, 'test-results');
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, 'current-state.png') });
  
  // Get detailed shell structure
  const shellStructure = await page.evaluate(() => {
    const shell = document.querySelector('#theia-app-shell') || document.querySelector('.theia-shell');
    if (!shell) return { error: 'No shell found' };
    
    const result = {
      shellTag: shell.tagName,
      shellClass: shell.className,
      shellId: shell.id,
      childCount: shell.children.length,
      children: []
    };
    
    // Get direct children
    Array.from(shell.children).forEach(child => {
      result.children.push({
        tag: child.tagName,
        className: child.className,
        id: child.id,
        childCount: child.children.length,
        text: child.textContent?.substring(0, 200)
      });
    });
    
    // Look for specific Theia regions
    const regions = [
      '#theia-top-panel',
      '#theia-leftContent',
      '#theia-main-panel',
      '#theia-bottom-panel',
      '#theia-statusBar',
      '.theia-header',
      '.theia-activity-bar'
    ];
    
    result.regions = {};
    for (const region of regions) {
      const el = document.querySelector(region);
      result.regions[region] = el ? {
        exists: true,
        tag: el.tagName,
        className: el.className,
        visible: el.offsetParent !== null,
        childCount: el.children.length
      } : { exists: false };
    }
    
    return result;
  });
  
  console.log('=== Shell Structure ===');
  console.log(JSON.stringify(shellStructure, null, 2));
  
  await browser.close();
})();
