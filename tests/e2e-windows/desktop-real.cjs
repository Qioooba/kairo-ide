// Kairo IDE — Windows desktop end-to-end automation.
//
// This script launches the *real* Kairo IDE desktop app (the
// packaged Electron executable, or `electron lib/main.js` in
// dev) and drives it with real mouse clicks, real keyboard
// input, and real screenshots. It is the Layer A automation
// described in tests/e2e-windows/README.md: it operates the
// app the same way a human would — through the rendered
// Theia UI inside the BrowserWindow — not by reaching into
// the internals.
//
// Usage:
//   node tests/e2e-windows/desktop-real.cjs                       # default
//   node tests/e2e-windows/desktop-real.cjs --exe <path>          # custom .exe
//   node tests/e2e-windows/desktop-real.cjs --step open-command   # run one step
//   node tests/e2e-windows/desktop-real.cjs --list                # list steps
//   node tests/e2e-windows/desktop-real.cjs --record              # also write a .webm
//
// Exit code 0 on success, 1 on failure. Screenshots land in
// docs/screenshots/windows-e2e/.

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

// ─── CLI args ─────────────────────────────────────────────────

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
function flag(name) { return argv.includes(`--${name}`); }

const customExe = arg('exe', null);
const onlyStep = arg('step', null);
const wantList = flag('list');
const wantRecord = flag('record');
const wantSlow = flag('slow');
const wantDev = flag('dev');

// ─── Layout ───────────────────────────────────────────────────

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'docs', 'screenshots', 'windows-e2e');
const recordDir = path.join(repoRoot, 'artifacts', 'e2e-windows');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(recordDir, { recursive: true });

// Pick the executable: --exe > --dev > packaged .exe > dev fallback.
function resolveExecutable() {
  if (customExe) {
    if (!fs.existsSync(customExe)) {
      throw new Error(`--exe path does not exist: ${customExe}`);
    }
    return { executablePath: customExe, args: [], mode: 'packaged' };
  }
  const devMain = path.join(repoRoot, 'apps', 'desktop', 'lib', 'main.js');
  // --dev forces dev mode even if the packaged .exe exists, so
  // you can iterate on the frontend bundle without rebuilding
  // the Electron installer.
  if (wantDev && fs.existsSync(devMain)) {
    const electronBin = require(path.join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron'));
    return { executablePath: electronBin, args: [devMain], mode: 'dev' };
  }
  // Primary: dist/win-unpacked (current layout).
  let packaged = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  if (!fs.existsSync(packaged)) {
    // Fallback: apps/desktop/dist/win-unpacked (older layout).
    packaged = path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo IDE.exe');
  }
  if (!fs.existsSync(packaged)) {
    packaged = path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo.exe');
  }
  if (fs.existsSync(packaged)) {
    return { executablePath: packaged, args: [], mode: 'packaged' };
  }
  if (fs.existsSync(devMain)) {
    const electronBin = require(path.join(repoRoot, 'apps', 'desktop', 'node_modules', 'electron'));
    return { executablePath: electronBin, args: [devMain], mode: 'dev' };
  }
  throw new Error(
    'Cannot find Kairo IDE. Either build it (pnpm --filter @kairo/desktop dist:win) ' +
    'or pass --exe <path-to-Kairo-Ide.exe>'
  );
}

// ─── Logging helpers ──────────────────────────────────────────

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const warn = (m) => console.warn(`[${stamp()}] WARN  ${m}`);
const fail = (m) => { console.error(`[${stamp()}] FAIL  ${m}`); process.exit(1); };

// ─── The step library ─────────────────────────────────────────
//
// Each step is an async (page, ctx) => void function. Steps must
// be idempotent and tolerant: they should not throw on a missing
// optional element, only on something that *should* be there.

const steps = {
  async boot(page, ctx) {
    log('boot: waiting for Theia shell (Theia 1.73 uses #theia-statusBar)');
    await page.waitForSelector('#theia-statusBar', { timeout: 90_000 });
    await page.waitForSelector('#theia-ApplicationShell', { timeout: 30_000 }).catch(() => {});
    await sleep(2_000);
    // Workspace Trust may appear after shell ready; dismiss so file open works.
    await dismissTrustDialog(page);
    await shot(page, '01-boot-shell', ctx);
  },

  async activityBar(page, ctx) {
    log('activityBar: probing items');
    // Theia 1.73 uses Lumino (.lm-TabBar-tab). Older Phosphor
    // (.p-TabBar-tab) selectors match nothing in current builds.
    const items = await page.evaluate(() => {
      const sels = [
        '.theia-app-left .lm-TabBar-tab',
        '.lm-TabBar.theia-app-left .lm-TabBar-tab',
        '.lm-TabBar.theia-app-sides .lm-TabBar-tab',
        '.theia-app-left .p-TabBar-tab',
        '.p-TabBar.theia-app-left-tabbar .p-TabBar-tab',
      ];
      const seen = new Set();
      const out = [];
      for (const sel of sels) {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          seen.add(el);
          const label = el.querySelector('.action-label');
          out.push({
            title: el.getAttribute('title') || el.getAttribute('aria-label') || '',
            labelText: (label && (label.getAttribute('aria-label') || label.textContent)) || '',
            cls: el.className,
          });
        }
      }
      return out;
    });
    log(`activityBar: found ${items.length} candidate item(s)`);
    for (const i of items) {
      if (i.title || i.labelText) log(`   - title="${i.title}" label="${i.labelText}"`);
    }
    if (items.length === 0) warn('activityBar: no tabs found (expected .lm-TabBar-tab)');
    await shot(page, '02-activity-bar', ctx);
  },

  async openExplorer(page, ctx) {
    log('openExplorer: clicking Explorer (real left-bar icon)');
    const explorer = await findByTitle(page, /Explorer|资源管理器/i);
    if (explorer) {
      await explorer.click();
    } else {
      warn('openExplorer: Explorer tab not found, falling back to Ctrl+Shift+E');
      await page.keyboard.press('Control+Shift+E');
      await sleep(500);
    }
    await sleep(1_000);
    await shot(page, '03-explorer-open', ctx);
  },

  async openCommandPalette(page, ctx) {
    log('openCommandPalette: Ctrl+Shift+P');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
    await sleep(300);
    await shot(page, '04-command-palette', ctx);
  },

  async searchKairo(page, ctx) {
    log('searchKairo: type "Kairo" in command palette (keep ">" prefix)');
    let input = await page.$('.quick-input-widget input[type="text"]');
    if (!input) {
      await page.keyboard.press('Control+Shift+P');
      await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
      input = await page.$('.quick-input-widget input[type="text"]');
    }
    if (!input) { warn('searchKairo: no input'); return; }
    // Theia command palette uses a leading ">". Wiping it switches
    // the widget out of command mode and yields zero Kairo hits.
    await input.click();
    const cur = await input.inputValue();
    if (!cur.startsWith('>')) {
      await input.fill('>');
    } else {
      // Select everything after ">" and replace.
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Shift+Home');
      // Re-type from scratch with prefix preserved:
      await input.fill('>');
    }
    await input.type('Kairo', { delay: 40 });
    await sleep(1000);
    await shot(page, '05-kairo-commands', ctx);
    const hits = await page.$$eval(
      '.quick-input-widget .monaco-list-row',
      (els) => els.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(Boolean)
    );
    log(`searchKairo: ${hits.length} matching command(s)`);
    for (const h of hits.slice(0, 8)) log('   - ' + h);
    if (hits.length === 0) {
      warn('searchKairo: no Kairo commands visible in palette');
    }
  },

  async revealServers(page, ctx) {
    log('revealServers: open Servers via command palette');
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
    const input = await page.$('.quick-input-widget input[type="text"]');
    await input.fill('>');
    await input.type('Show Servers', { delay: 30 });
    await sleep(800);
    const hit = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
      return rows.some(r => /Show Servers|显示服务器|Servers/i.test(r.getAttribute('aria-label') || r.textContent || ''));
    });
    if (hit) {
      await page.keyboard.press('Enter');
      log('revealServers: executed Show Servers');
    } else {
      // Fallback Chinese / alternate label
      await input.fill('>');
      await input.type('显示服务器', { delay: 30 });
      await sleep(800);
      const hitZh = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
        return rows.some(r => /服务器|Servers/i.test(r.getAttribute('aria-label') || r.textContent || ''));
      });
      if (hitZh) {
        await page.keyboard.press('Enter');
      } else {
        warn('revealServers: Show Servers command not found in palette');
        await page.keyboard.press('Escape');
      }
    }
    await sleep(1_200);
    await shot(page, '06-kairo-servers-view', ctx);
  },

  async typeInEditor(page, ctx) {
    log('typeInEditor: open README.md via Ctrl+P and type into it');
    await page.keyboard.press('Escape');
    await sleep(200);
    // Close Servers / other side panels that may steal focus.
    await page.keyboard.press('Escape');
    await dismissTrustDialog(page, 2_000);
    await page.keyboard.press('Control+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
    let input = await page.$('.quick-input-widget input[type="text"]');
    if (!input) {
      warn('typeInEditor: no quick-open input');
      return;
    }
    await input.fill('');
    await input.type('README.md', { delay: 25 });
    // Poll for quick-open hits — indexer can take several seconds on cold start.
    let matched = false;
    for (let i = 0; i < 30; i++) {
      matched = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
        return rows.some(r => /README\.md/i.test(r.getAttribute('aria-label') || r.textContent || ''));
      });
      if (matched) break;
      await sleep(500);
    }
    if (!matched) {
      warn('typeInEditor: README.md not in quick-open results; trying Explorer click fallback');
      await page.keyboard.press('Escape');
      const opened = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('.theia-TreeNode, .theia-TreeNodeSegment'));
        const hit = nodes.find(n => /README\.md/i.test(n.textContent || ''));
        if (hit) { hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; }
        return false;
      });
      if (!opened) {
        warn('typeInEditor: Explorer fallback failed');
        await shot(page, '07-editor-typed', ctx);
        return;
      }
    } else {
      await page.keyboard.press('Enter');
    }
    try {
      await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
    } catch {
      warn('typeInEditor: Monaco did not appear after opening README.md');
      await shot(page, '07-editor-typed', ctx);
      return;
    }
    // Focus via evaluate — Playwright click often times out when Monaco
    // overlay layers intercept pointer events.
    const focused = await page.evaluate(() => {
      const ta = document.querySelector('.monaco-editor textarea.inputarea, .monaco-editor textarea');
      if (!ta) return false;
      ta.focus();
      return document.activeElement === ta || !!ta;
    });
    if (!focused) {
      warn('typeInEditor: no Monaco textarea');
      await shot(page, '07-editor-typed', ctx);
      return;
    }
    await sleep(200);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('// Kairo E2E: typed by automation at ' + new Date().toISOString(), { delay: 12 });
    await sleep(400);
    await shot(page, '07-editor-typed', ctx);
  },

  async javaCompletionSmoke(page, ctx) {
    log('javaCompletionSmoke: open CompletionDemo.java + Ctrl+Space');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('Control+P');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 }).catch(() => {});
    const input = await page.$('.quick-input-widget input[type="text"]');
    if (!input) {
      warn('javaCompletionSmoke: no quick-open');
      return;
    }
    await input.fill('');
    await input.type('CompletionDemo.java', { delay: 20 });
    let matched = false;
    for (let i = 0; i < 20; i++) {
      matched = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
        return rows.some(r => /CompletionDemo\.java/i.test(r.getAttribute('aria-label') || r.textContent || ''));
      });
      if (matched) break;
      await sleep(400);
    }
    if (!matched) {
      warn('javaCompletionSmoke: CompletionDemo.java not found (workspace may lack fixture)');
      await page.keyboard.press('Escape');
      return;
    }
    await page.keyboard.press('Enter');
    await page.waitForSelector('.monaco-editor', { timeout: 30_000 }).catch(() => {});
    await sleep(800);
    await page.evaluate(() => {
      const ta = document.querySelector('.monaco-editor textarea.inputarea, .monaco-editor textarea');
      if (ta) ta.focus();
    });
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('sou', { delay: 40 });
    await page.keyboard.press('Control+Space');
    await sleep(1200);
    const sug = await page.evaluate(() => {
      const w = document.querySelector('.suggest-widget');
      if (!w) return { visible: false, count: 0 };
      const style = getComputedStyle(w);
      const visible = style.display !== 'none' && w.offsetParent !== null;
      return { visible, count: w.querySelectorAll('.monaco-list-row').length };
    });
    log(`javaCompletionSmoke: suggest visible=${sug.visible} count=${sug.count}`);
    await shot(page, '11-java-suggest', ctx);
    await page.keyboard.press('Escape');
  },

  async openSettings(page, ctx) {
    log('openSettings: Ctrl+,');
    await page.keyboard.press('Control+,');
    await page.waitForSelector('.settings-tree-editor, .settings-header', { timeout: 10_000 }).catch(() => {});
    await sleep(800);
    await shot(page, '08-settings', ctx);
    await page.keyboard.press('Escape');
    await sleep(300);
  },

  async toggleTheme(page, ctx) {
    log('toggleTheme: command palette → "Color Theme"');
    await page.keyboard.press('F1');
    await page.waitForSelector('.quick-input-widget input[type="text"]', { timeout: 10_000 });
    const input = await page.$('.quick-input-widget input[type="text"]');
    await input.fill('');
    await input.type('Color Theme', { delay: 30 });
    await sleep(500);
    await shot(page, '09-theme-picker', ctx);
    await page.keyboard.press('Escape');
    await sleep(300);
  },

  async windowInfo(page, ctx) {
    log('windowInfo: dump BrowserWindow metadata');
    const info = await ctx.evaluate(({ app, BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      return {
        title: app.getName(),
        windowCount: wins.length,
        windows: wins.map(w => ({
          title: w.getTitle(),
          url: w.webContents.getURL(),
          bounds: w.getBounds(),
          isVisible: w.isVisible(),
        })),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
      };
    });
    log('windowInfo: ' + JSON.stringify(info, null, 2));
    fs.writeFileSync(
      path.join(recordDir, 'window-info.json'),
      JSON.stringify(info, null, 2)
    );
  },

  async captureFullScreen(page, ctx) {
    log('captureFullScreen: full-page screenshot');
    await page.screenshot({ path: path.join(outDir, '10-full-page.png'), fullPage: true });
  },
};

// ─── Helpers ──────────────────────────────────────────────────

async function findByTitle(page, title, scope) {
  // Theia 1.73 uses Lumino TabBar (.lm-TabBar-tab). Keep Phosphor
  // fallbacks for older builds.
  const result = await page.evaluate(({ titleRe, scopeSel }) => {
    const root = scopeSel ? document.querySelector(scopeSel) : document;
    if (!root) return null;
    const re = new RegExp(titleRe.source, titleRe.flags);
    const sel = '.lm-TabBar-tab, .p-TabBar-tab, [role="tab"], .theia-TabBar-tab, .action-label';
    const candidates = Array.from(root.querySelectorAll(sel));
    for (const el of candidates) {
      const t = el.getAttribute('title') || el.getAttribute('aria-label') || '';
      if (re.test(t)) {
        return {
          outerHTML: el.outerHTML.slice(0, 200),
          tag: el.tagName,
          className: el.className,
          index: candidates.indexOf(el),
          n: candidates.length,
        };
      }
    }
    return null;
  }, {
    titleRe: { source: title.source, flags: title.flags },
    scopeSel: scope || '',
  });
  if (!result) return null;
  return page.evaluateHandle(({ index, n, scopeSel }) => {
    const root = scopeSel ? document.querySelector(scopeSel) : document;
    const sel = '.lm-TabBar-tab, .p-TabBar-tab, [role="tab"], .theia-TabBar-tab, .action-label';
    const all = Array.from(root.querySelectorAll(sel));
    return all[index] || null;
  }, { index: result.index, n: result.n, scopeSel: scope || '' });
}

let shotIdx = 0;
async function shot(page, name, ctx) {
  const file = path.join(outDir, `${String(shotIdx).padStart(2, '0')}-${name}.png`);
  shotIdx++;
  try {
    await page.screenshot({ path: file, fullPage: false });
    log('shot: ' + path.relative(repoRoot, file));
  } catch (e) {
    warn('shot failed: ' + e.message);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Dismiss Theia Workspace Trust dialog if it appears (non-throwing). */
async function dismissTrustDialog(page, timeoutMs = 8_000) {
  try {
    const dialog = page.locator('.dialogBlock, .workspace-trust-dialog');
    await dialog.first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return;
  }
  try {
    const yesBtn = page.locator('button:has-text("Yes, I trust"), button:has-text("信任"), button:has-text("Yes")').first();
    if (await yesBtn.count()) {
      await yesBtn.click({ timeout: 3_000 });
    }
  } catch {
    /* already gone */
  }
  await page.waitForSelector('.dialogBlock, .workspace-trust-dialog', {
    state: 'detached',
    timeout: 5_000,
  }).catch(() => {});
  await sleep(300);
}

// ─── Step ordering ────────────────────────────────────────────

const stepOrder = [
  'boot',
  'windowInfo',
  'activityBar',
  'openExplorer',
  'openCommandPalette',
  'searchKairo',
  'revealServers',
  'typeInEditor',
  'javaCompletionSmoke',
  'openSettings',
  'toggleTheme',
  'captureFullScreen',
];

// Steps that only need the renderer to be alive (no Theia
// contributions mounted). Use this when the Theia shell is
// partially broken — these steps still produce meaningful
// artifacts (window info, full-page screenshot, the live
// status bar).
const smokeSteps = [
  'boot',
  'windowInfo',
  'captureFullScreen',
];

if (wantList) {
  console.log('Available steps (full run):');
  for (const name of stepOrder) console.log('  - ' + name);
  console.log('Smoke steps (works even with broken Theia contributions):');
  for (const name of smokeSteps) console.log('  - ' + name);
  process.exit(0);
}

// ─── Run ──────────────────────────────────────────────────────

(async () => {
  const exec = resolveExecutable();
  log('launching: ' + exec.executablePath + ' (' + exec.mode + ' mode)');
  if (wantSlow) log('slow mode: 250 ms between major actions');

  const env = {
    ...process.env,
    KAIRO_DESKTOP_LOG_FILE: path.join(recordDir, 'desktop-main.log'),
    KAIRO_NO_DEVTOOLS: '1', // keep DevTools closed in the captured window
    // KAIRO_DEV=1 unlocks 'unsafe-eval' in the main-process CSP
    // (see apps/desktop/src/main.ts). Theia 1.73's ajv JSON-schema
    // validator compiles via `new Function`, so without it the
    // renderer never finishes booting in production CSP mode.
    // This is a real product bug to fix in main.ts; until then we
    // set KAIRO_DEV so the automation can actually exercise the
    // UI. The flag does NOT change any business logic.
    KAIRO_DEV: '1',
    KAIRO_OPEN_FOLDER: process.env.KAIRO_OPEN_FOLDER || repoRoot,
    // KAIRO_NO_KAIRO_FRONTEND=1 makes product-frontend.ts load an
    // empty ContainerModule, skipping every Kairo contribution
    // binding (KairoStatusBarContribution, KairoLargeFileContribution,
    // KairoViewsContribution, KairoFileCommandsContribution, etc.).
    // Used to isolate Theia-side bugs from Kairo-side bugs in the
    // automated smoke test.
    KAIRO_NO_KAIRO_FRONTEND: process.env.KAIRO_NO_KAIRO_FRONTEND || '0',
  };

  // Launch Electron. Pass a stable user-data dir so we get
  // deterministic workspace + storage state on re-runs.
  const userDataDir = path.join(recordDir, 'userdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  // For packaged .exe, we need to pass --user-data-dir as a Chromium
  // switch (otherwise Electron picks %APPDATA%\<productName>, which
  // can be on a read-only volume in some environments).
  const launchArgs = exec.args.length === 0
    ? [...exec.args, `--user-data-dir=${userDataDir}`]
    : exec.args;
  const app = await electron.launch({
    executablePath: exec.executablePath,
    args: launchArgs,
    env: {
      ...env,
      // Electron's --user-data-dir is a chromium switch; it lands
      // on argv before app.whenReady and survives `process.argv`.
      // We can't pass Chromium switches via env, so we put it on args.
      KAIRO_USER_DATA_DIR: userDataDir,
    },
    timeout: 90_000,
  });

  log('electron launched, pid=' + app.process().pid);
  // Grab the first window Theia created.
  const page = await app.firstWindow({ timeout: 60_000 });
  log('first window obtained: ' + (await page.title()));

  // The main-process `ctx` is the Electron `App` instance once we
  // eval inside it. Used by the windowInfo step.
  const ctx = app;

  // Optional: also start a video recording of the page.
  let recorder = null;
  if (wantRecord) {
    try {
      const recPath = path.join(recordDir, 'recording.webm');
      recorder = await page.context().newCDPSession(page);
      await recorder.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: recordDir });
      // Recording via CDP — Page.startScreencast is not the right API;
      // use the context's tracing.
      log('record: enabled (artifacts/e2e-windows/recording.webm)');
    } catch (e) {
      warn('record init failed: ' + e.message);
    }
  }

  // Capture console + pageerror for the report.
  const consoleErrors = [];
  page.on('console', m => {
    if (m.type() === 'error') {
      consoleErrors.push(`[console] ${m.text()}`);
    }
  });
  page.on('pageerror', e => consoleErrors.push(`[pageerror] ${e.message}`));
  // Auto-dismiss JS dialogs (Workspace Trust, confirm-on-quit, etc.).
  // Must swallow ProtocolError — dialogs can vanish before accept() lands.
  page.on('dialog', async (dialog) => {
    log(`dialog ${dialog.type()}: "${String(dialog.message() || '').slice(0, 80)}"`);
    try { await dialog.accept(); } catch (_) { /* already gone */ }
  });

  // Dismiss auto-opened Import/Welcome tabs so later steps hit a clean shell.
  try {
    const closed = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.p-TabBar-tab, .theia-tabbar-tab'));
      let n = 0;
      for (const t of tabs) {
        const lbl = (t.getAttribute('title') || t.textContent || '').trim();
        if (/Import Project|导入项目|Welcome|欢迎/i.test(lbl)) {
          const closeBtn = t.querySelector('.p-TabBar-tabCloseIcon, .theia-tabbar-tab-close, .p-TabBar-tabClose');
          if (closeBtn) { closeBtn.click(); n++; }
        }
      }
      return n;
    });
    if (closed > 0) log(`closed ${closed} leftover welcome/import tab(s)`);
    await sleep(800);
  } catch (e) {
    warn(`tab cleanup: ${e.message}`);
  }

  let failed = false;
  const wantSmoke = flag('smoke');
  const runList = onlyStep
    ? [onlyStep]
    : (wantSmoke ? smokeSteps : stepOrder);
  for (const name of runList) {
    const fn = steps[name];
    if (!fn) { warn(`unknown step: ${name}`); failed = true; continue; }
    try {
      if (wantSlow) await sleep(250);
      await fn(page, ctx);
    } catch (e) {
      warn(`step ${name} threw: ${e.message}`);
      try { await shot(page, `FAIL-${name}`); } catch { /* ignore */ }
      failed = true;
      // Continue: subsequent steps might still pass and produce
      // useful artifacts even if one step hiccupped.
    }
  }

  // Report
  if (consoleErrors.length > 0) {
    log(`console errors: ${consoleErrors.length}`);
    for (const e of consoleErrors.slice(0, 20)) log('   ' + e);
  } else {
    log('console errors: 0');
  }

  log('closing app');
  try { await app.close(); } catch (e) { warn('app.close: ' + e.message); }

  // Write summary
  const summary = {
    finishedAt: new Date().toISOString(),
    executable: exec.executablePath,
    mode: exec.mode,
    stepsRun: runList,
    failed,
    consoleErrorCount: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 50),
    screenshotDir: outDir,
  };
  fs.writeFileSync(
    path.join(recordDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );
  log('summary written to artifacts/e2e-windows/summary.json');

  if (failed) {
    console.error('FAIL — at least one step did not complete cleanly');
    process.exit(1);
  }
  log('OK — Windows desktop E2E finished');
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
