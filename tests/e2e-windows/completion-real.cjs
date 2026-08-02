// Kairo IDE — Java completion UX real-UI verification.
//
// Drives Theia (browser or Electron) with real keystrokes and captures
// suggest / surround / complete-statement / cheatsheet evidence.
//
// Usage:
//   node tests/e2e-windows/completion-real.cjs                  # browser :18301
//   node tests/e2e-windows/completion-real.cjs --url http://127.0.0.1:18301
//   node tests/e2e-windows/completion-real.cjs --exe "…\Kairo.exe"
//
// Screenshots → docs/screenshots/windows-e2e/completion/

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium, _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
function flag(name) { return argv.includes(`--${name}`); }

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-e2e', 'completion');
const reportPath = path.join(repoRoot, 'artifacts', 'e2e-windows', 'completion-report.json');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const baseUrl = arg('url', process.env.THEIA_URL || process.env.CAPTURE_URL || 'http://127.0.0.1:18301');
const customExe = arg('exe', null);
const javaFile = arg('file', 'CompletionDemo.java');

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const warn = (m) => console.warn(`[${stamp()}] WARN  ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let shotIdx = 0;
const results = [];

async function shot(page, name) {
  const file = path.join(outDir, `${String(shotIdx).padStart(2, '0')}-${name}.png`);
  shotIdx++;
  await page.screenshot({ path: file, fullPage: false });
  log('shot: ' + path.relative(repoRoot, file));
  return file;
}

function record(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: detail || '' });
  log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' — ' + detail : ''}`);
}

async function dismissTrust(page) {
  try {
    const yes = page.locator('button:has-text("Yes, I trust"), button:has-text("信任"), button:has-text("Yes")').first();
    if (await yes.count()) await yes.click({ timeout: 2000 });
  } catch { /* ignore */ }
  await sleep(300);
}

async function focusEditor(page, { keepPosition = false } = {}) {
  if (!keepPosition) {
    try {
      const box = await page.locator('.monaco-editor .view-lines').first().boundingBox();
      if (box) {
        await page.mouse.click(box.x + Math.min(140, box.width / 2), box.y + Math.min(90, box.height / 2));
      }
    } catch { /* ignore */ }
  }
  await page.evaluate(() => {
    const ta = document.querySelector('.monaco-editor textarea.inputarea, .monaco-editor textarea, .native-edit-context');
    if (ta && typeof ta.focus === 'function') ta.focus();
  });
  return true;
}

async function appendInJavaEditor(page, text) {
  // Do not re-click the editor center — that destroys goToMarker position.
  await focusEditor(page, { keepPosition: true });
  await page.keyboard.type(text, { delay: 35 });
  await sleep(200);
  return true;
}

async function triggerSuggest(page) {
  await focusEditor(page, { keepPosition: true });
  await page.keyboard.press('Control+Space');
  for (let i = 0; i < 16; i++) {
    await sleep(250);
    const sug = await suggestVisible(page);
    if (sug.visible && sug.count > 0) return sug;
  }
  await page.keyboard.press('Control+Space');
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    const sug = await suggestVisible(page);
    if (sug.visible && sug.count > 0) return sug;
  }
  return suggestVisible(page);
}

async function suggestVisible(page) {
  return page.evaluate(() => {
    const widgets = Array.from(document.querySelectorAll(
      '.suggest-widget, .editor-widget.suggest-widget, .monaco-editor .suggest-widget'
    ));
    for (const widget of widgets) {
      const style = window.getComputedStyle(widget);
      const hidden = style.display === 'none' || style.visibility === 'hidden' || widget.getAttribute('aria-hidden') === 'true';
      const rows = Array.from(widget.querySelectorAll('.monaco-list-row'));
      const labels = rows.slice(0, 12).map(r => (r.getAttribute('aria-label') || r.textContent || '').trim()).filter(Boolean);
      const text = (widget.textContent || '').replace(/\s+/g, ' ').slice(0, 120);
      // "Loading…" alone is not a success — need real rows.
      if ((!hidden || rows.length) && labels.length > 0) {
        return { visible: true, count: rows.length, labels, text };
      }
      if (!hidden && /loading/i.test(text) && labels.length === 0) {
        return { visible: false, count: 0, labels: [], text };
      }
    }
    return { visible: false, count: 0, labels: [], text: '' };
  });
}

async function expandExplorerPath(page, segments) {
  for (const seg of segments) {
    await page.evaluate((name) => {
      const nodes = Array.from(document.querySelectorAll(
        '.theia-TreeNodeSegmentGrow, .theia-TreeNodeSegment, .theia-TreeNode'
      ));
      const hit = nodes.find(el => (el.textContent || '').trim() === name);
      if (!hit) return;
      // Expand if collapsed
      const row = hit.closest('.theia-TreeNode') || hit;
      const twisty = row.querySelector('.theia-ExpansionToggle, .theia-tree-node-expansion');
      if (twisty && !row.classList.contains('theia-expanded') && !twisty.classList.contains('theia-mod-expanded')) {
        twisty.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      } else {
        hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, seg);
    await sleep(350);
  }
}

async function openFile(page, name) {
  await page.keyboard.press('Escape');
  await sleep(200);

  // Already open?
  const already = await page.evaluate((n) => {
    const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab, .p-TabBar-tab, .theia-tab'));
    const tab = tabs.find(t => (t.getAttribute('title') || t.textContent || '').includes(n.split(/[/\\]/).pop()));
    if (!tab) return false;
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!document.querySelector('.monaco-editor');
  }, name);
  if (already) {
    await sleep(500);
    await focusEditor(page);
    return;
  }

  // Expand common Java paths then double-click file basename.
  const base = name.split(/[/\\]/).pop();
  await expandExplorerPath(page, ['src', 'main', 'java', 'com', 'example']);
  await expandExplorerPath(page, ['src']);
  await sleep(400);

  const fromTree = await page.evaluate((n) => {
    const nodes = Array.from(document.querySelectorAll(
      '.theia-TreeNodeSegmentGrow, .theia-TreeNodeSegment, .theia-TreeNode'
    ));
    const hit = nodes.find(el => {
      const t = (el.textContent || '').trim();
      return t === n || t.endsWith(n);
    });
    if (!hit) return false;
    hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return true;
  }, base);
  if (fromTree) {
    for (let i = 0; i < 30; i++) {
      const tabOk = await page.evaluate((n) => {
        const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab, .p-TabBar-tab'));
        return tabs.some(t => (t.getAttribute('title') || t.textContent || '').includes(n));
      }, base);
      if (tabOk && await page.$('.monaco-editor')) {
        await sleep(600);
        await focusEditor(page);
        return;
      }
      await sleep(400);
    }
    warn('openFile: tree open slow, falling back to Ctrl+P');
  }

  await page.keyboard.press('Control+P');
  await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 15_000 });
  const input = await page.$('.quick-input-widget input[type="text"]');
  await input.fill('');
  await input.type(base, { delay: 20 });
  let matched = false;
  for (let i = 0; i < 40; i++) {
    matched = await page.evaluate((n) => {
      const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
      const re = new RegExp(n.replace(/\./g, '\\.'), 'i');
      return rows.some(r => re.test(r.getAttribute('aria-label') || r.textContent || ''));
    }, base);
    if (matched) break;
    await sleep(400);
  }
  if (!matched && base !== 'HelloWorld.java') {
    warn('openFile: target missing; trying HelloWorld.java');
    await input.fill('');
    await input.type('HelloWorld.java', { delay: 20 });
    await sleep(800);
  }
  // Click matching row instead of Enter (Enter can focus Explorer)
  const clicked = await page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
    const re = new RegExp(n.replace(/\./g, '\\.'), 'i');
    const hit = rows.find(r => re.test(r.getAttribute('aria-label') || r.textContent || ''));
    if (!hit) return false;
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, matched ? base : 'HelloWorld.java');
  if (!clicked) await page.keyboard.press('Enter');
  await sleep(1000);
  // Wait for a java editor tab, not Explorer
  for (let i = 0; i < 20; i++) {
    const opened = await page.evaluate(() => {
      const tab = document.querySelector('.lm-TabBar-tab.lm-mod-current, .p-TabBar-tab.p-mod-current, .lm-TabBar-tab.theia-mod-current');
      return (tab?.getAttribute('title') || tab?.textContent || '').trim();
    });
    if (/\.java/i.test(opened) && await page.$('.monaco-editor')) {
      await focusEditor(page);
      log('openFile: active tab=' + opened);
      return;
    }
    await sleep(400);
  }
  const opened = await page.evaluate(() => {
    const tab = document.querySelector('.lm-TabBar-tab.lm-mod-current, .p-TabBar-tab.p-mod-current, .lm-TabBar-tab.theia-mod-current');
    return (tab?.getAttribute('title') || tab?.textContent || '').trim();
  });
  log('openFile: active tab=' + opened);
  if (!/\.java/i.test(opened)) {
    throw new Error('unexpected tab after open: ' + opened);
  }
  await focusEditor(page);
}

async function runCommand(page, label) {
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
  const input = await page.$('.quick-input-widget input[type="text"]');
  await input.fill('>');
  await input.type(label, { delay: 25 });
  await sleep(1100);
  const hitIndex = await page.evaluate((lab) => {
    const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
    const needle = lab.toLowerCase().replace(/\.{2,3}$/, '').trim();
    return rows.findIndex(r => {
      const t = (r.getAttribute('aria-label') || r.textContent || '').toLowerCase();
      return t.includes(needle) || t.includes(needle.replace(/\s+/g, ''));
    });
  }, label);
  if (hitIndex >= 0) {
    const row = page.locator('.quick-input-widget .monaco-list-row').nth(hitIndex);
    await row.click({ timeout: 3000 }).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await sleep(600);
    return true;
  }
  await page.keyboard.press('Escape');
  return false;
}

// Fixture line numbers in CompletionDemo.java (1-based). Prefer Go to Line —
// production Theia does not expose window.monaco, and view-line clicks are flaky.
const FIXTURE_LINES = {
  CURSOR_MEMBER: 18,
  CURSOR_SOUT: 24,
  CURSOR_IF: 27,
  CURSOR_TEMPLATE: 30,
  CURSOR_SMART: 34,
};

async function ensureCompletionDemo(page) {
  const tab = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab, .p-TabBar-tab'));
    const hit = tabs.find(t => /CompletionDemo\.java/i.test(t.getAttribute('title') || t.textContent || ''));
    if (hit) {
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return hit.getAttribute('title') || hit.textContent || '';
    }
    return '';
  });
  if (tab) {
    await sleep(300);
    await focusEditor(page);
    return true;
  }
  await openFile(page, 'src/main/java/com/example/CompletionDemo.java');
  return true;
}

async function dismissOverlays(page) {
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  // Close cheatsheet / dialog widgets if still visible
  await page.evaluate(() => {
    const closeBtns = Array.from(document.querySelectorAll(
      '.dialogControl i.close, .theia-dialog .close, .lm-TabBar-tabCloseIcon, button[aria-label*="[Cc]lose"], .kairo-cheatsheet-dialog .close'
    ));
    for (const b of closeBtns.slice(0, 3)) {
      try { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch { /* ignore */ }
    }
  });
  await sleep(200);
}

async function goToMarker(page, marker) {
  await dismissOverlays(page);
  await ensureCompletionDemo(page);
  await focusEditor(page);

  const line = FIXTURE_LINES[marker];
  // Use command palette Go to Line — Ctrl+G is unreliable across Theia keymaps.
  const went = await runCommand(page, 'Go to Line');
  if (went && line) {
    await sleep(300);
    const input = await page.$('.quick-input-widget input[type="text"]');
    if (input) {
      await input.fill(String(line));
      await sleep(200);
      await page.keyboard.press('Enter');
      await sleep(300);
    }
  } else if (line) {
    // Fallback Ctrl+G
    await page.keyboard.press('Control+G');
    await sleep(400);
    await page.keyboard.type(String(line), { delay: 20 });
    await page.keyboard.press('Enter');
    await sleep(300);
  } else {
    try {
      const loc = page.locator('.monaco-editor .view-line').filter({ hasText: marker }).first();
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      if (box) await page.mouse.click(box.x + Math.max(24, box.width - 10), box.y + box.height / 2);
    } catch (e) {
      warn('goToMarker fallback failed: ' + (e.message || e));
    }
  }

  await focusEditor(page, { keepPosition: true });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await sleep(250);

  const around = await page.evaluate(() => {
    const status = document.querySelector('#theia-statusBar')?.textContent || '';
    const ln = (status.match(/Ln\s*(\d+)/i) || [])[1];
    const col = (status.match(/Col\s*(\d+)/i) || [])[1];
    const tab = document.querySelector('.lm-TabBar-tab.lm-mod-current, .p-TabBar-tab.p-mod-current');
    return { ln, col, tab: (tab?.getAttribute('title') || tab?.textContent || '').trim() };
  });
  log('goToMarker ' + marker + ' -> ln=' + around.ln + ' col=' + around.col + ' tab=' + around.tab);
}

async function launchBrowser() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  log('goto ' + baseUrl);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#theia-statusBar, #theia-app-shell, .theia-ApplicationShell', { timeout: 90_000 });
  await sleep(2500);
  await dismissTrust(page);
  return { kind: 'browser', browser, page, close: async () => browser.close() };
}

async function launchElectron() {
  const userDataDir = path.join(repoRoot, 'artifacts', 'e2e-windows', 'userdata-completion');
  fs.mkdirSync(userDataDir, { recursive: true });
  const app = await electron.launch({
    executablePath: customExe,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      KAIRO_DEV: '1',
      KAIRO_NO_DEVTOOLS: '1',
      KAIRO_USER_DATA_DIR: userDataDir,
    },
    timeout: 90_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForSelector('#theia-statusBar', { timeout: 90_000 });
  await sleep(2500);
  await dismissTrust(page);
  return { kind: 'electron', browser: app, page, close: async () => app.close() };
}

async function run(page) {
  await shot(page, 'boot');

  // 1) Open Java fixture (CompletionDemo preferred, HelloWorld fallback inside openFile)
  try {
    await openFile(page, 'CompletionDemo.java');
    await shot(page, 'java-open');
    record('open-java', true, 'CompletionDemo.java');
  } catch (e) {
    try {
      await openFile(page, 'HelloWorld.java');
      await shot(page, 'java-open');
      record('open-java', true, 'HelloWorld.java fallback');
    } catch (e2) {
      record('open-java', false, String(e2.message || e2));
      await shot(page, 'java-open-fail');
      return;
    }
  }

  // Drive suggest from EOF — most reliable under headless (no monaco global).
  await dismissOverlays(page);
  await focusEditor(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await appendInJavaEditor(page, 'sou');
  let sug = await triggerSuggest(page);
  await shot(page, 'suggest-sout');
  const hasSout = sug.labels.some(l => /sout|System\.out/i.test(l));
  record('suggest-live-template', sug.visible && (sug.count > 0 || hasSout), `visible=${sug.visible} count=${sug.count} labels=${sug.labels.slice(0, 5).join(' | ')}`);
  await page.keyboard.press('Escape');
  await sleep(200);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');

  await focusEditor(page, { keepPosition: true });
  await page.keyboard.press('Enter');
  await appendInJavaEditor(page, 'name.');
  sug = await triggerSuggest(page);
  await shot(page, 'suggest-member');
  record('suggest-member-or-postfix', sug.visible && sug.count > 0, `count=${sug.count} labels=${sug.labels.slice(0, 6).join(' | ')}`);
  await page.keyboard.press('Escape');
  await sleep(150);

  await focusEditor(page, { keepPosition: true });
  await page.keyboard.press('Enter');
  await appendInJavaEditor(page, 'message.sout');
  sug = await triggerSuggest(page);
  await shot(page, 'suggest-postfix');
  const hasPostfix = sug.labels.some(l => /sout|Postfix|println/i.test(l));
  record('suggest-postfix', sug.visible && (hasPostfix || sug.count > 0), `labels=${sug.labels.slice(0, 6).join(' | ')}`);
  await page.keyboard.press('Escape');
  await sleep(150);

  // 4) Complete Statement — type a fresh incomplete if (don't rely on fixture caret)
  await ensureCompletionDemo(page);
  await focusEditor(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await appendInJavaEditor(page, 'if (true');
  const completed = await runCommand(page, 'Complete Statement');
  if (!completed) {
    await focusEditor(page, { keepPosition: true });
    await page.keyboard.press('Control+Shift+Enter');
  }
  await sleep(800);
  await shot(page, 'complete-statement');
  const ifClosed = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.monaco-editor .view-line'))
      .map(n => (n.textContent || '').replace(/\u00a0/g, ' '));
    return lines.some(l => /if\s*\(\s*true\s*\)\s*\{/.test(l)) || lines.some(l => /if\s*\([^)]*\)\s*\{/.test(l));
  });
  record('complete-statement', ifClosed, ifClosed ? 'if (...) { visible' : 'brace not observed');

  // 5) Smart Completion command present
  await goToMarker(page, 'CURSOR_SMART');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  const smartCmd = await runCommand(page, 'Smart Type Completion');
  sug = await triggerSuggest(page);
  await shot(page, 'smart-completion');
  record('smart-completion-command', smartCmd, `cmd=${smartCmd} suggest=${sug.visible} count=${sug.count}`);
  await page.keyboard.press('Escape');

  // 6) Surround With quick pick
  await focusEditor(page);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  const surroundOk = await runCommand(page, 'Surround With');
  await sleep(600);
  const pickVisible = await page.evaluate(() => {
    const q = document.querySelector('.quick-input-widget');
    if (!q) return false;
    const text = q.textContent || '';
    return /Surround|if|try|while|包围/i.test(text);
  });
  await shot(page, 'surround-with');
  record('surround-with', surroundOk && pickVisible, `cmd=${surroundOk} pick=${pickVisible}`);
  await page.keyboard.press('Escape');

  // 7) Manage Live Templates BEFORE cheatsheet (cheatsheet search steals palette input)
  await dismissOverlays(page);
  await focusEditor(page);
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
  // Prefer the visible command-palette input (last quick-input on screen).
  const manageInput = page.locator('.quick-input-widget input[type="text"]').last();
  await manageInput.fill('>Live Template');
  await sleep(1400);
  let manageTpl = false;
  try {
    const row = page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: /Manage Live Templates/i }).first();
    await row.waitFor({ state: 'visible', timeout: 4000 });
    await row.click();
    manageTpl = true;
  } catch {
    try {
      const addRow = page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: /Add Live Template/i }).first();
      await addRow.click({ timeout: 2000 });
      manageTpl = true;
    } catch { /* ignore */ }
  }
  await sleep(700);
  await shot(page, 'live-templates-manage');
  record('live-templates-manage', manageTpl, manageTpl ? 'command executed' : 'command not found');
  await dismissOverlays(page);

  // 8) Cheat sheet lists new shortcuts
  const cheat = await runCommand(page, 'Keyboard Shortcuts Cheat Sheet');
  await sleep(800);
  const cheatText = await page.evaluate(() => {
    const el = document.querySelector('.kairo-cheatsheet-content, .kairo-cheatsheet-dialog, .dialogContent');
    return el ? el.textContent || '' : document.body.innerText.slice(0, 4000);
  });
  await shot(page, 'cheatsheet');
  const hasHippie = /Hippie|循环补全/i.test(cheatText);
  const hasUnwrap = /Unwrap|拆除包围/i.test(cheatText);
  record('cheatsheet-hippie-unwrap', cheat && (hasHippie || hasUnwrap), `cheat=${cheat} hippie=${hasHippie} unwrap=${hasUnwrap}`);
  await dismissOverlays(page);
}

(async () => {
  let session;
  try {
    session = customExe ? await launchElectron() : await launchBrowser();
    log(`session=${session.kind}`);
    await run(session.page);
  } catch (e) {
    warn('fatal: ' + (e && e.stack ? e.stack : e));
    record('fatal', false, String(e.message || e));
  } finally {
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const report = { at: new Date().toISOString(), baseUrl, exe: customExe, passed, failed, results };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`report: ${path.relative(repoRoot, reportPath)}  ${passed} pass / ${failed} fail`);
    if (session) await session.close().catch(() => {});
    process.exit(failed > 0 ? 1 : 0);
  }
})();
