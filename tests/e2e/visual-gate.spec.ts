/**
 * Kairo visual gate (UI-08) — Playwright image assertions with approved baselines.
 *
 * Classification: VISUAL GATE. Unlike visual-regression.cjs (capture smoke),
 * these tests FAIL on pixel differences outside the approved baselines and
 * produce actual/expected/diff artifacts per case.
 *
 * Baseline workflow (REPORT §7.4–§7.5, §8):
 *  1. First run on a clean build produces actual/ images with no baseline.
 *  2. A human reviewer inspects every actual/ image (margins, alignment,
 *     truncation, clickability, wording, focus, state) and records the
 *     verdict in review.json next to the case.
 *  3. Only AFTER approval: `npx playwright test --config
 *     tests/e2e/playwright.config.ts visual-gate.spec.ts --update-snapshots`
 *     promotes actual/ to approved baselines. Bulk-updating baselines to
 *     silence failures is prohibited — a diff must first be explained.
 *  4. Baselines are environment-pinned (1440x900, dark, zh-CN, 100%).
 *     Cross-theme/locale/viewport coverage stays in the campaign specs.
 *
 * Requires a running stack: Runtime Agent + Theia Browser (see header of
 * tests/e2e/playwright.config.ts).
 */
import { test, expect } from '@playwright/test';

test.describe('visual gate @visual', () => {
  test('VG-01 shell baseline', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#theia-statusBar', { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot('vg-shell.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    });
  });

  test('VG-02 command palette baseline (open state)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#theia-statusBar', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
    await page.waitForTimeout(500);
    // Open state must be captured — a closed-palette screenshot proves nothing (UI).
    await expect(page.locator('.quick-input-widget')).toBeVisible();
    await expect(page).toHaveScreenshot('vg-command-palette.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
    });
    await page.keyboard.press('Escape').catch(() => undefined);
  });

  test('VG-03 run configurations view baseline', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#theia-statusBar', { timeout: 60_000 });
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget .quick-input-box input').first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill('>Kairo: Manage Run Configurations');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    const view = page.locator('.kairo-widget').filter({ hasText: 'Run Configurations' }).first();
    await expect(view).toBeVisible({ timeout: 30_000 });
    await expect(view).toHaveScreenshot('vg-run-configurations.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
