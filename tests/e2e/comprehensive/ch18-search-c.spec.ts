/**
 * Chapter 18 (part 3) — Browser column.
 * 18.5 docked Find 结果窗   TC-SRCH-051..052
 */
import { test, expect } from '@playwright/test';
import { W2, openIdeAt, SEARCH_CENTER_SHORTCUT } from './ch18-helpers';

test('TC-SRCH-051 [P2] kairo.search.results.open 底部 Find 窗 + 共享 session model', async ({ page }) => {
  await openIdeAt(page, W2);
  await page.waitForTimeout(1500); // let keybindings finish attaching

  // open the docked tool window via its command BEFORE any search → idle
  const palette = page.locator('.quick-input-widget .quick-input-box input').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('F1');
    try { await palette.waitFor({ state: 'visible', timeout: 2_500 }); break; } catch { /* retry */ }
  }
  await palette.waitFor({ state: 'visible', timeout: 8_000 });
  await palette.fill('>Open Find Tool Window');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  const docked = page.locator('#theia-bottom-content-panel [data-testid="search-results-panel"]');
  await expect(docked).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="find-tool-idle"]')).toBeVisible(); // bottom rank area, idle

  // search from the modal — docked window mirrors results (shared model)
  await page.keyboard.press(SEARCH_CENTER_SHORTCUT);
  await page.locator('[data-testid="search-center-modal"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-testid="search-query"]').fill('foo');
  await page.locator('[data-testid="search-query"]').press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="search-cancel"]'),
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(400);

  // docked shows identical stats and rows while the modal is still open
  await expect(page.locator('[data-testid="find-tool-count"]')).toContainText(/matches in \d+ files/, { timeout: 10_000 });
  const dockedRows = await page.locator('[data-testid="find-tool-result"]').count();
  const modalRows = await page.locator('[data-testid="search-result"]').count();
  expect(dockedRows).toBe(modalRows);

  // close the modal — docked window keeps the session's results
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="search-center-modal"]')).toHaveCount(0);
  await expect(page.locator('#theia-bottom-content-panel [data-testid="find-tool-result"]').first())
    .toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="find-tool-count"]')).toContainText(/matches in \d+ files/);
});

test('TC-SRCH-052 [P2] 默认排除：node_modules / .git / WEB-INF/lib(*.class) 不入结果', async ({ page }) => {
  await openIdeAt(page, W2);
  await page.waitForTimeout(1500); // let keybindings finish attaching

  // zebraunique exists in: deepsignal.txt (root), node_modules/pkg/deep.js,
  // .git/hidden.txt; Fake*.class under WEB-INF/lib is binary-skipped.
  await page.keyboard.press(SEARCH_CENTER_SHORTCUT);
  await page.locator('[data-testid="search-center-modal"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-testid="search-query"]').fill('zebraunique');
  await page.locator('[data-testid="search-query"]').press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="search-cancel"]'),
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(300);

  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 matches');
  const files = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="search-group"] .kairo-search-result-filename'))
      .map(e => e.textContent?.trim()));
  expect(files).toEqual(['deepsignal.txt']); // default excludes held
});
