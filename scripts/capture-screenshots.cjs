const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = process.argv[2] || path.join(__dirname, '..', 'docs', 'screenshots', 'current-ui');

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    console.log('Using Microsoft Edge.');
  } catch (e) {
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      console.log('Using Google Chrome.');
    } catch (e2) {
      console.error('No supported browser found. Install Edge/Chrome or run `npx playwright install chromium`.');
      throw e2;
    }
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Inject agent config so browser mode can connect to the Go Runtime Agent.
  // The backend HTML injection only works for Electron preload; regular
  // browsers need this helper for screenshot/automation sessions.
  const agentUrl = process.env.KAIRO_AGENT_URL || 'http://127.0.0.1:18080';
  const agentSecret = process.env.KAIRO_AGENT_SECRET || '';
  if (agentSecret) {
    // Secret only via __kairo.getSecret() closure — never on kairoConfig (S1).
    await page.addInitScript((config) => {
      window.__kairo = { agentBaseUrl: config.agentUrl, getSecret: () => config.agentSecret };
      window.kairoConfig = { agentUrl: config.agentUrl };
      window.__KAIRO_DEFAULT_RUNTIME_URL__ = config.agentUrl;
    }, { agentUrl, agentSecret });
  }

  const consoleMessages = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      console.error('[console.error]', text.substring(0, 500));
    }
  });
  page.on('pageerror', err => {
    console.error('[pageerror]', err.message);
  });

  const port = process.env.KAIRO_PORT || '18301';
  const url = `http://127.0.0.1:${port}`;
  console.log(`Navigating to ${url} ...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for Theia preload overlay to disappear
  try {
    await page.waitForSelector('.theia-preload', { state: 'detached', timeout: 60000 });
    console.log('Preload overlay removed.');
  } catch (e) {
    console.warn('Preload overlay still present after 60s:', e.message);
    await page.evaluate(() => {
      const preload = document.querySelector('.theia-preload');
      if (preload) preload.style.display = 'none';
    });
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(3000);

  const screenshot = async (name) => {
    const file = path.join(OUTPUT_DIR, name);
    await page.screenshot({ path: file, fullPage: false });
    console.log('Saved:', file);
  };

  const clickMenu = async (menuText, itemText) => {
    // Open menu bar item
    await page.click(`.lm-MenuBar-item:has-text("${menuText}")`);
    await page.waitForTimeout(500);
    if (itemText) {
      await page.click(`.lm-Menu-itemLabel:has-text("${itemText}")`);
      await page.waitForTimeout(1500);
    }
  };

  const openViewByCommand = async (commandLabel) => {
    try {
      await page.keyboard.press('Control+Shift+P');
      await page.waitForTimeout(800);
      await page.type('.monaco-inputbox input', commandLabel);
      await page.waitForTimeout(800);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('Command palette failed:', e.message);
    }
  };

  // 1. Main welcome screen
  await screenshot('01-welcome.png');

  // 2. Kairo menu
  try {
    await clickMenu('Kairo');
    await screenshot('02-kairo-menu.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (e) {
    console.log('Kairo menu failed:', e.message);
  }

  // 3. File menu
  try {
    await clickMenu('File');
    await screenshot('03-file-menu.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (e) {
    console.log('File menu failed:', e.message);
  }

  // 4. Open Run Configurations (via command palette)
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(600);
    const input = page.locator('.quick-input-widget .quick-input-box input');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill('Kairo: Manage Run Configurations');
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await screenshot('04-run-configurations.png');
  } catch (e) {
    console.log('Run Configurations failed:', e.message);
  }

  // Helper to open a view through Kairo menu
  const openKairoSubmenuItem = async (submenu, item) => {
    await page.click('.lm-MenuBar-item:has-text("Kairo")');
    await page.waitForTimeout(300);
    await page.hover(`.lm-Menu-itemLabel:has-text("${submenu}")`);
    await page.waitForTimeout(500);
    await page.click(`.lm-Menu-itemLabel:has-text("${item}")`);
    await page.waitForTimeout(2000);
  };

  // 5. Open Server view
  try {
    await openKairoSubmenuItem('View', 'Servers');
    await screenshot('05-server-view.png');
  } catch (e) {
    console.log('Server view failed:', e.message);
  }

  // 6. Open Build view
  try {
    await openKairoSubmenuItem('View', 'Builds');
    await screenshot('06-build-view.png');
  } catch (e) {
    console.log('Build view failed:', e.message);
  }

  // 7. Open Debug view
  try {
    await openKairoSubmenuItem('Debug', 'Open Debug View');
    await screenshot('07-debug-view.png');
  } catch (e) {
    console.log('Debug view failed:', e.message);
  }

  // 8. Open an editor file via File > Open File or by using command palette
  try {
    // Use keyboard shortcut Ctrl+P to open file quick open
    await page.keyboard.press('Control+P');
    await page.waitForTimeout(1000);
    await page.type('.monaco-inputbox input', 'index.jsp');
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await screenshot('08-editor-jsp.png');
  } catch (e) {
    console.log('Open index.jsp failed:', e.message);
  }

  // 9. Open a TS file
  try {
    await page.keyboard.press('Control+P');
    await page.waitForTimeout(1000);
    await page.type('.monaco-inputbox input', 'index.ts');
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await screenshot('09-editor-ts.png');
  } catch (e) {
    console.log('Open index.ts failed:', e.message);
  }

  // 10. Open Preferences
  try {
    await page.keyboard.press('Control+Comma');
    await page.waitForTimeout(2000);
    await screenshot('10-preferences.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (e) {
    console.log('Preferences failed:', e.message);
  }

  // 11. New Project dialog (import wizard)
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(600);
    const palInput = page.locator('.quick-input-widget .quick-input-box input');
    await palInput.waitFor({ state: 'visible', timeout: 5000 });
    await palInput.fill('Kairo: Import Project');
    await page.waitForTimeout(800);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await screenshot('11-new-project-dialog.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } catch (e) {
    console.log('New Project dialog failed:', e.message);
  }

  // 12. Status bar context
  await screenshot('12-status-bar.png');

  const allErrors = consoleMessages.filter(m => m.type === 'error');
  console.log(`Total console errors: ${allErrors.length}`);

  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
