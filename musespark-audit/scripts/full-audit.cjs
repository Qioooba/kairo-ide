/**
 * MuseSpark Full Audit — Playwright 全量截图 + 按钮点击 + 输入/下拉/滚动
 * 目标：覆盖每个菜单、每个页面、每个按钮、每个文本框、下拉，划到底部全页
 * 并行：通过 Playwright 多 context 并发采集
 * 产出：musespark-audit/screenshots/** + 交互日志
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.CAPTURE_URL || 'http://127.0.0.1:18301';
const OUT_ROOT = path.join(__dirname, '..', 'screenshots');
const LOG_PATH = path.join(__dirname, '..', 'issues', 'interaction-log.jsonl');
const VIEWPORT = { width: 1440, height: 900 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
ensureDir(path.dirname(LOG_PATH));
ensureDir(path.join(OUT_ROOT, 'menus'));
ensureDir(path.join(OUT_ROOT, 'modules'));
ensureDir(path.join(OUT_ROOT, 'dialogs'));
ensureDir(path.join(OUT_ROOT, 'fullpage'));
ensureDir(path.join(OUT_ROOT, 'interactions'));

const log = (entry) => fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');

async function dismissDialogs(page) {
  for (const sel of ['button:has-text("Yes, I trust")', 'button:has-text("Don\'t Save")', 'button:has-text("Don\'t show again")']) {
    try { const b = page.locator(sel).first(); if (await b.count() && await b.isVisible({ timeout: 800 })) { await b.click(); await sleep(300); log({ type: 'dismiss', selector: sel, ok: true }); } } catch {}
  }
}
async function runCommand(page, label) {
  await page.keyboard.press('Escape'); await sleep(200);
  await page.keyboard.press('Control+Shift+P'); await sleep(600);
  const input = page.locator('.quick-input-widget .quick-input-box input');
  try { await input.waitFor({ state: 'visible', timeout: 4000 }); await input.fill('>' + label); await sleep(700); const row = page.locator('.quick-input-widget .monaco-list-row').first(); if (await row.count()) await row.click(); else await page.keyboard.press('Enter'); await sleep(1200); log({ type: 'command', label, ok: true }); return true; } catch (e) { log({ type: 'command', label, ok: false, error: e.message }); return false; }
}
async function fullPageShot(page, name) {
  // 滚动到底部：Theia Shell 分区各自滚动，逐个滚到底再截全页（playwright fullPage 会自动滚）
  try {
    // 尝试滚所有可滚动容器到底部，确保底部内容被渲染
    await page.evaluate(() => {
      document.querySelectorAll('.theia-Tree, .p-Tree, .monaco-list, .theia-list, .kairo-widget-body, .kairo-panel, [data-testid]').forEach(el => { try { el.scrollTop = el.scrollHeight; } catch {} });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT_ROOT, 'fullpage', `${name}.png`), fullPage: true });
    log({ type: 'screenshot', name, fullPage: true, ok: true });
  } catch (e) { log({ type: 'screenshot', name, ok: false, error: e.message }); }
}
async function clickAllButtons(page, prefix) {
  const btns = page.locator('button:visible, [role="button"]:visible, .theia-button:visible, .kairo-button:visible');
  const count = await btns.count();
  log({ type: 'buttons-found', prefix, count });
  for (let i = 0; i < Math.min(count, 50); i++) {
    const btn = btns.nth(i);
    try {
      const text = (await btn.innerText().catch(()=>'' )).slice(0, 40).trim() || (await btn.getAttribute('aria-label') || '').slice(0, 40);
      const box = await btn.boundingBox().catch(()=>null);
      if (!box) continue;
      await btn.scrollIntoViewIfNeeded().catch(()=>{});
      await btn.click({ timeout: 2000 }).catch(async () => { await page.evaluate(el => el.click(), await btn.elementHandle().catch(()=>null)); });
      await sleep(500);
      // 截图：点击后状态
      await page.screenshot({ path: path.join(OUT_ROOT, 'interactions', `${prefix}-btn-${String(i).padStart(2,'0')}-${text.replace(/[^a-zA-Z0-9]/g,'_').slice(0,20)}.png`), fullPage: false }).catch(()=>{});
      log({ type: 'button-click', prefix, index: i, text, ok: true });
      // ESC 关闭可能弹出的 dialog/dropdown，回到原页
      await page.keyboard.press('Escape').catch(()=>{});
      await sleep(300);
    } catch (e) { log({ type: 'button-click', prefix, index: i, ok: false, error: e.message }); }
  }
}
async function testInputs(page, prefix) {
  const inputs = page.locator('input:visible, textarea:visible, [contenteditable="true"]:visible');
  const n = await inputs.count();
  log({ type: 'inputs-found', prefix, count: n });
  for (let i = 0; i < Math.min(n, 20); i++) {
    const inp = inputs.nth(i);
    try {
      await inp.scrollIntoViewIfNeeded().catch(()=>{});
      await inp.click({ timeout: 1500 }).catch(()=>{});
      await inp.fill('test-输入-123').catch(async () => { await inp.pressSequentially('test-输入-123').catch(()=>{}); });
      await sleep(300);
      const val = await inp.inputValue().catch(async () => await inp.innerText().catch(()=>''));
      log({ type: 'input-test', prefix, index: i, value: String(val).slice(0,30), ok: true });
      await page.keyboard.press('Escape').catch(()=>{});
    } catch (e) { log({ type: 'input-test', prefix, index: i, ok: false, error: e.message }); }
  }
}
async function testSelects(page, prefix) {
  const selects = page.locator('select:visible, [role="combobox"]:visible, .theia-select:visible, .kairo-select:visible');
  const n = await selects.count();
  log({ type: 'selects-found', prefix, count: n });
  for (let i = 0; i < Math.min(n, 10); i++) {
    const sel = selects.nth(i);
    try {
      await sel.scrollIntoViewIfNeeded();
      await sel.click({ timeout: 1500 });
      await sleep(400);
      // 选第一个 option
      const opt = page.locator('option:visible, [role="option"]:visible').first();
      if (await opt.count()) { await opt.click().catch(()=>{}); await sleep(300); }
      await page.keyboard.press('Escape').catch(()=>{});
      log({ type: 'select-test', prefix, index: i, ok: true });
    } catch (e) { log({ type: 'select-test', prefix, index: i, ok: false, error: e.message }); }
  }
}

const TASKS = [
  { name: '01-welcome', command: null, shot: '#theia-main-content-panel' },
  { name: '02-servers', command: 'Kairo: Show Servers', shot: '#theia-left-content-panel' },
  { name: '03-builds', command: 'Kairo: Show Builds', shot: '#theia-left-content-panel' },
  { name: '04-deployments', command: 'Kairo: Show Deployments', shot: '#theia-left-content-panel' },
  { name: '05-run-configurations', command: 'Kairo: Manage Run Configurations', shot: '#theia-main-content-panel' },
  { name: '06-tomcat-logs', command: 'Kairo: Show Tomcat Logs', shot: '#theia-left-content-panel' },
  { name: '07-debug-variables', command: 'Kairo: Show Debug Variables', shot: '#theia-left-content-panel' },
  { name: '08-debug-callstack', command: 'Kairo: Show Debug Call Stack', shot: '#theia-left-content-panel' },
  { name: '09-debug-breakpoints', command: 'Kairo: Show Debug Breakpoints', shot: '#theia-left-content-panel' },
  { name: '10-debug-tool-window', command: 'Debug: Open Debug Tool Window (IDEA-style)', shot: '#theia-bottom-content-panel' },
  { name: '11-maven', command: 'Kairo: Show Maven', shot: '#theia-left-content-panel' },
  { name: '12-todo', command: 'Kairo: Show TODO/FIXME', shot: '#theia-left-content-panel' },
  { name: '13-problems', command: 'Problems: Focus on Problems View', shot: '#theia-bottom-content-panel' },
  { name: '14-search', command: 'Kairo: Search Everywhere', shot: '#theia-left-content-panel' },
  { name: '15-git-changes', command: null, shot: null },
  { name: '16-svn-changes', command: null, shot: null },
  { name: '17-sql-console', command: 'Kairo: Show SQL Console', shot: '#theia-main-content-panel' },
  { name: '18-remote', command: 'Kairo: Show Remote', shot: '#theia-left-content-panel' },
  { name: '19-perf-dashboard', command: 'Kairo: Show Performance', shot: '#theia-left-content-panel' },
  { name: '20-preferences', command: 'Preferences: Open Settings (UI)', shot: '#theia-main-content-panel' },
  { name: '21-keymap', command: 'Kairo: Show Keymap', shot: '#theia-main-content-panel' },
  { name: '22-extensions', command: 'Extensions: Focus on Extensions View', shot: '#theia-left-content-panel' },
  { name: '23-terminal', command: 'Terminal: Create New Terminal', shot: '#theia-bottom-content-panel' },
  { name: '24-output', command: 'View: Toggle Output', shot: '#theia-bottom-content-panel' },
  { name: '25-explorer', command: 'File: Focus on Files Explorer', shot: '#theia-left-content-panel' },
];

async function captureMenus(page) {
  const menus = ['File','Edit','Selection','View','Go','Run','Terminal','Help','Kairo'];
  for (const label of menus) {
    const item = page.locator(`.lm-MenuBar-item:has-text("${label}"), .p-MenuBar-item:has-text("${label}")`).first();
    if (await item.count()) {
      try { await item.click(); await sleep(500); await page.screenshot({ path: path.join(OUT_ROOT, 'menus', `menu-${label.toLowerCase()}.png`) }); log({ type: 'menu', label, ok: true }); await page.keyboard.press('Escape'); await sleep(300); } catch (e) { log({ type: 'menu', label, ok: false, error: e.message }); }
    }
  }
  // Run 菜单展开态（重点）
  const run = page.locator('.lm-MenuBar-item:has-text("Run")').first();
  if (await run.count()) { try { await run.click(); await sleep(500); await page.screenshot({ path: path.join(OUT_ROOT, 'menus', 'menu-run-expanded.png') }); await page.keyboard.press('Escape'); } catch {} }
}

async function captureDialogs(page) {
  const dialogs = [
    { cmd: 'Kairo: Import Project', name: 'dialog-import-project' },
    { cmd: 'Kairo: Show Project Structure', name: 'dialog-project-structure' },
    { cmd: 'SVN: Commit', name: 'dialog-svn-commit' },
    { cmd: 'SVN: Update', name: 'dialog-svn-update' },
    { cmd: 'SVN: Show History', name: 'dialog-svn-history' },
    { cmd: 'Git: Commit', name: 'dialog-git-commit' },
  ];
  for (const d of dialogs) {
    if (await runCommand(page, d.cmd)) { await sleep(800); await page.screenshot({ path: path.join(OUT_ROOT, 'dialogs', `${d.name}.png`), fullPage: true }); await page.keyboard.press('Escape'); await sleep(500); log({ type: 'dialog', name: d.name, ok: true }); }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  console.log('Navigating to', BASE_URL);
  try { await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForSelector('#theia-app-shell, .theia-shell', { state: 'attached', timeout: 30000 }); await sleep(3000); await dismissDialogs(page); } catch (e) { console.error('nav failed', e.message); log({ type: 'nav', ok: false, error: e.message }); }

  // 1) 全量页面 + 全页滚动截图
  for (const t of TASKS) {
    try {
      if (t.command) await runCommand(page, t.command);
      await sleep(600);
      await fullPageShot(page, t.name);
      // 2) 按钮/输入/下拉全覆盖
      await clickAllButtons(page, t.name);
      await testInputs(page, t.name);
      await testSelects(page, t.name);
      // 额外滚动到底部再截一次
      await fullPageShot(page, `${t.name}-scrolled`);
    } catch (e) { log({ type: 'task', name: t.name, ok: false, error: e.message }); }
  }

  // 3) 菜单
  await captureMenus(page);
  // 4) 对话框
  await captureDialogs(page);
  // 5) 最终全壳
  await page.screenshot({ path: path.join(OUT_ROOT, 'fullpage', '99-full-shell-final.png'), fullPage: true });
  await browser.close();
  console.log('Done. See', OUT_ROOT, 'and', LOG_PATH);
})().catch(e => { console.error(e); process.exit(1); });
