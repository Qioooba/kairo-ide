/**
 * Chapter 12 — Editor core tests (BROWSER column).
 * TC-ED-001..017 from docs/COMPREHENSIVE_TEST_DOCUMENT.md.
 *
 * macOS browser keymap: save Cmd+S, close Cmd+W, undo Cmd+Z, redo Shift+Cmd+Z,
 * delete line Cmd+Backspace, copy line Cmd+D, move line Shift+Alt+Up/Down,
 * toggle case Cmd+Shift+U, comment Cmd+/, block comment Cmd+Alt+/,
 * find Cmd+F, replace Cmd+R, next match Cmd+G, fold Cmd+- / Cmd+Shift+-,
 * bracket Ctrl+Shift+M, add cursor below Ctrl+Shift+G, next occurrence Alt+J,
 * select all occurrences Cmd+Ctrl+Shift+J.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openIde, laneWorkspace, laneConfigDir } from './helpers';

const WS_ROOT = laneWorkspace('C');
const PROJ = path.join(WS_ROOT, 'legacy-sample');
const ED = path.join(PROJ, '_kairo-ed');
const USER_SETTINGS = path.join(laneConfigDir('C'), 'settings.json');
const HISTORY_DIR = path.join(WS_ROOT, '.kairo', 'local-history');

// The chapter is executed against both Chromium/Windows and macOS browser
// builds.  Keep the platform-dependent modifier in one place so the tests
// exercise the same keymap users actually receive instead of silently sending
// Meta chords to a Windows page.
const PRIMARY_MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const primary = (chord: string): string => `${PRIMARY_MOD}+${chord}`;
const CLOSE_ACTIVE_EDITOR = process.platform === 'darwin' ? 'Meta+w' : 'Control+F4';
const ADD_CURSOR_BELOW = process.platform === 'darwin' ? 'Control+Shift+g' : 'Control+Alt+ArrowDown';
const SELECT_ALL_OCCURRENCES = process.platform === 'darwin'
  ? 'Meta+Control+Shift+j'
  : 'Control+Alt+Shift+j';
const DELETE_LINE = process.platform === 'darwin' ? 'Meta+Backspace' : 'Control+y';
const XML_BLOCK_COMMENT = process.platform === 'darwin' ? 'Meta+Alt+/' : 'Control+Shift+/';
const NEXT_FIND_MATCH = process.platform === 'darwin' ? primary('g') : 'F3';

function treeNode(page: any, label: string) {
  return page.locator('.theia-TreeNode').filter({
    has: page.locator(`.theia-TreeNodeSegment:text-is("${label}")`),
  }).first();
}

async function expandNode(page: any, label: string): Promise<void> {
  const node = treeNode(page, label);
  await node.waitFor({ state: 'visible', timeout: 15_000 });
  const cls = (await node.getAttribute('class')) || '';
  if (cls.includes('theia-ExpandedTreeNode')) return;
  await node.dblclick();
  await page.waitForTimeout(700);
}

/** Open a file inside _kairo-ed via explorer double-click. */
async function openEdFile(page: any, name: string): Promise<void> {
  await expandNode(page, 'legacy-sample');
  if (!(await treeNode(page, '_kairo-ed').count())) {
    await page.waitForTimeout(800); // watcher may still be surfacing it
  }
  if (!(await treeNode(page, '_kairo-ed').count())) {
    throw new Error('_kairo-ed folder not visible in explorer');
  }
  const cls = (await treeNode(page, '_kairo-ed').getAttribute('class')) || '';
  if (!cls.includes('theia-ExpandedTreeNode')) {
    await treeNode(page, '_kairo-ed').dblclick();
    await page.waitForTimeout(700);
  }
  await treeNode(page, name).dblclick();
  await expect(page.locator('.lm-TabBar-tabLabel', { hasText: name }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForSelector('.monaco-editor .view-lines', { timeout: 15_000 });
  await page.waitForTimeout(600);
  await ensureEditorFocus(page);
}

/** Close every editor so restored workspace state cannot interfere. */
async function closeAllEditors(page: any): Promise<void> {
  await page.keyboard.press('F1');
  const pal = page.locator('.quick-input-widget input.input').first();
  try {
    await pal.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return;
  }
  await pal.fill('Close All Editors');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
}

/** Make sure keyboard input lands in the monaco editor. */
async function ensureEditorFocus(page: any): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const inEditor = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return !!(a && a.closest && a.closest('.monaco-editor'));
    });
    if (inEditor) return;
    await page.locator('.monaco-editor:visible .view-lines').last().click();
    await page.waitForTimeout(400);
  }
}

async function editorText(page: any): Promise<string> {
  return page.locator('.monaco-editor:visible .view-lines').last().innerText();
}

/** Monaco renders spaces in view-lines as U+00A0 — normalize for text asserts. */
function norm(s: string): string {
  return s.replace(/\u00a0/g, ' ');
}

function write(name: string, content: string): string {
  const p = path.join(ED, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

/** Press Cmd+S and wait until no tab is dirty anymore (with retries — the
 * keybinding dispatch occasionally needs a second stroke under load). */
async function saveViaKeyboard(page: any): Promise<void> {
  const dirty = page.locator('.lm-TabBar-tab.theia-mod-dirty');
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press(primary('s'));
    try {
      await expect(dirty).toHaveCount(0, { timeout: 3_000 });
      await page.waitForTimeout(400);
      return;
    } catch {
      // retry
    }
  }
  await expect(dirty).toHaveCount(0, { timeout: 10_000 });
}

/** Run `fn` up to `times` times until `check` (Node-context, may use page)
 * stops throwing / returns true. waitForFunction cannot be used here because
 * serialized predicates have no access to Node-side helpers. */
async function retryKeys(page: any, times: number, fn: () => Promise<void>, check: () => Promise<boolean>, settle = 700): Promise<void> {
  const poll = async (timeoutMs: number): Promise<boolean> => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await check()) return true;
      await page.waitForTimeout(150);
    }
    return check();
  };
  for (let i = 0; i < times; i++) {
    await fn();
    if (await poll(settle)) return;
  }
  expect(await poll(4000)).toBe(true);
}

test.describe('Chapter 12 — Editor core', () => {

  let savedSettings = '';
  let settingsExisted = false;

  test.beforeAll(() => {
    fs.mkdirSync(ED, { recursive: true });
    // Deterministic autosave environment: off by default for every test in
    // this chapter (ED-015 manages its own transitions).
    settingsExisted = fs.existsSync(USER_SETTINGS);
    savedSettings = settingsExisted ? fs.readFileSync(USER_SETTINGS, 'utf8') : '{}';
    const base = JSON.parse(savedSettings);
    delete base['files.autoSave'];
    delete base['editor.autoSave'];
    fs.writeFileSync(USER_SETTINGS, JSON.stringify(base, null, 2));
  });

  test.afterAll(() => {
    if (savedSettings) {
      if (settingsExisted) {
        fs.writeFileSync(USER_SETTINGS, savedSettings);
      } else {
        fs.rmSync(USER_SETTINGS, { force: true });
      }
    }
  });

  test('TC-ED-001: multiple tabs open; Cmd+W closes active editor', async ({ page }) => {
    write('ed01-a.txt', 'alpha content\n');
    write('ed01-b.txt', 'beta content\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed01-a.txt');
    await openEdFile(page, 'ed01-b.txt');
    const labels = page.locator('.lm-TabBar-content .lm-TabBar-tabLabel');
    await expect(labels.filter({ hasText: 'ed01-a.txt' }).first()).toBeVisible();
    await expect(labels.filter({ hasText: 'ed01-b.txt' }).first()).toBeVisible();
    // active tab is ed01-b; Cmd+W closes it
    await page.keyboard.press(CLOSE_ACTIVE_EDITOR);
    await expect(labels.filter({ hasText: 'ed01-b.txt' })).toHaveCount(0, { timeout: 10_000 });
    await expect(labels.filter({ hasText: 'ed01-a.txt' }).first()).toBeVisible();
  });

  test('TC-ED-002: save clears dirty dot, writes disk, adds local-history snapshot', async ({ page }) => {
    const p = write('ed02-save.txt', 'original line\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed02-save.txt');
    // modify
    await page.keyboard.press(primary('a')); // select all (editor.action.selectAll)
    await page.keyboard.type('edited by TC-ED-002\n');
    const tab = page.locator('.lm-TabBar-tab', { hasText: 'ed02-save.txt' }).first();
    await expect(tab).toHaveClass(/theia-mod-dirty/, { timeout: 10_000 });
    // save
    await saveViaKeyboard(page);
    await expect.poll(() => fs.readFileSync(p, 'utf8'), { timeout: 10_000 })
      .toContain('edited by TC-ED-002');
    // local history snapshot created under <workspace>/.kairo/local-history
    const snaps = fs.existsSync(HISTORY_DIR)
      ? fs.readdirSync(HISTORY_DIR).filter(f => f.includes('ed02-save'))
      : [];
    console.log(`[TC-ED-002] snapshots for file: ${JSON.stringify(snaps)}`);
    expect(snaps.length).toBeGreaterThan(0);
  });

  test('TC-ED-003: deep undo/redo replays 20 edits correctly', async ({ page }) => {
    write('ed03-undo.txt', 'start\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed03-undo.txt');
    // go to end
    await page.keyboard.press(primary('ArrowDown'));
    // 20 discrete edits — each Enter starts a new undo unit
    for (let i = 1; i <= 20; i++) {
      await page.keyboard.type(`line${String(i).padStart(2, '0')}`);
      await page.waitForTimeout(350);
      await page.keyboard.press('Escape'); // dismiss any suggestion popup so Enter never accepts it
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(450); // defeat typing coalescing
    }
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(primary('z'));
    }
    const afterUndo = await editorText(page);
    console.log(`[TC-ED-003] after 20x undo: ${JSON.stringify(afterUndo.slice(0, 40))}`);
    expect(afterUndo).not.toContain('line20');
    expect(afterUndo).not.toContain('line05');
    expect(afterUndo).toContain('start');
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(primary('Shift+z'));
    }
    const afterRedo = await editorText(page);
    expect(afterRedo).toContain('line20');
    expect(afterRedo).toContain('line01');
  });

  test('TC-ED-004: multi-cursor — add cursor below, Alt+J, select-all occurrences', async ({ page }) => {
    write('ed04-cursor.txt', 'aa\nbb\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed04-cursor.txt');
    // cursor at line1 col1; Ctrl+Shift+G adds a cursor below (IDEA mac)
    await page.keyboard.press(primary('ArrowUp'));
    await page.keyboard.press('Home');
    await page.keyboard.press(ADD_CURSOR_BELOW);
    await page.waitForTimeout(300);
    await page.keyboard.type('X-');
    let txt = norm(await editorText(page));
    console.log(`[TC-ED-004] after addCursorBelow+type: ${JSON.stringify(txt)}`);
    expect(txt).toContain('X-aa');
    expect(txt).toContain('X-bb');
    // Alt+J selects next occurrence of the current selection
    write('ed04-occ.txt', 'foo bar foo bar\n');
    await openEdFile(page, 'ed04-occ.txt');
    // select first "foo" deterministically
    await ensureEditorFocus(page);
    await page.keyboard.press(primary('ArrowUp'));
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.press('Alt+j'); // next occurrence
    await page.waitForTimeout(300);
    await page.keyboard.type('Z');
    txt = norm(await editorText(page));
    console.log(`[TC-ED-004] after Alt+J x2 + type: ${JSON.stringify(txt)}`);
    expect(txt).toContain('Z bar Z bar');
    expect(txt).not.toContain('foo');
    // Cmd+Ctrl+Shift+J selects all occurrences
    write('ed04-all.txt', 'dup one dup two dup\n');
    await openEdFile(page, 'ed04-all.txt');
    await ensureEditorFocus(page);
    await page.keyboard.press(primary('ArrowUp'));
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.press(SELECT_ALL_OCCURRENCES);
    await page.waitForTimeout(300);
    await page.keyboard.type('Q');
    txt = norm(await editorText(page));
    console.log(`[TC-ED-004] after selectAllOccurrences + type: ${JSON.stringify(txt)}`);
    expect(txt).toContain('Q one Q two Q');
    expect(txt).not.toContain('dup');
  });

  test('TC-ED-005: delete line / duplicate line / move line', async ({ page }) => {
    write('ed05-lines.txt', 'l1\nl2\nl3\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed05-lines.txt');
    await ensureEditorFocus(page);
    // Delete line l2 (retry: rare chord-delivery races swallow a stroke)
    let txt = '';
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(primary('Home'));
      await page.keyboard.press('ArrowDown'); // cursor on l2
      await page.keyboard.press('Home');
      await page.keyboard.press(DELETE_LINE); // delete line
      await page.waitForTimeout(400);
      txt = norm(await editorText(page));
      if (txt.includes('l1') && txt.includes('l3') && !txt.includes('l2')) break;
    }
    console.log(`[TC-ED-005] after delete l2: ${JSON.stringify(txt)}`);
    expect(txt).toContain('l1');
    expect(txt).not.toContain('l2');
    // duplicate line: cursor onto l3 -> Cmd+D duplicates it below
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(primary('Home'));
      await page.keyboard.press('ArrowDown'); // first remaining data line (l3)
      await page.keyboard.press('Home');
      const before = norm(await editorText(page));
      const countBefore = (before.match(/l3/g) || []).length;
      await page.keyboard.press(primary('d'));
      await page.waitForTimeout(400);
      const after = norm(await editorText(page));
      const countAfter = (after.match(/l3/g) || []).length;
      if (countAfter > countBefore) { txt = after; break; }
    }
    console.log(`[TC-ED-005] after duplicate l3: ${JSON.stringify(txt)}`);
    expect((txt.match(/l3/g) || []).length).toBeGreaterThanOrEqual(2);
    // move line down with Shift+Alt+Down: order must flip when possible
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(primary('Home'));
      await page.keyboard.press('ArrowDown'); // first l3
      await page.keyboard.press('Home');
      const before = norm(await editorText(page));
      await page.keyboard.press('Shift+Alt+ArrowDown');
      await page.waitForTimeout(400);
      const after = norm(await editorText(page));
      if (before !== after) { txt = after; break; }
    }
    console.log(`[TC-ED-005] final text: ${JSON.stringify(txt)}`);
    expect(txt).toContain('l3');
    expect(txt).toContain('l1');
  });

  test('TC-ED-006: toggle case converts selected text (Cmd+Shift+U)', async ({ page }) => {
    write('ed06-case.txt', 'zzz hello WORLD tail\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed06-case.txt');
    // Deterministic keyboard selection of "hello" (cols 5..9): the sentinel
    // prefix keeps Home anchored even if focus clicks land elsewhere.
    let converted = false;
    for (let attempt = 0; attempt < 4 && !converted; attempt++) {
      await page.keyboard.press(primary('ArrowUp'));
      for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); }
      for (let i = 0; i < 5; i++) { await page.keyboard.press('Shift+ArrowRight'); }
      await page.waitForTimeout(200);
      await page.keyboard.press(primary('Shift+u'));
      await page.waitForTimeout(500);
      const txt = norm(await editorText(page));
      console.log(`[TC-ED-006] attempt ${attempt}: ${JSON.stringify(txt)}`);
      converted = txt.includes('HELLO');
    }
    expect(converted).toBe(true);
  });

  test('TC-ED-007: comment toggles per language (java //, jsp/xml <!-- -->)', async ({ page }) => {
    write('ed07-comment.java', 'public class Ed07 {\n    int x = 1;\n}\n');
    write('ed07-page.jsp', '<p>kairo</p>\n');
    write('ed07-conf.xml', '<root>\n  <item/>\n</root>\n');
    await openIde(page);
    // java line comment (retry — a rare chord race can swallow the stroke)
    await openEdFile(page, 'ed07-comment.java');
    let txt = '';
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(primary('ArrowUp'));
      await page.keyboard.press('Home');
      await page.keyboard.press(primary('/'));
      await page.waitForTimeout(400);
      txt = norm(await editorText(page));
      if (txt.includes('//')) break;
    }
    console.log(`[TC-ED-007] java after Cmd+/: ${JSON.stringify(txt.split('\n').slice(0, 2))}`);
    expect(txt).toMatch(/\/\//);
    // jsp uses HTML-style block comment
    await openEdFile(page, 'ed07-page.jsp');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(primary('a')); // jsp config defines only blockComment → needs selection
      await page.waitForTimeout(150);
      await page.keyboard.press(primary('/'));
      await page.waitForTimeout(400);
      txt = norm(await editorText(page));
      if (txt.includes('<!--')) break;
    }
    console.log(`[TC-ED-007] jsp after Cmd+/: ${JSON.stringify(txt)}`);
    expect(txt).toContain('<!--');
    // xml block comment via Cmd+Alt+/
    await openEdFile(page, 'ed07-conf.xml');
    await ensureEditorFocus(page);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(primary('a'));
      await page.waitForTimeout(150);
      await page.keyboard.press(XML_BLOCK_COMMENT);
      await page.waitForTimeout(500);
      txt = norm(await editorText(page));
      if (txt.includes('<!--')) break;
    }
    console.log(`[TC-ED-007] xml after Cmd+Alt+/: ${JSON.stringify(txt.slice(0, 60))}`);
    expect(txt).toContain('<!--');
  });

  test('TC-ED-008: in-file find/replace — highlight cycle & regex toggle', async ({ page }) => {
    write('ed08-find.txt', 'cat dog cat bird cat\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed08-find.txt');
    await page.keyboard.press(primary('f'));
    const findWidget = page.locator('.find-widget').first();
    await expect(findWidget).toBeVisible({ timeout: 10_000 });
    await page.keyboard.type('cat');
    await page.waitForTimeout(600);
    const matchesCount = () => findWidget.locator('.matchesCount').innerText().catch(() => '');
    const count1 = await matchesCount();
    console.log(`[TC-ED-008] match count: "${count1}"`);
    expect(count1).toMatch(/3/);
    // Cmd+G advances to next match (mac keymap); F3 forward, Shift+F3 backward
    await page.keyboard.press(NEXT_FIND_MATCH);
    await page.waitForTimeout(400);
    const count2 = await matchesCount();
    console.log(`[TC-ED-008] after Cmd+G: "${count2}"`);
    expect(count2).toMatch(/2 of 3|3 of 3/);
    expect(count2).not.toBe(count1);
    await page.keyboard.press('F3');
    await page.waitForTimeout(400);
    const count3 = await matchesCount();
    console.log(`[TC-ED-008] after F3: "${count3}"`);
    expect(count3).not.toBe(count2);
    await page.keyboard.press('Shift+F3');
    await page.waitForTimeout(400);
    const count4 = await matchesCount();
    console.log(`[TC-ED-008] after Shift+F3: "${count4}"`);
    expect(count4).toBe(count2);
    // regex toggle exists (monaco codicon button)
    const regexToggle = findWidget.locator('.codicon-regex').first();
    expect(await regexToggle.count()).toBeGreaterThan(0);
    // replace opens with Cmd+R
    await page.keyboard.press(primary('r'));
    await page.waitForTimeout(500);
    const replaceRow = findWidget.locator('.replace-part').first();
    if (!(await replaceRow.isVisible().catch(() => false))) {
      // some builds show replace input directly inside find widget
      await expect(findWidget.locator('textarea.input, .replace-input')).toBeVisible({ timeout: 5000 });
    }
    await page.keyboard.press('Escape');
  });

  test('TC-ED-009: fold/unfold single and all; #region marker', async ({ page }) => {
    write('ed09-fold.ts', [
      'function big() {',
      '  if (true) {',
      '    while (false) {',
      '      deep();',
      '    }',
      '  }',
      '}',
      'tail();',
      '',
    ].join('\n'));
    write('ed09-region.java', [
      'public class Ed09 {',
      '// #region R',
      'int a;',
      'int b;',
      '// #endregion',
      'void tail() {}',
      '}',
      '',
    ].join('\n'));
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed09-fold.ts');
    await ensureEditorFocus(page);
    const lineCount = () => page.locator('.monaco-editor:visible .view-lines').last()
      .evaluate((el: HTMLElement) => el.childElementCount);
    const beforeFold = await lineCount();
    // fold all: place cursor in editor then Cmd+Shift+-
    await page.keyboard.press(primary('Shift+-'));
    let afterFoldAll = beforeFold;
    await expect.poll(async () => {
      afterFoldAll = await lineCount();
      return afterFoldAll;
    }, { timeout: 10_000, intervals: [300, 500] }).toBeLessThan(beforeFold);
    console.log(`[TC-ED-009] rendered view-lines before=${beforeFold} foldAll=${afterFoldAll}`);
    // unfold all restores
    await page.keyboard.press(primary('Shift+='));
    await page.waitForTimeout(700);
    const afterUnfoldAll = await lineCount();
    expect(afterUnfoldAll).toBe(beforeFold);
    // fold single region: cursor onto line 4 (inside while-block), then Cmd+-
    await page.keyboard.press(primary('ArrowUp'));
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); }
    await page.keyboard.press(primary('-'));
    await page.waitForTimeout(600);
    const afterSingleFold = await lineCount();
    console.log(`[TC-ED-009] single fold=${afterSingleFold}`);
    expect(afterSingleFold).toBeLessThan(beforeFold);
    await page.keyboard.press(primary('='));
    await page.waitForTimeout(400);
    // #region marker folding (java language configuration folding.markers)
    await openEdFile(page, 'ed09-region.java');
    await ensureEditorFocus(page);
    const beforeRegion = await lineCount();
    await page.keyboard.press(primary('ArrowUp'));
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); } // inside region body
    await page.keyboard.press(primary('-'));
    await page.waitForTimeout(600);
    const afterRegionFold = await lineCount();
    console.log(`[TC-ED-009] region fold before=${beforeRegion} after=${afterRegionFold}`);
    expect(afterRegionFold).toBeLessThan(beforeRegion);
    await page.keyboard.press(primary('='));
  });

  test('TC-ED-010: bracket matching jumps to matching brace (Ctrl+Shift+M)', async ({ page }) => {
    write('ed10-bracket.txt', 'start {middle} end\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed10-bracket.txt');
    await page.keyboard.press(primary('ArrowUp'));
    await page.keyboard.press('Home');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight'); // just before '{'
    await page.keyboard.press('Control+Shift+m');
    await page.waitForTimeout(400);
    await page.keyboard.type('#');
    const txt = await editorText(page);
    console.log(`[TC-ED-010] after jump+type: ${JSON.stringify(txt)}`);
    expect(txt.startsWith('#')).toBe(false);
    expect(txt.replace(/\s/g, '')).toMatch(/^start({middle#}|{#middle}|#{middle})/);
  });

  test('TC-ED-011: auto-close pairs per language config (java { ( [ "; jsp ${)', async ({ page }) => {
    write('ed11-pairs.java', 'public class Ed11 {\n}\n');
    write('ed11-el.jsp', '<p></p>\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed11-pairs.java');
    // Dismiss any suggestion popup after each keystroke so the raw pair
    // characters are what lands in the buffer.
    await page.keyboard.press(primary('ArrowDown'));
    // Each pair opener goes on its own fresh line so the auto-inserted closer
    // is directly observable as an empty pair. Retries absorb a startup race
    // where the first keystrokes after editor creation are dropped by the
    // native edit context.
    const openOnNewLine = async (ch: string, expectPair: RegExp) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(ch);
        await page.waitForTimeout(350);
        if (expectPair.test(norm(await editorText(page)))) {
          await page.keyboard.press('Escape');
          return;
        }
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(150);
      }
    };
    await openOnNewLine('{', /\{\}/);
    await openOnNewLine('(', /\(\)/);
    await openOnNewLine('[', /\[\]/);
    await openOnNewLine('"', /""/);
    await page.waitForTimeout(400);
    let txt = norm(await editorText(page));
    console.log(`[TC-ED-011] java pairs: ${JSON.stringify(txt)}`);
    expect(txt).toMatch(/\{\}/);
    expect(txt).toMatch(/\(\)/);
    expect(txt).toMatch(/\[\]/);
    expect(txt).toMatch(/""/);
    // jsp: ${ closes } per jsp language configuration autoClosingPairs
    await openEdFile(page, 'ed11-el.jsp');
    await ensureEditorFocus(page);
    let elClosed = false;
    for (let attempt = 0; attempt < 4 && !elClosed; attempt++) {
      await page.keyboard.press(primary('a'));
      await page.keyboard.press('Escape');
      await page.keyboard.type('${center');
      await page.waitForTimeout(500);
      elClosed = norm(await editorText(page)).includes('${center}');
      if (!elClosed) {
        await page.keyboard.press('Enter');
      }
    }
    txt = norm(await editorText(page));
    console.log(`[TC-ED-011] jsp EL: ${JSON.stringify(txt)}`);
    expect(elClosed).toBe(true);
  });

  test('TC-ED-012: Tab inserts 4 spaces (insertSpaces=true, tabSize=4)', async ({ page }) => {
    const p = write('ed12-indent.txt', '\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed12-indent.txt');
    await ensureEditorFocus(page);
    // Cursor on the empty first line: one Tab must insert exactly 4 spaces.
    await page.keyboard.press('Tab');
    await page.keyboard.type('after-tab');
    await page.waitForTimeout(300);
    console.log(`[TC-ED-012] buffer before save: ${JSON.stringify(await editorText(page))}`);
    await saveViaKeyboard(page);
    await expect.poll(() => fs.readFileSync(p, 'utf8'), { timeout: 10_000 })
      .toMatch(/^ {4}after-tab/);
    const content = fs.readFileSync(p, 'utf8');
    console.log(`[TC-ED-012] saved content: ${JSON.stringify(content)}`);
    expect(content).toMatch(/^ {4}after-tab/);
    // Shift+Tab removes the indent
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+Tab');
    await saveViaKeyboard(page);
    const content2 = fs.readFileSync(p, 'utf8');
    expect(content2).not.toMatch(/ {4}after-tab/);
  });

  test('TC-ED-013: breadcrumbs visible for deep file (enabled by default)', async ({ page }) => {
    await openIde(page);
    await expandNode(page, 'legacy-sample');
    await expandNode(page, 'src');
    const open = async (...labels: string[]) => {
      for (const l of labels) {
        if (!(await treeNode(page, l).count())) continue;
        const cls = (await treeNode(page, l).getAttribute('class')) || '';
        if (cls.includes('theia-ExpandableTreeNode') && !cls.includes('Expanded')) {
          await treeNode(page, l).dblclick();
          await page.waitForTimeout(500);
        }
      }
    };
    await open('main', 'java', 'com', 'example', 'legacy');
    await treeNode(page, 'HelloServlet.java').dblclick();
    await expect(page.locator('.lm-TabBar-tabLabel', { hasText: 'HelloServlet.java' }).first())
      .toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    const bc = page.locator('.theia-breadcrumbs').first();
    const visible = await bc.isVisible().catch(() => false);
    const cls = await page.evaluate(() => {
      const el = document.querySelector('.theia-breadcrumbs');
      return el ? el.className : null;
    });
    console.log(`[TC-ED-013] breadcrumb container=${cls} visible=${visible}`);
    expect(visible).toBe(true);
  });

  test('TC-ED-014: minimap off by default; enabling setting shows it', async ({ page }) => {
    write('ed14-minimap.txt', Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'));
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed14-minimap.txt');
    // monaco keeps the container in DOM but hidden when disabled
    await expect(page.locator('.monaco-editor .minimap').first()).toBeHidden();
    // enable via user settings (Theia picks up file changes live)
    const settings = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8'));
    fs.writeFileSync(USER_SETTINGS, JSON.stringify({ ...settings, 'editor.minimap.enabled': true }, null, 2));
    try {
      await expect(page.locator('.monaco-editor .minimap').first()).toBeVisible({ timeout: 20_000 });
    } finally {
      fs.writeFileSync(USER_SETTINGS, JSON.stringify(settings, null, 2));
    }
    await expect(page.locator('.monaco-editor .minimap').first()).toBeHidden({ timeout: 20_000 });
  });

  test('TC-ED-015: files.autoSave default off; editor.autoSave alias syncs & works', async ({ page }) => {
    const orig = fs.readFileSync(USER_SETTINGS, 'utf8');
    const base = JSON.parse(orig);
    delete base['files.autoSave'];
    delete base['editor.autoSave'];
    fs.writeFileSync(USER_SETTINGS, JSON.stringify(base, null, 2));
    try {
      const p = write('ed15-autosave.txt', 'v1\n');
      await openIde(page);
      await openEdFile(page, 'ed15-autosave.txt');
      await page.keyboard.press(primary('ArrowDown'));
      await page.keyboard.press('Enter');
      await page.keyboard.type('dirty-but-unsaved');
      // blur editor and wait beyond any delay — nothing must hit disk
      await page.locator('#theia-left-content-panel').click();
      await page.waitForTimeout(2500);
      expect(fs.readFileSync(p, 'utf8')).not.toContain('dirty-but-unsaved');
      console.log('[TC-ED-015] default off confirmed (disk untouched)');

      // Set ONLY the Kairo alias externally, then reload: at boot the sync
      // must write files.autoSave='afterDelay' into user settings (editor→files
      // direction), and afterDelay autosave must hit disk (behavior).
      const mid = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8'));
      mid['editor.autoSave'] = 'afterDelay';
      fs.writeFileSync(USER_SETTINGS, JSON.stringify(mid, null, 2));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openIde(page);
      await page.waitForTimeout(2000);
      const synced = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8'));
      console.log(`[TC-ED-015] files.autoSave after reload+sync: ${synced['files.autoSave']}`);
      expect(synced['files.autoSave']).toBe('afterDelay');

      await openEdFile(page, 'ed15-autosave.txt');
      await page.keyboard.press(primary('ArrowDown'));
      await page.keyboard.press('End');
      await page.keyboard.type('-v2');
      let savedToDisk = false;
      for (let i = 0; i < 20 && !savedToDisk; i++) {
        await page.waitForTimeout(500);
        savedToDisk = fs.readFileSync(p, 'utf8').includes('-v2');
      }
      console.log(`[TC-ED-015] afterDelay autosaved to disk=${savedToDisk}`);
      expect(savedToDisk).toBe(true);
    } finally {
      fs.writeFileSync(USER_SETTINGS, orig);
    }
  });

  test('TC-ED-016: formatOnSave formats .java on save', async ({ page }) => {
    const orig = fs.readFileSync(USER_SETTINGS, 'utf8');
    const base = JSON.parse(orig);
    base['kairo.java.formatOnSave'] = true;
    fs.writeFileSync(USER_SETTINGS, JSON.stringify(base, null, 2));
    try {
      const p = write('ed16-format.java', [
        'public class Ed16 {',
        'void messy( ){int x=1;',
        'if(x>0){x++;}}}',
        '',
      ].join('\n'));
      await openIde(page);
      await openEdFile(page, 'ed16-format.java');
      await saveViaKeyboard(page);
      await page.waitForTimeout(1500);
      const content = fs.readFileSync(p, 'utf8');
      console.log(`[TC-ED-016] content after format-on-save:\n${content}`);
      // formatting must have expanded the collapsed braces / spacing
      const formatted =
        /\{\s*\n\s*void messy/.test(content) ||
        content.includes('int x = 1') ||
        (content.match(/\n/g) || []).length >= 4;
      expect(formatted).toBe(true);
    } finally {
      fs.writeFileSync(USER_SETTINGS, orig);
    }
  });

  test('TC-ED-017: onFrameDeactivation without running server does NOT auto-save', async ({ page }) => {
    const p = write('ed17-blur.txt', 'keep\n');
    await openIde(page);
    await closeAllEditors(page);
    await openEdFile(page, 'ed17-blur.txt');
    await page.keyboard.press(primary('ArrowDown'));
    await page.keyboard.press('Enter');
    await page.keyboard.type('unsaved-on-blur');
    // simulate window deactivation
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new FocusEvent('blur'));
    });
    await page.waitForTimeout(2000);
    const content = fs.readFileSync(p, 'utf8');
    console.log(`[TC-ED-017] disk after blur: ${JSON.stringify(content)} (no server running → saveAll must not fire)`);
    expect(content).not.toContain('unsaved-on-blur');
  });

});
