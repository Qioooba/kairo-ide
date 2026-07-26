/**
 * Playwright config for full regression testing on new ports.
 * Uses port 3002 for Theia IDE and 18081 for Runtime Agent.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './regression',
  testMatch: [
    'shard-01-shell.spec.ts',
    'shard-02-project.spec.ts',
    'shard-03-java.spec.ts',
    'shard-04-multilang.spec.ts',
    'shard-05-build.spec.ts',
    'shard-06-debug.spec.ts',
    'shard-07-search.spec.ts',
    'shard-08-ui.spec.ts',
  ],

  // Timeout for each test: 5 minutes (300s)
  timeout: 300_000,

  // Global timeout for the entire suite
  globalTimeout: 60 * 60_000, // 1 hour

  // Retry once on failure
  retries: 1,

  // Reporter
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/regression-report', open: 'never' }],
    ['json', { outputFile: 'test-results/regression-results.json' }],
  ],

  use: {
    // Base URL of the Theia Browser IDE (new port)
    baseURL: 'http://127.0.0.1:3002',

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

  // Projects: only Chromium
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          headless: true,
          args: ['--headless=new'],
        },
      },
    },
  ],

  // Output directory for test artifacts
  outputDir: 'test-results/regression-artifacts',
});
