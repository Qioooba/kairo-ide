// Shared helpers for Kairo IDE macOS Web QA Wave 3 scripts.
// NO core business logic — only UI automation glue, process/HTTP helpers,
// and evidence collection.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function loadEnv(dataDir) {
  const envFile = path.join(dataDir, 'stack.env');
  if (!fs.existsSync(envFile)) {
    throw new Error(`Missing stack env: ${envFile}`);
  }
  const env = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      env[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }
  return env;
}

async function startStack(opts = {}) {
  const args = [path.join(REPO_ROOT, 'scripts', 'start-qa-stack.sh')];
  if (opts.dataDir) args.push('--data-dir', opts.dataDir);
  if (opts.port) args.push('--port', String(opts.port));
  if (opts.webPort) args.push('--web-port', String(opts.webPort));
  if (opts.skipBuild) args.push('--skip-build');

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', args, { cwd: REPO_ROOT, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code !== 0) {
        const err = new Error(`start-qa-stack.sh exited ${code}`);
        (err).stdout = stdout;
        (err).stderr = stderr;
        reject(err);
        return;
      }
      // Parse ENV_FILE line
      const m = stdout.match(/ENV_FILE:\s+(\S+)/);
      const dataDirM = stdout.match(/DATA_DIR:\s+(\S+)/);
      const dataDir = opts.dataDir || (dataDirM ? dataDirM[1] : '');
      const envFile = m ? m[1] : path.join(dataDir, 'stack.env');
      if (!fs.existsSync(envFile)) {
        reject(new Error(`start script did not create env file: ${envFile}`));
        return;
      }
      resolve({ dataDir, envFile, env: loadEnv(dataDir), stdout, stderr });
    });
  });
}

async function stopStack(dataDir) {
  return new Promise((resolve) => {
    const proc = spawn('bash', [path.join(REPO_ROOT, 'scripts', 'stop-qa-stack.sh'), '--data-dir', dataDir], {
      cwd: REPO_ROOT, stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

async function httpGet(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_e) { /* ignore */ }
    return { ok: res.ok, status: res.status, text, json };
  } catch (err) {
    return { ok: false, status: 0, text: '', json: null, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

async function agentGet(env, endpoint, timeoutMs = 10000) {
  const base = env.KAIRO_QA_AGENT_URL || `http://127.0.0.1:${env.KAIRO_QA_AGENT_PORT || 18080}`;
  return httpGet(`${base.replace(/\/$/, '')}${endpoint}`, timeoutMs);
}

async function agentPost(env, endpoint, payload, timeoutMs = 10000) {
  const base = env.KAIRO_QA_AGENT_URL || `http://127.0.0.1:${env.KAIRO_QA_AGENT_PORT || 18080}`;
  const url = `${base.replace(/\/$/, '')}${endpoint}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_e) { /* ignore */ }
    return { ok: res.ok, status: res.status, text, json };
  } catch (err) {
    return { ok: false, status: 0, text: '', json: null, error: err.message };
  } finally {
    clearTimeout(t);
  }
}

async function launchBrowser(opts = {}) {
  return chromium.launch({
    headless: false,
    slowMo: opts.slowMo ?? 30,
    args: ['--disable-dev-shm-usage'],
  });
}

async function openPage(browser, webUrl, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...opts.context,
  });
  const page = await context.newPage();
  const logs = [];
  page.on('console', msg => logs.push({ type: msg.type(), text: msg.text(), url: (msg.location() || {}).url || '', time: nowIso() }));
  page.on('pageerror', err => logs.push({ type: 'pageerror', text: err.message, time: nowIso() }));
  page.on('requestfailed', req => logs.push({ type: 'requestfailed', text: `${req.failure()?.errorText || ''}`, url: req.url(), time: nowIso() }));
  page.on('response', res => { if (res.status() >= 400) logs.push({ type: 'http' + res.status(), text: `HTTP ${res.status()}`, url: res.url(), time: nowIso() }); });
  page._kairoLogs = logs;
  await page.goto(webUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
  // Give Theia shell time to render
  await sleep(5000);
  return page;
}

async function dismissTrustDialog(page, timeoutMs = 15000) {
  const trustYes = page.locator('button', { hasText: 'Yes, I trust the authors' });
  try {
    await trustYes.waitFor({ state: 'visible', timeout: timeoutMs });
    await trustYes.click();
    await sleep(1000);
    return true;
  } catch (_e) {
    return false;
  }
}

async function openCommandPalette(page, timeoutMs = 15000) {
  // Theia browser app: Ctrl/Cmd+P opens the quick-input; prefix '>' switches to
  // command palette mode. F1 / Ctrl+Shift+P do not reliably open commands here.
  await page.keyboard.press('Meta+P');
  const widget = page.locator('.quick-input-widget');
  await widget.waitFor({ state: 'visible', timeout: timeoutMs });
  return widget;
}

async function runCommand(page, label, timeoutMs = 20000) {
  await openCommandPalette(page, timeoutMs);
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.fill('');
  await input.type('>' + label, { delay: 30 });
  await sleep(800);
  const firstRow = page.locator('.quick-input-widget .monaco-list .monaco-list-row, .monaco-list .monaco-list-row').first();
  try {
    await firstRow.waitFor({ state: 'visible', timeout: timeoutMs });
    await firstRow.click();
  } catch (_e) {
    // Fallback: the command palette may not expose rows in headed mode.
    // Pressing Enter executes the top filtered item if the input matches.
    await page.keyboard.press('Enter');
  }
  await sleep(500);
}

async function screenshot(page, outPath, opts = {}) {
  ensureDir(path.dirname(outPath));
  await page.screenshot({ path: outPath, fullPage: true, ...opts });
  return outPath;
}

async function waitForSelectorVisible(page, selector, timeoutMs = 30000) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: timeoutMs });
  return el;
}

async function waitForText(page, selector, text, timeoutMs = 30000) {
  const el = page.locator(selector, { hasText: text }).first();
  await el.waitFor({ state: 'visible', timeout: timeoutMs });
  return el;
}

async function getStatusBarText(page) {
  return page.evaluate(() => {
    const sb = document.getElementById('theia-statusBar') || document.querySelector('.theia-statusbar');
    return sb ? (sb.textContent || '') : '';
  });
}

async function waitForStatusBarContains(page, needle, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (t.includes(needle)) return t;
    await sleep(500);
  }
  throw new Error(`Status bar did not contain "${needle}" within ${timeoutMs}ms`);
}

async function waitForStatusBarNotContains(page, needle, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (!t.includes(needle)) return t;
    await sleep(500);
  }
  throw new Error(`Status bar still contained "${needle}" after ${timeoutMs}ms`);
}

function sha256File(filePath) {
  const crypto = require('crypto');
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function writeResult(outDir, result) {
  ensureDir(outDir);
  const p = path.join(outDir, 'result.json');
  fs.writeFileSync(p, JSON.stringify(result, null, 2));
  return p;
}

function writeLogs(outDir, logs) {
  ensureDir(outDir);
  const p = path.join(outDir, 'console.jsonl');
  const fd = fs.openSync(p, 'w');
  for (const line of logs) {
    fs.writeSync(fd, JSON.stringify(line) + '\n');
  }
  fs.closeSync(fd);
  return p;
}

module.exports = {
  REPO_ROOT,
  nowIso,
  ensureDir,
  loadEnv,
  startStack,
  stopStack,
  httpGet,
  agentGet,
  agentPost,
  launchBrowser,
  openPage,
  dismissTrustDialog,
  openCommandPalette,
  runCommand,
  screenshot,
  waitForSelectorVisible,
  waitForText,
  getStatusBarText,
  waitForStatusBarContains,
  waitForStatusBarNotContains,
  sha256File,
  writeResult,
  writeLogs,
  sleep,
};
