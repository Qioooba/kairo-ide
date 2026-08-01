/**
 * Temporary script to capture current Kairo IDE UI screenshots for analysis.
 * Runs against the already-started browser mode on http://127.0.0.1:3001.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3001';
const OUT_DIR = path.join(__dirname, 'current-ui');

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function dismissDialogs(page) {
    const trustBtn = page.locator('button:has-text("Yes, I trust")').first();
    try {
        await trustBtn.waitFor({ state: 'visible', timeout: 3000 });
        await trustBtn.click();
        await sleep(500);
    } catch { /* no dialog */ }

    const dontSave = page.locator('button:has-text("Don\'t Save")').first();
    try {
        await dontSave.waitFor({ state: 'visible', timeout: 2000 });
        await dontSave.click();
        await sleep(500);
    } catch { /* no dialog */ }
}

async function runCommand(page, label) {
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('Control+Shift+P');
    await sleep(600);
    const input = page.locator('.quick-input-widget .quick-input-box input');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill('>' + label);
    await sleep(800);
    const firstRow = page.locator('.quick-input-widget .monaco-list-row').first();
    if (await firstRow.count() > 0) {
        await firstRow.click();
    } else {
        await page.keyboard.press('Enter');
    }
    await sleep(1500);
}

async function capturePanel(page, name, selector) {
    try {
        const el = page.locator(selector).first();
        if (await el.count() > 0 && await el.isVisible()) {
            await el.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
            console.log(`Captured ${name}.png`);
        } else {
            await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
            console.log(`Captured ${name}.png (full page fallback)`);
        }
    } catch (e) {
        await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
        console.log(`Captured ${name}.png (fallback due to ${e.message})`);
    }
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    console.log('Navigating to', BASE_URL);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { state: 'attached', timeout: 30000 });
    await sleep(3000);
    await dismissDialogs(page);
    await sleep(1000);

    // Selectors
    const leftPanel = '#theia-left-content-panel, .theia-left-side-panel';
    const mainPanel = '#theia-main-content-panel';
    const bottomPanel = '#theia-bottom-content-panel, .theia-bottom-panel';

    // 1. Welcome page in main area
    await capturePanel(page, '01-welcome', mainPanel);

    // 2. Servers view (left panel)
    await runCommand(page, 'Kairo: Show Servers');
    await capturePanel(page, '02-servers', leftPanel);

    // 3. Builds view (left panel)
    await runCommand(page, 'Kairo: Show Builds');
    await capturePanel(page, '03-builds', leftPanel);

    // 4. Deployments view (left panel)
    await runCommand(page, 'Kairo: Show Deployments');
    await capturePanel(page, '04-deployments', leftPanel);

    // 5. Run Configurations (main area)
    await runCommand(page, 'Kairo: Manage Run Configurations');
    await capturePanel(page, '05-run-configurations', mainPanel);

    // 6. Tomcat Logs (left panel)
    await runCommand(page, 'Kairo: Show Tomcat Logs');
    await capturePanel(page, '06-tomcat-logs', leftPanel);

    // 7. Debug Variables (left panel)
    await runCommand(page, 'Kairo: Show Debug Variables');
    await capturePanel(page, '07-debug-variables', leftPanel);

    // 8. Debug Callstack (left panel)
    await runCommand(page, 'Kairo: Show Debug Call Stack');
    await capturePanel(page, '08-debug-callstack', leftPanel);

    // 9. Debug Breakpoints (left panel)
    await runCommand(page, 'Kairo: Show Debug Breakpoints');
    await capturePanel(page, '09-debug-breakpoints', leftPanel);

    // 10. Debug Tool Window (bottom panel)
    await runCommand(page, 'Debug: Open Debug Tool Window (IDEA-style)');
    await capturePanel(page, '10-debug-tool-window', bottomPanel);

    // 11. Full IDE shell with activity bar and status bar
    await page.screenshot({ path: path.join(OUT_DIR, '11-full-shell.png') });
    console.log('Captured 11-full-shell.png');

    // 12. Command palette styling
    await page.keyboard.press('F1');
    await sleep(600);
    await capturePanel(page, '12-command-palette', '.quick-input-widget');
    await page.keyboard.press('Escape');

    // 13. Menu bar (Run menu open)
    // Current Theia (1.73) uses Lumino v2 class prefixes (`lm-`), so the old
    // `p-`/VS Code style selectors no longer match. Probe verified:
    //   menubar: .lm-MenuBar (inside #theia-top-panel)
    //   item:    li.lm-MenuBar-item > div.lm-MenuBar-itemLabel
    //   menu:    div.lm-Menu.lm-MenuBar-menu
    const runMenu = page.locator('.lm-MenuBar-item:has-text("Run"), .p-MenuBar-item:has-text("Run")').first();
    if (await runMenu.count() > 0) {
        await runMenu.click();
        await sleep(500);
        await capturePanel(page, '13-run-menu', '.lm-Menu, .monaco-menu');
        await page.keyboard.press('Escape');
    }

    // 14. Preferences / Settings page
    await runCommand(page, 'Preferences: Open Settings (UI)');
    await sleep(1000);
    await capturePanel(page, '14-preferences', mainPanel);

    await browser.close();
    console.log('Done. Screenshots saved to', OUT_DIR);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
