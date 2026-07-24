/**
 * Kairo IDE E2E test fixtures.
 *
 * Provides reusable fixtures for:
 *   - Browser launch (Chromium headless)
 *   - Workspace preparation (create temp project with legacy-sample)
 *   - Workspace cleanup (remove temp project)
 *   - Agent API helpers
 *
 * Usage in tests:
 *   import { test, expect } from './fixtures';
 *   test('my scenario', async ({ theiaPage, workspace }) => { ... });
 */
import { test as base, expect, Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceContext {
  /** Absolute path to the temp workspace directory */
  rootPath: string;
  /** Project name */
  projectName: string;
  /** Source files copied from legacy-sample */
  sourceFiles: string[];
}

export interface AgentApi {
  /** Base URL of the Runtime Agent (e.g. http://127.0.0.1:18080) */
  baseUrl: string;
  /** GET an API endpoint */
  get(endpoint: string): Promise<AgentResponse>;
  /** POST to an API endpoint */
  post(endpoint: string, payload?: unknown): Promise<AgentResponse>;
  /** DELETE an API endpoint */
  delete(endpoint: string): Promise<AgentResponse>;
}

export interface AgentResponse {
  status: number;
  body: string;
  json: Record<string, unknown> | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent API helpers
// ---------------------------------------------------------------------------

const AGENT_PORT = process.env.AGENT_PORT || '18080';
const AGENT_BASE_URL = `http://127.0.0.1:${AGENT_PORT}`;

async function agentFetch(
  method: string,
  endpoint: string,
  payload?: unknown,
): Promise<AgentResponse> {
  const url = `${AGENT_BASE_URL}${endpoint}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify({ requestId: `e2e-${Date.now()}`, payload }) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body, json };
  } catch (err) {
    return { status: 0, body: '', json: null, error: String(err) };
  }
}

function createAgentApi(): AgentApi {
  return {
    baseUrl: AGENT_BASE_URL,
    get: (endpoint) => agentFetch('GET', endpoint),
    post: (endpoint, payload) => agentFetch('POST', endpoint, payload),
    delete: (endpoint) => agentFetch('DELETE', endpoint),
  };
}

// ---------------------------------------------------------------------------
// Workspace fixture helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixture declarations
// ---------------------------------------------------------------------------

type KairoFixtures = {
  /** Agent API client for HTTP-level verification */
  agentApi: AgentApi;
  /** Temp workspace directory with legacy-sample contents */
  workspace: WorkspaceContext;
};

/**
 * Extended test with Kairo-specific fixtures.
 *
 * Fixtures:
 *   - agentApi:  HTTP client for the Runtime Agent API
 *   - workspace: Temp project directory created from legacy-sample
 */
export const test = base.extend<KairoFixtures>({
  // -----------------------------------------------------------------------
  // Agent API fixture — stateless, no teardown needed
  // -----------------------------------------------------------------------
  agentApi: async ({}, use) => {
    const api = createAgentApi();
    await use(api);
  },

  // -----------------------------------------------------------------------
  // Workspace fixture — copies legacy-sample to a temp directory,
  // registers it with the agent, and cleans up after the test.
  // -----------------------------------------------------------------------
  workspace: async ({}, use) => {
    const projectName = `kairo-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rootPath = path.join(os.tmpdir(), 'kairo-e2e-workspaces', projectName);

    // Copy legacy-sample to temp workspace
    copyDirSync(LEGACY_SAMPLE_ROOT, rootPath);

    // Collect source files for reference
    const sourceFiles = collectSourceFiles(rootPath);

    const ctx: WorkspaceContext = { rootPath, projectName, sourceFiles };

    // Register workspace with the agent
    const api = createAgentApi();
    const wsResp = await api.post('/api/v1/workspaces', { rootPath });

    // Use the workspace in the test
    await use(ctx);

    // Cleanup: remove temp directory
    removeDirSync(rootPath);
  },
});

export { expect };

// ---------------------------------------------------------------------------
// UI helpers (reusable across tests)
// ---------------------------------------------------------------------------

/**
 * Helper: open the Theia command palette (F1 key)
 */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('F1');
  await page.waitForSelector('.quick-input-widget .quick-input-box input', {
    timeout: 10_000,
  });
  await page.waitForTimeout(500);
}

/**
 * Helper: type a command into the open command palette
 */
export async function typeInCommandPalette(page: Page, text: string): Promise<void> {
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.fill('');
  await input.type(text, { delay: 50 });
  await page.waitForTimeout(500);
}

/**
 * Helper: select the first result in the quick pick list
 */
export async function selectFirstQuickPick(page: Page): Promise<boolean> {
  const firstRow = page.locator('.monaco-list .monaco-list-row').first();
  try {
    await firstRow.waitFor({ state: 'visible', timeout: 5_000 });
    await firstRow.click();
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: run a command via the command palette
 */
export async function runCommandViaPalette(
  page: Page,
  commandLabel: string,
): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
  await page.waitForSelector('.quick-input-widget', { timeout: 5_000 });
  await page.waitForTimeout(300);
  // Delete the '>' prefix if it's there
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(commandLabel, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);
}

/**
 * Helper: read the Theia status bar text
 */
export async function getStatusBarText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const sb = document.querySelector('#theia-statusBar');
    return sb ? (sb.textContent || '') : '';
  });
}

/**
 * Helper: wait for status bar to contain a specific string
 */
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

/**
 * Helper: wait for the Theia shell to fully load
 */
export async function waitForTheiaShell(page: Page, timeout = 30_000): Promise<void> {
  // Wait for the Theia shell (works on both Welcome page and editor page)
  await page.waitForSelector('#theia-shell, #theia-top-panel, .theia-shell', { timeout });
  // Wait for the activity bar to be visible (indicates Theia is fully loaded)
  await page.waitForSelector('#theia-leftContent, .theia-activity-bar', { timeout: 5_000 }).catch(() => {
    // Activity bar might not be visible on Welcome page, that's OK
  });
  // Give React time to render
  await page.waitForTimeout(1_000);
}

/**
 * Helper: navigate to the Theia IDE
 */
export async function navigateToTheia(
  page: Page,
  baseUrl = 'http://localhost:3000',
): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Wait for the shell to be visible (not necessarily the editor)
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { timeout: 30_000 });
  await page.waitForTimeout(2_000);
}

/**
 * Helper: detect if we're on the Welcome page
 */
export async function isOnWelcomePage(page: Page): Promise<boolean> {
  return (await page.locator('.theia-welcome, .welcome-page').count()) > 0;
}

/**
 * Helper: open a new file to get the editor visible
 */
export async function openNewFile(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
  await page.waitForTimeout(1_000);
}

/**
 * Helper: open a file via "Go to File" quick-open
 */
export async function openFileViaQuickOpen(
  page: Page,
  fileName: string,
): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
  await page.waitForSelector('.quick-input-widget', { timeout: 5_000 });
  await page.keyboard.type(fileName, { delay: 50 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);
}

/**
 * Helper: get the Build View state from the UI
 */
export async function getBuildViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const buildView = document.querySelector('[data-testid="kairo-build-view"]');
    if (!buildView) return [];
    const items = buildView.querySelectorAll('[data-testid="build-item"]');
    const results: unknown[] = [];
    for (const item of items) {
      const stateEl = item.querySelector('[data-testid="build-state"]');
      const summaryEl = item.querySelector('[data-testid="build-summary"]');
      results.push({
        state: stateEl ? stateEl.textContent?.trim() : '',
        summary: summaryEl ? summaryEl.textContent?.trim() : '',
      });
    }
    return results;
  });
}

/**
 * Helper: get the Server View state from the UI
 */
export async function getServerViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const serverView = document.querySelector('[data-testid="kairo-server-view"]');
    if (!serverView) return [];
    const items = serverView.querySelectorAll('[data-testid="server-item"]');
    const results: unknown[] = [];
    for (const item of items) {
      const stateEl = item.querySelector('[data-testid="server-state"]');
      const pidEl = item.querySelector('[data-testid="server-pid"]');
      const portsEl = item.querySelector('[data-testid="server-ports"]');
      results.push({
        state: stateEl ? stateEl.textContent?.trim() : '',
        pid: pidEl ? pidEl.textContent?.trim() : '',
        ports: portsEl ? portsEl.textContent?.trim() : '',
      });
    }
    return results;
  });
}

/**
 * Helper: get the Problems View state from the UI
 */
export async function getProblemsViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    // Theia Problems view uses .theia-problems or .theia-markers
    const problemsView =
      document.querySelector('[data-testid="kairo-problems-view"]') ||
      document.querySelector('.theia-problems') ||
      document.querySelector('.theia-markers');
    if (!problemsView) return [];
    const items = problemsView.querySelectorAll(
      '.theia-marker-container, .problem-marker, [data-testid="problem-item"]',
    );
    const results: unknown[] = [];
    for (const item of items) {
      const messageEl = item.querySelector('.message, .theia-marker-message');
      const locationEl = item.querySelector('.owner, .theia-marker-owner');
      results.push({
        message: messageEl ? messageEl.textContent?.trim() : item.textContent?.trim() || '',
        location: locationEl ? locationEl.textContent?.trim() : '',
      });
    }
    return results;
  });
}

/**
 * Helper: wait for a build to reach a specific state
 */
export async function waitForBuildState(
  page: Page,
  targetState: string,
  timeoutMs = 120_000,
): Promise<unknown | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const builds = await getBuildViewState(page);
    if (builds && builds.length > 0) {
      const last = builds[builds.length - 1] as Record<string, string>;
      if (last.state === targetState) {
        return last;
      }
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

/**
 * Helper: wait for a server to reach a specific state
 */
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
        if ((srv as Record<string, string>).state === targetState) {
          return srv;
        }
      }
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function collectSourceFiles(dir: string): string[] {
  const result: string[] = [];
  function walk(current: string) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.kairo' || entry.name === 'node_modules') continue;
        walk(full);
      } else {
        result.push(full);
      }
    }
  }
  walk(dir);
  return result;
}

// ---------------------------------------------------------------------------
// Sample project fixture helpers
// ---------------------------------------------------------------------------

const SAMPLE_PROJECT_ROOT = path.resolve(
  __dirname,
  'fixtures',
  'sample-project',
);

/**
 * Copies the sample project from tests/e2e/fixtures/sample-project/ into
 * the given workspace directory. Returns the absolute path to the copied
 * project.
 */
export function setupSampleProject(workspace: WorkspaceContext): string {
  const projectPath = path.join(workspace.rootPath, 'sample-project');
  copyDirSync(SAMPLE_PROJECT_ROOT, projectPath);
  return projectPath;
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Waits for JDT LS to be ready. Polls the status bar until "JDT LS: ready"
 * appears or the timeout is reached.
 */
export async function waitForJavaReady(
  page: Page,
  timeoutMs = 120_000,
): Promise<boolean> {
  const result = await waitForStatusContains(page, 'JDT LS: ready', timeoutMs);
  return result !== null;
}

/**
 * Waits for the search index to be built. Polls the status bar for
 * "Search: indexed" or "Search: ready".
 */
export async function waitForSearchIndexed(
  page: Page,
  timeoutMs = 120_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (t.includes('Search: indexed') || t.includes('Search: ready')) {
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Problems helpers
// ---------------------------------------------------------------------------

/**
 * Returns the count of problems in the Problems panel.
 * Assumes the Problems view is visible.
 */
export async function getProblemsCount(page: Page): Promise<number> {
  const problems = await getProblemsViewState(page);
  return problems.length;
}

// ---------------------------------------------------------------------------
// Editor helpers
// ---------------------------------------------------------------------------

/**
 * Returns the text content of the active Monaco editor.
 */
export async function getEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines = document.querySelectorAll('.monaco-editor .view-line');
    return Array.from(lines)
      .map((l) => l.textContent || '')
      .join('\n');
  });
}

/**
 * Opens a file in the editor by its relative path within the workspace.
 * Uses the "Go to File" quick-open palette.
 */
export async function openFileInEditor(
  page: Page,
  filePath: string,
): Promise<void> {
  // Extract just the file name for quick-open matching
  const fileName = path.basename(filePath);
  await openFileViaQuickOpen(page, fileName);
}

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

/**
 * Sets a breakpoint at a specific line number in the given file.
 * First opens the file, then navigates to the line and presses F9.
 */
export async function setBreakpoint(
  page: Page,
  filePath: string,
  lineNumber: number,
): Promise<void> {
  await openFileInEditor(page, filePath);
  await page.waitForTimeout(1_000);

  // Navigate to the target line
  // Use Ctrl+G (Go to Line) to jump to the specific line
  await page.click('.monaco-editor .view-lines');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(500);
  await page.keyboard.type(String(lineNumber), { delay: 30 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Toggle breakpoint on the current line
  await page.keyboard.press('F9');
  await page.waitForTimeout(500);
}

/**
 * Waits for the debug session to pause (e.g., at a breakpoint).
 * Checks the status bar for "Debug: paused".
 */
export async function waitForDebugPaused(
  page: Page,
  timeoutMs = 60_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (t.includes('Debug: paused')) {
      return true;
    }
    // Also check for the debug paused indicator in the DOM
    const pausedInDom = await page.evaluate(() => {
      const highlighted = document.querySelector(
        '.monaco-editor .debug-current-line, .monaco-editor .debug-top-stack-frame',
      );
      return highlighted !== null;
    });
    if (pausedInDom) {
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * Returns the list of variables visible in the Debug Variables view.
 */
export async function getDebugVariables(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const varsWidget = document.querySelector(
      '.debug-variables, .debug-view .variables, [data-testid="debug-variables"]',
    );
    if (!varsWidget) return [];
    const items = varsWidget.querySelectorAll(
      '.theia-TreeNode, .monaco-list-row, [data-testid="variable-item"]',
    );
    return Array.from(items).map((el) => el.textContent?.trim() || '');
  });
}