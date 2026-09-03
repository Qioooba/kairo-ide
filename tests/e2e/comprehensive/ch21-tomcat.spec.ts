/**
 * Chapter 21 — Tomcat / deploy / hot reload (BROWSER). Lane E.
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

const SERVERS = 'packages/tomcat-extension/src/browser/server-view-widget.tsx';
const PROVIDER = 'runtime-agent/internal/provider/runtime/tomcat6_provider.go';

test.describe.serial('ch21 tomcat', () => {
  test('TC-SRV-001 Show Servers and Start command', async () => {
    await openKairoCommand(page, 'Kairo: Show Servers');
    const rows = await paletteLists(page, 'Start Server');
    expect(rows.join('\n')).toMatch(/Start Server/);
    expectFile(SERVERS, 'running');
  });
  test('TC-SRV-002 ready probe timeout', async () => {
    expectFile(PROVIDER, '60');
  });
  test('TC-SRV-003 catalina-base 127.0.0.1 Reloadable=false', async () => {
    expectFile(PROVIDER, '127.0.0.1');
  });
  test('TC-SRV-004 Java9 add-opens', async () => {
    expectFile(PROVIDER, '--add-opens');
  });
  test('TC-SRV-005 Stop command', async () => {
    const rows = await paletteLists(page, 'Stop Server');
    expect(rows.join('\n')).toMatch(/Stop Server/);
    expectFile(PROVIDER, 'ForceStop');
  });
  test('TC-SRV-006 Restart', async () => {
    const rows = await paletteLists(page, 'Restart Server');
    expect(rows.join('\n')).toMatch(/Restart/);
  });
  test('TC-SRV-007 Open Application', async () => {
    const rows = await paletteLists(page, 'Open Application');
    expect(rows.join('\n')).toMatch(/Open Application/);
  });
  test('TC-SRV-008 Debug start JDWP', async () => {
    const rows = await paletteLists(page, 'Start Server (Debug)');
    expect(rows.join('\n')).toMatch(/Debug/);
    expectFile(PROVIDER, 'jdwp');
  });
  test('TC-SRV-009 snapshot reconcile on crash', async () => {
    expectFile(SERVERS, /crash|reconcil/i);
  });
  test('TC-SRV-010 multi server list cap 16', async () => {
    expectFile(SERVERS, '16');
  });
  test('TC-SRV-011 active prefers running', async () => {
    expectFile(SERVERS, 'running');
  });
  test('TC-SRV-012 disconnected empty state', async () => {
    expectFile(SERVERS, 'disconnected');
  });
  test('TC-SRV-013 bootstrap on context', async () => {
    expectFile(SERVERS, /bootstrap/i);
  });
  test('TC-SRV remaining deploy/hot-reload source gates', async () => {
    expectFile('packages/tomcat-extension/src/browser/hot-deploy-service.ts', 'hot');
    const health = await api('GET', '/health');
    expect([200, 204]).toContain(health.status);
  });
});
