const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots', 'current-ui');

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (e) {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Inject agent config so browser mode can connect to the Go Runtime Agent.
  const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18080';
  const agentSecret = process.env.KAIRO_AGENT_SECRET || '';
  if (agentSecret) {
    await page.addInitScript((config) => {
      window.__kairo = { agentBaseUrl: config.agentUrl, getSecret: () => config.agentSecret };
      window.kairoConfig = { agentUrl: config.agentUrl, agentSecret: config.agentSecret };
      window.__KAIRO_DEFAULT_RUNTIME_URL__ = config.agentUrl;
    }, { agentUrl, agentSecret });
  }

  await page.goto('http://127.0.0.1:18301', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const screenshot = async (name) => {
    const file = path.join(OUTPUT_DIR, name);
    await page.screenshot({ path: file, fullPage: false });
    console.log('Saved:', file);
  };

  const openKairoSubmenuItem = async (submenu, item) => {
    await page.click('.lm-MenuBar-item:has-text("Kairo")');
    await page.waitForTimeout(300);
    await page.hover(`.lm-Menu-itemLabel:has-text("${submenu}")`);
    await page.waitForTimeout(500);
    await page.click(`.lm-Menu-itemLabel:has-text("${item}")`);
    await page.waitForTimeout(2000);
  };

  const closeActiveTab = async () => {
    try {
      await page.click('.p-TabBar-tabLabel.p-mod-current + .p-TabBar-tabCloseIcon, .p-TabBar-tab.p-mod-current .p-TabBar-tabCloseIcon');
      await page.waitForTimeout(500);
    } catch (e) {}
  };

  // 1. Expanded file tree
  try {
    await page.click('.theia-TreeNodeSegmentGrow:text-is("src")');
    await page.waitForTimeout(500);
    await page.click('.theia-TreeNodeSegmentGrow:text-is("main")');
    await page.waitForTimeout(500);
    await screenshot('13-expanded-tree.png');
  } catch (e) {
    console.log('Tree expand failed:', e.message);
  }

  // 2. Tomcat Logs view
  try {
    await openKairoSubmenuItem('View', 'Tomcat Logs');
    await screenshot('14-tomcat-logs.png');
  } catch (e) {
    console.log('Tomcat Logs failed:', e.message);
  }

  // 3. Maven view
  try {
    await openKairoSubmenuItem('View', 'Maven');
    await screenshot('15-maven-view.png');
  } catch (e) {
    console.log('Maven view failed:', e.message);
  }

  // 4. Deployments view
  try {
    await openKairoSubmenuItem('View', 'Deployments');
    await screenshot('16-deployments.png');
  } catch (e) {
    console.log('Deployments failed:', e.message);
  }

  // 5. Performance Dashboard
  try {
    await openKairoSubmenuItem('View', 'Performance');
    await screenshot('17-performance-dashboard.png');
  } catch (e) {
    console.log('Performance Dashboard failed:', e.message);
  }

  // 6. Debug Variables focused
  try {
    await openKairoSubmenuItem('Debug', 'Variables');
    await screenshot('18-debug-variables.png');
  } catch (e) {
    console.log('Debug Variables failed:', e.message);
  }

  // 7. Debug Breakpoints
  try {
    await openKairoSubmenuItem('Debug', 'Breakpoints');
    await screenshot('19-debug-breakpoints.png');
  } catch (e) {
    console.log('Debug Breakpoints failed:', e.message);
  }

  // 8. Test Results
  try {
    await openKairoSubmenuItem('View', 'Test Results');
    await screenshot('20-test-results.png');
  } catch (e) {
    console.log('Test Results failed:', e.message);
  }

  await browser.close();
})();
