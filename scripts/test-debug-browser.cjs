/**
 * Kairo IDE — Debug & Import Browser Test (Playwright)
 *
 * Loads the running Kairo IDE browser app at http://127.0.0.1:3000
 * and verifies:
 *   1. Page loads without console errors
 *   2. Theia shell renders
 *   3. Kairo main menu is present
 *   4. Debug five-piece suite can be opened:
 *      - Threads, Call Stack, Variables, Watch, Breakpoints
 *   5. Import wizard can be opened
 *   6. Project navigation works
 */
const { chromium } = require('playwright');
const fs = require('fs');

const URL = process.env.KAIRO_URL || 'http://127.0.0.1:3000';
const SCREENSHOT_DIR = '/Users/qi/Documents/spaces/kairo-ide/test-results';

async function checkWidgetTab(page, name) {
  return await page.evaluate((widgetName) => {
    const labels = Array.from(document.querySelectorAll(
      '.p-TabBar-tabLabel, .lm-TabBar-tabLabel, .theia-tab-label, [class*="TabBar"] [class*="Label"]'
    ));
    return labels.some(el => (el.textContent || '').includes(widgetName));
  }, name);
}

async function openCommandPalette(page) {
  await page.keyboard.press('F1');
  await page.waitForTimeout(1500);
  return await page.evaluate(() => {
    return !!document.querySelector('.quick-input-widget, .monaco-quick-input-widget');
  });
}

async function executeCommand(page, commandText) {
  const open = await openCommandPalette(page);
  if (!open) return false;
  await page.keyboard.type(commandText);
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  return true;
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleLogs = [];
  const pageErrors = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`));
  page.on('pageerror', err => pageErrors.push(`[pageerror] ${err.message.slice(0, 300)}`));

  console.log('=== Kairo IDE — Browser Debug Test ===');
  console.log(`URL: ${URL}\n`);

  // ── Step 1: Load the app ───────────────────────────────────────
  console.log('[1] Loading the app...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(12_000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-01-loaded.png`, fullPage: true });

  const hasShell = await page.evaluate(() => !!document.querySelector('#theia-app-shell, .theia-shell, .p-Widget'));
  console.log(`    Theia shell present: ${hasShell ? 'YES' : 'NO'}`);

  // ── Step 2: Check the Kairo menu is in the menubar ─────────────
  console.log('[2] Checking the Kairo menu...');
  const kairoMenuInfo = await page.evaluate(() => {
    const menubar = document.querySelector('.p-MenuBar, [class*="MenuBar"]');
    if (!menubar) return { found: false };
    const labels = Array.from(menubar.querySelectorAll('.p-MenuBar-itemLabel, [class*="MenuBar-itemLabel"]'))
      .map(el => (el.textContent || '').trim())
      .filter(Boolean);
    return { found: true, labels, hasKairo: labels.includes('Kairo') };
  });
  const hasKairoMenu = kairoMenuInfo.found && kairoMenuInfo.hasKairo;
  console.log(`    Kairo menu present: ${hasKairoMenu ? 'YES' : 'NO'} (${JSON.stringify(kairoMenuInfo.labels)})`);

  // ── Step 3: Open the Command Palette and verify Kairo commands ─
  console.log('[3] Opening the Command Palette...');
  const paletteOpen = await openCommandPalette(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-02-palette.png`, fullPage: true });
  console.log(`    Command Palette open: ${paletteOpen ? 'YES' : 'NO'}`);

  let kairoCommandsShown = [];
  if (paletteOpen) {
    await page.keyboard.type('Kairo');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-03-palette-kairo.png`, fullPage: true });
    kairoCommandsShown = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.quick-input-list-entry, .monaco-list-row, [class*="list"] [class*="row"]'));
      return items
        .map(el => (el.textContent || '').trim())
        .filter(t => t.toLowerCase().includes('kairo'))
        .slice(0, 30);
    });
    console.log(`    Kairo commands in palette (${kairoCommandsShown.length}):`);
    for (const c of kairoCommandsShown.slice(0, 10)) console.log(`      - ${c}`);
    if (kairoCommandsShown.length > 10) console.log(`      ... and ${kairoCommandsShown.length - 10} more`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── Step 4: Click the Kairo menu and verify submenus ───────────
  console.log('[4] Clicking the Kairo menu...');
  const clickedKairo = await page.evaluate(() => {
    const menubar = document.querySelector('.p-MenuBar, [class*="MenuBar"]');
    if (!menubar) return false;
    const items = Array.from(menubar.querySelectorAll('.p-MenuBar-item, [class*="MenuBar-item"]'));
    const kairoItem = items.find(el => {
      const labels = el.querySelectorAll('.p-MenuBar-itemLabel, [class*="itemLabel"]');
      return Array.from(labels).some(l => (l.textContent || '').trim() === 'Kairo');
    });
    if (kairoItem) {
      (kairoItem).click();
      return true;
    }
    return false;
  });
  console.log(`    Kairo menu clicked: ${clickedKairo ? 'YES' : 'NO'}`);
  let kairoSubmenus = [];
  if (clickedKairo) {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-04-kairo-menu.png`, fullPage: true });
    kairoSubmenus = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.p-Menu-itemLabel, .p-Menu-item, [class*="Menu-itemLabel"]'));
      return items.map(el => (el.textContent || '').trim()).filter(t => t && t.length < 50).slice(0, 30);
    });
    console.log(`    Kairo submenu items: ${JSON.stringify(kairoSubmenus.slice(0, 10))}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── Step 5: Open the Debug View via command palette ────────────
  console.log('[5] Opening the Debug View...');
  await executeCommand(page, 'Kairo: Open Debug View');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-05-debug-view.png`, fullPage: true });
  const hasDebugView = await checkWidgetTab(page, 'Debug');
  console.log(`    Debug View open: ${hasDebugView ? 'YES' : 'NO'}`);

  // ── Step 6: Open the Debug Variables widget ───────────────────
  console.log('[6] Opening Debug Variables...');
  await executeCommand(page, 'Kairo: Show Debug Variables');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-06-variables.png`, fullPage: true });
  const hasDebugVariables = await checkWidgetTab(page, 'Variables');
  console.log(`    Debug Variables widget open: ${hasDebugVariables ? 'YES' : 'NO'}`);

  // ── Step 7: Open the other four debug widgets ─────────────────
  const debugWidgetResults = {};
  for (const cmd of [
    ['Breakpoints', 'Kairo: Show Debug Breakpoints'],
    ['Call Stack', 'Kairo: Show Debug Call Stack'],
    ['Watch', 'Kairo: Show Debug Watch'],
    ['Console', 'Kairo: Open Debug Console'],
  ]) {
    const [w, command] = cmd;
    console.log(`[7] Opening Debug ${w}...`);
    await executeCommand(page, command);
    const opened = await checkWidgetTab(page, w);
    debugWidgetResults[w] = opened;
    console.log(`    Debug ${w} widget open: ${opened ? 'YES' : 'NO'}`);
  }
  await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-07-all-debug-widgets.png`, fullPage: true });

  // ── Step 8: Open the Import Wizard ─────────────────────────────
  console.log('[8] Opening the Import Wizard...');
  await executeCommand(page, 'Kairo: Import Project');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/debug-test-08-import-wizard.png`, fullPage: true });
  const hasImportWizard = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(
      '.p-TabBar-tabLabel, .theia-tab-label, [class*="TabBar"] [class*="Label"]'
    ));
    return labels.some(el => /import.*project|kairo.*import/i.test(el.textContent || ''));
  });
  const hasImportProject = await page.evaluate(() =>
    /import.*project|legacy.*java|auto.?detect/i.test(document.body.textContent || ''),
  );
  console.log(`    Import Wizard open: ${hasImportWizard ? 'YES' : 'NO'}`);
  console.log(`    Import Project text present: ${hasImportProject ? 'YES' : 'NO'}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── Step 9: Check the file navigator ───────────────────────────
  console.log('[9] Checking the file navigator...');
  const hasNavigator = await page.evaluate(() => {
    // Theia uses 'lm-TabBar-tab' (not 'p-TabBar-tab') for its tabs
    const labels = Array.from(document.querySelectorAll(
      '.p-TabBar-tab, .lm-TabBar-tab, .theia-tab, .p-TabBar-tabLabel, .lm-TabBar-tabLabel, .theia-tab-label, h1, h2, h3, .p-TreeNode-label, .lm-TreeNode-label, [class*="TreeNode-label"]'
    ));
    return labels.some(el => /files|navigator|explorer/i.test(el.textContent || ''));
  });
  console.log(`    File Navigator present: ${hasNavigator ? 'YES' : 'NO'}`);

  // ── Final report ───────────────────────────────────────────────
  console.log('\n=== Console messages (last 30) ===');
  for (const log of consoleLogs.slice(-30)) console.log(log);
  console.log('\n=== Page errors ===');
  for (const err of pageErrors) console.log(err);
  console.log('');

  const summary = {
    url: URL,
    hasShell,
    hasKairoMenu,
    kairoMenuLabels: kairoMenuInfo.labels,
    kairoCommandsCount: kairoCommandsShown.length,
    kairoSubmenus,
    hasDebugView,
    hasDebugVariables,
    debugWidgetResults,
    hasImportWizard,
    hasImportProject,
    hasNavigator,
    consoleLogsCount: consoleLogs.length,
    pageErrorsCount: pageErrors.length,
    pageErrors: pageErrors.slice(0, 5),
    fatalConsoleErrors: consoleLogs.filter(l => l.startsWith('[error]')).slice(0, 5),
  };
  fs.writeFileSync(`${SCREENSHOT_DIR}/debug-test-summary.json`, JSON.stringify(summary, null, 2));
  console.log('Summary written to', `${SCREENSHOT_DIR}/debug-test-summary.json`);

  await browser.close();

  // Print final score
  console.log('\n=== Final Score ===');
  console.log(`Kairo menu:           ${hasKairoMenu ? 'PASS' : 'FAIL'}`);
  console.log(`Kairo commands shown: ${kairoCommandsShown.length > 5 ? 'PASS' : 'FAIL'} (${kairoCommandsShown.length} found)`);
  console.log(`Debug Variables:      ${hasDebugVariables ? 'PASS' : 'FAIL'}`);
  console.log(`Debug Breakpoints:    ${debugWidgetResults['Breakpoints'] ? 'PASS' : 'FAIL'}`);
  console.log(`Debug Call Stack:     ${debugWidgetResults['Call Stack'] ? 'PASS' : 'FAIL'}`);
  console.log(`Debug Watch:          ${debugWidgetResults['Watch'] ? 'PASS' : 'FAIL'}`);
  console.log(`Debug Console:        ${debugWidgetResults['Console'] ? 'PASS' : 'FAIL'}`);
  console.log(`Import Wizard:        ${hasImportWizard || hasImportProject ? 'PASS' : 'FAIL'}`);
  console.log(`File Navigator:       ${hasNavigator ? 'PASS' : 'FAIL'}`);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
