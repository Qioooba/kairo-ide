/**
 * Chapter 18 — Search功能全家桶 (Browser column).
 * 18.1 Search Center  TC-SRCH-001..012
 * 18.2 Replace in Path TC-SRCH-021..025 (fixtures under /tmp/kairo-w2search — shared lane workspace untouched)
 *
 * Platform note: this campaign runs Chrome on macOS. The Kairo keymap binds
 * macOS chords (B.2): Cmd+Shift+F / Cmd+Shift+R for Find/Replace in Path,
 * Cmd+Shift+O / Cmd+O / Cmd+Alt+O / Cmd+Shift+A for Find File/Class/Symbol/Action.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openIde, attachDiagnostics, unexpectedConsoleErrors, openFileViaQuickOpen } from './helpers';

const W2 = '/tmp/kairo-w2search/ws';

const ALPHA_ORIG = 'alpha line with foo token\nfoo appears twice: foo foo\nno target on this line\n';
const BETA_ORIG = 'beta starts with foo\nplain middle line\nending foo\n';

function resetReplaceFixtures(): void {
  fs.mkdirSync(path.join(W2, 'replace'), { recursive: true });
  fs.writeFileSync(path.join(W2, 'replace', 'alpha.txt'), ALPHA_ORIG);
  fs.writeFileSync(path.join(W2, 'replace', 'beta.txt'), BETA_ORIG);
}

/** openIde pinned to an arbitrary workspace root (URL fragment binding). */
async function openIdeAt(page: Page, root: string): Promise<void> {
  await page.goto(`/#${encodeURI(root)}`, { waitUntil: 'domcontentloaded' });
  const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任|trust the authors$/i }).first();
  try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
}

const modal = (page: Page) => page.locator('[data-testid="search-center-modal"]');
const queryInput = (page: Page) => page.locator('[data-testid="search-query"]');

async function openSearchCenter(page: Page, key = 'Meta+Shift+F'): Promise<void> {
  await page.keyboard.press(key);
  await modal(page).waitFor({ state: 'visible', timeout: 10_000 });
}

async function search(page: Page, q: string): Promise<void> {
  await queryInput(page).fill(q);
  // Enter submits the form — the submit button flips label/disabled while
  // streaming, which makes click() retries unstable.
  await queryInput(page).press('Enter');
}

/** Wait until the current search reached a terminal UI state; returns which. */
async function awaitSettled(page: Page, timeout = 90_000): Promise<'results' | 'empty' | 'error' | 'cancelled'> {
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="search-cancel"]'),
    undefined,
    { timeout },
  );
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    if (document.querySelector('[data-testid="search-error"]')) return 'error';
    if (document.querySelector('[data-testid="search-cancelled"]')) return 'cancelled';
    if (document.querySelector('[data-testid="search-empty"]')) return 'empty';
    return 'results';
  });
}

interface StreamFrame { kind?: string; done?: boolean; error?: string; total?: number; batchIndex?: number; batch?: unknown[]; }

/**
 * Playwright's page-level websocket events do not surface these agent
 * sockets reliably, so wrap window.WebSocket before app code runs and
 * record /search/stream traffic directly.
 */
async function installStreamCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Orig = (window as any).WebSocket;
    const sent: string[] = [];
    const recvd: string[] = [];
    let opened = 0;
    (window as any).__kairoStreamSent = sent;
    (window as any).__kairoStreamRecvd = recvd;
    (window as any).__kairoStreamOpened = () => opened;
    function Patched(this: unknown, url: string | URL, protocols?: string | string[]) {
      const inst = new Orig(url, protocols);
      try {
        if (String(url).includes('/search/stream')) {
          opened++;
          inst.addEventListener('message', (ev: MessageEvent) => {
            if (typeof ev.data === 'string') recvd.push(ev.data);
          });
          const origSend = inst.send.bind(inst);
          inst.send = (d: unknown) => { sent.push(typeof d === 'string' ? d : String(d)); return origSend(d); };
        }
      } catch { /* instrumentation must never break the app */ }
      return inst;
    }
    Patched.prototype = Orig.prototype;
    (['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const).forEach((s, i) => {
      Object.defineProperty(Patched, s, { value: i });
    });
    (window as any).WebSocket = Patched;
  });
}

async function streamFrames(page: Page): Promise<{ sent: Array<Record<string, unknown> & { query?: string }>; recvd: Array<StreamFrame>; opened: number }> {
  return page.evaluate(() => {
    const parse = (raw: string[] | undefined): unknown[] =>
      (raw ?? []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    return {
      sent: parse((window as any).__kairoStreamSent) as Array<Record<string, unknown> & { query?: string }>,
      recvd: parse((window as any).__kairoStreamRecvd) as Array<StreamFrame>,
      opened: Number((window as any).__kairoStreamOpened?.() ?? 0),
    };
  });
}

async function resultRowCount(page: Page): Promise<number> {
  return page.locator('[data-testid="search-result"]').count();
}

/**
 * Press a key "inside" the modal: re-host focus on a passive footer element
 * first. Theia intermittently shifts focus out of the overlay after
 * navigation-key renders, so every keypress re-anchors it explicitly.
 */
async function pressInModal(page: Page, key: string): Promise<void> {
  const anchor = page.locator('[data-testid="search-count"]');
  // Re-host focus on a passive footer element; Theia intermittently shifts
  // focus out of the overlay after navigation-key renders, so verify the
  // anchor actually holds focus before pressing.
  for (let attempt = 0; attempt < 4; attempt++) {
    await anchor.focus();
    await page.waitForTimeout(70);
    const ok = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid') === 'search-count');
    if (ok) break;
  }
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
}

function resultFiles(page: Page): Promise<Array<string | undefined>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="search-group"] .kairo-search-result-filename'))
      .map(e => e.textContent?.trim()));
}

// ------------------------------------------------------------------
// 18.1 Search Center
// ------------------------------------------------------------------

test('TC-SRCH-001 [P0] Ctrl+Shift+F 打开 body overlay（SIW 键已注销）', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await openIde(page);

  // Windows-chord Ctrl+Shift+F is not bound in this macOS browser build…
  await page.keyboard.press('Control+Shift+F');
  await page.waitForTimeout(600);
  expect(await modal(page).count()).toBe(0);

  // …the platform chord (macOS Cmd+Shift=F; Win/Linux: Ctrl+Shift+F) opens the overlay.
  await page.keyboard.press('Meta+Shift+F');
  await expect(modal(page)).toBeVisible({ timeout: 10_000 });

  // backdrop hosted as a body-level overlay, outside the workbench shell DOM
  const hosting = await page.evaluate(() => {
    const bd = document.querySelector('[data-testid="search-center-backdrop"]') as HTMLElement | null;
    const widgetRoot = bd?.closest('.kairo-search-center-widget') as HTMLElement | null ?? bd;
    return {
      attached: !!bd,
      outsideShell: !!bd && !bd.closest('#theia-app-shell'),
      bodyHosted: (widgetRoot?.parentElement ?? bd?.parentElement) === document.body,
    };
  });
  expect(hosting.attached).toBe(true);
  expect(hosting.outsideShell).toBe(true);
  expect(hosting.bodyHosted).toBe(true);

  // Theia SIW owns the same chord upstream — must NOT have opened a visible SIW panel.
  const siwVisible = await page.evaluate(() => {
    const el = document.getElementById('search-in-workspace');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  });
  expect(siwVisible).toBe(false);

  // input auto-focused
  await expect(queryInput(page)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0, { timeout: 5_000 });
  expect(unexpectedConsoleErrors(diag.consoleErrors)).toEqual([]);
});

test('TC-SRCH-002 [P1] Monaco 聚焦时 capture 拦截仍打开；modal 内按键放行', async ({ page }) => {
  await openIde(page);
  await openFileViaQuickOpen(page, 'HelloWorld.java');
  await page.locator('.monaco-editor:visible .view-lines').first().click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => !!document.activeElement?.closest('.monaco-editor'))).toBe(true);

  await page.keyboard.press('Meta+Shift+F');
  await expect(modal(page)).toBeVisible({ timeout: 10_000 });

  // keys typed inside the modal must pass through untouched (no re-interception)
  await queryInput(page).fill('Hello');
  await page.keyboard.press('x');
  await expect(queryInput(page)).toHaveValue('Hellox');

  // single Escape closes exactly once
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
});

test('TC-SRCH-003 [P1] 三开关 Aa / .* / W 随请求发送并生效', async ({ page }) => {
  await installStreamCapture(page);
  await openIdeAt(page, W2);
  await openSearchCenter(page);

  const caseBtn = page.locator('[data-testid="filter-case"]');
  const regexBtn = page.locator('[data-testid="filter-regex"]');
  const wordBtn = page.locator('[data-testid="filter-word"]');

  // toggle all three — active state reflected
  await caseBtn.click();
  await regexBtn.click();
  await wordBtn.click();
  await expect(caseBtn).toHaveClass(/is-active/);
  await expect(regexBtn).toHaveClass(/is-active/);
  await expect(wordBtn).toHaveClass(/is-active/);
  await caseBtn.click(); await regexBtn.click(); await wordBtn.click(); // all off again

  // isolate the dedicated sample file
  await page.locator('[data-testid="filter-file-types"]').fill('flagsample.txt');

  // caseSensitive ON: only exact-case BetaToken matches
  await caseBtn.click();
  await search(page, 'BetaToken');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 matches');
  // caseSensitive OFF: BETATOKEN still matches (insensitive)
  await caseBtn.click();
  await search(page, 'BETATOKEN');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 matches');

  // wholeWord ON: "tok" only matches the word-bounded occurrence
  await wordBtn.click();
  await search(page, 'tok');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 matches'); // "tok end" only
  // wholeWord OFF: substring hits inside AlphaToken/BetaToken too
  await wordBtn.click();
  await search(page, 'tok');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('3 matches');

  // isRegex ON: "T.KEN" as pattern — dot is a wildcard, so it also hits Token
  await regexBtn.click();
  await search(page, 'T.KEN');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('3 matches');
  // isRegex OFF: literal text search finds exactly the "T.KEN" line
  await regexBtn.click();
  await search(page, 'T.KEN');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-count"]')).toContainText('1 matches');

  // every request carried the flags + narrowed include
  const { sent } = await streamFrames(page);
  const byQuery = new Map<string, Record<string, unknown>>();
  for (const frame of sent) {
    if (typeof frame.query === 'string') byQuery.set(frame.query, frame);
  }
  expect(byQuery.get('BetaToken')).toMatchObject({ caseSensitive: true, isRegex: false, wholeWord: false });
  expect(byQuery.get('BETATOKEN')).toMatchObject({ caseSensitive: false });
  const tokFrames = sent.filter(f => f.query === 'tok');
  expect(tokFrames.length).toBe(2);
  expect(tokFrames[0]).toMatchObject({ wholeWord: true, include: ['flagsample.txt'] });
  expect(tokFrames[1]).toMatchObject({ wholeWord: false });
  const tkenFrames = sent.filter(f => f.query === 'T.KEN');
  expect(tkenFrames.some(f => f.isRegex === true)).toBe(true);
  expect(tkenFrames.some(f => f.isRegex === false)).toBe(true);
});

test('TC-SRCH-004 [P1] 流式结果 WS search/stream 增量合并 + total/done 统计', async ({ page }) => {
  test.setTimeout(240_000);
  await installStreamCapture(page);
  await openIdeAt(page, W2);
  await openSearchCenter(page);

  // sample the live counter while streaming to observe incremental merging
  const samples: string[] = [];
  await queryInput(page).fill('e');
  void queryInput(page).press('Enter').then(() => undefined);
  const deadline = Date.now() + 120_000;
  let sawStreamingLabel = false;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      count: document.querySelector('[data-testid="search-count"]')?.textContent ?? '',
      streaming: document.querySelector('[data-testid="search-count"]')?.textContent?.includes('streaming') ?? false,
      cancelVisible: !!document.querySelector('[data-testid="search-cancel"]'),
      rows: document.querySelectorAll('[data-testid="search-result"]').length,
      empty: !!document.querySelector('[data-testid="search-empty"]'),
      error: !!document.querySelector('[data-testid="search-error"]'),
    })).catch(() => ({ count: '', streaming: false, cancelVisible: true, rows: 0, empty: false, error: false }));
    if (st.streaming && st.rows > 0) sawStreamingLabel = true;
    samples.push(`${st.streaming ? 'S' : '.'}:${st.count}:${st.rows}`);
    if ((!st.cancelVisible && st.rows > 0) || st.empty || st.error) break;
    await page.waitForTimeout(120);
  }
  console.log('CH18-004 samples(head):', JSON.stringify(samples.slice(0, 8)));

  // WS evidence: multiple ≤50-item batches merged incrementally before done
  const { recvd } = await streamFrames(page);
  const batches = recvd.filter(f => !f.done && !f.error && Array.isArray(f.batch));
  const doneEv = recvd.find(f => f.done && !f.error);
  expect(batches.length).toBeGreaterThanOrEqual(2); // >50 matches ⇒ ≥2 flushes of batchSize=50
  for (const b of batches) expect(b.batch!.length).toBeLessThanOrEqual(50);
  for (let i = 1; i < batches.length; i++) {
    expect(batches[i].batchIndex!).toBeGreaterThan(batches[i - 1].batchIndex!);
  }
  let lastTotal = 0;
  for (const b of batches) {
    expect(b.total!).toBeGreaterThanOrEqual(lastTotal);
    lastTotal = b.total!;
  }
  expect(doneEv).toBeTruthy();
  expect(sawStreamingLabel || batches.length >= 2).toBe(true);

  // final stats reflect total/done
  const finalCount = await page.locator('[data-testid="search-count"]').textContent();
  expect(finalCount).toContain(String(lastTotal));
  expect(finalCount).toMatch(/in \d+ files/);
  expect(finalCount).not.toContain('streaming');
  await expect(page.locator('[data-testid="search-error"]')).toHaveCount(0);
});

test('TC-SRCH-005 [P1] 结果分组 by-file + ←/→ 折叠展开', async ({ page }) => {
  await openIdeAt(page, W2);
  await openSearchCenter(page);
  // "foo" hits exactly two files (replace/alpha.txt ×4, replace/beta.txt ×2)
  await search(page, 'foo');
  expect(await awaitSettled(page)).toBe('results');

  const headers = page.locator('[data-testid="search-group"]');
  expect(await headers.count()).toBe(2); // grouped by file
  expect(await headers.first().textContent()).toMatch(/\d$/); // trailing per-file count badge

  const rowsBefore = await resultRowCount(page);
  expect(rowsBefore).toBe(6);

  // ← collapses the selected match's group
  await pressInModal(page, 'ArrowLeft');
  await page.waitForTimeout(300);
  expect(await resultRowCount(page)).toBeLessThan(rowsBefore);
  expect(await page.locator('[data-testid="search-group"] .codicon-chevron-right').count()).toBeGreaterThanOrEqual(1);

  // selection rests on the next group header → ← collapses it as well
  await pressInModal(page, 'ArrowLeft');
  await page.waitForTimeout(300);
  expect(await resultRowCount(page)).toBe(0);
  expect(await page.locator('[data-testid="search-group"] .codicon-chevron-right').count()).toBe(2);

  // → on a collapsed header expands it again
  await pressInModal(page, 'ArrowRight');
  await page.waitForTimeout(300);
  expect(await resultRowCount(page)).toBeGreaterThan(0);
});

test('TC-SRCH-006 [P1] ↑↓ 跳过 header；Enter/Shift+Enter/Ctrl+Enter 打开语义', async ({ page }) => {
  await openIdeAt(page, W2);
  await openSearchCenter(page);
  await search(page, 'class');
  expect(await awaitSettled(page)).toBe('results');

  const selectedIdx = async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="search-result"]'))
      .findIndex(el => el.className.includes('is-selected')));
  const i0 = await selectedIdx();
  expect(i0).toBeGreaterThanOrEqual(0);
  // ↓ must consume exactly one MATCH per effective press — group headers in
  // between are skipped without costing a keypress. Theia intermittently
  // swallows a keystroke during overlay renders, so retry non-moving presses.
  const rowsN = await resultRowCount(page);
  let cur = i0;
  let effectiveDown = 0;
  let lost = 0;
  while (cur < rowsN - 1 && lost < 8) {
    await pressInModal(page, 'ArrowDown');
    const next = await selectedIdx();
    if (next === cur) { lost++; continue; } // swallowed keypress — retry
    expect(next - cur).toBe(1); // advances exactly one match, never two
    cur = next;
    effectiveDown++;
  }
  expect(cur).toBe(rowsN - 1); // reached the very last match
  expect(effectiveDown).toBe(rowsN - 1 - i0); // zero presses spent on headers
  // ↑ walks back to the exact start
  for (let k = 0; k < effectiveDown + 4; k++) {
    await pressInModal(page, 'ArrowUp');
    if (await selectedIdx() === i0) break;
  }
  expect(await selectedIdx()).toBe(i0);

  // Enter opens and keeps dialog
  const tabsBefore = await page.evaluate(() =>
    document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tabLabel').length);
  await pressInModal(page, 'Enter');
  await page.waitForTimeout(900);
  expect(await modal(page).count()).toBe(1);
  const tabsEnter = await page.evaluate(() =>
    document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tabLabel').length);
  expect(tabsEnter).toBeGreaterThan(tabsBefore);

  // Shift+Enter opens and closes the dialog
  await pressInModal(page, 'Shift+Enter');
  await page.waitForTimeout(900);
  expect(await modal(page).count()).toBe(0);

  // Ctrl+Enter preserveFocus: editor revealed, dialog stays mounted
  await openSearchCenter(page);
  await search(page, 'class');
  expect(await awaitSettled(page)).toBe('results');
  const totalRows = await resultRowCount(page);
  for (let k = 0; k < totalRows; k++) await pressInModal(page, 'ArrowDown'); // select last match (different file)
  const tabsBeforeCtrl = await page.evaluate(() =>
    document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tabLabel').length);
  await pressInModal(page, 'Control+Enter');
  await page.waitForTimeout(1000);
  expect(await modal(page).count()).toBe(1); // dialog preserved
  const tabsAfterCtrl = await page.evaluate(() =>
    document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tabLabel').length);
  expect(tabsAfterCtrl).toBeGreaterThan(tabsBeforeCtrl); // editor was revealed
});

test('TC-SRCH-007 [P2] Esc 关闭弹层；docked Find 结果保留', async ({ page }) => {
  await openIdeAt(page, W2);
  await openSearchCenter(page);
  await search(page, 'class');
  expect(await awaitSettled(page)).toBe('results');

  // push session into the docked Find tool window
  await page.locator('[data-testid="open-find-window"]').click();
  await page.waitForTimeout(900);
  await expect(page.locator('#theia-bottom-content-panel [data-testid="search-results-panel"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="find-tool-result"]').first()).toBeVisible({ timeout: 10_000 });

  // reopen dialog — shared session model still holds the results
  await openSearchCenter(page);
  await expect(page.locator('[data-testid="search-result"]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
  // docked window keeps the results after the dialog closed
  await expect(page.locator('#theia-bottom-content-panel [data-testid="find-tool-result"]').first())
    .toBeVisible({ timeout: 10_000 });
  const stats = await page.locator('[data-testid="find-tool-count"]').textContent();
  expect(stats).toMatch(/matches in \d+ files/);
});

test('TC-SRCH-008 [P2] 文件掩码 java, !Test：include 收窄 + 排除', async ({ page }) => {
  await openIdeAt(page, W2);
  await openSearchCenter(page);

  // unmasked: readme.txt + all three .java files contain "class"
  await search(page, 'class');
  expect(await awaitSettled(page)).toBe('results');
  const unmaskedFiles = await resultFiles(page);
  expect(unmaskedFiles).toContain('readme.txt');
  expect(unmaskedFiles).toContain('TestHolder.java');

  // mask narrows include to *.java and excludes *Test*
  await page.locator('[data-testid="filter-file-types"]').fill('java, !Test');
  await search(page, 'class');
  expect(await awaitSettled(page)).toBe('results');
  const maskedFiles = await resultFiles(page);
  expect(maskedFiles).toEqual(expect.arrayContaining(['Util.java', 'Greeter.java']));
  expect(maskedFiles).not.toContain('readme.txt');       // include narrowed to *.java
  expect(maskedFiles).not.toContain('TestHolder.java');  // !Test excluded
  for (const f of maskedFiles) expect(f).toMatch(/\.java$/);
});

test('TC-SRCH-009 [P2] 范围下拉 scope 转 include 收窄', async ({ page }) => {
  await openIdeAt(page, W2);
  await openFileViaQuickOpen(page, 'Greeter.java');

  await openSearchCenter(page);
  const scope = page.locator('[data-testid="scope-selector"]');

  // Current File → include:[Greeter.java relative path]
  await scope.selectOption('current-file');
  await search(page, 'String');
  expect(await awaitSettled(page)).toBe('results');
  expect(await resultFiles(page)).toEqual(['Greeter.java']);

  // Project scope restores full breadth
  await scope.selectOption('project');
  await search(page, 'String');
  expect(await awaitSettled(page)).toBe('results');
  const filesProject = await resultFiles(page);
  expect(filesProject.length).toBeGreaterThanOrEqual(1);

  // Directory scope: confined to com/example
  await scope.selectOption('directory');
  await search(page, 'package');
  const terminal = await awaitSettled(page);
  expect(['results', 'empty']).toContain(terminal);
  const dirs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="search-group"] .kairo-search-result-filepath'))
      .map(e => e.textContent?.trim()));
  for (const dir of dirs) expect(dir!.endsWith('com/example')).toBe(true);
});

test('TC-SRCH-010 [P3] Advanced exclude 行 exclude globs 生效', async ({ page }) => {
  await openIdeAt(page, W2);
  await openSearchCenter(page);
  await page.locator('[data-testid="toggle-advanced"]').click();
  const excludeInput = page.locator('[data-testid="filter-exclude"]');
  await expect(excludeInput).toBeVisible();

  await excludeInput.fill('**/*.java');
  await search(page, 'class');
  expect(await awaitSettled(page)).toBe('results');
  const files = await resultFiles(page);
  for (const f of files) expect(f).not.toMatch(/\.java$/);
  expect(files).toContain('readme.txt');
});

test('TC-SRCH-011 [P3] history 上限 50 去重（pinned 模型上限 10）', async ({ page }) => {
  await openIdeAt(page, W2);
  await openSearchCenter(page);

  await search(page, 'zebra');
  expect(await awaitSettled(page)).toBe('results');
  await search(page, 'token');
  expect(await awaitSettled(page)).toBe('results');
  await search(page, 'zebra'); // duplicate — dedupe keeps one entry
  expect(await awaitSettled(page)).toBe('results');

  let history = await page.evaluate(() => JSON.parse(localStorage.getItem('kairo-search-history') ?? '[]'));
  expect(history.length).toBe(2);
  expect(history[0].query).toBe('zebra');

  // seed 55 entries then search once → capped at 50, newest first
  await page.evaluate(() => {
    const seeded = Array.from({ length: 55 }, (_, i) => ({
      query: `seed-${i}`, isRegex: false, caseSensitive: false, wholeWord: false, scope: 'project', timestamp: i,
    }));
    localStorage.setItem('kairo-search-history', JSON.stringify(seeded.reverse()));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任|trust the authors$/i }).first();
  try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
  await openSearchCenter(page);
  await search(page, 'brand-new-query');
  expect(await awaitSettled(page)).toBe('empty');

  history = await page.evaluate(() => JSON.parse(localStorage.getItem('kairo-search-history') ?? '[]'));
  expect(history.length).toBeLessThanOrEqual(50);
  expect(history[0].query).toBe('brand-new-query');
  // NOTE: pinned 上限 10 由 SearchScopeModel.pinQuery 实现（无 UI 入口），模型级单测覆盖。
});

test('TC-SRCH-012 [P1] 取消语义：CancelledError 不当错误展示 + stale 保护', async ({ page }) => {
  const diag = attachDiagnostics(page);
  await installStreamCapture(page);
  await openIdeAt(page, W2);
  await openSearchCenter(page);

  // start a long streaming search then cancel mid-flight
  await search(page, 'e');
  const cancelBtn = page.locator('[data-testid="search-cancel"]');
  await cancelBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400); // let some batches stream first
  await cancelBtn.dispatchEvent('click'); // overlays intercept real hit-testing
  expect(await awaitSettled(page)).toBe('cancelled');
  await expect(page.locator('[data-testid="search-error"]')).toHaveCount(0); // cancelled ≠ error

  // immediate new search works (stale stream cannot poison it)
  await search(page, 'greet');
  expect(await awaitSettled(page)).toBe('results');
  expect(await resultFiles(page)).toEqual(['Greeter.java']);

  // each search opened its own /search/stream connection (old one aborted)
  const { opened } = await streamFrames(page);
  expect(opened).toBeGreaterThanOrEqual(2);

  // rapid resubmit after cancel: final state belongs to the newest query only
  await search(page, 'token');
  expect(await awaitSettled(page)).toBe('results');
  await expect(page.locator('[data-testid="search-error"]')).toHaveCount(0);
  expect(unexpectedConsoleErrors(diag.consoleErrors)).toEqual([]);
});

// ------------------------------------------------------------------
// 18.2 Replace in Path — isolated fixtures under /tmp/kairo-w2search
// ------------------------------------------------------------------

async function openReplaceMode(page: Page): Promise<void> {
  await page.keyboard.press('Meta+Shift+R');
  await modal(page).waitFor({ state: 'visible', timeout: 10_000 });
  const replaceText = page.locator('[data-testid="replace-text"]');
  if (!(await replaceText.isVisible())) {
    await page.locator('.kairo-search-tab', { hasText: 'Replace' }).click();
  }
  await expect(replaceText).toBeVisible();
}

async function runFindForReplace(page: Page, q: string): Promise<void> {
  await queryInput(page).fill(q);
  await page.locator('[data-testid="search-submit"]').click();
  expect(await awaitSettled(page)).toBe('results');
}

const replaceAllBtn = (page: Page) => page.locator('.kairo-search-replace-btn', { hasText: 'Replace all' });
const undoBtn = (page: Page) => page.locator('.kairo-search-replace-btn.secondary', { hasText: 'Undo' });

test('TC-SRCH-021 [P1] 替换预览列即时生成，replacement 展示', async ({ page }) => {
  resetReplaceFixtures();
  await openIdeAt(page, W2);
  await openReplaceMode(page);
  await runFindForReplace(page, 'foo');

  const rows = page.locator('[data-testid="search-result"]');
  expect(await rows.count()).toBeGreaterThanOrEqual(4);

  // typing the replacement builds the plan immediately (Replace All appears)
  await page.locator('[data-testid="replace-text"]').fill('bar');
  await replaceAllBtn(page).waitFor({ state: 'visible', timeout: 10_000 });

  // replacement preview rendered inline on match rows (post-image column)
  await expect(rows.first().locator('.kairo-search-replacement')).toHaveText('bar', { timeout: 10_000 });
});

test('TC-SRCH-022 [P0] Replace All 两阶段事务落盘', async ({ page }) => {
  resetReplaceFixtures();
  await openIdeAt(page, W2);
  await openReplaceMode(page);
  await runFindForReplace(page, 'foo');
  await page.locator('[data-testid="replace-text"]').fill('bar');
  await replaceAllBtn(page).click();

  await expect(undoBtn(page)).toBeVisible({ timeout: 15_000 }); // applied & no failed ⇒ undoable
  expect(fs.readFileSync(path.join(W2, 'replace', 'alpha.txt'), 'utf8'))
    .toBe('alpha line with bar token\nbar appears twice: bar bar\nno target on this line\n');
  expect(fs.readFileSync(path.join(W2, 'replace', 'beta.txt'), 'utf8'))
    .toBe('beta starts with bar\nplain middle line\nending bar\n');
});

test('TC-SRCH-023 [P0] Undo 先验 post-image 再逆序回写 original', async ({ page }) => {
  resetReplaceFixtures();
  await openIdeAt(page, W2);
  await openReplaceMode(page);
  await runFindForReplace(page, 'foo');
  await page.locator('[data-testid="replace-text"]').fill('REPL');
  await replaceAllBtn(page).click();
  await expect(undoBtn(page)).toBeVisible({ timeout: 15_000 });
  await undoBtn(page).click();

  // Undo button disappears once fully undone
  await expect(undoBtn(page)).toHaveCount(0, { timeout: 15_000 });
  // originals restored byte-for-byte
  expect(fs.readFileSync(path.join(W2, 'replace', 'alpha.txt'), 'utf8')).toBe(ALPHA_ORIG);
  expect(fs.readFileSync(path.join(W2, 'replace', 'beta.txt'), 'utf8')).toBe(BETA_ORIG);
});

test('TC-SRCH-024 [P1] 二进制/超大文件替换被拒绝', async ({ page }) => {
  resetReplaceFixtures();
  const hugePath = path.join(W2, 'replace', 'huge.txt');
  expect(fs.statSync(hugePath).size).toBeGreaterThan(5 * 1024 * 1024);
  const hugeBefore = fs.readFileSync(hugePath);

  await openIdeAt(page, W2);
  await openReplaceMode(page);
  // zebra occurs exactly twice, both inside huge.txt
  await runFindForReplace(page, 'zebra');
  await page.locator('[data-testid="replace-text"]').fill('horse');
  await page.waitForTimeout(2500); // allow createPlan to attempt + fail on the 5MB read limit

  // plan creation refused the oversized file ⇒ no Replace All offer, zero writes
  await expect(replaceAllBtn(page)).toHaveCount(0);
  expect(fs.readFileSync(hugePath).equals(hugeBefore)).toBe(true);
  await expect(page.locator('[data-testid="search-error"]')).toHaveCount(0); // silent refusal, no crash
});

test('TC-SRCH-025 [P1] 替换前内容漂移：preflight 拒绝零写入', async ({ page }) => {
  resetReplaceFixtures();
  await openIdeAt(page, W2);
  await openReplaceMode(page);
  await runFindForReplace(page, 'foo');
  await page.locator('[data-testid="replace-text"]').fill('bar');
  await replaceAllBtn(page).waitFor({ state: 'visible', timeout: 10_000 });

  // manual external edit AFTER the plan was built → fingerprint drift
  fs.appendFileSync(path.join(W2, 'replace', 'beta.txt'), 'manual drift line\n');
  await replaceAllBtn(page).click();
  await page.waitForTimeout(1500);

  // zero-write: alpha untouched; beta only carries our manual line
  expect(fs.readFileSync(path.join(W2, 'replace', 'alpha.txt'), 'utf8')).toBe(ALPHA_ORIG);
  expect(fs.readFileSync(path.join(W2, 'replace', 'beta.txt'), 'utf8'))
    .toBe(BETA_ORIG + 'manual drift line\n');
  // failed transaction must not become undoable
  await expect(undoBtn(page)).toHaveCount(0);
  // failure surfaced to the user instead of silently swallowed
  await expect(page.locator('[data-testid="search-error"]')).toBeVisible();
});
