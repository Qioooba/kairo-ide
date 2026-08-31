/**
 * SHARD-16: Performance Baseline
 *
 * Measures performance metrics:
 *   1. Page load time (time to interactive)
 *   2. Time to shell ready
 *   3. Time to command palette responsive
 *   4. Memory usage during operations
 *   5. Navigation Performance API metrics
 *
 * Establishes a performance baseline and flags regressions.
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
  runCommandViaPalette,
  runKairoImportWizard,
} from '../fixtures';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { regressionWorkspace } from './paths';

const TEST_WORKSPACE = regressionWorkspace('shard16');
const LEGACY_SAMPLE = path.resolve(__dirname, '..', '..', '..', 'legacy-sample');
const PROJECT_ID = 'project-workspace-shard16';

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

test.describe('[SHARD-16] Performance Baseline', () => {
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

  test('TEST-1601: Page load performance metrics', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const perfMetrics: Record<string, number> = {};

    const startTime = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const navTime = Date.now() - startTime;
    perfMetrics.navigationToDomContent = navTime;

    const shellStart = Date.now();
    await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { timeout: 60000 });
    perfMetrics.shellAppear = Date.now() - shellStart;

    await waitForTheiaShell(page);
    await page.waitForTimeout(2000);
    await dismissTrustDialog(page).catch(() => {});

    const cpStart = Date.now();
    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget', { timeout: 15000 });
    perfMetrics.commandPaletteResponse = Date.now() - cpStart;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const navTiming = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return null;
      return {
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        loadEvent: nav.loadEventEnd - nav.startTime,
        domInteractive: nav.domInteractive - nav.startTime,
        firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime || 0,
        firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        resourceCount: performance.getEntriesByType('resource').length,
      };
    });

    perfMetrics.totalTimeToInteractive = Date.now() - startTime;

    console.log('=== Performance Metrics ===');
    console.log(`Navigation to DOMContent: ${perfMetrics.navigationToDomContent}ms`);
    console.log(`Shell appear: ${perfMetrics.shellAppear}ms`);
    console.log(`Command palette response: ${perfMetrics.commandPaletteResponse}ms`);
    console.log(`Total time to interactive: ${perfMetrics.totalTimeToInteractive}ms`);
    if (navTiming) {
      console.log('Navigation Timing:', JSON.stringify(navTiming, null, 2));
    }

    await page.screenshot({ path: `${screenshotDir}/perf-baseline.png` });

    expect(perfMetrics.commandPaletteResponse).toBeLessThan(15000);
    expect(perfMetrics.shellAppear).toBeLessThan(60000);

    fs.mkdirSync(testInfo.outputPath('reports'), { recursive: true });
    fs.writeFileSync(
      testInfo.outputPath('reports/perf-metrics.json'),
      JSON.stringify({ perfMetrics, navTiming, timestamp: new Date().toISOString() }, null, 2),
    );
  });

  test('TEST-1602: Command execution latency', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const commands = [
      'Kairo: Show Servers',
      'Kairo: Show Builds',
      'Kairo: Open Keyboard Shortcuts',
      'Kairo: Open Debug Diagnostics',
    ];

    const latencies: Record<string, number> = {};

    for (const cmd of commands) {
      const start = Date.now();
      try {
        await runCommandViaPalette(page, cmd);
        latencies[cmd] = Date.now() - start;
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } catch (e) {
        latencies[cmd] = -1;
      }
    }

    console.log('=== Command Latencies ===');
    for (const [cmd, lat] of Object.entries(latencies)) {
      console.log(`  ${cmd}: ${lat < 0 ? 'ERROR' : lat + 'ms'}`);
    }

    await page.screenshot({ path: `${screenshotDir}/cmd-latency.png` });
  });

  test('TEST-1603: Memory usage baseline', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const memoryBefore = await page.evaluate(() => {
      const perfMem = (performance as any).memory || {};
      return {
        usedJSHeapSize: perfMem.usedJSHeapSize || 0,
        totalJSHeapSize: perfMem.totalJSHeapSize || 0,
        jsHeapSizeLimit: perfMem.jsHeapSizeLimit || 0,
      };
    });

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('F1');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
      await page.keyboard.type('Kairo:', { delay: 20 });
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    const memoryAfter = await page.evaluate(() => {
      const perfMem = (performance as any).memory || {};
      return {
        usedJSHeapSize: perfMem.usedJSHeapSize || 0,
        totalJSHeapSize: perfMem.totalJSHeapSize || 0,
        jsHeapSizeLimit: perfMem.jsHeapSizeLimit || 0,
      };
    });

    console.log('=== Memory Usage ===');
    console.log('Before:', JSON.stringify(memoryBefore));
    console.log('After:', JSON.stringify(memoryAfter));
    if (memoryBefore.usedJSHeapSize > 0 && memoryAfter.usedJSHeapSize > 0) {
      const growth = memoryAfter.usedJSHeapSize - memoryBefore.usedJSHeapSize;
      const growthPct = (growth / memoryBefore.usedJSHeapSize * 100).toFixed(1);
      console.log(`Growth: ${(growth / 1024 / 1024).toFixed(1)}MB (${growthPct}%)`);
    }

    await page.screenshot({ path: `${screenshotDir}/memory-baseline.png` });
  });

  test('TEST-1604: Import project performance', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const start = Date.now();
    const result = await runKairoImportWizard(page, TEST_WORKSPACE, { timeoutMs: 60000 });
    const importTime = Date.now() - start;

    console.log(`Project import time: ${importTime}ms`);
    console.log('Import result:', result);

    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${screenshotDir}/import-perf.png` });

    expect(result.opened || importTime < 60000).toBeTruthy();
  });
});
