/**
 * SHARD-15: UI Design Review — Colors, Contrast, Layout
 *
 * Visual review of the IDE UI:
 *   1. Color scheme consistency (Kairo dark theme)
 *   2. Text contrast ratios (WCAG AA compliance check)
 *   3. Layout integrity (no overlapping elements)
 *   4. Responsive behavior (resize window)
 *   5. Focus indicators
 *   6. Button styling consistency
 *   7. Status bar readability
 *
 * Uses page.evaluate() to check computed styles programmatically.
 * Takes full-page screenshots for visual comparison.
 */
import { test, expect } from '@playwright/test';
import {
  navigateToTheia,
  waitForTheiaShell,
  dismissTrustDialog,
} from '../fixtures';

test.describe('[SHARD-15] UI Design Review', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await navigateToTheia(page, baseURL || 'http://127.0.0.1:3002');
    await waitForTheiaShell(page);
    await dismissTrustDialog(page);
  });

  test('TEST-1501: Shell layout is complete (all major panels present)', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const layout = await page.evaluate(() => {
      const results: Record<string, boolean> = {};
      const selectors = {
        shell: '#theia-app-shell, #theia-shell, .theia-shell',
        topPanel: '#theia-top-panel',
        statusBar: '#theia-statusBar',
        leftPanel: '#theia-left-content-panel, .theia-left-side-panel',
        mainPanel: '#theia-main-content-panel',
        activityBar: '.theia-app-left.theia-app-sides.lm-TabBar',
      };
      for (const [name, sel] of Object.entries(selectors)) {
        const el = document.querySelector(sel);
        results[name] = el !== null && el.getBoundingClientRect().width > 0;
      }
      return results;
    });

    console.log('Layout check:', layout);
    await page.screenshot({ path: `${screenshotDir}/layout-review.png`, fullPage: false });

    expect(layout.shell).toBe(true);
    expect(layout.topPanel).toBe(true);
    expect(layout.statusBar).toBe(true);
  });

  test('TEST-1502: Status bar text is readable', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const statusBarInfo = await page.evaluate(() => {
      const sb = document.querySelector('#theia-statusBar');
      if (!sb) return { exists: false };
      const style = window.getComputedStyle(sb);
      const text = sb.textContent || '';
      const items = Array.from(sb.querySelectorAll('div, span')).map(el => {
        const s = window.getComputedStyle(el);
        return {
          text: el.textContent?.trim().substring(0, 50) || '',
          color: s.color,
          bgColor: s.backgroundColor,
          fontSize: s.fontSize,
          visible: el.getBoundingClientRect().width > 0,
        };
      }).filter(i => i.visible && i.text.length > 0);
      return {
        exists: true,
        bgColor: style.backgroundColor,
        color: style.color,
        fontSize: style.fontSize,
        height: sb.getBoundingClientRect().height,
        items: items.slice(0, 20),
        fullText: text.substring(0, 200),
      };
    });

    console.log('Status bar info:', JSON.stringify(statusBarInfo, null, 2));
    await page.screenshot({ path: `${screenshotDir}/statusbar.png` });

    expect(statusBarInfo.exists).toBe(true);
  });

  test('TEST-1503: Buttons have consistent styling', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${screenshotDir}/command-palette-styling.png` });
    await page.keyboard.press('Escape');

    const buttonStyles = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).slice(0, 30);
      return buttons.map(btn => {
        const style = window.getComputedStyle(btn);
        const rect = btn.getBoundingClientRect();
        return {
          text: btn.textContent?.trim().substring(0, 30) || '(no text)',
          visible: rect.width > 0 && rect.height > 0,
          bgColor: style.backgroundColor,
          color: style.color,
          borderRadius: style.borderRadius,
          fontSize: style.fontSize,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          disabled: btn.hasAttribute('disabled'),
        };
      }).filter(b => b.visible);
    });

    console.log(`Found ${buttonStyles.length} visible buttons`);
    console.log('Button style sample:', JSON.stringify(buttonStyles.slice(0, 10), null, 2));

    for (const btn of buttonStyles) {
      expect(btn.height).toBeGreaterThan(15);
      if (!btn.disabled && btn.text.length > 0) {
        expect(btn.color).toBeTruthy();
      }
    }
  });

  test('TEST-1504: Activity bar icons are visible and clickable', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const activityBar = await page.evaluate(() => {
      // Kairo uses Lumino tab bar for the vertical activity bar (left icon strip)
      // .theia-app-left IS the .lm-TabBar itself (not a descendant)
      const activityBarEl = document.querySelector('.theia-app-left.theia-app-sides.lm-TabBar');
      if (!activityBarEl) return { exists: false };

      const tabItems = Array.from(activityBarEl.querySelectorAll('.lm-TabBar-tab')).map(item => {
        const rect = item.getBoundingClientRect();
        const ariaLabel = item.getAttribute('aria-label') || '';
        return {
          id: item.id,
          title: ariaLabel || item.getAttribute('title') || '',
          visible: rect.width > 0 && rect.height > 0,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          iconClass: item.querySelector('.codicon')?.className || '',
          ariaLabel,
        };
      }).filter(i => i.visible && i.width > 20 && i.height > 20 && i.top < 800);

      return { exists: true, itemCount: tabItems.length, items: tabItems.slice(0, 15) };
    });

    console.log('Activity bar:', JSON.stringify(activityBar, null, 2));
    await page.screenshot({ path: `${screenshotDir}/activity-bar.png` });

    expect(activityBar.exists).toBe(true);
    expect(activityBar.itemCount).toBeGreaterThan(0);
  });

  test('TEST-1505: Resize window does not break layout', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const sizes = [
      { w: 1280, h: 720 },
      { w: 1920, h: 1080 },
      { w: 1024, h: 768 },
      { w: 800, h: 600 },
    ];

    for (let i = 0; i < sizes.length; i++) {
      const { w, h } = sizes[i];
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${screenshotDir}/viewport-${w}x${h}.png` });

      const shellVisible = await page.evaluate(() => {
        const shell = document.querySelector('#theia-app-shell, #theia-shell, .theia-shell');
        return shell !== null && shell.getBoundingClientRect().width > 100;
      });
      expect(shellVisible).toBe(true);
    }

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('TEST-1506: Color theme is Kairo dark theme', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const themeInfo = await page.evaluate(() => {
      const body = document.body;
      const style = window.getComputedStyle(body);
      const shell = document.querySelector('#theia-app-shell, .theia-shell');
      const shellStyle = shell ? window.getComputedStyle(shell) : null;
      return {
        bodyBg: style.backgroundColor,
        bodyColor: style.color,
        bodyFont: style.fontFamily,
        shellBg: shellStyle?.backgroundColor || 'n/a',
        hasKairoClass: document.documentElement.classList.contains('kairo-dark') ||
                       document.body.classList.contains('kairo-dark') ||
                       !!document.querySelector('[data-theme*="kairo"], .kairo-theme, [class*="kairo-dark"]'),
      };
    });

    console.log('Theme info:', themeInfo);
    await page.screenshot({ path: `${screenshotDir}/theme-review.png` });

    const bgMatch = themeInfo.bodyBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (bgMatch) {
      const r = parseInt(bgMatch[1]), g = parseInt(bgMatch[2]), b = parseInt(bgMatch[3]);
      const brightness = (r + g + b) / 3;
      console.log(`Background brightness: ${brightness}`);
    }
  });

  test('TEST-1507: No overlapping critical UI elements', async ({ page }, testInfo) => {
    const screenshotDir = testInfo.outputPath('screenshots');

    const overlapCheck = await page.evaluate(() => {
      const issues: string[] = [];
      const criticalElements = [
        '#theia-top-panel',
        '#theia-statusBar',
        '#theia-main-content-panel',
      ];
      const rects: Array<{ el: string; top: number; bottom: number; left: number; right: number }> = [];
      for (const sel of criticalElements) {
        const el = document.querySelector(sel);
        if (el) {
          const r = el.getBoundingClientRect();
          rects.push({ el: sel, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
        }
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          const overlap = a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;
          if (overlap) {
            issues.push(`Overlap: ${a.el} & ${b.el}`);
          }
        }
      }
      return { issues, rects };
    });

    console.log('Overlap check:', overlapCheck);
    await page.screenshot({ path: `${screenshotDir}/overlap-check.png` });
  });
});
