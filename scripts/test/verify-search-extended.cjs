/**
 * Extended real desktop verification:
 *   1) Replace All + Undo (disk content)
 *   2) Exclude mask / Scope current-file
 *   3) Find File (Ctrl+Shift+N)
 *
 *   node scripts/test/verify-search-extended.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = path.join(repoRoot, 'artifacts', 'search-extended-verify');
fs.mkdirSync(outDir, { recursive: true });

const MARKER_A = 'KAIRO_REPLACE_MARKER_AAA';
const MARKER_B = 'KAIRO_REPLACE_MARKER_BBB';

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
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Kairo.exe not found');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'target') continue;
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
      await sleep(400);
      await page.keyboard.press('Enter');
      await sleep(1200);
    }
    pathInput = page.locator('[data-testid="path-input"]').first();
  }
  if (!(await pathInput.isVisible().catch(() => false))) {
    return { ok: false, error: 'path-input missing' };
  }
  await pathInput.click({ clickCount: 3 });
  await pathInput.fill(abs);
  await shot(page, '01-import-path');
  const scanBtn = page.locator('[data-testid="scan-btn"]').first();
  if (await scanBtn.count() && await scanBtn.isEnabled().catch(() => false)) await scanBtn.click();
  else await pathInput.press('Enter');

  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  try { await importBtn.waitFor({ state: 'visible', timeout: 45_000 }); }
  catch { return { ok: false, error: 'scan failed' }; }
  await shot(page, '01-import-step2');
  await importBtn.click();
  await sleep(800);

  const openBtn = page.locator('[data-testid="open-project-btn"]').first();
  try { await openBtn.waitFor({ state: 'visible', timeout: 45_000 }); }
  catch { return { ok: false, error: 'import step3 failed' }; }
  await shot(page, '01-import-step3');
  await openBtn.click();
  for (let i = 0; i < 12; i++) { await sleep(400); await dismissTrust(page); }
  return { ok: true };
}

async function openSearch(page, mode = 'search') {
  await page.keyboard.press('Escape');
  await sleep(300);
  if (mode === 'replace') {
    await page.keyboard.press('Control+Shift+R');
  } else {
    await page.keyboard.press('Control+Shift+F');
  }
  await sleep(1200);
  const modal = page.locator('[data-testid="search-center-modal"]');
  if (!(await modal.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Shift+P');
    await sleep(600);
    const palette = page.locator('.quick-input-widget input[type="text"]');
    if (await palette.count()) {
      await palette.fill(mode === 'replace' ? '>Replace in Path' : '>Find in Path');
      await sleep(400);
      await page.keyboard.press('Enter');
      await sleep(1200);
    }
  }
  if (mode === 'replace' && await modal.isVisible().catch(() => false)) {
    const replaceField = page.locator('[data-testid="replace-text"]');
    if (!(await replaceField.isVisible().catch(() => false))) {
      const tab = page.locator('.kairo-search-tab').filter({ hasText: /替换|Replace/i }).first();
      if (await tab.count()) { await tab.click(); await sleep(300); }
    }
  }
  return modal;
}

async function runSearch(page, { query, mask, exclude, scope }) {
  const q = page.locator('[data-testid="search-query"]');
  await q.click();
  await q.fill(query);
  if (mask != null) {
    const m = page.locator('[data-testid="filter-file-types"]');
    if (await m.count()) await m.fill(mask);
  }
  if (scope) {
    const sel = page.locator('[data-testid="scope-selector"]');
    if (await sel.count()) await sel.selectOption(scope);
  }
  if (exclude) {
    const adv = page.locator('[data-testid="toggle-advanced"]');
    if (await adv.count() && await adv.isVisible().catch(() => false)) {
      // open advanced if exclude input not visible
      if (!(await page.locator('[data-testid="filter-exclude"]').isVisible().catch(() => false))) {
        await adv.click();
        await sleep(200);
      }
    }
    const ex = page.locator('[data-testid="filter-exclude"]');
    if (await ex.isVisible().catch(() => false)) await ex.fill(exclude);
  }
  await page.keyboard.press('Enter');
  await sleep(4000);
}

(async () => {
  const exe = resolveExe();
  log(`exe: ${exe}`);

  // Disposable workspace copy so Replace/Undo does not mutate repo sample permanently.
  const workspace = path.join(outDir, 'workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  copyDir(path.join(repoRoot, 'legacy-sample'), workspace);
  const helloPath = path.join(workspace, 'src', 'main', 'java', 'com', 'example', 'HelloWorld.java');
  let helloSrc = fs.readFileSync(helloPath, 'utf8');
  if (!helloSrc.includes(MARKER_A)) {
    helloSrc = helloSrc.replace('String aa = "";', `String aa = "${MARKER_A}";`);
    fs.writeFileSync(helloPath, helloSrc, 'utf8');
  }
  log(`seeded marker in ${helloPath}`);

  const userDataDir = path.join(outDir, 'userdata');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });

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
    const bar = await statusBarText(page);
    if (/代理[：:]\s*已连接|Agent[：:].*connect/i.test(bar)) break;
    await sleep(1000);
  }

  const imported = await importAndOpenProject(page, workspace);
  const bar = await statusBarText(page);
  const projectOk = /项目[：:].+/i.test(bar) && !/未导入|not imported/i.test(bar);
  record('Import disposable workspace', projectOk || !!(imported && imported.ok), bar.slice(0, 120));
  await shot(page, '01-workspace');

  // ═══════════════════════════════════════════════════════════
  // A. Exclude mask: Hello + *.java should find servlet; exclude legacy → fewer
  // ═══════════════════════════════════════════════════════════
  let modal = await openSearch(page, 'search');
  record('Open Search Center', await modal.isVisible().catch(() => false));
  await runSearch(page, { query: 'Hello', mask: '*.java' });
  await shot(page, '02-search-all-java');
  const allCount = await page.locator('[data-testid="search-result"]').count();
  const allGroups = await page.locator('[data-testid="search-group"]').count();
  record('Baseline Hello+*.java has matches', allCount > 0, `results=${allCount} groups=${allGroups}`);

  await runSearch(page, { query: 'Hello', mask: '*.java, !**/HelloServlet.java' });
  await shot(page, '03-search-exclude-servlet');
  const exclCount = await page.locator('[data-testid="search-result"]').count();
  const exclText = await page.locator('[data-testid="search-center-modal"]').innerText().catch(() => '');
  const servletGone = !/HelloServlet\.java/i.test(exclText);
  const worldPresent = /HelloWorld\.java/i.test(exclText);
  record('Exclude !**/HelloServlet.java drops servlet', servletGone && worldPresent && exclCount > 0 && exclCount < allCount,
    `before=${allCount} after=${exclCount} servletGone=${servletGone} worldPresent=${worldPresent}`);

  // Advanced exclude field
  await page.locator('[data-testid="toggle-advanced"]').click().catch(() => {});
  await sleep(200);
  await runSearch(page, { query: 'Hello', mask: '*.java', exclude: '**/legacy/**' });
  await shot(page, '04-search-exclude-legacy');
  const excl2Text = await page.locator('[data-testid="search-center-modal"]').innerText().catch(() => '');
  record('Exclude **/legacy/** via advanced field', !/HelloServlet\.java/i.test(excl2Text) && /HelloWorld\.java/i.test(excl2Text),
    excl2Text.includes('HelloServlet') ? 'servlet still present' : 'servlet excluded');

  // ═══════════════════════════════════════════════════════════
  // B. Scope: current-file (open HelloWorld via Find File first)
  // ═══════════════════════════════════════════════════════════
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.keyboard.press('Control+Shift+N');
  await sleep(1200);
  let findFile = page.locator('[data-testid="find-file"]');
  if (!(await findFile.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Shift+P');
    await sleep(600);
    const palette = page.locator('.quick-input-widget input[type="text"]');
    if (await palette.count()) {
      await palette.fill('>Find File');
      await sleep(400);
      await page.keyboard.press('Enter');
      await sleep(1200);
    }
  }
  findFile = page.locator('[data-testid="find-file"]');
  const findVisible = await findFile.isVisible().catch(() => false);
  record('Ctrl+Shift+N opens Find File', findVisible);
  if (findVisible) {
    const fq = page.locator('[data-testid="find-file-query"]');
    await fq.fill('HelloWorld');
    await sleep(2000);
    await shot(page, '05-find-file');
    const ffCount = await page.locator('[data-testid="find-file-result"]').count();
    record('Find File fuzzy "HelloWorld" returns hits', ffCount > 0, `results=${ffCount}`);
    if (ffCount > 0) {
      await page.locator('[data-testid="find-file-result"]').first().click();
      await sleep(1500);
      await shot(page, '06-opened-helloworld');
      const title = await page.title();
      const editorText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
      record('Find File opens HelloWorld.java', /HelloWorld/i.test(title) || /HelloWorld|MARKER_AAA|package com\.example/i.test(editorText),
        title.slice(0, 80));
    }
  }

  modal = await openSearch(page, 'search');
  if (await modal.isVisible().catch(() => false)) {
    await runSearch(page, { query: 'Hello', mask: '*.java', scope: 'current-file' });
    await shot(page, '07-scope-current-file');
    const scopeText = await page.locator('[data-testid="search-center-modal"]').innerText().catch(() => '');
    const scopeCount = await page.locator('[data-testid="search-result"]').count();
    const onlyWorld = /HelloWorld\.java/i.test(scopeText) && !/HelloServlet\.java/i.test(scopeText);
    record('Scope current-file limits to HelloWorld', onlyWorld && scopeCount > 0,
      `results=${scopeCount} onlyWorld=${onlyWorld}`);
  } else {
    record('Scope current-file limits to HelloWorld', false, 'modal missing');
  }

  // ═══════════════════════════════════════════════════════════
  // C. Replace All + Undo on unique marker
  // ═══════════════════════════════════════════════════════════
  modal = await openSearch(page, 'replace');
  const replaceOpen = await modal.isVisible().catch(() => false);
  record('Open Replace in Path', replaceOpen);
  if (replaceOpen) {
    await page.locator('[data-testid="search-query"]').fill(MARKER_A);
    const mask = page.locator('[data-testid="filter-file-types"]');
    if (await mask.count()) await mask.fill('*.java');
    const scope = page.locator('[data-testid="scope-selector"]');
    if (await scope.count()) await scope.selectOption('project');
    await page.locator('[data-testid="replace-text"]').fill(MARKER_B);
    await page.keyboard.press('Enter');
    await sleep(4000);
    await shot(page, '08-replace-preview');
    const markCount = await page.locator('[data-testid="search-result"]').count();
    record('Replace search finds marker', markCount > 0, `results=${markCount}`);

    // Wait for Replace All button (plan builds async after results)
    const replaceAll = page.getByRole('button', { name: /全部替换|Replace All/i }).first();
    let replaceBtnReady = false;
    for (let i = 0; i < 20; i++) {
      if (await replaceAll.isVisible().catch(() => false) && await replaceAll.isEnabled().catch(() => false)) {
        replaceBtnReady = true;
        break;
      }
      await sleep(300);
    }
    record('Replace All button appears', replaceBtnReady);
    if (replaceBtnReady) {
      await replaceAll.click();
      await sleep(2500);
      await shot(page, '09-after-replace');
      const afterReplace = fs.readFileSync(helloPath, 'utf8');
      const applied = afterReplace.includes(MARKER_B) && !afterReplace.includes(MARKER_A);
      record('Replace All wrote marker to disk', applied,
        applied ? 'BBB present, AAA gone' : afterReplace.includes(MARKER_A) ? 'still AAA' : 'neither');

      const undoBtn = page.getByRole('button', { name: /撤销|Undo/i }).first();
      let undoReady = false;
      for (let i = 0; i < 15; i++) {
        if (await undoBtn.isVisible().catch(() => false) && await undoBtn.isEnabled().catch(() => false)) {
          undoReady = true;
          break;
        }
        await sleep(300);
      }
      record('Undo button appears after apply', undoReady);
      if (undoReady) {
        await undoBtn.click();
        await sleep(2500);
        await shot(page, '10-after-undo');
        const afterUndo = fs.readFileSync(helloPath, 'utf8');
        const restored = afterUndo.includes(MARKER_A) && !afterUndo.includes(MARKER_B);
        record('Undo restored marker on disk', restored,
          restored ? 'AAA restored' : afterUndo.includes(MARKER_B) ? 'still BBB' : 'neither');
      }
    }
  }

  await shot(page, '11-final');
  await app.close().catch(() => {});

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const report = { exe, at: new Date().toISOString(), passed, failed, results,
    screenshots: fs.readdirSync(outDir).filter(f => f.endsWith('.png')) };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  log(`DONE  passed=${passed} failed=${failed}  report=${path.join(outDir, 'report.json')}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
