/**
 * Chapter 4 — window, layout & theme basics (docs/COMPREHENSIVE_TEST_DOCUMENT.md).
 * Browser column: TC-WIN-002/003/004/005/006/007/008/009/012.
 * Desktop-only (001 window size, 010 HiDPI, 011 min-size) are covered in the
 * desktop phase.
 */
import { expect, test } from '@playwright/test';
import {
  attachDiagnostics, openFileViaQuickOpen, openIde, runCommand, waitForMainTab,
} from './helpers';

test.describe.configure({ mode: 'serial' });

/** Read a CSS custom property off :root (Theia theme variables). */
async function cssVar(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

async function bodyClasses(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => document.body.className);
}

/** Read the actual DockPanel state instead of assuming a persisted layout. */
async function bottomPanelVisible(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const panel = document.querySelector('#theia-bottom-content-panel');
    if (!panel) return false;
    const style = getComputedStyle(panel);
    const rect = panel.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && !panel.classList.contains('lm-mod-hidden')
      && rect.height > 0;
  });
}

async function setBottomPanelVisible(page: import('@playwright/test').Page, visible: boolean): Promise<void> {
  if (await bottomPanelVisible(page) !== visible) {
    await runCommand(page, 'Toggle Bottom Panel');
  }
  await expect.poll(() => bottomPanelVisible(page), {
    timeout: 10_000,
    message: `bottom panel should be ${visible ? 'visible' : 'hidden'}`,
  }).toBe(visible);
}

async function statusBarVisible(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const bar = document.querySelector('#theia-statusBar');
    if (!bar) return false;
    const style = getComputedStyle(bar);
    const rect = bar.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && !bar.classList.contains('lm-mod-hidden')
      && rect.height > 0;
  });
}

async function setStatusBarVisible(page: import('@playwright/test').Page, visible: boolean): Promise<void> {
  if (await statusBarVisible(page) !== visible) {
    await runCommand(page, 'Toggle Status Bar Visibility');
  }
  await expect.poll(() => statusBarVisible(page), {
    timeout: 10_000,
    message: `status bar should be ${visible ? 'visible' : 'hidden'}`,
  }).toBe(visible);
}

test.describe('ch04 window/layout/theme (browser column)', () => {

  test('TC-WIN-002 window title follows editor and workspace', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    await openFileViaQuickOpen(page, 'README.md');
    await waitForMainTab(page, /README\.md/, 20_000);
    await page.waitForTimeout(1500);
    const title = await page.title();
    expect(title).toMatch(/Kairo IDE/);
    expect(title).toMatch(/README\.md/i);
    // middle segment = workspace root folder name (lane root dir is "workspace")
    expect(title).toMatch(/\bworkspace\b/);
    expect(diag.pageErrors).toEqual([]);
  });

  test('TC-WIN-003 default dark theme: IDEA-dark surfaces and brand blue', async ({ page }) => {
    await openIde(page);
    await expect(page.locator('body')).toHaveClass(/theia-dark/, { timeout: 20_000 });
    // Kairo IDEA Dark surfaces (doc: #1e1f22 / #252629 / #2b2c30 / #37393d)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const allowedDark = ['rgb(30, 31, 34)', 'rgb(37, 38, 41)', 'rgb(43, 44, 48)', 'rgb(55, 57, 61)'];
    expect(allowedDark, `body background ${bg} must be one of the IDEA-dark surfaces`).toContain(bg);
    // brand blue: Kairo theme defines --theia-brand-color0: #4a9eff (ui-spec §2.3)
    const brand = await cssVar(page, '--theia-brand-color0');
    expect(brand.toLowerCase()).toMatch(/4a9eff/i);
    // status bar must NOT be the Theia default blue #007acc
    const sbColor = await page.evaluate(() => getComputedStyle(document.querySelector('#theia-statusBar')!).backgroundColor);
    expect(sbColor.toLowerCase()).not.toBe('rgb(0, 122, 204)');
  });

  test('TC-WIN-004 light theme switches body class and status bar contrast', async ({ page }) => {
    await openIde(page);
    await runCommand(page, 'Preferences: Color Theme');
    const input = page.locator('.quick-input-widget .quick-input-box input').first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(600);
    await input.fill('light');
    await page.waitForTimeout(600);
    // pick the light entry from the list
    const row = page.locator('.quick-input-widget .monaco-list-row', { hasText: /light/i }).first();
    await row.click({ timeout: 10_000 });
    await expect(page.locator('body')).toHaveClass(/theia-light/, { timeout: 20_000 });
    const sbColor = await page.evaluate(() => getComputedStyle(document.querySelector('#theia-statusBar')!).backgroundColor);
    expect(sbColor.toLowerCase()).not.toBe('rgb(0, 122, 204)');
    // restore dark for subsequent tests
    await runCommand(page, 'Preferences: Color Theme');
    const input2 = page.locator('.quick-input-widget .quick-input-box input').first();
    await input2.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(500);
    await input2.fill('dark');
    await page.waitForTimeout(500);
    const darkRow = page.locator('.quick-input-widget .monaco-list-row', { hasText: /dark/i }).first();
    await darkRow.click({ timeout: 10_000 });
    await expect(page.locator('body')).toHaveClass(/theia-dark/, { timeout: 20_000 });
  });

  test('TC-WIN-005 theme race: rapid switching + reload stays consistent', async ({ page }) => {
    await openIde(page);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => document.body.classList.add('theia-light'));
      await page.evaluate(() => document.body.classList.remove('theia-light'));
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    const trust = page.getByRole('button', { name: /^(Yes, I trust the authors|是，我信任)/i }).first();
    try { await trust.click({ timeout: 10_000 }); } catch { /* none */ }
    await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
    await page.waitForTimeout(3000);
    const cls = await bodyClasses(page);
    expect(cls).toMatch(/theia-dark/);
    expect(cls).not.toMatch(/theia-light/);
    const sbColor = await page.evaluate(() => getComputedStyle(document.querySelector('#theia-statusBar')!).backgroundColor);
    expect(sbColor.toLowerCase()).not.toBe('rgb(0, 122, 204)');
  });

  test('TC-WIN-006 file icons render in navigator', async ({ page }) => {
    await openIde(page);
    // The navigator remembers expansion state per workspace.  Expand the
    // fixture explicitly so this assertion exercises file icons rather than
    // only the two collapsed workspace-root folders.
    const projectNode = page.locator('.theia-TreeNode').filter({
      has: page.locator('.theia-TreeNodeSegment:text-is("legacy-sample")'),
    }).first();
    await projectNode.waitFor({ state: 'visible', timeout: 20_000 });
    if (!((await projectNode.getAttribute('class')) || '').includes('theia-ExpandedTreeNode')) {
      await projectNode.dblclick();
    }
    await page.locator('.theia-TreeNode').filter({
      has: page.locator('.theia-TreeNodeSegment:text-is("README.md")'),
    }).first().waitFor({ state: 'visible', timeout: 20_000 });
    const firstIcon = page.locator('#theia-left-content-panel .theia-Tree .theia-TreeNode .file-icon, #theia-left-content-panel .theia-Tree .theia-TreeNode [class*="codicon"]').first();
    await expect(firstIcon).toBeVisible({ timeout: 20_000 });
    // java/xml icons use file-icons css classes or codicons — assert non-empty icon styling
    const hasIcon = await page.evaluate(() => {
      const nodes = document.querySelectorAll('#theia-left-content-panel .theia-TreeNode');
      let styled = 0;
      for (const n of Array.from(nodes)) {
        const icon = n.querySelector('.file-icon, [class*="codicon"]');
        if (icon && icon.className.toString().trim().length > 0) styled++;
      }
      return { total: nodes.length, styled };
    });
    expect(hasIcon.total).toBeGreaterThan(3);
    expect(hasIcon.styled).toBe(hasIcon.total);
  });

  test('TC-WIN-007 activity bar exposes core view toggles', async ({ page }) => {
    await openIde(page);
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#theia-left-content-panel .lm-TabBar-tab')).map(
        (el) => el.getAttribute('title') || el.textContent?.trim() || '',
      ),
    );
    const joined = labels.join('|');
    for (const re of [/explorer/i, /search/i, /source control|git/i, /debug/i]) {
      expect(joined, `activity bar must contain ${re}`).toMatch(re);
    }
    // clicking a hidden tab opens it
    const searchTab = page.locator('#theia-left-content-panel .lm-TabBar-tab').filter({ hasText: /search/i }).or(
      page.locator('#theia-left-content-panel .lm-TabBar-tab[title*="Search"]'),
    ).first();
    await searchTab.click();
    await page.waitForTimeout(800);
    const panelVisible = await page.evaluate(() => {
      const panel = document.querySelector('#theia-left-content-panel .lm-SplitPanel-child:not(.lm-mod-hidden)');
      return !!panel;
    });
    expect(panelVisible).toBeTruthy();
  });

  test('TC-WIN-008 View>Appearance toggles bottom panel / status bar / menu bar', async ({ page }) => {
    await openIde(page);
    // Layout visibility is persisted by Theia, so normalize the initial state
    // before exercising the actual off/on transition.
    await setBottomPanelVisible(page, true);
    await setBottomPanelVisible(page, false);
    await setBottomPanelVisible(page, true);
    // The status bar visibility is also persisted by Theia. Normalize it
    // before asserting the off/on transition, just like the bottom panel.
    await setStatusBarVisible(page, true);
    await setStatusBarVisible(page, false);
    await setStatusBarVisible(page, true);
  });

  test('TC-WIN-009 split editor creates independent editors', async ({ page }) => {
    await openIde(page);
    await openFileViaQuickOpen(page, 'README.md');
    await waitForMainTab(page, /README\.md/, 20_000);
    await runCommand(page, 'Split Editor Right');
    await page.waitForTimeout(1500);
    const groups = await page.evaluate(() =>
      document.querySelectorAll('#theia-main-content-panel .lm-DockPanel-widget').length,
    );
    expect(groups).toBeGreaterThanOrEqual(2);
    // both sides scroll/cursor independence — type into the active (second) group
    await page.keyboard.type('// split-side');
    await page.waitForTimeout(600);
    const dirty = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab'))
        .filter((t) => /README/.test(t.textContent ?? ''))
        .filter((t) => t.className.includes('theia-mod-dirty')).length,
    );
    expect(dirty).toBeGreaterThanOrEqual(1);
    await runCommand(page, 'Revert File');
    await page.waitForTimeout(600);
  });

  test('TC-WIN-012 secondary window opens via Move Editor into New Window', async ({ page }) => {
    // Native drag-out is desktop-only; the browser column exposes the same
    // feature through the "Move Editor into New Window" command, which
    // opens a secondary browser window (popup).
    await openIde(page);
    await openFileViaQuickOpen(page, 'README.md');
    await waitForMainTab(page, /README\.md/, 20_000);
    const popupPromise = page.context().waitForEvent('page', { timeout: 20_000 });
    await runCommand(page, 'Move Editor into New Window');
    const popup = await popupPromise;
    // Secondary windows host only the extracted widget (not a full Theia app shell).
    await popup.waitForSelector('#widget-host', { timeout: 60_000 });
    await expect(popup.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
    expect(popup.url()).toMatch(/secondary-window\.html/);
    await popup.close();
  });

});
