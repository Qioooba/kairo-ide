/**
 * Local helpers for chapters 8–10 (welcome / import wizard / project).
 * Kept separate from ./helpers so parallel lane agents are unaffected.
 */
import { expect, Page, test as base } from '@playwright/test';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AGENT, api } from './helpers';

export const REPO = path.resolve(__dirname, '..', '..', '..');
export const LANES = path.join(REPO, '.test-lanes', 'B');
export const TMP_ROOT = process.env.KAIRO_TEST_TMP || path.join(LANES, 'tmp', 'kairo-w1b');
export const LEGACY_SAMPLE = path.join(REPO, 'legacy-sample');

/**
 * The trust dialog renders "No, I don't trust the authors" FIRST in the DOM;
 * a suffix regex like /trust the authors$/ matches it and clicks the WRONG
 * button (workspace silently opens in Restricted Mode). Anchor at start and
 * only match the accept button.
 */
export function trustAcceptButton(page: Page) {
  return page.getByRole('button', { name: /^(Yes, I trust the authors|是，我信任)/i }).first();
}

/** Open Theia optionally rooted at a filesystem path (browser hash form). */
export async function openIdeAt(page: Page, fsPath?: string): Promise<void> {
  await page.goto(fsPath ? `/#${fsPath}` : '/', { waitUntil: 'domcontentloaded' });
  try {
    await trustAcceptButton(page).click({ timeout: 15_000 });
  } catch {
    /* no dialog */
  }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
}

export const openIde = (page: Page) => openIdeAt(page);

/**
 * Re-load the SAME workspace URL. page.goto() to an identical URL
 * (hash included) is a same-document fragment navigation and never
 * restarts the workbench — "restart" cases must reload instead.
 */
export async function reloadIde(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await trustAcceptButton(page).click({ timeout: 15_000 });
  } catch {
    /* no dialog */
  }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
}

/** Robust F1 command palette (retries while the workbench settles). */
export async function runCommand(page: Page, label: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget .quick-input-box input').first();
    try {
      await input.waitFor({ state: 'visible', timeout: 3500 });
      await input.fill(`>${label}`);
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);
      return;
    } catch {
      await page.keyboard.press('Escape');
      await page.locator('#theia-app-shell').click({ position: { x: 10, y: 10 }, force: true }).catch(() => {});
      await page.waitForTimeout(700);
    }
  }
  throw new Error(`command palette never opened for: ${label}`);
}

/** Status bar entry ids look like `status-bar-kairo.project`.
 * The id itself contains a dot, so a plain #id.class selector would
 * misparse — use an exact attribute match instead. */
export function kairoStatusEntry(page: Page, id: string) {
  return page.locator(`[id="status-bar-kairo.${id}"]`);
}

export async function waitWelcome(page: Page, timeout = 45_000): Promise<void> {
  await page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: /Welcome/i })
    .first().waitFor({ timeout });
  await page.waitForTimeout(1200);
}

const AGENT_PORT_NUM = Number(new URL(AGENT).port);
const THEIA = process.env.THEIA_URL || 'http://127.0.0.1:18411';
const AGENT_BIN = path.join(REPO, 'runtime-agent', 'bin', `kairo-runtime${process.platform === 'win32' ? '.exe' : ''}`);

async function waitForPort(up: boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${AGENT}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      if (up && res.ok) return;
    } catch {
      if (!up) return;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`agent ${AGENT} did not turn ${up ? 'up' : 'down'}`);
}

/** Stop ONLY this lane's runtime agent (Theia stays up). */
export async function stopAgent(): Promise<void> {
  const pidFile = path.join(LANES, 'agent.pid');
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
        } else {
          process.kill(pid, 'SIGTERM');
          await new Promise(r => setTimeout(r, 700));
          try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ }
        }
      } catch { /* process may have exited between the health check and kill */ }
    }
    try { fs.unlinkSync(pidFile); } catch { /* already gone */ }
  }
  await waitForPort(false, 20_000);
}

/** Start this lane's runtime agent back up. */
export async function startAgent(): Promise<void> {
  fs.mkdirSync(path.join(LANES, 'logs'), { recursive: true });
  const out = fs.openSync(path.join(LANES, 'logs', 'agent.log'), 'a');
  const child = spawn(AGENT_BIN, ['--config', path.join(LANES, 'agent.yaml')], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  fs.writeFileSync(path.join(LANES, 'agent.pid'), String(child.pid));
  child.unref();
  await waitForPort(true, 60_000);
  // give the stores a moment
  await new Promise(r => setTimeout(r, 500));
}

/**
 * Full-stack lane restart (Theia backend + agent). Required — not just a
 * page reload — whenever the persisted settings.json is mutated out-of-band:
 * the Theia preference backend caches user settings and an external edit
 * can lose against that cache (watcher debounce), making preference-driven
 * cases nondeterministic.
 */
export async function restartLane(): Promise<void> {
  const bash = process.platform === 'win32' ? 'bash.exe' : 'bash';
  try { execFileSync(bash, ['tests/e2e/lanes/lane.sh', 'stop', 'B'], { cwd: REPO, stdio: 'ignore' }); } catch { /* lane may already be down */ }
  await new Promise(r => setTimeout(r, 1500));
  const restartLog = path.join(REPO, 'test-results', 'laneB-restart.log');
  fs.mkdirSync(path.dirname(restartLog), { recursive: true });
  const log = fs.openSync(restartLog, 'a');
  const child = spawn(bash, ['tests/e2e/lanes/lane.sh', 'start', 'B'], {
    cwd: REPO, detached: true, stdio: ['ignore', log, log], windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    let theiaUp = false;
    let agentUp = false;
    try {
      agentUp = (await fetch(`${AGENT}/api/v1/health`, { signal: AbortSignal.timeout(1200) })).ok;
      theiaUp = (await fetch(THEIA, { signal: AbortSignal.timeout(1200) })).ok;
    } catch { /* not yet */ }
    if (theiaUp && agentUp) {
      await new Promise(r => setTimeout(r, 2000));
      return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('lane B did not come back up within 150s');
}

/** Fresh legacy-sample copy with optional .kairo strip. */
export function makeCopy(name: string, opts?: { keepKairo?: boolean }): string {
  const dest = path.join(TMP_ROOT, name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(LEGACY_SAMPLE, dest, { recursive: true });
  if (!opts?.keepKairo) {
    fs.rmSync(path.join(dest, '.kairo'), { recursive: true, force: true });
  }
  return dest;
}

export interface AgentEnvelope<T = unknown> {
  requestId: string;
  ok: boolean;
  payload?: T;
  error?: { code: string; message: string };
}

export async function agentJson<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', endpoint: string, payload?: unknown): Promise<T> {
  const res = await fetch(`${AGENT}/api/v1${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload !== undefined ? JSON.stringify({ requestId: `tc-${Date.now()}`, payload }) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as AgentEnvelope<T>;
  if (!body.ok) {
    throw Object.assign(new Error(body.error?.message || `agent ${method} ${endpoint} failed`), { code: body.error?.code });
  }
  return body.payload as T;
}

export interface WsRecord { id: string; name: string; rootPath: string }

/** Register a directory as a backend workspace (authorizes it in the sandbox). */
export async function registerWorkspace(rootPath: string, name: string): Promise<WsRecord> {
  return agentJson<WsRecord>('POST', '/workspaces', { rootPath, name });
}

export async function importViaApi(workspaceId: string, rootPath: string, name: string): Promise<{ id: string; name: string; rootPath: string }> {
  return agentJson('POST', '/projects/import', {
    workspaceId,
    rootPath,
    name,
    sourceDirs: ['src'],
    webRoot: 'WebRoot',
    libDirs: ['lib'],
    buildScript: 'build.xml',
    defaultEncoding: 'gbk',
    jdkVersion: '1.6',
    sourceVersion: '1.6',
    targetVersion: '1.6',
    outputDir: 'build/classes',
    buildTool: 'ant',
    contextPath: '/',
  });
}

/** Delete every project + workspace binding from the agent catalog. */
export async function purgeCatalog(): Promise<void> {
  // Agent's GET /projects is workspace-scoped (X-Kairo-Workspace-Id required);
  // a plain GET without header returns [] on this version, so we enumerate
  // via workspaces instead to guarantee full cleanup.
  const workspaces = await agentJson<WsRecord[]>('GET', '/workspaces').catch(() => []);
  const wsList: WsRecord[] = Array.isArray(workspaces) ? workspaces : [];
  // collect projects per workspace
  for (const w of wsList) {
    try {
      const res = await fetch(`${AGENT}/api/v1/projects`, { headers: { 'X-Kairo-Workspace-Id': w.id } });
      const body = await res.json().catch(() => null) as any;
      const list: { id: string }[] = Array.isArray(body?.payload) ? body.payload : [];
      for (const p of list) {
        await fetch(`${AGENT}/api/v1/projects/${p.id}`, { method: 'DELETE' }).catch(() => {});
      }
    } catch { /* ignore */ }
  }
  // fallback global attempt (older agents) + workspace deletion
  try {
    const projects = await agentJson<{ id: string }[]>('GET', '/projects').catch(() => []);
    for (const p of projects ?? []) {
      await fetch(`${AGENT}/api/v1/projects/${p.id}`, { method: 'DELETE' }).catch(() => {});
    }
  } catch { /* ignore */ }
  for (const w of wsList) {
    await fetch(`${AGENT}/api/v1/workspaces/${w.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

export async function cleanupTmp(): Promise<void> {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}

export const expectWait = expect;
export { base as test };
