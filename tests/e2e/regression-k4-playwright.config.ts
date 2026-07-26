/**
 * Kairo IDE Browser Full Regression Test Runner
 * Port-shifted configuration for this isolated session (k4):
 *   - Theia Browser (frontend):  3080
 *   - Runtime Agent  (backend):  18480
 *   - Tomcat         (HTTP):     8086
 *
 * Drives all 8 SHARDs of KAIRO_BROWSER_FULL_REGRESSION_TEST_PLAN.md via Playwright.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './regression',
  testMatch: [
    '**/shard-*.spec.ts',
  ],
  timeout: 300_000,
  globalTimeout: 60 * 60_000, // 1 hour ceiling for full regression
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/regression-report', open: 'never' }],
    ['json', { outputFile: 'test-results/regression-results.json' }],
  ],
  use: {
    // Base URL of the Theia Browser IDE (new isolated port)
    baseURL: process.env.THEIA_URL || 'http://127.0.0.1:3080',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          headless: true,
          args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
  outputDir: 'test-results/regression-artifacts',
});
