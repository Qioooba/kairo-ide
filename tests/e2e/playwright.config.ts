/**
 * Playwright E2E test configuration for Kairo IDE.
 *
 * Tests drive the real Theia Browser IDE through the browser.
 * They require a running Theia stack (Runtime Agent + Theia frontend).
 *
 * Prerequisites:
 *   1. pnpm agent:run    (Runtime Agent on :18080)
 *   2. pnpm dev:browser   (Theia Browser on :3000)
 *
 * Run with:
 *   npx playwright test --config tests/e2e/playwright.config.ts
 *   # or: pnpm test:e2e:playwright
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'core-e2e.spec.ts',

  // Timeout for each test: 5 minutes (300s)
  timeout: 300_000,

  // Global timeout for the entire suite
  globalTimeout: 30 * 60_000,

  // Retry once on CI
  retries: process.env.CI ? 1 : 0,

  // Reporter
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    // Base URL of the Theia Browser IDE
    baseURL: process.env.THEIA_URL || 'http://127.0.0.1:3000',

    // Agent API base URL
    // accessible via process.env in tests

    // Browser viewport
    viewport: { width: 1440, height: 900 },

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Trace on first retry
    trace: 'on-first-retry',

    // Video recording
    video: 'retain-on-failure',

    // Default timeout for actions
    actionTimeout: 30_000,

    // Default navigation timeout
    navigationTimeout: 60_000,
  },

  // Projects: only Chromium for now
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          headless: true,
        },
      },
    },
  ],

  // Output directory for test artifacts
  outputDir: 'test-results/artifacts',
});