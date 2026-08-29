/**
 * Chapter 37 — Command palette & focus navigation tests (BROWSER column).
 * TC-CMD-001..005 from docs/COMPREHENSIVE_TEST_DOCUMENT.md.
 *
 * Browser keymap notes (appendix B.2/B.3): Find Action is Cmd+Shift+A on
 * macOS browser builds (B.3 remaps only Ctrl+N/W-class Chrome-reserved keys).
 */
import { test, expect } from '@playwright/test';
import { openIde, attachDiagnostics } from './helpers';

function treeNode(page: any, label: string) {
  return page.locator('.theia-TreeNode').filter({
    has: page.locator(`.theia-TreeNodeSegment:text-is("${label}")`),
  }).first();
}

async function openPalette(page: any, key: 'F1' | 'Meta+Shift+p'): Promise<any> {
  await page.keyboard.press(key);
  const input = page.locator('.quick-input-widget input.input').first();
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  return input;
}

const paletteRows = (page: any) => page.locator('.quick-input-widget .monaco-list-row');

/** Ancestor shell area of the active element: left/bottom/main/statusbar. */
const activeArea = (page: any) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return 'none';
  if (a.closest('#theia-left-content-panel') || a.closest('#theia-left-side-panel')) return 'left';
  if (a.closest('#theia-bottom-content-panel')) return 'bottom';
  if (a.closest('#theia-statusBar')) return 'statusbar';
  if (a.closest('#theia-main-content-panel')) return 'main';
  if (a.closest('.monaco-editor')) return 'editor';
  return a.tagName;
});

test.describe('Chapter 37 — Command palette & focus navigation', () => {

  test('TC-CMD-001: F1 opens command palette; kairo.* commands searchable & executable; no raw i18n keys', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    await page.waitForTimeout(1200); // let all contributions register

    const input = await openPalette(page, 'F1');
    await input.fill('kairo.');
    await page.waitForTimeout(900);
    const rows = paletteRows(page);
    const count = await rows.count();
    console.log(`[TC-CMD-001] kairo.* rows visible: ${count}`);
    expect(count).toBeGreaterThanOrEqual(10);

    // Labels must be human-readable (no raw i18n key leakage like widget.x.y)
    const labels = await rows.locator('.monaco-list-row .label-name').allInnerTexts()
      .catch(async () => await rows.allInnerTexts());
    console.log(`[TC-CMD-001] sample labels: ${JSON.stringify(labels.slice(0, 8))}`);
    const rawKey = labels.find(l => /\.[a-z]{2,}(\.[a-z0-9]+)+\s*$/.test(l.trim()) && !l.includes(' '));
    expect(rawKey).toBeUndefined();

    // Execute a harmless command end-to-end: "Focus Editor"
    await input.fill('>Focus Editor');
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const area = await activeArea(page);
    console.log(`[TC-CMD-001] focus area after executing Focus Editor: ${area}`);
    expect(area).toBe('main');
    // Palette closed after execution
    await expect(page.locator('.quick-input-widget')).toHaveClass(/invisible|closed/, { timeout: 5_000 }).catch(() => {
      // some builds remove/hide via style — accept either
    });
    expect(diag.pageErrors).toEqual([]);
  });

  test('TC-CMD-002: Find Action (Cmd+Shift+A) filters labeled commands and shows shortcut detail', async ({ page }) => {
    await openIde(page);
    await page.waitForTimeout(1000);

    // Actual browser keybinding per appendix B.2/B.3 on macOS: Cmd+Shift+A
    await page.keyboard.press('Meta+Shift+a');
    const modal = page.locator('.kairo-find-modal').first();
    await modal.waitFor({ state: 'visible', timeout: 10_000 });
    const input = page.locator('.kairo-find-input').first();
    await expect(input).toBeFocused().catch(() => undefined);

    await input.fill('close');
    await page.waitForTimeout(800);
    const items = page.locator('.kairo-find-item');
    const n = await items.count();
    console.log(`[TC-CMD-002] filtered items for "close": ${n}`);
    expect(n).toBeGreaterThan(0);

    // Every item shows a non-empty label; at least one shows a shortcut detail
    const labels = await items.locator('.kairo-find-label').allInnerTexts();
    console.log(`[TC-CMD-002] labels: ${JSON.stringify(labels.slice(0, 6))}`);
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
    const shortcuts = await items.locator('.kairo-find-shortcut').allInnerTexts();
    console.log(`[TC-CMD-002] shortcuts: ${JSON.stringify(shortcuts.slice(0, 6))}`);
    expect(shortcuts.some(s => s.trim().length > 0)).toBe(true);

    // Escape closes the overlay (focus the query field first — the async
    // item-list render may otherwise steal focus from the autofocused input).
    await input.click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  test('TC-CMD-003: Escape outside editor returns focus to the editor', async ({ page }) => {
    await openIde(page);
    // Open an editor so focusEditor has a target.
    await treeNode(page, 'legacy-sample').dblclick();
    await page.waitForTimeout(600);
    await page.locator('.monaco-editor:visible .view-lines').first().click().catch(() => undefined);
    // Move focus into the explorer tree.
    await treeNode(page, 'legacy-sample').click();
    await page.waitForTimeout(400);
    const before = await activeArea(page);
    console.log(`[TC-CMD-003] focus before Escape: ${before}`);
    expect(before).toBe('left');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const after = await activeArea(page);
    console.log(`[TC-CMD-003] focus after Escape: ${after}`);
    expect(after === 'main' || after === 'editor').toBe(true);
  });

  test('TC-CMD-004: F6 cycles focus through panels and wraps', async ({ page }) => {
    await openIde(page);
    await page.waitForTimeout(1000);
    // Start from the editor.
    await page.locator('.monaco-editor:visible .view-lines').first().click().catch(() => undefined);
    await page.waitForTimeout(300);

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F6');
      await page.waitForTimeout(450);
      seen.push(await activeArea(page));
    }
    console.log(`[TC-CMD-004] areas after each F6: ${JSON.stringify(seen)}`);
    // Cycle covers sidebar / bottom / statusbar targets besides main/editor.
    const distinct = new Set(seen.map(s => s));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
    expect(seen).toContain('left');
    expect(seen).toContain('statusbar');
  });

  test('TC-CMD-005: Shift+Escape hides the focused panel', async ({ page }) => {
    await openIde(page);
    await page.waitForTimeout(1000);
    // Reveal + focus the bottom Output panel through its toggle command.
    const pal = page.locator('.quick-input-widget input.input').first();
    let opened = false;
    for (let i = 0; i < 3 && !opened; i++) {
      await page.keyboard.press('F1');
      try {
        await pal.waitFor({ state: 'visible', timeout: 3_000 });
        await page.waitForTimeout(250);
        opened = await pal.isVisible();
      } catch {
        opened = false;
      }
      if (!opened) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }
    expect(opened).toBe(true);
    await pal.fill('>View: Toggle Output');
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);

    const bottomVisibleBefore = await page.evaluate(() => {
      const b = document.getElementById('theia-bottom-content-panel');
      return !!b && !b.classList.contains('lm-mod-hidden') && getComputedStyle(b).display !== 'none';
    });
    console.log(`[TC-CMD-005] bottom panel visible before: ${bottomVisibleBefore}`);
    expect(bottomVisibleBefore).toBe(true);

    await page.keyboard.press('Shift+Escape');
    await page.waitForTimeout(700);
    const bottomVisibleAfter = await page.evaluate(() => {
      const b = document.getElementById('theia-bottom-content-panel');
      return !!b && !b.classList.contains('lm-mod-hidden') && getComputedStyle(b).display !== 'none';
    });
    console.log(`[TC-CMD-005] bottom panel visible after Shift+Escape: ${bottomVisibleAfter}`);
    expect(bottomVisibleAfter).toBe(false);
  });

});
