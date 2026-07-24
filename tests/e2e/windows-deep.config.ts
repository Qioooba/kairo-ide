/**
 * Playwright config for Kairo IDE Windows Desktop Deep Test
 *
 * Runs in HEADED mode so you can watch the browser window and see
 * all the simulated clicks, keyboard shortcuts, and UI interactions.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'windows-desktop-deep-test.spec.ts',

  timeout: 180_000,
  globalTimeout: 300_000,

  retries: 0,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: '../../artifacts/windows-deep-test-report', open: 'never' }],
    ['json', { outputFile: '../../artifacts/windows-deep-test-results.json' }],
  ],

  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: {
      headless: false,
      args: [
        '--start-maximized',
        '--disable-features=Translate',
        '--no-default-browser-check',
        '--disable-infobars',
      ],
      slowMo: 50,
    },
  },

  projects: [
    {
      name: 'windows-chromium-headed',
      use: {
        browserName: 'chromium',
      },
    },
  ],

  outputDir: '../../artifacts/windows-deep-test-artifacts',
});
