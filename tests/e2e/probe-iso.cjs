const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errs.push('CONSOLE-ERR: ' + msg.text().slice(0, 200));
  });
  try {
    await page.goto('http://127.0.0.1:3070', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#theia-shell, #theia-app-shell, .theia-shell', { timeout: 30000 });
    await page.waitForTimeout(5000);
    const title = await page.title();
    const shellVisible = await page.locator('#theia-app-shell, .theia-shell, #theia-shell').first().isVisible().catch(() => false);
    const menuBar = await page.locator('#theia-menu-bar, .theia-menu-bar').count();
    const statusBar = await page.locator('#theia-statusBar, .theia-status-bar').count();
    const editorArea = await page.locator('#theia-editor-area, .theia-editor-area').count();
    const leftContent = await page.locator('#theia-leftContent, .theia-activity-bar').count();
    await page.keyboard.press('F1');
    await page.waitForTimeout(1500);
    const paletteVisible = await page.locator('.quick-input-widget').first().isVisible().catch(() => false);
    let kairoCommands = 0;
    if (paletteVisible) {
      await page.keyboard.type('Kairo:', { delay: 30 });
      await page.waitForTimeout(800);
      kairoCommands = await page.locator('.monaco-list .monaco-list-row').count();
    }
    console.log('TITLE=' + title);
    console.log('SHELL_VISIBLE=' + shellVisible);
    console.log('MENU_BAR=' + menuBar);
    console.log('STATUS_BAR=' + statusBar);
    console.log('EDITOR_AREA=' + editorArea);
    console.log('LEFT_CONTENT=' + leftContent);
    console.log('COMMAND_PALETTE_VISIBLE=' + paletteVisible);
    console.log('KAIRO_COMMANDS=' + kairoCommands);
    console.log('ERRORS_COUNT=' + errs.length);
    errs.slice(0, 10).forEach((e, i) => console.log('ERR' + i + '=' + e));
  } catch (e) {
    console.log('FATAL=' + e.message);
  }
  await browser.close();
})();
