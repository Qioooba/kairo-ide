/**
 * Shared helpers for the comprehensive browser test campaign.
 * Strictly derived from docs/COMPREHENSIVE_TEST_DOCUMENT.md (v0.1.0).
 *
 * Lane env: THEIA_URL, AGENT_PORT (no auth in test lanes).
 */
import { expect, Page } from '@playwright/test';

export const AGENT = `http://127.0.0.1:${process.env.AGENT_PORT || '18080'}`;
export const THEIA_URL = process.env.THEIA_URL || 'http://127.0.0.1:3000';

export interface AgentResp {
  status: number;
  json: any | null;
  body: string;
}

/** Call the runtime agent REST API (envelope: {requestId, payload}). */
export async function api(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  payload?: unknown,
): Promise<AgentResp> {
  const res = await fetch(`${AGENT}/api/v1${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload !== undefined ? JSON.stringify({ requestId: `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`, payload }) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* html or empty */
  }
  return { status: res.status, json, body };
}

/**
 * Open Theia and wait until the workbench shell is interactive.
 * Handles the workspace trust dialog if it appears.
 */
export async function openIde(page: Page): Promise<void> {
  // Pin the lane ROOT workspace via URL fragment — otherwise the backend
  // serves getMostRecentlyUsedWorkspace() and a single File>Open Folder
  // test permanently re-binds every fresh page to a subfolder workspace
  // (different agent workspaceId ⇒ empty project lists downstream).
  await page.goto(`/#${encodeURI(LANE_WS)}`, { waitUntil: 'domcontentloaded' });
  // Trust dialog (workspace.trust.enabled true in browser app config)
  const trustButton = page.getByRole('button', { name: /Yes, I trust|是，我信任|trust the authors$/i }).first();
  try {
    await trustButton.click({ timeout: 15_000 });
    // Theia reloads/re-renders after trusting; wait for shell again below
  } catch {
    /* no dialog — fine */
  }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
}

/** Open a widget via F1 command palette. Returns after palette closes. */
export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press('F1');
  const input = page.locator('.quick-input-widget .quick-input-box input').first();
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(`>${label}`);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

/** The kairo status bar segment container entries. */
export function statusBarEntry(page: Page, text: string) {
  return page.locator('#theia-statusBar .kairo-sb-entry', { hasText: text });
}

/** Collect console errors + page errors + failed requests for a whole test. */
export function attachDiagnostics(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (!url.includes('favicon') && !url.includes('websocket')) failedRequests.push(`${r.method()} ${url}`);
  });
  return { consoleErrors, pageErrors, failedRequests };
}

/* ------------------------------------------------------------------ */
/*  Chapter 5/6/7 helpers                                               */
/* ------------------------------------------------------------------ */

import * as path from 'path';

/** Absolute path of the lane's served workspace folder. */
export const LANE_WS =
  process.env.LANE_WS ||
  path.resolve(__dirname, '..', '..', '..', '.test-lanes', 'A', 'workspace');

/**
 * Startup console noise that is pre-existing/benign in this build
 * (Theia core DI warnings and duplicate preference registrations).
 * Anything outside this list is treated as an unexpected error.
 */
export const CONSOLE_ALLOWLIST: RegExp[] = [
  /NavigatorTreeDecorator.*asynchronous dependencies/i,
  /Property with id .* already exists/i,
  /A command .* is already registered/i,
  /Linked preference .* not found/i,
  /Failed to load resource/i,
  /\[theia\]/i,
  /Use of umd/i,
  /Passwordfield is deprecated/i,
  // BUG-20260826-108 (P3, cosmetic): some Kairo list widgets render arrays
  // without React keys in rare paths — React logs this as console.error.
  /Each child in a list should have a unique .key. prop/i,
];

export function unexpectedConsoleErrors(errors: string[]): string[] {
  return errors.filter((e) => !CONSOLE_ALLOWLIST.some((re) => re.test(e)));
}

/** Open a top-level menu (File/Edit/…). The dropdown stays open afterwards. */
export async function openMainMenu(page: Page, topLabel: string): Promise<void> {
  await page
    .locator('[role="menubar"] .lm-MenuBar-item', { hasText: topLabel })
    .first()
    .click();
  await page
    .locator('.lm-Menu:not(.lm-mod-hidden)')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(250);
}

export interface MenuItemOptions {
  /** data-command prefix — Theia appends a unique ":N" suffix per action. */
  command?: string;
  /** Exact visible label text of the item. */
  label?: string;
}

export function menuItemLocator(page: Page, opts: MenuItemOptions): import('@playwright/test').Locator {
  // Scope strictly to currently-open menus — detached template menus keep
  // duplicate items in the DOM that would otherwise shadow the live entry.
  if (opts.command) {
    return page.locator(`.lm-Menu:not(.lm-mod-hidden) .lm-Menu-item[data-command^="${opts.command}:"]`).first();
  }
  return page
    .locator('.lm-Menu:not(.lm-mod-hidden) .lm-Menu-item', {
      has: page.locator('.lm-Menu-itemLabel', { hasText: opts.label! }),
    })
    .first();
}

async function ensureMenuOpen(page: Page): Promise<void> {
  await page.locator('.lm-Menu:not(.lm-mod-hidden)').first().waitFor({ state: 'visible', timeout: 10_000 });
}

/** Click a menu item identified by command id or label. Menu must be open. */
export async function clickMenuItem(page: Page, opts: MenuItemOptions): Promise<void> {
  await ensureMenuOpen(page);
  const item = menuItemLocator(page, opts);
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  await item.click();
  await page.waitForTimeout(400);
}

/** Hover a submenu parent so its child menu expands. */
export async function hoverSubmenu(page: Page, opts: MenuItemOptions): Promise<void> {
  await ensureMenuOpen(page);
  const item = menuItemLocator(page, opts);
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  await item.hover();
  await page.waitForTimeout(700);
  // some builds need a second hover event before the submenu mounts
  await item.hover().catch(() => undefined);
  await page.waitForTimeout(500);
}

/** All visible menu entries as "label :: data-command" strings. */
export async function dumpVisibleMenuItems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const menu of Array.from(document.querySelectorAll('.lm-Menu'))) {
      const style = window.getComputedStyle(menu);
      if (style.display === 'none' || menu.offsetParent === null) continue;
      for (const item of Array.from(menu.querySelectorAll('.lm-Menu-item'))) {
        const label = item.querySelector('.lm-Menu-itemLabel')?.textContent?.trim() ?? '';
        const cmd = item.getAttribute('data-command') ?? '';
        out.push(`${label} :: ${cmd}`);
      }
    }
    return out;
  });
}

/** Close any open menu / dialog overlay. */
export async function escapeOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    } catch { /* ignore */ }
  }
}

/** Open a workspace file via the Go>Go to File quick open (menu-driven). */
export async function openFileViaQuickOpen(page: Page, fileName: string): Promise<void> {
  const input = page.locator('.quick-input-widget .quick-input-box input').first();
  await openMainMenu(page, 'Go');
  await clickMenuItem(page, { command: 'file-search.openFile' });
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(fileName);
  const row = page.locator('.quick-input-widget .monaco-list-row', { hasText: fileName }).first();
  try {
    await row.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    // retry — the file index may lag right after creating the file
    await input.fill('');
    await page.waitForTimeout(600);
    await input.fill(fileName);
    await row.waitFor({ state: 'visible', timeout: 8_000 });
  }
  await input.press('Enter');
  await page.waitForTimeout(1200);
}

/** Focus the active Monaco editor by clicking its text area surface. */
export async function focusEditor(page: Page): Promise<void> {
  await page.locator('.monaco-editor:visible .view-lines').first().click();
  await page.waitForTimeout(250);
}

/** Names of all main-area tabs. */
export async function mainTabNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tabLabel')).map(
      (el) => el.textContent?.trim() ?? '',
    ),
  );
}

/** Wait until a main-area tab matching the regex exists. */
export async function waitForMainTab(page: Page, nameRe: RegExp, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    ([src, flags]) => {
      const re = new RegExp(src, flags);
      return Array.from(document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tabLabel')).some(
        (el) => re.test(el.textContent ?? ''),
      );
    },
    [nameRe.source, nameRe.flags] as [string, string],
    { timeout },
  );
}

export function mainTab(page: Page, nameRe: RegExp) {
  return page.locator('#theia-main-content-panel .lm-TabBar-tab').filter({
    has: page.locator('.lm-TabBar-tabLabel', { hasText: nameRe }),
  }).first();
}

/** Left/right side panel tab bar labels (Explorer/Search/Servers/...). */
export async function sideTabNames(page: Page, area: 'left' | 'right'): Promise<string[]> {
  return page.evaluate((a) =>
    Array.from(document.querySelectorAll(`#theia-${a}-content-panel .lm-TabBar-tabLabel`)).map(
      (el) => el.textContent?.trim() ?? '',
    ),
  area);
}

/** Status bar entry containing the given text. */
export function sbEntry(page: Page, textRe: RegExp) {
  return page.locator('#theia-statusBar .element').filter({ hasText: textRe }).first();
}

/** Ensure the agent knows the lane workspace; returns its workspaceId. */
export async function ensureWorkspace(): Promise<string> {
  const list = await api('GET', '/workspaces');
  const found = (list.json?.payload ?? []).find(
    (w: { rootPath: string }) => String(w.rootPath).replace(/\/+$/, '') === LANE_WS.replace(/\/+$/, ''),
  );
  if (found) return found.id;
  const created = await api('POST', '/workspaces', { rootPath: LANE_WS, name: 'workspace' });
  if (created.json?.payload?.id) return created.json.payload.id;
  throw new Error(`cannot resolve lane workspace: ${created.body.slice(0, 200)}`);
}

/** Agent request that carries the lane workspace binding (header + envelope). */
export async function apiWs(
  method: 'GET' | 'POST',
  endpoint: string,
  workspaceId: string,
  payload?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${AGENT}/api/v1${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Kairo-Workspace-Id': workspaceId },
    body: method === 'GET' ? undefined : JSON.stringify({ requestId: `tcws-${Date.now()}`, ...(payload !== undefined ? { payload } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* ignore */ }
  return { status: res.status, json };
}

export interface ImportedProject { id: string; name: string }

/** Import (register) a project directory with the runtime agent. */
export async function importProjectApi(opts: {
  workspaceId: string;
  rootPath: string;
  name: string;
  encoding?: string;
}): Promise<ImportedProject> {
  const body = {
    workspaceId: opts.workspaceId,
    rootPath: opts.rootPath,
    name: opts.name,
    sourceDirs: ['src'],
    webRoot: 'WebRoot',
    libDirs: ['lib'],
    buildScript: 'build.xml',
    defaultEncoding: (opts.encoding ?? 'gbk'),
    jdkVersion: '1.8',
    sourceVersion: '1.8',
    targetVersion: '1.8',
    outputDir: 'build/classes',
    buildTool: 'ant' as const,
    contextPath: `/${opts.name}`,
  };
  const res = await api('POST', '/projects/import', body);
  const p = res.json?.payload;
  if (!p?.id) throw new Error(`project import failed: ${res.body.slice(0, 300)}`);
  return { id: p.id, name: p.name ?? opts.name };
}

/**
 * Resolve the agent workspace id the given page is bound to by watching
 * the kairo events WebSocket URL (?workspaceId=…). Reloads the page once
 * to force a fresh connection (handles trust dialog transparently).
 */
export async function discoverBoundWorkspaceId(page: Page): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no kairo events websocket observed')), 60_000);
    const handler = (ws: import('@playwright/test').WebSocket): void => {
      const m = ws.url().match(/[?&]workspaceId=(ws_[A-Za-z0-9]+)/);
      if (m) {
        clearTimeout(timer);
        page.off('websocket', handler);
        resolve(m[1]);
      }
    };
    page.on('websocket', handler);
    void page.reload({ waitUntil: 'domcontentloaded' }).then(async () => {
      const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任|trust the authors$/i }).first();
      try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
      await page.waitForSelector('#theia-app-shell', { timeout: 90_000 });
    }).catch(() => undefined);
  });
}

/** Import a project into `wsId`; on global-name conflict rebind via delete+import. */
export async function ensureProjectInWs(wsId: string, proj: { rootPath: string; name: string; encoding?: string }): Promise<void> {
  try {
    await importProjectApi({ workspaceId: wsId, ...proj });
    return;
  } catch { /* name registered under another workspace */ }
  const list = await api('GET', '/projects');
  const found = (list.json?.payload ?? []).find((p: { name: string }) => p.name === proj.name);
  if (found?.id) {
    await api('DELETE', `/projects/${found.id}`);
  }
  await importProjectApi({ workspaceId: wsId, ...proj });
}

/** Create a Tomcat run configuration entry via API. */
export async function createRunConfigApi(workspaceId: string, cfg: {
  id: string; name: string; projectId: string; mode: 'run' | 'debug'; httpPort: number;
}): Promise<void> {
  const res = await api('POST', `/workspaces/${workspaceId}/run-configurations`, {
    id: cfg.id,
    name: cfg.name,
    type: 'tomcat6',
    projectId: cfg.projectId,
    mode: cfg.mode,
    suspend: false,
    jdkRef: 'kairo-jdk',
    build: { type: 'javac', clean: false },
    server: { id: 'tomcat-local', httpPort: cfg.httpPort, debugPort: 8000 + Math.floor(Math.random() * 100), contextPath: '/app' },
    deploy: { mode: 'exploded', artifact: 'legacy-sample.war' },
    env: {},
    vmOptions: [],
    beforeLaunchTasks: [],
  });
  if (res.status >= 400) throw new Error(`run-config create failed: ${res.body.slice(0, 200)}`);
}
