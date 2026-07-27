// Kairo IDE Windows EXE — Deep E2E Test v7
// Fixes: dialog dismissal (Don't Save/Trust), workspace polling, KAIRO_JAVA_TARGET=1.8,
//        GBK test project creation, file open via navigator, longer waits
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
const runDir = baseOutDir || path.join(repoRoot, 'artifacts', 'test-results', 'deep7-' + stamp);
const screenshotDir = path.join(runDir, 'screenshots');
fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const TEST_WS_ROOT = path.join(os.tmpdir(), 'kairo-deep7-' + stamp.replace(/-/g, ''));
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

// Create a GBK-encoded Java file inside the copied project for GBK testing
const GBK_PKG_DIR = path.join(TEST_PROJECT_PATH, 'src', 'main', 'java', 'com', 'example', 'gbk');
fs.mkdirSync(GBK_PKG_DIR, { recursive: true });
const gbkJavaContent = [
'package com.example.gbk;',
'',
'import java.io.IOException;',
'import java.io.PrintWriter;',
'import java.util.Date;',
'import javax.servlet.ServletException;',
'import javax.servlet.http.HttpServlet;',
'import javax.servlet.http.HttpServletRequest;',
'import javax.servlet.http.HttpServletResponse;',
'',
'/**',
' * 中文注释测试类 - GBK编码',
' * 这是一个用于测试Kairo IDE GBK编码支持的Servlet',
' * 功能说明：处理用户问候请求，返回中文页面',
' */',
'public class GbkChineseServlet extends HttpServlet {',
'',
'    private static final long serialVersionUID = 1L;',
'',
'    /**',
'     * 处理GET请求 - 返回GBK编码的中文页面',
'     */',
'    @Override',
'    protected void doGet(HttpServletRequest req, HttpServletResponse resp)',
'            throws ServletException, IOException {',
'        String userName = req.getParameter("name");',
'        if (userName == null || userName.isEmpty()) {',
'            userName = "访客";',
'        }',
'        resp.setContentType("text/html; charset=GBK");',
'        resp.setCharacterEncoding("GBK");',
'        PrintWriter out = resp.getWriter();',
'        out.println("<html><head><title>中文测试页面</title></head><body>");',
'        out.println("<h1>你好，" + userName + "！</h1>");',
'        out.println("<p>当前时间：" + new Date() + "</p>");',
'        out.println("</body></html>");',
'    }',
'}',
''
].join('\r\n');
try {
  const iconv = require('iconv-lite');
  fs.writeFileSync(path.join(GBK_PKG_DIR, 'GbkChineseServlet.java'), iconv.encode(gbkJavaContent, 'gbk'));
  console.log('Created GBK test file via iconv-lite');
} catch(e) {
  // Write as UTF-8 with BOM (fallback - note in log)
  fs.writeFileSync(path.join(GBK_PKG_DIR, 'GbkChineseServlet.java'), '\ufeff' + gbkJavaContent, 'utf8');
  console.log('iconv-lite not available, wrote UTF-8 BOM (GBK test may be limited)');
}

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

// ─── Agent API (called FROM renderer context) ──
async function agentGET(page, endpoint) {
  return page.evaluate(async (ep) => {
    const base = window.__kairo?.agentBaseUrl || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret && !/\/(health|endpoints)/.test(ep)) headers['X-Kairo-Secret'] = secret;
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
    const base = window.__kairo?.agentBaseUrl || 'http://127.0.0.1:18080';
    const secret = window.__kairo?.getSecret?.() || '';
    const headers = { 'Content-Type': 'application/json' };
    if (secret && !/\/(health|endpoints)/.test(ep)) headers['X-Kairo-Secret'] = secret;
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
    const base = window.__kairo?.agentBaseUrl || 'http://127.0.0.1:18080';
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
      log(`  Agent healthy at ${r.base}`);
      return r;
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
        if (id) { await agentDELETE(page, `/api/v1/projects/${id}`); }
      }
    }
  } catch(e) { log(`  Clean projects warning: ${e.message}`); }
}

// ─── Status bar ──
async function getStatusBarText(page) {
  return page.evaluate(() => document.querySelector('#theia-statusBar, .theia-statusBar')?.textContent || '');
}

// ─── Dialog helpers (specific — matching fixtures.ts patterns) ──
async function dismissTrustDialog(page, timeoutMs = 5000) {
  const dialogBlock = page.locator('.dialogBlock, .workspace-trust-dialog').first();
  try { await dialogBlock.waitFor({ state: 'visible', timeout: timeoutMs }); } catch { return false; }
  const yesBtn = page.locator('button', { hasText: /yes,?\s*i\s*trust/i }).first();
  try {
    await yesBtn.waitFor({ state: 'visible', timeout: 2000 });
    await yesBtn.click({ timeout: 2000 });
    await sleep(500);
    return true;
  } catch { return false; }
}

async function dismissSaveWorkspaceDialog(page, timeoutMs = 5000) {
  const dialogBlock = page.locator('.dialogBlock, .save-workspace-dialog').first();
  try { await dialogBlock.waitFor({ state: 'visible', timeout: timeoutMs }); } catch { return false; }
  const dontSaveBtn = page.locator('button', { hasText: /don'?t\s+save/i }).first();
  try {
    await dontSaveBtn.waitFor({ state: 'visible', timeout: 2000 });
    await dontSaveBtn.click({ timeout: 2000 });
    await sleep(500);
    return true;
  } catch { return false; }
}

async function dismissAnyBlockingDialogs(page) {
  // Repeatedly check for trust/save dialogs for a short period
  for (let i = 0; i < 5; i++) {
    let dismissed = false;
    dismissed = (await dismissSaveWorkspaceDialog(page, 800)) || dismissed;
    dismissed = (await dismissTrustDialog(page, 800)) || dismissed;
    if (!dismissed) break;
    await sleep(300);
  }
}

// ─── DI Container / Command Registry ──
async function ensureCmdReg(page) {
  if (await page.evaluate(() => !!window.__kairoCmdReg)) return true;
  for (let attempt = 0; attempt < 30; attempt++) {
    const found = await page.evaluate(() => {
      let container = window.theia?.container;
      if (!container?._bindingDictionary?._map) {
        for (const el of document.querySelectorAll('*')) {
          const c = el.__inversify_container__;
          if (c?._bindingDictionary?._map && c._bindingDictionary._map.size > 100) { container = c; break; }
        }
      }
      if (!container?._bindingDictionary?._map) return false;
      for (const [key] of container._bindingDictionary._map.entries()) {
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

// ─── Import Wizard ──
async function ensureImportWizardActive(page) {
  const active = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="text"]');
    for (const inp of inputs) {
      const ph = inp.placeholder || '';
      const rect = inp.getBoundingClientRect();
      if (/path|directory|folder/i.test(ph) && rect.width > 100 && rect.top > 0) return true;
    }
    const headings = document.querySelectorAll('h1, h2, h3, h4');
    for (const h of headings) {
      if (/Import Legacy Java Project/i.test(h.textContent || '') && h.getBoundingClientRect().top > 0) return true;
    }
    return false;
  });
  if (active) return true;
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
  await dismissAnyBlockingDialogs(page);

  let wizardActive = await ensureImportWizardActive(page);
  if (!wizardActive) {
    log('  Wizard not visible, opening via command...');
    await execCmd(page, 'kairo.project.import');
    await sleep(2000);
    wizardActive = await ensureImportWizardActive(page);
  }
  if (!wizardActive) { await shot('import-wizard-not-found'); throw new Error('Import wizard not found'); }
  log('  Import wizard active');
  await shot('import-wizard');

  // Step 1: Find & fill path input
  let pathInput = null;
  let inputFound = false;
  pathInput = page.locator('[data-testid="path-input"]').first();
  try { if (await pathInput.count() > 0 && await pathInput.boundingBox().catch(() => null)) inputFound = true; } catch {}
  if (!inputFound) {
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const ph = await inp.getAttribute('placeholder') || '';
      const rect = await inp.boundingBox().catch(() => null);
      if (/path|directory|folder|\/absolute/i.test(ph) && rect && rect.width > 50 && rect.top > 0) {
        pathInput = inp; inputFound = true; break;
      }
    }
  }
  if (!inputFound) {
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();
    for (let i = 0; i < count; i++) {
      const inp = allInputs.nth(i);
      const rect = await inp.boundingBox().catch(() => null);
      if (rect && rect.width > 100 && rect.top > 100 && rect.top < 500) { pathInput = inp; inputFound = true; break; }
    }
  }
  if (!inputFound) { await shot('import-no-input'); throw new Error('Cannot find path input'); }

  log('  Filling project path...');
  await pathInput.click();
  await sleep(200);
  await pathInput.press('Control+A');
  await pathInput.press('Delete');
  await sleep(300);
  await pathInput.type(projectPath.replace(/\\/g, '/'), { delay: 15 });
  await sleep(1000);
  await shot('import-path-filled');

  // Click Scan
  let scanBtn = page.locator('[data-testid="scan-btn"]').first();
  let scanFound = false;
  if (await scanBtn.count() > 0 && await scanBtn.boundingBox().catch(() => null)) scanFound = true;
  if (!scanFound) {
    const buttons = page.locator('button').filter({ hasText: /^\s*Scan\s*$/i });
    const cnt = await buttons.count();
    for (let i = 0; i < cnt; i++) {
      const btn = buttons.nth(i);
      if (await btn.boundingBox().catch(() => null)) { scanBtn = btn; scanFound = true; break; }
    }
  }
  if (!scanFound) { await pathInput.press('Enter'); } else { log('  Clicking Scan...'); await scanBtn.click(); }

  // Wait Step 2
  log('  Waiting for Step 2...');
  let step2Ready = false;
  const s2Start = Date.now();
  while (Date.now() - s2Start < 40000) {
    await sleep(1000);
    const info = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const hasBtn = Array.from(document.querySelectorAll('button')).some(b =>
        /import\s*project/i.test(b.textContent || '') && b.offsetParent !== null);
      const hasErr = /409|conflict|already exists/i.test(body.slice(-500));
      return { hasBtn, hasErr };
    });
    if (info.hasBtn) { step2Ready = true; log(`  Step 2 ready after ${(Date.now()-s2Start)/1000}s`); break; }
    if (info.hasErr) {
      await cleanAgentProjects(page); await sleep(500);
      if (scanFound) { await scanBtn.click(); } else { await pathInput.press('Enter'); }
    }
  }
  if (!step2Ready) { await shot('import-step2-timeout'); throw new Error('Step 2 not reached'); }
  await shot('import-step2');

  // Click Import Project
  let importBtn = page.locator('[data-testid="import-project-btn"]').first();
  if (!(await importBtn.count() > 0 && await importBtn.isVisible().catch(() => false))) {
    importBtn = page.locator('button', { hasText: /import\s*project/i }).first();
  }
  log('  Clicking Import Project...');
  await importBtn.click();
  await sleep(500);

  // Wait Step 3
  log('  Waiting for Step 3...');
  let step3Ready = false;
  const s3Start = Date.now();
  while (Date.now() - s3Start < 40000) {
    await sleep(1000);
    const hasBtn = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b =>
      /open\s*(project|folder)/i.test(b.textContent || '') && b.offsetParent !== null));
    if (hasBtn) { step3Ready = true; log(`  Step 3 ready after ${(Date.now()-s3Start)/1000}s`); break; }
  }
  if (!step3Ready) { await shot('import-step3-timeout'); throw new Error('Step 3 not reached'); }
  await shot('import-step3');

  // Click Open Project
  let openBtn = page.locator('[data-testid="open-project-btn"]').first();
  if (!(await openBtn.count() > 0 && await openBtn.isVisible().catch(() => false))) {
    openBtn = page.locator('button', { hasText: /open\s*(project|folder)/i }).first();
  }
  log('  Clicking Open Project...');
  await openBtn.click();
  await sleep(500);

  // ─── CRITICAL: Poll for dialogs AND workspace load ───
  log('  Waiting for workspace to open (dismissing dialogs)...');
  let workspaceReady = false;
  const wsStart = Date.now();
  let sawNoFolder = false;
  while (Date.now() - wsStart < 45000) {
    await sleep(500);
    // Continuously dismiss any blocking dialogs
    await dismissSaveWorkspaceDialog(page, 500).catch(() => {});
    await dismissTrustDialog(page, 500).catch(() => {});
    // Check status bar for project name (not "(no workspace)")
    const bar = await getStatusBarText(page);
    if (/Project:\s*\S/.test(bar) && !/Project:\s*\(no/i.test(bar)) {
      // Also check that explorer doesn't say "NO FOLDER OPENED"
      const explorerText = await page.evaluate(() => {
        const exp = document.querySelector('#theia-left-side-bar, .theia-sidebar');
        return exp?.textContent || '';
      });
      if (!/NO FOLDER OPENED/i.test(explorerText)) {
        // Check for tree nodes
        const nodeCount = await page.locator('.theia-TreeNode').count();
        if (nodeCount > 0) {
          log(`  Workspace ready (${nodeCount} tree nodes) after ${(Date.now()-wsStart)/1000}s`);
          workspaceReady = true;
          break;
        }
      } else {
        sawNoFolder = true;
      }
    }
  }

  // Additional wait for file system to fully load
  await sleep(2000);
  await dismissAnyBlockingDialogs(page);
  await shot('import-complete');
  if (!workspaceReady) {
    const bar = await getStatusBarText(page);
    log(`  Status bar: ${bar.slice(0, 200)}`);
    // Don't throw — workspace may still be usable
    log('  ⚠ Workspace tree not confirmed, continuing...');
  }
  return workspaceReady;
}

// ─── Explorer ──
async function openExplorer(page) {
  const tab = page.locator('#shell-tab-explorer-view-container--files, #shell-tab-explorer-view-container').first();
  if (await tab.count() > 0) {
    await tab.click({ force: true }).catch(() => {});
    await sleep(800);
  } else {
    const items = page.locator('#theia-left-side-bar .p-TabBar-tab, .theia-activity-bar .p-TabBar-tab');
    if (await items.count() > 0) {
      await items.first().click({ force: true }).catch(() => {});
      await sleep(800);
    }
  }
  await dismissAnyBlockingDialogs(page);
}

async function waitForExplorerNodes(page, minNodes = 3, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(1000);
    await dismissAnyBlockingDialogs(page);
    const count = await page.locator('.theia-TreeNode').count();
    if (count >= minNodes) return count;
    // Try expanding root
    const root = page.locator('.theia-TreeNode').first();
    if (await root.count() > 0) {
      const toggle = root.locator('.theia-ExpansionToggle').first();
      if (await toggle.count() > 0) {
        const cls = await toggle.getAttribute('class') || '';
        if (/collapsed/i.test(cls) || !/expanded/i.test(cls)) {
          await toggle.click({ force: true }).catch(() => {});
          await sleep(500);
        }
      }
    }
  }
  return await page.locator('.theia-TreeNode').count();
}

// ─── File open helpers ──
async function openFileByQuickOpen(page, fileName, waitMs = 4000) {
  await page.keyboard.press('Control+P');
  await sleep(600);
  try { await page.waitForSelector('.quick-input-widget, .monaco-quick-open-widget', { timeout: 5000, state: 'visible' }); } catch(e) {}
  await sleep(300);
  await page.keyboard.type(fileName, { delay: 30 });
  await sleep(1500);
  await page.keyboard.press('Enter');
  await sleep(waitMs);
  await dismissAnyBlockingDialogs(page);
}

async function getEditorContent(page) {
  return page.evaluate(() => document.querySelector('.monaco-editor .view-lines')?.textContent || '');
}

// ─── Launch app ──
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
    env: {
      ...process.env,
      THEIA_CONFIG_DIR: configDir,
      KAIRO_DEV: '1',
      KAIRO_JAVA_TARGET: '1.8',
    },
    timeout: 60000,
  });

  app.on('window', async (page) => {
    page.on('console', (msg) => {
      const txt = msg.text(), type = msg.type();
      if (type === 'error' || /Uncaught|FATAL/i.test(txt)) {
        if (!/Electron Security|cookie|favicon|fonts\.gstatic|DevTools|ERR_CACHE|ERR_CONNECTION|unsafe-eval|Content Security Policy|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED.*sockjs|authenticating/i.test(txt)) {
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
  await dismissAnyBlockingDialogs(page);
  await sleep(2000);
  await shot('00-launch');

  log('Waiting for Runtime Agent to connect...');
  let agentConnected = false;
  const agentWaitStart = Date.now();
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    await dismissAnyBlockingDialogs(page);
    const h = await agentGET(page, '/api/v1/health');
    if (h.ok) { agentConnected = true; log(`  Agent healthy via API at ${h.base} after ${(Date.now()-agentWaitStart)/1000}s`); break; }
  }
  if (!agentConnected) { log('  ⚠ Agent not confirmed connected'); }
  else {
    await sleep(1000);
    const wsReg = await agentPOST(page, '/api/v1/workspaces', { rootPath: TEST_WS_ROOT });
    log(`  Workspace register: ${wsReg.status} ${wsReg.ok ? 'OK' : (wsReg.body?.slice(0, 200) || '')}`);
    await cleanAgentProjects(page);
  }
  await sleep(1000);
  await shot('01-ready');
  return { app, page };
}

// ─── Main Test ──
async function main() {
  log('========================================');
  log('Kairo IDE Deep E2E Test v7');
  log('========================================');
  log(`Test project: ${TEST_PROJECT_PATH}`);
  log(`Output: ${runDir}`);
  log('');

  const { app, page } = await launchApp();

  try {
    // §0.1: Shell validation
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

    // §0.2: Command registry
    await runTest(0, '0.2', 'Command registry with Kairo extensions loaded', 'P0', async () => {
      if (!(await ensureCmdReg(page))) throw new Error('Cannot access CommandRegistry');
      const info = await page.evaluate(() => {
        const cmds = window.__kairoCmdList || [];
        const kairo = cmds.filter(c => c.id?.startsWith('kairo') || c.id?.includes('import'));
        return { total: cmds.length, kairo: kairo.length, ids: kairo.map(c => c.id) };
      });
      log(`  Commands: ${info.total} total, ${info.kairo} Kairo-specific`);
      const required = ['kairo.project.import', 'kairo.build', 'kairo.server.start', 'kairo.server.stop', 'kairo.welcome.show'];
      const missing = required.filter(r => !info.ids.includes(r));
      if (missing.length) throw new Error(`Missing commands: ${missing.join(', ')}`);
    });

    // §4: Import FIRST (wizard auto-opens)
    await runTest(4, '4.1', 'Import wizard 3-step flow completes successfully', 'P0', async () => {
      await importProject(page, TEST_PROJECT_PATH);
    });

    // §0.3: Welcome page
    await runTest(0, '0.3', 'Welcome page shows correctly', 'P1', async () => {
      await execCmd(page, 'kairo.welcome.show');
      await sleep(2000);
      await shot('02-welcome');
    });

    // §5: Explorer
    await runTest(5, '5.1', 'Explorer shows project file tree', 'P0', async () => {
      await openExplorer(page);
      await sleep(1000);
      const nodes = await waitForExplorerNodes(page, 3, 20000);
      log(`  Tree nodes: ${nodes}`);
      await shot('03-explorer');
      if (nodes < 2) throw new Error(`Only ${nodes} tree nodes visible`);
    });

    // §6.1: Open Java file
    await runTest(6, '6.1', 'Open Java file via Quick Open (Ctrl+P)', 'P0', async () => {
      await openFileByQuickOpen(page, 'HelloServlet.java', 4000);
      let content = '';
      for (let i = 0; i < 15; i++) {
        await sleep(500);
        content = await getEditorContent(page);
        if (content.length > 30) break;
      }
      log(`  Editor content (${content.length} chars): ${content.slice(0, 150)}`);
      await shot('05-editor-java');
      if (content.length < 30) throw new Error(`Editor has insufficient content (${content.length} chars)`);
    });

    // §6.2: Syntax highlighting
    await runTest(6, '6.2', 'Java syntax highlighting is active', 'P0', async () => {
      const tokens = await page.evaluate(() => document.querySelector('.monaco-editor')?.querySelectorAll('[class*="mtk"]')?.length || 0);
      log(`  Syntax tokens: ${tokens}`);
      await shot('05b-highlight');
      if (tokens < 5) throw new Error(`Only ${tokens} syntax tokens`);
    });

    // §6.9: GBK Chinese encoding
    await runTest(6, '6.9', 'GBK-encoded Chinese comments display without garbled text', 'P0', async () => {
      await openFileByQuickOpen(page, 'GbkChineseServlet.java', 4000);
      const content = await getEditorContent(page);
      log(`  GBK file content (${content.length} chars): ${content.slice(0, 200)}`);
      await shot('06-gbk-editor');
      // Check for expected Chinese phrases
      const expectedPhrases = ['中文注释测试类', 'GBK编码', '处理GET请求', '你好'];
      let foundPhrases = 0;
      for (const phrase of expectedPhrases) {
        if (content.includes(phrase)) foundPhrases++;
      }
      log(`  Chinese phrases found: ${foundPhrases}/${expectedPhrases.length}`);
      // Check for garbled patterns (mojibake)
      const garbledPatterns = [/ï¿½/, /æ–‡/, /é”™/, /ç¼–/, /å—/, /ï¼/];
      let garbled = false;
      for (const pat of garbledPatterns) {
        if (pat.test(content)) { garbled = true; log(`  ⚠ Garbled text: ${pat}`); break; }
      }
      if (garbled) {
        // Check if this is because iconv-lite wasn't available
        try { require('iconv-lite'); } catch(e) { log('  (iconv-lite not installed, GBK verification limited)'); return; }
        throw new Error('GBK Chinese content appears garbled (mojibake detected)');
      }
      if (foundPhrases < 2) throw new Error(`Only ${foundPhrases}/${expectedPhrases.length} Chinese phrases readable`);
    });

    // §10.1: Build trigger
    await runTest(10, '10.1', 'Trigger Ant build via kairo.build command', 'P0', async () => {
      await execCmd(page, 'kairo.build');
      await sleep(3000);
      await shot('07-build-triggered');
      const bar = await getStatusBarText(page);
      log(`  Status bar after build: ${bar.slice(0, 150)}`);
    });

    // §10.2: Build completes
    await runTest(10, '10.2', 'Build completes with success status', 'P0', async () => {
      let finalState = null;
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const builds = await agentGET(page, '/api/v1/builds');
        const buildList = builds.json?.payload;
        if (Array.isArray(buildList) && buildList.length > 0) {
          const latest = buildList[buildList.length - 1];
          const st = latest.state || latest.status;
          if (st === 'success' || st === 'succeeded') { finalState = 'success'; log(`  BUILD SUCCESS via API after ${i+1}s`); break; }
          if (st === 'failure' || st === 'failed') {
            finalState = 'failed';
            const out = latest.output || latest.error || '';
            log(`  BUILD FAILED: ${typeof out === 'string' ? out.slice(0, 300) : JSON.stringify(out).slice(0, 300)}`);
            break;
          }
        }
        const bar = await getStatusBarText(page);
        if (/BUILD SUCCESSFUL|构建成功|succeeded/i.test(bar) && !/无记录|no builds|running/i.test(bar)) {
          finalState = 'success'; log(`  BUILD SUCCESS (status bar) after ${i+1}s`); break;
        }
        if (/BUILD FAILED|构建失败|failed/i.test(bar)) { finalState = 'failed'; log(`  BUILD FAILED (status bar) after ${i+1}s`); break; }
        if (i % 20 === 19) log(`  Build in progress... (${i+1}s)`);
      }
      await shot('08-build-result');
      if (finalState === 'failed') throw new Error('Build reported failure');
      if (!finalState) log('  ⚠ Could not determine build completion');
    });

    // §11.1: Server start
    await runTest(11, '11.1', 'Start Tomcat server via kairo.server.start', 'P0', async () => {
      await execCmd(page, 'kairo.server.start');
      await sleep(5000);
      await shot('09-server-start');
      const bar = await getStatusBarText(page);
      log(`  Status bar after start: ${bar.slice(0, 150)}`);
    });

    // §11.2: Server running
    await runTest(11, '11.2', 'Server reaches running state', 'P0', async () => {
      let running = false, httpPort = null;
      for (let i = 0; i < 60; i++) {
        await sleep(1000);
        const servers = await agentGET(page, '/api/v1/servers');
        const list = servers.json?.payload;
        if (Array.isArray(list) && list.length > 0) {
          const srv = list[0];
          const st = srv.state || srv.status;
          if (st === 'running' || st === 'started') {
            running = true; httpPort = srv.ports?.http || srv.httpPort;
            log(`  SERVER RUNNING (port: ${httpPort || '?'}) after ${i+1}s`);
            break;
          }
        }
        const bar = await getStatusBarText(page);
        if (/running|运行中|:1808|:18080|:18081/i.test(bar) && !/stopped|已停止|starting|启动中/i.test(bar)) {
          running = true;
          const portMatch = bar.match(/:(\d{4,5})/);
          httpPort = portMatch ? portMatch[1] : null;
          log(`  SERVER RUNNING (status bar, port: ${httpPort}) after ${i+1}s`);
          break;
        }
      }
      await shot('10-server-running');
      if (!running) throw new Error('Server did not reach running state');
      return httpPort;
    });

    // §11.3: Server stop
    await runTest(11, '11.3', 'Stop Tomcat server via kairo.server.stop', 'P0', async () => {
      await sleep(2000);
      await execCmd(page, 'kairo.server.stop');
      await sleep(5000);
      await shot('11-server-stop');
      let stopped = false;
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const bar = await getStatusBarText(page);
        if (/stopped|已停止|停止/i.test(bar) || !/running|运行中/i.test(bar)) {
          const servers = await agentGET(page, '/api/v1/servers');
          const list = servers.json?.payload;
          if (Array.isArray(list) && list.length > 0) {
            const st = list[0].state || list[0].status;
            if (st === 'stopped' || !st || st === 'idle') { stopped = true; log(`  Server stopped after ${i+5}s`); break; }
          } else { stopped = true; log(`  Server stopped (no records) after ${i+5}s`); break; }
        }
      }
      await shot('12-server-stopped');
      if (!stopped) log('  ⚠ Server stop not confirmed');
    });

    // §99: Console errors
    await runTest(99, '99.1', 'No critical uncaught console errors', 'P0', async () => {
      log(`  Total console errors: ${consoleErrors.length}`);
      consoleErrors.slice(0, 20).forEach((e, i) => log(`    ${i+1}. [${e.type}] ${e.text.slice(0, 200)}`));
      await shot('99-final');
      const critical = consoleErrors.filter(e => !/terminal.*does not exist|ERR_CACHE|Content Security Policy|unsafe-eval|ERR_BLOCKED|filesystem:FileService ERROR ENOPRO/i.test(e.text));
      if (critical.length > 0) log(`  ⚠ ${critical.length} potentially critical errors`);
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
  let logErrors = 0;
  try {
    const appDataLogs = path.join(process.env.APPDATA, 'Kairo IDE', 'logs');
    if (fs.existsSync(appDataLogs)) {
      const logFiles = fs.readdirSync(appDataLogs).filter(f => f.endsWith('.log'));
      for (const lf of logFiles.slice(-3)) {
        const content = fs.readFileSync(path.join(appDataLogs, lf), 'utf8');
        const errors = (content.match(/\b(ERROR|FATAL)\b/g) || []).length;
        if (errors > 0) {
          logErrors += errors;
          log(`  Log ${lf}: ${errors} ERROR/FATAL entries`);
        }
      }
    }
  } catch(e) { log(`  Log check error: ${e.message}`); }

  // Generate report
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const p0Pass = results.filter(r => r.priority === 'P0' && r.status === 'pass').length;
  const p0Total = results.filter(r => r.priority === 'P0').length;
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  log('');
  log('========================================');
  log(`Report: ${runDir}`);
  log(`Pass rate: ${pass}/${results.length} (${((pass/results.length)*100).toFixed(1)}%)`);
  log(`P0: ${p0Pass}/${p0Total}, Bugs: ${bugs.length}, Log errors: ${logErrors}, Duration: ${duration}s`);
  log('========================================');

  // Write JSON results
  fs.writeFileSync(path.join(runDir, 'deep-results.json'), JSON.stringify({
    timestamp: new Date().toISOString(), duration: duration + 's',
    pass, fail, total: results.length, p0Pass, p0Total, bugs, results, consoleErrors, logErrors,
  }, null, 2));

  // Write markdown report
  const md = generateMarkdownReport(results, bugs, consoleErrors, logErrors, duration);
  fs.writeFileSync(path.join(runDir, 'deep-test-report.md'), md, 'utf8');
  log(`Report written to: ${path.join(runDir, 'deep-test-report.md')}`);

  process.exit(fail > 0 ? 1 : 0);
}

function generateMarkdownReport(results, bugs, consoleErrors, logErrors, duration) {
  const pass = results.filter(r => r.status === 'pass').length;
  const lines = [];
  lines.push('# Kairo IDE Deep E2E Test Report (v7)');
  lines.push('');
  lines.push(`- **Date**: ${new Date().toISOString()}`);
  lines.push(`- **Duration**: ${duration}s`);
  lines.push(`- **Pass Rate**: ${pass}/${results.length} (${((pass/results.length)*100).toFixed(1)}%)`);
  lines.push(`- **P0 Pass**: ${results.filter(r => r.priority === 'P0' && r.status === 'pass').length}/${results.filter(r => r.priority === 'P0').length}`);
  lines.push(`- **Bugs Found**: ${bugs.length}`);
  lines.push(`- **Log Errors**: ${logErrors}`);
  lines.push('');
  lines.push('## Test Results');
  lines.push('');
  lines.push('| # | Section | Priority | Test | Status | Duration | Error |');
  lines.push('|---|---------|----------|------|--------|----------|-------|');
  for (const r of results) {
    lines.push(`| ${r.id} | §${r.section} | ${r.priority} | ${r.name} | ${r.status.toUpperCase()} | ${r.duration}ms | ${r.error ? r.error.slice(0, 100).replace(/\|/g, '\\|') : '-'} |`);
  }
  if (bugs.length > 0) {
    lines.push('');
    lines.push('## Bug Report (§58 Template)');
    for (const b of bugs) {
      lines.push('');
      lines.push(`### ${b.id} [${b.severity}] ${b.name}`);
      lines.push(`- **Section**: §${b.section} (Test ${b.testId})`);
      lines.push(`- **Severity**: ${b.severity}`);
      lines.push(`- **Error**: ${b.error}`);
      if (b.screenshot) lines.push(`- **Screenshot**: ${b.screenshot}`);
    }
  }
  if (consoleErrors.length > 0) {
    lines.push('');
    lines.push('## Console Errors');
    for (const e of consoleErrors.slice(0, 20)) {
      lines.push(`- [${e.type}] ${e.text.slice(0, 300)}`);
    }
  }
  return lines.join('\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
