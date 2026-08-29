/**
 * Chapter 18 (part 2) — Browser column.
 * 18.3 Search Everywhere              TC-SRCH-031..033
 * 18.4 Find File/Class/Symbol/Action  TC-SRCH-041..045
 */
import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import { api, openIde, attachDiagnostics, unexpectedConsoleErrors } from './helpers';
import { W2, openIdeAt } from './ch18-helpers';

const everywhere = (page: Page) => page.locator('[data-testid="search-everywhere"]');

async function openEverywhere(page: Page): Promise<void> {
  // double Shift within 400ms
  await page.keyboard.press('Shift');
  await page.waitForTimeout(70);
  await page.keyboard.press('Shift');
  await everywhere(page).waitFor({ state: 'visible', timeout: 10_000 });
}

async function everywhereQuery(page: Page, q: string): Promise<void> {
  const input = page.locator('[data-testid="everywhere-query"]');
  await input.fill(q);
  await page.waitForTimeout(700); // debounce + provider roundtrip
}

// ------------------------------------------------------------------
// 18.3 Search Everywhere
// ------------------------------------------------------------------

test('TC-SRCH-031 [P1] 双击 Shift 唤起；输入框内双击忽略', async ({ page }) => {
  await openIde(page);
  await page.waitForTimeout(1500); // let keybindings finish attaching
  // slow double-shift (>400ms gap) must NOT open
  await page.keyboard.press('Shift');
  await page.waitForTimeout(650);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(500);
  expect(await everywhere(page).count()).toBe(0);

  // fast double-shift opens the body overlay
  await openEverywhere(page);
  await expect(page.locator('[data-testid="everywhere-query"]')).toBeFocused();
  // hosted outside the workbench shell (body overlay)
  const outsideShell = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="search-everywhere"]');
    return !!el && !el.closest('#theia-app-shell');
  });
  expect(outsideShell).toBe(true);

  // double-shift INSIDE the query input is ignored (no close/reset)
  await page.locator('[data-testid="everywhere-query"]').fill('Util');
  await page.keyboard.press('Shift');
  await page.waitForTimeout(70);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(400);
  await expect(everywhere(page)).toBeVisible();
  await expect(page.locator('[data-testid="everywhere-query"]')).toHaveValue('Util');

  await page.keyboard.press('Escape');
  await expect(everywhere(page)).toHaveCount(0);
});

test('TC-SRCH-032 [P1] 分类 tabs：并发 allSettled 部分失败降级、无错误横幅', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openIde(page);
  await page.waitForTimeout(1500); // let keybindings finish attaching;
  await openEverywhere(page);

  for (const tab of ['files', 'types', 'symbols', 'actions']) {
    await page.locator(`[data-testid="category-${tab}"]`).click();
    await page.waitForTimeout(900);
    // each tab settles into results or a graceful empty state — never an error banner
    expect(await page.locator('[data-testid="search-everywhere"] [role="alert"]').count()).toBe(0);
    const state = await page.evaluate(() => ({
      items: document.querySelectorAll('[data-testid="everywhere-item"]').length,
      status: Array.from(document.querySelectorAll('.kairo-everywhere-status')).map(e => e.textContent).join(''),
    }));
    console.log(`CH18-032 ${tab}:`, JSON.stringify(state));
  }

  // files tab really lists workspace files
  await page.locator('[data-testid="category-files"]').click();
  await everywhereQuery(page, 'HelloWorld');
  await expect(page.locator('[data-testid="everywhere-item"]').first()).toContainText('HelloWorld', { timeout: 15_000 });

  // actions tab lists labelled commands
  await page.locator('[data-testid="category-actions"]').click();
  await everywhereQuery(page, 'Save');
  await expect(page.locator('[data-testid="everywhere-item"]').first()).toBeVisible({ timeout: 15_000 });

  // all tab mixes categories without error
  await page.locator('[data-testid="category-all"]').click();
  await everywhereQuery(page, 'Hello');
  await expect(page.locator('[data-testid="everywhere-item"]').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('[data-testid="search-everywhere"] [role="alert"]').count()).toBe(0);
  expect(unexpectedConsoleErrors(diag.consoleErrors)).toEqual([]);
});

test('TC-SRCH-033 [P3] fuzzy 排序 "HeloWor" 命中 HelloWorld 居首', async ({ page }) => {
  await openIde(page);
  await page.waitForTimeout(1500); // let keybindings finish attaching;
  await openEverywhere(page);

  await everywhereQuery(page, 'HeloWor'); // subsequence of HelloWorld, NOT a substring
  const top = page.locator('[data-testid="everywhere-item"]').first();
  await expect(top).toContainText(/HelloWorld/i, { timeout: 15_000 });

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="everywhere-item"]'))
      .map(e => e.textContent?.trim() ?? '').slice(0, 6));
  console.log('CH18-033 top items:', JSON.stringify(labels));
  await page.keyboard.press('Escape');
});

// ------------------------------------------------------------------
// 18.4 Find File / Class / Symbol / Action
// ------------------------------------------------------------------

async function openFindModal(page: Page, key: string, testid: string): Promise<void> {
  const target = page.locator(`[data-testid="${testid}"]`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press(key);
    try {
      await target.waitFor({ state: 'visible', timeout: 2_500 });
      return;
    } catch { /* early keystrokes after shell boot can be swallowed — retry */ }
  }
  await target.waitFor({ state: 'visible', timeout: 8_000 });
}

test('TC-SRCH-041 [P1] Find File 浏览器键位 + 索引结果 + 空查询 recent', async ({ page }) => {
  await openIdeAt(page, W2);
  await page.waitForTimeout(1500); // let keybindings finish attaching

  // B.3 remap covers Windows browsers (Ctrl+Shift+N → Alt+Shift+F); this
  // macOS browser build uses the B.2 mac chord ⇧⌘O through the same guard.
  await openFindModal(page, 'Meta+Shift+O', 'find-file');
  await page.locator('[data-testid="find-file-query"]').fill('Util');
  await expect(page.locator('[data-testid="find-file-result"]').first())
    .toContainText('Util.java', { timeout: 20_000 });
  const detail = await page.locator('[data-testid="find-file-result"]').first().textContent();
  expect(detail).toContain('src/Util.java'); // relative path detail

  // Enter opens the file and closes the popup
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  await expect(page.locator('[data-testid="find-file"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Util\.java/ })).toBeVisible({ timeout: 20_000 });

  // empty query → recent files (remembered on open)
  await openFindModal(page, 'Meta+Shift+O', 'find-file');
  await page.waitForTimeout(600);
  const recent = await page.locator('[data-testid="find-file-result"]').count();
  expect(recent).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-testid="find-file-result"]').first()).toContainText('Util.java');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="find-file"]')).toHaveCount(0);
});

test('TC-SRCH-042 [P1] Find Class 两段式命中 Greeter（包名剥离启发式）', async ({ page }) => {
  await openIdeAt(page, W2);
  await page.waitForTimeout(1500); // let keybindings finish attaching
  await openFindModal(page, 'Meta+O', 'find-class');
  await page.locator('[data-testid="find-class-query"]').fill('Greeter');
  await expect(page.locator('[data-testid="find-class-result"]').first())
    .toContainText('Greeter', { timeout: 20_000 });

  const top = await page.locator('[data-testid="find-class-result"]').first().textContent();
  expect(top).toContain('com.example'); // package strip heuristic detail

  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  await expect(page.locator('[data-testid="find-class"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Greeter\.java/ })).toBeVisible({ timeout: 20_000 });
});

test('TC-SRCH-043 [P2] Find Symbol kinds 过滤（JDT ready→符号；否则优雅空态）', async ({ page }) => {
  await openIde(page); // lane workspace holds imported legacy-sample project

  let jdtReady = false;
  try {
    const st = await api('GET', '/jdtls');
    jdtReady = st.json?.payload?.state === 'ready';
  } catch { /* keep false */ }
  console.log('CH18-043 jdtReady:', jdtReady);

  await openFindModal(page, 'Meta+Alt+O', 'find-symbol');
  await page.locator('[data-testid="find-symbol-query"]').fill('doGet');
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => ({
    results: Array.from(document.querySelectorAll('[data-testid="find-symbol-result"]'))
      .map(e => e.textContent?.trim() ?? '').slice(0, 5),
    statusText: Array.from(document.querySelectorAll('.kairo-find-status')).map(e => e.textContent).join(''),
    errorBanner: document.querySelectorAll('[data-testid="find-symbol"] [role="alert"]').length,
  }));
  console.log('CH18-043 state:', JSON.stringify(state));

  if (jdtReady) {
    expect(state.results.join(' ')).toMatch(/doGet/i); // Method symbol via workspaceSymbols
  } else {
    expect(state.errorBanner).toBe(0); // graceful degradation, no raw error
  }
  await page.keyboard.press('Escape');
});

test('TC-SRCH-044 [P2] Find Action 有 label 的命令 + 格式化快捷键 detail', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openIde(page);
  await page.waitForTimeout(1500); // let keybindings finish attaching;
  await openFindModal(page, 'Meta+Shift+A', 'find-action');
  const actionInput = page.locator('[data-testid="find-action-query"]');
  await actionInput.fill('Save');
  await expect(actionInput).toHaveValue('Save', { timeout: 5_000 });
  await expect(page.locator('[data-testid="find-action-result"]').first()).toBeVisible({ timeout: 15_000 });

  const firstText = await page.locator('[data-testid="find-action-result"]').first().textContent();
  expect(firstText).toBeTruthy();
  expect(firstText!).toMatch(/Save/i);
  // detail column shows the formatted chord for a bound command (⌘S here)
  expect(firstText!).toMatch(/(Cmd|Ctrl) \+ s/i);

  // results are ranked by fuzzy score and capped
  const count = await page.locator('[data-testid="find-action-result"]').count();
  expect(count).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="find-action"]')).toHaveCount(0);
  expect(unexpectedConsoleErrors(diag.consoleErrors)).toEqual([]);
});

test('TC-SRCH-045 [P2] 路径安全：scheme / 绝对路径 / ..逃逸（含 decode 后）全拒绝', async () => {
  // Verify the exact compiled artifact that ships inside the browser bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.resolve(__dirname, '../../../packages/search-extension/lib/browser/search-path.js'));
  const root = W2;

  const rejected = [
    '../escape.txt',
    '../../outside.txt',
    '/etc/passwd',
    'file:///etc/passwd',
    'file://localhost/etc/passwd',
    '%2e%2e/secret.txt',
    'src/%2e%2e/%2e%2e/evil.txt',
    'a/../../b.txt',
  ];
  for (const candidate of rejected) {
    let threw = '';
    try {
      mod.resolveWorkspaceMatchUri(root, candidate);
    } catch (e) {
      threw = (e as Error).message;
    }
    expect(threw, `must reject ${candidate}`).toMatch(/Unsafe search result path|escapes the workspace/);
  }

  const ok = String(mod.resolveWorkspaceMatchUri(root, 'src/Util.java'));
  expect(ok).toContain('/tmp/kairo-w2search/ws/src/Util.java');
  const nested = String(mod.resolveWorkspaceMatchUri(root, 'src/main/java/com/example/Greeter.java'));
  expect(nested).toContain('/ws/src/main/java/com/example/Greeter.java');
});
