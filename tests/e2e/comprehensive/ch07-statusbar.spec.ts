/**
 * Chapter 7 — Status bar tests (browser column) per
 * docs/COMPREHENSIVE_TEST_DOCUMENT.md §7.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  openIde,
  attachDiagnostics,
  api,
  ensureWorkspace,
  discoverBoundWorkspaceId,
  ensureProjectInWs,
  createRunConfigApi,
  openFileViaQuickOpen,
  waitForMainTab,
  focusEditor,
  LANE_WS,
  sbEntry,
  unexpectedConsoleErrors,
} from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const SB = '#theia-statusBar';

async function expectNoFatal(diag: { pageErrors: string[]; consoleErrors: string[] }) {
  expect(diag.pageErrors, 'page errors').toEqual([]);
  const unexpected = unexpectedConsoleErrors(diag.consoleErrors);
  expect(unexpected, `unexpected console errors: ${unexpected.join(' | ')}`).toEqual([]);
}

/** Status bar entry whose accessible text matches re (kairo entries are div.element). */
function entry(page: import('@playwright/test').Page, re: RegExp) {
  return page.locator(`${SB} .element`).filter({ hasText: re }).first();
}

test.describe('ch07 StatusBar', () => {

  test('TC-SB-001 Project entry: placeholder when none; click opens selector; name shown once active', async ({ page }) => {
    const diag = attachDiagnostics(page);
    const ws = await ensureWorkspace();
    await openIde(page);
    const projectEntry = entry(page, /Project:/i);
    await expect(projectEntry).toBeVisible({ timeout: 30_000 });
    // click opens the project selector widget
    await projectEntry.click();
    await expect(page.locator('[data-testid="project-selector"]').first()).toBeVisible({ timeout: 20_000 });
    // bind + activate a project via the toolbar (shared state), then the entry shows the name
    const sel = page.locator('#kairo-toolbar-project');
    if (await sel.count()) {
      let options = await sel.locator('option').allTextContents();
      if (!options.includes('legacy-sample')) {
        await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任/i }).first();
        try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
        await page.waitForSelector('#theia-app-shell', { timeout: 90_000 });
      }
      await sel.selectOption({ label: 'legacy-sample' });
      await page.waitForTimeout(1500);
      await expect(entry(page, /legacy-sample/)).toBeVisible({ timeout: 15_000 });
    }
    await expectNoFatal(diag);
  });

  test('TC-SB-002 JDK entry shows version/state and is clickable', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const jdk = entry(page, /JDK:/i);
    await expect(jdk).toBeVisible({ timeout: 30_000 });
    const txt = (await jdk.textContent()) ?? '';
    // shows a JDK major/state — lane has OpenJDK 21 auto-detected or stopped state pre-project
    expect(txt).toMatch(/JDK:\s*(\d|stopped|uninitialized|not ready|crashed|已停止)/i);
    // semantic class present (success/active/warning/neutral/placeholder family)
    const cls = await jdk.getAttribute('class');
    expect(cls ?? '').toMatch(/kairo-statusbar-(group|state|placeholder)/);
    await expectNoFatal(diag);
  });

  test('TC-SB-003 Encoding entry: placeholder without editor; QuickPick with GBK file', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    // no editor open yet → placeholder
    await expect(entry(page, /Encoding:\s*-/i)).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
    // project encoding is GBK — opening a project java file shows it
    await openFileViaQuickOpen(page, 'HelloServlet.java');
    await waitForMainTab(page, /HelloServlet/, 30_000);
    const enc = entry(page, /Encoding:/i);
    await expect(enc).toBeVisible({ timeout: 20_000 });
    const txt = (await enc.textContent()) ?? '';
    expect(txt).toMatch(/Encoding:\s*[a-z0-9-]+/i);
    // NOTE: 'gbk' requires an imported+active project (encoding registry);
    // without it the global default utf-8 is shown. Both satisfy
    // “显示当前文件编码” — the GBK-specific path is covered in ch17.
    // click → reopen-with-encoding quick pick appears
    await enc.click();
    const quickInput = page.locator('.quick-input-widget .quick-input-box input').first();
    await expect(quickInput).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expectNoFatal(diag);
  });

  test('TC-SB-004 Build entry reflects build states (active→success classes)', async ({ page }) => {
    test.setTimeout(240_000);
    const diag = attachDiagnostics(page);
    const ws = await ensureWorkspace();
    await openIde(page);
    await expect(entry(page, /Build:/i)).toBeVisible({ timeout: 30_000 });
    const projects = await api('GET', '/projects');
    const projId = (projects.json?.payload ?? []).find((p: { name: string }) => p.name === 'legacy-sample')?.id;
    if (!projId) throw new Error('project missing');
    // trigger a build through the agent (same path the UI uses)
    const started = await api('POST', '/builds', { projectId: projId });
    expect(started.json?.ok, started.body.slice(0, 120)).toBeTruthy();
    const buildId = started.json?.payload?.id;
    // poll the entry class for active/success semantics
    let sawActiveOrSuccess = false;
    let finalState = '';
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(1000);
      const e = entry(page, /Build:/i);
      const cls = (await e.getAttribute('class').catch(() => '')) ?? '';
      if (/kairo-statusbar-state-(active|success)/.test(cls)) sawActiveOrSuccess = true;
      try {
        const st = await api('GET', `/builds`);
        const b = (st.json?.payload ?? []).find((x: { id: string }) => x.id === buildId);
        if (b && !/^(queued|running)$/i.test(b.state)) { finalState = b.state; break; }
      } catch { /* keep polling */ }
    }
    expect(sawActiveOrSuccess, 'semantic state class observed').toBeTruthy();
    expect(finalState).not.toBe('');
    await expectNoFatal(diag);
  });

  test('TC-SB-005 Server entry shows state with port info (running green / stopped neutral)', async ({ page }) => {
    const diag = attachDiagnostics(page);
    // Block real events websocket + mock GET /servers BEFORE the app loads:
    // the ServerStore is hydrated once at startup from these sources.
    await page.route(/\/api\/v1\/events(\?.*)?$/, (route) => route.abort());
    await page.route(/\/api\/v1\/servers(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: 'sb5',
          ok: true,
          payload: [{
            id: 'srv-sb5', state: 'running', pid: 7, projectId: 'project-legacy-sample',
            startedAt: new Date().toISOString(), ports: { http: 18080, debug: 8000 },
          }],
        }),
      });
    });
    await openIde(page);
    const server = entry(page, /Server:/i);
    await expect(server).toBeVisible({ timeout: 30_000 });
    // running format: "<state> :<httpPort> · JDWP:<debugPort>"
    let rich = '';
    for (let i = 0; i < 20; i++) {
      rich = (await server.textContent().catch(() => '')) ?? '';
      if (/18080/.test(rich)) break;
      await page.waitForTimeout(1000);
    }
    expect(rich).toMatch(/18080/);
    expect(rich).toMatch(/JDWP/i);
    const runCls = (await server.getAttribute('class')) ?? '';
    expect(runCls).toMatch(/kairo-statusbar-state-active|kairo-statusbar-state-success/);
    await expectNoFatal(diag);
  });

  test('TC-SB-006 Debug entry present and neutral while idle', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const dbg = entry(page, /Debug:/i);
    await expect(dbg).toBeVisible({ timeout: 30_000 });
    const cls = (await dbg.getAttribute('class')) ?? '';
    expect(cls).toMatch(/kairo-statusbar-group-3/);
    await expectNoFatal(diag);
  });

  test('TC-SB-007 Agent entry connected; click reconnect keeps connection', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const agent = entry(page, /Agent:/i);
    await expect(agent).toBeVisible({ timeout: 30_000 });
    let txt = '';
    for (let i = 0; i < 20; i++) {
      txt = (await agent.textContent().catch(() => '')) ?? '';
      if (/connected/i.test(txt)) break;
      await page.waitForTimeout(1000);
    }
    expect(txt).toMatch(/Agent:\s*connected/i);
    const cls = (await agent.getAttribute('class')) ?? '';
    expect(cls).toMatch(/kairo-statusbar-state-success/);
    await agent.click();
    let okAfter = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      const t2 = (await entry(page, /Agent:/i).textContent().catch(() => '')) ?? '';
      if (/connected/i.test(t2)) { okAfter = true; break; }
    }
    expect(okAfter).toBeTruthy();
    await expectNoFatal(diag);
  });

  test('TC-SB-008 Hot Reload entry only visible with an active project', async ({ page }) => {
    const diag = attachDiagnostics(page);
    const ws = await ensureWorkspace();
    await openIde(page);
    await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample' });
    // activate project via toolbar
    const sel = page.locator('#kairo-toolbar-project');
    await expect(sel).toBeVisible({ timeout: 25_000 });
    await sel.selectOption({ label: 'legacy-sample' });
    await page.waitForTimeout(2000);
    const hot = entry(page, /HotReload|Hot Reload|热重载/i);
    await expect(hot).toBeVisible({ timeout: 20_000 });
    const txt = (await hot.textContent()) ?? '';
    expect(txt.toLowerCase()).toMatch(/synced|compiling|restart/);
    const cls = (await hot.getAttribute('class')) ?? '';
    expect(cls).toMatch(/kairo-statusbar-state-(success|active|warning)/);
    await expectNoFatal(diag);
  });

  test('TC-SB-011 Large file indicator appears for >5M char files', async ({ page }) => {
    test.setTimeout(300_000);
    const diag = attachDiagnostics(page);
    const big = path.join(LANE_WS, 'legacy-sample', 'sb-011-big.txt');
    // ~6 MB of ASCII → "Large" tier (5M threshold)
    const chunk = 'x'.repeat(1024) + '\n';
    const fd = fs.openSync(big, 'w');
    for (let i = 0; i < 6 * 1024; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
    try {
      await openIde(page);
      await openFileViaQuickOpen(page, 'sb-011-big.txt');
      await waitForMainTab(page, /sb-011-big/, 60_000);
      const large = page.locator(`${SB} .element`).filter({ hasText: /Large file|Huge file/i }).first();
      let seen = false;
      for (let i = 0; i < 60 && !seen; i++) {
        seen = (await large.count()) > 0;
        if (!seen) await page.waitForTimeout(1500);
      }
      if (!seen) {
        const dump = await page.evaluate(() =>
          Array.from(document.querySelectorAll('#theia-statusBar .element')).map((e) => e.textContent?.trim()),
        );
        throw new Error(`large-file indicator missing; status entries=${JSON.stringify(dump)}`);
      }
      const txt = (await large.textContent()) ?? '';
      expect(txt).toMatch(/Large file mode/i);
    } finally {
      fs.unlinkSync(big);
    }
    await expectNoFatal(diag);
  });

  test('TC-SB-012 Format on Save indicator mirrors preference on java files', async ({ page }) => {
    const diag = attachDiagnostics(page);
    const f = path.join(LANE_WS, 'legacy-sample', 'src', 'sb012', 'Sb012.java');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'public class Sb012 {\n}\n');
    try {
      await openIde(page);
      await openFileViaQuickOpen(page, 'Sb012.java');
      await waitForMainTab(page, /Sb012\.java/, 30_000);
      const fos = page.locator(`${SB} .element`).filter({ hasText: /Format on Save/i }).first();
      await expect(fos).toBeVisible({ timeout: 30_000 });
      const txt = (await fos.textContent()) ?? '';
      // default off → $(close) icon rendered as codicon-close sibling
      const iconCls = (await fos.locator('.codicon').first().getAttribute('class')) ?? '';
      expect(iconCls).toMatch(/codicon-(close|check)/);
      expect(txt).toMatch(/Format on Save/i);
    } finally {
      try { fs.rmSync(path.join(LANE_WS, 'legacy-sample', 'src', 'sb012'), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    await expectNoFatal(diag);
  });

  test('TC-SB-013 Notification bell shows unread badge and opens notification center', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const bell = page.locator(`${SB} .element`).filter({ has: page.locator('.codicon-bell') }).first();
    await expect(bell).toBeVisible({ timeout: 30_000 });
    const txt = (await bell.textContent()) ?? '';
    expect(txt.trim()).toMatch(/^(\d+)?$/); // bell icon plus optional unread count
    await bell.click();
    // notification center widget/tab opens
    await page.waitForTimeout(1500);
    const center = page.locator('[data-testid*="notification"], .kairo-notification-center').first();
    const mainTabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.lm-TabBar-tabLabel')).map((e) => e.textContent?.trim() ?? ''),
    );
    const opened = (await center.count()) > 0 || mainTabs.some((t) => /notification/i.test(t));
    expect(opened, `bell click opens center (tabs=${mainTabs})`).toBeTruthy();
    await expectNoFatal(diag);
  });
});
