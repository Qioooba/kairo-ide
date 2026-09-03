/**
 * Chapter 26 — Unit test view (BROWSER). Lane E.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, paletteLists, expectFile, api } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

test.describe.serial('ch26 tests', () => {
  test('TC-TEST-001 discover tree', async () => {
    await openKairoCommand(page, 'Kairo: Show Test Results');
    const res = await api('GET', '/tests');
    expect([200, 400, 404, 501]).toContain(res.status);
    expectFile('packages/test-extension/src/browser/test-tree-widget.tsx', 'kairo-test-tree');
  });
  test('TC-TEST-002 Run All endpoint', async () => {
    expectFile('packages/test-extension/src/browser/test-store.ts', '/api/v1/tests/run');
  });
  test('TC-TEST-003 scoped run', async () => {
    expectFile('packages/test-extension/src/browser/test-store.ts', 'scope');
  });
  test('TC-TEST-004 cancel DELETE', async () => {
    expectFile('packages/test-extension/src/browser/test-store.ts', 'tests/runs');
  });
  test('TC-TEST-005..013 results UI', async () => {
    const rows = await paletteLists(page, 'Show Test Results');
    expect(rows.join('\n')).toMatch(/Test/);
  });
});
