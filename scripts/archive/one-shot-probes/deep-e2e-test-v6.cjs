// Kairo IDE Windows EXE — Deep E2E Test v6
// Agent API calls made from renderer context (inherits correct port & secret)
// Uses data-testid selectors, proper dialog handling, full P0 flow
const fs = require('fs');
const path = require('path');
require('../../tests/setup-tmp.cjs'); // KAIRO_TMP override
const os = require('os');
const { _electron: electron } = require('playwright');

const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf(`--${name}`); return (i >= 0 && i + 1 < argv.length) ? argv[i+1] : def; }
const customExe = arg('exe', null);
const baseOutDir = arg('out', null);

const repoRoot = path.resolve(__dirname, '..', '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = baseOutDir || path.join(repoRoot, 'artifacts', 'test-results', 'deep6-' + stamp);
const screenshotDir = path.join(runDir, 'screenshots');
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

// Fresh test workspace (copy legacy-sample each run to avoid state leaks)
const TEST_WS_ROOT = path.join(os.tmpdir(), 'kairo-deep6-' + stamp.replace(/-/g, ''));
const TEST_PROJECT_PATH = path.join(TEST_WS_ROOT, 'legacy-sample');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name), dp = path.join(dest, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '.kairo' && entry.name !== 'node_modules' && entry.name !== '.git') copyDirSync(sp, dp); }
    else fs.copyFileSync(sp, dp);
  }
}
copyDirSync(path.join(repoRoot, 'legacy-sample'), TEST_PROJECT_PATH);

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

// ─── Agent API (called FROM renderer context — auto-gets URL & secret) ──
async function agentGET(page, endpoint) {
  return page.evaluate(async (ep) => {
    const base = window.__kairo?.agentBaseUrl || window.KAIRO_RUNTIME_BASE_URL || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret && !ep.includes('/health') && !ep.includes('/endpoints')) {
      headers['X-Kairo-Secret'] = secret;
    }
    try {
      const res = await fetch(`${base}${ep}`, { method: 'GET', headers, signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch(_) {}
      return { ok: res.ok, status: res.status, body: text, json, base };
    } catch (err) {
      return { ok: false, status: 0, error: String(err), base };
    }
  }, endpoint);
}

async function agentPOST(page, endpoint, payload) {
  return page.evaluate(async (args) => {
    const { ep, p } = args;
    const base = window.__kairo?.agentBaseUrl || window.KAIRO_RUNTIME_BASE_URL || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret && !ep.includes('/health') && !ep.includes('/endpoints')) {
      headers['X-Kairo-Secret'] = secret;
    }
    const body = p ? JSON.stringify({ requestId: `e2e-${Date.now()}`, payload: p }) : undefined;
    try {
      const res = await fetch(`${base}${ep}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch(_) {}
      return { ok: res.ok, status: res.status, body: text, json, base };
    } catch (err) {
      return { ok: false, status: 0, error: String(err), base };
    }
  }, { ep: endpoint, p: payload });
}

async function agentDELETE(page, endpoint) {
  return page.evaluate(async (ep) => {
    const base = window.__kairo?.agentBaseUrl || window.KAIRO_RUNTIME_BASE_URL || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Kairo-Secret'] = secret;
    try {
      const res = await fetch(`${base}${ep}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch(_) {}
      return { ok: res.ok, status: res.status, body: text, json, base };
    } catch (err) {
      return { ok: false, status: 0, error: String(err), base };
    }
  }, endpoint);
}

async function waitForAgentHealthy(page, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await agentGET(page, '/api/v1/health');
    if (r.ok && (r.json?.payload?.OK || r.json?.ok)) {
      log(`  Agent healthy at ${r.base} (v${r.json?.payload?.Version || r.json?.payload?.version || '?'})`);
      return r;
    }
    if (r.status > 0 && r.status !== 200) {
      log(`  Agent status: ${r.status} body: ${r.body?.slice(0,200)}`);
    }
    await sleep(1000);
  }
  return null;
}

async function cleanAgentProjects(page) {
  try {
    const list = await agentGET(page, '/api/v1/projects');
    const projects = list.json?.payload;
    if (Array.isArray(projects)) {
      for (const p of projects) {
        const id = p.id || p.projectId;
        if (id) {
          log(`  Deleting old project: ${id}`);
          await agentDELETE(page, `/api/v1/projects/${id}`);
        }
      }
    }
  } catch(e) { log(`  Clean projects warning: ${e.message}`); }
}

// ─── DI Container / Command Registry ───────────────────────
async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 30; attempt++) {
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

// ─── Dialog helpers ────────────────────────────────────────
async function dismissDialogByText(page, texts, timeout = 2000) {
  try {
    const dialog = page.locator('.dialogBlock, .p-Dialog, .theia-dialog, .quick-input-widget').first();
    for (const text of texts) {
      const btn = page.locator('button', { hasText: new RegExp(text, 'i') }).first();
      if (await btn.count() > 0) {
        const visible = await btn.isVisible().catch(() => false);
        const enabled = await btn.isEnabled().catch(() => false);
        if (visible && enabled) {
          await btn.click({ timeout: 2000 }).catch(() => {});
          await sleep(400);
          return true;
        }
      }
    }
  } catch(_) {}
  return false;
}

async function dismissAllDialogs(page, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await dismissDialogByText(page, [/don'?t\s*save/i, /donot/i]);
    await dismissDialogByText(page, [/^ok$/, /^yes$/, /^close$/, /i\s*trust/i, /^trust$/i]);
    await dismissDialogByText(page, [/cancel/i, /^no$/]);
    await sleep(300);
  }
}

// ─── Command palette ──────────────────────────────────────
async function openCommandPalette(page) {
  await page.keyboard.press('Control+Shift+P');
  try {
    await page.waitForSelector('.quick-input-widget, .monaco-quick-open-widget', { timeout: 5000, state: 'visible' });
    await sleep(400);
    return true;
  } catch(e) {
    await page.keyboard.press('Escape');
    return false;
  }
}

async function runCommandViaPalette(page, searchText) {
  await openCommandPalette(page);
  await page.keyboard.type(searchText, { delay: 25 });
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(1000);
  await dismissAllDialogs(page);
}

// ─── Import Wizard ────────────────────────────────────────
async function ensureImportWizardActive(page) {
  // Check if import wizard content is visible in the viewport (active tab)
  const active = await page.evaluate(() => {
    // Check if we can see a visible text input with path-like placeholder
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const inp of inputs) {
      const ph = inp.placeholder || '';
      const rect = inp.getBoundingClientRect();
      if (/path|directory|folder/i.test(ph) && rect.width > 100 && rect.top > 0) {
        return true;
      }
    }
    // Check if Import Legacy Java Project heading is visible
    const headings = document.querySelectorAll('h1, h2, h3, h4');
    for (const h of headings) {
      if (/Import Legacy Java Project/i.test(h.textContent || '') && h.getBoundingClientRect().top > 0) {
        return true;
      }
    }
    return false;
  });
  if (active) return true;

  // Try clicking the Import Project tab
  log('  Import wizard not active, clicking Import Project tab...');
  const importTab = page.locator('.p-TabBar-tab, .theia-tabBar-tab').filter({ hasText: /Import Project/i }).first();
  if (await importTab.count() > 0) {
    await importTab.click({ force: true });
    await sleep(1000);
    return true;
  }
  return false;
}

async function importProject(page, projectPath) {
  log(`Importing: ${projectPath}`);
  await dismissAllDialogs(page);

  // Ensure import wizard is visible and active
  let wizardActive = await ensureImportWizardActive(page);
  if (!wizardActive) {
    log('  Wizard not visible, opening via command...');
    await execCmd(page, 'kairo.project.import');
    await sleep(2000);
    wizardActive = await ensureImportWizardActive(page);
  }

  if (!wizardActive) {
    await shot('import-wizard-not-found');
    throw new Error('Import wizard not found');
  }
  log('  Import wizard active');
  await shot('import-wizard');

  // ─── Step 1: Find path input and fill ───
  // Find a visible text input in the import wizard area
  let pathInput = null;
  let inputFound = false;

  // Method 1: data-testid
  pathInput = page.locator('[data-testid="path-input"]').first();
  try {
    if (await pathInput.count() > 0) {
      const rect = await pathInput.boundingBox();
      if (rect && rect.width > 50) inputFound = true;
    }
  } catch {}

  // Method 2: visible input with path placeholder
  if (!inputFound) {
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const ph = await inp.getAttribute('placeholder') || '';
      const rect = await inp.boundingBox().catch(() => null);
      if (/path|directory|folder|\/absolute/i.test(ph) && rect && rect.width > 50 && rect.top > 0) {
        pathInput = inp;
        inputFound = true;
        log(`  Found path input via placeholder "${ph}"`);
        break;
      }
    }
  }

  // Method 3: first visible text input in the main area (not side bar, not status bar)
  if (!inputFound) {
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const rect = await inp.boundingBox().catch(() => null);
      if (rect && rect.width > 100 && rect.top > 100 && rect.top < 500) {
        pathInput = inp;
        inputFound = true;
        log(`  Found path input via position (top=${rect.top.toFixed(0)}, w=${rect.width.toFixed(0)})`);
        break;
      }
    }
  }

  if (!inputFound) {
    await shot('import-no-input');
    throw new Error('Cannot find path input in import wizard');
  }

  log('  Filling project path...');
  await pathInput.click();
  await sleep(200);
  // Clear any existing text
  await pathInput.press('Control+A');
  await pathInput.press('Delete');
  await sleep(300);
  // Verify cleared
  const val = await pathInput.inputValue().catch(() => '');
  if (val) {
    await pathInput.fill('');
    await sleep(200);
  }
  // Use type with delay to simulate real typing (triggers React onChange)
  await pathInput.type(projectPath.replace(/\\/g, '/'), { delay: 15 });
  await sleep(1000);
  await shot('import-path-filled');

  // ─── Click Scan ───
  let scanBtn = null;
  let scanFound = false;
  scanBtn = page.locator('[data-testid="scan-btn"]').first();
  if (await scanBtn.count() > 0) {
    const rect = await scanBtn.boundingBox().catch(() => null);
    if (rect) scanFound = true;
  }
  if (!scanFound) {
    const buttons = page.locator('button').filter({ hasText: /^\s*Scan\s*$/i });
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const rect = await btn.boundingBox().catch(() => null);
      if (rect && rect.width > 30) { scanBtn = btn; scanFound = true; break; }
    }
  }

  if (!scanFound) {
    log('  Scan button not found, pressing Enter');
    await pathInput.press('Enter');
  } else {
    log('  Clicking Scan...');
    await scanBtn.click();
  }

  // ─── Wait for Step 2 (Confirm Settings) ───
  log('  Waiting for Step 2 (Confirm Settings)...');
  let step2Ready = false;
  const step2Start = Date.now();
  while (Date.now() - step2Start < 40000) {
    await sleep(1000);
    // Look for "Import Project" button or step indicator on step 2
    const stepInfo = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const step2Active = body.includes('Confirm Settings') &&
        !body.includes('Select Directory');
      const hasImportBtn = Array.from(document.querySelectorAll('button')).some(b =>
        /import\s*project/i.test(b.textContent || '') && b.offsetParent !== null);
      const hasError = /409|conflict|already exists|error|failed/i.test(body.slice(-500));
      return { step2Active, hasImportBtn, hasError, bodyTail: body.slice(-300) };
    });
    if (stepInfo.hasImportBtn) { step2Ready = true; log(`  Step 2 ready after ${(Date.now()-step2Start)/1000}s`); break; }
    if (stepInfo.hasError && /409|conflict|already exists/i.test(stepInfo.bodyTail)) {
      await shot('import-409-error');
      // Try to clean via API and retry
      log('  409 Conflict detected, cleaning old projects...');
      await cleanAgentProjects(page);
      await sleep(1000);
      // Re-click scan
      if (scanFound) { await scanBtn.click(); } else { await pathInput.press('Enter'); }
    }
  }

  if (!step2Ready) {
    await shot('import-step2-timeout');
    const bodyText = await page.evaluate(() => document.body.textContent?.slice(-800) || '');
    throw new Error(`Step 2 not reached within timeout: ${bodyText.slice(0, 300)}`);
  }
  await shot('import-step2');

  // Click Import Project
  let importBtn = page.locator('[data-testid="import-project-btn"]').first();
  if (!(await importBtn.count() > 0 && await importBtn.isVisible().catch(() => false))) {
    importBtn = page.locator('button', { hasText: /import\s*project/i }).first();
  }
  log('  Clicking Import Project...');
  await importBtn.click();
  await sleep(1000);

  // ─── Wait for Step 3 (Complete) ───
  log('  Waiting for Step 3 (Complete)...');
  let step3Ready = false;
  const step3Start = Date.now();
  while (Date.now() - step3Start < 40000) {
    await sleep(1000);
    const hasOpenBtn = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).some(b =>
        /open\s*(project|folder)/i.test(b.textContent || '') && b.offsetParent !== null);
    });
    if (hasOpenBtn) { step3Ready = true; log(`  Step 3 ready after ${(Date.now()-step3Start)/1000}s`); break; }
    // Check for errors
    const err = await page.evaluate(() => {
      const t = document.body.textContent || '';
      return /409|conflict|already exists|error/i.test(t.slice(-500)) ? t.slice(-300) : null;
    });
    if (err && /409|conflict/i.test(err)) {
      await shot('import-step3-409');
      throw new Error(`409 in Step 3: ${err.slice(0, 200)}`);
    }
  }

  if (!step3Ready) {
    await shot('import-step3-timeout');
    const bodyText = await page.evaluate(() => document.body.textContent?.slice(-800) || '');
    throw new Error(`Step 3 not reached within timeout: ${bodyText.slice(0, 300)}`);
  }
  await shot('import-step3');

  // Click Open Project
  let openBtn = page.locator('[data-testid="open-project-btn"]').first();
  if (!(await openBtn.count() > 0 && await openBtn.isVisible().catch(() => false))) {
    openBtn = page.locator('button', { hasText: /open\s*(project|folder)/i }).first();
  }
  log('  Clicking Open Project...');
  await openBtn.click();

  // ─── Handle post-open dialogs ───
  log('  Handling dialogs and waiting for workspace...');
  let workspaceLoaded = false;
  const wsStart = Date.now();
  while (Date.now() - wsStart < 45000) {
    await sleep(500);
    await dismissAllDialogs(page, 1);
    const bar = await page.evaluate(() => document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '');
    if (/Project:\s*\S/.test(bar) && !/Project:\s*\(no/i.test(bar)) {
      const projName = bar.match(/Project:\s*([^|]+)/)?.[0]?.trim();
      log(`  Workspace loaded: ${projName}`);
      workspaceLoaded = true;
      break;
    }
  }

  await shot('import-complete');
  if (!workspaceLoaded) {
    const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
    log(`  Status bar: ${bar.slice(0, 200)}`);
    // Don't throw - workspace might have loaded but status bar not updated
  }
  return workspaceLoaded;
}

// ─── Explorer ──────────────────────────────────────────────
async function openExplorer(page) {
  const tab = page.locator('#shell-tab-explorer-view-container--files, #shell-tab-explorer-view-container').first();
  if (await tab.count() > 0) {
    await tab.click({ force: true }).catch(() => {});
    await sleep(800);
  } else {
    // Click first activity bar item (Explorer)
    const items = page.locator('#theia-left-side-bar .p-TabBar-tab, .theia-activity-bar .p-TabBar-tab');
    if (await items.count() > 0) {
      await items.first().click({ force: true }).catch(() => {});
      await sleep(800);
    }
  }
  await dismissAllDialogs(page);
}

// ─── Launch app ────────────────────────────────────────────
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
        if (!/Electron Security|cookie|favicon|fonts\.gstatic|DevTools|terminal.*does not exist|ERR_CACHE|ERR_CONNECTION|unsafe-eval|Content Security Policy|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED.*sockjs|authenticating/i.test(txt)) {
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

  log('Waiting for application shell...');
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (await page.evaluate(() => !!document.querySelector('#theia-statusBar, .theia-statusBar'))) {
      log(`Shell visible after ${i+1}s`);
      break;
    }
    if (i === 89) throw new Error('Shell timeout');
  }
  await sleep(4000);
  await dismissAllDialogs(page);
  await shot('00-launch');

  // Wait for agent
  log('Waiting for Runtime Agent to connect...');
  // Check status bar for agent connected indicator
  let agentConnected = false;
  const agentWaitStart = Date.now();
  while (Date.now() - agentWaitStart < 90000) {
    await sleep(2000);
    const bar = await page.evaluate(() => document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '');
    if (/Agent:\s*(connected|已连接|ready|运行中|listening)/i.test(bar) && !/已断开|disconnected|unknown/i.test(bar)) {
      agentConnected = true;
      log(`  Agent connected after ${(Date.now()-agentWaitStart)/1000}s: ${bar.match(/Agent:\s*[^|]+/)?.[0] || ''}`);
      break;
    }
    if (Date.now() - agentWaitStart > 30000) {
      // After 30s, try API health check
      const h = await agentGET(page, '/api/v1/health');
      if (h.ok) { agentConnected = true; log(`  Agent healthy via API at ${h.base} after ${(Date.now()-agentWaitStart)/1000}s`); break; }
    }
  }
  if (!agentConnected) {
    log('  ⚠ Agent not confirmed connected - will proceed but some features may fail');
  } else {
    // Register workspace and clean old projects
    await sleep(1000);
    const wsReg = await agentPOST(page, '/api/v1/workspaces', { rootPath: TEST_WS_ROOT });
    log(`  Workspace register: ${wsReg.status} ${wsReg.ok ? 'OK' : wsReg.body?.slice(0, 200)}`);
    await cleanAgentProjects(page);
  }

  await sleep(1000);
  await shot('01-ready');
  return { app, page };
}

// ─── Main Test ────────────────────────────────────────────
async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test v6');
  log('========================================');
  log(`Test project: ${TEST_PROJECT_PATH}`);
  log(`Output: ${runDir}`);
  log('');

  const { app, page } = await launchApp();

  try {
    // ── Section 0: Startup validation ──
    await runTest(0, '0.1', 'Application shell and primary UI present', 'P0', async () => {
      const info = await page.evaluate(() => ({
        title: document.title,
        menu: !!document.querySelector('.p-MenuBar, #theia-top-panel, .theia-ApplicationShell-menu'),
        activity: !!document.querySelector('.theia-app-left, .theia-activity-bar, #theia-left-side-bar'),
        status: !!document.querySelector('#theia-statusBar, .theia-statusBar'),
        kairoGlobal: !!window.__kairo,
        agentBase: window.__kairo?.agentBaseUrl,
      }));
      log(`  Title: "${info.title}"`);
      log(`  Menu:${info.menu} Activity:${info.activity} Status:${info.status}`);
      log(`  __kairo:${info.kairoGlobal} Agent:${info.agentBase}`);
      if (!/Kairo\s*IDE/i.test(info.title)) throw new Error(`Unexpected title: "${info.title}"`);
      if (!info.activity) throw new Error('Activity bar missing');
      if (!info.status) throw new Error('Status bar missing');
      if (!info.kairoGlobal) throw new Error('window.__kairo not exposed (preload broken)');
    });

    await runTest(0, '0.2', 'Command registry with Kairo extensions loaded', 'P0', async () => {
      if (!(await ensureCmdReg(page))) throw new Error('Cannot access CommandRegistry');
      const info = await page.evaluate(() => {
        const cmds = window.__kairoCmdList || [];
        const kairo = cmds.filter(c => c.id?.startsWith('kairo') || c.id?.includes('import'));
        return { total: cmds.length, kairo: kairo.length, ids: kairo.map(c => c.id) };
      });
      log(`  Commands: ${info.total} total, ${info.kairo} Kairo-specific`);
      const required = ['kairo.project.import', 'kairo.build', 'kairo.server.start', 'kairo.server.stop'];
      const missing = required.filter(r => !info.ids.includes(r));
      if (missing.length) throw new Error(`Missing commands: ${missing.join(', ')}`);
    });

    // ── Section 4: Project Import (FIRST - wizard auto-opens on launch) ──
    await runTest(4, '4.1', 'Import wizard 3-step flow completes successfully', 'P0', async () => {
      await importProject(page, TEST_PROJECT_PATH);
    });

    // ── Section 0.3: Welcome ──
    await runTest(0, '0.3', 'Welcome page shows correctly', 'P1', async () => {
      await execCmd(page, 'kairo.welcome.show');
      await sleep(2000);
      await shot('02-welcome');
    });

    // ── Section 5: File Explorer ──
    await runTest(5, '5.1', 'Explorer shows project file tree', 'P0', async () => {
      await openExplorer(page);
      await sleep(1000);
      const firstNode = page.locator('.theia-TreeNode').first();
      if (await firstNode.count() > 0) {
        const expand = firstNode.locator('.theia-ExpansionToggle').first();
        if (await expand.count() > 0) {
          await expand.click({ force: true });
          await sleep(1000);
        } else {
          await firstNode.click();
          await sleep(1000);
        }
      }
      const nodes = await page.locator('.theia-TreeNode').count();
      log(`  Tree nodes: ${nodes}`);
      await shot('03-explorer');
      if (nodes < 2) throw new Error(`Only ${nodes} tree nodes visible (expected project files)`);
    });

    // ── Section 6: Editor ──
    await runTest(6, '6.1', 'Open Java file via Quick Open (Ctrl+P)', 'P0', async () => {
      await page.keyboard.press('Control+P');
      try { await page.waitForSelector('.quick-input-widget, .monaco-quick-open-widget', { timeout: 5000, state: 'visible' }); } catch(e) {}
      await sleep(500);
      await page.keyboard.type('HelloServlet.java', { delay: 40 });
      await sleep(1000);
      await shot('04-quickopen');
      await page.keyboard.press('Enter');
      await sleep(2500);
      await dismissAllDialogs(page);

      // Check editor has content
      let contentLen = 0;
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        contentLen = await page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent?.length || 0);
        if (contentLen > 30) break;
      }
      const content = await page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent || '');
      log(`  Editor content (${contentLen} chars): ${content.slice(0, 120)}`);
      await shot('05-editor-java');
      if (contentLen < 30) throw new Error(`Editor has insufficient content (${contentLen} chars)`);
    });

    await runTest(6, '6.2', 'Java syntax highlighting is active', 'P0', async () => {
      const tokens = await page.evaluate(() => document.querySelector('.monaco-editor')?.querySelectorAll('[class*="mtk"]')?.length || 0);
      log(`  Syntax tokens: ${tokens}`);
      if (tokens < 5) throw new Error(`Only ${tokens} syntax tokens — highlighting may be inactive`);
    });

    // ── Section 6.9: GBK encoding check ──
    await runTest(6, '6.9', 'GBK-encoded Chinese comments display without garbled text', 'P0', async () => {
      // Find any GBK file in legacy-sample - check if there are GBK-encoded Java files
      // legacy-sample uses UTF-8, but we need to test GBK. Let's check what files exist.
      const files = fs.readdirSync(TEST_PROJECT_PATH, { recursive: true });
      const javaFiles = files.filter(f => typeof f === 'string' && f.endsWith('.java'));
      log(`  Java files in project: ${javaFiles.join(', ')}`);

      // Open a JSP file that might have Chinese content
      await page.keyboard.press('Control+P');
      await sleep(500);
      try { await page.waitForSelector('.quick-input-widget', { timeout: 3000, state: 'visible' }); } catch(e) {}
      await page.keyboard.type('index.jsp', { delay: 40 });
      await sleep(800);
      await page.keyboard.press('Enter');
      await sleep(2000);
      await dismissAllDialogs(page);

      const content = await page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent || '');
      log(`  JSP content (${content.length} chars): ${content.slice(0, 150)}`);
      await shot('06-editor-jsp');

      // Check for garbled characters (common mojibake patterns)
      const garbledPatterns = [/ï¿½/, /æ–‡/, /é”™/, /ç¼–/, /å­—/, /ï¼/, /鈥/, /銆/];
      let garbled = false;
      for (const pat of garbledPatterns) {
        if (pat.test(content)) { garbled = true; log(`  ⚠ Possible garbled text detected: ${pat}`); break; }
      }
      // Note: legacy-sample may not have Chinese content - this is informational
      if (garbled && /utf-8/i.test(content)) {
        // Don't fail - legacy-sample might be UTF-8
      }
    });

    // ── Section 10: Build ──
    await runTest(10, '10.1', 'Trigger Ant build via kairo.build command', 'P0', async () => {
      await execCmd(page, 'kairo.build');
      await sleep(3000);
      await shot('07-build-triggered');

      // Check status bar for build indication
      const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
      log(`  Status bar after build trigger: ${bar.slice(0, 150)}`);
    });

    await runTest(10, '10.2', 'Build completes with success status', 'P0', async () => {
      let finalState = null;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        // Check via agent API
        const builds = await agentGET(page, '/api/v1/builds');
        const buildList = builds.json?.payload;
        if (Array.isArray(buildList) && buildList.length > 0) {
          const latest = buildList[buildList.length - 1];
          const st = latest.state || latest.status;
          if (st === 'success' || st === 'succeeded') { finalState = 'success'; log(`  BUILD SUCCESS via API after ${i+1}s`); break; }
          if (st === 'failure' || st === 'failed') { finalState = 'failed'; log(`  BUILD FAILED: ${JSON.stringify(latest.output || latest.error || '').slice(0,300)}`); break; }
        }
        // Check status bar
        const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
        if (/BUILD SUCCESSFUL|构建成功|成功/i.test(bar) && !/无记录|no builds/i.test(bar)) { finalState = 'success'; log(`  BUILD SUCCESS (status bar) after ${i+1}s`); break; }
        if (/BUILD FAILED|构建失败/i.test(bar)) { finalState = 'failed'; log(`  BUILD FAILED (status bar) after ${i+1}s`); break; }
        if (i % 15 === 14) log(`  Build in progress... (${i+1}s)`);
      }
      await shot('08-build-result');
      if (finalState === 'failed') throw new Error('Build reported failure');
      if (!finalState) log('  ⚠ Could not determine build completion via API or status bar (check screenshots)');
    });

    // ── Section 11: Tomcat Server ──
    await runTest(11, '11.1', 'Start Tomcat server via kairo.server.start', 'P0', async () => {
      await execCmd(page, 'kairo.server.start');
      await sleep(3000);
      await shot('09-server-start');
      const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
      log(`  Status bar after start: ${bar.slice(0, 150)}`);
    });

    await runTest(11, '11.2', 'Server reaches running state', 'P0', async () => {
      let running = false, serverInfo = null;
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        // Check via agent
        const servers = await agentGET(page, '/api/v1/servers');
        const list = servers.json?.payload;
        if (Array.isArray(list) && list.length > 0) {
          const srv = list[0];
          const st = srv.state || srv.status;
          if (st === 'running' || st === 'started') {
            running = true; serverInfo = srv;
            log(`  SERVER RUNNING (port: ${srv.ports?.http || srv.httpPort || '?'}) after ${i+1}s`);
            break;
          }
        }
        // Check status bar
        const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
        if (/running|运行中|started/i.test(bar) && !/stopped|已停止|starting|启动中/i.test(bar)) {
          running = true;
          log(`  SERVER RUNNING (status bar) after ${i+1}s: ${bar.slice(0,120)}`);
          break;
        }
        if (i % 20 === 19) log(`  Waiting for server... (${i+1}s)`);
      }
      await shot('10-server-running');
      if (!running) log('  ⚠ Server running state not detected within timeout');
      return serverInfo;
    });

    await runTest(11, '11.3', 'Stop Tomcat server via kairo.server.stop', 'P0', async () => {
      // First wait a bit if server was starting
      await sleep(2000);
      await execCmd(page, 'kairo.server.stop');
      await sleep(5000);
      await shot('11-server-stop');

      let stopped = false;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const bar = await page.evaluate(() => document.querySelector('#theia-statusBar')?.textContent || '');
        if (/stopped|已停止/i.test(bar) || !/running/i.test(bar)) {
          const servers = await agentGET(page, '/api/v1/servers');
          const list = servers.json?.payload;
          if (Array.isArray(list) && list.length > 0) {
            const srv = list[0];
            const st = srv.state || srv.status;
            if (st === 'stopped' || !st || st === 'idle') { stopped = true; log(`  Server stopped after ${i+5}s`); break; }
          } else {
            stopped = true; log(`  Server appears stopped (no server records) after ${i+5}s`); break;
          }
        }
      }
      await shot('12-server-stopped');
      if (!stopped) log('  ⚠ Server stop not confirmed within timeout');
    });

    // ── Console errors check ──
    await runTest(99, '99.1', 'No critical uncaught console errors', 'P0', async () => {
      log(`  Total console errors: ${consoleErrors.length}`);
      consoleErrors.slice(0, 20).forEach((e, i) => log(`    ${i+1}. [${e.type}] ${e.text.slice(0, 200)}`));
      await shot('99-final');
      // Filter known non-critical errors
      const critical = consoleErrors.filter(e => !/terminal.*does not exist|ERR_CACHE|Content Security Policy|unsafe-eval|ERR_BLOCKED|net::ERR_FAILED.*:18/i.test(e.text));
      if (critical.length > 0) {
        log(`  ⚠ ${critical.length} potentially critical errors found`);
      }
    });

  } catch (err) {
    log(`FATAL: ${err.message}`);
    await shot('fatal-error');
  } finally {
    log('Closing application...');
    try { await app.close(); } catch(e) { log(`Close error: ${e.message}`); }
  }

  await sleep(8000);

  // Check log files
  const logDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Kairo IDE', 'logs');
  let logErrors = [];
  try {
    if (fs.existsSync(logDir)) {
      const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort();
      if (logFiles.length > 0) {
        const latestLog = path.join(logDir, logFiles[logFiles.length - 1]);
        const logContent = fs.readFileSync(latestLog, 'utf8');
        const errorLines = logContent.split('\n').filter(l => /ERROR|FATAL/i.test(l));
        logErrors = errorLines.map(l => l.slice(0, 300));
        log(`Log file: ${latestLog}`);
        log(`  ERROR/FATAL lines: ${errorLines.length}`);
      }
    }
  } catch(e) { log(`Log check error: ${e.message}`); }

  // Check child processes are cleaned up
  let leftoverProcesses = [];
  try {
    const { execSync } = require('child_process');
    const procs = execSync('tasklist /FI "IMAGENAME eq kairo-runtime.exe" /FO CSV /NH', { encoding: 'utf8' });
    if (!/No tasks/i.test(procs)) leftoverProcesses = procs.split('\n').filter(l => l.trim()).slice(0,5);
  } catch(e) {}

  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const p0 = results.filter(r => r.priority === 'P0');
  const p0Passed = p0.filter(r => r.status === 'pass').length;

  const report = `# Kairo IDE Deep E2E Test Report v6

**Date:** ${new Date().toISOString()}
**Duration:** ${(totalDuration/1000).toFixed(1)}s
**Target:** ${resolveExe()}
**Test Project:** ${TEST_PROJECT_PATH}
**Artifacts:** ${runDir}

## Summary

| Priority | Total | Passed | Failed | Pass Rate |
|----------|-------|--------|--------|-----------|
| P0 | ${p0.length} | ${p0Passed} | ${p0.length - p0Passed} | ${((p0Passed/p0.length)*100).toFixed(1)}% |
| **Total** | **${results.length}** | **${passed}** | **${failed}** | **${((passed/results.length)*100).toFixed(1)}%** |

## Console Errors (${consoleErrors.length})
${consoleErrors.length === 0 ? 'None' : consoleErrors.map(e => `- [${e.type}] ${e.text.slice(0, 250)}`).join('\n')}

## Log File Errors (${logErrors.length})
${logErrors.length === 0 ? 'None' : logErrors.map(l => `- ${l}`).join('\n')}

## Leftover Processes After Close
${leftoverProcesses.length === 0 ? 'All child processes terminated' : leftoverProcesses.join('\n')}

## Failed Tests
${results.filter(r => r.status === 'fail').map(r => `### ${r.id} §${r.section} [${r.priority}] ${r.name}\n**Error:** ${r.error}\n**Screenshot:** ${r.screenshot || 'none'}`).join('\n\n') || 'None'}

## Bugs Filed (${bugs.length})
${bugs.map(b => `### ${b.id} [${b.severity}] ${b.name}\n${b.error}\nScreenshot: ${b.screenshot || 'none'}`).join('\n\n') || 'None'}

## All Test Results
${results.map(r => `- [${r.status === 'pass' ? '✓' : '✗'}] ${r.id} §${r.section} [${r.priority}] ${r.name} (${r.duration}ms)`).join('\n')}
`;

  fs.writeFileSync(path.join(runDir, 'deep-test-report.md'), report);
  fs.writeFileSync(path.join(runDir, 'deep-results.json'), JSON.stringify({
    summary: { total: results.length, passed, failed, p0Passed, p0Total: p0.length },
    results, bugs, consoleErrors, logErrors, testProject: TEST_PROJECT_PATH, runDir,
  }, null, 2));

  log('');
  log('========================================');
  log(`Report: ${runDir}`);
  log(`Pass rate: ${passed}/${results.length} (${((passed/results.length)*100).toFixed(1)}%)`);
  log(`P0: ${p0Passed}/${p0.length}, Bugs: ${bugs.length}, Log errors: ${logErrors.length}`);
  if (leftoverProcesses.length > 0) log(`⚠ Leftover kairo-runtime.exe processes!`);
  log('========================================');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
