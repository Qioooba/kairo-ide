import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'desktop-electron.spec.ts',
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../../test-results/desktop-report', open: 'never' }],
    ['json', { outputFile: '../../../test-results/desktop-results.json' }],
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
  },
  outputDir: '../../../test-results/desktop-artifacts',
});
