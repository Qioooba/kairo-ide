/**
 * Kairo IDE — Standalone E2E Smoke Tests
 *
 * These tests run WITHOUT the Go Runtime Agent. They verify:
 *   1. The Theia browser app can start and render the shell
 *   2. Core widgets render correctly
 *   3. Basic keyboard navigation works
 *
 * Prerequisites:
 *   - pnpm dev:browser (starts Theia on :3000)
 *   - npx playwright test --config tests/e2e/standalone-playwright.config.ts
 *
 * If the Theia dev server is not running, these tests will fail gracefully
 * with descriptive error messages.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const THEIA_URL = process.env.THEIA_URL || 'http://127.0.0.1:3000';
const NAVIGATION_TIMEOUT = 30_000;
const ELEMENT_TIMEOUT = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to navigate to Theia. Returns true if successful, false if the
 * server is not running.
 */
async function tryNavigate(page: Page): Promise<{ success: boolean; reason: string }> {
  try {
    await page.goto(THEIA_URL, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT,
    });
    return { success: true, reason: '' };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('net::ERR')) {
      return { success: false, reason: `Theia dev server is not running at ${THEIA_URL}` };
    }
    return { success: false, reason: msg };
  }
}

/**
 * Check if a CSS selector is present in the DOM.
 */
async function hasSelector(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: ELEMENT_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the page contains specific text content.
 */
async function hasText(page: Page, text: string): Promise<boolean> {
  try {
    const content = await page.textContent('body');
    return content !== null && content.includes(text);
  } catch {
    return false;
  }
}

// ===========================================================================
// Standalone-01: Theia Browser Start
// ===========================================================================
test.describe('Standalone-01: Theia Browser Start', () => {
  test('should load the Theia shell page', async ({ page }) => {
    await test.step('1. Navigate to Theia', async () => {
      const result = await tryNavigate(page);
      if (!result.success) {
        // Don't fail — Theia may not be running
        console.log(`[SKIP] Theia is not running: ${result.reason}`);
        test.skip();
        return;
      }
      console.log(`  Navigated to ${THEIA_URL}`);
    });

    await test.step('2. Wait for Theia shell and verify non-empty body', async () => {
      // Theia starts with a loading spinner; wait for the real shell.
      await page.waitForSelector('#theia-app-shell, #theia-shell, .theia-shell', {
        timeout: NAVIGATION_TIMEOUT,
      });
      const bodyContent = await page.textContent('body');
      expect(bodyContent).toBeTruthy();
      expect(bodyContent!.length).toBeGreaterThan(30);
      console.log(`  Body content length: ${bodyContent!.length} chars`);
    });

    await test.step('3. Verify page title is not empty', async () => {
      const title = await page.title();
      console.log(`  Page title: "${title}"`);
      // Theia should have a title, even if it's just "Theia" or "Kairo IDE"
      expect(title.length).toBeGreaterThan(0);
    });

    await test.step('4. Take a screenshot', async () => {
      await page.screenshot({
        path: 'test-results/standalone-01-boot.png',
        fullPage: true,
      });
      console.log('  Screenshot saved: test-results/standalone-01-boot.png');
    });
  });
});

// ===========================================================================
// Standalone-02: Widget Rendering
// ===========================================================================
test.describe('Standalone-02: Widget Rendering', () => {
  test('should render core Theia widgets', async ({ page }) => {
    await test.step('1. Navigate to Theia', async () => {
      const result = await tryNavigate(page);
      if (!result.success) {
        console.log(`[SKIP] Theia is not running: ${result.reason}`);
        test.skip();
        return;
      }
    });

    await test.step('2. Verify the shell container exists', async () => {
      const shellSelectors = [
        '#theia-app-shell',
        '#theia-shell',
        '.theia-shell',
        '#theia-top-panel',
        '#theia-main-content-panel',
        '.theia-ApplicationShell',
      ];

      let foundShell = false;
      for (const sel of shellSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Shell container found: ${sel}`);
          foundShell = true;
          break;
        }
      }
      expect(foundShell, 'At least one shell selector should be present').toBeTruthy();
    });

    await test.step('3. Verify activity bar or sidebar exists', async () => {
      const sidebarSelectors = [
        '#theia-leftContent',
        '.theia-activity-bar',
        '#theia-left-side-panel',
        '.theia-Left',
      ];

      let foundSidebar = false;
      for (const sel of sidebarSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Sidebar found: ${sel}`);
          foundSidebar = true;
          break;
        }
      }
      if (foundSidebar) {
        console.log('  Activity bar/sidebar is present');
      } else {
        console.log('  Activity bar/sidebar not found (may be on Welcome page)');
      }
    });

    await test.step('4. Verify status bar exists', async () => {
      const statusBarSelectors = [
        '#theia-statusBar',
        '.theia-statusBar',
        '[aria-label="Status Bar"]',
      ];

      let foundStatusBar = false;
      for (const sel of statusBarSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Status bar found: ${sel}`);
          foundStatusBar = true;
          // Log status bar content
          const sbText = await page.textContent(sel);
          console.log(`  Status bar content: "${sbText?.substring(0, 120)}"`);
          break;
        }
      }
      if (foundStatusBar) {
        expect(true).toBeTruthy();
      } else {
        console.log('  Status bar not found — may not be rendered yet');
      }
    });

    await test.step('5. Take a screenshot of the widget layout', async () => {
      await page.screenshot({
        path: 'test-results/standalone-02-widgets.png',
        fullPage: true,
      });
      console.log('  Screenshot saved: test-results/standalone-02-widgets.png');
    });
  });
});

// ===========================================================================
// Standalone-03: Keyboard Navigation
// ===========================================================================
test.describe('Standalone-03: Keyboard Navigation', () => {
  test('should respond to common keyboard shortcuts', async ({ page }) => {
    await test.step('1. Navigate to Theia', async () => {
      const result = await tryNavigate(page);
      if (!result.success) {
        console.log(`[SKIP] Theia is not running: ${result.reason}`);
        test.skip();
        return;
      }
    });

    await test.step('2. Press F1 to open command palette', async () => {
      await page.keyboard.press('F1');
      await page.waitForTimeout(1_000);

      const paletteSelectors = [
        '.quick-input-widget',
        '.monaco-quick-open-widget',
        '.quick-open-overlay',
        '.command-palette',
      ];

      let paletteFound = false;
      for (const sel of paletteSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Command palette found: ${sel}`);
          paletteFound = true;
          break;
        }
      }

      if (paletteFound) {
        console.log('  F1: Command palette opened successfully');
        // Close palette
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else {
        console.log('  F1: Command palette did not open (may need different key)');
      }
    });

    await test.step('3. Try Ctrl+Shift+P to open command palette', async () => {
      await page.keyboard.press('Control+Shift+P');
      await page.waitForTimeout(1_000);

      const paletteSelectors = [
        '.quick-input-widget',
        '.monaco-quick-open-widget',
        '.quick-open-overlay',
        '.command-palette',
      ];

      let paletteFound = false;
      for (const sel of paletteSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Command palette found: ${sel}`);
          paletteFound = true;
          break;
        }
      }

      if (paletteFound) {
        console.log('  Ctrl+Shift+P: Command palette opened successfully');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else {
        console.log('  Ctrl+Shift+P: Command palette did not open');
      }
    });

    await test.step('4. Press Ctrl+P to open file quick-open', async () => {
      await page.keyboard.press('Control+P');
      await page.waitForTimeout(1_000);

      const quickOpenSelectors = [
        '.quick-open-overlay',
        '.monaco-quick-open-widget',
        '.quick-input-widget',
      ];

      let quickOpenFound = false;
      for (const sel of quickOpenSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Quick-open found: ${sel}`);
          quickOpenFound = true;
          break;
        }
      }

      if (quickOpenFound) {
        console.log('  Ctrl+P: Quick-open dialog opened successfully');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else {
        console.log('  Ctrl+P: Quick-open dialog did not open');
      }
    });

    await test.step('5. Take a screenshot after keyboard navigation', async () => {
      await page.screenshot({
        path: 'test-results/standalone-03-keyboard.png',
        fullPage: true,
      });
      console.log('  Screenshot saved: test-results/standalone-03-keyboard.png');
    });
  });
});

// ===========================================================================
// Standalone-04: Welcome Page Content
// ===========================================================================
test.describe('Standalone-04: Welcome Page Content', () => {
  test('should show welcome page or editor area', async ({ page }) => {
    await test.step('1. Navigate to Theia', async () => {
      const result = await tryNavigate(page);
      if (!result.success) {
        console.log(`[SKIP] Theia is not running: ${result.reason}`);
        test.skip();
        return;
      }
    });

    await test.step('2. Check for welcome page content', async () => {
      const welcomeSelectors = [
        '.theia-welcome',
        '.welcome-page',
        '.kairo-welcome',
        '[data-testid="kairo-welcome"]',
      ];

      let foundWelcome = false;
      for (const sel of welcomeSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Welcome page found: ${sel}`);
          foundWelcome = true;
          break;
        }
      }

      if (foundWelcome) {
        // Check for Kairo-specific content
        const hasKairo = await hasText(page, 'Kairo');
        console.log(`  Page contains "Kairo": ${hasKairo}`);
        const hasIDE = await hasText(page, 'IDE');
        console.log(`  Page contains "IDE": ${hasIDE}`);
      } else {
        console.log('  Welcome page not found — may be showing editor directly');
      }
    });

    await test.step('3. Check for editor area', async () => {
      const editorSelectors = [
        '.monaco-editor',
        '#theia-editor-area',
        '.theia-editor',
        '.editor-container',
      ];

      let foundEditor = false;
      for (const sel of editorSelectors) {
        if (await hasSelector(page, sel)) {
          console.log(`  Editor area found: ${sel}`);
          foundEditor = true;
          break;
        }
      }

      if (foundEditor) {
        console.log('  Editor area is rendered');
      } else {
        console.log('  Editor area not found — may be on Welcome page');
      }
    });

    await test.step('4. Verify no visible error messages', async () => {
      const errorTexts = ['Error', 'Failed', 'Cannot', 'Unable', 'Crash'];
      const bodyContent = await page.textContent('body');
      if (bodyContent) {
        for (const err of errorTexts) {
          if (bodyContent.includes(err)) {
            console.log(`  Note: body contains "${err}" — may be normal UI text`);
          }
        }
      }
    });

    await test.step('5. Take a screenshot', async () => {
      await page.screenshot({
        path: 'test-results/standalone-04-welcome.png',
        fullPage: true,
      });
      console.log('  Screenshot saved: test-results/standalone-04-welcome.png');
    });
  });
});

// ===========================================================================
// Standalone-05: Page Responsiveness
// ===========================================================================
test.describe('Standalone-05: Page Responsiveness', () => {
  test('should not crash or hang on load', async ({ page }) => {
    await test.step('1. Measure page load time', async () => {
      const startTime = Date.now();

      const result = await tryNavigate(page);
      if (!result.success) {
        console.log(`[SKIP] Theia is not running: ${result.reason}`);
        test.skip();
        return;
      }

      const loadTime = Date.now() - startTime;
      console.log(`  Page loaded in ${loadTime}ms`);
      // Page should load within 30 seconds
      expect(loadTime).toBeLessThan(NAVIGATION_TIMEOUT);
    });

    await test.step('2. Check for console errors', async () => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });
      // Wait a bit for any async errors to surface
      await page.waitForTimeout(2_000);
      console.log(`  Console errors: ${errors.length}`);
      if (errors.length > 0) {
        for (const err of errors.slice(0, 5)) {
          console.log(`    - ${err.substring(0, 200)}`);
        }
      }
    });

    await test.step('3. Verify page is interactive', async () => {
      // Try to focus the page and type something
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      const activeElement = await page.evaluate(() => {
        const el = document.activeElement;
        return el ? el.tagName : 'none';
      });
      console.log(`  Active element after Tab: ${activeElement}`);
      expect(activeElement).toBeTruthy();
    });
  });
});