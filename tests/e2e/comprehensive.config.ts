/**
 * Playwright config for the comprehensive browser test campaign
 * driven by docs/COMPREHENSIVE_TEST_DOCUMENT.md.
 *
 * Each test lane (isolated agent+theia stack) is selected via env:
 *   THEIA_URL=http://127.0.0.1:18401 AGENT_PORT=18400 \
 *     npx playwright test --config tests/e2e/comprehensive.config.ts [spec...]
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'comprehensive',
  testMatch: '**/*.spec.ts',
  timeout: 300_000,
  globalTimeout: 150 * 60_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.PW_REPORT || 'test-results/comprehensive.json' }]],
  use: {
    baseURL: process.env.THEIA_URL || 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: { headless: true, args: ['--headless=new'] },
      },
    },
  ],
  outputDir: process.env.PW_OUTPUT_DIR || 'test-results/artifacts-comprehensive',
});
