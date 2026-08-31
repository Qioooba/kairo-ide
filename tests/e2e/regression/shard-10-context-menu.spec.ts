/**
 * SHARD-10: Context Menu (Right-Click) Full Coverage
 *
 * Tests right-click context menus in:
 *   1. File Explorer (on files and folders)
 *   2. Editor area (code context)
 *   3. Terminal
 *
 * Each context menu interaction checks for console errors and screenshots.
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  openFileExplorer,
  runKairoImportWizard,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { regressionWorkspace } from './paths';

const TEST_WORKSPACE = regressionWorkspace('shard10');
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard10';

async function removeProjectFromCatalog(request: { delete: (url: string) => Promise<unknown> } | null) {
  if (!request) return;
  try {
    const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
    await request.delete(`${agentBase}/api/v1/projects/${PROJECT_ID}`);
  } catch {
    /* 404 is fine */
  }
}

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

test.describe('[SHARD-10] Context Menu Coverage', () => {
  test.beforeAll(async ({ request }) => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
    if (fs.existsSync(LEGACY_SAMPLE)) {
      copyDirSync(LEGACY_SAMPLE, TEST_WORKSPACE);
    }
    await removeProjectFromCatalog(request as any);
  });

  test.beforeEach(async ({ page, baseURL, request }) => {
    await removeProjectFromCatalog(request as any);
    await navigateToTheia(page, baseURL || 'http://127.0.0.1:3002');
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
  });

  test('TEST-1001: Right-click in file explorer shows context menu', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await runKairoImportWizard(page, TEST_WORKSPACE, { timeoutMs: 60000 });
    await page.waitForTimeout(2000);
    await openFileExplorer(page);

    const treeNode = page.locator('.theia-TreeNode').first();
    if (await treeNode.count() > 0) {
      await treeNode.click({ button: 'right', timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/explorer-context-menu.png` });

      const contextMenu = page.locator('.p-Menu, .context-menu, [role="menu"]').first();
      expect(await contextMenu.count()).toBeGreaterThan(0);

      const menuItems = page.locator('.p-Menu-item, [role="menuitem"]');
      const itemCount = await menuItems.count();
      expect(itemCount).toBeGreaterThan(0);

      for (let i = 0; i < Math.min(itemCount, 5); i++) {
        const item = menuItems.nth(i);
        if (await item.isVisible().catch(() => false)) {
          await item.hover();
          await page.waitForTimeout(100);
        }
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: `${screenshotDir}/after-context-menu.png` });
    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1002: Right-click on .java file in explorer', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await runKairoImportWizard(page, TEST_WORKSPACE, { timeoutMs: 60000 });
    await page.waitForTimeout(2000);
    await openFileExplorer(page);

    const javaFile = page.locator('.theia-TreeNode').filter({ hasText: /\.java$/i }).first();
    if (await javaFile.count() > 0) {
      await javaFile.click({ button: 'right', timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/java-file-context-menu.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1003: Right-click in editor area', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await runKairoImportWizard(page, TEST_WORKSPACE, { timeoutMs: 60000 });
    await page.waitForTimeout(2000);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.keyboard.type('index.jsp', { delay: 50 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    const editor = page.locator('.monaco-editor').first();
    if (await editor.count() > 0) {
      const box = await editor.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${screenshotDir}/editor-context-menu.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1004: Right-click in terminal area', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+`' : 'Control+`');
    await page.waitForTimeout(2000);

    const terminal = page.locator('.xterm, .terminal').first();
    if (await terminal.count() > 0) {
      const box = await terminal.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + 20, { button: 'right' });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${screenshotDir}/terminal-context-menu.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });

  test('TEST-1005: Right-click on empty explorer area', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await openFileExplorer(page).catch(() => {});

    const explorerPanel = page.locator('#theia-left-content-panel').first();
    if (await explorerPanel.count() > 0) {
      const box = await explorerPanel.boundingBox();
      if (box) {
        await page.mouse.click(box.x + 50, box.y + box.height - 20, { button: 'right' });
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${screenshotDir}/explorer-empty-context-menu.png` });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    expect(consoleErrors.filter(e => !isIgnored(e))).toEqual([]);
  });
});

function isIgnored(msg: string): boolean {
  return /favicon|non-serializable|componentWillReceiveProps|componentWillMount|WebSocket connection|ERR_CONNECTION_REFUSED|monaco.*deprecated|JDT LS requires|KAIRO_JRE17|Failed to prepare JDT|jdtls|Failed to load resource/i.test(msg);
}
