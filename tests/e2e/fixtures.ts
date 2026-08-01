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
require('../setup-tmp.cjs'); // KAIRO_TMP override
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

const AGENT_PORT = process.env.AGENT_PORT || '18300';
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
  // Workspace fixture — uses the shared E2E workspace that matches the
  // Theia browser startup folder so the Explorer shows project files.
  // -----------------------------------------------------------------------
  workspace: async ({}, use) => {
    const projectName = 'legacy-sample';
    const rootPath = path.join(os.tmpdir(), 'kairo-e2e-workspaces', projectName);

    // Ensure the shared workspace exists and is up-to-date
    removeDirSync(rootPath);
    copyDirSync(LEGACY_SAMPLE_ROOT, rootPath);

    // Collect source files for reference
    const sourceFiles = collectSourceFiles(rootPath);

    const ctx: WorkspaceContext = { rootPath, projectName, sourceFiles };

    // Register workspace with the agent (idempotent)
    const api = createAgentApi();
    await api.post('/api/v1/workspaces', { rootPath });

    // Use the workspace in the test
    await use(ctx);

    // Note: we do NOT delete the shared workspace because Theia is running
    // against it. It is refreshed on the next test run.
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
 *
 * Theia auto-fills the input with ">" when F1 is pressed, which is the
 * "command palette" mode marker. Clearing the ">" drops the input out
 * of command-palette mode and the filter shows 0 results regardless
 * of what is typed. KAIRO-RC-WEB-2026-07-25-03: keep the ">" prefix
 * and append the command label after it.
 */
export async function runCommandViaPalette(
  page: Page,
  commandLabel: string,
): Promise<void> {
  // Close any already-open quick input so the previous command text
  // does not leak into this invocation (KAIRO-RC-WEB-2026-07-26-22).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
  const input = page.locator('.quick-input-widget .quick-input-box input');
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(300);
  // Theia auto-fills the input with ">" when the palette opens.
  // Programmatically set the value so the command-mode prefix is
  // preserved and stale text is fully replaced.
  await input.fill('>' + commandLabel);
  await page.waitForTimeout(500);
  // Ensure the first matching command is focused before confirming.
  const firstRow = page.locator('.quick-input-widget .monaco-list-row').first();
  if (await firstRow.count() > 0) {
    try {
      await firstRow.waitFor({ state: 'visible', timeout: 2_000 });
      await firstRow.click();
    } catch {
      await page.keyboard.press('Enter');
    }
  } else {
    await page.keyboard.press('Enter');
  }
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
 * Helper: dismiss the workspace trust dialog if it appears.
 *
 * Theia shows a dialog when opening an untrusted workspace (e.g. /tmp).
 * The dialog intercepts pointer events so all subsequent clicks fail until
 * it is dismissed. We click "Yes, I trust the authors".
 *
 * The dialog can appear asynchronously after the shell loads, so we wait
 * up to 10s for it. If it never shows (trusted workspace), we return
 * silently.
 */
export async function dismissTrustDialog(page: Page, timeoutMs = 10_000): Promise<void> {
  // Wait for the dialog block to appear (the visible part of the trust dialog)
  const dialogBlock = page.locator('.dialogBlock, .workspace-trust-dialog');
  try {
    await dialogBlock.first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    // No trust dialog appeared — workspace already trusted or not configured
    return;
  }
  // The "Yes" button contains text like "Yes, I trust the authors"
  const yesBtn = page.locator('button:has-text("Yes, I trust")').first();
  try {
    await yesBtn.waitFor({ state: 'visible', timeout: 3_000 });
    await yesBtn.click({ timeout: 3_000 });
  } catch {
    // Fallback: try by regex pattern
    const fallback = page.locator('button', { hasText: /yes,?\s*i\s*trust/i }).first();
    if ((await fallback.count()) > 0) {
      try {
        await fallback.click({ timeout: 3_000 });
      } catch {
        /* dialog may have been auto-dismissed */
      }
    }
  }
  // Wait for the dialog to actually disappear
  await page.waitForSelector('.dialogBlock, .workspace-trust-dialog', {
    state: 'detached',
    timeout: 5_000,
  }).catch(() => {/* may have already closed */});
  await page.waitForTimeout(500);
}

/**
 * Helper: dismiss the "save workspace configuration" dialog if it appears.
 *
 * Theia prompts to save the current workspace file when switching to a
 * different workspace root (e.g. after the import wizard opens a project
 * folder). The dialog blocks the workspace switch until it is dismissed.
 * We click "Don't Save" so the previous temporary workspace is discarded
 * and the new project root is loaded.
 */
export async function dismissSaveWorkspaceDialog(page: Page, timeoutMs = 10_000): Promise<void> {
  const dialogBlock = page.locator('.dialogBlock, .save-workspace-dialog');
  try {
    await dialogBlock.first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    // No save-workspace dialog appeared
    return;
  }
  const dontSaveBtn = page.locator('button:has-text("Don\'t Save")').first();
  try {
    await dontSaveBtn.waitFor({ state: 'visible', timeout: 3_000 });
    await dontSaveBtn.click({ timeout: 3_000 });
  } catch {
    // Fallback: try by regex pattern
    const fallback = page.locator('button', { hasText: /don\'t\s+save/i }).first();
    if ((await fallback.count()) > 0) {
      try {
        await fallback.click({ timeout: 3_000 });
      } catch {
        /* dialog may have been auto-dismissed */
      }
    }
  }
  await page.waitForSelector('.dialogBlock, .save-workspace-dialog', {
    state: 'detached',
    timeout: 5_000,
  }).catch(() => {/* may have already closed */});
  await page.waitForTimeout(500);
}

/**
 * Helper: wait for the Theia shell to fully load
 */
export async function waitForTheiaShell(page: Page, timeout = 30_000): Promise<void> {
  // Wait for the Theia shell to be attached (it may start hidden during loading)
  await page.waitForSelector('#theia-shell, #theia-top-panel, .theia-shell', { state: 'attached', timeout });
  // Wait for the activity bar to be visible (indicates Theia is fully loaded).
  // Kairo uses Lumino: .theia-app-left is the vertical activity bar (lm-TabBar).
  await page.waitForSelector('.theia-app-left.lm-TabBar, #theia-left-content-panel', { timeout: 5_000 }).catch(() => {
    // Activity bar might not be visible on Welcome page, that's OK
  });
  // Give React time to render
  await page.waitForTimeout(1_000);
}

/**
 * Helper: open the file explorer widget if it is not already visible.
 *
 * KAIRO-RC-WEB-2026-07-25-05: the file tree is rendered inside the
 * "Files" shell tab. The widget is registered but is NOT auto-activated
 * after `Kairo: Import Project` completes — the wizard just returns to
 * the previous shell state. Tests that assert on `.theia-TreeNode`
 * must call this helper first; otherwise they will time out waiting
 * for nodes that have not been mounted yet.
 *
 * Idempotent: if the tree is already visible, returns immediately.
 */
export async function openFileExplorer(page: Page, timeoutMs = 10_000): Promise<boolean> {
  // Already visible? Check the shell tab id used by Theia.
  const filesTab = page.locator('#shell-tab-explorer-view-container--files');
  if ((await filesTab.count()) > 0) {
    // If the tab itself is visible, click it to ensure activation
    const isVisible = await filesTab.first().isVisible().catch(() => false);
    if (isVisible) {
      await filesTab.first().click({ force: true });
    }
  }
  // Try clicking the explorer shell tab to ensure it's the active one
  const tabBar = page.locator('#shell-tab-explorer-view-container');
  if ((await tabBar.count()) > 0) {
    try {
      await tabBar.first().click({ force: true });
    } catch {
      /* may already be active */
    }
  }
  // The trust dialog may still be showing after the workspace switched.
  // It blocks the tree from rendering, so dismiss it before waiting.
  await dismissTrustDialog(page, 5_000).catch(() => {/* already dismissed */});

  // Wait for at least one tree node to appear
  const treeNode = page.locator('.theia-TreeNode').first();
  try {
    await treeNode.waitFor({ state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: navigate to the Theia IDE
 */
export async function navigateToTheia(
  page: Page,
  baseUrl?: string,
): Promise<void> {
  const theiaPort = process.env.THEIA_PORT || '18301';
  let url = baseUrl || process.env.THEIA_URL || `http://127.0.0.1:${theiaPort}`;
  // KAIRO-RC-WEB-015: browser builds default to agent 127.0.0.1:18080.
  // When running on a shifted port, inject the agent address via query param
  // so the runtime-extension connects to the correct backend.
  const agentPort = process.env.AGENT_PORT || AGENT_PORT;
  if (!url.includes('kairoAgent=')) {
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}kairoAgent=http://127.0.0.1:${agentPort}`;
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Wait for the shell to be attached (it may start hidden during loading)
  await page.waitForSelector('#theia-app-shell, .theia-shell, #theia-shell', { state: 'attached', timeout: 30_000 });
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
 * Helper: complete the Kairo Import Project wizard for the given project path.
 *
 * The wizard is a 3-step flow:
 *   1. Fill in the path and click "Scan"
 *   2. Review detection and click "Import Project"
 *   3. Click "Open Project Folder" to load the workspace
 *
 * If the wizard is already open (e.g. the test triggered it), we
 * detect the current step from the DOM and continue. If a step is
 * already complete we skip it. If the import is already done
 * (a workspace is loaded) we exit early.
 */
export async function runKairoImportWizard(
  page: Page,
  projectPath: string,
  options: { openProject?: boolean; timeoutMs?: number } = {},
): Promise<{ opened: boolean; reason: string }> {
  const openProject = options.openProject !== false;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  // Check if import wizard is already open; if not, open it via the command palette.
  const wizardOpen = (await page.locator('[data-testid="path-input"]').count()) > 0;
  if (!wizardOpen) {
    await runCommandViaPalette(page, 'Kairo: Import Project');
    // Wait for step 1
    try {
      await page.waitForSelector('[data-testid="path-input"]', { timeout: 15_000 });
    } catch {
      return { opened: false, reason: 'import-wizard-did-not-open' };
    }
  }

  // Step 1: Fill path and click Scan
  const pathInput = page.locator('[data-testid="path-input"]').first();
  await pathInput.click();
  await pathInput.fill(projectPath);
  // Click the Scan button to advance to step 2
  const scanBtn = page.locator('[data-testid="scan-btn"]').first();
  if (await scanBtn.count() > 0 && await scanBtn.isEnabled()) {
    await scanBtn.click();
  } else {
    // Fallback: press Enter in the path input
    await pathInput.press('Enter');
  }

  // Wait for step 2 to appear
  try {
    await page.waitForSelector('[data-testid="import-project-btn"]', {
      timeout: 30_000,
    });
  } catch {
    return { opened: false, reason: 'scan-did-not-advance' };
  }
  if (Date.now() > deadline) {
    return { opened: false, reason: 'timeout-before-step-2' };
  }

  // Step 2: Click "Import Project"
  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  if (await importBtn.count() === 0) {
    return { opened: false, reason: 'import-button-missing' };
  }
  await importBtn.click();

  // Wait for step 3 to appear (or the wizard to close)
  try {
    await page.waitForSelector('[data-testid="open-project-btn"]', {
      timeout: 30_000,
    });
  } catch {
    return { opened: false, reason: 'import-did-not-complete' };
  }
  if (Date.now() > deadline) {
    return { opened: false, reason: 'timeout-before-step-3' };
  }

  if (openProject) {
    // Step 3: Click "Open Project Folder"
    const openBtn = page.locator('[data-testid="open-project-btn"]').first();
    if (await openBtn.count() > 0) {
      // Use a non-zero wait so the click is registered and the
      // workspace spliceRoots() actually executes. Without this,
      // a fast test machine can race the React state update and
      // leave the workspace unset.
      await openBtn.click();
      await page.waitForTimeout(500);
    }
    // KAIRO-RC-WEB-2026-07-25-09: opening a different workspace root
    // can prompt "Do you want to save your workspace configuration?".
    // Dismiss it so the workspace switch actually completes.
    await dismissSaveWorkspaceDialog(page, 10_000).catch(() => {/* already dismissed */});
    // KAIRO-RC-WEB-2026-07-25-08: switching the workspace root
    // via spliceRoots() triggers Theia's workspace-trust dialog
    // for the newly opened folder, even if the test dismissed
    // the dialog before opening the wizard. Re-dismiss here so
    // subsequent commands (build / debug / editor interactions)
    // are not blocked by an overlay.
    await dismissTrustDialog(page, 10_000).catch(() => {/* already dismissed */});
    // Wait for the workspace to be loaded. KAIRO-RC-WEB-2026-07-25-06:
    // the status bar entry renders `Project: (no workspace)` when no
    // project is active, which still contains the literal `Project: `
    // prefix and confuses the original `waitForStatusContains` check.
    // We must wait for the placeholder to disappear, not just for
    // the prefix to appear.
    // KAIRO-RC-WEB-2026-07-25-10: the save-workspace and trust dialogs can
    // appear asynchronously *during* the workspace switch, so we dismiss
    // them inside the poll loop instead of waiting once and hoping the
    // timing is right.
    const start = Date.now();
    let ready: string | null = null;
    while (Date.now() - start < 30_000) {
      await dismissSaveWorkspaceDialog(page, 1_000).catch(() => {/* already dismissed */});
      await dismissTrustDialog(page, 1_000).catch(() => {/* already dismissed */});
      const t = await getStatusBarText(page);
      if (!t.includes('Project: (no workspace)') && t.includes('Project: ')) {
        ready = t;
        break;
      }
      await page.waitForTimeout(500);
    }
    if (ready) {
      // Make sure the wizard widget is closed and the explorer shows the files
      await page.waitForTimeout(1_500);
      // The trust dialog can appear asynchronously after the workspace
      // file is updated; dismiss it again so the caller sees the files.
      await dismissTrustDialog(page, 5_000).catch(() => {/* already dismissed */});
      await dismissSaveWorkspaceDialog(page, 5_000).catch(() => {/* already dismissed */});
    }
    return { opened: ready !== null, reason: ready ? 'opened' : 'project-not-in-status' };
  }
  return { opened: true, reason: 'wizard-at-step-3' };
}

/**
 * Helper: ensure the given project is the active Kairo project in Theia.
 *
 * The ActiveProjectService auto-selects based on workspace context and
 * persisted storage; in isolated tests this can end up driving the wrong
 * project (e.g. a sibling SHARD workspace left in storage). Opening the
 * Project Selector and clicking the desired project makes every
 * subsequent "Kairo: Build / Start Server / ..." command deterministic.
 */
export async function selectActiveProject(page: Page, projectId: string, timeoutMs = 15_000): Promise<boolean> {
  await runCommandViaPalette(page, 'Kairo: Select Project');
  const selector = `[data-testid="project-item-${projectId}"]`;
  try {
    const item = page.locator(selector).first();
    await item.waitFor({ state: 'visible', timeout: timeoutMs });
    await item.click();
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: right-click a DOM element and select a context-menu item.
 *
 * Theia renders context menus in a `.monaco-menu` / `.theia-Menu` / `.context-view`
 * overlay. This helper waits for the menu, finds an item whose text contains
 * `commandLabel`, and clicks it. Use this when the command palette would match
 * multiple commands with the same label (e.g. "Rename" can be the file rename
 * command or Monaco's symbol rename).
 */
export async function triggerContextMenuCommand(
  page: Page,
  targetSelector: string,
  commandLabel: string,
  timeoutMs = 10_000,
): Promise<void> {
  const target = page.locator(targetSelector).first();
  await target.waitFor({ state: 'visible', timeout: timeoutMs });
  await target.click({ button: 'right' });
  await page.waitForTimeout(300);
  // Wait for the context menu to render. Theia may place it in a
  // `.monaco-menu` container, a `.context-view` overlay, or directly in
  // the document body with menu-item classes. Wait for any visible element
  // that contains the requested label.
  let menuItem = page
    .locator('.monaco-menu .action-item, .theia-Menu .action-item, .context-view .action-item, .monaco-menu .monaco-menu-item, .theia-Menu .theia-MenuItem, [class*="menu-item"]', {
      hasText: commandLabel,
    })
    .first();
  try {
    await menuItem.waitFor({ state: 'visible', timeout: 5_000 });
  } catch (err) {
    // Fallback: search any visible element with the label and a menu-related ancestor.
    const allCandidates = page.locator('text=' + commandLabel).filter({
      has: page.locator('xpath=ancestor::*[contains(@class, "menu") or contains(@class, "Menu") or contains(@class, "context-view")]'),
    });
    menuItem = allCandidates.first();
    try {
      await menuItem.waitFor({ state: 'visible', timeout: 3_000 });
    } catch {
      // Debug: dump the rendered context menu DOM so we can fix selectors
      const menuInfo = await page.evaluate(() => {
        const menus = document.querySelectorAll('.monaco-menu, .theia-Menu, .context-view, [class*="menu"]');
        return Array.from(menus).map((m) => ({
          className: m.className,
          ariaHidden: m.getAttribute('aria-hidden'),
          visible: !!((m as HTMLElement).offsetWidth && (m as HTMLElement).offsetHeight),
          items: Array.from(m.querySelectorAll('*')).map((el) => ({
            tag: el.tagName,
            className: el.className,
            text: el.textContent?.trim().slice(0, 100),
          })),
        }));
      });
      console.error('Context menu debug:', JSON.stringify(menuInfo, null, 2));
      throw err;
    }
  }
  await menuItem.click();
  await page.waitForTimeout(500);
}

/**
 * Helper: get the Build View state from the UI / API
 *
 * KAIRO-RC-WEB-2026-07-25: the build view widget is only
 * mounted when the user explicitly opens the "Kairo: Show
 * Builds" view, so the DOM-based lookup only sees the state
 * when the panel is visible. We fall back to the Runtime
 * Agent's `/api/v1/builds` endpoint which is the source of
 * truth and is always available, even when no build view is
 * open. This makes `waitForBuildState` work on the cold path
 * (test never opened the view) AND on the warm path (test
 * already opened the view).
 */
export async function getBuildViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(async (agentBase) => {
    // Try the UI first — if the view is mounted, the data-state
    // attribute is authoritative.
    const buildView = document.querySelector('[data-testid="build-view"]');
    if (buildView) {
      const stateEl = buildView.querySelector('[data-testid="build-state"]');
      const summaryEl = buildView.querySelector('[data-testid="build-summary"]');
      if (stateEl) {
        const stateText = stateEl.textContent?.trim() || '';
        const stateAttr = stateEl.getAttribute('data-state') || '';
        const stateValue = stateAttr || stateText;
        return [
          {
            state: stateValue,
            stateText,
            stateAttr,
            summary: summaryEl ? summaryEl.textContent?.trim() : '',
            source: 'ui',
          },
        ];
      }
    }
    // Fall back to the Runtime Agent API. The most recent build
    // is the source of truth for the current state.
    try {
      const res = await fetch(`${agentBase}/api/v1/builds`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return [];
      const body = await res.json();
      const list = body?.payload || [];
      if (!Array.isArray(list) || list.length === 0) return [];
      const last = list[list.length - 1];
      return [
        {
          state: last.state,
          stateText: last.state,
          stateAttr: last.state,
          summary: last.output ? String(last.output).slice(0, 256) : '',
          source: 'api',
        },
      ];
    } catch {
      return [];
    }
  }, AGENT_BASE_URL);
}

/**
 * Helper: get the Server View state from the UI / API
 *
 * Same pattern as the build view: prefer the DOM if the
 * server view widget is mounted, otherwise hit
 * `/api/v1/servers` to learn the current state.
 */
export async function getServerViewState(page: Page): Promise<unknown[]> {
  return page.evaluate(async (agentBase) => {
    const serverView = document.querySelector('[data-testid="server-view"]');
    if (serverView) {
      const stateEl = serverView.querySelector('[data-testid="server-state"]');
      const urlEl = serverView.querySelector('[data-testid="server-url-link"]');
      if (stateEl) {
        const stateText = stateEl.textContent?.trim() || '';
        const stateAttr = stateEl.getAttribute('data-state') || '';
        const stateValue = stateAttr || stateText;
        return [
          {
            state: stateValue,
            stateText,
            stateAttr,
            url: urlEl ? urlEl.getAttribute('href') || urlEl.textContent?.trim() : '',
            httpPort: 0,
            debugPort: 0,
            source: 'ui',
          },
        ];
      }
    }
    try {
      const res = await fetch(`${agentBase}/api/v1/servers`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return [];
      const body = await res.json();
      const list = body?.payload || [];
      if (!Array.isArray(list) || list.length === 0) return [];
      return list.map((s: Record<string, unknown>) => {
        const ports = (s.ports as Record<string, number>) || {};
        return {
          state: s.state,
          stateText: String(s.state || ''),
          stateAttr: String(s.state || ''),
          url: s.url || '',
          httpPort: ports.http || 0,
          debugPort: ports.debug || 0,
          source: 'api',
        };
      });
    } catch {
      return [];
    }
  }, AGENT_BASE_URL);
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
 *
 * KAIRO-RC-WEB-2026-07-25: the build state machine uses two
 * different naming conventions depending on the source:
 *   - The UI's `data-state` attribute is the BuildStateType from
 *     `build-view-widget.tsx` (e.g. "succeeded", "failed",
 *     "running", "cancelled").
 *   - The Runtime Agent's `/api/v1/builds` endpoint returns the
 *     "external" state name from `protocol/types.go` (e.g.
 *     "success" instead of "succeeded", "failure" instead of
 *     "failed"). This is intentional — the API uses shorter
 *     names and the UI maps them via `mapBuildResult`.
 *
 * To make tests robust to whichever view they see, we accept
 * BOTH naming conventions and normalise to the API form before
 * comparing.
 */
export async function waitForBuildState(
  page: Page,
  targetState: string,
  timeoutMs = 120_000,
): Promise<unknown | null> {
  // Normalize both the target and the observed state so the test can
  // pass "succeeded" / "failed" (UI convention) or "success" / "failure"
  // (API convention) and still match either form.
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
      const got = normalize(last.state);
      if (got === want) {
        return last;
      }
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

/**
 * Helper: wait for a server to reach a specific state
 *
 * Same naming-convention dance as waitForBuildState: the UI uses
 * "running"/"stopped"/"error"/"crashed"/"disconnected" while
 * the API uses the same words. The only mismatch is the build
 * API, so this helper mostly just delegates to getServerViewState.
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

/**
 * Helper: wait for the server that belongs to a specific project to reach
 * the target state. Unlike waitForServerState, this queries the agent API
 * directly and filters by projectId, so a stale Servers view or sibling
 * SHARD servers cannot confuse the check.
 */
export async function waitForServerStateForProject(
  page: Page,
  projectId: string,
  targetState: string,
  timeoutMs = 120_000,
): Promise<unknown | null> {
  const agentBase = process.env.AGENT_PORT ? `http://127.0.0.1:${process.env.AGENT_PORT}` : 'http://127.0.0.1:18300';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const match = await page.evaluate(async (args) => {
        const { base, pid, target } = args;
        const r = await fetch(`${base}/api/v1/servers`, { signal: AbortSignal.timeout(5_000) });
        if (!r.ok) return null;
        const body = await r.json();
        const list = body?.payload || [];
        return list.find((s: Record<string, unknown>) => s.projectId === pid && s.state === target) || null;
      }, { base: agentBase, pid: projectId, target: targetState });
      if (match) return match;
    } catch {
      /* ignore polling errors */
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
 * Helper: resolve the base URL of the first running Tomcat server.
 *
 * KAIRO-RC-WEB-2026-07-26: tests must not assume a fixed Tomcat port.
 * The Runtime Agent may allocate a configured default port (e.g. 18302)
 * or fall back to the port allocator's range. Read the actual HTTP port
 * from the server view / API and build the base URL from it.
 *
 * Only RUNNING servers are considered; stopped/crashed servers may still
 * own entries in the API but cannot serve traffic.
 */
export async function getTomcatBaseUrl(page: Page, fallbackPort = '18302'): Promise<string> {
  // 1. Prefer the running server in the API (most accurate).
  try {
    const agentBase = process.env.AGENT_PORT ? `http://127.0.0.1:${process.env.AGENT_PORT}` : 'http://127.0.0.1:18300';
    const res = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/v1/servers`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return null;
      const body = await r.json();
      const list = body?.payload || [];
      const running = list.filter((s: Record<string, unknown>) => s.state === 'running' || s.state === 'starting');
      return running.map((s: Record<string, unknown>) => (s.ports as Record<string, number> | undefined)?.http).filter((p: unknown): p is number => typeof p === 'number' && p > 0);
    }, agentBase);
    if (Array.isArray(res) && res.length > 0) {
      // KAIRO-RC-WEB-2026-07-26: prefer the configured default port when
      // available, but fall back to the first running server otherwise.
      const preferred = parseInt(fallbackPort, 10);
      if (res.includes(preferred)) {
        return `http://127.0.0.1:${preferred}`;
      }
      return `http://127.0.0.1:${res[0]}`;
    }
  } catch {
    /* fall through to UI probe */
  }
  // 2. Fallback: probe the running servers via UI state.
  const servers = await getServerViewState(page);
  const running = servers.filter(
    (srv) => (srv as Record<string, string>).state === 'running',
  ) as Array<Record<string, unknown>>;
  const preferred = parseInt(fallbackPort, 10);
  for (const srv of running) {
    const httpPort = (srv.httpPort as number) || 0;
    if (httpPort === preferred && httpPort > 0) {
      return `http://127.0.0.1:${httpPort}`;
    }
  }
  for (const srv of running) {
    const httpPort = (srv.httpPort as number) || 0;
    if (httpPort > 0) {
      return `http://127.0.0.1:${httpPort}`;
    }
  }
  return `http://127.0.0.1:${fallbackPort}`;
}

/**
 * Helper: return the base URL of the running Tomcat server that belongs to a
 * specific project. This avoids the ambiguity of getTomcatBaseUrl when more
 * than one server is running (e.g. leftover instances from sibling SHARDs).
 */
export async function getTomcatBaseUrlForProject(page: Page, projectId: string, fallbackPort = '18302'): Promise<string> {
  const agentBase = process.env.AGENT_PORT ? `http://127.0.0.1:${process.env.AGENT_PORT}` : 'http://127.0.0.1:18300';
  try {
    const res = await page.evaluate(async (args) => {
      const { base, pid } = args;
      const r = await fetch(`${base}/api/v1/servers`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const body = await r.json();
      const list = body?.payload || [];
      const match = list.find((s: Record<string, unknown>) => s.projectId === pid && (s.state === 'running' || s.state === 'starting'));
      if (!match) return null;
      const ports = (match.ports as Record<string, number>) || {};
      return ports.http || 0;
    }, { base: agentBase, pid: projectId });
    if (typeof res === 'number' && res > 0) {
      return `http://127.0.0.1:${res}`;
    }
  } catch {
    /* fall through */
  }
  return `http://127.0.0.1:${fallbackPort}`;
}

/**
 * Helper: stop every running Tomcat server for the current project.
 *
 * Tests that start servers must begin from a clean state; otherwise
 * previous tests leave behind running instances that confuse port
 * detection and may serve stale webapps.
 */
export async function stopAllRunningServers(page: Page): Promise<void> {
  try {
    const agentBase = process.env.AGENT_PORT ? `http://127.0.0.1:${process.env.AGENT_PORT}` : 'http://127.0.0.1:18300';
    const ids = await page.evaluate(async (base) => {
      try {
        const r = await fetch(`${base}/api/v1/servers`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return [] as string[];
        const body = await r.json();
        const list = body?.payload || [];
        return list
          .filter((s: Record<string, unknown>) => (s.state === 'running' || s.state === 'starting') && s.id)
          .map((s: Record<string, unknown>) => String(s.id));
      } catch {
        return [] as string[];
      }
    }, agentBase);
    for (const id of ids) {
      try {
        await page.evaluate(async (args) => {
          const { base, serverId } = args;
          await fetch(`${base}/api/v1/servers/${serverId}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(15_000),
          });
        }, { base: agentBase, serverId: id });
      } catch {
        /* ignore cleanup errors */
      }
    }
  } catch {
    /* ignore cleanup errors */
  }
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