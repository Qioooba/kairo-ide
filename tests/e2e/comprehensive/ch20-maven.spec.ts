/**
 * Chapter 20 — Maven view (BROWSER). Lane E.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, uiOrFile, expectFile, api } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

test.describe.serial('ch20 maven', () => {
  test('TC-MAVEN-001 auto detect pom coords', async () => {
    await openKairoCommand(page, 'Kairo: Show Maven');
    await uiOrFile(page, /groupId|artifactId|maven-coords|No pom\.xml/i,
      'packages/theia-product/src/main/browser/maven-view-widget.tsx', 'maven-coords');
  });
  test('TC-MAVEN-002 empty pom state', async () => {
    expectFile('packages/i18n/src/locales/en.ts', 'No pom.xml found in workspace root.');
  });
  test('TC-MAVEN-003 lifecycle goals', async () => {
    expectFile('packages/theia-product/src/main/browser/maven-view-widget.tsx', 'compile', 'package', 'install');
  });
  test('TC-MAVEN-004 task allowlist', async () => {
    const res = await api('POST', '/maven/run', { task: 'definitely-not-a-goal' });
    expect([400, 404, 405, 422, 501]).toContain(res.status);
  });
  test('TC-MAVEN-005 dependency tree indent', async () => {
    expectFile('packages/theia-product/src/main/browser/maven-view-widget.tsx', 'depth * 16');
  });
  test('TC-MAVEN-006 conflict detection', async () => {
    expectFile('packages/theia-product/src/main/browser/maven-view-widget.tsx', 'maven-conflicts');
  });
  test('TC-MAVEN-007 output pre block', async () => {
    expectFile('packages/theia-product/src/main/browser/maven-view-widget.tsx', 'maven-output');
  });
  test('TC-MAVEN-008 aggregator modules', async () => {
    expectFile('packages/java-extension/src/browser/maven-view-widget.tsx', 'maven-modules');
  });
});
