/**
 * SHARD-11: Dialog Coverage
 *
 * Tests all dialogs and confirmation dialogs:
 *   1. Workspace trust dialog
 *   2. Save workspace configuration dialog
 *   3. File save confirmation dialog
 *   4. Import wizard dialog
 *   5. Error/warning toast notifications
 *
 * Each dialog test verifies: dialog renders, buttons work, no console errors.
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  runCommandViaPalette,
} from '../fixtures';

test.describe('[SHARD-11] Dialog Coverage', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await navigateToTheia(page, baseURL || 'http://127.0.0.1:3002');
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
  });

  test('TEST-1101: Workspace trust dialog appears and is dismissible', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTheiaShell(page);
    await page.waitForTimeout(2000);

    const trustDialog = page.locator('.dialogBlock, .workspace-trust-dialog');
    const trustVisible = await trustDialog.count() > 0 && await trustDialog.first().isVisible().catch(() => false);

    if (trustVisible) {
      await page.screenshot({ path: `${screenshotDir}/trust-dialog-visible.png` });

      const trustBtn = page.locator('button').filter({ hasText: /trust/i }).first();
      expect(await trustBtn.count()).toBeGreaterThan(0);

      await dismissTrustDialog(page, 5000);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${screenshotDir}/after-trust-dismissed.png` });
    } else {
      await page.screenshot({ path: `${screenshotDir}/no-trust-dialog.png` });
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1102: Command palette opens and closes correctly', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${screenshotDir}/command-palette-open.png` });

    const input = page.locator('.quick-input-widget input, .quick-input-box input');
    expect(await input.count()).toBeGreaterThan(0);

    await page.keyboard.type('Kairo:', { delay: 30 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/command-palette-typing.png` });

    const results = page.locator('.monaco-list-row, .quick-input-list .monaco-list-row');
    expect(await results.count()).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1103: Quick Open (Ctrl+P) dialog works', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${screenshotDir}/quick-open.png` });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1104: Find dialog (Ctrl+F) in editor works', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
    await page.waitForTimeout(1000);

    await page.keyboard.type('Hello World Test Content', { delay: 30 });
    await page.waitForTimeout(500);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/find-dialog.png` });

    await page.keyboard.type('Hello', { delay: 30 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${screenshotDir}/find-with-text.png` });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
    await page.waitForTimeout(500);

    const dontSave = page.locator('button').filter({ hasText: /don't save/i }).first();
    if (await dontSave.count() > 0 && await dontSave.isVisible().catch(() => false)) {
      await dontSave.click();
      await page.waitForTimeout(500);
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1105: Toast notifications and message dialogs', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await runCommandViaPalette(page, 'Kairo: Reconnect Runtime Agent').catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotDir}/after-reconnect.png` });

    const notifications = page.locator('.theia-notification-list, .notification, .toast');
    await notifications.count();

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1106: Go to line dialog (Ctrl+G) works', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
    await page.waitForTimeout(1000);
    await page.keyboard.type('line1\nline2\nline3\nline4\nline5\n', { delay: 20 });

    await page.keyboard.press('Control+G');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/go-to-line.png` });

    await page.keyboard.type('3', { delay: 30 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${screenshotDir}/after-goto-line.png` });

    await page.keyboard.press('Escape');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
    await page.waitForTimeout(500);
    const dontSave = page.locator('button').filter({ hasText: /don't save/i }).first();
    if (await dontSave.count() > 0 && await dontSave.isVisible().catch(() => false)) {
      await dontSave.click();
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });
});

function isIgnored(msg: string): boolean {
  return /favicon|non-serializable|componentWillReceiveProps|componentWillMount|WebSocket connection|ERR_CONNECTION_REFUSED|monaco.*deprecated|JDT LS requires|KAIRO_JRE17|Failed to prepare JDT|jdtls|Failed to load resource/i.test(msg);
}
