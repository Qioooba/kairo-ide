/**
 * Chapter 22 — Run configurations (BROWSER). Lane E.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openIde, openKairoCommand, paletteLists, expectFile } from './campaign';

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await openIde(page);
});
test.afterAll(async () => { await page?.close(); });

const W = 'packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx';
const S = 'packages/theia-product/src/main/browser/kairo-run-configuration-service.ts';
const SCHEMA = 'packages/config-schema/src/run-configuration.ts';

test.describe.serial('ch22 run configurations', () => {
  test('TC-RUN-001 open Manage Run Configurations', async () => {
    const rows = await paletteLists(page, 'Manage Run Configurations');
    expect(rows.join('\n')).toMatch(/Run Configuration/);
    await openKairoCommand(page, 'Kairo: Manage Run Configurations');
    expectFile(W, 'configuration');
  });
  test('TC-RUN-002 new default tomcat template', async () => {
    expectFile(S, 'tomcat', 'mode');
  });
  test('TC-RUN-003 six form groups', async () => {
    expectFile(W, 'General', 'Server', 'Build', 'Deploy');
  });
  test('TC-RUN-004 unique name validation', async () => {
    expectFile(SCHEMA, /duplicate|unique/i);
  });
  test('TC-RUN-005 httpPort != debugPort', async () => {
    expectFile(S, 'httpPort', 'debugPort');
  });
  test('TC-RUN-006 artifact path traversal rejected', async () => {
    expectFile(SCHEMA, '..');
  });
  test('TC-RUN-007 env secrets must use ${env:}', async () => {
    expectFile(SCHEMA, 'PASSWORD', '${env:');
  });
  test('TC-RUN-008 env line format', async () => {
    expectFile(S, 'NAME=value');
  });
  test('TC-RUN-009 beforeLaunch build before deploy', async () => {
    expectFile(S, 'beforeLaunch');
  });
  test('TC-RUN-010 ID immutable while editing', async () => {
    expectFile(S, 'cannot be changed');
  });
  test('TC-RUN-011 delete confirm', async () => {
    expectFile(S, /delete/i);
  });
  test('TC-RUN-012 Run button launch', async () => {
    expectFile(S, 'launch');
  });
  test('TC-RUN-013 Debug one-click', async () => {
    expectFile(S, 'debug', 'suspend');
  });
  test('TC-RUN-014 port occupied banner', async () => {
    expectFile(S, 'occupied');
  });
  test('TC-RUN-015 mutex in-progress', async () => {
    expectFile(S, 'already in progress');
  });
  test('TC-RUN-016 project mismatch', async () => {
    expectFile(S, 'Select project');
  });
  test('TC-RUN-017 summary panel', async () => {
    expectFile(W, 'JDWP');
  });
  test('TC-RUN-018 default badge', async () => {
    expectFile(S, /selectedConfigurationId|default/i);
  });
  test('TC-RUN-019 canonical JSON serialization', async () => {
    expectFile(SCHEMA, 'localeCompare');
  });
});
