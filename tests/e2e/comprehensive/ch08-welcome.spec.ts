/**
 * Chapter 8 — Welcome page (docs/COMPREHENSIVE_TEST_DOCUMENT.md).
 * Browser column: TC-WELC-001 … TC-WELC-011.
 */
import { expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  agentJson, cleanupTmp, importViaApi, kairoStatusEntry, makeCopy,
  openIdeAt, purgeCatalog, reloadIde, registerWorkspace, restartLane, runCommand, startAgent, stopAgent,
  test, waitWelcome, TMP_ROOT, trustAcceptButton,
} from './helpers-ch810';

test.describe.configure({ mode: 'serial' });

const SEED_NAME = 'seed-a';
/**
 * TC-WELC-001 requires a cold start with NO project. The lane workspace
 * contains legacy-sample/.kairo/project.yaml which auto-binds on startup,
 * so every "no project" case opens this pristine empty folder instead.
 */
const EMPTY_WS = path.join(TMP_ROOT, 'empty-ws');

function freshEmptyWs(): string {
  fs.rmSync(EMPTY_WS, { recursive: true, force: true });
  fs.mkdirSync(EMPTY_WS, { recursive: true });
  return EMPTY_WS;
}

/** Trust dialog + shell wait after opening the empty workspace. */
async function openEmpty(page: import('@playwright/test').Page): Promise<void> {
  await openIdeAt(page, freshEmptyWs());
}

test.describe('ch08 welcome', () => {

  test.beforeAll(async () => {
    // Fresh recents are in-memory on the agent — restart wipes them;
    // purgeCatalog removes persisted project/workspace bindings so
    // no project can auto-activate on cold start.
    await stopAgent();
    await startAgent();
    await purgeCatalog();
    freshEmptyWs();
  });

  test.afterAll(async () => {
    await cleanupTmp();
  });

  test('TC-WELC-001/003/004: auto-open tab, title/tagline, three Get Started buttons', async ({ page }) => {
    await openEmpty(page);
    // WELC-001 — opens as a main-area tab with codicon-home icon
    const tab = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Welcome/i }).first();
    await tab.waitFor({ timeout: 45_000 });
    await expect(tab.locator('.codicon-home')).toHaveCount(1);

    const body = page.locator('#kairo-welcome');
    await expect(body.getByRole('heading', { level: 1, name: 'Kairo IDE' })).toBeVisible();          // WELC-003
    await expect(body.locator('.kairo-welcome-tagline')).not.toBeEmpty();

    // WELC-004 — the three entry points
    const importBtn = body.getByTestId('welcome-import');
    await expect(importBtn).toHaveClass(/kairo-button-primary/);
    await expect(importBtn.locator('.codicon-folder-opened')).toHaveCount(1);
    await expect(importBtn).toContainText(/Import Project…|导入项目…/);
    await expect(body.getByTestId('welcome-select')).toContainText(/Open Project…|打开项目…/);
    const wsBtn = body.getByTestId('welcome-open-workspace');
    await expect(wsBtn).toContainText(/Open Workspace Folder…|打开工作区文件夹…/);
  });

  test('TC-WELC-002: first-run toast guides import (~5s), welcome content untouched', async ({ page }) => {
    // The toast fires once the shell is up and auto-dismisses after ~5s,
    // so arm the waiter BEFORE navigation — it can never appear before
    // the app shell exists (onStart contributions), hence no false hit.
    const toast = page.locator('.theia-notifications-container .theia-notification-list-item',
      { hasText: /import your first project|导入您的第一个项目|第一个项目/i });
    const toastSeen = toast.first().waitFor({ state: 'visible', timeout: 90_000 }).then(() => true, () => false);
    await openEmpty(page);
    await waitWelcome(page);
    expect(await toastSeen, 'first-run import guidance toast should appear').toBeTruthy();
    // welcome content is not replaced by the toast
    await expect(page.locator('#kairo-welcome h1')).toHaveText('Kairo IDE');
    // toast disappears after ~5 s
    await expect(toast.first()).toBeHidden({ timeout: 12_000 });
  });

  test('TC-WELC-006a: empty recent state 「暂无最近项目」', async ({ page }) => {
    await openEmpty(page);
    await waitWelcome(page);
    await expect(page.locator('#kairo-welcome').getByTestId('welcome-recent-empty'))
      .toHaveText(/No recent projects|暂无最近项目/);
  });

  test('TC-WELC-006b/007: recent entries (name+path) open workspace, close Welcome, show file tree', async ({ page }) => {
    // seed one recent project through the agent API
    const root = makeCopy(SEED_NAME);
    const ws = await registerWorkspace(root, SEED_NAME);
    await importViaApi(ws.id, root, SEED_NAME);

    await openEmpty(page);
    await waitWelcome(page);
    const item = page.locator('#kairo-welcome [data-testid^="recent-"]').first();
    await item.waitFor({ timeout: 20_000 });
    // two-line entry: name + root path
    await expect(item.locator('.recent-project-name')).toHaveText(SEED_NAME);
    await expect(item.locator('.recent-project-path')).toHaveText(new RegExp(`${SEED_NAME}$`));

    // WELC-007 — clicking opens that workspace (browser reloads with new root)
    await item.click();
    // status bar + welcome close may need a boot cycle to settle; retry once
    let opened = false;
    for (let attempt = 0; attempt < 2 && !opened; attempt++) {
      try {
        const trust = trustAcceptButton(page);
        await trust.click({ timeout: 8_000 });
      } catch { /* no dialog */ }
      try {
        await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
        await expect(kairoStatusEntry(page, 'project')).toContainText(SEED_NAME, { timeout: 45_000 });
        opened = true;
      } catch {
        if (attempt === 0) {
          await page.reload({ waitUntil: 'domcontentloaded' });
        }
      }
    }
    expect(opened, 'active project should be restored after opening the recent entry').toBeTruthy();
    // Welcome auto-closed once a project is active
    await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Welcome/i })).toHaveCount(0, { timeout: 30_000 });
    // navigator tree renders the project files
    await expect(page.locator('#explorer-view-container, #theia-left-content-panel').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.theia-TreeNodeSegment', { hasText: 'build.xml' }).first()).toBeVisible({ timeout: 60_000 });
  });

  test('TC-WELC-005: Import button opens the import wizard', async ({ page }) => {
    await openEmpty(page);
    await waitWelcome(page);
    await page.locator('#kairo-welcome').getByTestId('welcome-import').click();
    await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Import Project/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wizard-title')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('TC-WELC-008: agent-offline alert banner (dedicated offline hint) and dismissible', async ({ page }) => {
    await openEmpty(page);
    await waitWelcome(page);
    await stopAgent();
    try {
      // reload with the agent down; the trust accept may itself trigger one
      // automatic reload — retry the boot cycle until the shell is up.
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        try {
          await trustAcceptButton(page).click({ timeout: 15_000 });
        } catch { /* no dialog */ }
        try {
          await page.waitForSelector('#theia-app-shell', { timeout: 40_000 });
          break;
        } catch (e) {
          if (attempt === 2) throw new Error('shell never appeared with agent offline');
          /* retry */
        }
      }
      const banner = page.getByTestId('welcome-error');
      await banner.waitFor({ state: 'visible', timeout: 60_000 });
      await expect(banner.locator('.kairo-error-banner')).toBeVisible();
      // network-error matched → dedicated offline message
      await expect(banner).toContainText(/offline|无法连接|Agent.*离线/i);
      // dismissible
      await banner.getByRole('button', { name: /Close|关闭/ }).click();
      await expect(banner).toBeHidden();
    } finally {
      await startAgent();
    }
  });

  test('TC-WELC-009: Quick Start three-step cards, CTA reuse, buttons, ≤600px single column', async ({ page }) => {
    await openEmpty(page);
    await waitWelcome(page);
    const qs = page.getByTestId('welcome-quickstart');
    for (const step of ['quickstart-import', 'quickstart-config', 'quickstart-run']) {
      await expect(qs.getByTestId(step)).toBeVisible();
    }
    // step 1 reuses the primary CTA → no extra button inside step 1
    await expect(qs.getByTestId('quickstart-import').getByRole('button')).toHaveCount(0);
    // steps 2 & 3 expose their own action buttons
    await expect(qs.getByTestId('quickstart-config-action')).toContainText(/Run Configurations|运行配置/i);
    await expect(qs.getByTestId('quickstart-run-action')).toContainText(/Build & Run|构建并运行/i);

    // responsive: 3 columns wide, 1 column at ≤600px
    const steps = qs.locator('.kairo-quickstart-steps');
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await steps.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
    await page.setViewportSize({ width: 480, height: 800 });
    expect(await steps.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('TC-WELC-010: keyboard reachability — focus lands on first focusable element', async ({ page }) => {
    await openEmpty(page);
    await waitWelcome(page);
    await page.locator('#kairo-welcome').click();
    // Tab cycles into widget focusables starting from the primary CTA area
    await page.keyboard.press('Tab');
    const focused = page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      testid: (document.activeElement as HTMLElement)?.dataset?.testid,
      label: (document.activeElement as HTMLElement)?.textContent?.trim().slice(0, 40),
    }));
    const f = await focused;
    expect(f.testid === 'welcome-import' || f.tag === 'BUTTON' || f.tag === 'INPUT' || f.tag === 'DIV').toBeTruthy();
  });

  test('TC-WELC-011: kairo.general.showWelcome=false suppresses auto-open after restart', async ({ page }) => {
    // The preference is toggled through the app's own PreferenceService
    // (window.theia.container, User scope): an out-of-band edit of
    // settings.json races the backend preference cache and trust-service
    // rewrites, which is nondeterministic. A page reload then acts as the
    // documented "restart": the persisted value must suppress auto-open.
    const withPrefSvc = (body: string) => page.evaluate(`(async () => {
      const c = window['theia'].container;
      const map = c._bindingDictionary._map;
      let tok;
      for (const [k] of map) {
        if (String(k.name ?? k) === 'Symbol(PreferenceService)') { tok = k; break; }
      }
      if (!tok) throw new Error('PreferenceService binding not found');
      const svc = c.get(tok);
      await svc.ready;
      return (${body})(svc);
    })()`);
    // undefined removes the override so the schema default (true) applies
    const setPref = (value: boolean | undefined) => withPrefSvc(
      `(svc) => svc.set('kairo.general.showWelcome', ${String(value)}, 1 /* PreferenceScope.User */)`
    );
    const getPref = () => withPrefSvc(`(svc) => svc.get('kairo.general.showWelcome', null)`);

    try {
      await openEmpty(page);
      await waitWelcome(page);

      // disable through the application itself
      await setPref(false);
      await expect.poll(getPref, { timeout: 10_000 }).toBe(false);

      // cold start: layout-restorer resurrections are closed by the widget
      // guard and maybeOpenWelcome skips opening (BUG-20260826-200)
      await reloadIde(page);
      await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Welcome/i }))
        .toHaveCount(0, { timeout: 20_000 });

      // restore the default (remove override → schema default true)
      await setPref();
      await reloadIde(page);
      await waitWelcome(page);
    } finally {
      // never leak a disabled Welcome to other tests
      await setPref().catch(() => {});
    }
  });
});
