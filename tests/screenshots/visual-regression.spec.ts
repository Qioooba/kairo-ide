import { test, expect } from '@playwright/test';
import * as path from 'node:path';

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

test.describe('UI Screenshot Regression', () => {
  test.describe.configure({ mode: 'serial' });

  test('V-01: Welcome page', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.kairo-welcome-body', { timeout: 30000 }).catch(() => {
      // Fallback: Theia welcome
    });
    await expect(page).toHaveScreenshot('welcome.png', { maxDiffPixels: 100 });
  });

  test('V-02: Explorer with project', async ({ page }) => {
    await expect(page).toHaveScreenshot('explorer.png', { maxDiffPixels: 100 });
  });

  test('V-03: Search Center', async ({ page }) => {
    await page.keyboard.press('Control+Shift+F');
    await page.waitForSelector('.kairo-search-center', { timeout: 10000 });
    await expect(page).toHaveScreenshot('search-center.png', { maxDiffPixels: 100 });
  });

  test('V-04: Search Everywhere', async ({ page }) => {
    await page.keyboard.press('Shift+Shift');
    await page.waitForSelector('.kairo-search-everywhere-widget', { timeout: 10000 });
    await expect(page).toHaveScreenshot('search-everywhere.png', { maxDiffPixels: 100 });
  });

  test('V-05: Find File popup', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+O');
    await page.waitForSelector('.kairo-find-modal-backdrop', { timeout: 10000 });
    await expect(page).toHaveScreenshot('find-file.png', { maxDiffPixels: 100 });
  });

  test('V-06: Problems panel', async ({ page }) => {
    await expect(page).toHaveScreenshot('problems.png', { maxDiffPixels: 100 });
  });

  test('V-07: Git Changes view', async ({ page }) => {
    await expect(page).toHaveScreenshot('git-changes.png', { maxDiffPixels: 100 });
  });

  test('V-08: Settings UI', async ({ page }) => {
    await page.keyboard.press('Meta+,');
    await page.waitForSelector('.theia-settings', { timeout: 10000 });
    await expect(page).toHaveScreenshot('settings.png', { maxDiffPixels: 100 });
  });

  test('V-09: Status bar', async ({ page }) => {
    await page.waitForSelector('#theia-statusBar', { timeout: 30000 });
    const statusBar = page.locator('#theia-statusBar');
    await expect(statusBar).toHaveScreenshot('status-bar.png', { maxDiffPixels: 50 });
  });

  test('V-10: Dark theme', async ({ page }) => {
    await expect(page).toHaveScreenshot('dark-theme.png', { maxDiffPixels: 100 });
  });
});