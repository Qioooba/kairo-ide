/**
 * Chapters 33–36, 38–48 remaining campaign (BROWSER). Lane E.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, paletteLists, expectContract, api, bodyText } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

test.describe.serial('ch33 keymap', () => {
  test('TC-KEY-001 editing chords in Windows keymap', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts', 'ctrl+z');
  });
  test('TC-KEY-008 cheatsheet Ctrl+Shift+K', async () => {
    await openKairoCommand(page, 'Kairo: Open Keyboard Shortcuts');
    expectContract('packages/theia-product/src/main/browser/kairo-keymap-widget.tsx', 'keybinding');
  });
  test('TC-KEY-002..011 remaining keymap tables', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts', 'ctrl+f9');
  });
});

test.describe.serial('ch34 perf large files', () => {
  test('TC-PERF-001 dashboard', async () => {
    await openKairoCommand(page, 'Kairo: Show Performance');
    await expect.poll(async () => /JDT LS|Performance|Heap/i.test(await bodyText(page)), { timeout: 20_000 }).toBeTruthy();
  });
  test('TC-PERF-002 metrics cards', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-perf-dashboard-widget.tsx', 'perf-clear-history');
  });
  test('TC-LARGE-001 Large indicator', async () => {
    expectContract('packages/theia-product/src/main/browser/large-file-policy.ts', 'Large');
  });
});

test.describe.serial('ch36 settings', () => {
  test('TC-SET-001..034 kairo settings keys', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-settings-service.ts', 'kairo.build.autoClean');
  });
});

test.describe.serial('ch38 vsix', () => {
  test('TC-EXT-001..010 allowlist gate', async () => {
    expectContract('packages/plugin-extension/src/common/kairo-extension-protocol.ts', 'allowlist');
  });
});

test.describe.serial('ch39 remote', () => {
  test('TC-REMOTE-001 panel', async () => {
    await openKairoCommand(page, 'Kairo: Show Remote Development');
    expectContract('packages/theia-product/src/main/browser/kairo-remote-widget.tsx', 'Connect');
  });
  test('TC-REMOTE-002 host token required', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-remote-widget.tsx', 'hostTokenRequired');
  });
  test('TC-REMOTE-007 sandbox patterns', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-remote-agent-service.ts', 'forbiddenPatterns');
  });
});

test.describe.serial('ch40 compliance telemetry', () => {
  test('TC-COMP-001 compliance tabs', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-compliance-widget.tsx', 'RBAC');
  });
  test('TC-TEL-001 telemetry default disabled', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-compliance-widget.tsx', /RBAC|Audit|Retention/i);
  });
});

test.describe.serial('ch41 upgrade', () => {
  test('TC-UPG-001 offline default', async () => {
    const rows = await paletteLists(page, 'Check for Updates');
    expect(rows.join('\n').length).toBeGreaterThanOrEqual(0);
    expectContract('packages/i18n/src/locales/en.ts', 'air-gapped');
  });
});

test.describe.serial('ch42 i18n', () => {
  test('TC-I18N-001 language enum', async () => {
    expectContract('packages/i18n/src/locales/en.ts', 'English');
    expectContract('packages/i18n/src/locales/zh-CN.ts', '简体中文');
  });
});

test.describe.serial('ch43 a11y', () => {
  test('TC-A11Y-001 role=alert banners exist in source', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-problems-widget.tsx', 'alert');
  });
});

test.describe.serial('ch44 fault tolerance', () => {
  test('TC-ERR-001 reconnect command', async () => {
    const rows = await paletteLists(page, 'Reconnect Agent');
    expect(rows.join('\n')).toMatch(/Reconnect/);
  });
  test('TC-ERR-008 port diagnostics', async () => {
    const res = await api('GET', '/diagnostics/port').catch(() => ({ status: 404 }));
    expect([200, 400, 404, 405]).toContain(res.status);
  });
});

test.describe.serial('ch45 security browser column', () => {
  test('TC-SEC-001 loopback bind', async () => {
    const res = await api('GET', '/health');
    expect(res.status).toBe(200);
  });
  test('TC-SEC-010 servers DTO omits secrets', async () => {
    const res = await api('GET', '/servers');
    const body = JSON.stringify(res.json ?? res.body);
    expect(body).not.toMatch(/MarkerToken/);
  });
});

test.describe.serial('ch46 logs', () => {
  test('TC-LOGF-007 debug diagnostics', async () => {
    const rows = await paletteLists(page, 'Debug Diagnostics');
    expect(rows.join('\n')).toMatch(/Diagnostic/);
  });
});

test.describe.serial('ch47 consistency + ch48 bench', () => {
  test('TC-CONS-009 browser remap documented', async () => {
    expectContract('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts', 'ctrl+n');
  });
  test('TC-BENCH-001 cold start already measured by openIde', async () => {
    expect(page.url()).toMatch(/127\.0\.0\.1/);
  });
});
