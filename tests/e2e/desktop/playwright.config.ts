/**
 * Playwright E2E test configuration for Kairo IDE Desktop tests.
 *
 * These tests run against the Browser form of Kairo IDE but with
 * Desktop-specific expectations (menus, shortcuts, window management).
 *
 * Prerequisites:
 *   1. pnpm agent:run    (Runtime Agent on :18080)
 *   2. pnpm dev:browser   (Theia Browser on :3000)
 *
 * Run with:
 *   npx playwright test --config tests/e2e/desktop/playwright.config.ts
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'desktop-*.spec.ts',

  // Timeout for each test: 2 minutes
  timeout: 120_000,

  // Global timeout for the entire suite
  globalTimeout: 20 * 60_000,

  // Retry once on CI
  retries: process.env.CI ? 1 : 0,

  // Reporter
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/desktop-report', open: 'never' }],
    ['json', { outputFile: '../../test-results/desktop-results.json' }],
  ],

  use: {
    // Base URL of the Theia Browser IDE
    baseURL: process.env.THEIA_URL || 'http://127.0.0.1:3000',

    // Browser viewport (desktop-sized)
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

  // Projects: Chromium (desktop-like)
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        browserName: 'chromium',
        launchOptions: {
          // Use headed mode for desktop-like behavior
          headless: true,
          // Desktop-like args
          args: [
            '--disable-features=Translate',
            '--disable-sync',
            '--no-default-browser-check',
          ],
        },
      },
    },
  ],

  // Output directory for test artifacts
  outputDir: '../../test-results/desktop-artifacts',
});