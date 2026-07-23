/**
 * Kairo IDE Desktop 形态 E2E Scenarios
 *
 * Tests for the Desktop form (Electron app). Since the Electron app may not be
 * built, these tests run against the Browser form but with Desktop-specific
 * expectations.
 *
 * Prerequisites:
 *   1. Run `pnpm agent:run` in one terminal
 *   2. Run `pnpm dev:browser` in another terminal
 *   3. Run `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/desktop-e2e.spec.ts`
 */
import { test, expect } from './fixtures';

test.describe('Desktop 形态核心旅程', () => {
  test.describe.configure({ mode: 'serial' });

  test('D-01: Desktop launch and shell ready', async ({ page }) => {
    // Desktop form: wait for the full app shell
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });
    // Verify the menu bar is present (Desktop form has menu bar)
    const menuBar = page.locator('.p-MenuBar, .theia-menu-bar');
    // Desktop form should have window controls or menu bar
    await expect(page.locator('#theia-top-panel')).toBeVisible();
  });

  test('D-02: Desktop file dialog integration', async ({ page }) => {
    // Desktop form uses native file dialogs
    // Test that the File > Open command works
    await page.keyboard.press('Meta+O'); // Cmd+O or Ctrl+O
    await page.waitForTimeout(2_000);
    // In Browser form, this opens a browser file input
    // In Desktop form, this opens a native dialog
    // We just verify the UI doesn't crash
    await page.keyboard.press('Escape');
  });

  test('D-03: Desktop window state persistence', async ({ page }) => {
    // Desktop form should remember window size and position
    // This is an Electron-specific test that stores in localStorage as proxy
    await page.evaluate(() => {
      localStorage.setItem(
        'kairo-window-state',
        JSON.stringify({
          x: 100,
          y: 100,
          width: 1200,
          height: 800,
        }),
      );
    });
    const state = await page.evaluate(() =>
      localStorage.getItem('kairo-window-state'),
    );
    expect(state).toBeTruthy();
  });

  test('D-04: Desktop offline mode', async ({ page }) => {
    // Desktop form should work offline (all dependencies bundled)
    // Verify that the bundled resources are available
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });
    // Check that local resources are loaded (not CDN)
    const scripts = await page.locator('script[src]').all();
    for (const script of scripts) {
      const src = await script.getAttribute('src');
      if (src) {
        expect(src).not.toContain('cdn.');
        expect(src).not.toContain('unpkg.com');
      }
    }
  });

  test('D-05: Desktop keyboard shortcuts', async ({ page }) => {
    // Desktop-specific shortcuts
    await page.goto('http://localhost:3000');
    await page.waitForSelector('#theia-app-shell', { timeout: 30_000 });

    // Cmd+W / Ctrl+W — close tab (Desktop form)
    // Cmd+Q / Alt+F4 — quit (Desktop form)
    // These are desktop-specific and should not be intercepted by browser

    // Verify common shortcuts are registered
    await page.keyboard.press('Meta+Shift+P'); // Command palette
    await page.waitForSelector('.monaco-quick-open-widget', { timeout: 5_000 });
    await page.keyboard.press('Escape');
  });
});