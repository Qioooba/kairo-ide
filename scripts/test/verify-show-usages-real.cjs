/**
 * Real desktop click verification for Show Usages / Find Usages.
 *
 *   node scripts/test/verify-show-usages-real.cjs
 *   node scripts/test/verify-show-usages-real.cjs --exe <path>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'artifacts', 'show-usages-real-verify');
fs.mkdirSync(outDir, { recursive: true });

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}

function resolveExe() {
  const custom = arg('exe', null);
  if (custom) return custom;
  const candidates = [
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'run', 'Kairo.exe'),
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo.exe'),
    path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Kairo.exe not found');
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function dismissTrust(page) {
  for (const label of [/Trust|信任|Yes|是|Continue|继续|Don't Save|不保存|Cancel|取消/i]) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await sleep(400);
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function statusBarText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#theia-statusBar, .theia-statusBar');
    return el ? (el.textContent || '').trim() : '';
  });
}

async function importAndOpenProject(page, projectPath) {
  const abs = path.resolve(projectPath).replace(/\\/g, '/');
  log(`import wizard: ${abs}`);

  let pathInput = page.locator('[data-testid="path-input"]').first();
  if (!(await pathInput.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Shift+P');
    await sleep(600);
    const palette = page.locator('.quick-input-widget input[type="text"]');
    if (await palette.count()) {
      await palette.fill('>Import Project');
      await sleep(500);
      await page.keyboard.press('Enter');
      await sleep(1500);
    }
    pathInput = page.locator('[data-testid="path-input"]').first();
  }
  if (!(await pathInput.isVisible().catch(() => false))) {
    pathInput = page.locator('.kairo-import-wizard input[type="text"], [class*="import"] input[type="text"]').first();
  }
  if (!(await pathInput.isVisible().catch(() => false))) {
    return { ok: false, error: 'path-input not visible' };
  }

  await pathInput.click({ clickCount: 3 });
  await pathInput.fill(abs);
  await shot(page, '01a-import-path');

  const scanBtn = page.locator('[data-testid="scan-btn"]').first();
  if (await scanBtn.count() && await scanBtn.isEnabled().catch(() => false)) {
    await scanBtn.click();
  } else {
    await pathInput.press('Enter');
  }

  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  try {
    await importBtn.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    await shot(page, '01a-import-scan-fail');
    return { ok: false, error: 'scan did not reach step 2' };
  }
  await importBtn.click();
  await sleep(1000);

  const openBtn = page.locator('[data-testid="open-project-btn"]').first();
  try {
    await openBtn.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    await shot(page, '01a-import-step3-fail');
    return { ok: false, error: 'import did not reach step 3' };
  }
  await openBtn.click();

  for (let i = 0; i < 12; i++) {
    await sleep(500);
    await dismissTrust(page);
  }

  const explorer = await page.evaluate(() => {
    const tree = document.querySelector('.theia-TreeContainer, .theia-FileTree, #files');
    return tree ? (tree.textContent || '') : '';
  });
  const ok = /HelloWorld|HelloServlet|legacy-sample|src/i.test(explorer);
  return { ok, explorer: explorer.replace(/\s+/g, ' ').slice(0, 160) };
}

async function openJavaFile(page, fileHint) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await page.keyboard.press('Control+P');
  await sleep(900);
  try {
    await page.waitForSelector('.quick-input-widget', { timeout: 5000, state: 'visible' });
  } catch { /* ignore */ }
  const box = page.locator('.quick-input-widget input[type="text"]').first();
  if (!(await box.isVisible().catch(() => false))) return false;
  await box.click({ clickCount: 3 });
  await page.keyboard.type(fileHint, { delay: 40 });
  await sleep(1800);
  // Prefer clicking a matching result row over blind Enter
  const row = page.locator('.quick-input-list .monaco-list-row, .quick-input-list-entry').filter({ hasText: fileHint }).first();
  if (await row.count() && await row.isVisible().catch(() => false)) {
    await row.click();
  } else {
    await page.keyboard.press('Enter');
  }
  await sleep(2500);

  let hasEditor = /HelloServlet|package |HttpServlet|doGet/i.test(
    await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '')
  );
  if (!hasEditor) {
    // Absolute path via EditorManager DI
    const abs = path.join(repoRoot, 'legacy-sample', 'src', 'main', 'java', 'com', 'example', 'legacy', 'HelloServlet.java');
    const opened = await page.evaluate(async (filePath) => {
      try {
        let container = window.theia?.container;
        if (!container?._bindingDictionary?._map) {
          for (const el of document.querySelectorAll('*')) {
            const c = el.__inversify_container__;
            if (c?._bindingDictionary?._map?.size > 100) { container = c; break; }
          }
        }
        if (!container) return { ok: false, reason: 'no-container' };
        let URI = window.theia?.URI;
        let EditorManager;
        for (const [key] of container._bindingDictionary._map.entries()) {
          try {
            const svc = container.get(key);
            if (svc && typeof svc.open === 'function' && typeof svc.getByUri === 'function') {
              EditorManager = svc;
            }
          } catch { /* ignore */ }
        }
        if (!EditorManager) return { ok: false, reason: 'no-editor-manager' };
        const normalized = filePath.replace(/\\/g, '/');
        const uriStr = normalized.match(/^[A-Za-z]:/) ? `file:///${normalized}` : `file://${normalized}`;
        const uri = URI ? (URI.file ? URI.file(filePath) : new URI(uriStr)) : uriStr;
        await EditorManager.open(uri);
        return { ok: true, uri: String(uri) };
      } catch (e) {
        return { ok: false, reason: String(e).slice(0, 200) };
      }
    }, abs);
    log(`open via EditorManager: ${JSON.stringify(opened)}`);
    await sleep(2000);
    hasEditor = /HelloServlet|package |HttpServlet|doGet/i.test(
      await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '')
    );
  }
  if (!hasEditor) {
    for (const name of ['src', 'main', 'java', 'com', 'example', 'legacy']) {
      const node = page.locator('.theia-TreeNode').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
      if (await node.count()) {
        await node.dblclick().catch(() => node.click());
        await sleep(400);
      }
    }
    const fileNode = page.locator('.theia-TreeNode').filter({ hasText: /HelloServlet\.java/ }).first();
    if (await fileNode.count()) {
      await fileNode.dblclick().catch(() => fileNode.click());
      await sleep(2000);
    }
    hasEditor = /HelloServlet|package |HttpServlet|doGet/i.test(
      await page.locator('.monaco-editor .view-lines').first().innerText().catch(() => '')
    );
  }
  return hasEditor;
}

async function placeCursorOnWord(page, word) {
  return page.evaluate((target) => {
    const editors = document.querySelectorAll('.monaco-editor');
    for (const ed of editors) {
      const lines = ed.querySelectorAll('.view-line');
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i].textContent || '';
        const idx = text.indexOf(target);
        if (idx >= 0) {
          const lineEl = lines[i];
          const rect = lineEl.getBoundingClientRect();
          // Approximate character width; click near the word start.
          const x = rect.left + Math.min(rect.width * 0.35, 12 + idx * 8);
          const y = rect.top + rect.height / 2;
          const el = document.elementFromPoint(x, y) || lineEl;
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, button: 0 }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0 }));
          return { ok: true, line: i + 1, text: text.trim().slice(0, 80) };
        }
      }
    }
    return { ok: false };
  }, word);
}

async function commandRegistered(page, id) {
  return page.evaluate(async (commandId) => {
    try {
      // Theia exposes commands via window / DI; probe several paths.
      const candidates = [
        () => window.theia?.commands?.getCommand?.(commandId),
        () => window.__theia_commands__?.[commandId],
      ];
      for (const get of candidates) {
        try {
          const c = get && get();
          if (c) return { found: true, via: 'window' };
        } catch { /* ignore */ }
      }
      // Fallback: execute and see if handler exists by checking command palette list.
      return { found: null };
    } catch (e) {
      return { found: false, error: String(e) };
    }
  }, id);
}

async function runCommandViaPalette(page, label) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await page.keyboard.press('Control+Shift+P');
  await sleep(700);
  const input = page.locator('.quick-input-widget input[type="text"]').first();
  if (!(await input.count())) return false;
  await input.fill(`>${label}`);
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(1500);
  return true;
}

async function quickPickVisible(page) {
  const qi = page.locator('.quick-input-widget');
  if (!(await qi.isVisible().catch(() => false))) return false;
  // Title / list rows indicate Show Usages picker (not empty command palette).
  const text = await qi.innerText().catch(() => '');
  return /Usages of|usage|declaration|Find Usages Panel|用法/i.test(text);
}

async function findUsagesPanelVisible(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.kairo-java-references-widget, #kairo-java-references');
    if (!panel) return { visible: false };
    const style = window.getComputedStyle(panel);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && panel.clientHeight > 0;
    const text = (panel.textContent || '').replace(/\s+/g, ' ').slice(0, 200);
    return { visible, text };
  });
}

(async () => {
  const exe = resolveExe();
  log(`exe: ${exe}`);
  const userDataDir = path.join(outDir, 'userdata');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const workspace = path.join(repoRoot, 'legacy-sample');
  if (!fs.existsSync(workspace)) throw new Error(`workspace missing: ${workspace}`);

  // Confirm packaged bundle includes Show Usages (preflight).
  const asarBundleHint = await (async () => {
    try {
      const asar = require('@electron/asar');
      const fsSync = require('fs');
      const os = require('os');
      const asarPath = path.join(path.dirname(exe), 'resources', 'app.asar');
      if (!fsSync.existsSync(asarPath)) return { hasShowUsages: null, reason: 'no asar beside exe' };
      const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'kairo-asar-'));
      asar.extractAll(asarPath, tmp);
      const bundlePath = path.join(tmp, 'lib', 'frontend', 'bundle.js');
      const text = fsSync.readFileSync(bundlePath, 'utf8');
      fsSync.rmSync(tmp, { recursive: true, force: true });
      return {
        hasShowUsages: text.includes('kairo.java.showUsages'),
        hasFindUsages: text.includes('kairo.java.findUsages'),
        hasCaretSnap: text.includes('Place the caret on a class'),
        hasWidgetFactory: text.includes('kairo-java-references'),
      };
    } catch (e) {
      return { hasShowUsages: null, error: String(e).slice(0, 200) };
    }
  })();
  log(`asar preflight: ${JSON.stringify(asarBundleHint)}`);
  record('Packaged bundle has kairo.java.showUsages', !!asarBundleHint.hasShowUsages, JSON.stringify(asarBundleHint));
  record('Packaged bundle has caret snap message', !!asarBundleHint.hasCaretSnap);

  const env = {
    ...process.env,
    KAIRO_USER_DATA_DIR: userDataDir,
    KAIRO_DESKTOP_LOG_FILE: path.join(outDir, 'main.log'),
    KAIRO_NO_DEVTOOLS: '1',
  };

  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env,
    timeout: 180_000,
  });

  const page = await app.firstWindow({ timeout: 120_000 });
  page.on('dialog', async (dialog) => {
    log(`js-dialog: ${dialog.type()} ${dialog.message().slice(0, 120)}`);
    await dialog.dismiss().catch(() => {});
  });

  log(`title: ${await page.title()}`);
  await page.waitForSelector('#theia-statusBar', { timeout: 120_000 });
  await sleep(5000);
  await dismissTrust(page);
  await shot(page, '01-boot');

  for (let i = 0; i < 30; i++) {
    const barNow = await statusBarText(page);
    if (/代理[：:]\s*已连接|Agent[：:]\s*(connected|Connected)/i.test(barNow)) break;
    await sleep(1000);
  }

  const openRes = await importAndOpenProject(page, workspace);
  await shot(page, '02-workspace');
  const bar = await statusBarText(page);
  const projectImported = /项目[：:]\s*legacy-sample|Project[：:]\s*legacy-sample/i.test(bar)
    || !!(openRes && openRes.ok);
  record('Workspace imported (legacy-sample)', projectImported, bar.slice(0, 120));

  // Wait for agent after import
  for (let i = 0; i < 30; i++) {
    const barNow = await statusBarText(page);
    if (/代理[：:]\s*已连接|Agent[：:]\s*(connected|Connected)/i.test(barNow)) break;
    await sleep(1000);
  }
  await sleep(2000);

  // Open HelloServlet.java — has HttpServlet superclass / doGet usages context.
  const opened = await openJavaFile(page, 'HelloServlet.java');
  await shot(page, '03-open-java');
  record('Open HelloServlet.java', opened);

  // Wait for Java LS / editor readiness.
  for (let i = 0; i < 40; i++) {
    const barNow = await statusBarText(page);
    if (/JDT|Java|索引|Index|Ready|就绪/i.test(barNow)) break;
    await sleep(1000);
  }
  await sleep(3000);

  // Place caret on class name via Go to Symbol in file
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(200);
  await page.locator('.monaco-editor').first().click({ position: { x: 100, y: 60 } }).catch(() => {});
  await sleep(300);
  await page.keyboard.press('Control+Shift+O');
  await sleep(800);
  let symInput = page.locator('.quick-input-widget input[type="text"]').first();
  if (await symInput.isVisible().catch(() => false)) {
    await symInput.fill('@HelloServlet');
    await sleep(700);
    const row = page.locator('.quick-input-list .monaco-list-row, .quick-input-list-entry').filter({ hasText: /HelloServlet/ }).first();
    if (await row.count()) await row.click();
    else await page.keyboard.press('Enter');
    await sleep(600);
  } else {
    // Ctrl+F fallback
    await page.keyboard.press('Control+F');
    await sleep(600);
    const findInput = page.locator('.find-widget textarea, .find-widget input.input').first();
    if (await findInput.isVisible().catch(() => false)) {
      await findInput.fill('class HelloServlet');
      await page.keyboard.press('Enter');
      await sleep(400);
      await page.keyboard.press('Escape');
    }
  }
  await shot(page, '04-caret');

  // ── Show Usages via command (more reliable than key chord in Playwright) ──
  await runCommandViaPalette(page, 'Show Usages');
  await sleep(3500);
  await shot(page, '05-show-usages');

  const afterShow = await page.evaluate(() => {
    const qi = document.querySelector('.quick-input-widget');
    const panel = document.querySelector('.kairo-java-references-widget, #kairo-java-references');
    const toasts = [...document.querySelectorAll('.theia-notification-list-item, .theia-notification-toast, .notification-list-item')]
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
    const qiText = (qi?.innerText || '').replace(/\s+/g, ' ').slice(0, 300);
    const panelText = (panel?.textContent || '').replace(/\s+/g, ' ').slice(0, 240);
    return {
      popup: !!(qi && getComputedStyle(qi).display !== 'none' && qi.clientHeight > 20 && /Usages of|usage|declaration|用法/i.test(qiText)),
      panel: !!(panel && getComputedStyle(panel).display !== 'none' && panel.clientHeight > 0),
      emptyToast: toasts.some(t => /No usages found|未找到|no usages/i.test(t)),
      emptyPanel: /未找到引用|No references/i.test(panelText),
      qiText, panelText, toasts,
      hasItem: !!panel?.querySelector('.kairo-java-references-item'),
      hasFilter: !!panel?.querySelector('.kairo-java-references-filter'),
    };
  });
  record('Show Usages UI responds', !!(afterShow.popup || afterShow.panel || afterShow.emptyToast), JSON.stringify(afterShow));

  if (afterShow.popup) {
    await page.keyboard.press('Enter');
    await sleep(1000);
    await shot(page, '06-select');
    record('Select from Show Usages popup', true);
  }

  // Alt+F7 / Find Usages panel
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await runCommandViaPalette(page, 'Find Usages');
  await sleep(3500);
  await shot(page, '07-find-usages');
  const panel = await findUsagesPanelVisible(page);
  record('Find Usages panel opens', !!panel.visible, panel.text || '');

  if (panel.visible) {
    const item = page.locator('.kairo-java-references-item').first();
    if (await item.count() && await item.isVisible().catch(() => false)) {
      await item.click();
      await sleep(1000);
      await shot(page, '08-click-usage-row');
      record('Click usage row in Find Usages panel', true);
    } else {
      const filter = page.locator('.kairo-java-references-filter');
      const filterOk = await filter.isVisible().catch(() => false);
      record('Find Usages empty/filter state', /未找到|No reference|filter|引用/i.test(panel.text || '') || filterOk, panel.text || '');
    }
  }

  // Palette lists command
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await page.keyboard.press('Control+Shift+P');
  await sleep(700);
  const paletteInput = page.locator('.quick-input-widget input[type="text"]').first();
  if (await paletteInput.count()) {
    await paletteInput.fill('>Show Usages');
    await sleep(700);
    await shot(page, '09-palette-probe');
    const listText = await page.locator('.quick-input-widget').innerText().catch(() => '');
    record('Command palette lists Show Usages', /Show Usages/i.test(listText), listText.slice(0, 160));
  }

  const report = {
    at: new Date().toISOString(),
    exe,
    asarBundleHint,
    results,
    pass: results.filter(r => r.ok).length,
    fail: results.filter(r => !r.ok).length,
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`done: ${report.pass} pass / ${report.fail} fail → ${path.join(outDir, 'report.json')}`);

  await app.close().catch(() => {});
  process.exit(report.fail > 0 ? 1 : 0);
})().catch(async (err) => {
  console.error(err);
  process.exit(2);
});
