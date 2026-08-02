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
import * as cp from 'node:child_process';
// Use CJS require so setup-tmp.cjs's monkey-patch of os.tmpdir() is visible.
// (esbuild's __toESM shallow-copies the builtin namespace, hiding the patch.)
const os = require('node:os') as typeof import('node:os');

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
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // Windows EBUSY: the shared Theia backend holds watcher/file handles on
      // the workspace. Fall back to in-place overwrite (copyDirSync below);
      // stale extra files are harmless because tests only assert on files
      // that exist in legacy-sample.
      console.warn(
        `[fixtures] removeDirSync failed, falling back to overwrite: ${(err as Error).message}`,
      );
    }
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

    // KAIRO-S27 / E2E-SERVER: earlier tests leave Tomcat (and possibly JDT)
    // java processes alive. On Windows those processes hold file handles on
    // the shared workspace (EBUSY on delete) and stale "running" records,
    // which break server-start / port tests. Kill leftover java processes
    // before refreshing the workspace.
    try {
      cp.execSync('taskkill /F /IM java.exe', { stdio: 'ignore' });
    } catch {
      /* no java process to kill */
    }
    await new Promise((r) => setTimeout(r, 500));

    // Ensure the shared workspace exists and is up-to-date
    removeDirSync(rootPath);
    copyDirSync(LEGACY_SAMPLE_ROOT, rootPath);

    // Collect source files for reference
    const sourceFiles = collectSourceFiles(rootPath);

    const ctx: WorkspaceContext = { rootPath, projectName, sourceFiles };

    // Register workspace with the agent (idempotent)
    const api = createAgentApi();
    await api.post('/api/v1/workspaces', { rootPath });

    // KAIRO-RC-WEB-040 / KAIRO-S27: delete any prior import of this project so
    // the Import Wizard's re-import does not hit "project already exists: 409".
    await api.delete(`/api/v1/projects/project-${projectName}`);

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
  // Dismiss any stale quick input first. Theia keeps a hidden instance around
  // when a previous quick-open was interrupted (e.g. focus stolen by the
  // import wizard), and pressing Ctrl+P again would only re-show that one.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
    try {
      await page.waitForSelector('.quick-input-widget:visible', { timeout: 4_000 });
      opened = true;
    } catch {
      // The widget may already exist but be hidden; close it and retry.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await page.keyboard.type(fileName, { delay: 50 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);
  // Best-effort: wait for Monaco to show content for the opened file.
  try {
    await page.locator('.monaco-editor .view-lines').first().waitFor({ state: 'visible', timeout: 15_000 });
  } catch { /* caller may open differently */ }
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

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(200);

  // Check if import wizard is already open; if not, open it via the command palette.
  // UI may be zh-CN — command label is localized via i18n (`Kairo: 导入项目`).
  const step2Open = (await page.locator('[data-testid="import-project-btn"]').count()) > 0;
  const step3Open = (await page.locator('[data-testid="open-project-btn"]').count()) > 0;
  let wizardOpen = (await page.locator('[data-testid="path-input"]').count()) > 0;

  if (step3Open) {
    // Already at success step — fall through.
  } else if (step2Open && !wizardOpen) {
    // Continue from confirm step.
  } else if (!wizardOpen) {
    const openAttempts = [
      'Kairo: 导入项目',
      'Kairo: Import Project',
      '导入项目',
      'Import Project',
    ];
    for (const label of openAttempts) {
      try {
        await runCommandViaPalette(page, label);
      } catch { /* try next */ }
      try {
        await page.waitForSelector(
          '[data-testid="path-input"], [data-testid="import-project-btn"]',
          { timeout: 5_000 },
        );
        wizardOpen = true;
        break;
      } catch { /* try next label */ }
    }
    if (!wizardOpen) {
      // Welcome-page primary button fallback
      const welcomeImport = page.locator(
        'button:has-text("导入项目"), button:has-text("Import Project"), [data-testid="welcome-import"]',
      ).first();
      if ((await welcomeImport.count()) > 0) {
        await welcomeImport.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(800);
      }
      try {
        await page.waitForSelector(
          '[data-testid="path-input"], [data-testid="import-project-btn"]',
          { timeout: 10_000 },
        );
      } catch {
        return { opened: false, reason: 'import-wizard-did-not-open' };
      }
    }
  }

  // Step 1: Fill path and click Scan (skip if already on step 2/3)
  const stillOnStep1 = (await page.locator('[data-testid="path-input"]').count()) > 0
    && (await page.locator('[data-testid="import-project-btn"]').count()) === 0;
  if (stillOnStep1) {
    const pathInput = page.locator('[data-testid="path-input"]').first();
    await pathInput.click();
    await pathInput.fill(projectPath);
    const scanBtn = page.locator('[data-testid="scan-btn"]').first();
    if (await scanBtn.count() > 0 && await scanBtn.isEnabled()) {
      await scanBtn.click();
    } else {
      await pathInput.press('Enter');
    }
  }

  // Wait for step 2 to appear (unless already on step 3)
  if ((await page.locator('[data-testid="open-project-btn"]').count()) === 0) {
    try {
      await page.waitForSelector('[data-testid="import-project-btn"]', {
        timeout: 30_000,
      });
    } catch {
      return { opened: false, reason: 'scan-did-not-advance' };
    }
  }
  if (Date.now() > deadline) {
    return { opened: false, reason: 'timeout-before-step-2' };
  }

  // Step 2: Click "Import Project" if present
  const importBtn = page.locator('[data-testid="import-project-btn"]').first();
  if ((await importBtn.count()) > 0) {
    await importBtn.click();
  } else if ((await page.locator('[data-testid="open-project-btn"]').count()) === 0) {
    return { opened: false, reason: 'import-button-missing' };
  }

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
      // KAIRO-S27: 兼容 zh 文案（项目：/项目：（无工作区））与 en 文案（Project: ...）
      const hasNoProject =
        t.includes('Project: (no workspace)') || t.includes('项目：（无工作区）') || t.includes('项目: (未导入)') || t.includes('项目：（未导入）');
      const hasProject = /(Project:|项目[:：])/.test(t);
      if (!hasNoProject && hasProject) {
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
      // KAIRO-S27 / E2E-03: reopening an already-open workspace root makes
      // "Open Project Folder" a no-op, which can leave the wizard's success
      // dialog on screen and block every later modal (e.g. the Search
      // Center). Explicitly close it when it is still visible.
      await page
        .locator('[data-testid="ready-close-btn"]')
        .click({ timeout: 3_000 })
        .catch(() => {/* wizard already closed */});
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
      // Sort newest-first so callers that take [0] get the most recent server
      // instead of an old stopped record (KAIRO-S27: agent keeps history).
      return list
        .slice()
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          String(b.startedAt || '').localeCompare(String(a.startedAt || '')),
        )
        .map((s: Record<string, unknown>) => {
          const ports = (s.ports as Record<string, number>) || {};
          return {
            state: s.state,
            stateText: String(s.state || ''),
            stateAttr: String(s.state || ''),
            url: s.url || '',
            httpPort: ports.http || 0,
            debugPort: ports.debug || 0,
            startedAt: String(s.startedAt || ''),
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
/**
 * Normalize a build state to the UI convention
 * ("succeeded"/"failed") regardless of whether it came from the
 * UI (`data-state` = "succeeded") or the Runtime Agent API
 * (state = "success"/"failure").
 */
export function normalizeBuildState(state: string): string {
  if (state === 'succeeded' || state === 'success') return 'succeeded';
  if (state === 'failed' || state === 'failure') return 'failed';
  return state;
}

export async function waitForBuildState(
  page: Page,
  targetState: string,
  timeoutMs = 120_000,
): Promise<unknown | null> {
  const want = normalizeBuildState(targetState);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const builds = await getBuildViewState(page);
    if (builds && builds.length > 0) {
      const last = builds[builds.length - 1] as Record<string, string>;
      const got = normalizeBuildState(last.state);
      if (got === want) {
        // Return the normalized state so callers can assert on a
        // stable value regardless of whether the source was the UI
        // ("succeeded") or the agent API ("success").
        return { ...last, state: got };
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
 * Waits for JDT LS to be ready. Polls the status bar until the JDK entry
 * shows a concrete version (e.g. "JDK: 17"), which is the readiness signal
 * since Session 16 Phase F merged the Java/JDT LS states into one entry
 * (JDT LS state only lives in the tooltip). During startup the entry shows
 * a state word instead ("JDK: starting" / "JDK: initializing"), and the
 * initial placeholder is "JDK: -", so a version pattern is unambiguous.
 */
export async function waitForJavaReady(
  page: Page,
  timeoutMs = 120_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    // KAIRO-S27: JDK 条目在 en/zh 下冒号不同（"JDK: 17" / "JDK：17"），两者都接受。
    if (/JDK[：:]\s*\d/.test(t)) return true;
    await page.waitForTimeout(500);
  }
  return false;
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
  await gotoEditorLine(page, lineNumber);
  await page.keyboard.press('F9');
  await page.waitForTimeout(500);
}

/**
 * Whether status-bar text indicates a paused debug session.
 * Matches EN ("Debug: paused") and zh-CN ("调试：paused").
 */
export function isDebugPausedStatus(statusBarText: string): boolean {
  return /(?:Debug|调试)\s*[:：]\s*paused/i.test(statusBarText)
    || /Paused on breakpoint/i.test(statusBarText)
    || /已暂停/.test(statusBarText);
}

/**
 * Waits for the debug session to pause (e.g., at a breakpoint).
 * Checks the status bar for "Debug: paused" / "调试：paused".
 */
export async function waitForDebugPaused(
  page: Page,
  timeoutMs = 60_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    if (isDebugPausedStatus(t)) {
      return true;
    }
    // Also check for the debug paused indicator in the DOM
    const pausedInDom = await page.evaluate(() => {
      const highlighted = document.querySelector(
        '.monaco-editor .debug-current-line, .monaco-editor .debug-top-stack-frame, .monaco-editor .debug-top-stack-frame-line',
      );
      if (highlighted) return true;
      const labels = document.querySelectorAll('.theia-TreeNodeLabel, .monaco-list-row, [class*="debug"]');
      for (const el of Array.from(labels)) {
        if (/Paused on breakpoint|已暂停/i.test(el.textContent || '')) return true;
      }
      return false;
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

// ---------------------------------------------------------------------------
// Deep-debug helpers (DBG-DEEP / shard-06b) — click / hover first
// ---------------------------------------------------------------------------

export type DebugToolbarAction =
  | 'continue'
  | 'pause'
  | 'stop'
  | 'restart'
  | 'stepOver'
  | 'stepInto'
  | 'stepOut'
  | 'runToCursor'
  | 'muteBreakpoints'
  | 'dropFrame'
  | 'evaluate';

const DEBUG_TOOLBAR_ICON: Record<DebugToolbarAction, string> = {
  continue: 'codicon-debug-continue',
  pause: 'codicon-debug-pause',
  stop: 'codicon-debug-stop',
  restart: 'codicon-debug-restart',
  stepOver: 'codicon-debug-step-over',
  stepInto: 'codicon-debug-step-into',
  stepOut: 'codicon-debug-step-out',
  runToCursor: 'codicon-debug-continue',
  muteBreakpoints: 'codicon-debug-disconnect',
  dropFrame: 'codicon-debug-reverse-continue',
  evaluate: 'codicon-debug-console',
};

/**
 * Go to a line in the active Monaco editor (Ctrl+G).
 */
export async function gotoEditorLine(page: Page, lineNumber: number): Promise<void> {
  const editor = page.locator('.monaco-editor .view-lines').first();
  await editor.waitFor({ state: 'visible', timeout: 30_000 });
  await editor.click({ timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(400);
  await page.keyboard.type(String(lineNumber), { delay: 20 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/**
 * Click the editor gutter to toggle a breakpoint on `lineNumber`.
 * Falls back to F9 if the gutter click does not produce a glyph.
 */
export async function clickGutterBreakpoint(
  page: Page,
  filePath: string,
  lineNumber: number,
): Promise<boolean> {
  await openFileInEditor(page, filePath);
  await page.waitForTimeout(800);
  await gotoEditorLine(page, lineNumber);

  const clicked = await page.evaluate((line) => {
    const overlays = document.querySelector(
      '.monaco-editor .margin-view-overlays, .monaco-editor .glyph-margin',
    );
    if (!overlays) return false;
    const lineNodes = overlays.querySelectorAll('.cgmr, .margin-view-overlays > div, .line-numbers');
    // Prefer exact line-number element
    const numbers = document.querySelectorAll('.monaco-editor .line-numbers');
    for (const el of Array.from(numbers)) {
      if ((el.textContent || '').trim() === String(line)) {
        const r = (el as HTMLElement).getBoundingClientRect();
        const cx = Math.max(2, r.left - 8);
        const cy = r.top + r.height / 2;
        const target = document.elementFromPoint(cx, cy) as HTMLElement | null;
        if (target) {
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy }));
          return true;
        }
      }
    }
    void lineNodes;
    return false;
  }, lineNumber);

  if (!clicked) {
    // Pixel click on margin relative to editor
    const editor = page.locator('.monaco-editor').first();
    const box = await editor.boundingBox();
    if (box) {
      const lineHeight = await page.evaluate(() => {
        const ln = document.querySelector('.monaco-editor .view-line') as HTMLElement | null;
        return ln ? ln.getBoundingClientRect().height || 18 : 18;
      });
      // Approximate: gutter ~ 40px from left; line offset from top of view
      const currentLineInfo = await page.evaluate(() => {
        const cur = document.querySelector('.monaco-editor .current-line, .monaco-editor .view-overlays .current-line');
        if (cur) {
          const r = (cur as HTMLElement).getBoundingClientRect();
          return { y: r.top + r.height / 2 };
        }
        return null;
      });
      const y = currentLineInfo?.y ?? box.y + 40 + (lineNumber - 1) * lineHeight;
      await page.mouse.click(box.x + 12, y);
    } else {
      await page.keyboard.press('F9');
    }
  }

  await page.waitForTimeout(600);
  let hasGlyph = await hasBreakpointGlyph(page);
  if (!hasGlyph) {
    await page.keyboard.press('F9');
    await page.waitForTimeout(500);
    hasGlyph = await hasBreakpointGlyph(page);
  }
  return hasGlyph;
}

/**
 * Whether a breakpoint glyph is visible in the active editor margin.
 */
export async function hasBreakpointGlyph(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sels = [
      '.monaco-editor .codicon-debug-breakpoint',
      '.monaco-editor .cgmr.codicon-debug-breakpoint',
      '.monaco-editor .margin-view-overlays .codicon-debug-breakpoint',
      '.monaco-editor .glyph-margin-widget',
      '[class*="debug-breakpoint"]',
    ];
    for (const s of sels) {
      if (document.querySelector(s)) return true;
    }
    return false;
  });
}

/**
 * Assert debug session is paused (status bar or current-line decoration).
 */
export async function assertDebugPaused(page: Page, timeoutMs = 30_000): Promise<void> {
  const ok = await waitForDebugPaused(page, timeoutMs);
  if (!ok) {
    throw new Error('Expected debug session to be paused (status bar / current-line decoration)');
  }
}

/**
 * Best-effort current debug line number from Monaco decorations / cursor.
 */
export async function getCurrentDebugLine(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const highlighted = document.querySelector(
      '.monaco-editor .debug-top-stack-frame-line, .monaco-editor .debug-current-line, .monaco-editor .view-overlays .current-line',
    ) as HTMLElement | null;
    if (highlighted) {
      const numbers = document.querySelectorAll('.monaco-editor .line-numbers');
      const hy = highlighted.getBoundingClientRect().top + highlighted.getBoundingClientRect().height / 2;
      let best: { line: number; dist: number } | null = null;
      for (const n of Array.from(numbers)) {
        const text = (n.textContent || '').trim();
        const line = parseInt(text, 10);
        if (!Number.isFinite(line)) continue;
        const r = (n as HTMLElement).getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - hy);
        if (!best || dist < best.dist) best = { line, dist };
      }
      if (best && best.dist < 20) return best.line;
    }
    // Fallback: status / active line number class
    const active = document.querySelector('.monaco-editor .line-numbers.active-line-number');
    if (active) {
      const line = parseInt((active.textContent || '').trim(), 10);
      return Number.isFinite(line) ? line : null;
    }
    return null;
  });
}

/**
 * Assert the paused debug line equals (or is near) `expectedLine`.
 */
export async function assertCurrentDebugLine(
  page: Page,
  expectedLine: number,
  tolerance = 0,
): Promise<void> {
  const line = await getCurrentDebugLine(page);
  if (line === null) {
    throw new Error(`Expected debug line ~${expectedLine}, but could not read current line`);
  }
  if (Math.abs(line - expectedLine) > tolerance) {
    throw new Error(`Expected debug line ~${expectedLine} (±${tolerance}), got ${line}`);
  }
}

/**
 * Click a debug toolbar button (Kairo IDEA toolbar or Theia/codicon fallback).
 */
export async function clickDebugToolbar(
  page: Page,
  action: DebugToolbarAction,
): Promise<boolean> {
  const icon = DEBUG_TOOLBAR_ICON[action];
  // Prefer Kairo IDEA toolbar button by icon class
  const ideaBtn = page.locator(
    `.kairo-debug-toolbar-idea .kairo-debug-toolbar-btn .${icon}, .kairo-debug-toolbar-idea .${icon}`,
  ).first();
  if ((await ideaBtn.count()) > 0) {
    try {
      await ideaBtn.click({ timeout: 3_000 });
      await page.waitForTimeout(400);
      return true;
    } catch { /* fall through */ }
  }

  const legacyBtn = page.locator(
    `.kairo-debug-toolbar-widget .${icon}, .theia-debug-toolbar .${icon}, .debug-toolbar .${icon}`,
  ).first();
  if ((await legacyBtn.count()) > 0) {
    try {
      await legacyBtn.click({ timeout: 3_000 });
      await page.waitForTimeout(400);
      return true;
    } catch { /* fall through */ }
  }

  // Title-based fallback (localized labels may vary; use common English fragments)
  const titleHints: Partial<Record<DebugToolbarAction, RegExp>> = {
    continue: /resume|continue|继续/i,
    pause: /pause|暂停/i,
    stop: /stop|停止/i,
    restart: /restart|rerun|重新/i,
    stepOver: /step over|单步跳过|跳过/i,
    stepInto: /step into|单步进入|进入/i,
    stepOut: /step out|单步跳出|跳出/i,
    muteBreakpoints: /mute|静音|禁用断点/i,
    dropFrame: /drop frame|丢弃帧/i,
    evaluate: /evaluate|求值/i,
  };
  const hint = titleHints[action];
  if (hint) {
    const byTitle = page.locator(`.kairo-debug-toolbar-btn[title]`).filter({ hasText: hint }).first();
    // title is an attribute — filter via evaluate
    const clicked = await page.evaluate((reSource) => {
      const re = new RegExp(reSource, 'i');
      const btns = document.querySelectorAll('.kairo-debug-toolbar-btn, .theia-debug-toolbar .theia-ui-button, button');
      for (const b of Array.from(btns)) {
        const title = b.getAttribute('title') || b.getAttribute('aria-label') || '';
        if (re.test(title)) {
          (b as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, hint.source);
    if (clicked) {
      await page.waitForTimeout(400);
      return true;
    }
    void byTitle;
  }

  // Keyboard fallback for core actions
  const keys: Partial<Record<DebugToolbarAction, string>> = {
    continue: 'F5',
    stop: 'Shift+F5',
    stepOver: 'F10',
    stepInto: 'F11',
    stepOut: 'Shift+F11',
    runToCursor: 'Alt+F9',
  };
  const key = keys[action];
  if (key) {
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

/**
 * Hover a specific identifier in the editor and return debug-hover text if shown.
 * Locates the word via Monaco view-line text content (no blind pixel hover).
 */
export async function hoverEditorIdentifier(
  page: Page,
  word: string,
  timeoutMs = 5_000,
): Promise<string> {
  // Find the DOM span that contains the identifier and hover its center
  const found = await page.evaluate((w) => {
    const lines = document.querySelectorAll('.monaco-editor .view-line span span, .monaco-editor .view-line span');
    for (const el of Array.from(lines)) {
      const text = (el.textContent || '').trim();
      if (text === w || text.includes(w)) {
        // Prefer exact token match
        if (text !== w && !new RegExp(`\\b${w}\\b`).test(text)) continue;
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { x: r.left + Math.min(r.width / 2, 8), y: r.top + r.height / 2, ok: true };
        }
      }
    }
    return { x: 0, y: 0, ok: false };
  }, word);

  if (!found.ok) {
    throw new Error(`hoverEditorIdentifier: could not locate identifier "${word}" in editor DOM`);
  }

  await page.mouse.move(found.x, found.y);
  await page.waitForTimeout(800);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => {
      const sels = [
        '.kairo-debug-hover-widget',
        '.debug-hover-widget',
        '.monaco-hover',
        '.theia-debug-hover',
        '[class*="debug-hover"]',
      ];
      for (const s of sels) {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return (el.textContent || '').trim();
          }
        }
      }
      return '';
    });
    if (text) return text;
    await page.waitForTimeout(250);
  }
  return '';
}

/**
 * Set / update a conditional breakpoint at `lineNumber` with expression `condition`.
 * Prefers command palette; falls back to F9 + Edit Breakpoint flow.
 */
export async function setConditionalBreakpoint(
  page: Page,
  filePath: string,
  lineNumber: number,
  condition: string,
): Promise<void> {
  await openFileInEditor(page, filePath);
  await page.waitForTimeout(600);
  await gotoEditorLine(page, lineNumber);

  // Ensure a breakpoint exists first
  if (!(await hasBreakpointGlyph(page))) {
    await page.keyboard.press('F9');
    await page.waitForTimeout(400);
  }

  try {
    await runCommandViaPalette(page, 'Debug: Edit Breakpoint');
  } catch {
    try {
      await runCommandViaPalette(page, 'Debug: Add Conditional Breakpoint');
    } catch {
      /* continue to input probe */
    }
  }
  await page.waitForTimeout(600);

  const condInput = page.locator(
    '.quick-input-widget .quick-input-box input, .monaco-inputbox input, .theia-input[type="text"]:visible, input.theia-input:visible',
  ).first();
  if ((await condInput.count()) > 0) {
    await condInput.fill(condition, { timeout: 5_000 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    return;
  }

  // Right-click glyph → Edit Breakpoint
  const glyph = page.locator('.monaco-editor .codicon-debug-breakpoint').first();
  if ((await glyph.count()) > 0) {
    await glyph.click({ button: 'right', timeout: 3_000 });
    await page.waitForTimeout(400);
    const editItem = page.locator('.p-Menu-itemLabel, .monaco-menu .action-label').filter({
      hasText: /edit breakpoint|conditional|编辑断点|条件/i,
    }).first();
    if ((await editItem.count()) > 0) {
      await editItem.click({ timeout: 3_000 });
      await page.waitForTimeout(400);
      const input2 = page.locator(
        '.quick-input-widget .quick-input-box input, .monaco-inputbox input, input:visible',
      ).first();
      if ((await input2.count()) > 0) {
        await input2.fill(condition, { timeout: 5_000 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }
    }
  }
}

/**
 * Collect variable name/value pairs from any visible debug variables widget.
 */
export async function collectDebugVariableEntries(
  page: Page,
): Promise<Array<{ name: string; value: string }>> {
  // Dismiss leftover palettes; expand Locals if collapsed.
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  } catch { /* ignore */ }
  await page.evaluate(() => {
    const labels = document.querySelectorAll(
      '.theia-TreeNodeLabel, .monaco-list-row, .theia-debug-variables .theia-TreeNode, [class*="variable"]',
    );
    for (const el of Array.from(labels)) {
      const text = (el.textContent || '').trim();
      if (/^Locals$/i.test(text) || /^局部变量$/i.test(text)) {
        (el as HTMLElement).click();
        const twistie = el.closest('.theia-TreeNode')?.querySelector('.theia-ExpansionToggle, .codicon-tree-item-expanded, .codicon-chevron-right, .codicon-chevron-down');
        if (twistie) (twistie as HTMLElement).click();
      }
    }
  });
  await page.waitForTimeout(600);

  return page.evaluate(() => {
    const selectors = [
      '.theia-debug-variables .theia-TreeNode',
      '.theia-debug-variables .monaco-list-row',
      '.kairo-debug-variables .theia-TreeNode',
      '.kairo-debug-variables-idea [class*="variable"]',
      '.debug-variables .theia-TreeNode',
      '[id*="debug.variables"] .theia-TreeNode',
      '[id*="debug.variables"] .monaco-list-row',
      '[data-testid="debug-variables"] .theia-TreeNode',
      '.kairo-debug-tool-window [class*="variable"]',
      '.theia-debug-session .theia-TreeNode',
    ];
    const items: Array<{ name: string; value: string }> = [];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      if (nodes.length === 0) continue;
      for (const n of Array.from(nodes).slice(0, 80)) {
        const text = (n.textContent || '').trim();
        if (!text || /^(Local|Locals|Global|Arguments|Scopes|局部变量)/i.test(text)) continue;
        const m = text.match(/^(\S+)\s*[:=]?\s*(.*)$/);
        if (m) items.push({ name: m[1], value: m[2] || '' });
        else items.push({ name: text, value: '' });
      }
      if (items.length > 0) break;
    }
    return items;
  });
}

/**
 * Trigger a GET to the sample HelloServlet and close the tab.
 */
export async function triggerHelloRequest(
  page: Page,
  baseUrl: string,
  pathSuffix = '/hello',
): Promise<number | null> {
  const url = `${baseUrl.replace(/\/$/, '')}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const tab = await page.context().newPage();
  try {
    const resp = await tab.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
    await tab.waitForTimeout(800);
    return resp ? resp.status() : null;
  } catch {
    return null;
  } finally {
    try { await tab.close(); } catch { /* ignore */ }
  }
}

/**
 * Query Agent GET /api/v1/debug/adapter/status for availability.
 */
export async function getDebugAdapterStatus(
  request: { get: (url: string) => Promise<{ ok: () => boolean; json: () => Promise<unknown> }> },
): Promise<{ available: boolean; raw: unknown }> {
  const agentBase = `http://127.0.0.1:${process.env.AGENT_PORT || '18300'}`;
  try {
    const res = await request.get(`${agentBase}/api/v1/debug/adapter/status`);
    const json = await res.json();
    const payload = (json as { payload?: Record<string, unknown> })?.payload || json;
    const text = JSON.stringify(payload || {}).toLowerCase();
    const available =
      text.includes('available') ||
      text.includes('"ready"') ||
      text.includes('adapterpath') ||
      text.includes('jdk') ||
      (!text.includes('unavailable') && !text.includes('not configured'));
    return { available: !!available && res.ok(), raw: payload };
  } catch (err) {
    return { available: false, raw: String(err) };
  }
}

/**
 * Wait until debug is no longer paused (resumed or terminated).
 */
export async function waitForDebugResumed(
  page: Page,
  timeoutMs = 15_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getStatusBarText(page);
    const pausedDom = await page.evaluate(() => {
      return !!document.querySelector(
        '.monaco-editor .debug-current-line, .monaco-editor .debug-top-stack-frame-line',
      );
    });
    if (!isDebugPausedStatus(t) && !pausedDom) {
      // Prefer explicit connected/running, but absence of paused is enough
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * Count visible call-stack frames in Theia / Kairo debug views.
 */
export async function getCallStackFrameCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sels = [
      '.theia-debug-stack-frames .theia-TreeNode',
      '.theia-debug-stack-frames .monaco-list-row',
      '.kairo-debug-callstack .theia-TreeNode',
      '.kairo-debug-frames-idea [class*="frame"]',
      '[id*="debug.callStack"] .theia-TreeNode',
      '[id*="debug.callstack"] .monaco-list-row',
    ];
    for (const s of sels) {
      const n = document.querySelectorAll(s).length;
      if (n > 0) return n;
    }
    return 0;
  });
}