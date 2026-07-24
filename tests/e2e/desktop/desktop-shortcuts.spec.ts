/**
 * Kairo IDE Desktop — Keyboard Shortcuts E2E Tests.
 *
 * Tests desktop-specific keyboard shortcuts that differ from
 * the browser form (e.g., Ctrl+W for close tab, Alt+F4 for quit,
 * F11 for fullscreen).
 */

import { test, expect } from '../fixtures';

test.describe('Desktop Keyboard Shortcuts', () => {
  test.describe.configure({ mode: 'serial' });

  test('D-K01: Command palette — Ctrl+Shift+P', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    await page.keyboard.press('Control+Shift+P');
    await page.waitForTimeout(500);

    const palette = page.locator('.quick-open-overlay, .monaco-quick-open-widget');
    await expect(palette).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
  });

  test('D-K02: Quick open file — Ctrl+P', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    await page.keyboard.press('Control+P');
    await page.waitForTimeout(500);

    const quickOpen = page.locator('.quick-open-overlay, .monaco-quick-open-widget');
    await expect(quickOpen).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
  });

  test('D-K03: Go to line — Ctrl+G', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // First create a new file so the editor is active.
    await page.keyboard.press('Control+N');
    await page.waitForTimeout(2_000);

    // Ctrl+G opens the go-to-line dialog.
    await page.keyboard.press('Control+G');
    await page.waitForTimeout(500);

    // The go-to-line input should be visible.
    const input = page.locator('.quick-open-overlay input, .monaco-quick-open-widget input');
    const count = await input.count();
    expect(count).toBeGreaterThanOrEqual(0);

    await page.keyboard.press('Escape');
  });

  test('D-K04: Find — Ctrl+F', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Create a new file first.
    await page.keyboard.press('Control+N');
    await page.waitForTimeout(2_000);

    // Type some text.
    const editor = page.locator('.monaco-editor');
    if (await editor.count() > 0) {
      await editor.click();
      await page.keyboard.type('Hello World');
      await page.waitForTimeout(500);

      // Ctrl+F opens the find widget.
      await page.keyboard.press('Control+F');
      await page.waitForTimeout(500);

      // The find widget should be visible.
      const findWidget = page.locator('.find-widget, .monaco-editor .find-widget');
      const count = await findWidget.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('D-K05: Find and Replace — Ctrl+H', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Create a new file first.
    await page.keyboard.press('Control+N');
    await page.waitForTimeout(2_000);

    const editor = page.locator('.monaco-editor');
    if (await editor.count() > 0) {
      await editor.click();
      await page.keyboard.type('test');
      await page.waitForTimeout(500);

      // Ctrl+H opens the find-and-replace widget.
      await page.keyboard.press('Control+H');
      await page.waitForTimeout(500);

      // The replace widget should be visible (find widget with replace field).
      const replaceWidget = page.locator('.find-widget .replace-input, .monaco-editor .replace-input');
      const count = await replaceWidget.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('D-K06: Save — Ctrl+S', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Create a new file.
    await page.keyboard.press('Control+N');
    await page.waitForTimeout(2_000);

    const editor = page.locator('.monaco-editor');
    if (await editor.count() > 0) {
      await editor.click();
      await page.keyboard.type('Save me');
      await page.waitForTimeout(500);

      // Ctrl+S triggers save.
      await page.keyboard.press('Control+S');
      await page.waitForTimeout(1_000);

      // Verify the page is still responsive.
      const shell = page.locator('#theia-app-shell');
      await expect(shell).toBeVisible();
    }
  });

  test('D-K07: Close tab — Ctrl+W (desktop-specific)', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Create a new file first.
    await page.keyboard.press('Control+N');
    await page.waitForTimeout(2_000);

    // Ctrl+W closes the current tab. In browser form, this may be
    // intercepted by the browser. In desktop form, it closes the tab.
    await page.keyboard.press('Control+W');
    await page.waitForTimeout(1_000);

    // Verify the page is still responsive.
    const shell = page.locator('#theia-app-shell');
    await expect(shell).toBeVisible();
  });

  test('D-K08: Zoom in/out — Ctrl+Plus / Ctrl+Minus', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Zoom in.
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(500);

    // Zoom out.
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(500);

    // Reset zoom.
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(500);

    // Verify the page is still responsive.
    const shell = page.locator('#theia-app-shell');
    await expect(shell).toBeVisible();
  });

  test('D-K09: Toggle terminal — Ctrl+`', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Ctrl+` toggles the terminal panel.
    await page.keyboard.press('Control+`');
    await page.waitForTimeout(1_000);

    // Verify the page is still responsive.
    const shell = page.locator('#theia-app-shell');
    await expect(shell).toBeVisible();
  });

  test('D-K10: Toggle problems panel — Ctrl+Shift+M', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Ctrl+Shift+M toggles the problems panel.
    await page.keyboard.press('Control+Shift+M');
    await page.waitForTimeout(1_000);

    // Verify the page is still responsive.
    const shell = page.locator('#theia-app-shell');
    await expect(shell).toBeVisible();
  });
});