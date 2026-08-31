/**
 * Chapter 3 — startup / shutdown lifecycle (docs/COMPREHENSIVE_TEST_DOCUMENT.md).
 * Browser column on Windows: TC-LAUNCH-002/013/014/021/022/023/041/042/063/064/065.
 * Desktop-only cases (003-012, 024/025, 031-034, 051-055, 066) are covered in the
 * desktop phase; 056/057 need a running Tomcat — deferred to the ch21 session.
 *
 * Runs on one lane (env THEIA_URL + AGENT_PORT + LANE, default A). Serial:
 * several cases restart the lane agent.
 */
import { expect, test } from '@playwright/test';
import { execFile, execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  api, attachDiagnostics, LANE_WS, openFileViaQuickOpen, openIde, sbEntry, waitForMainTab,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const IS_WIN = process.platform === 'win32';
const REPO = path.resolve(__dirname, '..', '..', '..');
const LANE = process.env.LANE || 'A';
const LANES_DIR = path.join(REPO, '.test-lanes', LANE);
const AGENT_PORT = parseInt(process.env.AGENT_PORT || '18400', 10);
const THEIA_URL = process.env.THEIA_URL || 'http://127.0.0.1:18401';
const THEIA_PORT = parseInt(new URL(THEIA_URL).port, 10);

/* ---------------- Windows-safe agent process helpers ---------------- */

function killTree(pid: string): void {
  if (!pid) return;
  if (IS_WIN) {
    try { execFile('taskkill', ['/F', '/T', '/PID', pid], { stdio: 'ignore' }); } catch { /* gone */ }
  } else {
    try { execSync(`kill ${pid} 2>/dev/null; kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore' }); } catch { /* gone */ }
  }
}

function pidsListeningOn(port: number): string[] {
  if (IS_WIN) {
    try {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = new Set<string>();
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && parseInt(m[1], 10) === port) pids.add(m[2]);
      }
      return [...pids];
    } catch { return []; }
  }
  try {
    return execSync(`lsof -tnP -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { return []; }
}

async function waitForAgent(up: boolean, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${AGENT_PORT}/api/v1/health`, { signal: AbortSignal.timeout(1200) });
      if (res.ok === up) return;
    } catch {
      // connection refused = port down = agent down
      if (!up) return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`agent did not turn ${up ? 'UP' : 'DOWN'} within ${timeout}ms`);
}

async function stopAgent(): Promise<void> {
  const pidFile = path.join(LANES_DIR, 'agent.pid');
  if (fs.existsSync(pidFile)) killTree(fs.readFileSync(pidFile, 'utf8').trim());
  for (const pid of pidsListeningOn(AGENT_PORT)) killTree(pid);
  await waitForAgent(false, 20_000);
}

async function startAgent(): Promise<void> {
  const out = fs.openSync(path.join(LANES_DIR, 'logs', 'agent.log'), 'a');
  const bin = path.join(REPO, 'runtime-agent', 'bin', IS_WIN ? 'kairo-runtime.exe' : 'kairo-runtime');
  const child = spawn(bin, ['--config', path.join(LANES_DIR, 'agent.yaml')], {
    detached: true, stdio: ['ignore', out, out], cwd: REPO,
  });
  fs.writeFileSync(path.join(LANES_DIR, 'agent.pid'), String(child.pid));
  child.unref();
  await waitForAgent(true, 60_000);
  await new Promise((r) => setTimeout(r, 500));
}

/* ------------------------------ tests ------------------------------ */

/** Locale-tolerant agent status entry (EN "Agent: connected" / zh "代理: 已连接"). */
function agentStatus(page: import('@playwright/test').Page) {
  return page.locator('#theia-statusBar .element').filter({ hasText: /Agent|代理/i }).first();
}

test.describe('ch03 launch/shutdown (browser column)', () => {

  test.beforeAll(async () => {
    // The suite manipulates the agent process — ensure the lane is up first
    // (a previous crashed run may have left the agent dead).
    const up = await fetch(`http://127.0.0.1:${AGENT_PORT}/api/v1/health`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.ok).catch(() => false);
    if (!up) await startAgent();
  });

  test('TC-LAUNCH-013 state files are valid JSON with expected fields and no secret', async () => {
    const statePath = path.join(LANES_DIR, 'data', 'agent-state.json');
    expect(fs.existsSync(statePath), `agent-state.json exists at ${statePath}`).toBeTruthy();
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state.port).toBe(AGENT_PORT);
    expect(state.bindAddress).toBe('127.0.0.1');
    expect(Number.isInteger(state.pid)).toBeTruthy();
    expect(String(state.startedAt)).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // secret must never be persisted
    const keys = Object.keys(state).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.includes('secret'))).toBeFalsy();
    expect(/secret/i.test(fs.readFileSync(statePath, 'utf8'))).toBeFalsy();
    // theia-state.json is written by the desktop launcher into userData —
    // browser lane has no such file; the theia side is covered by the
    // running port assertion below.
    const theiaUp = await fetch(THEIA_URL, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    expect(theiaUp).toBeTruthy();
  });

  test('TC-LAUNCH-014 no secret plaintext on the agent command line', async () => {
    if (!IS_WIN) test.skip(true, 'Windows process inspection');
    const out = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'kairo-runtime.exe\'\\").CommandLine"',
      { encoding: 'utf8' },
    );
    expect(out).toContain('--config');
    expect(out).not.toMatch(/--secret/i);
    expect(out).not.toMatch(/KAIRO_LOCAL_SECRET=\S+/);
    // no long hex/base64 token that could be a leaked secret
    expect(out).not.toMatch(/[A-Fa-f0-9]{40,}/);
  });

  test('TC-LAUNCH-002 cold start: fresh page reaches interactive workbench', async ({ page }) => {
    const diag = attachDiagnostics(page);
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
    const coldMs = Date.now() - t0;
    console.log(`[TC-LAUNCH-002] cold start to interactive shell: ${coldMs}ms (backend warm)`);
    expect(coldMs).toBeLessThan(30_000);
    // Best-effort: performance dashboard should have a cold start record.
    try {
      const perfEntry = sbEntry(page, /性能|Performance/i);
      await perfEntry.click({ timeout: 5_000 });
      await page.locator('#kairo-perf-dashboard').waitFor({ state: 'visible', timeout: 8_000 });
      const dashboard = await page.locator('#kairo-perf-dashboard').innerText();
      console.log(`[TC-LAUNCH-002] perf dashboard mentions cold start: ${/Cold Start|冷启动/i.test(dashboard)}`);
    } catch (e) {
      console.log(`[TC-LAUNCH-002] perf dashboard check skipped: ${String(e).slice(0, 80)}`);
    }
    expect(diag.pageErrors).toEqual([]);
  });

  test('TC-LAUNCH-064 F5 refresh restores layout and reconnects agent', async ({ page }) => {
    await openIde(page);
    await openFileViaQuickOpen(page, 'README.md');
    await waitForMainTab(page, /README\.md/, 20_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const trust = page.getByRole('button', { name: /^(Yes, I trust the authors|是，我信任)/i }).first();
    try { await trust.click({ timeout: 10_000 }); } catch { /* none */ }
    await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
    // layout restore: editor tab comes back
    await waitForMainTab(page, /README\.md/, 45_000);
    // agent reconnects on its own
    await expect(agentStatus(page)).toContainText(/connected|已连接/i, { timeout: 45_000 });
  });

  test('TC-LAUNCH-063 two tabs run as independent sessions', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pa = await ctxA.newPage();
    const pb = await ctxB.newPage();
    await openIde(pa);
    await openIde(pb);
    await openFileViaQuickOpen(pa, 'README.md');
    await openFileViaQuickOpen(pb, 'build.xml');
    await waitForMainTab(pa, /README\.md/, 20_000);
    await waitForMainTab(pb, /build\.xml/, 20_000);
    // both sessions remain operable side by side
    await expect(agentStatus(pa)).toContainText(/connected|已连接/i, { timeout: 20_000 });
    await expect(agentStatus(pb)).toContainText(/connected|已连接/i, { timeout: 20_000 });
    await ctxA.close();
    await ctxB.close();
  });

  test('TC-LAUNCH-021 agent restart: fresh start reaches healthy quickly', async () => {
    const t0 = Date.now();
    await stopAgent();
    await startAgent();
    const ms = Date.now() - t0;
    console.log(`[TC-LAUNCH-021] agent restart to healthy: ${ms}ms`);
    expect(ms).toBeLessThan(30_000);
    const health = await api('GET', '/health');
    expect(health.json?.payload?.ok).toBe(true);
  });

  test('TC-LAUNCH-023 corrupt agent-state.json is ignored, fresh start works', async () => {
    await stopAgent();
    const statePath = path.join(LANES_DIR, 'data', 'agent-state.json');
    const backup = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : '';
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{corrupt!!not json!!!');
    try {
      await startAgent();
      const health = await api('GET', '/health');
      expect(health.json?.payload?.ok).toBe(true);
      // state file must be rewritten as valid JSON
      const rewritten = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(rewritten.port).toBe(AGENT_PORT);
    } finally {
      if (!backup) fs.rmSync(statePath, { force: true });
    }
  });

  test('TC-LAUNCH-022 second theia instance reuses the running agent', async ({ page }) => {
    const before = JSON.parse(fs.readFileSync(path.join(LANES_DIR, 'data', 'agent-state.json'), 'utf8'));
    const extraPort = 18901;
    // Isolated config dir: without it the second instance falls back to the
    // user's default theia-config (different locale/preferences) and pollutes it.
    const extraCfg = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-theia-2nd-'));
    const child = spawn(process.execPath, ['lib/backend/main.js', LANE_WS, '--hostname=127.0.0.1', `--port=${extraPort}`], {
      cwd: path.join(REPO, 'apps', 'browser'),
      env: { ...process.env, KAIRO_RUNTIME_URL: `http://127.0.0.1:${AGENT_PORT}`, THEIA_CONFIG_DIR: extraCfg },
      detached: true, stdio: 'ignore',
    });
    try {
      const deadline = Date.now() + 120_000;
      let up = false;
      while (Date.now() < deadline) {
        up = await fetch(`http://127.0.0.1:${extraPort}`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
        if (up) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(up, 'second theia instance came up').toBeTruthy();
      // the second frontend works against the SAME agent
      await page.goto(`http://127.0.0.1:${extraPort}/#${encodeURI(LANE_WS)}`, { waitUntil: 'domcontentloaded' });
      const trust = page.getByRole('button', { name: /^(Yes, I trust the authors|是，我信任)/i }).first();
      try { await trust.click({ timeout: 10_000 }); } catch { /* none */ }
      await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
      await expect(agentStatus(page)).toContainText(/connected|已连接/i, { timeout: 45_000 });
      // original agent process untouched
      const after = JSON.parse(fs.readFileSync(path.join(LANES_DIR, 'data', 'agent-state.json'), 'utf8'));
      expect(after.pid).toBe(before.pid);
      expect(after.port).toBe(AGENT_PORT);
    } finally {
      killTree(String(child.pid));
    }
  });

  test('TC-LAUNCH-041/042 agent death shows offline, restart reconnects and functions recover', async ({ page }) => {
    await openIde(page);
    await expect(agentStatus(page)).toContainText(/connected|已连接/i, { timeout: 30_000 });
    await stopAgent();
    // frontend notices: status flips to connecting/offline (no reload)
    await expect(agentStatus(page)).toContainText(/connecting|offline|disconnected|连接|离线/i, { timeout: 60_000 });
    // supervisor restart (auto-respawn at ~800ms is a desktop-launcher feature)
    await startAgent();
    // frontend reconnects WITHOUT page reload (WS resubscribe)
    await expect(agentStatus(page)).toContainText(/connected|已连接/i, { timeout: 60_000 });
    // functionality recovers: agent REST API + frontend data flow (project list)
    const projects = await api('GET', '/projects');
    expect(projects.status).toBe(200);
    await expect(page.locator('#kairo-toolbar, body').first()).toContainText(/legacy-sample/i, { timeout: 30_000 });
  });

  test('TC-LAUNCH-065 starting a second theia on an occupied port fails loudly', async () => {
    const startScript = path.join(REPO, 'apps', 'browser', 'scripts', 'start.cjs');
    const child = spawn(process.execPath, [startScript], {
      cwd: path.join(REPO, 'apps', 'browser'),
      env: {
        ...process.env,
        KAIRO_RUNTIME_URL: `http://127.0.0.1:${AGENT_PORT}`,
        THEIA_WORKSPACE: LANE_WS,
        THEIA_PORT: String(THEIA_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += String(d); });
    child.stderr.on('data', (d) => { output += String(d); });
    const exit = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } resolve(null); }, 45_000);
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    expect(exit, 'second instance exited (non-null)').not.toBeNull();
    expect(output).toMatch(/EADDRINUSE|address already in use|listen/i);
    // the original theia keeps serving — no fake page takeover
    const orig = await fetch(THEIA_URL, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
    expect(orig).toBeTruthy();
  });

});
