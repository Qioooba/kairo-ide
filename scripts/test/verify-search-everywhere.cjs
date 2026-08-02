/**
 * Real desktop verification: Search Everywhere, Find Class/Symbol/Action,
 * plus Search Center regex/case/word toggles.
 *
 *   node scripts/test/verify-search-everywhere.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'artifacts', 'search-everywhere-verify');
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
  for (const c of [
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'run', 'Kairo.exe'),
    path.join(repoRoot, 'apps', 'desktop', 'dist', 'win-unpacked', 'Kairo.exe'),
  ]) if (fs.existsSync(c)) return c;
  throw new Error('Kairo.exe not found');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', '.git', 'target'].includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${stamp()}] ${m}`);
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => {});
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function dismissTrust(page) {
  for (const label of [/Trust|信任|Yes|是|Continue|继续|Don't Save|不保存|Cancel|取消/i]) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await sleep(300);
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

async function runPalette(page, label) {
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Control+Shift+P');
  await sleep(600);
  const input = page.locator('.quick-input-widget input[type="text"]');
  if (!(await input.count())) return false;
  await input.fill(`>${label}`);
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1200);
  return true;
}

async function importAndOpenProject(page, projectPath) {
  const abs = path.resolve(projectPath).replace(/\\/g, '/');
  log(`import: ${abs}`);
  let pathInput = page.locator('[data-testid="path-input"]').first();
  if (!(await pathInput.isVisible().catch(() => false))) {
    await runPalette(page, 'Import Project');
    pathInput = page.locator('[data-testid="path-input"]').first();
  }
  if (!(await pathInput.isVisible().catch(() => false))) return { ok: false };
  await pathInput.click({ clickCount: 3 });
  await pathInput.fill(abs);
  const scan = page.locator('[data-testid="scan-btn"]').first();
  if (await scan.count() && await scan.isEnabled().catch(() => false)) await scan.click();
  else await pathInput.press('Enter');
  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  try { await importBtn.waitFor({ state: 'visible', timeout: 45_000 }); } catch { return { ok: false }; }
  await importBtn.click();
  await sleep(800);
  const openBtn = page.locator('[data-testid="open-project-btn"]').first();
  try { await openBtn.waitFor({ state: 'visible', timeout: 45_000 }); } catch { return { ok: false }; }
  await openBtn.click();
  for (let i = 0; i < 12; i++) { await sleep(400); await dismissTrust(page); }
  return { ok: true };
}

async function openByShortcutOrPalette(page, shortcut, paletteLabel, testId) {
  await page.keyboard.press('Escape');
  await sleep(300);
  // Click shell chrome so inputs aren't focused (needed for Double Shift).
  await page.locator('#theia-statusBar, .theia-statusBar').click({ force: true }).catch(() => {});
  await sleep(200);
  if (shortcut === 'DoubleShift') {
    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
    await sleep(80);
    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
  } else {
    await page.keyboard.press(shortcut);
  }
  await sleep(1200);
  let loc = page.locator(`[data-testid="${testId}"]`);
  if (await loc.isVisible().catch(() => false)) return loc;
  await runPalette(page, paletteLabel);
  loc = page.locator(`[data-testid="${testId}"]`);
  return loc;
}

(async () => {
  const exe = resolveExe();
  log(`exe: ${exe}`);

  // Kill leftover Kairo/agent processes that can steal single-instance
  // lock or leave a stale agent with unrelated projects (e.g. shard06b).
  try {
    require('child_process').execSync(
      'powershell -NoProfile -Command "Get-Process Kairo,kairo-runtime -ErrorAction SilentlyContinue | Stop-Process -Force"',
      { stdio: 'ignore' },
    );
  } catch { /* ignore */ }
  await sleep(1500);

  const workspace = path.join(outDir, 'workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  copyDir(path.join(repoRoot, 'legacy-sample'), workspace);

  const userDataDir = path.join(outDir, 'userdata');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  try { fs.rmSync(path.join(outDir, 'main.log'), { force: true }); } catch { /* ignore */ }

  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      KAIRO_USER_DATA_DIR: userDataDir,
      KAIRO_DESKTOP_LOG_FILE: path.join(outDir, 'main.log'),
      KAIRO_NO_DEVTOOLS: '1',
    },
    timeout: 180_000,
  });

  const page = await app.firstWindow({ timeout: 120_000 });
  page.on('dialog', async (d) => { await d.dismiss().catch(() => {}); });
  await page.waitForSelector('#theia-statusBar', { timeout: 120_000 });
  await sleep(5000);
  await dismissTrust(page);
  await shot(page, '00-boot');

  for (let i = 0; i < 30; i++) {
    if (/代理[：:]\s*已连接|Agent[：:].*connect/i.test(await statusBarText(page))) break;
    await sleep(1000);
  }

  const imported = await importAndOpenProject(page, workspace);
  const bar = await statusBarText(page);
  record('Import workspace', !!(imported && imported.ok) || (/项目[：:]/.test(bar) && !/未导入|not imported/i.test(bar)), bar.slice(0, 100));
  await shot(page, '01-workspace');

  // ── Search Everywhere (Double Shift / palette) ──
  let everywhere = await openByShortcutOrPalette(page, 'DoubleShift', 'Search Everywhere', 'search-everywhere');
  let everywhereVisible = await everywhere.isVisible().catch(() => false);
  if (!everywhereVisible) {
    // Try again via explicit command id label variants
    await runPalette(page, 'Kairo Search Everywhere');
    everywhere = page.locator('[data-testid="search-everywhere"]');
    everywhereVisible = await everywhere.isVisible().catch(() => false);
  }
  record('Search Everywhere opens', everywhereVisible);
  await shot(page, '02-everywhere');

  if (everywhereVisible) {
    const q = page.locator('[data-testid="everywhere-query"]');
    await q.fill('HelloWorld');
    await sleep(2000);
    await shot(page, '03-everywhere-helloworld');
    let items = await page.locator('[data-testid="everywhere-item"]').count();
    record('Everywhere finds HelloWorld (all)', items > 0, `items=${items}`);

    // Files category
    const filesTab = page.locator('[data-testid="category-files"]');
    if (await filesTab.count()) {
      await filesTab.click();
      await sleep(1500);
      items = await page.locator('[data-testid="everywhere-item"]').count();
      const text = await everywhere.innerText().catch(() => '');
      record('Everywhere Files category', items > 0 && /HelloWorld/i.test(text), `items=${items}`);
      await shot(page, '04-everywhere-files');
    }

    // Actions category
    const actionsTab = page.locator('[data-testid="category-actions"]');
    if (await actionsTab.count()) {
      await actionsTab.click();
      await page.locator('[data-testid="everywhere-query"]').fill('Find');
      await sleep(1500);
      items = await page.locator('[data-testid="everywhere-item"]').count();
      record('Everywhere Actions category', items > 0, `items=${items}`);
      await shot(page, '05-everywhere-actions');
    }

    // Types category (needs JDT LS)
    const typesTab = page.locator('[data-testid="category-types"]');
    if (await typesTab.count()) {
      await typesTab.click();
      await page.locator('[data-testid="everywhere-query"]').fill('Hello');
      let items = 0;
      for (let i = 0; i < 20; i++) {
        await sleep(1000);
        items = await page.locator('[data-testid="everywhere-item"]').count();
        if (items > 0) break;
      }
      const err = await page.locator('[data-testid="everywhere-open-error"], .kairo-error-banner').first().isVisible().catch(() => false);
      record('Everywhere Types category (JDT)', items > 0, `items=${items} errBanner=${err}`);
      await shot(page, '06-everywhere-types');
    }
  }

  // ── Find Action (Ctrl+Shift+A) ──
  const findAction = await openByShortcutOrPalette(page, 'Control+Shift+A', 'Find Action', 'find-action');
  const actionVisible = await findAction.isVisible().catch(() => false);
  record('Find Action opens', actionVisible);
  if (actionVisible) {
    await page.locator('[data-testid="find-action-query"]').fill('Import');
    await sleep(1500);
    const count = await page.locator('[data-testid="find-action-result"]').count();
    record('Find Action fuzzy "Import"', count > 0, `results=${count}`);
    await shot(page, '07-find-action');
  }

  // ── Search Center toggles early (needs live agent WebSocket) ──
  // Agent has historically died during heavy JDT / classfile open;
  // run text-search checks while the agent is still healthy.
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.keyboard.press('Control+Shift+F');
  await sleep(1200);
  const modalEarly = page.locator('[data-testid="search-center-modal"]');
  if (await modalEarly.isVisible().catch(() => false)) {
    const caseBtn = modalEarly.locator('[data-testid="filter-case"]');
    const regexBtn = modalEarly.locator('[data-testid="filter-regex"]');
    const wordBtn = modalEarly.locator('[data-testid="filter-word"]');
    const queryInput = modalEarly.locator('[data-testid="search-query"]');
    const maskInput = modalEarly.locator('[data-testid="filter-file-types"]');
    const submitBtn = modalEarly.locator('[data-testid="search-submit"]');

    async function setToggle(btn, wantOn) {
      for (let i = 0; i < 6; i++) {
        const on = await btn.evaluate(el => el.classList.contains('is-active')).catch(() => false);
        if (on === wantOn) return true;
        await btn.click({ force: true });
        await sleep(200);
      }
      return (await btn.evaluate(el => el.classList.contains('is-active')).catch(() => false)) === wantOn;
    }

    async function doSearch(term) {
      await queryInput.fill(term);
      if (await maskInput.count()) await maskInput.fill('*.java');
      await submitBtn.click();
      await sleep(3500);
      return modalEarly.locator('[data-testid="search-result"]').count();
    }

    await setToggle(caseBtn, false);
    await setToggle(regexBtn, false);
    await setToggle(wordBtn, false);
    const insensitive = await doSearch('hello');
    await shot(page, '11-case-off');

    await setToggle(caseBtn, true);
    const sensitive = await doSearch('hello');
    await shot(page, '12-case-on');
    record('Case-sensitive toggle narrows results', sensitive < insensitive || (insensitive > 0 && sensitive === 0),
      `caseOff=${insensitive} caseOn=${sensitive}`);

    await setToggle(caseBtn, false);
    await setToggle(regexBtn, true);
    const regexCount = await doSearch('Hel+o');
    await shot(page, '13-regex');
    record('Regex toggle matches Hel+o', regexCount > 0, `results=${regexCount}`);

    await setToggle(regexBtn, false);
    await setToggle(wordBtn, true);
    const wordCount = await doSearch('Hello');
    await shot(page, '14-whole-word');
    record('Whole-word toggle finds Hello', wordCount > 0, `results=${wordCount}`);
    await page.keyboard.press('Escape');
    await sleep(300);
  } else {
    record('Case-sensitive toggle narrows results', false, 'search modal missing');
    record('Regex toggle matches Hel+o', false, 'search modal missing');
    record('Whole-word toggle finds Hello', false, 'search modal missing');
  }

  // ── Find Class (Ctrl+N) — depends on JDT LS ──
  // Warm up: open a Java file first so project/LS context is active.
  await page.keyboard.press('Escape');
  await sleep(300);
  await openByShortcutOrPalette(page, 'Control+Shift+N', 'Find File', 'find-file');
  if (await page.locator('[data-testid="find-file"]').isVisible().catch(() => false)) {
    await page.locator('[data-testid="find-file-query"]').fill('HelloWorld.java');
    await sleep(1500);
    if (await page.locator('[data-testid="find-file-result"]').count()) {
      await page.locator('[data-testid="find-file-result"]').first().click();
      await sleep(2000);
    }
  }

  const lsInfo = await page.evaluate(() => {
    const bar = document.querySelector('#theia-statusBar, .theia-statusBar');
    return {
      bar: bar ? (bar.textContent || '').slice(0, 250) : '',
      bodyHasJdt: /JDT|语言服务器|Language Server/i.test(document.body.innerText.slice(0, 5000)),
    };
  });
  log(`LS probe: ${JSON.stringify(lsInfo)}`);

  const findClass = await openByShortcutOrPalette(page, 'Control+N', 'Find Class', 'find-class');
  const classVisible = await findClass.isVisible().catch(() => false);
  record('Find Class opens', classVisible);
  if (classVisible) {
    await page.locator('[data-testid="find-class-query"]').fill('HelloWorld');
    let count = 0;
    let status = '';
    for (let i = 0; i < 45; i++) { // up to ~45s for cold JDT
      await sleep(1000);
      count = await page.locator('[data-testid="find-class-result"]').count();
      status = await findClass.innerText().catch(() => '');
      if (count > 0) break;
    }
    await shot(page, '08-find-class');
    if (count > 0) {
      record('Find Class finds HelloWorld', true, `results=${count}`);
      // Prefer a .java row when present (avoid decompiled .class).
      const javaRow = page.locator('[data-testid="find-class-result"]').filter({ hasText: /\.java/i }).first();
      if (await javaRow.count()) await javaRow.click();
      else await page.locator('[data-testid="find-class-result"]').first().click();
      await sleep(1500);
      await shot(page, '09-find-class-opened');
      const title = await page.title();
      record('Find Class opens editor', /HelloWorld/i.test(title) || /HelloWorld/i.test(await page.evaluate(() => document.body.innerText.slice(0, 1500))), title.slice(0, 80));
    } else {
      record('Find Class finds HelloWorld', false, `no results after wait; status=${status.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }

  // ── Find Symbol (Ctrl+Alt+Shift+N) ──
  const findSymbol = await openByShortcutOrPalette(page, 'Control+Alt+Shift+N', 'Find Symbol', 'find-symbol');
  const symbolVisible = await findSymbol.isVisible().catch(() => false);
  record('Find Symbol opens', symbolVisible);
  if (symbolVisible) {
    await page.locator('[data-testid="find-symbol-query"]').fill('main');
    let count = 0;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      count = await page.locator('[data-testid="find-symbol-result"]').count();
      if (count > 0) break;
    }
    await shot(page, '10-find-symbol');
    record('Find Symbol fuzzy "main"', count > 0, `results=${count}`);
  }

  await shot(page, '15-final');
  await app.close().catch(() => {});

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({
    exe, at: new Date().toISOString(), passed, failed, results,
    screenshots: fs.readdirSync(outDir).filter(f => f.endsWith('.png')),
  }, null, 2));
  log(`DONE  passed=${passed} failed=${failed}  report=${path.join(outDir, 'report.json')}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
