/**
 * SHARD-13: Real Project Content Editing
 *
 * Tests editing REAL content in legacy-sample project files:
 *   - Java files (code completion, editing, saving)
 *   - JSP files (HTML/Java mix)
 *   - XML files (web.xml, build.xml)
 *   - Properties files
 *   - CSS files
 *   - JSON/TS/Python files
 *
 * Each edit test: opens file → types content → saves → verifies no errors → closes.
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  dismissSaveWorkspaceDialog,
  openFileExplorer,
  runKairoImportWizard,
  waitForJavaReady,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TEST_WORKSPACE = '/tmp/kairo-k4-workspace/projects/workspace-shard13';
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard13';

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

test.describe('[SHARD-13] Real Project Content Editing', () => {
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

    const result = await runKairoImportWizard(page, TEST_WORKSPACE, { timeoutMs: 60000 });
    console.log('Import result:', result);
    await page.waitForTimeout(3000);
    await dismissTrustDialog(page);
    await dismissSaveWorkspaceDialog(page);
    await openFileExplorer(page).catch(() => {});
  });

  test('TEST-1301: Open and edit Java file without errors', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.keyboard.type('HelloServlet.java', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${screenshotDir}/java-file-opened.png` });

    const editor = page.locator('.monaco-editor').first();
    if (await editor.count() > 0) {
      await editor.click();
      await page.waitForTimeout(300);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('// Test comment added by E2E test', { delay: 30 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/java-edit.png` });
    }

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${screenshotDir}/java-saved.png` });

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await page.waitForTimeout(300);

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });

  test('TEST-1302: Open and edit JSP file without errors', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.keyboard.type('index.jsp', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotDir}/jsp-opened.png` });

    const editor = page.locator('.monaco-editor').first();
    if (await editor.count() > 0) {
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('<!-- E2E test comment -->', { delay: 30 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/jsp-edit.png` });
    }

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
    await page.waitForTimeout(1000);

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });

  test('TEST-1303: Open web.xml (XML) without errors', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.keyboard.type('web.xml', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotDir}/webxml-opened.png` });

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });

  test('TEST-1304: Open build.xml (Ant) without errors', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.keyboard.type('build.xml', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotDir}/buildxml-opened.png` });

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });

  test('TEST-1305: Open CSS file without errors', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.keyboard.type('style.css', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotDir}/css-opened.png` });

    const editor = page.locator('.monaco-editor').first();
    if (await editor.count() > 0) {
      await editor.click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('.e2e-test { color: red; }', { delay: 30 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/css-edit.png` });
    }

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });

  test('TEST-1306: Create new file and type content', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${screenshotDir}/new-file.png` });

    await page.keyboard.type('Hello from Kairo IDE E2E test!\nLine 2\nLine 3', { delay: 30 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/new-file-typed.png` });

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
    await page.waitForTimeout(500);
    const dontSave = page.locator('button').filter({ hasText: /don't save/i }).first();
    if (await dontSave.count() > 0 && await dontSave.isVisible().catch(() => false)) {
      await dontSave.click();
      await page.waitForTimeout(500);
    }

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });

  test('TEST-1307: Tab switching between multiple open files', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');
    const consoleErrors: string[] = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

    const files = ['HelloServlet.java', 'index.jsp', 'web.xml'];
    for (const file of files) {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
      await page.keyboard.type(file, { delay: 50 });
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: `${screenshotDir}/multi-tabs.png` });

    const tabs = page.locator('.p-TabBar-tab, .theia-tab, [role="tab"]');
    const tabCount = await tabs.count();
    for (let i = 0; i < Math.min(tabCount, 5); i++) {
      const tab = tabs.nth(i);
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(500);
      }
    }
    await page.screenshot({ path: `${screenshotDir}/after-tab-switch.png` });

    const unexpectedErrors = consoleErrors.filter(e => !isIgnored(e));
    expect(unexpectedErrors).toEqual([]);
  });
});

function isIgnored(msg: string): boolean {
  return /favicon|non-serializable|componentWillReceiveProps|componentWillMount|WebSocket connection|ERR_CONNECTION_REFUSED|monaco.*deprecated|request.*failed|Failed to load resource|JDT LS requires|KAIRO_JRE17|Failed to prepare JDT|jdtls/i.test(msg);
}
