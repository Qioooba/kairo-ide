/**
 * Real desktop verification for Kairo Find in Path / Replace / Find tool window.
 * Launches the packaged Electron app and drives it like a human.
 *
 *   node scripts/test/verify-search-real.cjs
 *   node scripts/test/verify-search-real.cjs --exe <path>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'artifacts', 'search-real-verify');
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

/** Import + open legacy-sample via the Kairo import wizard (real UI path). */
async function importAndOpenProject(page, projectPath) {
  const abs = path.resolve(projectPath).replace(/\\/g, '/');
  log(`import wizard: ${abs}`);

  // Prefer already-open wizard; otherwise open via palette.
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
    // Fallback: any visible text input in the import panel
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
  await shot(page, '01a-import-step2');
  await importBtn.click();
  await sleep(1000);

  const openBtn = page.locator('[data-testid="open-project-btn"]').first();
  try {
    await openBtn.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    await shot(page, '01a-import-step3-fail');
    return { ok: false, error: 'import did not reach step 3' };
  }
  await shot(page, '01a-import-step3');
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

async function statusBarText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#theia-statusBar, .theia-statusBar');
    return el ? (el.textContent || '').trim() : '';
  });
}

(async () => {
  const exe = resolveExe();
  log(`exe: ${exe}`);
  const userDataDir = path.join(outDir, 'userdata');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const workspace = path.join(repoRoot, 'legacy-sample');
  if (!fs.existsSync(workspace)) {
    throw new Error(`workspace missing: ${workspace}`);
  }

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

  // Wait for agent connected before importing / searching.
  for (let i = 0; i < 30; i++) {
    const barNow = await statusBarText(page);
    if (/代理[：:]\s*已连接|Agent[：:]\s*(connected|Connected)/i.test(barNow)) break;
    await sleep(1000);
  }

  const openRes = await importAndOpenProject(page, workspace);
  await shot(page, '01b-workspace');
  const bar = await statusBarText(page);
  log(`status: ${bar.slice(0, 200)}`);
  log(`import: ${JSON.stringify(openRes)}`);
  const projectImported = /项目[：:]\s*legacy-sample|Project[：:]\s*legacy-sample/i.test(bar)
    || !!(openRes && openRes.ok);
  record('Workspace imported (legacy-sample)', projectImported, bar.slice(0, 120));

  // ── 1. Ctrl+Shift+F opens Kairo Search Center (not Theia SIW) ──
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.keyboard.press('Control+Shift+F');
  await sleep(1500);
  await shot(page, '02-ctrl-shift-f');

  const modal = page.locator('[data-testid="search-center-modal"]');
  const theiaSiw = page.locator('.search-in-workspace, .theia-search-container, #search-in-workspace');
  const modalVisible = await modal.isVisible().catch(() => false);
  const siwVisible = await theiaSiw.first().isVisible().catch(() => false);
  record('Ctrl+Shift+F opens Kairo Search Center', modalVisible, modalVisible ? 'modal visible' : 'modal missing');
  record('Theia SIW did not steal shortcut', !siwVisible || modalVisible, siwVisible && !modalVisible ? 'SIW visible without Kairo modal' : 'ok');

  if (!modalVisible) {
    await page.keyboard.press('Control+Shift+P');
    await sleep(800);
    const input = page.locator('.quick-input-widget input[type="text"]');
    if (await input.count()) {
      await input.fill('>Find in Path');
      await sleep(600);
      await page.keyboard.press('Enter');
      await sleep(1500);
      await shot(page, '02b-palette-find');
      const again = await modal.isVisible().catch(() => false);
      record('Fallback: Find in Path via palette', again);
    }
  }

  // ── 2. Search with file mask ──
  if (await modal.isVisible().catch(() => false)) {
    const query = page.locator('[data-testid="search-query"]');
    const mask = page.locator('[data-testid="filter-file-types"]');
    await query.click();
    const searchTerm = projectImported ? 'Hello' : 'uiVerify';
    await query.fill(searchTerm);
    if (await mask.count()) {
      await mask.fill('*.java');
    }
    await page.keyboard.press('Enter');
    await sleep(5000);
    await shot(page, '03-search-results');

    const errorBanner = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="search-error"], .kairo-search-error, .kairo-search-banner-error');
      if (el && el.textContent) return el.textContent.trim();
      const modalEl = document.querySelector('[data-testid="search-center-modal"]');
      if (!modalEl) return '';
      const text = modalEl.textContent || '';
      const m = text.match(/错误[:：]\s*[^\n]+|Error[:：]\s*[^\n]+|WebSocket[^\n]{0,80}|No workspace[^\n]{0,80}/i);
      return m ? m[0] : '';
    });
    if (errorBanner) {
      record('Search has no connection/error banner', false, errorBanner.slice(0, 160));
    } else {
      record('Search has no connection/error banner', true, 'ok');
    }

    const resultCount = await page.locator('[data-testid="search-result"]').count();
    const groupCount = await page.locator('[data-testid="search-group"]').count();
    const loading = await page.locator('[data-testid="search-loading"]').isVisible().catch(() => false);
    const empty = await page.locator('[data-testid="search-empty"]').isVisible().catch(() => false);
    record(
      `Search "${searchTerm}" + *.java returns matches`,
      resultCount > 0,
      `results=${resultCount} groups=${groupCount} empty=${empty} loading=${loading}`
    );

    // Pin to Find tool window while results are still visible (before result click).
    const pin = page.locator('[data-testid="open-find-window"]');
    if (await pin.count() && await pin.isVisible().catch(() => false)) {
      await pin.click();
      await sleep(1500);
      await shot(page, '05-find-tool-window');
      const panel = page.locator('[data-testid="search-results-panel"]');
      const panelVisible = await panel.isVisible().catch(() => false);
      record('Open in Find Window docks panel', panelVisible, panelVisible ? 'panel visible' : 'panel missing');
    } else {
      record('Open in Find Window button present', false, 'button missing');
    }

    // Re-open modal if pin closed it, then verify click keeps dialog open.
    if (!(await modal.isVisible().catch(() => false))) {
      await page.keyboard.press('Control+Shift+F');
      await sleep(1200);
      const q = page.locator('[data-testid="search-query"]');
      if (await q.isVisible().catch(() => false)) {
        await q.fill(searchTerm);
        const m = page.locator('[data-testid="filter-file-types"]');
        if (await m.count()) await m.fill('*.java');
        await page.keyboard.press('Enter');
        await sleep(3000);
      }
    }
    if (await modal.isVisible().catch(() => false) && resultCount > 0) {
      await page.locator('[data-testid="search-result"]').first().click();
      await sleep(800);
      const stillOpen = await modal.isVisible().catch(() => false);
      record('Click result keeps dialog open', stillOpen);
      await shot(page, '04-after-click-result');
    }
  }

  // ── 5. Ctrl+Shift+R opens replace mode ──
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.keyboard.press('Control+Shift+R');
  await sleep(1500);
  if (!(await page.locator('[data-testid="search-center-modal"]').isVisible().catch(() => false))) {
    // Fallback: command palette (shortcut may be swallowed when Find panel focused)
    await page.keyboard.press('Control+Shift+P');
    await sleep(700);
    const palette = page.locator('.quick-input-widget input[type="text"]');
    if (await palette.count()) {
      await palette.fill('>Replace in Path');
      await sleep(500);
      await page.keyboard.press('Enter');
      await sleep(1500);
    }
  }
  if (!(await page.locator('[data-testid="search-center-modal"]').isVisible().catch(() => false))) {
    await page.locator('body').click({ position: { x: 400, y: 300 } }).catch(() => {});
    await sleep(300);
    await page.keyboard.press('Control+Shift+R');
    await sleep(1500);
  }
  await shot(page, '06-ctrl-shift-r');
  const modal2 = page.locator('[data-testid="search-center-modal"]');
  const replaceInput = page.locator('[data-testid="replace-text"]');
  const replaceVisible = await modal2.isVisible().catch(() => false);
  let replaceField = await replaceInput.isVisible().catch(() => false);
  record('Ctrl+Shift+R / Replace in Path opens Search Center', replaceVisible);
  if (replaceVisible && !replaceField) {
    const tab = page.locator('.kairo-search-tab').filter({ hasText: /替换|Replace/i }).first();
    if (await tab.count()) {
      await tab.click();
      await sleep(400);
      replaceField = await replaceInput.isVisible().catch(() => false);
    }
  }
  record('Replace mode shows replace field', replaceField, replaceField ? 'replace-text visible' : 'field missing');

  await shot(page, '07-final');
  await app.close().catch(() => {});

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const report = {
    exe,
    at: new Date().toISOString(),
    passed,
    failed,
    results,
    screenshots: fs.readdirSync(outDir).filter(f => f.endsWith('.png')),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`DONE  passed=${passed} failed=${failed}  report=${path.join(outDir, 'report.json')}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
