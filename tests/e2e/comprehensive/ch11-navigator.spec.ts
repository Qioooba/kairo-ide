/**
 * Chapter 11 — File Explorer (Navigator) tests (BROWSER column).
 * TC-NAV-001..007 from docs/COMPREHENSIVE_TEST_DOCUMENT.md.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openIde, attachDiagnostics, laneWorkspace } from './helpers';

const WS_ROOT = laneWorkspace('C');
const PROJ = path.join(WS_ROOT, 'legacy-sample');

/** Locate an explorer tree node by its visible label segment. */
function treeNode(page: any, label: string) {
  return page.locator('.theia-TreeNode').filter({
    has: page.locator(`.theia-TreeNodeSegment:text-is("${label}")`),
  }).first();
}

async function expandNode(page: any, label: string): Promise<void> {
  const node = treeNode(page, label);
  await node.waitFor({ state: 'visible', timeout: 15_000 });
  const cls = (await node.getAttribute('class')) || '';
  if (cls.includes('theia-ExpandedTreeNode')) return;
  await node.dblclick();
  await node.and(page.locator('.theia-ExpandedTreeNode')).waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Run a context-menu item on a tree node. */
async function contextMenuAction(page: any, label: string, menuItem: string): Promise<void> {
  await treeNode(page, label).click({ button: 'right' });
  const menu = page.locator('[role="menu"]').first();
  await menu.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.lm-Menu-item', { hasText: menuItem }).first().click();
  await page.waitForTimeout(400);
}

/** Theia single-text-input dialog (New File/Folder, Rename). */
function dialogInput(page: any) {
  return page.locator('#theia-dialog-shell input.theia-input').first();
}

test.describe('Chapter 11 — Navigator', () => {

  test('TC-NAV-001: workspace tree fully renders legacy-sample structure', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    await expandNode(page, 'legacy-sample');
    // Key directories and files must be present
    // `dist` is a generated build artifact and is intentionally excluded from
    // the checked-in legacy fixture (`legacy-sample/.gitignore`).  The
    // Explorer must render the source/configuration tree that is actually
    // present in a clean workspace; generated output is covered by the build
    // and deployment suites instead of making this navigation test depend on
    // a previous build having polluted the fixture.
    for (const label of ['src', 'WebRoot', 'lib', 'build', '.kairo', '.settings',
      'build.xml', 'README.md', 'package.json', 'index.html']) {
      await expect(treeNode(page, label)).toBeVisible({ timeout: 10_000 });
    }
    // Deep structure: src/main/java/com/example/legacy/HelloServlet.java
    await expandNode(page, 'src');
    await expect(treeNode(page, 'main')).toBeVisible();
    await expandNode(page, 'WebRoot');
    await expect(treeNode(page, 'hello.jsp')).toBeVisible();
    await expect(treeNode(page, 'WEB-INF')).toBeVisible();
    expect(diag.pageErrors).toEqual([]);
  });

  test('TC-NAV-002: new file / folder via context menu + invalid-name validation', async ({ page }) => {
    const file = path.join(PROJ, 'src', 'nav002-created.txt');
    const dir = path.join(PROJ, 'src', 'nav002-dir');
    try { fs.rmSync(file, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }

    await openIde(page);
    await expandNode(page, 'legacy-sample');
    await expandNode(page, 'src');

    // -- New File... --
    await contextMenuAction(page, 'src', 'New File');
    const input = dialogInput(page);
    await input.waitFor({ state: 'visible', timeout: 10_000 });

    // Invalid name check first (must NOT create)
    await input.fill('bad/name.txt');
    await page.waitForTimeout(600);
    const acceptBtn = page.locator('#theia-dialog-shell button.main').first();
    const errVisible = await page.locator('#theia-dialog-shell .error').first()
      .isVisible().catch(() => false);
    const acceptDisabled = await acceptBtn.isDisabled().catch(() => false);
    console.log(`[TC-NAV-002] invalid-name error shown=${errVisible} accept disabled=${acceptDisabled}`);
    if (!errVisible && !acceptDisabled) {
      throw new Error('Invalid file name was accepted by New File dialog (no validation)');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect(fs.existsSync(path.join(PROJ, 'src', 'bad')), 'invalid name must not be created').toBe(false);

    // Valid creation
    await contextMenuAction(page, 'src', 'New File');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill('nav002-created.txt');
    await page.keyboard.press('Enter');
    await expect(treeNode(page, 'nav002-created.txt')).toBeVisible({ timeout: 10_000 });
    expect(fs.existsSync(file), 'file exists on disk').toBe(true);

    // -- New Folder... --
    await contextMenuAction(page, 'src', 'New Folder');
    await input.waitFor({ state: 'visible', timeout: 10_000 });    await input.fill('nav002-dir');
    await page.keyboard.press('Enter');
    await expect(treeNode(page, 'nav002-dir')).toBeVisible({ timeout: 10_000 });
    expect(fs.statSync(dir).isDirectory(), 'folder exists on disk').toBe(true);
  });

  test('TC-NAV-003: rename + delete with confirmation dialog (default)', async ({ page }) => {
    const orig = path.join(PROJ, 'nav003-rename-me.txt');
    const renamed = path.join(PROJ, 'nav003-renamed.txt');
    fs.rmSync(renamed, { force: true });
    fs.writeFileSync(orig, 'rename/delete probe\n');

    await openIde(page);
    await expandNode(page, 'legacy-sample');
    await expect(treeNode(page, 'nav003-rename-me.txt')).toBeVisible({ timeout: 10_000 });

    // Rename
    await contextMenuAction(page, 'nav003-rename-me.txt', 'Rename');
    const input = dialogInput(page);
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill('nav003-renamed.txt');
    await page.keyboard.press('Enter');
    await expect(treeNode(page, 'nav003-renamed.txt')).toBeVisible({ timeout: 10_000 });
    expect(fs.existsSync(renamed), 'renamed on disk').toBe(true);
    expect(fs.existsSync(orig), 'old name gone').toBe(false);

    // Delete → confirmation expected by default (confirmBeforeDelete=true)
    await contextMenuAction(page, 'nav003-renamed.txt', 'Delete');
    const dialog = page.locator('#theia-dialog-shell').filter({ hasText: /delete|删除/i }).first();
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    // ConfirmDialog renders Cancel/OK ("Move File to Trash" title)
    await page.locator('#theia-dialog-shell button.main', { hasText: /^OK$/ }).first().click();
    await expect(treeNode(page, 'nav003-renamed.txt')).toHaveCount(0, { timeout: 10_000 });
    expect(fs.existsSync(renamed), 'deleted from disk').toBe(false);
  });

  test('TC-NAV-004: autoRevealInExplorer reveals opened file in tree', async ({ page }) => {
    await openIde(page);
    // Collapse everything so hello.jsp is not rendered initially.
    await expandNode(page, 'legacy-sample');
    await expandNode(page, 'WebRoot'); // ensure it exists expanded first
    await treeNode(page, 'legacy-sample').dblclick(); // collapse root again
    await page.waitForTimeout(800);

    // Open a deep file through quick file search instead of the explorer.
    // The browser runner executes on the host OS.  Sending the macOS Meta
    // chord on Windows is a no-op (the old test then reported a misleading
    // auto-reveal failure), so exercise the platform's real keybinding.
    const findFileShortcut = process.platform === 'darwin' ? 'Meta+Shift+O' : 'Control+Shift+N';
    await page.keyboard.press(findFileShortcut);
    const quickInput = page.locator('.kairo-find-input').first();
    try {
      await quickInput.waitFor({ state: 'visible', timeout: 6_000 });
    } catch {
      // Fallback: run the command from the palette (F1 opens with '>' prefix already)
      await page.keyboard.press('F1');
      const pal = page.locator('.quick-input-widget input.input').first();
      await pal.waitFor({ state: 'visible', timeout: 10_000 });
      await pal.fill('Kairo Find File');
      await page.waitForTimeout(800);
      await page.keyboard.press('Enter');
      await quickInput.waitFor({ state: 'visible', timeout: 10_000 });
    }
    await quickInput.fill('utf8.jsp');
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    // Editor tab opens…
    await expect(page.locator('.lm-TabBar-tabLabel', { hasText: 'utf8.jsp' }).first())
      .toBeVisible({ timeout: 20_000 });
    // …and the explorer auto-expanded + selected the node.
    const node = treeNode(page, 'utf8.jsp');
    await expect(node).toBeVisible({ timeout: 10_000 });
    const cls = (await node.getAttribute('class')) || '';
    console.log(`[TC-NAV-004] revealed node class=${cls}`);
    expect(cls).toMatch(/theia-mod-selected|theia-mod-focus/);
  });

  test('TC-NAV-005: VCS decorations after git init/commit/modify', async ({ page }) => {
    // Prepare a fresh git repo INSIDE legacy-sample (workspace is not itself a repo).
    const readmePath = path.join(PROJ, 'README.md');
    const originalReadme = fs.readFileSync(readmePath);
    fs.rmSync(path.join(PROJ, '.git'), { recursive: true, force: true });
    execFileSync('git', ['init', '-q'], { cwd: PROJ, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@t.io'], { cwd: PROJ, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: PROJ, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: PROJ, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: PROJ, stdio: 'ignore' });
    fs.appendFileSync(readmePath, '// nav005 change\n');
    fs.writeFileSync(path.join(PROJ, 'nav005-untracked.txt'), 'untracked\n');

    try {
      await openIde(page);
      await expandNode(page, 'legacy-sample');
      await page.waitForTimeout(4500); // GitService detects repo (≤3s poll) + refresh

      // Modified tracked file → tail dot decoration with "Git: Modified" tooltip (yellow)
      const modNode = treeNode(page, 'README.md');
      await modNode.waitFor({ state: 'visible', timeout: 10_000 });
      const modTail = modNode.locator('.theia-TailDecoration, [title*="Git"], .codicon-circle-filled').first();
      await expect(modTail).toBeVisible({ timeout: 20_000 });
      const tooltip = await modTail.getAttribute('title');
      console.log(`[TC-NAV-005] modified decoration tooltip="${tooltip}"`);
      expect(String(tooltip)).toMatch(/Git:\s*Modified/i);

      // Untracked file → grayish dot with "Git: Untracked"
      const untrackedNode = treeNode(page, 'nav005-untracked.txt');
      const untrackedTail = untrackedNode.locator('.theia-TailDecoration, [title*="Git"], .codicon-circle-filled').first();
      await expect(untrackedTail).toBeVisible({ timeout: 20_000 });
      const tip2 = await untrackedTail.getAttribute('title');
      console.log(`[TC-NAV-005] untracked decoration tooltip="${tip2}"`);
      expect(String(tip2)).toMatch(/Git:\s*Untracked/i);

      // Color sanity: modified uses warning/yellow-ish var
      const color = await modTail.evaluate((el: HTMLElement) => getComputedStyle(el).color);
      console.log(`[TC-NAV-005] modified decoration computed color=${color}`);
    } finally {
      fs.rmSync(path.join(PROJ, '.git'), { recursive: true, force: true });
      fs.rmSync(path.join(PROJ, 'nav005-untracked.txt'), { force: true });
      fs.writeFileSync(readmePath, originalReadme);
    }
  });

  test('TC-NAV-006: double-click GBK .jsp opens without mojibake (project encoding override)', async ({ page }) => {
    await openIde(page);
    await expandNode(page, 'legacy-sample');
    await expandNode(page, 'WebRoot');
    await treeNode(page, 'hello.jsp').dblclick();

    // Tab opens
    await expect(page.locator('.lm-TabBar-tabLabel', { hasText: 'hello.jsp' }).first())
      .toBeVisible({ timeout: 20_000 });
    await page.waitForSelector('.monaco-editor .view-lines', { timeout: 20_000 });
    const text = await page.locator('.monaco-editor .view-lines').innerText();
    console.log(`[TC-NAV-006] view-lines contains 欢迎使用=${text.includes('欢迎使用')} 当前时间=${text.includes('当前时间')} replacement-char=${text.includes('\uFFFD')}`);
    // GBK bytes bb b6 d3 ad ca b9 d3 c3 = 欢迎使用 ; b5 b1 c7 b0 ca b1 bc e4 a3 ba = 当前时间：
    expect(text).toContain('欢迎使用');
    expect(text).toContain('当前时间');
    expect(text).not.toContain('\uFFFD');
  });

  test('TC-NAV-007: external file creation appears via watcher without manual refresh', async ({ page }) => {
    await openIde(page);
    await expandNode(page, 'legacy-sample');
    const external = path.join(PROJ, 'nav007-external-file.txt');
    fs.rmSync(external, { force: true });
    try {
      await expect(treeNode(page, 'nav007-external-file.txt')).toHaveCount(0);
      fs.writeFileSync(external, `created outside IDE at ${new Date().toISOString()}\n`);
      // watcher should surface it automatically
      await expect(treeNode(page, 'nav007-external-file.txt')).toBeVisible({ timeout: 20_000 });
    } finally {
      fs.rmSync(external, { force: true });
    }
  });

});
