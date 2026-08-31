/**
 * Chapter 6 — Toolbar tests (browser column) per
 * docs/COMPREHENSIVE_TEST_DOCUMENT.md §6.
 */
import { test, expect } from '@playwright/test';
import {
  openIde,
  attachDiagnostics,
  api,
  ensureWorkspace,
  importProjectApi,
  createRunConfigApi,
  LANE_WS,
  discoverBoundWorkspaceId,
  ensureProjectInWs,
  unexpectedConsoleErrors,
} from './helpers';
import * as path from 'path';
import * as fs from 'fs';

test.use({ viewport: { width: 1440, height: 900 } });

const TOOLBAR = '.kairo-toolbar';
const PROJECT_SEL = '#kairo-toolbar-project';
const RUNCFG_SEL = '#kairo-toolbar-run-config';

async function expectNoFatal(diag: { pageErrors: string[]; consoleErrors: string[] }) {
  expect(diag.pageErrors, 'page errors').toEqual([]);
  const unexpected = unexpectedConsoleErrors(diag.consoleErrors);
  expect(unexpected, `unexpected console errors: ${unexpected.join(' | ')}`).toEqual([]);
}

test.describe('ch06 Toolbar', () => {

  let wsId: string;

  /**
   * Make sure the toolbar dropdown lists both lane projects bound to the
   * workspace THIS page is using, then activate legacy-sample.
   */
  async function bindToolbar(page: import('@playwright/test').Page): Promise<void> {
    const sel = page.locator(PROJECT_SEL);
    await expect(sel).toBeVisible({ timeout: 20_000 });
    let options = await sel.locator('option').allTextContents();
    if (!options.includes('legacy-sample') || !options.includes('_proj-second')) {
      const ws = await discoverBoundWorkspaceId(page);
      await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample', encoding: 'gbk' });
      await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, '_proj-second'), name: '_proj-second', encoding: 'utf-8' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任/i }).first();
      try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
      await page.waitForSelector('#theia-app-shell', { timeout: 90_000 });
      await expect(sel).toBeVisible({ timeout: 20_000 });
    }
    await sel.selectOption({ label: 'legacy-sample' });
    await page.waitForTimeout(1200);
  }

  test.beforeAll(async () => {
    try {
      wsId = await ensureWorkspace();
      await ensureProjectInWs(wsId, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample' });
      await ensureProjectInWs(wsId, { rootPath: path.join(LANE_WS, '_proj-second'), name: '_proj-second', encoding: 'utf-8' });
    } catch (e) {
      console.warn('[ch06] beforeAll:', e instanceof Error ? e.message : e);
    }
  });

  test('TC-TB-001 toolbar shows all elements', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const tb = page.locator(TOOLBAR);
    await expect(tb).toBeVisible({ timeout: 30_000 });
    // project dropdown + label
    await expect(tb.locator('label', { hasText: /Project|项目/ })).toBeVisible();
    await expect(page.locator(PROJECT_SEL)).toBeVisible();
    // run config dropdown + label
    await expect(tb.locator('label', { hasText: /Run Config|运行配置/i })).toBeVisible();
    await expect(page.locator(RUNCFG_SEL)).toBeVisible();
    // vertical separator
    await expect(tb.locator('.kairo-toolbar-separator')).toBeVisible();
    // four action buttons with codicons
    await expect(tb.locator('.kairo-toolbar-btn-run .codicon-play')).toBeVisible();
    await expect(tb.locator('.kairo-toolbar-btn-debug .codicon-debug-alt')).toBeVisible();
    await expect(tb.locator('.kairo-toolbar-btn-stop .codicon-stop')).toBeVisible();
    await expect(tb.locator('.kairo-toolbar-btn-build .codicon-tools')).toBeVisible();
    await expectNoFatal(diag);
  });

  test('TC-TB-002 project dropdown lists agent projects and marks current', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const sel = page.locator(PROJECT_SEL);
    await expect(sel).toBeVisible({ timeout: 20_000 });
    await expect(sel.locator('option')).not.toHaveCount(0, { timeout: 20_000 });
    let options = await sel.locator('option').allTextContents();
    if (!options.includes('legacy-sample')) {
      const ws = await discoverBoundWorkspaceId(page);
      await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample' });
      await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, '_proj-second'), name: '_proj-second', encoding: 'utf-8' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任/i }).first();
      try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
      await page.waitForSelector('#theia-app-shell', { timeout: 90_000 });
      await expect(sel).toBeVisible({ timeout: 20_000 });
      options = await sel.locator('option').allTextContents();
    }
    expect(options).toContain('legacy-sample');
    expect(options).not.toContain('No projects');
    // empty-state text only when no projects (verified in ch05 fresh states)
    await expectNoFatal(diag);
  });

  test('TC-TB-003 switching project updates ActiveProjectService (status bar follows)', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const sel = page.locator(PROJECT_SEL);
    await expect(sel).toBeVisible({ timeout: 20_000 });
    let options = await sel.locator('option').allTextContents();
    if (!options.includes('_proj-second') || !options.includes('legacy-sample')) {
      const ws = await discoverBoundWorkspaceId(page);
      await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample', encoding: 'gbk' });
      await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, '_proj-second'), name: '_proj-second', encoding: 'utf-8' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任/i }).first();
      try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
      await page.waitForSelector('#theia-app-shell', { timeout: 90_000 });
      await expect(sel).toBeVisible({ timeout: 20_000 });
    }
    await sel.selectOption({ label: '_proj-second' });
    await page.waitForTimeout(1500);
    const projectEntry = page.locator('#theia-statusBar .element').filter({ hasText: /Project:/i }).first();
    await expect(projectEntry).toHaveText(/_proj-second/, { timeout: 15_000 });
    // switch back
    await sel.selectOption({ label: 'legacy-sample' });
    await page.waitForTimeout(1500);
    await expect(projectEntry).toHaveText(/legacy-sample/, { timeout: 15_000 });
    await expectNoFatal(diag);
  });

  test('TC-TB-004 run config dropdown format "{name} ({MODE})" and empty state', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const ws = await discoverBoundWorkspaceId(page);
    // create two configs via API so the dropdown is populated
    const projects = await api('GET', '/projects');
    const projId = (projects.json?.payload ?? []).find((p: { name: string }) => p.name === 'legacy-sample')?.id;
    if (!projId) throw new Error('legacy-sample not registered for lane workspace');
    await createRunConfigApi(ws, { id: 'cfg-run-a', name: 'Tomcat Local', projectId: projId, mode: 'run', httpPort: 18090 });
    await createRunConfigApi(ws, { id: 'cfg-debug-b', name: 'Tomcat Debug', projectId: projId, mode: 'debug', httpPort: 18091 });
    await openIde(page);
    const sel = page.locator(RUNCFG_SEL);
    await expect(sel).toBeVisible({ timeout: 20_000 });
    // the run config service reads the persisted document — wait for options
    let texts: string[] = [];
    for (let i = 0; i < 20; i++) {
      texts = await sel.locator('option').allTextContents();
      if (texts.some((t) => /\(RUN\)/.test(t))) break;
      await page.waitForTimeout(1000);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      const trust = page.getByRole('button', { name: /Yes, I trust/i }).first();
      try { await trust.click({ timeout: 8000 }); } catch { /* none */ }
      await page.waitForSelector('#theia-app-shell', { timeout: 60_000 }).catch(() => undefined);
    }
    expect(texts.some((t) => /Tomcat Local \(RUN\)/.test(t)), `got ${texts}`).toBeTruthy();
    expect(texts.some((t) => /Tomcat Debug \(DEBUG\)/.test(t))).toBeTruthy();
    await expectNoFatal(diag);
  });

  test('TC-TB-005 selecting a config persists selectedConfigurationId', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const ws = await discoverBoundWorkspaceId(page);
    const doc = await api('GET', `/workspaces/${ws}/run-configurations`);
    const cfgs = doc.json?.payload?.configurations ?? [];
    test.skip(cfgs.length < 2, '需要两个已持久化的运行配置（TC-TB-004 已创建）');
    const other = cfgs.find((c: { id: string }) => c.id !== doc.json.payload.selectedConfigurationId);
    const sel = page.locator(RUNCFG_SEL);
    await expect(sel).toBeVisible({ timeout: 20_000 });
    await sel.selectOption(other.id);
    await page.waitForTimeout(1500);
    const after = await api('GET', `/workspaces/${ws}/run-configurations`);
    expect(after.json?.payload?.selectedConfigurationId).toBe(other.id);
    await expectNoFatal(diag);
  });

  test('TC-TB-006 Run button enters busy state and restores (launch request intercepted)', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const ws = await discoverBoundWorkspaceId(page);
    await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample', encoding: 'gbk' });
    const projects = await api('GET', '/projects');
    const projId = (projects.json?.payload ?? []).find((p: { name: string }) => p.name === 'legacy-sample')?.id;
    if (!projId) throw new Error('project missing');
    await createRunConfigApi(ws, { id: 'cfg-run-tb6', name: 'TB6 Run', projectId: projId, mode: 'run', httpPort: 18092 });
    // select the config BEFORE load by persisting selection
    await api('PUT', `/workspaces/${ws}/run-configurations`, {
      version: 1,
      configurations: [
        { id: 'cfg-run-tb6', name: 'TB6 Run', type: 'tomcat6', projectId: projId, mode: 'run', suspend: false, jdkRef: 'kairo-jdk', build: { type: 'javac', clean: false }, server: { id: 't', httpPort: 18092, debugPort: 18403, contextPath: '/app' }, deploy: { mode: 'exploded', artifact: 'a.war' }, env: {}, vmOptions: [], beforeLaunchTasks: [] },
      ],
      selectedConfigurationId: 'cfg-run-tb6',
    });
    // toolbar Run hits POST /api/v1/servers — delay it so the busy state is observable
    await page.route('**/api/v1/servers', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ requestId: 'tb6', ok: false, error: { code: 'internal', message: 'intercepted for TC-TB-006' } }) });
    });
    await bindToolbar(page);
    // wait until the run-config service loaded the persisted document
    const rsel = page.locator(RUNCFG_SEL);
    await expect(rsel).toContainText('', { timeout: 1 }).catch(() => undefined);
    for (let i = 0; i < 20; i++) {
      const v = await rsel.inputValue().catch(() => '');
      if (v === 'cfg-run-tb6') break;
      await page.waitForTimeout(1000);
    }
    const tb = page.locator(TOOLBAR);
    const runBtn = tb.locator('.kairo-toolbar-btn-run');
    await expect(runBtn).toBeEnabled({ timeout: 25_000 });
    await runBtn.click();
    // busy: root class + Running… label + all four buttons disabled
    await expect(tb).toHaveClass(/kairo-toolbar-busy/, { timeout: 8_000 });
    await expect(runBtn).toHaveText(/Running|运行中/i);
    await expect(tb.locator('.kairo-toolbar-btn-debug')).toBeDisabled();
    await expect(tb.locator('.kairo-toolbar-btn-stop')).toBeDisabled();
    await expect(tb.locator('.kairo-toolbar-btn-build')).toBeDisabled();
    // completes → busy class removed
    await expect(tb).not.toHaveClass(/kairo-toolbar-busy/, { timeout: 20_000 });
    await expect(runBtn).not.toHaveText(/Running|运行中/i);
    await expectNoFatal(diag);
  });

  test('TC-TB-007 Debug button disabled when selected config mode=run', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const ws = await discoverBoundWorkspaceId(page);
    await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample', encoding: 'gbk' });
    const projects = await api('GET', '/projects');
    const projId = (projects.json?.payload ?? []).find((p: { name: string }) => p.name === 'legacy-sample')?.id;
    if (!projId) throw new Error('project missing');
    await api('PUT', `/workspaces/${ws}/run-configurations`, {
      version: 1,
      configurations: [
        { id: 'cfg-run-tb7', name: 'TB7 Run', type: 'tomcat6', projectId: projId, mode: 'run', suspend: false, jdkRef: 'kairo-jdk', build: { type: 'javac', clean: false }, server: { id: 't', httpPort: 18093, debugPort: 18403, contextPath: '/app' }, deploy: { mode: 'exploded', artifact: 'a.war' }, env: {}, vmOptions: [], beforeLaunchTasks: [] },
      ],
      selectedConfigurationId: 'cfg-run-tb7',
    });
    await openIde(page);
    const debugBtn = page.locator(`${TOOLBAR} .kairo-toolbar-btn-debug`);
    await expect(debugBtn).toBeVisible({ timeout: 25_000 });
    await expect(debugBtn).toBeDisabled({ timeout: 15_000 });
    await expectNoFatal(diag);
  });

  test('TC-TB-008 Stop button gating (disabled idle; enabled+Stopping… with running server)', async ({ page }) => {
    const diag = attachDiagnostics(page);
    // mock a running server so Stop becomes enabled without Tomcat
    await page.route('**/api/v1/servers', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: 'tb8',
          ok: true,
          payload: [{
            id: 'srv-mock', state: 'running', pid: 4242, projectId: 'project-legacy-sample',
            startedAt: new Date().toISOString(), ports: { http: 18094, debug: 0 },
          }],
        }),
      });
    });
    await openIde(page);
    // open the Servers view — it fetches GET /servers on mount and feeds
    // the shared ServerStore that drives the Stop button gating
    {
      const { openMainMenu, hoverSubmenu, clickMenuItem } = await import('./helpers');
      await openMainMenu(page, 'Kairo');
      await hoverSubmenu(page, { label: 'View' });
      await clickMenuItem(page, { label: 'Servers' });
      await page.waitForTimeout(2500);
    }
    const stopBtn = page.locator(`${TOOLBAR} .kairo-toolbar-btn-stop`);
    await expect(stopBtn).toBeVisible({ timeout: 25_000 });
    await expect(stopBtn).toBeEnabled({ timeout: 20_000 });
    // delay stop so Stopping… is observable
    await page.route('**/api/v1/servers/srv-mock', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: 'tb8-stop',
          ok: true,
          payload: { id: 'srv-mock', state: 'stopped', pid: 0, projectId: 'project-legacy-sample', startedAt: '', ports: { http: 18094, debug: 0 } },
        }),
      });
    });
    await stopBtn.click();
    await expect(stopBtn).toHaveText(/Stopping|停止中/i, { timeout: 6_000 });
    await expect(stopBtn).not.toHaveText(/Stopping|停止中/i, { timeout: 15_000 });
    await expectNoFatal(diag);
  });

  test('TC-TB-009 Build button shows Building… and creates a Builds record', async ({ page }) => {
    test.setTimeout(240_000);
    const diag = attachDiagnostics(page);
    await openIde(page);
    const ws = await discoverBoundWorkspaceId(page);
    await bindToolbar(page);
    const beforeList = await apiWsList(ws);
    const beforeMax = beforeList.map((b: { startedAt?: string }) => b.startedAt ?? '').sort().pop() ?? '';
    await openIde(page);
    const buildBtn = page.locator(`${TOOLBAR} .kairo-toolbar-btn-build`);
    await expect(buildBtn).toBeEnabled({ timeout: 25_000 });
    await buildBtn.click();
    await expect(buildBtn).toHaveText(/Building|构建中/i, { timeout: 10_000 });
    let found = false;
    for (let i = 0; i < 45 && !found; i++) {
      await page.waitForTimeout(2000);
      const after = await apiWsList(ws) as Array<{ startedAt?: string; state?: string }>;
      found = after.some((b) => (b.startedAt ?? '') > beforeMax);
    }
    expect(found, 'new build record created').toBeTruthy();
    await expect(buildBtn).not.toHaveText(/Building|构建中/i, { timeout: 30_000 });
    await expectNoFatal(diag);
  });

  async function apiWsList(ws: string): Promise<Array<unknown>> {
    const agentUrl = process.env.AGENT_URL || `http://127.0.0.1:${process.env.AGENT_PORT || '18410'}`;
    const res = await fetch(`${agentUrl}/api/v1/builds`, {
      headers: { 'X-Kairo-Workspace-Id': ws },
    });
    const j = await res.json().catch(() => null);
    return Array.isArray(j?.payload) ? j.payload : [];
  }

  test('TC-TB-010 double-click Run triggers exactly one operation', async ({ page }) => {
    const diag = attachDiagnostics(page);
    await openIde(page);
    const ws = await discoverBoundWorkspaceId(page);
    await ensureProjectInWs(ws, { rootPath: path.join(LANE_WS, 'legacy-sample'), name: 'legacy-sample', encoding: 'gbk' });
    const projects = await api('GET', '/projects');
    const projId = (projects.json?.payload ?? []).find((p: { name: string }) => p.name === 'legacy-sample')?.id;
    if (!projId) throw new Error('project missing');
    await api('PUT', `/workspaces/${ws}/run-configurations`, {
      version: 1,
      configurations: [
        { id: 'cfg-run-tb10', name: 'TB10 Run', type: 'tomcat6', projectId: projId, mode: 'run', suspend: false, jdkRef: 'kairo-jdk', build: { type: 'javac', clean: false }, server: { id: 't', httpPort: 18095, debugPort: 18403, contextPath: '/app' }, deploy: { mode: 'exploded', artifact: 'a.war' }, env: {}, vmOptions: [], beforeLaunchTasks: [] },
      ],
      selectedConfigurationId: 'cfg-run-tb10',
    });
    let startCalls = 0;
    await page.route('**/api/v1/servers', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      startCalls++;
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ requestId: 'tb10', ok: false, error: { code: 'internal', message: 'tb10' } }) });
    });
    await bindToolbar(page);
    const rsel10 = page.locator(RUNCFG_SEL);
    for (let i = 0; i < 20; i++) {
      const v = await rsel10.inputValue().catch(() => '');
      if (v === 'cfg-run-tb10') break;
      await page.waitForTimeout(1000);
    }
    const runBtn = page.locator(`${TOOLBAR} .kairo-toolbar-btn-run`);
    await expect(runBtn).toBeEnabled({ timeout: 25_000 });
    await runBtn.dblclick();
    await page.waitForTimeout(3500);
    expect(startCalls, `start calls=${startCalls}`).toBe(1);
    await expectNoFatal(diag);
  });

  test('TC-TB-011 toolbar labels refresh on language switch to zh-CN', async ({ page }) => {
    test.setTimeout(240_000);
    const diag = attachDiagnostics(page);
    await openIde(page);
    const tb = page.locator(TOOLBAR);
    await expect(tb).toBeVisible({ timeout: 30_000 });
    const buildBefore = ((await tb.locator('.kairo-toolbar-btn-build').textContent()) ?? '').trim();
    // Theia watches <THEIA_CONFIG_DIR>/settings.json and pushes preference
    // updates live — flip kairo.language exactly like a user editing settings.
    const cfgPath = path.join(LANE_WS, '..', 'theia-config', 'settings.json');
    const original = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(original);
    parsed['kairo.language'] = 'zh-CN';
    fs.writeFileSync(cfgPath, JSON.stringify(parsed, null, 4));
    let buildAfter = buildBefore;
    try {
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(1000);
        buildAfter = ((await tb.locator('.kairo-toolbar-btn-build').textContent().catch(() => '')) ?? '').trim();
        if (buildAfter && buildAfter !== buildBefore) break;
      }
    } finally {
      // restore language so later tests/chapters run with the default locale
      fs.writeFileSync(cfgPath, original);
    }
    expect(buildAfter, `label before="${buildBefore}" after="${buildAfter}"`).not.toBe(buildBefore);
    await expectNoFatal(diag);
  });
});
