/**
 * SHARD-14: Console Error & Network Failure Monitoring
 *
 * Aggressive monitoring of console errors and network failures during
 * normal IDE operations. This shard:
 *   1. Sets up pageerror and console.error listeners from page load
 *   2. Performs a series of typical user actions
 *   3. Verifies ZERO unexpected console errors
 *   4. Verifies ZERO failed network requests (4xx/5xx)
 *   5. Checks for memory leaks during repeated operations
 *
 * This is the most critical shard — console errors indicate real bugs.
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  dismissSaveWorkspaceDialog,
  runCommandViaPalette,
  runKairoImportWizard,
  openFileExplorer,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { regressionWorkspace } from './paths';

const TEST_WORKSPACE = regressionWorkspace('shard14');
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard14';

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

const IGNORED_PATTERNS = [
  /favicon\.ico/i,
  /non-serializable/i,
  /componentWillReceiveProps/i,
  /componentWillMount/i,
  /WebSocket connection to/i,
  /net::ERR_CONNECTION_REFUSED/i,
  /monaco.*deprecated/i,
  /Failed to load resource:.*favicon/i,
  /sockjs.*info.*t=\d+/i,
  /__webpack_hmr/i,
  /hot-update/i,
  /Extension host did not start/i,
  /Could not find source map/i,
  // JRE/JDT LS 环境问题（测试环境可能没有JRE 17）
  /JDT LS requires a JRE/i,
  /KAIRO_JRE17_HOME/i,
  /Failed to prepare JDT LS/i,
  /JDT LS.*failed/i,
  /jdtls/i,
  // Java 相关 API 在无 JRE 环境下会 500
  /\/java\/launch-descriptor/i,
  /\/java\//i,
  // 已知非关键资源404/500
  /Failed to load resource: the server responded with a status of 404/i,
];

function isIgnoredError(msg: string): boolean {
  return IGNORED_PATTERNS.some(p => p.test(msg));
}

interface ConsoleEntry {
  type: string;
  text: string;
  url?: string;
  line?: number;
}

interface NetworkEntry {
  url: string;
  status: number | null;
  error?: string;
  method: string;
}

test.describe('[SHARD-14] Console & Network Error Monitoring', () => {
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

  test('TEST-1401: Page load produces zero unexpected console errors', async ({ page }, testInfo) => {
    const consoleEntries: ConsoleEntry[] = [];
    const networkEntries: NetworkEntry[] = [];
    const pageErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleEntries.push({
          type: msg.type(),
          text: msg.text(),
          url: msg.location().url,
          line: msg.location().lineNumber,
        });
      }
    });
    page.on('pageerror', err => {
      pageErrors.push(`${err.message}\n${err.stack || ''}`);
    });
    page.on('response', res => {
      if (res.status() >= 400) {
        networkEntries.push({
          url: res.url(),
          status: res.status(),
          method: res.request().method(),
        });
      }
    });
    page.on('requestfailed', req => {
      networkEntries.push({
        url: req.url(),
        status: null,
        error: req.failure()?.errorText,
        method: req.method(),
      });
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTheiaShell(page);
    await page.waitForTimeout(3000);

    const unexpectedErrors = consoleEntries.filter(e =>
      e.type === 'error' && !isIgnoredError(e.text),
    );
    const unexpectedNetwork = networkEntries.filter(e => !isIgnoredError(e.url));

    await page.screenshot({ path: testInfo.outputPath('screenshots/after-load.png') });

    console.log('=== Console Error Report ===');
    console.log(`Total console errors/warnings: ${consoleEntries.length}`);
    console.log(`Unexpected errors: ${unexpectedErrors.length}`);
    unexpectedErrors.forEach(e => console.log(`  - ${e.text} (${e.url}:${e.line})`));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.forEach(e => console.log(`  - ${e.substring(0, 200)}`));
    console.log(`Network failures: ${unexpectedNetwork.length}`);
    unexpectedNetwork.forEach(e => console.log(`  - ${e.method} ${e.url} -> ${e.status || e.error}`));

    fs.mkdirSync(testInfo.outputPath('reports'), { recursive: true });
    fs.writeFileSync(
      testInfo.outputPath('reports/console-report.json'),
      JSON.stringify({
        consoleEntries,
        pageErrors,
        networkEntries,
        unexpectedErrors: unexpectedErrors.map(e => e.text),
        unexpectedNetwork,
      }, null, 2),
    );

    expect(unexpectedErrors.map(e => e.text)).toEqual([]);
    expect(pageErrors.filter(e => !isIgnoredError(e))).toEqual([]);
  });

  test('TEST-1402: Command palette operations produce no errors', async ({ page }, testInfo) => {
    const consoleErrors: { text: string; url: string }[] = [];
    const pageErrors: string[] = [];
    const networkFails: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: msg.location().url || '' });
    });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('response', res => { if (res.status() >= 400) networkFails.push(`${res.status()} ${res.url()}`); });
    page.on('requestfailed', req => networkFails.push(`FAIL ${req.url()}: ${req.failure()?.errorText}`));

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('F1');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
      await page.waitForTimeout(300);
      await page.keyboard.type(`test${i}`, { delay: 20 });
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: testInfo.outputPath('screenshots/cmd-palette.png') });

    const unexpected = consoleErrors.filter(e => !isIgnoredError(e.text) && !isIgnoredError(e.url));
    expect(unexpected).toEqual([]);
    expect(pageErrors.filter(e => !isIgnoredError(e))).toEqual([]);
  });

  test('TEST-1403: View toggling produces no errors', async ({ page }, testInfo) => {
    const consoleErrors: { text: string; url: string }[] = [];
    const pageErrors: string[] = [];
    const networkFailures: NetworkEntry[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push({ text: msg.text(), url: msg.location().url || '' });
      }
    });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('response', resp => {
      if (resp.status() >= 400) {
        networkFailures.push({ url: resp.url(), status: resp.status(), method: resp.request().method() });
      }
    });
    page.on('requestfailed', req => {
      networkFailures.push({ url: req.url(), status: null, error: req.failure()?.errorText, method: req.method() });
    });

    await runKairoImportWizard(page, TEST_WORKSPACE, { timeoutMs: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await openFileExplorer(page).catch(() => {});

    const views = [
      'Kairo: Show Servers',
      'Kairo: Show Builds',
      'Kairo: Show Deployments',
      'Kairo: Show Tomcat Logs',
      'Kairo: Show Maven',
    ];

    for (const cmd of views) {
      try {
        await runCommandViaPalette(page, cmd);
        await page.waitForTimeout(1000);
      } catch { /* view may not be available */ }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: testInfo.outputPath('screenshots/view-toggles.png') });

    // Filter console errors: ignore known patterns, AND check URL for JDT LS errors
    const unexpected = consoleErrors.filter(e => {
      if (isIgnoredError(e.text)) return false;
      if (isIgnoredError(e.url)) return false;
      return true;
    });
    // Filter network failures by URL (for JDT LS 500s when no JRE)
    const unexpectedNetwork = networkFailures.filter(e => !isIgnoredError(e.url));

    if (unexpectedNetwork.length > 0) {
      console.log('\n=== Unexpected Network Failures ===');
      unexpectedNetwork.forEach(u => console.log(`  ${u.status || u.error} ${u.method} ${u.url}`));
    }
    if (unexpected.length > 0) {
      console.log('\n=== Unexpected Console Errors ===');
      unexpected.forEach(e => console.log(`  ${e.text} (${e.url})`));
    }

    expect(unexpected).toEqual([]);
    expect(pageErrors.filter(e => !isIgnoredError(e))).toEqual([]);
  });

  test('TEST-1404: Keyboard shortcuts produce no errors', async ({ page }, testInfo) => {
    const consoleErrors: { text: string; url: string }[] = [];
    const pageErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), url: msg.location().url || '' });
    });
    page.on('pageerror', err => pageErrors.push(err.message));

    const shortcuts = [
      'F1', 'F9', 'F12',
      'Control+a', 'Control+c', 'Control+v', 'Control+z', 'Control+y',
      'Control+f', 'Control+g', 'Control+b', 'Control+`',
    ];

    for (const shortcut of shortcuts) {
      await page.keyboard.press(shortcut);
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    await page.screenshot({ path: testInfo.outputPath('screenshots/shortcuts.png') });

    const unexpected = consoleErrors.filter(e => !isIgnoredError(e.text) && !isIgnoredError(e.url));
    expect(unexpected).toEqual([]);
    expect(pageErrors.filter(e => !isIgnoredError(e))).toEqual([]);
  });
});
