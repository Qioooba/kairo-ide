/**
 * Kairo IDE Browser Full Regression — All 8 SHARDs in one file
 * Port-shifted: frontend :3050, backend :18180, tomcat :8088
 *
 * The fixtures override AGENT_PORT and the Theia baseUrl. The frontend is told
 * the agent URL via the ?kairoAgent= query parameter (handled in RuntimeConnectionService).
 */
require('../setup-tmp.cjs'); // KAIRO_TMP override
import { test as base, expect, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
// Use CJS require so setup-tmp.cjs's monkey-patch of os.tmpdir() is visible.
const os = require('node:os') as typeof import('node:os');

const THEIA_BASE = process.env.THEIA_URL || 'http://127.0.0.1:3050';
const AGENT_PORT = process.env.AGENT_PORT || '18180';
const AGENT_BASE_URL = `http://127.0.0.1:${AGENT_PORT}`;
const KAIRO_AGENT_QUERY = `?kairoAgent=${encodeURIComponent(AGENT_BASE_URL)}`;

const LEGACY_SAMPLE_ROOT = path.resolve(__dirname, '..', '..', 'legacy-sample');

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function removeDirSync(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

interface WorkspaceContext {
  rootPath: string;
  projectName: string;
}

const test = base.extend<{ workspace: WorkspaceContext; agentUrl: string; theiaBase: string }>({
  agentUrl: async ({}, use) => use(AGENT_BASE_URL),
  theiaBase: async ({}, use) => use(THEIA_BASE),
  workspace: async ({}, use) => {
    const projectName = `kairo-rgn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const rootPath = path.join(os.tmpdir(), 'kairo-rgn-workspaces', projectName);
    copyDirSync(LEGACY_SAMPLE_ROOT, rootPath);
    // Register via agent API as a safety net
    try {
      await fetch(`${AGENT_BASE_URL}/api/v1/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: `e2e-${Date.now()}`, payload: { rootPath } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // best-effort
    }
    await use({ rootPath, projectName });
    removeDirSync(rootPath);
  },
});

export { expect, test, THEIA_BASE, AGENT_BASE_URL, KAIRO_AGENT_QUERY, AGENT_PORT };

// ------------------------------------------------------------------
// Reusable UI helpers (mirror fixtures.ts semantics)
// ------------------------------------------------------------------
export async function navigateToTheia(page: Page, baseUrl: string = THEIA_BASE): Promise<void> {
  await page.goto(`${baseUrl}${KAIRO_AGENT_QUERY}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { timeout: 60_000 });
  await page.waitForTimeout(2_000);
}

export async function waitForTheiaShell(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForSelector('#theia-shell, #theia-top-panel, .theia-shell', { timeout });
  await page.waitForTimeout(1_000);
}

export async function getStatusBarText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const sb = document.querySelector('#theia-statusBar');
    return sb ? (sb.textContent || '') : '';
  });
}

export async function waitForStatusContains(
  page: Page,
  needle: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (t.includes(needle)) return t;
    await page.waitForTimeout(500);
  }
  return null;
}

export async function runCommandViaPalette(page: Page, commandLabel: string): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
  await page.waitForSelector('.quick-input-widget', { timeout: 5_000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(commandLabel, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);
}

export async function openFileViaQuickOpen(page: Page, fileName: string): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
  await page.waitForSelector('.quick-input-widget', { timeout: 5_000 });
  await page.keyboard.type(fileName, { delay: 50 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);
}

export async function getBuildViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const buildView = document.querySelector('[data-testid="kairo-build-view"]');
    if (!buildView) return [];
    const items = buildView.querySelectorAll('[data-testid="build-item"]');
    return Array.from(items).map((item) => {
      const stateEl = item.querySelector('[data-testid="build-state"]');
      const summaryEl = item.querySelector('[data-testid="build-summary"]');
      return {
        state: stateEl ? (stateEl.textContent || '').trim() : '',
        summary: summaryEl ? (summaryEl.textContent || '').trim() : '',
      };
    });
  });
}

export async function getServerViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const serverView = document.querySelector('[data-testid="kairo-server-view"]');
    if (!serverView) return [];
    const items = serverView.querySelectorAll('[data-testid="server-item"]');
    return Array.from(items).map((item) => {
      const stateEl = item.querySelector('[data-testid="server-state"]');
      const pidEl = item.querySelector('[data-testid="server-pid"]');
      const portsEl = item.querySelector('[data-testid="server-ports"]');
      return {
        state: stateEl ? (stateEl.textContent || '').trim() : '',
        pid: pidEl ? (pidEl.textContent || '').trim() : '',
        ports: portsEl ? (portsEl.textContent || '').trim() : '',
      };
    });
  });
}

export async function getProblemsViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const view =
      document.querySelector('[data-testid="kairo-problems-view"]') ||
      document.querySelector('.theia-problems') ||
      document.querySelector('.theia-markers');
    if (!view) return [];
    const items = view.querySelectorAll(
      '.theia-marker-container, .problem-marker, [data-testid="problem-item"]',
    );
    return Array.from(items).map((it) => {
      const msg = it.querySelector('.message, .theia-marker-message');
      const loc = it.querySelector('.owner, .theia-marker-owner');
      return {
        message: msg ? (msg.textContent || '').trim() : (it.textContent || '').trim(),
        location: loc ? (loc.textContent || '').trim() : '',
      };
    });
  });
}

export async function waitForBuildState(
  page: Page,
  targetState: string,
  timeoutMs = 120_000,
): Promise<unknown | null> {
  // The build view reports the UI convention ("succeeded") while the
  // agent API reports the external convention ("success"). Normalize
  // both sides so either source satisfies the wait.
  const normalize = (state: string): string => {
    if (state === 'succeeded' || state === 'success') return 'succeeded';
    if (state === 'failed' || state === 'failure') return 'failed';
    return state;
  };
  const want = normalize(targetState);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const builds = await getBuildViewState(page);
    if (builds && builds.length > 0) {
      const last = builds[builds.length - 1] as Record<string, string>;
      if (normalize(last.state) === want) return { ...last, state: want };
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

export async function waitForServerState(
  page: Page,
  targetState: string,
  timeoutMs = 120_000,
): Promise<unknown | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const servers = await getServerViewState(page);
    if (servers && servers.length > 0) {
      for (const srv of servers) {
        if ((srv as Record<string, string>).state === targetState) return srv;
      }
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

export async function waitForJavaReady(page: Page, timeoutMs = 180_000): Promise<boolean> {
  // Session 16 Phase F: Java/JDT LS 状态合并为单个 JDK 条目（JDT LS 状态仅存于 tooltip）。
  // 就绪信号 = JDK 条目显示具体版本（如 "JDK: 17"），启动/占位态为状态词或 "-"。
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (/JDK[：:]\s*\d/.test(t)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

export async function agentApi(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  payload?: unknown,
): Promise<{ status: number; json: Record<string, unknown> | null; body: string }> {
  const url = `${AGENT_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload
        ? JSON.stringify({ requestId: `e2e-${Date.now()}`, payload })
        : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(body); } catch { /* not JSON */ }
    return { status: res.status, json, body };
  } catch (err) {
    return { status: 0, json: null, body: String(err) };
  }
}
