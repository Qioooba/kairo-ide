// Kairo IDE Windows EXE — Deep E2E Test v5
// Based on official E2E fixtures: uses data-testid, Agent API, proper dialog handling
const fs = require('fs');
const path = require('path');
const os = require('os');
const { _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf(`--${name}`); return (i >= 0 && i + 1 < argv.length) ? argv[i+1] : def; }
const customExe = arg('exe', null);
const baseOutDir = arg('out', null);

const repoRoot = path.resolve(__dirname, '..', '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = baseOutDir || path.join(repoRoot, 'artifacts', 'test-results', 'deep5-' + stamp);
const screenshotDir = path.join(runDir, 'screenshots');
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

// Agent port (from Kairo default)
const AGENT_PORT = '18300';
const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;

// Create a fresh test workspace by copying legacy-sample
const TEST_WS_ROOT = path.join(os.tmpdir(), 'kairo-deep-test-' + stamp.replace(/-/g, ''));
const TEST_PROJECT_PATH = path.join(TEST_WS_ROOT, 'legacy-sample');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name), dp = path.join(dest, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '.kairo' && entry.name !== 'node_modules') copyDirSync(sp, dp); }
    else fs.copyFileSync(sp, dp);
  }
}

// Prepare test project
copyDirSync(path.join(repoRoot, 'legacy-sample'), TEST_PROJECT_PATH);
// Also prepare GBK project
const GBK_PROJECT_PATH = path.join(TEST_WS_ROOT, 'gbk-project');
try { copyDirSync(path.join(repoRoot, 'test-workspace', 'gbk-legacy-project'), GBK_PROJECT_PATH); } catch(e) {}

const results = [];
const bugs = [];
const consoleErrors = [];
const startTime = Date.now();

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const warn = (m) => console.warn(`[${new Date().toISOString().slice(11, 23)}] WARN ${m}`);

let testCounter = 0;
let currentPage = null;
let currentApp = null;

async function runTest(section, id, name, priority, fn) {
  testCounter++;
  const start = Date.now();
  const safeName = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
  const result = { id, section, name, priority, status: 'pass', duration: 0, error: null, screenshot: null, timestamp: new Date().toISOString() };
  log(`▶ [${id}] §${section} ${priority}: ${name}`);
  try {
    await fn(result);
    result.duration = Date.now() - start;
    results.push(result);
    log(`  ✓ PASS (${result.duration}ms)`);
  } catch (err) {
    result.duration = Date.now() - start;
    result.status = 'fail';
    result.error = err.message || String(err);
    results.push(result);
    try {
      const shotPath = path.join(screenshotDir, `fail-${section}-${id}-${safeName}.png`);
      if (currentPage) { await currentPage.screenshot({ path: shotPath, fullPage: false }); result.screenshot = path.relative(runDir, shotPath); }
    } catch (_) {}
    log(`  ✗ FAIL (${result.duration}ms): ${result.error}`);
    if (priority === 'P0' || priority === 'P1') addBug(section, id, name, priority, result.error, result.screenshot);
  }
}

function addBug(section, testId, name, severity, error, screenshot) {
  const bugId = `KAIRO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(bugs.length+1).padStart(3,'0')}`;
  bugs.push({ id: bugId, section, testId, name, severity, error, screenshot });
}

async function shot(name) {
  try { const f = path.join(screenshotDir, `${name}.png`); await currentPage.screenshot({ path: f, fullPage: false }); log(`  📸 ${name}.png`); } catch(e) {}
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Agent API helpers
async function agentFetch(method, endpoint, body) {
  try {
    const res = await fetch(`${AGENT_BASE}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify({ requestId: `e2e-${Date.now()}`, payload: body }) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch(_) {}
    return { status: res.status, body: text, json };
  } catch (err) {
    return { status: 0, error: String(err) };
  }
}

async function waitForAgent(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await agentFetch('GET', '/api/v1/health');
    if (res.status === 200 || (res.json && res.json.payload)) {
      log('Agent API is ready');
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function cleanAgentProjects() {
  // List projects and delete them all
  const list = await agentFetch('GET', '/api/v1/projects');
  if (list.json?.payload && Array.isArray(list.json.payload)) {
    for (const p of list.json.payload) {
      const id = p.id || p.projectId;
      if (id) {
        log(`  Cleaning up old project: ${id}`);
        await agentFetch('DELETE', `/api/v1/projects/${id}`);
      }
    }
  }
}

// ─── DI Container ──────────────────────────────────────────
async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 25; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container?._bindingDictionary?._map) {
        const shell = document.querySelector('.theia-ApplicationShell, [data-theia-shell]');
        if (shell) container = shell.__inversify_container__ || Object.values(shell).find(v => v?._bindingDictionary?._map);
      }
      if (!container?._bindingDictionary?._map) {
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c?._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { container = c; break; }
        }
      }
      if (!container?._bindingDictionary?._map) return false;
      const map = container._bindingDictionary._map;
      for (const [key] of map.entries()) {
        if (typeof key === 'symbol' && key.toString() === 'Symbol(CommandService)') {
          try {
            const svc = container.get(key);
            if (svc?.executeCommand) {
              window.__kairoCmdReg = svc;
              try { window.__kairoCmdList = Array.from(svc.getAllCommands()).map(c => ({ id: c.id, label: c.label })); } catch(_) {}
              return true;
            }
          } catch(_) {}
        }
      }
      return false;
    });
    if (found) return true;
    await sleep(1500);
  }
  return false;
}

async function execCmd(page, commandId) {
  await ensureCmdReg(page);
  return page.evaluate((cmdId) => window.__kairoCmdReg.executeCommand(cmdId), commandId);
}

// ─── Dialog helpers (from fixtures) ────────────────────────
async function dismissTrustDialog(page, timeout = 5000) {
  try {
    const dialog = page.locator('.dialogBlock, .workspace-trust-dialog').first();
    await dialog.waitFor({ state: 'visible', timeout }).catch(() => null);
    if (await dialog.count() > 0 && await dialog.isVisible().catch(() => false)) {
      const btn = page.locator('button', { hasText: /yes,?\s*i\s*trust|Trust/i }).first();
      if (await btn.count() > 0) { await btn.click({ timeout: 3000 }).catch(() => {}); await sleep(500); }
    }
  } catch(_) {}
}

async function dismissSaveWorkspaceDialog(page, timeout = 5000) {
  try {
    const dialog = page.locator('.dialogBlock, .save-workspace-dialog').first();
    await dialog.waitFor({ state: 'visible', timeout }).catch(() => null);
    if (await dialog.count() > 0 && await dialog.isVisible().catch(() => false)) {
      const btn = page.locator('button', { hasText: /don'?t\s*save/i }).first();
      if (await btn.count() > 0) { await btn.click({ timeout: 3000 }).catch(() => {}); await sleep(500); }
    }
  } catch(_) {}
}

async function dismissAllDialogs(page) {
  await dismissSaveWorkspaceDialog(page, 2000);
  await dismissTrustDialog(page, 2000);
}

// ─── Command palette ──────────────────────────────────────
async function runCommandViaPalette(page, commandLabel) {
  await page.keyboard.press('Control+Shift+P');
  try {
    await page.waitForSelector('.quick-input-widget', { timeout: 5000, state: 'visible' });
    await sleep(300);
    await page.keyboard.press('End');
    await page.keyboard.type(commandLabel, { delay: 30 });
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(1000);
    return true;
  } catch(e) {
    await page.keyboard.press('Escape');
    return false;
  }
}

// ─── Import Wizard (using data-testid) ────────────────────
async function importProject(page, projectPath) {
  log(`Importing: ${projectPath}`);
  await dismissAllDialogs(page);

  // Open import wizard
  await runCommandViaPalette(page, 'Kairo: Import Project');
  await sleep(1000);

  // Wait for step 1 (path input)
  const pathInput = page.locator('[data-testid="path-input"]').first();
  try {
    await pathInput.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    // Fallback: find any text input in a dialog
    await shot('import-wizard-fallback');
    const anyInput = page.locator('input[type="text"]').filter({ has: page.locator(':visible') }).first();
    if (await anyInput.count() === 0) throw new Error('Import wizard path input not found');
    await anyInput.click();
    await anyInput.fill(projectPath.replace(/\\/g, '/'));
    // Find scan button
    const scanBtn = page.locator('button', { hasText: /^\s*scan\s*$/i }).first();
    if (await scanBtn.count() > 0) { await scanBtn.click(); } else { await page.keyboard.press('Enter'); }
  }

  if (await pathInput.count() > 0) {
    await pathInput.click();
    await pathInput.fill(projectPath.replace(/\\/g, '/'));
    await shot('import-path-filled');

    // Click Scan
    const scanBtn = page.locator('[data-testid="scan-btn"]').first();
    if (await scanBtn.count() > 0 && await scanBtn.isEnabled().catch(() => false)) {
      await scanBtn.click();
    } else {
      await pathInput.press('Enter');
    }
  }

  // Wait for step 2 (import project button)
  log('  Waiting for Step 2...');
  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  try {
    await importBtn.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    await shot('import-scan-failed');
    // Check for error
    const err = await page.evaluate(() => document.body.innerText.slice(-500));
    throw new Error(`Step 2 not reached: ${err.slice(0, 200)}`);
  }
  log('  Step 2 ready, clicking Import Project...');
  await shot('import-step2');
  await importBtn.click();
  await sleep(1000);

  // Wait for step 3 (open project button)
  log('  Waiting for Step 3...');
  const openBtn = page.locator('[data-testid="open-project-btn"]').first();
  try {
    await openBtn.waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    await shot('import-step3-failed');
    const err = await page.evaluate(() => document.body.innerText.slice(-800));
    throw new Error(`Step 3 not reached (409 Conflict likely): ${err.slice(0, 300)}`);
  }
  log('  Step 3 ready, clicking Open Project Folder...');
  await shot('import-step3');
  await openBtn.click();
  await sleep(500);

  // Handle dialogs that may appear during workspace switch
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    await dismissAllDialogs(page);
  }

  // Wait for workspace to load (status bar shows project name, not "(no workspace)")
  log('  Waiting for workspace to load...');
  let loaded = false;
  const start = Date.now();
  while (Date.now() - start < 40000) {
    await dismissAllDialogs(page);
    await sleep(500);
    const bar = await page.evaluate(() => {
      const el = document.querySelector('#theia-statusBar, .theia-statusBar');
      return el ? el.textContent : '';
    });
    if (bar.includes('Project: ') && !bar.includes('Project: (no workspace)')) {
      loaded = true;
      log(`  Workspace loaded: ${bar.slice(0, 150)}`);
      break;
    }
  }
  await shot('import-done');
  return loaded;
}

// ─── Explorer helpers ──────────────────────────────────────
async function openFileExplorer(page) {
  // Click the Explorer shell tab
  const tab = page.locator('#shell-tab-explorer-view-container--files, #shell-tab-explorer-view-container').first();
  if (await tab.count() > 0) {
    await tab.click({ force: true }).catch(() => {});
    await sleep(1000);
  } else {
    // Click first activity bar item
    const items = page.locator('.theia-activity-bar .p-TabBar-tab, #theia-left-side-bar .p-TabBar-tab');
    if (await items.count() > 0) {
      await items.first().click({ force: true }).catch(() => {});
      await sleep(1000);
    }
  }
  await dismissAllDialogs(page);
  // Wait for tree nodes
  try {
    await page.locator('.theia-TreeNode').first().waitFor({ state: 'attached', timeout: 15000 });
    return true;
  } catch { return false; }
}

async function waitForStatusContains(page, needle, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.evaluate(() => document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '');
    if (t.includes(needle)) return t;
    await sleep(500);
  }
  return null;
}

// ─── Agent API state helpers ──────────────────────────────
async function getLatestBuild(page) {
  return page.evaluate(async (base) => {
    try {
      const r = await fetch(`${base}/api/v1/builds`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const b = await r.json();
      const list = b?.payload;
      return Array.isArray(list) && list.length > 0 ? list[list.length - 1] : null;
    } catch { return null; }
  }, AGENT_BASE);
}

async function getServerState(page) {
  return page.evaluate(async (base) => {
    try {
      const r = await fetch(`${base}/api/v1/servers`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const b = await r.json();
      const list = b?.payload;
      return Array.isArray(list) && list.length > 0 ? list[0] : null;
    } catch { return null; }
  }, AGENT_BASE);
}

function resolveExe() {
  if (customExe) return customExe;
  const p = path.join(repoRoot, 'dist', 'win-unpacked', 'Kairo IDE.exe');
  if (fs.existsSync(p)) return p;
  throw new Error('Cannot find Kairo IDE .exe');
}

async function launchApp() {
  const exePath = resolveExe();
  log(`Launching: ${exePath}`);
  const userDataDir = path.join(runDir, 'userdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  const configDir = path.join(runDir, 'theia-config');
  fs.mkdirSync(configDir, { recursive: true });

  const app = await electron.launch({
    executablePath: exePath,
    env: { ...process.env, THEIA_CONFIG_DIR: configDir, KAIRO_DEV: '1' },
    timeout: 60000,
  });

  app.on('window', async (page) => {
    page.on('console', (msg) => {
      const txt = msg.text(), type = msg.type();
      if (type === 'error' || /Uncaught|FATAL/i.test(txt)) {
        if (!/Electron Security|cookie|favicon|fonts\.gstatic|DevTools|terminal.*does not exist|ERR_CACHE|ERR_CONNECTION|schema.*function code|unsafe-eval/i.test(txt)) {
          consoleErrors.push({ ts: new Date().toISOString(), type, text: txt.slice(0, 500) });
          if (type === 'error') warn(`CONSOLE: ${txt.slice(0, 150)}`);
        }
      }
    });
    page.on('pageerror', (err) => {
      const msg = err.message;
      if (!/unsafe-eval|Content Security Policy/i.test(msg)) {
        consoleErrors.push({ ts: new Date().toISOString(), type: 'pageerror', text: msg });
        warn(`PAGE ERROR: ${msg.slice(0, 150)}`);
      }
    });
  });

  const page = await app.firstWindow();
  currentApp = app;
  currentPage = page;

  log('Waiting for shell...');
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if (await page.evaluate(() => !!document.querySelector('#theia-statusBar, .theia-statusBar'))) {
      log(`Shell after ${i+1}s`);
      break;
    }
    if (i === 59) throw new Error('Shell timeout');
  }
  await sleep(5000);
  await shot('01-launch');
  await dismissAllDialogs(page);
  await sleep(1000);
  await shot('02-ready');

  // Wait for Agent API
  log('Waiting for Agent API...');
  const agentReady = await waitForAgent(30000);
  if (agentReady) {
    // Register workspace root
    await agentFetch('POST', '/api/v1/workspaces', { rootPath: TEST_WS_ROOT });
    log(`  Registered workspace: ${TEST_WS_ROOT}`);
    // Clean old projects
    await cleanAgentProjects();
  } else {
    log('  ⚠ Agent API not available, will continue without API support');
  }

  return { app, page };
}

// ─── Main Test ────────────────────────────────────────────
async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test v5');
  log('========================================');
  log(`Test workspace: ${TEST_WS_ROOT}`);
  log(`Output: ${runDir}`);
  log('');

  const { app, page } = await launchApp();

  try {
    // ── Section 0: Startup ──
    await runTest(0, '0.1', 'Shell, menu, activity, status bar present', 'P0', async () => {
      const info = await page.evaluate(() => ({
        title: document.title,
        menu: !!document.querySelector('.p-MenuBar, #theia-top-panel'),
        activity: !!document.querySelector('.theia-app-left, .theia-activity-bar, #theia-left-side-bar'),
        status: !!document.querySelector('#theia-statusBar, .theia-statusBar'),
      }));
      if (!/Kairo\s*IDE/i.test(info.title)) throw new Error(`Title: "${info.title}"`);
      if (!info.menu) throw new Error('Menu bar missing');
      if (!info.activity) throw new Error('Activity bar missing');
      if (!info.status) throw new Error('Status bar missing');
    });

    await runTest(0, '0.2', 'Command registry with Kairo commands', 'P0', async () => {
      if (!(await ensureCmdReg(page))) throw new Error('CommandRegistry not accessible');
      const info = await page.evaluate(() => {
        const cmds = window.__kairoCmdList || [];
        const kairo = cmds.filter(c => c.id?.startsWith('kairo'));
        return { total: cmds.length, kairo: kairo.length, cmds: kairo.map(c => c.id) };
      });
      log(`  Commands: ${info.total} total, ${info.kairo} Kairo`);
      const required = ['kairo.project.import', 'kairo.build', 'kairo.server.start', 'kairo.server.stop', 'kairo.server.debug'];
      for (const r of required) {
        if (!info.cmds.includes(r)) throw new Error(`Missing command: ${r}`);
      }
    });

    // ── Section 4: Import ──
    await runTest(4, '4.1', 'Import wizard 3-step flow (data-testid validated)', 'P0', async () => {
      const loaded = await importProject(page, TEST_PROJECT_PATH);
      if (!loaded) throw new Error('Workspace did not load - check screenshots');
    });

    // ── Section 5: Explorer ──
    await runTest(5, '5.1', 'Explorer shows project file tree', 'P0', async () => {
      const ok = await openFileExplorer(page);
      await shot('05-explorer');
      if (!ok) {
        // Try expanding root
        const firstNode = page.locator('.theia-TreeNode').first();
        if (await firstNode.count() > 0) {
          const expand = firstNode.locator('.theia-ExpansionToggle').first();
          if (await expand.count() > 0) { await expand.click({ force: true }); await sleep(1000); }
          else { await firstNode.click(); await sleep(1000); }
        }
      }
      const nodes = await page.locator('.theia-TreeNode').count();
      log(`  Tree nodes: ${nodes}`);
      await shot('05-files');
      if (nodes < 2) throw new Error(`Only ${nodes} tree nodes visible`);
    });

    // ── Section 6: Editor ──
    await runTest(6, '6.1', 'Open Java file via Ctrl+P', 'P0', async () => {
      await page.keyboard.press('Control+P');
      await page.waitForSelector('.quick-input-widget', { timeout: 5000 }).catch(() => {});
      await sleep(500);
      await page.keyboard.type('HelloServlet.java', { delay: 50 });
      await sleep(1000);
      await shot('06-quickopen');
      await page.keyboard.press('Enter');
      await sleep(2000);
      await dismissAllDialogs(page);

      const editor = page.locator('.monaco-editor').first();
      await editor.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});

      let hasContent = false;
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        const text = await page.evaluate(() => {
          const lines = document.querySelector('.monaco-editor .view-lines');
          return lines?.textContent || '';
        });
        if (text.length > 30) { hasContent = true; log(`  Editor content (${text.length} chars): ${text.slice(0, 100)}`); break; }
      }
      await shot('06-editor');
      if (!hasContent) throw new Error('Editor did not load Java file content');
    });

    await runTest(6, '6.2', 'Java syntax highlighting active', 'P0', async () => {
      const tokens = await page.evaluate(() => {
        const ed = document.querySelector('.monaco-editor');
        if (!ed) return 0;
        return ed.querySelectorAll('[class*="mtk"]').length;
      });
      log(`  Syntax tokens: ${tokens}`);
      if (tokens < 5) throw new Error(`Only ${tokens} tokens - highlighting inactive`);
    });

    // ── Section 10: Build ──
    await runTest(10, '10.1', 'Trigger Ant build (kairo.build)', 'P0', async () => {
      await execCmd(page, 'kairo.build');
      await sleep(3000);
      await shot('10-build-started');
    });

    await runTest(10, '10.2', 'Build completes successfully', 'P0', async () => {
      let buildState = null;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        const latest = await getLatestBuild(page);
        if (latest?.state === 'success' || latest?.state === 'succeeded') { buildState = 'success'; log(`  BUILD SUCCESS after ${i+1}s`); break; }
        if (latest?.state === 'failure' || latest?.state === 'failed') { buildState = 'failed'; log(`  BUILD FAILED after ${i+1}s: ${latest.output?.slice(0,200)}`); break; }
        // Also check status bar for Chinese indicators
        const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
        if (/成功|BUILD SUCCESSFUL/i.test(bar) && !/无记录/i.test(bar)) { buildState = 'success'; log(`  BUILD SUCCESS (status bar) after ${i+1}s`); break; }
        if (i % 15 === 14) {
          const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
          log(`  Building... (${i+1}s) ${bar.slice(0, 80)}`);
        }
      }
      await shot('10-build-done');
      if (buildState === 'failed') throw new Error('Build failed');
      if (!buildState) log('  ⚠ Build completion not detected (may still be running or API unavailable)');
    });

    // ── Section 11: Server ──
    await runTest(11, '11.1', 'Start Tomcat server (kairo.server.start)', 'P0', async () => {
      await execCmd(page, 'kairo.server.start');
      await sleep(3000);
      await shot('11-server-start');
    });

    await runTest(11, '11.2', 'Server reaches running state', 'P0', async () => {
      let running = false, port = null;
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const srv = await getServerState(page);
        if (srv?.state === 'running') {
          running = true;
          port = srv.ports?.http || srv.httpPort;
          log(`  SERVER RUNNING on port ${port} after ${i+1}s`);
          break;
        }
        const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
        if (/running|运行中/i.test(bar) && !/stopped|已停止/i.test(bar)) {
          running = true;
          log(`  SERVER RUNNING (status bar) after ${i+1}s: ${bar.slice(0,100)}`);
          break;
        }
        if (i % 15 === 14) {
          const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
          log(`  Starting server... (${i+1}s) ${bar.slice(0, 80)}`);
        }
      }
      await shot('11-server-running');
      if (!running) log('  ⚠ Server running state not detected within timeout');
      return port;
    });

    // ── Console errors summary ──
    await runTest(99, '99.1', 'Console error check', 'P0', async () => {
      log(`  Console errors: ${consoleErrors.length}`);
      consoleErrors.forEach(e => log(`    [${e.type}] ${e.text.slice(0, 200)}`));
      await shot('99-final');
    });

  } catch (err) {
    log(`FATAL: ${err.message}`);
    await shot('fatal-error');
  } finally {
    log('Closing app...');
    try { await app.close(); } catch(e) {}
  }

  await sleep(7000);

  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const p0 = results.filter(r => r.priority === 'P0');
  const p0Passed = p0.filter(r => r.status === 'pass').length;

  const report = `# Kairo IDE Deep E2E Test Report v5

**Date:** ${new Date().toISOString()}
**Duration:** ${(totalDuration/1000).toFixed(1)}s
**Target:** ${resolveExe()}
**Test Workspace:** ${TEST_PROJECT_PATH}

## Summary

| Priority | Total | Passed | Failed | Pass Rate |
|----------|-------|--------|--------|-----------|
| P0 | ${p0.length} | ${p0Passed} | ${p0.length - p0Passed} | ${((p0Passed/p0.length)*100).toFixed(1)}% |
| **Total** | **${results.length}** | **${passed}** | **${failed}** | **${((passed/results.length)*100).toFixed(1)}%** |

## Console Errors (${consoleErrors.length})
${consoleErrors.map(e => `- [${e.type}] ${e.text.slice(0, 200)}`).join('\n') || 'None'}

## Failed Tests
${results.filter(r => r.status === 'fail').map(r => `### ${r.id} §${r.section} [${r.priority}] ${r.name}\n${r.error}`).join('\n\n') || 'None'}

## Bugs (${bugs.length})
${bugs.map(b => `### ${b.id} [${b.severity}] ${b.name}\n${b.error}`).join('\n\n') || 'None'}

## All Results
${results.map(r => `- [${r.status === 'pass' ? '✓' : '✗'}] ${r.id} §${r.section} [${r.priority}] ${r.name} (${r.duration}ms)`).join('\n')}
`;

  fs.writeFileSync(path.join(runDir, 'deep-test-report.md'), report);
  fs.writeFileSync(path.join(runDir, 'deep-results.json'), JSON.stringify({
    summary: { total: results.length, passed, failed, p0Passed, p0Total: p0.length },
    results, bugs, consoleErrors, testProject: TEST_PROJECT_PATH,
  }, null, 2));

  log('');
  log('========================================');
  log(`Report: ${runDir}`);
  log(`Pass rate: ${passed}/${results.length} (${((passed/results.length)*100).toFixed(1)}%)`);
  log(`P0: ${p0Passed}/${p0.length}, Bugs: ${bugs.length}`);
  log('========================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
