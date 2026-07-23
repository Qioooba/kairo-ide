import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'visual-regression.spec.ts',

  timeout: 120_000,

  retries: 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.THEIA_URL || 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
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
        },
      },
    },
  ],

  outputDir: 'test-results/artifacts',

  snapshotDir: 'screenshots',
});